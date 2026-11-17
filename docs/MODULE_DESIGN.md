# MODULE_DESIGN.md

Every module implements `ModuleDefinition` (`src/shared/types/module.ts`): metadata, contexts, required APIs, lifecycle, and everything else arrives via injected `ModuleContext` services. Below: the contract per module (purpose / responsibilities / APIs / permissions / I/O / deps / interfaces / limitations / tests).

---

## 1. http-analyzer

1. **Purpose:** structured observation of HTTP traffic for the active tab(s).
2. **Responsibilities:** capture request/response metadata; normalize into findings; respect scope allowlist; support on-demand deep capture.
3. **Browser APIs:** `chrome.webRequest` (observational), `chrome.debugger` (CDP `Network.*`) for bodies, `chrome.devtools.network` alternative in devtools context.
4. **Permissions:** `webRequest`, `host_permissions`, optional `debugger` (added when deep capture enabled).
5. **Input:** traffic events filtered by scope + user toggles.
6. **Output:** findings `http-request` (method, url, status, header summary), `http-response-body` (on deep capture, preview only — never full body to storage unless user opts in).
7. **Dependencies:** results-manager.
8. **Interfaces:** events on engine bus; messages for enable/disable per tab.
9. **Limitations (MV3):** webRequest is **observational only** (no blocking — that moved to declarativeNetRequest); response bodies require the debugger tier + its infobar banner; SW suspension must not lose in-flight events (attach listeners at top level).
10. **Tests:** unit — URL/headers normalization, scope filter; integration — fake webRequest event stream; E2E — request visible in panel.

## 2. param-discovery

1. **Purpose:** discover every parameter an app accepts, from every surface available in-browser.
2. **Responsibilities:** harvest (a) URL query + fragment params (location parsing), (b) form inputs incl. hidden fields, (c) JS-defined params (fetch/axios calls + object literals in bundles — mirrors `param-extractor` skill logic), (d) API request params (from http-analyzer events), (e) ParamHunt's own wordlist-guessing assist is **out of scope** for the extension (differential guessing = external tooling; the extension surfaces what the page itself reveals).
3. **Browser APIs:** DOM (forms/location), fetch/XHR hooks (isolated world), `chrome.scripting` for targeted injection, webRequest event feed.
4. **Permissions:** `scripting`, `activeTab`, host permissions (via allowlist).
5. **Input:** DOM mutations, URL changes (SPA-aware), collected JS sources, request events.
6. **Output:** findings `param:<kind>` — `{name, kind: query|fragment|form|hidden|js|api, sample, source-url}`.
7. **Dependencies:** results-manager; feeds from http-analyzer + js-analyzer.
8. **Interfaces:** `params/report` message (already in protocol.ts).
9. **Limitations:** JS-bundle mining inside the page is size-bound (cap per-file analysis); SPA URL changes need history API hooks (pushState instrumentation); nothing sees server-side-only params.
10. **Tests:** unit — parser fixtures (HTML forms, JS literals, URLs); integration — param dedup; E2E — test page (local fixture) reveals known params.

## 3. dom-inspector

1. **Purpose:** expose the dynamic DOM surface (forms, links, attributes, injected nodes).
2. **Responsibilities:** MutationObserver-driven diffing; form + hidden-input inventory; attribute mining (onclick/handlers, data-*); element fingerprinting.
3. **Browser APIs:** DOM APIs, MutationObserver, content-script world.
4. **Permissions:** none beyond content script registration.
5. **Input:** DOM mutations, user-triggered snapshot request.
6. **Output:** findings `dom:<kind>` (form-summary, hidden-input, external-attribute...).
7. **Dependencies:** results-manager.
8. **Interfaces:** content-side collector; `dom/snapshot` messages (to be added to protocol).
9. **Limitations:** shadow DOM requires recursive traversal into open roots (closed roots are invisible by design); MutationObserver floods need batching/debounce; performance budget on huge SPAs.
10. **Tests:** unit — fixture DOM trees; perf test — 10k-node page budget; E2E — synthetic mutation appears.

