/**
 * entrypoints/background.ts — the MV3 service worker.
 *
 * Lifecycle contract: the message router is attached inside defineBackground,
 * which WXT executes synchronously at SW evaluation — an SW cold-start never
 * drops the first message. Engine boot is async and must never block the
 * listener registration. State lives in chrome.storage, never in memory
 * alone, so suspension is survivable.
 *
 * BUILD FACT: entrypoint files are executed by WXT's build analysis — zero
 * top-level side effects allowed here; everything runs inside the callback.
 */
import { Engine } from '@core/engine/Engine';
import { createChromeStorageAdapter } from '@core/storage/chromeStorageAdapter';
import { isRequest, type ParamHuntMessage } from '@core/messaging/protocol';
import { createResultsManager } from '@modules/results-manager';
import { createParamDiscovery } from '@modules/param-discovery';

export default defineBackground(() => {
  const logger = console;
  const storage = createChromeStorageAdapter();

  const engine = new Engine({
    storage,
    logger,
    onFinding: async () => {
      /* findings are written directly by the results-manager api; the hook
         stays for future modules that emit without a store handle */
    },
  });

  const results = createResultsManager(storage);
  const discovery = createParamDiscovery(results);

  engine.register(results.module);
  engine.register(discovery.module);

  const handlers = { ...results.handlers, ...discovery.handlers };

  chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
    if (!isRequest(raw)) return; // broadcast events have no receiver here

    const msg = raw as ParamHuntMessage;
    const handler = handlers[msg.type];
    if (!handler) {
      sendResponse({
        ok: false,
        forRequestId: (msg as { requestId: string }).requestId,
        error: { code: 'NO_HANDLER', message: `no handler for ${msg.type}` },
      });
      return;
    }

    handler(msg as never, sender)
      .then((data) => sendResponse({ ok: true, forRequestId: (msg as { requestId: string }).requestId, data }))
      .catch((err: unknown) =>
        sendResponse({
          ok: false,
          forRequestId: (msg as { requestId: string }).requestId,
          error: {
            code: 'HANDLER_ERROR',
            message: err instanceof Error ? err.message : String(err),
          },
        }),
      );
    return true; // keep the channel open for the async reply
  });

  void engine.start().catch((err) => {
    logger.error('[ParamHunt] engine boot failed:', err);
  });

  logger.info('[ParamHunt] background ready');
});
