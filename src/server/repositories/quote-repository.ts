import 'server-only';

import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db/client';
import { quoteNumberFor, statusesThatCanReach, type QuoteStatus } from '@/domain/quote';
import type { QuoteLineInput, QuoteTotals } from '@/domain/quote/pricing';
import type { RequestStatus } from '@/domain/request';
import { archiveWhere } from '@/server/repositories/archive-repository';

/**
 * Quotes: their reads, and the two transactions that matter.
 *
 * **Sending** and **accepting** are each one transaction, because each is
 * several writes that only make sense together. `BUSINESS-RULES.md` 7.2.1 is
 * explicit for the first — freezing happens "in the same transaction as the
 * transition to `SENT`" — and 7.6 for the second.
 *
 * Ownership is expressed once, here, and every customer-facing read goes
 * through it. `DATABASE.md` section 15 puts quotes in the customer-owned class:
 * the filter is in the query, never after the fetch.
 */

/* ---------------------------------------------------------------------------
 * Selection
 * ------------------------------------------------------------------------ */

const QUOTE_SELECT = {
  id: true,
  quoteNumber: true,
  version: true,
  status: true,
  currency: true,
  subtotal: true,
  discountTotal: true,
  shippingTotal: true,
  taxTotal: true,
  grandTotal: true,
  depositRequired: true,
  validUntil: true,
  acceptanceValidUntil: true,
  customerMessage: true,
  rejectionReason: true,
  sentAt: true,
  viewedAt: true,
  acceptedAt: true,
  rejectedAt: true,
  createdAt: true,
  userId: true,
  requestId: true,
  supersedesQuoteId: true,
  request: { select: { requestNumber: true, status: true } },
  // The quote-bound cart acceptance created, so the customer's quote page can
  // link to its checkout and say whether it is still redeemable (7.10.1).
  cart: { select: { id: true, status: true, quoteValidUntil: true } },
  items: {
    select: {
      id: true,
      kind: true,
      label: true,
      description: true,
      quantity: true,
      unitPrice: true,
      lineTotal: true,
      position: true,
      requestItemId: true,
    },
    orderBy: { position: 'asc' },
  },
} satisfies Prisma.QuoteSelect;

type QuoteRow = Prisma.QuoteGetPayload<{ select: typeof QUOTE_SELECT }>;

export type QuoteRecord = Omit<QuoteRow, 'status'> & { status: QuoteStatus };

function toRecord(row: QuoteRow): QuoteRecord {
  return { ...row, status: row.status as QuoteStatus };
}

/**
 * The staff projection: everything above, plus `internalNotes`.
 *
 * The two selects exist so the customer's cannot accidentally grow the column.
 * `DATABASE.md` section 15 puts `quotes.internalNotes` in the never-exposed
 * class, and the way to keep a field out of a DTO is not to select it — a
 * caller who forgets to strip it cannot leak what was never fetched.
 */
const STAFF_QUOTE_SELECT = {
  ...QUOTE_SELECT,
  internalNotes: true,
} satisfies Prisma.QuoteSelect;

type StaffQuoteRow = Prisma.QuoteGetPayload<{ select: typeof STAFF_QUOTE_SELECT }>;

export type StaffQuoteRecord = Omit<StaffQuoteRow, 'status'> & { status: QuoteStatus };

function toStaffRecord(row: StaffQuoteRow): StaffQuoteRecord {
  return { ...row, status: row.status as QuoteStatus };
}

/* ---------------------------------------------------------------------------
 * Reads
 * ------------------------------------------------------------------------ */

/**
 * A quote the signed-in customer owns.
 *
 * `internalNotes` is **not selected at all** — `DATABASE.md` section 15
 * requires the DTO mapper to exclude it rather than a caller to remember to.
 */
export async function findQuoteForOwner(input: {
  quoteNumber: string;
  userId: string;
}): Promise<QuoteRecord | null> {
  const row = await prisma.quote.findFirst({
    where: { quoteNumber: input.quoteNumber, userId: input.userId },
    select: QUOTE_SELECT,
  });

  return row ? toRecord(row) : null;
}

