import 'server-only';

import { randomBytes } from 'node:crypto';

import { z } from 'zod';

import { depositFor } from '@/domain/order/deposit';
import { isCheckoutValid, type QuoteStatus } from '@/domain/quote';
import { entryStatus, reservesStockAtPlacement } from '@/domain/order/state-machine';
import {
  isPrepaid,
  supportsPaymentMethod,
  type PaymentMethod,
} from '@/domain/order/payment-method';
import { orderTotals, reconcilesWithQuote } from '@/domain/order/totals';
import {
  QUOTED_SHIPPING_LABEL,
  remainingForFreeShipping,
  resolveShipping,
  selectRate,
  type DeliveryType,
} from '@/domain/shipping';
import {
  findActiveStandardCart,
  findOwnedCart,
  type CartData,
  type CartOwner,
} from '@/server/repositories/cart-repository';
import { placeOrder, type OrderItemInput } from '@/server/repositories/order-repository';
import {
  notifyOrderPlaced,
  staffRecipients,
} from '@/server/services/notification-service';
import {
  invalidateQuoteBoundCart,
  loadQuoteTotals,
} from '@/server/repositories/quote-repository';
import { loadCommerceSettings } from '@/server/repositories/settings-repository';
import {
  ratesForWilaya,
  wilayaExists,
  wilayaName,
} from '@/server/repositories/shipping-repository';
import { priceCartData } from './cart-service';
import type { PricedCart } from './cart-pricing';

/**
 * Checkout.
 *
 * The client sends **contact details, an address, a delivery type and a payment
 * method**. It does not send a price, a subtotal, a discount, a shipping
 * amount, a total or a deposit, and there is nowhere in this schema for one to
 * arrive — the same technique Phase 7 used for the custom-request boundary, and
 * for the same reason: a field that does not exist cannot be trusted by
 * accident.
 *
 * Everything about money is derived here from rows the customer cannot edit:
 *
 *   - the lines, re-priced through `cart-pricing` — the one path (5.1, 16)
 *   - the delivery charge, from `shipping_rates` via `domain/shipping` (4.1)
 *   - the deposit, from `domain/order/deposit` and the settings percentage (5.5)
 *   - the entry status, from `domain/order/state-machine` (8.2)
 *
 * 5.3: totals are recomputed and re-validated **inside the placement
 * transaction**. Between adding to cart and paying, prices and stock can both
 * change, and the order must reflect the moment it was placed.
 */

/* ---------------------------------------------------------------------------
 * Input
 * ------------------------------------------------------------------------ */

/**
 * Algerian mobile and landline numbers, with or without the international
 * prefix. `UX.md` section 7 requires the phone to be validated as a real local
 * number rather than as "some digits": it is the primary operational contact,
 * and a wrong one means an undeliverable order.
 */
const ALGERIAN_PHONE = /^(?:\+213|00213|0)(?:5|6|7|2|3|4)\d{7,8}$/;

export const checkoutInput = z.object({
  contactName: z.string().trim().min(2).max(120),
  /*
   * Optional, since Phase 14.11.
   *
   * It carries the confirmation and is what later lets a guest claim an order
   * into an account — both true, and neither a reason to refuse a sale. A great
   * many customers here pay cash on delivery and have no working e-mail
   * address; the phone below is the contact that matters, and it is required.
   *
   * An address that *is* given must be an address. One that is not is
   * normalised to `null` rather than stored blank: an empty string is a missing
   * e-mail that every `IS NOT NULL` check would believe, and the column
   * forbids it outright.
   */
  contactEmail: z
    .preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
      z.email().max(255).nullable(),
    )
    .default(null),
  contactPhone: z
    .string()
    .trim()
    .transform((value) => value.replace(/[\s.-]/g, ''))
    .refine((value) => ALGERIAN_PHONE.test(value), {
      message: 'Numéro de téléphone algérien invalide.',
    }),
  wilayaCode: z.number().int().min(1).max(58),
  communeName: z.string().trim().min(2).max(120),
  addressLine: z.string().trim().min(5).max(300),
  deliveryType: z.enum(['HOME', 'DESK']),
  paymentMethod: z.enum(['COD', 'BANK_TRANSFER', 'CCP']),
  customerNote: z.string().trim().max(1000).nullable().default(null),
  termsAccepted: z.literal(true),
});

