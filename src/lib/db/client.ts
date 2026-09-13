import 'server-only';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '@/generated/prisma/client';
import { isDevelopment, isProd, serverEnv } from '@/lib/env';

/**
 * The Prisma client singleton.
 *
 * This module and `server/repositories/` are the ONLY places Prisma may be
 * imported (docs/ARCHITECTURE.md section 6). The `server-only` import above
 * makes an accidental client-side import a build error rather than a runtime
 * surprise, and the ESLint boundary rules reject the import path anywhere else.
 *
 * Connection strategy (docs/ARCHITECTURE.md section 18):
 *
 *   - The application connects through `DATABASE_URL`, which points at the
 *     provider's pooler in production. Migrations use `DIRECT_URL` and never
 *     touch this client.
 *   - `max` defaults to 1. A serverless instance is short-lived and many run
 *     concurrently, so a per-instance pool multiplies against instance count
 *     and exhausts the server. Raise `DATABASE_POOL_MAX` only for a
 *     long-running server process.
 *   - The client is cached on `globalThis` in development so hot reload does
 *     not open a new pool on every edit. This is the one place a global is
 *     correct.
 */

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: serverEnv.DATABASE_URL,
    max: serverEnv.DATABASE_POOL_MAX,
    // Fail fast rather than queueing behind an exhausted pool.
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });

  return new PrismaClient({
    adapter,
    log: isProd ? ['warn', 'error'] : ['warn', 'error'],
  });
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (isDevelopment) {
  globalForPrisma.prisma = prisma;
}
