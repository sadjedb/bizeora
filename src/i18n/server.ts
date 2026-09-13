import 'server-only';

import { cookies } from 'next/headers';

import { dictionaryFor } from '@/i18n';
import { DEFAULT_LOCALE, type Locale } from '@/i18n/locales';
import type { Dictionary } from '@/i18n/dictionaries/fr';

/**
 * The language of a page that has none in its URL.
 *
 * The storefront carries its locale in the path, so a page there reads
 * `params.locale` and needs nothing from this file. The workshop does not: its
 * addresses are `/admin/orders` and always have been, and prefixing them would
 * change every bookmark the business has for no gain — `/admin` is behind a
 * session, indexed by nobody, and never linked from outside.
 *
 * So the workshop's language is a **preference**, and it lives in the same
 * `NEXT_LOCALE` cookie the storefront's switcher writes. One person switching
 * the shop to English gets an English workshop too, which is the behaviour they
 * would expect and the one that needs no explaining.
 *
 * Reading a cookie opts the route out of static rendering. Every admin page is
 * already `force-dynamic` — it is a private view of live data — so this costs
 * nothing that was not already spent.
 */
export const LOCALE_COOKIE = 'NEXT_LOCALE';

export async function workshopDictionary(): Promise<{ locale: Locale; t: Dictionary }> {
  const store = await cookies();
  const preference = store.get(LOCALE_COOKIE)?.value;

  return dictionaryFor(preference ?? DEFAULT_LOCALE);
}
