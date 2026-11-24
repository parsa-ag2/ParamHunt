// @vitest-environment happy-dom
/**
 * modules/param-discovery/lib/regression.test.ts — the v0.5 false-positive
 * regression suite. Locks in BOTH directions: framework noise stays out,
 * real business parameters stay in.
 */
import { describe, expect, it } from 'vitest';
import { extractJsParams, extractUrlParams, extractDomParams } from './extract';
import { classifyScript } from './classify';
import { isConfirmedParam } from '@shared/paramQuality';
import type { Finding } from '@shared/types/finding';

const PAGE = 'https://t.com/app';
const APP_JS = 'https://t.com/assets/app.js';

/** Minified Next.js-style bundle shape: query/params anchors + framework internals. */
const FRAMEWORK_NOISE = [
  'var r={query:{status:1,arg:2},body:{},filters:{store:1}};',
  'var p={params:{current:1},fields:{backend:1}};',
  'var i18={options:{defaultNS:["app"]}};',
  'var e={constructor:1};e[r]=2;e[t]=3;n[t]=4;o[0]=5;r[0]=6;',
  'o.state[s]=7;h.current=8;this.state.status=9;o.ctx.store=10;o.prev.next=11;o.next.prev=12;',
  't.defaultNS=["app"];t.arg=1;a.backend=2;e.constructor=3;',
  'var actions={cancelOrder:function(){},getDeliveryPackages:function(){},addGiftCart:function(){}};',
  'var x=cond?a=1:b;', // ternary — never a query string
];

/** Real application parameter shapes that MUST survive. */
const REAL_PARAMS = [
  'category_code',
  'vendor_code',
  'returnUrl',
  'product_id',
  'user_id',
  'redirect_uri',
  'csrf_token',
  'page',
  'filter[type]',
];

function jsParams(code: string): string[] {
  return extractJsParams(code, PAGE, APP_JS).map((o) => o.name);
}

describe('FALSE POSITIVE regression — framework noise produces zero JS params', () => {
  it.each(FRAMEWORK_NOISE.map((snippet) => [snippet] as const))('line "%s" → no params', (snippet) => {
    const names = jsParams(snippet);
    expect(names).toEqual([]);
  });

  it('the whole framework block produces zero params (not just per-line)', () => {
    expect(jsParams(FRAMEWORK_NOISE.join('\n'))).toEqual([]);
  });

  it('function-name maps (cancelOrder/getDeliveryPackages/addGiftCart) inside request payloads are filtered only without request context', () => {
    // outside a request call → not params
    expect(jsParams('var actions={cancelOrder:1,getDeliveryPackages:2,addGiftCart:3};')).toEqual([]);
    // inside a real axios payload they ARE payload fields (evidence-backed)
    const rows = jsParams("axios.post('/api/x',{cancelOrder:1,getDeliveryPackages:2});");
    expect(rows).toEqual(['cancelOrder', 'getDeliveryPackages']);
  });

  it('ternary expressions never produce query params', () => {
    expect(jsParams('var v=cond?x=1:y;')).toEqual([]);
  });
});

describe('TRUE POSITIVE regression — real parameters survive', () => {
  it('URL query strings: all business params extracted', () => {
    const names = jsParams(`fetch("/api/list?category_code=10&vendor_code=3&returnUrl=/home&product_id=42");`);
    for (const expected of ['category_code', 'vendor_code', 'returnUrl', 'product_id']) {
      expect(names).toContain(expected);
    }
  });

  it('URLSearchParams: literal names extracted', () => {
    const names = jsParams(
      `const params=new URLSearchParams(location.search);params.get("user_id");params.set("filter","active");params.append("page","2");`,
    );
    for (const expected of ['user_id', 'filter', 'page']) {
      expect(names).toContain(expected);
    }
  });

  it('request payload objects: real keys at HIGH confidence with payload evidence', () => {
    const rows = extractJsParams(
      `axios.post("/api/checkout",{product_id:42,csrf_token:"x",redirect_uri:"/done"});`,
      PAGE,
      APP_JS,
    );
    const names = rows.map((o) => o.name);
    for (const expected of ['product_id', 'csrf_token', 'redirect_uri']) {
      expect(names).toContain(expected);
    }
    for (const row of rows) {
      expect(row.confidence).toBe('high'); // direct request payload
      expect(row.evidence?.url).toBe(APP_JS);
      expect(row.evidence?.line).toBe(1);
    }
  });

  it('bracket notation params survive: filter[type]', () => {
    const names = jsParams(`fetch("/api/list?filter[type]=x&sort=desc");`);
    expect(names).toContain('filter[type]');
    expect(names).toContain('sort');
  });

  it('URL source: hash params + query params', () => {
    const names = extractUrlParams('https://t.com/cb#access_token=x&state=1').map((o) => o.name);
    expect(names).toContain('access_token');
    expect(names).toContain('state');
  });

  it('DOM source: hidden inputs + named fields', () => {
    document.body.innerHTML = `<form action="/checkout"><input type="hidden" name="csrf_token"><input name="email"></form>`;
    const names = extractDomParams(document, PAGE).map((o) => o.name);
    expect(names).toContain('csrf_token');
    expect(names).toContain('email');
  });

  it('end-to-end: all confirmed via the quality predicate', () => {
    const rows = extractJsParams(
      `fetch("/api/list?category_code=10&vendor_code=3");axios.post("/api/checkout",{product_id:42,csrf_token:"x"});`,
      PAGE,
      APP_JS,
    );
    for (const row of rows) {
      const f = {
        source: 'param-discovery',
        title: `param: ${row.name}`,
        detail: { confidence: row.confidence, kinds: [row.kind] },
      } as unknown as Finding;
      expect(isConfirmedParam(f)).toBe(true);
    }
  });
});

describe('CLASSIFICATION regression — hashed framework assets vs app bundles', () => {
  it('hashed polyfills (same-origin) → vendor', () => {
    expect(classifyScript('https://t.com/_next/static/polyfills-abc123.js', PAGE)).toBe('vendor');
  });
  it('hashed chunk-vendors (same-origin) → vendor', () => {
    expect(classifyScript('https://t.com/js/chunk-vendors.9f2a1b.js', PAGE)).toBe('vendor');
  });
  it('known jQuery/React/Vue assets → vendor', () => {
    expect(classifyScript('https://t.com/js/jquery.min.js', PAGE)).toBe('vendor');
    expect(classifyScript('https://t.com/js/react.production.min.js', PAGE)).toBe('vendor');
    expect(classifyScript('https://cdn.jsdelivr.net/npm/vue@3/dist/vue.global.prod.js', PAGE)).toBe('third-party');
  });
  it('hashed APP bundles (mixed) → first-party (still analyzed)', () => {
    expect(classifyScript('https://t.com/_next/static/_app-abc123.js', PAGE)).toBe('first-party');
    expect(classifyScript('https://t.com/js/main.7fa2b3.js', PAGE)).toBe('first-party');
  });
  it('first-party bundle with vendor-ish filename survives', () => {
    expect(classifyScript('https://t.com/assets/vendor.bundle.js', PAGE)).toBe('first-party');
  });
  it('unknown external origins excluded by default', () => {
    expect(classifyScript('https://tracker.io/pixel.js', PAGE)).toBe('third-party');
  });
});
