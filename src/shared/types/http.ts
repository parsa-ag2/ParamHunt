/**
 * shared/types/http.ts — network/URL observation data models.
 *
 * Privacy contract: no request bodies, no cookie values, no authorization
 * headers — metadata only; `initiator` is reduced to an origin.
 */
export interface RequestRecord {
  id: string;
  url: string;
  origin: string;
  path: string;
  method: string;
  /** chrome.webRequest resource type (script, xhr, document, …). */
  resourceType: string;
  /** Initiator origin only — never a full URL with identifiers. */
  initiatorOrigin?: string;
  statusCode?: number;
  /** Query parameter NAMES observed on the request URL. */
  paramNames: string[];
  timestamp: string;
}

export interface UrlRecord {
  /** Normalized absolute URL (dedup key, case-normalized where safe). */
  url: string;
  origin: string;
  path: string;
  method: 'GET' | 'POST' | 'OTHER';
  /** Where the URL was seen: page link/form, or a network request. */
  source: 'page' | 'network';
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