/** Every quote a customer has been sent, newest first. Drafts are not theirs yet. */
export async function listQuotesForOwner(
  userId: string,
): Promise<readonly QuoteRecord[]> {
  const rows = await prisma.quote.findMany({
    where: { userId, status: { not: 'DRAFT' } },
    select: QUOTE_SELECT,
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return rows.map(toRecord);
}

/** Any quote, for staff. The caller has already checked the capability. */
export async function findQuoteForStaff(
  quoteId: string,
): Promise<StaffQuoteRecord | null> {
  const row = await prisma.quote.findUnique({
    where: { id: quoteId },
    select: STAFF_QUOTE_SELECT,
  });

  return row ? toStaffRecord(row) : null;
}

export async function listQuotesForRequest(
  requestId: string,
): Promise<readonly StaffQuoteRecord[]> {
  const rows = await prisma.quote.findMany({
    where: { requestId },
    select: STAFF_QUOTE_SELECT,
    orderBy: { version: 'desc' },
  });

  return rows.map(toStaffRecord);
}

/** 7.3: `VIEWED` is set once, on the owner's first view. An admin view does not. */
export async function markViewedByOwner(input: {
  quoteId: string;
  userId: string;
}): Promise<void> {
  await prisma.quote.updateMany({
    where: {
      id: input.quoteId,
      userId: input.userId,
      status: { in: [...statusesThatCanReach('VIEWED')] },
    },
    data: { status: 'VIEWED', viewedAt: new Date() },
  });
}

/* ---------------------------------------------------------------------------
 * Drafting
 * ------------------------------------------------------------------------ */

/**
 * A draft line as it is stored.
 *
 * `requestItemId` is the binding 2.6.5 needs at acceptance: it says which of
 * the request's configurations this line prices. `description` is the admin's
 * free note, shown to the customer beneath the label.
 */
export type DraftQuoteLine = QuoteLineInput & {
  description: string | null;
  requestItemId: string | null;
};

export type DraftQuoteInput = {
  requestId: string;
  userId: string;
  createdByUserId: string;
  currency: string;
  lines: readonly DraftQuoteLine[];
  totals: QuoteTotals;
  depositRequired: number;
  validUntil: Date;
  customerMessage: string | null;
  internalNotes: string | null;
};

/**
 * Create a draft, taking the next quote number.
 *
 * The **base** comes from `next_quote_base()`, a PostgreSQL sequence, for the
 * reasons ADR-023 gives: `nextval` never blocks and never repeats. A revision
 * reuses its predecessor's base and increments the version, so `Q-1042` and
 * `Q-1042-v2` are visibly the same conversation.
 */
export async function createDraftQuote(
  input: DraftQuoteInput & { supersedesQuoteId?: string | null; baseNumber?: number },
): Promise<{ id: string; quoteNumber: string; version: number }> {
  return prisma.$transaction(async (tx) => {
    const previous = await tx.quote.findFirst({
      where: { requestId: input.requestId },
      select: { version: true, quoteNumber: true },
      orderBy: { version: 'desc' },
    });

    const version = (previous?.version ?? 0) + 1;

    const base =
      input.baseNumber ??
      (previous
        ? baseFromQuoteNumber(previous.quoteNumber)
        : Number(
            (await tx.$queryRaw<{ base: bigint }[]>`SELECT next_quote_base() AS base`)[0]!
              .base,
          ));

    const created = await tx.quote.create({
      data: {
        quoteNumber: quoteNumberFor(base, version),
        requestId: input.requestId,
        userId: input.userId,
        createdByUserId: input.createdByUserId,
        version,
        supersedesQuoteId: input.supersedesQuoteId ?? null,
        status: 'DRAFT',
        currency: input.currency,
        subtotal: input.totals.subtotal,
        discountTotal: input.totals.discountTotal,
        shippingTotal: input.totals.shippingTotal,
        taxTotal: input.totals.taxTotal,
        grandTotal: input.totals.grandTotal,
        depositRequired: input.depositRequired,
        validUntil: input.validUntil,
        customerMessage: input.customerMessage,
        internalNotes: input.internalNotes,
        items: {
          create: input.lines.map((line, position) => ({
            kind: line.kind,
            label: line.label,
            description: line.description,
            requestItemId: line.requestItemId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            lineTotal: line.unitPrice * line.quantity,
            position,
          })),
        },
      },
      select: { id: true, quoteNumber: true, version: true },
    });

    return created;
  });
}

function baseFromQuoteNumber(quoteNumber: string): number {
  const match = /^Q-(\d+)/.exec(quoteNumber);
  return match ? Number(match[1]) : 0;
}

/**
 * Replace a draft's lines and totals.
 *
 * Conditional on the row still being `DRAFT`, so a sent quote cannot be edited
 * even by a request that was in flight when it was sent. That condition is the
 * database's half of 7.2; the service checks first so the admin gets a sentence
 * rather than a silent no-op, and this is what makes it true.
 */
export async function updateDraftQuote(input: {
  quoteId: string;
  lines: readonly DraftQuoteLine[];
  totals: QuoteTotals;
  depositRequired: number;
  validUntil: Date;
  customerMessage: string | null;
  internalNotes: string | null;
}): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.quote.updateMany({
      where: { id: input.quoteId, status: 'DRAFT' },
      data: {
        subtotal: input.totals.subtotal,
        discountTotal: input.totals.discountTotal,
        shippingTotal: input.totals.shippingTotal,
        taxTotal: input.totals.taxTotal,
        grandTotal: input.totals.grandTotal,
        depositRequired: input.depositRequired,
        validUntil: input.validUntil,
        customerMessage: input.customerMessage,
        internalNotes: input.internalNotes,
      },
    });

    if (updated.count === 0) return false;

    await tx.quoteItem.deleteMany({ where: { quoteId: input.quoteId } });
    await tx.quoteItem.createMany({
      data: input.lines.map((line, position) => ({
        quoteId: input.quoteId,
        kind: line.kind,
        label: line.label,
        description: line.description,
        requestItemId: line.requestItemId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal: line.unitPrice * line.quantity,
        position,
      })),
    });

    return true;
  });
}

