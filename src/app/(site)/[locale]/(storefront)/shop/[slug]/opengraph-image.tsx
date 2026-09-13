import { ImageResponse } from 'next/og';

import { brand } from '@/config/brand';
import { formatMoney } from '@/components/commerce/price';
import { OG_CONTENT_TYPE, OG_SIZE, OgCard } from '@/components/seo/og-card';
import { getPublishedProductBySlug } from '@/server/repositories/catalogue-repository';
import { dictionaryFor } from '@/i18n';

/**
 * The social card for a product.
 *
 * `ROADMAP.md` Phase 14 asks for "dynamic OG images for products", and the
 * reason is prosaic: there is no photography yet, so without this a product
 * shared in a message or on a social network is a bare link. A generated card
 * carrying the product's name and its price is worth more than a placeholder
 * and much more than nothing.
 *
 * Next uses this file **only when the page's metadata does not set
 * `openGraph.images` itself**, so a product that has a real photograph keeps the
 * photograph and one that does not gets this. That fallback order is the point:
 * a photograph of the actual piece always wins.
 *
 * Nothing private can reach the card. It is built from the same publicly
 * visible product query the page uses, so an unpublished or unknown slug
 * renders the brand alone rather than leaking a draft's name or its price.
 */

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = `${brand.name} — broderie personnalisée`;

export default async function Image({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const { t } = dictionaryFor(locale);
  const product = await getPublishedProductBySlug(slug);

  return new ImageResponse(
    <OgCard
      headline={product ? product.name : t.common.brandTagline}
      detail={
        product
          ? formatMoney(product.price, { currency: product.currency })
          : t.seo.ogProductFallback
      }
      footer={t.seo.ogFooter}
    />,
    size,
  );
}
