/**
 * What embroidery looks like.
 *
 * A customer uploads a flat PNG of a logo and has to decide, before paying,
 * whether they want it stitched onto a garment. A flat PNG tells them almost
 * nothing about that: thread is a rounded, shiny, directional material with a
 * small palette, and a gradient-heavy logo that looks fine on a screen becomes
 * six blocks of colour on a sweatshirt. The preview this module describes is
 * how that conversation happens before the order rather than after it.
 *
 * ## It is a rendering, never a transformation
 *
 * **Nothing here ever touches the stored file.** Rule 9B and ADR-024: a design
 * file is evidence of what the customer asked for and is kept byte-for-byte, so
 * the stitch effect is applied to a *copy in a canvas, in the browser*, for
 * display only. The workshop, which has to digitise the real artwork, is shown
 * the original and never this. If a future phase ever wants to store a stitched
 * render, it stores it **beside** the original as a derived asset, and it is a
 * schema change with an ADR — not a change to this file.
 *
 * ## Why this is a domain module and not just canvas code
 *
 * Same split as `domain/media` and `lib/media/shop-image`: the rules live here,
 * pure and unit-tested, and the pixel plumbing lives in `lib/embroidery`. That
 * is not ceremony — it is the only way this is testable at all. You cannot
 * assert that a canvas "looks embroidered", but you can assert that a thread's
 * crown is brighter than its edges, that the palette really is reduced, and
 * that the row spacing scales with the artwork instead of being a magic number
 * that looks right on one logo.
 *
 * ## The model
 *
 * Satin stitch — the fill used for a logo or lettering — is a series of
 * parallel threads laid side by side. Each thread is a small cylinder, so
 * across its width the light goes dark, bright, dark, with a specular line
 * along the crown. Stack those rows at an angle and you have the whole effect;
 * everything else here is restraint about how far to push it.
 */

export type StitchParams = {
  /**
   * The direction the rows run, in degrees.
   *
   * 45° rather than 0° or 90° on purpose: horizontal rows read as corduroy and
   * vertical ones read as a barcode, because both align with the edges of
   * almost every logo. A diagonal crosses them.
   */
  angleDeg: number;
  /** Centre-to-centre distance between threads, in source pixels. */
  periodPx: number;
  /** How dark a thread's edge goes relative to its crown, 0–1. */
  relief: number;
  /** The specular line along the crown, 0–1. */
  sheen: number;
  /**
   * How many levels each colour channel is reduced to.
   *
   * The single most convincing part of the effect and the one that is really a
   * *fact* rather than a decoration: a machine stitches with the cones on the
   * head, so a photograph cannot be embroidered and a gradient becomes bands.
   * Showing that before the order is the whole point.
   */
  levels: number;
};

/** The deliberately restrained defaults. */
export const STITCH_DEFAULTS = {
  angleDeg: 45,
  relief: 0.17,
  sheen: 0.3,
  levels: 6,
} as const;

/**
 * Rows across the artwork's shorter side.
 *
 * The thread spacing has to be derived from the artwork rather than fixed,
 * because the same design arrives at 200px and at 2000px and a fixed period
 * would make one of them look like knitting and the other like sandpaper.
 * Forty rows across the short side is about what a 60mm chest logo really
 * carries.
 */
const ROWS_ACROSS_SHORT_SIDE = 26;

/** Below this the rows stop reading as threads and start aliasing. */
const MIN_PERIOD_PX = 4;
const MAX_PERIOD_PX = 14;

export function stitchParams(
  widthPx: number,
  heightPx: number,
  overrides: Partial<StitchParams> = {},
): StitchParams {
  const shortSide = Math.max(1, Math.min(widthPx, heightPx));
  const period = Math.round(shortSide / ROWS_ACROSS_SHORT_SIDE);

  return {
    ...STITCH_DEFAULTS,
    periodPx: Math.min(MAX_PERIOD_PX, Math.max(MIN_PERIOD_PX, period)),
    ...overrides,
  };
}

