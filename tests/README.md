# Tests

| Directory      | Runner     | Contents                                                             |
| -------------- | ---------- | -------------------------------------------------------------------- |
| `unit/`        | Vitest     | Pure functions, above all the domain layer. No database, no network. |
| `components/`  | Vitest     | Design-system primitives in jsdom. Opt in with a                     |
|                |            | `@vitest-environment jsdom` docblock; setup is `tests/setup/dom.ts`. |
| `integration/` | Vitest     | Schema and services against a real database, plus the Better Auth    |
|                |            | flows in `auth.test.ts`.                                             |
| `e2e/`         | Playwright | Full journeys through a built application.                           |

```bash
npm run test         # unit + component + integration
npm run test:watch
npm run e2e          # builds, starts, then drives the app
```

`npm run e2e` starts two servers: a production build on 3000, and a development
server on 3100 for the design-system showcase, which does not exist in
production. They are kept apart by `NEXT_DIST_DIR`, so the dev server writes to
`.next-dev` rather than fighting the production build over `.next`.

`npm run e2e` needs browsers once: `npm run e2e:install`.

## Verifying the architecture boundary

The layer rules in `eslint.config.mjs` are load-bearing — if they silently stop
firing, the domain layer rots without anyone noticing. ESLint's
`no-restricted-imports` does **not** merge options across config blocks (the
last matching block wins), which is exactly how such a rule gets disabled by
accident when a new block is added.

There is no automated test for this, because the check is "does the linter
reject this file", not "does this code behave". Re-run it by hand after
changing `eslint.config.mjs`:

```bash
cat > src/domain/__boundary_probe.ts <<'EOF'
import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { clientEnv } from '@/lib/env';
import { betterAuth } from 'better-auth';
import { hash } from '@node-rs/argon2';

export function probe() {
  const w = window.location.href;
  const e = process.env.SECRET_THING;
  return [NextResponse, PrismaClient, clientEnv, betterAuth, hash, w, e];
}
EOF

npx eslint src/domain/__boundary_probe.ts   # must report 8 errors, exit 1
rm src/domain/__boundary_probe.ts

cat > src/components/__boundary_probe.tsx <<'EOF'
import { auth } from '@/lib/auth/config';
import { getCurrentActor } from '@/lib/auth';
import { betterAuth } from 'better-auth';
import { prisma } from '@/lib/db/client';
import { PrismaClient } from '@prisma/client';

export function Probe() {
  return [auth, getCurrentActor, betterAuth, prisma, PrismaClient];
}
EOF

npx eslint src/components/__boundary_probe.tsx   # must report 5 errors, exit 1
rm src/components/__boundary_probe.tsx

for dir in app domain components; do
  cat > "src/$dir/__generated_probe.ts" <<'EOF'
import { PrismaClient } from '@/generated/prisma/client';

export const probe = PrismaClient;
EOF
  npx eslint "src/$dir/__generated_probe.ts"   # must report 1 error, exit 1
  rm "src/$dir/__generated_probe.ts"
done
```

Expected from the domain probe: `next/server`, `@prisma/client`, `@/lib/env`,
`better-auth` and `@node-rs/argon2` rejected as imports; `window` and `process`
rejected as globals; `process.env` rejected by `no-restricted-syntax`.

Expected from the component probe: all five imports rejected — a component must
not reach the auth library, the auth boundary, or the database.

```bash
for dir in app domain components; do
  cat > "src/$dir/__sdk_probe.ts" <<'EOF'
import { S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';

export const probe = [S3Client, sharp];
EOF
  npx eslint "src/$dir/__sdk_probe.ts"   # must report 2 errors, exit 1
  rm "src/$dir/__sdk_probe.ts"
done
```

Expected from the generated-client probe: one rejection in each of the three
layers. It exists because the first two probes import `@prisma/client`, which is
the package name and **not what this project imports** — `prisma.config.ts`
generates the client into `src/generated/prisma`, and for a while that path was
missing from the rule, so a query written the way the repositories write one
would have linted clean anywhere outside `src/components`. A boundary that only
rejects the spelling nobody uses is not a boundary.

Expected from the storage-SDK probe: two rejections in each layer. The storage
provider and the image decoder are wrapped by `lib/storage` and `lib/media`, and
those two directories are the only ones allowed to import them (ADR-009). This
probe was added in Phase 9 because the first version of that boundary did not
exist: a component could import `@aws-sdk/client-s3` and lint clean.

Anything fewer means a boundary has been weakened.

Last verified: Phase 9 — eight, five, one per layer from the generated-client
probe, and two per layer from the storage-SDK probe; exit code 1 each.
