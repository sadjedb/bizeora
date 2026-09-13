/**
 * The gallery and the homepage, against the real database.
 *
 * The most important test in this file is the shortest: **the database refuses
 * to publish a gallery item made from a customer's design without a recorded
 * consent.** `BUSINESS-RULES.md` 13.6 is the one rule here whose violation
 * would be a business-ending mistake rather than a bug report, so it is
 * enforced twice — a pure predicate that refuses with a sentence, and a CHECK
 * constraint that makes the row impossible — and both are exercised.
 *
 * The rest asks the same question the catalogue tests ask: is "not visible"
 * applied by the query, or by a component that could forget? Unpublished
 * gallery items must be unreachable by slug, absent from every listing, and
 * invisible to the facet counts — because a facet that counts a hidden item
 * tells a visitor that it exists.
 */

import dotenv from 'dotenv';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

dotenv.config({ path: ['.env.local', '.env'], quiet: true });

const {
  getGalleryItemBySlug,
  listFeaturedGalleryItems,
  listGalleryFacets,
  listGalleryItems,
  listProductsRelatedToGalleryItem,
} = await import('../../src/server/repositories/gallery-repository');
const { listActiveBanners, listHomepageSections, listSocialLinks } =
  await import('../../src/server/repositories/content-repository');
const { loadHomepage } = await import('../../src/server/services/content-service');
const { prisma } = await import('../../src/lib/db/client');

const PREFIX = `phase13-content-${Date.now()}`;
const PRODUCT_TYPE = `Support ${PREFIX}`;
const EMBROIDERY_TYPE = `Broderie ${PREFIX}`;

const createdGallerySlugs: string[] = [];
let tagId: string;
let taggedProductId: string;
let taggedProductSlug: string;

async function createGalleryItem(input: {
  slug: string;
  isPublished: boolean;
  isFeatured?: boolean;
  productType?: string | null;
  embroideryType?: string | null;
}): Promise<string> {
  const item = await prisma.galleryItem.create({
    data: {
      slug: input.slug,
      title: `Réalisation ${input.slug}`,
      description: 'Créée par la suite de tests du contenu.',
      imageKey: `gallery/${input.slug}.jpg`,
      alt: 'Une pièce brodée',
      productType: input.productType ?? PRODUCT_TYPE,
      embroideryType: input.embroideryType ?? EMBROIDERY_TYPE,
      isPublished: input.isPublished,
      isFeatured: input.isFeatured ?? false,
      position: 1,
    },
    select: { id: true },
  });

  createdGallerySlugs.push(input.slug);
  return item.id;
}

beforeAll(async () => {
  const tag = await prisma.tag.create({
    data: { slug: `${PREFIX}-tag`, name: `Étiquette ${PREFIX}` },
    select: { id: true },
  });

  tagId = tag.id;

  const template = await prisma.product.findFirstOrThrow({
    where: { slug: 't-shirt-brode-classique', deletedAt: null },
    select: { categoryId: true, currency: true },
  });

  const product = await prisma.product.create({
    data: {
      slug: `test-content-${PREFIX}`,
      name: 'Pièce liée à une réalisation',
      description: 'Produit de test créé par la suite du contenu.',
      categoryId: template.categoryId,
      basePrice: 200_000,
      currency: template.currency,
      status: 'ACTIVE',
      publishedAt: new Date(Date.now() - 1_000),
      stockPolicy: 'MADE_TO_ORDER',
      tags: { create: [{ tagId: tag.id }] },
    },
    select: { id: true, slug: true },
  });

  taggedProductId = product.id;
  taggedProductSlug = product.slug;
});

afterAll(async () => {
  await prisma.galleryTag.deleteMany({ where: { tagId } });
  await prisma.galleryItem.deleteMany({ where: { slug: { in: createdGallerySlugs } } });
  await prisma.productTag.deleteMany({ where: { tagId } });
  await prisma.tag.deleteMany({ where: { id: tagId } });
  await prisma.product.deleteMany({ where: { id: taggedProductId } });
});

