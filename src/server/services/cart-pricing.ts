import 'server-only';

import { availableQuantity, isVariantPurchasable } from '@/domain/order/availability';
import { orderTotals, type OrderTotals } from '@/domain/order/totals';
import {
  quantityDiscount,
  selectDiscountTier,
  type DiscountTier,
} from '@/domain/discount';
import { requiresProduction, usesLivePricing } from '@/domain/cart';
import { customizationUnitPrice, setupFeeFor } from '@/domain/pricing/customization';
import { resolveUnitPrice } from '@/domain/pricing';
import type { CartData, CartLineData } from '@/server/repositories/cart-repository';
import type { CommerceSettings } from '@/server/repositories/settings-repository';

/**
 * **The** cart pricing path.
 *
 * `BUSINESS-RULES.md` section 16 requires one totals pipeline "used identically
 * by cart, checkout, order placement and the admin", and 5.1 defines it. This
 * module is that single path: the cart page, the checkout summary and order
 * placement all call `priceCart`, so a cart that adds up to one number cannot
 * become an order that adds up to another.
 *
 * Nothing here reads the database and nothing here trusts an input from a
 * browser. It takes rows the repository re-read and settings the repository
 * loaded, and returns money.
 *
 * The three rules that shape the output:
 *
 *   2.2  The setup fee is charged **once per configuration, not per unit**, and
 *        appears as its own line. A cart line has a unit price and a quantity
 *        and cannot express that, so the fee becomes a separate `FEE` line —
 *        synthetic in the cart, a real `order_items` row at placement. Folding
 *        it into the unit price would multiply it by the quantity.
 *
 *   2.5  The quantity discount applies to the **embroidery component only,
 *        never the garment**, is tiered on the total custom units in the cart,
 *        and is shown as an explicit line. It lands in `discountTotal`, which
 *        `DATABASE.md` section 8 defines as a positive magnitude subtracted.
 *
 *   2.7  Price precedence: accepted quote price > variant override > product
 *        base price. A quote-bound line uses `lockedUnitPrice` and ignores the
 *        catalogue entirely, including sale prices.
 */

export type FeeKind = 'SETUP_FEE' | 'DIGITIZING' | 'RUSH_FEE' | 'OTHER';

/**
 * 2.6.5, the fee half of the quote-line mapping. `PRODUCT` and `EMBROIDERY`
 * become priced lines, `SHIPPING` and `DISCOUNT` become order totals rather
 * than items — none of them should reach a `FEE` cart line, and `OTHER` is the
 * honest answer if one somehow does.
 */
function feeKindFor(quoteLineKind: string | null | undefined): FeeKind {
  switch (quoteLineKind) {
    case 'SETUP_FEE':
    case 'DIGITIZING':
    case 'RUSH_FEE':
      return quoteLineKind;
    default:
      return 'OTHER';
  }
}

export type LineIssue =
  | 'PRODUCT_UNAVAILABLE'
  | 'VARIANT_INACTIVE'
  | 'INSUFFICIENT_STOCK'
  | 'CONFIGURATION_NEEDS_QUOTE'
  | 'PRICE_UNRESOLVABLE';

export type PricedLine = {
  id: string;
  kind: 'STOCK' | 'CUSTOM' | 'FEE';
  name: string;
  variantLabel: string | null;
  productSlug: string | null;
  image: { src: string | null; alt: string } | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  /** Null when the line's stock is not tracked. */
  maxQuantity: number | null;
  requiresProduction: boolean;
  /** Present when the line cannot be bought as it stands. */
  issue: LineIssue | null;
  /** Editable in the UI, and refused by the server, on a quote-bound cart. */
  editable: boolean;
  /**
   * Every `FEE` line names its kind, because `order_items` requires one
   * (2.6.5). A standard cart's fee is synthesised here; a quote-bound cart's
   * comes from the quote line it was derived from.
   */
  fee: { feeKind: FeeKind; sourceLineId: string | null } | null;
  /** Carried through to `order_items` at placement. */
  snapshot: {
    productId: string | null;
    variantId: string | null;
    customizationConfigId: string | null;
    quoteItemId: string | null;
    skuSnapshot: string | null;
    imageKeySnapshot: string | null;
  };
};

export type PricedCart = {
  cartId: string;
  kind: 'STANDARD' | 'QUOTE_BOUND';
  currency: string;
  lines: readonly PricedLine[];
  totals: OrderTotals;
  /** For the "Quantity discount, 25 units, −10%" line (2.5). */
  discountBasisPoints: number;
  totalCustomUnits: number;
  hasCustomLine: boolean;
  hasProductionLine: boolean;
  /** Every line issue, so checkout can refuse and the cart can explain. */
  issues: readonly { lineId: string; issue: LineIssue }[];
  isPurchasable: boolean;
};

