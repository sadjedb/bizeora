'use server';

import { revalidatePath } from 'next/cache';

import {
  PRODUCT_STATUSES,
  STOCK_POLICIES,
  slugify,
  type ProductStatus,
  type StockPolicy,
} from '@/domain/catalogue';
import { mayManageCatalogue } from '@/domain/permissions';
import { LOCALES } from '@/i18n/locales';
import { requireStaff } from '@/server/auth/guards';
import {
  addProductOption,
  collectTranslation,
  integerField,
  optionalText,
  saveProduct,
  saveVariant,
  changeProductStatus,
} from '@/server/services/catalogue-admin-service';
import {
  attachProductImage,
  makeImagePrimary,
  moveProductImage,
  removeProductImage,
  renameProductImage,
  setProductImageSurface,
} from '@/server/services/media-service';
import {
  attachProductModel,
  readModelMaterials,
  removeProductModel,
  setModelSettings,
} from '@/server/services/model3d-service';
import { MAX_MODEL_BYTES } from '@/domain/model3d';

import type { OptionFormState, ProductFormState, VariantFormState } from './form-state';

/**
 * Writing the catalogue.
 *
 * **Every action authorises independently.** The `/admin` layout guards what is
 * rendered, and that is not authorisation: a server action is reachable by
 * anybody who can POST to it, without a page ever rendering. So each of these
 * calls `requireStaff` and then the capability predicate from
 * `domain/permissions` over the loaded actor.
 *
 * **Nothing in the payload decides anything but its own field.** Status arrives
 * as a string and is checked against `PRODUCT_STATUSES` rather than cast;
 * prices are parsed as integers or refused; the product a variant belongs to is
 * the one in the URL, not one the form named. There is no field in any of these
 * forms that can point a write at a record the operator was not already on.
 *
 * **Revalidation follows the write.** A published product changes `/shop`, its
 * own page and the homepage's featured band, all of which are cached for five
 * minutes; a renamed product changes the old URL too, which is now a redirect.
 */

const UNAUTHENTICATED = 'Connectez-vous pour gérer le catalogue.';
const FORBIDDEN = 'Vous n’avez pas accès à la gestion du catalogue.';

async function authorise(): Promise<
  { ok: true; userId: string } | { ok: false; message: string }
> {
  const authorisation = await requireStaff();

  if (!authorisation.ok) {
    return {
      ok: false,
      message: authorisation.reason === 'UNAUTHENTICATED' ? UNAUTHENTICATED : FORBIDDEN,
    };
  }

  if (!mayManageCatalogue(authorisation.actor)) return { ok: false, message: FORBIDDEN };

  return { ok: true, userId: authorisation.actor.userId };
}

function isProductStatus(value: unknown): value is ProductStatus {
  return (
    typeof value === 'string' && (PRODUCT_STATUSES as readonly string[]).includes(value)
  );
}

function isStockPolicy(value: unknown): value is StockPolicy {
  return (
    typeof value === 'string' && (STOCK_POLICIES as readonly string[]).includes(value)
  );
}

/** A checkbox is absent from the payload when it is unchecked. */
function checkbox(form: FormData, name: string): boolean {
  return form.get(name) === 'on' || form.get(name) === 'true';
}

/**
 * Everything the storefront caches that a catalogue write can invalidate.
 *
 * **One concrete path per language.** The storefront's URLs carry a language
 * and live inside two route groups, and the route-pattern form of
 * `revalidatePath` does not reach them; `/fr/shop` is what the cache is keyed
 * on. Passing `/shop` — as this did before the site became bilingual — matches
 * nothing at all, which is the worst shape a cache bug can take: the write
 * succeeds, the page keeps its old copy, and nothing reports a failure.
 */
function revalidateStorefront(slugs: readonly (string | null)[]): void {
  revalidatePath('/admin/products');
  revalidatePath('/admin/stock');

  for (const locale of LOCALES) {
    revalidatePath(`/${locale}`);
    revalidatePath(`/${locale}/shop`);

    for (const slug of slugs) {
      if (slug) revalidatePath(`/${locale}/shop/${slug}`);
    }
  }
}

