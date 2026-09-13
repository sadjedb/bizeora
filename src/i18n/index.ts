import { fr, type Dictionary } from '@/i18n/dictionaries/fr';
import { en } from '@/i18n/dictionaries/en';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';

export type { Dictionary };
export type { Locale };

/**
 * The strings, for one language.
 *
 * Synchronous and eager: both dictionaries are a few kilobytes of static
 * objects, so the usual dynamic-import dance buys nothing and costs every
 * caller an `await`. If a third language ever makes that untrue, this is the
 * one function that changes.
 */
const DICTIONARIES: Record<Locale, Dictionary> = { fr, en };

export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale];
}

/**
 * The dictionary for a route parameter that has not been validated yet.
 *
 * Pages receive `params.locale` as a `string`. Rather than repeat the same
 * narrowing in forty files, they call this and get the default language for
 * anything unrecognised — the layout has already sent a genuinely unknown
 * locale to `notFound`, so this only ever falls back in a test.
 */
export function dictionaryFor(locale: string): {
  locale: Locale;
  t: Dictionary;
} {
  const resolved: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return { locale: resolved, t: DICTIONARIES[resolved] };
}
