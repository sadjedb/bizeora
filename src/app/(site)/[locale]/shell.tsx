import type { ReactNode } from 'react';

import { dictionaryFor } from '@/i18n';

import { StorefrontChrome } from './chrome';
import { footerColumns, footerContact, storefrontNav } from './navigation';

/**
 * The public site's chrome — header, navigation, footer.
 *
 * Lifted out of the storefront's layout so that two layouts can wear it. The
 * shop is behind a switch the owner can turn off (`site.storefrontEnabled`) and
 * signing in is not: `/login` is how the workshop reaches `/admin`, so it sits
 * in its own route group outside the closable part of the site. Both groups
 * render this, which is why the seam is invisible — the page looks the same
 * whichever side of it a route falls on.
 *
 * A server component, so the dictionary is resolved once per request here
 * rather than in a client bundle. The interactive half — marking the current
 * navigation item, opening the mobile drawer — lives in `StorefrontChrome`,
 * which receives its words as props.
 */
export async function SiteShell({
  locale,
  children,
}: {
  locale: string;
  children: ReactNode;
}) {
  const { t } = dictionaryFor(locale);

  return (
    <StorefrontChrome
      nav={storefrontNav(t)}
      columns={footerColumns(t)}
      contact={footerContact(t)}
      footerMadeIn={t.footer.madeIn}
      // The one filled control in the header. It points at the builder, which
      // is the destination the business earns the most from and the one a
      // first-time visitor is least likely to find on their own.
      cta={{ label: t.nav.startOrder, href: '/custom' }}
      labels={{
        mainNavigation: t.a11y.mainNavigation,
        openMenu: t.a11y.openMenu,
        menu: t.a11y.openMenu,
        search: t.common.search,
        account: t.a11y.account,
        cart: t.a11y.cart,
        theme: t.a11y.theme,
        language: t.a11y.language,
      }}
    >
      {children}
    </StorefrontChrome>
  );
}
