/**
 * shared/types/http.ts — URL / endpoint observation data models.
 *
 * Privacy contract: no request bodies, no cookie values, no authorization
 * headers. Evidence is compact (snippets ≤160 chars), never whole files.
 */

export interface UrlCandidate {
  /** Absolute URL (resolved against the page when the base is known). */
  url: string;
  source: UrlSource;
  /** Where on the page it was found (content location evidence). */
  evidence?: { url?: string; snippet?: string };
  /** Only when the discovery context pins it (form method). */
  method?: 'GET' | 'POST';
}

export type UrlSource =
  | 'page' // the page's own URL
  | 'link' // <a href>
  | 'form' // <form action>
  | 'script' // <script src>
  | 'inline-js' // inline <script> string literals
  | 'js-bundle' // external first-party bundle string literals
  | 'fetch' // fetch() call
  | 'xhr' // XMLHttpRequest.open
  | 'axios' // axios.get/post/create
  | 'router' // route definitions (/:id templates)
  | 'network' // observed webRequest
  | 'config' // API config objects (baseURL etc.)
  | 'meta' // canonical / meta refresh / preload / resource hints
  | 'embed' // iframe / media / data-URL attributes
  | 'other';

export interface UrlRecord {
  /** Normalized absolute URL (dedup key). */
  url: string;
  origin: string;
  path: string;
  method: 'GET' | 'POST' | 'OTHER';
  /** ALL discovery sources — merged during dedup, never discarded. */
  sources: UrlSource[];
  paramNames: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  occurrences: number;
}

export type EndpointCategory =
  | 'API'
  | 'AUTH'
  | 'USER'
  | 'ADMIN'
  | 'UPLOAD'
  | 'DOWNLOAD'
  | 'PAYMENT'
  | 'GRAPHQL'
  | 'WEBSOCKET'
  | 'ROUTE'
  | 'OTHER';

export type EndpointMethodConfidence = 'explicit' | 'inferred' | 'unknown';

/** Wire-format for content-reported endpoint candidates (evidence embedded). */
export interface EndpointCandidateLike {
  url: string;
  path: string;
  method: string;
  methodConfidence: EndpointMethodConfidence;
  source: UrlSource;
  category: EndpointCategory;
  evidence: { url?: string; line?: number; column?: number; snippet?: string };
}

export interface EndpointRecord {
  /** Dedup key: `METHOD|path-or-url`. Unknown methods show as UNKNOWN. */
  key: string;
  /** Resolved full URL when possible, else empty. */
  url: string;
  origin?: string;
  /** Endpoint path or template (`/api/users/:id`). */
  path: string;
  method: string; // 'UNKNOWN' when not identifiable
  methodConfidence: EndpointMethodConfidence;
  category: EndpointCategory;
  /** ALL discovery sources — merged during dedup. */
  sources: UrlSource[];
  /** Source files/pages where it was found (evidence URL list). */
  sourceFiles: string[];
  /** Distinct evidence records (file + line/col + snippet), capped 10. */
  evidence: Array<{ url?: string; line?: number; column?: number; snippet?: string }>;
  paramNames: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  occurrences: number;
}

/** Cookie metadata — the VALUE is deliberately absent (privacy contract). */
export interface CookieMeta {
  name: string;
  domain: string;
  path: string;
  expirationDate?: number;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string;
}

/** Browser storage key metadata — values are never collected. */
export interface StorageKeyMeta {
  key: string;
  type: 'local' | 'session';
  /** Approximate serialized size in characters. */
  length: number;
}
