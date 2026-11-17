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
