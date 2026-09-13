# STITCH

Custom embroidery ordering platform, storefront, customer portal and admin dashboard.

`STITCH` is a temporary brand name — see `docs/DESIGN-SYSTEM.md` section 2 for how to replace it.

## Status

**Phase 1 — Foundation.** Infrastructure only. There is no database, no authentication, and no
storefront yet; the page at `/` exists to prove the build chain works and is replaced in Phase 5.

Current work is always in [`tasks/CURRENT.md`](tasks/CURRENT.md). The plan is in
[`docs/ROADMAP.md`](docs/ROADMAP.md).

## Quick start

```bash
npm install
cp .env.example .env.local
npm run dev
```

`NEXT_PUBLIC_SITE_URL` defaults to `http://localhost:3000` in development. It is **required** for
`npm run build`, which runs as production — a missing value would silently emit wrong canonical
URLs and Open Graph tags, so the build fails instead.

## Scripts

| Script                            | Does                                              |
| --------------------------------- | ------------------------------------------------- |
| `npm run dev`                     | Development server                                |
| `npm run build`                   | Production build                                  |
| `npm run start`                   | Serve a production build                          |
| `npm run lint`                    | ESLint, including the architecture boundary rules |
| `npm run typecheck`               | `tsc --noEmit`                                    |
| `npm run test`                    | Vitest, unit and integration                      |
| `npm run test:watch`              | Vitest in watch mode                              |
| `npm run e2e`                     | Playwright (builds and starts the app first)      |
| `npm run e2e:install`             | Install Playwright browsers, once                 |
| `npm run format` / `format:check` | Prettier                                          |
| `npm run validate`                | Everything CI runs                                |

## Documentation

`docs/` is the source of truth, and each file has one job — read only what the task needs.

| File                                        | Covers                                     |
| ------------------------------------------- | ------------------------------------------ |
| [PRODUCT.md](docs/PRODUCT.md)               | Business model, customers, scope           |
| [UX.md](docs/UX.md)                         | Sitemap, journeys, interface states        |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md)     | Stack, layers, caching, deployment         |
| [DATABASE.md](docs/DATABASE.md)             | Schema design, the Phase 2 source of truth |
| [BUSINESS-RULES.md](docs/BUSINESS-RULES.md) | Pricing, lifecycles, permissions           |
| [DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md)   | Tokens and components                      |
| [SECURITY.md](docs/SECURITY.md)             | Auth, uploads, access control              |
| [ROADMAP.md](docs/ROADMAP.md)               | Phases and their definitions of done       |
| [DECISIONS.md](docs/DECISIONS.md)           | Why things are the way they are            |

`AGENTS.md` and `CLAUDE.md` carry the working rules for contributors and AI sessions.

## Architecture in one paragraph

A layered Next.js monolith. Dependencies point strictly downward: presentation, then entry points,
then services, then a **pure domain layer**, then repositories and infrastructure. The domain layer
holds every calculation and state machine and imports nothing — no framework, no ORM, no I/O — so
business rules are unit-testable in milliseconds and exist in exactly one place. ESLint enforces
this; see [`src/ARCHITECTURE.md`](src/ARCHITECTURE.md) and
[`tests/README.md`](tests/README.md) for how to verify it still holds.

## Requirements

Node 20.19+ (see `engines`). Node 22 LTS is the intended production runtime; CI validates both.
