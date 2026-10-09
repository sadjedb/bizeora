/**
 * How often a thing may be attempted, and by whom.
 *
 * `SECURITY.md` section 9 has carried a table of limits since Phase 0 with
 * nothing enforcing it. These are the rules as code: the key a limit counts
 * against, the arithmetic of a fixed window, and the two properties that decide
 * whether a limiter works at all.
 *
 * **The subject is the decision.** Keyed by address alone, an office behind one
 * connection locks itself out; keyed by identifier alone, an attacker with a
 * list of addresses is unlimited. Several endpoints are therefore limited
 * twice, and the tests below check that both keys are distinct and that neither
 * can be collapsed into the other by how somebody types.
 *
 * **Counting happens before asking.** `withinLimit` takes the count *after* the
 * attempt was recorded, which is what makes two simultaneous requests unable to
 * both pass a limit of one.
 */

import { describe, expect, it } from 'vitest';

import {
  LIMITS,
  RATE_LIMITED_ACTIONS,
  rateLimitKey,
  retryAfterSeconds,
  windowExpiry,
  windowStart,
  withinLimit,
  type RateLimit,
} from '../../src/domain/rate-limit';

const AT = new Date('2026-09-22T14:07:33.000Z');
const LOGIN: RateLimit = { subject: 'identifier', windowSeconds: 900, max: 5 };

describe('the table of limits', () => {
  it('gives every action at least one limit', () => {
    for (const action of RATE_LIMITED_ACTIONS) {
      expect(LIMITS[action].length, action).toBeGreaterThan(0);
    }
  });

  it('never allows an unlimited window', () => {
    for (const action of RATE_LIMITED_ACTIONS) {
      for (const limit of LIMITS[action]) {
        expect(limit.max, action).toBeGreaterThan(0);
        expect(limit.windowSeconds, action).toBeGreaterThan(0);
      }
    }
  });

  /*
   * Either subject alone is escapable, so the endpoints where that matters get
   * both. This asserts the pairing rather than the numbers, which are section
   * 9's to change.
   */
  it('limits login and password reset by identifier and by address', () => {
    for (const action of ['login', 'passwordReset'] as const) {
      const subjects = LIMITS[action].map((limit) => limit.subject);

      expect(subjects, action).toContain('identifier');
      expect(subjects, action).toContain('ip');
    }
  });

  /*
   * Section 9 bolds this one number, and gives the reason: the guest lookup is
   * the only endpoint that maps an order number to a customer's data, and it is
   * unauthenticated by design. It is "the tightest limit **relative to its
   * legitimate use**" rather than the smallest number in the table —
   * registration is smaller — so what is asserted here is the number itself.
   */
  it('holds the guest order lookup to five an hour, per address', () => {
    expect(LIMITS.guestOrderLookup).toEqual([
      { subject: 'ip', windowSeconds: 3600, max: 5 },
    ]);
  });

  /*
   * Every unauthenticated endpoint has to be limited by address: there is no
   * other subject available, so a missing IP limit is an unlimited endpoint.
   */
  it('limits every endpoint a stranger can reach by address', () => {
    for (const action of [
      'login',
      'register',
      'passwordReset',
      'guestOrderLookup',
    ] as const) {
      const subjects = LIMITS[action].map((limit) => limit.subject);
      expect(subjects, action).toContain('ip');
    }
  });
});

describe('windows', () => {
  it('floors a moment to the start of its window', () => {
    const start = windowStart(AT, 900);

    expect(start % 900).toBe(0);
    expect(start).toBeLessThanOrEqual(Math.floor(AT.getTime() / 1000));
  });

  it('puts two moments in the same window in the same bucket', () => {
    const early = new Date('2026-09-22T14:00:01.000Z');
    const late = new Date('2026-09-22T14:14:59.000Z');

    expect(windowStart(early, 900)).toBe(windowStart(late, 900));
  });

  it('puts a moment past the boundary in the next one', () => {
    const before = new Date('2026-09-22T14:14:59.000Z');
    const after = new Date('2026-09-22T14:15:00.000Z');

    expect(windowStart(after, 900)).toBeGreaterThan(windowStart(before, 900));
  });

  it('expires a window exactly when it closes', () => {
    const expiry = windowExpiry(AT, 900);

    expect(expiry.getTime()).toBe((windowStart(AT, 900) + 900) * 1000);
    expect(expiry.getTime()).toBeGreaterThan(AT.getTime());
  });
});

