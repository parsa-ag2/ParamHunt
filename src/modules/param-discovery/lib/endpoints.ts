/**
 * modules/param-discovery/lib/endpoints.ts — endpoint extraction.
 *
 * Pure text analysis of JS source (never executed). Extracts API endpoint
 * candidates from fetch/XHR/axios/config/router patterns with exact
 * evidence (file + line/column + snippet via LineLocator).
 *
 * Shared by the content script (inline scripts) and the background
 * (first-party bundles) — ONE extraction pass per source, no second engine.
 */
import type { EndpointCategory, EndpointMethodConfidence, UrlSource } from '@shared/types/http';
import type { Evidence } from '@shared/types/param';
import { LineLocator } from './extract';

const MAX_EVIDENCE_SNIPPET = 160;

export interface EndpointCandidate {
  /** Resolved URL when resolvable, else empty. */
  url: string;
  /** Path or template (`/api/users/:id`). */
  path: string;
  method: string;
  methodConfidence: EndpointMethodConfidence;
  source: UrlSource;
  category: EndpointCategory;
  evidence: Evidence;
}

export interface EndpointExtractOptions {
  pageUrl: string;
  sourceUrl?: string;
  source: UrlSource;
  /** Same-file baseURL (axios.create({baseURL})) for resolving relative paths. */
  baseURL?: string;
}

interface Locator {
  lineAt(index: number): number;
  columnAt(index: number): number;
  snippetAt(index: number): string;
}

function makeLocator(code: string): Locator {
  return new LineLocator(code);
}

export function categorize(path: string): EndpointCategory {
  const p = path.toLowerCase();
  if (p.includes('graphql')) return 'GRAPHQL';
  if (/(^|\/)(ws|socket|websocket)(\/|\.|$)/i.test(p) || p.startsWith('wss://') || p.startsWith('ws://')) return 'WEBSOCKET';
  if (/:([a-zA-Z_][\w]*)\b/.test(p) || p.includes('/:')) return 'ROUTE';
  if (/auth|login|logout|token|session|oauth|register|signup/.test(p)) return 'AUTH';
  if (/admin|dashboard|panel/.test(p)) return 'ADMIN';
  if (/upload|file|media|attach/.test(p)) return 'UPLOAD';
  if (/download|export|report/.test(p)) return 'DOWNLOAD';
  if (/pay|checkout|billing|invoice|order|cart/.test(p)) return 'PAYMENT';
  if (/user|profile|account|me\b/.test(p)) return 'USER';
  if (/:([a-z_]+)\b/.test(p) || p.includes('/:')) return 'ROUTE';
  if (/\/api(\/|$)|\/v\d+(\/|$)/.test(p)) return 'API';
  return 'OTHER';
}