/**
 * One channel, reduced to the palette.
 *
 * Rounds to the nearest of `levels` evenly spaced values and returns a byte, so
 * black and white always survive exactly — a logo whose white went to 243 would
 * read as dirty against the garment.
 */
export function quantiseChannel(value: number, levels: number): number {
  if (levels <= 1) return value <= 127 ? 0 : 255;

  const steps = levels - 1;
  const clamped = value < 0 ? 0 : value > 255 ? 255 : value;

  return Math.round((Math.round((clamped / 255) * steps) / steps) * 255);
}

/** Perceived brightness, Rec. 709. */
export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * How much to scale every channel of a pixel to put it on the thread palette.
 *
 * **The palette is reduced in lightness, with the hue left alone**, and the
 * first version of this got it wrong in a way worth recording. Quantising each
 * channel independently looks right on saturated artwork and is a disaster on
 * everything else: a near-white ground at (250, 248, 243) has its channels land
 * on different steps, and a logo on a white box comes back striped in pale pink
 * and yellow. The customer reads that as "your filter is broken", and they are
 * not wrong.
 *
 * Quantising the *luminance* and scaling the channels by the same factor keeps
 * a neutral neutral and a red red. It is also the better model: a spool has a
 * colour, and what a limited palette actually limits is how many shades of it
 * are on the machine.
 *
 * Returned as a multiplier rather than three bytes so the caller can apply it
 * in its own loop without this allocating an array per pixel — at a quarter of
 * a million pixels that is the difference between instant and noticeable.
 */
export function paletteScale(r: number, g: number, b: number, levels: number): number {
  const lum = luminance(r, g, b);
  // Pure black has no lightness to redistribute, and dividing by it would be
  // a scale of Infinity on three zeroes.
  if (lum < 1) return 1;

  return quantiseChannel(lum, levels) / lum;
}

/**
 * Where a pixel falls across the width of the thread it belongs to, 0–1.
 *
 * 0 and 1 are the gaps between threads; 0.5 is the crown. This is the whole
 * geometry of the effect: project the point onto the axis perpendicular to the
 * rows, and take the fractional part of how many periods along it is.
 */
export function threadPosition(
  x: number,
  y: number,
  angleDeg: number,
  periodPx: number,
): number {
  const angle = (angleDeg * Math.PI) / 180;
  const across = x * Math.cos(angle) + y * Math.sin(angle);
  const turns = across / Math.max(1, periodPx);

  // `% 1` keeps the sign of the operand in JavaScript, so a negative
  // coordinate — which a rotated design produces — would come back negative
  // and shade the wrong half of the thread.
  const fraction = turns - Math.floor(turns);
  return fraction;
}

/**
 * The curve of a thread's cross-section, 0 at the gaps and 1 at the crown.
 *
 * `sin(πt)` is a serviceable cylinder without a square root per pixel.
 */
function crownAt(position: number): number {
  return Math.sin(Math.PI * position);
}

/**
 * **Both terms below are quantities of light, not multipliers, and that is the
 * one thing to understand about this model.**
 *
 * The first two attempts multiplied the pixel by a factor derived from where it
 * sat across the thread, and both failed in the same way from opposite ends.
 * Multiplying means the effect is proportional to the colour: a valley at 0.54
 * takes 117 levels out of white and 0 out of black. So a white logo came back
 * as harsh diagonal hatching — an etching, not a garment — while a black one,
 * which is what most logos sent to an embroiderer actually are, came back
 * completely flat, because `0 × anything` is 0.
 *
 * Light does not work that way. The shadow in the valley between two threads
 * and the highlight along a thread's crown are both *amounts of light*, roughly
 * independent of the colour underneath. Subtracting and adding them in bytes
 * gives a soft valley on white and a clearly visible sheen on black, from one
 * set of numbers.
 */

/** How quickly the shadow falls off out of the valley. */
const SHADOW_EXPONENT = 1.7;

/** How tight the highlight is along the crown. */
const SPECULAR_EXPONENT = 4;

