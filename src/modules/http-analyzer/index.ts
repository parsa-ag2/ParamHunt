/**
 * modules/http-analyzer — the browser-request observatory (background).
 *
 * Observes webRequest metadata for scoped origins only: URL, method,
 * resource type, initiator origin, status, query parameter NAMES.
 *
 * Privacy contract: no bodies, no headers, no cookie values, initiator
 * reduced to origin. Requests are a ring buffer (default 500).
 *
 * Manual replay: `http/replay` re-fetches an observed GET URL with
 * credentials omitted, after re-checking scope. The message itself is the
 * explicit user action (the UI shows the destination + confirms).
 */
import type { MessagePayloads, ParamHuntMessage } from '@core/messaging/protocol';
import type { RequestRecord } from '@shared/types/http';
import type { ParamObservation } from '@shared/types/param';
import type { ModuleDefinition } from '@shared/types/module';
import type { StorageAdapter } from '@core/storage/StorageAdapter';
import type { UrlsStore } from '@core/results/urls';
import type { RequestHandlers } from '../results-manager';
import { isInScope } from '@shared/scope';
import { loadSettingsCached, watchSettings } from '@shared/settings';
import { pipelineError } from '@shared/debug';

const MAX_REQUESTS = 500;
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
      // requests have no "current origin" — allowlist/exclusions decide,
      // plus origins the user is actively researching this session
      const decision = isInScope(url, {
        currentOrigin: '',
        allowlist: [...settings.allowlist, ...activeOrigins],
        exclusions: settings.exclusions,
      });
      return decision.inScope;
    },
    note: (origin) => {
      activeOrigins.add(origin);
    },
  };
}

/** Pure request-record builder (tested without chrome). */
export function requestRecord(details: WebRequestDetails): RequestRecord | null {
  let parsed: URL;
  try {
    parsed = new URL(details.url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  let initiatorOrigin: string | undefined;
  if (details.initiator && details.initiator !== 'null') {
    try {
      initiatorOrigin = new URL(details.initiator).origin;
    } catch {
      initiatorOrigin = undefined;
    }
  }
  return {
    id: `${Date.now().toString(36)}-${details.requestId ?? Math.random().toString(36).slice(2, 8)}`,
    url: details.url,
    origin: parsed.origin,
    path: parsed.pathname,
    method: details.method.toUpperCase(),
    resourceType: details.resourceType ?? 'other',
    initiatorOrigin,
    statusCode: details.statusCode,
    paramNames: [...parsed.searchParams.keys()],
    timestamp: new Date().toISOString(),
  };
}

export function createHttpAnalyzer(
  storage: StorageAdapter,
  urlsStore: UrlsStore,
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
  let records: RequestRecord[] = [];
  let loaded = false;
  /** Request-URL dedup: identical URLs (xhr polling!) are processed once. */
  const seenUrls = new Set<string>();
  let persistTimer: ReturnType<typeof setTimeout> | undefined;

  async function loadAll(): Promise<RequestRecord[]> {
    if (loaded) return records;
    const bag = await storage.get('paramhunt:requests');
    records = Array.isArray(bag) ? (bag as RequestRecord[]) : [];
    loaded = true;
    return records;
  }

  async function persist(): Promise<void> {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = undefined;
    }
    await storage.set('paramhunt:requests', records);
  }

  /** Batched persistence — request-heavy pages must not write per event. */
  function persistSoon(): void {
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = undefined;
      void persist();
    }, 2_500);
  }

  async function recordRequest(details: WebRequestDetails): Promise<void> {
    const settings = await loadSettingsCached();
    if (!settings.discovery.network) return; // user-disabled module
    const rec = requestRecord(details);
    if (!rec) return;
    if (seenUrls.has(rec.url)) return; // dedup: same URL (polling xhr) once
    if (!(await gate.check(rec.url))) return;
    seenUrls.add(rec.url);
    if (seenUrls.size > 2_000) {
      // FIFO eviction of the dedup set (oldest URL becomes eligible again)
      const first = seenUrls.values().next().value;
      if (first) seenUrls.delete(first);
    }
    const items = await loadAll();
    records = [rec, ...items].slice(0, MAX_REQUESTS); // newest first, ring cap
    persistSoon(); // batched write — never one chrome.storage.set per request
    await urlsStore.addMany([{ url: rec.url, method: normalizeMethod(rec.method), source: 'network' }]);
    // NETWORK source params: query names with request evidence, batched flush
    if (deps.onNetworkParams && rec.paramNames.length > 0) {
      const ts = rec.timestamp;
      for (const name of rec.paramNames) {
        pendingNetworkObs.push({
          name,
          source: 'network',
          kind: 'query',
          pageUrl: rec.url,
          method: rec.method === 'GET' ? 'GET' : rec.method === 'POST' ? 'POST' : undefined,
          confidence: 'high',
          seenAt: ts,
          evidence: { url: rec.url, snippet: `${rec.method} ${rec.resourceType} (query string)` },
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
    'http/query': async (msg) => {
      const items = await loadAll();
      const filtered = msg.origin ? items.filter((r) => r.origin === msg.origin) : items;
      return { requests: filtered, total: filtered.length };
    },
    'http/clear': async () => {
      const n = records.length;
      records = [];
      loaded = true;
      await persist();
      return { cleared: n };
    },
    'http/replay': async (msg) => {
      if (!(await gate.check(msg.url))) {
        return { status: 0, statusText: 'blocked by scope', error: 'URL is outside the permitted scope' };
      }
      try {
        // Credentials deliberately omitted: cookies/auth headers are not replayed.
        const res = await fetch(msg.url, { method: 'GET', credentials: 'omit', redirect: 'manual' });
        const contentType = res.headers.get('content-type') ?? undefined;
        let bodyPreview: string | undefined;
        if (contentType && !contentType.includes('html')) {
          bodyPreview = (await res.text()).slice(0, REPLAY_BODY_PREVIEW);
        }
        return { status: res.status, statusText: res.statusText, contentType, bodyPreview, finalUrl: res.url };
      } catch (err) {
        return {
          status: 0,
          statusText: 'network error',
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    'urls/query': async (msg) => {
      const urls = await urlsStore.list(msg.origin);
      return { urls, total: urls.length };
    },
    'urls/clear': async () => ({ cleared: await urlsStore.clear() }),
    'cookies/query': async (msg) => {
      const tab = await chrome.tabs.get(msg.tabId);
      if (!tab.url) return { cookies: [] };
      const settings = await loadSettingsCached();
      const decision = isInScope(tab.url, {
        currentOrigin: new URL(tab.url).origin,
        allowlist: settings.allowlist,
        exclusions: settings.exclusions,
      });
      if (!decision.inScope) return { cookies: [] };
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


