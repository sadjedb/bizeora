/**
 * The rules behind the admin's two new screens.
 *
 * `catalogue-domain.test.ts` covers the *read* side — what a price resolves to,
 * whether a variant can be bought. This file covers the *write* side that Phase
 * 14.5 introduced: what a valid product draft is, what a slug looks like, when
 * a variant counts as low, and — the one that matters — which stock adjustments
 * must be refused.
 *
 * Pure functions over literals. No database, no Prisma, no framework. The same
 * two stock conditions are enforced again by a conditional `UPDATE` in the
 * repository, and these tests are about the *messages*: the refusal an operator
 * reads has to name the actual obstacle, not say "invalid".
 */

import { describe, expect, it } from 'vitest';

import {
  ADJUSTMENT_REASONS,
  DEFAULT_LOW_STOCK_THRESHOLD,
  DEFAULT_STOCK_POLICY,
  PRODUCT_STATUSES,
  availableStock,
  hasErrors,
  isStockAlert,
  isValidSlug,
  normaliseSku,
  resultingQuantity,
  slugify,
  stockState,
  validateProductDraft,
  validateStockAdjustment,
  validateVariantDraft,
  type ProductDraft,
  type VariantDraft,
} from '@/domain/catalogue';

/* ---------------------------------------------------------------------------
 * Slugs
 * ------------------------------------------------------------------------ */

describe('slugify', () => {
  it('folds accented Latin rather than dropping it', () => {
    // "charpe-brode" would be a worse URL than a transliterated one, and it is
    // what a naive `[^a-z0-9]` filter produces on a French catalogue.
    expect(slugify('Écharpe brodée')).toBe('echarpe-brodee');
    expect(slugify('Tôte-bag "Été" à l’unité')).toBe('tote-bag-ete-a-l-unite');
  });

  it('collapses runs of punctuation and trims the edges', () => {
    expect(slugify('  ---Polo   //  Piqué!!  ')).toBe('polo-pique');
  });

  it('produces a slug that validates, or nothing at all', () => {
    for (const input of ['Écharpe brodée', 'T-shirt 100% coton', 'A']) {
      expect(isValidSlug(slugify(input))).toBe(true);
    }

    // Nothing survivable in, nothing out — the caller then fails validation
    // rather than storing an empty URL.
    expect(slugify('!!!')).toBe('');
    expect(isValidSlug('')).toBe(false);
  });

  it('rejects the shapes a URL cannot carry', () => {
    for (const invalid of [
      'Tote-Bag',
      'tote bag',
      'tote--bag',
      '-tote',
      'tote-',
      'tôte',
    ]) {
      expect(isValidSlug(invalid), invalid).toBe(false);
    }
  });
});

describe('normaliseSku', () => {
  it('shouts, because a SKU is read off a label', () => {
    expect(normaliseSku('  tsh-cls  noir ')).toBe('TSH-CLS-NOIR');
  });
});

/* ---------------------------------------------------------------------------
 * Product drafts
 * ------------------------------------------------------------------------ */

const VALID: ProductDraft = {
  name: 'Tote bag toile épaisse',
  slug: 'tote-bag-toile-epaisse',
  subtitle: null,
  description: 'Une toile de coton épaisse, cousue et brodée dans notre atelier.',
  categoryId: 'a-category-id',
  status: 'DRAFT',
  basePrice: 2500,
  compareAtPrice: null,
  stockPolicy: 'MADE_TO_ORDER',
  material: null,
  careInstructions: null,
  embroideryDetails: null,
  isCustomizable: false,
  isFeatured: false,
  isNewArrival: false,
  isBestSeller: false,
  seoTitle: null,
  seoDescription: null,
};

