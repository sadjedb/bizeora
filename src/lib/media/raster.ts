import 'server-only';

import sharp from 'sharp';

import {
  MAX_IMAGE_PIXELS,
  PREVIEW_MAX_EDGE,
  verifyImageDimensions,
} from '@/domain/design-file';

/**
 * Raster decoding and preview generation.
 *
 * The only place in the project that decodes an image, and the only place that
 * imports `sharp`. Everything here treats the incoming bytes as hostile:
 *
 *   - **`limitInputPixels`** caps the decode before it happens. A
 *     decompression bomb is a small file that becomes gigabytes of pixels, and
 *     the defence has to be applied by the decoder, not after it.
 *   - **`failOn: 'error'`** refuses a truncated or corrupt file rather than
 *     returning whatever it managed to read. A half-decoded logo is not a
 *     design; it is a file that will look wrong on a garment.
 *   - **Metadata is a claim, not a fact.** The dimensions used are the ones the
 *     decoder reports, and they are re-checked against the domain limits.
 *
 * `SECURITY.md` section 6 and ADR-011: previews are generated for PNG and JPG
 * only. SVG and PDF are never decoded server-side at all, which removes two
 * parsers from the attack surface entirely.
 */

export type RasterInspection =
  | { ok: true; width: number; height: number; format: string }
  | { ok: false; reason: 'IMAGE_UNREADABLE' | 'IMAGE_TOO_LARGE' };

function open(bytes: Uint8Array) {
  return sharp(Buffer.from(bytes), {
    limitInputPixels: MAX_IMAGE_PIXELS,
    failOn: 'error',
    // One frame. An animated PNG's later frames are not part of a logo, and
    // decoding them multiplies the cost of a hostile file.
    pages: 1,
  });
}

export async function inspectRaster(bytes: Uint8Array): Promise<RasterInspection> {
  try {
    /**
     * `metadata()` parses the header. It does **not** prove the image decodes:
     * a PNG with a valid header and a corrupt body reports its dimensions
     * happily and then fails at `vipspng: libpng read error` when anything
     * tries to read the pixels. That file would have passed validation, been
     * promoted to `READY`, and reached the embroiderer as artwork nobody can
     * open.
     *
     * So the pixels are actually read. `stats()` decodes the image under the
     * same `limitInputPixels` and `failOn` guards as everything else here, and
     * a file that cannot survive that is not a design file.
     */
    const image = open(bytes);
    const metadata = await image.metadata();
    await image.stats();
    const dimensions = verifyImageDimensions({
      width: metadata.width,
      height: metadata.height,
    });

    if (!dimensions.ok)
      return {
        ok: false,
        reason:
          dimensions.error.code === 'IMAGE_TOO_LARGE'
            ? 'IMAGE_TOO_LARGE'
            : 'IMAGE_UNREADABLE',
      };

    return {
      ok: true,
      width: dimensions.value.width,
      height: dimensions.value.height,
      format: metadata.format ?? 'unknown',
    };
  } catch {
    // `sharp` throws on a bomb over `limitInputPixels` and on a corrupt file
    // alike. Both are "we will not decode this", which is the same answer.
    return { ok: false, reason: 'IMAGE_UNREADABLE' };
  }
}

/**
 * A downscaled JPEG preview, or null when the image cannot be decoded.
 *
 * `rotate()` with no argument applies the EXIF orientation and then strips the
 * metadata, so the preview is upright and carries no GPS coordinates from the
 * phone that took the photograph. Uploading a picture of a sketch should not
 * publish where the sketch was made.
 */
export async function createPreview(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const output = await open(bytes)
      .rotate()
      .resize({
        width: PREVIEW_MAX_EDGE,
        height: PREVIEW_MAX_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      // Flattened onto white: a transparent logo previewed on a transparent
      // background is an invisible logo.
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();

    return new Uint8Array(output);
  } catch (error) {
    /**
     * A preview is a nicety; the file is already stored and validated, so a
     * failure here must not fail the upload. But it must not be *silent*
     * either — a swallowed error here once hid a preview that never generated
     * in the production build while every test passed.
     */
    console.warn('[media] preview generation failed', error);
    return null;
  }
}
