import {
  EDGE_SHADE,
  PREVIEW_MAX_PX,
  PREVIEW_MIN_PX,
  paletteScale,
  shadeChannel,
  stitchParams,
  threadShadow,
  threadPosition,
  threadSpecular,
  threadTwist,
  type StitchParams,
} from '@/domain/embroidery';

/**
 * The stitch preview's pixel plumbing.
 *
 * The rules are in `domain/embroidery`; this is the part that cannot be unit
 * tested because it needs a canvas, and it is kept as thin as possible for that
 * reason. Same split as `domain/media` / `lib/media/shop-image`.
 *
 * **Browser only.** It is called from a client component after the image has
 * loaded. It is not on any server path and must not become one: running this on
 * the server would mean decoding customer artwork into memory on a request,
 * which is both expensive and a different security question from the one
 * ADR-024 already answered.
 *
 * ## The one real constraint
 *
 * `getImageData` on a canvas that has drawn a cross-origin image throws a
 * `SecurityError` — the canvas is *tainted*. Design previews are served from
 * our own origin through a signed URL, so in practice this does not happen, but
 * "in practice" is not a guarantee when storage can be reconfigured to a CDN
 * host. Every failure path here therefore returns `null` rather than throwing,
 * and the component falls back to showing the artwork as uploaded. A preview is
 * a nicety; losing it must never lose the picture.
 */

export type StitchRenderResult = {
  /** A data URL of the stitched render, ready for an `<img>`. */
  url: string;
  width: number;
  height: number;
};

/**
 * Render `image` as embroidery.
 *
 * Returns `null` when the browser will not let us read the pixels, when the
 * image has no dimensions yet, or when a canvas cannot be obtained at all.
 */
export function renderStitch(
  image: HTMLImageElement,
  overrides: Partial<StitchParams> = {},
): StitchRenderResult | null {
  const sourceWidth = image.naturalWidth;
  const sourceHeight = image.naturalHeight;
  if (sourceWidth === 0 || sourceHeight === 0) return null;

  /*
   * The working size: down to `PREVIEW_MAX_PX`, and **up** to `PREVIEW_MIN_PX`.
   *
   * Scaling up is deliberate — see `PREVIEW_MIN_PX`. Thread is a physical
   * thing, so a 150-pixel logo and a 3000-pixel one stitched at the same width
   * carry the same number of stitches; rendering the small one at its own size
   * produces threads too fine to see and a preview that appears to do nothing.
   *
   * The clamp is applied to the longest side so the aspect ratio is untouched.
   */
  const longest = Math.max(sourceWidth, sourceHeight);
  const target = Math.min(PREVIEW_MAX_PX, Math.max(PREVIEW_MIN_PX, longest));
  const scale = target / longest;
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  // `willReadFrequently` tells the browser to keep this canvas on the CPU. We
  // read the whole buffer once and write it back once; without the hint some
  // engines put it on the GPU and every `getImageData` becomes a readback.
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;

  context.drawImage(image, 0, 0, width, height);

  let pixels: ImageData;
  try {
    pixels = context.getImageData(0, 0, width, height);
  } catch {
    // A tainted canvas. See the note above: no preview, but still a picture.
    return null;
  }

  stitch(pixels, stitchParams(width, height, overrides));
  context.putImageData(pixels, 0, 0);

  return { url: canvas.toDataURL('image/png'), width, height };
}

/**
 * The per-pixel pass, in place.
 *
 * One loop rather than one per effect: the quantisation, the thread shading and
 * the twist all read the same pixel, and three passes over a 512 × 512 buffer
 * is three times the memory traffic for the same arithmetic.
 *
 * The edge darkening needs the *original* alpha of the neighbours, which is why
 * alpha is copied out first — reading it back from `data` mid-loop would see
 * pixels this pass has already rewritten and the outline would thicken as it
 * went.
 */
function stitch(image: ImageData, params: StitchParams): void {
  const { data, width, height } = image;
  const alpha = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    alpha[p] = data[i + 3]!;
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      const i = p * 4;

      // Fully transparent pixels are the garment showing through. Leave them.
      if (alpha[p]! === 0) continue;

      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;

      const position = threadPosition(x, y, params.angleDeg, params.periodPx);
      const twist = threadTwist(x, y, params.angleDeg, params.periodPx);

      // One scale for all three channels, so a neutral stays neutral — see
      // `paletteScale`. The twist multiplies the colour rather than the light:
      // it is the thread's own surface varying along its length.
      const palette = paletteScale(r, g, b, params.levels);
      const shadow = threadShadow(position, params);
      const specular = threadSpecular(position, params);
      const shade = isEdge(alpha, width, height, x, y) ? EDGE_SHADE : 1;

      data[i] = shadeChannel(r, palette, twist, shadow, specular, shade);
      data[i + 1] = shadeChannel(g, palette, twist, shadow, specular, shade);
      data[i + 2] = shadeChannel(b, palette, twist, shadow, specular, shade);
    }
  }
}

/** Does this pixel border transparency, or the edge of the image? */
function isEdge(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): boolean {
  if (x === 0 || y === 0 || x === width - 1 || y === height - 1) return true;

  // Four-neighbour rather than eight: on a diagonal edge the eight-neighbour
  // test marks two pixels deep, which at this scale is a visible black line
  // rather than an outline.
  return (
    alpha[p(width, x - 1, y)]! < 250 ||
    alpha[p(width, x + 1, y)]! < 250 ||
    alpha[p(width, x, y - 1)]! < 250 ||
    alpha[p(width, x, y + 1)]! < 250
  );
}

function p(width: number, x: number, y: number): number {
  return y * width + x;
}
