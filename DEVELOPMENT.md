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
5. Update `docs/ROADMAP.md` milestone checkboxes as gates close.


---

## Coding standards (from docs/CODING_STANDARDS.md)

## 1. TypeScript

- **Strict always** (`strict`, `noUncheckedIndexedAccess`, `noFallthroughCasesInSwitch`). No `any` — use `unknown` + narrowing. `eslint`/`biome` to be added at M0 (CI runs `tsc --noEmit`).
- **Path aliases** (`tsconfig.json`): `@core/*`, `@modules/*`, `@shared/*`, `@ui/*` — no relative `../../` chains across layers.
- **Dependency direction is enforced by review:** `shared` ← `core` ← `modules`/`entrypoints`. `core` must not import `modules`; `shared` must not import anything.
- **Discriminated unions over optional-flag structs** (messages, findings); exhaustive `switch` + `assertNever`.
- No enums — string-literal unions + `as const` objects.
- Types live in `src/shared/types/` when shared; co-located when module-private.

## 2. Browser / MV3 rules

- Never call `chrome.*` outside `core/` (engine, bridge, adapters) and `entrypoints/` boot files. Modules receive everything via `ModuleContext`.
- Background: all listeners registered **synchronously at top level**; `await` only inside handlers.
- Every `sendMessage` result is checked (`undefined` → transport failure); every callback path checks `chrome.runtime.lastError`.
- No `eval`, no remote code, no inline handlers in extension pages (CSP).
- Storage keys: `paramhunt:` prefix (`shared/constants.ts`).

## 3. React

- Function components only; no `React.FC` (type props directly).
- UI components are presentational; data via hooks that call the bridge.
- No page-derived content in `dangerouslySetInnerHTML` — forbidden except none.
- Keys are stable ids, never array indices in dynamic lists (findings list).

## 4. Naming & style

- Files: `PascalCase.ts(x)` for classes/components, `camelCase.ts` for modules/functions, folders `kebab-case`.
- Exports: named exports; `default` only for entrypoint definitions (WXT convention).
- Errors: typed error classes with `name` + `message`; module isolation via engine, not global try/catch.
- Comments: why, not what. Every non-obvious browser-API workaround cites its doc/source.

## 5. Testing standards

- **Unit (Vitest):** pure logic (parsers, normalizers, dedup, serializers) — no chrome mocks needed by design (ports + adapters). Target: every parser/normalizer has fixture-based tests.
- **Integration:** engine + adapters with in-memory storage fake; bridge over a fake `chrome.runtime`.
- **E2E (Playwright):** load built extension (`--load-extension`), drive fixture pages (local `e2e/fixtures/`), assert findings appear in panel. Chrome extension testing basis: developer.chrome.com "How to test".
- Coverage guidance: parsers/normalizers ≥90%; UI smoke only.
- Test data: fixtures in `e2e/fixtures/` (synthetic pages exercising each module surface).

## 6. Git

- Conventional Commits (`feat(modules): …`, `fix(core): …`, `docs: …`).
- Branches: `feat/<module>-<topic>`, `fix/<topic>`.
- CI must pass: typecheck + unit + build (E2E enabled from M1).
- No secrets in repo ever (`.env` gitignored; tokens live in the user's env, never files).
