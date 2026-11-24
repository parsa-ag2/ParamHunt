# ARCHITECTURE.md

> Consolidated from SYSTEM_ARCHITECTURE + COMPONENT_COMMUNICATION + FOLDER_STRUCTURE (v0.5 cleanup).

# SYSTEM_ARCHITECTURE.md

## 1. Runtime contexts (the fundamental constraint)

A Chrome MV3 extension is **not one program** — it is several programs in separate JS contexts that share nothing except messaging APIs and (for content scripts) the DOM:

```
┌───────────────────────────────────────────────────────────────────────┐
│ Browser process                                                       │
│                                                                       │
│  ┌──────────────────────┐        ┌───────────────────────────────┐   │
│  │ Background (SW)      │        │ DevTools page                 │   │
│  │ - Engine             │◀──────▶│ - chrome.devtools.*           │   │
│  │ - ModuleRegistry     │ runtime│ - inspectedWindow.tabId       │   │
│  │ - results pipeline   │ msgs   │ - Panel UI (React)            │   │
│  │ - webRequest/debugger│        └───────────────────────────────┘   │
│  │ - storage authority  │        ┌───────────────────────────────┐   │
│  └──────────┬───────────┘        │ Popup / Options (React)       │   │
│             │ runtime msgs       │ - thin views over bg state    │   │
│  ┌──────────▼───────────────────┴───────────────────────────────┐    │
│  │ Tab(s): web pages                                            │    │
│  │  ┌─────────────────────────┐   ┌──────────────────────────┐  │    │
│  │  │ Content script (ISOLATED│   │ MAIN-world injector      │  │    │
│  │  │ world): DOM observers,  │──▶│ (page context):          │  │    │
│  │  │ form/location reading,  │ M │ postMessage hooks,       │  │    │
│  │  │ runtime messaging       │   │ page API instrumentation │  │    │
│  │  └─────────────────────────┘   └──────────────────────────┘  │    │
│  └──────────────────────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────────────────────┘
```

**Hard rules that follow from this topology:**

1. **No shared mutable state across contexts.** The background owns authoritative state (findings, module status) behind chrome.storage; every other context is a thin view.
2. **All cross-context calls go through the typed bridge** (`core/messaging/protocol.ts`), never raw `chrome.*` scattered in feature code.
3. **The engine exists only in the background.** Content/MAIN modules are *collectors* — they harvest and report; the engine normalizes and persists.

## 2. The Core Engine (background)

Responsibilities (contract in `src/core/engine/`):

| Concern | Implementation | Notes |
|---|---|---|
| Module registration | `ModuleRegistry` (typed `ModuleDefinition`) | Duplicate ids rejected; deps resolved topologically |
| Lifecycle | `Engine.start()/stop()` | **Restart-safe**: MV3 SW may suspend at any idle moment; `start()` re-attaches listeners idempotently |
| Event distribution | `EventBus` (typed, in-context only) | Cross-context distribution is messaging, never the bus |
| Data processing | findings pipeline | `FindingDraft` → normalize (add id/hash/occurrences) → `Finding` → storage |
| Message coordination | `bridge` router | One `runtime.onMessage` router, discriminated-union dispatch |
| Configuration | `StorageAdapter` port + settings scopes | Global (`settings.*`), per-module (`modules.<id>.*`) |
| Error handling | per-module isolation | One module's `start()` failure → module `error` status, engine continues |

**Architectural pattern: modular monolith with plugin contracts.** Evaluated alternatives:

- *Plugin architecture with runtime-loaded plugins* — rejected: MV3 forbids remote code loading; local dynamic imports of analysis modules buy nothing but indirection.
- *Micro-context services (each module its own SW?)* — impossible: MV3 allows one SW.
- *Pure event-driven with no central engine* — rejected: findings normalization/dedup/storage authority needs an owner.

Module design is plugin-like (contract + registry + no direct imports between modules), the codebase stays a modular monolith (one bundle, typed end-to-end). This grows without restructuring: a new module = new folder + registration.

## 3. State strategy

