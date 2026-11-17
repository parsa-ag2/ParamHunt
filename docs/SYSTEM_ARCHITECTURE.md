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
