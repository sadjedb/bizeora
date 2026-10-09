import 'server-only';

import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db/client';
import { toPublicAssetUrl } from '@/lib/media/public-asset';
import { isProductPurchasable, isVariantPurchasable } from '@/domain/order/availability';
import { resolveCompareAtPrice, resolveUnitPrice } from '@/domain/pricing';
import { DEFAULT_LOCALE } from '@/i18n/locales';
import { localise } from '@/domain/translation';
import {
  CATALOGUE_PER_PAGE,
  NO_CATALOGUE_QUERY,
  cataloguePageCount,
  searchTerms,
  type CatalogueQuery,
  type CatalogueSort,
} from '@/domain/catalogue/browse';

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
  translations: true,
  category: { select: { name: true, translations: true } },
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
  translations: unknown;
  basePrice: number;
  compareAtPrice: number | null;
  currency: string;
  stockPolicy: string;
  isCustomizable: boolean;
  isNewArrival: boolean;
  isBestSeller: boolean;
  category: { name: string; translations: unknown };
  images: ImageRow[];
  variants: { isActive: boolean; stockQuantity: number; reservedQuantity: number }[];
};

/**
 * A row, in the language it is being read in.
 *
 * The overlay is applied **here**, at the boundary where a database row becomes
 * a DTO, rather than in each page. Every storefront read passes through this
 * function or its detail equivalent, so a page cannot forget to translate: the
 * only `name` it can reach is already the right one.
 *
 * `localise` names the fields it may replace, so an overlay written into the
 * column cannot set a price or a status by being present.
 */
