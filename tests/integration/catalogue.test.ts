/**
 * The catalogue read path, against the real database.
 *
 * The unit tests prove the rules; these prove the *queries* — that visibility
 * is applied by PostgreSQL rather than by JavaScript, that the DTOs carry what
 * the storefront needs and nothing more, and that a draft product cannot reach
 * a public page. That last one is the reason this file exists: a visibility
 * predicate is easy to write, easy to get subtly wrong, and the failure is
 * silent until a customer sees an unpublished product.
 *
 * Runs against the seeded development catalogue.
 */

import dotenv from 'dotenv';
import { afterAll, describe, expect, it } from 'vitest';

dotenv.config({ path: ['.env.local', '.env'], quiet: true });

const {
  CATALOGUE_PAGE_SIZE,
  getCatalogueCategoryBySlug,
  getProductPageData,
  getPublishedProductBySlug,
  listCatalogue,
  listCatalogueCategories,
  listPublishedProducts,
  listRelatedProducts,
  publiclyVisibleWhere,
} = await import('../../src/server/repositories/catalogue-repository');

const { CATALOGUE_PER_PAGE, NO_CATALOGUE_QUERY } =
  await import('../../src/domain/catalogue/browse');

const { prisma } = await import('../../src/lib/db/client');

/** Seeded by `prisma/seed.ts` specifically so this file can assert on it. */
const DRAFT_SLUG = 'echantillon-interne-non-publie';
const PUBLISHED_SLUG = 't-shirt-brode-classique';
/** Every variant out of stock: visible, not purchasable (rules 11.2, 11.3). */
const SOLD_OUT_SLUG = 'bonnet-cotele-brode';
/** MADE_TO_ORDER: always available whatever the counts say (rule 10.2). */
const MADE_TO_ORDER_SLUG = 'tote-bag-toile-epaisse';

afterAll(async () => {
  await prisma.$disconnect();
});

/** Every property name anywhere in a DTO, however deeply nested. */
function keysOf(value: unknown, found: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) keysOf(entry, found);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      found.add(key);
      keysOf(nested, found);
    }
  }
  return found;
}

describe('visibility', () => {
  it('requires ACTIVE, published in the past, and not soft-deleted', () => {
    const where = publiclyVisibleWhere(new Date('2026-06-01T00:00:00.000Z'));

    // Asserted as a predicate rather than inferred from results, so a clause
    // cannot be dropped without this failing.
    expect(where.status).toBe('ACTIVE');
    expect(where.deletedAt).toBeNull();
    expect(where.publishedAt).toEqual({
      not: null,
      lte: new Date('2026-06-01T00:00:00.000Z'),
    });
  });

  it('never lists a draft product', async () => {
    const products = await listPublishedProducts();

    expect(products.length).toBeGreaterThan(0);
    expect(products.some((product) => product.slug === DRAFT_SLUG)).toBe(false);
  });

  it('does not resolve a draft product by slug', async () => {
    // The row exists; the public query must not return it.
    const row = await prisma.product.findFirst({ where: { slug: DRAFT_SLUG } });
    expect(row).not.toBeNull();
    expect(row?.status).toBe('DRAFT');

    expect(await getPublishedProductBySlug(DRAFT_SLUG)).toBeNull();
    expect(await getProductPageData(DRAFT_SLUG)).toBeNull();
  });

  it('returns null for a slug that does not exist', async () => {
    expect(await getPublishedProductBySlug('cette-piece-n-existe-pas')).toBeNull();
    expect(await getProductPageData('cette-piece-n-existe-pas')).toBeNull();
  });

  it('would exclude a product published in the future', async () => {
    // Proven against the predicate rather than by mutating seeded data, so the
    // test leaves the database as it found it.
    const past = publiclyVisibleWhere(new Date('2025-01-01T00:00:00.000Z'));
    const visibleInThePast = await prisma.product.count({ where: past });
    const visibleNow = await prisma.product.count({ where: publiclyVisibleWhere() });

    expect(visibleInThePast).toBe(0);
    expect(visibleNow).toBeGreaterThan(0);
  });
});

