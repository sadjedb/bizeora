import 'server-only';

import { z } from 'zod';

import { availableQuantity } from '@/domain/order/availability';
import {
  isMutable,
  mergedQuantity,
  validateMutation,
  validateQuantity,
} from '@/domain/cart';
import {
  addCustomLine,
  ensureActiveStandardCart,
  findActiveStandardCart,
  findOwnedCart,
  loadPlacementModifiers,
  removeLine as removeLineRow,
  resolveCustomizationForCart,
  resolvePurchasableVariant,
  setLineQuantity,
  upsertStockLine,
  type CartData,
  type CartOwner,
} from '@/server/repositories/cart-repository';
import {
  loadCommerceSettings,
  loadDiscountTiers,
} from '@/server/repositories/settings-repository';
import { priceCart, type PricedCart, type PricingContext } from './cart-pricing';

/**
 * Cart use cases.
 *
 * The security boundary for everything a customer can do to a cart. The client
 * sends a slug, an SKU, a line id and a quantity; it never sends a price, and
 * there is nowhere in these schemas for one to arrive.
 *
 * Section 10.3: **stock is not reserved by adding to a cart.** Availability is
 * checked here so the customer gets honest feedback, and checked again
 * authoritatively at placement. A cart is not a commitment, and reserving on
 * add lets a bot exhaust the inventory.
 */

export type CartError =
  | 'PRODUCT_NOT_FOUND'
  | 'OUT_OF_STOCK'
  | 'INVALID_QUANTITY'
  | 'CART_IS_QUOTE_BOUND'
  | 'CART_NOT_FOUND'
  | 'LINE_NOT_FOUND'
  | 'CONFIGURATION_NOT_FOUND'
  | 'CONFIGURATION_NEEDS_QUOTE';

export type CartResult<T> = { ok: true; value: T } | { ok: false; error: CartError };

export const CART_ERROR_LABELS: Record<CartError, string> = {
  PRODUCT_NOT_FOUND: 'Cet article n’est plus disponible.',
  OUT_OF_STOCK: 'Le stock disponible ne couvre pas cette quantité.',
  INVALID_QUANTITY: 'Cette quantité n’est pas valide.',
  CART_IS_QUOTE_BOUND:
    'Cette commande correspond à un devis accepté et ne peut pas être modifiée.',
  CART_NOT_FOUND: 'Votre panier est introuvable.',
  LINE_NOT_FOUND: 'Cet article n’est plus dans votre panier.',
  CONFIGURATION_NOT_FOUND: 'Cette personnalisation est introuvable.',
  CONFIGURATION_NEEDS_QUOTE:
    'Cette personnalisation nécessite un devis et ne peut pas être ajoutée au panier.',
};

/* ---------------------------------------------------------------------------
 * Input
 * ------------------------------------------------------------------------ */

export const addToCartInput = z.object({
  productSlug: z.string().min(1).max(200),
  variantSku: z.string().min(1).max(120),
  quantity: z.number().int().min(1).max(999),
});

export const updateLineInput = z.object({
  lineId: z.uuid(),
  quantity: z.number().int().min(1).max(999),
});

export const removeLineInput = z.object({ lineId: z.uuid() });

/* ---------------------------------------------------------------------------
 * Pricing
 * ------------------------------------------------------------------------ */

/**
 * Price a cart through the single path.
 *
 * Exported because checkout and order placement need exactly this, with a
 * shipping total added — not a second implementation that agrees today.
 */
export async function priceCartData(
  cart: CartData,
  shippingTotal?: number,
): Promise<PricedCart> {
  const customPairs = cart.lines
    .filter(
      (line) => line.customization?.placementId && line.product?.customizationProfileId,
    )
    .map((line) => ({
      profileId: line.product!.customizationProfileId!,
      placementId: line.customization!.placementId!,
    }));

  const [settings, tiers, placementModifiers] = await Promise.all([
    loadCommerceSettings(),
    loadDiscountTiers(),
    loadPlacementModifiers(customPairs),
  ]);

  const context: PricingContext = { settings, tiers, placementModifiers, shippingTotal };
  return priceCart(cart, context);
}

/** The customer's cart as it should be rendered, or null when empty. */
export async function getCartView(owner: CartOwner): Promise<PricedCart | null> {
  const cart = await findActiveStandardCart(owner);
  if (!cart) return null;
  return priceCartData(cart);
}

/* ---------------------------------------------------------------------------
 * Mutations
 * ------------------------------------------------------------------------ */

