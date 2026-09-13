/**
 * Shop imagery: the pictures the business publishes about itself.
 *
 * Deliberately separate from `domain/design-file`, which governs **customer
 * artwork**. The two look alike and are governed by opposite rules, and
 * conflating them is how a customer's logo ends up on a public URL:
 *
 * | | customer design files | shop media |
 * | --- | --- | --- |
 * | who uploads | the customer | staff only |
 * | where it lands | the private bucket | the public one |
 * | who may read it | the owner, after a check | anybody with the URL |
 * | are the bytes kept as sent | yes, exactly (ADR-024) | no, re-encoded |
 * | accepted types | PNG, JPG, SVG, PDF | PNG, JPG, WebP |
 *
 * The last row is the one worth stating twice. A design file is evidence of
 * what the customer asked for, so it is stored byte-for-byte. A photograph of a
 * tote bag is not evidence of anything: it is re-encoded on the way in, which
 * strips the EXIF block — **including the GPS coordinates a phone writes into
 * every picture it takes** — caps the pixel count, and produces one predictable
 * format instead of whatever the camera produced.
 *
 * Pure. No I/O, no framework, no `sharp`: the decoding lives in
 * `lib/media/shop-image`, and what is here is the rules that decide whether it
 * should happen at all.
 */

/* ---------------------------------------------------------------------------
 * What may be uploaded
 * ------------------------------------------------------------------------ */

export const SHOP_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export type ShopImageMimeType = (typeof SHOP_IMAGE_MIME_TYPES)[number];

export function isShopImageMimeType(value: string): value is ShopImageMimeType {
  return (SHOP_IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

/**
 * 12 MB.
 *
 * Generous, because it is what a modern phone produces and the owner should not
 * have to resize a photograph before uploading it. What is stored afterwards is
 * a re-encoded image of at most `SHOP_IMAGE_MAX_EDGE` on its longest side, so
 * this bounds the *upload*, not the shelf.
 */
export const MAX_SHOP_IMAGE_BYTES = 12 * 1024 * 1024;

/**
 * The longest edge of what is stored, in pixels.
 *
 * 2400 covers a full-bleed hero on a 2× laptop display and leaves `next/image`
 * room to produce every smaller size it serves. Storing the camera's 6000px
 * original would cost bandwidth on the way in and buy nothing: no viewport
 * asks for it.
 */
export const SHOP_IMAGE_MAX_EDGE = 2400;

/** Below this, an image is a mistake rather than a photograph. */
export const MIN_SHOP_IMAGE_EDGE = 200;

/** Section 14 of the design system: alternative text is a sentence, not a file name. */
export const IMAGE_ALT_MAX = 160;

/**
 * Eight per product.
 *
 * The product page renders a gallery; past eight nobody scrolls, and each one
 * is a row, an object and a thumbnail on the admin screen. A limit that is
 * never reached is still worth having: it is what stops a mis-click in a file
 * dialog from uploading a folder.
 */
export const MAX_IMAGES_PER_PRODUCT = 8;

/* ---------------------------------------------------------------------------
 * Refusals
 * ------------------------------------------------------------------------ */

export type MediaRefusal = {
  code:
    | 'TYPE_NOT_ACCEPTED'
    | 'TOO_LARGE'
    | 'EMPTY'
    | 'TOO_MANY'
    | 'ALT_TOO_LONG'
    | 'IMAGE_UNREADABLE'
    | 'IMAGE_TOO_SMALL';
};

/**
 * Whether these bytes may be accepted at all, before anything decodes them.
 *
 * The declared type is the browser's claim and is checked again against the
 * file's own signature once the bytes are in hand — this is the cheap gate that
 * refuses the obvious cases without reading anything.
 */
export function validateShopImageUpload(input: {
  contentType: string;
  sizeBytes: number;
  /** How many images the product already has. */
  existingCount: number;
}): MediaRefusal | null {
  if (!isShopImageMimeType(input.contentType)) return { code: 'TYPE_NOT_ACCEPTED' };
  if (input.sizeBytes <= 0) return { code: 'EMPTY' };
  if (input.sizeBytes > MAX_SHOP_IMAGE_BYTES) return { code: 'TOO_LARGE' };
  if (input.existingCount >= MAX_IMAGES_PER_PRODUCT) return { code: 'TOO_MANY' };

  return null;
}

/** Whether a decoded image is big enough to publish. */
export function validateShopImageDimensions(input: {
  width: number;
  height: number;
}): MediaRefusal | null {
  if (input.width < MIN_SHOP_IMAGE_EDGE || input.height < MIN_SHOP_IMAGE_EDGE) {
    return { code: 'IMAGE_TOO_SMALL' };
  }

  return null;
}

export function validateAlt(alt: string): MediaRefusal | null {
  return alt.length > IMAGE_ALT_MAX ? { code: 'ALT_TOO_LONG' } : null;
}

/* ---------------------------------------------------------------------------
 * Ordering
 * ------------------------------------------------------------------------ */

/**
 * The list with one item moved a step, or the list unchanged.
 *
 * Pure, so the rule that "the first image is the one on the card" can be tested
 * without a database. The repository writes the returned order back as
 * positions 0…n in one transaction.
 */
export function movedOrder<T extends { id: string }>(
  items: readonly T[],
  id: string,
  direction: 'up' | 'down',
): readonly T[] {
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return items;

  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= items.length) return items;

  const next = items.slice();
  const moved = next[index]!;
  next[index] = next[target]!;
  next[target] = moved;

  return next;
}

/**
 * Which image a product shows when only one is shown.
 *
 * `isPrimary` is a flag on a row, so nothing in the schema stops two rows from
 * claiming it or every row from disclaiming it. The reader therefore never
 * trusts the flag alone: the primary is the flagged one **or the first**, and
 * the writer's job is only to keep that answer stable.
 */
export function primaryOf<T extends { isPrimary: boolean }>(
  images: readonly T[],
): T | null {
  return images.find((image) => image.isPrimary) ?? images[0] ?? null;
}
