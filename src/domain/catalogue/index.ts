/**
 * The catalogue, as rules rather than as a form.
 *
 * Everything the admin's product and stock screens decide lives here: what a
 * valid product draft is, what a slug looks like, when a variant is low, and
 * whether an inventory adjustment is allowed. Pure functions over plain data,
 * no I/O — `BUSINESS-RULES.md` section 16 puts stock and availability in
 * `domain/`, and section 12.2 puts every permission predicate there too.
 *
 * The reason this module exists at all is that Phase 14.5 gave the admin the
 * ability to *write* the catalogue for the first time. Until now the catalogue
 * arrived from the seed and every rule about it was a read-side rule. A form
 * that posts a price, a stock count and a status is the moment those rules have
 * to be stated once and enforced on the server.
 */

/* ---------------------------------------------------------------------------
 * Status and policy vocabularies
 * ------------------------------------------------------------------------ */

export const PRODUCT_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = {
  DRAFT: 'Brouillon',
  ACTIVE: 'En ligne',
  ARCHIVED: 'Archivé',
};

export const PRODUCT_STATUS_HINTS: Record<ProductStatus, string> = {
  DRAFT: 'Invisible sur la boutique. Modifiable librement.',
  ACTIVE: 'Visible et vendable dès qu’une variante est disponible.',
  ARCHIVED: 'Retiré de la boutique. Les commandes passées sont conservées.',
};

export const STOCK_POLICIES = ['TRACK', 'DONT_TRACK', 'MADE_TO_ORDER'] as const;
export type StockPolicy = (typeof STOCK_POLICIES)[number];

export const STOCK_POLICY_LABELS: Record<StockPolicy, string> = {
  TRACK: 'Stock suivi',
  DONT_TRACK: 'Stock non suivi',
  MADE_TO_ORDER: 'Fabriqué à la commande',
};

export const STOCK_POLICY_HINTS: Record<StockPolicy, string> = {
  TRACK: 'La disponibilité est calculée à partir du stock. Une rupture bloque la vente.',
  DONT_TRACK: 'Toujours disponible. Aucune quantité n’est décomptée.',
  MADE_TO_ORDER:
    'Toujours disponible, produit à la commande. Recommandé pour les supports de broderie (10.8).',
};

/**
 * 10.8: a blank the business sources per job must not be stock-tracked, because
 * tracking it turns a sourcing question into a hard checkout failure. The
 * create form therefore opens on `MADE_TO_ORDER`, and `TRACK` is a deliberate
 * choice rather than the path of least resistance.
 */
export const DEFAULT_STOCK_POLICY: StockPolicy = 'MADE_TO_ORDER';

/* ---------------------------------------------------------------------------
 * Slugs
 * ------------------------------------------------------------------------ */

/**
 * A URL-safe slug from a product name.
 *
 * Accented Latin is folded rather than dropped — the catalogue is French, and
 * "Écharpe brodée" becoming "charpe-brode" would be a worse URL than a
 * transliterated one. Everything outside `a-z0-9` collapses to a single
 * hyphen, and the result is trimmed of leading and trailing hyphens.
 *
 * This is a *suggestion*. The admin can always type a slug, because a slug the
 * machine chose is still the URL the business has to live with.
 */
export function slugify(input: string): string {
  return (
    input
      .normalize('NFD')
      // Combining marks, by Unicode property rather than by a literal range.
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, SLUG_MAX)
  );
}

export const SLUG_MAX = 96;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= SLUG_MAX && SLUG_PATTERN.test(slug);
}

/* ---------------------------------------------------------------------------
 * Product drafts
 * ------------------------------------------------------------------------ */

export const NAME_MAX = 120;
export const SUBTITLE_MAX = 160;
export const DESCRIPTION_MIN = 20;
export const DESCRIPTION_MAX = 4000;
export const SHORT_TEXT_MAX = 2000;

/** The maximum price the form accepts, in the currency's own units. */
export const PRICE_MAX = 100_000_000;

