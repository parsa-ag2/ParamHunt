import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EndpointsStore } from './endpoints';
import { createMemoryAdapterSpy } from '../storage/spyAdapter';
import type { EndpointInput } from './endpoints';

let spy: ReturnType<typeof createMemoryAdapterSpy>;
let store: EndpointsStore;

const input = (over: Partial<EndpointInput> = {}): EndpointInput => ({
  url: 'https://api.target.com/api/users',
  path: '/api/users',
  method: 'GET',
  methodConfidence: 'inferred',
  category: 'USER',
  source: 'js-bundle',
  evidence: { url: 'https://t.com/app.js', line: 10, column: 3, snippet: 'fetch("/api/users")' },
  ...over,
});

beforeEach(() => {
  spy = createMemoryAdapterSpy();
  store = new EndpointsStore(spy.adapter, 'k');
});

describe('EndpointsStore — identity and merging', () => {
  it('GET and POST of the same path are DISTINCT endpoints', async () => {
    await store.addMany([input(), input({ method: 'POST', category: 'PAYMENT', path: '/api/orders' })]);
    await store.addMany([input({ method: 'POST', path: '/api/users' })]);
    const all = await store.debugAll();
    expect(all).toHaveLength(3); // GET/users, POST/users, POST/orders
  });

  it('same path on different API origins does NOT merge', async () => {
    await store.addMany([input({ url: 'https://api-one.example.com/api/users' })]);
    await store.addMany([input({ url: 'https://api-two.example.com/api/users' })]);
    expect(await store.debugAll()).toHaveLength(2);
  });

  it('repeat observation merges sources+evidence without a new record', async () => {
    await store.addMany([input()]);
    const res = await store.addMany([input({ source: 'network', evidence: { url: 'https://t.com/net', snippet: 'GET xhr' } })]);
    const all = await store.debugAll();
    expect(all).toHaveLength(1);
    expect(all[0]?.occurrences).toBe(2);
    expect(all[0]?.sources).toContain('js-bundle');
    expect(all[0]?.sources).toContain('network');
    expect(all[0]?.evidence).toHaveLength(2); // both locations preserved
    expect(res.added).toBe(0); // merged, not added — persisted via update path
  });

  it('never overwrites a useful absolute URL with an empty one', async () => {
    await store.addMany([input()]);
    await store.addMany([input({ url: '', source: 'inline-js' })]);
    const all = await store.debugAll();
    expect(all[0]?.url).toBe('https://api.target.com/api/users');
  });

  it('update-only observation schedules persistence (spy.setCalls increases)', async () => {
    await store.addMany([input()]);
    const before = spy.setCalls;
    await store.addMany([input({ source: 'network' })]); // update: sources merge
    await store.flush();
    expect(spy.setCalls).toBeGreaterThan(before);
  });
});

describe('UrlsStore — update persistence (regression: v0.5 skipped update writes)', () => {
  it('update-only observations ARE persisted (debounced flush), unlike the v0.5 bug', async () => {
    const { UrlsStore } = await import('./urls');
    const spy2 = createMemoryAdapterSpy();
    const urls = new UrlsStore(spy2.adapter, 'u');
    await urls.addMany([{ url: 'https://t.com/a', source: 'link' }]);
    await urls.flush(); // drain the scheduled write from the first add
    const before = spy2.setCalls;
    const res = await urls.addMany([{ url: 'https://t.com/a', source: 'network' }]);
    expect(res.updated).toBe(1); // source merge = real metadata change
    await urls.flush(); // the update MUST reach storage (v0.5 never wrote it)
    expect(spy2.setCalls).toBeGreaterThan(before);
  });
});