/* ---------------------------------------------------------------------------
 * Sending
 * ------------------------------------------------------------------------ */

export type SendFailure = { code: 'NOT_DRAFT' } | { code: 'ALREADY_OUTSTANDING' };

/**
 * Send a quote: freeze, supersede, transition, record — or none of it.
 *
 * 7.2.1 requires the freeze to happen **in the same transaction** as the
 * transition to `SENT`, and 7.2.3 explains why the freeze point is send rather
 * than acceptance: a quote is immutable from the moment it is sent, so what it
 * describes must be immutable from that moment too. Freezing later would leave
 * version 1's lines fixed while the configuration underneath them changed,
 * making the version history a record of prices with no record of what was
 * priced.
 *
 * The freeze writes `frozenAt` **and the display snapshots** (ADR-016), so the
 * quote stays readable after the placement is renamed, the thread colour is
 * deactivated or the product is deleted.
 */
export async function sendQuote(input: {
  quoteId: string;
  validUntil: Date;
  actorUserId: string;
  /**
   * Announced inside the send transaction (`ARCHITECTURE.md` section 11), so
   * the quote and the e-mail telling the customer about it either both exist or
   * neither does. Nothing is delivered here.
   */
  onSent?: (context: { tx: Prisma.TransactionClient; validUntil: Date }) => Promise<void>;
}): Promise<{ ok: true; quoteNumber: string } | { ok: false; failure: SendFailure }> {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const quote = await tx.quote.findUniqueOrThrow({
        where: { id: input.quoteId },
        select: {
          id: true,
          status: true,
          requestId: true,
          version: true,
          quoteNumber: true,
        },
      });

      if (quote.status !== 'DRAFT')
        return { ok: false as const, failure: { code: 'NOT_DRAFT' as const } };

      // 7.2: at most one quote per request may be outstanding. The previous
      // version is superseded here rather than left to a later sweep, so the
      // partial unique index below can never see two.
      await tx.quote.updateMany({
        where: {
          requestId: quote.requestId,
          id: { not: quote.id },
          status: { in: [...statusesThatCanReach('SUPERSEDED')] },
        },
        data: { status: 'SUPERSEDED' },
      });

      const sentAt = new Date();

      const sent = await tx.quote.updateMany({
        where: { id: quote.id, status: { in: [...statusesThatCanReach('SENT')] } },
        data: { status: 'SENT', sentAt, validUntil: input.validUntil },
      });

      if (sent.count === 0)
        return { ok: false as const, failure: { code: 'NOT_DRAFT' as const } };

      await freezeConfigurationsForRequest(tx, quote.requestId, sentAt);

      // The request follows the quote: 6.1 QUOTED is reachable from IN_REVIEW,
      // and from QUOTED again when a revision is sent.
      const request = await tx.customRequest.findUniqueOrThrow({
        where: { id: quote.requestId },
        select: { status: true },
      });

      await tx.customRequest.update({
        where: { id: quote.requestId },
        data: { status: 'QUOTED', quotedAt: sentAt, needsInfoReason: null },
      });

      await tx.customRequestEvent.createMany({
        data: [
          {
            requestId: quote.requestId,
            type: 'QUOTE_SENT',
            actorType: 'ADMIN',
            actorUserId: input.actorUserId,
            message: `Devis ${quote.quoteNumber} envoyé.`,
            isCustomerVisible: true,
          },
          {
            requestId: quote.requestId,
            type: 'STATUS_CHANGE',
            fromStatus: request.status,
            toStatus: 'QUOTED',
            actorType: 'ADMIN',
            actorUserId: input.actorUserId,
            isCustomerVisible: true,
          },
        ],
      });

      if (input.onSent) await input.onSent({ tx, validUntil: input.validUntil });

      return { ok: true as const, quoteNumber: quote.quoteNumber };
    });

    return result;
  } catch (error) {
    // Only the partial unique index means "another quote is already
    // outstanding". Anything else is a real failure and must not be reported to
    // an admin as a benign conflict, so it is rethrown.
    if (isUniqueViolation(error)) {
      return { ok: false, failure: { code: 'ALREADY_OUTSTANDING' } };
    }
    throw error;
  }
}