describe('validateProductDraft', () => {
  it('accepts a complete draft', () => {
    expect(hasErrors(validateProductDraft(VALID))).toBe(false);
  });

  it('requires a name, a category and a description somebody can read', () => {
    const errors = validateProductDraft({
      ...VALID,
      name: '   ',
      categoryId: '',
      description: 'Trop court',
    });

    expect(errors.name).toBeDefined();
    expect(errors.categoryId).toBeDefined();
    expect(errors.description).toBeDefined();
  });

  it('refuses a price that is not a whole number', () => {
    expect(validateProductDraft({ ...VALID, basePrice: 25.5 }).basePrice).toBeDefined();
    expect(
      validateProductDraft({ ...VALID, basePrice: Number.NaN }).basePrice,
    ).toBeDefined();
    expect(validateProductDraft({ ...VALID, basePrice: -1 }).basePrice).toBeDefined();
  });

  it('allows a zero price on a draft and refuses it once live', () => {
    // A zero-price live product is almost always an unfinished draft, and the
    // failure is somebody buying it.
    expect(validateProductDraft({ ...VALID, basePrice: 0 }).basePrice).toBeUndefined();
    expect(
      validateProductDraft({ ...VALID, basePrice: 0, status: 'ACTIVE' }).basePrice,
    ).toBeDefined();
  });

  it('refuses a compare-at price that advertises a discount that is not one', () => {
    expect(
      validateProductDraft({ ...VALID, compareAtPrice: 2500 }).compareAtPrice,
    ).toBeDefined();
    expect(
      validateProductDraft({ ...VALID, compareAtPrice: 2000 }).compareAtPrice,
    ).toBeDefined();
    expect(
      validateProductDraft({ ...VALID, compareAtPrice: 3200 }).compareAtPrice,
    ).toBeUndefined();
  });

  it('refuses a slug that is not URL-shaped', () => {
    expect(validateProductDraft({ ...VALID, slug: 'Tote Bag' }).slug).toBeDefined();
  });

  it('defaults blanks to made-to-order, per 10.8', () => {
    expect(DEFAULT_STOCK_POLICY).toBe('MADE_TO_ORDER');
    expect(PRODUCT_STATUSES).toContain('DRAFT');
  });
});

/* ---------------------------------------------------------------------------
 * Variants
 * ------------------------------------------------------------------------ */

const VARIANT: VariantDraft = {
  sku: 'TOT-EPS-NAT',
  optionValues: [],
  priceOverride: null,
  stockQuantity: 0,
  lowStockThreshold: null,
  isActive: true,
};

describe('validateVariantDraft', () => {
  it('accepts a plain variant', () => {
    expect(hasErrors(validateVariantDraft(VARIANT))).toBe(false);
  });

  it('requires a SKU in the shape a label can carry', () => {
    expect(validateVariantDraft({ ...VARIANT, sku: '' }).sku).toBeDefined();
    expect(validateVariantDraft({ ...VARIANT, sku: 'tot eps!' }).sku).toBeDefined();
    // Lower case is normalised, not refused.
    expect(validateVariantDraft({ ...VARIANT, sku: 'tot-eps' }).sku).toBeUndefined();
  });

  it('never accepts a negative stock quantity or threshold', () => {
    expect(
      validateVariantDraft({ ...VARIANT, stockQuantity: -1 }).stockQuantity,
    ).toBeDefined();
    expect(
      validateVariantDraft({ ...VARIANT, lowStockThreshold: -1 }).lowStockThreshold,
    ).toBeDefined();
  });
});

/* ---------------------------------------------------------------------------
 * Stock state
 * ------------------------------------------------------------------------ */

const STOCKED = {
  isActive: true,
  stockQuantity: 10,
  reservedQuantity: 0,
  lowStockThreshold: null,
};

