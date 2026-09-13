import 'server-only';

import {
  EXPIRY_WARNING_LEAD_MS,
  audienceOf,
  dedupeKeyFor,
  isWithinExpiryWarning,
  nextAttemptAt,
  parseRecipients,
  type NotificationTemplate,
} from '@/domain/notification';
import { formatMoney } from '@/components/commerce/price';
import type { OrderStatus } from '@/domain/order/state-machine';
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from '@/domain/order/payment-method';
import { clientEnv, serverEnv } from '@/lib/env';
import { emailTransport } from '@/lib/email/transport';
import { renderEmail, type TemplatePayloads } from '@/lib/email/templates';
import {
  claimPendingNotifications,
  enqueueNotification,
  markNotificationFailed,
  markNotificationSent,
  skipNotification,
  type NotificationPayload,
  type NotificationTx,
} from '@/server/repositories/notification-repository';
import {
  expireOutstandingQuotes,
  invalidateLapsedQuoteCarts,
  listQuotesExpiringWithin,
} from '@/server/repositories/quote-repository';
import { loadStaffRecipients } from '@/server/repositories/settings-repository';

/**
 * Announcing what happened, and delivering it.
 *
 * Two halves that never meet in the same call stack. **Enqueuing** is a write
 * in the caller's transaction: it takes facts the caller already has and turns
 * them into a row. **Dispatching** reads rows and talks to a provider. A
 * failed e-mail therefore cannot roll back an order, because by the time
 * anything is sent the order is long committed.
 *
 * This module holds no business rules. It formats money with the same function
 * the pages use, labels a status with the same map the domain owns, and asks
 * `domain/notification` who a template is for and when to try again. What it
 * adds is the sentence "this happened, tell that person".
 *
 * The recipient of a customer e-mail comes from the **row** — the order's
 * `contactEmail`, the quote owner's address — never from a payload. The
 * recipient of a staff e-mail comes from settings. Neither is ever an argument
 * a browser could supply.
 */

const SITE = clientEnv.NEXT_PUBLIC_SITE_URL;

function url(path: string): string {
  return `${SITE}${path}`;
}

function money(amount: number, currency: string): string {
  return formatMoney(amount, { currency });
}

/* ---------------------------------------------------------------------------
 * Recipients
 * ------------------------------------------------------------------------ */

/**
 * Who the workshop is.
 *
 * `ARCHITECTURE.md` section 11 resolves staff recipients "from the
 * `notifications` settings group", so the setting is authoritative and the
 * owner changes it without a deploy. `ADMIN_NOTIFICATION_EMAIL` is a bootstrap
 * for a deployment where nobody has opened the admin yet — never a hard-coded
 * address, and never something a request can influence.
 */
export async function staffRecipients(): Promise<readonly string[]> {
  const configured = parseRecipients(await loadStaffRecipients());
  if (configured.length > 0) return configured;

  return parseRecipients(serverEnv.ADMIN_NOTIFICATION_EMAIL);
}

/* ---------------------------------------------------------------------------
 * Enqueuing — customer events
 * ------------------------------------------------------------------------ */

/**
 * Queue a customer e-mail.
 *
 * The audience is checked against `domain/notification`: a staff template
 * cannot be enqueued through this door however it is called. Section 11 asks
 * for that guarantee and this is where it lives.
 */
async function enqueueCustomer<K extends keyof TemplatePayloads>(
  template: K,
  input: {
    dedupeSubject: string;
    /**
     * Where it goes, or nothing.
     *
     * An order placed without an e-mail address has nobody to send a
     * confirmation to (Phase 14.11) — a cash-on-delivery customer in Algeria
     * frequently has no address, and the phone number is the contact. The
     * queue is not the place to discover that: a row with no recipient would
     * sit in the outbox failing forever, and throwing here would lose the
     * **order** over a missing e-mail.
     *
     * So it is simply not enqueued, and that is the whole handling.
     */
    recipient: string | null;
    payload: TemplatePayloads[K];
    userId?: string | null;
    relatedOrderId?: string | null;
    relatedQuoteId?: string | null;
    relatedRequestId?: string | null;
  },
  tx?: NotificationTx,
): Promise<void> {
  if (audienceOf(template as NotificationTemplate) !== 'CUSTOMER') {
    throw new Error(`${template} is not a customer template`);
  }

  // Nobody to tell. See the note on `recipient`.
  if (!input.recipient) return;

  await enqueueNotification(
    {
      template: template as NotificationTemplate,
      dedupeKey: dedupeKeyFor(template as NotificationTemplate, input.dedupeSubject),
      recipient: input.recipient,
      payload: input.payload as unknown as NotificationPayload,
      userId: input.userId,
      relatedOrderId: input.relatedOrderId,
      relatedQuoteId: input.relatedQuoteId,
      relatedRequestId: input.relatedRequestId,
    },
    tx,
  );
}

