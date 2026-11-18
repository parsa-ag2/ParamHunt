# DEVELOPMENT.md — ParamHunt developer guide

> **End users don't need this file.** If you just want to install ParamHunt, follow [`README.md`](README.md) — no Node.js, no npm, no terminal.

## 1. Prerequisites

- Node.js ≥ 20 (tested on 26) and npm
- Chrome/Chromium for manual testing

## 2. Setup

```bash
npm install        # installs deps + runs `wxt prepare` (generates .wxt types)
```

## 3. Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev build with HMR; load `.output/chrome-mv3` as unpacked extension |
| `npm run build` | **Production build + `chrome/` synchronization** (fails if sync fails) |
| `npm run sync:chrome` | Re-sync `.output/chrome-mv3` → `chrome/` standalone |
| `npm run zip` | Store-ready ZIP of the production build (developer artifact, not user distribution) |
| `npm run compile` | TypeScript typecheck (`tsc --noEmit`) |
| `npm run test` | Unit tests (Vitest) |
| `npm run test:e2e` | Extension E2E (Playwright; needs `npx playwright install chromium` + `EXTENSION_PATH=.output/chrome-mv3`) |

## 4. The `chrome/` directory — the one rule that matters

`chrome/` is the **ready-to-load extension that ordinary users install** via Load unpacked. It is a **generated artifact that is intentionally committed** to git (this is the repository's distribution model — no Releases, no ZIP assets).

- It is produced by `npm run build`, which runs `wxt build` and then `scripts/sync-chrome.mjs`.
- The sync script **rebuilds `chrome/` from scratch**, validates the manifest (MV3, parses), and verifies **every file the manifest references** exists (icons, service worker, popups, content scripts, web-accessible resources). Any miss → non-zero exit → build fails.
- **Never edit files in `chrome/` by hand** — they are overwritten on the next build. Source lives in `src/`.
- `.gitignore` deliberately does **not** exclude `chrome/`.

Manual equivalent: `wxt build && node scripts/sync-chrome.mjs`.

## 5. Project architecture (short version)

Full architecture lives in [`docs/`](docs/) — start with `SYSTEM_ARCHITECTURE.md`, then `MODULE_DESIGN.md` and `TECHNICAL_DECISIONS.md`.

```
src/
├── entrypoints/     # background (SW) · content · popup · options · devtools
├── core/            # engine, typed messaging protocol + bridge, storage port
├── modules/         # analysis modules (one folder each, ModuleDefinition contract)
├── shared/          # cross-context types, constants, logger
└── ui/              # shared React components
```

Rules: `core/` never imports `modules/`; `shared/` never imports `chrome.*`; modules get everything via `ModuleContext`; the background owns storage; `defineBackground`/`defineContentScript`/`browser` are **WXT auto-imports** (no import line — an explicit `import from 'wxt'` breaks `wxt prepare`).

## 6. Testing

- **Unit (Vitest):** pure engine pieces (`src/**/*.test.ts`). Ports/adapters make chrome mocking unnecessary so far.
- **Integration/E2E (Playwright):** `EXTENSION_PATH=<built dir> npm run test:e2e`; specs in `e2e/`, fixture pages go to `e2e/fixtures/`.
- CI (`.github/workflows/ci.yml`): install → typecheck → unit → build. E2E steps are commented until a runner with a browser is available.

## 7. Contribution

1. Branch from `main`: `feat/<module>-<topic>` / `fix/<topic>`.
2. Conventional Commits (`feat(modules): …`, `fix(core): …`, `docs: …`).
3. CI must be green: typecheck + tests + **build** (which includes `chrome/` sync + validation).
4. If you touched architecture: update the matching `docs/*.md` in the same PR.
5. Update `docs/DEVELOPMENT_ROADMAP.md` milestone checkboxes as gates close.
