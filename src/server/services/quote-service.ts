import 'server-only';

import { z } from 'zod';

import { toPublicAssetUrl } from '@/lib/media/public-asset';
import { depositFor } from '@/domain/order/deposit';
import {
  acceptanceValidUntilFrom,
  isAcceptable,
  isCheckoutValid,
  isEditable,
  validUntilFrom,
  type QuoteStatus,
} from '@/domain/quote';
import {
  QUOTE_LINE_ERROR_LABELS,
  SENDABILITY_ERROR_LABELS,
  hasProductionLine,
  quoteTotals,
  validateQuoteLines,
  validateSendable,
  type QuoteLineInput,
} from '@/domain/quote/pricing';
import { validateRequestTransition, type RequestStatus } from '@/domain/request';
import {
  acceptQuote,
  addRequestMessage,
  applyRequestTransition,
  cancelQuote,
  createDraftQuote,
  declineQuote,
  findQuoteForOwner,
  findQuoteForStaff,
  findRequestItemBindings,
  findUserIdByEmail,
  listQuotesForOwner,
  listQuotesForRequest,
  markViewedByOwner,
  sendQuote,
  updateDraftQuote,
  type DraftQuoteLine,
  type QuoteRecord,
  type RequestItemBinding,
  type StaffQuoteRecord,
} from '@/server/repositories/quote-repository';
import { notifyQuoteSent } from '@/server/services/notification-service';
import { findQuoteOwnerContact } from '@/server/repositories/user-repository';
import {
  attachRequestToUser,
  findRequestForOwner,
  findRequestForStaff,
  type RequestDetail,
} from '@/server/repositories/request-repository';
import { loadQuoteSettings } from '@/server/repositories/settings-repository';

/**
 * The quote use cases.
 *
 * Everything a quote is worth is in three invariants, and each is enforced in
 * exactly one place:
 *
 *   **Totals are derived, never supplied.** An admin sends *lines*; the totals
 *   come from `domain/quote/pricing.quoteTotals`. There is no field in any
 *   schema here for a subtotal, a grand total or a deposit, so none can arrive
 *   from a browser — the same technique Phases 7, 8 and 9 used.
 *
 *   **A sent quote is immutable** (7.2). Editing checks `isEditable` first, and
 *   the repository's `updateMany` is conditional on `status: 'DRAFT'`, so even
 *   a request already in flight when the quote was sent cannot change it.
 *
 *   **Only the owner accepts** (7.5, 12.3), only while the quote is valid, and
 *   acceptance is one transaction that also creates the quote-bound cart (7.6).
 */

/* ---------------------------------------------------------------------------
 * Input
 * ------------------------------------------------------------------------ */

const QUOTE_LINE = z.object({
  kind: z.enum([
    'PRODUCT',
    'EMBROIDERY',
    'SETUP_FEE',
    'DIGITIZING',
    'RUSH_FEE',
    'SHIPPING',
    'DISCOUNT',
    'OTHER',
  ]),
  label: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500).nullable().default(null),
  quantity: z.number().int().min(1).max(9_999),
  /** Minor units. Negative only on a DISCOUNT line, checked by the domain. */
  unitPrice: z.number().int().min(-100_000_000).max(100_000_000),
  /**
   * Which of the request's items this line prices, so acceptance can attach the
   * frozen configuration (2.6.5). An id is not money, but it is still checked
   * against **this** request's items before it is stored — a foreign id would
   * otherwise bind a customer's quote line to somebody else's configuration.
   */
  requestItemId: z.uuid().nullable().default(null),
});

/**
 * The draft payload.
 *
 * Note what is **absent**: `subtotal`, `discountTotal`, `shippingTotal`,
 * `grandTotal`, `depositRequired`, `status`, `quoteNumber`, `version`. Every
 * one is derived. A payload carrying them fails to parse rather than being
 * ignored.
 */
export const quoteDraftInput = z.object({
  requestNumber: z.string().min(1).max(50),
  lines: z.array(QUOTE_LINE).min(1).max(30),
  customerMessage: z.string().trim().max(2_000).nullable().default(null),
  internalNotes: z.string().trim().max(2_000).nullable().default(null),
  /** Days from now. Defaults to the settings value; an admin may shorten it. */
  validityDays: z.number().int().min(1).max(90).optional(),
});

export type QuoteDraftInput = z.infer<typeof quoteDraftInput>;

export type QuoteError =
  | { code: 'REQUEST_NOT_FOUND'; message: string }
  | { code: 'QUOTE_NOT_FOUND'; message: string }
  | { code: 'INVALID_INPUT'; message: string }
  | { code: 'NOT_EDITABLE'; message: string }
  | { code: 'NOT_SENDABLE'; message: string }
  | { code: 'NOT_ACCEPTABLE'; message: string }
  | { code: 'NO_CUSTOMER'; message: string }
  | { code: 'INVALID_TRANSITION'; message: string };

