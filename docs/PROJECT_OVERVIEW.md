# PROJECT_OVERVIEW.md

**ParamHunt** — a professional Chrome Extension (Manifest V3) for browser-based security research and authorized web application testing.

## 1. Vision

Modern web-app security work happens inside the browser, but the browser's built-in tools (DevTools) are generic: they are built for debugging, not for systematic security research. ParamHunt is a modular, researcher-first layer on top of the browser that continuously **observes and structures** what an application exposes — parameters, requests, DOM surfaces, postMessage channels, JS internals, storage — and turns those observations into a **normalized, deduplicated, exportable findings model**.

Design ethos (in order):

1. **Observe, don't attack.** ParamHunt is a passive/analytical instrument. It never fires payloads. Exploitation belongs to the researcher's other tooling.
2. **Modular core, independent modules.** Every capability is a module behind one contract; the engine knows nothing module-specific.
3. **Every context matters.** Background, content, MAIN world, DevTools — each is a different runtime with different powers; the architecture treats them as first-class, typed surfaces.
4. **Findings are the currency.** Whatever a module discovers is normalized into one `Finding` model: filterable, deduplicable, exportable.
5. **Authorized use is a precondition, not a feature.** Scope/authorization awareness is part of the product design (see §4).

## 2. Target capabilities (planned — none implemented yet)

| # | Module | One-line purpose |
|---|--------|------------------|
| 1 | HTTP Request Analyzer | Structured observation of network traffic (headers, methods, URLs, response metadata) |
| 2 | Parameter Discovery | Query/fragment/form/hidden/JS-defined/API parameters incl. bundle-mined names |
| 3 | DOM Inspector | DOM traversal, dynamic changes (MutationObserver), forms & attributes |
| 4 | PostMessage Tracker | `window.postMessage` flows with origin/target validation visibility |
| 5 | JavaScript Analyzer | Static + runtime JS analysis, source maps, bundles, event handlers |
| 6 | Event Monitor | Runtime event listeners & delegation observation |
| 7 | Storage Inspector | LocalStorage / SessionStorage / Cookies / IndexedDB inspection |
| 8 | Results Manager | Normalization, dedup, filtering, search, history |
| 9 | Export Engine | JSON / CSV / structured report export |

Full contracts: [`MODULE_DESIGN.md`](MODULE_DESIGN.md).

## 3. User surfaces

- **Popup** — quick status, module toggles, current-tab snapshot.
- **DevTools panel** — the primary workbench: findings browser, filters, export. Chosen over popup for full-width tables + session-long lifetime (see TECHNICAL_DECISIONS #5).
- **Options page** — module settings, scope allowlist, export preferences.
- **Background service worker** — no UI; the engine + module host.

## 4. Authorization & scope stance

The extension is designed for researchers operating within authorized scopes (bug bounty programs, owned systems, written permission). Product-level safeguards planned:

- A **scope allowlist** (URL patterns) configured in Options; observation defaults to *off* for out-of-scope origins.
- Findings carry the origin they came from, so reports are attributable.
- No automated attack payloads, no fingerprint-spam, no data exfiltration to third parties. All data stays local (chrome.storage) unless the user exports it.

## 5. Glossary

| Term | Meaning |
|---|---|
| MV3 | Chrome Extension Manifest V3 — current platform (service worker, declarative resources, no remote code) |
| SW | (Background) service worker — event-driven background context |
| Content script | Extension JS injected into pages, runs in an *isolated world* |
| Isolated world | Shared DOM, separate JS context — page variables invisible |
| MAIN world | The page's own JS context; required to hook page-level APIs |
| Finding | Normalized, persisted observation produced by a module |
| CDP | Chrome DevTools Protocol |

## 6. Repository docs map

| Doc | Content |
|---|---|
| SYSTEM_ARCHITECTURE.md | Contexts, engine, state, diagrams |
| FOLDER_STRUCTURE.md | Directory-by-directory rationale |
| COMPONENT_COMMUNICATION.md | Message contracts + transport rules |
| MODULE_DESIGN.md | Per-module contracts (9 modules × 10 fields) |
| SECURITY_MODEL.md | Permissions, worlds, CSP, untrusted input |
| CODING_STANDARDS.md | TS/React conventions, testing standards |
| DEVELOPMENT_ROADMAP.md | M0–M9 build order |
| TECHNICAL_DECISIONS.md | ADR-style decisions + alternatives rejected |