export type ProductDraft = {
  name: string;
  slug: string;
  subtitle: string | null;
  description: string;
  categoryId: string;
  status: ProductStatus;
  basePrice: number;
  compareAtPrice: number | null;
  stockPolicy: StockPolicy;
  material: string | null;
  careInstructions: string | null;
  embroideryDetails: string | null;
  isCustomizable: boolean;
  isFeatured: boolean;
  isNewArrival: boolean;
  isBestSeller: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
};

export type ProductDraftField = keyof ProductDraft;

export type FieldErrors<Field extends string> = Partial<Record<Field, string>>;

/**
 * Whether a draft may be saved.
 *
 * The rules that are *not* here matter as much as the ones that are. Slug
 * uniqueness is a database question and is answered by a unique index, not by a
 * read-then-write that two admins can both pass. Category existence is a
 * foreign key. This function answers only what can be answered from the payload
 * alone, and the repository answers the rest.
 */
export function validateProductDraft(
  draft: ProductDraft,
): FieldErrors<ProductDraftField> {
  const errors: FieldErrors<ProductDraftField> = {};

  const name = draft.name.trim();
  if (name.length === 0) errors.name = 'Le nom est obligatoire.';
  else if (name.length > NAME_MAX) errors.name = `${NAME_MAX} caractères au maximum.`;

  if (!isValidSlug(draft.slug)) {
    errors.slug =
      'Minuscules, chiffres et tirets uniquement, par exemple « tote-bag-toile ».';
  }

  if (draft.subtitle !== null && draft.subtitle.length > SUBTITLE_MAX) {
    errors.subtitle = `${SUBTITLE_MAX} caractères au maximum.`;
  }

  const description = draft.description.trim();
  if (description.length < DESCRIPTION_MIN) {
    errors.description = `Au moins ${DESCRIPTION_MIN} caractères : c’est le texte que lit le client.`;
  } else if (description.length > DESCRIPTION_MAX) {
    errors.description = `${DESCRIPTION_MAX} caractères au maximum.`;
  }

  if (draft.categoryId.length === 0) errors.categoryId = 'Choisissez une catégorie.';

  if (!Number.isInteger(draft.basePrice) || draft.basePrice < 0) {
    errors.basePrice = 'Un montant entier, sans décimale.';
  } else if (draft.basePrice > PRICE_MAX) {
    errors.basePrice = 'Montant trop élevé.';
  } else if (draft.basePrice === 0 && draft.status === 'ACTIVE') {
    // A zero-price product that is live is almost always an unfinished draft
    // rather than a giveaway, and the failure is a customer buying it.
    errors.basePrice = 'Un produit en ligne ne peut pas être à zéro.';
  }

  if (draft.compareAtPrice !== null) {
    if (!Number.isInteger(draft.compareAtPrice) || draft.compareAtPrice < 0) {
      errors.compareAtPrice = 'Un montant entier, sans décimale.';
    } else if (draft.compareAtPrice <= draft.basePrice) {
      // A compare-at price at or below the price advertises a discount that is
      // not one. 2.4 of BUSINESS-RULES.md: it is shown only when it is higher.
      errors.compareAtPrice = 'Doit être supérieur au prix de vente, ou vide.';
    }
  }

  for (const field of ['material', 'careInstructions', 'embroideryDetails'] as const) {
    const value = draft[field];
    if (value !== null && value.length > SHORT_TEXT_MAX) {
      errors[field] = `${SHORT_TEXT_MAX} caractères au maximum.`;
    }
  }

  if (draft.seoTitle !== null && draft.seoTitle.length > NAME_MAX) {
    errors.seoTitle = `${NAME_MAX} caractères au maximum.`;
  }
  if (draft.seoDescription !== null && draft.seoDescription.length > SUBTITLE_MAX * 2) {
    errors.seoDescription = `${SUBTITLE_MAX * 2} caractères au maximum.`;
  }

  return errors;
}

