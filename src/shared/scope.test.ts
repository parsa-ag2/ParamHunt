import { describe, expect, it } from 'vitest';
import { isInScope } from './scope';

const origin = 'https://target.example.com';

describe('scope gate', () => {
  it('current origin is in scope by default', () => {
    expect(isInScope(`${origin}/page?x=1`, { currentOrigin: origin }).inScope).toBe(true);
  });

  it('other origins are out of scope by default', () => {
    const d = isInScope('https://evil.com/page', { currentOrigin: origin });
    expect(d.inScope).toBe(false);
    expect(d.reason).toBe('out-of-scope');
  });

  it('allowlist extends scope to permitted origins (bare domain form)', () => {
    const ctx = { currentOrigin: origin, allowlist: ['api.target.example.com'] };
    expect(isInScope('https://api.target.example.com/v1/x', ctx).inScope).toBe(true);
    expect(isInScope('https://api.target.example.com.evil.com/v1', ctx).inScope).toBe(false);
  });

  it('allowlist supports glob patterns', () => {
    const ctx = { currentOrigin: origin, allowlist: ['https://*.target.example.com/*'] };
    expect(isInScope('https://staging.target.example.com/app', ctx).inScope).toBe(true);
    expect(isInScope('https://google.com/', ctx).inScope).toBe(false);
  });

  it('exclusions always win over allowlist and current origin', () => {
    const ctx = {
      currentOrigin: origin,
      allowlist: ['https://*.target.example.com/*'],
      exclusions: ['https://logout.target.example.com/*'],
    };
    expect(isInScope('https://logout.target.example.com/x', ctx)).toEqual({
      inScope: false,
      reason: 'excluded',
    });
    expect(isInScope(`${origin}/logout`, { ...ctx, exclusions: [`${origin}/logout`] }).reason).toBe(
      'excluded',
    );
  });

  it('invalid URLs are out of scope (fail closed)', () => {
    expect(isInScope('not a url', { currentOrigin: origin }).inScope).toBe(false);
  });
});
