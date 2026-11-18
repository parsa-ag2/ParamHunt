/**
 * modules/param-discovery — background side of the discovery pipeline.
 *
 * Content scripts collect scope-filtered observations; THIS side is the
 * authority: it re-checks scope (never trusting the sender), fetches the
 * page's script bundles with extension permissions, mines them as text,
 * deduplicates everything into ParamRecords and stores findings.
 */
import type { MessagePayloads, ParamHuntMessage, ScopeView } from '@core/messaging/protocol';
import type { FindingDraft, ModuleDefinition } from '@shared/types/module';
import type { ParamObservation, ParamRecord } from '@shared/types/param';
import { isInScope } from '@shared/scope';
import { loadSettings } from '@shared/settings';
import {
  collectInlineScripts,
  collectScriptSrcs,
  dedupeParams,
  extractDomParams,
  extractJsParams,
  extractUrlParams,
} from './lib/extract';
import type { RequestHandlers } from '../results-manager';
import type { ResultsManager } from '../results-manager';

type MessageSender = chrome.runtime.MessageSender;

const MAX_BUNDLES = 8;
const MAX_BUNDLE_BYTES = 1_000_000;

export function createParamDiscovery(results: ResultsManager): {
  module: ModuleDefinition;
  handlers: RequestHandlers;
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
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url;
    if (!url) return null;
    const settings = await loadSettings();
    const origin = new URL(url).origin;
    const decision = isInScope(url, { currentOrigin: origin, allowlist: settings.allowlist, exclusions: settings.exclusions });
    return {
      url,
      view: {
        origin,
        inScope: decision.inScope,
        reason: decision.reason,
        allowlist: settings.allowlist,
        exclusions: settings.exclusions,
      },
    } satisfies { url?: string; view: ScopeView };
  }

  /** Fetch + mine external bundles (extension context, host permissions). */
  async function mineBundles(scriptSrcs: readonly string[], pageUrl: string): Promise<ParamObservation[]> {
    const observations: ParamObservation[] = [];
    for (const src of scriptSrcs.slice(0, MAX_BUNDLES)) {
      try {
        const res = await fetch(src);
        if (!res.ok) continue;
        const text = (await res.text()).slice(0, MAX_BUNDLE_BYTES);
        observations.push(...extractJsParams(text, pageUrl || src));
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

  /** Shared pipeline for both params/report and scan/trigger paths. */
  async function processObservations(
    observations: readonly ParamObservation[],
    scriptSrcs: readonly string[],
    tabId: number | undefined,
    pageUrl: string,
  ): Promise<{ stored: number; duplicates: number; records: readonly ParamRecord[] }> {
    const bundleObservations = await mineBundles(scriptSrcs, pageUrl);
    const records = dedupeParams([...observations, ...bundleObservations]);
    let stored = 0;
    let duplicates = 0;
    for (const draft of recordsToDrafts(records, tabId)) {
      const { duplicate } = await api.add(draft);
      duplicate ? duplicates += 1 : stored += 1;
    }
    return { stored, duplicates, records };
  }

  const handlers: RequestHandlers = {
    'params/report': async (msg, sender) => {
      const tabId = sender.tab?.id;
      const tab = tabId !== undefined ? await tabInScope(tabId) : null;
      const pageUrl = tab?.url ?? '';
      if (!tab?.view.inScope) {
        // defense in depth: content already filtered; drop silently
        return { stored: 0, duplicates: 0, records: [] };
      }
      const result = await processObservations(
        msg.observations,
        msg.scriptSrcs,
        tabId,
        pageUrl,
      );
      return result satisfies MessagePayloads['params/report'];
    },

    'scan/trigger': async (msg) => {
      const tab = await tabInScope(msg.tabId);
      if (!tab?.view.inScope) {
        return { observations: 0, stored: 0, duplicates: 0 };
      }
      const reply = await chrome.tabs.sendMessage<
        { type: 'scan/run'; requestId: string },
        { ok: boolean; data?: { observations: ParamObservation[]; scriptSrcs: string[] } }
      >(msg.tabId, { type: 'scan/run', requestId: msg.requestId });
      if (!reply?.ok || !reply.data) {
        return { observations: 0, stored: 0, duplicates: 0 };
      }
      const result = await processObservations(
        reply.data.observations,
        reply.data.scriptSrcs,
        msg.tabId,
        tab.url ?? '',
      );
      return {
        observations: result.records.length,
        stored: result.stored,
        duplicates: result.duplicates,
      };
    },

    'scope/get': async (msg) => {
      const tab = await tabInScope(msg.tabId);
      if (!tab) {
        const settings = await loadSettings();
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

  return { module, handlers };
}
