/**
 * The counter, against the real database.
 *
 * The unit tests prove the rules; this proves the **atomicity**, which is the
 * only property of a rate limiter that cannot be tested without a database. A
 * limiter that reads a count and then writes count + 1 lets two simultaneous
 * requests both pass a limit of one, and the failure is invisible under any
 * test that sends requests one at a time.
 *
 * Runs against the development database and cleans up after itself: the keys
 * are prefixed with a timestamp, so a failed run leaves rows that expire rather
 * than rows that break the next one.
 */

import { randomUUID } from 'node:crypto';

import dotenv from 'dotenv';
import { afterAll, describe, expect, it } from 'vitest';

dotenv.config({ path: ['.env.local', '.env'], quiet: true });

const { consume, sweepRateLimits } = await import('../../src/lib/rate-limit');
const { prisma } = await import('../../src/lib/db/client');

/** A subject nothing else in the suite can collide with. */
function subject(): string {
  return `e2e-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

afterAll(async () => {
  await prisma.rateLimit.deleteMany({ where: { key: { contains: 'e2e-' } } });
  await prisma.$disconnect();
});

describe('counting attempts', () => {
  it('allows up to the limit and refuses the next one', async () => {
    const ip = subject();

    // Registration is three an hour per address (`SECURITY.md` section 9).
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const verdict = await consume({ action: 'register', subjects: { ip } });
      expect(verdict.allowed, `attempt ${attempt}`).toBe(true);
    }

    const fourth = await consume({ action: 'register', subjects: { ip } });

    expect(fourth.allowed).toBe(false);
    if (fourth.allowed) return;

    expect(fourth.subject).toBe('ip');
    expect(fourth.retryAfter).toBeGreaterThan(0);
    expect(fourth.retryAfter).toBeLessThanOrEqual(3600);
  });

  /*
   * The property the database is here for. Ten requests arriving together
   * against a limit of three must produce exactly three allowances — not ten,
   * which is what a read-then-write gives under concurrency.
   */
  it('cannot be beaten by simultaneous attempts', async () => {
    const ip = subject();

    const verdicts = await Promise.all(
      Array.from({ length: 10 }, () => consume({ action: 'register', subjects: { ip } })),
    );

    expect(verdicts.filter((verdict) => verdict.allowed)).toHaveLength(3);
  });

  it('keeps two subjects of the same action apart', async () => {
    const first = subject();
    const second = subject();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await consume({ action: 'register', subjects: { ip: first } });
    }

    expect((await consume({ action: 'register', subjects: { ip: first } })).allowed).toBe(
      false,
    );

    // The second address has spent nothing.
    expect(
      (await consume({ action: 'register', subjects: { ip: second } })).allowed,
    ).toBe(true);
  });

  it('keeps two actions with the same subject apart', async () => {
    const ip = subject();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await consume({ action: 'register', subjects: { ip } });
    }

    expect((await consume({ action: 'register', subjects: { ip } })).allowed).toBe(false);

    // Guest lookup has its own five, keyed by the same address.
    expect(
      (await consume({ action: 'guestOrderLookup', subjects: { ip } })).allowed,
    ).toBe(true);
  });

  /*
   * "Per user" on an endpoint a guest reached is a limit that does not apply,
   * not a limit that failed. Folding every guest into one `anonymous` bucket
   * would let the first of them exhaust the allowance for all of them.
   */
  it('skips a limit whose subject is not supplied', async () => {
    const ip = subject();

    // `submitRequest` is keyed by user only. With no user, nothing is counted.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const verdict = await consume({ action: 'submitRequest', subjects: { ip } });
      expect(verdict.allowed).toBe(true);
    }
  });

  it('counts both limits of an action that has two', async () => {
    const identifier = subject();
    const ip = subject();

    // Login is 5 per identifier and 20 per address; the identifier gives first.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await consume({ action: 'login', subjects: { identifier, ip } });
    }

    const sixth = await consume({ action: 'login', subjects: { identifier, ip } });

    expect(sixth.allowed).toBe(false);
    if (!sixth.allowed) expect(sixth.subject).toBe('identifier');
  });

  it('records a refused attempt, so refusals cannot be spent for free', async () => {
    const ip = subject();

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await consume({ action: 'register', subjects: { ip } });
    }

    const rows = await prisma.rateLimit.findMany({
      where: { key: { contains: ip } },
      select: { count: true },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.count).toBe(6);
  });
});

describe('sweeping', () => {
  it('deletes windows that have closed and keeps the ones that have not', async () => {
    const ip = subject();
    await consume({ action: 'register', subjects: { ip } });

    // An hour from now nothing has expired yet.
    expect(await prisma.rateLimit.count({ where: { key: { contains: ip } } })).toBe(1);
    await sweepRateLimits(new Date());
    expect(await prisma.rateLimit.count({ where: { key: { contains: ip } } })).toBe(1);

    // Two hours on, the window is long closed.
    await sweepRateLimits(new Date(Date.now() + 2 * 60 * 60 * 1000));
    expect(await prisma.rateLimit.count({ where: { key: { contains: ip } } })).toBe(0);
  });
});