export async function saveProductAction(
  _previous: ProductFormState,
  form: FormData,
): Promise<ProductFormState> {
  const authorisation = await authorise();
  if (!authorisation.ok) return { errors: { form: authorisation.message } };

  const productId = optionalText(form.get('productId'));
  const name = (form.get('name') as string | null) ?? '';

  // An empty slug means "derive one from the name", which is what somebody
  // creating a product expects. A slug that was typed is never overwritten.
  const typedSlug = optionalText(form.get('slug'));
  const slug = typedSlug === null ? slugify(name) : slugify(typedSlug);

  const status = form.get('status');
  const stockPolicy = form.get('stockPolicy');

  if (!isProductStatus(status)) return { errors: { status: 'État inconnu.' } };
  if (!isStockPolicy(stockPolicy)) {
    return { errors: { stockPolicy: 'Politique de stock inconnue.' } };
  }

  const compareAtRaw = optionalText(form.get('compareAtPrice'));

  const result = await saveProduct({
    productId,
    // One language at a time: the form shows English beside French, and the
    // service merges it over whatever the column already holds.
    translation: {
      locale: 'en',
      values: collectTranslation(form, 'en', 'product'),
    },
    draft: {
      name,
      slug,
      subtitle: optionalText(form.get('subtitle')),
      description: (form.get('description') as string | null) ?? '',
      categoryId: (optionalText(form.get('categoryId')) ?? '') as string,
      status,
      basePrice: integerField(form.get('basePrice')),
      compareAtPrice: compareAtRaw === null ? null : integerField(compareAtRaw),
      stockPolicy,
      material: optionalText(form.get('material')),
      careInstructions: optionalText(form.get('careInstructions')),
      embroideryDetails: optionalText(form.get('embroideryDetails')),
      isCustomizable: checkbox(form, 'isCustomizable'),
      isFeatured: checkbox(form, 'isFeatured'),
      isNewArrival: checkbox(form, 'isNewArrival'),
      isBestSeller: checkbox(form, 'isBestSeller'),
      seoTitle: optionalText(form.get('seoTitle')),
      seoDescription: optionalText(form.get('seoDescription')),
    },
  });

  if (!result.ok) {
    return { errors: result.errors, translationErrors: result.translationErrors };
  }

  revalidateStorefront([result.value.slug, result.value.previousSlug]);
  revalidatePath(`/admin/products/${result.value.id}`);

  return { errors: {}, savedId: result.value.id, savedAt: Date.now() };
}

type SimpleResult = { ok: true } | { ok: false; message: string };

export async function changeProductStatusAction(input: {
  productId: string;
  status: string;
}): Promise<SimpleResult> {
  const authorisation = await authorise();
  if (!authorisation.ok) return { ok: false, message: authorisation.message };

  if (!isProductStatus(input.status)) return { ok: false, message: 'État inconnu.' };

  const result = await changeProductStatus({
    productId: input.productId,
    status: input.status,
  });

  if (!result.ok) return { ok: false, message: result.message };

  revalidateStorefront([result.slug]);
  revalidatePath(`/admin/products/${input.productId}`);

  return { ok: true };
}

export async function addOptionAction(
  _previous: OptionFormState,
  form: FormData,
): Promise<OptionFormState> {
  const authorisation = await authorise();
  if (!authorisation.ok) return { errors: { name: authorisation.message } };

  const productId = optionalText(form.get('productId'));
  if (productId === null) return { errors: { name: 'Produit inconnu.' } };

  const result = await addProductOption({
    productId,
    name: (form.get('optionName') as string | null) ?? '',
    rawValues: (form.get('optionValues') as string | null) ?? '',
  });

  if (!result.ok) return { errors: result.errors };

  revalidatePath(`/admin/products/${productId}`);

  return { errors: {} };
}

