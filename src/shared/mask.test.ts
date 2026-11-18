import { describe, expect, it } from 'vitest';
import { isSensitiveKey, maskUrl, urlForCopy } from './mask';

describe('sensitive-value masking', () => {
  it('masks credential-ish parameter values by default', () => {
    const masked = maskUrl('https://t.com/cb?code=abc123&state=xyz');
    expect(masked).toContain('code=***');
    expect(masked).toContain('state=xyz'); // non-sensitive stays readable
  });

  it('catches common secret-ish names', () => {
    for (const key of ['access_token', 'session', 'apiKey', 'password', 'jwt', 'signature']) {
      expect(isSensitiveKey(key)).toBe(true);
    }
    for (const key of ['page', 'q', 'category', 'sort']) {
      expect(isSensitiveKey(key)).toBe(false);
    }
  });

  it('keeps URLs without sensitive params untouched', () => {
    const url = 'https://t.com/list?page=2&q=a+b';
    expect(maskUrl(url)).toBe(url);
  });

  it('urlForCopy masks by default and unhmasks only on explicit action', () => {
    const url = 'https://t.com/cb?code=abc&page=1';
    expect(urlForCopy(url)).toContain('code=***');
    expect(urlForCopy(url, { includeValues: true })).toBe(url);
  });

  it('invalid URLs pass through unchanged (no fabrication)', () => {
    expect(maskUrl('::bad::')).toBe('::bad::');
  });
});
