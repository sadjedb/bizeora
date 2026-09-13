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
  getProductPageData,
  getPublishedProductBySlug,
  listPublishedProducts,
  listRelatedProducts,
  publiclyVisibleWhere,
} = await import('../../src/server/repositories/catalogue-repository');

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