export type QuoteResult<T> = { ok: true; value: T } | { ok: false; error: QuoteError };

function fail(code: QuoteError['code'], message: string): QuoteResult<never> {
  return { ok: false, error: { code, message } as QuoteError };
}

/* ---------------------------------------------------------------------------
 * Suggesting lines
 * ------------------------------------------------------------------------ */

export type SuggestedLine = DraftQuoteLine;

/**
 * A starting point, not an answer.
 *
 * 2.6.1: "the system supplies a **suggested** set of lines derived from the
 * configuration; the admin may change every value." So this reads the request's
 * own estimate — which Phase 7 already computed from the documented formula —
 * and lays it out as lines. Nothing here is authoritative; the admin's typed
 * numbers are.
 */
export async function suggestQuoteLines(
  requestNumber: string,
): Promise<QuoteResult<readonly SuggestedLine[]>> {
  const request = await findRequestForStaff(requestNumber);
  if (!request) return fail('REQUEST_NOT_FOUND', 'Demande introuvable.');

  const lines: SuggestedLine[] = [];

  for (const item of request.items) {
    const config = item.customizationConfig;
    const name =
      config.productNameSnapshot ?? config.product?.name ?? 'Pièce personnalisée';

    // The estimate is per line and non-binding (2.4.3). Dividing it by the
    // quantity gives a per-unit figure to start from; the admin replaces it.
    const perUnit =
      config.estimateMin && item.quantity > 0
        ? Math.round(config.estimateMin / item.quantity)
        : (config.product?.basePrice ?? 0);

    const placement = config.placementLabel ?? config.placement?.name ?? null;

    lines.push({
      kind: 'PRODUCT',
      label: placement ? `${name} — ${placement}` : name,
      quantity: item.quantity,
      unitPrice: perUnit,
      description: config.embroideryText ? `Texte : ${config.embroideryText}` : null,
      requestItemId: item.id,
    });
  }

  return { ok: true, value: lines };
}

/* ---------------------------------------------------------------------------
 * Drafting
 * ------------------------------------------------------------------------ */

type PricedDraft = {
  lines: readonly DraftQuoteLine[];
  totals: ReturnType<typeof quoteTotals>;
  depositRequired: number;
  validUntil: Date;
};

/**
 * Price a set of lines.
 *
 * Everything about money is computed here from the lines and the settings, and
 * `bindings` is the guard on the one identifier the payload is allowed to
 * carry: a `requestItemId` that is not one of **this** request's items is
 * rejected rather than stored, so a quote line cannot be pointed at another
 * customer's configuration.
 */
async function priceDraft(
  lines: readonly DraftQuoteLine[],
  validityDays: number | undefined,
  bindings: readonly RequestItemBinding[],
): Promise<QuoteResult<PricedDraft>> {
  const allowed = new Set(bindings.map((binding) => binding.requestItemId));

  for (const [index, line] of lines.entries()) {
    if (line.requestItemId !== null && !allowed.has(line.requestItemId)) {
      return fail('INVALID_INPUT', `Ligne ${index + 1} : article de demande inconnu.`);
    }
  }

  const checked = validateQuoteLines(lines);
  if (!checked.ok) {
    return fail(
      'INVALID_INPUT',
      `Ligne ${checked.error.index + 1} : ${QUOTE_LINE_ERROR_LABELS[checked.error.code]}`,
    );
  }

  const settings = await loadQuoteSettings();
  const totals = quoteTotals(lines);

  // 5.5: the deposit is the documented percentage of the grand total, in basis
  // points, and the quote carries it so acceptance can copy it (5.5.1).
  const depositRequired = depositFor({
    quoteDepositRequired: null,
    hasCustomLine: hasProductionLine(lines),
    isPrepaidMethod: false,
    grandTotal: totals.grandTotal,
    depositPercentBasisPoints: settings.depositPercentBasisPoints,
  });

  const validUntil = validUntilFrom(
    new Date(),
    validityDays ?? settings.quoteValidityDays,
  );

  return { ok: true, value: { lines, totals, depositRequired, validUntil } };
}

