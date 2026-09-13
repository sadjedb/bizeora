import 'server-only';

/**
 * The authentication boundary's public surface.
 *
 * Application code imports from here, never from `better-auth` directly. What
 * is deliberately absent is the point: no Better Auth type, no `Session`, no
 * `User`, no handler. Callers get an `Actor` and the two operations they
 * legitimately need (ADR-006).
 *
 * The route handler imports `auth` from `./config` directly, because mounting
 * the endpoints is the one job that genuinely needs the instance.
 */

export { getCurrentActor, revokeAllSessionsForUser } from '@/lib/auth/session';
export { SESSION_LIFETIME_SECONDS } from '@/lib/auth/config';
export { hashPassword, verifyPassword } from '@/lib/auth/password';
export {
  registerCustomer,
  signInWithPassword,
  signOutCurrentSession,
  type CredentialResult,
} from '@/lib/auth/credentials';
