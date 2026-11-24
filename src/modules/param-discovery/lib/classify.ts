/**
 * modules/param-discovery/lib/classify.ts — script classification.
 *
 * Decides BEFORE any download/parse whether a script URL is worth analyzing.
 * Three verdicts:
 *  - 'first-party': the site's own application code → analyze.
 *  - 'vendor': a recognizable third-party library → never analyze, even
 *    when self-hosted (exact well-known lib filenames).
 *  - 'third-party': unknown external origin → excluded by default.
 *
 * Rules (deliberate, from the spec):
 *  - Same origin as the page → first-party ALWAYS (a first-party bundle
 *    stays eligible even if its filename contains vendor/bundle).
 *  - Cross-origin CDN/static-assets domains that share the site's
 *    registrable domain (assets.example.com for example.com) → first-party.
 *  - Cross-origin unknown → third-party (excluded by default).
 *  - Exact well-known library filenames (jquery.min.js, react.production…)
 *    are excluded everywhere — self-hosted copies are still vendor code.
 *  - Weak naming patterns (chunk-vendors, vendors~…) apply to cross-origin
 *    scripts only, so a same-origin app bundle named vendor.js survives.
 *  - No JS execution, no AST — pure URL inspection.
 */

export type ScriptVerdict = 'first-party' | 'vendor' | 'third-party';

/** Exact filenames that are always third-party libraries, self-hosted or not. */
const KNOWN_LIB_FILES = [
  'jquery.js', 'jquery.min.js', 'jquery-3.js', 'jquery-ui.js', 'jquery-ui.min.js',
  'react.js', 'react.min.js', 'react.production.min.js', 'react.development.js',
  'react-dom.js', 'react-dom.production.min.js', 'react-dom.development.js',
  'vue.js', 'vue.min.js', 'vue.runtime.js', 'vue.runtime.min.js', 'vue.global.js', 'vue.global.prod.js',
  'angular.js', 'angular.min.js', 'angular-animate.js', 'angular-route.js',
  'bootstrap.js', 'bootstrap.min.js', 'bootstrap.bundle.js', 'bootstrap.bundle.min.js',
  'lodash.js', 'lodash.min.js',
  'moment.js', 'moment.min.js', 'moment-with-locales.js',
  'axios.js', 'axios.min.js',
  'ember.js', 'ember.min.js', 'backbone.js', 'backbone.min.js',
  'mootools.js', 'prototype.js', 'modernizr.js', 'modernizr.min.js',
  'popper.js', 'popper.min.js',
  'chart.js', 'charts.js', 'd3.js', 'd3.min.js',
  'tinymce.min.js', 'ckeditor.js',
  'swiper.js', 'swiper.min.js', 'swiper-bundle.js',
  'gtag.js', 'gtm.js', 'analytics.js',
  'recaptcha.js', 'recaptcha/api.js',
  'stripe.js',
  'sdk.js', 'widget.js',
];

/**
 * STRICT vendor-only filename patterns — definitionally framework/polyfill
 * files with no application code. Apply to SAME-ORIGIN scripts too
 * (polyfills-<hash>.js, chunk-vendors-<hash>.js, runtime chunks).
 * Deliberately NOT applied to app-entry names (_app-*, main-*, index-*) —
 * those are mixed bundles that must keep getting analyzed.
 */
const STRICT_VENDOR_ONLY = [
  /^polyfills?([-_.][\w.-]*)?\.js$/i,
  /^chunk[-_.]?vendors?([-_.][\w-]+)?\.js$/i,
  /^vendors?(~[\w.-]+)?\.js$/i,
  /^vendors?\.[a-f0-9]{8,}\.js$/i,
  /^runtime([-_.~][\w.-]*)?\.js$/i,
];

/** Weak naming patterns — third-party signals only on cross-origin scripts. */
const WEAK_VENDOR_PATTERNS = [
  /(^|\/)(vendors?~?[.\-]?)(main|app|chunk)?[.-]?(\d+)?[.-]?vendor/i,
  /chunk[-_.]?vendors?/i,
  /(^|\/)vendors?\//i,
  /node_modules\//i,
  /(^|\/)framework(\.|\/|-)/i,
  /polyfills?(\.min)?\.js$/i,
  /(^|\/)vendor(\.min)?\.js$/i,
];

/** Third-party infrastructure origins — never first-party even by domain suffix. */
const KNOWN_THIRD_PARTY_HOSTS = [
  'cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com', 'ajax.googleapis.com',
  'code.jquery.com', 'stackpath.bootstrapcdn.com', 'maxcdn.bootstrapcdn.com',
  'fonts.googleapis.com', 'fonts.gstatic.com', 'www.googletagmanager.com',
  'www.google-analytics.com', 'googleapis.com', 'gstatic.com',
  'jsdelivr.net', 'unpkg.com', 'cdn.jsdelivr.net',
];

/** Registrable-domain approximation: last two labels (covers co.uk-style poorly — accepted, documented). */
function registrableDomain(hostname: string): string {
  const parts = hostname.toLowerCase().split('.');
  return parts.length >= 2 ? parts.slice(-2).join('.') : hostname;
}

export function classifyScript(srcUrl: string, pageOrigin: string): ScriptVerdict {
  let u: URL;
  try {
    u = new URL(srcUrl);
  } catch {
    return 'third-party';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'third-party';

  // tolerant input: accepts a bare origin OR a full page URL
  let pageHost = '';
  try {
    pageHost = new URL(pageOrigin).hostname.toLowerCase();
  } catch {
    pageHost = (pageOrigin.replace(/^https?:\/\//, '').split('/')[0] ?? '').toLowerCase();
  }
  const scriptHost = u.hostname.toLowerCase();
  const sameOrigin = u.origin === pageOrigin || scriptHost === pageHost;
  const file = u.pathname.split('/').pop() ?? '';
  const fileLower = file.toLowerCase();

  // known third-party infrastructure → excluded by default (strongest signal)
  if (KNOWN_THIRD_PARTY_HOSTS.some((h) => scriptHost === h || scriptHost.endsWith(`.${h}`))) {
    return 'third-party';
  }

  // exact well-known library filenames → vendor everywhere
  if (KNOWN_LIB_FILES.includes(fileLower)) return 'vendor';

  if (sameOrigin) {
    // strict vendor-only files (polyfills/vendor/runtime chunks) are
    // framework-only even when self-hosted — nothing app-related to mine
    if (STRICT_VENDOR_ONLY.some((rx) => rx.test(file))) return 'vendor';
    return 'first-party';
  }

  // shared registrable domain (assets.example.com for example.com) → first-party
  if (scriptHost && pageHost && registrableDomain(scriptHost) === registrableDomain(pageHost)) {
    return 'first-party';
  }

  // weak vendor naming on cross-origin scripts → vendor
  if (WEAK_VENDOR_PATTERNS.some((rx) => rx.test(u.pathname))) return 'vendor';

  // unknown external → excluded by default (spec rule)
  return 'third-party';
}

/** Filter a list of script srcs down to first-party ones worth mining. */
export function firstPartyScripts(srcs: readonly string[], pageOrigin: string): string[] {
  const out: string[] = [];
  for (const src of srcs) {
    if (classifyScript(src, pageOrigin) === 'first-party') out.push(src);
  }
  return out;
}
