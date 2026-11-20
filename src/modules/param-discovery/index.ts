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
import { firstPartyScripts } from './lib/classify';
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
  /** Network-source entry (wired to http-analyzer's request observations). */
  ingestObservations: (observations: readonly ParamObservation[], pageUrl: string) => Promise<void>;
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
    pageOrigin?: string,
  ): Promise<ParamObservation[]> {
    if (!config.jsBundles) return []; // user-disabled module
    // FIRST-PARTY FILTER: classification happens BEFORE any fetch/parse —
    // vendor + unknown third-party scripts never reach expensive analysis.
    const pageOriginResolved = pageOrigin ?? (pageUrl ? new URL(pageUrl).origin : '');
    const eligible = firstPartyScripts(scriptSrcs.slice(0, MAX_BUNDLES), pageOriginResolved);
    const excluded = scriptSrcs.slice(0, MAX_BUNDLES).length - eligible.length;
    if (excluded > 0) debugLog('extract', `first-party filter: ${excluded} script(s) excluded`);
    const observations: ParamObservation[] = [];
    for (const src of eligible) {
      const cached = bundleCache.get(src);
      if (cached) {
        observations.push(...cached);
        continue;
      }
      try {
        const res = await fetch(src);
        if (!res.ok) continue;
        const text = (await res.text()).slice(0, MAX_BUNDLE_BYTES);
        const mined = extractJsParams(text, pageUrl, src); // evidence.url = the bundle itself
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

  /**
   * Cross-scan merge: PRESERVES every association instead of freezing the
   * first observation — source counts accumulate, kinds/methods/inputTypes
   * union, URL associations (pathname→count) union (capped), confidence
   * never downgrades. This is what keeps "Group by URL" complete over time.
   */
  function mergeParamDetail(
    existing: Record<string, unknown>,
    incoming: Record<string, unknown>,
  ): Record<string, unknown> {
    const mergeCountMap = (a: unknown, b: unknown, cap: number): Record<string, number> => {
      const out: Record<string, number> = { ...((a ?? {}) as Record<string, number>) };
      for (const [k, v] of Object.entries((b ?? {}) as Record<string, number>)) {
        out[k] = (out[k] ?? 0) + (typeof v === 'number' ? v : 1);
      }
      if (Object.keys(out).length <= cap) return out;
      // cap: keep the highest-count associations (never silently drop all)
      return Object.fromEntries(
        Object.entries(out)
          .sort((x, y) => y[1] - x[1])
          .slice(0, cap),
      );
    };
    const unionStrings = (a: unknown, b: unknown): string[] => {
      const set = [...((a ?? []) as string[]), ...((b ?? []) as string[])];
      return [...new Set(set)].slice(0, 20);
    };
    const rank: Record<string, number> = { low: 0, medium: 1, high: 2 };
    const confA = String(existing.confidence ?? 'low');
    const confB = String(incoming.confidence ?? 'low');
    // evidence union: dedup by url|line|col|snippet, cap 10 — the Found At
    // column must keep every distinct discovery location across scans
    const evKey = (e: unknown): string => {
      const o = (e ?? {}) as Record<string, unknown>;
      return `${o.url ?? ''}|${o.line ?? ''}|${o.column ?? ''}|${o.snippet ?? ''}`;
    };
    const mergedEvidence: unknown[] = [
      ...((existing.evidence ?? []) as unknown[]),
      ...((incoming.evidence ?? []) as unknown[]).filter((e) => !((existing.evidence ?? []) as unknown[]).some((x) => evKey(x) === evKey(e))),
    ].slice(0, 10);
    return {
      ...existing,
      sources: mergeCountMap(existing.sources, incoming.sources, 10),
      kinds: unionStrings(existing.kinds, incoming.kinds),
      methods: unionStrings(existing.methods, incoming.methods),
      inputTypes: unionStrings(existing.inputTypes, incoming.inputTypes),
      urls: mergeCountMap(existing.urls, incoming.urls, 50),
      evidence: mergedEvidence,
      lastPageUrl: incoming.lastPageUrl ?? existing.lastPageUrl,
      lastSeenAt: incoming.lastSeenAt ?? existing.lastSeenAt,
      confidence: (rank[confA] ?? 0) >= (rank[confB] ?? 0) ? confA : confB,
    };
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
        evidence: { url: pageUrl, snippet: `domain=${c.domain}; path=${c.path}` },
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
    let bundlePageOrigin: string | undefined;
    try {
      bundlePageOrigin = pageUrl ? new URL(pageUrl).origin : undefined;
    } catch {
      bundlePageOrigin = undefined;
    }
    const bundleObservations = await mineBundles(scriptSrcs, pageUrl, config, bundlePageOrigin);
    if (bundleObservations.length > 0) {
      debugLog('extract', `bundle mining added ${bundleObservations.length} observations`);
    }
    const records = dedupeParams([...observations, ...bundleObservations]);
    debugLog('dedupe', `${records.length} unique params from ${observations.length + bundleObservations.length} observations`);
    // PERFORMANCE: one batched store write + one broadcast per scan batch
    // (the old loop persisted the full findings array once per finding).
    // mergeParamDetail preserves source/URL associations across scans.
    const batch = await api.addMany(recordsToDrafts(records, tabId), {
      mergeDetail: mergeParamDetail,
    });
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

  /** Network-source entry point (wired by the background to http-analyzer). */
  async function ingestObservations(
    observations: readonly ParamObservation[],
    pageUrl: string,
  ): Promise<void> {
    const settings = await loadSettingsCached();
    if (!settings.discovery.network) return;
    await processObservations(observations, [], [], undefined, pageUrl, settings.discovery);
  }

  return { module, handlers, triggerScan, ingestObservations };
}
