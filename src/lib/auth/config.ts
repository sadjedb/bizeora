import 'server-only';

import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { nextCookies } from 'better-auth/next-js';
import { emailOTP } from 'better-auth/plugins';

import { clientEnv, isProd, serverEnv } from '@/lib/env';
import { prisma } from '@/lib/db/client';
import { sendPasswordReset, sendVerificationCode } from '@/lib/email';
import { hashPassword, verifyPassword } from '@/lib/auth/password';

/**
 * The Better Auth instance. This file, and only this file, constructs it.
 *
 * Boundary (ADR-006, docs/ARCHITECTURE.md section 7): Better Auth owns
 * authentication — credentials, sessions, verification, reset. It owns no
 * authorisation. Its admin and permission plugins are unused, `users.role` is
 * our column, and no Better Auth type is exported from `lib/auth/`. Callers get
 * an `Actor` from `./session`.
 *
 * Persistence exception, stated openly: `ARCHITECTURE.md` section 6 confines
 * Prisma to `server/repositories/`. The Better Auth Prisma adapter is the
 * repository for the four auth tables, so it holds the client here. It reaches
 * `users`, `sessions`, `accounts` and `verification` and nothing else; no
 * business table is queried from this directory.
 */

const THIRTY_DAYS_IN_SECONDS = 60 * 60 * 24 * 30;
const SEVEN_DAYS_IN_SECONDS = 60 * 60 * 24 * 7;
const ONE_DAY_IN_SECONDS = 60 * 60 * 24;
const ONE_HOUR_IN_SECONDS = 60 * 60;
const FIFTEEN_MINUTES_IN_SECONDS = 15 * 60;

/**
 * Absolute session lifetime by role (docs/SECURITY.md section 2).
 * Staff and admin sessions are shorter because an admin session is the most
 * valuable credential in the system.
 */
export const SESSION_LIFETIME_SECONDS = {
  CUSTOMER: THIRTY_DAYS_IN_SECONDS,
  STAFF: SEVEN_DAYS_IN_SECONDS,
  ADMIN: SEVEN_DAYS_IN_SECONDS,
} as const;

