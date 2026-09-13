import type { MetadataRoute } from 'next';

import { absoluteUrl, languageAlternates, seoIndexable } from '@/lib/seo';
import { LOCALES } from '@/i18n/locales';
import { listProductsForSitemap } from '@/server/repositories/catalogue-repository';
import { listGalleryItemsForSitemap } from '@/server/repositories/gallery-repository';

/**
 * `sitemap.xml`.
 *
 * Two rules, and the second is the one that matters.
 *
 * **Every URL is generated from a repository**, behind the same visibility
 * predicate the pages themselves use — `publiclyVisibleWhere` for products,
 * `publiclyVisibleGalleryWhere` for the gallery. A sitemap built from its own
 * idea of "public" is a sitemap that eventually advertises a draft product or a
 * piece of customer work whose consent was never recorded, and it does so to
 * the one audience that will copy it everywhere.
 *
 * **Nothing private is listed, and nothing parameterised.** No `/admin`, no
 * `/account`, no cart, checkout, quote, request or order route; no filtered
 * gallery URL, because a filter is a view of the listing rather than a page of
 * its own (`lib/seo`, and the canonical the filtered page carries). The static
 * entries below are written out rather than discovered, so adding a private
 * route cannot add it to the sitemap by accident.
 *
 * It is empty while the deployment is not indexable: publishing a map of a site
 * that asks not to be indexed is a contradiction a crawler resolves in whichever
 * direction it prefers.
 *
 * **Every page is listed once per language**, and each entry names the others
 * through `alternates.languages`. Listing only French would leave the English
 * half of the site discoverable solely by following links, and listing the two
 * without `hreflang` would offer a crawler two pages that say the same thing in
 * different words — which is the shape of duplicate content, not of a
 * translation.
 *
 * Dynamic rather than built: the project keeps the database out of `next build`
 * (see the shop route's note), and a sitemap is fetched rarely enough that
 * generating it per request costs nothing worth optimising.
 */
export const dynamic = 'force-dynamic';

/** The public routes that exist, by hand, because they are few and fixed. */
const STATIC_ROUTES: readonly {
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'];
  priority: number;
}[] = [
  { path: '/', changeFrequency: 'weekly', priority: 1 },
  { path: '/shop', changeFrequency: 'daily', priority: 0.9 },
  { path: '/custom', changeFrequency: 'monthly', priority: 0.9 },
  { path: '/gallery', changeFrequency: 'weekly', priority: 0.7 },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!seoIndexable) return [];

  const [products, gallery] = await Promise.all([
    listProductsForSitemap(),
    listGalleryItemsForSitemap(),
  ]);

  const now = new Date();

  const entries: {
    path: string;
    lastModified: Date;
    changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'];
    priority: number;
  }[] = [
    ...STATIC_ROUTES.map((route) => ({
      path: route.path,
      lastModified: now,
      changeFrequency: route.changeFrequency,
      priority: route.priority,
    })),

    ...products.map((product) => ({
      path: `/shop/${product.slug}`,
      lastModified: product.updatedAt,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),

    ...gallery.map((item) => ({
      path: `/gallery/${item.slug}`,
      lastModified: item.updatedAt,
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    })),
  ];

  return entries.flatMap((entry) =>
    LOCALES.map((locale) => ({
      url: absoluteUrl(entry.path, locale),
      lastModified: entry.lastModified,
      changeFrequency: entry.changeFrequency,
      priority: entry.priority,
      alternates: { languages: languageAlternates(entry.path) },
    })),
  );
}
