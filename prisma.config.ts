import path from 'node:path';

import dotenv from 'dotenv';
import { defineConfig, env } from 'prisma/config';

// Next.js loads .env.local automatically; the Prisma CLI does not. Load the
// same files, in the same precedence order Next.js uses, so one .env.local
// serves the application, the CLI, the seed and the database tests.
dotenv.config({ path: ['.env.local', '.env'], quiet: true });

/**
 * Prisma CLI configuration.
 *
 * From Prisma 7 the connection URLs live here rather than in schema.prisma.
 * Two URLs, with different jobs (docs/ARCHITECTURE.md section 18):
 *
 *   DATABASE_URL  pooled, used by the running application
 *   DIRECT_URL    unpooled, used by migrations — a transaction-mode pooler
 *                 cannot support the advisory locks and session state that
 *                 `prisma migrate` needs
 *
 * `shadowDatabaseUrl` is intentionally absent: Prisma creates and drops a
 * temporary shadow database on the direct connection, which is correct for a
 * local Postgres and for any managed provider where the role may create
 * databases.
 */
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),

  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },

  // The CLI only ever runs migrations and introspection, so its connection is
  // DIRECT_URL — the unpooled endpoint. The application never uses this; it
  // connects through DATABASE_URL via the pg adapter in src/lib/db/client.ts.
  datasource: {
    url: env('DIRECT_URL'),
  },
});