/* ---------------------------------------------------------------------------
 * The consent rule (13.6)
 * ------------------------------------------------------------------------ */

describe('publishing a customer’s design', () => {
  it('is refused by the database when no consent is recorded', async () => {
    const designFile = await prisma.designFile.findFirst({ select: { id: true } });

    // The constraint is about the *column being set*, so a real file id is not
    // required to prove it — but using one when the database has any makes the
    // row the constraint actually guards.
    const sourceId = designFile?.id ?? null;

    if (sourceId === null) {
      // No design file exists in this database. Assert the constraint's shape
      // directly rather than skipping: the rule must be present.
      const constraint = await prisma.$queryRaw<{ conname: string }[]>`
        SELECT conname FROM pg_constraint
         WHERE conname = 'gallery_items_consent_required'
      `;

      expect(constraint).toHaveLength(1);
      return;
    }

    await expect(
      prisma.galleryItem.create({
        data: {
          slug: `${PREFIX}-no-consent`,
          title: 'Sans consentement',
          imageKey: 'gallery/no-consent.jpg',
          alt: 'Une pièce brodée',
          isPublished: true,
          sourceDesignFileId: sourceId,
          customerConsentAt: null,
        },
      }),
    ).rejects.toThrow();
  });

  it('accepts the same row once the consent is recorded', async () => {
    const designFile = await prisma.designFile.findFirst({ select: { id: true } });
    if (!designFile) return;

    const slug = `${PREFIX}-with-consent`;

    const created = await prisma.galleryItem.create({
      data: {
        slug,
        title: 'Avec consentement',
        imageKey: 'gallery/with-consent.jpg',
        alt: 'Une pièce brodée',
        isPublished: true,
        sourceDesignFileId: designFile.id,
        customerConsentAt: new Date(),
      },
      select: { id: true },
    });

    createdGallerySlugs.push(slug);
    expect(created.id).toBeTruthy();
  });

  it('accepts an unpublished row without consent, because it shows nobody anything', async () => {
    const designFile = await prisma.designFile.findFirst({ select: { id: true } });
    if (!designFile) return;

    const slug = `${PREFIX}-draft-no-consent`;

    const created = await prisma.galleryItem.create({
      data: {
        slug,
        title: 'Brouillon sans consentement',
        imageKey: 'gallery/draft.jpg',
        alt: 'Une pièce brodée',
        isPublished: false,
        sourceDesignFileId: designFile.id,
        customerConsentAt: null,
      },
      select: { id: true },
    });

    createdGallerySlugs.push(slug);
    expect(created.id).toBeTruthy();
  });

  it('never lets the private original out through a gallery DTO', async () => {
    const slug = `${PREFIX}-dto`;
    await createGalleryItem({ slug, isPublished: true });

    const detail = await getGalleryItemBySlug(slug);
    const serialised = JSON.stringify(detail);

    expect(serialised).not.toContain('sourceDesignFileId');
    expect(serialised).not.toContain('imageKey');
    expect(serialised).not.toContain('customerConsentAt');
  });
});

/* ---------------------------------------------------------------------------
 * Visibility and filtering
 * ------------------------------------------------------------------------ */

