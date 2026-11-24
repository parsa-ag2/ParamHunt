/**
 * modules/http-analyzer — lightweight network observer (background).
 *
 * Observes webRequest metadata for scoped origins ONLY to feed the URL
 * catalog and the NETWORK parameter source. Nothing else is kept:
 * no request records, no bodies, no headers, no replay.
 *
 * recordRequest emits one EndpointInput per observed URL too — network
 * observed endpoints join the source-code discovered ones in the catalog.
 */
import type { MessagePayloads, ParamHuntMessage } from '@core/messaging/protocol';
import type { EndpointInput } from '@core/results/endpoints';
import type { EndpointsStore } from '@core/results/endpoints';
import { categorize } from '@modules/param-discovery/lib/endpoints';
import type { UrlSource } from '@shared/types/http';
import type { ParamObservation } from '@shared/types/param';
import type { ModuleDefinition } from '@shared/types/module';
import type { StorageAdapter } from '@core/storage/StorageAdapter';
import type { UrlsStore } from '@core/results/urls';
import type { RequestHandlers } from '../results-manager';
import { isRequestInScope } from '@shared/scope';
import { loadSettingsCached, watchSettings } from '@shared/settings';
import { pipelineError } from '@shared/debug';

const REPLAY_BODY_PREVIEW = 2048;

interface WebRequestDetails {
  requestId?: string;
  url: string;
  method: string;
  resourceType?: string;
  initiator?: string;
  statusCode?: number;
}

/** Scope gate for requests: exclusions + allowlist + session-active origins. */
export interface RequestScopeGate {
  check: (url: string) => Promise<boolean>;
  /** Discovery activity marks an origin as actively researched. */
  note: (origin: string) => void;
}

export function createRequestScopeGate(): RequestScopeGate {
  const activeOrigins = new Set<string>();
  return {
    async check(url: string) {
      const settings = await loadSettingsCached(); // cached — no storage read per request
      // ORIGIN-AWARE gate: the parsed request origin is compared against the
      // actively inspected origins (scheme+host+port exact). A bare-origin
      // allowlist pattern matches any URL on that origin. Exclusions win.
      const decision = isRequestInScope(url, {
        activeOrigins: [...activeOrigins],
        allowlist: settings.allowlist,
        exclusions: settings.exclusions,
      });
      return decision.inScope;
    },
    note: (origin) => {
      activeOrigins.add(origin);
    },
  };
}