export const auth = betterAuth({
  appName: 'Bizeora',
  baseURL: serverEnv.BETTER_AUTH_URL ?? clientEnv.NEXT_PUBLIC_SITE_URL,
  secret: serverEnv.BETTER_AUTH_SECRET,

  database: prismaAdapter(prisma, {
    provider: 'postgresql',
    // Multi-statement operations (create user + credential account) commit or
    // roll back together, so a failed sign-up cannot leave a user with no
    // credential row.
    transaction: true,
  }),

  advanced: {
    database: {
      // Our primary keys are `uuidv7()` DEFAULTs on `uuid` columns. `false`
      // makes Better Auth omit `id` from every insert so PostgreSQL generates
      // it — verified against the installed adapter factory, where this path
      // returns `undefined` for the id default rather than a random string.
      // Any other setting writes a 32-character base62 string into a `uuid`
      // column and fails at insert time.
      generateId: false,
    },
    cookiePrefix: 'stitch',
    // Derived from the origin by default; pinned so a proxied HTTPS
    // deployment cannot end up issuing a cookie without `Secure`.
    useSecureCookies: isProd,
  },

  emailAndPassword: {
    enabled: true,
    // docs/SECURITY.md section 2: minimum 10 characters, no composition rules.
    minPasswordLength: 10,
    maxPasswordLength: 256,
    /**
     * Verification gates commitment, not browsing: a customer may sign in and
     * look around unverified, and must be verified before accepting a quote.
     * That check belongs to `domain/permissions.requiresEmailVerification`,
     * not to the login endpoint.
     */
    requireEmailVerification: false,
    autoSignIn: false,
    // A reset means "someone may have had my password". Ending every other
    // session is the point of the exercise.
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: ONE_HOUR_IN_SECONDS,

    // Argon2id, replacing Better Auth's default scrypt. Supported override.
    password: {
      hash: hashPassword,
      verify: verifyPassword,
    },

    sendResetPassword: async ({ user, url }) => {
      await sendPasswordReset({ to: user.email, url });
    },
  },

  /**
   * Email verification is a one-time code, not a link. See ADR-021.
   *
   * There is deliberately **no `sendVerificationEmail` here**. The `emailOTP`
   * plugin below supplies one through its `init`, and plugin options are merged
   * with `defu(userOptions, pluginOptions)` — which gives the user's value
   * precedence. Defining one here would therefore silently win, restore the
   * replayable JWT link, and leave `overrideDefaultEmailVerification` doing
   * nothing at all. A test asserts that sign-up produces a code and no link.
   */
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: false,
  },

  /**
   * Reset tokens are hashed at rest.
   *
   * A reset token lives in `verification.identifier` as `reset-password:<token>`,
   * and `storeIdentifier: "hashed"` is Better Auth's own supported option: it
   * SHA-256s the identifier on write and on lookup. This is the supported
   * mechanism ADR-006 said it would adopt if one existed, so ADR-020 amends the
   * Phase 2.3 position for verification rows. Session tokens are a separate
   * question and remain stored as issued, as decided.
   */
  verification: {
    storeIdentifier: 'hashed',
  },

  session: {
    // The customer default. Staff and admin are clamped below and again in
    // `./session`.
    expiresIn: THIRTY_DAYS_IN_SECONDS,
    updateAge: ONE_DAY_IN_SECONDS,
  },

  user: {
    /**
     * Read-only projections of our own columns onto the session's user object,
     * so `getCurrentActor` builds an `Actor` without a second query.
     * `input: false` keeps them out of every request body: a client must never
     * be able to post itself a role.
     */
    additionalFields: {
      role: { type: 'string', required: false, input: false },
      status: { type: 'string', required: false, input: false },
    },
  },

  databaseHooks: {
    session: {
      create: {
        /**
         * Clamp a staff or admin session to seven days at creation.
         *
         * Better Auth has one global `expiresIn`, so the role-dependent
         * lifetime is applied here. Note the limit of this hook on its own:
         * the rolling refresh in `/get-session` rewrites `expiresAt` from the
         * global `expiresIn`, which would quietly restore 30 days. The
         * absolute cap in `./session` is what actually holds the line, and
         * this hook keeps the stored row honest in the meantime.
         */
        async before(session) {
          const user = await prisma.user.findUnique({
            where: { id: session.userId },
            select: { role: true },
          });

          if (!user || user.role === 'CUSTOMER') return;

          return {
            data: {
              ...session,
              expiresAt: new Date(
                Date.now() + SESSION_LIFETIME_SECONDS[user.role] * 1000,
              ),
            },
          };
        },
      },
    },
  },

  /**
   * Pinned rather than left to the default, which is also `warn`.
   *
   * Better Auth logs "Sign-up attempt for existing email: <address>" at `info`.
   * An email address is PII and `docs/SECURITY.md` section 10 keeps PII out of
   * logs, so the level is stated here explicitly: raising it to `info` or
   * `debug` for troubleshooting starts writing customer addresses to the log,
   * and that should be a deliberate act rather than a default nobody checked.
   */
  logger: { level: 'warn' },

  plugins: [
    /**
     * Email verification by one-time code (ADR-021).
     *
     * Better Auth's default verification link is a stateless HS256 JWT: nothing
     * is stored, so nothing can be consumed, and the link is replayable for its
     * whole lifetime. `overrideDefaultEmailVerification` is the library's own
     * switch for replacing it, and the OTP path is genuinely single-use —
     * `atomicVerifyOTP` consumes the row through `consumeVerificationValue`,
     * which deletes it in the same operation that reads it, and does not
     * recreate it on success. A replayed code finds nothing and is rejected.
     *
     * Only email verification uses this plugin. Sign-in stays email and
     * password, and password reset keeps its own supported flow.
     */
    emailOTP({
      // 8 digits rather than the default 6. The attempt limit is what really
      // stops guessing, but two extra digits cost the user nothing.
      otpLength: 8,
      // Long enough to survive slow email delivery, short enough to bound the
      // window. Replaces the 24 hours the JWT link used to allow.
      expiresIn: FIFTEEN_MINUTES_IN_SECONDS,
      // Three wrong codes and the identifier is locked out: the row is left
      // consumed rather than recreated, so a fourth attempt has nothing to
      // find. This, not the code length, is the anti-guessing control.
      allowedAttempts: 3,
      /**
       * Encrypted at rest, not hashed — the opposite of the reset token, on
       * purpose.
       *
       * A reset token has ~143 bits of entropy, so a SHA-256 digest of it is
       * irreversible in practice. An 8-digit code has ~27 bits: an attacker
       * holding the digest recovers the code by trying all 10^8 values, which
       * is milliseconds of work. Hashing a low-entropy credential looks like
       * protection and is not. Symmetric encryption under `BETTER_AUTH_SECRET`
       * is, because the secret lives in the secret store rather than the
       * database, so database read access alone does not yield the code.
       */
      storeOTP: 'encrypted',
      // Replaces the JWT link everywhere, including the sign-up email.
      overrideDefaultEmailVerification: true,
      // Applies where Better Auth's rate limiting is active, which is
      // production by default. The attempt limit above is unconditional.
      rateLimit: { window: 60, max: 3 },

      sendVerificationOTP: async ({ email, otp, type }) => {
        // The plugin can also drive sign-in, password reset and email change.
        // None of those are enabled, so anything other than verification here
        // means a flow was turned on without a decision being taken.
        if (type !== 'email-verification') {
          throw new Error(`Unexpected email OTP type: ${type}`);
        }

        await sendVerificationCode({ to: email, otp });
      },
    }),

    // Lets sign-in and sign-out set their cookies from a server action.
    nextCookies(),
  ],
});
