/**
 * The actor: who is making a request, expressed in the project's own terms.
 *
 * This is the only identity type the domain, services and repositories ever
 * see. Better Auth's `User` and `Session` types stop at `lib/auth/`, which maps
 * them into an `Actor` (docs/ARCHITECTURE.md section 7, ADR-006). That mapping
 * is the whole reason authorisation is unit-testable without a session, a
 * database or the auth library — every function in `domain/permissions` takes
 * a plain object built by hand in a test.
 *
 * An actor answers "who is this". It deliberately answers nothing about what
 * they may do; that is `domain/permissions`.
 */

/** The three roles in BUSINESS-RULES.md section 12.1. Not hierarchical. */
export type Role = 'CUSTOMER' | 'STAFF' | 'ADMIN';

/** Nobody is signed in. Guests are anonymous actors, never Better Auth users. */
export type AnonymousActor = {
  readonly kind: 'anonymous';
};

/** A signed-in user, reduced to what a permission decision can depend on. */
export type AuthenticatedActor = {
  readonly kind: 'authenticated';
  readonly userId: string;
  readonly role: Role;
  readonly emailVerified: boolean;
  /** `ACTIVE` users may act; anything else is refused at the wrapper. */
  readonly status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
};

export type Actor = AnonymousActor | AuthenticatedActor;

export const anonymousActor: AnonymousActor = { kind: 'anonymous' };

export function isAuthenticated(actor: Actor): actor is AuthenticatedActor {
  return actor.kind === 'authenticated';
}

/**
 * An actor who is signed in, active, and therefore allowed to be considered
 * for a permission decision at all. A suspended account is not "a customer
 * with fewer permissions"; it is refused before permissions are consulted.
 */
export function isActive(actor: Actor): actor is AuthenticatedActor {
  return isAuthenticated(actor) && actor.status === 'ACTIVE';
}
