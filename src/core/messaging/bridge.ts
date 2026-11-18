/**
 * core/messaging/bridge.ts — typed transport over chrome messaging APIs.
 *
 * Facts implemented here (they bite if skipped):
 *  - `sendMessage` resolves `undefined` when the receiver never replied —
 *    treated as a transport failure, never as success.
 *  - every request carries a unique requestId and is raced against a timeout;
 *  - payloads are JSON-serializable only.
 */
import type {
  ParamHuntMessage,
  ParamHuntResponse,
} from './protocol';

export interface SendOptions {
  /** Route to a specific tab's content scripts (chrome.tabs.sendMessage). */
  tabId?: number;
  /** ms before the request resolves with a timeout error (default 15s). */
  timeoutMs?: number;
}

/**
 * The request union minus the (auto-filled) requestId — distributed per
 * member so each variant keeps its payload keys for excess-property checks.
 */
type WithoutRequestId<M> = M extends { requestId: string }
  ? Omit<M, 'requestId'> & { requestId?: string }
  : never;
export type ParamHuntRequest = WithoutRequestId<ParamHuntMessage>;

let seq = 0;
function nextRequestId(): string {
  seq += 1;
  return `req-${Date.now().toString(36)}-${seq}`;
}

export class BridgeError extends Error {
  constructor(
    public code: 'TIMEOUT' | 'NO_RECEIVER' | 'HANDLER_ERROR' | 'BAD_ENVELOPE',
    message: string,
  ) {
    super(message);
    this.name = 'BridgeError';
  }
}

/** Send a request and resolve with the handler's payload. */
export async function sendRequest<T>(
  message: ParamHuntRequest,
  options: SendOptions = {},
): Promise<T> {
  const requestId = message.requestId ?? nextRequestId();
  const full = { ...message, requestId } as ParamHuntMessage;

  const raw = options.tabId
    ? await withTimeout(
        chrome.tabs.sendMessage<unknown, ParamHuntResponse<T>>(options.tabId, full),
        options.timeoutMs,
      )
    : await withTimeout(
        chrome.runtime.sendMessage<unknown, ParamHuntResponse<T>>(full),
        options.timeoutMs,
      );

  if (raw === undefined) {
    throw new BridgeError('NO_RECEIVER', 'no handler replied (receiver may be closed or sleeping)');
  }
  if (!raw || typeof raw !== 'object' || !('ok' in raw) || raw.forRequestId !== requestId) {
    throw new BridgeError('BAD_ENVELOPE', `malformed response for ${requestId}`);
  }
  if (raw.ok) return raw.data;
  throw new BridgeError('HANDLER_ERROR', raw.error.message);
}

/** Fire-and-forget broadcast from the background (listener-less sends are fine). */
export function broadcastEvent(event: { type: 'findings/changed' }): void {
  void chrome.runtime.sendMessage(event).catch(() => {
    // no receivers (e.g. all UIs closed) — not an error
  });
}

async function withTimeout<T>(p: Promise<T>, timeoutMs = 15_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new BridgeError('TIMEOUT', `reply not received in ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