function toSummary(row: SummaryRow, locale: string): CatalogueProductSummary {
  const product = { basePrice: row.basePrice, compareAtPrice: row.compareAtPrice };
  const policy = row.stockPolicy as 'TRACK' | 'DONT_TRACK' | 'MADE_TO_ORDER';

  const translated = localise(row, row.translations, locale, ['name']);
  const category = localise(row.category, row.category.translations, locale, ['name']);

  return {
    slug: row.slug,
    name: translated.name,
    category: category.name,
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
  options: { limit?: number; locale?: string } = {},
): Promise<readonly CatalogueProductSummary[]> {
  const rows = await prisma.product.findMany({
    where: publiclyVisibleWhere(),
    select: SUMMARY_SELECT,
    // Matches the `(status, publishedAt desc)` index in DATABASE.md section 17.
    orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
    take: Math.min(options.limit ?? CATALOGUE_PAGE_SIZE, CATALOGUE_PAGE_SIZE),
  });

  const locale = options.locale ?? DEFAULT_LOCALE;
  return rows.map((row) => toSummary(row, locale));
}

/* ---------------------------------------------------------------------------
 * Browsing
 * ------------------------------------------------------------------------ */

export type CatalogueCategory = {
  slug: string;
  name: string;
  description: string | null;
  /** How many published products it holds, for the chip's trailing figure. */
  count: number;
};

export type CatalogueListing = {
  items: readonly CatalogueProductSummary[];
  /** Matching the filters, before the page was cut out of it. */
  total: number;
  /** In the whole catalogue, or the whole category, ignoring the filters. */
  totalUnfiltered: number;
  page: number;
  pageCount: number;
};

/**
 * The `where` behind `/shop` and `/shop/c/[category]`.
 *
 * Every clause is the database's work. That is not a preference: `available` is
 * computed from stock counts and could be filtered in JavaScript, and doing so
 * would mean fetching the catalogue to show twelve of it and paginating over a
 * total that does not match what the visitor can see.
 */
function catalogueWhere(
  query: CatalogueQuery,
  categoryId: string | null,
  locale: string,
): Prisma.ProductWhereInput {
  const clauses: Prisma.ProductWhereInput[] = [publiclyVisibleWhere()];

  if (categoryId) clauses.push({ categoryId });
  if (query.customisable) clauses.push({ isCustomizable: true });

  /*
   * "Somebody could buy this today", as SQL.
   *
   * The same rule as `isProductPurchasable` in `domain/order/availability`,
   * which is the authority: a product that does not track stock is always
   * available, and a tracked one needs an active variant holding more than it
   * has reserved. `prisma.productVariant.fields.reservedQuantity` is a column
   * reference rather than a value, so the comparison happens row by row in
   * Postgres instead of over a fetched list.
   */
  if (query.inStock) {
    clauses.push({
      OR: [
        { stockPolicy: { in: ['DONT_TRACK', 'MADE_TO_ORDER'] } },
        {
          variants: {
            some: {
              isActive: true,
              stockQuantity: { gt: prisma.productVariant.fields.reservedQuantity },
            },
          },
        },
      ],
    });
  }

  /*
   * Every word has to match something, though not the same something.
   *
   * "tote toile" finds "Tote bag en toile écrue"; a single `contains` of the
   * whole phrase would not. Each word is checked against the name, the subtitle
   * and the category, so a visitor can type either what the thing is called or
   * what kind of thing it is.
   *
   * `mode: 'insensitive'` is case only — Postgres ILIKE does not fold accents,
   * so "brode" will not find "brodé". Fixing that properly means the `unaccent`
   * extension and an expression index, which is a migration for a catalogue of
   * eight products; it is written here so the next person knows it is a known
   * limit rather than an oversight.
   */
  if (query.q) {
    /*
     * An English visitor searches in English.
     *
     * The French columns are still matched, because a product's English name is
     * often the French one and a half-translated catalogue must not become
     * unsearchable. The translated name is a JSON path match rather than an
     * indexed column — the trade recorded in the migration, and the reason the
     * overlay is a column rather than a table.
     */
    const translated = locale !== DEFAULT_LOCALE;

    for (const word of searchTerms(query.q)) {
      const alternatives: Prisma.ProductWhereInput[] = [
        { name: { contains: word, mode: 'insensitive' } },
        { subtitle: { contains: word, mode: 'insensitive' } },
        { category: { name: { contains: word, mode: 'insensitive' } } },
      ];

      if (translated) {
        alternatives.push({
          translations: {
            path: [locale, 'name'],
            string_contains: word,
            mode: 'insensitive',
          },
        });
      }

      clauses.push({ OR: alternatives });
    }
  }

  return { AND: clauses };
}

/**
 * The order, as the database understands it.
 *
 * Price sorts on `basePrice` rather than on the resolved unit price, and the
 * difference is real: a variant may override the price, so a product whose
 * large size costs more sorts by its base. Sorting by the resolved price would
 * mean computing it for every row in the catalogue before taking twelve, which
 * is the fetch-then-filter this module exists to avoid. The card shows the
 * resolved price, so the order is a close approximation rather than a lie — and
 * every sort ends on `id` so that a tie never reshuffles between pages.
 */
function catalogueOrderBy(sort: CatalogueSort): Prisma.ProductOrderByWithRelationInput[] {
  switch (sort) {
    case 'PRICE_ASC':
      return [{ basePrice: 'asc' }, { id: 'desc' }];
    case 'PRICE_DESC':
      return [{ basePrice: 'desc' }, { id: 'desc' }];
    case 'NAME':
      return [{ name: 'asc' }, { id: 'desc' }];
    case 'NEWEST':
      // Matches the `(status, publishedAt desc)` index in DATABASE.md 17.
      return [{ publishedAt: 'desc' }, { id: 'desc' }];
  }
}

/**
 * One page of the catalogue, filtered and counted.
 *
 * Three reads: the page, the total behind it, and the total without the filters
 * — the last is what lets the header say "8 pièces sur 24" rather than leaving a
 * visitor to wonder whether the shop is nearly empty or their filter is narrow.
 *
 * The page number is **clamped after counting**, not before: `?page=99` on a
 * two-page catalogue shows page 2 rather than an empty grid, because a page that
 * exists is a better answer than a correct emptiness.
 */
export async function listCatalogue(input: {
  query: CatalogueQuery;
  categoryId?: string | null;
  /** Which language the results are read in, and searched in. */
  locale?: string;
}): Promise<CatalogueListing> {
  const categoryId = input.categoryId ?? null;
  const locale = input.locale ?? DEFAULT_LOCALE;
  const where = catalogueWhere(input.query, categoryId, locale);

  const [total, totalUnfiltered] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.count({
      where: catalogueWhere(NO_CATALOGUE_QUERY, categoryId, locale),
    }),
  ]);

  const pageCount = cataloguePageCount(total);
  const page = Math.min(Math.max(input.query.page, 1), pageCount);

  const rows =
    total === 0
      ? []
      : await prisma.product.findMany({
          where,
          select: SUMMARY_SELECT,
          orderBy: catalogueOrderBy(input.query.sort),
          skip: (page - 1) * CATALOGUE_PER_PAGE,
          take: CATALOGUE_PER_PAGE,
        });

  return {
    items: rows.map((row) => toSummary(row, locale)),
    total,
    totalUnfiltered,
    page,
    pageCount,
  };
}