describe('listing', () => {
  it('returns storefront DTOs, not Prisma models', async () => {
    const [product] = await listPublishedProducts();
    expect(product).toBeDefined();

    expect(Object.keys(product!).sort()).toEqual([
      'available',
      'badge',
      'category',
      'compareAtPrice',
      'currency',
      'image',
      'isCustomizable',
      'name',
      'price',
      'slug',
    ]);

    // Operational and internal columns must not be on the wire — checked
    // over the serialised *keys* rather than the raw text, because a substring
    // search for "id" also matches "width".
    for (const leak of [
      'id',
      'status',
      'deletedAt',
      'stockQuantity',
      'reservedQuantity',
    ]) {
      expect(keysOf(product), `leaked ${leak}`).not.toContain(leak);
    }
  });

  it('prices in integer minor units', async () => {
    for (const product of await listPublishedProducts()) {
      expect(Number.isInteger(product.price)).toBe(true);
      expect(product.currency).toBe('DZD');
      if (product.compareAtPrice !== null) {
        expect(product.compareAtPrice).toBeGreaterThan(product.price);
      }
    }
  });

  it('carries at most one image, with its alt text', async () => {
    const products = await listPublishedProducts();
    const withImage = products.find((product) => product.image !== null);

    expect(withImage).toBeDefined();
    expect(withImage!.image!.alt.length).toBeGreaterThan(0);

    /*
     * The key resolves through `lib/media` against the configured public asset
     * origin — a path in this project, `/assets`, rather than a CDN. What
     * matters is that the repository never invents a URL of its own: whatever
     * comes back is built from the stored key.
     *
     * Compared against **that product's own row** rather than against the
     * seed's `products/<slug>/1.jpg` convention. Other suites create products
     * and upload photographs into `media/`, and whichever of them sorts first
     * here is none of this test's business — the claim is about the mapping,
     * not about a filename.
     */
    const stored = await prisma.productImage.findFirstOrThrow({
      where: { product: { slug: withImage!.slug } },
      orderBy: [{ isPrimary: 'desc' }, { position: 'asc' }],
      select: { storageKey: true },
    });

    expect(withImage!.image!.src).toBe(`/assets/${stored.storageKey}`);
  });

  it('is bounded, so it cannot degrade into a full table scan', async () => {
    const products = await listPublishedProducts({ limit: 1000 });
    expect(products.length).toBeLessThanOrEqual(CATALOGUE_PAGE_SIZE);

    const limited = await listPublishedProducts({ limit: 2 });
    expect(limited).toHaveLength(2);
  });
});

describe('availability', () => {
  it('marks a product with every variant out of stock as unavailable', async () => {
    const product = await getPublishedProductBySlug(SOLD_OUT_SLUG);

    // Visible but not purchasable — rule 11.3. It must still resolve.
    expect(product).not.toBeNull();
    expect(product!.available).toBe(false);
    expect(product!.variants.every((variant) => !variant.available)).toBe(true);
  });

  it('treats a made-to-order product as available with no stock', async () => {
    const product = await getPublishedProductBySlug(MADE_TO_ORDER_SLUG);

    expect(product!.available).toBe(true);
    expect(product!.variants.every((variant) => variant.available)).toBe(true);
  });

  it('marks the one seeded out-of-stock combination and no other', async () => {
    const product = await getPublishedProductBySlug(PUBLISHED_SLUG);
    const unavailable = product!.variants.filter((variant) => !variant.available);

    expect(unavailable).toHaveLength(1);
    expect(unavailable[0]!.options).toEqual({ Taille: 'S', Couleur: 'Écru' });
    // The product is still purchasable overall.
    expect(product!.available).toBe(true);
  });
});

