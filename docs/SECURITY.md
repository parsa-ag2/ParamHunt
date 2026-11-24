# SECURITY.md

> Consolidated from SECURITY_MODEL (v0.5 cleanup).

# SECURITY_MODEL.md

ParamHunt is a security *instrument*; its own security posture must be exemplary — a compromised observer is the worst possible outcome.

## 1. Manifest V3 security model (the constraints we design within)

| MV3 fact | Consequence for ParamHunt |
|---|---|
| No remote code execution — all code ships in the package | No CDN scripts, no eval, no dynamic plugin loading; analysis modules compile in |
| Service worker replaces background page | Event-driven design; no persistent background state in memory |
| `webRequest` observational only (blocking moved to declarativeNetRequest) | HTTP analyzer observes; never blocks/rewrites traffic |
| Host permissions at install (or optional w/ user prompt patterns) | Scope allowlist enforced in-app regardless of granted hosts |
| Content scripts in isolated world | DOM read/observe only; page JS never trusted |
| CSP for extension pages | Strict default; React + bundler output complies |

*(Basis: official MV3 docs — "What is Manifest V3", architecture overview; verification pass pending, see TECHNICAL_DECISIONS #12.)*

## 2. Permission set (minimal + justified)

```jsonc
// wxt.config.ts manifest.permissions
"storage",      // findings + settings persistence (results-manager)
"scripting",    // targeted, user-triggered injections into scope-gated tabs
"webRequest",   // observational request metadata (http-analyzer)
"tabs",         // tab lifecycle (tab:activated engine event), tab URLs for scope checks
"activeTab",    // user-gesture-scoped access (popup actions)
"cookies"       // storage-inspector metadata (attributes, not HttpOnly values)
```

```jsonc
"host_permissions": ["<all_urls>"]  // justified: the tool observes arbitrary
// in-scope sites chosen by the researcher; scope allowlist gates what we touch.
// ROADMAP: evaluate "optional host permissions" UX (prompt per-site) at M3.
```

**Rejected permissions** (documented in TECHNICAL_DECISIONS #6): `webRequestBlocking` (MV2-only), `downloads` (blob export avoids it), `debugger` (on-demand roadmap addition, infobar cost documented), `declarativeNetRequest` (we don't block), `history`/`bookmarks`/`identity` (unrelated).

## 3. Worlds & injection safety

- **Isolated world (content script):** reads DOM, listens to mutations, owns storage snapshots. Cannot read page JS globals. All DOM-derived strings are **data, never code** — never assigned to `innerHTML` of extension pages (React text nodes only).
- **MAIN world:** required only for postMessage/event instrumentation (page-context hooks). Injection via MV3 registered content script with `world: "MAIN"` — **never** `eval`, never remote `<script src>`. The MAIN↔isolated channel validates a per-session random token + exact origin; page-forged messages are dropped.
- **Instrumentation discipline:** hooks observe and forward; they never alter page semantics (no message suppression/modification) — the researcher's presence must stay neutral.

## 4. Untrusted input handling

Everything a page produces is hostile input: URLs, headers, DOM text, storage values, postMessage payloads, bundle contents.

- **Encoding at boundaries:** findings carry raw strings only as *data*; UI renders them as React text nodes; exports escape CSV cells (formula-injection guard) and JSON is produced via `JSON.stringify`.
- **Payload previews capped** (`MAX_SAMPLE_VALUE` = 64 chars) and marked as previews; full values never leave the browser unless the user exports them.
- **No HTML rendering anywhere** for page-derived content.
- **Bundle analysis** treats downloaded JS as opaque text for regex/parsing — never executes it. Source-map `sourcesContent` likewise: parsed as text only.
- **Message validation:** `onMessage` router validates shape per protocol union (unknown type → ignored + logged); size caps on messages from content contexts.

## 5. Data handling & storage

- All findings/settings live in `chrome.storage.local` (device-local, extension-scoped). No telemetry, no network egress of collected data. (Verification: CI + review rule — `fetch` only used for user-initiated bundle retrieval from in-scope origins.)
- Findings may contain sensitive samples (tokens, IDs) — by design the researcher works locally; the **export step is the egress point**, user-controlled, with a redaction toggle planned (M8: mask token-like values).
- Secure storage note: `chrome.storage` is not encrypted at rest; documented so users don't collect on machines they don't trust.

## 6. Extension-page CSP & UI

- Extension pages (popup/options/devtools) ship with MV3's default strict CSP (no inline scripts, no remote resources). Tailwind/React via bundler output only.
- No `target="_blank"` without `rel="noopener noreferrer"`; external links from findings render as plain links the user clicks deliberately.

## 7. Performance & neutrality

- Observers are scoped (per active tab, debounced); MutationObserver batches; bundle analysis size-capped; storage writes batched. The tool must not distort the app it observes (event-loop budget) or reveal itself through traffic (extension fetches use extension context, not page context, and are documented).
