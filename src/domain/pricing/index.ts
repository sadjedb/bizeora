/**
 * Unit price resolution.
 *
 * `BUSINESS-RULES.md` section 16 requires this to exist exactly once, in
 * `domain/`, because the product page, the cart, checkout, the admin and the
 * quote builder all need the same answer. A second implementation that happens
 * to agree today is still a defect.
 *
 * Section 2.1:
 *
 *     unitPrice(variant, product) = variant.priceOverride ?? product.basePrice
 *
 * Pure, and typed against the two fields it actually reads rather than against
 * a Prisma model — this module must stay importable from a unit test with a
 * literal, and `domain/` may not see Prisma at all.
 *
 * Customisation surcharges, quantity discounts and the estimate range are also
 * `domain/pricing`'s job and arrive with the builder in Phase 7.
 */

/** Everything price resolution reads from a variant. */
export type PricedVariant = {
  priceOverride: number | null;
  compareAtPriceOverride: number | null;
};

/** Everything price resolution reads from a product. */
export type PricedProduct = {
  basePrice: number;
  compareAtPrice: number | null;
};

/**
 * The price of one unit, in integer minor units (ADR-012).
 *
 * A variant with no override inherits the product's base price. `null` is
 * "inherit", not "free" — which is why the check is `??` and not `||`, since a
 * legitimate override of `0` must survive.
 */
export function resolveUnitPrice(
  product: PricedProduct,
  variant?: PricedVariant | null,
): number {
  return variant?.priceOverride ?? product.basePrice;
}

/**
 * The struck-through "was" price, or `null` when there is nothing to show.
 *
 * Section 2.1: `compareAtPrice` is display-only, must be **strictly greater**
 * than the effective price, and never participates in a calculation. A stored
 * value at or below the current price is a data error rather than a discount,
 * and rendering it would advertise a price rise as a saving.
 */
export function resolveCompareAtPrice(
  product: PricedProduct,
  variant?: PricedVariant | null,
): number | null {
  const effective = resolveUnitPrice(product, variant);
  const compareAt = variant?.compareAtPriceOverride ?? product.compareAtPrice;

  if (compareAt === null || compareAt <= effective) return null;
  return compareAt;
}
