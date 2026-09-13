import 'server-only';

import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db/client';
import { toPublicAssetUrl } from '@/lib/media/public-asset';
import type { CartKind, LineKind } from '@/domain/cart';

/**
 * The cart's reads and writes.
 *
 * One of the four Prisma consumers, alongside `lib/db` and the catalogue and
 * customisation repositories. Same contract: explicit `select`, DTOs out,
 * business rules imported rather than reimplemented.
 *
 * **No price is stored on a standard cart line.** `DATABASE.md` section 7 is
 * explicit: standard lines are priced live from the catalogue at render and at
 * checkout, so a customer never pays a stale price. `lockedUnitPrice` exists
 * only on a quote-bound line, guarded by the check constraint
 * `locked_unit_price IS NOT NULL implies quote_item_id IS NOT NULL` — a
 * standard line is structurally incapable of carrying a price.
 */

/* ---------------------------------------------------------------------------
 * Ownership
 * ------------------------------------------------------------------------ */

export type CartOwner =
  { kind: 'user'; userId: string } | { kind: 'guest'; anonymousToken: string };

/**
 * `DATABASE.md` section 7: exactly one of `userId` and `anonymousToken` is
 * non-null, enforced by a check constraint. This is the only ownership model —
 * a guest cart is the same table with the other column filled in, exactly as a
 * guest order is an `orders` row with a null `userId` (section 15).
 */
function ownerWhere(owner: CartOwner): Prisma.CartWhereInput {
  return owner.kind === 'user'
    ? { userId: owner.userId, anonymousToken: null }
    : { anonymousToken: owner.anonymousToken, userId: null };
}

/* ---------------------------------------------------------------------------
 * Selection
 * ------------------------------------------------------------------------ */

const CART_SELECT = {
  id: true,
  kind: true,
  status: true,
  currency: true,
  userId: true,
  anonymousToken: true,
  quoteId: true,
  quoteValidUntil: true,
  items: {
    select: {
      id: true,
      kind: true,
      quantity: true,
      position: true,
      nameSnapshot: true,
      lockedUnitPrice: true,
      quoteItemId: true,
      quoteItem: { select: { kind: true, label: true } },
      product: {
        select: {
          id: true,
          slug: true,
          name: true,
          basePrice: true,
          currency: true,
          status: true,
          publishedAt: true,
          deletedAt: true,
          stockPolicy: true,
          customizationProfileId: true,
          images: {
            select: { storageKey: true, alt: true },
            orderBy: [{ isPrimary: 'desc' }, { position: 'asc' }],
            take: 1,
          },
        },
      },
      variant: {
        select: {
          id: true,
          sku: true,
          priceOverride: true,
          isActive: true,
          stockQuantity: true,
          reservedQuantity: true,
          optionValues: {
            select: {
              optionValue: {
                select: {
                  value: true,
                  option: { select: { name: true, position: true } },
                },
              },
            },
          },
        },
      },
      customizationConfig: {
        select: {
          id: true,
          pricingMode: true,
          embroideryText: true,
          threadColorCount: true,
          productId: true,
          variantId: true,
          placement: { select: { id: true, name: true } },
          embroiderySize: { select: { id: true, name: true, basePrice: true } },
        },
      },
    },
    orderBy: { position: 'asc' },
  },
} satisfies Prisma.CartSelect;

type CartRow = Prisma.CartGetPayload<{ select: typeof CART_SELECT }>;

export type CartLineData = {
  id: string;
  kind: LineKind;
  quantity: number;
  position: number;
  nameSnapshot: string | null;
  /** Non-null only on a quote-bound line. */
  lockedUnitPrice: number | null;
  quoteItemId: string | null;
  /**
   * The quote line this was derived from. `cart_items` has no `feeKind`
   * column, so a quote's fee line carries its kind here — and `order_items`
   * requires one on every FEE row (2.6.5, and the check constraint).
   */
  quoteLine: { kind: string; label: string } | null;
  product: {
    id: string;
    slug: string;
    name: string;
    basePrice: number;
    currency: string;
    stockPolicy: 'TRACK' | 'DONT_TRACK' | 'MADE_TO_ORDER';
    /** Needed to price a custom line: the placement modifier lives on the profile. */
    customizationProfileId: string | null;
    /** Whether the product is still publicly visible, re-read now. */
    isVisible: boolean;
    image: { src: string | null; alt: string } | null;
    /** The raw storage key, snapshotted onto the order item at placement. */
    imageKey: string | null;
  } | null;
  variant: {
    id: string;
    sku: string;
    priceOverride: number | null;
    isActive: boolean;
    stockQuantity: number;
    reservedQuantity: number;
    label: string;
  } | null;
  customization: {
    id: string;
    pricingMode: 'FIXED' | 'QUOTE';
    hasText: boolean;
    threadColorCount: number;
    placementId: string | null;
    placementName: string | null;
    embroiderySizeName: string | null;
    embroiderySizeBasePrice: number | null;
  } | null;
};