/**
 * Queue a staff e-mail, once per configured recipient.
 *
 * With nobody configured, a single `SKIPPED` row is written instead: the event
 * is still in the outbox, visibly undelivered, rather than a silence that looks
 * exactly like a bug.
 */
async function enqueueStaff<K extends keyof TemplatePayloads>(
  template: K,
  input: {
    dedupeSubject: string;
    payload: TemplatePayloads[K];
    /**
     * Resolved by the caller, **before** any transaction is opened.
     *
     * Not read here on purpose. The connection pool is one connection wide by
     * default (`ARCHITECTURE.md` section 18), so a settings query issued while
     * an interactive transaction holds that connection waits for a transaction
     * that is waiting for it. Passing the answer in is what keeps every read
     * outside the transaction that announces the event.
     */
    recipients: readonly string[];
    relatedOrderId?: string | null;
    relatedQuoteId?: string | null;
    relatedRequestId?: string | null;
  },
  tx?: NotificationTx,
): Promise<void> {
  if (audienceOf(template as NotificationTemplate) !== 'STAFF') {
    throw new Error(`${template} is not a staff template`);
  }

  const recipients = input.recipients;
  const payload = input.payload as unknown as NotificationPayload;

  if (recipients.length === 0) {
    await skipNotification(
      {
        template: template as NotificationTemplate,
        dedupeKey: dedupeKeyFor(template as NotificationTemplate, input.dedupeSubject),
        payload,
        relatedOrderId: input.relatedOrderId,
        relatedQuoteId: input.relatedQuoteId,
        relatedRequestId: input.relatedRequestId,
        reason:
          'Aucun destinataire configuré (notifications.adminRecipients ou ADMIN_NOTIFICATION_EMAIL).',
      },
      tx,
    );

    return;
  }

  for (const recipient of recipients) {
    await enqueueNotification(
      {
        template: template as NotificationTemplate,
        // One row per recipient, so two addresses are two deliveries rather
        // than one row that half-succeeded.
        dedupeKey: dedupeKeyFor(
          template as NotificationTemplate,
          `${input.dedupeSubject}:${recipient.toLowerCase()}`,
        ),
        recipient,
        payload,
        relatedOrderId: input.relatedOrderId,
        relatedQuoteId: input.relatedQuoteId,
        relatedRequestId: input.relatedRequestId,
      },
      tx,
    );
  }
}

/* ---------------------------------------------------------------------------
 * The events
 * ------------------------------------------------------------------------ */

export type OrderNotificationInput = {
  /** Resolved before the transaction opened. See `enqueueStaff`. */
  staffRecipients: readonly string[];
  orderId: string;
  orderNumber: string;
  userId: string | null;
  contactName: string;
  contactEmail: string | null;
  currency: string;
  status: OrderStatus;
  paymentMethod: string;
  subtotal: number;
  discountTotal: number;
  shippingTotal: number;
  shippingRateLabel: string | null;
  grandTotal: number;
  depositRequired: number;
  address: string;
  items: readonly {
    name: string;
    variantLabel: string | null;
    quantity: number;
    lineTotal: number;
  }[];
};

/**
 * An order was placed (`order.confirmed` to the customer, `order.placed` to the
 * workshop).
 *
 * Everything in the payload is a **snapshot the order already holds** —
 * `nameSnapshot`, `variantLabelSnapshot`, the stored totals, the wilaya
 * snapshot. The confirmation a customer keeps must say what they bought, not
 * what the shop sells today, and re-reading the catalogue here would quietly
 * undo every snapshot Phase 8 wrote.
 *
 * The recipient is the order's own `contactEmail`, which the checkout schema
 * validated and stored. A payload address is never used to route anything.
 */
