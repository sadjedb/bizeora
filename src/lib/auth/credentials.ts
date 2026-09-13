import 'server-only';

import { headers } from 'next/headers';

import { auth } from '@/lib/auth/config';

/**
 * Sign in, sign up, sign out — the three credential operations, wrapped.
 *
 * Same boundary as the rest of this directory (ADR-006): Better Auth's types,
 * its `APIError` and its response shapes stop here. A caller gets a plain
 * discriminated union and never learns which library issued the cookie.
 *
 * These are callable **only from a server action or route handler**, because
 * setting the session cookie is what they are for and only those may write one.
 * The `nextCookies()` plugin in `./config` is what carries the header across.
 */

export type CredentialResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'INVALID_CREDENTIALS' | 'EMAIL_TAKEN' | 'WEAK_PASSWORD' | 'FAILED';
    };

function statusOf(error: unknown): number | null {
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === 'number' ? status : null;
}

function messageOf(error: unknown): string {
  const body = (error as { body?: { message?: unknown } } | null)?.body;
  return typeof body?.message === 'string' ? body.message : '';
}

/**
 * Sign in with an email address and a password.
 *
 * Every failure collapses to one reason on purpose. Distinguishing "no such
 * account" from "wrong password" turns the login form into an account-existence
 * oracle, which is the enumeration weakness `SECURITY.md` section 2 names.
 */
export async function signInWithPassword(input: {
  email: string;
  password: string;
}): Promise<CredentialResult> {
  try {
    await auth.api.signInEmail({
      body: { email: input.email, password: input.password },
      headers: await headers(),
    });

    return { ok: true };
  } catch (error) {
    const status = statusOf(error);
    if (status === 401 || status === 403 || status === 400) {
      return { ok: false, reason: 'INVALID_CREDENTIALS' };
    }
    return { ok: false, reason: 'FAILED' };
  }
}

/**
 * Create a customer account.
 *
 * `role` and `status` are `input: false` in the Better Auth configuration, so
 * neither can be supplied here or by a browser: every account created through
 * this path is a `CUSTOMER`, and a staff account is made by hand.
 *
 * `autoSignIn` is off, so this deliberately does not produce a session. The
 * caller signs in afterwards, which keeps one code path for "you are now
 * signed in" rather than two.
 */
export async function registerCustomer(input: {
  name: string;
  email: string;
  password: string;
}): Promise<CredentialResult> {
  try {
    await auth.api.signUpEmail({
      body: { name: input.name, email: input.email, password: input.password },
      headers: await headers(),
    });

    return { ok: true };
  } catch (error) {
    const message = messageOf(error).toLowerCase();

    if (message.includes('password')) return { ok: false, reason: 'WEAK_PASSWORD' };
    if (statusOf(error) === 422 || message.includes('exist')) {
      return { ok: false, reason: 'EMAIL_TAKEN' };
    }
    return { ok: false, reason: 'FAILED' };
  }
}

export async function signOutCurrentSession(): Promise<void> {
  try {
    await auth.api.signOut({ headers: await headers() });
  } catch {
    // Signing out an already-dead session is the outcome the caller wanted.
  }
}
