/**
 * The gallery — "Our Work".
 *
 * Small, and one rule in it is not small at all. `BUSINESS-RULES.md` 13.6 and
 * `DATABASE.md` section 13 both say the same thing in different words: **a
 * gallery item derived from a customer's design may not be published without a
 * recorded consent**, and the public image is always a separately uploaded
 * asset rather than a signed reference to the private original. That is the one
 * place in this application where a private customer file could become public
 * by accident, and it is the mistake that would end the business.
 *
 * So the predicate lives here, pure and testable, and the database carries the
 * same rule as a CHECK constraint. Two enforcements of one rule, deliberately:
 * the domain refuses it with a sentence, the constraint makes it impossible.
 *
 * Everything else here is filtering, which is presentation logic with a URL.
 */

export type GalleryPublishInput = {
  /** Non-null when the item was made from a customer's uploaded design. */
  sourceDesignFileId: string | null;
  /** When that customer agreed, in writing, that we may show it. */
  customerConsentAt: Date | null;
};

/**
 * Whether this item may be published.
 *
 * An item with no `sourceDesignFileId` is our own photography and needs no
 * consent. An item derived from a customer's file needs `customerConsentAt`,
 * and no amount of "they said so on the phone" substitutes for the column.
 */
export function mayPublishGalleryItem(input: GalleryPublishInput): boolean {
  if (input.sourceDesignFileId === null) return true;

  return input.customerConsentAt !== null;
}

export const GALLERY_CONSENT_REFUSAL =
  'Cet élément vient du fichier d’un client : il ne peut être publié qu’avec un consentement enregistré.';

/* ---------------------------------------------------------------------------
 * Filtering
 * ------------------------------------------------------------------------ */

/**
 * The filters `/gallery` offers.
 *
 * Two facets, both free text on the row rather than reference tables:
 * `productType` ("Casquette") and `embroideryType` ("Logo d'entreprise").
 * `DATABASE.md` section 13 keeps them as text because the gallery is curated by
 * one person and a reference table for a dozen labels is a join and a screen
 * nobody needs.
 */
export type GalleryFilters = {
  productType: string | null;
  embroideryType: string | null;
};

export const NO_GALLERY_FILTERS: GalleryFilters = {
  productType: null,
  embroideryType: null,
};

/**
 * Read the filters out of a query string.
 *
 * Anything that is not a non-empty string becomes `null`, so `?type=` and
 * `?type[]=a&type[]=b` both mean "no filter" rather than an error page. A value
 * that matches nothing simply returns no items — the empty state says so and
 * offers a way back, which is `UX.md` section 13's rule for an empty result.
 */
export function parseGalleryFilters(params: {
  productType?: string | string[] | undefined;
  embroideryType?: string | string[] | undefined;
}): GalleryFilters {
  return {
    productType: single(params.productType),
    embroideryType: single(params.embroideryType),
  };
}

function single(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function hasActiveGalleryFilters(filters: GalleryFilters): boolean {
  return filters.productType !== null || filters.embroideryType !== null;
}

/** Build the query string for a filter change, dropping the empty facets. */
export function galleryHref(filters: GalleryFilters): string {
  const search = new URLSearchParams();

  if (filters.productType) search.set('productType', filters.productType);
  if (filters.embroideryType) search.set('embroideryType', filters.embroideryType);

  const query = search.toString();
  return query === '' ? '/gallery' : `/gallery?${query}`;
}

/** The href that toggles one facet value on or off, leaving the other alone. */
export function toggleGalleryFilter(
  filters: GalleryFilters,
  facet: keyof GalleryFilters,
  value: string,
): string {
  return galleryHref({
    ...filters,
    [facet]: filters[facet] === value ? null : value,
  });
}
