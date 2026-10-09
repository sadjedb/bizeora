import 'server-only';

import { headers } from 'next/headers';

import { consume, type RateLimitSubjects } from '@/lib/rate-limit';
import type { RateLimitedAction } from '@/domain/rate-limit';

/**
 * The rate limiter, as a server action uses it.
 *
 * `lib/rate-limit` counts; this is the thin layer that knows how to find the
 * caller's address and what a refusal should say. It lives in `server/` for the
 * same reason the guards do: an action wants one line, and the line should not
 * be "work out which of nine proxy headers to trust".
 */

/**
 * The caller's address, as far as it can be known.
 *
 * `x-forwarded-for` is a list, appended to by each proxy, so the **first**
 * entry is the client and the rest are hops. It is also trivially forged by the
 * client when nothing in front of the application rewrites it — which is why a
 * per-IP limit is never the only limit on an endpoint that matters (`LIMITS`
 * pairs it with an identifier wherever it counts).
 *
 * Returns `null` rather than a placeholder when there is no address. A `null`
 * subject is skipped by `consume`; a placeholder would put every anonymous
 * caller in one bucket and let the first of them exhaust it for everyone.
 */
export async function callerAddress(): Promise<string | null> {
  const store = await headers();

  const forwarded = store.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }

  return store.get('x-real-ip')?.trim() || null;
}

export type ThrottleResult =
  { ok: true } | { ok: false; retryAfter: number; message: string };

/**
 * A generic refusal, with no numbers in it.
 *
 * `SECURITY.md` section 9: "Exceeding a limit returns a generic message and
 * `Retry-After`, never a count of remaining attempts." A message that says how
 * many tries are left is a message that tells an attacker how close they are,
 * and one that names which limit fired tells them which subject to rotate.
 */
const REFUSED = 'Trop de tentatives. Réessayez dans quelques minutes.';

/**
 * Count this attempt, and say whether it may proceed.
 *
 * The identifier is whatever the caller typed — an e-mail address, an order
 * number — and is **not** trusted to be anything: it is lower-cased, trimmed
 * and used only as a bucket name.
 */
export async function throttle(input: {
  action: RateLimitedAction;
  /** The signed-in account, when there is one. */
  userId?: string | null;
  /** What was typed, for the per-identifier limits. */
  identifier?: string | null;
}): Promise<ThrottleResult> {
  const subjects: RateLimitSubjects = { ip: await callerAddress() };

  if (input.userId !== undefined) subjects.user = input.userId;
  if (input.identifier !== undefined) subjects.identifier = input.identifier;

  const verdict = await consume({ action: input.action, subjects });
  if (verdict.allowed) return { ok: true };

  return { ok: false, retryAfter: verdict.retryAfter, message: REFUSED };
}
