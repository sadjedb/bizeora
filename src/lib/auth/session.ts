import 'server-only';

import { cache } from 'react';
import { headers } from 'next/headers';

import { anonymousActor, type Actor, type Role } from '@/domain/auth/actor';
import { prisma } from '@/lib/db/client';
import { auth, SESSION_LIFETIME_SECONDS } from '@/lib/auth/config';

/**
 * Reading the current actor.
 *
 * This is the seam. Application code asks this module who the caller is and
 * receives an `Actor` — our type, defined in `domain/auth`. Better Auth's
 * `User` and `Session` types do not leave this file, so replacing the provider
 * means rewriting this directory and nothing else (ADR-006).
 *
 * Nothing here decides what the actor may do. That is `domain/permissions`,
 * which is pure and takes the `Actor` this module returns.
 */

const ROLES: readonly string[] = ['CUSTOMER', 'STAFF', 'ADMIN'];
const STATUSES: readonly string[] = ['ACTIVE', 'SUSPENDED', 'DELETED'];

function toRole(value: unknown): Role {
  // The column is a database enum, so an unexpected value means the row was
  // written outside the application. Fail closed to the least privilege.
  return typeof value === 'string' && ROLES.includes(value)
    ? (value as Role)
    : 'CUSTOMER';
}

function toStatus(value: unknown): 'ACTIVE' | 'SUSPENDED' | 'DELETED' {
  return typeof value === 'string' && STATUSES.includes(value)
    ? (value as 'ACTIVE' | 'SUSPENDED' | 'DELETED')
    : 'SUSPENDED';
}

/**
 * Absolute lifetime enforcement.
 *
 * Better Auth's rolling refresh rewrites `expiresAt` from the single global
 * `expiresIn`, so a staff or admin session would drift back to the customer's
 * 30 days on its first refresh. The session's `createdAt` cannot drift, so the
 * cap is measured from there: past the role's lifetime the row is deleted and
 * the caller is anonymous from that request onward.
 *
 * Deleting rather than merely refusing keeps a single meaning for "the session
 * row exists" and preserves instant revocation as the one mechanism
 * (docs/SECURITY.md section 2.1).
 */
function hasOutlivedRoleLimit(role: Role, createdAt: Date): boolean {
  const ageInSeconds = (Date.now() - createdAt.getTime()) / 1000;
  return ageInSeconds > SESSION_LIFETIME_SECONDS[role];
}

/**
 * The current actor, or the anonymous actor.
 *
 * Memoised per request with React's `cache`, so several server components and
 * a server action in the same render share one session lookup rather than one
 * each — the mitigation ADR-006 names for database-backed sessions.
 */
export const getCurrentActor = cache(async (): Promise<Actor> => {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) return anonymousActor;

  const role = toRole((session.user as { role?: unknown }).role);
  const status = toStatus((session.user as { status?: unknown }).status);

  if (hasOutlivedRoleLimit(role, new Date(session.session.createdAt))) {
    await prisma.session.deleteMany({ where: { token: session.session.token } });
    return anonymousActor;
  }

  return {
    kind: 'authenticated',
    userId: session.user.id,
    role,
    emailVerified: session.user.emailVerified,
    status,
  };
});

/**
 * Revoke every session belonging to a user, immediately.
 *
 * The first step of incident response (docs/SECURITY.md section 15) and the
 * reason sessions are rows rather than JWTs: deletion takes effect on the very
 * next request, everywhere.
 */
export async function revokeAllSessionsForUser(userId: string): Promise<number> {
  const { count } = await prisma.session.deleteMany({ where: { userId } });
  return count;
}
