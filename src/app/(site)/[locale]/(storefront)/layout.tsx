import type { ReactNode } from 'react';

import { isLocale, type Locale } from '@/i18n/locales';
import { siteSettings } from '@/server/services/settings-service';

import { SiteShell } from '../shell';
import { StorefrontClosed } from './storefront-closed';

/**
 * The shop, and the switch that closes it.
 *
 * Everything commercial hangs off this layout — the catalogue, the builder, the
 * cart, the checkout, the customer's account — so `site.storefrontEnabled` is
 * answered once, here, rather than on each of those pages. Off, and there is no
 * shop: no navigation, no footer, nothing to click, just a note saying the
 * workshop is still there (`StorefrontClosed`).
 *
 * **Not in the root layout above**, deliberately. Sign-in sits outside this
 * group precisely so that closing the shop cannot lock the owner out of
 * `/admin`; a check in the root would close that door too.
 *
 * **And no staff exception.** An earlier version let signed-in staff through to
 * the real site with a banner, and it could not work: recognising them means
 * reading a cookie, reading a cookie makes the render request-specific, and
 * three of these pages are prerendered and revalidated every five minutes
 * (`revalidate = 300`). Next refuses that combination outright — the pages
 * returned 500 the moment the shop closed. Rather than give up the cache that
 * makes the catalogue fast, the shop closes to everybody: an owner who wants to
 * look at it opens it, which takes one click and takes effect immediately.
 */
export default async function StorefrontLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  // The root layout above has already refused anything else with a 404; this
  // narrows the type rather than re-deciding.
  const locale: Locale = isLocale(raw) ? raw : 'fr';

  const { storefrontEnabled, brandName, whatsapp } = await siteSettings();

  if (!storefrontEnabled) {
    return <StorefrontClosed locale={locale} brandName={brandName} whatsapp={whatsapp} />;
  }

  return <SiteShell locale={locale}>{children}</SiteShell>;
}
