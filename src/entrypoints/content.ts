/**
 * entrypoints/content.ts — content script (isolated world).
 *
 * Runs the in-page half of parameter discovery: URL, DOM (forms incl.
 * hidden inputs, controls, url-literals) and inline JS extraction. Reports
 * to the background, which re-checks scope and mines external bundles.
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
import { loadSettings } from '@shared/settings';
import { createLogger } from '@shared/logger';
import {
  collectInlineScripts,
  collectScriptSrcs,
  extractDomParams,
  extractJsParams,
  extractUrlParams,
} from '@modules/param-discovery/lib/extract';
import type { ParamObservation } from '@shared/types/param';

const RESCAN_DEBOUNCE_MS = 1500;
const MAX_INLINE_SCRIPT_CHARS = 500_000;

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    const log = createLogger('content');
    let lastScanAt = 0;
    let rescanTimer: ReturnType<typeof setTimeout> | undefined;
    let scanning = false;

    /** Current-origin scope: default + user allowlist from settings. */
    async function scopeAllows(url: string): Promise<boolean> {
      const settings = await loadSettings();
      return isInScope(url, {
        currentOrigin: location.origin,
        allowlist: settings.allowlist,
        exclusions: settings.exclusions,
      }).inScope;
    }

    /** Pure extraction on the live document (read-only). */
    function collectObservations(pageUrl: string): ParamObservation[] {
      const observations: ParamObservation[] = [
        ...extractUrlParams(pageUrl),
        ...extractDomParams(document, pageUrl),
      ];
      for (const code of collectInlineScripts(document)) {
        const bounded = code.length > MAX_INLINE_SCRIPT_CHARS ? code.slice(0, MAX_INLINE_SCRIPT_CHARS) : code;
        observations.push(...extractJsParams(bounded, pageUrl));
      }
      return observations;
    }

    /** Full scan; returns false when the page is out of scope. */
    async function runScan(): Promise<
      { ok: true; observations: ParamObservation[]; scriptSrcs: string[] } | { ok: false }
    > {
      const pageUrl = location.href;
      if (!(await scopeAllows(pageUrl))) {
        log.debug('out of scope — no collection', pageUrl);
        return { ok: false };
      }
      const observations = collectObservations(pageUrl);
      const scriptSrcs = collectScriptSrcs(document, pageUrl);
      log.info(`collected ${observations.length} observations from ${scriptSrcs.length} script refs`);
      return { ok: true, observations, scriptSrcs };
    }

    async function scanAndReport(): Promise<void> {
      if (scanning) return;
      scanning = true;
      try {
        const result = await runScan();
        if (!result.ok || result.observations.length === 0) return;
        const summary = await sendRequest<{ stored: number; duplicates: number }>({
          type: 'params/report',
          observations: result.observations,
          scriptSrcs: result.scriptSrcs,
        });
        log.info(`reported: ${summary.stored} new, ${summary.duplicates} known`);
        lastScanAt = Date.now();
      } catch (err) {
        log.warn('scan/report failed (background may be asleep):', err);
      } finally {
        scanning = false;
      }
    }

    // DOM growth = new forms/fields worth rescanning (debounced)
    const observer = new MutationObserver((mutations) => {
      const relevant = mutations.some((m) =>
        [...m.addedNodes].some((n) => {
          if (n.nodeType !== Node.ELEMENT_NODE) return false;
          const el = n as Element;
          return (
            el.matches('form, input, select, textarea, script') ||
            (el.querySelector?.('form, input, select, textarea, script') != null)
          );
        }),
      );
      if (!relevant) return;
      if (Date.now() - lastScanAt < RESCAN_DEBOUNCE_MS) return;
      if (rescanTimer) clearTimeout(rescanTimer);
      rescanTimer = setTimeout(() => void scanAndReport(), RESCAN_DEBOUNCE_MS);
    });

    function startObservers(): void {
      void scanAndReport();
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    // background-relayed manual rescan (DevTools panel button)
    chrome.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse) => {
      const msg = raw as { type?: string; requestId?: string };
      if (msg?.type !== 'scan/run' || !msg.requestId) return;
      void (async () => {
        try {
          const result = await runScan();
          sendResponse({
            ok: true,
            forRequestId: msg.requestId as string,
            data: {
              observations: result.ok ? result.observations : [],
              scriptSrcs: result.ok ? result.scriptSrcs : [],
              scope: { inScope: result.ok, reason: result.ok ? 'current-origin' : 'out-of-scope' },
            },
          });
          if (result.ok) void scanAndReport(); // persist through the normal path too
        } catch (err) {
          sendResponse({
            ok: false,
            forRequestId: msg.requestId as string,
            error: { code: 'SCAN_ERROR', message: err instanceof Error ? err.message : String(err) },
          });
        }
      })();
      return true; // async reply
    });

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startObservers, { once: true });
    } else {
      startObservers();
    }
  },
});