export type CheckoutInput = z.infer<typeof checkoutInput>;

export type CheckoutError =
  | 'CART_EMPTY'
  | 'CART_NOT_FOUND'
  | 'CART_NOT_PURCHASABLE'
  | 'INVALID_INPUT'
  | 'WILAYA_NOT_SERVED'
  | 'DELIVERY_TYPE_NOT_OFFERED'
  | 'PAYMENT_METHOD_NOT_ALLOWED'
  | 'OUT_OF_STOCK'
  | 'ALREADY_PLACED'
  | 'QUOTE_TOTAL_MISMATCH'
  | 'QUOTE_ACCEPTANCE_LAPSED'
  | 'TOTALS_INVALID';

export const CHECKOUT_ERROR_LABELS: Record<CheckoutError, string> = {
  CART_EMPTY: 'Votre panier est vide.',
  CART_NOT_FOUND: 'Votre panier est introuvable.',
  CART_NOT_PURCHASABLE:
    'Un article de votre panier n’est plus disponible. Vérifiez votre panier.',
  INVALID_INPUT: 'Certaines informations sont incomplètes ou invalides.',
  WILAYA_NOT_SERVED:
    'Nous ne livrons pas encore dans cette wilaya. Contactez-nous et nous trouverons une solution.',
  DELIVERY_TYPE_NOT_OFFERED:
    'Ce mode de livraison n’est pas disponible pour cette wilaya.',
  PAYMENT_METHOD_NOT_ALLOWED:
    'Ce mode de paiement n’est pas disponible pour une commande personnalisée.',
  OUT_OF_STOCK: 'Le stock a changé pendant votre commande. Vérifiez votre panier.',
  ALREADY_PLACED: 'Cette commande a déjà été enregistrée.',
  QUOTE_TOTAL_MISMATCH:
    'Le total ne correspond plus au devis accepté. Contactez-nous avant de payer.',
  QUOTE_ACCEPTANCE_LAPSED:
    'Le délai de validité de ce devis accepté est écoulé. Demandez un devis actualisé.',
  TOTALS_INVALID: 'Le total de cette commande ne peut pas être calculé.',
};

export type CheckoutResult<T> =
  { ok: true; value: T } | { ok: false; error: CheckoutError };

/* ---------------------------------------------------------------------------
 * The live delivery quote
 * ------------------------------------------------------------------------ */

export type DeliveryQuote = {
  deliveryType: DeliveryType;
  amount: number;
  isFree: boolean;
  estimatedMinDays: number;
  estimatedMaxDays: number;
  remainingForFree: number | null;
  label: string;
  /**
   * The **whole** total for this delivery choice, not just its price.
   *
   * The browser must not add `subtotal - discount + shipping` itself: that is
   * the 5.1 pipeline, and section 16 requires it to exist once. So each option
   * carries the totals it would produce, and the form renders the one that is
   * selected rather than computing anything.
   */
  subtotal: number;
  discountTotal: number;
  grandTotal: number;
  /** 5.5, computed with the same function placement uses. */
  depositRequired: number;
};

/**
 * What each delivery type would cost for this cart and wilaya.
 *
 * `UX.md` section 7: "selecting a wilaya recalculates delivery server-side;
 * desk versus home is a visible choice with distinct prices". Both options are
 * returned so the page renders real numbers rather than a placeholder — and the
 * numbers come from the same `resolveShipping` placement uses.
 */
