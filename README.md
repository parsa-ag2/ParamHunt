# ParamHunt

**Browser-based security research tool** — a modular Chrome Extension (Manifest V3) for inspecting and analyzing web application behavior during **authorized** testing: parameter discovery, HTTP analysis, DOM & JS inspection, postMessage tracking, storage inspection, and findings management.

> ⚠️ **For authorized security research and bug bounty work only.** Use only on systems you are permitted to test. The tool observes; it does not attack.

![status](https://img.shields.io/badge/status-architecture%20scaffold-blue) ![stack](https://img.shields.io/badge/stack-WXT%20%2B%20Vite%20%2B%20React%2019%20%2B%20TS-purple) ![mv3](https://img.shields.io/badge/manifest-v3-green)

## Status: Architecture Scaffold

The repository currently contains the **architecture**: full documentation set, build/config system, typed core-engine contracts, and entry-point skeletons. **No analysis logic is implemented yet** — module implementation starts at roadmap M1.

- Architecture docs: [`docs/`](docs/)
- Design decisions with rationale: [`docs/TECHNICAL_DECISIONS.md`](docs/TECHNICAL_DECISIONS.md)
- Build order: [`docs/DEVELOPMENT_ROADMAP.md`](docs/DEVELOPMENT_ROADMAP.md)

## Stack

| Layer | Choice |
|---|---|
| Language | TypeScript (strict) |
| Extension platform | Chrome Manifest V3 (service worker, content scripts, DevTools panel) |
| Framework | [WXT](https://wxt.dev) (Vite-based extension framework — auto-manifest, HMR) |
| UI | React 19 + Tailwind CSS 4 |
| Unit tests | Vitest |
| E2E | Playwright + Chrome extension testing |

## Getting started (after dependencies are implemented)

```bash
npm install          # installs deps + runs `wxt prepare` (generates .wxt types)
npm run dev          # dev build + HMR (load .output/chrome-mv3 as unpacked)
npm run build        # production build
npm run test         # unit tests (Vitest)
npm run test:e2e     # extension E2E (Playwright)
```

## License

MIT — see [LICENSE](LICENSE).
