import { err, ok, type Result } from '../result';

/**
 * The quote lifecycle.
 *
 * `BUSINESS-RULES.md` section 7, and section 16 requires it in `domain/quote`
 * exactly once. Three ideas carry the whole of it:
 *
 *   **A quote is immutable once sent** (7.2). Changing one creates version N+1
 *   and marks N `SUPERSEDED`. There is no path in this file from `SENT` back to
 *   `DRAFT`, because there is no such path in the business.
 *
 *   **Two independent expiries.** `validUntil` bounds how long an unanswered
 *   quote may be accepted (7.4); `acceptanceValidUntil` bounds how long an
 *   *accepted* quote stays redeemable (7.10). Both are enforced twice — by a
 *   job and by a lazy check on every read — so correctness never depends on the
 *   job having run.
 *
 *   **Only the owner accepts** (7.5, 12.3). An admin accepting on a customer's
 *   behalf would destroy what acceptance means.
 */

export type QuoteStatus =
  | 'DRAFT'
  | 'SENT'
  | 'VIEWED'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'SUPERSEDED';

/** 7.1, transcribed. Anything not listed is rejected. */
export const QUOTE_TRANSITIONS: Record<QuoteStatus, readonly QuoteStatus[]> = {
  DRAFT: ['SENT', 'CANCELLED'],
  SENT: ['VIEWED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'SUPERSEDED'],
  VIEWED: ['ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'SUPERSEDED'],
  ACCEPTED: [],
  REJECTED: [],
  EXPIRED: [],
  CANCELLED: [],
  SUPERSEDED: [],
};

export const TERMINAL_QUOTE_STATUSES: readonly QuoteStatus[] = [
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
  'CANCELLED',
  'SUPERSEDED',
];

export function isTerminalQuoteStatus(status: QuoteStatus): boolean {
  return TERMINAL_QUOTE_STATUSES.includes(status);
}

/**
 * Every status from which `to` is reachable.
 *
 * This exists so the repository's conditional `UPDATE`s can be built **from the
 * table above** rather than restating it in SQL. Enforcement has to happen in
 * the query — a check in JavaScript is made before the row is locked, and two
 * simultaneous acceptances would both pass it — but section 16 requires the rule
 * itself to exist once. So the query asks the domain which statuses it may
 * claim from, and the domain is still the only place that knows.
 */
export function statusesThatCanReach(to: QuoteStatus): readonly QuoteStatus[] {
  return (Object.keys(QUOTE_TRANSITIONS) as QuoteStatus[]).filter((from) =>
    canTransitionQuote(from, to),
  );
}

/** The two statuses in which a quote is live in front of a customer. */
export function isOutstanding(status: QuoteStatus): boolean {
  return status === 'SENT' || status === 'VIEWED';
}

export type QuoteTransitionError = {
  code:
    | 'INVALID_TRANSITION'
    | 'SENT_QUOTE_IS_IMMUTABLE'
    | 'NOT_OWNER'
    | 'QUOTE_EXPIRED'
    | 'MISSING_REJECTION_REASON';
};

export function canTransitionQuote(from: QuoteStatus, to: QuoteStatus): boolean {
  if (from === to) return false;
  return QUOTE_TRANSITIONS[from].includes(to);
}

/**
 * Whether a quote's *content* may still be edited.
 *
 * The single most important predicate in this file. 7.2: a quote is immutable
 * once sent. Every write path that touches lines, totals, validity or the
 * customer message asks this first, so "immutable" is a check rather than a
 * convention.
 */
export function isEditable(status: QuoteStatus): boolean {
  return status === 'DRAFT';
}

export function validateQuoteEdit(
  status: QuoteStatus,
): Result<true, QuoteTransitionError> {
  if (!isEditable(status)) return err({ code: 'SENT_QUOTE_IS_IMMUTABLE' as const });
  return ok(true);
}

/**
 * A transition, checked.
 *
 * 7.8 says rejection *may* capture a reason, so unlike the order machine's
 * cancellation this takes no required payload — there is nothing a transition
 * here can be missing. It exists as a function anyway so that every caller
 * reaches the table the same way.
 */
export function validateQuoteTransition(
  from: QuoteStatus,
  to: QuoteStatus,
): Result<{ from: QuoteStatus; to: QuoteStatus }, QuoteTransitionError> {
  if (!canTransitionQuote(from, to)) return err({ code: 'INVALID_TRANSITION' as const });
  return ok({ from, to });
}

/* ---------------------------------------------------------------------------
 * Expiry
 * ------------------------------------------------------------------------ */

/**
 * The status a quote **actually** has, allowing for time.
 *
 * 7.4: a quote in `SENT` or `VIEWED` past `validUntil` is expired, enforced by
 * an hourly job *and* by a lazy check on every read. This is the lazy check,
 * and it exists so that a stalled job can never make an expired quote
 * acceptable. The stored row still says `SENT` until the job catches up; every
 * decision uses this instead.
 */
export function effectiveQuoteStatus(input: {
  status: QuoteStatus;
  validUntil: Date;
  now?: Date;
}): QuoteStatus {
  const now = input.now ?? new Date();
  if (!isOutstanding(input.status)) return input.status;

  // Strictly after: a quote is valid *until* the instant, so the instant itself
  // is still inside the window. `validUntil` is the last moment, not the first
  // moment of expiry.
  return now.getTime() > input.validUntil.getTime() ? 'EXPIRED' : input.status;
}

export function isExpired(input: {
  status: QuoteStatus;
  validUntil: Date;
  now?: Date;
}): boolean {
  return effectiveQuoteStatus(input) === 'EXPIRED';
}

/** 7.5: acceptable only from `SENT` or `VIEWED`, and only inside validity. */
export function isAcceptable(input: {
  status: QuoteStatus;
  validUntil: Date;
  now?: Date;
}): boolean {
  return isOutstanding(effectiveQuoteStatus(input));
}

/* ---------------------------------------------------------------------------
 * Acceptance validity (7.10)
 * ------------------------------------------------------------------------ */

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** `validUntil = sentAt + settings.custom_orders.quoteValidityDays` (7.4). */
export function validUntilFrom(sentAt: Date, validityDays: number): Date {
  return new Date(sentAt.getTime() + validityDays * MILLISECONDS_PER_DAY);
}

/** 7.10: `acceptanceValidUntil = acceptedAt + acceptanceValidityDays`. */
export function acceptanceValidUntilFrom(acceptedAt: Date, validityDays: number): Date {
  return new Date(acceptedAt.getTime() + validityDays * MILLISECONDS_PER_DAY);
}

/**
 * 7.10.1: the quote-bound cart is checkout-valid only while
 * `now <= acceptanceValidUntil`.
 *
 * The quote stays `ACCEPTED` and historically readable either way (7.10.4);
 * only its redeemability lapses.
 */
export function isCheckoutValid(input: {
  status: QuoteStatus;
  acceptanceValidUntil: Date | null;
  now?: Date;
}): boolean {
  if (input.status !== 'ACCEPTED' || !input.acceptanceValidUntil) return false;

  const now = input.now ?? new Date();
  return now.getTime() <= input.acceptanceValidUntil.getTime();
}

/* ---------------------------------------------------------------------------
 * Numbering
 * ------------------------------------------------------------------------ */

/**
 * `DATABASE.md` section 10 gives the format as "Q-1042-v2".
 *
 * The base comes from a PostgreSQL sequence and belongs to the *family* of
 * quotes for one request; the version is the suffix. Version 1 carries no
 * suffix, so the first quote a customer ever sees reads `Q-1042` — which is
 * what `UX.md` section 7 quotes back at them.
 */
export function quoteNumberFor(base: number, version: number): string {
  return version <= 1 ? `Q-${base}` : `Q-${base}-v${version}`;
}

/** The base a quote number belongs to, or null when it is not one of ours. */
export function quoteNumberBase(quoteNumber: string): number | null {
  const match = /^Q-(\d+)(?:-v(\d+))?$/.exec(quoteNumber);
  return match ? Number(match[1]) : null;
}

/** French copy for the statuses a customer sees. V1 is single-locale. */
export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  DRAFT: 'Brouillon',
  SENT: 'En attente de votre réponse',
  VIEWED: 'En attente de votre réponse',
  ACCEPTED: 'Accepté',
  REJECTED: 'Refusé',
  EXPIRED: 'Expiré',
  CANCELLED: 'Annulé',
  SUPERSEDED: 'Remplacé par une version plus récente',
};
