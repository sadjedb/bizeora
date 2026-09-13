import 'server-only';

import { collectDataNeeds, listConfig, type HomepageSection } from '@/domain/content';
import {
  listActiveBanners,
  listCategoryCards,
  listDeliveryZones,
  listHomepageSections,
  listSocialLinks,
  type CategoryCard,
  type DeliveryZoneSummary,
  type PublicBanner,
  type PublicSocialLink,
} from '@/server/repositories/content-repository';
import {
  listFeaturedGalleryItems,
  type GalleryCard,
} from '@/server/repositories/gallery-repository';
import {
  listApprovedReviewsAcrossCatalogue,
  type PublicReview,
} from '@/server/repositories/review-repository';
import {
  listPublishedProducts,
  type CatalogueProductSummary,
} from '@/server/repositories/catalogue-repository';

/**
 * Composing the homepage.
 *
 * The page is a list of bands the owner ordered, and each band needs different
 * data. The naive shape — every band fetching its own — makes the homepage's
 * query count a property of how many sections happen to be enabled, and makes
 * every band a server component that must not be a client component.
 *
 * So the loading happens once, here. `domain/content` says which data each
 * enabled section needs; this asks for the union of that, in parallel, and
 * hands the result to a renderer that does no I/O at all. A homepage with the
 * gallery band switched off issues no gallery query — not because a component
 * decided not to render, but because nothing asked for it.
 *
 * The limits come from each section's `config`, already bounded by the domain,
 * so a content edit cannot turn a band into a full-catalogue scan.
 */

export type HomepageData = {
  sections: readonly HomepageSection[];
  products: readonly CatalogueProductSummary[];
  categories: readonly CategoryCard[];
  gallery: readonly GalleryCard[];
  reviews: readonly (PublicReview & { productName: string; productSlug: string })[];
  social: readonly PublicSocialLink[];
  banners: readonly PublicBanner[];
  delivery: readonly DeliveryZoneSummary[];
};

/** Defaults when a section carries no `limit`, one row at every breakpoint. */
const DEFAULT_PRODUCTS = 4;
const DEFAULT_CATEGORIES = 4;
const DEFAULT_GALLERY = 6;
const DEFAULT_REVIEWS = 3;

/** The largest `limit` any enabled section of this type asked for. */
function limitFor(
  sections: readonly HomepageSection[],
  type: HomepageSection['type'],
  fallback: number,
): number {
  const limits = sections
    .filter((section) => section.type === type)
    .map((section) => listConfig(section.config, fallback).limit);

  return limits.length === 0 ? fallback : Math.max(...limits);
}

export async function loadHomepage(now: Date = new Date()): Promise<HomepageData> {
  const sections = await listHomepageSections();
  const needs = collectDataNeeds(sections);

  const [products, categories, gallery, reviews, social, banners, delivery] =
    await Promise.all([
      needs.has('products')
        ? listPublishedProducts({
            limit: limitFor(sections, 'FEATURED_PRODUCTS', DEFAULT_PRODUCTS),
          })
        : [],
      needs.has('categories')
        ? listCategoryCards({
            limit: limitFor(sections, 'CATEGORY_GRID', DEFAULT_CATEGORIES),
          })
        : [],
      needs.has('gallery')
        ? listFeaturedGalleryItems({
            limit: limitFor(sections, 'GALLERY', DEFAULT_GALLERY),
          })
        : [],
      needs.has('reviews')
        ? listApprovedReviewsAcrossCatalogue({
            limit: limitFor(sections, 'REVIEWS', DEFAULT_REVIEWS),
          })
        : [],
      needs.has('social') ? listSocialLinks() : [],
      needs.has('banners') ? listActiveBanners(now) : [],
      needs.has('delivery') ? listDeliveryZones() : [],
    ]);

  return { sections, products, categories, gallery, reviews, social, banners, delivery };
}
