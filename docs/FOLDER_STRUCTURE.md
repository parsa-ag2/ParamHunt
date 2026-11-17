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
