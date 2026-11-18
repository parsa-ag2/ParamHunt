# DEVELOPMENT_ROADMAP.md

Build order designed so the **foundation never needs restructuring**: engine + contracts first, then one module end-to-end to prove the pipeline, then parallelize.

| Milestone | Scope | Status |
|---|---|---|
| **M0 — Engine core (foundation)** | Storage adapter (chrome.storage.local + memory test double); Engine lifecycle (start/stop, restart-safe); ModuleRegistry topo-sort + cycle detection; typed bridge sendRequest/reply; onMessage router; unit tests | ✅ **done** (40 tests) |
| **M1 — Parameter discovery end-to-end** | URL/fragment + DOM (forms/hidden/controls/data-param/url-literals) + JS extraction (inline + background-fetched bundles); dedup into ParamRecords; scope gate (origin + allowlist/exclusions) enforced on both ends; findings persisted; DevTools panel live view + Rescan + filter + details; popup counters; Options scope editor | ✅ **done** (v0.1.0) |
| **M2 — Findings management UX** | status/notes/search, per-finding triage in panel | ⬜ next |
| **M3 — HTTP observatory** | webRequest metadata tier + opt-in debugger deep capture | ⬜ |
| **M4 — postMessage inspector** | MAIN-world registered script + token-validated relay | ⬜ |
| **M5 — js-analyzer depth** | API paths, sourcemap mining, richer data-flow indicators | ⬜ |
| **M6 — event-monitor + storage-inspector** | listener inventory; localStorage/session/cookies views | ⬜ |
| **M7 — export engine** | JSON first, then CSV/Markdown with escaping guards | ⬜ |
| **M8 — hardening** | perf budgets, redaction toggles, error-isolation review | ⬜ |
| **M9 — release** | versioning, changelog, self-distribution polish | ⬜ |

## Engineering gates

- Every milestone ships with tests; CI must be green (typecheck + unit + **build with chrome/ sync validation**).
- New chrome API usage updates `TECHNICAL_DECISIONS.md` with the limitation it hit.

## Open verification items

1. Official-docs verification pass (network-restricted earlier): SW lifecycle specifics, messaging edge cases, `world: "MAIN"` registration syntax — flagged `TODO(verify)` in code.
2. WXT devtools-panel entrypoint naming confirmed working in v0.21.5 (build verified).
