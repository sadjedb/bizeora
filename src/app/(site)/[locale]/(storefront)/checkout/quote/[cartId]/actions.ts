'use server';

import { redirect } from 'next/navigation';

import {
  CHECKOUT_ERROR_LABELS,
  placeOrderFromCart,
} from '@/server/services/checkout-service';
import { readCartOwner } from '@/server/cart/owner';

/**
 * Placing the accepted quote's order.
 *
 * The only difference from the standard checkout action is the cart: this one
 * names it, because a customer may hold a standard cart and any number of
 * quote-bound carts at once (5A.2) and "the active cart" is therefore not a
 * question with one answer.
 *
 * The cart id is not a capability. `placeOrderFromCart` resolves it through
 * `findOwnedCart`, which filters by owner **in the query**, so a cart id
 * belonging to somebody else is "not found".
 *
 * As with every checkout, the payload carries no price, no shipping amount, no
 * total and no deposit. On a quote-bound cart those come from the accepted
 * quote, and 5A.6 fails the placement outright if the reconstructed total does
 * not match it to the centime.
 */

export type QuoteCheckoutResult = { ok: false; message: string };

export async function placeQuoteOrderAction(
  cartId: string,
  raw: unknown,
): Promise<QuoteCheckoutResult> {
  const owner = await readCartOwner();
  if (!owner) return { ok: false, message: CHECKOUT_ERROR_LABELS.CART_NOT_FOUND };

  const result = await placeOrderFromCart(owner, raw, { cartId });
  if (!result.ok) return { ok: false, message: CHECKOUT_ERROR_LABELS[result.error] };

  redirect(`/order/${result.value.orderNumber}`);
}