export async function addToCart(
  owner: CartOwner,
  raw: unknown,
): Promise<CartResult<{ cartId: string; quantity: number }>> {
  const parsed = addToCartInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'INVALID_QUANTITY' };

  const input = parsed.data;

  const resolved = await resolvePurchasableVariant({
    productSlug: input.productSlug,
    variantSku: input.variantSku,
  });

  if (!resolved) return { ok: false, error: 'PRODUCT_NOT_FOUND' };

  const cartId = await ensureActiveStandardCart(owner);
  const cart = await findOwnedCart(cartId, owner);
  if (!cart) return { ok: false, error: 'CART_NOT_FOUND' };

  const mutation = validateMutation(cart.kind, input.quantity);
  if (!mutation.ok) {
    return {
      ok: false,
      error:
        mutation.error.code === 'CART_IS_QUOTE_BOUND'
          ? 'CART_IS_QUOTE_BOUND'
          : 'INVALID_QUANTITY',
    };
  }

  const existing = cart.lines.find(
    (line) => line.kind === 'STOCK' && line.variant?.id === resolved.variantId,
  );

  const cap =
    resolved.stockPolicy === 'TRACK'
      ? availableQuantity({
          isActive: true,
          stockQuantity: resolved.stockQuantity,
          reservedQuantity: resolved.reservedQuantity,
        })
      : null;

  if (cap !== null && cap < 1) return { ok: false, error: 'OUT_OF_STOCK' };

  const quantity = mergedQuantity(existing?.quantity ?? 0, input.quantity, cap);

  // Nothing to do rather than a silent no-op that reads as success: the
  // requested quantity is entirely beyond what exists.
  if (existing && quantity === existing.quantity && cap !== null && quantity === cap) {
    return { ok: false, error: 'OUT_OF_STOCK' };
  }

  await upsertStockLine({
    cartId,
    productId: resolved.productId,
    variantId: resolved.variantId,
    quantity,
  });

  return { ok: true, value: { cartId, quantity } };
}

/**
 * Add a fixed-price customisation to the cart.
 *
 * 2.3: only a `FIXED` configuration may be bought at a price the system chose.
 * A `QUOTE` configuration goes through the quote flow, and this refuses it
 * rather than inventing a number for it.
 */
export async function addCustomizationToCart(
  owner: CartOwner,
  input: { customizationConfigId: string; quantity: number },
): Promise<CartResult<{ cartId: string }>> {
  const quantity = validateQuantity(input.quantity);
  if (!quantity.ok) return { ok: false, error: 'INVALID_QUANTITY' };

  const config = await resolveCustomizationForCart(input.customizationConfigId);
  if (!config) return { ok: false, error: 'CONFIGURATION_NOT_FOUND' };
  if (config.pricingMode !== 'FIXED') {
    return { ok: false, error: 'CONFIGURATION_NEEDS_QUOTE' };
  }

  const cartId = await ensureActiveStandardCart(owner);
  const cart = await findOwnedCart(cartId, owner);
  if (!cart || !isMutable(cart.kind)) return { ok: false, error: 'CART_IS_QUOTE_BOUND' };

  await addCustomLine({
    cartId,
    productId: config.productId,
    variantId: config.variantId,
    customizationConfigId: config.id,
    quantity: quantity.value,
  });

  return { ok: true, value: { cartId } };
}

export async function updateCartLine(
  owner: CartOwner,
  raw: unknown,
): Promise<CartResult<{ cartId: string }>> {
  const parsed = updateLineInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'INVALID_QUANTITY' };

  const cart = await findActiveStandardCart(owner);
  if (!cart) return { ok: false, error: 'CART_NOT_FOUND' };

  const mutation = validateMutation(cart.kind, parsed.data.quantity);
  if (!mutation.ok) {
    return {
      ok: false,
      error:
        mutation.error.code === 'CART_IS_QUOTE_BOUND'
          ? 'CART_IS_QUOTE_BOUND'
          : 'INVALID_QUANTITY',
    };
  }

  const line = cart.lines.find((candidate) => candidate.id === parsed.data.lineId);
  if (!line) return { ok: false, error: 'LINE_NOT_FOUND' };

  // Stock is re-checked on every quantity change, so the number in the cart is
  // one the customer could actually buy. It is still re-checked at placement.
  if (line.variant && line.product?.stockPolicy === 'TRACK') {
    if (availableQuantity(line.variant) < parsed.data.quantity) {
      return { ok: false, error: 'OUT_OF_STOCK' };
    }
  }

  await setLineQuantity({
    cartId: cart.id,
    lineId: parsed.data.lineId,
    quantity: parsed.data.quantity,
  });

  return { ok: true, value: { cartId: cart.id } };
}

export async function removeCartLine(
  owner: CartOwner,
  raw: unknown,
): Promise<CartResult<{ cartId: string }>> {
  const parsed = removeLineInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'LINE_NOT_FOUND' };

  const cart = await findActiveStandardCart(owner);
  if (!cart) return { ok: false, error: 'CART_NOT_FOUND' };
  if (!isMutable(cart.kind)) return { ok: false, error: 'CART_IS_QUOTE_BOUND' };

  const line = cart.lines.find((candidate) => candidate.id === parsed.data.lineId);
  if (!line) return { ok: false, error: 'LINE_NOT_FOUND' };

  await removeLineRow({ cartId: cart.id, lineId: parsed.data.lineId });
  return { ok: true, value: { cartId: cart.id } };
}

/** The badge in the header. Counts units, not lines. */
export async function countCartUnits(owner: CartOwner): Promise<number> {
  const cart = await findActiveStandardCart(owner);
  if (!cart) return 0;
  return cart.lines.reduce((total, line) => total + line.quantity, 0);
}