export async function createQuoteDraft(
  raw: unknown,
  staffUserId: string,
): Promise<QuoteResult<{ quoteId: string; quoteNumber: string; version: number }>> {
  const parsed = quoteDraftInput.safeParse(raw);
  if (!parsed.success) return fail('INVALID_INPUT', 'Devis invalide.');

  const request = await findRequestForStaff(parsed.data.requestNumber);
  if (!request) return fail('REQUEST_NOT_FOUND', 'Demande introuvable.');

  /**
   * A quote needs an owner. `quotes.userId` is NOT NULL and 7.5 gives
   * acceptance to the owning customer, but a Phase 7 request may be a guest's —
   * the builder never asked anyone to sign in. So the request is bound to the
   * account matching the email it carries, which is the same "claim by verified
   * email" rule `DATABASE.md` section 15 gives for orders. Without such an
   * account there is nobody who could accept, and the admin is told so.
   */
  const userId =
    request.userId ??
    (request.contactEmail ? await findUserIdByEmail(request.contactEmail) : null);

  if (!userId) {
    return fail(
      'NO_CUSTOMER',
      'Cette demande n’est rattachée à aucun compte client. Le client doit créer un compte avec ' +
        'l’adresse indiquée avant de pouvoir recevoir un devis.',
    );
  }

  if (!request.userId) await attachRequestToUser({ requestId: request.id, userId });

  const bindings = await findRequestItemBindings(request.id);

  const priced = await priceDraft(parsed.data.lines, parsed.data.validityDays, bindings);
  if (!priced.ok) return priced;

  // 7.2: a revision supersedes its predecessor and reuses its base number.
  const existing = await listQuotesForRequest(request.id);
  const previous = existing.find(
    (quote) => quote.status === 'SENT' || quote.status === 'VIEWED',
  );

  const created = await createDraftQuote({
    requestId: request.id,
    userId,
    createdByUserId: staffUserId,
    currency: request.items[0]?.customizationConfig.product?.currency ?? 'DZD',
    lines: priced.value.lines,
    totals: priced.value.totals,
    depositRequired: priced.value.depositRequired,
    validUntil: priced.value.validUntil,
    customerMessage: parsed.data.customerMessage,
    internalNotes: parsed.data.internalNotes,
    supersedesQuoteId: previous?.id ?? null,
  });

  return {
    ok: true,
    value: {
      quoteId: created.id,
      quoteNumber: created.quoteNumber,
      version: created.version,
    },
  };
}

export async function updateQuoteDraft(
  quoteId: string,
  raw: unknown,
): Promise<QuoteResult<{ quoteId: string }>> {
  const parsed = quoteDraftInput.omit({ requestNumber: true }).safeParse(raw);
  if (!parsed.success) return fail('INVALID_INPUT', 'Devis invalide.');

  const quote = await findQuoteForStaff(quoteId);
  if (!quote) return fail('QUOTE_NOT_FOUND', 'Devis introuvable.');

  // 7.2, checked here so the admin sees a sentence, and again in the query so
  // it is true even if the quote is sent between these two lines.
  if (!isEditable(quote.status)) {
    return fail(
      'NOT_EDITABLE',
      'Ce devis a été envoyé et ne peut plus être modifié. Créez une nouvelle version.',
    );
  }

  const bindings = await findRequestItemBindings(quote.requestId);

  const priced = await priceDraft(parsed.data.lines, parsed.data.validityDays, bindings);
  if (!priced.ok) return priced;

  const updated = await updateDraftQuote({
    quoteId,
    lines: priced.value.lines,
    totals: priced.value.totals,
    depositRequired: priced.value.depositRequired,
    validUntil: priced.value.validUntil,
    customerMessage: parsed.data.customerMessage,
    internalNotes: parsed.data.internalNotes,
  });

  if (!updated) {
    return fail('NOT_EDITABLE', 'Ce devis a été envoyé et ne peut plus être modifié.');
  }

  return { ok: true, value: { quoteId } };
}

/* ---------------------------------------------------------------------------
 * Sending
 * ------------------------------------------------------------------------ */