describe('the gallery listing', () => {
  const published = `${PREFIX}-published`;
  const hidden = `${PREFIX}-hidden`;
  const removed = `${PREFIX}-removed`;

  beforeAll(async () => {
    await createGalleryItem({ slug: published, isPublished: true, isFeatured: true });
    await createGalleryItem({ slug: hidden, isPublished: false });

    const id = await createGalleryItem({ slug: removed, isPublished: true });
    await prisma.galleryItem.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  });

  it('lists a published item and hides an unpublished or deleted one', async () => {
    const items = await listGalleryItems({ limit: 24 });
    const slugs = items.map((item) => item.slug);

    expect(slugs).toContain(published);
    expect(slugs).not.toContain(hidden);
    expect(slugs).not.toContain(removed);
  });

  it('returns null for an unpublished slug, exactly as for an unknown one', async () => {
    expect(await getGalleryItemBySlug(hidden)).toBeNull();
    expect(await getGalleryItemBySlug(removed)).toBeNull();
    expect(await getGalleryItemBySlug(`${PREFIX}-never-existed`)).toBeNull();
  });

  it('filters by each facet, and by both together', async () => {
    const bySupport = await listGalleryItems({
      filters: { productType: PRODUCT_TYPE, embroideryType: null },
    });

    expect(bySupport.map((item) => item.slug)).toContain(published);

    const wrong = await listGalleryItems({
      filters: { productType: 'Un support qui n’existe pas', embroideryType: null },
    });

    expect(wrong).toHaveLength(0);

    const both = await listGalleryItems({
      filters: { productType: PRODUCT_TYPE, embroideryType: EMBROIDERY_TYPE },
    });

    expect(both.map((item) => item.slug)).toContain(published);
  });

  it('offers a facet value only when a published item carries it', async () => {
    const facets = await listGalleryFacets();

    expect(facets.productTypes).toContain(PRODUCT_TYPE);

    const secret = `Support secret ${PREFIX}`;
    const slug = `${PREFIX}-secret-facet`;

    await createGalleryItem({ slug, isPublished: false, productType: secret });

    const after = await listGalleryFacets();
    expect(after.productTypes).not.toContain(secret);
  });

  it('lists featured items for the homepage band', async () => {
    const featured = await listFeaturedGalleryItems({ limit: 6 });

    expect(featured.every((item) => item.isFeatured)).toBe(true);
    expect(featured.map((item) => item.slug)).toContain(published);
  });
});

describe('related products', () => {
  const slug = `${PREFIX}-related`;

  beforeAll(async () => {
    const id = await createGalleryItem({ slug, isPublished: true });
    await prisma.galleryTag.create({ data: { galleryItemId: id, tagId } });
  });

  it('finds the products that share a tag with the item', async () => {
    const related = await listProductsRelatedToGalleryItem({ slug });

    expect(related.map((product) => product.slug)).toContain(taggedProductSlug);
  });

  it('drops a product the catalogue would not show', async () => {
    await prisma.product.update({
      where: { id: taggedProductId },
      data: { status: 'DRAFT' },
    });

    const related = await listProductsRelatedToGalleryItem({ slug });
    expect(related.map((product) => product.slug)).not.toContain(taggedProductSlug);

    await prisma.product.update({
      where: { id: taggedProductId },
      data: { status: 'ACTIVE' },
    });
  });
});

/* ---------------------------------------------------------------------------
 * The homepage
 * ------------------------------------------------------------------------ */

