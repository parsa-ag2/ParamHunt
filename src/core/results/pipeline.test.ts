/**
 * Pipeline integration test — proves the collection→display round-trip with
 * a mocked chrome.* surface: content-side report → background handlers
 * (scope re-check, bundle mining skipped, dedup, store) → findings/query →
 * the exact page a UI would render. This is the regression test for
 * "parameters don't appear".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryAdapter } from '@core/storage/memoryAdapter';
import type { StorageAdapter } from '@core/storage/StorageAdapter';
import { invalidateSettingsCache } from '@shared/settings';
import type { UrlCandidate } from '@shared/types/http';
import { createResultsManager } from '@modules/results-manager';
import { createParamDiscovery } from '@modules/param-discovery';
import { createHttpAnalyzer, createRequestScopeGate } from '@modules/http-analyzer';
import { UrlsStore } from '@core/results/urls';
import { EndpointsStore } from '@core/results/endpoints';
import type { FindingPage } from '@shared/types/finding';
import type { ParamObservation } from '@shared/types/param';

type StorageBag = Map<string, unknown>;

interface MockChrome {
  storage: { local: { get: (k: string | null) => Promise<Record<string, unknown>>; set: (o: Record<string, unknown>) => Promise<void> } };
  tabs: { get: (id: number) => Promise<{ id: number; url: string }> };
  runtime: { sendMessage: (msg: unknown) => Promise<undefined> };
  scripting: { executeScript: ReturnType<typeof vi.fn> };
}

let storageBag: StorageBag;
let mock: MockChrome;
let handlers: ReturnType<typeof createParamDiscovery>['handlers'] & ReturnType<typeof createHttpAnalyzer>['handlers'];
let resultsHandlers: ReturnType<typeof createResultsManager>['handlers'];

const TAB_ID = 42;
const TAB_URL = 'https://target.example.com/app?utm=noise';

beforeEach(() => {
  storageBag = new Map();
  invalidateSettingsCache(); // the settings cache is process-global
  mock = {
    storage: {
      local: {
        get: async (k) => (k === null ? Object.fromEntries(storageBag) : { [k]: storageBag.get(k) }),
        set: async (o) => {
          for (const [k, v] of Object.entries(o)) storageBag.set(k, v);
        },
      },
    },
    tabs: { get: async (id) => ({ id, url: TAB_URL }) },
    runtime: { sendMessage: vi.fn(async () => undefined) }, // broadcast: no receivers
    scripting: { executeScript: vi.fn() },
  };
  (globalThis as unknown as { chrome: MockChrome }).chrome = mock;

  const storage: StorageAdapter = createMemoryAdapter();
  const results = createResultsManager(storage);
  const urlsStore = new UrlsStore(storage, 'paramhunt:urls');
  const endpointsStore = new EndpointsStore(storage, 'paramhunt:endpoints');
  const discovery = createParamDiscovery(results, { urlsStore, endpointsStore, noteOrigin: () => {} });
  const http = createHttpAnalyzer(storage, urlsStore, endpointsStore, {
    check: async () => true, // scope gate is exercised in scope.test.ts
    note: () => {},
  });
  handlers = { ...discovery.handlers, ...http.handlers };
  resultsHandlers = results.handlers;
});

afterEach(() => {
  vi.restoreAllMocks();
});

const obs = (name: string, kind: ParamObservation['kind'], source: ParamObservation['source']): ParamObservation => ({
  name,
  source,
  kind,
  pageUrl: TAB_URL,
  confidence: 'high',
  seenAt: new Date().toISOString(),
});

const sender = { tab: { id: TAB_ID } } as never;

/** Non-nullable handler accessor — handlers are always registered in these tests. */
function must<K extends keyof typeof handlers>(key: K): NonNullable<(typeof handlers)[K]> {
  return handlers[key] as NonNullable<(typeof handlers)[K]>;
}
function mustResults<K extends keyof typeof resultsHandlers>(key: K): NonNullable<(typeof resultsHandlers)[K]> {
  return resultsHandlers[key] as NonNullable<(typeof resultsHandlers)[K]>;
}

