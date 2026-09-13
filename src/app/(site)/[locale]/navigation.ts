import type { NavItem } from '@/components/layout/header';
import type { FooterColumn, FooterProps } from '@/components/layout/footer';
import type { Dictionary } from '@/i18n';

/**
 * The storefront's navigation, as it stands today.
 *
 * `UX.md` section 3 documents the full IA — Shop, Custom Embroidery, Our Work,
 * How It Works, About in the header; four columns in the footer. Most of those
 * destinations are database-backed pages that arrive with the content system,
 * so **only routes that exist are listed here**. A navigation link to a page
 * that has not been built is a 404 dressed up as an affordance, and it makes
 * the site feel broken in exactly the place a first-time visitor looks.
 *
 * The shape is right; the rows fill in as the pages land.
 *
 * Functions of the dictionary rather than constants, because the labels are
 * language-dependent and the hrefs are not: `Link` adds the language prefix, so
 * `/shop` is written once and resolves to `/fr/shop` or `/en/shop` by itself.
 */

export function storefrontNav(t: Dictionary): readonly NavItem[] {
  return [
    { label: t.nav.shop, href: '/shop' },
    { label: t.nav.gallery, href: '/gallery' },
    // Emphasised, per UX.md section 3: the highest-value destination must not
    // read as one link among six.
    { label: t.nav.custom, href: '/custom', accent: true },
  ];
}

export function footerColumns(t: Dictionary): readonly FooterColumn[] {
  return [
    { heading: t.nav.shop, links: [{ label: t.nav.allProducts, href: '/shop' }] },
    { heading: t.nav.madeToOrder, links: [{ label: t.nav.custom, href: '/custom' }] },
    { heading: t.nav.theAtelier, links: [{ label: t.nav.gallery, href: '/gallery' }] },
  ];
}

/**
 * Contact details.
 *
 * Placeholders until the settings table drives them (Phase 12). The delivery
 * and currency notes are facts about how the business works rather than
 * invented marketing, so they are safe to state now; a phone number is not, so
 * there is not one here.
 */
export function footerContact(t: Dictionary): NonNullable<FooterProps['contact']> {
  return {
    deliveryNote: t.footer.deliveryNote,
    currencyNote: t.footer.currencyNote,
  };
}