export async function quoteDelivery(
  owner: CartOwner,
  wilayaCode: number,
): Promise<CheckoutResult<readonly DeliveryQuote[]>> {
  const cart = await findActiveStandardCart(owner);
  if (!cart) return { ok: false, error: 'CART_NOT_FOUND' };
  if (cart.lines.length === 0) return { ok: false, error: 'CART_EMPTY' };

  if (!(await wilayaExists(wilayaCode))) return { ok: false, error: 'WILAYA_NOT_SERVED' };

  const priced = await priceCartData(cart);
  const rates = await ratesForWilaya(wilayaCode);
  if (rates.length === 0) return { ok: false, error: 'WILAYA_NOT_SERVED' };

  // 4.2.1: the free-delivery threshold compares against the subtotal **after**
  // discounts, so a discount cannot buy its way to free delivery.
  const subtotalAfterDiscount = priced.totals.subtotal - priced.totals.discountTotal;

  const settings = await loadCommerceSettings();
  const options: DeliveryQuote[] = [];

  for (const rate of rates) {
    const resolved = resolveShipping(rate, subtotalAfterDiscount);

    const totals = orderTotals({
      lines: priced.lines.map((line) => ({
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        lineDiscount: 0,
      })),
      discountTotal: priced.totals.discountTotal,
      shippingTotal: resolved.amount,
    });

    if (!totals.ok) return { ok: false, error: 'TOTALS_INVALID' };

    options.push({
      deliveryType: rate.deliveryType,
      amount: resolved.amount,
      isFree: resolved.isFree,
      estimatedMinDays: resolved.estimatedMinDays,
      estimatedMaxDays: resolved.estimatedMaxDays,
      remainingForFree: remainingForFreeShipping(rate, subtotalAfterDiscount),
      label: resolved.label,
      subtotal: totals.value.subtotal,
      discountTotal: totals.value.discountTotal,
      grandTotal: totals.value.grandTotal,
      depositRequired: depositFor({
        quoteDepositRequired: null,
        hasCustomLine: priced.hasCustomLine,
        // No V1 method is prepaid, so the deposit does not vary by method.
        isPrepaidMethod: false,
        grandTotal: totals.value.grandTotal,
        depositPercentBasisPoints: settings.depositPercentBasisPoints,
      }),
    });
  }

  return { ok: true, value: options };
}

/* ---------------------------------------------------------------------------
 * Placement
 * ------------------------------------------------------------------------ */

function toOrderItems(priced: PricedCart): readonly OrderItemInput[] {
  return priced.lines.map((line, index) => ({
    kind: line.kind,
    feeKind: line.fee ? line.fee.feeKind : null,
    productId: line.kind === 'FEE' ? null : line.snapshot.productId,
    variantId: line.kind === 'FEE' ? null : line.snapshot.variantId,
    customizationConfigId:
      line.kind === 'FEE' ? null : line.snapshot.customizationConfigId,
    quoteItemId: line.snapshot.quoteItemId,
    // Snapshots, so the order renders identically forever whatever the
    // catalogue does next (DATABASE.md section 8).
    nameSnapshot: line.name,
    variantLabelSnapshot: line.variantLabel,
    skuSnapshot: line.snapshot.skuSnapshot,
    imageKeySnapshot: line.snapshot.imageKeySnapshot,
    unitPrice: line.unitPrice,
    quantity: line.quantity,
    lineDiscount: 0,
    lineTotal: line.lineTotal,
    requiresProduction: line.requiresProduction,
    position: index,
  }));
}

export type PlacedOrderSummary = {
  orderNumber: string;
  guestToken: string | null;
  status: string;
  grandTotal: number;
  depositRequired: number;
};

