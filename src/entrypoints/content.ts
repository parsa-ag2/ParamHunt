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
 * IDEMPOTENCY: this file may be injected twice into a tab (registered
 * content script on load + programmatic injection for tabs opened before
 * install/reload). A window flag prevents duplicate listeners; a scan
 * still runs on every injection so programmatic rescans collect data.
 *
 * BUILD FACT: WXT executes entrypoint files during build analysis — every
 * side effect lives inside main(); the module scope is side-effect-free.
 * `defineContentScript` is a WXT auto-import (no import line).
 */
import { sendRequest } from '@core/messaging/bridge';
import { isInScope } from '@shared/scope';
import { loadSettings } from '@shared/settings';
import { createPipelineLogger, pipelineError, refreshDebugFlag } from '@shared/debug';
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
    // idempotency flag (survives within the isolated world for the tab's life)
    const flag = window as unknown as { __paramhuntContentLoaded?: boolean };
    const alreadyLoaded = flag.__paramhuntContentLoaded === true;
    flag.__paramhuntContentLoaded = true;

    const log = createPipelineLogger('content');
    void refreshDebugFlag();

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
      log('extract', `collected ${observations.length} observations`, { pageUrl });
      return observations;
    }

    /** Full scan; returns false when the page is out of scope. */
    async function runScan(): Promise<
      { ok: true; observations: ParamObservation[]; scriptSrcs: string[] } | { ok: false }
    > {
      const pageUrl = location.href;
      if (!(await scopeAllows(pageUrl))) {
        log('collect', 'out of scope — no collection', { pageUrl });
        return { ok: false };
      }
      const observations = collectObservations(pageUrl);
      const scriptSrcs = collectScriptSrcs(document, pageUrl);
      return { ok: true, observations, scriptSrcs };
    }

    async function scanAndReport(): Promise<void> {
      if (scanning) {
        log('collect', 'scan skipped — one already running');
        return;
      }
      scanning = true;
      try {
        const result = await runScan();
        if (!result.ok || result.observations.length === 0) return;
        const summary = await sendRequest<{ stored: number; duplicates: number }>({
          type: 'params/report',
          observations: result.observations,
          scriptSrcs: result.scriptSrcs,
        });
        log('report', `stored ${summary.stored} new, ${summary.duplicates} known`, { pageUrl: location.href });
      } catch (err) {
        pipelineError('content', 'error', `scan/report failed: ${err instanceof Error ? err.message : String(err)}`);
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
      if (rescanTimer) clearTimeout(rescanTimer);
      rescanTimer = setTimeout(() => void scanAndReport(), RESCAN_DEBOUNCE_MS);
    });

    // background-relayed manual rescan (panel/popup buttons + SPA navigation)
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
          pipelineError('content', 'error', `scan/run failed: ${err instanceof Error ? err.message : String(err)}`);
          sendResponse({
            ok: false,
            forRequestId: msg.requestId as string,
            error: { code: 'SCAN_ERROR', message: err instanceof Error ? err.message : String(err) },
          });
        }
      })();
      return true; // async reply
    });

    function startObservers(): void {
      if (!alreadyLoaded) {
        observer.observe(document.documentElement, { childList: true, subtree: true });
        log('content-init', 'observers registered', { href: location.href });
      }
      // scan runs on EVERY injection (initial load + programmatic rescan)
      void scanAndReport();
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startObservers, { once: true });
    } else {
      startObservers();
    }
  },
});
