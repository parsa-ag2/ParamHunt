/**
 * modules/param-discovery — background side of the discovery pipeline.
 *
 * Content scripts collect scope-filtered observations; THIS side is the
 * authority: it re-checks scope (never trusting the sender), fetches the
 * page's script bundles with extension permissions, mines them as text,
 * deduplicates everything into ParamRecords and stores findings.
 *
 * scan/trigger handles the "already-open tab" problem: if the tab has no
 * content script (opened before install/reload), it injects one
 * programmatically (idempotent on the content side) and reports honestly.
 */
import type { MessagePayloads, ParamHuntMessage, ScopeView } from '@core/messaging/protocol';
import type { FindingDraft, ModuleDefinition } from '@shared/types/module';
import type { ParamObservation, ParamRecord } from '@shared/types/param';
import type { UrlsStore } from '@core/results/urls';
import { isInScope } from '@shared/scope';
import { loadSettingsCached, type DiscoveryConfig } from '@shared/settings';
import { createPipelineLogger, pipelineError } from '@shared/debug';
import {
  dedupeParams,
  extractJsParams,
} from './lib/extract';
import type { RequestHandlers } from '../results-manager';
import type { ResultsManager } from '../results-manager';
import { broadcastEvent } from '@core/messaging/bridge';

type MessageSender = chrome.runtime.MessageSender;

const MAX_BUNDLES = 8;
const MAX_BUNDLE_BYTES = 1_000_000;

const debugLog = createPipelineLogger('discovery-bg');

