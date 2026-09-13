import { ImageResponse } from 'next/og';

import { brand } from '@/config/brand';
import { OG_CONTENT_TYPE, OG_SIZE, OgCard } from '@/components/seo/og-card';

/**
 * The site-wide social card.
 *
 * Every route that does not supply its own image inherits this one, so a link
 * to the homepage, the shop, the builder or a piece of work shares as a branded
 * card rather than as a bare URL. There is no photography yet and no invented
 * asset URL: the card is drawn, not fetched.
 *
 * Deliberately static — it says the brand and nothing about a particular page,
 * because a page-specific claim belongs on the route that can make it.
 */

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = `${brand.name} — ${brand.tagline}`;

export default function Image() {
  return new ImageResponse(
    <OgCard headline={brand.tagline} detail={brand.description} />,
    size,
  );
}