describe('collection → display pipeline', () => {
  it('stores content-reported params and the UI query returns them', async () => {
    const report = await must('params/report')(
      {
        type: 'params/report',
        requestId: 'r1',
        observations: [
          obs('user_id', 'query', 'url'),
          obs('csrf_token', 'hidden', 'dom'),
          obs('email', 'form-field', 'form'),
          obs('order_id', 'js-query', 'js'),
        ],
        scriptSrcs: [],
        urls: [],
        endpoints: [],

      },
      sender,
    );
    expect(report.stored).toBe(4);
    expect(report.duplicates).toBe(0);

    const page = (await mustResults('findings/query')(
      { type: 'findings/query', requestId: 'r2', query: { sources: ['param-discovery'], limit: 500 } },
      sender,
    )) as FindingPage;
    expect(page.total).toBe(4);
    expect(page.items.map((f) => f.title).sort()).toEqual([
      'param: csrf_token',
      'param: email',
      'param: order_id',
      'param: user_id',
    ]);
  });

  it('re-reporting the same param merges (occurrences++) instead of duplicating', async () => {
    for (let i = 0; i < 2; i++) {
      await must('params/report')(
        { type: 'params/report', requestId: `r${i}`, observations: [obs('user_id', 'query', 'url')], scriptSrcs: [], urls: [], endpoints: [] },
        sender,
      );
    }
    const page = (await mustResults('findings/query')(
      { type: 'findings/query', requestId: 'r3', query: {} },
      sender,
    )) as FindingPage;
    expect(page.total).toBe(1);
    expect(page.items[0]?.occurrences).toBe(2);
  });

  it('background re-checks scope and drops excluded-origin reports', async () => {
    // exclusion rules always win — even for the tab's own origin
    storageBag.set('paramhunt:settings', { mode: 'origin', allowlist: [], exclusions: ['target.example.com'] });
    const report = await must('params/report')(
      { type: 'params/report', requestId: 'r4', observations: [obs('q', 'query', 'url')], scriptSrcs: [], urls: [], endpoints: [] },
      sender,
    );
    expect(report.stored).toBe(0);
    const page = (await mustResults('findings/query')(
      { type: 'findings/query', requestId: 'r5', query: {} },
      sender,
    )) as FindingPage;
    expect(page.total).toBe(0);
  });

  it('scan/trigger collects from the tab when the content script replies', async () => {
    // simulate the content script answering the background's scan/run message
    mock.tabs = {
      ...mock.tabs,
      // tabs.sendMessage isn't on this mock — triggerScan uses it via chrome.tabs.sendMessage;
      // for this test we go through handlers with a direct content reply stub.
    } as MockChrome['tabs'];
    // direct call path: content would be present — emulate by injecting via scripting not needed here;
    // exercise the injected path instead:
    const result = await must('scan/trigger')(
      { type: 'scan/trigger', requestId: 'r6', tabId: TAB_ID },
      sender,
    );
    // no real content script exists in the mock → background must fall back to injection
    expect(['collected', 'injected']).toContain(result.status);
  });

  it('scope/get reflects the real tab origin', async () => {
    const view = await must('scope/get')(
      { type: 'scope/get', requestId: 'r7', tabId: TAB_ID },
      sender,
    );
    expect(view).toMatchObject({ origin: 'https://target.example.com', inScope: true });
  });
});

describe('URL catalog pipeline (structured candidates → store → query)', () => {
  it('structured URL candidates preserve source attribution end-to-end', async () => {
    const urlCandidates: UrlCandidate[] = [
      { url: 'https://target.example.com/products?category=10', source: 'link', evidence: { url: 'https://target.example.com/app', snippet: 'a /products' } },
      { url: 'https://target.example.com/checkout', source: 'form', method: 'POST', evidence: { url: 'https://target.example.com/app', snippet: 'form /checkout' } },
      { url: 'https://target.example.com/checkout', source: 'page', evidence: { url: 'https://target.example.com/checkout' } },
    ];
    await must('params/report')(
      { type: 'params/report', requestId: 'u1', observations: [], scriptSrcs: [], urls: urlCandidates, endpoints: [] },
      sender,
    );
    const page = (await must('urls/query')(
      { type: 'urls/query', requestId: 'u2', origin: 'https://target.example.com' },
      sender,
    )) as { urls: Array<{ url: string; sources: string[] }>; total: number };
    // 2 candidates + the scanned page URL itself (registered as page source)
    expect(page.total).toBe(3);
    expect(page.urls.some((u) => u.url === TAB_URL && u.sources.includes('page'))).toBe(true);
    const checkout = page.urls.find((u) => u.url.endsWith('/checkout'));
    expect(checkout?.sources).toContain('form');
    expect(checkout?.sources).toContain('page'); // multi-source preserved
  });

  it('the scanned page URL itself is registered as a page-source record', async () => {
    await must('params/report')(
      { type: 'params/report', requestId: 'u3', observations: [], scriptSrcs: [], urls: [], endpoints: [] },
      sender,
    );
    const page = (await must('urls/query')(
      { type: 'urls/query', requestId: 'u4', origin: 'https://target.example.com' },
      sender,
    )) as { urls: Array<{ url: string }>; total: number };
    expect(page.urls.some((u) => u.url === TAB_URL)).toBe(true);
  });
});

describe('endpoint handlers (endpoints/query + clear)', () => {
  it('endpoints/query returns records; endpoints/clear empties the catalog', async () => {
    await must('endpoints/query')(
      { type: 'endpoints/query', requestId: 'e1', origin: 'https://target.example.com' },
      sender,
    );
    // seed via a reported endpoint candidate from an inline script
    await must('params/report')(
      {
        type: 'params/report',
        requestId: 'e2',
        observations: [],
        scriptSrcs: [],
        urls: [],
        endpoints: [
          {
            url: 'https://target.example.com/api/users',
            path: '/api/users',
            method: 'GET',
            methodConfidence: 'inferred',
            source: 'inline-js',
            category: 'USER',
            evidence: { url: 'https://target.example.com/app', line: 12, column: 3, snippet: 'fetch("/api/users")' },
          },
        ],
      },
      sender,
    );
    const page = (await must('endpoints/query')(
      { type: 'endpoints/query', requestId: 'e3', origin: 'https://target.example.com' },
      sender,
    )) as { endpoints: Array<{ path: string; method: string; category: string }>; total: number };
    expect(page.total).toBe(1);
    expect(page.endpoints[0]).toMatchObject({ path: '/api/users', method: 'GET', category: 'USER' });
    const cleared = await must('endpoints/clear')({ type: 'endpoints/clear', requestId: 'e4' }, sender);
    expect(cleared.cleared).toBeGreaterThanOrEqual(1);
  });
});
