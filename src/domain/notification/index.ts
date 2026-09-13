/**
 * What can be announced, and to whom.
 *
 * `ARCHITECTURE.md` section 11 lists the eight V1 events and requires that
 * "every template declares its audience so a customer template can never be
 * dispatched to a staff recipient or the reverse". That declaration is this
 * file, and it is pure: no provider, no rendering, no I/O. The dispatcher asks
 * it who a template is for; the enqueuer asks it what makes an event unique.
 *
 * Nothing here decides *whether* an event happened. A service that changed a
 * state says so; this only describes the announcement.
 */

export type NotificationAudience = 'CUSTOMER' | 'STAFF';

/** The eight templates section 11 names. There is no ninth in V1. */
export type NotificationTemplate =
  | 'auth.verify_email'
  | 'auth.password_reset'
  | 'order.confirmed'
  | 'quote.sent'
  | 'quote.expiring'
  | 'request.submitted'
  | 'order.placed'
  | 'quote.expiring.staff';

export const NOTIFICATION_TEMPLATES: readonly NotificationTemplate[] = [
  'auth.verify_email',
  'auth.password_reset',
  'order.confirmed',
  'quote.sent',
  'quote.expiring',
  'request.submitted',
  'order.placed',
  'quote.expiring.staff',
];

/**
 * Who each template is addressed to.
 *
 * `quote.expiring` appears twice in section 11's table — once for the customer,
 * once for the workshop — with different words and a different reason. They are
 * two templates here rather than one with a flag, because a flag is how the
 * customer's copy eventually reaches the workshop's inbox.
 */
export const TEMPLATE_AUDIENCE: Record<NotificationTemplate, NotificationAudience> = {
  'auth.verify_email': 'CUSTOMER',
  'auth.password_reset': 'CUSTOMER',
  'order.confirmed': 'CUSTOMER',
  'quote.sent': 'CUSTOMER',
  'quote.expiring': 'CUSTOMER',
  'request.submitted': 'STAFF',
  'order.placed': 'STAFF',
  'quote.expiring.staff': 'STAFF',
};

export function audienceOf(template: NotificationTemplate): NotificationAudience {
  return TEMPLATE_AUDIENCE[template];
}

export function isCustomerTemplate(template: NotificationTemplate): boolean {
  return audienceOf(template) === 'CUSTOMER';
}

export function isStaffTemplate(template: NotificationTemplate): boolean {
  return audienceOf(template) === 'STAFF';
}

/**
 * The idempotency key for an event.
 *
 * `<template>:<subject>` — one order confirmation per order, one expiry warning
 * per quote per audience. The column is unique, so enqueuing the same event
 * twice is a constraint violation the writer swallows rather than a second
 * e-mail landing in somebody's inbox.
 *
 * The subject is the **business identifier**, not a row id: an order number or
 * a quote number reads the same in a log, in an inbox and on the telephone.
 */
export function dedupeKeyFor(template: NotificationTemplate, subject: string): string {
  return `${template}:${subject}`;
}

/* ---------------------------------------------------------------------------
 * Retry (section 11; V1.5 owns the tuned curve)
 * ------------------------------------------------------------------------ */

/** Attempts before a notification is left alone for a person to look at. */
export const MAX_DELIVERY_ATTEMPTS = 5;

const BACKOFF_MINUTES: readonly number[] = [1, 5, 15, 60];

/**
 * When to try again after a failure.
 *
 * A fixed, short curve rather than a tuned one: V1's failure mode is a provider
 * being briefly unreachable, and four retries over about an hour and a quarter
 * covers it. `ARCHITECTURE.md` puts retry tuning in V1.5, so this deliberately
 * has no jitter, no per-error policy and no dead-letter queue.
 *
 * Returns `null` when the budget is spent, which is what marks the row `FAILED`
 * and stops it being claimed again.
 */
export function nextAttemptAt(input: { attempts: number; now: Date }): Date | null {
  if (input.attempts >= MAX_DELIVERY_ATTEMPTS) return null;

  const minutes =
    BACKOFF_MINUTES[Math.min(input.attempts, BACKOFF_MINUTES.length - 1)] ?? 60;

  return new Date(input.now.getTime() + minutes * 60_000);
}

/** Whether a failure is worth trying again, or is the last word. */
export function shouldRetry(attempts: number): boolean {
  return attempts < MAX_DELIVERY_ATTEMPTS;
}

/* ---------------------------------------------------------------------------
 * Quote expiry warnings (7.4, 7.10)
 * ------------------------------------------------------------------------ */

/**
 * How long before `validUntil` the warning goes out.
 *
 * Two days: long enough that a customer who reads e-mail once a day still has a
 * working day to answer, short enough that the warning is about *this* quote
 * rather than a reminder that one exists. It is not a new validity period —
 * `validUntil` is unchanged and remains the only deadline.
 */
export const EXPIRY_WARNING_LEAD_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * Whether a quote is inside its warning window.
 *
 * Deliberately not "is it expiring soon" in the abstract: an already-expired
 * quote is not warned about, because the e-mail would arrive after the thing it
 * warns of. The caller has already filtered to outstanding quotes using the
 * existing effective-status rule; this is only the timing.
 */
export function isWithinExpiryWarning(input: {
  validUntil: Date;
  now: Date;
  leadMs?: number;
}): boolean {
  const lead = input.leadMs ?? EXPIRY_WARNING_LEAD_MS;
  const remaining = input.validUntil.getTime() - input.now.getTime();

  return remaining > 0 && remaining <= lead;
}

/* ---------------------------------------------------------------------------
 * Recipients
 * ------------------------------------------------------------------------ */

/**
 * Parse the configured staff recipients.
 *
 * A comma-separated setting, because the owner edits it in a text field and a
 * JSON array in a settings row is a support call waiting to happen. Blanks and
 * duplicates are dropped; the order is preserved so the first address is the
 * one a human would call the primary.
 */
export function parseRecipients(value: string | null | undefined): readonly string[] {
  if (!value) return [];

  const seen = new Set<string>();
  const recipients: string[] = [];

  for (const candidate of value.split(',')) {
    const address = candidate.trim();
    if (address === '') continue;

    const key = address.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    recipients.push(address);
  }

  return recipients;
}