export async function sendQuoteToCustomer(
  quoteId: string,
  staffUserId: string,
): Promise<QuoteResult<{ quoteNumber: string }>> {
  const quote = await findQuoteForStaff(quoteId);
  if (!quote) return fail('QUOTE_NOT_FOUND', 'Devis introuvable.');

  if (!isEditable(quote.status)) {
    return fail('NOT_SENDABLE', 'Ce devis a déjà été envoyé.');
  }

  const lines: QuoteLineInput[] = quote.items.map((item) => ({
    kind: item.kind as QuoteLineInput['kind'],
    label: item.label,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
  }));

  // 2.6.3, re-checked at the moment of sending rather than only at drafting:
  // a draft written a fortnight ago may now have a `validUntil` in the past.
  const settings = await loadQuoteSettings();
  const validUntil = validUntilFrom(new Date(), settings.quoteValidityDays);

  const sendable = validateSendable({
    lines,
    totals: quoteTotals(lines),
    validUntil,
  });

  // The address the quote is sent to is its **owner's**, which 7.5 makes the
  // only account that may accept it. Nothing in the payload routes anything.
  const owner = await findQuoteOwnerContact(quote.userId);
  const customerName = owner?.name ?? null;
  const customerEmail = owner?.email ?? null;

  if (!customerEmail) {
    return fail('NOT_SENDABLE', 'Le compte client de ce devis n’a pas d’adresse e-mail.');
  }

  if (!sendable.ok) {
    return fail('NOT_SENDABLE', SENDABILITY_ERROR_LABELS[sendable.error.code]);
  }

  const sent = await sendQuote({
    quoteId,
    validUntil,
    actorUserId: staffUserId,
    /**
     * 8A: the customer is told inside the send transaction (section 11). The
     * payload is the quote's own immutable content — a sent quote never changes
     * (7.2), so the e-mail and the quote page can never disagree.
     */
    onSent: async ({ tx, validUntil: deadline }) => {
      if (!quote.request) return;

      await notifyQuoteSent(
        {
          quoteId,
          quoteNumber: quote.quoteNumber,
          version: quote.version,
          userId: quote.userId,
          contactName: customerName ?? 'client',
          contactEmail: customerEmail,
          requestNumber: quote.request.requestNumber,
          currency: quote.currency,
          grandTotal: quote.grandTotal,
          depositRequired: quote.depositRequired,
          validUntil: deadline,
          customerMessage: quote.customerMessage,
          lines: quote.items.map((item) => ({
            label: item.label,
            quantity: item.quantity,
            lineTotal: item.lineTotal,
          })),
        },
        tx,
      );
    },
  });

  if (!sent.ok) {
    return fail(
      'NOT_SENDABLE',
      sent.failure.code === 'ALREADY_OUTSTANDING'
        ? 'Un autre devis est déjà en attente pour cette demande.'
        : 'Ce devis a déjà été envoyé.',
    );
  }

  return { ok: true, value: { quoteNumber: sent.quoteNumber } };
}

/* ---------------------------------------------------------------------------
 * The customer's side
 * ------------------------------------------------------------------------ */

export type CustomerQuoteView = {
  quoteNumber: string;
  version: number;
  status: QuoteStatus;
  requestNumber: string;
  currency: string;
  lines: readonly {
    kind: string;
    label: string;
    description: string | null;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }[];
  subtotal: number;
  discountTotal: number;
  shippingTotal: number;
  grandTotal: number;
  depositRequired: number;
  validUntil: Date;
  acceptanceValidUntil: Date | null;
  customerMessage: string | null;
  rejectionReason: string | null;
  acceptable: boolean;
  /** The quote-bound cart acceptance created, when it is still redeemable. */
  checkout: { cartId: string; validUntil: Date | null } | null;
  /** 7.10.1: accepted, but the redemption window has closed. */
  acceptanceLapsed: boolean;
};

/**
 * A quote as its owner sees it.
 *
 * `internalNotes` is not in the projection at all, and the status shown is the
 * **effective** one — a quote whose validity lapsed reads as expired even if
 * the hourly job has not run yet (7.4).
 */
export function toCustomerView(quote: QuoteRecord, now = new Date()): CustomerQuoteView {
  const acceptable = isAcceptable({
    status: quote.status,
    validUntil: quote.validUntil,
    now,
  });

  // 7.10.1, the lazy half: the cart is checkout-valid only inside the
  // acceptance window, whether or not the sweep has run. The cart row may still
  // read ACTIVE; this is what decides.
  const redeemable =
    isCheckoutValid({
      status: quote.status,
      acceptanceValidUntil: quote.acceptanceValidUntil,
      now,
    }) && quote.cart?.status === 'ACTIVE';

  return {
    quoteNumber: quote.quoteNumber,
    version: quote.version,
    status: acceptable
      ? quote.status
      : quote.status === 'SENT' || quote.status === 'VIEWED'
        ? 'EXPIRED'
        : quote.status,
    requestNumber: quote.request.requestNumber,
    currency: quote.currency,
    lines: quote.items.map((item) => ({
      kind: item.kind,
      label: item.label,
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
    })),
    subtotal: quote.subtotal,
    discountTotal: quote.discountTotal,
    shippingTotal: quote.shippingTotal,
    grandTotal: quote.grandTotal,
    depositRequired: quote.depositRequired,
    validUntil: quote.validUntil,
    acceptanceValidUntil: quote.acceptanceValidUntil,
    customerMessage: quote.customerMessage,
    rejectionReason: quote.rejectionReason,
    acceptable,
    checkout:
      redeemable && quote.cart
        ? { cartId: quote.cart.id, validUntil: quote.acceptanceValidUntil }
        : null,
    acceptanceLapsed: quote.status === 'ACCEPTED' && !redeemable,
  };
}

