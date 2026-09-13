import 'server-only';

import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db/client';
import { toPublicAssetUrl } from '@/lib/media/public-asset';
import { isProductPurchasable, isVariantPurchasable } from '@/domain/order/availability';
import { resolveCompareAtPrice, resolveUnitPrice } from '@/domain/pricing';

/**
 * The storefront catalogue read path.
 *
 * This module and `lib/db` are the only places Prisma is allowed
 * (`ARCHITECTURE.md` section 6, enforced by the import-boundary lint rule).
 * Everything above it — pages, components, tests — sees the DTOs declared
 * below and nothing else. That is not ceremony: a Prisma model carries
 * `Decimal`, `Date`, `stockQuantity`, `reservedQuantity` and internal ids, and
 * handing one to a client component serialises all of it into the page.
 *
 * Three rules shape every query here:
 *
 *   1. **Visibility is in the `where`, never applied after the fetch.**
 *      A filter that runs in JavaScript is one forgotten line from publishing a
 *      draft.
 *   2. **Explicit `select`, always.** Section 6 prohibits `include` of a whole
 *      relation tree in a list context, and it is how admin-only columns stay
 *      out of the payload.
 *   3. **Business rules are imported, not re-implemented.** Price resolution
 *      and availability are `domain/` functions
 *      (`BUSINESS-RULES.md` section 16); this module maps rows and calls them.
 */

/* ---------------------------------------------------------------------------
 * DTOs — the storefront's view of the catalogue.
 * ------------------------------------------------------------------------ */

/** The catalogue markers a card can carry, as kinds. */
export type CatalogueBadge = 'NEW' | 'BEST_SELLER' | 'CUSTOMISABLE';

export type CatalogueImage = {
  /** Resolved public URL, or `null` while the asset bucket does not exist. */
  src: string | null;
  alt: string;
  width: number | null;
  height: number | null;
  blurDataUrl: string | null;
};

export type CatalogueOptionValue = {
  value: string;
  /** Swatch fill for a colour option. Always paired with the value's name. */
  hexColor: string | null;
};

export type CatalogueOption = {
  name: string;
  values: readonly CatalogueOptionValue[];
};

export type CatalogueVariant = {
  sku: string;
  /** Option values that identify this variant, e.g. `{ Taille: 'M' }`. */
  options: Readonly<Record<string, string>>;
  /** Server-resolved. The component never computes a price. */
  price: number;
  compareAtPrice: number | null;
  /**
   * Derived from stock policy and counts in `domain/order`. The raw counts are
   * deliberately not exposed — how much stock the business holds is
   * operational information, not something a product page needs.
   */
  available: boolean;
};

export type CatalogueProductSummary = {
  slug: string;
  name: string;
  category: string;
  price: number;
  compareAtPrice: number | null;
  currency: string;
  image: CatalogueImage | null;
  available: boolean;
  isCustomizable: boolean;
  /**
   * Which marker the card carries, if any — **a kind, never a label.**
   *
   * The repository used to return the French words. That put presentation in
   * the data layer, and it is the reason a badge could not be translated: a
   * bilingual storefront cannot have its copy decided by a `SELECT`. The
   * dictionary supplies the words at the point of rendering.
   */
  badge: CatalogueBadge | null;
};

export type CatalogueProductDetail = CatalogueProductSummary & {
  subtitle: string | null;
  description: string;
  images: readonly CatalogueImage[];
  options: readonly CatalogueOption[];
  variants: readonly CatalogueVariant[];
  /** Specification rows, built from the columns that carry them. */
  details: readonly { term: string; value: string }[];
  embroideryDetails: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
};

/* ---------------------------------------------------------------------------
 * Visibility
 * ------------------------------------------------------------------------ */

/**
 * `BUSINESS-RULES.md` 11.1 — publicly visible means `status = ACTIVE`,
 * `publishedAt` in the past, and not soft-deleted.
 *
 * Exported so a test can assert the exact predicate rather than infer it from
 * results, and so no caller has to remember all three clauses. It is a `where`
 * fragment on purpose: this must be applied by the database.
 */
export function publiclyVisibleWhere(now: Date = new Date()) {
  return {
    status: 'ACTIVE',
    deletedAt: null,
    publishedAt: { not: null, lte: now },
  } as const;
}

/* ---------------------------------------------------------------------------
 * Selections
 * ------------------------------------------------------------------------ */

/** The fields a card needs, and nothing else. */
const SUMMARY_SELECT = {
  slug: true,
  name: true,
  basePrice: true,
  compareAtPrice: true,
  currency: true,
  stockPolicy: true,
  isCustomizable: true,
  isNewArrival: true,
  isBestSeller: true,
  category: { select: { name: true } },
  // One image: the primary, else the first by position. Taking two and
  // choosing in code costs one row and avoids a correlated subquery.
  images: {
    select: {
      storageKey: true,
      alt: true,
      width: true,
      height: true,
      blurDataUrl: true,
      isPrimary: true,
    },
    orderBy: [{ isPrimary: 'desc' }, { position: 'asc' }],
    take: 1,
  },
  // Availability is a fold over variants, so only the three fields the rule
  // reads are selected — never the whole variant row.
  variants: {
    select: { isActive: true, stockQuantity: true, reservedQuantity: true },
  },
} satisfies Prisma.ProductSelect;

