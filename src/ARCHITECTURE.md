# Source layout

The full structure and the reasoning are in `docs/ARCHITECTURE.md` sections 3 and 17.
This file is the short version, kept next to the code it describes.

## Layers, and which way dependencies point

```
app/ · components/     presentation — renders, never calculates
        ↓
server/actions/        entry points — auth, validation, rate limit
        ↓
server/services/       orchestration and transactions
        ↓
domain/                PURE business logic — no I/O, no framework
        ↓
server/repositories/   the only Prisma consumers
lib/                   infrastructure adapters
```

A lower layer never imports an upper one.

## Directories

| Path          | Holds                                                                  | Created in            |
| ------------- | ---------------------------------------------------------------------- | --------------------- |
| `app/`        | Routes, layouts, route handlers                                        | Phase 1               |
| `components/` | UI. Never imports services or repositories                             | Phase 4               |
| `config/`     | Brand and site configuration                                           | Phase 1               |
| `domain/`     | Pure business logic and state machines                                 | Phase 1 (`result.ts`) |
| `lib/`        | Infrastructure: env, db, storage, payments, notifications              | Phase 1 (`env.ts`)    |
| `server/`     | Actions, services, repositories, auth, cache                           | Phase 3               |
| `styles/`     | `tokens.css` and `globals.css` — the only place raw design values live | Phase 1               |
| `types/`      | Shared types not owned by a single module                              | as needed             |

Directories are created by the phase that first needs them. An empty directory
full of placeholder files is worse than no directory.

## The rules that are enforced, not just documented

`eslint.config.mjs` fails the build on any of these:

- `domain/` importing Next.js, React, Prisma, `lib/`, `server/`, `app/` or `components/`
- `domain/` touching `window`, `document`, `fetch` or `process`
- `components/` importing `server/services` or `server/repositories`
- anything outside `server/repositories/` and `lib/db/` importing Prisma
- reading `process.env` outside `lib/env.ts` for a non-`NEXT_PUBLIC_` variable

If a rule blocks something legitimate, the design is wrong — not the rule.
Raise it rather than adding an eslint-disable.
