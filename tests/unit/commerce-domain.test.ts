/**
 * The commerce domain, at its boundaries.
 *
 * Phase 8's rules are the ones where an off-by-one is money: a free-delivery
 * threshold met exactly, a deposit rounded, a transition that must not be
 * allowed. Every test here names the rule it encodes, because a test that
 * agrees with the implementation but not with `BUSINESS-RULES.md` is worse than
 * no test.
 */

import { describe, expect, it } from 'vitest';

import {
  isMutable,
  mergedQuantity,
  requiresProduction,
  validateMutation,
} from '../../src/domain/cart';
import { balanceAfterDeposit, depositFor } from '../../src/domain/order/deposit';
import { amountPaidFrom, derivePaymentStatus } from '../../src/domain/order/payment';
import {
  availablePaymentMethods,
  supportsPaymentMethod,
} from '../../src/domain/order/payment-method';
import {
  ORDER_STATUS_LABELS,
  ORDER_TRANSITIONS,
  canTransition,
  customerMayCancel,
  entryStatus,
  isOrderInFlight,
  reservesStockAtPlacement,
  validateTransition,
  type OrderStatus,
} from '../../src/domain/order/state-machine';
import {
  lineTotal,
  orderTotals,
  reconcilesWithQuote,
} from '../../src/domain/order/totals';
import {
  remainingForFreeShipping,
  resolveShipping,
  selectRate,
  shippingRateLabel,
  type ApplicableRate,
} from '../../src/domain/shipping';

const RATE: ApplicableRate = {
  id: 'rate-1',
  deliveryType: 'HOME',
  price: 60_000,
  freeOverAmount: 1_000_000,
  estimatedMinDays: 2,
  estimatedMaxDays: 4,
  zoneName: 'Nord',
};

/* ---------------------------------------------------------------------------
 * 4. Shipping
 * ------------------------------------------------------------------------ */

describe('resolveShipping', () => {
  it('charges the rate below the threshold and nothing at or above it', () => {
    // 4.1: `>=`, so a subtotal exactly at the threshold earns free delivery.
    expect(resolveShipping(RATE, 999_999).amount).toBe(60_000);
    expect(resolveShipping(RATE, 1_000_000).amount).toBe(0);
    expect(resolveShipping(RATE, 1_000_001).amount).toBe(0);
  });

  it('reports free delivery rather than only a zero', () => {
    expect(resolveShipping(RATE, 1_000_000).isFree).toBe(true);
    expect(resolveShipping(RATE, 10).isFree).toBe(false);
  });

  it('never offers free delivery when the rate has no threshold', () => {
    // 4.2: a null `freeOverAmount` does not fall back to the settings default.
    const noThreshold = { ...RATE, freeOverAmount: null };
    expect(resolveShipping(noThreshold, 100_000_000).amount).toBe(60_000);
    expect(resolveShipping(noThreshold, 100_000_000).isFree).toBe(false);
    expect(remainingForFreeShipping(noThreshold, 0)).toBeNull();
  });

  it('snapshots a label that explains the charge later (4.7)', () => {
    expect(resolveShipping(RATE, 0).label).toBe('Nord — Livraison à domicile');
    expect(shippingRateLabel('Sud', 'DESK')).toBe('Sud — Livraison au bureau');
  });

  it('reports what is still needed for free delivery, and nothing once met', () => {
    expect(remainingForFreeShipping(RATE, 400_000)).toBe(600_000);
    expect(remainingForFreeShipping(RATE, 1_000_000)).toBeNull();
  });
});

describe('selectRate', () => {
  it('refuses an unmapped wilaya rather than defaulting to a rate (4.4)', () => {
    const result = selectRate([], 'HOME');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('WILAYA_NOT_SERVED');
  });

  it('distinguishes "not served" from "this delivery type is not offered"', () => {
    const result = selectRate([RATE], 'DESK');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DELIVERY_TYPE_NOT_OFFERED');
  });

  it('finds the rate for the chosen type', () => {
    const desk = { ...RATE, id: 'rate-2', deliveryType: 'DESK' as const, price: 40_000 };
    const result = selectRate([RATE, desk], 'DESK');
    expect(result.ok && result.value.id).toBe('rate-2');
  });
});

/* ---------------------------------------------------------------------------
 * 5.1 Totals
 * ------------------------------------------------------------------------ */

