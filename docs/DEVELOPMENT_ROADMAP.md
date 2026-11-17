# DEVELOPMENT_ROADMAP.md

Build order designed so the **foundation never needs restructuring**: engine + contracts first, then one module end-to-end to prove the pipeline, then parallelize.

| Milestone | Scope | Exit criteria |
|---|---|---|
| **M0 — Engine core (foundation)** | Storage adapter impl (chrome.storage.local); Engine lifecycle (start/stop, restart-safe listener re-attach); ModuleRegistry topo-sort + cycle detection; bridge sendRequest/reply over chrome.runtime + tabs; onMessage router with protocol dispatch; vitest setup + first unit tests; dev icons | Extension loads unpacked; popup queries engine status successfully; SW restart keeps state |
| **M1 — results-manager + first real collector (dom-inspector slim)** | Finding normalization (id/hash/occurrences), dedup, rotation; content-script form/location param harvest (query, form, hidden); `params/report` wired end-to-end; DevTools panel lists findings live (port streaming) | Visiting a form page produces deduped param findings in the panel |
| **M2 — DevTools workbench polish** | Panel table (filters, severity, search), popup module toggles, options page (scope allowlist) | Scope allowlist gates collection; toggles persist |
| **M3 — http-analyzer (observational tier)** | webRequest metadata capture + normalization + scope filter; deep capture tier behind explicit toggle (debugger/CDP, devtools-driven) | Request findings appear; deep capture shows bodies preview with banner noted in UI |
| **M4 — postmessage-tracker** | MAIN-world registered script + token-validated relay; origin validation classifier | Fixture page wildcard postMessage flagged `high` |
| **M5 — param-discovery full + js-analyzer** | Bundle fetch + parse (capped), sourcemap sourcesContent mining, param merge from all sources, param-ranked view | Bundle-mined param names appear and merge with DOM/archive-less sources |
| **M6 — event-monitor + storage-inspector** | getEventListeners (devtools context) + storage snapshots/cookies attributes | Storage snapshot + cookie flag findings |
| **M7 — export-engine** | JSON/CSV/markdown serializers (CSV formula-injection guard), export UI in panel | Exported files round-trip |
| **M8 — hardening** | Redaction toggle, message size caps audit, perf budgets (MutationObserver batching), error isolation review | Perf budget test green on fixture SPA |
| **M9 — release process** | wxt zip builds, versioning, CHANGELOG, store-ready privacy disclosures (or self-distribution via GitHub releases) | v0.1.0 tagged |

## Standing engineering gates

- Every milestone ships with tests; no milestone merges with red CI.
- Every new chrome API usage updates `TECHNICAL_DECISIONS.md` with the limitation it hit.
- Docs live with code: module implementation = module doc updated same PR.

## Open verification items (network-restricted research phase)

1. Official-docs verification pass: service-worker lifecycle specifics, messaging edge cases, webRequest MV3 wording, `world: "MAIN"` registration syntax — flagged in code comments as `TODO(verify)`.
2. WXT devtools-panel entrypoint naming + panel.html auto-inclusion — confirm against wxt.dev reference when reachable.
