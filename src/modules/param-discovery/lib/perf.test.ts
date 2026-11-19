// @vitest-environment happy-dom
/**
 * Performance tests — MEASURED budgets, not vibes.
 *
 * Asserts the actual algorithmic costs that caused the v0.1 lag:
 *  - full-page DOM extraction on a 5,000-node page
 *  - incremental extraction of a 60-node mutation batch (+ dedup of repeats)
 *  - storage-write amplification (batched vs per-finding persist)
 *  - bundle-mine cache (same URL never fetched twice)
 *
 * Budgets are generous (CI machines are slow); actual numbers print to the log.
 */
import { describe, expect, it, vi } from 'vitest';
import { extractDomParams, extractFromNode, extractJsParams } from './extract';
import { FindingsStore } from '@core/results/store';
import { createMemoryAdapterSpy } from '@core/storage/spyAdapter';
import { createMemoryAdapter } from '@core/storage/memoryAdapter';
import { BundleMineCache } from './mine-cache';
import type { FindingDraft } from '@shared/types/module';

function buildBigDom(nodeCount: number): HTMLElement {
  const root = document.createElement('div');
  for (let i = 0; i < nodeCount; i++) {
    const wrapper = document.createElement('div');
    if (i % 5 === 0) {
      const form = document.createElement('form');
      form.setAttribute('action', `/submit?batch=${i % 20}`);
      const input = document.createElement('input');
      input.name = `field_${i}`;
      input.type = i % 10 === 0 ? 'hidden' : 'text';
      form.appendChild(input);
      wrapper.appendChild(form);
    } else if (i % 7 === 0) {
      const a = document.createElement('a');
      a.href = `/page/${i}?p=${i}&q=x`;
      wrapper.appendChild(a);
    } else {
      wrapper.appendChild(document.createElement('span'));
    }
    root.appendChild(wrapper);
  }
  document.body.appendChild(root);
  return root;
}

function draft(i: number): FindingDraft {
  return {
    source: 'param-discovery',
    type: 'param',
    severity: 'info',
    title: `param: p${i}`,
    location: 'https://t/',
    detail: { name: `p${i}` },
    observedAt: new Date().toISOString(),
    dedupeKey: `param:p${i}`,
  };
}

describe('DOM extraction performance', () => {
  it('full-page extraction of 5,000 nodes stays within budget', () => {
    const root = buildBigDom(5_000);
    const start = performance.now();
    const rows = extractDomParams(document, 'https://t.com/big');
    const ms = performance.now() - start;
    console.log(`[perf] full 5,000-node extraction: ${ms.toFixed(1)}ms, ${rows.length} params`);
    expect(ms).toBeLessThan(400); // generous CI budget; typical <150ms
    expect(rows.length).toBeGreaterThan(0);
    root.remove();
  });

  it('incremental batch (60 new nodes) is fast + repeats are free', () => {
    const processed = new WeakSet<Element>();
    const root = buildBigDom(2_000);
    extractDomParams(document, 'https://t.com/big'); // baseline full scan

    const batch: Element[] = [];
    for (let i = 0; i < 60; i++) {
      const form = document.createElement('form');
      form.setAttribute('action', `/new?step=${i}`);
      const input = document.createElement('input');
      input.name = `new_field_${i}`;
      input.type = 'hidden';
      form.appendChild(input);
      root.appendChild(form);
      batch.push(form);
    }
    const start = performance.now();
    let obs = 0;
    for (const node of batch) obs += extractFromNode(node, 'https://t.com/big', document, processed).length;
    const ms = performance.now() - start;
    console.log(`[perf] incremental 60-node batch: ${ms.toFixed(1)}ms, ${obs} observations`);
    expect(ms).toBeLessThan(60); // generous; typical <10ms
    expect(obs).toBeGreaterThanOrEqual(60);

    // the same batch again must cost (almost) nothing — processed tracking
    const start2 = performance.now();
    let again = 0;
    for (const node of batch) again += extractFromNode(node, 'https://t.com/big', document, processed).length;
    const ms2 = performance.now() - start2;
    console.log(`[perf] repeat batch: ${ms2.toFixed(1)}ms, ${again} observations`);
    expect(ms2).toBeLessThan(10);
    expect(again).toBe(0); // WeakSet prevents re-processing entirely
    root.remove();
  });
});

describe('storage-write amplification fix (measured)', () => {
  it('addMany: batch of 50 → ≤2 writes (old add() loop → 51 writes)', async () => {
    const spy = createMemoryAdapterSpy();
    const store = new FindingsStore(spy.adapter, 'k');
    const drafts = Array.from({ length: 50 }, (_, i) => draft(i));
    const res = await store.addMany(drafts);
    expect(res.stored).toBe(50);
    console.log(`[perf] batched 50 findings → ${spy.setCalls} storage write(s)`);
    expect(spy.setCalls).toBeLessThanOrEqual(2);

    // baseline measurement: the OLD per-finding loop on an identical store
    const oldSpy = createMemoryAdapterSpy();
    const oldStore = new FindingsStore(oldSpy.adapter, 'k2');
    for (const d of drafts) await oldStore.add(d);
    console.log(`[perf] per-finding loop → ${oldSpy.setCalls} storage write(s)`);
    expect(oldSpy.setCalls).toBeGreaterThan(10); // the amplification we removed
  });

  it('all-duplicate batch → zero writes (in-memory counter update only)', async () => {
    const spy = createMemoryAdapterSpy();
    const store = new FindingsStore(spy.adapter, 'k');
    const drafts = Array.from({ length: 20 }, (_, i) => draft(i));
    await store.addMany(drafts);
    const afterFirst = spy.setCalls;
    const second = await store.addMany(drafts);
    expect(second.duplicates).toBe(20);
    expect(spy.setCalls).toBe(afterFirst); // no persist when nothing new landed
  });
});

describe('bundle-mine cache (measured)', () => {
  it('same bundle URL is fetched exactly once', async () => {
    const fetchSpy = vi.fn(async () => 'const p = new URLSearchParams(location.search); const x = p.get("k");');
    const cache = new BundleMineCache();
    const first = await cache.mine(['https://t.com/app.js'], 'https://t.com/', extractJsParams, fetchSpy as never);
    const second = await cache.mine(['https://t.com/app.js'], 'https://t.com/', extractJsParams, fetchSpy as never);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(second.length).toBe(first.length);
    expect(first.some((o) => o.name === 'k')).toBe(true);
    expect(cache.size).toBe(1);
  });

  it('LRU cap evicts the oldest entry', async () => {
    const fetchSpy = vi.fn(async (u: string) => `const p = new URLSearchParams(u); p.get("${u}");`);
    const cache = new BundleMineCache(2);
    for (const u of ['a', 'b', 'c']) {
      await cache.mine([`https://t/${u}.js`], 'https://t/', extractJsParams, fetchSpy as never);
    }
    expect(cache.size).toBe(2); // 'a' evicted
  });

});
