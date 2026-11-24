/**
 * core/messaging/protocol.ts — strongly-typed message contracts.
 *
 * THE anti-coupling device of the whole extension: every cross-context
 * message is a member of this discriminated union. Senders/receivers import
 * the union — never string literals — so the compiler enforces the contract.
 * Request/response messages carry `requestId`; `{type:'findings/changed'}`
 * is a broadcast event (no reply). See docs/ARCHITECTURE.md.
 */
import type { Finding, FindingPage, FindingQuery } from '@shared/types/finding';
import type { ParamObservation, ParamRecord } from '@shared/types/param';
import type { CookieMeta, EndpointRecord, StorageKeyMeta, UrlCandidate, UrlRecord } from '@shared/types/http';

/** Scope view sent to UIs. */
export interface ScopeView {
  origin: string;
  inScope: boolean;
  reason: string;
  allowlist: readonly string[];
  exclusions: readonly string[];
}

/** Request/response contract between popup, devtools, content and background. */
export type ParamHuntMessage =
  // -- findings (popup/devtools -> background) ------------------------------
  | { type: 'findings/query'; requestId: string; query: FindingQuery }
  | { type: 'findings/status'; requestId: string; ids: readonly string[]; status: Finding['status'] }
  | { type: 'findings/remove'; requestId: string; ids: readonly string[] }
  | { type: 'findings/clear'; requestId: string }
  | { type: 'findings/note'; requestId: string; id: string; note: string }
  // -- parameter discovery ---------------------------------------------------
  | {
      type: 'params/report';
      requestId: string;
      /** Observations collected in the page (already scope-filtered). */
      observations: readonly ParamObservation[];
      /** <script src> URLs for the background to fetch + mine (host perms). */
      scriptSrcs: readonly string[];
      /** Structured URL candidates seen on the page (URL catalog input). */
      urls: readonly UrlCandidate[];
      /** Endpoint candidates mined from INLINE scripts (content-side pass). */
      endpoints: readonly import('@shared/types/http').EndpointCandidateLike[];
    }
  | {
      type: 'scan/trigger';
      requestId: string;
      tabId: number;
    }
  /** internal: background -> content, triggers a scan in that tab */
  | { type: 'scan/run'; requestId: string }
  // -- scope -----------------------------------------------------------------
  | { type: 'scope/get'; requestId: string; tabId: number }
  // -- URL catalog -------------------------------------------------------------
  | { type: 'urls/query'; requestId: string; origin?: string }
  | { type: 'urls/clear'; requestId: string }
  // -- endpoint catalog --------------------------------------------------------
  | { type: 'endpoints/query'; requestId: string; origin?: string }
  | { type: 'endpoints/clear'; requestId: string }
  // -- cookies (metadata only — values never leave the browser jar) -----------
  | { type: 'cookies/query'; requestId: string; tabId: number }
  // -- browser storage keys (values never collected) --------------------------
  | { type: 'storage/inspect'; requestId: string; tabId: number }
  /** internal: background -> content, collects key metadata only */
  | { type: 'storage/keys'; requestId: string };

/** Broadcast events — coalesced, pushed by the background after writes. */
export type ParamHuntEvent = { type: 'findings/changed' } | { type: 'catalog/changed' };

/** Any message that can arrive on chrome.runtime.onMessage. */
export type AnyParamHuntMessage = ParamHuntMessage | ParamHuntEvent;

export function isRequest(msg: unknown): msg is ParamHuntMessage {
  return typeof msg === 'object' && msg !== null && 'requestId' in msg && 'type' in msg;
}

/** Discriminate by `type` — exhaustive handling via `switch` + `assertNever`. */
export type ParamHuntMessageType = ParamHuntMessage['type'];

/** Response envelope — every request gets exactly one reply (or an error). */
export type ParamHuntResponse<T = unknown> =
  | { ok: true; forRequestId: string; data: T }
  | { ok: false; forRequestId: string; error: { code: string; message: string } };

/** Per-type response payloads (kept explicit for strong typing at call sites). */
export interface MessagePayloads {
  'findings/query': FindingPage;
  'findings/status': { updated: number };
  'findings/remove': { removed: number };
  'findings/clear': { cleared: number };
  'params/report': { stored: number; duplicates: number; records: readonly ParamRecord[] };
  /**
   * scan/trigger result. `injected` means the tab had no content script
   * (opened before install/reload) and one was injected programmatically;
   * collection then reports asynchronously via findings/changed.
   */
  'scan/trigger': {
    status: 'collected' | 'injected' | 'out-of-scope' | 'failed';
    observations: number;
    stored: number;
    duplicates: number;
    error?: string;
  };
  'scan/run': { observations: number; scriptSrcs: number; scope: ScopeDecisionView };
  'scope/get': ScopeView;
  'urls/query': { urls: UrlRecord[]; total: number };
  'endpoints/query': { endpoints: EndpointRecord[]; total: number };
  'endpoints/clear': { cleared: number };
  'urls/clear': { cleared: number };
  'cookies/query': { cookies: CookieMeta[] };
  'storage/inspect': { entries: StorageKeyMeta[] };
  'storage/keys': { entries: StorageKeyMeta[] };
  'findings/note': { updated: number };
}

/** Minimal scope decision mirrored into scan replies (content-side view). */
export interface ScopeDecisionView {
  inScope: boolean;
  reason: string;
}

/** Compile-time exhaustiveness helper for message handlers. */
export function assertNever(message: never): never {
  throw new Error(`Unhandled message type: ${JSON.stringify(message)}`);
}