export function createParamDiscovery(
  results: ResultsManager,
  deps: { urlsStore: UrlsStore; noteOrigin: (origin: string) => void },
): {
  module: ModuleDefinition;
  handlers: RequestHandlers;
  /** Used by the background's webNavigation listener for SPA navigations. */
  triggerScan: (tabId: number) => Promise<MessagePayloads['scan/trigger']>;
} {
  const { api } = results;

  const module: ModuleDefinition = {
    id: 'param-discovery',
    name: 'Parameter Discovery',
    description:
      'Collects parameter names from URLs, DOM forms (incl. hidden inputs), and JS sources of in-scope pages.',
    contexts: ['background', 'content'],
    requiredApis: ['scripting'],
    dependencies: ['results-manager'],
    async start(ctx) {
      ctx.logger.info('discovery engine ready (url | dom | js sources)');
    },
  };

  /** Authority-side scope check: the tab URL decides, not the sender's claim. */
  async function tabInScope(tabId: number | undefined): Promise<{ url?: string; view: ScopeView } | null> {
    if (!tabId) return null;
    try {
      const tab = await chrome.tabs.get(tabId);
      const url = tab.url;
      if (!url) return null;
      const settings = await loadSettingsCached();
      const origin = new URL(url).origin;
      const decision = isInScope(url, {
        currentOrigin: origin,
        allowlist: settings.allowlist,
        exclusions: settings.exclusions,
      });
      return {
        url,
        view: {
          origin,
          inScope: decision.inScope,
          reason: decision.reason,
          allowlist: settings.allowlist,
          exclusions: settings.exclusions,
        },
      };
    } catch (err) {
      pipelineError('discovery-bg', 'message', 'tabInScope failed', err);
      return null;
    }
  }

  /**
   * PERFORMANCE: mined bundles are cached (LRU, 50 entries) — a bundle is
   * downloaded and analyzed exactly once per service-worker lifetime, no
   * matter how many scans report it. Reads config: discovery.jsBundles.
   */
  const bundleCache = new Map<string, ParamObservation[]>();
  const BUNDLE_CACHE_MAX = 50;

  async function mineBundles(
    scriptSrcs: readonly string[],
    pageUrl: string,
    config: DiscoveryConfig,
  ): Promise<ParamObservation[]> {
    if (!config.jsBundles) return []; // user-disabled module
    const observations: ParamObservation[] = [];
    for (const src of scriptSrcs.slice(0, MAX_BUNDLES)) {
      const cached = bundleCache.get(src);
      if (cached) {
        observations.push(...cached);
        continue;
      }
      try {
        const res = await fetch(src);
        if (!res.ok) continue;
        const text = (await res.text()).slice(0, MAX_BUNDLE_BYTES);
        const mined = extractJsParams(text, pageUrl || src);
        observations.push(...mined);
        bundleCache.set(src, mined);
        if (bundleCache.size > BUNDLE_CACHE_MAX) {
          const oldest = bundleCache.keys().next().value;
          if (oldest) bundleCache.delete(oldest); // LRU eviction
        }
      } catch {
        // unreachable bundle (CORS-less, offline) — skip, never fabricate
      }
    }
    return observations;
  }

  /** Turn deduplicated records into findings drafts (param-centric dedup). */
  function recordsToDrafts(records: readonly ParamRecord[], tabId: number | undefined): FindingDraft[] {
    return records.map((r) => ({
      source: 'param-discovery',
      type: 'param',
      severity: 'info',
      title: `param: ${r.name}`,
      location: r.firstPageUrl,
      detail: { ...r },
      observedAt: r.lastSeenAt,
      ...(tabId !== undefined ? { tabId } : {}),
      dedupeKey: `param:${r.name.toLowerCase()}`,
    }));
  }

  /** Cookie NAMES for the scoped origin — value is never read (privacy contract). */
  async function harvestCookieNames(pageUrl: string, config: DiscoveryConfig, seenAt?: string): Promise<ParamObservation[]> {
    if (!config.cookies) return []; // user-disabled module
    try {
      const jar = await chrome.cookies.getAll({ url: pageUrl });
      const ts = seenAt ?? new Date().toISOString();
      return jar.map((c) => ({
        name: c.name,
        source: 'cookie' as const,
        kind: 'cookie-name' as const,
        pageUrl,
        confidence: 'low' as const,
        seenAt: ts,
      }));
    } catch {
      return [];
    }
  }

  /** Shared pipeline for both params/report and scan/trigger paths. */
  async function processObservations(
    observations: readonly ParamObservation[],
    scriptSrcs: readonly string[],
    urls: readonly string[],
    tabId: number | undefined,
    pageUrl: string,
    config: DiscoveryConfig,
  ): Promise<{ stored: number; duplicates: number; records: readonly ParamRecord[] }> {
    debugLog('collect', `processing ${observations.length} observations, ${scriptSrcs.length} script refs`, { tabId, pageUrl });
    const bundleObservations = await mineBundles(scriptSrcs, pageUrl, config);
    if (bundleObservations.length > 0) {
      debugLog('extract', `bundle mining added ${bundleObservations.length} observations`);
    }
    const records = dedupeParams([...observations, ...bundleObservations]);
    debugLog('dedupe', `${records.length} unique params from ${observations.length + bundleObservations.length} observations`);
    // PERFORMANCE: one batched store write + one broadcast per scan batch
    // (the old loop persisted the full findings array once per finding).
    const batch = await api.addMany(recordsToDrafts(records, tabId));
    const stored = batch.stored;
    const duplicates = batch.duplicates;
    // URL catalog (page sources; network sources arrive via http-analyzer)
    if (urls.length > 0) {
      const added = await deps.urlsStore.addMany(urls.map((u) => ({ url: u, source: 'page' as const })));
      debugLog('store', `url catalog: ${added} new URLs`);
    }
    debugLog('store', `stored ${stored} new, ${duplicates} known (occurrences updated)`);
    // ONE broadcast per batch — UIs refresh once, not per finding
    broadcastEvent({ type: 'findings/changed' });
    return { stored, duplicates, records };
  }

  /** Ask a tab's content script to run a scan and hand back raw results. */
  async function collectFromTab(tabId: number, requestId: string): Promise<{
    observations: ParamObservation[];
    scriptSrcs: string[];
    urls: string[];
  } | null> {
    try {
      const reply = await chrome.tabs.sendMessage<
        { type: 'scan/run'; requestId: string },
        { ok: boolean; data?: { observations: ParamObservation[]; scriptSrcs: string[]; urls: string[] } }
      >(tabId, { type: 'scan/run', requestId });
      if (reply?.ok && reply.data) {
        return { observations: reply.data.observations, scriptSrcs: reply.data.scriptSrcs, urls: reply.data.urls ?? [] };
      }
      return null;
    } catch {
      return null; // no content script in that tab (pre-install tab / SPA nav)
    }
  }

  /** scan/trigger implementation, shared by the UI button and SPA navigation. */
  async function triggerScan(tabId: number): Promise<MessagePayloads['scan/trigger']> {
    const tab = await tabInScope(tabId);
    if (!tab?.view.inScope) {
      debugLog('message', 'scan/trigger: out of scope', { tabId, origin: tab?.view.origin });
      return { status: 'out-of-scope', observations: 0, stored: 0, duplicates: 0 };
    }

    // 1) direct collection from an already-injected content script
    const direct = await collectFromTab(tabId, `scan-${Date.now()}`);
    if (direct) {
      if (tab.url) deps.noteOrigin(new URL(tab.url).origin);
      const settings = await loadSettingsCached();
      const result = await processObservations(direct.observations, direct.scriptSrcs, direct.urls ?? [], tabId, tab.url ?? '', settings.discovery);
      return {
        status: 'collected',
        observations: result.records.length,
        stored: result.stored,
        duplicates: result.duplicates,
      };
    }

    // 2) injection fallback: tab opened before install/reload, or SPA page
    //    without a fresh document load. content.ts is idempotent.
    debugLog('message', 'no content script in tab — injecting', { tabId });
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content-scripts/content.js'],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      pipelineError('discovery-bg', 'error', `injection failed: ${message}`);
      return { status: 'failed', observations: 0, stored: 0, duplicates: 0, error: message };
    }

    // the injected script registers its listener synchronously; retry once
    // after a beat, then rely on its own async report (findings/changed)
    await new Promise((r) => setTimeout(r, 300));
    const retry = await collectFromTab(tabId, `scan-retry-${Date.now()}`);
    if (retry) {
      if (tab.url) deps.noteOrigin(new URL(tab.url).origin);
      const settings = await loadSettingsCached();
      const result = await processObservations(retry.observations, retry.scriptSrcs, retry.urls, tabId, tab.url ?? '', settings.discovery);
      return {
        status: 'injected',
        observations: result.records.length,
        stored: result.stored,
        duplicates: result.duplicates,
      };
    }
    // injected and collecting on its own — honest partial status
    return { status: 'injected', observations: 0, stored: 0, duplicates: 0 };
  }

  const handlers: RequestHandlers = {
    'params/report': async (msg, sender) => {
      const tabId = sender.tab?.id;
      const tab = tabId !== undefined ? await tabInScope(tabId) : null;
      const pageUrl = tab?.url ?? '';
      if (!tab?.view.inScope) {
        // defense in depth: content already filtered; drop silently
        debugLog('report', 'params/report dropped — out of scope', { tabId });
        return { stored: 0, duplicates: 0, records: [] };
      }
      deps.noteOrigin(tab.view.origin);
      debugLog('report', `params/report: ${msg.observations.length} observations`, { tabId });
      const settings = await loadSettingsCached();
      // Cookie-name harvesting (metadata only — values are never read)
      const cookieObservations = await harvestCookieNames(pageUrl, settings.discovery, msg.observations[0]?.seenAt);
      return await processObservations(
        [...msg.observations, ...cookieObservations],
        msg.scriptSrcs,
        msg.urls,
        tabId,
        pageUrl,
        settings.discovery,
      );
    },

    'scan/trigger': async (msg) => {
      debugLog('message', 'scan/trigger', { tabId: msg.tabId });
      return await triggerScan(msg.tabId);
    },

    'scope/get': async (msg) => {
      const tab = await tabInScope(msg.tabId);
      if (!tab) {
        const settings = await loadSettingsCached();
        return {
          origin: '',
          inScope: false,
          reason: 'out-of-scope',
          allowlist: settings.allowlist,
          exclusions: settings.exclusions,
        };
      }
      return tab.view;
    },
  };

  return { module, handlers, triggerScan };
}
