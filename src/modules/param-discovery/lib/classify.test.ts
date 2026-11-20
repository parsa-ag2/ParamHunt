import { describe, expect, it } from 'vitest';
import { classifyScript, firstPartyScripts } from './classify';

const PAGE = 'https://market.example.com';

describe('first-party script classification', () => {
  it('same-origin scripts are first-party', () => {
    expect(classifyScript('https://market.example.com/assets/app.js', PAGE)).toBe('first-party');
  });

  it('exact known library filenames are excluded even when self-hosted', () => {
    expect(classifyScript('https://market.example.com/js/jquery.min.js', PAGE)).toBe('vendor');
    expect(classifyScript('https://market.example.com/js/react.production.min.js', PAGE)).toBe('vendor');
  });

  it('shared registrable domain (static-assets CDN) is first-party', () => {
    expect(classifyScript('https://assets.example.com/bundles/app.main.js', PAGE)).toBe('first-party');
    expect(classifyScript('https://cdn.example.com/app.bundle.js', PAGE)).toBe('first-party');
  });

  it('known third-party infrastructure is excluded by default', () => {
    for (const src of [
      'https://code.jquery.com/jquery-3.6.0.min.js',
      'https://cdn.jsdelivr.net/npm/vue@3/dist/vue.global.prod.js',
      'https://unpkg.com/react@18/umd/react.production.min.js',
      'https://www.googletagmanager.com/gtag/js?id=G-1',
    ]) {
      expect(['third-party', 'vendor']).toContain(classifyScript(src, PAGE));
    }
  });

  it('vendor-named chunks on foreign CDNs are excluded', () => {
    expect(['vendor', 'third-party']).toContain(classifyScript('https://somecdn.io/static/chunk-vendors.abc123.js', PAGE));
    expect(['vendor', 'third-party']).toContain(classifyScript('https://somecdn.io/js/vendors~main.js', PAGE));
    expect(['vendor', 'third-party']).toContain(classifyScript('https://somecdn.io/js/node_modules/lib.js', PAGE));
  });

  it('first-party app bundle with vendor-ish name SURVIVES on own origin', () => {
    expect(classifyScript('https://market.example.com/assets/vendor.bundle.js', PAGE)).toBe('first-party');
  });

  it('unknown external origins are excluded by default', () => {
    expect(classifyScript('https://tracker.io/pixel.js', PAGE)).toBe('third-party');
  });

  it('filter: only first-party scripts reach analysis', () => {
    const srcs = [
      'https://market.example.com/assets/app.js',
      'https://market.example.com/js/jquery.min.js',
      'https://assets.example.com/app.main.js',
      'https://cdn.jsdelivr.net/npm/lodash@4/lodash.min.js',
      'https://tracker.io/p.js',
    ];
    expect(firstPartyScripts(srcs, PAGE)).toEqual([
      'https://market.example.com/assets/app.js',
      'https://assets.example.com/app.main.js',
    ]);
  });
});
