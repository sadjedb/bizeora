import 'server-only';

import sharp from 'sharp';

import { MAX_IMAGE_PIXELS } from '@/domain/design-file';
import { SHOP_IMAGE_MAX_EDGE, validateShopImageDimensions } from '@/domain/media';

/**
 * Turning an uploaded photograph into something the shop can publish.
 *
 * Shop imagery is **re-encoded rather than stored as sent** (`domain/media`),
 * and this is where that happens. Four things change on the way through, each
 * of which is a decision rather than a default:
 *
 * **The metadata is dropped.** `sharp` writes no EXIF unless asked, so the
 * stored file carries no camera model, no timestamp and — the one that matters
 * — no GPS coordinates. A phone writes the owner's location into every
 * photograph it takes, and a public bucket would publish it.
 *
 * **The orientation is applied.** `rotate()` with no argument bakes the EXIF
 * orientation into the pixels before that tag is discarded, so a picture taken
 * sideways is stored upright rather than appearing sideways once the tag is
 * gone.
 *
 * **The size is capped.** Nothing on the site asks for more than
 * `SHOP_IMAGE_MAX_EDGE`; `next/image` derives every smaller size from what is
 * stored, and it cannot un-blur, so this is the one dimension worth keeping
 * generous.
 *
 * **The format becomes JPEG.** One format on the shelf, whatever the camera
 * produced. `next/image` re-encodes to AVIF or WebP per request anyway
 * (`next.config.ts`), so the stored format is a storage decision, not a
 * delivery one — and a progressive JPEG is the one every tool can open when
 * somebody eventually wants the file back.
 *
 * Transparency is flattened onto white for the same reason the design-file
 * preview does it: a transparent logo on a transparent ground is an invisible
 * logo, and this file will be shown on a page whose background changes with the
 * theme.
 */

export type PreparedImage = {
  bytes: Uint8Array;
  contentType: 'image/jpeg';
  extension: 'jpg';
  width: number;
  height: number;
  /**
   * A tiny base64 JPEG, inlined into the markup as `next/image`'s
   * `blurDataURL`. Stored on the row rather than generated per render: it is
   * derived from bytes that never change, and deriving it again on every page
   * view would decode an image to produce 400 characters.
   */
  blurDataUrl: string;
};

export type PrepareFailure = {
  ok: false;
  reason: 'IMAGE_UNREADABLE' | 'IMAGE_TOO_SMALL';
};

export type PrepareResult = ({ ok: true } & PreparedImage) | PrepareFailure;

function open(bytes: Uint8Array) {
  return sharp(Buffer.from(bytes), {
    // The same decompression-bomb guard the design-file path uses. A hostile
    // 40 000 × 40 000 PNG is a few kilobytes on the wire and gigabytes in
    // memory, and only the decoder can refuse it.
    limitInputPixels: MAX_IMAGE_PIXELS,
    failOn: 'error',
    pages: 1,
  });
}

export async function prepareShopImage(bytes: Uint8Array): Promise<PrepareResult> {
  try {
    const source = open(bytes).rotate();

    /*
     * Orientation is applied above, so width and height are read *after* it:
     * a portrait photograph written by a camera as a rotated landscape reports
     * landscape dimensions in its header and is portrait once upright.
     */
    const rotated = await source
      .resize({
        width: SHOP_IMAGE_MAX_EDGE,
        height: SHOP_IMAGE_MAX_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 82, progressive: true, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });

    const width = rotated.info.width;
    const height = rotated.info.height;

    const tooSmall = validateShopImageDimensions({ width, height });
    if (tooSmall) return { ok: false, reason: 'IMAGE_TOO_SMALL' };

    // 16px on the longest edge: enough to carry the photograph's colours while
    // the real one loads, small enough that the data URL is shorter than the
    // URL it stands in for.
    const placeholder = await open(new Uint8Array(rotated.data))
      .resize({ width: 16, height: 16, fit: 'inside' })
      .jpeg({ quality: 40 })
      .toBuffer();

    return {
      ok: true,
      bytes: new Uint8Array(rotated.data),
      contentType: 'image/jpeg',
      extension: 'jpg',
      width,
      height,
      blurDataUrl: `data:image/jpeg;base64,${placeholder.toString('base64')}`,
    };
  } catch {
    // A bomb over the pixel limit and a truncated file both arrive here, and
    // both mean the same thing: this will not be decoded.
    return { ok: false, reason: 'IMAGE_UNREADABLE' };
  }
}