| State | Where | Why |
|---|---|---|
| Findings (authoritative) | `chrome.storage.local` via results-manager | Survives SW suspension; shared across contexts |
| Module status | in-memory + mirrored to storage | SW restart re-derives; UI reads storage copy |
| User settings | `chrome.storage.local` (+ optional `sync` for tiny prefs) | Cross-context, persistent |
| Tab/session view state | in-context (popup/devtools React state) | Ephemeral by nature |

**SW-suspension rule:** every listener is registered **synchronously at top level** of `background.ts`; any async boot work happens *inside* handlers. No module-level singletons that assume continuous life. (Doc basis: Chrome Extension "Service Workers" + "Architecture overview" — verification pass pending, roadmap M0.)

## 4. Surfaces

- **Popup** (`entrypoints/popup/`): current tab snapshot + module toggles. Dies on close — treat as a view, never authoritative.
- **DevTools panel** (`entrypoints/devtools/`): primary workbench. Lifetime = whole inspection session; full-width; `inspectedWindow.tabId` targets the inspected tab. Network-grade capture (debugger API) is natural here.
- **Options** (`entrypoints/options/`): module toggles, scope allowlist, export prefs.

## 5. Network capture strategy (background vs devtools)

Two tiered paths (detailed in MODULE_DESIGN.md#http-analyzer):

1. **Always-on tier:** `chrome.webRequest` (observational in MV3 — no blocking) for metadata: URLs, methods, headers, status.
2. **Deep tier (on demand, devtools-driven):** `chrome.debugger` (CDP `Network.enable`) for response **bodies** and full request/response pairs when the researcher explicitly enables capture for a tab. debugger shows an infobar banner — accepted, user-controlled.

`chrome.devtools.network` (devtools context) is also available for HAR-grade observation inside the panel context.


# COMPONENT_COMMUNICATION.md

## 1. The rule

**Contexts never share a JS environment.** Popup, devtools page, content script (isolated world), MAIN-world injector and the service worker are separate runtimes. Everything between them crosses `chrome.runtime` / `chrome.tabs` / (main↔isolated) `window.postMessage` transports. Therefore:

- One **typed protocol** (`src/core/messaging/protocol.ts`) — a discriminated union. No ad-hoc string messages.
- One **bridge module** (`src/core/messaging/bridge.ts`) that owns transports; feature code calls `sendRequest(msg)` / `onMessage(router)`.
- Every request carries a `requestId`; every reply is a `ParamHuntResponse` envelope (`ok`/`error`).

## 2. Channel matrix

| Channel | Transport | Notes |
|---|---|---|
| Popup ↔ Background | `chrome.runtime.sendMessage` / `onMessage` | SW may be suspended — a send **wakes** it; must handle `undefined` response + `lastError` |
| DevTools ↔ Background | `chrome.runtime.sendMessage` + `chrome.runtime.connect` (long-lived port for streaming findings) | DevTools page lives as long as the panel is open |
| Content ↔ Background | `chrome.runtime.sendMessage` (C→B), `chrome.tabs.sendMessage` (B→C) | Content scripts can only message their own extension |
| MAIN ↔ Content (isolated) | `window.postMessage` with **exact-origin + token validation** | The only bridge into the page's JS world |
| Core Engine ↔ Modules | in-context only: `ModuleContext` services + `EventBus` | Never crosses contexts |
| Modules ↔ Shared services | injected via `ModuleContext` (storage, logger, recordFinding) | Modules stay chrome-free |
| Engine ↔ Storage | `StorageAdapter` port (`chrome.storage.local` backend) | Testable with fakes |

## 3. Patterns

### 3.1 Request/response (default)

```
Popup                 Background(SW)
  │ sendRequest({type:'findings/query', requestId, query})
  │───────────────────────────────────────────▶ router → results-manager
  │◀──────────────────────────────────────────  {ok, forRequestId, data}
```

Implementation facts (from chrome docs, verification pass pending):

- `sendMessage()` resolves `undefined` when the receiver doesn't reply → **treat as transport failure**, not success.
- Always check `chrome.runtime.lastError` in callback-style code.
- Payloads must be **JSON-serializable** (MV3 structured-clone subset).

### 3.2 Streaming (findings feed into devtools panel)

`chrome.runtime.connect` long-lived port from the devtools page; background pushes `finding:new` events. Port closes automatically when devtools closes — re-connect on reopen. (Port lifecycle doc basis: "Message Passing" guide.)

### 3.3 MAIN-world isolation (postMessage module)

```
Page MAIN world                    Content script (isolated)         Background
  hooked postMessage ──window.postMessage({__paramhunt: token, data})──▶ validate origin+token ──▶ normalize → storage
```

- The injector is loaded via a **registered content script with `world: "MAIN"`** (MV3 feature) — not eval, not remote code.
- Messages carry a per-session random token; the isolated-world listener drops anything without it (prevents page-forged spoofing).

## 4. Anti-coupling checklist

1. Feature code never imports another *module's* internals — only shared types + bridge.
2. Handlers switch on `message.type` and end with `assertNever(msg)` for exhaustiveness.
3. Adding a message = adding to the union + payloads map; the compiler points to every place that must change.
4. UI components receive data via props from bridge hooks; no `chrome.*` inside components.
5. Background is the single writer of storage; other contexts read via messages (no storage races).


# FOLDER_STRUCTURE.md

Verified working tree conventions (WXT v0.21 — cloned from wxt-dev/wxt templates; React 19).

```
ParamHunt/
├── docs/                     # architecture documentation (this set)
├── e2e/                      # Playwright extension E2E specs
├── public/                   # static files copied verbatim (icons, etc.)
│   └── icons/                # manifest icons (PNG 16/32/48/128 — placeholders)
├── assets/                   # source-of-truth branding (logo.svg)
├── .github/workflows/        # CI (npm ci → typecheck → unit → build)
├── src/                      # WXT srcDir
│   ├── entrypoints/          # WXT convention: one folder/entry per runtime surface
│   │   ├── background.ts     # MV3 service worker (engine host)
│   │   ├── content.ts        # content script (isolated world collectors)
│   │   ├── popup/            # browser action UI (React)
│   │   ├── options/          # options page (React)
│   │   └── devtools/         # devtools page + panel (React)
│   ├── core/                 # framework-level, target-agnostic
│   │   ├── engine/           # Engine, ModuleRegistry, EventBus
│   │   ├── messaging/        # protocol.ts (typed contracts) + bridge.ts (transport)
│   │   └── storage/          # StorageAdapter port + chrome backend
│   ├── modules/              # one folder per analysis module (9 planned)
│   │   └── <module>/index.ts # ModuleDefinition (metadata + lifecycle contract)
│   ├── shared/               # cross-context types, constants, logger, css
│   │   ├── types/            # module.ts, finding.ts (the data contracts)
│   │   ├── constants.ts
│   │   ├── logger.ts
│   │   └── ui.css            # Tailwind v4 entry
│   └── ui/                   # shared React components (populated M1+)
├── package.json              # scripts: dev/build/zip/compile/test/test:e2e
├── wxt.config.ts             # manifest generation + vite/tailwind wiring
├── tsconfig.json             # strict TS; path aliases @core/@modules/@shared/@ui
├── vitest.config.ts          # unit tests
├── playwright.config.ts      # E2E (chromium, --load-extension)
└── .editorconfig / .gitignore / LICENSE(MIT) / README.md
```

## Rules encoded in the structure

1. **`core/` never imports from `modules/` or `entrypoints/`.** The engine is a framework; modules register themselves. (Dependency direction: entrypoints → core, modules → core+shared, shared → nothing.)
2. **`modules/<id>/index.ts` exports exactly one `ModuleDefinition`.** No side effects at import time — registration is explicit in `background.ts`. (Safe under SW restart.)
3. **`shared/` has no chrome APIs.** Pure types/constants run in every context.
4. **`ui/` is presentational only.** Data access via the bridge, never via chrome APIs inside components.
5. **New module = new folder under `modules/` + one registration line.** Nothing else changes.

## Generated directories (gitignored)

| Path | Producer | Purpose |
|---|---|---|
| `.wxt/` | `wxt prepare` | Generated TS types (browser runtime augmentations, tsconfig base) |
| `.output/` | `wxt build` / `wxt dev` | Built extension per browser (`chrome-mv3`, `firefox-mv2`) |
