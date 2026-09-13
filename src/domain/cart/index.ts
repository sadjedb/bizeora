import { err, ok, type Result } from '../result';

/**
 * Cart rules.
 *
 * `BUSINESS-RULES.md` section 5A and `DATABASE.md` section 7. The distinction
 * this module exists to hold is ADR-015's: **an accepted quote is a
 * commitment, not a cart.**
 *
 * A `STANDARD` cart is a shopping list — lines are added, edited and removed,
 * and priced live from the catalogue at every render so a customer never pays
 * a stale price. A `QUOTE_BOUND` cart contains exactly the accepted quote's
 * lines and nothing else; the only actions are check out and abandon.
 *
 * Every one of these predicates is enforced **server-side**. Hiding a quantity
 * stepper in the UI is presentation; refusing the mutation is the rule.
 */

export type CartKind = 'STANDARD' | 'QUOTE_BOUND';
export type LineKind = 'STOCK' | 'CUSTOM' | 'FEE';

/** `DATABASE.md` section 7: `quantity > 0 and <= 999`. */
export const MAX_LINE_QUANTITY = 999;

export type CartMutationError = {
  code:
    | 'CART_IS_QUOTE_BOUND'
    | 'QUANTITY_TOO_LOW'
    | 'QUANTITY_TOO_HIGH'
    | 'QUANTITY_NOT_AN_INTEGER';
};

/**
 * 5A.1: arbitrary products cannot be added to a quote-bound cart, quantities
 * cannot be edited, and lines cannot be removed.
 *
 * One predicate covers all three because the rule is one rule — the cart's
 * contents are fixed at acceptance. Splitting it into `canAdd`, `canEdit` and
 * `canRemove` would invite a caller to check the wrong one.
 */
export function isMutable(kind: CartKind): boolean {
  return kind === 'STANDARD';
}

/** The quantity bounds a line must satisfy before it reaches the database. */
export function validateQuantity(quantity: number): Result<number, CartMutationError> {
  if (!Number.isInteger(quantity))
    return err({ code: 'QUANTITY_NOT_AN_INTEGER' as const });
  if (quantity < 1) return err({ code: 'QUANTITY_TOO_LOW' as const });
  if (quantity > MAX_LINE_QUANTITY) return err({ code: 'QUANTITY_TOO_HIGH' as const });
  return ok(quantity);
}

/** A mutation is legal only on a standard cart, and only with a sane quantity. */
export function validateMutation(
  kind: CartKind,
  quantity: number,
): Result<number, CartMutationError> {
  if (!isMutable(kind)) return err({ code: 'CART_IS_QUOTE_BOUND' as const });
  return validateQuantity(quantity);
}

/**
 * Adding a variant that is already in the cart increments rather than
 * duplicates — the partial unique index `(cartId, variantId) where
 * kind='STOCK'` in `DATABASE.md` section 7 makes that the only possible
 * outcome, so the arithmetic belongs here rather than in a repository.
 *
 * `available` caps the result. Section 10.3 is clear that a cart is not a
 * commitment and nothing is reserved by adding, but offering to put 400 of
 * something in a cart when 3 exist is a promise checkout will have to break.
 * `null` means the variant's policy does not track stock, so there is no cap.
 */
export function mergedQuantity(
  existing: number,
  added: number,
  available: number | null,
): number {
  const total = existing + added;
  const capped = available === null ? total : Math.min(total, available);
  return Math.min(capped, MAX_LINE_QUANTITY);
}

/**
 * 5A.4: coupons are disabled on a quote-bound cart — the price was already
 * negotiated, and stacking a coupon on it would discount a discount.
 *
 * Coupons themselves are V1.5. This predicate exists now because the cart it
 * guards exists now, and the answer must not be left to whoever builds them.
 */
export function acceptsCoupons(kind: CartKind): boolean {
  return kind === 'STANDARD';
}

/**
 * 5A.5 and 2.7: quantity discounts are not re-applied to a quote-bound cart —
 * the admin already priced them into the quote's lines — and a quote-locked
 * line ignores catalogue changes entirely, including sale prices.
 */
export function usesLivePricing(kind: CartKind): boolean {
  return kind === 'STANDARD';
}

/**
 * 8.3 and 10.2: a line requires production when it carries a customisation, or
 * when its variant is made to order. Drives `order_items.requiresProduction`
 * and therefore whether the order can enter `DESIGN_REVIEW`.
 */
export function requiresProduction(input: {
  kind: LineKind;
  stockPolicy: 'TRACK' | 'DONT_TRACK' | 'MADE_TO_ORDER' | null;
}): boolean {
  if (input.kind === 'FEE') return false;
  if (input.kind === 'CUSTOM') return true;
  return input.stockPolicy === 'MADE_TO_ORDER';
}
