import { applyBasisPoints } from '../money';

/**
 * Deposits.
 *
 * `BUSINESS-RULES.md` 5.5:
 *
 *     depositRequired =
 *       order derives from a quote     -> quote.depositRequired   // COPIED
 *       order contains no custom line  -> 0
 *       payment method is prepaid      -> grandTotal
 *       otherwise                      -> applyBasisPoints(grandTotal,
 *                                           settings.custom_orders.depositPercent)
 *
 * The order of those branches is the rule, not an implementation detail, so
 * this function follows it top to bottom.
 *
 * `depositPercent` is **basis points** (section 1.6, ADR-018): the 50% default
 * is `5000`, never `0.5`. The document notes that an earlier draft wrote
 * `grandTotal * depositPercent`, which is only correct for a float — that form
 * is superseded, and `applyBasisPoints` is the single conversion.
 *
 * 5.5.1 is the branch people get wrong: a quote-derived order **copies** the
 * quote's deposit and never recomputes it from the current percentage. The
 * deposit is part of what the customer accepted, so a settings change between
 * acceptance and checkout does not move it.
 */

export type DepositInput = {
  /**
   * The accepted quote's `depositRequired`, or `null` when the order does not
   * derive from a quote. A quote with a deposit of zero is still a quote: the
   * distinction is `null` versus `0`, which is why this is not a number alone.
   */
  quoteDepositRequired: number | null;
  /** Whether any line is `CUSTOM` — a stock-only order never has a deposit. */
  hasCustomLine: boolean;
  /** V1 has no prepaid method; the branch exists because the rule does. */
  isPrepaidMethod: boolean;
  grandTotal: number;
  /** `settings.custom_orders.depositPercent`, in basis points. */
  depositPercentBasisPoints: number;
};

export function depositFor(input: DepositInput): number {
  if (input.quoteDepositRequired !== null) return input.quoteDepositRequired;
  if (!input.hasCustomLine) return 0;
  if (input.isPrepaidMethod) return input.grandTotal;

  const deposit = applyBasisPoints(input.grandTotal, input.depositPercentBasisPoints);

  // `depositRequired <= grandTotal` is a check constraint on the table
  // (DATABASE.md section 8). A percentage above 100 is a settings error rather
  // than a licence to bill more than the order is worth.
  return Math.min(deposit, input.grandTotal);
}

/** 5.5: what is still owed after the deposit, shown as "due on delivery". */
export function balanceAfterDeposit(grandTotal: number, depositRequired: number): number {
  return Math.max(0, grandTotal - depositRequired);
}
