import 'server-only';

import {
  CATEGORY_IN_USE_REFUSAL,
  hasErrors,
  mayDeactivateCategory,
  normaliseSku,
  resultingQuantity,
  validateCategoryDraft,
  validateProductDraft,
  validateStockAdjustment,
  validateVariantDraft,
  type AdjustmentReason,
  type CategoryDraft,
  type CategoryDraftField,
  type FieldErrors,
  type ProductDraft,
  type ProductDraftField,
  type ProductStatus,
  type VariantDraft,
  type VariantDraftField,
} from '@/domain/catalogue';
import {
  adjustStock,
  countLiveProductsInCategory,
  getCategoryTranslations,
  getProductTranslations,
  translationWrite,
  createCategory,
  createOption,
  createProduct,
  createVariant,
  getVariantForAdjustment,
  setProductStatus,
  updateCategory,
  updateProduct,
  updateVariant,
  type AdjustmentApplied,
  type SavedCategoryRow,
  type WriteFailure,
} from '@/server/repositories/catalogue-admin-repository';
import {
  TRANSLATABLE_FIELDS,
  mergeTranslation,
  validateTranslation,
  type TranslatableKind,
  type TranslationRefusal,
} from '@/domain/translation';

/**
 * Catalogue and stock, as use cases.
 *
 * The division of labour is the one the rest of the application already uses:
 * the **action** authorises and revalidates, this **service** validates and
 * orchestrates, and the **repository** is the only thing that talks to Prisma.
 *
 * What is worth saying out loud is how failure is shaped. Every entry point
 * returns either a value or a map from form field to message, because every
 * caller is a form and a form needs to put the message next to the control that
 * caused it. A thrown exception here would become a full-page error on a screen
 * where the operator has just typed forty fields.
 *
 * Uniqueness is deliberately *not* checked before writing. Two staff members
 * creating "tote-bag" at the same moment both pass a lookup and one of them
 * still loses at the index; so the write is attempted, the constraint decides,
 * and the loser gets the message on the `slug` field. The same holds for SKUs.
 */

export type ProductFormErrors = FieldErrors<ProductDraftField> & { form?: string };
export type VariantFormErrors = FieldErrors<VariantDraftField> & { form?: string };

const MESSAGES: Record<WriteFailure['code'], string> = {
  SLUG_TAKEN: 'Cette adresse est déjà utilisée par un autre produit.',
  SKU_TAKEN: 'Ce SKU existe déjà. Un SKU identifie une seule variante.',
  NOT_FOUND: 'Ce produit n’existe plus. Rechargez la liste.',
  CATEGORY_NOT_FOUND: 'Cette catégorie n’existe plus.',
  OPTION_EXISTS: 'Ce produit a déjà une option portant ce nom.',
  STOCK_REFUSED: 'Le stock a changé entre-temps. Rechargez la page.',
};

