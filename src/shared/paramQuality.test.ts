import { describe, expect, it } from 'vitest';
import { countConfirmed, isConfirmedParam, isPossibleParam } from './paramQuality';
import type { Finding } from './types/finding';

function finding(overrides: Partial<Finding> & { conf?: string; kinds?: string[] }): Finding {
  const { conf, kinds, ...rest } = overrides;
  return {
    id: 'f',
    hash: 'h',
    source: 'param-discovery',
    type: 'param',
    severity: 'info',
    title: 'param: x',
    location: 'https://t/',
    detail: { name: 'x', confidence: conf ?? 'high', kinds: kinds ?? ['query'] },
    observedAt: new Date().toISOString(),
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    occurrences: 1,
    status: 'new',
    ...rest,
  };
}

describe('parameter quality boundary (confirmed vs possible)', () => {
  it('weak JS-object candidates are POSSIBLE (framework artifacts)', () => {
    for (const name of ['defaultNS', 'constructor', 'current', 'status', 'cancelOrder']) {
      const f = finding({ title: `param: ${name}`, conf: 'low', kinds: ['js-object'] });
      expect(isPossibleParam(f)).toBe(true);
      expect(isConfirmedParam(f)).toBe(false);
    }
  });

  it('strong JS evidence (query strings, URLSearchParams, payload keys) is CONFIRMED', () => {
    for (const conf of ['high', 'medium']) {
      const f = finding({ conf, kinds: ['js-query', 'js-searchparams', 'js-object'] });
      expect(isConfirmedParam(f)).toBe(true);
    }
  });

  it('URL/DOM/FORM/NETWORK/COOKIE/STORAGE sources are always confirmed, even at low confidence', () => {
    for (const source of ['url', 'dom', 'form', 'network', 'cookie', 'storage'] as const) {
        // source here is a detail-level provenance label, not a module id
      for (const conf of ['high', 'medium', 'low']) {
        const f = { ...finding({ conf, kinds: [source === 'network' ? 'query' : 'hidden'] }), source: source as unknown as Finding['source'] };
        expect(isConfirmedParam(f)).toBe(true);
      }
    }
  });

  it('non-parameter findings are never "possible"', () => {
    const f = finding({ source: 'http-analyzer' as never, conf: 'low', kinds: ['js-object'] });
    expect(isPossibleParam(f)).toBe(false);
  });

  it('countConfirmed matches the predicate over a mixed set', () => {
    const mixed = [
      finding({ conf: 'high' }),
      finding({ conf: 'low', kinds: ['js-object'] }),
      finding({ conf: 'medium' }),
    ];
    expect(countConfirmed(mixed)).toBe(2);
  });
});
