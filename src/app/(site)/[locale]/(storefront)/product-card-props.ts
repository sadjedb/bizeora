import type { ProductCardProduct } from '@/components/commerce/product-card';
import type { CatalogueProductSummary } from '@/server/repositories/catalogue-repository';
import type { Dictionary } from '@/i18n';
import { badgeFor } from '@/i18n/catalogue';

/**
 * Catalogue DTO to `ProductCard` props.
 *
 * The listing, the homepage and the related-products strip all render the same
 * card, so the mapping lives once rather than three times. It is a rename, not
 * a transformation: every value is already resolved by the repository, and
 * nothing here decides a price, an availability or a badge.
 *
 * Optional props are spread conditionally rather than passed as `undefined`,
 * which keeps `exactOptionalPropertyTypes` honest if it is ever turned on.
 */
export function toCardProduct(
  product: CatalogueProductSummary,
  t: Dictionary,
): ProductCardProduct {
  return {
    name: product.name,
    href: `/shop/${product.slug}`,
    eyebrow: product.category,
    imageSrc: product.image?.src ?? null,
    imageAlt: product.image?.alt ?? product.name,
    price: product.price,
    currency: product.currency,
    available: product.available,
    ...(product.compareAtPrice !== null
      ? { compareAtPrice: product.compareAtPrice }
      : {}),
    soldOutLabel: t.product.soldOut,
    ...(product.badge ? { badge: badgeFor(product.badge, t) } : {}),
    ...(product.image?.blurDataUrl ? { blurDataURL: product.image.blurDataUrl } : {}),
  };
}
