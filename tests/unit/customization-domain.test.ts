/**
 * The custom-order rules, at their exact boundaries.
 *
 * `BUSINESS-RULES.md` sections 2.2 to 2.5 and 11, which section 16 requires to
 * live in `domain/` exactly once. Every threshold is tested *at* its value and
 * one either side, because "at or below" versus "below" is the difference
 * between a customer getting a price and being told to wait for a quote.
 */

import { describe, expect, it } from 'vitest';

import { applyBasisPoints, roundHalfUp } from '@/domain/money';
import {
  quantityDiscount,
  selectDiscountTier,
  type DiscountTier,
} from '@/domain/discount';
import {
  determinePricingMode,
  type PricingModeInput,
  type PricingModeThresholds,
} from '@/domain/customization/pricing-mode';
import {
  DEFAULT_CONFIGURATION_LIMITS,
  validateConfiguration,
  type ConfigurationInput,
} from '@/domain/customization/validation';
import {
  customizationUnitPrice,
  estimateFor,
  priceCustomLine,
  setupFeeFor,
  threadColorSurcharge,
  type CustomizationRates,
} from '@/domain/pricing/customization';

/** The V1 seed tiers (BUSINESS-RULES.md 2.5). */
const TIERS: readonly DiscountTier[] = [
  { minQuantity: 1, maxQuantity: 9, discountBasisPoints: 0 },
  { minQuantity: 10, maxQuantity: 24, discountBasisPoints: 500 },
  { minQuantity: 25, maxQuantity: 49, discountBasisPoints: 1000 },
  { minQuantity: 50, maxQuantity: null, discountBasisPoints: 1500 },
];

const THRESHOLDS: PricingModeThresholds = {
  quoteThresholdThreadColors: 3,
  quoteThresholdQuantity: 10,
  quoteThresholdInstructionLength: 200,
};

const RATES: CustomizationRates = {
  threadColorSurchargePerColor: 150,
  textSurcharge: 250,
  setupFee: 1200,
  setupFeeWaiverQuantity: 25,
  estimateBandBasisPoints: 1500,
};

/** A configuration that qualifies for a fixed price on every condition. */
const FIXED: PricingModeInput = {
  productId: 'p1',
  variantId: 'v1',
  freeformProductType: null,
  placedOnSurface: true,
  customPlacementNote: null,
  embroiderySizeId: 's1',
  threadColorCount: 1,
  quantity: 1,
  instructions: null,
  allDesignFilesReady: true,
};

describe('applyBasisPoints', () => {
  it('converts the documented percentages', () => {
    expect(applyBasisPoints(10_000, 0)).toBe(0);
    expect(applyBasisPoints(10_000, 500)).toBe(500);
    expect(applyBasisPoints(10_000, 1000)).toBe(1000);
    expect(applyBasisPoints(10_000, 1500)).toBe(1500);
    expect(applyBasisPoints(10_000, 5000)).toBe(5000);
    expect(applyBasisPoints(10_000, 10_000)).toBe(10_000);
  });

  it('rounds once, half away from zero', () => {
    // 1 DA at 5% = 0.05 → 0. Rounding twice would be how a discount and its
    // reversal end up a minor unit apart.
    expect(applyBasisPoints(1, 500)).toBe(0);
    expect(applyBasisPoints(10, 500)).toBe(1);
    expect(roundHalfUp(0.5)).toBe(1);
    expect(roundHalfUp(-0.5)).toBe(-1);
  });

  it('returns an integer for any input', () => {
    for (const amount of [1, 7, 99, 4801, 123_457]) {
      expect(Number.isInteger(applyBasisPoints(amount, 1500))).toBe(true);
    }
  });
});

describe('selectDiscountTier', () => {
  it('picks the right tier at every documented boundary', () => {
    const at = (quantity: number) => {
      const result = selectDiscountTier(TIERS, quantity);
      if (!result.ok) throw new Error(`no tier for ${quantity}`);
      return result.tier.discountBasisPoints;
    };

    expect(at(1)).toBe(0);
    expect(at(9)).toBe(0);
    expect(at(10)).toBe(500);
    expect(at(24)).toBe(500);
    expect(at(25)).toBe(1000);
    expect(at(49)).toBe(1000);
    expect(at(50)).toBe(1500);
    expect(at(5000)).toBe(1500);
  });

  it('returns a typed error rather than a silent zero', () => {
    // Section 2.5.2: a quantity with no matching tier is a data defect. A
    // silent zero is indistinguishable from a correct result.
    const result = selectDiscountTier(TIERS, 0);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no-matching-tier');
  });

  it('applies the discount to the embroidery component only', () => {
    expect(quantityDiscount(10_000, TIERS[2]!)).toBe(1000);
  });
});

