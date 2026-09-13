import 'server-only';

import { prisma } from '@/lib/db/client';
import { toPublicAssetUrl } from '@/lib/media/public-asset';
import {
  activeBanners,
  isHomepageSectionType,
  orderedSections,
  type Banner,
  type HomepageSection,
} from '@/domain/content';

/**
 * Storefront content: homepage sections, banners, social links, categories.
 *
 * Four small tables that share one property — they are edited by the owner and
 * read by every visitor — and one rule: **published-and-active is a clause in
 * the query.** A disabled section, an expired banner and a deactivated social
 * link are all things somebody decided not to show, and "fetched then filtered"
 * is one forgotten line away from showing them.
 *
 * The ordering and enabling rules themselves live in `domain/content`, because
 * they are the part a test should be able to exercise without a database. This
 * module fetches rows and hands them over.
 */

/* ---------------------------------------------------------------------------
 * Homepage sections
 * ------------------------------------------------------------------------ */

/**
 * Every homepage section, enabled ones first-class and ordered.
 *
 * A row whose `type` is not one this build knows is dropped: the enum is a
 * database type and a deploy can lag a migration, and an unknown band is better
 * absent than a thrown render.
 */
export async function listHomepageSections(): Promise<readonly HomepageSection[]> {
  const rows = await prisma.homepageSection.findMany({
    where: { isEnabled: true },
    select: {
      id: true,
      type: true,
      position: true,
      isEnabled: true,
      title: true,
      subtitle: true,
      body: true,
      ctaLabel: true,
      ctaHref: true,
      imageKey: true,
      config: true,
    },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
  });

  const known = rows.flatMap((row) =>
    isHomepageSectionType(row.type)
      ? [
          {
            id: row.id,
            type: row.type,
            position: row.position,
            isEnabled: row.isEnabled,
            title: row.title,
            subtitle: row.subtitle,
            body: row.body,
            ctaLabel: row.ctaLabel,
            ctaHref: row.ctaHref,
            imageKey: row.imageKey,
            config: row.config as unknown,
          } satisfies HomepageSection,
        ]
      : [],
  );

  return orderedSections(known);
}

/* ---------------------------------------------------------------------------
 * Banners
 * ------------------------------------------------------------------------ */

export type PublicBanner = {
  id: string;
  message: string;
  href: string | null;
  variant: string | null;
};

/**
 * The banners showing right now.
 *
 * The `isActive` flag is applied by the database; the time window is applied by
 * `domain/content`, so "is this banner live at this instant" is a pure function
 * a test can drive with a fixed clock rather than by waiting.
 */
export async function listActiveBanners(
  now: Date = new Date(),
): Promise<readonly PublicBanner[]> {
  const rows = await prisma.banner.findMany({
    where: { isActive: true },
    select: {
      id: true,
      message: true,
      href: true,
      variant: true,
      startsAt: true,
      endsAt: true,
      isActive: true,
      position: true,
    },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    take: 10,
  });

  return activeBanners(rows satisfies readonly Banner[], now).map((banner) => ({
    id: banner.id,
    message: banner.message,
    href: banner.href,
    variant: banner.variant,
  }));
}

/* ---------------------------------------------------------------------------
 * Social links
 * ------------------------------------------------------------------------ */

export type PublicSocialLink = {
  id: string;
  platform: string;
  url: string;
  handle: string | null;
};

export async function listSocialLinks(): Promise<readonly PublicSocialLink[]> {
  const rows = await prisma.socialLink.findMany({
    where: { isActive: true },
    select: { id: true, platform: true, url: true, handle: true },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    take: 10,
  });

  return rows;
}

/* ---------------------------------------------------------------------------
 * Categories
 * ------------------------------------------------------------------------ */

export type CategoryCard = {
  slug: string;
  name: string;
  description: string | null;
  image: string | null;
  productCount: number;
};

/**
 * Top-level categories that have something in them.
 *
 * A category grid linking to an empty listing is a dead end, so the count is
 * part of the query and a category with no publicly visible product is left
 * out. The count is the database's `_count`, not a second round trip per card.
 */
export async function listCategoryCards(input: {
  limit: number;
}): Promise<readonly CategoryCard[]> {
  const rows = await prisma.category.findMany({
    where: { isActive: true, deletedAt: null, parentId: null },
    select: {
      slug: true,
      name: true,
      description: true,
      imageKey: true,
      _count: {
        select: {
          products: {
            where: { status: 'ACTIVE', deletedAt: null, publishedAt: { not: null } },
          },
        },
      },
    },
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
    take: Math.min(Math.max(input.limit, 1), 12),
  });

  return rows.flatMap((row) =>
    row._count.products === 0
      ? []
      : [
          {
            slug: row.slug,
            name: row.name,
            description: row.description,
            image: toPublicAssetUrl(row.imageKey),
            productCount: row._count.products,
          },
        ],
  );
}

/* ---------------------------------------------------------------------------
 * Delivery, for the trust band
 * ------------------------------------------------------------------------ */

export type DeliveryZoneSummary = {
  zone: string;
  wilayaCount: number;
  minDays: number;
  maxDays: number;
};

/**
 * What the shop actually promises about delivery.
 *
 * `ROADMAP.md` Phase 13 asks for "delivery information" as a trust element, and
 * the only honest source for it is the rates the checkout charges: a delivery
 * promise typed into a content row is one nobody reconciles against
 * `shipping_rates`, and the first customer to notice the difference is the one
 * who paid it. So the band is rendered from the zones, and if a zone's days
 * change the homepage changes with them.
 *
 * Rates carrying no day range are excluded rather than shown as "0 days".
 */
export async function listDeliveryZones(): Promise<readonly DeliveryZoneSummary[]> {
  const rows = await prisma.shippingZone.findMany({
    where: { isActive: true },
    select: {
      name: true,
      _count: { select: { wilayas: true } },
      rates: {
        where: { isActive: true },
        select: { estimatedMinDays: true, estimatedMaxDays: true },
      },
    },
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
    take: 10,
  });

  return rows.flatMap((row) => {
    const mins = row.rates.flatMap((rate) =>
      rate.estimatedMinDays === null ? [] : [rate.estimatedMinDays],
    );
    const maxes = row.rates.flatMap((rate) =>
      rate.estimatedMaxDays === null ? [] : [rate.estimatedMaxDays],
    );

    if (mins.length === 0 || maxes.length === 0) return [];

    return [
      {
        zone: row.name,
        wilayaCount: row._count.wilayas,
        minDays: Math.min(...mins),
        maxDays: Math.max(...maxes),
      },
    ];
  });
}