const DETAIL_SELECT = {
  ...SUMMARY_SELECT,
  subtitle: true,
  description: true,
  material: true,
  careInstructions: true,
  embroideryDetails: true,
  seoTitle: true,
  seoDescription: true,
  categoryId: true,
  images: {
    select: {
      storageKey: true,
      alt: true,
      width: true,
      height: true,
      blurDataUrl: true,
      isPrimary: true,
    },
    orderBy: [{ isPrimary: 'desc' }, { position: 'asc' }],
  },
  options: {
    select: {
      name: true,
      values: {
        select: { value: true, hexColor: true },
        orderBy: { position: 'asc' },
      },
    },
    orderBy: { position: 'asc' },
  },
  variants: {
    select: {
      sku: true,
      priceOverride: true,
      compareAtPriceOverride: true,
      isActive: true,
      stockQuantity: true,
      reservedQuantity: true,
      optionValues: {
        select: {
          optionValue: {
            select: { value: true, option: { select: { name: true } } },
          },
        },
      },
    },
    orderBy: { position: 'asc' },
  },
} satisfies Prisma.ProductSelect;

/* ---------------------------------------------------------------------------
 * Mapping
 * ------------------------------------------------------------------------ */

type ImageRow = {
  storageKey: string;
  alt: string;
  width: number | null;
  height: number | null;
  blurDataUrl: string | null;
};

function toImage(row: ImageRow): CatalogueImage {
  return {
    src: toPublicAssetUrl(row.storageKey),
    alt: row.alt,
    width: row.width,
    height: row.height,
    blurDataUrl: row.blurDataUrl,
  };
}

/**
 * The catalogue markers a card can carry.
 *
 * At most one, in priority order, because section 8 puts a single badge in the
 * card's top-left corner and stacking them turns a fashion grid into a sale
 * rack. "Customisable" comes last: it is true of nearly every product, so it
 * only earns the slot when nothing more specific applies.
 */
function toBadge(product: {
  isNewArrival: boolean;
  isBestSeller: boolean;
  isCustomizable: boolean;
}): CatalogueBadge | null {
  if (product.isNewArrival) return 'NEW';
  if (product.isBestSeller) return 'BEST_SELLER';
  if (product.isCustomizable) return 'CUSTOMISABLE';
  return null;
}

type SummaryRow = {
  slug: string;
  name: string;
  basePrice: number;
  compareAtPrice: number | null;
  currency: string;
  stockPolicy: string;
  isCustomizable: boolean;
  isNewArrival: boolean;
  isBestSeller: boolean;
  category: { name: string };
  images: ImageRow[];
  variants: { isActive: boolean; stockQuantity: number; reservedQuantity: number }[];
};

function toSummary(row: SummaryRow): CatalogueProductSummary {
  const product = { basePrice: row.basePrice, compareAtPrice: row.compareAtPrice };
  const policy = row.stockPolicy as 'TRACK' | 'DONT_TRACK' | 'MADE_TO_ORDER';

  return {
    slug: row.slug,
    name: row.name,
    category: row.category.name,
    price: resolveUnitPrice(product),
    compareAtPrice: resolveCompareAtPrice(product),
    currency: row.currency,
    image: row.images[0] ? toImage(row.images[0]) : null,
    available: isProductPurchasable(row.variants, policy),
    isCustomizable: row.isCustomizable,
    badge: toBadge(row),
  };
}

/* ---------------------------------------------------------------------------
 * Queries
 * ------------------------------------------------------------------------ */

/** Bounded, per `ARCHITECTURE.md` section 6: no unbounded `findMany`. */
export const CATALOGUE_PAGE_SIZE = 24;

export async function listPublishedProducts(
  options: { limit?: number } = {},
): Promise<readonly CatalogueProductSummary[]> {
  const rows = await prisma.product.findMany({
    where: publiclyVisibleWhere(),
    select: SUMMARY_SELECT,
    // Matches the `(status, publishedAt desc)` index in DATABASE.md section 17.
    orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
    take: Math.min(options.limit ?? CATALOGUE_PAGE_SIZE, CATALOGUE_PAGE_SIZE),
  });

  return rows.map(toSummary);
}