describe('determinePricingMode', () => {
  it('is FIXED when every condition holds', () => {
    const decision = determinePricingMode(FIXED, THRESHOLDS);

    expect(decision.mode).toBe('FIXED');
    expect(decision.reasons).toEqual([]);
  });

  it('needs a quote for a free-text product (condition 1)', () => {
    expect(
      determinePricingMode({ ...FIXED, freeformProductType: 'Tablier' }, THRESHOLDS)
        .reasons,
    ).toContain('FREEFORM_PRODUCT');

    expect(
      determinePricingMode({ ...FIXED, variantId: null }, THRESHOLDS).reasons,
    ).toContain('FREEFORM_PRODUCT');
  });

  it('needs a quote for a custom placement (condition 2)', () => {
    expect(
      determinePricingMode(
        { ...FIXED, customPlacementNote: 'Sur la capuche' },
        THRESHOLDS,
      ).reasons,
    ).toContain('CUSTOM_PLACEMENT');
  });

  /*
   * The freeform rewrite of condition 2 (ADR-035). A design nobody could place
   * on a measured photograph — because the blank has none — is a description
   * rather than a measurement, and a description is a conversation.
   */
  it('needs a quote when the design was never placed on a surface', () => {
    expect(
      determinePricingMode({ ...FIXED, placedOnSurface: false }, THRESHOLDS).reasons,
    ).toContain('CUSTOM_PLACEMENT');
  });

  /*
   * And of condition 3. Every size is free now — that is the point of dragging
   * — so the question is whether the price table covers the one that was
   * dragged. `null` means no band did.
   */
  it('needs a quote for a size no band covers (condition 3)', () => {
    expect(
      determinePricingMode({ ...FIXED, embroiderySizeId: null }, THRESHOLDS).reasons,
    ).toContain('CUSTOM_DIMENSIONS');
  });

  it('holds the thread-colour threshold at exactly 3', () => {
    // "at or below" — 3 is fixed, 4 needs a quote.
    expect(determinePricingMode({ ...FIXED, threadColorCount: 3 }, THRESHOLDS).mode).toBe(
      'FIXED',
    );
    const four = determinePricingMode({ ...FIXED, threadColorCount: 4 }, THRESHOLDS);
    expect(four.mode).toBe('QUOTE');
    expect(four.reasons).toContain('THREAD_COLORS');
  });

  it('holds the quantity threshold at exactly 10', () => {
    expect(determinePricingMode({ ...FIXED, quantity: 10 }, THRESHOLDS).mode).toBe(
      'FIXED',
    );
    const eleven = determinePricingMode({ ...FIXED, quantity: 11 }, THRESHOLDS);
    expect(eleven.mode).toBe('QUOTE');
    expect(eleven.reasons).toContain('QUANTITY');
  });

  it('holds the instruction-length threshold at exactly 200', () => {
    // Condition 6 says "shorter than", so 199 is fixed and 200 already is not.
    expect(
      determinePricingMode({ ...FIXED, instructions: 'x'.repeat(199) }, THRESHOLDS).mode,
    ).toBe('FIXED');

    const atLimit = determinePricingMode(
      { ...FIXED, instructions: 'x'.repeat(200) },
      THRESHOLDS,
    );
    expect(atLimit.mode).toBe('QUOTE');
    expect(atLimit.reasons).toContain('INSTRUCTIONS');
  });

  it('needs a quote while artwork is unreviewed (condition 7)', () => {
    expect(
      determinePricingMode({ ...FIXED, allDesignFilesReady: false }, THRESHOLDS).reasons,
    ).toContain('ARTWORK_REVIEW');
  });

  it('reports every failing condition, not just the first', () => {
    const decision = determinePricingMode(
      { ...FIXED, threadColorCount: 6, quantity: 40, allDesignFilesReady: false },
      THRESHOLDS,
    );

    // The customer is told why, so a quote does not read as a stall.
    expect(decision.reasons).toEqual(['THREAD_COLORS', 'QUANTITY', 'ARTWORK_REVIEW']);
  });

  it('reads the thresholds it is given rather than hard-coding them', () => {
    // The owner may raise these from the admin; the rule must follow.
    const relaxed = { ...THRESHOLDS, quoteThresholdQuantity: 50 };
    expect(determinePricingMode({ ...FIXED, quantity: 40 }, relaxed).mode).toBe('FIXED');
  });
});