/** Prisma's `P2002`, and PostgreSQL's `23505` underneath it. */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === 'P2002' || code === '23505';
}

/**
 * Freeze every configuration the request's items name (7.2.1, ADR-016).
 *
 * Idempotent: `frozenAt: null` in the filter means a configuration already
 * frozen by an earlier version keeps its original freeze time and snapshots.
 * Version 2 must not rewrite what version 1 recorded.
 */
async function freezeConfigurationsForRequest(
  tx: Prisma.TransactionClient,
  requestId: string,
  frozenAt: Date,
): Promise<void> {
  const items = await tx.customRequestItem.findMany({
    where: { requestId },
    select: {
      customizationConfig: {
        select: {
          id: true,
          frozenAt: true,
          product: { select: { name: true } },
          variant: { select: { sku: true } },
          placement: { select: { name: true } },
          designSurfaceLabel: true,
          embroiderySize: { select: { name: true } },
          font: { select: { name: true } },
          threadColors: {
            select: { threadColor: { select: { name: true } } },
            orderBy: { position: 'asc' },
          },
        },
      },
    },
  });

  for (const item of items) {
    const config = item.customizationConfig;
    if (config.frozenAt) continue;

    await tx.customizationConfig.update({
      where: { id: config.id },
      data: {
        frozenAt,
        // The display snapshots. After this the quote reads correctly even if
        // the placement is renamed or the thread colour is deactivated.
        productNameSnapshot: config.product?.name ?? null,
        /*
         * "Devant · 85 × 43 mm", or the old named zone.
         *
         * Freeform placement (ADR-035) writes its own sentence at submission,
         * so the freeze copies it rather than deriving it a second time. The
         * named-placement branch stays for the configurations that predate the
         * change — a quote sent in 2026 must still read as it did then, which
         * is the whole point of a snapshot (ADR-016).
         */
        placementLabel: config.placement?.name ?? config.designSurfaceLabel ?? null,
        embroiderySizeLabel: config.embroiderySize?.name ?? null,
        fontLabel: config.font?.name ?? null,
        threadColorNames: config.threadColors.map((link) => link.threadColor.name),
      },
    });
  }
}

/* ---------------------------------------------------------------------------
 * Customer responses
 * ------------------------------------------------------------------------ */

export type AcceptFailure =
  | { code: 'NOT_ACCEPTABLE' }
  | { code: 'ALREADY_ACCEPTED'; cartId: string }
  | { code: 'NO_LINES' };

/**
 * Accept a quote, atomically (7.6).
 *
 * One transaction: transition the quote; transition the request; set
 * `acceptanceValidUntil`; create the **quote-bound cart** with every line
 * mapped per 2.6.5, each carrying its `lockedUnitPrice`; write both events.
 * The customer's standard cart is not touched (5A.2).
 *
 * Idempotent and race-safe by the same technique Phase 8 used for placement:
 * the transition is a conditional `updateMany` from the outstanding statuses,
 * so of two simultaneous acceptances exactly one matches a row. The loser finds
 * the quote already `ACCEPTED` and is handed the cart the winner created, which
 * is the same outcome it wanted.
 */
