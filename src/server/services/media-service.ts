import 'server-only';

import { detectSignature } from '@/domain/design-file';
import {
  movedOrder,
  validateAlt,
  validateShopImageUpload,
  type MediaRefusal,
} from '@/domain/media';
import { prepareShopImage } from '@/lib/media/shop-image';
import { mediaKeyFor, newObjectId, storage } from '@/lib/storage';
import {
  addProductImage,
  deleteProductImage,
  findImageProduct,
  listProductImages,
  reorderProductImages,
  setImageSurface,
  setPrimaryProductImage,
  updateImageAlt,
  type AdminImageRow,
} from '@/server/repositories/catalogue-admin-repository';
import {
  MIN_SURFACE_WIDTH_MM,
  MAX_SURFACE_WIDTH_MM,
  isDesignSurface,
} from '@/domain/customization/placement';

/**
 * Shop photography, as use cases.
 *
 * ## Why the bytes come through the server
 *
 * Customer design files are uploaded **straight to the bucket** with a
 * presigned PUT, and the server only reads them afterwards to verify them
 * (`design-file-service`, `SECURITY.md` section 6). Shop imagery does not take
 * that route, and the difference is deliberate rather than an oversight:
 *
 *   - the stored object is **not** the uploaded one — it is re-encoded, capped
 *     and stripped of EXIF (`lib/media/shop-image`), so the bytes have to pass
 *     through something that can decode them;
 *   - it lands in the **public** prefix, where "verified afterwards" is not
 *     good enough: an object is readable by anyone the moment it exists, so
 *     nothing may be written there until it has been decoded and accepted;
 *   - it is staff-only and occasional. The presign dance exists to keep large
 *     customer uploads off the application; a handful of product photographs a
 *     week is not that problem.
 *
 * The consequence to know about: the action that calls this receives the file
 * in its request body, so `next.config.ts` raises the server-action body limit
 * to match `MAX_SHOP_IMAGE_BYTES`.
 *
 * ## What is checked, in order
 *
 * The declared type and size first, because they are free. Then the file's own
 * **signature**, because the declared type is the browser's claim and a `.jpg`
 * that is really an HTML document is the oldest trick there is. Then the decode
 * itself, which is the only thing that proves the file is an image at all.
 */

export type MediaFailure = { ok: false; message: string; code: MediaRefusal['code'] };
export type MediaSuccess<T> = { ok: true; value: T };
export type MediaResult<T> = MediaSuccess<T> | MediaFailure;

/**
 * French, like every other admin-facing message produced on the server.
 *
 * The workshop's screens are translated from the dictionaries, but a message
 * that comes back from a server action has no request locale to read — the
 * limitation ADR-030 records. These are the fallback text an English-speaking
 * operator would see, and they are deliberately short and factual.
 */
const MESSAGES: Record<MediaRefusal['code'], string> = {
  TYPE_NOT_ACCEPTED: 'Format non accepté. Utilisez JPG, PNG ou WebP.',
  TOO_LARGE: 'Image trop volumineuse (12 Mo maximum).',
  EMPTY: 'Ce fichier est vide.',
  TOO_MANY: 'Ce produit a déjà le nombre maximum de photographies.',
  ALT_TOO_LONG: 'La description est trop longue.',
  IMAGE_UNREADABLE: 'Ce fichier n’a pas pu être lu comme une image.',
  IMAGE_TOO_SMALL: 'Image trop petite pour être publiée (200 px minimum).',
};

function refuse(code: MediaRefusal['code']): MediaFailure {
  return { ok: false, code, message: MESSAGES[code] };
}

/**
 * Store one image and attach it to a product.
 *
 * The object is written **before** the row, and the row is what makes it
 * visible: a write that fails halfway leaves an unreferenced object rather than
 * a product pointing at nothing. If the row fails, the object is removed again
 * — best-effort, because a leaked object is a few kilobytes and a thrown error
 * here would lose the operator's upload for a reason they cannot act on.
 */
