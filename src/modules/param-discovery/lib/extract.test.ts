// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  collectInlineScripts,
  collectScriptSrcs,
  dedupeParams,
  extractDomParams,
  extractJsParams,
  extractUrlParams,
} from './extract';

const PAGE = 'https://target.example.com/app?page=1';

function doc(html: string): Document {
  document.body.innerHTML = html;
  return document;
}

describe('extractUrlParams', () => {
  it('extracts query params with samples at high confidence', () => {
    const rows = extractUrlParams('https://t.com/search?q=abc&filter[type]=x');
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(byName['q']).toMatchObject({ kind: 'query', sample: 'abc', confidence: 'high' });
    expect(byName['filter[type]']).toBeDefined();
  });

  it('extracts fragment-embedded params (#access_token=…)', () => {
    const rows = extractUrlParams('https://t.com/cb#access_token=xyz&state=1');
    expect(rows.map((r) => r.name)).toContain('access_token');
    expect(rows.map((r) => r.name)).toContain('state');
    expect(rows.find((r) => r.name === 'access_token')?.kind).toBe('fragment');
  });

  it('returns [] for invalid URLs', () => {
    expect(extractUrlParams('::bad::')).toEqual([]);
  });
});

describe('extractDomParams', () => {
  it('collects form fields with method context', () => {
    const rows = extractDomParams(
      doc(`<form action="/login?a=b" method="POST">
             <input name="email"><input name="pass" type="password">
           </form>`),
      PAGE,
    );
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(byName['email']).toMatchObject({ kind: 'form-field', method: 'POST', confidence: 'high' });
    expect(byName['pass']?.inputType).toBe('password');
    expect(byName['pass']?.sample).toBeUndefined(); // password values never sampled
  });

  it('flags hidden inputs distinctly with their current value', () => {
    const rows = extractDomParams(
      doc('<form><input type="hidden" name="csrf" value="t0k3n"></form>'),
      PAGE,
    );
    const csrf = rows.find((r) => r.name === 'csrf');
    expect(csrf).toMatchObject({ kind: 'hidden', confidence: 'high', sample: 't0k3n' });
  });

  it('collects standalone (formless) controls and url-literals', () => {
    const rows = extractDomParams(
      doc(`<div><input name="q2" value="hi"></div><a href="/list?page=2&sort=desc">n</a>`),
      PAGE,
    );
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(byName['q2']).toMatchObject({ kind: 'dom-field', method: undefined, sample: 'hi' });
    expect(byName['page']).toMatchObject({ kind: 'url-literal', sample: '2' });
    expect(byName['sort']).toBeDefined();
  });

  it('honors data-param attributes as parameter identifiers', () => {
    const rows = extractDomParams(
      doc('<input data-param="tenant_id" name="display_only">'),
      PAGE,
    );
    expect(rows.find((r) => r.name === 'tenant_id')).toMatchObject({ kind: 'data-attr', confidence: 'low' });
  });

  it('never collects from out-of-band scripts — DOM only, read-only', () => {
    const rows = extractDomParams(doc('<div id="safe">text</div>'), PAGE);
    expect(rows).toEqual([]);
  });
});

describe('extractJsParams (text analysis — never executed)', () => {
  it('finds query keys in URL literals', () => {
    const rows = extractJsParams(`fetch("/api/v2/orders?order_id=7&include=items")`, PAGE);
    const names = rows.map((r) => r.name);
    expect(names).toContain('order_id');
    expect(names).toContain('include');
    expect(rows.find((r) => r.name === 'order_id')).toMatchObject({ kind: 'js-query', sample: '7' });
  });

  it('tracks URLSearchParams assigned to short variable names', () => {
    const code = `const p = new URLSearchParams(location.search); const uid = p.get("user_id"); p.set("page", "2");`;
    const rows = extractJsParams(code, PAGE);
    const names = rows.map((r) => r.name);
    expect(names).toContain('user_id');
    expect(names).toContain('page');
    expect(rows.find((r) => r.name === 'user_id')?.kind).toBe('js-searchparams');
  });

  it('extracts object keys ONLY from real request-call arguments (v0.5 fix)', () => {
    // inside an axios call → direct payload evidence → HIGH confidence
    const rows = extractJsParams(`axios.post(u, { params: { is_admin: false, role: "x" } })`, PAGE);
    const names = rows.map((r) => r.name);
    expect(names).toContain('is_admin');
    expect(names).toContain('role');
    expect(rows.find((r) => r.name === 'is_admin')?.confidence).toBe('high');
    // the same object OUTSIDE a request call → zero params (framework noise fix)
    const outside = extractJsParams(`var cfg = { params: { is_admin: false, role: "x" } };`, PAGE);
    expect(outside).toEqual([]);
  });

  it('rejects invalid parameter names', () => {
    const rows = extractJsParams(`fetch("/x?=bad&good=1")`, PAGE);
    expect(rows.map((r) => r.name)).toEqual(['good']);
  });
});

