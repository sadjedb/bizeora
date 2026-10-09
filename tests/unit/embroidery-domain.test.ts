import { describe, expect, it } from 'vitest';

import {
  PREVIEW_MAX_PX,
  STITCH_DEFAULTS,
  luminance,
  paletteScale,
  quantiseChannel,
  shadeChannel,
  stitchParams,
  threadPosition,
  threadShadow,
  threadSpecular,
  threadTwist,
} from '@/domain/embroidery';

/**
 * The stitch preview's rules.
 *
 * You cannot assert that a canvas "looks embroidered", which is precisely why
 * the arithmetic lives in `domain/embroidery` and the canvas work lives in
 * `lib/embroidery`. What is testable is the set of claims the effect rests on:
 * that the palette really is reduced, that a thread is brighter down its middle
 * than at its edges, and that the row spacing follows the size of the artwork
 * rather than being a number that happened to look right on one logo.
 */

const params = stitchParams(400, 400);

describe('quantiseChannel', () => {
  it('keeps black black and white white', () => {
    // A logo whose white came back as 243 would read as grubby against the
    // garment, which is the one way a "preview" can lose a sale.
    expect(quantiseChannel(0, 6)).toBe(0);
    expect(quantiseChannel(255, 6)).toBe(255);
  });

  it('collapses a gradient onto the palette', () => {
    const levels = 6;
    const distinct = new Set(
      Array.from({ length: 256 }, (_, value) => quantiseChannel(value, levels)),
    );

    // The whole claim the preview makes about thread: a machine stitches with
    // the cones on the head, so 256 shades of one channel become six.
    expect(distinct.size).toBe(levels);
  });

  it('is monotonic — a brighter input never comes back darker', () => {
    for (let value = 1; value < 256; value += 1) {
      expect(quantiseChannel(value, 6)).toBeGreaterThanOrEqual(
        quantiseChannel(value - 1, 6),
      );
    }
  });

  it('falls back to two tones rather than dividing by zero', () => {
    expect(quantiseChannel(10, 1)).toBe(0);
    expect(quantiseChannel(200, 1)).toBe(255);
  });

  it('clamps input outside a byte', () => {
    expect(quantiseChannel(-20, 6)).toBe(0);
    expect(quantiseChannel(900, 6)).toBe(255);
  });
});

describe('threadPosition', () => {
  it('runs from one gap to the next across a period', () => {
    // Along the axis perpendicular to the rows, one period is one thread.
    const atStart = threadPosition(0, 0, 0, 10);
    const atHalf = threadPosition(5, 0, 0, 10);
    const atNext = threadPosition(10, 0, 0, 10);

    expect(atStart).toBeCloseTo(0, 6);
    expect(atHalf).toBeCloseTo(0.5, 6);
    expect(atNext).toBeCloseTo(0, 6);
  });

  it('stays inside 0–1 for negative coordinates', () => {
    // `%` keeps the sign of its left operand in JavaScript. A rotated design
    // produces negative coordinates, and a negative position would shade the
    // wrong half of every thread on that side of the origin.
    for (let x = -40; x < 0; x += 1) {
      const position = threadPosition(x, 0, 45, 7);
      expect(position).toBeGreaterThanOrEqual(0);
      expect(position).toBeLessThan(1);
    }
  });

  it('is constant along the direction the rows run', () => {
    // At 45° the rows run along x === y, so moving along that line must not
    // move you across a thread.
    expect(threadPosition(3, 3, 135, 8)).toBeCloseTo(threadPosition(9, 9, 135, 8), 6);
  });
});

describe('the light model', () => {
  it('shades the valley and lights the crown', () => {
    // 0 and 1 are where two threads meet; 0.5 is the crown of one.
    expect(threadShadow(0, params)).toBeGreaterThan(threadShadow(0.5, params));
    expect(threadSpecular(0.5, params)).toBeGreaterThan(threadSpecular(0, params));
  });

  it('puts no shadow and no highlight at the same place', () => {
    expect(threadShadow(0.5, params)).toBeCloseTo(0, 6);
    expect(threadSpecular(0, params)).toBeCloseTo(0, 6);
  });

  it('is symmetric about the crown', () => {
    expect(threadShadow(0.3, params)).toBeCloseTo(threadShadow(0.7, params), 6);
    expect(threadSpecular(0.3, params)).toBeCloseTo(threadSpecular(0.7, params), 6);
  });

  it('shows stitching on black, which multiplying never could', () => {
    // The failure that forced this model: a highlight folded into a
    // multiplier leaves black black, and most logos sent to an embroiderer
    // are mostly black. The sheen has to be light added, not colour scaled.
    const crown = shadeChannel(
      0,
      1,
      1,
      threadShadow(0.5, params),
      threadSpecular(0.5, params),
      1,
    );
    const valley = shadeChannel(
      0,
      1,
      1,
      threadShadow(0, params),
      threadSpecular(0, params),
      1,
    );

    expect(valley).toBe(0);
    expect(crown).toBeGreaterThan(40);
  });

  it('does not hatch white into an etching', () => {
    // The opposite failure: a proportional valley took 117 levels out of
    // white and turned a logo on a white ground into engraving.
    const crown = shadeChannel(
      255,
      1,
      1,
      threadShadow(0.5, params),
      threadSpecular(0.5, params),
      1,
    );
    const valley = shadeChannel(
      255,
      1,
      1,
      threadShadow(0, params),
      threadSpecular(0, params),
      1,
    );

    expect(crown).toBe(255);
    expect(crown - valley).toBeLessThan(70);
    expect(crown - valley).toBeGreaterThan(10);
  });
});

