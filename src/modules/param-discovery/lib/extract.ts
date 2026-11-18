/**
 * modules/param-discovery/lib/extract.ts — pure extraction + dedup logic.
 *
 * No chrome.* and no side effects: identical code runs in content scripts
 * and in unit tests. JS sources are analyzed as TEXT only — nothing is
 * ever evaluated. Values are samples, capped, and never replayed.
 */
import type {
  ParamConfidence,
  ParamObservation,
  ParamRecord,
} from '@shared/types/param';

const MAX_SAMPLE = 64;
const NAME_RE = /^[A-Za-z_][\w.\[\]-]{0,32}$/;

function now(): string {
  return new Date().toISOString();
}

function obs(
  name: string,
  source: ParamObservation['source'],
  kind: ParamObservation['kind'],
  pageUrl: string,
  extra: Partial<ParamObservation> = {},
): ParamObservation | null {
  if (!name || !NAME_RE.test(name)) return null;
  return {
    name,
    source,
    kind,
    pageUrl,
    seenAt: now(),
    confidence: 'medium',
    ...extra,
  };
}

function cap(value: string | null | undefined): string | undefined {
  if (value == null) return undefined;
  const v = value.slice(0, MAX_SAMPLE);
  return v === '' ? undefined : v;
}

// ─── A. URL ──────────────────────────────────────────────────────────────────

/** Query + fragment parameters of the current URL. */
export function extractUrlParams(url: string): ParamObservation[] {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [];
  }
  const out: ParamObservation[] = [];
  for (const [name, value] of parsed.searchParams) {
    const o = obs(name, 'url', 'query', url, { sample: cap(value), confidence: 'high' });
    if (o) out.push(o);
  }
  // fragment-embedded query (e.g. #access_token=… or #?next=/x)
  const hash = parsed.hash.replace(/^#/, '');
  if (hash) {
    const qs = hash.startsWith('?') ? hash.slice(1) : hash;
    if (qs.includes('=')) {
      for (const pair of qs.split('&')) {
        const [name, value] = pair.split('=', 2);
        if (name) {
          const o = obs(decodeURIComponentSafe(name), 'url', 'fragment', url, {
            sample: cap(decodeURIComponentSafe(value ?? '')),
            confidence: 'high',
          });
          if (o) out.push(o);
        }
      }
    }
  }
  return out.filter((o): o is ParamObservation => o !== null);
}

