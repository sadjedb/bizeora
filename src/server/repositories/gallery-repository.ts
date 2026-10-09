import 'server-only';

import { DEFAULT_LOCALE } from '@/i18n/locales';
import { localise } from '@/domain/translation';

import { prisma } from '@/lib/db/client';
import { toPublicAssetUrl } from '@/lib/media/public-asset';
import type { GalleryFilters } from '@/domain/gallery';

/**
 * The gallery read path.
 *
 * Public visibility is `isPublished` **and** not soft-deleted, and it is a
 * clause in every query here rather than a filter applied afterwards — the same
 * rule `catalogue-repository` follows, for the same reason. An unpublished
 * gallery item is frequently a piece of customer work awaiting a consent that
 * has not been given (13.6), so "fetched then hidden" is not a near miss here;
 * it is the exact failure mode the consent rule exists to prevent.
 *
 * The image a visitor sees is `imageKey` resolved through the **public** asset
 * origin. `sourceDesignFileId` never leaves this module: the private original
 * is not served publicly even when consent has been given, and a storage key in
 * a DTO is how it would start being.
 */

export type GalleryCard = {
  slug: string;
  title: string;
  alt: string;
  image: string | null;
  thumbnail: string | null;
  productType: string | null;
  embroideryType: string | null;
  isFeatured: boolean;
};

export type GalleryDetail = GalleryCard & {
  description: string | null;
  tags: readonly string[];
};

/** The facet values that actually occur, so a filter never offers a dead end. */
export type GalleryFacets = {
  productTypes: readonly string[];
  embroideryTypes: readonly string[];
};

const CARD_SELECT = {
  slug: true,
  title: true,
  alt: true,
  translations: true,
  imageKey: true,
  thumbnailKey: true,
  productType: true,
  embroideryType: true,
  isFeatured: true,
} as const;

/** 13.6 and `DATABASE.md` section 13, expressed once, applied by the database. */
export function publiclyVisibleGalleryWhere() {
  return { isPublished: true, deletedAt: null } as const;
}

export const GALLERY_PAGE_SIZE = 24;

function toCard(
  row: {
    slug: string;
    title: string;
    alt: string;
    imageKey: string;
    thumbnailKey: string | null;
    productType: string | null;
    embroideryType: string | null;
    isFeatured: boolean;
    translations?: unknown;
  },
  locale: string = DEFAULT_LOCALE,
): GalleryCard {
  // The caption and the alt text, in the reader's language. The facets are not
  // translated: they are filter values shared with the URL, and translating one
  // would break the link that carries it.
  const text = localise(row, row.translations, locale, ['title', 'alt']);

  return {
    slug: row.slug,
    title: text.title,
    alt: text.alt,
    image: toPublicAssetUrl(row.imageKey),
    thumbnail: toPublicAssetUrl(row.thumbnailKey ?? row.imageKey),
    productType: row.productType,
    embroideryType: row.embroideryType,
    isFeatured: row.isFeatured,
  };
}

export async function listGalleryItems(
  input: { filters?: GalleryFilters; limit?: number; locale?: string } = {},
): Promise<readonly GalleryCard[]> {
  const filters = input.filters;

  const rows = await prisma.galleryItem.findMany({
    where: {
      ...publiclyVisibleGalleryWhere(),
      ...(filters?.productType ? { productType: filters.productType } : {}),
      ...(filters?.embroideryType ? { embroideryType: filters.embroideryType } : {}),
    },
    select: CARD_SELECT,
    // Curated order first, then newest. `position` is what the owner controls.
    orderBy: [{ position: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }],
    take: Math.min(input.limit ?? GALLERY_PAGE_SIZE, GALLERY_PAGE_SIZE),
  });

  return rows.map((row) => toCard(row, input.locale));
}

/** Featured items, for the homepage band. */
export async function listFeaturedGalleryItems(input: {
  limit: number;
  locale?: string;
}): Promise<readonly GalleryCard[]> {
  const rows = await prisma.galleryItem.findMany({
    where: { ...publiclyVisibleGalleryWhere(), isFeatured: true },
    select: CARD_SELECT,
    orderBy: [{ position: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }],
    take: Math.min(Math.max(input.limit, 1), 12),
  });

  return rows.map((row) => toCard(row, input.locale));
}

export async function getGalleryItemBySlug(
  slug: string,
  locale: string = DEFAULT_LOCALE,
): Promise<GalleryDetail | null> {
  const row = await prisma.galleryItem.findFirst({
    where: { slug, ...publiclyVisibleGalleryWhere() },
    select: {
      ...CARD_SELECT,
      description: true,
      tags: { select: { tag: { select: { name: true } } } },
    },
  });

  if (!row) return null;

  const text = localise(row, row.translations, locale, ['description']);

  return {
    ...toCard(row, locale),
    description: text.description,
    tags: row.tags.map((link) => link.tag.name),
  };
}

/**
 * The facets that exist among published items.
 *
 * Grouped in the database and read from published rows only, so a filter chip
 * can never reveal that an unpublished item of some type exists.
 */
export async function listGalleryFacets(): Promise<GalleryFacets> {
  const [productTypes, embroideryTypes] = await Promise.all([
    prisma.galleryItem.groupBy({
      by: ['productType'],
      where: { ...publiclyVisibleGalleryWhere(), productType: { not: null } },
      orderBy: { productType: 'asc' },
    }),
    prisma.galleryItem.groupBy({
      by: ['embroideryType'],
      where: { ...publiclyVisibleGalleryWhere(), embroideryType: { not: null } },
      orderBy: { embroideryType: 'asc' },
    }),
  ]);

  return {
    productTypes: productTypes.flatMap((row) =>
      row.productType ? [row.productType] : [],
    ),
    embroideryTypes: embroideryTypes.flatMap((row) =>
      row.embroideryType ? [row.embroideryType] : [],
    ),
  };
}

/**
 * Products that share a tag with this gallery item.
 *
 * `ROADMAP.md` asks a gallery detail page for "links to related products", and
 * the honest join is the shared tag: a gallery item tagged "casquette" leads to
 * the caps a visitor can actually buy. Products are filtered by the catalogue's
 * own visibility rule, so an item may legitimately have no related products —
 * the page then simply does not offer any.
 */
export async function listProductsRelatedToGalleryItem(input: {
  slug: string;
  limit?: number;
}): Promise<readonly { slug: string; name: string }[]> {
  const rows = await prisma.product.findMany({
    where: {
      status: 'ACTIVE',
      deletedAt: null,
      publishedAt: { not: null, lte: new Date() },
      tags: {
        some: { tag: { gallery: { some: { galleryItem: { slug: input.slug } } } } },
      },
    },
    select: { slug: true, name: true },
    orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
    take: Math.min(input.limit ?? 4, 8),
  });

  return rows;
}

/**
 * Every publicly visible gallery item, for `sitemap.xml`.
 *
 * Behind the same `publiclyVisibleGalleryWhere` clause the listing uses, so an
 * unpublished item — which is often a piece of customer work awaiting the
 * consent of 13.6 — cannot reach the sitemap even if the listing changed.
 */
export async function listGalleryItemsForSitemap(): Promise<
  readonly { slug: string; updatedAt: Date }[]
> {
  return prisma.galleryItem.findMany({
    where: publiclyVisibleGalleryWhere(),
    select: { slug: true, updatedAt: true },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    take: 10_000,
  });
}