/** One quote line as it becomes a quote-bound cart line (2.6.5). */
type CartLineDraft = {
  kind: 'CUSTOM' | 'FEE';
  quoteItemId: string;
  customizationConfigId: string | null;
  productId: string | null;
  variantId: string | null;
  nameSnapshot: string | null;
  lockedUnitPrice: number;
  quantity: number;
};

/** Load a quote for its owner, marking it `VIEWED` the first time (7.3). */
export async function viewQuoteAsOwner(input: {
  quoteNumber: string;
  userId: string;
}): Promise<QuoteResult<CustomerQuoteView>> {
  const quote = await findQuoteForOwner(input);
  if (!quote) return fail('QUOTE_NOT_FOUND', 'Devis introuvable.');

  if (quote.status === 'SENT') {
    await markViewedByOwner({ quoteId: quote.id, userId: input.userId });
  }

  return { ok: true, value: toCustomerView(quote) };
}

/**
 * Accept a quote (7.6).
 *
 * The mapping to cart lines is 2.6.5's, applied here: `PRODUCT` and
 * `EMBROIDERY` lines become `CUSTOM` cart lines carrying the frozen
 * configuration; the fee kinds become `FEE` lines; `SHIPPING` and `DISCOUNT`
 * become totals on the order and are deliberately **not** cart lines — Phase 8
 * reads them from the quote itself, so mapping them here would charge them
 * twice.
 */
export async function acceptQuoteAsOwner(input: {
  quoteNumber: string;
  userId: string;
}): Promise<QuoteResult<{ cartId: string; alreadyAccepted: boolean }>> {
  const quote = await findQuoteForOwner(input);
  if (!quote) return fail('QUOTE_NOT_FOUND', 'Devis introuvable.');

  const settings = await loadQuoteSettings();
  const bindings = await findRequestItemBindings(quote.requestId);
  const byRequestItem = new Map(
    bindings.map((binding) => [binding.requestItemId, binding]),
  );
  const fallback = bindings[0] ?? null;

  const cartLines: CartLineDraft[] = [];

  for (const item of quote.items) {
    // 2.6.5: SHIPPING becomes `orders.shippingTotal` and DISCOUNT becomes
    // `orders.discountTotal`. Neither is an item, and Phase 8 reads both from
    // the quote — mapping them here would charge them a second time.
    if (item.kind === 'SHIPPING' || item.kind === 'DISCOUNT') continue;

    const isProductLine = item.kind === 'PRODUCT' || item.kind === 'EMBROIDERY';

    if (!isProductLine) {
      cartLines.push({
        kind: 'FEE',
        quoteItemId: item.id,
        customizationConfigId: null,
        productId: null,
        variantId: null,
        nameSnapshot: item.label,
        lockedUnitPrice: item.unitPrice,
        quantity: item.quantity,
      });
      continue;
    }

    /**
     * A `CUSTOM` line must name a configuration — `cart_items_custom_check`
     * requires it, and 2.6.5 says the line "carries the frozen
     * `customizationConfigId`". The line's own `requestItemId` is the binding;
     * a line the admin typed without one falls back to the request's first
     * item, which is what a single-item request means. If neither resolves,
     * acceptance is refused with a sentence rather than crashing on the
     * constraint halfway through the transaction.
     */
    const binding = item.requestItemId
      ? (byRequestItem.get(item.requestItemId) ?? null)
      : fallback;

    if (!binding) {
      return fail(
        'NOT_ACCEPTABLE',
        'Ce devis ne peut pas être accepté : une ligne ne référence aucune personnalisation. Contactez-nous.',
      );
    }

    cartLines.push({
      kind: 'CUSTOM',
      quoteItemId: item.id,
      customizationConfigId: binding.customizationConfigId,
      productId: binding.productId,
      variantId: binding.variantId,
      nameSnapshot: item.label,
      lockedUnitPrice: item.unitPrice,
      quantity: item.quantity,
    });
  }

  const accepted = await acceptQuote({
    quoteId: quote.id,
    userId: input.userId,
    acceptanceValidUntil: acceptanceValidUntilFrom(
      new Date(),
      settings.acceptanceValidityDays,
    ),
    cartLines,
    quoteValidUntil: quote.validUntil,
  });

  if (accepted.ok) {
    return { ok: true, value: { cartId: accepted.cartId, alreadyAccepted: false } };
  }

  // Idempotency: a second acceptance is not an error, it is the same outcome.
  if (accepted.failure.code === 'ALREADY_ACCEPTED') {
    return {
      ok: true,
      value: { cartId: accepted.failure.cartId, alreadyAccepted: true },
    };
  }

  return fail(
    'NOT_ACCEPTABLE',
    'Ce devis ne peut plus être accepté. Il a peut-être expiré ou été remplacé.',
  );
}

