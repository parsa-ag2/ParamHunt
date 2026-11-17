/**
 * core/messaging/protocol.ts — strongly-typed message contracts.
 *
 * THE anti-coupling device of the whole extension: every cross-context
 * message is a member of this discriminated union. Senders/receivers import
 * the union — never string literals — so the compiler enforces the contract.
 * See docs/COMPONENT_COMMUNICATION.md for transport details.
 */
import type { Finding, FindingPage, FindingQuery } from '@shared/types/finding';
import type { ModuleId, ModuleStatus } from '@shared/types/module';

/** Request/response contract between popup, devtools, content and background. */
export type ParamHuntMessage =
  // -- engine control -------------------------------------------------------
  | { type: 'engine/status'; requestId: string }
  | { type: 'engine/module-status'; requestId: string; moduleId: ModuleId }
  // -- findings (popup/devtools -> background/results-manager) --------------
  | { type: 'findings/query'; requestId: string; query: FindingQuery }
  | { type: 'findings/status'; requestId: string; ids: readonly string[]; status: Finding['status'] }
  // -- param discovery (content -> background) ------------------------------
  | {
      type: 'params/report';
      requestId: string;
      tabId: number;
      url: string;
      params: readonly { name: string; kind: 'query' | 'fragment' | 'form' | 'hidden' | 'js' | 'api'; sample?: string }[];
    }
  // -- postMessage tracking (MAIN-world injector -> content -> background) --
  | {
      type: 'postmessage/observed';
      requestId: string;
      tabId: number;
      frame: { url: string; origin: string };
      direction: 'in' | 'out';
      targetOrigin: string;
      originValidated: boolean;
      payloadPreview: string;
    }
  // -- storage inspection (background -> content) ---------------------------
  | { type: 'storage/snapshot'; requestId: string; kinds: readonly ('local' | 'session')[] };

/** Discriminate by `type` — exhaustive handling via `switch` + `never` checks. */
export type ParamHuntMessageType = ParamHuntMessage['type'];

/** Response envelope — every request gets exactly one reply (or an error). */
export type ParamHuntResponse<T = unknown> =
  | { ok: true; forRequestId: string; data: T }
  | { ok: false; forRequestId: string; error: { code: string; message: string } };

/** Per-type response payloads (kept explicit for strong typing at call sites). */
export interface MessagePayloads {
  'engine/status': { running: boolean; modules: readonly { id: ModuleId; status: ModuleStatus }[] };
  'engine/module-status': ModuleStatus;
  'findings/query': FindingPage;
  'findings/status': { updated: number };
  'params/report': { stored: number; duplicates: number };
  'postmessage/observed': { recorded: true };
  'storage/snapshot': { local: Record<string, unknown>; session: Record<string, unknown> };
}

/** Compile-time exhaustiveness helper for message handlers. */
export function assertNever(message: never): never {
  throw new Error(`Unhandled message type: ${JSON.stringify(message)}`);
}
