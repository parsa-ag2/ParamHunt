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

/**
 * Line/Column locator — ONE pass to collect line offsets, then O(log n)
 * binary search per match. Keeps evidence extraction cheap on 1MB bundles.
 */
export class LineLocator {
  private readonly lineStarts: number[];
  constructor(private readonly code: string) {
    const starts = [0];
    for (let i = 0; i < code.length; i++) {
      if (code.charCodeAt(i) === 10) starts.push(i + 1);
    }
    this.lineStarts = starts;
  }

  lineAt(index: number): number {
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((this.lineStarts[mid] ?? 0) <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1; // 1-based
  }

  columnAt(index: number): number {
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((this.lineStarts[mid] ?? 0) <= index) lo = mid;
      else hi = mid - 1;
    }
    return index - (this.lineStarts[lo] ?? 0) + 1; // 1-based
  }

  /**
   * Context snippet CENTERED on the match — fixes useless `bundle.js:1`
   * evidence where the whole minified bundle is one line. Bounded.
   */
  snippetAt(index: number, before = 70, after = 90): string {
    const start = Math.max(0, index - before);
    const end = Math.min(this.code.length, index + after);
    let s = this.code.slice(start, end).replace(/\s+/g, ' ').trim();
    if (start > 0) s = `…${s}`;
    if (end < this.code.length) s = `${s}…`;
    return s;
  }
}

/**
 * JS parameter extraction — CONTEXT-AWARE (v0.5 rewrite).
 *
 * The old ANCHORED_OBJ window pass caused the false-positive flood: every
 * `query:{`/`params:{`/`body:{` in framework code opened a 400-char window
 * that vacuumed every following object key. Removed entirely.
 *
 * New rules, all evidence-based:
 *  1. Query-string keys must live INSIDE a quoted string literal — a bare
 *     `cond?x=1:y` ternary or a property chain can never match.
 *  2. Object keys are extracted ONLY from arguments of real request calls
 *     (fetch / axios / XMLHttpRequest.open), scoped by balanced-paren walk
 *     with function-value filtering — framework maps never qualify.
 *  3. URLSearchParams var tracking requires the assignment to precede the
 *     use within a bounded distance (minified bundles are one line; this
 *     prevents cross-object contamination).
 * Minified-code guard: 1-char names are artifacts and always dropped.
 */
const MIN_JS_NAME_LEN = 2;
/** Call-argument spans larger than this are skipped (bounded work). */
const MAX_CALL_SPAN = 1_200;
/** URLSearchParams var must be used within this distance of its assignment. */
const USP_PROXIMITY = 2_000;

