/**
 * Content in a second language, as an overlay.
 *
 * The interface has been bilingual since Phase 14.7 and the catalogue was not:
 * an English visitor read an English shell wrapped around French product names.
 * This is the mechanism that closes that gap, and it is deliberately the one
 * ADR-027 already chose for the homepage rather than a second design.
 *
 * ## The shape
 *
 * A row carries a `translations` column holding an object keyed by locale, then
 * by the column it overrides:
 *
 * ```json
 * { "en": { "name": "Embroidered classic t-shirt" } }
 * ```
 *
 * `localise` merges that over the row. **French is the source of truth and the
 * fallback**: anything the overlay does not mention keeps its French value, so
 * a product with an English name and no English description reads correctly
 * rather than showing an empty paragraph. A half-translated catalogue is the
 * normal state of a catalogue that is being translated.
 *
 * ## What is not here
 *
 * No `fr` key is ever written. French lives in the row's own columns, which is
 * what makes every query that does not care about language — the admin, the
 * sitemap, an order snapshot — keep working untouched. Writing French into the
 * overlay as well would create two places for one value and no rule about which
 * wins.
 *
 * Pure. No I/O, no Prisma, no framework.
 */

import { DEFAULT_LOCALE, type Locale } from '@/i18n/locales';

/* ---------------------------------------------------------------------------
 * Reading
 * ------------------------------------------------------------------------ */

/** The locales a row may carry an overlay for: every language but the source. */
export const TRANSLATABLE_LOCALES: readonly Locale[] = ['en'];

export function isTranslatableLocale(value: string): value is Locale {
  return (TRANSLATABLE_LOCALES as readonly string[]).includes(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * A usable string, or nothing.
 *
 * Whitespace is not a translation. An overlay field that has been opened in the
 * form and left blank must fall back rather than blank out the French — which
 * is the difference between "not translated yet" and "translated to nothing",
 * and only one of those is ever meant.
 */
function usable(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** The overlay for one locale, as plain strings. Empty when there is none. */
export function translationFor(
  translations: unknown,
  locale: string,
): Readonly<Record<string, string>> {
  if (locale === DEFAULT_LOCALE) return {};

  const overlay = asRecord(asRecord(translations)[locale]);
  const fields: Record<string, string> = {};

  for (const [field, value] of Object.entries(overlay)) {
    const text = usable(value);
    if (text !== null) fields[field] = text;
  }

  return fields;
}

/**
 * The same row, read in another language.
 *
 * Only the fields named are considered, and only the ones the overlay actually
 * has are replaced. Naming the fields at the call site rather than merging
 * whatever the JSON holds is the point: a crafted overlay cannot set `id`,
 * `basePrice` or `status` by being written into the column.
 */
export function localise<T extends object, K extends keyof T & string>(
  row: T,
  translations: unknown,
  locale: string,
  fields: readonly K[],
): T {
  const overlay = translationFor(translations, locale);
  if (Object.keys(overlay).length === 0) return row;

  const patch: Partial<Record<K, string>> = {};
  for (const field of fields) {
    const value = overlay[field];
    if (value !== undefined) patch[field] = value;
  }

  return Object.keys(patch).length === 0 ? row : { ...row, ...patch };
}

/* ---------------------------------------------------------------------------
 * Writing
 * ------------------------------------------------------------------------ */

export type TranslationRefusal = 'UNKNOWN_FIELD' | 'TOO_LONG';

/**
 * What may be translated on each kind of row, and how long each may be.
 *
 * The caps mirror the French column's own, because a translation that does not
 * fit where the original does is a layout bug waiting for a visitor who reads
 * English. A field absent from this list cannot be written by the form at all —
 * the same rule `domain/settings` applies to settings, and for the same reason:
 * the payload names the field.
 */
export const TRANSLATABLE_FIELDS = {
  product: {
    name: 120,
    subtitle: 160,
    description: 4000,
    material: 2000,
    careInstructions: 2000,
    embroideryDetails: 2000,
    seoTitle: 120,
    seoDescription: 320,
  },
  category: {
    name: 60,
    description: 600,
    seoTitle: 120,
    seoDescription: 320,
  },
  gallery: {
    title: 160,
    description: 2000,
    alt: 200,
  },
  banner: {
    message: 200,
  },
} as const satisfies Record<string, Record<string, number>>;

export type TranslatableKind = keyof typeof TRANSLATABLE_FIELDS;

export function translatableFields(
  kind: TranslatableKind,
): readonly (keyof (typeof TRANSLATABLE_FIELDS)[TranslatableKind] & string)[] {
  return Object.keys(TRANSLATABLE_FIELDS[kind]) as never;
}

/**
 * Check a submitted overlay, and refuse rather than truncate.
 *
 * Returns a message per bad field, keyed the way every other form in this
 * application keys its errors, so the screen can mark each one where it stands.
 */
export function validateTranslation(
  kind: TranslatableKind,
  values: Readonly<Record<string, string>>,
): Readonly<Record<string, TranslationRefusal>> {
  const limits: Record<string, number> = TRANSLATABLE_FIELDS[kind];
  const refusals: Record<string, TranslationRefusal> = {};

  for (const [field, value] of Object.entries(values)) {
    const max = limits[field];

    if (max === undefined) {
      refusals[field] = 'UNKNOWN_FIELD';
      continue;
    }

    if (value.trim().length > max) refusals[field] = 'TOO_LONG';
  }

  return refusals;
}

/**
 * Fold a submitted overlay into the column that is already there.
 *
 * Three rules, all of them about not losing work:
 *
 *   * **A blank field is a removal**, not an empty translation. Clearing the
 *     English name in the form should give the visitor the French one back.
 *   * **A locale with nothing left in it is removed**, so the column holds
 *     `null` rather than `{"en":{}}` once the last field is cleared.
 *   * **Other locales are untouched.** The form edits one language at a time,
 *     and saving English must not be a way to lose a third language that is not
 *     on the screen.
 */
export function mergeTranslation(
  existing: unknown,
  locale: string,
  kind: TranslatableKind,
  values: Readonly<Record<string, string>>,
): Record<string, Record<string, string>> | null {
  const all = asRecord(existing);
  const next: Record<string, Record<string, string>> = {};

  for (const [key, value] of Object.entries(all)) {
    if (key === locale) continue;
    const overlay = translationFor({ [key]: value }, key);
    if (Object.keys(overlay).length > 0) next[key] = { ...overlay };
  }

  const limits: Record<string, number> = TRANSLATABLE_FIELDS[kind];
  const overlay: Record<string, string> = {};

  for (const [field, value] of Object.entries(values)) {
    if (!(field in limits)) continue;

    const text = usable(value);
    if (text !== null) overlay[field] = text;
  }

  if (Object.keys(overlay).length > 0) next[locale] = overlay;

  return Object.keys(next).length === 0 ? null : next;
}

/**
 * How much of a row has been translated, for the workshop's own list.
 *
 * "Translated" is not a boolean — a product with an English name and no English
 * description is genuinely half done, and a screen that reports it as "no"
 * hides the work already spent. The count is over the fields that *have* a
 * French value, because translating an empty column is not work owed.
 */
export function translationProgress(input: {
  row: Readonly<Record<string, unknown>>;
  translations: unknown;
  locale: string;
  kind: TranslatableKind;
}): { done: number; total: number } {
  const overlay = translationFor(input.translations, input.locale);
  const fields = Object.keys(TRANSLATABLE_FIELDS[input.kind]);

  const owed = fields.filter((field) => usable(input.row[field]) !== null);
  const done = owed.filter((field) => overlay[field] !== undefined);

  return { done: done.length, total: owed.length };
}
