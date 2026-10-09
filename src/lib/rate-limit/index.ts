import 'server-only';

import { prisma } from '@/lib/db/client';
import { serverEnv } from '@/lib/env';
import {
  LIMITS,
  rateLimitKey,
  retryAfterSeconds,
  windowExpiry,
  withinLimit,
  type RateLimitSubject,
  type RateLimitedAction,
} from '@/domain/rate-limit';

/**
 * Counting attempts.
 *
 * The storage half of `domain/rate-limit`. The limits, the keys and the
 * arithmetic are there; this does one thing, atomically: increment the counter
 * for a window and say what it now holds.
 *
 * ## The adapter seam
 *
 * `SECURITY.md` section 9 specifies Upstash Redis with a Postgres fallback.
 * Postgres is what is implemented, because it is what this deployment has, and
 * a limiter that only exists in a service nobody has signed up for is not
 * enforcing anything. Every caller goes through `consume`, so Redis arrives one
 * day as a second implementation of this function rather than as a change at
 * thirty call sites.
 */

export type RateLimitVerdict =
  | { allowed: true }
  | {
      allowed: false;
      /** Whole seconds, for a `Retry-After` header or a message. */
      retryAfter: number;
      /** Which limit refused it, for the log. Never shown to the caller. */
      subject: RateLimitSubject;
    };

export type RateLimitSubjects = Partial<Record<RateLimitSubject, string | null>>;

/**
 * Record an attempt and decide whether it may proceed.
 *
 * **Counts first, asks afterwards.** Two simultaneous requests must not both
 * pass a limit of one, and the only way to guarantee that without a lock is to
 * let the database do the increment and compare the result it returns. The cost
 * is that a refused attempt still counts towards the window — which is correct:
 * an attacker's refused attempts are exactly what the limit is measuring.
 *
 * **Every limit for the action is checked**, and all of them are counted even
 * once one has refused. Stopping at the first refusal would leave the other
 * counters short and let an attacker who trips the cheap limit deliberately
 * avoid the expensive one.
 *
 * **A database failure allows the request.** That is a deliberate direction: a
 * limiter that cannot reach its store would otherwise take the shop down
 * entirely, and the thing it is protecting against is abuse rather than
 * catastrophe. It is logged so an outage is visible rather than silent.
 */
export async function consume(input: {
  action: RateLimitedAction;
  subjects: RateLimitSubjects;
  now?: Date;
}): Promise<RateLimitVerdict> {
  if (serverEnv.RATE_LIMIT === 'off') {
    warnOnce();
    return { allowed: true };
  }

  const now = input.now ?? new Date();
  const limits = LIMITS[input.action];

  let refusal: RateLimitVerdict | null = null;

  for (const limit of limits) {
    const subject = input.subjects[limit.subject];

    /*
     * A limit with no subject is skipped rather than counted under
     * `anonymous`. "Per user" on an endpoint a guest reached is not a limit
     * that failed; it is a limit that does not apply, and folding every guest
     * into one bucket would lock the shop's customers out of each other's
     * allowances.
     */
    if (subject === undefined) continue;

    const key = rateLimitKey({ action: input.action, limit, subject, at: now });
    const expiresAt = windowExpiry(now, limit.windowSeconds);

    try {
      const count = await increment(key, expiresAt);

      if (!withinLimit(count, limit) && refusal === null) {
        refusal = {
          allowed: false,
          retryAfter: retryAfterSeconds(now, expiresAt),
          subject: limit.subject,
        };
      }
    } catch (error) {
      // Fail open, loudly. See the note above.
      console.error('[rate-limit] counter unavailable', {
        action: input.action,
        subject: limit.subject,
        error: error instanceof Error ? error.message : 'unknown',
      });
    }
  }

  return refusal ?? { allowed: true };
}

/**
 * Say once, loudly, that nothing is being limited.
 *
 * A deployment with `RATE_LIMIT=off` has no protection on login, registration,
 * uploads or the guest order lookup. That is correct for the end-to-end suite
 * and catastrophic anywhere else, so it is stated in the log rather than left
 * to be discovered — once, because a line per request would bury it.
 */
let warned = false;

function warnOnce(): void {
  if (warned) return;
  warned = true;

  console.warn(
    '[rate-limit] RATE_LIMIT=off — every limit in SECURITY.md section 9 is disabled.',
  );
}

/**
 * Add one to a window's counter and return the new value.
 *
 * One statement, and it has to be: `INSERT … ON CONFLICT DO UPDATE` is atomic,
 * so two requests arriving together get 1 and 2 rather than both getting 1.
 * Raw SQL because Prisma's `upsert` is a read followed by a write, which is
 * precisely the race this avoids.
 */
async function increment(key: string, expiresAt: Date): Promise<number> {
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "rate_limits" ("key", "count", "expires_at")
    VALUES (${key}, 1, ${expiresAt})
    ON CONFLICT ("key")
    DO UPDATE SET "count" = "rate_limits"."count" + 1
    RETURNING "count"
  `;

  return rows[0]?.count ?? 1;
}

/**
 * Delete windows that have closed.
 *
 * Called by the notification dispatcher rather than by a scheduler of its own:
 * the table is small, the rows are dead the moment their window ends, and
 * adding a second cron entry for a delete that takes milliseconds is more
 * moving parts than the problem deserves.
 */
export async function sweepRateLimits(now: Date = new Date()): Promise<number> {
  const result = await prisma.rateLimit.deleteMany({
    where: { expiresAt: { lt: now } },
  });

  return result.count;
}