export async function acceptQuote(input: {
  quoteId: string;
  userId: string;
  acceptanceValidUntil: Date;
  /** Quote lines that become cart lines, already mapped by the service. */
  cartLines: readonly {
    kind: 'CUSTOM' | 'FEE';
    quoteItemId: string;
    customizationConfigId: string | null;
    productId: string | null;
    variantId: string | null;
    nameSnapshot: string | null;
    lockedUnitPrice: number;
    quantity: number;
  }[];
  quoteValidUntil: Date;
}): Promise<{ ok: true; cartId: string } | { ok: false; failure: AcceptFailure }> {
  if (input.cartLines.length === 0) return { ok: false, failure: { code: 'NO_LINES' } };

  return prisma.$transaction(async (tx) => {
    const acceptedAt = new Date();

    const claimed = await tx.quote.updateMany({
      where: {
        id: input.quoteId,
        userId: input.userId,
        status: { in: [...statusesThatCanReach('ACCEPTED')] },
        // The expiry check, in the query. A quote whose validity lapsed between
        // the page render and the click must not be acceptable, and a check in
        // JavaScript would have been made before the row was locked.
        validUntil: { gte: acceptedAt },
      },
      data: {
        status: 'ACCEPTED',
        acceptedAt,
        respondedAt: acceptedAt,
        acceptanceValidUntil: input.acceptanceValidUntil,
      },
    });

    if (claimed.count === 0) {
      // Either somebody else won the race, or it was never acceptable. The
      // difference matters: the first is a success the caller should be handed.
      const existing = await tx.quote.findFirst({
        where: { id: input.quoteId, userId: input.userId, status: 'ACCEPTED' },
        select: { cart: { select: { id: true } } },
      });

      if (existing?.cart) {
        return {
          ok: false as const,
          failure: { code: 'ALREADY_ACCEPTED' as const, cartId: existing.cart.id },
        };
      }

      return { ok: false as const, failure: { code: 'NOT_ACCEPTABLE' as const } };
    }

    const quote = await tx.quote.findUniqueOrThrow({
      where: { id: input.quoteId },
      select: {
        requestId: true,
        quoteNumber: true,
        request: { select: { status: true } },
      },
    });

    // 5A: an exclusive cart, bound to this quote, containing exactly its lines.
    const cart = await tx.cart.create({
      data: {
        kind: 'QUOTE_BOUND',
        status: 'ACTIVE',
        userId: input.userId,
        quoteId: input.quoteId,
        quoteValidUntil: input.acceptanceValidUntil,
        items: {
          create: input.cartLines.map((line, position) => ({
            kind: line.kind,
            productId: line.productId,
            variantId: line.variantId,
            customizationConfigId: line.customizationConfigId,
            quoteItemId: line.quoteItemId,
            nameSnapshot: line.nameSnapshot,
            lockedUnitPrice: line.lockedUnitPrice,
            quantity: line.quantity,
            position,
          })),
        },
      },
      select: { id: true },
    });

    await tx.customRequest.update({
      where: { id: quote.requestId },
      data: { status: 'ACCEPTED', respondedAt: acceptedAt },
    });

    await tx.customRequestEvent.createMany({
      data: [
        {
          requestId: quote.requestId,
          type: 'STATUS_CHANGE',
          fromStatus: quote.request.status,
          toStatus: 'ACCEPTED',
          actorType: 'CUSTOMER',
          actorUserId: input.userId,
          message: `Devis ${quote.quoteNumber} accepté.`,
          isCustomerVisible: true,
        },
      ],
    });

    return { ok: true as const, cartId: cart.id };
  });
}

/** 7.8: rejection may capture a reason. The quote is never deleted. */
export async function declineQuote(input: {
  quoteId: string;
  userId: string;
  reason: string | null;
}): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const rejectedAt = new Date();

    const declined = await tx.quote.updateMany({
      where: {
        id: input.quoteId,
        userId: input.userId,
        status: { in: [...statusesThatCanReach('ACCEPTED')] },
      },
      data: {
        status: 'REJECTED',
        rejectedAt,
        respondedAt: rejectedAt,
        rejectionReason: input.reason,
      },
    });

    if (declined.count === 0) return false;

    const quote = await tx.quote.findUniqueOrThrow({
      where: { id: input.quoteId },
      select: {
        requestId: true,
        quoteNumber: true,
        request: { select: { status: true } },
      },
    });

    await tx.customRequest.update({
      where: { id: quote.requestId },
      data: { status: 'REJECTED', respondedAt: rejectedAt },
    });

    await tx.customRequestEvent.create({
      data: {
        requestId: quote.requestId,
        type: 'STATUS_CHANGE',
        fromStatus: quote.request.status,
        toStatus: 'REJECTED',
        actorType: 'CUSTOMER',
        actorUserId: input.userId,
        message: input.reason
          ? `Devis ${quote.quoteNumber} refusé : ${input.reason}`
          : `Devis ${quote.quoteNumber} refusé.`,
        isCustomerVisible: true,
      },
    });

    return true;
  });
}