function decodeURIComponentSafe(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

// ─── B/C. DOM ────────────────────────────────────────────────────────────────

const CONTROL_SELECTOR = 'input, select, textarea';

function docBase(doc: Document, pageUrl: string): string {
  // The scanned page's URL is the authoritative base for relative URLs
  // (a content script's location == page). Fallback order keeps tests and
  // odd embeddings working without fabricating anything.
  if (pageUrl.startsWith('http')) return pageUrl;
  if (doc.baseURI?.startsWith('http')) return doc.baseURI;
  return pageUrl;
}

/** Forms (with action/method), hidden inputs, standalone controls, data-param. */
export function extractDomParams(doc: Document, pageUrl: string): ParamObservation[] {
  const out: ParamObservation[] = [];
  const base = docBase(doc, pageUrl);

  // URL-literal query keys from <a href> and <form action>
  for (const el of doc.querySelectorAll<HTMLAnchorElement | HTMLFormElement>('a[href], form[action]')) {
    const target = el.getAttribute('href') ?? el.getAttribute('action');
    if (!target || !target.includes('?')) continue;
    try {
      const abs = new URL(target, base);
      for (const [name, value] of abs.searchParams) {
        const o = obs(name, 'dom', 'url-literal', pageUrl, { sample: cap(value), confidence: 'medium' });
        if (o) out.push(o);
      }
    } catch {
      // relative URL without base — skip, never fabricate
    }
  }

  const seenControls = new Set<Element>();
  for (const form of doc.querySelectorAll('form')) {
    const rawMethod = (form.getAttribute('method') ?? 'get').toUpperCase();
    const method = rawMethod === 'POST' ? 'POST' : 'GET';
    for (const el of form.querySelectorAll(CONTROL_SELECTOR)) {
      seenControls.add(el);
      const entry = controlObservation(el, pageUrl, method);
      if (entry) out.push(entry);
    }
  }

  // named controls outside any form
  for (const el of doc.querySelectorAll(CONTROL_SELECTOR)) {
    if (seenControls.has(el)) continue;
    const entry = controlObservation(el, pageUrl, undefined);
    if (entry) out.push(entry);
  }

  return out.filter((o): o is ParamObservation => o !== null);
}

function controlObservation(
  el: Element,
  pageUrl: string,
  method: 'GET' | 'POST' | undefined,
): ParamObservation | null {
  const name = el.getAttribute('name');
  const inputType = el.getAttribute('type') ?? undefined;

  // data-param="name" marks a control whose identifier lives in a data attribute
  const dataParam = el.getAttribute('data-param');
  if (dataParam && NAME_RE.test(dataParam)) {
    return obs(dataParam, 'dom', 'data-attr', pageUrl, {
      method,
      inputType,
      confidence: 'low',
    });
  }
  if (!name) return null;

  const isHidden = el.tagName === 'INPUT' && inputType?.toLowerCase() === 'hidden';
  const isForm = el.closest('form') !== null;
  const rawSample =
    isHidden
      ? el.getAttribute('value')
      : inputType?.toLowerCase() === 'password'
        ? undefined // never sample password values
        : el.getAttribute('value');

  return obs(name, 'dom', isHidden ? 'hidden' : isForm ? 'form-field' : 'dom-field', pageUrl, {
    method,
    inputType,
    sample: cap(rawSample ?? undefined),
    confidence: isHidden || isForm ? 'high' : 'medium',
  });
}

// ─── D. JavaScript (text analysis — never executed) ─────────────────────────

const QS_IN_STRING = /[?&]([A-Za-z_][\w.\[\]-]{0,32})=([^&"'`<>\s]{0,48})/g;
const USP_VAR = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+URLSearchParams/g;
const USP_USE = (v: string) =>
  new RegExp(`\\b${v.replace(/\$/g, '\\$')}\\.(?:get|getAll|set|append|has)\\(['"]([^'"]{1,40})['"]`, 'g');
const ANCHORED_OBJ = /(?:params|query|body|payload|filters|fields)\s*:\s*\{/g;
const OBJ_KEY = /(?:^|[,{])\s*['"]?([A-Za-z_$][\w$-]{1,32})['"]?\s*:/g;

/** Parameter-name patterns inside JS source text. */
export function extractJsParams(code: string, pageUrl: string): ParamObservation[] {
  const out: ParamObservation[] = [];

  for (const m of code.matchAll(QS_IN_STRING)) {
    const name = m[1];
    if (!name) continue;
    const o = obs(name, 'js', 'js-query', pageUrl, { sample: cap(m[2] ?? ''), confidence: 'medium' });
    if (o) out.push(o);
  }

  for (const vm of code.matchAll(USP_VAR)) {
    const varName = vm[1];
    if (!varName) continue;
    const use = USP_USE(varName);
    for (const m of code.matchAll(use)) {
      const name = m[1];
      if (!name) continue;
      const o = obs(name, 'js', 'js-searchparams', pageUrl, { confidence: 'medium' });
      if (o) out.push(o);
    }
  }

  for (const am of code.matchAll(ANCHORED_OBJ)) {
    const start = (am.index ?? 0) + am[0].length;
    const window = code.slice(start, start + 400);
    for (const km of window.matchAll(OBJ_KEY)) {
      const key = km[1];
      if (!key || /^(get|set|value|type|name|length|url|href|method)$/.test(key)) continue;
      const o = obs(key, 'js', 'js-object', pageUrl, { confidence: 'low' });
      if (o) out.push(o);
    }
  }

  return out;
}

// ─── Helpers used by the content script ─────────────────────────────────────

/** Inline <script> bodies (no src). */
export function collectInlineScripts(doc: Document): string[] {
  return [...doc.querySelectorAll('script:not([src])')]
    .map((s) => s.textContent ?? '')
    .filter((code) => code.trim().length > 0);
}

/** <script src> URLs, absolute. */
export function collectScriptSrcs(doc: Document, pageUrl: string): string[] {
  const srcs: string[] = [];
  const base = docBase(doc, pageUrl);
  for (const s of doc.querySelectorAll('script[src]')) {
    const raw = s.getAttribute('src');
    if (!raw) continue;
    try {
      const abs = new URL(raw, base);
      if (abs.protocol === 'http:' || abs.protocol === 'https:') srcs.push(abs.href);
    } catch {
      // unresolvable — skip
    }
  }
  return [...new Set(srcs)];
}

// ─── E. Deduplication ───────────────────────────────────────────────────────

/**
 * Merge observations into records. Identity = parameter name
 * (case-insensitive; the first spelling is kept for display).
 * Duplicate status surfaces as `occurrences` + per-source counts.
 */
export function dedupeParams(observations: ParamObservation[]): ParamRecord[] {
  const byKey = new Map<string, ParamRecord>();
  for (const o of observations) {
    const key = o.name.toLowerCase();
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        name: o.name,
        sources: { [o.source]: 1 },
        kinds: [o.kind],
        methods: o.method ? [o.method] : [],
        inputTypes: o.inputType ? [o.inputType] : [],
        firstPageUrl: o.pageUrl,
        lastPageUrl: o.pageUrl,
        firstSample: o.sample,
        confidence: o.confidence,
        occurrences: 1,
        firstSeenAt: o.seenAt,
        lastSeenAt: o.seenAt,
      });
      continue;
    }
    existing.sources[o.source] = (existing.sources[o.source] ?? 0) + 1;
    if (!existing.kinds.includes(o.kind)) existing.kinds.push(o.kind);
    if (o.method && !existing.methods.includes(o.method)) existing.methods.push(o.method);
    if (o.inputType && !existing.inputTypes.includes(o.inputType)) {
      existing.inputTypes.push(o.inputType);
    }
    existing.lastPageUrl = o.pageUrl;
    existing.firstSample ??= o.sample;
    existing.confidence = maxC(existing.confidence, o.confidence);
    existing.occurrences += 1;
    existing.lastSeenAt = o.seenAt;
  }
  return [...byKey.values()];
}

function maxC(a: ParamConfidence, b: ParamConfidence): ParamConfidence {
  const rank: Record<ParamConfidence, number> = { low: 0, medium: 1, high: 2 };
  return rank[a] >= rank[b] ? a : b;
}
