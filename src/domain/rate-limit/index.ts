/**
 * What may be attempted, how often, and by whom.
 *
 * `SECURITY.md` section 9 has carried this table since Phase 0 with nothing
 * enforcing it. This is the table as code — the limits themselves, the key a
 * limit is counted against, and the arithmetic of a fixed window. The storage
 * is elsewhere (`lib/rate-limit`); none of it is here, which is what lets the
 * limits be tested without a database.
 *
 * ## Why the limits live in the domain
 *
 * A rate limit is a business rule wearing an infrastructure costume. "Five
 * login attempts per quarter of an hour" is a decision about how much a
 * customer may fumble their password before the shop stops talking to them, and
 * it belongs next to the deposit percentage rather than inside a Redis client.
 *
 * ## The key is the decision that matters
 *
 * A limit counted against the wrong subject is worse than no limit: keyed by IP
 * alone, one office behind a NAT locks itself out; keyed by identifier alone,
 * an attacker with a list of addresses is unlimited. Section 9 names the
 * subject for each endpoint, and `LIMITS` records it rather than leaving it to
 * whoever writes the call.
 */

export const RATE_LIMITED_ACTIONS = [
  'login',
  'register',
  'passwordReset',
  'uploadDesign',
  'submitRequest',
  'guestOrderLookup',
  'submitReview',
  'acceptQuote',
] as const;

export type RateLimitedAction = (typeof RATE_LIMITED_ACTIONS)[number];

/** What a limit is counted against. */
export type RateLimitSubject =
  /** The signed-in account. */
  | 'user'
  /** The caller's address. */
  | 'ip'
  /** What was typed — an e-mail address, an order number. */
  | 'identifier';

export type RateLimit = {
  subject: RateLimitSubject;
  /** How long the window is, in seconds. */
  windowSeconds: number;
  /** How many attempts the window allows. */
  max: number;
};

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * The limits, from `SECURITY.md` section 9.
 *
 * Several endpoints are limited **twice** — by identifier and by IP — because
 * either alone is escapable: an attacker rotating addresses defeats the first,
 * and a shared connection is punished by the second. Both are checked and the
 * stricter answer wins.
 */
export const LIMITS: Record<RateLimitedAction, readonly RateLimit[]> = {
  // Credential stuffing. Tight per identifier, looser per address, because a
  // household or an office shares one.
  login: [
    { subject: 'identifier', windowSeconds: 15 * MINUTE, max: 5 },
    { subject: 'ip', windowSeconds: 15 * MINUTE, max: 20 },
  ],
  register: [{ subject: 'ip', windowSeconds: HOUR, max: 3 }],
  // Mail bombing, and enumeration of which addresses have accounts.
  passwordReset: [
    { subject: 'identifier', windowSeconds: HOUR, max: 3 },
    { subject: 'ip', windowSeconds: HOUR, max: 10 },
  ],
  // Storage exhaustion — the main cost risk in the whole application.
  uploadDesign: [
    { subject: 'user', windowSeconds: HOUR, max: 20 },
    { subject: 'ip', windowSeconds: HOUR, max: 5 },
  ],
  submitRequest: [{ subject: 'user', windowSeconds: DAY, max: 10 }],
  /*
   * The tightest limit relative to its legitimate use, and deliberately so: it
   * is the one endpoint that maps an order number to a customer's data, and it
   * is unauthenticated by design. Somebody checking their own delivery looks it
   * up once or twice.
   */
  guestOrderLookup: [{ subject: 'ip', windowSeconds: HOUR, max: 5 }],
  submitReview: [{ subject: 'user', windowSeconds: DAY, max: 5 }],
  acceptQuote: [{ subject: 'user', windowSeconds: MINUTE, max: 10 }],
};

/**
 * The window a moment falls in, as whole seconds.
 *
 * Putting this in the key is what makes incrementing a counter a single upsert
 * rather than a read-modify-write two requests can both win. See the migration.
 */
export function windowStart(at: Date, windowSeconds: number): number {
  const seconds = Math.floor(at.getTime() / 1000);

  return seconds - (seconds % windowSeconds);
}

/**
 * The key one limit is counted under.
 *
 * The subject is **lower-cased and trimmed** so `Ali@Example.com` and
 * `ali@example.com ` are one person rather than two allowances. An empty
 * subject becomes `anonymous`, which is a shared bucket on purpose: a caller
 * the application cannot identify should not get a private allowance by being
 * unidentifiable.
 */
export function rateLimitKey(input: {
  action: RateLimitedAction;
  limit: RateLimit;
  subject: string | null | undefined;
  at: Date;
}): string {
  const subject = (input.subject ?? '').trim().toLowerCase() || 'anonymous';
  const bucket = windowStart(input.at, input.limit.windowSeconds);

  return `${input.action}:${input.limit.subject}:${subject}:${bucket}`;
}

/** When the window holding `at` closes. */
export function windowExpiry(at: Date, windowSeconds: number): Date {
  return new Date((windowStart(at, windowSeconds) + windowSeconds) * 1000);
}

/**
 * How long to tell the caller to wait, in whole seconds.
 *
 * Rounded **up** and never below one: a `Retry-After: 0` invites an immediate
 * retry, which is the behaviour the limit exists to stop.
 */
export function retryAfterSeconds(now: Date, expiresAt: Date): number {
  return Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000));
}

/**
 * Whether this attempt is allowed, given how many have been counted.
 *
 * `count` is the value **after** this attempt was recorded, which is why the
 * comparison is `<=`. Counting first and asking afterwards is what makes two
 * simultaneous requests unable to both pass a limit of one.
 */
export function withinLimit(count: number, limit: RateLimit): boolean {
  return count <= limit.max;
}
