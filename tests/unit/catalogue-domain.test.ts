/**
 * Pricing and availability, the two catalogue rules that `BUSINESS-RULES.md`
 * section 16 requires to exist exactly once in `domain/`.
 *
 * Pure functions over literals: no database, no Prisma, no framework. That is
 * the whole argument for putting them in `domain/` — the storefront, the cart
 * and order placement all consult the same code, and it can be checked in
 * milliseconds.
 */

import { describe, expect, it } from 'vitest';

import {
  availableQuantity,
  isProductPurchasable,
  isVariantPurchasable,
} from '@/domain/order/availability';
import { resolveCompareAtPrice, resolveUnitPrice } from '@/domain/pricing';

const PRODUCT = { basePrice: 4800, compareAtPrice: 6000 };

describe('resolveUnitPrice', () => {
  it('uses the product base price when a variant has no override', () => {
    expect(
      resolveUnitPrice(PRODUCT, { priceOverride: null, compareAtPriceOverride: null }),
    ).toBe(4800);
  });

  it('uses the variant override when there is one', () => {
    expect(
      resolveUnitPrice(PRODUCT, { priceOverride: 5200, compareAtPriceOverride: null }),
    ).toBe(5200);
  });

  it('treats a zero override as a price, not as absent', () => {
    // `??` rather than `||`: a legitimate override of 0 must survive.
    expect(
      resolveUnitPrice(PRODUCT, { priceOverride: 0, compareAtPriceOverride: null }),
    ).toBe(0);
  });

  it('falls back to the product when no variant is supplied at all', () => {
    expect(resolveUnitPrice(PRODUCT)).toBe(4800);
    expect(resolveUnitPrice(PRODUCT, null)).toBe(4800);
  });
});

describe('resolveCompareAtPrice', () => {
  it('returns the compare-at price when it is strictly higher', () => {
    expect(resolveCompareAtPrice(PRODUCT)).toBe(6000);
  });

  it('drops a compare-at price that is not higher than the effective price', () => {
    // Section 2.1: display-only, and only when strictly greater. A "was" at or
    // below the "now" is a data error, not a saving.
    expect(resolveCompareAtPrice({ basePrice: 6000, compareAtPrice: 6000 })).toBeNull();
    expect(resolveCompareAtPrice({ basePrice: 6000, compareAtPrice: 4800 })).toBeNull();
  });

  it('compares against the variant price, not the base price', () => {
    // A variant priced above the product's compare-at must not show a saving.
    expect(
      resolveCompareAtPrice(PRODUCT, {
        priceOverride: 6500,
        compareAtPriceOverride: null,
      }),
    ).toBeNull();
  });

  it('prefers the variant compare-at override', () => {
    expect(
      resolveCompareAtPrice(PRODUCT, {
        priceOverride: 5000,
        compareAtPriceOverride: 7000,
      }),
    ).toBe(7000);
  });

  it('returns null when nothing is set', () => {
    expect(resolveCompareAtPrice({ basePrice: 4800, compareAtPrice: null })).toBeNull();
  });
});

describe('availableQuantity', () => {
  it('subtracts reserved units from stock', () => {
    expect(
      availableQuantity({ isActive: true, stockQuantity: 10, reservedQuantity: 3 }),
    ).toBe(7);
  });

  it('never reports a negative quantity', () => {
    // Over-reservation is a data problem, not an invitation to sell backwards.
    expect(
      availableQuantity({ isActive: true, stockQuantity: 2, reservedQuantity: 5 }),
    ).toBe(0);
  });
});

describe('isVariantPurchasable', () => {
  const stocked = { isActive: true, stockQuantity: 5, reservedQuantity: 0 };
  const empty = { isActive: true, stockQuantity: 0, reservedQuantity: 0 };

  it('enforces stock under TRACK', () => {
    expect(isVariantPurchasable(stocked, 'TRACK')).toBe(true);
    expect(isVariantPurchasable(empty, 'TRACK')).toBe(false);
  });

  it('treats fully reserved stock as unavailable', () => {
    expect(
      isVariantPurchasable(
        { isActive: true, stockQuantity: 4, reservedQuantity: 4 },
        'TRACK',
      ),
    ).toBe(false);
  });

  it('ignores stock under DONT_TRACK and MADE_TO_ORDER', () => {
    expect(isVariantPurchasable(empty, 'DONT_TRACK')).toBe(true);
    expect(isVariantPurchasable(empty, 'MADE_TO_ORDER')).toBe(true);
  });

  it('refuses an inactive variant under every policy', () => {
    // Section 2.1: an inactive variant cannot be purchased even when its
    // product is active.
    const inactive = { isActive: false, stockQuantity: 99, reservedQuantity: 0 };

    expect(isVariantPurchasable(inactive, 'TRACK')).toBe(false);
    expect(isVariantPurchasable(inactive, 'DONT_TRACK')).toBe(false);
    expect(isVariantPurchasable(inactive, 'MADE_TO_ORDER')).toBe(false);
  });
});

describe('isProductPurchasable', () => {
  const stocked = { isActive: true, stockQuantity: 5, reservedQuantity: 0 };
  const empty = { isActive: true, stockQuantity: 0, reservedQuantity: 0 };

  it('needs only one available variant', () => {
    expect(isProductPurchasable([empty, stocked], 'TRACK')).toBe(true);
  });

  it('is unavailable when every variant is out of stock', () => {
    // Section 11.3: such a product is still *visible* — it renders as
    // unavailable and keeps its URL rather than 404-ing.
    expect(isProductPurchasable([empty, empty], 'TRACK')).toBe(false);
  });

  it('is unavailable when every variant is inactive', () => {
    expect(
      isProductPurchasable(
        [{ isActive: false, stockQuantity: 9, reservedQuantity: 0 }],
        'TRACK',
      ),
    ).toBe(false);
  });

  it('treats a variantless made-to-order product as orderable', () => {
    expect(isProductPurchasable([], 'MADE_TO_ORDER')).toBe(true);
    expect(isProductPurchasable([], 'DONT_TRACK')).toBe(true);
  });

  it('treats a variantless tracked product as unavailable', () => {
    // Nothing to count means nothing to sell.
    expect(isProductPurchasable([], 'TRACK')).toBe(false);
  });
});