export async function placeOrderFromCart(
  owner: CartOwner,
  raw: unknown,
  options: { cartId?: string } = {},
): Promise<CheckoutResult<PlacedOrderSummary>> {
  const parsed = checkoutInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'INVALID_INPUT' };
  const input = parsed.data;

  const cart: CartData | null = options.cartId
    ? await findOwnedCart(options.cartId, owner)
    : await findActiveStandardCart(owner);

  if (!cart) return { ok: false, error: 'CART_NOT_FOUND' };
  if (cart.status !== 'ACTIVE') return { ok: false, error: 'ALREADY_PLACED' };
  if (cart.lines.length === 0) return { ok: false, error: 'CART_EMPTY' };

  // 7.10.1 and 7.10.2, before anything else is computed: a quote-bound cart is
  // checkout-valid only inside the acceptance window, and the rule is enforced
  // lazily here as well as by the sweep, so a stalled job cannot let a lapsed
  // acceptance be redeemed. The cart is invalidated on the way out, so the next
  // read agrees with this one.
  const acceptance = await checkQuoteAcceptance(cart);
  if (!acceptance.ok) return acceptance;

  const wilaya = await wilayaName(input.wilayaCode);
  if (wilaya === null) return { ok: false, error: 'WILAYA_NOT_SERVED' };

  // Priced without shipping first: the free-delivery threshold reads the
  // subtotal after discount, so shipping cannot be an input to itself.
  const preliminary = await priceCartData(cart);
  if (!preliminary.isPurchasable) {
    const outOfStock = preliminary.issues.some(
      (issue) => issue.issue === 'INSUFFICIENT_STOCK',
    );
    return { ok: false, error: outOfStock ? 'OUT_OF_STOCK' : 'CART_NOT_PURCHASABLE' };
  }

  if (
    !supportsPaymentMethod(input.paymentMethod, {
      hasCustomLine: preliminary.hasCustomLine,
    })
  ) {
    return { ok: false, error: 'PAYMENT_METHOD_NOT_ALLOWED' };
  }

  const shipping = await resolveOrderShipping({
    cart,
    priced: preliminary,
    wilayaCode: input.wilayaCode,
    deliveryType: input.deliveryType,
  });

  if (!shipping.ok) return shipping;

  const priced = await priceCartData(cart, shipping.value.amount);

  // 5A: a quote-bound order takes its discount and deposit from the accepted
  // quote, never from the current rules. 2.6.5 maps DISCOUNT lines onto
  // `orders.discountTotal`, which is why the discount is read here rather than
  // recomputed from the tiers.
  const quote =
    cart.kind === 'QUOTE_BOUND' && cart.quoteId
      ? await loadQuoteTotals(cart.quoteId)
      : null;

  const totals = orderTotals({
    lines: priced.lines.map((line) => ({
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      lineDiscount: 0,
    })),
    discountTotal: quote ? quote.discountTotal : priced.totals.discountTotal,
    shippingTotal: shipping.value.amount,
  });

  if (!totals.ok) return { ok: false, error: 'TOTALS_INVALID' };

  /**
   * 5A.6, the hard invariant: if the reconstructed total does not equal the
   * accepted quote's total to the centime, placement **fails** rather than
   * charging a different amount. This is the single assertion that makes "the
   * customer pays what they accepted" verifiable rather than assumed.
   */
  if (quote && !reconcilesWithQuote(totals.value, quote.grandTotal)) {
    return { ok: false, error: 'QUOTE_TOTAL_MISMATCH' };
  }

  const settings = await loadCommerceSettings();

  const depositRequired = depositFor({
    // 5.5.1: copied from the quote, never recomputed from the current
    // percentage — the deposit is part of what the customer accepted.
    quoteDepositRequired: quote ? quote.depositRequired : null,
    hasCustomLine: priced.hasCustomLine,
    isPrepaidMethod: isPrepaid(input.paymentMethod as PaymentMethod),
    grandTotal: totals.value.grandTotal,
    depositPercentBasisPoints: settings.depositPercentBasisPoints,
  });

  const status = entryStatus({ depositRequired, amountPaid: 0 });

  /**
   * 8.10.3: an order awaiting payment reserves nothing — no stock, no
   * materials, no production. That is what makes the state safe to leave open
   * while a customer walks to the bank, and it is why this list is empty for a
   * deposit order rather than reserved and released later.
   */
  const reservations = reservesStockAtPlacement(status)
    ? priced.lines
        .filter(
          (line) =>
            line.kind !== 'FEE' &&
            line.snapshot.variantId !== null &&
            line.maxQuantity !== null,
        )
        .map((line) => ({ variantId: line.snapshot.variantId!, quantity: line.quantity }))
    : [];

  const guestToken =
    owner.kind === 'guest' ? randomBytes(24).toString('base64url') : null;

  // Resolved before the placement transaction opens: the pool is one connection
  // wide by default, so a settings read from inside it would wait for the
  // transaction that is waiting for the read.
  const workshop = await staffRecipients();

  const placed = await placeOrder({
    cartId: cart.id,
    userId: owner.kind === 'user' ? owner.userId : null,
    guestToken,
    currency: cart.currency,
    status,
    contactName: input.contactName,
    contactPhone: input.contactPhone,
    contactEmail: input.contactEmail,
    paymentMethod: input.paymentMethod,
    deliveryType: input.deliveryType,
    shippingRateId: shipping.value.rateId,
    shippingRateLabel: shipping.value.label,
    subtotal: totals.value.subtotal,
    discountTotal: totals.value.discountTotal,
    shippingTotal: totals.value.shippingTotal,
    taxTotal: totals.value.taxTotal,
    grandTotal: totals.value.grandTotal,
    depositRequired,
    customerNote: input.customerNote,
    quoteId: cart.quoteId,
    // 4.5: delivery estimates are counted from `confirmedAt`, which has not
    // happened yet. Writing dates now would date them from the wrong event.
    estimatedDeliveryFrom: null,
    estimatedDeliveryTo: null,
    address: {
      fullName: input.contactName,
      phone: input.contactPhone,
      wilayaCode: input.wilayaCode,
      wilayaNameSnapshot: wilaya,
      communeName: input.communeName,
      addressLine: input.addressLine,
      postalCode: null,
      notes: input.customerNote,
    },
    items: toOrderItems(priced),
    reservations,
    /**
     * 8A: the confirmation and the workshop's alert are queued **inside** the
     * placement transaction (`ARCHITECTURE.md` section 11), so an order and the
     * announcement of it either both exist or neither does. Nothing is sent
     * here — the dispatcher does that out of band, which is what stops a
     * provider outage from failing a checkout.
     *
     * Every value comes from what was just written: the snapshots, the stored
     * totals, and the address as recorded. The recipient is the order's own
     * contact address, not the payload's.
     */
    onPlaced: async ({ tx, orderId, orderNumber, status }) => {
      await notifyOrderPlaced(
        {
          staffRecipients: workshop,
          orderId,
          orderNumber,
          status,
          userId: owner.kind === 'user' ? owner.userId : null,
          contactName: input.contactName,
          contactEmail: input.contactEmail,
          currency: cart.currency,
          paymentMethod: input.paymentMethod,
          subtotal: totals.value.subtotal,
          discountTotal: totals.value.discountTotal,
          shippingTotal: totals.value.shippingTotal,
          shippingRateLabel: shipping.value.label,
          grandTotal: totals.value.grandTotal,
          depositRequired,
          address: `${input.addressLine}, ${input.communeName}, ${wilaya}`,
          items: priced.lines.map((line) => ({
            name: line.name,
            variantLabel: line.variantLabel,
            quantity: line.quantity,
            lineTotal: line.lineTotal,
          })),
        },
        tx,
      );
    },
  });

  if (!placed.ok) {
    return {
      ok: false,
      error: placed.failure.code === 'OUT_OF_STOCK' ? 'OUT_OF_STOCK' : 'ALREADY_PLACED',
    };
  }

  return {
    ok: true,
    value: {
      orderNumber: placed.order.orderNumber,
      guestToken,
      status: placed.order.status,
      grandTotal: totals.value.grandTotal,
      depositRequired,
    },
  };
}

