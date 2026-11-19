import { describe, expect, it } from 'vitest';
import { groupParams } from './grouping';
import type { Finding } from '@shared/types/finding';

function paramFinding(name: string, urls: Record<string, number>, methods: string[] = ['GET']): Finding {
  const firstPageUrl = `https://t.com${Object.keys(urls)[0] ?? '/'}`;
  const [method] = methods;
  return {
    id: `f-${name}-${Object.keys(urls).join('-')}-${method}`,
    hash: `h-${name}-${Object.keys(urls).join('-')}-${method}`,
    source: 'param-discovery',
    type: 'param',
    severity: 'info',
    title: `param: ${name}`,
    location: firstPageUrl,
    detail: {
      name,
      sources: { url: 1 },
      kinds: ['query'],
      methods,
      confidence: 'high',
      urls,
    },
    observedAt: new Date().toISOString(),
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    occurrences: 1,
    status: 'new',
  };
}

describe('groupParams — URL-based grouping', () => {
  it('multi-URL membership: one parameter appears in EVERY associated group', () => {
    // `page` was seen on /products, /users AND /search
    const groups = groupParams(
      [
        paramFinding('page', { '/products': 3, '/users': 2, '/search': 1 }),
        paramFinding('category', { '/products': 2 }),
        paramFinding('user_id', { '/users': 1 }),
      ],
      { mode: 'path', collapsePatterns: false },
    );
    const byKey = new Map(groups.map((g) => [g.label, g]));
    expect(byKey.get('/products')?.items.map((i) => i.title)).toContain('param: page');
    expect(byKey.get('/users')?.items.map((i) => i.title)).toContain('param: page');
    expect(byKey.get('/search')?.items.map((i) => i.title)).toContain('param: page');
    // association counts preserved
    expect(byKey.get('/products')?.items).toHaveLength(2); // page + category
  });

  it('multiple parameters per group, sorted largest-first', () => {
    const groups = groupParams(
      [
        paramFinding('a', { '/one': 1 }, ['GET']),
        paramFinding('b', { '/one': 1 }, ['GET']),
        paramFinding('c', { '/one': 1 }, ['POST']),
        paramFinding('d', { '/two': 1 }, ['GET']),
        paramFinding('e', { '/two': 1 }, ['GET']),
        paramFinding('f', { '/two': 1 }, ['GET']),
      ],
      { mode: 'path', collapsePatterns: false },
    );
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.items.length)).toEqual([3, 3]); // tie → label order
    expect(groups.map((g) => g.label).sort()).toEqual(['/one', '/two']);
  });

  it('method grouping: same param with GET+POST appears in both groups', () => {
    const groups = groupParams([paramFinding('q', { '/s': 1 }, ['GET', 'POST'])], {
      mode: 'method',
      collapsePatterns: false,
    });
    expect(groups.map((g) => g.label).sort()).toEqual(['GET', 'POST']);
  });

  it('origin grouping uses the associated page origins', () => {
    const f = {
      ...paramFinding('token', { '/cb': 1 }),
      detail: {
        name: 'token',
        sources: { url: 1 },
        kinds: ['query'],
        methods: [],
        confidence: 'high',
        urls: {},
      },
      location: 'https://idp.example.net/cb?token=x',
    } as Finding;
    const groups = groupParams([f], { mode: 'origin', collapsePatterns: false });
    expect(groups.map((g) => g.label)).toEqual(['https://idp.example.net']);
  });

  it('pattern collapse merges numeric-only variants, never unrelated paths', () => {
    const groups = groupParams(
      [
        paramFinding('u1', { '/users/123': 1 }),
        paramFinding('u2', { '/users/456': 1 }),
        paramFinding('s', { '/settings': 1 }),
        paramFinding('x', { '/weird/abc123def': 1 }), // hex-ish segment — must NOT merge
      ],
      { mode: 'path', collapsePatterns: true },
    );
    const labels = groups.map((g) => g.label);
    expect(labels).toContain('/users/{id}');
    expect(labels).toContain('/settings');
    expect(labels).toContain('/weird/abc123def'); // not reliable → never merged
    const users = groups.find((g) => g.label === '/users/{id}');
    expect(users?.items).toHaveLength(2);
  });

  it('group actions data: group items carry copyable names', () => {
    const groups = groupParams(
      [paramFinding('category', { '/api/products': 1 }), paramFinding('product_id', { '/api/products': 1 })],
      { mode: 'path', collapsePatterns: false },
    );
    const g = groups[0]!;
    expect(g.items.map((i) => i.title.replace('param: ', '')).sort()).toEqual(['category', 'product_id']);
  });

  it('performance: 5,000 findings × 500 paths group in bounded time', () => {
    const findings: Finding[] = [];
    for (let i = 0; i < 5_000; i++) {
      const path = `/api/endpoint${i % 500}`;
      findings.push(paramFinding(`p${i}`, { [path]: 1 }));
    }
    const start = performance.now();
    const groups = groupParams(findings, { mode: 'path', collapsePatterns: false });
    const ms = performance.now() - start;
    console.log(`[perf] grouped 5,000 findings → ${groups.length} groups in ${ms.toFixed(1)}ms`);
    expect(groups.length).toBe(500);
    expect(ms).toBeLessThan(500); // generous CI budget; typical <50ms
  });
});
