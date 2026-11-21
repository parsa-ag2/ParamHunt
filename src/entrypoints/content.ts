/**
 * entrypoints/content.ts — content script (isolated world).
 *
 * PERFORMANCE ARCHITECTURE (the v0.1 lag fixes):
 *  - The FULL document is scanned exactly ONCE per page load.
 *  - After that, the MutationObserver path processes ONLY newly added
 *    subtrees (bounded per batch) via extractFromNode — never a full rescan.
 *  - Observations are deduped content-side (name|kind|path) so repeat
 *    sightings are never re-serialized or re-sent to the background.
 *  - External script srcs are deduped content-side; the background keeps
 *    its own bundle cache, so each bundle is fetched+mined once.
 *  - Storage-key harvest runs once per page (flag-gated, config-checked).
 *
 * Safety: read-only observation. No form submission, no value changes,
 * no page JS evaluation, and nothing is collected out of scope.
 *
 * BUILD FACT: WXT executes entrypoint files during build analysis — every
 * side effect lives inside main(); the module scope is side-effect-free.
 * `defineContentScript` is a WXT auto-import (no import line).
 */
import { sendRequest } from '@core/messaging/bridge';
import { isInScope } from '@shared/scope';
import { loadSettingsCached, watchSettings, type ScopeSettings } from '@shared/settings';
import { createPipelineLogger, pipelineError, refreshDebugFlag } from '@shared/debug';
import {
  collectCatalogUrls,
  collectInlineScripts,
  collectScriptSrcs,
  extractDomParams,
  extractFromNode,
  extractJsParams,
  extractUrlParams,
} from '@modules/param-discovery/lib/extract';
import { extractEndpoints } from '@modules/param-discovery/lib/endpoints';
import type { EndpointCandidateLike } from '@shared/types/http';
import type { ParamObservation } from '@shared/types/param';