describe('stockState', () => {
  it('never calls an inactive variant in stock', () => {
    // 2.1: an inactive variant cannot be purchased even when its product is
    // active, so "in stock" would be true about the shelf and false about the
    // shop.
    expect(stockState({ ...STOCKED, isActive: false }, 'TRACK')).toBe('INACTIVE');
    expect(stockState({ ...STOCKED, isActive: false }, 'MADE_TO_ORDER')).toBe('INACTIVE');
  });

  it('reports the policy rather than a quantity when stock is not kept', () => {
    expect(stockState({ ...STOCKED, stockQuantity: 0 }, 'MADE_TO_ORDER')).toBe(
      'MADE_TO_ORDER',
    );
    expect(stockState({ ...STOCKED, stockQuantity: 0 }, 'DONT_TRACK')).toBe('UNTRACKED');
  });

  it('counts reserved units against availability', () => {
    // 10.4: available = stock - reserved. Ten on the shelf with ten promised is
    // a rupture, not ten in stock.
    expect(availableStock({ ...STOCKED, reservedQuantity: 10 })).toBe(0);
    expect(stockState({ ...STOCKED, reservedQuantity: 10 }, 'TRACK')).toBe(
      'OUT_OF_STOCK',
    );
  });

  it('warns at the variant threshold, and at a floor when it has none', () => {
    expect(stockState({ ...STOCKED, stockQuantity: 2 }, 'TRACK')).toBe('LOW_STOCK');
    expect(
      stockState({ ...STOCKED, stockQuantity: DEFAULT_LOW_STOCK_THRESHOLD }, 'TRACK'),
    ).toBe('LOW_STOCK');
    expect(stockState({ ...STOCKED, stockQuantity: 10 }, 'TRACK')).toBe('IN_STOCK');

    // 10.7: at or below the variant's own threshold.
    const generous = { ...STOCKED, stockQuantity: 8, lowStockThreshold: 8 };
    expect(stockState(generous, 'TRACK')).toBe('LOW_STOCK');
  });

  it('marks only the two states worth interrupting somebody for', () => {
    expect(isStockAlert('OUT_OF_STOCK')).toBe(true);
    expect(isStockAlert('LOW_STOCK')).toBe(true);
    expect(isStockAlert('IN_STOCK')).toBe(false);
    expect(isStockAlert('MADE_TO_ORDER')).toBe(false);
    expect(isStockAlert('INACTIVE')).toBe(false);
  });
});

/* ---------------------------------------------------------------------------
 * Adjustments
 * ------------------------------------------------------------------------ */

const ON_HAND = { stockQuantity: 10, reservedQuantity: 3 };

function adjust(delta: number, note: string | null = null) {
  return validateStockAdjustment({ delta, reason: 'COUNT', note }, ON_HAND);
}

describe('validateStockAdjustment', () => {
  it('accepts a movement in either direction that leaves the invariants intact', () => {
    expect(adjust(5)).toBeNull();
    expect(adjust(-7)).toBeNull();
  });

  it('refuses a movement that would take stock negative', () => {
    const refusal = adjust(-11);

    expect(refusal?.code).toBe('NEGATIVE_RESULT');
    // The operator is told the actual number, not "invalid".
    expect(refusal?.message).toContain('10');
  });

  it('refuses a movement that would drop stock below what orders reserved', () => {
    // 10.4 counts three units as promised to orders that exist. Removing eight
    // of ten would leave two, and unsell an order somebody may have paid a
    // deposit on — the database's `reserved_quantity <= stock_quantity` check
    // would refuse it anyway, as an unexplained 500.
    const refusal = adjust(-8);

    expect(refusal?.code).toBe('BELOW_RESERVED');
    expect(refusal?.message).toContain('3');
    // And it says what to do instead.
    expect(refusal?.message).toContain('commande');
  });

  it('refuses a movement of zero', () => {
    expect(adjust(0)?.code).toBe('ZERO');
  });

  it('refuses anything that is not a whole number', () => {
    expect(adjust(1.5)?.code).toBe('NOT_INTEGER');
    expect(adjust(Number.NaN)?.code).toBe('NOT_INTEGER');
  });

  it('refuses a note longer than the column', () => {
    expect(adjust(1, 'x'.repeat(281))?.code).toBe('NOTE_TOO_LONG');
    expect(adjust(1, 'x'.repeat(280))).toBeNull();
  });

  it('previews the resulting quantity the same way the write computes it', () => {
    expect(resultingQuantity(10, -4)).toBe(6);
    expect(resultingQuantity(0, 12)).toBe(12);
  });

  it('names a closed set of reasons', () => {
    // An adjustment with a free-text reason is an adjustment nobody can group,
    // and grouping is the only reason to keep a ledger.
    expect([...ADJUSTMENT_REASONS]).toEqual([
      'RECEIVED',
      'COUNT',
      'DAMAGED',
      'RETURNED',
      'CORRECTION',
    ]);
  });
});
