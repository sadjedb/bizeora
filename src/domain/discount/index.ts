import { applyBasisPoints } from '../money';

/**
 * Quantity discount tiers.
 *
 * `BUSINESS-RULES.md` section 2.5. The tiers themselves are **rows in
 * `discount_tiers`**, admin-editable (ADR-017); the selection is domain code.
 * That split is the whole point: the owner changes the numbers without a
 * deploy, and the rule that picks one stays testable.
 *
 * The discount applies to the **embroidery component only, never to the garment
 * price** (2.5), and it is shown as its own line rather than folded into a unit
 * price, so a customer can see what they were given.
 */

export type DiscountTier = {
  minQuantity: number;
  /** `null` means open-ended — the 50+ tier. */
  maxQuantity: number | null;
  discountBasisPoints: number;
};

export type TierSelection =
  { ok: true; tier: DiscountTier } | { ok: false; reason: 'no-matching-tier' };

/**
 * The tier that applies to a quantity.
 *
 * Section 2.5.1: exactly one active row matches, guaranteed by the non-overlap
 * and full-coverage constraints in `DATABASE.md` section 18. So this is a
 * lookup, not a search with a tie-break.
 *
 * Section 2.5.2: a quantity with no matching tier is a **data defect, not a
 * zero discount**, and this returns a typed error rather than silently
 * discounting nothing — a silent zero is indistinguishable from a correct
 * result, which is what makes it dangerous.
 */
export function selectDiscountTier(
  tiers: readonly DiscountTier[],
  quantity: number,
): TierSelection {
  const tier = tiers.find(
    (candidate) =>
      quantity >= candidate.minQuantity &&
      (candidate.maxQuantity === null || quantity <= candidate.maxQuantity),
  );

  if (!tier) return { ok: false, reason: 'no-matching-tier' };
  return { ok: true, tier };
}

/**
 * The discount on an embroidery component, in minor units.
 *
 * Section 2.5.3: `applyBasisPoints(embroideryComponent, tier.discountBasisPoints)`,
 * rounded once.
 */
export function quantityDiscount(
  embroideryComponent: number,
  tier: DiscountTier,
): number {
  return applyBasisPoints(embroideryComponent, tier.discountBasisPoints);
}
