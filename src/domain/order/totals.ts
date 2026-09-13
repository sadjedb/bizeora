import { err, ok, type Result } from '../result';

/**
 * The order totals pipeline.
 *
 * `BUSINESS-RULES.md` 5.1, and section 16 requires it to exist **once**, used
 * identically by the cart, checkout, order placement and the admin. A cart that
 * adds up differently from the order it becomes is the classic commerce bug,
 * and the only reliable defence is that there is nowhere else to add up.
 *
 *     lineTotal_i   = unitPrice_i * quantity_i - lineDiscount_i
 *     subtotal      = sum(lineTotal_i)
 *     discountTotal = quantityDiscount + couponDiscount
 *     shippingTotal = resolveShipping(...)
 *     taxTotal      = 0 in V1
 *     grandTotal    = subtotal - discountTotal + shippingTotal + taxTotal
 *
 * All amounts are integer minor units (ADR-012). `discountTotal` is a
 * **positive magnitude that is subtracted**, matching the column comment in
 * `DATABASE.md` section 8 — a negative discount would add money.
 */

export type TotalsLine = {
  unitPrice: number;
  quantity: number;
  /** Positive magnitude subtracted from this line. */
  lineDiscount: number;
};

export type OrderTotals = {
  subtotal: number;
  discountTotal: number;
  shippingTotal: number;
  taxTotal: number;
  grandTotal: number;
};

export type TotalsError = {
  code: 'NEGATIVE_TOTAL' | 'NEGATIVE_COMPONENT' | 'NON_INTEGER_AMOUNT';
};

/** 5.1, and the `lineTotal = unitPrice * quantity - lineDiscount` check in the schema. */
export function lineTotal(line: TotalsLine): number {
  return line.unitPrice * line.quantity - line.lineDiscount;
}

/**
 * The whole order, added up once.
 *
 * Returns a Result rather than a number because two of the failures are worth
 * refusing rather than storing: a negative grand total (a discount larger than
 * the order) and a non-integer amount (a float that escaped ADR-012 somewhere
 * upstream). Both would satisfy the database's arithmetic check constraint
 * while being nonsense, so they are caught here where the reason is still known.
 */
export function orderTotals(input: {
  lines: readonly TotalsLine[];
  discountTotal: number;
  shippingTotal: number;
  taxTotal?: number;
}): Result<OrderTotals, TotalsError> {
  const taxTotal = input.taxTotal ?? 0;

  const amounts = [
    ...input.lines.flatMap((line) => [line.unitPrice, line.quantity, line.lineDiscount]),
    input.discountTotal,
    input.shippingTotal,
    taxTotal,
  ];

  if (!amounts.every(Number.isInteger))
    return err({ code: 'NON_INTEGER_AMOUNT' as const });

  if (input.discountTotal < 0 || input.shippingTotal < 0 || taxTotal < 0) {
    return err({ code: 'NEGATIVE_COMPONENT' as const });
  }

  const subtotal = input.lines.reduce((sum, line) => sum + lineTotal(line), 0);
  const grandTotal = subtotal - input.discountTotal + input.shippingTotal + taxTotal;

  if (grandTotal < 0 || subtotal < 0) return err({ code: 'NEGATIVE_TOTAL' as const });

  return ok({
    subtotal,
    discountTotal: input.discountTotal,
    shippingTotal: input.shippingTotal,
    taxTotal,
    grandTotal,
  });
}

/**
 * 5A.6: a quote-bound order's reconstructed total must equal the accepted
 * `quote.grandTotal` **exactly**.
 *
 * This is the single assertion that makes "the customer pays what they
 * accepted" verifiable rather than assumed, so it is a function with a name
 * rather than an inline `===` somewhere in a service.
 */
export function reconcilesWithQuote(
  totals: OrderTotals,
  quoteGrandTotal: number,
): boolean {
  return totals.grandTotal === quoteGrandTotal;
}