describe('detail', () => {
  it('maps options, values and variants', async () => {
    const product = await getPublishedProductBySlug(PUBLISHED_SLUG);
    expect(product).not.toBeNull();

    expect(product!.options.map((option) => option.name)).toEqual(['Taille', 'Couleur']);

    const colour = product!.options.find((option) => option.name === 'Couleur');
    expect(colour!.values.every((value) => value.hexColor !== null)).toBe(true);

    // Every variant names its axes, which is what the panel matches on.
    expect(product!.variants.length).toBeGreaterThan(0);
    for (const variant of product!.variants) {
      expect(Object.keys(variant.options).sort()).toEqual(['Couleur', 'Taille']);
      expect(variant.sku.length).toBeGreaterThan(0);
      expect(Number.isInteger(variant.price)).toBe(true);
    }
  });

  it('orders images with the primary first', async () => {
    const product = await getPublishedProductBySlug(PUBLISHED_SLUG);

    expect(product!.images.length).toBeGreaterThan(1);
    expect(product!.images[0]!.alt).toContain('vue de face');
  });

  it('builds detail rows only from the columns that carry them', async () => {
    const product = await getPublishedProductBySlug(PUBLISHED_SLUG);

    expect(product!.details.map((detail) => detail.term)).toEqual([
      'Matière',
      'Entretien',
    ]);
    expect(product!.embroideryDetails).toBeTruthy();
  });

  it('does not leak stock counts or internal ids onto the detail DTO', async () => {
    // The deepest DTO in the system: product, images, options, values and
    // variants all in one payload, every one of which is serialised into the
    // page and handed to a client component.
    const keys = keysOf(await getPublishedProductBySlug(PUBLISHED_SLUG));

    for (const leak of [
      'id',
      'productId',
      'variantId',
      'optionId',
      'categoryId',
      'status',
      'deletedAt',
      'stockQuantity',
      'reservedQuantity',
      'lowStockThreshold',
      'storageKey',
      'priceOverride',
    ]) {
      expect(keys, `leaked ${leak}`).not.toContain(leak);
    }
  });
});

describe('related products', () => {
  it('returns other published products from the same category', async () => {
    const product = await prisma.product.findFirstOrThrow({
      where: { slug: PUBLISHED_SLUG },
      select: { categoryId: true },
    });

    const related = await listRelatedProducts(product.categoryId, PUBLISHED_SLUG);

    expect(related.every((candidate) => candidate.slug !== PUBLISHED_SLUG)).toBe(true);
    // The draft lives in the same category on purpose: it must not surface
    // here either.
    expect(related.every((candidate) => candidate.slug !== DRAFT_SLUG)).toBe(true);
  });

  it('is bounded rather than loading the category', async () => {
    const accessories = await prisma.category.findFirstOrThrow({
      where: { slug: 'accessoires' },
      select: { id: true },
    });

    const related = await listRelatedProducts(accessories.id, 'casquette-brodee', 2);
    expect(related.length).toBeLessThanOrEqual(2);
  });

  it('is empty rather than wrong when a category has one product', async () => {
    const polos = await prisma.category.findFirstOrThrow({
      where: { slug: 'polos' },
      select: { id: true },
    });

    // The page drops the section instead of padding it with unrelated pieces.
    expect(await listRelatedProducts(polos.id, 'polo-pique-brode')).toHaveLength(0);
  });
});

/* ---------------------------------------------------------------------------
 * Browsing — Phase 14.13
 * ------------------------------------------------------------------------ */

