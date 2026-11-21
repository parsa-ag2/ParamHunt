/**
 * modules/param-discovery/lib/extract.ts — pure extraction + dedup logic.
 *
 * No chrome.* and no side effects: identical code runs in content scripts
 * and in unit tests. JS sources are analyzed as TEXT only — nothing is
 * ever evaluated. Values are samples, capped, and never replayed.
 */
import type {
  Evidence,
  ParamConfidence,
  ParamKind,
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
    const o = obs(name, 'url', 'query', url, {
      sample: cap(value),
      confidence: 'high',
      evidence: { url, snippet: `?${name}=${value}` },
    });
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
            evidence: { url, snippet: `#${name}=${value ?? ''}` },
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

/** Query keys from an <a href>/<form action> literal. */
function literalQueryKeys(el: Element, pageUrl: string, base: string): ParamObservation[] {
  const out: ParamObservation[] = [];
  const target = el.getAttribute('href') ?? el.getAttribute('action');
  if (!target || !target.includes('?')) return out;
  try {
    const abs = new URL(target, base);
    for (const [name, value] of abs.searchParams) {
      const o = obs(name, 'dom', 'url-literal', pageUrl, { sample: cap(value), confidence: 'medium' });
      if (o) out.push(o);
    }
  } catch {
    // relative URL without base — skip, never fabricate
  }
  return out;
}

/**
 * INCREMENTAL extraction: params from ONE element (a control, an <a>,
 * a <form>, or a container). Used by the MutationObserver path so the
 * full document is never rescanned — only newly added subtrees are.
 * `processed` marks elements already handled; callers skip those.
 */
export function extractFromNode(
  node: Element,
  pageUrl: string,
  doc: Document,
  processed: WeakSet<Element>,
): ParamObservation[] {
  const out: ParamObservation[] = [];
  const base = docBase(doc, pageUrl);

  const handle = (el: Element): void => {
    if (processed.has(el)) return;
    processed.add(el);
    if (el.matches('a[href], form[action]')) out.push(...literalQueryKeys(el, pageUrl, base));
    if (el.matches(CONTROL_SELECTOR)) {
      const form = el.closest('form');
      const rawMethod = (form?.getAttribute('method') ?? 'get').toUpperCase();
      const method = rawMethod === 'POST' ? ('POST' as const) : ('GET' as const);
      const o = controlObservation(el, pageUrl, method);
      if (o) out.push(o);
    }
    if (el.tagName === 'SCRIPT') {
      const src = el.getAttribute('src');
      if (!src) {
        const code = el.textContent ?? '';
        if (code.trim().length > 0 && code.length <= MAX_INLINE_SCRIPT_CHARS) {
          out.push(...extractJsParams(code, pageUrl));
        }
      }
    }
  };

  handle(node);
  // subtree additions (a <div> containing new inputs, a <form>, …)
  const bounded =
    node.children.length > 0 && node.querySelectorAll('*').length <= SUBTREE_SCAN_CAP
      ? node
      : node.matches('form') || node.children.length === 0
        ? node
        : null;
  if (bounded) {
    for (const el of bounded.querySelectorAll('a[href], form[action], form, ' + CONTROL_SELECTOR + ', script:not([src])')) {
      handle(el);
    }
  }
  return out;
}

/** Inline scripts larger than this are truncated before regex analysis. */
const MAX_INLINE_SCRIPT_CHARS = 500_000;
const SUBTREE_SCAN_CAP = 400;

export { controlObservation as extractControl };

/** Forms (with action/method), hidden inputs, standalone controls, data-param. */
export function extractDomParams(doc: Document, pageUrl: string): ParamObservation[] {
  const out: ParamObservation[] = [];
  const base = docBase(doc, pageUrl);

  // URL-literal query keys from <a href> and <form action>
  for (const el of doc.querySelectorAll<HTMLAnchorElement | HTMLFormElement>('a[href], form[action]')) {
    out.push(...literalQueryKeys(el, pageUrl, base));
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

  // evidence: compact attribute summary for the Found At view
  const tag = el.tagName.toLowerCase();
  const attrs: string[] = [tag];
  const id = el.getAttribute('id');
  if (id) attrs.push(`#${id}`);
  const cls = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean).slice(0, 2);
  if (cls.length) attrs.push(`.${cls.join('.')}`);
  for (const a of ['name', 'type']) {
    const v = el.getAttribute(a);
    if (v) attrs.push(`[${a}="${v}"]`);
  }
  const evidence: Evidence = {
    url: pageUrl,
    snippet: `<${attrs.join('')}>`,
  };

  // data-param="name" marks a control whose identifier lives in a data attribute
  const dataParam = el.getAttribute('data-param');
  if (dataParam && NAME_RE.test(dataParam)) {
    return obs(dataParam, 'dom', 'data-attr', pageUrl, {
      method,
      inputType,
      confidence: 'low',
      evidence,
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
    evidence,
  });
}

// ─── D. JavaScript (text analysis — never executed) ─────────────────────────

const QS_IN_STRING = /[?&]([A-Za-z_][\w.\[\]-]{0,32})=([^&"'`<>\s]{0,48})/g;
const USP_VAR = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+URLSearchParams/g;
const USP_USE = (v: string) =>
  new RegExp(`\\b${v.replace(/\$/g, '\\$')}\\.(?:get|getAll|set|append|has)\\(['"]([^'"]{1,40})['"]`, 'g');
const ANCHORED_OBJ = /(?:params|query|body|payload|filters|fields)\s*:\s*\{/g;
const OBJ_KEY = /(?:^|[,{])\s*['"]?([A-Za-z_$][\w$-]{1,32})['"]?\s*:/g;

/** Minified-code guard: JS-source names shorter than 2 chars are artifacts. */
const MIN_JS_NAME_LEN = 2;

/**
 * Line/Column locator — ONE pass to collect line offsets, then O(log n)
 * binary search per match. Keeps evidence extraction cheap on 1MB bundles.
 */
export class LineLocator {
  private readonly lineStarts: number[];
  private readonly lines: string[];
  constructor(private readonly code: string) {
    const starts = [0];
    const lines: string[] = [];
    let start = 0;
    for (let i = 0; i < code.length; i++) {
      if (code.charCodeAt(i) === 10) {
        lines.push(code.slice(start, i));
        start = i + 1;
        starts.push(i + 1);
      }
    }
    lines.push(code.slice(start));
    this.lineStarts = starts;
    this.lines = lines;
  }

  locate(index: number): { line: number; column: number; snippet: string } {
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((this.lineStarts[mid] ?? 0) <= index) lo = mid;
      else hi = mid - 1;
    }
    const line = lo + 1; // 1-based
    const column = index - (this.lineStarts[lo] ?? 0) + 1; // 1-based
    const raw = this.lines[lo] ?? '';
    const snippet = raw.length > 160 ? raw.slice(0, 160) : raw;
    return { line, column, snippet };
  }
}

/** Parameter-name patterns inside JS source text (with exact evidence). */
export function extractJsParams(
  code: string,
  pageUrl: string,
  sourceUrl?: string,
): ParamObservation[] {
  const out: ParamObservation[] = [];
  if (code.length === 0) return out;
  const locator = new LineLocator(code);

  const withEvidence = (
    name: string,
    kind: ParamKind,
    confidence: ParamConfidence,
    index: number,
    extra: Partial<ParamObservation> = {},
  ): void => {
    if (name.length < MIN_JS_NAME_LEN) return; // minified artifacts stay out
    const { line, column, snippet } = locator.locate(index);
    const o = obs(name, 'js', kind, pageUrl, {
      confidence,
      evidence: { url: sourceUrl ?? pageUrl, line, column, snippet },
      ...extra,
    });
    if (o) out.push(o);
  };

  for (const m of code.matchAll(QS_IN_STRING)) {
    const name = m[1];
    if (!name) continue;
    withEvidence(name, 'js-query', 'medium', m.index ?? 0, { sample: cap(m[2] ?? '') });
  }

  for (const vm of code.matchAll(USP_VAR)) {
    const varName = vm[1];
    if (!varName) continue;
    const use = USP_USE(varName);
    for (const m of code.matchAll(use)) {
      const name = m[1];
      if (!name) continue;
      withEvidence(name, 'js-searchparams', 'medium', m.index ?? 0);
    }
  }

  for (const am of code.matchAll(ANCHORED_OBJ)) {
    const start = (am.index ?? 0) + am[0].length;
    const window = code.slice(start, start + 400);
    for (const km of window.matchAll(OBJ_KEY)) {
      const key = km[1];
      if (!key || /^(get|set|value|type|name|length|url|href|method)$/.test(key)) continue;
      withEvidence(key, 'js-object', 'low', start + (km.index ?? 0));
    }
  }

  return out;
}

// ─── URL catalog extraction (PHASE 2 — comprehensive sources) ────────────────

export interface UrlCatalogEntry {
  url: string;
  source: 'page' | 'link' | 'form' | 'script' | 'inline-js' | 'meta' | 'embed' | 'other';
  evidence: { url: string; snippet?: string };
}

const URL_ATTR_SELECTOR =
  'a[href], form[action], script[src], link[href], iframe[src], img[src], source[src], video[src], audio[src], embed[src], [data-url], [data-src], [data-href]';
const SCHEME_OK = /^https?:\/\//i;

/** Collect catalog URLs from the live document (same-origin + first-party domains). */
export function collectCatalogUrls(doc: Document, pageUrl: string, isEligibleDomain: (u: string) => boolean): UrlCatalogEntry[] {
  const out = new Map<string, UrlCatalogEntry>();
  const base = docBase(doc, pageUrl);
  const add = (raw: string | null, source: UrlCatalogEntry['source'], evidenceSnippet?: string): void => {
    if (!raw) return;
    try {
      const abs = new URL(raw, base);
      if (!SCHEME_OK.test(abs.href)) return;
      if (!isEligibleDomain(abs.href)) return;
      if (out.has(abs.href)) return;
      out.set(abs.href, { url: abs.href, source, evidence: { url: pageUrl, snippet: evidenceSnippet } });
    } catch {
      // unresolvable — skip
    }
  };

  add(pageUrl, 'page');
  for (const el of doc.querySelectorAll(URL_ATTR_SELECTOR)) {
    const tag = el.tagName.toLowerCase();
    const raw = el.getAttribute('href') ?? el.getAttribute('src') ?? el.getAttribute('action') ?? el.getAttribute('data-url') ?? el.getAttribute('data-src') ?? el.getAttribute('data-href');
    if (!raw || raw.startsWith('data:') || raw.startsWith('blob:') || raw.startsWith('#')) continue;
    let source: UrlCatalogEntry['source'] = 'other';
    let snip = `${tag} ${raw.slice(0, 100)}`;
    if (tag === 'a') source = 'link';
    else if (tag === 'form') source = 'form';
    else if (tag === 'script') source = 'script';
    else if (tag === 'iframe' || tag === 'img' || tag === 'video' || tag === 'audio' || tag === 'embed' || tag === 'source') {
      source = 'embed';
    } else if (tag === 'link') {
      const rel = el.getAttribute('rel') ?? '';
      if (rel === 'canonical') snip = `canonical ${raw.slice(0, 100)}`;
      source = 'meta';
    } else if (tag.startsWith('data-')) {
      source = 'other';
    } else if (tag.startsWith('data-') || el.hasAttribute('data-url') || el.hasAttribute('data-src') || el.hasAttribute('data-href')) {
      source = 'other';
    }
    add(raw, source, snip);
  }

  // canonical + meta refresh (explicit evidence)
  for (const m of doc.querySelectorAll('meta[http-equiv="refresh" i]')) {
    const content = m.getAttribute('content') ?? '';
    const urlMatch = content.match(/url=([^;]+)/i);
    const refreshTarget = urlMatch?.[1]?.trim();
    if (refreshTarget) add(refreshTarget, 'meta', `meta refresh ${content.slice(0, 100)}`);
  }

  // JS string literals: absolute URLs + fetch/XHR paths (bounded)
  for (const code of collectInlineScripts(doc)) {
    const bounded = code.length > MAX_INLINE_SCRIPT_CHARS ? code.slice(0, MAX_INLINE_SCRIPT_CHARS) : code;
    for (const u of jsStringUrls(bounded, pageUrl)) add(u, 'inline-js', 'inline script');
  }

  return [...out.values()];
}

/** URL strings inside JS text: absolute + fetch/xhr/axios path patterns. */
export function jsStringUrls(code: string, pageUrl: string): string[] {
  const found = new Set<string>();
  const abs = /["'`](https?:\/\/[^"'`\s]{4,300})["'`]/g;
  for (const m of code.matchAll(abs)) {
    const u0 = m[1] ?? '';
    try {
      const u = new URL(u0, pageUrl);
      if (SCHEME_OK.test(u.href)) found.add(u.href);
    } catch {
      // skip
    }
  }
  // relative fetch/xhr/axios path literals
  const rel = /(?:fetch\s*\(\s*|\.open\s*\(\s*["'`][A-Z]+["'`]\s*,\s*|axios\s*\.\s*\w+\s*\(\s*)(["'`])(\/[A-Za-z0-9_@:%.\-~{}][^"'`\s]{1,280})\1/g;
  for (const m of code.matchAll(rel)) {
    const r1 = m[2] ?? '';
    try {
      const u = new URL(r1, pageUrl);
      found.add(u.href);
    } catch {
      // skip
    }
  }
  return [...found];
}

// ─── Helpers used by the content script ─────────────────────────────────────

/** Inline <script> bodies (no src). */
export function collectInlineScripts(doc: Document): string[] {
  return [...doc.querySelectorAll('script:not([src])')]
    .map((s) => s.textContent ?? '')
    .filter((code) => code.trim().length > 0);
}

/** <script src> URLs, absolute. */
export function collectScriptSrcs(root: Document | Element, pageUrl: string): string[] {
  const srcs: string[] = [];
  const base = pageUrl.startsWith('http') ? pageUrl : (root as Document).baseURI?.startsWith('http') ? (root as Document).baseURI : pageUrl;
  for (const s of root.querySelectorAll('script[src]')) {
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
const MAX_URL_ASSOCIATIONS = 50;
const MAX_EVIDENCE = 10;

const evidenceKey = (e: Evidence): string =>
  `${e.url ?? ''}|${e.line ?? ''}|${e.column ?? ''}|${e.snippet ?? ''}`;

/** Deduped, capped evidence list on a record (Found At data). */
function addEvidence(existing: ParamRecord, o: ParamObservation): void {
  if (!o.evidence) return;
  const list = existing.evidence ?? [];
  const key = evidenceKey(o.evidence);
  if (list.some((e) => evidenceKey(e) === key)) return;
  if (list.length >= MAX_EVIDENCE) return; // keep the first 10 distinct locations
  existing.evidence = [...list, o.evidence];
}

/** pathname helper cached per scan loop — avoid re-parsing the same URL. */
function pathnameOf(pageUrl: string, cache: Map<string, string>): string {
  const cached = cache.get(pageUrl);
  if (cached !== undefined) return cached;
  let path = pageUrl;
  try {
    path = new URL(pageUrl).pathname;
  } catch {
    // non-URL context — fall back to the raw string
  }
  cache.set(pageUrl, path);
  return path;
}

export function dedupeParams(observations: ParamObservation[]): ParamRecord[] {
  const byKey = new Map<string, ParamRecord>();
  const pathCache = new Map<string, string>();
  for (const o of observations) {
    const key = o.name.toLowerCase();
    const path = pathnameOf(o.pageUrl, pathCache);
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
        urls: { [path]: 1 },
        evidence: o.evidence ? [o.evidence] : undefined,
      });
      continue;
    }
    existing.sources[o.source] = (existing.sources[o.source] ?? 0) + 1;
    if (!existing.kinds.includes(o.kind)) existing.kinds.push(o.kind);
    if (o.method && !existing.methods.includes(o.method)) existing.methods.push(o.method);
    if (o.inputType && !existing.inputTypes.includes(o.inputType)) {
      existing.inputTypes.push(o.inputType);
    }
    if (Object.keys(existing.urls ?? {}).length < MAX_URL_ASSOCIATIONS || existing.urls?.[path]) {
      existing.urls = { ...(existing.urls ?? {}), [path]: (existing.urls?.[path] ?? 0) + 1 };
    }
    existing.lastPageUrl = o.pageUrl;
    existing.firstSample ??= o.sample;
    existing.confidence = maxC(existing.confidence, o.confidence);
    existing.occurrences += 1;
    existing.lastSeenAt = o.seenAt;
    addEvidence(existing, o);
  }
  return [...byKey.values()];
}

function maxC(a: ParamConfidence, b: ParamConfidence): ParamConfidence {
  const rank: Record<ParamConfidence, number> = { low: 0, medium: 1, high: 2 };
  return rank[a] >= rank[b] ? a : b;
}
