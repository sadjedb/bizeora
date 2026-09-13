import { isLocale, type Locale } from '@/i18n/locales';

/**
 * Turning an internal href into a localised one.
 *
 * Pure string work, no framework, so the `Link` primitive, the middleware and a
 * unit test all answer the question the same way.
 */

/**
 * Paths that never take a language prefix.
 *
 * The workshop, the API, the development showcase, the public asset folder and
 * the framework's own routes. This list is the twin of the one in
 * `middleware.ts`; the two must agree, and both are short enough to read.
 */
const UNLOCALISED_PREFIXES = ['/admin', '/api', '/dev', '/assets', '/_next'] as const;

/** Files a crawler or the framework fetches by exact name. */
const UNLOCALISED_EXACT = ['/sitemap.xml', '/robots.txt', '/favicon.ico'] as const;

export function isUnlocalisedPath(path: string): boolean {
  if (UNLOCALISED_EXACT.includes(path as (typeof UNLOCALISED_EXACT)[number])) return true;

  return UNLOCALISED_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

/** The locale a pathname is already in, or `null` when it carries none. */
export function localeFromPath(pathname: string): Locale | null {
  const first = pathname.split('/')[1] ?? '';
  return isLocale(first) ? first : null;
}

/**
 * The href to render for an internal path.
 *
 * Returns the path unchanged when there is nothing to do — an external URL, a
 * fragment, a query-only href, an unlocalised route, a path that already names
 * its locale, or a page rendered outside any locale (the admin, where
 * `locale` is `null`). Everything else gains the prefix.
 *
 * Leaving a bare `/shop` in the markup would still *work*, because the
 * middleware redirects it — but every internal click would cost a round trip,
 * and a navigation item's `href` would never equal the pathname it is supposed
 * to mark as current.
 */
export function localiseHref(href: string, locale: Locale | null): string {
  if (locale === null) return href;
  if (!href.startsWith('/')) return href;
  if (href.startsWith('//')) return href;
  if (isUnlocalisedPath(href.split('?')[0]?.split('#')[0] ?? href)) return href;
  if (localeFromPath(href) !== null) return href;

  return href === '/' ? `/${locale}` : `/${locale}${href}`;
}

/**
 * The same pathname in another language.
 *
 * What the language switcher links to: the page the visitor is on, in the other
 * locale, so switching never sends anybody back to the homepage. A path with no
 * locale — which should not happen inside the storefront — is prefixed rather
 * than rewritten.
 */
export function switchLocalePath(pathname: string, next: Locale): string {
  const current = localeFromPath(pathname);
  if (current === null) return localiseHref(pathname, next);

  const rest = pathname.slice(`/${current}`.length);
  return rest === '' ? `/${next}` : `/${next}${rest}`;
}

/**
 * A pathname with its language prefix removed.
 *
 * What navigation compares against. An item's `href` is written unprefixed
 * (`/shop`), the browser is at `/fr/shop`, and "am I the current page?" has to
 * be asked in one of the two shapes — this makes it the shorter one.
 */
export function pathWithoutLocale(pathname: string): string {
  const locale = localeFromPath(pathname);
  if (locale === null) return pathname;

  const rest = pathname.slice(`/${locale}`.length);
  return rest === '' ? '/' : rest;
}
