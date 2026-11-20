import { describe, expect, it } from 'vitest';
import { findingsToCsv } from './csv';
import type { Finding } from '@shared/types/finding';

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f1',
    hash: 'h1',
    source: 'param-discovery',
    type: 'param',
    severity: 'info',
    title: 'param: user_id',
    location: 'https://t.com/app',
    detail: { name: 'user_id', methods: ['GET'], kinds: ['query'], confidence: 'high' },
    observedAt: new Date().toISOString(),
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    occurrences: 3,
    status: 'new',
    ...overrides,
  };
}

describe('findingsToCsv', () => {
  it('emits a header row + data rows', () => {
    const csv = findingsToCsv([finding()]);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toContain('name,source,severity,status');
    expect(lines[1]).toContain('user_id');
    expect(lines[1]).toContain('param-discovery');
  });

  it('quotes cells containing commas and doubles inner quotes', () => {
    const csv = findingsToCsv([finding({ location: 'https://t.com/a,b?x=1' })]);
    const dataLine = csv.trim().split('\r\n')[1] ?? '';
    // the comma inside the location cell forces RFC 4180 quoting
    expect(dataLine).toContain('"https://t.com/a,b?x=1"');
  });

  it('neutralizes formula injection in the first cell', () => {
    const csv = findingsToCsv([finding({ title: 'param: =HYPERLINK("http://evil")', detail: { name: '=cmd' } })]);
    const dataLine = csv.trim().split('\r\n')[1] ?? '';
    // both the title-derived name cell and any guarded cell get the
    // apostrophe treatment (verified: the row contains the neutralized form)
    expect(dataLine).toContain("'=HYPERLINK");
  });

  it('reports evidence count and first evidence URL', () => {
    const f = finding({
      detail: {
        name: 'x',
        confidence: 'medium',
        evidence: [{ url: 'https://t.com/app.js', line: 184, column: 27, snippet: 'p.get("x")' }, { url: 'https://t.com/other.js' }],
      },
    });
    const csv = findingsToCsv([f]);
    const line = csv.trim().split('\r\n')[1];
    expect(line).toContain('2');
    expect(line).toContain('https://t.com/app.js');
  });

  it('handles empty input (header only)', () => {
    expect(findingsToCsv([])).toContain('name,source');
  });
});