export async function attachProductImage(input: {
  productId: string;
  file: { bytes: Uint8Array; contentType: string; alt: string };
}): Promise<MediaResult<AdminImageRow>> {
  const existing = await listProductImages(input.productId);

  const refusal = validateShopImageUpload({
    contentType: input.file.contentType,
    sizeBytes: input.file.bytes.byteLength,
    existingCount: existing.length,
  });

  if (refusal) return refuse(refusal.code);

  const altRefusal = validateAlt(input.file.alt);
  if (altRefusal) return refuse(altRefusal.code);

  /*
   * The bytes' own claim about themselves. `detectSignature` knows PNG, JPEG,
   * SVG and PDF; the last two are not shop imagery, and an unrecognised
   * signature is not either. WebP has no entry there, so it is recognised by
   * its own container header rather than by trusting the upload's type.
   */
  const signature = detectSignature(input.file.bytes) ?? webpSignature(input.file.bytes);
  if (
    signature !== 'image/png' &&
    signature !== 'image/jpeg' &&
    signature !== 'image/webp'
  ) {
    return refuse('TYPE_NOT_ACCEPTED');
  }

  const prepared = await prepareShopImage(input.file.bytes);
  if (!prepared.ok) return refuse(prepared.reason);

  const key = mediaKeyFor(newObjectId(), prepared.extension);
  await storage.put({
    key,
    body: prepared.bytes,
    contentType: prepared.contentType,
  });

  const created = await addProductImage({
    productId: input.productId,
    storageKey: key,
    alt: input.file.alt.trim(),
    width: prepared.width,
    height: prepared.height,
    blurDataUrl: prepared.blurDataUrl,
  });

  if (!created.ok) {
    await storage.delete(key).catch(() => undefined);
    return refuse('IMAGE_UNREADABLE');
  }

  return { ok: true, value: created.value };
}

/**
 * Store an image that belongs to the site rather than to a product.
 *
 * The homepage's hero is the one that exists today. It returns the storage key
 * and writes no row: the key goes into the band's own `config`, which is where
 * that page keeps everything else about itself (ADR-027).
 *
 * Nothing deletes the previous object when a hero is replaced. That is
 * deliberate for now — an image that is still referenced by a cached page or by
 * a row somebody is about to undo is worse lost than kept — and the orphan is a
 * few kilobytes in a bucket. A sweep belongs with the one that already exists
 * for stale uploads.
 */
export async function attachSiteImage(input: {
  bytes: Uint8Array;
  contentType: string;
}): Promise<MediaResult<{ storageKey: string; width: number; height: number }>> {
  const refusal = validateShopImageUpload({
    contentType: input.contentType,
    sizeBytes: input.bytes.byteLength,
    // Site imagery is not a gallery, so the per-product ceiling does not apply.
    existingCount: 0,
  });

  if (refusal) return refuse(refusal.code);

  const signature = detectSignature(input.bytes) ?? webpSignature(input.bytes);
  if (
    signature !== 'image/png' &&
    signature !== 'image/jpeg' &&
    signature !== 'image/webp'
  ) {
    return refuse('TYPE_NOT_ACCEPTED');
  }

  const prepared = await prepareShopImage(input.bytes);
  if (!prepared.ok) return refuse(prepared.reason);

  const key = mediaKeyFor(newObjectId(), prepared.extension);
  await storage.put({ key, body: prepared.bytes, contentType: prepared.contentType });

  return {
    ok: true,
    value: { storageKey: key, width: prepared.width, height: prepared.height },
  };
}

/**
 * WebP's signature: `RIFF` … `WEBP`.
 *
 * Not in `domain/design-file` because a customer may not send one — it is
 * accepted here and nowhere else, and putting it there would widen a boundary
 * that is deliberately narrow.
 */
function webpSignature(bytes: Uint8Array): 'image/webp' | null {
  if (bytes.length < 12) return null;

  const riff = String.fromCharCode(...bytes.subarray(0, 4));
  const webp = String.fromCharCode(...bytes.subarray(8, 12));

  return riff === 'RIFF' && webp === 'WEBP' ? 'image/webp' : null;
}