export async function notifyOrderPlaced(
  input: OrderNotificationInput,
  tx?: NotificationTx,
): Promise<void> {
  const deposit =
    input.depositRequired > 0 ? money(input.depositRequired, input.currency) : null;

  await enqueueCustomer(
    'order.confirmed',
    {
      dedupeSubject: input.orderNumber,
      recipient: input.contactEmail,
      userId: input.userId,
      relatedOrderId: input.orderId,
      payload: {
        orderNumber: input.orderNumber,
        contactName: input.contactName,
        items: input.items.map((item) => ({
          name: item.name,
          variant: item.variantLabel,
          quantity: item.quantity,
          total: money(item.lineTotal, input.currency),
        })),
        subtotal: money(input.subtotal, input.currency),
        discountTotal:
          input.discountTotal > 0 ? money(input.discountTotal, input.currency) : null,
        shippingLabel: input.shippingRateLabel ?? 'Livraison',
        shippingTotal: money(input.shippingTotal, input.currency),
        grandTotal: money(input.grandTotal, input.currency),
        depositRequired: deposit,
        paymentMethod:
          PAYMENT_METHOD_LABELS[input.paymentMethod as PaymentMethod] ??
          input.paymentMethod,
        address: input.address,
        statusMessage:
          input.status === 'AWAITING_PAYMENT'
            ? 'Rien n’est encore lancé en production : dès que votre acompte est confirmé, nous commençons.'
            : 'Nous vérifions votre commande et vous confirmons rapidement.',
        orderUrl: url(`/order/${input.orderNumber}`),
      },
    },
    tx,
  );

  await enqueueStaff(
    'order.placed',
    {
      dedupeSubject: input.orderNumber,
      recipients: input.staffRecipients,
      relatedOrderId: input.orderId,
      payload: {
        orderNumber: input.orderNumber,
        customerName: input.contactName,
        grandTotal: money(input.grandTotal, input.currency),
        paymentMethod:
          PAYMENT_METHOD_LABELS[input.paymentMethod as PaymentMethod] ??
          input.paymentMethod,
        depositRequired: deposit,
        itemCount: input.items.reduce((total, item) => total + item.quantity, 0),
        adminUrl: url(`/admin/orders/${input.orderNumber}`),
      },
    },
    tx,
  );
}

export type RequestNotificationInput = {
  /** Resolved before the transaction opened. See `enqueueStaff`. */
  staffRecipients: readonly string[];
  requestId: string;
  requestNumber: string;
  customerName: string;
  itemCount: number;
  pricingMode: 'FIXED' | 'QUOTE';
  estimateMin: number | null;
  estimateMax: number | null;
  currency: string;
  responseTimeHours: number;
};

/** A custom request arrived (`request.submitted`, staff only). */
export async function notifyRequestSubmitted(
  input: RequestNotificationInput,
  tx?: NotificationTx,
): Promise<void> {
  const estimate =
    input.estimateMin !== null && input.estimateMax !== null
      ? `${money(input.estimateMin, input.currency)} – ${money(input.estimateMax, input.currency)}`
      : null;

  await enqueueStaff(
    'request.submitted',
    {
      dedupeSubject: input.requestNumber,
      recipients: input.staffRecipients,
      relatedRequestId: input.requestId,
      payload: {
        requestNumber: input.requestNumber,
        customerName: input.customerName,
        itemCount: input.itemCount,
        pricingMode: input.pricingMode === 'QUOTE' ? 'Devis nécessaire' : 'Prix ferme',
        estimate,
        responseTimeHours: input.responseTimeHours,
        adminUrl: url(`/admin/requests/${input.requestNumber}`),
      },
    },
    tx,
  );
}

export type QuoteSentNotificationInput = {
  quoteId: string;
  quoteNumber: string;
  version: number;
  userId: string;
  contactName: string;
  contactEmail: string | null;
  requestNumber: string;
  currency: string;
  grandTotal: number;
  depositRequired: number;
  validUntil: Date;
  customerMessage: string | null;
  lines: readonly { label: string; quantity: number; lineTotal: number }[];
};

const DATE = new Intl.DateTimeFormat('fr-DZ', { dateStyle: 'long' });

/**
 * A quote was sent (`quote.sent`, customer only).
 *
 * The payload is the quote's own immutable content — its number, its version,
 * its lines as authored, its total and its `validUntil`. A sent quote never
 * changes (7.2), so this e-mail and the quote page can never disagree.
 */
