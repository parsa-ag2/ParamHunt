// @vitest-environment happy-dom
/**
 * Fixture-driven extraction tests: real test pages from e2e/fixtures/ are
 * parsed the same way the content script parses live pages.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  collectInlineScripts,
  collectScriptSrcs,
  extractDomParams,
  extractJsParams,
  extractUrlParams,
  dedupeParams,
} from '@modules/param-discovery/lib/extract';

const FIX = (name: string) => readFileSync(join(__dirname, '..', '..', '..', '..', 'e2e', 'fixtures', name), 'utf8');
const PAGE = 'https://target.example.com/app';

let document: Document;
beforeEach(() => {
  document = new DOMParser().parseFromString('<html><head></head><body></body></html>', 'text/html');
});

function load(html: string): void {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.documentElement.innerHTML = parsed.documentElement.innerHTML;
}

describe('fixture: forms.html', () => {
  it('collects hidden inputs, form fields, methods and url-literals', () => {
    load(FIX('forms.html'));
    const rows = dedupeParams([
      ...extractUrlParams('https://target.example.com/checkout?step=1'),
      ...extractDomParams(document, PAGE),
    ]);
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(byName['csrf_token']).toMatchObject({ confidence: 'high', firstSample: 't1', kinds: expect.arrayContaining(['hidden']) });
    expect(byName['returnUrl']).toBeDefined(); // hidden + url-literal merge
    expect(byName['email']).toMatchObject({ kinds: expect.arrayContaining(['form-field']), methods: ['POST'], confidence: 'high' });
    expect(byName['card']?.inputTypes).toContain('password');
    expect(byName['country']).toBeDefined();
    expect(byName['notes']).toBeDefined();
    expect(byName['category_code']?.firstSample).toBe('10');
    expect(byName['vendor_code']?.firstSample).toBe('3');
    expect(byName['step']).toBeDefined();
  });
});

describe('fixture: dynamic.html', () => {
  it('mines inline JS for searchparams vars and fetch URLs', () => {
    load(FIX('dynamic.html'));
    const inline = collectInlineScripts(document);
    const obs = inline.flatMap((code) => extractJsParams(code, PAGE));
    const names = obs.map((o) => o.name);
    expect(names).toContain('user_id');   // short var tracking
    expect(names).toContain('order_id');
    expect(names).toContain('include');
    expect(names).toContain('is_admin');
    expect(obs.find((o) => o.name === 'uid')).toBeUndefined();
  });
});

describe('fixture: js-params.html', () => {
  it('extracts params-object keys', () => {
    load(FIX('js-params.html'));
    const inline = collectInlineScripts(document).join('\n');
    const names = extractJsParams(inline, PAGE).map((o) => o.name);
    expect(names).toContain('is_admin');
    expect(names).toContain('role');
    expect(names).toContain('filter_type');
    expect(names).toContain('spa_param'); // pushState URL literal
  });
});

describe('fixture: empty.html', () => {
  it('collects nothing on an empty page', () => {
    load(FIX('empty.html'));
    expect(extractDomParams(document, PAGE)).toEqual([]);
    expect(collectInlineScripts(document)).toEqual([]);
    expect(collectScriptSrcs(document, PAGE)).toEqual([]);
    expect(extractUrlParams('https://target.example.com/empty.html')).toEqual([]);
  });
});

describe('duplicate-parameter policy', () => {
  it('same name from two sources merges with source counts preserved', () => {
    load(FIX('forms.html'));
    const records = dedupeParams([
      ...extractUrlParams('https://target.example.com/checkout?returnUrl=%2Fhome'),
      ...extractDomParams(document, PAGE),
    ]);
    const ru = records.find((r) => r.name.toLowerCase() === 'returnurl');
    expect(ru?.sources).toMatchObject({ url: 1, dom: 1 });
    expect(ru?.occurrences).toBe(2);
  });
});