describe('validateConfiguration', () => {
  const VALID: ConfigurationInput = {
    productId: 'p1',
    variantId: 'v1',
    freeformProductType: null,
    customPlacementNote: null,
    hasSize: true,
    embroideryText: null,
    threadColorIds: ['t1'],
    instructions: null,
    quantity: 1,
    hasDesignFile: true,
  };

  it('accepts a complete configuration', () => {
    expect(validateConfiguration(VALID)).toEqual([]);
  });

  it('accepts text with no file — the "I only want text" path', () => {
    expect(
      validateConfiguration({ ...VALID, hasDesignFile: false, embroideryText: 'Amina' }),
    ).toEqual([]);
  });

  it('rejects a configuration with neither a file nor text', () => {
    expect(
      validateConfiguration({ ...VALID, hasDesignFile: false, embroideryText: '   ' }),
    ).toContain('NO_DESIGN');
  });

  it('holds the thread-colour ceiling at exactly 8', () => {
    // The *other* colour limit: 8 is the point above which a configuration
    // cannot be built at all, distinct from the quote threshold of 3.
    const eight = Array.from({ length: 8 }, (_, index) => `t${index}`);
    const nine = Array.from({ length: 9 }, (_, index) => `t${index}`);

    expect(validateConfiguration({ ...VALID, threadColorIds: eight })).toEqual([]);
    expect(validateConfiguration({ ...VALID, threadColorIds: nine })).toContain(
      'TOO_MANY_THREAD_COLORS',
    );
  });

  it('requires at least one thread colour', () => {
    expect(validateConfiguration({ ...VALID, threadColorIds: [] })).toContain(
      'NO_THREAD_COLOR',
    );
  });

  it('holds the quantity bounds', () => {
    expect(validateConfiguration({ ...VALID, quantity: 1 })).toEqual([]);
    expect(validateConfiguration({ ...VALID, quantity: 0 })).toContain(
      'QUANTITY_TOO_LOW',
    );
    expect(validateConfiguration({ ...VALID, quantity: 1.5 })).toContain(
      'QUANTITY_TOO_LOW',
    );
    expect(
      validateConfiguration({
        ...VALID,
        quantity: DEFAULT_CONFIGURATION_LIMITS.maxQuantity,
      }),
    ).toEqual([]);
    expect(
      validateConfiguration({
        ...VALID,
        quantity: DEFAULT_CONFIGURATION_LIMITS.maxQuantity + 1,
      }),
    ).toContain('QUANTITY_TOO_HIGH');
  });

  it('reports every problem at once', () => {
    // So a form can mark every bad field rather than revealing them one submit
    // at a time.
    const issues = validateConfiguration({
      ...VALID,
      productId: null,
      hasSize: false,
      threadColorIds: [],
      hasDesignFile: false,
      embroideryText: null,
    });

    expect(issues).toEqual([
      'NO_PRODUCT',
      'NO_EMBROIDERY_SIZE',
      'NO_DESIGN',
      'NO_THREAD_COLOR',
    ]);
  });

  /*
   * A size the price table cannot cover is not invalid — it is a quote
   * (ADR-035). The configuration still says how big it is in millimetres; what
   * it lacks is a *band*, and a band is a price, not a fact about the garment.
   */
  it('accepts a size no band covers', () => {
    const issues = validateConfiguration({
      ...VALID,
      hasSize: true,
      customPlacementNote: 'Grand motif dos complet',
    });

    expect(issues).toEqual([]);
  });

  it('refuses a configuration that says no size at all', () => {
    expect(validateConfiguration({ ...VALID, hasSize: false })).toEqual([
      'NO_EMBROIDERY_SIZE',
    ]);
  });
});