describe('orderTotals', () => {
  it('computes the documented pipeline', () => {
    const result = orderTotals({
      lines: [
        { unitPrice: 4_800, quantity: 2, lineDiscount: 0 },
        { unitPrice: 1_200, quantity: 1, lineDiscount: 0 },
      ],
      discountTotal: 500,
      shippingTotal: 600,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.subtotal).toBe(10_800);
    // 10_800 - 500 + 600 + 0
    expect(result.value.grandTotal).toBe(10_900);
    expect(result.value.taxTotal).toBe(0);
  });

  it('subtracts a line discount from its own line', () => {
    expect(lineTotal({ unitPrice: 1_000, quantity: 3, lineDiscount: 250 })).toBe(2_750);
  });

  it('refuses a total that would be negative', () => {
    const result = orderTotals({
      lines: [{ unitPrice: 100, quantity: 1, lineDiscount: 0 }],
      discountTotal: 500,
      shippingTotal: 0,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NEGATIVE_TOTAL');
  });

  it('refuses a float that escaped ADR-012 upstream', () => {
    const result = orderTotals({
      lines: [{ unitPrice: 10.5, quantity: 1, lineDiscount: 0 }],
      discountTotal: 0,
      shippingTotal: 0,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NON_INTEGER_AMOUNT');
  });

  it('refuses a negative discount, which would add money', () => {
    const result = orderTotals({
      lines: [{ unitPrice: 100, quantity: 1, lineDiscount: 0 }],
      discountTotal: -500,
      shippingTotal: 0,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NEGATIVE_COMPONENT');
  });

  it('reconciles with a quote only on exact equality (5A.6)', () => {
    const totals = {
      subtotal: 10_000,
      discountTotal: 0,
      shippingTotal: 500,
      taxTotal: 0,
      grandTotal: 10_500,
    };

    expect(reconcilesWithQuote(totals, 10_500)).toBe(true);
    expect(reconcilesWithQuote(totals, 10_499)).toBe(false);
    expect(reconcilesWithQuote(totals, 10_501)).toBe(false);
  });
});

/* ---------------------------------------------------------------------------
 * 5.5 Deposits
 * ------------------------------------------------------------------------ */

describe('depositFor', () => {
  const base = {
    quoteDepositRequired: null,
    hasCustomLine: true,
    isPrepaidMethod: false,
    grandTotal: 13_100,
    depositPercentBasisPoints: 5_000,
  };

  it('takes 50% of the grand total, in basis points', () => {
    // 5.5: `applyBasisPoints(grandTotal, 5000)`, never `grandTotal * 5000`.
    expect(depositFor(base)).toBe(6_550);
  });

  it('is zero for an order with no custom line', () => {
    expect(depositFor({ ...base, hasCustomLine: false })).toBe(0);
  });

  it('copies the quote deposit and never recomputes it (5.5.1)', () => {
    // Even with a different percentage in settings, and even when the quote's
    // deposit is zero — `null` versus `0` is the distinction that matters.
    expect(
      depositFor({
        ...base,
        quoteDepositRequired: 4_000,
        depositPercentBasisPoints: 9_000,
      }),
    ).toBe(4_000);

    expect(depositFor({ ...base, quoteDepositRequired: 0 })).toBe(0);
  });

  it('takes the whole total for a prepaid method', () => {
    expect(depositFor({ ...base, isPrepaidMethod: true })).toBe(13_100);
  });

  it('never exceeds the grand total, whatever the setting says', () => {
    // `depositRequired <= grandTotal` is a check constraint on the table.
    expect(depositFor({ ...base, depositPercentBasisPoints: 15_000 })).toBe(13_100);
  });

  it('rounds half up, once', () => {
    expect(
      depositFor({ ...base, grandTotal: 101, depositPercentBasisPoints: 5_000 }),
    ).toBe(51);
  });

  it('states the balance still owed', () => {
    expect(balanceAfterDeposit(13_100, 6_550)).toBe(6_550);
    expect(balanceAfterDeposit(13_100, 13_100)).toBe(0);
  });
});

/* ---------------------------------------------------------------------------
 * 8. Lifecycle
 * ------------------------------------------------------------------------ */

describe('the order state machine', () => {
  it('allows every documented transition and nothing else', () => {
    expect(canTransition('AWAITING_PAYMENT', 'AWAITING_CONFIRMATION')).toBe(true);
    expect(canTransition('AWAITING_CONFIRMATION', 'CONFIRMED')).toBe(true);
    expect(canTransition('CONFIRMED', 'IN_PRODUCTION')).toBe(true);
    expect(canTransition('READY', 'SHIPPED')).toBe(true);
    expect(canTransition('SHIPPED', 'DELIVERED')).toBe(true);
    expect(canTransition('DELIVERED', 'REFUNDED')).toBe(true);

    // The tempting shortcuts.
    expect(canTransition('AWAITING_PAYMENT', 'CONFIRMED')).toBe(false);
    expect(canTransition('AWAITING_CONFIRMATION', 'SHIPPED')).toBe(false);
    expect(canTransition('CONFIRMED', 'DELIVERED')).toBe(false);
    expect(canTransition('DELIVERED', 'CANCELLED')).toBe(false);
  });

  it('makes CANCELLED and REFUNDED terminal', () => {
    const everyStatus: OrderStatus[] = [
      'AWAITING_PAYMENT',
      'AWAITING_CONFIRMATION',
      'CONFIRMED',
      'DESIGN_REVIEW',
      'IN_PRODUCTION',
      'READY',
      'SHIPPED',
      'DELIVERED',
      'ON_HOLD',
      'CANCELLED',
      'REFUNDED',
    ];

    for (const to of everyStatus) {
      expect(canTransition('CANCELLED', to), `CANCELLED -> ${to}`).toBe(false);
      expect(canTransition('REFUNDED', to), `REFUNDED -> ${to}`).toBe(false);
    }
  });

  it('releases a hold only back to the status it was held from (8.6)', () => {
    expect(canTransition('ON_HOLD', 'CONFIRMED', 'CONFIRMED')).toBe(true);
    // A hold must not be a way to skip a step.
    expect(canTransition('ON_HOLD', 'READY', 'CONFIRMED')).toBe(false);
    expect(canTransition('ON_HOLD', 'CONFIRMED', null)).toBe(false);
  });

  it('requires the payload each transition needs (8.7)', () => {
    const cancelled = validateTransition('CONFIRMED', 'CANCELLED', {});
    expect(cancelled.ok).toBe(false);
    if (!cancelled.ok) expect(cancelled.error.code).toBe('MISSING_CANCELLATION_REASON');

    const shipped = validateTransition('READY', 'SHIPPED', { carrierName: 'Yalidine' });
    expect(shipped.ok).toBe(false);
    if (!shipped.ok) expect(shipped.error.code).toBe('MISSING_TRACKING');

    expect(
      validateTransition('READY', 'SHIPPED', {
        carrierName: 'Yalidine',
        trackingNumber: 'YAL-1',
      }).ok,
    ).toBe(true);

    const held = validateTransition('CONFIRMED', 'ON_HOLD', {});
    expect(held.ok).toBe(false);
    if (!held.ok) expect(held.error.code).toBe('MISSING_HOLD_NOTE');
  });

  it('treats whitespace as a missing reason', () => {
    const result = validateTransition('CONFIRMED', 'CANCELLED', {
      cancellationReason: '   ',
    });
    expect(result.ok).toBe(false);
  });

  it('places a deposit order in AWAITING_PAYMENT and everything else in AWAITING_CONFIRMATION', () => {
    expect(entryStatus({ depositRequired: 6_550, amountPaid: 0 })).toBe(
      'AWAITING_PAYMENT',
    );
    expect(entryStatus({ depositRequired: 0, amountPaid: 0 })).toBe(
      'AWAITING_CONFIRMATION',
    );
    // Already covered: no reason to wait for money that has arrived.
    expect(entryStatus({ depositRequired: 6_550, amountPaid: 6_550 })).toBe(
      'AWAITING_CONFIRMATION',
    );
  });

  it('reserves no stock for an order awaiting payment (8.10.3)', () => {
    expect(reservesStockAtPlacement('AWAITING_PAYMENT')).toBe(false);
    expect(reservesStockAtPlacement('AWAITING_CONFIRMATION')).toBe(true);
  });

  it('lets a customer cancel only before the business has committed (8.4)', () => {
    expect(customerMayCancel('AWAITING_PAYMENT')).toBe(true);
    expect(customerMayCancel('AWAITING_CONFIRMATION')).toBe(true);
    expect(customerMayCancel('CONFIRMED')).toBe(false);
    expect(customerMayCancel('IN_PRODUCTION')).toBe(false);
  });
});

/* ---------------------------------------------------------------------------
 * 8.8 Payment status
 * ------------------------------------------------------------------------ */

describe('derivePaymentStatus', () => {
  it('follows the documented branches in order', () => {
    expect(
      derivePaymentStatus({ amountPaid: 0, grandTotal: 100, depositRequired: 50 }),
    ).toBe('UNPAID');
    expect(
      derivePaymentStatus({ amountPaid: 100, grandTotal: 100, depositRequired: 50 }),
    ).toBe('PAID');
    expect(
      derivePaymentStatus({ amountPaid: 50, grandTotal: 100, depositRequired: 50 }),
    ).toBe('DEPOSIT_PAID');
    expect(
      derivePaymentStatus({ amountPaid: 20, grandTotal: 100, depositRequired: 50 }),
    ).toBe('UNPAID');
  });

  it('does not read a part payment as a paid deposit when none is required', () => {
    // A threshold of zero is cleared by any amount, which would be wrong.
    expect(
      derivePaymentStatus({ amountPaid: 20, grandTotal: 100, depositRequired: 0 }),
    ).toBe('UNPAID');
  });

  it('counts succeeded payments and subtracts refunds', () => {
    expect(
      amountPaidFrom([
        { kind: 'DEPOSIT', amount: 5_000, status: 'SUCCEEDED' },
        { kind: 'BALANCE', amount: 5_000, status: 'PENDING' },
        { kind: 'REFUND', amount: 1_000, status: 'SUCCEEDED' },
        { kind: 'FULL', amount: 9_999, status: 'FAILED' },
      ]),
    ).toBe(4_000);
  });
});

/* ---------------------------------------------------------------------------
 * Payment methods
 * ------------------------------------------------------------------------ */

describe('payment methods', () => {
  it('never offers cash on delivery for a custom order', () => {
    expect(availablePaymentMethods({ hasCustomLine: true })).not.toContain('COD');
    expect(supportsPaymentMethod('COD', { hasCustomLine: true })).toBe(false);
    expect(supportsPaymentMethod('BANK_TRANSFER', { hasCustomLine: true })).toBe(true);
  });

  it('offers cash on delivery for a stock-only order', () => {
    expect(availablePaymentMethods({ hasCustomLine: false })).toContain('COD');
  });

  it('never offers an online provider in V1', () => {
    expect(availablePaymentMethods({ hasCustomLine: false })).not.toContain('ONLINE');
  });
});

/* ---------------------------------------------------------------------------
 * 5A / 7. Cart rules
 * ------------------------------------------------------------------------ */

describe('cart rules', () => {
  it('makes a quote-bound cart immutable (5A.1)', () => {
    expect(isMutable('STANDARD')).toBe(true);
    expect(isMutable('QUOTE_BOUND')).toBe(false);

    const result = validateMutation('QUOTE_BOUND', 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('CART_IS_QUOTE_BOUND');
  });

  it('holds the quantity bounds at 1 and 999', () => {
    expect(validateMutation('STANDARD', 1).ok).toBe(true);
    expect(validateMutation('STANDARD', 999).ok).toBe(true);
    expect(validateMutation('STANDARD', 0).ok).toBe(false);
    expect(validateMutation('STANDARD', 1000).ok).toBe(false);
    expect(validateMutation('STANDARD', 1.5).ok).toBe(false);
  });

  it('sums a repeated variant and caps it at what exists', () => {
    expect(mergedQuantity(2, 3, null)).toBe(5);
    expect(mergedQuantity(2, 3, 4)).toBe(4);
    expect(mergedQuantity(0, 5_000, null)).toBe(999);
  });

  it('marks a line as needing production for a custom or made-to-order line', () => {
    expect(requiresProduction({ kind: 'CUSTOM', stockPolicy: 'TRACK' })).toBe(true);
    expect(requiresProduction({ kind: 'STOCK', stockPolicy: 'MADE_TO_ORDER' })).toBe(
      true,
    );
    expect(requiresProduction({ kind: 'STOCK', stockPolicy: 'TRACK' })).toBe(false);
    // Always false for a fee (DATABASE.md section 8 check constraint).
    expect(requiresProduction({ kind: 'FEE', stockPolicy: null })).toBe(false);
  });
});

/* ---------------------------------------------------------------------------
 * What the portal reads (Phase 11)
 * ------------------------------------------------------------------------ */

describe('order status copy', () => {
  it('labels every status the state machine can hold', () => {
    // The account pages render a stored `orders.status` straight through this
    // map, so a status with no label is a page that prints `undefined` on a
    // real row.
    for (const status of Object.keys(ORDER_TRANSITIONS) as OrderStatus[]) {
      expect(ORDER_STATUS_LABELS[status], status).toBeTruthy();
    }

    expect(Object.keys(ORDER_STATUS_LABELS).sort()).toEqual(
      Object.keys(ORDER_TRANSITIONS).sort(),
    );
  });
});

describe('an order in flight', () => {
  it('is anything not delivered, cancelled or refunded', () => {
    for (const status of Object.keys(ORDER_TRANSITIONS) as OrderStatus[]) {
      const settled =
        status === 'DELIVERED' || status === 'CANCELLED' || status === 'REFUNDED';

      expect(isOrderInFlight(status), status).toBe(!settled);
    }
  });

  it('counts an order on hold, because the customer is still waiting', () => {
    expect(isOrderInFlight('ON_HOLD')).toBe(true);
  });
});