export type PricingContext = {
  settings: CommerceSettings;
  tiers: readonly DiscountTier[];
  /** `profileId:placementId` → modifier, from the cart repository. */
  placementModifiers: ReadonlyMap<string, number>;
  /** Resolved at checkout only; the cart has no address yet. */
  shippingTotal?: number;
};

/* ---------------------------------------------------------------------------
 * Per-line pricing
 * ------------------------------------------------------------------------ */

function stockAvailability(line: CartLineData): {
  issue: LineIssue | null;
  maxQuantity: number | null;
} {
  /**
   * 5A.8: stock is validated "for any line that names a tracked variant".
   * A custom line need not name one — a freeform piece has no catalogue
   * variant to be out of — so a missing variant is only a problem for a STOCK
   * line, where it means the row is broken.
   */
  if (line.kind === 'CUSTOM' && !line.variant) return { issue: null, maxQuantity: null };

  if (!line.product || !line.variant)
    return { issue: 'PRODUCT_UNAVAILABLE', maxQuantity: 0 };
  if (!line.product.isVisible) return { issue: 'PRODUCT_UNAVAILABLE', maxQuantity: 0 };
  if (!line.variant.isActive) return { issue: 'VARIANT_INACTIVE', maxQuantity: 0 };

  if (line.product.stockPolicy !== 'TRACK') return { issue: null, maxQuantity: null };

  const available = availableQuantity(line.variant);
  if (!isVariantPurchasable(line.variant, 'TRACK') || available < line.quantity) {
    return { issue: 'INSUFFICIENT_STOCK', maxQuantity: available };
  }

  return { issue: null, maxQuantity: available };
}

function priceStandardLine(
  line: CartLineData,
  context: PricingContext,
): { unitPrice: number; issue: LineIssue | null; embroideryComponent: number } {
  if (line.kind === 'STOCK') {
    if (!line.product)
      return { unitPrice: 0, issue: 'PRICE_UNRESOLVABLE', embroideryComponent: 0 };

    return {
      unitPrice: resolveUnitPrice(
        { basePrice: line.product.basePrice, compareAtPrice: null },
        line.variant
          ? { priceOverride: line.variant.priceOverride, compareAtPriceOverride: null }
          : null,
      ),
      issue: null,
      embroideryComponent: 0,
    };
  }

  // CUSTOM: the garment plus the embroidery, recomputed from the stored
  // configuration. Nothing about the price was kept on the cart line.
  const config = line.customization;
  if (!config || !line.product || config.embroiderySizeBasePrice === null) {
    return { unitPrice: 0, issue: 'PRICE_UNRESOLVABLE', embroideryComponent: 0 };
  }

  // 2.3: a configuration that needs a quote is not something a customer can buy
  // at a price the system chose. It goes through the quote flow, not the cart.
  if (config.pricingMode !== 'FIXED') {
    return { unitPrice: 0, issue: 'CONFIGURATION_NEEDS_QUOTE', embroideryComponent: 0 };
  }

  const profileId = line.product.customizationProfileId;
  const modifier =
    profileId && config.placementId
      ? context.placementModifiers.get(`${profileId}:${config.placementId}`)
      : undefined;

  if (modifier === undefined) {
    return { unitPrice: 0, issue: 'PRICE_UNRESOLVABLE', embroideryComponent: 0 };
  }

  const garment = resolveUnitPrice(
    { basePrice: line.product.basePrice, compareAtPrice: null },
    line.variant
      ? { priceOverride: line.variant.priceOverride, compareAtPriceOverride: null }
      : null,
  );

  const embroidery = customizationUnitPrice(
    {
      productUnitPrice: garment,
      embroiderySizeBasePrice: config.embroiderySizeBasePrice,
      placementModifier: modifier,
      threadColorCount: config.threadColorCount,
      hasText: config.hasText,
      quantity: line.quantity,
    },
    context.settings,
  );

  return {
    unitPrice: garment + embroidery,
    issue: null,
    embroideryComponent: embroidery * line.quantity,
  };
}

/* ---------------------------------------------------------------------------
 * The cart
 * ------------------------------------------------------------------------ */