/** Trim, and treat an empty string as "not provided" rather than as "". */
export function optionalText(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * A whole number from a form field.
 *
 * Returns `NaN` for anything that is not one, which every validator treats as
 * invalid — the alternative, coercing "12abc" to 12, is how a price becomes
 * something nobody typed.
 */
export function integerField(value: FormDataEntryValue | null): number {
  if (typeof value !== 'string') return Number.NaN;
  const trimmed = value.trim().replace(/\s/g, '');
  if (trimmed.length === 0) return Number.NaN;
  return /^[+-]?\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : Number.NaN;
}

/* ---------------------------------------------------------------------------
 * Products
 * ------------------------------------------------------------------------ */

export type SavedProduct = { id: string; slug: string; previousSlug: string | null };

export async function saveProduct(input: {
  /** `null` creates; an id updates. */
  productId: string | null;
  draft: ProductDraft;
  /** One locale's overlay, as submitted. Absent leaves the column alone. */
  translation?: { locale: string; values: Readonly<Record<string, string>> };
}): Promise<
  | { ok: true; value: SavedProduct }
  | {
      ok: false;
      errors: ProductFormErrors;
      translationErrors?: TranslationFormErrors;
    }
> {
  const errors = validateProductDraft(input.draft);
  if (hasErrors(errors)) return { ok: false, errors };

  /*
   * The overlay is merged against what is stored, not against what the form
   * remembered. Two people editing the same product in two languages would
   * otherwise each save the other's work away.
   */
  let translations: ReturnType<typeof translationWrite> | undefined;

  if (input.translation) {
    const existing = input.productId
      ? await getProductTranslations(input.productId)
      : null;

    const prepared = prepareTranslation({
      existing,
      locale: input.translation.locale,
      kind: 'product',
      values: input.translation.values,
    });

    if (!prepared.ok)
      return { ok: false, errors: {}, translationErrors: prepared.errors };
    translations = translationWrite(prepared.value);
  }

  const write = {
    name: input.draft.name.trim(),
    slug: input.draft.slug,
    subtitle: input.draft.subtitle,
    description: input.draft.description.trim(),
    categoryId: input.draft.categoryId,
    status: input.draft.status,
    basePrice: input.draft.basePrice,
    compareAtPrice: input.draft.compareAtPrice,
    stockPolicy: input.draft.stockPolicy,
    material: input.draft.material,
    careInstructions: input.draft.careInstructions,
    embroideryDetails: input.draft.embroideryDetails,
    isCustomizable: input.draft.isCustomizable,
    isFeatured: input.draft.isFeatured,
    isNewArrival: input.draft.isNewArrival,
    isBestSeller: input.draft.isBestSeller,
    seoTitle: input.draft.seoTitle,
    seoDescription: input.draft.seoDescription,
    ...(translations === undefined ? {} : { translations }),
  };

  const result =
    input.productId === null
      ? await createProduct(write)
      : await updateProduct(input.productId, write);

  if (!result.ok) {
    const message = MESSAGES[result.failure.code];

    if (result.failure.code === 'SLUG_TAKEN') {
      return { ok: false, errors: { slug: message } };
    }
    if (result.failure.code === 'CATEGORY_NOT_FOUND') {
      return { ok: false, errors: { categoryId: message } };
    }

    return { ok: false, errors: { form: message } };
  }

  // `previousSlug` is non-null only when the write renamed the product, which
  // is the case the caller has to revalidate an extra URL for.
  return { ok: true, value: result.value };
}

export async function changeProductStatus(input: {
  productId: string;
  status: ProductStatus;
}): Promise<{ ok: true; slug: string } | { ok: false; message: string }> {
  const result = await setProductStatus(input.productId, input.status);
  if (!result.ok) return { ok: false, message: MESSAGES[result.failure.code] };
  return { ok: true, slug: result.value.slug };
}

/* ---------------------------------------------------------------------------
 * Options and variants
 * ------------------------------------------------------------------------ */

export const OPTION_NAME_MAX = 40;
export const OPTION_VALUES_MAX = 24;

/**
 * Add an option and its values in one step.
 *
 * Values arrive as one comma-separated line, which is how somebody actually
 * thinks about "S, M, L". Blank entries are dropped and duplicates collapse,
 * because a stray trailing comma should not create an empty size.
 */
export async function addProductOption(input: {
  productId: string;
  name: string;
  rawValues: string;
}): Promise<{ ok: true } | { ok: false; errors: { name?: string; values?: string } }> {
  const name = input.name.trim();
  if (name.length === 0)
    return { ok: false, errors: { name: 'Le nom est obligatoire.' } };
  if (name.length > OPTION_NAME_MAX) {
    return { ok: false, errors: { name: `${OPTION_NAME_MAX} caractères au maximum.` } };
  }

  const values = [
    ...new Set(
      input.rawValues
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  ];

  if (values.length === 0) {
    return { ok: false, errors: { values: 'Indiquez au moins une valeur.' } };
  }
  if (values.length > OPTION_VALUES_MAX) {
    return {
      ok: false,
      errors: { values: `${OPTION_VALUES_MAX} valeurs au maximum.` },
    };
  }

  const result = await createOption({ productId: input.productId, name, values });
  if (!result.ok) return { ok: false, errors: { name: MESSAGES[result.failure.code] } };

  return { ok: true };
}

export async function saveVariant(input: {
  /** `null` creates a variant on `productId`; an id updates that variant. */
  variantId: string | null;
  productId: string;
  draft: VariantDraft;
  optionValueIds: readonly string[];
}): Promise<{ ok: true } | { ok: false; errors: VariantFormErrors }> {
  const errors = validateVariantDraft(input.draft);
  if (hasErrors(errors)) return { ok: false, errors };

  const write = {
    sku: normaliseSku(input.draft.sku),
    priceOverride: input.draft.priceOverride,
    lowStockThreshold: input.draft.lowStockThreshold,
    isActive: input.draft.isActive,
  };

  const result =
    input.variantId === null
      ? await createVariant({
          productId: input.productId,
          write,
          optionValueIds: input.optionValueIds,
        })
      : await updateVariant(input.variantId, write);

  if (!result.ok) {
    const message = MESSAGES[result.failure.code];
    return {
      ok: false,
      errors: result.failure.code === 'SKU_TAKEN' ? { sku: message } : { form: message },
    };
  }

  return { ok: true };
}

/* ---------------------------------------------------------------------------
 * Stock
 * ------------------------------------------------------------------------ */

export type StockAdjustmentResult =
  | { ok: true; value: AdjustmentApplied }
  | { ok: false; message: string; field?: 'delta' | 'note' };

/**
 * Apply a stock movement.
 *
 * Two layers, on purpose, and they are not redundant.
 *
 * `validateStockAdjustment` reads the variant as it is *now* and produces the
 * message the operator needs: "there are only 4 in stock", "3 units are
 * reserved to an order". A message is only possible with the numbers in hand.
 *
 * The repository's conditional `UPDATE` then applies the same two rules against
 * the row at the moment of the write, which is the only place they can be
 * guaranteed. If the row moved in between — a shipment, another operator — the
 * update matches nothing, and this re-reads to say which rule stopped it rather
 * than reporting a generic conflict.
 */
export async function applyStockAdjustment(input: {
  variantId: string;
  delta: number;
  reason: AdjustmentReason;
  note: string | null;
  actorUserId: string;
}): Promise<StockAdjustmentResult> {
  const variant = await getVariantForAdjustment(input.variantId);
  if (!variant) return { ok: false, message: MESSAGES.NOT_FOUND };

  const refusal = validateStockAdjustment(
    { delta: input.delta, reason: input.reason, note: input.note },
    variant,
  );

  if (refusal) {
    return {
      ok: false,
      message: refusal.message,
      field: refusal.code === 'NOTE_TOO_LONG' ? 'note' : 'delta',
    };
  }

  const applied = await adjustStock({
    variantId: input.variantId,
    delta: input.delta,
    reason: input.reason,
    note: input.note,
    actorUserId: input.actorUserId,
  });

  if (applied.ok) return { ok: true, value: applied.value };

  if (applied.failure.code === 'STOCK_REFUSED') {
    // The row moved between the read and the write. Re-read and say what the
    // situation is now, rather than "conflict".
    const now = await getVariantForAdjustment(input.variantId);

    if (now) {
      const second = validateStockAdjustment(
        { delta: input.delta, reason: input.reason, note: input.note },
        now,
      );

      if (second) return { ok: false, message: second.message, field: 'delta' };
    }
  }

  return { ok: false, message: MESSAGES[applied.failure.code], field: 'delta' };
}

/** What the form previews while the operator types. Pure; no I/O. */
export function previewQuantity(current: number, delta: number): number {
  return resultingQuantity(current, delta);
}

/* ---------------------------------------------------------------------------
 * Categories
 * ------------------------------------------------------------------------ */

export type CategoryFormErrors = FieldErrors<CategoryDraftField>;

/**
 * Create or update a category.
 *
 * Two rules the payload cannot answer on its own, in the order they can fail:
 *
 *   1. **A category with live products may not be switched off** — see
 *      `mayDeactivateCategory` for why that is a rule rather than a warning.
 *      The count is taken here, against the database, rather than trusted from
 *      the form, which shows a stale figure the moment somebody else publishes
 *      something.
 *   2. **The slug has to be free**, which is the partial unique index's answer,
 *      not ours.
 */
export async function saveCategory(input: {
  /** `null` creates; an id updates. */
  categoryId: string | null;
  draft: CategoryDraft;
  /** One locale's overlay, as submitted. Absent leaves the column alone. */
  translation?: { locale: string; values: Readonly<Record<string, string>> };
}): Promise<
  | { ok: true; value: SavedCategoryRow }
  | {
      ok: false;
      errors: CategoryFormErrors;
      translationErrors?: TranslationFormErrors;
    }
> {
  const errors = validateCategoryDraft(input.draft);
  if (hasErrors(errors)) return { ok: false, errors };

  if (input.categoryId !== null && !input.draft.isActive) {
    const liveProducts = await countLiveProductsInCategory(input.categoryId);

    if (!mayDeactivateCategory({ liveProducts })) {
      return { ok: false, errors: { isActive: CATEGORY_IN_USE_REFUSAL } };
    }
  }

  let translations: ReturnType<typeof translationWrite> | undefined;

  if (input.translation) {
    const existing = input.categoryId
      ? await getCategoryTranslations(input.categoryId)
      : null;

    const prepared = prepareTranslation({
      existing,
      locale: input.translation.locale,
      kind: 'category',
      values: input.translation.values,
    });

    if (!prepared.ok)
      return { ok: false, errors: {}, translationErrors: prepared.errors };
    translations = translationWrite(prepared.value);
  }

  const write = {
    name: input.draft.name.trim(),
    slug: input.draft.slug,
    description: input.draft.description,
    position: input.draft.position,
    isActive: input.draft.isActive,
    seoTitle: input.draft.seoTitle,
    seoDescription: input.draft.seoDescription,
    ...(translations === undefined ? {} : { translations }),
  };

  const result =
    input.categoryId === null
      ? await createCategory(write)
      : await updateCategory(input.categoryId, write);

  if (!result.ok) {
    const message = CATEGORY_MESSAGES[result.failure.code];

    if (result.failure.code === 'SLUG_TAKEN') {
      return { ok: false, errors: { slug: message } };
    }

    return { ok: false, errors: { form: message } };
  }

  return { ok: true, value: result.value };
}

const CATEGORY_MESSAGES: Record<WriteFailure['code'], string> = {
  ...MESSAGES,
  SLUG_TAKEN: 'Cette adresse est déjà utilisée par une autre catégorie.',
  NOT_FOUND: 'Cette catégorie n’existe plus. Rechargez la liste.',
};

/* ---------------------------------------------------------------------------
 * Translations
 * ------------------------------------------------------------------------ */

export type TranslationFormErrors = Record<string, string>;

const TRANSLATION_MESSAGES: Record<TranslationRefusal, string> = {
  TOO_LONG: 'C’est trop long.',
  UNKNOWN_FIELD: 'Ce champ ne peut pas être traduit.',
};

/**
 * Pull one locale's overlay out of a submitted form.
 *
 * The fields arrive as `translations.<locale>.<field>`, which is a flat
 * namespace a plain `<form>` can post without any client-side assembly. Only
 * the requested locale is read, and only fields the domain lists as
 * translatable survive — a crafted `translations.en.basePrice` is dropped here
 * rather than merged into the column.
 */
export function collectTranslation(
  form: FormData,
  locale: string,
  kind: TranslatableKind,
): Record<string, string> {
  const prefix = `translations.${locale}.`;
  const allowed = new Set<string>(Object.keys(TRANSLATABLE_FIELDS[kind]));
  const values: Record<string, string> = {};

  for (const [key, value] of form.entries()) {
    if (!key.startsWith(prefix) || typeof value !== 'string') continue;

    const field = key.slice(prefix.length);
    if (allowed.has(field)) values[field] = value;
  }

  return values;
}

/**
 * Check an overlay and fold it into what is already stored.
 *
 * Returns the whole column's new value, because that is what a write takes: the
 * merge keeps every other locale untouched, drops fields that were cleared, and
 * collapses to `null` once a locale has nothing left in it.
 */
export function prepareTranslation(input: {
  existing: unknown;
  locale: string;
  kind: TranslatableKind;
  values: Readonly<Record<string, string>>;
}):
  | { ok: true; value: Record<string, Record<string, string>> | null }
  | { ok: false; errors: TranslationFormErrors } {
  const refusals = validateTranslation(input.kind, input.values);

  if (Object.keys(refusals).length > 0) {
    return {
      ok: false,
      errors: Object.fromEntries(
        Object.entries(refusals).map(([field, code]) => [
          field,
          TRANSLATION_MESSAGES[code],
        ]),
      ),
    };
  }

  return {
    ok: true,
    value: mergeTranslation(input.existing, input.locale, input.kind, input.values),
  };
}