/**
 * The shadow where two threads meet, in bytes to subtract.
 *
 * This is what makes the rows read as separate threads rather than as a wash.
 * The exponent keeps it to the valley: at the crown it is zero, and most of the
 * thread's width is barely touched — which is correct, because a satin stitch
 * is a wide flat band and only the seam between two of them is in shade.
 */
export function threadShadow(position: number, params: StitchParams): number {
  return params.relief * 255 * Math.pow(1 - crownAt(position), SHADOW_EXPONENT);
}

/**
 * The light the thread's surface reflects, in bytes to add.
 *
 * Rayon and polyester embroidery thread is noticeably shiny — it is most of
 * what distinguishes stitching from printing at a glance — so this is not a
 * subtle touch, and a high exponent keeps it a line along the crown rather than
 * a wash over the whole row.
 */
export function threadSpecular(position: number, params: StitchParams): number {
  return params.sheen * 255 * Math.pow(crownAt(position), SPECULAR_EXPONENT);
}

/**
 * The fibrous variation *along* the thread.
 *
 * Without it the rows are perfectly uniform ribbons and the whole thing reads
 * as a gradient filter. Thread is twisted, so it catches light unevenly along
 * its length. Deliberately tiny — at more than a few percent it stops being
 * texture and becomes noise.
 */
const TWIST_AMPLITUDE = 0.05;
const TWIST_PERIOD_RATIO = 0.65;

export function threadTwist(
  x: number,
  y: number,
  angleDeg: number,
  periodPx: number,
): number {
  const angle = (angleDeg * Math.PI) / 180;
  const along = -x * Math.sin(angle) + y * Math.cos(angle);
  const turns = along / Math.max(1, periodPx * TWIST_PERIOD_RATIO);

  return 1 + TWIST_AMPLITUDE * Math.sin(turns * 2 * Math.PI);
}

/**
 * One channel, through the whole model, as a byte.
 *
 * `palette` puts it on the thread's shade, `diffuse` shapes the row, `specular`
 * adds the light coming off it, and `shade` is how much the outline is darkened
 * — in that order, because the highlight sits on top of the thread rather than
 * being part of its colour.
 */
export function shadeChannel(
  channel: number,
  palette: number,
  twist: number,
  shadow: number,
  specular: number,
  shade: number,
): number {
  const lit = (channel * palette * twist - shadow + specular) * shade;
  const rounded = Math.round(lit);

  return rounded < 0 ? 0 : rounded > 255 ? 255 : rounded;
}

/**
 * How much a pixel on the outline is darkened.
 *
 * Stitching has a raised, slightly darker border where the thread turns — and
 * more usefully, a dark edge is what stops a logo looking like it has been
 * pasted onto the garment. Applied by the renderer to pixels that have a
 * transparent neighbour.
 */
export const EDGE_SHADE = 0.78;

/**
 * The largest side the preview is rendered at.
 *
 * The effect is per-pixel in JavaScript, so this is the number that decides
 * whether it is instant or janky. 512 is enough that the threads are visible on
 * a phone and on a product page; beyond it the cost doubles and nothing looks
 * better, because the thread period grows with the artwork anyway.
 */
export const PREVIEW_MAX_PX = 512;

/**
 * The smallest side the preview is rendered at — small artwork is scaled **up**.
 *
 * This looks wrong and is right, and the reason is that thread is a physical
 * object. A 60 mm chest logo carries the same number of stitches whether the
 * customer sent a 150-pixel PNG or a 3000-pixel one; the file's resolution has
 * nothing to do with how coarse the embroidery is. So a small file rendered at
 * its own size gets four-pixel threads that cannot be seen, and the customer
 * concludes the preview does nothing — which is the opposite of the truth,
 * because a 150-pixel logo is exactly the case where the workshop most needs to
 * have the conversation about detail.
 *
 * It is also honest about resolution rather than hiding it: scaling the artwork
 * up first makes a low-resolution file look soft under the stitching, which is
 * what it will be.
 */
export const PREVIEW_MIN_PX = 360;