/* ---------------------------------------------------------------------------
 * Expiry sweeps (7.4, 7.10.2)
 * ------------------------------------------------------------------------ */

/**
 * Expire outstanding quotes past their validity.
 *
 * The scheduled half of 7.4. The lazy half lives in `domain/quote`, so a
 * stalled job cannot make an expired quote acceptable — this only makes the
 * stored rows agree with what every reader already computes.
 */
export async function expireOutstandingQuotes(now: Date = new Date()): Promise<number> {
  const expired = await prisma.quote.updateMany({
    where: {
      status: { in: [...statusesThatCanReach('EXPIRED')] },
      validUntil: { lt: now },
    },
    data: { status: 'EXPIRED' },
  });

  return expired.count;
}

/** 7.10.2: an accepted quote's cart is invalidated once acceptance lapses. */
export async function invalidateLapsedQuoteCarts(
  now: Date = new Date(),
): Promise<number> {
  const invalidated = await prisma.cart.updateMany({
    where: {
      kind: 'QUOTE_BOUND',
      status: 'ACTIVE',
      quoteValidUntil: { lt: now },
    },
    data: { status: 'INVALIDATED' },
  });

  return invalidated.count;
}

export type RequestStatusUpdate = {
  requestId: string;
  from: RequestStatus;
  to: RequestStatus;
  actorUserId: string | null;
  actorType: 'CUSTOMER' | 'ADMIN' | 'SYSTEM';
  needsInfoReason?: string | null;
  message?: string | null;
};

/**
 * Move a request, conditionally on it still being where the caller thought.
 *
 * 6.4: no code sets `status` without going through the transition function, and
 * every transition writes an event. The `status: from` filter is what makes a
 * concurrent second transition fail rather than overwrite.
 */
export async function applyRequestTransition(
  input: RequestStatusUpdate,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const moved = await tx.customRequest.updateMany({
      where: { id: input.requestId, status: input.from },
      data: {
        status: input.to,
        needsInfoReason:
          input.to === 'NEEDS_INFO' ? (input.needsInfoReason ?? null) : null,
        ...(input.to === 'IN_REVIEW' ? { reviewedAt: new Date() } : {}),
      },
    });

    if (moved.count === 0) return false;

    await tx.customRequestEvent.create({
      data: {
        requestId: input.requestId,
        type: 'STATUS_CHANGE',
        fromStatus: input.from,
        toStatus: input.to,
        actorType: input.actorType,
        actorUserId: input.actorUserId,
        message: input.message ?? input.needsInfoReason ?? null,
        isCustomerVisible: true,
      },
    });

    return true;
  });
}

/** 6.7.2: a message is a message. It never touches the status. */
export async function addRequestMessage(input: {
  requestId: string;
  actorType: 'CUSTOMER' | 'ADMIN';
  actorUserId: string | null;
  message: string;
  internal: boolean;
}): Promise<void> {
  await prisma.customRequestEvent.create({
    data: {
      requestId: input.requestId,
      type: input.internal ? 'INTERNAL_NOTE' : 'MESSAGE',
      actorType: input.actorType,
      actorUserId: input.actorUserId,
      message: input.message,
      // An internal note never leaves the admin (DATABASE.md section 15).
      isCustomerVisible: !input.internal,
    },
  });
}

/* ---------------------------------------------------------------------------
 * Phase 8's read
 * ------------------------------------------------------------------------ */

export type AcceptedQuoteTotals = {
  id: string;
  quoteNumber: string;
  status: string;
  subtotal: number;
  discountTotal: number;
  /** 4.6 / 5A.3: this supersedes rate resolution entirely. */
  shippingTotal: number;
  taxTotal: number;
  /** 5A.6: the reconstructed order total must equal this exactly. */
  grandTotal: number;
  /** 5.5.1: copied onto the order, never recomputed. */
  depositRequired: number;
  acceptanceValidUntil: Date | null;
};

/**
 * The parts of an accepted quote a checkout needs.
 *
 * Unchanged from Phase 8, which introduced it before quotes could be created.
 * Now that they can, the same function serves a real accepted quote.
 */
export async function loadQuoteTotals(
  quoteId: string,
): Promise<AcceptedQuoteTotals | null> {
  return prisma.quote.findUnique({
    where: { id: quoteId },
    select: {
      id: true,
      quoteNumber: true,
      status: true,
      subtotal: true,
      discountTotal: true,
      shippingTotal: true,
      taxTotal: true,
      grandTotal: true,
      depositRequired: true,
      acceptanceValidUntil: true,
    },
  });
}

