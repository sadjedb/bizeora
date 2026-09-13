import { applyBasisPoints } from '../money';
import { quantityDiscount, selectDiscountTier, type DiscountTier } from '../discount';

/**
 * Customisation pricing and the builder estimate.
 *
 * `BUSINESS-RULES.md` sections 2.2, 2.4 and 2.5, which section 16 requires to
 * live in `domain/pricing` exactly once, consumed by the builder estimate, the
 * cart and the quote builder.
 *
 * Section 2.2:
 *
 *     customizationUnitPrice = embroiderySize.basePrice
 *                            + placementModifier
 *                            + threadColorSurcharge(count)
 *                            + textSurcharge(text)
 *
 *     customLineUnitPrice = productUnitPrice + customizationUnitPrice
 *     customLineTotal     = customLineUnitPrice * quantity + setupFee
 *
 * The setup fee is charged **once per configuration, not per unit**, appears as
 * its own line, and is waived above a quantity threshold.
 *
 * Every rate arrives as a parameter. None is hard-coded: they are settings the
 * owner edits, and a number baked in here would be a price nobody can change.
 */

export type CustomizationRates = {
  /** Charged per colour **beyond the first** (section 2.2). */
  threadColorSurchargePerColor: number;
  /** Charged once per unit when the configuration carries embroidered text. */
  textSurcharge: number;
  /** Charged once per configuration, not per unit. */
  setupFee: number;
  /** Quantity at or above which the setup fee is waived. */
  setupFeeWaiverQuantity: number;
  /** `custom_orders.estimateBandPercent`, basis points. Default 1500 = 15%. */
  estimateBandBasisPoints: number;
};

export type CustomizationPriceInput = {
  /** The garment, already resolved by `resolveUnitPrice`. */
  productUnitPrice: number;
  /** `embroidery_sizes.basePrice`. */
  embroiderySizeBasePrice: number;
  /** `profile_placements.priceModifier`. May be negative. */
  placementModifier: number;
  threadColorCount: number;
  hasText: boolean;
  quantity: number;
};

/** The surcharge for colours beyond the first (section 2.2). */
export function threadColorSurcharge(threadColorCount: number, perColor: number): number {
  // One colour is included. A count below one is a data problem, not a credit.
  return Math.max(0, threadColorCount - 1) * perColor;
}

/** What the embroidery adds to one unit, before any discount. */
export function customizationUnitPrice(
  input: CustomizationPriceInput,
  rates: CustomizationRates,
): number {
  return (
    input.embroiderySizeBasePrice +
    input.placementModifier +
    threadColorSurcharge(input.threadColorCount, rates.threadColorSurchargePerColor) +
    (input.hasText ? rates.textSurcharge : 0)
  );
}

/** Charged once per configuration, waived at or above the threshold quantity. */
export function setupFeeFor(quantity: number, rates: CustomizationRates): number {
  return quantity >= rates.setupFeeWaiverQuantity ? 0 : rates.setupFee;
}

export type CustomLineBreakdown = {
  /** Garment price for one unit. */
  productUnitPrice: number;
  /** Embroidery price for one unit, before the quantity discount. */
  customizationUnitPrice: number;
  /** The embroidery component across the whole line — what the discount applies to. */
  embroideryComponent: number;
  /** The garment component across the whole line. Never discounted (2.5). */
  garmentComponent: number;
  /** Applied tier, so the UI can show "25 units, −10%" rather than a bare number. */
  discountBasisPoints: number;
  discountAmount: number;
  setupFee: number;
  /** What the customer would pay, before delivery. */
  total: number;
};

export type CustomLineResult =
  | { ok: true; breakdown: CustomLineBreakdown }
  | { ok: false; reason: 'no-matching-tier' };

/**
 * The full line, broken down.
 *
 * Returns the parts rather than one number, because section 2.5 requires the
 * discount to be shown as an explicit line and never folded silently into a
 * unit price. A caller that only wants the total takes `.total`; a caller that
 * has to explain it has everything it needs.
 *
 * Propagates the tier lookup's typed error (section 2.5.2) rather than
 * defaulting to zero, because a silent zero discount is indistinguishable from
 * a correct one.
 */
export function priceCustomLine(
  input: CustomizationPriceInput,
  rates: CustomizationRates,
  tiers: readonly DiscountTier[],
): CustomLineResult {
  const selection = selectDiscountTier(tiers, input.quantity);
  if (!selection.ok) return { ok: false, reason: selection.reason };

  const unitCustomization = customizationUnitPrice(input, rates);
  const embroideryComponent = unitCustomization * input.quantity;
  const garmentComponent = input.productUnitPrice * input.quantity;
  const discountAmount = quantityDiscount(embroideryComponent, selection.tier);
  const setupFee = setupFeeFor(input.quantity, rates);

  return {
    ok: true,
    breakdown: {
      productUnitPrice: input.productUnitPrice,
      customizationUnitPrice: unitCustomization,
      embroideryComponent,
      garmentComponent,
      discountBasisPoints: selection.tier.discountBasisPoints,
      discountAmount,
      setupFee,
      total: garmentComponent + embroideryComponent - discountAmount + setupFee,
    },
  };
}

export type Estimate = {
  /** In `FIXED` mode both bounds are the computed total. */
  min: number;
  max: number;
};

/**
 * The estimate shown in the builder.
 *
 * Section 2.4.1: an estimate is shown at **every** step, including in quote
 * mode — there is no state in which the customer is shown no number. That rule
 * is why this never returns null.
 *
 * Section 2.4.2: in quote mode it is a band around the computed total, from
 * `estimateBandPercent`, always with the caveat that the quote confirms the
 * final price. Section 2.4.3: an estimate is never binding.
 */
export function estimateFor(
  total: number,
  mode: 'FIXED' | 'QUOTE',
  rates: CustomizationRates,
): Estimate {
  if (mode === 'FIXED') return { min: total, max: total };

  const band = applyBasisPoints(total, rates.estimateBandBasisPoints);
  // Clamped at zero: a band wider than the total would otherwise quote a
  // negative floor, which is not a price.
  return { min: Math.max(0, total - band), max: total + band };
}
