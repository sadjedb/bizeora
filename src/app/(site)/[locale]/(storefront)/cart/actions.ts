'use server';

import { revalidatePath } from 'next/cache';

import {
  CART_ERROR_LABELS,
  addToCart,
  removeCartLine,
  updateCartLine,
} from '@/server/services/cart-service';
import { ensureCartOwner, readCartOwner } from '@/server/cart/owner';

/**
 * The cart's four server entry points.
 *
 * Each takes identifiers and a quantity, and nothing else. There is no price
 * parameter anywhere in this file — the same technique the Phase 7 submission
 * boundary used: a field that does not exist cannot be trusted by accident.
 *
 * `ensureCartOwner` is used for adding, because that is the moment a visitor
 * earns a cart and a cookie. Editing and removing use `readCartOwner`, because
 * a request to change a cart that does not exist is not a request to create one.
 */

export type CartActionResult = { ok: true } | { ok: false; message: string };

export async function addToCartAction(input: {
  productSlug: string;
  variantSku: string;
  quantity: number;
}): Promise<CartActionResult> {
  const owner = await ensureCartOwner();
  const result = await addToCart(owner, input);

  if (!result.ok) return { ok: false, message: CART_ERROR_LABELS[result.error] };

  revalidatePath('/cart');
  return { ok: true };
}

export async function updateCartLineAction(input: {
  lineId: string;
  quantity: number;
}): Promise<CartActionResult> {
  const owner = await readCartOwner();
  if (!owner) return { ok: false, message: CART_ERROR_LABELS.CART_NOT_FOUND };

  const result = await updateCartLine(owner, input);
  if (!result.ok) return { ok: false, message: CART_ERROR_LABELS[result.error] };

  revalidatePath('/cart');
  return { ok: true };
}

export async function removeCartLineAction(input: {
  lineId: string;
}): Promise<CartActionResult> {
  const owner = await readCartOwner();
  if (!owner) return { ok: false, message: CART_ERROR_LABELS.CART_NOT_FOUND };

  const result = await removeCartLine(owner, input);
  if (!result.ok) return { ok: false, message: CART_ERROR_LABELS[result.error] };

  revalidatePath('/cart');
  return { ok: true };
}
