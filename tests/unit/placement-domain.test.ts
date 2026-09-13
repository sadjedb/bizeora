/**
 * Where the design sits, as pure functions.
 *
 * This is the arithmetic a customer is trusting when they drag their logo onto
 * a photograph of a hoodie and read "85 mm" underneath it. If any of it is
 * wrong, the shop stitches something nobody approved — so the conversions are
 * tested against figures worked out by hand rather than against the
 * implementation's own output.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TRANSFORM,
  DESIGN_SURFACES,
  MIN_DESIGN_WIDTH_MM,
  MIN_WIDTH_PERCENT,
  aspectRatio,
  clampTransform,
  designSize,
  fitsWithin,
  isDesignSurface,
  resolveSizeBand,
  transformForBand,
  validatePlacement,
  widthPercentForMm,
  type DesignTransform,
  type SizeBand,
} from '../../src/domain/customization/placement';

/** A 520 mm-wide garment photographed square-ish, as the seed data will be. */
const SURFACE = { widthPx: 1200, heightPx: 1500, widthMm: 520 };

/** A landscape logo: twice as wide as it is tall. */
const LOGO = { widthPx: 800, heightPx: 400 };

function transform(patch: Partial<DesignTransform> = {}): DesignTransform {
  return { ...DEFAULT_TRANSFORM, ...patch };
}

describe('surfaces', () => {
  it('names the faces a person would name', () => {
    expect([...DESIGN_SURFACES]).toEqual([
      'FRONT',
      'BACK',
      'LEFT',
      'RIGHT',
      'TOP',
      'WRAP',
    ]);
  });

  // The surface arrives from a form and selects a photograph. Anything not on
  // the list has to be refused rather than coerced.
  it.each(['front', 'BEHIND', '', 'wrap', '__proto__'])('refuses %o', (value) => {
    expect(isDesignSurface(value)).toBe(false);
  });
});

describe('millimetres from a percentage', () => {
  /*
   * The number the whole feature rests on. A box covering a sixth of a 520 mm
   * garment is 86.67 mm, which the workshop is told is 87 — not 86.6666667,
   * and not a percentage.
   */
  it('converts the dragged width against the surface calibration', () => {
    const size = designSize(transform({ widthPercent: 16.667 }), 520, LOGO);
    expect(size.widthMm).toBe(87);
  });

  it('takes the height from the artwork, not from the box', () => {
    // 100 mm wide on artwork that is half as tall as it is wide.
    const size = designSize(transform({ widthPercent: 20 }), 500, LOGO);
    expect(size.widthMm).toBe(100);
    expect(size.heightMm).toBe(50);
  });

  /*
   * A file whose pixel dimensions could not be read — an SVG, a PDF — has no
   * proportions to scale by. Saying so beats inventing a square: the workshop
   * gets a width and confirms the rest.
   */
  it('states no height when the artwork has no known proportions', () => {
    expect(designSize(transform({ widthPercent: 20 }), 500, null).heightMm).toBeNull();
    expect(aspectRatio({ widthPx: 0, heightPx: 400 })).toBeNull();
  });

  it('round-trips a width in millimetres back to a box', () => {
    const percent = widthPercentForMm(90, 520);
    expect(designSize(transform({ widthPercent: percent }), 520, LOGO).widthMm).toBe(90);
  });

  it('does not divide by an unmeasured surface', () => {
    expect(widthPercentForMm(90, 0)).toBe(DEFAULT_TRANSFORM.widthPercent);
  });
});