describe('keys', () => {
  it('separates the two subjects of one action', () => {
    const byIdentifier = rateLimitKey({
      action: 'login',
      limit: LOGIN,
      subject: 'ali@example.com',
      at: AT,
    });
    const byAddress = rateLimitKey({
      action: 'login',
      limit: { ...LOGIN, subject: 'ip' },
      subject: 'ali@example.com',
      at: AT,
    });

    expect(byIdentifier).not.toBe(byAddress);
  });

  it('separates two actions with the same subject', () => {
    const login = rateLimitKey({
      action: 'login',
      limit: LOGIN,
      subject: 'ali@example.com',
      at: AT,
    });
    const reset = rateLimitKey({
      action: 'passwordReset',
      limit: LOGIN,
      subject: 'ali@example.com',
      at: AT,
    });

    expect(login).not.toBe(reset);
  });

  /*
   * Case and whitespace are how a limit is trivially escaped: five attempts as
   * `ali@x.com`, five more as `Ali@x.com `. They are one allowance.
   */
  it('treats one address typed five ways as one subject', () => {
    const keys = [
      'ali@example.com',
      'Ali@Example.com',
      ' ali@example.com ',
      'ALI@EXAMPLE.COM',
    ].map((subject) => rateLimitKey({ action: 'login', limit: LOGIN, subject, at: AT }));

    expect(new Set(keys).size).toBe(1);
  });

  it('gives an unknown caller a shared bucket rather than a private one', () => {
    const empty = rateLimitKey({ action: 'login', limit: LOGIN, subject: '', at: AT });
    const missing = rateLimitKey({
      action: 'login',
      limit: LOGIN,
      subject: null,
      at: AT,
    });

    expect(empty).toBe(missing);
    expect(empty).toContain('anonymous');
  });

  it('changes when the window does', () => {
    const now = rateLimitKey({ action: 'login', limit: LOGIN, subject: 'a', at: AT });
    const later = rateLimitKey({
      action: 'login',
      limit: LOGIN,
      subject: 'a',
      at: new Date(AT.getTime() + 900_000),
    });

    expect(now).not.toBe(later);
  });
});

describe('the verdict', () => {
  /*
   * `count` is the value after this attempt was recorded, so a limit of 5
   * allows counts 1 to 5 and refuses 6.
   */
  it('allows up to the limit and refuses past it', () => {
    expect(withinLimit(1, LOGIN)).toBe(true);
    expect(withinLimit(5, LOGIN)).toBe(true);
    expect(withinLimit(6, LOGIN)).toBe(false);
  });

  it('never tells a caller to retry immediately', () => {
    const now = new Date('2026-09-22T14:14:59.999Z');
    const expiry = new Date('2026-09-22T14:15:00.000Z');

    expect(retryAfterSeconds(now, expiry)).toBe(1);
  });

  it('rounds the wait up, so a retry is never early', () => {
    const now = new Date('2026-09-22T14:00:00.000Z');
    const expiry = new Date('2026-09-22T14:00:30.500Z');

    expect(retryAfterSeconds(now, expiry)).toBe(31);
  });

  it('never returns a negative wait for a window that has closed', () => {
    const now = new Date('2026-09-22T15:00:00.000Z');
    const expiry = new Date('2026-09-22T14:00:00.000Z');

    expect(retryAfterSeconds(now, expiry)).toBe(1);
  });
});