export async function declineQuoteAsOwner(input: {
  quoteNumber: string;
  userId: string;
  reason: string | null;
}): Promise<QuoteResult<{ declined: true }>> {
  const quote = await findQuoteForOwner(input);
  if (!quote) return fail('QUOTE_NOT_FOUND', 'Devis introuvable.');

  const declined = await declineQuote({
    quoteId: quote.id,
    userId: input.userId,
    reason: input.reason?.trim() || null,
  });

  if (!declined) return fail('NOT_ACCEPTABLE', 'Ce devis ne peut plus être refusé.');
  return { ok: true, value: { declined: true } };
}

/* ---------------------------------------------------------------------------
 * The request conversation
 * ------------------------------------------------------------------------ */

/**
 * Move a request.
 *
 * 6.4: no code sets `status` without going through the transition function, and
 * 6.2 says who may make which move. Both are checked before the write, and the
 * write is conditional on the request still being where the caller thought.
 */
export async function transitionRequest(input: {
  requestNumber: string;
  to: RequestStatus;
  actor: 'CUSTOMER' | 'STAFF' | 'SYSTEM';
  actorUserId: string | null;
  needsInfoReason?: string | null;
}): Promise<QuoteResult<{ status: RequestStatus }>> {
  const request = await findRequestForStaff(input.requestNumber);
  if (!request) return fail('REQUEST_NOT_FOUND', 'Demande introuvable.');

  const transition = validateRequestTransition(request.status, input.to, {
    actor: input.actor,
    needsInfoReason: input.needsInfoReason,
  });

  if (!transition.ok) {
    return fail(
      'INVALID_TRANSITION',
      transition.error.code === 'MISSING_NEEDS_INFO_REASON'
        ? 'Indiquez précisément l’information dont vous avez besoin.'
        : 'Ce changement de statut n’est pas autorisé.',
    );
  }

  const moved = await applyRequestTransition({
    requestId: request.id,
    from: request.status,
    to: input.to,
    actorUserId: input.actorUserId,
    actorType: input.actor === 'STAFF' ? 'ADMIN' : input.actor,
    needsInfoReason: input.needsInfoReason ?? null,
  });

  if (!moved)
    return fail('INVALID_TRANSITION', 'La demande a changé entre-temps. Rechargez.');

  return { ok: true, value: { status: input.to } };
}

/**
 * Post a message.
 *
 * 6.7.2: **ordinary conversation does not change the request status.** This
 * function has no transition in it at all, which is the point — a customer
 * asking "how long will this take?" cannot move anything, because there is no
 * code path from here to a status.
 */
/**
 * A customer's reply on their own request (6.7.2).
 *
 * A separate function from the admin's, and deliberately not a flag on it. Two
 * things differ and both matter:
 *
 *   - the request is resolved **for the owner** — `findRequestForOwner` filters
 *     on `userId` in the query — so a request number belonging to somebody else
 *     is "not found" rather than a message posted on their thread;
 *   - `internal` is not a parameter. A customer cannot write an
 *     `INTERNAL_NOTE`, because there is no argument through which to ask for
 *     one.
 *
 * And, as with the admin's, there is **no transition anywhere in it**. A
 * customer answering a `NEEDS_INFO` question does not clear the block: 6.7.3
 * gives that to the admin, who is the only one who can judge whether what
 * arrived is sufficient.
 */
export async function postCustomerMessage(input: {
  requestNumber: string;
  userId: string;
  message: string;
}): Promise<QuoteResult<{ posted: true }>> {
  const message = input.message.trim();
  if (message === '') return fail('INVALID_INPUT', 'Le message est vide.');

  const request = await findRequestForOwner({
    requestNumber: input.requestNumber,
    userId: input.userId,
  });

  if (!request) return fail('REQUEST_NOT_FOUND', 'Demande introuvable.');

  await addRequestMessage({
    requestId: request.id,
    actorType: 'CUSTOMER',
    actorUserId: input.userId,
    message,
    internal: false,
  });

  return { ok: true, value: { posted: true } };
}

export async function postRequestMessage(input: {
  requestNumber: string;
  actorType: 'CUSTOMER' | 'ADMIN';
  actorUserId: string | null;
  message: string;
  internal: boolean;
}): Promise<QuoteResult<{ posted: true }>> {
  const message = input.message.trim();
  if (message === '') return fail('INVALID_INPUT', 'Le message est vide.');

  const request = await findRequestForStaff(input.requestNumber);
  if (!request) return fail('REQUEST_NOT_FOUND', 'Demande introuvable.');

  await addRequestMessage({
    requestId: request.id,
    actorType: input.actorType,
    actorUserId: input.actorUserId,
    message,
    internal: input.internal,
  });

  return { ok: true, value: { posted: true } };
}