export async function renameProductImage(input: {
  imageId: string;
  alt: string;
}): Promise<MediaResult<{ productId: string }>> {
  const refusal = validateAlt(input.alt);
  if (refusal) return refuse(refusal.code);

  const updated = await updateImageAlt({ imageId: input.imageId, alt: input.alt.trim() });
  if (!updated.ok) return refuse('IMAGE_UNREADABLE');

  return { ok: true, value: updated.value };
}

/** Remove the row, then the bytes. See the repository for why in that order. */
export async function removeProductImage(
  imageId: string,
): Promise<MediaResult<{ productId: string }>> {
  const removed = await deleteProductImage(imageId);
  if (!removed.ok) return refuse('IMAGE_UNREADABLE');

  await storage.delete(removed.value.storageKey).catch(() => undefined);

  return { ok: true, value: { productId: removed.value.productId } };
}

/** Move one image a step, computing the new sequence in the domain. */
export async function moveProductImage(input: {
  imageId: string;
  direction: 'up' | 'down';
}): Promise<MediaResult<{ productId: string }>> {
  const images = await imagesOf(input.imageId);
  if (!images) return refuse('IMAGE_UNREADABLE');

  const next = movedOrder(images.rows, input.imageId, input.direction);

  const written = await reorderProductImages({
    productId: images.productId,
    orderedIds: next.map((row) => row.id),
  });

  if (!written.ok) return refuse('IMAGE_UNREADABLE');

  return { ok: true, value: { productId: images.productId } };
}

export async function makeImagePrimary(
  imageId: string,
): Promise<MediaResult<{ productId: string }>> {
  const updated = await setPrimaryProductImage(imageId);
  if (!updated.ok) return refuse('IMAGE_UNREADABLE');

  return { ok: true, value: updated.value };
}

/** The product an image belongs to, with its siblings in display order. */
async function imagesOf(
  imageId: string,
): Promise<{ productId: string; rows: readonly AdminImageRow[] } | null> {
  const productId = await findImageProduct(imageId);
  if (!productId) return null;

  return { productId, rows: await listProductImages(productId) };
}

/* ---------------------------------------------------------------------------
 * Turning a photograph into a placeable surface
 * ------------------------------------------------------------------------ */

/**
 * Say which face of the garment a photograph shows, and how wide it really is.
 *
 * The two settings that promote an ordinary catalogue picture into something a
 * customer can drop a design onto (ADR-035). Both arrive from a form, so both
 * are checked here rather than at the screen: the face against the enum, and
 * the measurement against a range that rules out the two mistakes anybody
 * actually makes — a figure typed in centimetres, and a figure typed in metres.
 *
 * Clearing the face clears the measurement with it. A width left attached to a
 * picture nobody places designs on is data that looks meant.
 */
export async function setProductImageSurface(input: {
  imageId: string;
  surface: string | null;
  surfaceWidthMm: number | null;
}): Promise<MediaResult<{ productId: string }>> {
  if (input.surface !== null && !isDesignSurface(input.surface)) {
    return { ok: false, code: 'TYPE_NOT_ACCEPTED', message: SURFACE_UNKNOWN };
  }

  if (input.surface !== null) {
    const width = input.surfaceWidthMm;

    if (
      width === null ||
      !Number.isInteger(width) ||
      width < MIN_SURFACE_WIDTH_MM ||
      width > MAX_SURFACE_WIDTH_MM
    ) {
      return { ok: false, code: 'TYPE_NOT_ACCEPTED', message: SURFACE_WIDTH_RANGE };
    }
  }

  const updated = await setImageSurface({
    imageId: input.imageId,
    surface: input.surface === null ? null : input.surface,
    surfaceWidthMm: input.surfaceWidthMm,
  });

  if (!updated.ok) {
    return {
      ok: false,
      code: 'IMAGE_UNREADABLE',
      message: 'Cette photographie est introuvable.',
    };
  }

  return { ok: true, value: updated.value };
}

const SURFACE_UNKNOWN = 'Cette face de vêtement n’existe pas.';
const SURFACE_WIDTH_RANGE = `La largeur réelle doit être comprise entre ${MIN_SURFACE_WIDTH_MM} et ${MAX_SURFACE_WIDTH_MM} mm (en millimètres, pas en centimètres).`;