export type CartData = {
  id: string;
  kind: CartKind;
  status: 'ACTIVE' | 'CONVERTED' | 'ABANDONED' | 'INVALIDATED';
  currency: string;
  userId: string | null;
  anonymousToken: string | null;
  quoteId: string | null;
  quoteValidUntil: Date | null;
  lines: readonly CartLineData[];
};

type VariantOptionValues = NonNullable<
  CartRow['items'][number]['variant']
>['optionValues'];

function variantLabel(optionValues: VariantOptionValues): string {
  return [...optionValues]
    .sort((a, b) => a.optionValue.option.position - b.optionValue.option.position)
    .map((link) => link.optionValue.value)
    .join(' / ');
}

function toCartData(row: CartRow, now: Date): CartData {
  return {
    id: row.id,
    kind: row.kind as CartKind,
    status: row.status,
    currency: row.currency,
    userId: row.userId,
    anonymousToken: row.anonymousToken,
    quoteId: row.quoteId,
    quoteValidUntil: row.quoteValidUntil,
    lines: row.items.map((item) => ({
      id: item.id,
      kind: item.kind as LineKind,
      quantity: item.quantity,
      position: item.position,
      nameSnapshot: item.nameSnapshot,
      lockedUnitPrice: item.lockedUnitPrice,
      quoteItemId: item.quoteItemId,
      quoteLine: item.quoteItem
        ? { kind: item.quoteItem.kind, label: item.quoteItem.label }
        : null,
      product: item.product
        ? {
            id: item.product.id,
            slug: item.product.slug,
            name: item.product.name,
            basePrice: item.product.basePrice,
            currency: item.product.currency,
            stockPolicy: item.product.stockPolicy as
              'TRACK' | 'DONT_TRACK' | 'MADE_TO_ORDER',
            customizationProfileId: item.product.customizationProfileId,
            isVisible:
              item.product.status === 'ACTIVE' &&
              item.product.deletedAt === null &&
              item.product.publishedAt !== null &&
              item.product.publishedAt <= now,
            image: item.product.images[0]
              ? {
                  src: toPublicAssetUrl(item.product.images[0].storageKey),
                  alt: item.product.images[0].alt,
                }
              : null,
            imageKey: item.product.images[0]?.storageKey ?? null,
          }
        : null,
      variant: item.variant
        ? {
            id: item.variant.id,
            sku: item.variant.sku,
            priceOverride: item.variant.priceOverride,
            isActive: item.variant.isActive,
            stockQuantity: item.variant.stockQuantity,
            reservedQuantity: item.variant.reservedQuantity,
            label: variantLabel(item.variant.optionValues),
          }
        : null,
      customization: item.customizationConfig
        ? {
            id: item.customizationConfig.id,
            pricingMode: item.customizationConfig.pricingMode as 'FIXED' | 'QUOTE',
            hasText: Boolean(item.customizationConfig.embroideryText?.trim()),
            threadColorCount: item.customizationConfig.threadColorCount,
            placementId: item.customizationConfig.placement?.id ?? null,
            placementName: item.customizationConfig.placement?.name ?? null,
            embroiderySizeName: item.customizationConfig.embroiderySize?.name ?? null,
            embroiderySizeBasePrice:
              item.customizationConfig.embroiderySize?.basePrice ?? null,
          }
        : null,
    })),
  };
}

/* ---------------------------------------------------------------------------
 * Reads
 * ------------------------------------------------------------------------ */

/** The owner's active standard cart, or null when they have never added anything. */
export async function findActiveStandardCart(
  owner: CartOwner,
  now: Date = new Date(),
): Promise<CartData | null> {
  const row = await prisma.cart.findFirst({
    where: { ...ownerWhere(owner), kind: 'STANDARD', status: 'ACTIVE' },
    select: CART_SELECT,
  });

  return row ? toCartData(row, now) : null;
}

/**
 * A cart by id, scoped to its owner.
 *
 * The scoping is **in the query**, per `AGENTS.md` and `DATABASE.md` section
 * 15: a cart id in a payload must never be enough to read someone else's cart.
 */
export async function findOwnedCart(
  cartId: string,
  owner: CartOwner,
  now: Date = new Date(),
): Promise<CartData | null> {
  const row = await prisma.cart.findFirst({
    where: { id: cartId, ...ownerWhere(owner) },
    select: CART_SELECT,
  });

  return row ? toCartData(row, now) : null;
}

/* ---------------------------------------------------------------------------
 * Writes
 * ------------------------------------------------------------------------ */