## 4. postmessage-tracker

1. **Purpose:** make cross-window messaging visible: who posts to whom, with which target origin, and whether origins are validated.
2. **Responsibilities:** instrument `window.postMessage` + `message` listeners in the MAIN world; record direction (in/out), targetOrigin, origin validation posture; relay to background.
3. **Browser APIs:** MAIN-world registered content script (`world: "MAIN"`), `window.postMessage` hooks, `chrome.runtime` relay from the isolated world.
4. **Permissions:** content-script `matches` (scope-gated), no extra host perms beyond scope.
5. **Input:** page messaging activity.
6. **Output:** findings `postmessage:<kind>` — `{direction, targetOrigin, originValidated, payloadPreview(capped)}`; wildcard-`*` target origin flagged `high`.
7. **Dependencies:** results-manager.
8. **Interfaces:** `postmessage/observed` message (in protocol.ts); MAIN↔isolated token-validated bridge (see COMPONENT_COMMUNICATION §3.3).
9. **Limitations:** cannot see other extensions' isolated worlds; payload serialization may be non-JSON (Record preview only); hooking page JS is page-authority territory — instrument, never modify semantics (no dropping/altering page messages).
10. **Tests:** unit — origin-validation classifier; integration — forged-token drop; E2E — fixture page sends wildcard postMessage → flagged.

## 5. js-analyzer

1. **Purpose:** static + runtime insight into the page's JS (bundles, source maps, handlers).
2. **Responsibilities:** inventory scripts; fetch+analyze bundles (size-capped): URLs, `fetch/axios` calls, object-literal param candidates (feeds param-discovery), sink-pattern grep (innerHTML/eval/document.write — *informational*, human-verified later); source-map discovery + sourcesContent mining; listener registration via EventMonitor data.
3. **Browser APIs:** fetch (extension context — CORS-free with host permissions), `chrome.scripting`, DOM script elements.
4. **Permissions:** `scripting`, host permissions.
5. **Input:** script URLs, user trigger, http-analyzer captured responses.
6. **Output:** findings `js:<kind>` (bundle-inventory, param-candidate, sink-note, sourcemap-found).
7. **Dependencies:** results-manager; consumed by param-discovery.
8. **Interfaces:** `js/analysis-report` message (to add); shared parser in `modules/js-analyzer/` (pure functions — unit-testable without chrome).
9. **Limitations:** eval-heavy/WASM bundles resist static analysis; fetching huge bundles must be capped (memory); **cannot bypass CORS** for non-permitted origins; CDP `Debugger` domain optional for runtime depth.
10. **Tests:** golden-file parser tests; size-cap unit tests; sourcemap pipeline integration.

## 6. event-monitor

1. **Purpose:** surface the page's runtime event-listener surface (what reacts to what).
2. **Responsibilities:** enumerate listeners per node (via Chrome-specific `getEventListeners` in devtools context where available; otherwise MAIN-world addEventListener instrumentation for future registrations), delegation detection, hot-path event stats.
3. **Browser APIs:** DevTools command-line API (`getEventListeners` — devtools context only), MAIN-world instrumentation.
4. **Permissions:** devtools integration (no extra permission for the API).
5. **Input:** user trigger per element/page.
6. **Output:** findings `event:<kind>` (listener-inventory, delegation-node).
7. **Dependencies:** results-manager.
8. **Interfaces:** devtools-panel driven; messages to be added.
9. **Limitations:** `getEventListeners` is a DevTools-only API (not web APIs) — page-wide enumeration is not possible from a content script; instrumentation only sees registrations *after* hook install.
10. **Tests:** unit — listener inventory schema; E2E — fixture page with delegated handlers.

## 7. storage-inspector