describe('browsing the catalogue', () => {
  /*
   * These assert the *queries*, which is the half the unit tests cannot reach.
   * Every filter here could be written in JavaScript over a fetched list, and
   * every one of them would then paginate over a total that does not match what
   * the visitor can see. So each case checks two things: the right products came
   * back, and the count agrees with them.
   */

  it('lists a page, and counts what is behind it', async () => {
    const listing = await listCatalogue({ query: NO_CATALOGUE_QUERY });

    expect(listing.items.length).toBeGreaterThan(0);
    expect(listing.items.length).toBeLessThanOrEqual(CATALOGUE_PER_PAGE);
    expect(listing.total).toBe(listing.totalUnfiltered);
    expect(listing.page).toBe(1);
  });

  it('never lists a draft, however it is searched for', async () => {
    const listing = await listCatalogue({
      query: { ...NO_CATALOGUE_QUERY, q: 'échantillon' },
    });

    expect(listing.items.map((item) => item.slug)).not.toContain(DRAFT_SLUG);
    expect(listing.total).toBe(0);
  });

  it('searches the name, and each word narrows', async () => {
    const one = await listCatalogue({ query: { ...NO_CATALOGUE_QUERY, q: 'tote' } });
    expect(one.items.map((item) => item.slug)).toContain(MADE_TO_ORDER_SLUG);

    // Adding a word that matches nothing on that product removes it, rather
    // than being ignored the way a single `LIKE` of the phrase would be.
    const two = await listCatalogue({
      query: { ...NO_CATALOGUE_QUERY, q: 'tote casquette' },
    });
    expect(two.total).toBe(0);
  });

  it('is case-insensitive', async () => {
    const lower = await listCatalogue({ query: { ...NO_CATALOGUE_QUERY, q: 'tote' } });
    const upper = await listCatalogue({ query: { ...NO_CATALOGUE_QUERY, q: 'TOTE' } });

    expect(upper.total).toBe(lower.total);
    expect(upper.total).toBeGreaterThan(0);
  });

  it('reports the unfiltered total beside the filtered one', async () => {
    const filtered = await listCatalogue({
      query: { ...NO_CATALOGUE_QUERY, q: 'tote' },
    });

    expect(filtered.total).toBeLessThan(filtered.totalUnfiltered);
    expect(filtered.totalUnfiltered).toBe(
      (await listCatalogue({ query: NO_CATALOGUE_QUERY })).total,
    );
  });

  it('filters to what accepts embroidery', async () => {
    const listing = await listCatalogue({
      query: { ...NO_CATALOGUE_QUERY, customisable: true },
    });

    expect(listing.items.length).toBeGreaterThan(0);
    for (const item of listing.items) expect(item.isCustomizable).toBe(true);
  });

  /*
   * The stock filter is the one that had to be SQL. `available` is derived from
   * counts and a policy, and the assertion that matters is that the rows the
   * database returned agree with the domain predicate the card renders from.
   */
  it('filters to what can be bought, and agrees with the card', async () => {
    const listing = await listCatalogue({
      query: { ...NO_CATALOGUE_QUERY, inStock: true },
    });

    expect(listing.items.length).toBeGreaterThan(0);
    for (const item of listing.items) expect(item.available).toBe(true);

    // The sold-out product is visible in the catalogue and absent from this one.
    const all = await listCatalogue({ query: NO_CATALOGUE_QUERY });
    expect(all.items.map((item) => item.slug)).toContain(SOLD_OUT_SLUG);
    expect(listing.items.map((item) => item.slug)).not.toContain(SOLD_OUT_SLUG);
  });

  it('orders by price in both directions', async () => {
    const ascending = await listCatalogue({
      query: { ...NO_CATALOGUE_QUERY, sort: 'PRICE_ASC' },
    });
    const descending = await listCatalogue({
      query: { ...NO_CATALOGUE_QUERY, sort: 'PRICE_DESC' },
    });

    const first = ascending.items[0];
    const last = descending.items[0];
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    expect(first!.price).toBeLessThanOrEqual(last!.price);
  });

  it('orders by name', async () => {
    const listing = await listCatalogue({
      query: { ...NO_CATALOGUE_QUERY, sort: 'NAME' },
    });

    const names = listing.items.map((item) => item.name);
    expect([...names].sort((a, b) => a.localeCompare(b, 'fr'))).toEqual(names);
  });

  /*
   * A page beyond the end is a mistyped URL, not an error. Showing the last
   * page is a better answer than a correct emptiness.
   */
  it('clamps a page number past the end', async () => {
    const listing = await listCatalogue({
      query: { ...NO_CATALOGUE_QUERY, page: 99 },
    });

    expect(listing.page).toBe(listing.pageCount);
    expect(listing.items.length).toBeGreaterThan(0);
  });

  it('returns an empty page without pretending it is page zero', async () => {
    const listing = await listCatalogue({
      query: { ...NO_CATALOGUE_QUERY, q: 'zzzzzzzz' },
    });

    expect(listing.items).toEqual([]);
    expect(listing.total).toBe(0);
    expect(listing.page).toBe(1);
    expect(listing.pageCount).toBe(1);
  });
});

describe('categories', () => {
  it('offers only categories with something published in them', async () => {
    const categories = await listCatalogueCategories();

    expect(categories.length).toBeGreaterThan(0);
    for (const category of categories) expect(category.count).toBeGreaterThan(0);
  });

  it('counts each category as the listing does', async () => {
    const categories = await listCatalogueCategories();

    for (const category of categories) {
      const resolved = await getCatalogueCategoryBySlug(category.slug);
      expect(resolved).not.toBeNull();

      const listing = await listCatalogue({
        query: NO_CATALOGUE_QUERY,
        categoryId: resolved!.id,
      });

      expect(listing.total).toBe(category.count);
    }
  });

  it('scopes a listing to its category', async () => {
    const categories = await listCatalogueCategories();
    const first = categories[0];
    expect(first).toBeDefined();

    const resolved = await getCatalogueCategoryBySlug(first!.slug);
    const listing = await listCatalogue({
      query: NO_CATALOGUE_QUERY,
      categoryId: resolved!.id,
    });

    expect(listing.total).toBeLessThanOrEqual(listing.totalUnfiltered);
    for (const item of listing.items) expect(item.category).toBe(first!.name);
  });

  it('does not resolve a slug that is not a category', async () => {
    expect(await getCatalogueCategoryBySlug('pas-une-categorie')).toBeNull();
  });
});