/* ---------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------ */

/**
 * The delivery charge for this order.
 *
 * 4.6 and 5A.3: a quote's `SHIPPING` lines **supersede** rate resolution
 * entirely — no zone or rate lookup occurs, `shippingRateId` stays null and the
 * label records "Livraison devisée". That branch is first because it must not
 * be reachable by accident from the rate path.
 */
async function resolveOrderShipping(input: {
  cart: CartData;
  priced: PricedCart;
  wilayaCode: number;
  deliveryType: DeliveryType;
}): Promise<CheckoutResult<{ amount: number; rateId: string | null; label: string }>> {
  if (input.cart.kind === 'QUOTE_BOUND') {
    if (!input.cart.quoteId) return { ok: false, error: 'CART_NOT_PURCHASABLE' };

    const quote = await loadQuoteTotals(input.cart.quoteId);
    if (!quote) return { ok: false, error: 'CART_NOT_PURCHASABLE' };

    return {
      ok: true,
      value: { amount: quote.shippingTotal, rateId: null, label: QUOTED_SHIPPING_LABEL },
    };
  }

  const rates = await ratesForWilaya(input.wilayaCode);
  const selected = selectRate(rates, input.deliveryType);

  if (!selected.ok) {
    return {
      ok: false,
      error:
        selected.error.code === 'WILAYA_NOT_SERVED'
          ? 'WILAYA_NOT_SERVED'
          : 'DELIVERY_TYPE_NOT_OFFERED',
    };
  }

  const subtotalAfterDiscount =
    input.priced.totals.subtotal - input.priced.totals.discountTotal;
  const resolved = resolveShipping(selected.value, subtotalAfterDiscount);

  return {
    ok: true,
    value: { amount: resolved.amount, rateId: resolved.rateId, label: resolved.label },
  };
}