export function hasErrors(errors: Record<string, string | undefined>): boolean {
  return Object.values(errors).some((message) => message !== undefined);
}

/* ---------------------------------------------------------------------------
 * Variants
 * ------------------------------------------------------------------------ */

export const SKU_MAX = 64;
const SKU_PATTERN = /^[A-Z0-9][A-Z0-9._-]*$/;

/** SKUs are shouted: they are read off a label, and case is a typo waiting. */
export function normaliseSku(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, '-');
}

export type VariantDraft = {
  sku: string;
  optionValues: readonly string[];
  priceOverride: number | null;
  stockQuantity: number;
  lowStockThreshold: number | null;
  isActive: boolean;
};

export type VariantDraftField = keyof VariantDraft;

export function validateVariantDraft(
  draft: VariantDraft,
): FieldErrors<VariantDraftField> {
  const errors: FieldErrors<VariantDraftField> = {};

  const sku = normaliseSku(draft.sku);
  if (sku.length === 0) errors.sku = 'Le SKU est obligatoire.';
  else if (sku.length > SKU_MAX) errors.sku = `${SKU_MAX} caractères au maximum.`;
  else if (!SKU_PATTERN.test(sku)) {
    errors.sku = 'Lettres majuscules, chiffres, point, tiret et souligné uniquement.';
  }

  if (!Number.isInteger(draft.stockQuantity) || draft.stockQuantity < 0) {
    errors.stockQuantity = 'Une quantité entière, jamais négative.';
  }

  if (draft.priceOverride !== null) {
    if (!Number.isInteger(draft.priceOverride) || draft.priceOverride < 0) {
      errors.priceOverride = 'Un montant entier, sans décimale.';
    } else if (draft.priceOverride > PRICE_MAX) {
      errors.priceOverride = 'Montant trop élevé.';
    }
  }

  if (draft.lowStockThreshold !== null) {
    if (!Number.isInteger(draft.lowStockThreshold) || draft.lowStockThreshold < 0) {
      errors.lowStockThreshold = 'Un seuil entier, jamais négatif.';
    }
  }

  return errors;
}

/* ---------------------------------------------------------------------------
 * Stock state
 * ------------------------------------------------------------------------ */

/**
 * 10.7: "a variant at or below `lowStockThreshold` appears in the admin's
 * low-stock list". A variant with no threshold of its own still has to appear
 * *somewhere* before it hits zero, so the system supplies a floor rather than
 * treating "no threshold" as "never warn".
 */
export const DEFAULT_LOW_STOCK_THRESHOLD = 3;

export type StockState =
  'UNTRACKED' | 'MADE_TO_ORDER' | 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'INACTIVE';

export const STOCK_STATE_LABELS: Record<StockState, string> = {
  UNTRACKED: 'Non suivi',
  MADE_TO_ORDER: 'À la commande',
  IN_STOCK: 'En stock',
  LOW_STOCK: 'Stock bas',
  OUT_OF_STOCK: 'Rupture',
  INACTIVE: 'Désactivée',
};

export type StockedVariant = {
  isActive: boolean;
  stockQuantity: number;
  reservedQuantity: number;
  lowStockThreshold: number | null;
};

/** 10.4: what could be committed right now. Never negative. */
export function availableStock(variant: StockedVariant): number {
  return Math.max(0, variant.stockQuantity - variant.reservedQuantity);
}

export function lowStockThresholdFor(variant: StockedVariant): number {
  return variant.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
}

/**
 * The one label the admin reads.
 *
 * `isActive` wins over everything: 2.1 says an inactive variant cannot be
 * purchased even when its product is active, so calling it "in stock" would be
 * telling the truth about the shelf and a lie about the shop.
 */
export function stockState(variant: StockedVariant, policy: StockPolicy): StockState {
  if (!variant.isActive) return 'INACTIVE';
  if (policy === 'DONT_TRACK') return 'UNTRACKED';
  if (policy === 'MADE_TO_ORDER') return 'MADE_TO_ORDER';

  const available = availableStock(variant);
  if (available === 0) return 'OUT_OF_STOCK';
  return available <= lowStockThresholdFor(variant) ? 'LOW_STOCK' : 'IN_STOCK';
}