describe('the catalogue in English', () => {
  /*
   * The seed translates some products fully, some by name only, and leaves the
   * draft alone — so these run against the same partial state a real catalogue
   * is in while it is being translated, rather than against a fixture where
   * every row happens to be complete.
   */

  it('reads a translated product in English and in French', async () => {
    const french = await getPublishedProductBySlug(PUBLISHED_SLUG, 'fr');
    const english = await getPublishedProductBySlug(PUBLISHED_SLUG, 'en');

    expect(french?.name).toBe('T-shirt brodé classique');
    expect(english?.name).toBe('Classic embroidered t-shirt');
    expect(english?.description).not.toBe(french?.description);
  });

  it('falls back to French field by field, not row by row', async () => {
    // Seeded with an English name and nothing else.
    const english = await getPublishedProductBySlug(SOLD_OUT_SLUG, 'en');
    const french = await getPublishedProductBySlug(SOLD_OUT_SLUG, 'fr');

    expect(english?.name).not.toBe(french?.name);
    expect(english?.description).toBe(french?.description);
  });

  it('defaults to French when no language is asked for', async () => {
    const implicit = await getPublishedProductBySlug(PUBLISHED_SLUG);
    const french = await getPublishedProductBySlug(PUBLISHED_SLUG, 'fr');

    expect(implicit?.name).toBe(french?.name);
  });

  it('translates the card in a listing, and its category', async () => {
    const listing = await listCatalogue({ query: NO_CATALOGUE_QUERY, locale: 'en' });
    const card = listing.items.find((item) => item.slug === PUBLISHED_SLUG);

    expect(card?.name).toBe('Classic embroidered t-shirt');
    expect(card?.category).toBe('T-shirts');
  });

  it('translates the category chips', async () => {
    const french = await listCatalogueCategories('fr');
    const english = await listCatalogueCategories('en');

    expect(french.map((category) => category.name)).toContain('Accessoires');
    expect(english.map((category) => category.name)).toContain('Accessories');
    expect(english).toHaveLength(french.length);
  });

  it('translates a category page', async () => {
    const english = await getCatalogueCategoryBySlug('accessoires', 'en');

    expect(english?.name).toBe('Accessories');
    expect(english?.slug).toBe('accessoires');
  });

  /*
   * An English visitor types English. The French columns stay searchable too,
   * because a half-translated catalogue must not become half-unsearchable.
   */
  it('searches the English name when reading in English', async () => {
    const found = await listCatalogue({
      query: { ...NO_CATALOGUE_QUERY, q: 'hooded' },
      locale: 'en',
    });

    expect(found.total).toBe(1);
    expect(found.items[0]?.name).toBe('Embroidered hooded sweatshirt');
  });

  it('still finds a product by its French name in English', async () => {
    const found = await listCatalogue({
      query: { ...NO_CATALOGUE_QUERY, q: 'capuche' },
      locale: 'en',
    });

    expect(found.total).toBe(1);
  });

  it('does not search the English name when reading in French', async () => {
    const found = await listCatalogue({
      query: { ...NO_CATALOGUE_QUERY, q: 'hooded' },
      locale: 'fr',
    });

    expect(found.total).toBe(0);
  });

  /*
   * Translation changes what a row *says*, never which rows there are. A draft
   * with an overlay would still be a draft.
   */
  it('returns the same set of products in both languages', async () => {
    const french = await listCatalogue({ query: NO_CATALOGUE_QUERY, locale: 'fr' });
    const english = await listCatalogue({ query: NO_CATALOGUE_QUERY, locale: 'en' });

    expect(english.total).toBe(french.total);
    expect(english.items.map((item) => item.slug)).toEqual(
      french.items.map((item) => item.slug),
    );
  });
});