/**
 * The acceptance window, checked lazily (7.10.1, 7.10.2).
 *
 * A standard cart passes untouched. A quote-bound cart must name a quote that
 * is `ACCEPTED` and still inside `acceptanceValidUntil`; anything else
 * invalidates the cart, because "the sweep has not run yet" must never be the
 * difference between a redeemable price and a lapsed one.
 */
async function checkQuoteAcceptance(
  cart: CartData,
): Promise<CheckoutResult<{ checked: true }>> {
  if (cart.kind !== 'QUOTE_BOUND') return { ok: true, value: { checked: true } };

  const quote = cart.quoteId ? await loadQuoteTotals(cart.quoteId) : null;

  const redeemable =
    quote !== null &&
    isCheckoutValid({
      status: quote.status as QuoteStatus,
      acceptanceValidUntil: quote.acceptanceValidUntil,
    });

  if (!redeemable) {
    await invalidateQuoteBoundCart(cart.id);
    return { ok: false, error: 'QUOTE_ACCEPTANCE_LAPSED' };
  }

  return { ok: true, value: { checked: true } };
}

/* ---------------------------------------------------------------------------
 * Quote-bound checkout
 * ------------------------------------------------------------------------ */

export type QuoteCheckoutView = {
  cartId: string;
  quoteNumber: string;
  priced: PricedCart;
  /**
   * The quote's own totals, not the cart's.
   *
   * A quote-bound cart carries no DISCOUNT line — 2.6.5 maps it onto
   * `orders.discountTotal` instead — so the cart's discount is zero and only
   * the quote knows the negotiated figure. Showing the cart's would print a
   * summary that does not add up to the total beneath it.
   */
  subtotal: number;
  discountTotal: number;
  shippingTotal: number;
  grandTotal: number;
  depositRequired: number;
  acceptanceValidUntil: Date | null;
};

/**
 * The accepted quote's own checkout (5A, `UX.md` section 7).
 *
 * Nothing here is editable and nothing is repriced: the lines carry
 * `lockedUnitPrice`, the delivery charge is the quote's `SHIPPING` total rather
 * than a rate lookup (5A.3), and the deposit is the quote's (5A.7). The page
 * renders the numbers it is given.
 */
export async function getQuoteCheckoutView(
  owner: CartOwner,
  cartId: string,
): Promise<CheckoutResult<QuoteCheckoutView>> {
  const cart = await findOwnedCart(cartId, owner);

  if (!cart || cart.kind !== 'QUOTE_BOUND') {
    return { ok: false, error: 'CART_NOT_FOUND' };
  }
  if (cart.status !== 'ACTIVE') return { ok: false, error: 'ALREADY_PLACED' };

  const acceptance = await checkQuoteAcceptance(cart);
  if (!acceptance.ok) return acceptance;

  const quote = await loadQuoteTotals(cart.quoteId!);
  if (!quote) return { ok: false, error: 'CART_NOT_PURCHASABLE' };

  const priced = await priceCartData(cart, quote.shippingTotal);

  return {
    ok: true,
    value: {
      cartId: cart.id,
      quoteNumber: quote.quoteNumber,
      priced,
      subtotal: quote.subtotal,
      discountTotal: quote.discountTotal,
      shippingTotal: quote.shippingTotal,
      grandTotal: quote.grandTotal,
      depositRequired: quote.depositRequired,
      acceptanceValidUntil: quote.acceptanceValidUntil,
    },
  };
}