/** Whether this state should draw the eye on a queue screen. */
export function isStockAlert(state: StockState): boolean {
  return state === 'OUT_OF_STOCK' || state === 'LOW_STOCK';
}

/* ---------------------------------------------------------------------------
 * Inventory adjustments
 * ------------------------------------------------------------------------ */

export const ADJUSTMENT_REASONS = [
  'RECEIVED',
  'COUNT',
  'DAMAGED',
  'RETURNED',
  'CORRECTION',
] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export const ADJUSTMENT_REASON_LABELS: Record<AdjustmentReason, string> = {
  RECEIVED: 'Réception de marchandise',
  COUNT: 'Inventaire physique',
  DAMAGED: 'Perte ou casse',
  RETURNED: 'Retour en stock',
  CORRECTION: 'Correction de saisie',
};

export const ADJUSTMENT_NOTE_MAX = 280;

export type StockAdjustment = {
  /** Signed. Positive receives stock, negative removes it. Never zero. */
  delta: number;
  reason: AdjustmentReason;
  note: string | null;
};

export type AdjustmentRefusal = {
  code: 'ZERO' | 'NOT_INTEGER' | 'NEGATIVE_RESULT' | 'BELOW_RESERVED' | 'NOTE_TOO_LONG';
  message: string;
};

/**
 * Whether an adjustment may be applied to this variant.
 *
 * Two refusals carry the whole safety of the feature.
 *
 * **Stock never goes negative.** A negative count is not a debt the business
 * can work off; it is a number that makes every availability calculation
 * downstream wrong, silently.
 *
 * **Stock never drops below what is already reserved.** `reservedQuantity` is
 * units promised to orders that exist (10.4), and the database carries
 * `reserved_quantity <= stock_quantity` as a check constraint. Removing stock
 * that is spoken for would either violate that constraint — an unexplained
 * 500 in the admin's face — or, worse, quietly unsell an order somebody has
 * already paid a deposit on. The admin is told to cancel the order first,
 * because that is the operation that actually releases the units.
 *
 * The adjustment is expressed as a **delta**, never as a final quantity. A form
 * that posts "the new total is 12" races every other write to that row; a form
 * that posts "-3" composes with them. The resulting quantity is shown in the
 * interface as a preview and recomputed on the server.
 */
export function validateStockAdjustment(
  adjustment: StockAdjustment,
  variant: Pick<StockedVariant, 'stockQuantity' | 'reservedQuantity'>,
): AdjustmentRefusal | null {
  if (!Number.isInteger(adjustment.delta)) {
    return { code: 'NOT_INTEGER', message: 'Saisissez un nombre entier.' };
  }

  if (adjustment.delta === 0) {
    return { code: 'ZERO', message: 'Indiquez une quantité à ajouter ou à retirer.' };
  }

  if (adjustment.note !== null && adjustment.note.length > ADJUSTMENT_NOTE_MAX) {
    return {
      code: 'NOTE_TOO_LONG',
      message: `${ADJUSTMENT_NOTE_MAX} caractères au maximum.`,
    };
  }

  const resulting = variant.stockQuantity + adjustment.delta;

  if (resulting < 0) {
    return {
      code: 'NEGATIVE_RESULT',
      message: `Il n’y a que ${variant.stockQuantity} en stock. Le stock ne peut pas devenir négatif.`,
    };
  }

  if (resulting < variant.reservedQuantity) {
    return {
      code: 'BELOW_RESERVED',
      message: `${variant.reservedQuantity} unité(s) sont réservées à des commandes en cours. Annulez la commande concernée avant de retirer ce stock.`,
    };
  }

  return null;
}

/** The quantity an adjustment would produce. Used for the form's preview. */
export function resultingQuantity(current: number, delta: number): number {
  return current + delta;
}