/* ---------------------------------------------------------------------------
 * Lists
 * ------------------------------------------------------------------------ */

export type CustomerQuoteSummary = {
  quoteNumber: string;
  version: number;
  status: QuoteStatus;
  requestNumber: string;
  grandTotal: number;
  currency: string;
  validUntil: Date;
  acceptable: boolean;
};

/** Every quote a customer has been sent, with the **effective** status (7.4). */
export async function listQuotesForCustomer(
  userId: string,
  now = new Date(),
): Promise<readonly CustomerQuoteSummary[]> {
  const quotes = await listQuotesForOwner(userId);

  return quotes.map((quote) => {
    const view = toCustomerView(quote, now);

    return {
      quoteNumber: view.quoteNumber,
      version: view.version,
      status: view.status,
      requestNumber: view.requestNumber,
      grandTotal: view.grandTotal,
      currency: view.currency,
      validUntil: view.validUntil,
      acceptable: view.acceptable,
    };
  });
}

/** Every version of a request's quotes, newest first, for the admin workspace. */
export async function listQuoteVersions(
  requestId: string,
): Promise<readonly StaffQuoteRecord[]> {
  return listQuotesForRequest(requestId);
}

/* ---------------------------------------------------------------------------
 * Cancellation
 * ------------------------------------------------------------------------ */

/**
 * Withdraw a quote (7.1).
 *
 * Cancelling one the customer was looking at returns the request to
 * `IN_REVIEW`, because the business is holding it again. A quote already
 * accepted or rejected is terminal and refuses.
 */
export async function cancelQuoteAsStaff(
  quoteId: string,
  staffUserId: string,
): Promise<QuoteResult<{ cancelled: true }>> {
  const quote = await findQuoteForStaff(quoteId);
  if (!quote) return fail('QUOTE_NOT_FOUND', 'Devis introuvable.');

  const cancelled = await cancelQuote({ quoteId, actorUserId: staffUserId });
  if (!cancelled) {
    return fail('INVALID_TRANSITION', 'Ce devis ne peut plus être annulé.');
  }

  return { ok: true, value: { cancelled: true } };
}

/* ---------------------------------------------------------------------------
 * What was quoted
 * ------------------------------------------------------------------------ */

export type QuotedFile = {
  designFileId: string;
  role: 'PRIMARY' | 'REFERENCE';
  filename: string;
  contentType: string;
  status: string;
};

export type QuotedConfiguration = {
  requestItemId: string;
  quantity: number;
  frozen: boolean;
  productName: string | null;
  placement: string | null;
  embroiderySize: string | null;
  font: string | null;
  threadColors: readonly string[];
  embroideryText: string | null;
  instructions: string | null;
  files: readonly QuotedFile[];
  /**
   * The placement, as a picture rather than a sentence.
   *
   * Null when the configuration was never placed on a measured photograph — an
   * older row, or a blank the owner has not measured. The sentence in
   * `placement` still describes it; there is simply nothing to draw.
   */
  placed: PlacedDesignView | null;
};

/**
 * Everything needed to redraw what the customer approved.
 *
 * The garment, the four percentages, and the real size. Deliberately the same
 * numbers the editor used — the workshop is not shown an approximation of the
 * customer's screen, it is shown the customer's screen.
 */
export type PlacedDesignView = {
  garmentSrc: string | null;
  garmentAlt: string;
  garmentWidthPx: number | null;
  garmentHeightPx: number | null;
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  rotationDeg: number;
  widthMm: number | null;
  heightMm: number | null;
};

/**
 * The configuration, read the way ADR-016 requires.
 *
 * **The snapshot wins whenever it exists.** A frozen configuration renders from
 * `productNameSnapshot`, `placementLabel`, `embroiderySizeLabel`, `fontLabel`
 * and `threadColorNames`, and the live rows are consulted only for a
 * configuration that has never been quoted. That is the whole point of freezing
 * on send (7.2.3): renaming a placement, deactivating a thread colour or
 * deleting a product afterwards must not change what a sent quote describes.
 */