describe('threadTwist', () => {
  it('stays within a few percent of neutral', () => {
    // It is texture, not noise. Past a few percent the rows stop reading as
    // thread and start reading as interference.
    for (let i = 0; i < 200; i += 1) {
      const twist = threadTwist(i, i * 2, STITCH_DEFAULTS.angleDeg, 6);
      expect(twist).toBeGreaterThan(0.9);
      expect(twist).toBeLessThan(1.1);
    }
  });
});

describe('stitchParams', () => {
  it('spaces the rows by the size of the artwork', () => {
    const small = stitchParams(200, 200);
    const large = stitchParams(1000, 1000);

    // A fixed period makes one of these look like knitting and the other like
    // sandpaper.
    expect(large.periodPx).toBeGreaterThan(small.periodPx);
  });

  it('clamps at both ends', () => {
    expect(stitchParams(16, 16).periodPx).toBeGreaterThanOrEqual(3);
    expect(stitchParams(8000, 8000).periodPx).toBeLessThanOrEqual(14);
  });

  it('measures the shorter side, so a banner is not striped', () => {
    // A 1200 × 100 strip of lettering has 100px of room across the stitches.
    // Sizing from the long side would put three threads in the whole height.
    expect(stitchParams(1200, 100).periodPx).toBe(stitchParams(100, 100).periodPx);
  });

  it('takes overrides without losing the derived period', () => {
    const tuned = stitchParams(400, 400, { levels: 3, angleDeg: 90 });

    expect(tuned.levels).toBe(3);
    expect(tuned.angleDeg).toBe(90);
    expect(tuned.periodPx).toBe(stitchParams(400, 400).periodPx);
  });

  it('survives a degenerate size', () => {
    expect(() => stitchParams(0, 0)).not.toThrow();
    expect(stitchParams(0, 0).periodPx).toBeGreaterThanOrEqual(3);
  });
});

describe('shadeChannel', () => {
  it('returns a byte, whatever it is given', () => {
    expect(shadeChannel(200, 1, 1, 0, 400, 1)).toBe(255);
    expect(shadeChannel(10, 1, 1, 400, 0, 1)).toBe(0);
    expect(shadeChannel(100, 1, 1, 0, 0, 1)).toBe(100);
  });

  it('applies the outline shade last, to the whole lit value', () => {
    // The edge darkening is the thread turning at the border of the shape.
    // It has to dim the highlight too, or the outline glows.
    expect(shadeChannel(200, 1, 1, 0, 40, 0.5)).toBe(120);
  });
});

describe('paletteScale', () => {
  it('never pulls a near-neutral further apart', () => {
    /*
     * The bug this replaced, stated as a property.
     *
     * A near-white ground at (232, 228, 226) is 6 levels wide — a difference
     * nobody can see. It straddles a step boundary, so quantising each
     * channel independently sends one of them up and two of them down, and the
     * gap becomes 51 — a visible pale pink. That is why a logo on a white box
     * came back striped in pink and yellow. Scaling all three by one factor can
     * only ever narrow the gap, because it is a ratio.
     */
    const ground = [232, 228, 226] as const;
    const spread = (values: readonly number[]) =>
      Math.max(...values) - Math.min(...values);

    const scale = paletteScale(ground[0], ground[1], ground[2], 6);
    const scaled = ground.map((c) => shadeChannel(c, scale, 1, 0, 0, 1));
    const perChannel = ground.map((c) => quantiseChannel(c, 6));

    expect(spread(scaled)).toBeLessThanOrEqual(spread(ground));
    expect(spread(perChannel)).toBeGreaterThan(spread(ground));
  });

  it('keeps the hue of a saturated colour', () => {
    const scale = paletteScale(200, 40, 40, 6);
    const [r, g, b] = [200, 40, 40].map((c) => shadeChannel(c, scale, 1, 0, 0, 1));

    expect(r).toBeGreaterThan(g!);
    expect(g).toBeCloseTo(b!, 0);
  });

  it('reduces how many shades exist', () => {
    const shades = new Set(
      Array.from({ length: 256 }, (_, v) =>
        shadeChannel(v, paletteScale(v, v, v, 6), 1, 0, 0, 1),
      ),
    );

    // Six steps of grey, which is the claim the preview makes about thread.
    expect(shades.size).toBeLessThanOrEqual(6);
  });

  it('does not divide by a black pixel', () => {
    expect(Number.isFinite(paletteScale(0, 0, 0, 6))).toBe(true);
    expect(shadeChannel(0, paletteScale(0, 0, 0, 6), 1, 0, 0, 1)).toBe(0);
  });
});

describe('luminance', () => {
  it('weights green most, as the eye does', () => {
    expect(luminance(0, 255, 0)).toBeGreaterThan(luminance(255, 0, 0));
    expect(luminance(255, 0, 0)).toBeGreaterThan(luminance(0, 0, 255));
    expect(luminance(255, 255, 255)).toBeCloseTo(255, 3);
  });
});

describe('PREVIEW_MAX_PX', () => {
  it('is small enough that a per-pixel pass stays interactive', () => {
    // The effect is a JavaScript loop over every pixel. This constant is the
    // one that decides whether the preview is instant or janky, so it is
    // asserted rather than left as a number somebody doubles one afternoon.
    expect(PREVIEW_MAX_PX * PREVIEW_MAX_PX).toBeLessThanOrEqual(512 * 512);
  });
});
