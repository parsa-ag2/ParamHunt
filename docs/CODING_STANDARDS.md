# CODING_STANDARDS.md

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
