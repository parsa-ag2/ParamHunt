# ParamHunt

**English** | [فارسی](README_FA.md)

A Chrome extension for browser-based security research: it **discovers and catalogs the parameters a web application exposes** — from the URL, forms (including hidden inputs), the live DOM, and the page's JavaScript — as you browse an authorized target.

> ⚠️ ParamHunt is an **observation-only** tool, built for authorized testing (bug bounty programs, your own apps). It never submits forms, sends payloads, or modifies requests.

## What it does now

- **Parameter Discovery** — collects parameter names from every client-side source on the pages you visit:
  - URL query + fragment parameters
  - HTML forms: action, method, inputs/selects/textareas, **hidden inputs**
  - Standalone DOM controls and `data-param` attributes
  - JavaScript sources: URL literals, `URLSearchParams` usage, param/config object keys (analyzed as text, never executed)
- **Deduplication** — the same parameter seen across pages/sources is merged into one entry with occurrence counts, source breakdown, method/input-type context, and a confidence rating.
- **Scope control** — observes the current site's origin by default; extend it with an allowlist (domain or glob patterns) and exclusions in Options. Exclusions always win. Out-of-scope pages are never collected.
- **DevTools panel** — F12 → *ParamHunt* tab: live parameter table with source badges, method/type context, occurrence counts, confidence, detail view, text filter + source filters + sorting, manual **Rescan** (auto-injects the collector into tabs opened before install), **Copy** per parameter, **Copy All** (unique, one per line), **Copy Selected**, and Clear.
- **Popup** — current-tab scope status, discovered-parameters counter (this site), name preview, **Copy All**, **Rescan**, engine status.
- **Automatic collection** — scans on page load, on dynamically added forms/fields, and on SPA navigations (history-state changes) for in-scope tabs.
- **Persistence** — findings survive browser restarts (local browser storage, deduplicated).
- **Manual rescan** — collect from dynamically added forms/fields on demand.

## Installation 

The repository ships a **ready-to-load extension folder** (`chrome/`), which contains the compiled extension (`manifest.json` at its root).

1. **Download**: green **`Code`** button → **`Download ZIP`** (or `git clone https://github.com/parsa-ag2/ParamHunt.git`).
2. **Extract** the ZIP — you get a folder like `ParamHunt-main` containing the `chrome` folder.
3. **Open** `chrome://extensions/` in Chrome/Chromium.
4. **Enable** the **`Developer mode`** toggle (top-right).
5. Click **`Load unpacked`** and select the extracted **`chrome`** folder — the one that directly contains `manifest.json` (not the repository root).
6. **Use it**: browse your target; open DevTools (F12) → **ParamHunt** tab → **Rescan**.

## Privacy

All data stays on your machine: findings live in local browser storage and leave your device only when you export them (export UI is in development). No telemetry, no external servers. The extension requests `storage`, `scripting`, `webRequest`, `tabs`, `activeTab`, `cookies`, `webNavigation` and host access for the targets you choose; the scope system gates what is actually collected.

## Development

WXT + React + TypeScript. Setup, build commands, and the `chrome/` synchronization contract: **[DEVELOPMENT.md](DEVELOPMENT.md)**. Architecture documents: [`docs/`](docs/).

## License

[MIT](LICENSE)