describe('clamping', () => {
  it('keeps the design on the garment horizontally', () => {
    const dragged = clampTransform(transform({ xPercent: 98, widthPercent: 20 }));
    expect(dragged.xPercent).toBe(90);

    const other = clampTransform(transform({ xPercent: -40, widthPercent: 20 }));
    expect(other.xPercent).toBe(10);
  });

  it('refuses a design too small to stitch', () => {
    expect(clampTransform(transform({ widthPercent: 0.1 })).widthPercent).toBe(
      MIN_WIDTH_PERCENT,
    );
  });

  it('caps the width at the garment', () => {
    expect(clampTransform(transform({ widthPercent: 400 })).widthPercent).toBe(100);
  });

  it('caps rotation at half a turn each way', () => {
    expect(clampTransform(transform({ rotationDeg: 900 })).rotationDeg).toBe(180);
    expect(clampTransform(transform({ rotationDeg: -900 })).rotationDeg).toBe(-180);
  });

  /*
   * A design as wide as the garment has nowhere to go: the clamp's low bound
   * (50) is above its high bound (50), and a naive implementation would return
   * whichever it applied last. It centres instead.
   */
  it('centres a design that fills the width', () => {
    expect(clampTransform(transform({ widthPercent: 100, xPercent: 0 })).xPercent).toBe(
      50,
    );
  });

  it('survives values that are not numbers', () => {
    const rubbish = clampTransform({
      xPercent: Number.NaN,
      yPercent: Number.POSITIVE_INFINITY,
      widthPercent: Number.NaN,
      rotationDeg: Number.NaN,
    });

    expect(Number.isFinite(rubbish.xPercent)).toBe(true);
    expect(Number.isFinite(rubbish.yPercent)).toBe(true);
    expect(rubbish.widthPercent).toBe(DEFAULT_TRANSFORM.widthPercent);
    expect(rubbish.rotationDeg).toBe(0);
  });
});

describe('staying on the garment', () => {
  it('accepts a design in the middle', () => {
    expect(fitsWithin({ transform: transform(), surface: SURFACE, artwork: LOGO })).toBe(
      true,
    );
  });

  it('refuses one hanging off the side', () => {
    expect(
      fitsWithin({
        transform: transform({ xPercent: 96, widthPercent: 20 }),
        surface: SURFACE,
        artwork: LOGO,
      }),
    ).toBe(false);
  });

  /*
   * The case a naive bounds check misses. A design that fits flat does not
   * necessarily fit turned: rotating a rectangle grows the box it occupies, by
   * √2 at 45° for a square. This one is inside at 0° and off the garment at 45°.
   */
  it('accounts for rotation growing the box', () => {
    const square = { widthPx: 400, heightPx: 400 };
    const near = transform({ xPercent: 82, yPercent: 50, widthPercent: 34 });

    expect(fitsWithin({ transform: near, surface: SURFACE, artwork: square })).toBe(true);
    expect(
      fitsWithin({
        transform: { ...near, rotationDeg: 45 },
        surface: SURFACE,
        artwork: square,
      }),
    ).toBe(false);
  });

  it('refuses a surface with no dimensions', () => {
    expect(
      fitsWithin({
        transform: transform(),
        surface: { widthPx: 0, heightPx: 0 },
        artwork: LOGO,
      }),
    ).toBe(false);
  });

  /*
   * A tall design on a tall garment. The height has to be converted through
   * both aspect ratios — the artwork's and the surface's — or a portrait logo
   * on a portrait photograph reads as fitting when it runs off the hem.
   */
  it('converts height through both aspect ratios', () => {
    const tall = { widthPx: 200, heightPx: 1000 };

    // 20% wide on a 1200×1500 surface is 240px; at 1:5 that is 1200px tall,
    // which is 80% of the 1500px surface. Centred, it fits — just.
    expect(
      fitsWithin({
        transform: transform({ xPercent: 50, yPercent: 50, widthPercent: 20 }),
        surface: SURFACE,
        artwork: tall,
      }),
    ).toBe(true);

    // Nudged up, the same design runs off the top.
    expect(
      fitsWithin({
        transform: transform({ xPercent: 50, yPercent: 25, widthPercent: 20 }),
        surface: SURFACE,
        artwork: tall,
      }),
    ).toBe(false);
  });
});