export function summariseConfigurations(
  request: RequestDetail,
): readonly QuotedConfiguration[] {
  return request.items.map((item) => {
    const config = item.customizationConfig;
    const frozen = config.frozenAt !== null;

    return {
      requestItemId: item.id,
      quantity: item.quantity,
      frozen,
      productName: frozen
        ? config.productNameSnapshot
        : (config.productNameSnapshot ?? config.product?.name ?? null),
      /*
       * "Devant · 146 × 37 mm", from submission onwards.
       *
       * `designSurfaceLabel` is written when the request is submitted and never
       * changes afterwards, so reading it before the configuration is frozen
       * breaks no rule ADR-016 makes — that rule is about not consulting *live
       * reference rows*, which a sentence stored on the configuration is not.
       * Without this the workshop saw no placement at all until a quote had
       * been sent, which is precisely when they most need to know where the
       * design goes.
       */
      placement: frozen
        ? (config.placementLabel ?? config.designSurfaceLabel)
        : (config.placementLabel ??
          config.designSurfaceLabel ??
          config.placement?.name ??
          null),
      embroiderySize: frozen
        ? config.embroiderySizeLabel
        : (config.embroiderySizeLabel ?? config.embroiderySize?.name ?? null),
      font: frozen ? config.fontLabel : config.fontLabel,
      threadColors: frozen
        ? config.threadColorNames
        : config.threadColorNames.length > 0
          ? config.threadColorNames
          : config.threadColors.map((link) => link.threadColor.name),
      embroideryText: config.embroideryText,
      instructions: config.instructions,
      files: config.files.map((link) => ({
        designFileId: link.designFile.id,
        role: link.role as 'PRIMARY' | 'REFERENCE',
        filename: link.designFile.originalFilename,
        contentType: link.designFile.mimeType,
        status: link.designFile.status,
      })),
      placed: placedDesign(config),
    };
  });
}

/**
 * The placement as something that can be drawn, or nothing.
 *
 * Deliberately **not** frozen the way the labels are. A snapshot exists to keep
 * a sent quote's *words* stable when reference data changes underneath it
 * (ADR-016); the picture is a rendering of numbers that live on the
 * configuration itself and cannot change. What can change is the garment
 * photograph the row points at — and if the owner replaces it, showing the new
 * one is right: the design is still 34% across a front, and that is still where
 * it goes.
 *
 * All four percentages or none. The database enforces that
 * (`customization_configs_design_transform_complete`); this reads it the same
 * way rather than drawing half a transform at a default position.
 */
function placedDesign(config: {
  designSurface: string | null;
  designXPercent: unknown;
  designYPercent: unknown;
  designWidthPercent: unknown;
  designRotationDeg: unknown;
  embroideryWidthMm: number | null;
  embroideryHeightMm: number | null;
  surfaceImage: {
    storageKey: string;
    alt: string;
    width: number | null;
    height: number | null;
  } | null;
}): PlacedDesignView | null {
  const x = toNumber(config.designXPercent);
  const y = toNumber(config.designYPercent);
  const width = toNumber(config.designWidthPercent);

  if (x === null || y === null || width === null) return null;

  return {
    garmentSrc: config.surfaceImage
      ? toPublicAssetUrl(config.surfaceImage.storageKey)
      : null,
    garmentAlt: config.surfaceImage?.alt ?? '',
    garmentWidthPx: config.surfaceImage?.width ?? null,
    garmentHeightPx: config.surfaceImage?.height ?? null,
    xPercent: x,
    yPercent: y,
    widthPercent: width,
    rotationDeg: toNumber(config.designRotationDeg) ?? 0,
    widthMm: config.embroideryWidthMm,
    heightMm: config.embroideryHeightMm,
  };
}

/**
 * Prisma hands a `Decimal` back for these columns, not a number.
 *
 * `Decimal(6,3)` is the right column type — a percentage the customer is shown
 * and the workshop stitches to has no business being binary floating point —
 * but it arrives as an object, and `Number()` on it is the documented way
 * across. Anything unparseable is treated as absent rather than as zero, which
 * would silently move a design to the top-left corner.
 */
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export type CustomerQuotePage = {
  quote: CustomerQuoteView;
  requestId: string;
  configurations: readonly QuotedConfiguration[];
};

/**
 * The customer's quote page, in one call.
 *
 * Both reads are ownership-scoped in the query — the quote by `userId`, the
 * request by `userId` — so a quote number belonging to somebody else is "not
 * found" rather than "not yours", and a request that is not theirs contributes
 * nothing even if the quote somehow were.
 */
export async function getCustomerQuotePage(input: {
  quoteNumber: string;
  userId: string;
}): Promise<QuoteResult<CustomerQuotePage>> {
  const view = await viewQuoteAsOwner(input);
  if (!view.ok) return view;

  const request = await findRequestForOwner({
    requestNumber: view.value.requestNumber,
    userId: input.userId,
  });

  return {
    ok: true,
    value: {
      quote: view.value,
      requestId: request?.id ?? '',
      configurations: request ? summariseConfigurations(request) : [],
    },
  };
}
