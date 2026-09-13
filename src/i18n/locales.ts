/**
 * The languages the storefront speaks.
 *
 * `PRODUCT.md` section 9 shipped V1 in French and named Arabic as the likely
 * second locale; English arrived first because the owner asked for it. Adding a
 * third is adding a dictionary and a line here — the routing, the metadata and
 * the switcher are all driven from this list rather than from a pair of
 * conditionals.
 *
 * Pure data with no I/O, so it can be imported by middleware, by a server
 * component and by a test alike.
 */

export const LOCALES = ['fr', 'en'] as const;

export type Locale = (typeof LOCALES)[number];

/**
 * French, and not by accident.
 *
 * The shop is Algerian, its catalogue is written in French, and the customers
 * it serves read French. English is the second language, so a visitor who
 * arrives without a preference gets the one the business actually writes in.
 */
export const DEFAULT_LOCALE: Locale = 'fr';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** What each language calls itself. Never translated — a switcher that says
 * "French" to an English reader is a switcher they cannot use in reverse. */
export const LOCALE_NAMES: Record<Locale, string> = {
  fr: 'Français',
  en: 'English',
};

/** The `lang` attribute and the BCP-47 tag used in metadata and `hreflang`. */
export const LOCALE_TAGS: Record<Locale, string> = {
  fr: 'fr',
  en: 'en',
};

/** Open Graph wants a territory. The shop is Algerian; its English is not. */
export const OG_LOCALES: Record<Locale, string> = {
  fr: 'fr_DZ',
  en: 'en_GB',
};

/** The locale that formats dates, money and lists. */
export const INTL_LOCALES: Record<Locale, string> = {
  fr: 'fr-DZ',
  en: 'en-GB',
};

/**
 * Prefix a path with a locale.
 *
 * Every locale is prefixed, the default one included. The alternative — a bare
 * `/shop` for French and `/en/shop` for English — makes the default language
 * the only one without a canonical of its own, and quietly turns every existing
 * link into a redirect. One shape for all of them is worth the extra segment.
 */
export function localePath(locale: Locale, path: string): string {
  const normalised = path === '/' ? '' : path.startsWith('/') ? path : `/${path}`;
  return `/${locale}${normalised}`;
}

/**
 * Split a pathname into its locale and the rest.
 *
 * Returns `null` for a path that carries no locale, which is how middleware
 * tells "needs redirecting" from "already fine".
 */
export function splitLocale(pathname: string): { locale: Locale; rest: string } | null {
  const [, first = '', ...others] = pathname.split('/');
  if (!isLocale(first)) return null;

  const rest = others.length > 0 ? `/${others.join('/')}` : '/';
  return { locale: first, rest };
}

/**
 * The best match for an `Accept-Language` header.
 *
 * Deliberately crude: it looks for the first supported language tag in the
 * header's order and falls back to the default. Quality values are not parsed,
 * because the alternative to a correct guess here is not a wrong page — it is
 * a redirect the visitor can undo with one click on the switcher.
 */
export function negotiateLocale(header: string | null): Locale {
  if (!header) return DEFAULT_LOCALE;

  for (const part of header.split(',')) {
    const tag = part.split(';')[0]?.trim().toLowerCase() ?? '';
    const base = tag.split('-')[0] ?? '';

    if (isLocale(base)) return base;
  }

  return DEFAULT_LOCALE;
}