describe('the price band a dragged size falls in', () => {
  const BANDS: readonly SizeBand[] = [
    { id: 'p', name: 'Petit', basePrice: 60_000, maxWidthMm: 60, maxHeightMm: 60 },
    { id: 'm', name: 'Moyen', basePrice: 90_000, maxWidthMm: 120, maxHeightMm: 120 },
    { id: 'g', name: 'Grand', basePrice: 140_000, maxWidthMm: 250, maxHeightMm: 250 },
  ];

  it('charges the cheapest band that covers it', () => {
    expect(resolveSizeBand({ widthMm: 50, heightMm: 25 }, BANDS)?.id).toBe('p');
    expect(resolveSizeBand({ widthMm: 100, heightMm: 50 }, BANDS)?.id).toBe('m');
    expect(resolveSizeBand({ widthMm: 200, heightMm: 100 }, BANDS)?.id).toBe('g');
  });

  it('is decided by whichever axis is bigger', () => {
    // Narrow but tall: too tall for Petit, so it is a Moyen.
    expect(resolveSizeBand({ widthMm: 40, heightMm: 110 }, BANDS)?.id).toBe('m');
  });

  /*
   * Not a failure. A design larger than every band is a real order that a price
   * table cannot price, which is exactly the condition that sends it to a
   * human — the same answer 2.3 already gives for custom dimensions.
   */
  it('finds no band for a design beyond the largest', () => {
    expect(resolveSizeBand({ widthMm: 400, heightMm: 200 }, BANDS)).toBeNull();
  });

  it('ignores an unknown height rather than refusing the band', () => {
    expect(resolveSizeBand({ widthMm: 50, heightMm: null }, BANDS)?.id).toBe('p');
  });

  it('treats a null maximum as unbounded', () => {
    const openEnded: SizeBand[] = [
      {
        id: 'any',
        name: 'Sur mesure',
        basePrice: 1,
        maxWidthMm: null,
        maxHeightMm: null,
      },
    ];
    expect(resolveSizeBand({ widthMm: 9_000, heightMm: 9_000 }, openEnded)?.id).toBe(
      'any',
    );
  });

  it('sets the box from a band without moving the design', () => {
    const current = transform({ xPercent: 30, yPercent: 20, rotationDeg: 10 });
    const sized = transformForBand(BANDS[1]!, current, 520);

    expect(designSize(sized, 520, LOGO).widthMm).toBe(120);
    expect(sized.xPercent).toBe(30);
    expect(sized.yPercent).toBe(20);
    expect(sized.rotationDeg).toBe(10);
  });
});

describe('what is wrong with a placement', () => {
  it('accepts a measured surface with a sensible design on it', () => {
    expect(
      validatePlacement({ surface: SURFACE, transform: transform(), artwork: LOGO }),
    ).toEqual([]);
  });

  it('refuses a garment with no chosen surface', () => {
    expect(
      validatePlacement({ surface: null, transform: transform(), artwork: LOGO }),
    ).toEqual(['NO_SURFACE']);
  });

  /*
   * A photograph nobody has measured can be looked at but not ordered from:
   * without the calibration there is no millimetre figure, and the shop would
   * be stitching a percentage.
   */
  it('refuses a surface the admin never measured', () => {
    const issues = validatePlacement({
      surface: { widthPx: 1200, heightPx: 1500, widthMm: null },
      transform: transform(),
      artwork: LOGO,
    });

    expect(issues).toContain('SURFACE_NOT_MEASURED');
  });

  it('refuses a design too small to be stitched', () => {
    const issues = validatePlacement({
      surface: SURFACE,
      transform: transform({ widthPercent: MIN_WIDTH_PERCENT }),
      artwork: LOGO,
    });

    // 2% of 520 mm is 10 mm, exactly the floor — so this one is allowed, and
    // the guard is the next millimetre down.
    expect(issues).not.toContain('TOO_SMALL');
    expect(
      designSize(transform({ widthPercent: MIN_WIDTH_PERCENT }), 520, LOGO).widthMm,
    ).toBe(MIN_DESIGN_WIDTH_MM);

    const tiny = validatePlacement({
      surface: { ...SURFACE, widthMm: 300 },
      transform: transform({ widthPercent: MIN_WIDTH_PERCENT }),
      artwork: LOGO,
    });
    expect(tiny).toContain('TOO_SMALL');
  });

  it('reports everything at once', () => {
    const issues = validatePlacement({
      surface: { widthPx: 1200, heightPx: 1500, widthMm: null },
      transform: transform({ xPercent: 99, widthPercent: 40 }),
      artwork: LOGO,
    });

    expect(issues).toContain('SURFACE_NOT_MEASURED');
    expect(issues).toContain('OFF_THE_GARMENT');
  });
});
