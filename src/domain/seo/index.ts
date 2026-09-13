/**
 * Structured data.
 *
 * `ROADMAP.md` Phase 14 asks for JSON-LD — Organization, WebSite,
 * BreadcrumbList, Product with offers and an aggregate rating, ItemList on
 * listings — and the whole risk of that feature is in one sentence: **what a
 * search engine is told must be what a visitor is shown.** A rating in JSON-LD
 * that no page displays is a fabrication whether or not anybody notices, and
 * emitting one is the single way this feature can do harm.
 *
 * So these are pure functions over the values the pages already render. They
 * take a price the pricing domain resolved, an availability the order domain
 * decided and a rating the approved reviews produced; they invent nothing, and
 * they **omit** rather than fill in. `AggregateRating` is absent when there are
 * no approved reviews, not present with a zero.
 *
 * Nothing here reads the environment or a database: absolute URLs are passed
 * in, already resolved against the configured origin by `lib/seo`.
 */

/** A JSON-LD node. Deliberately loose: the shape is Schema.org's, not ours. */
export type JsonLd = Record<string, unknown>;

/* ---------------------------------------------------------------------------
 * Site-level
 * ------------------------------------------------------------------------ */

export type OrganizationInput = {
  name: string;
  legalName: string;
  description: string;
  url: string;
  /** An absolute, public image URL. Omitted entirely when there is none. */
  logo: string | null;
  /** Absolute profile URLs from the `social_links` table. */
  sameAs: readonly string[];
};

/**
 * The business.
 *
 * `logo` and `sameAs` are omitted when empty rather than emitted as `null` or
 * `[]`: an empty `sameAs` claims the business has no profiles, which is a claim
 * rather than an absence.
 */
export function organizationLd(input: OrganizationInput): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: input.name,
    legalName: input.legalName,
    description: input.description,
    url: input.url,
    ...(input.logo ? { logo: input.logo } : {}),
    ...(input.sameAs.length > 0 ? { sameAs: [...input.sameAs] } : {}),
  };
}

export function webSiteLd(input: { name: string; url: string }): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: input.name,
    url: input.url,
    inLanguage: 'fr',
  };
}

/* ---------------------------------------------------------------------------
 * Breadcrumbs
 * ------------------------------------------------------------------------ */

export type Crumb = { name: string; url: string };

/**
 * The trail, in the order it is shown.
 *
 * Built from the same array the visible `Breadcrumbs` component renders, so the
 * two cannot describe different paths. An empty trail produces no node at all —
 * `null` rather than a `BreadcrumbList` with nothing in it.
 */
export function breadcrumbLd(crumbs: readonly Crumb[]): JsonLd | null {
  if (crumbs.length === 0) return null;

  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: crumb.url,
    })),
  };
}

/* ---------------------------------------------------------------------------
 * Products
 * ------------------------------------------------------------------------ */

/** Schema.org availability, from the same boolean the page renders. */
export const IN_STOCK = 'https://schema.org/InStock';
export const OUT_OF_STOCK = 'https://schema.org/OutOfStock';

export type ProductLdInput = {
  name: string;
  description: string;
  url: string;
  /** Absolute public image URLs. May be empty while photography is missing. */
  images: readonly string[];
  /** The resolved unit price, as the integer the page formats. */
  price: number;
  currency: string;
  /**
   * How many fraction digits the price is displayed with. Zero for the dinar,
   * which is quoted in whole units — see `schemaPrice`.
   */
  priceFractionDigits?: number;
  /** `true` when at least one variant can be bought (11.2). */
  available: boolean;
  category: string | null;
  /** One variant's SKU, when the product has exactly one. */
  sku: string | null;
  /** The approved-review aggregate: `average` is the mean × 100, or null. */
  rating: { average: number | null; count: number };
};

/**
 * The price, written the way Schema.org wants it — and the way the page shows it.
 *
 * The second half of that sentence is the whole rule. A structured-data price
 * that disagrees with the visible one is a mismatch Google penalises and a
 * customer notices, so this must produce the same number `formatMoney` renders,
 * not a re-interpretation of the column.
 *
 * `fractionDigits` therefore mirrors the display convention rather than the
 * currency's theoretical subunit: the dinar is quoted in whole units and
 * `components/commerce/price` formats it with none, so a stored `2500` is
 * "2 500 DA" on the page and `2500` here. Passing a different number of digits
 * is how a market with subunits would be added — the same parameter, the same
 * value, in both places.
 *
 * Formatted without a locale, because Schema.org requires a dot separator and
 * no grouping; a French `toLocaleString` would emit `2 500` and be rejected.
 */
export function schemaPrice(amount: number, fractionDigits = 0): string {
  return (amount / 10 ** fractionDigits).toFixed(fractionDigits);
}

/**
 * A product, its offer, and — only when it has one — its rating.
 *
 * The rating is omitted unless there is at least one approved review and a
 * computed average. Google requires `ratingValue` and `reviewCount` to be real
 * and to match what the page shows; a product nobody has reviewed simply has no
 * `aggregateRating` property, which is the correct statement rather than a
 * zero.
 */
export function productLd(input: ProductLdInput): JsonLd {
  const rating =
    input.rating.average !== null && input.rating.count > 0
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: (input.rating.average / 100).toFixed(2),
            reviewCount: input.rating.count,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {};

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: input.name,
    description: input.description,
    url: input.url,
    ...(input.images.length > 0 ? { image: [...input.images] } : {}),
    ...(input.category ? { category: input.category } : {}),
    ...(input.sku ? { sku: input.sku } : {}),
    offers: {
      '@type': 'Offer',
      url: input.url,
      price: schemaPrice(input.price, input.priceFractionDigits ?? 0),
      priceCurrency: input.currency,
      availability: input.available ? IN_STOCK : OUT_OF_STOCK,
    },
    ...rating,
  };
}

/* ---------------------------------------------------------------------------
 * Listings
 * ------------------------------------------------------------------------ */

export type ListItemInput = { name: string; url: string };

/**
 * An ordered list of links, for a listing page.
 *
 * `ItemList` of URLs rather than of embedded objects: the listing shows cards,
 * and repeating each product's full description here would be a second copy of
 * the product data that could drift from the detail page's own.
 */
export function itemListLd(input: {
  name: string;
  items: readonly ListItemInput[];
}): JsonLd | null {
  if (input.items.length === 0) return null;

  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: input.name,
    numberOfItems: input.items.length,
    itemListElement: input.items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      url: item.url,
    })),
  };
}

/* ---------------------------------------------------------------------------
 * Serialisation
 * ------------------------------------------------------------------------ */

/**
 * JSON-LD as a string safe to place inside a `<script>` element.
 *
 * `</script>` inside a JSON string value would close the element early and turn
 * whatever follows into markup. Every value here comes from our own database —
 * a product name, a review count — but a product name is a field somebody types,
 * so the escape is applied rather than reasoned about. `<` is escaped as `<`,
 * which is valid JSON and inert in HTML.
 */
export function serialiseJsonLd(node: JsonLd | readonly JsonLd[]): string {
  return JSON.stringify(node).replace(/</g, '\\u003c');
}