export async function notifyQuoteSent(
  input: QuoteSentNotificationInput,
  tx?: NotificationTx,
): Promise<void> {
  await enqueueCustomer(
    'quote.sent',
    {
      // Versioned, so revision 2 is its own e-mail rather than a duplicate.
      dedupeSubject: input.quoteNumber,
      recipient: input.contactEmail,
      userId: input.userId,
      relatedQuoteId: input.quoteId,
      payload: {
        quoteNumber: input.quoteNumber,
        version: input.version,
        contactName: input.contactName,
        requestNumber: input.requestNumber,
        lines: input.lines.map((line) => ({
          label: line.label,
          quantity: line.quantity,
          total: money(line.lineTotal, input.currency),
        })),
        grandTotal: money(input.grandTotal, input.currency),
        depositRequired:
          input.depositRequired > 0 ? money(input.depositRequired, input.currency) : null,
        validUntil: DATE.format(input.validUntil),
        message: input.customerMessage,
        quoteUrl: url(`/account/quotes/${input.quoteNumber}`),
      },
    },
    tx,
  );
}

export type ExpiringQuote = {
  quoteId: string;
  quoteNumber: string;
  userId: string;
  contactName: string;
  contactEmail: string | null;
  customerName: string;
  requestNumber: string;
  currency: string;
  grandTotal: number;
  validUntil: Date;
};

/**
 * A sent quote is about to lapse (`quote.expiring`, both audiences).
 *
 * The warning window is `domain/notification`'s, and `validUntil` is the
 * quote's own — no new validity period is introduced here. The dedupe key is
 * the quote number, so a sweep that runs hourly for two days sends one warning,
 * not forty-eight.
 */
export async function notifyQuoteExpiring(
  quote: ExpiringQuote,
  recipients: readonly string[],
): Promise<void> {
  await enqueueCustomer('quote.expiring', {
    dedupeSubject: quote.quoteNumber,
    recipient: quote.contactEmail,
    userId: quote.userId,
    relatedQuoteId: quote.quoteId,
    payload: {
      quoteNumber: quote.quoteNumber,
      contactName: quote.contactName,
      grandTotal: money(quote.grandTotal, quote.currency),
      validUntil: DATE.format(quote.validUntil),
      quoteUrl: url(`/account/quotes/${quote.quoteNumber}`),
    },
  });

  await enqueueStaff('quote.expiring.staff', {
    dedupeSubject: quote.quoteNumber,
    recipients,
    relatedQuoteId: quote.quoteId,
    payload: {
      quoteNumber: quote.quoteNumber,
      customerName: quote.customerName,
      grandTotal: money(quote.grandTotal, quote.currency),
      validUntil: DATE.format(quote.validUntil),
      adminUrl: url(`/admin/requests/${quote.requestNumber}`),
    },
  });
}

/** Which of these outstanding quotes are inside the warning window. */
export function selectExpiringQuotes(
  quotes: readonly ExpiringQuote[],
  now = new Date(),
): readonly ExpiringQuote[] {
  return quotes.filter((quote) =>
    isWithinExpiryWarning({ validUntil: quote.validUntil, now }),
  );
}

/* ---------------------------------------------------------------------------
 * Authentication e-mails
 * ------------------------------------------------------------------------ */

/**
 * The two credential e-mails, sent **immediately** rather than queued.
 *
 * A verification code lives fifteen minutes and a reset link one hour; a
 * dispatcher that runs every few minutes would spend a meaningful part of that
 * budget waiting. They are also the two messages whose content is a live
 * credential, and the outbox stores payloads — so keeping them out of it means
 * a database dump contains no reset link (`SECURITY.md` 2.1).
 *
 * Nothing is recorded about them beyond the transport's own result.
 */
export async function sendVerificationCode(input: {
  to: string;
  otp: string;
}): Promise<void> {
  await sendNow('auth.verify_email', input.to, { otp: input.otp });
}

export async function sendPasswordReset(input: {
  to: string;
  url: string;
}): Promise<void> {
  await sendNow('auth.password_reset', input.to, { url: input.url });
}

async function sendNow<K extends keyof TemplatePayloads>(
  template: K,
  to: string,
  payload: TemplatePayloads[K],
): Promise<void> {
  const rendered = renderEmail(template, payload);
  if (!rendered) return;

  const transport = emailTransport();
  if (!transport.isEnabled()) return;

  await transport.send({
    to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });
}

