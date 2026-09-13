import { z } from 'zod';

/**
 * Validated environment configuration.
 *
 * Rules (docs/SECURITY.md section 14):
 *   - The application refuses to start on a missing or malformed variable, so
 *     a misconfiguration is a failed deploy rather than a silent security gap.
 *   - No secret is ever prefixed NEXT_PUBLIC_.
 *   - Server variables are unreachable from client code; accessing `serverEnv`
 *     in the browser throws rather than returning undefined.
 *
 * Only variables the current foundation actually needs are defined here.
 * Later phases add their own (see .env.example for what is coming and when) —
 * a variable is added to this file in the phase that first reads it, never in
 * advance.
 */

const isProduction = process.env.NODE_ENV === 'production';

/* ---------------------------------------------------------------------------
 * Client — inlined into the browser bundle at build time. Never secret.
 * ------------------------------------------------------------------------ */

const clientSchema = z.object({
  /**
   * Absolute public origin, used for metadataBase, canonical URLs, sitemap
   * and Open Graph. Required in production; defaults to localhost in
   * development so a fresh clone runs with no .env file at all.
   */
  NEXT_PUBLIC_SITE_URL: z
    .url({ error: 'NEXT_PUBLIC_SITE_URL must be an absolute URL' })
    .refine((value) => !value.endsWith('/'), {
      error: 'NEXT_PUBLIC_SITE_URL must not have a trailing slash',
    }),

  /**
   * CDN origin for the public asset bucket, serving product photography.
   *
   * Optional. While it is unset, `lib/media` resolves every storage key to
   * `null` and the media primitives render their placeholder — which is the
   * honest state, rather than a broken image or an invented URL.
   *
   * **Either an absolute origin or a root-relative path.** A CDN bucket is an
   * origin (`https://cdn.example.com/assets`); a deployment that serves its own
   * public files is a path (`/assets`), which is what this project does until a
   * bucket exists. Allowing the path form is what let the storefront show
   * photography at all: it needs no infrastructure, and `next/image` optimises
   * a same-origin path without a `remotePatterns` entry, where an absolute
   * localhost URL would have needed one and would have been wrong in
   * production.
   */
  NEXT_PUBLIC_PUBLIC_ASSET_URL: z
    .string()
    .refine((value) => value.startsWith('/') || URL.canParse(value), {
      error:
        'NEXT_PUBLIC_PUBLIC_ASSET_URL must be an absolute URL or a root-relative path',
    })
    .refine((value) => !value.endsWith('/'), {
      error: 'NEXT_PUBLIC_PUBLIC_ASSET_URL must not have a trailing slash',
    })
    .optional(),
});

/**
 * Next.js only inlines `process.env.X` when X is written out literally, so
 * this object cannot be built dynamically.
 */
const rawClientEnv = {
  NEXT_PUBLIC_SITE_URL:
    process.env.NEXT_PUBLIC_SITE_URL ??
    (isProduction ? undefined : 'http://localhost:3000'),
  NEXT_PUBLIC_PUBLIC_ASSET_URL: process.env.NEXT_PUBLIC_PUBLIC_ASSET_URL,
};

/* ---------------------------------------------------------------------------
 * Server — never sent to the browser.
 * ------------------------------------------------------------------------ */

const postgresUrl = z
  .string()
  .min(1)
  .refine((value) => /^postgres(ql)?:\/\//.test(value), {
    error: 'must be a postgresql:// connection string',
  });

