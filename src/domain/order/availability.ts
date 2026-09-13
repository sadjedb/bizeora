/**
 * Stock availability.
 *
 * `BUSINESS-RULES.md` section 16 places this in `domain/order` and names the
 * **product page** as one of its consumers, alongside the cart and order
 * placement. It lives here so the answer the storefront shows and the answer
 * placement enforces cannot drift apart.
 *
 * Section 10:
 *
 *   10.1  Stock is tracked per variant, never per product.
 *   10.2  `TRACK` enforces availability; `DONT_TRACK` and `MADE_TO_ORDER` are
 *         always available.
 *   10.4  available = stockQuantity - reservedQuantity
 *
 * Reading availability is not reserving it. Section 10.3 is explicit that a
 * cart is not a commitment and nothing is reserved before confirmation, so
 * these functions are pure reads with no side effect anywhere in the system.
 */

export type StockPolicy = 'TRACK' | 'DONT_TRACK' | 'MADE_TO_ORDER';

/** Everything availability reads from a variant. */
export type StockedVariant = {
  isActive: boolean;
  stockQuantity: number;
  reservedQuantity: number;
};

/**
 * Units that could be committed right now.
 *
 * Only meaningful under `TRACK`. Clamped at zero because a negative available
 * count is a data problem, not an invitation to sell backwards.
 */
export function availableQuantity(variant: StockedVariant): number {
  return Math.max(0, variant.stockQuantity - variant.reservedQuantity);
}

/**
 * Whether one variant can be bought.
 *
 * Section 2.1: an inactive variant cannot be purchased even when its product is
 * active — so `isActive` is checked before the policy, not after.
 */
export function isVariantPurchasable(
  variant: StockedVariant,
  policy: StockPolicy,
): boolean {
  if (!variant.isActive) return false;
  if (policy === 'TRACK') return availableQuantity(variant) > 0;
  return true;
}

/**
 * Whether a product can be bought at all.
 *
 * Section 11.2: purchasable means visible **and** carrying at least one active
 * variant available under its stock policy. Section 11.3 then says a visible
 * product with no purchasable variant is *not hidden* — it renders as
 * unavailable, keeping its URL and its SEO value. That is why this returns a
 * boolean for the page to render rather than a reason to 404.
 *
 * A product with no variants at all is treated as purchasable when its policy
 * says stock is not tracked: a made-to-order piece that has not had variants
 * generated yet is still something the business will make.
 */
export function isProductPurchasable(
  variants: readonly StockedVariant[],
  policy: StockPolicy,
): boolean {
  if (variants.length === 0) return policy !== 'TRACK';
  return variants.some((variant) => isVariantPurchasable(variant, policy));
}