/**
 * The categories worth offering as chips.
 *
 * **Only the ones with something in them.** A chip that leads to an empty
 * listing is a dead end the visitor has to discover by clicking, and the count
 * beside it is what makes the choice informed rather than a guess. The count is
 * filtered by the same visibility predicate as the listing itself, so a category
 * holding nothing but drafts does not appear at all.
 */
export async function listCatalogueCategories(
  locale: string = DEFAULT_LOCALE,
): Promise<readonly CatalogueCategory[]> {
  const rows = await prisma.category.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      products: { some: publiclyVisibleWhere() },
    },
    select: {
      slug: true,
      name: true,
      description: true,
      translations: true,
      _count: { select: { products: { where: publiclyVisibleWhere() } } },
    },
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
  });

  return rows.map((row) => {
    const text = localise(row, row.translations, locale, ['name', 'description']);

    return {
      slug: row.slug,
      name: text.name,
      description: text.description,
      count: row._count.products,
    };
  });
}

export type CatalogueCategoryPage = CatalogueCategory & {
  id: string;
  seoTitle: string | null;
  seoDescription: string | null;
};

/**
 * A category by its slug, for `/shop/c/[category]`.
 *
 * Returns the id as well, because the listing query needs it and looking it up
 * twice would be two round trips for one page. An inactive or deleted category
 * is `null`: that route 404s rather than showing an empty catalogue under a
 * heading nobody can reach any more.
 */
export async function getCatalogueCategoryBySlug(
  slug: string,
  locale: string = DEFAULT_LOCALE,
): Promise<CatalogueCategoryPage | null> {
  const row = await prisma.category.findFirst({
    where: { slug, isActive: true, deletedAt: null },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      seoTitle: true,
      seoDescription: true,
      translations: true,
      _count: { select: { products: { where: publiclyVisibleWhere() } } },
    },
  });

  if (!row) return null;

  const text = localise(row, row.translations, locale, [
    'name',
    'description',
    'seoTitle',
    'seoDescription',
  ]);

  return {
    id: row.id,
    slug: row.slug,
    name: text.name,
    description: text.description,
    seoTitle: text.seoTitle,
    seoDescription: text.seoDescription,
    count: row._count.products,
  };
}

