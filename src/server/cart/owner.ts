import 'server-only';

import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';

import { getCurrentActor } from '@/lib/auth';
import { isProd } from '@/lib/env';
import { isActive } from '@/domain/auth/actor';
import type { CartOwner } from '@/server/repositories/cart-repository';

/**
 * Who owns the cart in front of us.
 *
 * `DATABASE.md` section 7: a cart carries **exactly one** of `userId` and
 * `anonymousToken`, enforced by a check constraint. There is no second
 * ownership model and no "guest user" row — a guest cart is the same table with
 * the other column filled in, exactly as a guest order is an `orders` row with
 * a null `userId` (section 15).
 *
 * The anonymous token lives in an `HttpOnly` cookie, so a browser can present
 * it and no script can read it. It is a bearer token for a shopping list: it
 * grants nothing but the cart it names, which is why a 24-byte random value is
 * enough and why it is never reused as an order token.
 */

export const CART_COOKIE = 'stitch_cart';

/** Long enough that a cart survives a few days of hesitation. */
const CART_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

async function currentUserId(): Promise<string | null> {
  const actor = await getCurrentActor();
  return isActive(actor) ? actor.userId : null;
}

/**
 * The owner for a **read**, or null when this visitor has no cart yet.
 *
 * Never writes a cookie: a server component cannot, and issuing an identifier
 * to someone who has only looked at a page would create an empty cart row for
 * every crawler that visits.
 */
export async function readCartOwner(): Promise<CartOwner | null> {
  const userId = await currentUserId();
  if (userId) return { kind: 'user', userId };

  const token = (await cookies()).get(CART_COOKIE)?.value;
  return token ? { kind: 'guest', anonymousToken: token } : null;
}

/**
 * The owner for a **write**, issuing a guest token if there is none.
 *
 * Only callable from a server action or route handler, because only those may
 * set a cookie. That restriction is the reason this is a separate function
 * rather than a flag on the one above.
 */
export async function ensureCartOwner(): Promise<CartOwner> {
  const userId = await currentUserId();
  if (userId) return { kind: 'user', userId };

  const jar = await cookies();
  const existing = jar.get(CART_COOKIE)?.value;
  if (existing) return { kind: 'guest', anonymousToken: existing };

  const token = randomBytes(24).toString('base64url');

  jar.set(CART_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
    maxAge: CART_COOKIE_MAX_AGE_SECONDS,
  });

  return { kind: 'guest', anonymousToken: token };
}

/** Called after checkout: the cart is converted, so the token is spent. */
export async function clearGuestCartCookie(): Promise<void> {
  (await cookies()).delete(CART_COOKIE);
}
