#!/usr/bin/env node
/**
 * scripts/sync-chrome.mjs — synchronize the WXT production build into the
 * repository's ready-to-load extension directory: `chrome/`.
 *
 * Contract (see docs/DEVELOPMENT.md §sync):
 *  1. `.output/chrome-mv3/manifest.json` must exist, parse, and be MV3.
 *  2. `chrome/` is rebuilt from scratch (never stale partial state).
 *  3. EVERY file the manifest references must exist in `chrome/`
 *     (icons, service worker, popups, devtools/options pages,
 *     content_scripts js/css, web_accessible_resources).
 *  4. Any failure exits non-zero → `npm run build` fails (never silently
 *     ship an incomplete extension).
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(root, '.output', 'chrome-mv3');
const chromeDir = path.join(root, 'chrome');

/** collect files a manifest.json references, relative to the output root */
function manifestReferences(manifest) {
  const refs = [];
  const add = (p) => {
    if (typeof p === 'string') refs.push(p);
    else if (Array.isArray(p)) refs.push(...p.filter((x) => typeof x === 'string'));
  };
  for (const size of Object.values(manifest.icons ?? {})) add(size);
  if (manifest.background?.service_worker) add(manifest.background.service_worker);
  if (manifest.action?.default_popup) add(manifest.action.default_popup);
  if (manifest.action?.default_icon) add(Object.values(manifest.action.default_icon));
  if (manifest.devtools_page) add(manifest.devtools_page);
  if (manifest.options_ui?.page) add(manifest.options_ui.page);
  if (manifest.options_page) add(manifest.options_page);
  for (const cs of manifest.content_scripts ?? []) {
    add(cs.js ?? []);
    add(cs.css ?? []);
  }
  for (const war of manifest.web_accessible_resources ?? []) add(war.resources ?? []);
  return refs;
}

function fail(msg) {
  console.error(`[sync-chrome] ✖ ${msg}`);
  process.exit(1);
}

// 1 — build output exists + valid MV3 manifest
if (!fs.existsSync(path.join(buildDir, 'manifest.json'))) {
  fail(`no build output at .output/chrome-mv3 — run "wxt build" first`);
}
const manifestPath = path.join(buildDir, 'manifest.json');
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch (e) {
  fail(`manifest.json is not valid JSON: ${e.message}`);
}
if (manifest.manifest_version !== 3) {
  fail(`expected manifest_version 3, got ${manifest.manifest_version}`);
}

// 2 — rebuild chrome/ from scratch
fs.rmSync(chromeDir, { recursive: true, force: true });
fs.mkdirSync(chromeDir, { recursive: true });

let copied = 0;
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else {
      fs.copyFileSync(s, d);
      copied += 1;
    }
  }
}
copyDir(buildDir, chromeDir);

// 3 — every referenced file must exist in chrome/
const missing = [];
for (const ref of manifestReferences(manifest)) {
  const rel = ref.replace(/^\//, ''); // manifest icon paths are root-absolute
  if (!fs.existsSync(path.join(chromeDir, rel))) missing.push(ref);
}
if (missing.length > 0) {
  fail(`manifest references missing from chrome/:\n  - ${missing.join('\n  - ')}`);
}

// 4 — sanity: no empty web_accessible_resources stays harmless, but flag stray junk
const junk = fs
  .readdirSync(chromeDir, { recursive: true })
  .filter((f) => /\.(map|log|tmp)$/i.test(String(f)));
if (junk.length > 0) {
  fail(`unexpected junk files in chrome/: ${junk.join(', ')}`);
}

console.log(
  `[sync-chrome] ✔ chrome/ synchronized: ${copied} files, MV3 ` +
    `"${manifest.name}" v${manifest.version}, all ${manifestReferences(manifest).length} ` +
    `manifest references verified`,
);