describe('customisation pricing', () => {
  it('charges only for colours beyond the first', () => {
    expect(threadColorSurcharge(1, 150)).toBe(0);
    expect(threadColorSurcharge(3, 150)).toBe(300);
    // A count below one is a data problem, never a credit.
    expect(threadColorSurcharge(0, 150)).toBe(0);
  });

  it('sums the section 2.2 formula', () => {
    // 1400 size + 200 placement + 2 extra colours × 150 + 250 text
    expect(
      customizationUnitPrice(
        {
          productUnitPrice: 4800,
          embroiderySizeBasePrice: 1400,
          placementModifier: 200,
          threadColorCount: 3,
          hasText: true,
          quantity: 1,
        },
        RATES,
      ),
    ).toBe(1400 + 200 + 300 + 250);
  });

  it('waives the setup fee at exactly the threshold quantity', () => {
    expect(setupFeeFor(24, RATES)).toBe(1200);
    expect(setupFeeFor(25, RATES)).toBe(0);
    expect(setupFeeFor(26, RATES)).toBe(0);
  });

  it('charges the setup fee once per configuration, not per unit', () => {
    const result = priceCustomLine(
      {
        productUnitPrice: 1000,
        embroiderySizeBasePrice: 500,
        placementModifier: 0,
        threadColorCount: 1,
        hasText: false,
        quantity: 5,
      },
      RATES,
      TIERS,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.breakdown.garmentComponent).toBe(5000);
    expect(result.breakdown.embroideryComponent).toBe(2500);
    expect(result.breakdown.setupFee).toBe(1200);
    expect(result.breakdown.discountAmount).toBe(0);
    expect(result.breakdown.total).toBe(5000 + 2500 + 1200);
  });

  it('discounts the embroidery component only, never the garment', () => {
    const result = priceCustomLine(
      {
        productUnitPrice: 1000,
        embroiderySizeBasePrice: 500,
        placementModifier: 0,
        threadColorCount: 1,
        hasText: false,
        quantity: 25,
      },
      RATES,
      TIERS,
    );

    if (!result.ok) throw new Error('expected a price');

    // 25 units: 10% off 12 500 of embroidery, and nothing off 25 000 of shirt.
    expect(result.breakdown.embroideryComponent).toBe(12_500);
    expect(result.breakdown.garmentComponent).toBe(25_000);
    expect(result.breakdown.discountBasisPoints).toBe(1000);
    expect(result.breakdown.discountAmount).toBe(1250);
    // Setup fee waived at 25.
    expect(result.breakdown.setupFee).toBe(0);
    expect(result.breakdown.total).toBe(25_000 + 12_500 - 1250);
  });

  it('refuses to price a quantity with no tier', () => {
    const result = priceCustomLine(
      {
        productUnitPrice: 1000,
        embroiderySizeBasePrice: 500,
        placementModifier: 0,
        threadColorCount: 1,
        hasText: false,
        quantity: 0,
      },
      RATES,
      TIERS,
    );

    expect(result.ok).toBe(false);
  });
});

describe('estimateFor', () => {
  it('is exact in fixed mode', () => {
    expect(estimateFor(10_000, 'FIXED', RATES)).toEqual({ min: 10_000, max: 10_000 });
  });

  it('is a 15% band in quote mode', () => {
    // Section 2.4.2, band from estimateBandPercent = 1500 basis points.
    expect(estimateFor(10_000, 'QUOTE', RATES)).toEqual({ min: 8500, max: 11_500 });
  });

  it('reads the band it is given', () => {
    expect(
      estimateFor(10_000, 'QUOTE', { ...RATES, estimateBandBasisPoints: 2000 }),
    ).toEqual({ min: 8000, max: 12_000 });
  });

  it('never quotes a negative floor', () => {
    const wide = { ...RATES, estimateBandBasisPoints: 15_000 };
    expect(estimateFor(1000, 'QUOTE', wide).min).toBe(0);
  });

  it('always produces a number — there is no "no estimate" state', () => {
    // Section 2.4.1: an estimate is shown at every step, including in quote
    // mode. That is why this returns a value rather than null.
    for (const mode of ['FIXED', 'QUOTE'] as const) {
      const estimate = estimateFor(0, mode, RATES);
      expect(Number.isInteger(estimate.min)).toBe(true);
      expect(Number.isInteger(estimate.max)).toBe(true);
    }
  });
});
