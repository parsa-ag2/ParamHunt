/**
 * core/messaging/bridge.ts — typed transport over chrome.runtime messaging.
 *
 * Skeleton (architecture phase). Design points that are final:
 *  - request/response with unique requestId + correlation (callback hell safe)
 *  - runtime.lastError always checked (MV3 sends can silently fail on dead SW)
 *  - sendMessage can return undefined -> treat as transport failure, never trust
 *  - JSON-serializable payloads only (structured clone subset)
 * TODO(M0): implement sendRequest/reply over chrome.runtime + chrome.tabs.
 */
import type { ParamHuntMessage, ParamHuntResponse } from './protocol';

export interface SendOptions {
  /** Route to a specific tab's content scripts (chrome.tabs.sendMessage). */
  tabId?: number;
  /** Frame within the tab (top frame = 0). */
  frameId?: number;
  /** ms before the request resolves with a timeout error (default 10s). */
  timeoutMs?: number;
}

export async function sendRequest<T>(
  message: ParamHuntMessage,
  options: SendOptions = {},
): Promise<T> {
  // TODO(M0): chrome.runtime.sendMessage / chrome.tabs.sendMessage +
  // requestId correlation + timeout race + lastError normalization.
  void message;
  void options;
  throw new Error('bridge: not implemented (roadmap M0)');
}

/** Server side helper — wraps a handler to produce ParamHuntResponse envelopes. */
export function reply<T>(
  requestId: string,
  produce: () => Promise<T>,
): Promise<ParamHuntResponse<T>> {
  return produce()
    .then((data) => ({ ok: true as const, forRequestId: requestId, data }))
    .catch((err: unknown) => ({
      ok: false as const,
      forRequestId: requestId,
      error: {
        code: 'HANDLER_ERROR',
        message: err instanceof Error ? err.message : String(err),
      },
    }));
}