const RESCAN_DEBOUNCE_MS = 1200;
const MAX_INLINE_SCRIPT_CHARS = 500_000;
/** Incremental batch caps — bounded work per mutation burst. */
const MAX_NODES_PER_BATCH = 300;
const MAX_PENDING_NODES = 1_000;
/** Content-side dedup: 'name|kind|path' keys, FIFO-evicted. */
const MAX_SEEN_PARAMS = 5_000;
const MAX_SEEN_SCRIPTS = 300;

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    // idempotency flag (survives within the isolated world for the tab's life)
    const flag = window as unknown as { __paramhuntContentLoaded?: boolean };
    const alreadyLoaded = flag.__paramhuntContentLoaded === true;
    flag.__paramhuntContentLoaded = true;

    const log = createPipelineLogger('content');
    void refreshDebugFlag();
    watchSettings(); // settings cache invalidation without storage reads

    let settings: ScopeSettings | null = null;
    let rescanTimer: ReturnType<typeof setTimeout> | undefined;
    let scanning = false;
    let storageHarvested = false;
    let lastScanAt = 0;

    /** 'name|kind|path' dedup — FIFO-capped to bound memory. */
    const seenParams = new Map<string, true>();
    const seenScripts = new Set<string>();
    const processedElements = new WeakSet<Element>();
    let pendingNodes: Element[] = [];
    let pendingTimer: ReturnType<typeof setTimeout> | undefined;

    function remember(o: ParamObservation): boolean {
      const key = `${o.name.toLowerCase()}|${o.kind}|${new URL(o.pageUrl, location.href).pathname}`;
      if (seenParams.has(key)) return false;
      if (seenParams.size >= MAX_SEEN_PARAMS) {
        const oldest = seenParams.keys().next().value;
        if (oldest) seenParams.delete(oldest);
      }
      seenParams.set(key, true);
      return true;
    }

    async function scopeAllows(url: string): Promise<boolean> {
      if (!settings) settings = await loadSettingsCached();
      return isInScope(url, {
        currentOrigin: location.origin,
        allowlist: settings.allowlist,
        exclusions: settings.exclusions,
      }).inScope;
    }

    function isRelevant(el: Element): boolean {
      return el.matches('a[href], form[action], input, select, textarea, script');
    }

    /** Full-document scan — runs ONCE per page load. */
    async function fullScan(): Promise<{
      ok: boolean;
      observations: ParamObservation[];
      scriptSrcs: string[];
      urls: string[];
      endpoints: EndpointCandidateLike[];
    }> {
      const pageUrl = location.href;
      if (!(await scopeAllows(pageUrl))) {
        log('collect', 'out of scope — no collection', { pageUrl });
        return { ok: false, observations: [], scriptSrcs: [], urls: [], endpoints: [] };
      }
      if (!settings) settings = await loadSettingsCached();

      const observations: ParamObservation[] = [
        ...extractUrlParams(pageUrl),
        ...extractDomParams(document, pageUrl),
      ];
      for (const o of observations) remember(o);

      let inlineEndpoints: EndpointCandidateLike[] = [];
      for (const code of collectInlineScripts(document)) {
        const bounded = code.length > MAX_INLINE_SCRIPT_CHARS ? code.slice(0, MAX_INLINE_SCRIPT_CHARS) : code;
        for (const o of extractJsParams(bounded, pageUrl)) if (remember(o)) observations.push(o);
        // endpoint candidates from inline scripts (same text, same pass)
        inlineEndpoints = inlineEndpoints.concat(
          extractEndpoints(bounded, { pageUrl, source: 'inline-js' }),
        );
      }

      // mark all currently-present elements as processed (incremental baseline)
      for (const el of document.querySelectorAll('a[href], form[action], form, input, select, textarea, script')) {
        processedElements.add(el);
      }

      const scriptSrcs = collectScriptSrcs(document, pageUrl).filter((s) => {
        if (seenScripts.has(s)) return false;
        seenScripts.add(s);
        return true;
      });

      // storage keys: once per page, config-gated, names+sizes only
      if (!storageHarvested && settings.discovery.storage) {
        storageHarvested = true;
        for (const [type, store] of [
          ['local', localStorage],
          ['session', sessionStorage],
        ] as const) {
          for (let i = 0; i < store.length; i++) {
            const key = store.key(i);
            if (!key || key.length > 64) continue;
            const o: ParamObservation = {
              name: key,
              source: 'storage',
              kind: 'storage-key',
              pageUrl,
              inputType: type,
              confidence: 'low',
              seenAt: new Date().toISOString(),
            };
            if (remember(o)) observations.push(o);
          }
        }
      }

      // comprehensive URL catalog: page, links, forms, scripts, embeds,
      // meta/canonical, data-URL attributes, inline-JS literals (same pass,
      // zero extra scans — one bounded query over URL-carrying elements)
      const settingsNow = settings ?? (await loadSettingsCached());
      const catalogUrls = collectCatalogUrls(document, pageUrl, (u) => {
        // same-origin always; allowlisted domains too (eligibility mirror)
        const scope = isInScope(u, {
          currentOrigin: location.origin,
          allowlist: settingsNow.allowlist,
          exclusions: settingsNow.exclusions,
        });
        return scope.inScope;
      });
      log('collect', `full scan: ${observations.length} observations, ${catalogUrls.length} catalog URLs, ${inlineEndpoints.length} endpoint candidates`, { pageUrl, scriptSrcs: scriptSrcs.length });
      return { ok: true, observations, scriptSrcs, urls: catalogUrls.map((c) => c.url), endpoints: inlineEndpoints.slice(0, 50) };
    }

    /** Incremental scan — ONLY the pending added subtrees. */
    async function incrementalScan(): Promise<void> {
      if (scanning || pendingNodes.length === 0) return;
      const pageUrl = location.href;
      if (!(await scopeAllows(pageUrl))) {
        pendingNodes = [];
        return;
      }
      const batch = pendingNodes.slice(0, MAX_NODES_PER_BATCH);
      pendingNodes = pendingNodes.slice(MAX_NODES_PER_BATCH);

      const observations: ParamObservation[] = [];
      const scriptSrcs: string[] = [];
      const started = performance.now();
      for (const node of batch) {
        for (const o of extractFromNode(node, pageUrl, document, processedElements)) {
          if (remember(o)) observations.push(o);
        }
        if (node.tagName === 'SCRIPT' || node.querySelector?.('script[src]')) {
          for (const src of collectScriptSrcs(node as Element, pageUrl)) {
            if (!seenScripts.has(src) && seenScripts.size < MAX_SEEN_SCRIPTS) {
              seenScripts.add(src);
              scriptSrcs.push(src);
            }
          }
        }
      }
      log('extract', `incremental: ${observations.length} new from ${batch.length} nodes in ${(performance.now() - started).toFixed(1)}ms`);
      if (observations.length > 0 || scriptSrcs.length > 0) await report(observations, scriptSrcs, pageUrl);
      if (pendingNodes.length > 0) scheduleIncremental(); // queue continuation
    }

    async function report(
      observations: ParamObservation[],
      scriptSrcs: string[],
      pageUrl: string,
      endpoints: EndpointCandidateLike[] = [],
    ): Promise<void> {
      try {
        const summary = await sendRequest<{ stored: number; duplicates: number }>({
          type: 'params/report',
          observations,
          scriptSrcs,
          urls: pageUrl === location.href ? [location.href] : [],
          endpoints,
        });
        log('report', `stored ${summary.stored} new, ${summary.duplicates} known`, { pageUrl });
      } catch (err) {
        pipelineError('content', 'error', `report failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    async function scanAndReport(): Promise<void> {
      if (scanning) {
        log('collect', 'scan skipped — one already running');
        return;
      }
      scanning = true;
      try {
        const result = await fullScan();
        lastScanAt = Date.now();
        if (!result.ok) return;
        await report(result.observations, result.scriptSrcs, location.href, result.endpoints);
      } catch (err) {
        pipelineError('content', 'error', `scan/report failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        scanning = false;
      }
    }

    function scheduleIncremental(): void {
      if (pendingTimer) return;
      pendingTimer = setTimeout(() => {
        pendingTimer = undefined;
        void incrementalScan();
      }, RESCAN_DEBOUNCE_MS);
    }

    // DOM growth = new subtrees only; full-document rescan never happens again
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const n of m.addedNodes) {
          if (n.nodeType !== Node.ELEMENT_NODE) continue;
          const el = n as Element;
          if (pendingNodes.length < MAX_PENDING_NODES && isRelevantOrContains(el)) {
            pendingNodes.push(el);
          }
        }
      }
      if (pendingNodes.length > 0 && Date.now() - lastScanAt > RESCAN_DEBOUNCE_MS) {
        scheduleIncremental();
      }
    });

    function isRelevantOrContains(el: Element): boolean {
      return (
        el.matches('a[href], form[action], form, input, select, textarea, script') ||
        (el.querySelector?.('a[href], form[action], input, select, textarea, script') != null)
      );
    }

    /** Manual/SPA rescan entry — runs an INCREMENTAL pass over the live DOM
     *  (unprocessed elements only), falling back to nothing heavy. */
    async function rescan(): Promise<{ observations: ParamObservation[]; scriptSrcs: string[] }> {
      // process any not-yet-processed elements in the current document
      const unprocessed: Element[] = [];
      for (const el of document.querySelectorAll('a[href], form[action], form, input, select, textarea, script')) {
        if (!processedElements.has(el) && unprocessed.length < MAX_NODES_PER_BATCH) unprocessed.push(el);
      }
      const observations: ParamObservation[] = [];
      let endpoints: EndpointCandidateLike[] = [];
      for (const node of unprocessed) {
        for (const o of extractFromNode(node, location.href, document, processedElements)) {
          if (remember(o)) observations.push(o);
        }
        if (node.tagName === 'SCRIPT') {
          const code = (node as HTMLScriptElement).textContent ?? '';
          if (code.trim() && code.length <= MAX_INLINE_SCRIPT_CHARS) {
            endpoints = endpoints.concat(extractEndpoints(code, { pageUrl: location.href, source: 'inline-js' }));
          }
        }
      }
      const scriptSrcs = collectScriptSrcs(document, location.href).filter((s) => {
        if (seenScripts.has(s)) return false;
        seenScripts.add(s);
        return true;
      });
      return { observations, scriptSrcs };
    }

    // background-relayed manual rescan (panel button + SPA navigation)
    // + storage-keys inspection (values never collected)
    chrome.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse) => {
      const msg = raw as { type?: string; requestId?: string };
      if (!msg?.type || !msg.requestId) return;

      if (msg.type === 'scan/run') {
        void (async () => {
          try {
            const result = await rescan();
            sendResponse({
              ok: true,
              forRequestId: msg.requestId as string,
              data: {
                observations: result.observations,
                scriptSrcs: result.scriptSrcs,
                urls: [],
                scope: { inScope: await scopeAllows(location.href), reason: 'current-origin' },
              },
            });
            if (result.observations.length > 0 || result.scriptSrcs.length > 0) {
              await report(result.observations, result.scriptSrcs, location.href);
            }
          } catch (err) {
            pipelineError('content', 'error', `scan/run failed: ${err instanceof Error ? err.message : String(err)}`);
            sendResponse({
              ok: false,
              forRequestId: msg.requestId as string,
              error: { code: 'SCAN_ERROR', message: err instanceof Error ? err.message : String(err) },
            });
          }
        })();
        return true; // async reply
      }

      if (msg.type === 'storage/keys') {
        // METADATA ONLY: key names + sizes — values are never collected
        void (async () => {
          try {
            const entries: { key: string; type: 'local' | 'session'; length: number }[] = [];
            for (const [type, store] of [
              ['local', localStorage],
              ['session', sessionStorage],
            ] as const) {
              for (let i = 0; i < store.length; i++) {
                const key = store.key(i);
                if (key == null) continue;
                entries.push({ key, type, length: (store.getItem(key) ?? '').length });
              }
            }
            sendResponse({ ok: true, forRequestId: msg.requestId as string, data: { entries } });
          } catch (err) {
            pipelineError('content', 'error', `storage/keys failed: ${err instanceof Error ? err.message : String(err)}`);
            sendResponse({
              ok: false,
              forRequestId: msg.requestId as string,
              error: { code: 'STORAGE_ERROR', message: err instanceof Error ? err.message : String(err) },
            });
          }
        })();
        return true;
      }
    });

    function startObservers(): void {
      if (!alreadyLoaded) {
        observer.observe(document.documentElement, { childList: true, subtree: true });
        log('content-init', 'incremental observers registered', { href: location.href });
      }
      // scan runs on EVERY injection (initial load + programmatic rescan) —
      // incremental for re-injection, full for first load
      if (alreadyLoaded) {
        void (async () => {
          const r = await rescan();
          if (r.observations.length > 0 || r.scriptSrcs.length > 0) await report(r.observations, r.scriptSrcs, location.href);
        })();
      } else {
        void scanAndReport();
      }
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startObservers, { once: true });
    } else {
      startObservers();
    }
  },
});
