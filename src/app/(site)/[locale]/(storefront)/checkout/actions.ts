'use server';

import { redirect } from 'next/navigation';

import {
  CHECKOUT_ERROR_LABELS,
  placeOrderFromCart,
  quoteDelivery,
  type DeliveryQuote,
} from '@/server/services/checkout-service';
import { clearGuestCartCookie, readCartOwner } from '@/server/cart/owner';

/**
 * Checkout's two server entry points.
 *
 * `quoteDeliveryAction` is what makes "selecting a wilaya recalculates delivery
 * server-side" (`UX.md` section 7) true rather than decorative: the browser
 * sends a wilaya code and receives prices it had no part in computing.
 *
 * `placeOrderAction` takes the form. It carries no total, no shipping amount
 * and no deposit — the service's schema has no field for them.
 */

export type DeliveryQuoteResult =
  { ok: true; options: readonly DeliveryQuote[] } | { ok: false; message: string };

export async function quoteDeliveryAction(input: {
  wilayaCode: number;
}): Promise<DeliveryQuoteResult> {
  const owner = await readCartOwner();
  if (!owner) return { ok: false, message: CHECKOUT_ERROR_LABELS.CART_NOT_FOUND };

  const result = await quoteDelivery(owner, input.wilayaCode);
  if (!result.ok) return { ok: false, message: CHECKOUT_ERROR_LABELS[result.error] };

  return { ok: true, options: result.value };
}

export type PlaceOrderActionResult = { ok: false; message: string };

/**
 * Place the order and leave for the confirmation page.
 *
 * On success this redirects and never returns, which is deliberate: the
 * confirmation is a real URL the customer can return to, and a guest carries
 * the order's own token there rather than the cart cookie, which is spent.
 */
export async function placeOrderAction(raw: unknown): Promise<PlaceOrderActionResult> {
  const owner = await readCartOwner();
  if (!owner) return { ok: false, message: CHECKOUT_ERROR_LABELS.CART_NOT_FOUND };

  const result = await placeOrderFromCart(owner, raw);
  if (!result.ok) return { ok: false, message: CHECKOUT_ERROR_LABELS[result.error] };

  if (owner.kind === 'guest') await clearGuestCartCookie();

  const query = result.value.guestToken
    ? `?token=${encodeURIComponent(result.value.guestToken)}`
    : '';

  redirect(`/order/${result.value.orderNumber}${query}`);
}