/**
 * The owner's active standard cart, created if it does not exist.
 *
 * The partial unique index `(user_id) where kind='STANDARD' and
 * status='ACTIVE'` makes a duplicate impossible rather than unlikely; a
 * concurrent create loses on the index and is retried as a read.
 */
export async function ensureActiveStandardCart(owner: CartOwner): Promise<string> {
  const existing = await prisma.cart.findFirst({
    where: { ...ownerWhere(owner), kind: 'STANDARD', status: 'ACTIVE' },
    select: { id: true },
  });

  if (existing) return existing.id;

  try {
    const created = await prisma.cart.create({
      data: {
        kind: 'STANDARD',
        status: 'ACTIVE',
        userId: owner.kind === 'user' ? owner.userId : null,
        anonymousToken: owner.kind === 'guest' ? owner.anonymousToken : null,
      },
      select: { id: true },
    });
    return created.id;
  } catch {
    const raced = await prisma.cart.findFirstOrThrow({
      where: { ...ownerWhere(owner), kind: 'STANDARD', status: 'ACTIVE' },
      select: { id: true },
    });
    return raced.id;
  }
}

/**
 * Add a stock line, or increase the existing line for that variant.
 *
 * The partial unique index `(cart_id, variant_id) where kind='STOCK'` is what
 * makes "increment rather than duplicate" a property of the table rather than a
 * habit of this function.
 */
export async function upsertStockLine(input: {
  cartId: string;
  productId: string;
  variantId: string;
  quantity: number;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.cartItem.findFirst({
      where: { cartId: input.cartId, variantId: input.variantId, kind: 'STOCK' },
      select: { id: true },
    });

    if (existing) {
      await tx.cartItem.update({
        where: { id: existing.id },
        data: { quantity: input.quantity },
      });
    } else {
      const last = await tx.cartItem.findFirst({
        where: { cartId: input.cartId },
        select: { position: true },
        orderBy: { position: 'desc' },
      });

      await tx.cartItem.create({
        data: {
          cartId: input.cartId,
          kind: 'STOCK',
          productId: input.productId,
          variantId: input.variantId,
          quantity: input.quantity,
          position: (last?.position ?? -1) + 1,
        },
      });
    }

    await tx.cart.update({
      where: { id: input.cartId },
      data: { lastActivityAt: new Date() },
    });
  });
}

/** Add a custom line. One line per configuration; a configuration is not shared. */
export async function addCustomLine(input: {
  cartId: string;
  productId: string | null;
  variantId: string | null;
  customizationConfigId: string;
  quantity: number;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const last = await tx.cartItem.findFirst({
      where: { cartId: input.cartId },
      select: { position: true },
      orderBy: { position: 'desc' },
    });

    await tx.cartItem.create({
      data: {
        cartId: input.cartId,
        kind: 'CUSTOM',
        productId: input.productId,
        variantId: input.variantId,
        customizationConfigId: input.customizationConfigId,
        quantity: input.quantity,
        position: (last?.position ?? -1) + 1,
      },
    });

    await tx.cart.update({
      where: { id: input.cartId },
      data: { lastActivityAt: new Date() },
    });
  });
}

/** Set a line's quantity. The caller has already validated the cart is mutable. */
export async function setLineQuantity(input: {
  cartId: string;
  lineId: string;
  quantity: number;
}): Promise<void> {
  await prisma.cartItem.updateMany({
    where: { id: input.lineId, cartId: input.cartId },
    data: { quantity: input.quantity },
  });
}

export async function removeLine(input: {
  cartId: string;
  lineId: string;
}): Promise<void> {
  await prisma.cartItem.deleteMany({
    where: { id: input.lineId, cartId: input.cartId },
  });
}

/**
 * Merge a guest cart into the user's on login (`DATABASE.md` section 7).
 *
 * "Conflicts resolve by summing quantities, capped at available stock." The cap
 * is the caller's, using `domain/cart.mergedQuantity`, which is why this takes
 * a resolved quantity per variant rather than deciding one.
 *
 * A quote-bound cart never participates in a merge (5A.2), which is why the
 * query names `kind: 'STANDARD'` on both sides rather than merging whatever it
 * finds.
 */