const STRING_URL = /["'`](https?:\/\/[^"'`\s]{1,300})["'`]/g;
const PATH_STRING = /["'`](\/[A-Za-z0-9_@:%.\-~{}]+(?:\/[A-Za-z0-9_@:%.\-~{}]+)*)(\?[^"'`]{0,200})?["'`]/g;

/** Endpoint candidates from one JS source. Bounded by regex passes — O(n). */
export function extractEndpoints(
  code: string,
  opts: EndpointExtractOptions,
): EndpointCandidate[] {
  const out: EndpointCandidate[] = [];
  if (code.length === 0) return out;
  const locator = makeLocator(code);
  const ev = (index: number): Evidence => {
    return {
      url: opts.sourceUrl ?? opts.pageUrl,
      line: locator.lineAt(index),
      column: locator.columnAt(index),
      snippet: locator.snippetAt(index),
    };
  };

  // same-file baseURL (axios.create({ baseURL: "..." }))
  let baseURL = opts.baseURL ?? '';
  const bm = code.match(/baseURL\s*[:=]\s*["'`]([^"'`]{1,200})["'`]/);
  if (bm) baseURL = bm[1] ?? '';

  const push = (
    rawPath: string,
    method: string,
    methodConfidence: EndpointMethodConfidence,
    source: UrlSource,
    index: number,
    lineText?: string,
  ): void => {
    const clean = rawPath.trim();
    if (!clean || clean.length < 2 || clean.length > 300) return;
    if (/^(data:|blob:|javascript:|#)/i.test(clean)) return;
    let url = '';
    let path = clean;
    try {
      if (/^(https?|wss?):\/\//i.test(clean)) {
        const u = new URL(clean);
        url = u.href;
        path = u.pathname + u.search;
      } else if (baseURL && clean.startsWith('/')) {
        // axios semantics: baseURL (with its path) + path
        const u = new URL(baseURL.replace(/\/$/, '') + clean);
        url = u.href;
        path = u.pathname + u.search;
      }
    } catch {
      // unresolvable — keep the raw path as a candidate, never fabricate
    }
    // path strings must look endpoint-like: start with / and have a letter
    if (!url && !/^\/[A-Za-z]/.test(clean)) return;
    const finalPath = path || clean;
    const e = ev(index);
    out.push({
      url,
      path: finalPath,
      method,
      methodConfidence,
      source: opts.source,
      category: categorize(finalPath),
      evidence: lineText
        ? ({ ...e, snippet: (lineText.length > MAX_EVIDENCE_SNIPPET ? lineText.slice(0, MAX_EVIDENCE_SNIPPET) : lineText) } as Evidence)
        : e,
    });
  };

  // 1) fetch("...") / fetch(`...`)
  for (const m of code.matchAll(/fetch\s*\(\s*(["'`])([^"'`]{2,300})\1/g)) {
    const path = m[2] ?? '';
    if (path) push(path, 'GET', 'inferred', opts.source, m.index ?? 0);
  }
  // 2) axios.get/post/put/patch/delete("...") — method explicit
  for (const m of code.matchAll(/axios\s*\.\s*(get|post|put|patch|delete|head|options|request)?\s*\(\s*(["'`])([^"'`]{2,300})\2/gi)) {
    const method = m[1] ? m[1].toUpperCase() : 'UNKNOWN';
    const mc: EndpointMethodConfidence = m[1] ? 'explicit' : 'unknown';
    const path = m[3] ?? '';
    if (path) push(path, method, mc, 'axios', m.index ?? 0);
  }
  // 3) XMLHttpRequest.open("METHOD", "url")
  for (const m of code.matchAll(/\.open\s*\(\s*["'`](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)["'`]\s*,\s*["'`]([^"'`]{2,300})["'`]/gi)) {
    const path = m[2] ?? '';
    const method = (m[1] ?? 'UNKNOWN').toUpperCase();
    if (path) push(path, method, 'explicit', 'xhr', m.index ?? 0);
  }
  // 4) dynamic import("...") — module endpoints (source: inline/bundle)
  for (const m of code.matchAll(/\bimport\s*\(\s*["'`]([^"'`]{2,200})["'`]\s*\)/g)) {
    const path = m[1] ?? '';
    if (path && /^https?:\/\/|^\/[A-Za-z]/.test(path)) push(path, 'UNKNOWN', 'unknown', opts.source, m.index ?? 0);
  }
  // 5) WebSocket / EventSource endpoints
  for (const m of code.matchAll(/new\s+(?:WebSocket|EventSource)\s*\(\s*(["'`])([^"'`]{2,300})\1/g)) {
    const path = m[2] ?? '';
    if (path) push(path, 'UNKNOWN', 'unknown', opts.source, m.index ?? 0);
  }
  // 6) route templates inside strings: "/users/:id" style
  for (const m of code.matchAll(PATH_STRING)) {
    const candidate = m[1] ?? '';
    if (candidate && /:([a-zA-Z_][\w]*)\b/.test(candidate) && candidate.length > 3) {
      push(candidate, 'UNKNOWN', 'unknown', 'router', m.index ?? 0);
    }
  }
  // 7) axios.create({ baseURL }) — recorded as a config-origin endpoint
  const baseValue = bm?.[1];
  if (baseValue && /^https?:\/\//.test(baseValue)) {
    push(baseValue, 'UNKNOWN', 'unknown', 'config', code.indexOf(baseValue));
  }
  // 8) standalone absolute URLs in strings (bounded — dedup happens upstream)
  for (const m of code.matchAll(STRING_URL)) {
    const path = m[1] ?? '';
    if (path) push(path, 'UNKNOWN', 'unknown', opts.source, m.index ?? 0);
  }

  return out;
}