/* ---------------------------------------------------------------------------
 * Binding a quote to its customer and its configurations
 * ------------------------------------------------------------------------ */

/**
 * The account an email address belongs to, if any.
 *
 * `quotes.userId` is NOT NULL and 7.5 gives acceptance to the owning customer,
 * but a Phase 7 request may be a guest's. Pricing one therefore binds it to the
 * account whose address it names — the same "claim by verified email" rule
 * `DATABASE.md` section 15 gives for orders. Deleted and suspended accounts are
 * excluded: a quote nobody may sign in to accept is not a quote.
 */
export async function findUserIdByEmail(email: string): Promise<string | null> {
  const row = await prisma.user.findFirst({
    // Case-insensitively: the builder takes the address as the customer typed
    // it, and the account was created from whatever they typed on the day.
    where: { email: { equals: email.trim(), mode: 'insensitive' }, status: 'ACTIVE' },
    select: { id: true },
  });

  return row?.id ?? null;
}

export type RequestItemBinding = {
  requestItemId: string;
  customizationConfigId: string;
  productId: string | null;
  variantId: string | null;
  quantity: number;
};

/**
 * What a request's items point at, for the acceptance mapping.
 *
 * 2.6.5 says a `PRODUCT` line "carries the frozen `customizationConfigId`", and
 * `cart_items_custom_check` makes that a database requirement rather than a
 * preference. So the binding is read here, by request item, and a quote line
 * that names one uses its configuration rather than the request's first.
 */
export async function findRequestItemBindings(
  requestId: string,
): Promise<readonly RequestItemBinding[]> {
  const rows = await prisma.customRequestItem.findMany({
    where: { requestId },
    select: {
      id: true,
      quantity: true,
      customizationConfigId: true,
      customizationConfig: { select: { productId: true, variantId: true } },
    },
    orderBy: { position: 'asc' },
  });

  return rows.map((row) => ({
    requestItemId: row.id,
    customizationConfigId: row.customizationConfigId,
    productId: row.customizationConfig.productId,
    variantId: row.customizationConfig.variantId,
    quantity: row.quantity,
  }));
}

/* ---------------------------------------------------------------------------
 * Cancellation
 * ------------------------------------------------------------------------ */

/**
 * 7.1: `DRAFT`, `SENT` and `VIEWED` may all be cancelled by the business.
 *
 * Conditional on the quote still being in one of them, so a quote the customer
 * accepted a moment ago cannot be cancelled out from under them.
 */
export async function cancelQuote(input: {
  quoteId: string;
  actorUserId: string;
}): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const quote = await tx.quote.findUnique({
      where: { id: input.quoteId },
      select: { requestId: true, quoteNumber: true, status: true },
    });

    if (!quote) return false;

    const cancelled = await tx.quote.updateMany({
      where: {
        id: input.quoteId,
        status: { in: [...statusesThatCanReach('CANCELLED')] },
      },
      data: { status: 'CANCELLED' },
    });

    if (cancelled.count === 0) return false;

    // Cancelling the quote the customer was looking at puts the request back in
    // the admin's hands. A cancelled draft was never in front of anyone, so the
    // request has not moved and nothing needs saying.
    if (quote.status === 'SENT' || quote.status === 'VIEWED') {
      const moved = await tx.customRequest.updateMany({
        where: { id: quote.requestId, status: 'QUOTED' },
        data: { status: 'IN_REVIEW', quotedAt: null },
      });

      if (moved.count > 0) {
        await tx.customRequestEvent.create({
          data: {
            requestId: quote.requestId,
            type: 'STATUS_CHANGE',
            fromStatus: 'QUOTED',
            toStatus: 'IN_REVIEW',
            actorType: 'ADMIN',
            actorUserId: input.actorUserId,
            message: `Devis ${quote.quoteNumber} annulé.`,
            isCustomerVisible: true,
          },
        });
      }
    }

    return true;
  });
}

/* ---------------------------------------------------------------------------
 * The lazy half of 7.10.2
 * ------------------------------------------------------------------------ */

/**
 * Invalidate one quote-bound cart whose acceptance window has lapsed.
 *
 * 7.10.2 requires the rule to be enforced "two ways — a scheduled job and a
 * lazy check on every read — so correctness never depends on the job having
 * run". `invalidateLapsedQuoteCarts` is the job; this is the lazy half, called
 * on the path that would otherwise let a lapsed cart be checked out.
 */
