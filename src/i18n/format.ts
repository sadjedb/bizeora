import { INTL_LOCALES, type Locale } from '@/i18n/locales';

/**
 * Dates, in the reader's language.
 *
 * Every storefront page used to hold a module-level
 * `new Intl.DateTimeFormat('fr-DZ', …)`, which was correct while there was one
 * language and silently wrong the moment there were two: a module constant is
 * created once per process, not once per request, so it cannot depend on the
 * locale of the page being rendered.
 *
 * These take the locale as an argument instead. `Intl` caches its own
 * formatters internally, so calling this per row costs a lookup, not a
 * construction.
 *
 * The admin is unaffected — it is French-only and keeps its own constants.
 */

type DateStyle = 'long' | 'medium' | 'short';

export function formatDate(
  value: Date,
  locale: Locale,
  dateStyle: DateStyle = 'long',
): string {
  return new Intl.DateTimeFormat(INTL_LOCALES[locale], { dateStyle }).format(value);
}

/** A date and a time, for a log entry or a message. */
export function formatDateTime(value: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_LOCALES[locale], {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value);
}
