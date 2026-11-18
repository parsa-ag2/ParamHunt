import { describe, expect, it } from 'vitest';
import { namesToClipboardText, paramName, uniqueParamNames } from './format';
import type { Finding } from '@shared/types/finding';

function finding(title: string, id = title): Finding {
  return {
    id,
    hash: `h-${id}`,
    source: 'param-discovery',
    type: 'param',
    severity: 'info',
    title,
    location: 'https://t/',
    detail: {},
    observedAt: new Date().toISOString(),
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    occurrences: 1,
    status: 'new',
  };
}

describe('copy formatting', () => {
  it('extracts parameter names from finding titles', () => {
    expect(paramName(finding('param: redirect_uri'))).toBe('redirect_uri');
  });

  it('Copy All yields unique names, one per line, first spelling wins', () => {
    const names = uniqueParamNames([
      finding('param: redirect_uri', '1'),
      finding('param: callback', '2'),
      finding('param: Redirect_Uri', '3'),
      finding('param: returnUrl', '4'),
      finding('param: callback', '5'),
    ]);
    expect(names).toEqual(['redirect_uri', 'callback', 'returnUrl']);
    expect(namesToClipboardText(names)).toBe('redirect_uri\ncallback\nreturnUrl');
  });

  it('empty input → empty clipboard text (never a fake newline)', () => {
    expect(namesToClipboardText(uniqueParamNames([]))).toBe('');
  });
});