export function priceCart(cart: CartData, context: PricingContext): PricedCart {
  const live = usesLivePricing(cart.kind);
  const lines: PricedLine[] = [];
  const issues: { lineId: string; issue: LineIssue }[] = [];

  let embroideryComponentTotal = 0;
  let totalCustomUnits = 0;

  for (const line of cart.lines) {
    const availability =
      line.kind === 'FEE' ? { issue: null, maxQuantity: null } : stockAvailability(line);

    // 2.7: a quote-locked line ignores the catalogue entirely.
    const priced = live
      ? priceStandardLine(line, context)
      : {
          unitPrice: line.lockedUnitPrice ?? 0,
          issue: line.lockedUnitPrice === null ? ('PRICE_UNRESOLVABLE' as const) : null,
          embroideryComponent: 0,
        };

    const issue = priced.issue ?? availability.issue;
    if (issue) issues.push({ lineId: line.id, issue });

    if (line.kind === 'CUSTOM') {
      totalCustomUnits += line.quantity;
      embroideryComponentTotal += priced.embroideryComponent;
    }

    lines.push({
      id: line.id,
      kind: line.kind,
      // 2.6.5: a fee line's quote label is copied verbatim, so the order
      // itemises exactly what the quote itemised.
      name: line.nameSnapshot ?? line.quoteLine?.label ?? line.product?.name ?? 'Article',
      variantLabel: line.variant?.label ?? null,
      productSlug: line.product?.slug ?? null,
      image: line.product?.image ?? null,
      unitPrice: priced.unitPrice,
      quantity: line.quantity,
      lineTotal: priced.unitPrice * line.quantity,
      maxQuantity: availability.maxQuantity,
      requiresProduction: requiresProduction({
        kind: line.kind,
        stockPolicy: line.product?.stockPolicy ?? null,
      }),
      issue,
      editable: live && line.kind !== 'FEE',
      fee:
        line.kind === 'FEE'
          ? { feeKind: feeKindFor(line.quoteLine?.kind), sourceLineId: null }
          : null,
      snapshot: {
        productId: line.product?.id ?? null,
        variantId: line.variant?.id ?? null,
        customizationConfigId: line.customization?.id ?? null,
        quoteItemId: line.quoteItemId,
        skuSnapshot: line.variant?.sku ?? null,
        imageKeySnapshot: line.product?.imageKey ?? null,
      },
    });

    // 2.2: one setup fee per configuration, waived at or above the threshold
    // quantity. A quote-bound cart already carries the admin's fee lines as
    // real rows, so synthesising one there would charge it twice.
    if (live && line.kind === 'CUSTOM' && !issue) {
      const setupFee = setupFeeFor(line.quantity, context.settings);
      if (setupFee > 0) {
        lines.push({
          id: `${line.id}:setup-fee`,
          kind: 'FEE',
          name: 'Frais de préparation',
          variantLabel: null,
          productSlug: null,
          image: null,
          unitPrice: setupFee,
          quantity: 1,
          lineTotal: setupFee,
          maxQuantity: null,
          requiresProduction: false,
          issue: null,
          editable: false,
          fee: { feeKind: 'SETUP_FEE', sourceLineId: line.id },
          snapshot: {
            productId: null,
            variantId: null,
            customizationConfigId: null,
            quoteItemId: null,
            skuSnapshot: null,
            imageKeySnapshot: null,
          },
        });
      }
    }
  }

  // 2.5: tiered on the total custom units in the cart, applied to the
  // embroidery component only. 5A.5: never re-applied to a quote-bound cart.
  let discountTotal = 0;
  let discountBasisPoints = 0;

  if (live && totalCustomUnits > 0 && embroideryComponentTotal > 0) {
    const tier = selectDiscountTier(context.tiers, totalCustomUnits);
    if (tier.ok) {
      discountBasisPoints = tier.tier.discountBasisPoints;
      discountTotal = quantityDiscount(embroideryComponentTotal, tier.tier);
    }
  }

  const totals = orderTotals({
    lines: lines.map((line) => ({
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      lineDiscount: 0,
    })),
    discountTotal,
    shippingTotal: context.shippingTotal ?? 0,
  });

  const resolved: OrderTotals = totals.ok
    ? totals.value
    : {
        subtotal: 0,
        discountTotal: 0,
        shippingTotal: 0,
        taxTotal: 0,
        grandTotal: 0,
      };

  return {
    cartId: cart.id,
    kind: cart.kind,
    currency: cart.currency,
    lines,
    totals: resolved,
    discountBasisPoints,
    totalCustomUnits,
    hasCustomLine: totalCustomUnits > 0,
    hasProductionLine: lines.some((line) => line.requiresProduction),
    issues,
    isPurchasable: totals.ok && lines.length > 0 && issues.length === 0,
  };
}
