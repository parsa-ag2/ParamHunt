/**
 * entrypoints/background.ts — the MV3 service worker.
 *
 * Lifecycle contract: the message router is attached inside defineBackground,
 * which WXT executes synchronously at SW evaluation — an SW cold-start never
 * drops the first message. Engine boot is async and must never block the
 * listener registration. State lives in chrome.storage, never in memory
 * alone, so suspension is survivable.
 *
 * SPA navigation: chrome.webNavigation.onHistoryStateUpdated re-triggers a
 * scan for in-scope tabs (pushState/replaceState never reloads the document,
 * so the content script alone would miss those URL changes).
 *
 * BUILD FACT: entrypoint files are executed by WXT's build analysis — zero
 * top-level side effects allowed here; everything runs inside the callback.
 */
import { Engine } from '@core/engine/Engine';
import { createChromeStorageAdapter } from '@core/storage/chromeStorageAdapter';
import { isRequest, type ParamHuntMessage } from '@core/messaging/protocol';
import { broadcastEvent } from '@core/messaging/bridge';
import { createResultsManager, type RequestHandlers } from '@modules/results-manager';
import { createParamDiscovery } from '@modules/param-discovery';
import { createHttpAnalyzer, createRequestScopeGate } from '@modules/http-analyzer';
import { UrlsStore } from '@core/results/urls';
import { EndpointsStore } from '@core/results/endpoints';
import { isInScope } from '@shared/scope';
import { loadSettingsCached, watchSettings } from '@shared/settings';
import { createPipelineLogger, pipelineError, refreshDebugFlag } from '@shared/debug';
import { STORAGE_KEYS } from '@shared/constants';

export default defineBackground(() => {
  const storage = createChromeStorageAdapter();
  const log = createPipelineLogger('background');
  void refreshDebugFlag();
  watchSettings(); // settings cache invalidation — no storage reads per event

  const engine = new Engine({
    storage,
    logger: console,
    onFinding: async () => {
      /* findings are written directly by the results-manager api; the hook
         stays for future modules that emit without a store handle */
    },
  });

  const results = createResultsManager(storage);
  const urlsStore = new UrlsStore(storage, STORAGE_KEYS.urls);
  const endpointsStore = new EndpointsStore(storage, STORAGE_KEYS.endpoints);
  /** Coalesced catalog broadcast — bursts of network events → ≤1 event/1.5s */
  let lastCatalogBroadcast = 0;
  let catalogBroadcastTimer: ReturnType<typeof setTimeout> | undefined;
  function broadcastCatalogChanged(): void {
    const now = Date.now();
    if (now - lastCatalogBroadcast >= 1_500) {
      lastCatalogBroadcast = now;
      broadcastEvent({ type: 'catalog/changed' });
      return;
    }
    if (catalogBroadcastTimer) return;
    catalogBroadcastTimer = setTimeout(() => {
      catalogBroadcastTimer = undefined;
      lastCatalogBroadcast = Date.now();
      broadcastEvent({ type: 'catalog/changed' });
    }, 1_500);
  }

  // catalog broadcast: wrap addMany so every write path (discovery, network,
  // scan triggers) publishes ONE coalesced event without per-write overhead
  const notifyCatalog = () => broadcastCatalogChanged();
  const urlsStoreWithBroadcast = {
    ...urlsStore,
    addMany: async (inputs: Parameters<typeof urlsStore.addMany>[0]) => {
      const r = await urlsStore.addMany(inputs);
      if (r.added + r.updated > 0) notifyCatalog();
      return r;
    },
  };
  const endpointsStoreWithBroadcast = {
    ...endpointsStore,
    addMany: async (inputs: Parameters<typeof endpointsStore.addMany>[0]) => {
      const r = await endpointsStore.addMany(inputs);
      if (r.added + r.updated > 0) notifyCatalog();
      return r;
    },
  };
  const gate = createRequestScopeGate();
  const discovery = createParamDiscovery(results, { urlsStore, endpointsStore, noteOrigin: gate.note });
  const http = createHttpAnalyzer(storage, urlsStore, endpointsStore, gate, {
    // NETWORK source: observed request query params flow into the same
    // dedup/store pipeline (batched flush, scope already checked per request)
    onNetworkParams: (observations: import('@shared/types/param').ParamObservation[]) =>
      discovery.ingestObservations(observations, ''),
  });

  engine.register(results.module);
  engine.register(discovery.module);
  engine.register(http.module);

  const handlers: RequestHandlers = {
    ...results.handlers,
    ...discovery.handlers,
    ...http.handlers,
  };

  chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
    if (!isRequest(raw)) return; // broadcast events have no receiver here

    const msg = raw as ParamHuntMessage;
    const handler = handlers[msg.type];
    if (!handler) {
      pipelineError('background', 'message', `NO HANDLER for ${msg.type}`, { sender: sender.tab?.url });
      sendResponse({
        ok: false,
        forRequestId: (msg as { requestId: string }).requestId,
        error: { code: 'NO_HANDLER', message: `no handler for ${msg.type}` },
      });
      return;
    }

    handler(msg as never, sender)
      .then((data) => sendResponse({ ok: true, forRequestId: (msg as { requestId: string }).requestId, data }))
      .catch((err: unknown) => {
        pipelineError('background', 'message', `handler ${msg.type} failed`, err);
        sendResponse({
          ok: false,
          forRequestId: (msg as { requestId: string }).requestId,
          error: {
            code: 'HANDLER_ERROR',
            message: err instanceof Error ? err.message : String(err),
          },
        });
      });
    return true; // keep the channel open for the async reply
  });

  // HTTP observatory: request metadata within the permitted scope
  http.attachWebRequest();

  // SPA navigations (pushState/replaceState) — rescan the tab when in scope
  chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
    void (async () => {
      if (details.frameId !== 0) return; // top frame only
      try {
        const tab = await chrome.tabs.get(details.tabId);
        if (!tab.url) return;
        const settings = await loadSettingsCached();
        const origin = new URL(tab.url).origin;
        const decision = isInScope(tab.url, {
          currentOrigin: origin,
          allowlist: settings.allowlist,
          exclusions: settings.exclusions,
        });
        if (!decision.inScope) return;
        log('collect', 'SPA navigation — rescanning tab', { tabId: details.tabId, url: tab.url });
        const result = await discovery.triggerScan(details.tabId);
        log('collect', 'SPA rescan result', { tabId: details.tabId, status: result.status, stored: result.stored });
      } catch (err) {
        pipelineError('background', 'error', 'SPA rescan failed', err);
      }
    })();
  });

  void engine.start().catch((err) => {
    pipelineError('background', 'error', 'engine boot failed', err);
  });

  log('content-init', 'background ready');
});