export async function getPublishedProductBySlug(
  slug: string,
): Promise<CatalogueProductDetail | null> {
  const row = await prisma.product.findFirst({
    // The slug is unique only among non-deleted rows (a partial index), so the
    // visibility predicate is what makes this lookup unambiguous.
    where: { slug, ...publiclyVisibleWhere() },
    select: DETAIL_SELECT,
  });

  if (!row) return null;

  const product = { basePrice: row.basePrice, compareAtPrice: row.compareAtPrice };
  const policy = row.stockPolicy as 'TRACK' | 'DONT_TRACK' | 'MADE_TO_ORDER';

  const details = [
    row.material ? { term: 'Matière', value: row.material } : null,
    row.careInstructions ? { term: 'Entretien', value: row.careInstructions } : null,
  ].filter((detail): detail is { term: string; value: string } => detail !== null);

  return {
    ...toSummary(row),
    subtitle: row.subtitle,
    description: row.description,
    images: row.images.map(toImage),
    options: row.options.map((option) => ({
      name: option.name,
      values: option.values.map((value) => ({
        value: value.value,
        hexColor: value.hexColor,
      })),
    })),
    variants: row.variants.map((variant) => ({
      sku: variant.sku,
      options: Object.fromEntries(
        variant.optionValues.map((link) => [
          link.optionValue.option.name,
          link.optionValue.value,
        ]),
      ),
      price: resolveUnitPrice(product, variant),
      compareAtPrice: resolveCompareAtPrice(product, variant),
      available: isVariantPurchasable(variant, policy),
    })),
    details,
    embroideryDetails: row.embroideryDetails,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
  };
}

/**
 * Other pieces from the same category.
 *
 * The schema has no "related products" table — `DATABASE.md` section 5 models
 * `collections` for editorial grouping, and those are V1.5. Category adjacency
 * is the documented relationship that exists, so it is what this uses, rather
 * than inventing a table for one section of one page.
 *
 * Bounded by `take` and excluded by slug in the query, so it never loads the
 * catalogue to pick four rows.
 */
export async function listRelatedProducts(
  categoryId: string,
  excludeSlug: string,
  limit = 4,
): Promise<readonly CatalogueProductSummary[]> {
  const rows = await prisma.product.findMany({
    // Uses the `(categoryId, status)` index from DATABASE.md section 17.
    where: { categoryId, slug: { not: excludeSlug }, ...publiclyVisibleWhere() },
    select: SUMMARY_SELECT,
    orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
    take: limit,
  });

  return rows.map(toSummary);
}

/**
 * A product page needs its own record and its neighbours. Issuing both in one
 * round trip keeps the page at two queries rather than two sequential waits,
 * and returns `null` without a second query when the slug is unknown.
 */
export async function getProductPageData(slug: string): Promise<{
  product: CatalogueProductDetail;
  related: readonly CatalogueProductSummary[];
} | null> {
  const row = await prisma.product.findFirst({
    where: { slug, ...publiclyVisibleWhere() },
    select: { categoryId: true },
  });

  if (!row) return null;

  const [product, related] = await Promise.all([
    getPublishedProductBySlug(slug),
    listRelatedProducts(row.categoryId, slug),
  ]);

  if (!product) return null;
  return { product, related };
}

/* ---------------------------------------------------------------------------
 * The sitemap
 * ------------------------------------------------------------------------ */

export type SitemapEntry = { slug: string; updatedAt: Date };

/**
 * Bounded, and the largest sitemap this catalogue can produce.
 *
 * A sitemap must be finite and deterministic. Ten thousand is far above what a
 * one-person workshop will hold and far below the 50,000-URL limit the protocol
 * sets, so the cap is a guard against a runaway query rather than a policy.
 */
export const SITEMAP_LIMIT = 10_000;

/**
 * Every publicly visible product, for `sitemap.xml`.
 *
 * The **same** `publiclyVisibleWhere` predicate the storefront uses (11.1), not
 * a second copy of it: a sitemap built from a different definition of "public"
 * is a sitemap that eventually advertises a draft. `updatedAt` becomes
 * `lastModified`, which is a fact about the row rather than the time of the
 * request.
 */
export async function listProductsForSitemap(): Promise<readonly SitemapEntry[]> {
  return prisma.product.findMany({
    where: publiclyVisibleWhere(),
    select: { slug: true, updatedAt: true },
    orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
    take: SITEMAP_LIMIT,
  });
}

/**
 * Where an old product slug now points.
 *
 * `product_redirects` exists so a slug change does not throw away the links and
 * the ranking the old URL earned (11.6, `DATABASE.md` section 5). Nothing wrote
 * to it before Phase 14 and nothing read it; the read is here, and the write
 * belongs to the admin catalogue management Phase 6 has not built — so the
 * table is correct and empty rather than wrong.
 *
 * Only a redirect that lands on a **publicly visible** product is returned. A
 * permanent redirect to a draft would be a permanent redirect to a 404, which
 * is worse than the 404 it replaced.
 */
export async function findProductRedirect(fromSlug: string): Promise<string | null> {
  const row = await prisma.productRedirect.findUnique({
    where: { fromSlug },
    select: {
      product: {
        select: { slug: true, status: true, deletedAt: true, publishedAt: true },
      },
    },
  });

  if (!row) return null;

  const target = row.product;
  const visible =
    target.status === 'ACTIVE' &&
    target.deletedAt === null &&
    target.publishedAt !== null &&
    target.publishedAt <= new Date();

  return visible ? target.slug : null;
}