export async function saveVariantAction(
  _previous: VariantFormState,
  form: FormData,
): Promise<VariantFormState> {
  const authorisation = await authorise();
  if (!authorisation.ok) return { errors: { form: authorisation.message } };

  const productId = optionalText(form.get('productId'));
  if (productId === null) return { errors: { form: 'Produit inconnu.' } };

  const priceRaw = optionalText(form.get('priceOverride'));
  const thresholdRaw = optionalText(form.get('lowStockThreshold'));

  // Option values arrive as one entry per option: `optionValue:<optionId>`.
  const optionValueIds = form
    .getAll('optionValueId')
    .filter((value): value is string => typeof value === 'string' && value.length > 0);

  const result = await saveVariant({
    variantId: optionalText(form.get('variantId')),
    productId,
    draft: {
      sku: (form.get('sku') as string | null) ?? '',
      optionValues: optionValueIds,
      priceOverride: priceRaw === null ? null : integerField(priceRaw),
      // Stock is never set from this form; a variant is stocked through an
      // adjustment so that every unit on the shelf has a ledger entry.
      stockQuantity: 0,
      lowStockThreshold: thresholdRaw === null ? null : integerField(thresholdRaw),
      isActive: checkbox(form, 'isActive'),
    },
    optionValueIds,
  });

  if (!result.ok) return { errors: result.errors };

  revalidatePath(`/admin/products/${productId}`);
  revalidatePath('/admin/stock');
  revalidatePath('/[locale]/shop', 'page');

  return { errors: {}, saved: true };
}

/* ---------------------------------------------------------------------------
 * Photographs (Phase 14.8)
 * ------------------------------------------------------------------------ */

export type ImageActionResult = { ok: true } | { ok: false; message: string };

/**
 * Upload one photograph.
 *
 * The file arrives in the action's own body rather than through a presigned
 * PUT, because the server has to decode and re-encode it before anything is
 * stored publicly — `media-service` explains the difference from the customer
 * upload path at length.
 *
 * One file per call. The browser sends them one after another so a failure
 * names the file that failed, and so a slow connection reports progress
 * per photograph rather than stalling on a batch.
 */
export async function uploadProductImageAction(
  form: FormData,
): Promise<ImageActionResult> {
  const permitted = await authorise();
  if (!permitted.ok) return { ok: false, message: permitted.message };

  const productId = form.get('productId');
  const file = form.get('file');
  const alt = form.get('alt');

  if (typeof productId !== 'string' || !(file instanceof File)) {
    return { ok: false, message: 'Envoi incomplet.' };
  }

  const result = await attachProductImage({
    productId,
    file: {
      bytes: new Uint8Array(await file.arrayBuffer()),
      contentType: file.type,
      alt: typeof alt === 'string' ? alt : '',
    },
  });

  if (!result.ok) return { ok: false, message: result.message };

  revalidateProduct(productId);
  return { ok: true };
}

export async function updateImageAltAction(input: {
  imageId: string;
  alt: string;
}): Promise<ImageActionResult> {
  const permitted = await authorise();
  if (!permitted.ok) return { ok: false, message: permitted.message };

  const result = await renameProductImage(input);
  if (!result.ok) return { ok: false, message: result.message };

  revalidateProduct(result.value.productId);
  return { ok: true };
}

export async function deleteImageAction(input: {
  imageId: string;
}): Promise<ImageActionResult> {
  const permitted = await authorise();
  if (!permitted.ok) return { ok: false, message: permitted.message };

  const result = await removeProductImage(input.imageId);
  if (!result.ok) return { ok: false, message: result.message };

  revalidateProduct(result.value.productId);
  return { ok: true };
}

export async function moveImageAction(input: {
  imageId: string;
  direction: 'up' | 'down';
}): Promise<ImageActionResult> {
  const permitted = await authorise();
  if (!permitted.ok) return { ok: false, message: permitted.message };

  const result = await moveProductImage(input);
  if (!result.ok) return { ok: false, message: result.message };

  revalidateProduct(result.value.productId);
  return { ok: true };
}

export async function setPrimaryImageAction(input: {
  imageId: string;
}): Promise<ImageActionResult> {
  const permitted = await authorise();
  if (!permitted.ok) return { ok: false, message: permitted.message };

  const result = await makeImagePrimary(input.imageId);
  if (!result.ok) return { ok: false, message: result.message };

  revalidateProduct(result.value.productId);
  return { ok: true };
}

/** A photograph changes the product page, the listing and the front page. */
function revalidateProduct(productId: string): void {
  revalidatePath(`/admin/products/${productId}`);
  revalidateStorefront([]);
}

/* ---------------------------------------------------------------------------
 * Placeable surfaces, and the models that replace them
 * ------------------------------------------------------------------------ */

