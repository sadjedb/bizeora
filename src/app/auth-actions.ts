'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { registerCustomer, signInWithPassword, signOutCurrentSession } from '@/lib/auth';
import { throttle } from '@/server/security/throttle';

/**
 * Sign in, sign up, sign out.
 *
 * Phase 10 is the first phase that needs them: only a signed-in customer may
 * accept a quote (7.5, 12.3), and only staff may price one. Phase 3 built the
 * whole authentication stack and no screen for it; this is the smallest screen
 * that makes the quote journey reachable, not the account area — that is
 * Phase 11.
 *
 * The payload carries a name, an address and a password. It carries **no role
 * and no status**: both are `input: false` in the Better Auth configuration, so
 * a browser asking for `role: 'ADMIN'` is asking for a field that does not
 * exist on the endpoint.
 */

const REDIRECT_PATH = /^\/(?!\/)[A-Za-z0-9\-._~!$&'()*+,;=:@%/]*$/;

/**
 * Where to go after signing in.
 *
 * Only a path on this site, never a URL. An open redirect on a login form is
 * how a phishing page borrows a real domain's credibility, and the rule is
 * cheap: it must start with a single `/`.
 */
function safeRedirect(value: string | null | undefined): string {
  if (!value || !REDIRECT_PATH.test(value)) return '/account';
  return value;
}

const signInSchema = z.object({
  email: z.email().max(255),
  password: z.string().min(1).max(256),
  redirectTo: z.string().max(500).nullable().default(null),
});

const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email().max(255),
  // The minimum is Better Auth's, from `SECURITY.md` section 2: ten
  // characters, no composition rules.
  password: z.string().min(10).max(256),
  redirectTo: z.string().max(500).nullable().default(null),
});

export type AuthActionResult = { ok: false; message: string };

const MESSAGES = {
  INVALID_CREDENTIALS: 'Adresse e-mail ou mot de passe incorrect.',
  EMAIL_TAKEN: 'Impossible de créer ce compte. Si vous en avez déjà un, connectez-vous.',
  WEAK_PASSWORD: 'Le mot de passe doit contenir au moins 10 caractères.',
  FAILED: 'La connexion a échoué. Réessayez dans un instant.',
  INVALID_INPUT: 'Vérifiez les informations saisies.',
} as const;

export async function signInAction(raw: unknown): Promise<AuthActionResult> {
  const parsed = signInSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: MESSAGES.INVALID_INPUT };

  /*
   * Counted before the password is checked, and counted per address **and**
   * per typed identifier (`SECURITY.md` section 9). Either alone is escapable:
   * an attacker rotating e-mail addresses defeats the identifier limit, and an
   * office behind one connection is punished by the address limit.
   *
   * The refusal says nothing about how many attempts remain and nothing about
   * whether the account exists — the same sentence a wrong password gets, for
   * the same reason.
   */
  const allowed = await throttle({
    action: 'login',
    identifier: parsed.data.email,
  });

  if (!allowed.ok) return { ok: false, message: allowed.message };

  const result = await signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (!result.ok) return { ok: false, message: MESSAGES[result.reason] };

  redirect(safeRedirect(parsed.data.redirectTo));
}

export async function registerAction(raw: unknown): Promise<AuthActionResult> {
  const parsed = registerSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: MESSAGES.INVALID_INPUT };

  // Per address only: there is no identifier to count against yet, and
  // three accounts an hour from one connection is generous for a real
  // household and useless for a spammer.
  const allowed = await throttle({ action: 'register' });
  if (!allowed.ok) return { ok: false, message: allowed.message };

  const created = await registerCustomer({
    name: parsed.data.name,
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (!created.ok) return { ok: false, message: MESSAGES[created.reason] };

  // `autoSignIn` is off, so the account exists and no session does. Signing in
  // here keeps one path for "you are now signed in" rather than two.
  const signedIn = await signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (!signedIn.ok) return { ok: false, message: MESSAGES.FAILED };

  redirect(safeRedirect(parsed.data.redirectTo));
}

export async function signOutAction(): Promise<void> {
  await signOutCurrentSession();
  redirect('/');
}