const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /**
   * Pooled connection, used by the running application. Serverless instances
   * scale out and Postgres allows only a few hundred connections, so this must
   * point at the provider's pooler in production.
   * See docs/ARCHITECTURE.md section 18.
   */
  DATABASE_URL: postgresUrl,

  /**
   * Unpooled connection, used only by `prisma migrate`. Migrations need
   * session-level features a transaction-mode pooler does not support.
   */
  DIRECT_URL: postgresUrl,

  /** Connections per application instance. One is correct for serverless. */
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(1),

  /**
   * Better Auth signing secret. Signs the email-verification JWT and the
   * cookie signatures, so rotating it invalidates outstanding verification
   * links and signed cookies (docs/SECURITY.md section 2).
   *
   * 32 bytes minimum, from a CSPRNG: `openssl rand -base64 32`. There is no
   * default in any environment — a development fallback would eventually be
   * deployed by accident, and a guessable secret here forges verification
   * tokens for any address.
   */
  BETTER_AUTH_SECRET: z.string().min(32, {
    error:
      'BETTER_AUTH_SECRET must be at least 32 characters. Generate one with: openssl rand -base64 32',
  }),

  /**
   * Absolute origin Better Auth builds its callback URLs from. Falls back to
   * the public site URL, which is the same origin in every environment this
   * project deploys to.
   */
  BETTER_AUTH_URL: z.url().optional(),

  /* -------------------------------------------------------------------------
   * Object storage (ADR-009). S3-compatible; Cloudflare R2 in production.
   *
   * All four are optional *here* and required *together* in production: the
   * schema cannot express "all or none", and a half-configured bucket must
   * fail with a sentence a person can act on rather than with a Zod issue
   * list. `lib/storage` makes that check and throws with the missing names.
   *
   * None of them is NEXT_PUBLIC_. A storage credential in the browser bundle
   * is a public bucket with extra steps.
   * ---------------------------------------------------------------------- */

  /** The S3 API endpoint. For R2: `https://<account>.r2.cloudflarestorage.com`. */
  S3_ENDPOINT: z.url().optional(),

  /** R2 ignores the region but the S3 protocol requires one; `auto` is theirs. */
  S3_REGION: z.string().min(1).default('auto'),

  /** The **private** bucket. Public access blocked at the bucket, not by ACL. */
  S3_BUCKET_PRIVATE: z.string().min(1).optional(),

  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),

  /**
   * Where the development and test adapter keeps its objects. Defaults to a
   * directory under the system temp folder, so a fresh clone needs no setup.
   * Never used when a bucket is configured, and never in production.
   */
  STORAGE_LOCAL_ROOT: z.string().min(1).optional(),

  /* -------------------------------------------------------------------------
   * Transactional email (Phase 8A)
   *
   * All optional, and for the same reason as the storage credentials: a build
   * runs without a mailbox, and the development transport is chosen by their
   * absence rather than by `NODE_ENV`. A deployment with no key sends nothing
   * and says so on every attempt, which is louder than a silent no-op.
   * ---------------------------------------------------------------------- */

  /** The Resend API key. Its presence is what selects the real transport. */
  RESEND_API_KEY: z.string().min(1).optional(),

  /**
   * Force the console transport, whatever else is configured.
   *
   * For the end-to-end suite, which invents `@example.invalid` addresses and
   * would otherwise send to them from a live account once a provider is set up
   * — dozens of real messages a run, all refused, and the outbox assertions
   * reading FAILED where they had always read SENT.
   *
   * It cannot be done by unsetting `RESEND_API_KEY` for the test server: Next
   * reads `.env.local` itself at start-up and puts the variable straight back.
   * An explicit override is the only lever that survives that.
   */
  EMAIL_TRANSPORT: z.enum(['auto', 'console']).optional(),

  /** The envelope sender, e.g. `Bizeora <commandes@example.dz>`. */
  EMAIL_FROM: z.string().min(1).optional(),

  /**
   * The workshop's address, as a **bootstrap fallback**.
   *
   * `ARCHITECTURE.md` section 11 resolves staff recipients from the
   * `notifications` settings group, which is where the owner changes them
   * without a deploy. This exists so a fresh deployment notifies somebody
   * before anyone has opened the admin, and is ignored once the setting is
   * filled in.
   */
  ADMIN_NOTIFICATION_EMAIL: z.string().min(1).optional(),

  /**
   * Whether search engines may index this deployment.
   *
   * Off unless it is explicitly turned on, which is the safe direction: a
   * staging copy or a preview deployment that quietly enters the index competes
   * with the real site for its own product pages, and getting it out again is
   * slow. `ROADMAP.md` opens indexing at launch (Phase 18), and this is the
   * switch that does it — one variable rather than an edit to a component.
   *
   * It is **not** an access control. `robots.txt` and a `noindex` are requests
   * a well-behaved crawler honours; authorisation is `server/auth/guards`
   * (`SECURITY.md` section 3), and every private route is guarded there
   * regardless of what this says.
   */
  SEO_INDEXABLE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),

  /**
   * The shared secret the scheduler presents to `/api/jobs/notifications`.
   *
   * Without it the endpoint refuses outright rather than running
   * unauthenticated: an open route that flushes the outbox is a way to make the
   * workshop e-mail itself. Long enough that guessing is not a strategy.
   */
  JOBS_SECRET: z.string().min(24).optional(),
});

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
}

function parseOrExit<T extends z.ZodType>(
  schema: T,
  value: unknown,
  label: string,
): z.infer<T> {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new Error(
      `Invalid ${label} environment configuration:\n${formatIssues(result.error)}\n\n` +
        'See .env.example for the expected values.',
    );
  }

  return result.data;
}

export const clientEnv = parseOrExit(clientSchema, rawClientEnv, 'client');

/**
 * Every server variable the schema declares, read by the name it declares.
 *
 * Derived from the schema rather than hand-listed, because a hand-written list
 * silently goes stale: a variable declared above but missing from the list
 * parses as `undefined` however carefully it was set in the environment, and an
 * optional one then merely looks unconfigured. That is exactly what happened to
 * `S3_*`, `STORAGE_LOCAL_ROOT` and the e-mail variables — the schema knew about
 * them and the parse never saw them.
 *
 * Not `process.env` wholesale, either: reading only the declared names keeps an
 * unrelated variable that happens to share one out of the configuration, and
 * keeps the schema the single list of what this application reads.
 *
 * Dynamic access is safe here because these are **server** variables. The
 * literal-name rule above applies to `NEXT_PUBLIC_*`, which the build inlines;
 * server code keeps a real `process.env` at runtime.
 */
const rawServerEnv = Object.fromEntries(
  Object.keys(serverSchema.shape).map((name) => [name, process.env[name]]),
);

const parsedServerEnv = parseOrExit(serverSchema, rawServerEnv, 'server');

/**
 * Server-only configuration.
 *
 * Guarded by a Proxy rather than by convention: reading any property in the
 * browser throws immediately, so a server variable cannot leak into a client
 * component by accident during a refactor.
 */
export const serverEnv = new Proxy(parsedServerEnv, {
  get(target, property) {
    if (typeof window !== 'undefined') {
      throw new Error(
        `serverEnv.${String(property)} was read in the browser. ` +
          'Server environment variables must never reach client code — ' +
          'use clientEnv for values that are safe to expose.',
      );
    }

    return Reflect.get(target, property);
  },
});

export const isDevelopment = parsedServerEnv.NODE_ENV === 'development';
export const isTest = parsedServerEnv.NODE_ENV === 'test';
export const isProd = parsedServerEnv.NODE_ENV === 'production';