describe('collect helpers', () => {
  it('collects inline scripts and external srcs (absolute, http(s) only)', () => {
    const d = doc(`
      <script src="/app.js"></script>
      <script src="https://cdn.example.com/lib.js"></script>
      <script>const p = new URLSearchParams(location.search);</script>
      <script src="javascript:void(0)"></script>
    `);
    expect(collectInlineScripts(d)).toHaveLength(1);
    const srcs = collectScriptSrcs(d, PAGE);
    expect(srcs).toContain('https://target.example.com/app.js');
    expect(srcs).toContain('https://cdn.example.com/lib.js');
    expect(srcs.some((s) => s.startsWith('javascript:'))).toBe(false);
  });
});

describe('dedupeParams', () => {
  const at = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();

  it('merges by case-insensitive name, unions sources/kinds, keeps first spelling', () => {
    const records = dedupeParams([
      { name: 'user_id', source: 'url', kind: 'query', pageUrl: 'https://t/1', confidence: 'high', seenAt: at(1) },
      { name: 'User_ID', source: 'js', kind: 'js-query', pageUrl: 'https://t/2', confidence: 'medium', seenAt: at(2) },
    ]);
    expect(records).toHaveLength(1);
    const r = records[0]!;
    expect(r.name).toBe('user_id');
    expect(r?.sources).toEqual({ url: 1, js: 1 });
    expect(r?.kinds).toEqual(['query', 'js-query']);
    expect(r?.confidence).toBe('high'); // never downgraded
    expect(r?.occurrences).toBe(2);
  });

  it('tracks methods/inputTypes and first/last page + timestamps', () => {
    const records = dedupeParams([
      { name: 'email', source: 'form', kind: 'form-field', pageUrl: 'https://t/a', method: 'POST' as const, confidence: 'high' as const, seenAt: at(1) },
      { name: 'email', source: 'dom', kind: 'dom-field', pageUrl: 'https://t/b', method: 'GET' as const, confidence: 'medium' as const, seenAt: at(3) },
    ]);
    const r = records[0]!;
    expect(r?.methods).toEqual(['POST', 'GET']);
    expect(r?.firstPageUrl).toBe('https://t/a');
    expect(r?.lastPageUrl).toBe('https://t/b');
    expect(r?.firstSeenAt).toBe(at(1));
    expect(r?.lastSeenAt).toBe(at(3));
  });
});

import { collectCatalogUrls } from './extract';

describe('collectCatalogUrls (comprehensive URL discovery)', () => {
  function docFrom(html: string): Document {
    document.body.innerHTML = html;
    return document;
  }
  const eligible = (u: string) => u.includes('target.example.com') || u.includes('assets.example.com');

  it('collects page/links/forms/scripts/iframes/canonical/meta-refresh/data-urls', () => {
    const doc = docFrom(`
      <link rel="canonical" href="https://target.example.com/canonical">
      <meta http-equiv="refresh" content="3; url=/refreshed">
      <a href="/products?category=10">p</a>
      <form action="/checkout?step=1"></form>
      <script src="/assets/app.js"></script>
      <iframe src="https://assets.example.com/embed"></iframe>
      <img src="/img/logo.png">
      <div data-url="https://target.example.com/data-url"></div>
      <a href="https://google.com/x">external — must NOT be collected</a>
    `);
    const urls = collectCatalogUrls(doc, PAGE, eligible).map((e) => e.url);
    expect(urls).toContain(PAGE); // page
    expect(urls).toContain('https://target.example.com/products?category=10');
    expect(urls).toContain('https://target.example.com/checkout?step=1');
    expect(urls).toContain('https://target.example.com/assets/app.js');
    expect(urls).toContain('https://assets.example.com/embed'); // first-party CDN
    expect(urls).toContain('https://target.example.com/img/logo.png');
    expect(urls).toContain('https://target.example.com/data-url');
    expect(urls).toContain('https://target.example.com/canonical');
    expect(urls).toContain('https://target.example.com/refreshed');
    expect(urls.some((u) => u.includes('google.com'))).toBe(false); // scope isolation
  });

  it('inline JS literals: fetch/xhr paths and absolute urls', () => {
    const doc = docFrom(`
      <script>
        fetch("/api/v2/items");
        xhr.open("POST", "/api/submit");
        axios.get("https://target.example.com/api/list");
      </script>
    `);
    const urls = collectCatalogUrls(doc, PAGE, eligible).map((e) => e.url);
    expect(urls).toContain('https://target.example.com/api/v2/items');
    expect(urls).toContain('https://target.example.com/api/submit');
    expect(urls).toContain('https://target.example.com/api/list');
  });

  it('source labels are recorded (page/link/form/script/meta)', () => {
    const doc = docFrom(`<a href="/p1"></a><form action="/p2"></form><script src="/p3.js"></script>`);
    const rows = collectCatalogUrls(doc, PAGE, eligible);
    console.log('CATALOG:', JSON.stringify(rows));
    const map = Object.fromEntries(rows.map((r) => [r.url, r.source]));
    expect(map['https://target.example.com/p1']).toBe('link');
    expect(map['https://target.example.com/p2']).toBe('form');
    expect(map['https://target.example.com/p3.js']).toBe('script');
  });
});
