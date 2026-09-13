import 'server-only';

import { getCurrentActor } from '@/lib/auth';
import { isActive, type AuthenticatedActor } from '@/domain/auth/actor';
import { isCustomer, isStaff } from '@/domain/permissions';

/**
 * The action wrappers.
 *
 * `ARCHITECTURE.md` section 8 calls for admin functions that "require an admin
 * actor type, which only the admin action wrapper can construct". This is that
 * wrapper, and it is the only place in the application where a role is turned
 * into permission to proceed.
 *
 * The decision itself is not made here — it is made by `domain/permissions`,
 * over a plain `Actor`, which is what keeps authorisation unit-testable without
 * a session, a database or the auth library (ADR-006, 12.2). This module only does
 * the plumbing: read the actor, ask the domain, return a typed refusal.
 *
 * Nothing checks a role inline in a component. If a page needs to know, it asks
 * one of these.
 */

export type Denied = { ok: false; reason: 'UNAUTHENTICATED' | 'FORBIDDEN' };
export type Granted<T> = { ok: true; actor: T };
export type Authorisation<T> = Granted<T> | Denied;

/**
 * Staff or admin.
 *
 * 12.1: roles are not hierarchical, so this is an explicit two-role check
 * rather than a rank comparison. Creating and sending quotes is a staff
 * capability; managing settings and users is admin-only and is not this phase.
 */
export async function requireStaff(): Promise<Authorisation<AuthenticatedActor>> {
  const actor = await getCurrentActor();

  if (!isActive(actor)) return { ok: false, reason: 'UNAUTHENTICATED' };
  if (!isStaff(actor)) return { ok: false, reason: 'FORBIDDEN' };

  return { ok: true, actor };
}

/**
 * A signed-in customer, acting for themselves.
 *
 * 12.3 gives quote acceptance to the customer and to nobody else — an admin
 * accepting on their behalf would destroy the meaning of acceptance — so this
 * refuses staff rather than treating them as a superset.
 */
export async function requireCustomer(): Promise<Authorisation<AuthenticatedActor>> {
  const actor = await getCurrentActor();

  if (!isActive(actor)) return { ok: false, reason: 'UNAUTHENTICATED' };
  if (!isCustomer(actor)) return { ok: false, reason: 'FORBIDDEN' };

  return { ok: true, actor };
}

/** Any active signed-in user, whatever their role. */
export async function requireSignedIn(): Promise<Authorisation<AuthenticatedActor>> {
  const actor = await getCurrentActor();
  if (!isActive(actor)) return { ok: false, reason: 'UNAUTHENTICATED' };

  return { ok: true, actor };
}