const STRING_LITERAL = /(['"`])([\s\S]{0,600}?)\1/g;
const QS_IN_STRING = /[?&]([A-Za-z_][\w.\[\]-]{0,32})=([^&"'`\s]{0,48})/g;
const USP_VAR = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+URLSearchParams/g;
const USP_USE = (v: string) =>
  new RegExp(`\\b${v.replace(/\$/g, '\\$')}\\.(?:get|getAll|set|append|has)\\(['"]([^'"]{1,40})['"]`, 'g');
const REQUEST_CALL = /\b(?:fetch\s*\(|axios(?:\s*\.\s*(?:get|post|put|patch|delete|head|options|request))?\s*\(|\.open\s*\(\s*["'`][A-Za-z]+["'`]\s*,)/gi;

/** Skip keys whose values are functions — action maps are not payloads. */
const FUNCTION_VALUE = /^(?:function\b|async\b|=>|\(\s*\))/;

/**
 * Object keys inside a request-call argument span — single-pass, string/
 * escape aware, O(span) once per call site (bounded by MAX_CALL_SPAN).
 * `expectKey` tracking means a key qualifies only at an object-literal
 * position (`{` or `,` before it) — property reads, ternaries and
 * computed access can never qualify.
 */
function objectKeysInSpan(span: string): Array<{ name: string; index: number; colonEnd: number }> {
  const out: Array<{ name: string; index: number; colonEnd: number }> = [];
  let inString: string | null = null;
  let depth = 0;
  let expectKey = false;
  let i = 0;
  while (i < span.length) {
    const ch = span[i] ?? '';
    if (inString) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === inString) inString = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      i += 1;
      continue;
    }
    if (ch === '{') {
      depth += 1;
      expectKey = true;
      i += 1;
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      expectKey = false;
      i += 1;
      continue;
    }
    if (ch === ',') {
      if (depth > 0) expectKey = true;
      i += 1;
      continue;
    }
    if (expectKey && /[A-Za-z_$"']/.test(ch)) {
      const start = i;
      let name = '';
      if (ch === '"' || ch === "'") {
        i += 1;
        while (i < span.length && span[i] !== ch) {
          name += span[i];
          i += 1;
        }
        i += 1; // closing quote
      } else {
        while (i < span.length && /[$\w-]/.test(span[i] ?? '')) {
          name += span[i];
          i += 1;
        }
      }
      // require `:` right after the key (object key, not array item/label)
      let j = i;
      while (j < span.length && /\s/.test(span[j] ?? '')) j += 1;
      if ((span[j] ?? '') === ':') {
        out.push({ name, index: start, colonEnd: j + 1 });
        expectKey = false;
        i = j + 1;
        continue;
      }
      expectKey = false;
      continue;
    }
    i += 1;
  }
  return out;
}

export function extractJsParams(
  code: string,
  pageUrl: string,
  sourceUrl?: string,
): ParamObservation[] {
  const out: ParamObservation[] = [];
  if (code.length === 0) return out;
  const locator = new LineLocator(code);

  const add = (
    name: string,
    kind: ParamKind,
    confidence: ParamConfidence,
    index: number,
    extra: Partial<ParamObservation> = {},
  ): void => {
    if (name.length < MIN_JS_NAME_LEN) return; // minified artifacts stay out
    const o = obs(name, 'js', kind, pageUrl, {
      confidence,
      evidence: {
        url: sourceUrl ?? pageUrl,
        line: locator.lineAt(index),
        column: locator.columnAt(index),
        snippet: locator.snippetAt(index),
      },
      ...extra,
    });
    if (o) out.push(o);
  };

  // ── 1) query-string keys INSIDE string literals ──────────────────────────
  for (const sm of code.matchAll(STRING_LITERAL)) {
    const quote = sm[1];
    const content = sm[2] ?? '';
    const contentStart = (sm.index ?? 0) + 1;
    // template placeholders produce computed names — skip those segments
    if (quote === '`') {
      for (const qm of content.matchAll(QS_IN_STRING)) {
        const name = qm[1] ?? '';
        const localIdx = qm.index ?? 0;
        if (content[localIdx - 1] === '$' || content[localIdx] === '$') continue;
        add(name, 'js-query', 'medium', contentStart + localIdx, { sample: cap(qm[2] ?? '') });
      }
      continue;
    }
    for (const qm of content.matchAll(QS_IN_STRING)) {
      const name = qm[1] ?? '';
      if (!name) continue;
      add(name, 'js-query', 'medium', contentStart + (qm.index ?? 0), { sample: cap(qm[2] ?? '') });
    }
  }

  // ── 2) URLSearchParams var tracking with proximity guard ─────────────────
  const uspAssignments: Array<{ name: string; index: number }> = [];
  for (const m of code.matchAll(USP_VAR)) {
    const varName = m[1];
    if (varName) uspAssignments.push({ name: varName, index: m.index ?? 0 });
  }
  for (const { name: varName, index: assignIdx } of uspAssignments) {
    const use = USP_USE(varName);
    for (const m of code.matchAll(use)) {
      const useIdx = m.index ?? 0;
      if (useIdx < assignIdx || useIdx - assignIdx > USP_PROXIMITY) continue;
      const paramName = m[1] ?? '';
      if (!paramName) continue;
      add(paramName, 'js-searchparams', 'medium', useIdx);
    }
  }

  // ── 3) object keys ONLY from real request-call arguments ─────────────────
  for (const cm of code.matchAll(REQUEST_CALL)) {
    const parenStart = (cm.index ?? 0) + cm[0].lastIndexOf('(');
    if (parenStart < 0) continue;
    // balanced-paren walk, bounded
    let depth = 0;
    let end = -1;
    const limit = Math.min(code.length, parenStart + MAX_CALL_SPAN);
    for (let i = parenStart; i < limit; i++) {
      const ch = code[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) continue;
    const span = code.slice(parenStart + 1, end);
    if (span.includes('${')) continue; // computed template call — skip

    for (const key of objectKeysInSpan(span)) {
      if (key.name.length < MIN_JS_NAME_LEN) continue;
      if (/^(get|set|value|type|name|length|url|href|method)$/.test(key.name)) continue;
      const valueHead = span.slice(key.colonEnd, key.colonEnd + 24).trim();
      if (FUNCTION_VALUE.test(valueHead)) continue; // action map, not payload
      add(key.name, 'js-object', 'high', (cm.index ?? 0) + 1 + key.index);
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
export function collectCatalogUrls(
  doc: Document,
  pageUrl: string,
  isEligibleDomain: (u: string) => boolean,
): UrlCatalogEntry[] {
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
  scanCatalogUrls(doc, base, pageUrl, add);

  // canonical + meta refresh (explicit evidence, document-level only)
  for (const m of doc.querySelectorAll('link[rel="canonical"], meta[http-equiv="refresh" i]')) {
    const rel = m.getAttribute('rel') ?? '';
    const content = m.getAttribute('content') ?? '';
    const raw = rel === 'canonical' ? m.getAttribute('href') : content.match(/url=([^;]+)/i)?.[1]?.trim();
    if (raw) add(raw, 'meta', rel === 'canonical' ? `canonical ${raw.slice(0, 100)}` : `meta refresh ${content.slice(0, 100)}`);
  }

  // JS string literals: absolute URLs + fetch/XHR paths (bounded)
  for (const code of collectInlineScripts(doc)) {
    const bounded = code.length > MAX_INLINE_SCRIPT_CHARS ? code.slice(0, MAX_INLINE_SCRIPT_CHARS) : code;
    for (const u of jsStringUrls(bounded, pageUrl)) add(u, 'inline-js', 'inline script');
  }

  return [...out.values()];
}

/**
 * INCREMENTAL URL collection: catalog URLs from ONE node (or its subtree).
 * Used by the MutationObserver path — never a full-document rescan.
 * Element-level sources only (page/canonical/meta are document-level).
 */
export function catalogUrlsFromRoot(
  root: Element,
  pageUrl: string,
  isEligibleDomain: (u: string) => boolean,
): UrlCatalogEntry[] {
  const out = new Map<string, UrlCatalogEntry>();
  const base = root.ownerDocument?.baseURI?.startsWith('http') ? root.ownerDocument.baseURI : pageUrl;
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
  scanCatalogUrls(root, base, pageUrl, add);
  return [...out.values()];
}

/** Element scan shared by both catalog paths (bounded by the selector). */
function scanCatalogUrls(
  scope: ParentNode,
  base: string,
  pageUrl: string,
  add: (raw: string | null, source: UrlCatalogEntry['source'], evidenceSnippet?: string) => void,
): void {
  for (const el of scope.querySelectorAll(URL_ATTR_SELECTOR)) {
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
    } else if (el.hasAttribute('data-url') || el.hasAttribute('data-src') || el.hasAttribute('data-href')) {
      source = 'other';
    }
    add(raw, source, snip);
  }
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
