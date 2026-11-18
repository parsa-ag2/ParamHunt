# ParamHunt

**English** | [فارسی](README_FA.md)

![status](https://img.shields.io/badge/status-in%20development-orange) ![stack](https://img.shields.io/badge/stack-WXT%20%2B%20React-blue) ![mv3](https://img.shields.io/badge/manifest-v3-green)

A **Chrome extension for browser-based security research** — built for bug bounty hunters and security researchers who work inside the browser. ParamHunt observes what a web application exposes (parameters, requests, DOM, postMessage, JavaScript, storage) and turns those observations into an organized, exportable findings list.

> ⚠️ **Authorized use only.** ParamHunt is an observation instrument for systems you are permitted to test (bug bounty programs, your own applications, written permission). It never attacks — it observes.

---

## 📌 Current status (v0.0.1)

ParamHunt is **under active development**. The extension **installs and runs** today, with its full architecture in place (module engine, typed messaging, storage layer, all three UI surfaces). The analysis modules are being built milestone-by-milestone — see the honest breakdown below.

### ✅ Implemented now

| Feature | Description |
|---|---|
| Installable MV3 extension | Loads via `chrome://extensions/` → Load unpacked (see below) |
| Popup dashboard | Shows the module status board for the current session |
| DevTools panel | "ParamHunt" panel shell inside Chrome DevTools (F12) |
| Options page | Settings surface (module toggles land in the next milestone) |
| Core engine | Modular engine + typed messaging + storage layer (the foundation modules build on) |

### 🚧 Planned (do NOT report bugs on these yet — they don't exist)

- HTTP request analysis · parameter discovery (DOM, hidden, JS, archives) · DOM inspection · postMessage tracking · JavaScript analyzer · event monitor · storage inspector · findings management · export

The development order and milestone gates live in [`docs/DEVELOPMENT_ROADMAP.md`](docs/DEVELOPMENT_ROADMAP.md).

---

## 📥 Installation (no Node.js, no npm, no terminal)

The repository contains a **ready-to-load extension folder** (`chrome/`). You only need Chrome/Chromium.

### Step 1 — Download

On this repository page, click the green **`Code`** button → **`Download ZIP`**.
(Alternatively: `git clone https://github.com/parsa-ag2/ParamHunt.git` if you prefer git.)

### Step 2 — Extract

Extract the downloaded ZIP to any folder. You should see a `ParamHunt-main` folder containing, among others, a folder named **`chrome`**.

### Step 3 — Open Chrome Extensions

In Chrome's address bar, go to:

```
chrome://extensions/
```

### Step 4 — Enable Developer Mode

Toggle **`Developer mode`** on (top-right corner).

### Step 5 — Load the extension

Click **`Load unpacked`** (top-left), then select the **`chrome`** folder from the extracted repository — the folder that directly contains `manifest.json`.

> ✅ Correct: `…/ParamHunt-main/chrome`  ❌ Wrong: `…/ParamHunt-main` (no manifest here)

### Step 6 — Start using ParamHunt

- Click the ParamHunt icon in Chrome's toolbar (puzzle-piece 🧩 → pin it) to open the **popup dashboard**.
- Press **F12** on any page → find the **ParamHunt** tab inside DevTools for the panel surface.
- Open **Options** from the extension's details page (`chrome://extensions/` → Details) for the settings surface.

---

## 🖼️ Screenshots

_Coming soon — the current UI is an early shell; real screenshots will be added as functional milestones land._

---

## 🔐 Permissions & privacy

| Permission | Why it's requested |
|---|---|
| `storage` | Save findings and your settings locally in the browser |
| `tabs` / `activeTab` | Know which tab you're inspecting; user-gesture-scoped actions |
| `scripting` | Inject analysis code into pages you choose to inspect |
| `webRequest` | Observe network requests of the inspected tab (metadata) |
| `cookies` | Show cookie attributes (Secure/HttpOnly/SameSite) in the storage inspector |
| Host access (`<all_urls>`) | ParamHunt is a research tool for *arbitrary* targets you choose; an in-app scope allowlist will gate what is actually observed |

**Privacy:** everything stays on your machine. No telemetry, no analytics, no external servers. Findings live in local browser storage and leave your device only when you export them yourself.

---

## ❓ FAQ

**Is this an attack tool?** No. ParamHunt only observes. It never sends attack payloads, never blocks or rewrites traffic.

**Why Developer mode / Load unpacked?** The extension is in active development and not yet published to the Chrome Web Store. Loading unpacked is the standard way to run it.

**Does it work on Firefox?** The WXT toolchain supports Firefox builds (`npm run build:firefox` for developers), but current releases target Chrome/Chromium only.

**Chrome flagged the extension?** Unpacked research extensions commonly show the "Disable developer mode extensions" notice — that's expected for self-loaded extensions, not a virus warning.

## 🐞 Troubleshooting

| Problem | Fix |
|---|---|
| "Could not find manifest" on Load unpacked | You selected the repository root — select the **`chrome`** folder instead |
| Extension doesn't appear in toolbar | Click the puzzle-piece 🧩 icon → Pin ParamHunt |
| Nothing seems to happen | Open DevTools console (F12) and look for `[ParamHunt]` log lines |

## 🛠️ Development

ParamHunt is built with WXT + React + TypeScript. Developer setup, build commands, the `chrome/` synchronization workflow, tests, and contribution guide live in **[DEVELOPMENT.md](DEVELOPMENT.md)** and the [`docs/`](docs/) architecture set.

## 📄 License

[MIT](LICENSE)