1. **Purpose:** inspect web-platform storage (not extension storage): localStorage, sessionStorage, cookies (+ IndexedDB listing).
2. **Responsibilities:** snapshot on demand + change diffs; classify values (tokens/JWT-looking strings flagged); cookie attribute view (Secure/HttpOnly/SameSite via `chrome.cookies`).
3. **Browser APIs:** content-script `localStorage/sessionStorage` (isolated world shares storage partition), `chrome.cookies` API, `chrome.scripting` for deep diffing.
4. **Permissions:** `cookies` (+ host permissions), `scripting`.
5. **Input:** user snapshot request, storage `storage`-events, cookie changes.
6. **Output:** findings `storage:<kind>` (snapshot, change, token-like-value, cookie-flags).
7. **Dependencies:** results-manager.
8. **Interfaces:** `storage/snapshot` message (in protocol.ts).
9. **Limitations:** HttpOnly cookies visible via API metadata but not readable values (by design — correct behavior); IndexedDB full inspection is async-heavy — listing + selected-db dig; partitioned storage per top-level site.
10. **Tests:** unit — JWT/token classifier; E2E — fixture page sets localStorage → snapshot matches.

## 8. results-manager

1. **Purpose:** the single authority for finding persistence, dedup, query.
2. **Responsibilities:** normalize `FindingDraft` → `Finding` (id, hash, occurrences, status); dedup by hash; storage lifecycle (rotation policy); query engine for UI (filter/sort/paginate); history.
3. **Browser APIs:** `chrome.storage.local` via StorageAdapter (port).
4. **Permissions:** `storage` (owned by engine, not module-specific).
5. **Input:** `recordFinding` calls from all modules; queries from UIs.
6. **Output:** `FindingPage` (query results); events for UI updates.
7. **Dependencies:** none (first in start order).
8. **Interfaces:** `findings/query`, `findings/status` messages (in protocol.ts); `onFinding` engine hook.
9. **Limitations:** storage.local quota (10 MB default) → rotation: keep N=10k newest by default, configurable; full-text search is prefix/substring over indexed fields (no fuzz).
10. **Tests:** unit — dedup/merge, rotation, query filters (in-memory adapter); integration — concurrent writes.

## 9. export-engine

1. **Purpose:** turn findings into portable artifacts.
2. **Responsibilities:** JSON export (full model), CSV (flattened table view), structured markdown report (grouped by module/severity); filename/versioning conventions; download via `chrome.downloads` or blob anchor.
3. **Browser APIs:** Blob/URL.createObjectURL (devtools/popup context), optional `downloads` permission.
4. **Permissions:** none required for blob-based export; `downloads` only if saving via chrome.downloads (avoided by default — keep permissions minimal).
5. **Input:** FindingQuery result sets.
6. **Output:** files (JSON/CSV/MD) built client-side.
7. **Dependencies:** results-manager.
8. **Interfaces:** `export/run` message (to add); pure serializers in module (unit-testable).
9. **Limitations:** CSV needs strict escaping (formula-injection: prefix `'` on leading `=`/`+`/`-`/`@` cells); large exports must stream in chunks to avoid popup-context memory limits (prefer devtools panel).
10. **Tests:** unit — CSV escaping, JSON round-trip; snapshot — markdown report fixture.

---

## Evaluation notes (requested critical review)

- **Reorganization applied vs the original brief:** *Security Analysis* as a "module" was dissolved — every module emits findings with severity, and human triage (7-Question style) lives in the results workflow. A dedicated "security analysis" module would duplicate the others' job.
- **Export moved to the end of the pipeline** (it consumes results-manager queries, not raw module output).
- **results-manager starts before all emitters** (dependency ordering) so no finding is ever lost to an uninitialized sink.
- **param wordlist-guessing excluded** from the extension: it's an active technique with request volume (rate-limit/WAF implications) — belongs to dedicated tooling (Arjun/param-miner), not a passive observer. The extension covers all *passive* param surfaces.
