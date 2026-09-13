import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as EnvModule from '@/lib/env';

/**
 * Configuration reaches the application.
 *
 * A narrow test for a failure that is invisible from the inside: a variable the
 * schema declares but the parse never reads is `undefined` however carefully it
 * was set, and because every one of these is optional, the result looks exactly
 * like "not configured yet". Storage silently fell back to the local adapter,
 * and the scheduler endpoint answered 503 with its secret set.
 *
 * The assertion is therefore not "these four names work" but "every name the
 * schema declares is read", which is what stops the list going stale again.
 */

/** Required by the schema in every environment, so always present. */
const REQUIRED: Record<string, string> = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/stitch',
  DIRECT_URL: 'postgresql://user:pass@localhost:5432/stitch',
  BETTER_AUTH_SECRET: 'a'.repeat(32),
};

/**
 * Import `lib/env` afresh under exactly these variables, then put the world
 * back. `undefined` unsets a variable, which is how the "not configured" case
 * is exercised on a machine where it happens to be configured.
 */
async function withEnvironment<T>(
  values: Record<string, string | undefined>,
  read: (env: typeof EnvModule) => T,
): Promise<T> {
  const overrides = { ...REQUIRED, ...values };
  const previous = new Map<string, string | undefined>();

  for (const [name, value] of Object.entries(overrides)) {
    previous.set(name, process.env[name]);

    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  vi.resetModules();

  try {
    return read(await import('@/lib/env'));
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }

    vi.resetModules();
  }
}

afterEach(() => {
  vi.resetModules();
});

describe('the server environment', () => {
  it('reads every variable its schema declares', async () => {
    // A distinct value for each declared name, so a name the parse never reads
    // shows up as `undefined` rather than as a coincidence of this machine.
    const values: Record<string, string> = {
      DATABASE_URL: REQUIRED.DATABASE_URL!,
      DIRECT_URL: REQUIRED.DIRECT_URL!,
      DATABASE_POOL_MAX: '7',
      BETTER_AUTH_SECRET: REQUIRED.BETTER_AUTH_SECRET!,
      BETTER_AUTH_URL: 'https://example.invalid',
      S3_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
      S3_REGION: 'auto',
      S3_BUCKET_PRIVATE: 'stitch-private',
      S3_ACCESS_KEY_ID: 'key-id',
      S3_SECRET_ACCESS_KEY: 'secret',
      STORAGE_LOCAL_ROOT: '/tmp/stitch',
      RESEND_API_KEY: 're_test_key',
      EMAIL_FROM: 'Bizeora <commandes@example.invalid>',
      ADMIN_NOTIFICATION_EMAIL: 'atelier@example.invalid',
      JOBS_SECRET: 'j'.repeat(32),
      SEO_INDEXABLE: 'true',
    };

    const seen = await withEnvironment(values, ({ serverEnv }) =>
      Object.fromEntries(
        Object.keys(values).map((name) => [
          name,
          (serverEnv as unknown as Record<string, unknown>)[name],
        ]),
      ),
    );

    // `NODE_ENV` is deliberately absent: vitest owns it. Two values are
    // transformed by the schema rather than passed through — the pool size to a
    // number, the indexing switch to a boolean — and those are the only ones
    // that may differ from what was set.
    expect(seen).toEqual({
      ...values,
      DATABASE_POOL_MAX: 7,
      SEO_INDEXABLE: true,
    });
  });

  it('leaves an unset optional variable undefined rather than guessing', async () => {
    const configured = await withEnvironment(
      { RESEND_API_KEY: undefined, JOBS_SECRET: undefined },
      ({ serverEnv }) => ({
        resend: serverEnv.RESEND_API_KEY,
        jobs: serverEnv.JOBS_SECRET,
      }),
    );

    expect(configured).toEqual({ resend: undefined, jobs: undefined });
  });
});