/* ---------------------------------------------------------------------------
 * Dispatch
 * ------------------------------------------------------------------------ */

export type DispatchSummary = {
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
};

/**
 * Deliver what is due.
 *
 * Claim a batch, render each row from the payload it stored, hand it to the
 * transport, and record the outcome. A row that fails is rescheduled by
 * `nextAttemptAt` until the budget runs out, then left `FAILED` where a person
 * can find it.
 *
 * Nothing here throws for a single bad row: one unrenderable notification must
 * not stop the queue behind it.
 */
export async function dispatchNotifications(
  input: {
    limit?: number;
    now?: Date;
  } = {},
): Promise<DispatchSummary> {
  const now = input.now ?? new Date();
  const transport = emailTransport();

  const summary: DispatchSummary = { claimed: 0, sent: 0, failed: 0, skipped: 0 };

  if (!transport.isEnabled()) return summary;

  const batch = await claimPendingNotifications({ limit: input.limit ?? 25, now });
  summary.claimed = batch.length;

  for (const notification of batch) {
    if (!notification.recipient) {
      await markNotificationFailed({
        id: notification.id,
        error: 'Aucun destinataire.',
        retryAt: null,
      });
      summary.skipped += 1;
      continue;
    }

    const rendered = renderEmail(notification.template, notification.payload);

    if (!rendered) {
      // An unknown template or a payload that does not fit it. Neither becomes
      // well-formed on its own, so retrying cannot help and a person must look.
      await markNotificationFailed({
        id: notification.id,
        error: `Modèle inconnu ou charge utile invalide : ${notification.template}`,
        retryAt: null,
      });
      summary.failed += 1;
      continue;
    }

    const result = await transport.send({
      to: notification.recipient,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });

    if (result.ok) {
      await markNotificationSent(notification.id);
      summary.sent += 1;
      continue;
    }

    const retryAt = result.retryable
      ? nextAttemptAt({ attempts: notification.attempts, now })
      : null;

    await markNotificationFailed({ id: notification.id, error: result.error, retryAt });
    summary.failed += 1;
  }

  return summary;
}

/* ---------------------------------------------------------------------------
 * The scheduled sweep
 * ------------------------------------------------------------------------ */

export type SweepSummary = {
  quotesExpired: number;
  cartsInvalidated: number;
  expiryWarnings: number;
  dispatch: DispatchSummary;
};

/**
 * Everything that happens on a timer.
 *
 * Four steps, in the order they depend on each other: expire what has lapsed,
 * invalidate the carts that lapsed with it, warn about what is *about* to
 * lapse, then deliver whatever is queued.
 *
 * The two sweeps are Phase 10's own — `expireOutstandingQuotes` and
 * `invalidateLapsedQuoteCarts` have existed and been tested since then with
 * nothing calling them. They are called here because a warning about a quote
 * that already expired is worse than no warning, and because this is the first
 * phase to have a scheduler at all. Neither is new behaviour; the lazy checks
 * still mean correctness never depended on this running.
 *
 * The warning is idempotent by quote number, so a sweep that runs hourly across
 * the two-day window sends one e-mail, not forty-eight.
 */
export async function runNotificationSweep(
  input: {
    now?: Date;
    limit?: number;
  } = {},
): Promise<SweepSummary> {
  const now = input.now ?? new Date();

  const quotesExpired = await expireOutstandingQuotes(now);
  const cartsInvalidated = await invalidateLapsedQuoteCarts(now);

  const candidates = await listQuotesExpiringWithin({
    from: now,
    until: new Date(now.getTime() + EXPIRY_WARNING_LEAD_MS),
  });

  const recipients = await staffRecipients();

  for (const quote of candidates) {
    await notifyQuoteExpiring(
      {
        quoteId: quote.quoteId,
        quoteNumber: quote.quoteNumber,
        userId: quote.userId,
        contactName: quote.customerName ?? 'client',
        contactEmail: quote.customerEmail,
        customerName: quote.customerName ?? quote.customerEmail,
        requestNumber: quote.requestNumber,
        currency: quote.currency,
        grandTotal: quote.grandTotal,
        validUntil: quote.validUntil,
      },
      recipients,
    );
  }

  const dispatch = await dispatchNotifications({ limit: input.limit, now });

  return {
    quotesExpired,
    cartsInvalidated,
    expiryWarnings: candidates.length,
    dispatch,
  };
}