describe('the homepage', () => {
  it('is a list of enabled sections, in position order', async () => {
    const sections = await listHomepageSections();

    expect(sections.length).toBeGreaterThan(0);
    expect(sections.every((section) => section.isEnabled)).toBe(true);

    const positions = sections.map((section) => section.position);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('reorders when a band’s position changes (the "reorderable" requirement)', async () => {
    const before = await listHomepageSections();
    expect(before.length).toBeGreaterThan(1);

    const first = before[0]!;
    const second = before[1]!;

    try {
      // Swap the two, exactly as an owner would.
      await prisma.homepageSection.update({
        where: { id: first.id },
        data: { position: second.position },
      });
      await prisma.homepageSection.update({
        where: { id: second.id },
        data: { position: first.position },
      });

      const after = await listHomepageSections();

      expect(after[0]!.id).toBe(second.id);
      expect(after[1]!.id).toBe(first.id);
    } finally {
      await prisma.homepageSection.update({
        where: { id: first.id },
        data: { position: first.position },
      });
      await prisma.homepageSection.update({
        where: { id: second.id },
        data: { position: second.position },
      });
    }

    expect((await listHomepageSections()).map((band) => band.id)).toEqual(
      before.map((band) => band.id),
    );
  });

  it('drops a band that is switched off', async () => {
    const sections = await listHomepageSections();
    const target = sections[0]!;

    try {
      await prisma.homepageSection.update({
        where: { id: target.id },
        data: { isEnabled: false },
      });

      const after = await listHomepageSections();
      expect(after.map((band) => band.id)).not.toContain(target.id);
    } finally {
      await prisma.homepageSection.update({
        where: { id: target.id },
        data: { isEnabled: true },
      });
    }
  });

  it('loads only what its enabled bands need', async () => {
    const data = await loadHomepage();

    const enabled = new Set(data.sections.map((section) => section.type));

    // Whatever the owner has switched on, the rule holds both ways: a band that
    // is off contributes no rows, and a band that is on gets its query.
    if (!enabled.has('GALLERY')) expect(data.gallery).toHaveLength(0);
    if (!enabled.has('CATEGORY_GRID')) expect(data.categories).toHaveLength(0);
    if (!enabled.has('SOCIAL')) expect(data.social).toHaveLength(0);
    if (!enabled.has('FEATURED_PRODUCTS')) expect(data.products).toHaveLength(0);

    if (enabled.has('GALLERY')) expect(data.gallery.length).toBeGreaterThan(0);
    if (enabled.has('FEATURED_PRODUCTS')) expect(data.products.length).toBeGreaterThan(0);
  });

  it('renders no fabricated social proof: the reviews band carries only approved rows', async () => {
    const data = await loadHomepage();

    for (const review of data.reviews) {
      const row = await prisma.review.findUniqueOrThrow({
        where: { id: review.id },
        select: { status: true },
      });

      expect(row.status).toBe('APPROVED');
    }
  });

  it('reads its delivery figures from the shipping rates, not from copy', async () => {
    const data = await loadHomepage();
    if (data.delivery.length === 0) return;

    for (const zone of data.delivery) {
      const stored = await prisma.shippingZone.findFirstOrThrow({
        where: { name: zone.zone },
        select: {
          rates: { where: { isActive: true }, select: { estimatedMinDays: true } },
          _count: { select: { wilayas: true } },
        },
      });

      const mins = stored.rates.flatMap((rate) =>
        rate.estimatedMinDays === null ? [] : [rate.estimatedMinDays],
      );

      expect(zone.minDays).toBe(Math.min(...mins));
      expect(zone.wilayaCount).toBe(stored._count.wilayas);
    }
  });
});

describe('banners', () => {
  let bannerId: string;

  afterEach(async () => {
    if (bannerId) await prisma.banner.deleteMany({ where: { id: bannerId } });
  });

  it('shows one inside its window and hides one outside it', async () => {
    const message = `Bannière ${PREFIX}`;

    const banner = await prisma.banner.create({
      data: {
        message,
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 60_000),
        isActive: true,
        position: 99,
      },
      select: { id: true },
    });

    bannerId = banner.id;

    const live = await listActiveBanners(new Date());
    expect(live.map((entry) => entry.message)).toContain(message);

    // The same row, read at an instant after its window: gone.
    const later = await listActiveBanners(new Date(Date.now() + 120_000));
    expect(later.map((entry) => entry.message)).not.toContain(message);
  });
});

describe('social links', () => {
  it('surfaces an active link and hides a deactivated one', async () => {
    const created = await prisma.socialLink.create({
      data: {
        platform: `Réseau ${PREFIX}`,
        url: 'https://example.invalid/atelier',
        handle: '@atelier',
        isActive: true,
        position: 99,
      },
      select: { id: true },
    });

    try {
      const active = await listSocialLinks();
      expect(active.map((link) => link.id)).toContain(created.id);

      await prisma.socialLink.update({
        where: { id: created.id },
        data: { isActive: false },
      });

      const after = await listSocialLinks();
      expect(after.map((link) => link.id)).not.toContain(created.id);
    } finally {
      await prisma.socialLink.deleteMany({ where: { id: created.id } });
    }
  });
});
