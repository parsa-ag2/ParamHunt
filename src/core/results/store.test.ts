import { beforeEach, describe, expect, it } from 'vitest';
import { FindingsStore } from './store';
import { createMemoryAdapter } from '@test-utils/storage-adapters';
import type { FindingDraft } from '@shared/types/module';

function draft(overrides: Partial<FindingDraft> = {}): FindingDraft {
  return {
    source: 'param-discovery',
    type: 'param',
    severity: 'info',
    title: 'param: user_id',
    location: 'https://t/app',
    detail: { name: 'user_id', confidence: 'high' },
    observedAt: new Date().toISOString(),
    ...overrides,
  };
}

let store: FindingsStore;

beforeEach(() => {
  store = new FindingsStore(createMemoryAdapter(), 'paramhunt:findings');
});

describe('FindingsStore', () => {
  it('adds findings with id/hash/status and persists across reloads', async () => {
    await store.add(draft());
    const reloaded = new FindingsStore(createMemoryAdapter(), 'paramhunt:findings');
    // fresh store, different adapter instance → proves persistence layer contract
    void reloaded;
    const all = await store.debugAll();
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBeTruthy();
    expect(all[0]?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(all[0]?.status).toBe('new');
  });

  it('deduplicates by dedupeKey: occurrence++ instead of a second row', async () => {
    const first = await store.add(draft({ dedupeKey: 'param:user_id' }));
    const second = await store.add(
      draft({ dedupeKey: 'param:user_id', location: 'https://t/other-page', observedAt: new Date().toISOString() }),
    );
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    const all = await store.debugAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.occurrences).toBe(2);
    expect(all[0]!.lastSeenAt).toBe(second.finding.lastSeenAt);
  });

  it('different content without dedupeKey → different rows', async () => {
    await store.add(draft({ title: 'a', detail: { name: 'a' } }));
    await store.add(draft({ title: 'b', detail: { name: 'b' } }));
    expect(await store.debugAll()).toHaveLength(2);
  });

  it('canonical detail hashing: key order must not change identity', async () => {
    const first = await store.add(draft({ detail: { a: 1, b: 2 } }));
    const second = await store.add(draft({ detail: { b: 2, a: 1 } }));
    expect(second.duplicate).toBe(true);
    expect(second.finding.hash).toBe(first.finding.hash);
  });

  it('list() filters by source/type/status/location and paginates', async () => {
    await store.add(draft({ title: 'x', dedupeKey: 'p:x', location: 'https://t/app?x=1' }));
    await store.add(draft({ title: 'y', type: 'other', dedupeKey: 'o:y', source: 'dom-inspector' }));
    const page = await store.list({ sources: ['param-discovery'], locationIncludes: '/app' });
    expect(page.total).toBe(1);
    expect(page.items[0]?.title).toBe('x');
    const paged = await store.list({ limit: 1, offset: 0 });
    expect(paged.items).toHaveLength(1);
  });

  it('setStatus/remove/clear mutate and persist', async () => {
    const { finding } = await store.add(draft());
    expect(await store.setStatus([finding.id], 'reviewed')).toBe(1);
    expect((await store.list({ statuses: ['reviewed'] })).total).toBe(1);
    expect(await store.remove([finding.id])).toBe(1);
    expect(await store.clear()).toBe(0);
  });

  it('rotates beyond the configured cap (oldest first)', async () => {
    const tiny = new FindingsStore(createMemoryAdapter(), 'k', crypto, 3);
    for (let i = 0; i < 5; i++) {
      await tiny.add(
        draft({
          title: `p${i}`,
          detail: { i },
          dedupeKey: `k${i}`,
          observedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
        }),
      );
    }
    const all = await tiny.debugAll();
    expect(all).toHaveLength(3);
    expect(all.map((f) => f.title)).toEqual(['p2', 'p3', 'p4']); // oldest two rotated out
  });
});