export function createHttpAnalyzer(
  storage: StorageAdapter,
  urlsStore: UrlsStore,
  endpointsStore: EndpointsStore,
  gate: RequestScopeGate,
  deps: { onNetworkParams?: (observations: ParamObservation[]) => Promise<void> } = {},
): {
  module: ModuleDefinition;
  handlers: RequestHandlers;
  /** Attach the webRequest observers (call once at SW evaluation). */
  attachWebRequest: () => void;
  /** Origins currently permitted for observation (fed by discovery activity). */
  noteOrigin: (origin: string) => void;
} {
  /** Request dedup: METHOD+URL — one method must never suppress another. */
  const seenRequests = new Set<string>();

  async function recordRequest(details: WebRequestDetails): Promise<void> {
    const settings = await loadSettingsCached();
    if (!settings.discovery.network) return; // user-disabled module
    let parsed: URL;
    try {
      parsed = new URL(details.url);
    } catch {
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
    const dedupKey = `${details.method.toUpperCase()}|${details.url}`; // METHOD+URL: one method never suppresses another
    if (seenRequests.has(dedupKey)) return;
    if (!(await gate.check(details.url))) return;
    seenRequests.add(dedupKey);
    if (seenRequests.size > 2_000) {
      // FIFO eviction of the dedup set (oldest becomes eligible again)
      const first = seenRequests.values().next().value;
      if (first) seenRequests.delete(first);
    }
    const method = normalizeMethod(details.method);
    await urlsStore.addMany([{ url: details.url, method, source: 'network' }]);
    // observed URL is also an endpoint candidate (network evidence)
    await endpointsStore.addMany([
      {
        url: details.url,
        path: parsed.pathname,
        method: method === 'OTHER' ? 'UNKNOWN' : method,
        methodConfidence: 'explicit',
        category: categorize(parsed.pathname),
        source: 'network',
        evidence: {
          url: details.url,
          snippet: `${details.method} ${details.resourceType ?? 'request'} (network observed)`,
        },
        paramNames: [...parsed.searchParams.keys()],
      },
    ]);
    // NETWORK source params: query names with request evidence, batched flush
    const paramNames = [...parsed.searchParams.keys()];
    if (deps.onNetworkParams && paramNames.length > 0) {
      const ts = new Date().toISOString();
      for (const name of paramNames) {
        pendingNetworkObs.push({
          name,
          source: 'network',
          kind: 'query',
          pageUrl: details.url,
          method: method === 'OTHER' ? undefined : method,
          confidence: 'high',
          seenAt: ts,
          evidence: { url: details.url, snippet: `${details.method} ${details.resourceType ?? 'request'} (query string)` },
        });
      }
      if (pendingNetworkObs.length >= 40) void flushNetworkParams();
      else scheduleNetworkFlush();
    }
  }

  const pendingNetworkObs: ParamObservation[] = [];
  let networkFlushTimer: ReturnType<typeof setTimeout> | undefined;

  function scheduleNetworkFlush(): void {
    if (networkFlushTimer) return;
    networkFlushTimer = setTimeout(() => {
      networkFlushTimer = undefined;
      void flushNetworkParams();
    }, 2_000);
  }

  async function flushNetworkParams(): Promise<void> {
    if (networkFlushTimer) {
      clearTimeout(networkFlushTimer);
      networkFlushTimer = undefined;
    }
    if (pendingNetworkObs.length === 0 || !deps.onNetworkParams) return;
    const batch = pendingNetworkObs.splice(0, pendingNetworkObs.length);
    try {
      await deps.onNetworkParams(batch);
    } catch (err) {
      pipelineError('http-bg', 'error', 'network params ingest failed', err);
    }
  }

  function normalizeMethod(m: string): 'GET' | 'POST' | 'OTHER' {
    if (m === 'GET') return 'GET';
    if (m === 'POST') return 'POST';
    return 'OTHER';
  }

  const module: ModuleDefinition = {
    id: 'http-analyzer',
    name: 'HTTP Observatory',
    description: 'Observes request metadata (URL, method, type, status) for scoped origins.',
    contexts: ['background'],
    requiredApis: ['webRequest'],
    dependencies: ['results-manager'],
    async start(ctx) {
      ctx.logger.info('http observatory ready (metadata only — no bodies/headers/values)');
    },
  };

  const handlers: RequestHandlers = {
    'endpoints/query': async (msg) => {
      const items = await endpointsStore.list(msg.origin);
      return { endpoints: items, total: items.length };
    },
    'endpoints/clear': async () => {
      const cleared = await endpointsStore.clear();
      return { cleared };
    },
    'urls/query': async (msg) => {
      const urls = await urlsStore.list(msg.origin);
      return { urls, total: urls.length };
    },
    'urls/clear': async () => ({ cleared: await urlsStore.clear() }),
    'cookies/query': async (msg) => {
      const tab = await chrome.tabs.get(msg.tabId);
      if (!tab.url) return { cookies: [] };
      // cookie metadata is origin-scoped: the tab's own origin is implicit
      const jar = await chrome.cookies.getAll({ url: tab.url });
      // Metadata only — the value is deliberately not included.
      return {
        cookies: jar.map((c) => ({
          name: c.name,
          domain: c.domain,
          path: c.path,
          expirationDate: c.expirationDate,
          secure: c.secure,
          httpOnly: c.httpOnly,
          sameSite: c.sameSite ?? 'unspecified',
        })),
      };
    },
    'storage/inspect': async (msg) => {
      try {
        const reply = await chrome.tabs.sendMessage<
          { type: 'storage/keys'; requestId: string },
          { ok: boolean; data?: { entries: MessagePayloads['storage/inspect']['entries'] } }
        >(msg.tabId, { type: 'storage/keys', requestId: msg.requestId });
        return { entries: reply?.ok && reply.data ? reply.data.entries : [] };
      } catch {
        return { entries: [] };
      }
    },
  };

  /** webRequest wiring — attach once at SW evaluation (synchronous rule). */
  function attachWebRequest(): void {
    const onCompleted = (details: unknown) => {
      void recordRequest(details as WebRequestDetails).catch((err) =>
        pipelineError('http-bg', 'error', 'recordRequest failed', err),
      );
    };
    const onError = (details: unknown) => {
      void recordRequest({ ...(details as WebRequestDetails), statusCode: undefined }).catch(() => {});
    };
    chrome.webRequest.onCompleted.addListener(onCompleted, { urls: ['<all_urls>'] });
    chrome.webRequest.onErrorOccurred.addListener(onError, { urls: ['<all_urls>'] });
  }

  return {
    module,
    handlers,
    attachWebRequest,
    noteOrigin: (origin) => {
      // expose gate.note for discovery wiring
      gate.note(origin);
    },
  };
}