export async function getPublishedProductBySlug(
  slug: string,
  locale: string = DEFAULT_LOCALE,
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

  /*
   * Every translatable field of the product, in one overlay.
   *
   * The summary mapper only localises what a card shows; a detail page shows
   * the description, the care instructions and the SEO copy as well, so the
   * overlay is applied again over the wider set. `localise` replaces only the
   * fields named and only when the overlay has them, so applying it twice is
   * idempotent rather than duplicated work.
   */
  const text = localise(row, row.translations, locale, [
    'subtitle',
    'description',
    'material',
    'careInstructions',
    'embroideryDetails',
    'seoTitle',
    'seoDescription',
  ]);

  const details = [
    text.material ? { term: 'Matière', value: text.material } : null,
    text.careInstructions ? { term: 'Entretien', value: text.careInstructions } : null,
  ].filter((detail): detail is { term: string; value: string } => detail !== null);

  return {
    ...toSummary(row, locale),
    subtitle: text.subtitle,
    description: text.description,
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
    embroideryDetails: text.embroideryDetails,
    seoTitle: text.seoTitle,
    seoDescription: text.seoDescription,
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
  locale: string = DEFAULT_LOCALE,
): Promise<readonly CatalogueProductSummary[]> {
  const rows = await prisma.product.findMany({
    // Uses the `(categoryId, status)` index from DATABASE.md section 17.
    where: { categoryId, slug: { not: excludeSlug }, ...publiclyVisibleWhere() },
    select: SUMMARY_SELECT,
    orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
    take: limit,
  });

  return rows.map((row) => toSummary(row, locale));
}

/**
 * A product page needs its own record and its neighbours. Issuing both in one
 * round trip keeps the page at two queries rather than two sequential waits,
 * and returns `null` without a second query when the slug is unknown.
 */
export async function getProductPageData(
  slug: string,
  locale: string = DEFAULT_LOCALE,
): Promise<{
  product: CatalogueProductDetail;
  related: readonly CatalogueProductSummary[];
  /** The garment's 3D model, when it has one. */
  model: CatalogueModel | null;
} | null> {
  const row = await prisma.product.findFirst({
    where: { slug, ...publiclyVisibleWhere() },
    select: { id: true, categoryId: true },
  });

  if (!row) return null;

  const [product, related, model] = await Promise.all([
    getPublishedProductBySlug(slug, locale),
    listRelatedProducts(row.categoryId, slug, 4, locale),
    getProductModel(row.id),
  ]);

  if (!product) return null;
  return { product, related, model };
}

/* ---------------------------------------------------------------------------
 * Models
 * ------------------------------------------------------------------------ */

export type CatalogueModel = {
  /** The `.glb`, as a URL a browser can fetch. Null while storage is unset. */
  src: string | null;
  /** Which of the model's materials the design is composited into. */
  materialName: string;
  /** How wide the garment is across that material's texture, in millimetres. */
  surfaceWidthMm: number | null;
  /** A still, so a card never boots a 3D engine to show something. */
  poster: string | null;
  label: string | null;
};

/**
 * The model a product is shown in, if it has one.
 *
 * **One, not a list.** The schema allows a model per variant and one for the
 * product, which is the right shape for a shop that eventually photographs
 * every colourway; what the builder needs today is "the model to turn", and
 * offering three of them is a decision nobody has asked to make. The
 * product-wide model wins over a variant's, because it is the one that is
 * certain to exist.
 *
 * Inactive models are excluded in the query — a model taken out of service is
 * usually one that renders wrong, and the failure of fetching it and hiding it
 * afterwards is a customer who briefly sees it.
 */
export async function getProductModel(productId: string): Promise<CatalogueModel | null> {
  const row = await prisma.productModel3d.findFirst({
    where: { productId, isActive: true },
    // A product-wide model first (`variantId` null sorts first ascending),
    // then the oldest, so the answer does not move between requests.
    orderBy: [{ variantId: 'asc' }, { createdAt: 'asc' }],
    select: {
      storageKey: true,
      materialName: true,
      surfaceWidthMm: true,
      posterKey: true,
      label: true,
    },
  });

  if (!row) return null;

  return {
    src: toPublicAssetUrl(row.storageKey),
    materialName: row.materialName,
    surfaceWidthMm: row.surfaceWidthMm,
    poster: toPublicAssetUrl(row.posterKey),
    label: row.label,
  };
}

/** The same, by slug, for a page that has one rather than an id. */
export async function getProductModelBySlug(
  slug: string,
): Promise<CatalogueModel | null> {
  const product = await prisma.product.findFirst({
    where: { slug, ...publiclyVisibleWhere() },
    select: { id: true },
  });

  return product ? getProductModel(product.id) : null;
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