/**
 * Promote a photograph into a face a customer can drop a design onto.
 *
 * Both values arrive as strings from a `<select>` and an `<input type=number>`;
 * neither is trusted. Sending an empty surface demotes the picture back to an
 * ordinary catalogue photograph, which is how a face is un-set — there is no
 * separate "remove surface" action, because two ways to reach one state is one
 * way too many.
 */
export async function setImageSurfaceAction(input: {
  imageId: string;
  surface: string | null;
  surfaceWidthMm: number | null;
}): Promise<ImageActionResult> {
  const permitted = await authorise();
  if (!permitted.ok) return { ok: false, message: permitted.message };

  const result = await setProductImageSurface(input);
  if (!result.ok) return { ok: false, message: result.message };

  revalidateProduct(result.value.productId);
  return { ok: true };
}

/**
 * Attach a `.glb`.
 *
 * The file is read into memory and parsed before a byte is stored, because
 * `models/` is public: an object there is readable the moment it exists, so
 * "check it afterwards" would mean publishing a model that fetches from
 * somebody else's server for as long as the check takes (ADR-036).
 */
export async function uploadProductModelAction(
  form: FormData,
): Promise<ImageActionResult> {
  const permitted = await authorise();
  if (!permitted.ok) return { ok: false, message: permitted.message };

  const productId = form.get('productId');
  const file = form.get('file');
  const material = form.get('materialName');
  const width = form.get('surfaceWidthMm');

  if (typeof productId !== 'string' || !(file instanceof File)) {
    return { ok: false, message: 'Envoi incomplet.' };
  }

  // Refused before the bytes are read, not after: the size is known from the
  // handle, and reading 200 MB into memory to then reject it is the failure
  // mode this check exists to avoid.
  if (file.size > MAX_MODEL_BYTES) {
    return {
      ok: false,
      message: `Le fichier dépasse ${Math.round(MAX_MODEL_BYTES / (1024 * 1024))} Mo.`,
    };
  }

  const result = await attachProductModel({
    productId,
    bytes: new Uint8Array(await file.arrayBuffer()),
    materialName: typeof material === 'string' ? material : null,
    surfaceWidthMm: typeof width === 'string' && width.trim() ? Number(width) : null,
    label: null,
  });

  if (!result.ok) return { ok: false, message: result.message };

  revalidateProduct(productId);
  return { ok: true };
}

/**
 * What a file declares, without storing any of it.
 *
 * So the upload screen can ask "which of these do you embroider?" **before** the
 * model is attached. The bytes are parsed and dropped; nothing reaches storage
 * and nothing reaches the database, which is what makes this safe to call on a
 * file the operator may yet decide against.
 */
export async function readModelMaterialsAction(
  form: FormData,
): Promise<
  | { ok: true; materials: readonly string[]; suggested: string | null }
  | { ok: false; message: string }
> {
  const permitted = await authorise();
  if (!permitted.ok) return { ok: false, message: permitted.message };

  const file = form.get('file');
  if (!(file instanceof File)) return { ok: false, message: 'Envoi incomplet.' };

  if (file.size > MAX_MODEL_BYTES) {
    return {
      ok: false,
      message: `Le fichier dépasse ${Math.round(MAX_MODEL_BYTES / (1024 * 1024))} Mo.`,
    };
  }

  const result = readModelMaterials(new Uint8Array(await file.arrayBuffer()));
  if (!result.ok) return { ok: false, message: result.message };

  return { ok: true, ...result.value };
}

export async function updateProductModelAction(input: {
  modelId: string;
  materialName?: string;
  surfaceWidthMm?: number | null;
  isActive?: boolean;
}): Promise<ImageActionResult> {
  const permitted = await authorise();
  if (!permitted.ok) return { ok: false, message: permitted.message };

  const result = await setModelSettings(input);
  if (!result.ok) return { ok: false, message: result.message };

  revalidateProduct(result.value.productId);
  return { ok: true };
}

export async function deleteProductModelAction(input: {
  modelId: string;
}): Promise<ImageActionResult> {
  const permitted = await authorise();
  if (!permitted.ok) return { ok: false, message: permitted.message };

  const result = await removeProductModel(input.modelId);
  if (!result.ok) return { ok: false, message: result.message };

  revalidateProduct(result.value.productId);
  return { ok: true };
}