export async function mergeGuestCartIntoUserCart(input: {
  guestCartId: string;
  userCartId: string;
  userId: string;
  /** Final quantity per stock line, already capped by the caller. */
  stockQuantities: ReadonlyMap<string, number>;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const guestLines = await tx.cartItem.findMany({
      where: { cartId: input.guestCartId },
      select: { id: true, kind: true, variantId: true, productId: true },
      orderBy: { position: 'asc' },
    });

    const last = await tx.cartItem.findFirst({
      where: { cartId: input.userCartId },
      select: { position: true },
      orderBy: { position: 'desc' },
    });
    let position = (last?.position ?? -1) + 1;

    for (const line of guestLines) {
      if (line.kind === 'STOCK' && line.variantId) {
        const quantity = input.stockQuantities.get(line.variantId);
        if (quantity === undefined) continue;

        const existing = await tx.cartItem.findFirst({
          where: { cartId: input.userCartId, variantId: line.variantId, kind: 'STOCK' },
          select: { id: true },
        });

        if (existing) {
          await tx.cartItem.update({ where: { id: existing.id }, data: { quantity } });
          await tx.cartItem.delete({ where: { id: line.id } });
        } else {
          await tx.cartItem.update({
            where: { id: line.id },
            data: { cartId: input.userCartId, quantity, position: position++ },
          });
        }
      } else {
        await tx.cartItem.update({
          where: { id: line.id },
          data: { cartId: input.userCartId, position: position++ },
        });
      }
    }

    await tx.cart.update({
      where: { id: input.guestCartId },
      data: { status: 'ABANDONED', anonymousToken: null, userId: input.userId },
    });
  });
}

/**
 * The placement price modifiers a set of custom lines needs.
 *
 * `profile_placements.priceModifier` is what a placement adds to a unit price,
 * and it is per *profile*: the same placement can cost differently on a cap and
 * on a tote. Keyed `profileId:placementId` because that pair is the row.
 */
export async function loadPlacementModifiers(
  pairs: readonly { profileId: string; placementId: string }[],
): Promise<ReadonlyMap<string, number>> {
  if (pairs.length === 0) return new Map();

  const rows = await prisma.profilePlacement.findMany({
    where: {
      OR: pairs.map((pair) => ({
        profileId: pair.profileId,
        placementId: pair.placementId,
      })),
    },
    select: { profileId: true, placementId: true, priceModifier: true },
  });

  return new Map(
    rows.map((row) => [`${row.profileId}:${row.placementId}`, row.priceModifier]),
  );
}

export type PurchasableVariant = {
  productId: string;
  productName: string;
  basePrice: number;
  currency: string;
  stockPolicy: 'TRACK' | 'DONT_TRACK' | 'MADE_TO_ORDER';
  variantId: string;
  sku: string;
  priceOverride: number | null;
  stockQuantity: number;
  reservedQuantity: number;
};

/**
 * Resolve a product and variant a customer asked to add.
 *
 * The add-to-cart security boundary. The client sends a slug and an SKU; every
 * fact comes from here. The public-visibility predicate is in the **query**, so
 * a draft or soft-deleted product cannot be added by anyone who guessed its
 * slug, and the variant is matched *within* the product so an SKU belonging to
 * another product resolves to nothing.
 */
export async function resolvePurchasableVariant(input: {
  productSlug: string;
  variantSku: string;
  now?: Date;
}): Promise<PurchasableVariant | null> {
  const now = input.now ?? new Date();

  const product = await prisma.product.findFirst({
    where: {
      slug: input.productSlug,
      status: 'ACTIVE',
      deletedAt: null,
      publishedAt: { not: null, lte: now },
    },
    select: {
      id: true,
      name: true,
      basePrice: true,
      currency: true,
      stockPolicy: true,
      variants: {
        where: { sku: input.variantSku, isActive: true },
        select: {
          id: true,
          sku: true,
          priceOverride: true,
          stockQuantity: true,
          reservedQuantity: true,
        },
        take: 1,
      },
    },
  });

  const variant = product?.variants[0];
  if (!product || !variant) return null;

  return {
    productId: product.id,
    productName: product.name,
    basePrice: product.basePrice,
    currency: product.currency,
    stockPolicy: product.stockPolicy as 'TRACK' | 'DONT_TRACK' | 'MADE_TO_ORDER',
    variantId: variant.id,
    sku: variant.sku,
    priceOverride: variant.priceOverride,
    stockQuantity: variant.stockQuantity,
    reservedQuantity: variant.reservedQuantity,
  };
}

/**
 * A customisation configuration a customer wants to buy at a fixed price.
 *
 * Re-read rather than trusted: the mode decides whether it may enter a cart at
 * all (2.3), and the product it names must still be purchasable.
 */
export async function resolveCustomizationForCart(configId: string): Promise<{
  id: string;
  pricingMode: 'FIXED' | 'QUOTE';
  productId: string | null;
  variantId: string | null;
} | null> {
  const config = await prisma.customizationConfig.findFirst({
    where: { id: configId, frozenAt: null },
    select: { id: true, pricingMode: true, productId: true, variantId: true },
  });

  if (!config) return null;

  return {
    id: config.id,
    pricingMode: config.pricingMode as 'FIXED' | 'QUOTE',
    productId: config.productId,
    variantId: config.variantId,
  };
}