export async function invalidateQuoteBoundCart(cartId: string): Promise<void> {
  await prisma.cart.updateMany({
    where: { id: cartId, kind: 'QUOTE_BOUND', status: 'ACTIVE' },
    data: { status: 'INVALIDATED' },
  });
}

/* ---------------------------------------------------------------------------
 * The admin queues
 * ------------------------------------------------------------------------ */

export type StaffQuoteSummary = {
  /** The row's identity, for the list's own selection checkbox. */
  id: string;
  quoteNumber: string;
  version: number;
  status: QuoteStatus;
  requestNumber: string;
  customerName: string | null;
  customerEmail: string;
  grandTotal: number;
  currency: string;
  validUntil: Date;
  acceptanceValidUntil: Date | null;
  sentAt: Date | null;
  /** The cart acceptance produced, when it exists and is still live. */
  hasLiveCart: boolean;
};

/**
 * Quotes that are somebody's move.
 *
 * Drafts are excluded: an unfinished quote is not a queue, it is a document the
 * admin is still writing, and it lives on its request's workspace.
 */
export async function listOutstandingQuotesForStaff(input: {
  limit?: number;
  archived?: boolean;
}): Promise<readonly StaffQuoteSummary[]> {
  const rows = await prisma.quote.findMany({
    where: {
      ...archiveWhere(input.archived),
      /*
       * The archived half is listed whatever its status.
       *
       * The live queue is "somebody's move" — sent, viewed, accepted. The
       * archived view is "what I put away", and filtering it by those same
       * three statuses would hide most of what was archived from the only
       * screen that can bring it back.
       */
      ...(input.archived ? {} : { status: { in: ['SENT', 'VIEWED', 'ACCEPTED'] } }),
    },
    select: {
      id: true,
      quoteNumber: true,
      version: true,
      status: true,
      grandTotal: true,
      currency: true,
      validUntil: true,
      acceptanceValidUntil: true,
      sentAt: true,
      request: { select: { requestNumber: true } },
      user: { select: { name: true, email: true } },
      cart: { select: { status: true } },
    },
    orderBy: { validUntil: 'asc' },
    take: input.limit ?? 50,
  });

  return rows.map((row) => ({
    id: row.id,
    quoteNumber: row.quoteNumber,
    version: row.version,
    status: row.status as QuoteStatus,
    requestNumber: row.request.requestNumber,
    customerName: row.user.name,
    customerEmail: row.user.email,
    grandTotal: row.grandTotal,
    currency: row.currency,
    validUntil: row.validUntil,
    acceptanceValidUntil: row.acceptanceValidUntil,
    sentAt: row.sentAt,
    hasLiveCart: row.cart?.status === 'ACTIVE',
  }));
}

/* ---------------------------------------------------------------------------
 * The expiry warning sweep (Phase 8A)
 * ------------------------------------------------------------------------ */

export type ExpiringQuoteRow = {
  quoteId: string;
  quoteNumber: string;
  userId: string;
  customerName: string | null;
  customerEmail: string;
  requestNumber: string;
  currency: string;
  grandTotal: number;
  validUntil: Date;
};

/**
 * Outstanding quotes whose validity ends inside the window.
 *
 * `SENT` and `VIEWED` only — the two statuses 7.5 calls acceptable — and
 * strictly in the future, because a warning that arrives after the deadline is
 * worse than none. The window itself is the caller's, from
 * `domain/notification`; this is the query, not the policy.
 *
 * The recipient comes from the quote's **owner**, which is the account 7.5
 * gives acceptance to. There is no address in a payload anywhere near this.
 */
export async function listQuotesExpiringWithin(input: {
  from: Date;
  until: Date;
  limit?: number;
}): Promise<readonly ExpiringQuoteRow[]> {
  const rows = await prisma.quote.findMany({
    where: {
      status: { in: ['SENT', 'VIEWED'] },
      validUntil: { gt: input.from, lte: input.until },
    },
    select: {
      id: true,
      quoteNumber: true,
      userId: true,
      currency: true,
      grandTotal: true,
      validUntil: true,
      request: { select: { requestNumber: true } },
      user: { select: { name: true, email: true } },
    },
    orderBy: { validUntil: 'asc' },
    take: input.limit ?? 100,
  });

  return rows.map((row) => ({
    quoteId: row.id,
    quoteNumber: row.quoteNumber,
    userId: row.userId,
    customerName: row.user.name,
    customerEmail: row.user.email,
    requestNumber: row.request.requestNumber,
    currency: row.currency,
    grandTotal: row.grandTotal,
    validUntil: row.validUntil,
  }));
}
