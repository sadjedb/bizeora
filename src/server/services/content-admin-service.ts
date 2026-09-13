import 'server-only';

import { LOCALES, type Locale } from '@/i18n/locales';
import {
  SECTION_FIELDS,
  hasSectionErrors,
  validateBanner,
  validateSectionDraft,
  type SectionErrors,
} from '@/domain/content/editing';
import { movedOrder } from '@/domain/media';
import {
  createBanner,
  deleteBanner,
  findSection,
  listAllSections,
  reorderSections,
  setSectionEnabled,
  updateBanner,
  updateSection,
  type AdminSectionRow,
} from '@/server/repositories/content-admin-repository';

/**
 * Editing the front page.
 *
 * The screen submits a flat form; this turns it into the row shape the
 * storefront reads, and refuses anything the band type does not declare
 * (`domain/content/editing`).
 *
 * ## Where the second language goes
 *
 * A band's English copy lives **inside its own `config`**, under an `en` key,
 * and `localiseSection` merges it over the French at render time (ADR-030).
 * That is why this service takes two sets of the same fields and writes one
 * row: the alternative was a migration for a translations table nobody has an
 * editor for, and the overlay reaches the same place with a JSON column that
 * already existed.
 *
 * The French is the row; the English is the overlay. A field left blank in
 * English is not stored, so the band falls back to the French rather than
 * showing a gap — which is the behaviour the owner will actually want while
 * translating a page one paragraph at a time.
 */

export type SectionFormValues = {
  title: string;
  subtitle: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
  /** Values for the fields this band type declares, keyed by field name. */
  config: Record<string, string | number | boolean | readonly unknown[] | null>;
};

export type SectionSubmission = {
  sectionId: string;
  /** The row itself: the language the shop is written in. */
  fr: SectionFormValues;
  /** The overlay. Blank fields are dropped rather than stored as empty. */
  en: SectionFormValues;
};

export type SectionSaveResult = { ok: true } | { ok: false; errors: SectionErrors };

/** Trim, and treat an empty string as "not provided". */
function text(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * The config object to store: declared fields only, empties dropped.
 *
 * Dropping empties rather than storing `""` matters for the overlay: the
 * renderer falls back to the French when a key is **absent**, and an empty
 * string is present.
 */
function configFrom(
  type: AdminSectionRow['type'],
  values: SectionFormValues['config'],
): Record<string, unknown> {
  const config: Record<string, unknown> = {};

  for (const field of SECTION_FIELDS[type]) {
    const value = values[field.name];

    if (value === undefined || value === null) continue;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) config[field.name] = trimmed;
      continue;
    }

    if (Array.isArray(value) && value.length === 0) continue;

    config[field.name] = value;
  }

  return config;
}

/**
 * The English copy, as the overlay object stored under `config.en`.
 *
 * It holds both kinds of thing the renderer merges: the row's translatable
 * columns (`title`, `body`, …) and the band's own translatable settings
 * (`eyebrow`, `points`, …). Blank fields are left out rather than stored as
 * empty strings, because the renderer falls back to the French when a key is
 * **absent** and an empty string is present.
 */
function overlayFrom(
  values: SectionFormValues,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const overlay: Record<string, unknown> = { ...config };

  const title = text(values.title);
  const subtitle = text(values.subtitle);
  const body = text(values.body);
  const ctaLabel = text(values.ctaLabel);

  if (title) overlay.title = title;
  if (subtitle) overlay.subtitle = subtitle;
  if (body) overlay.body = body;
  if (ctaLabel) overlay.ctaLabel = ctaLabel;

  return overlay;
}

export async function saveSection(input: SectionSubmission): Promise<SectionSaveResult> {
  const section = await findSection(input.sectionId);
  if (!section) return { ok: false, errors: { form: 'NOT_FOUND' } };

  const config = configFrom(section.type, input.fr.config);
  const overlayConfig = configFrom(section.type, input.en.config);
  const overlay = overlayFrom(input.en, overlayConfig);

  const draft = {
    type: section.type,
    title: text(input.fr.title),
    subtitle: text(input.fr.subtitle),
    body: text(input.fr.body),
    ctaLabel: text(input.fr.ctaLabel),
    ctaHref: text(input.fr.ctaHref),
    config,
  };

  const errors = validateSectionDraft(draft);
  if (hasSectionErrors(errors)) return { ok: false, errors };

  /*
   * The English copy is validated as a band of the same type, so a translated
   * field cannot carry what the original may not — the same length limits, the
   * same closed set of settings.
   *
   * Its *config* is checked separately from its copy, because the stored
   * overlay mixes the two into one object: passing that object as a config
   * would see `title` among the settings and refuse it as an unknown field.
   * The row columns keep the row's destination, which is not translated.
   */
  const overlayErrors = validateSectionDraft({
    type: section.type,
    title: text(input.en.title),
    subtitle: text(input.en.subtitle),
    body: text(input.en.body),
    // A translated label with the row's own destination: the pair is complete
    // or absent together, exactly as the French one is.
    ctaLabel: text(input.en.ctaLabel) === null ? null : text(input.en.ctaLabel),
    ctaHref: text(input.en.ctaLabel) === null ? null : draft.ctaHref,
    config: overlayConfig,
  });

  if (hasSectionErrors(overlayErrors)) return { ok: false, errors: overlayErrors };

  const written = await updateSection(input.sectionId, {
    ...draft,
    config: Object.keys(overlay).length > 0 ? { ...config, en: overlay } : config,
  });

  return written.ok ? { ok: true } : { ok: false, errors: { form: 'NOT_FOUND' } };
}

export async function toggleSection(input: {
  sectionId: string;
  isEnabled: boolean;
}): Promise<{ ok: boolean }> {
  return setSectionEnabled(input.sectionId, input.isEnabled);
}

/** Move one band a step, computing the sequence with the same helper the gallery uses. */
export async function moveSection(input: {
  sectionId: string;
  direction: 'up' | 'down';
}): Promise<{ ok: boolean }> {
  const sections = await listAllSections();
  const next = movedOrder(sections, input.sectionId, input.direction);

  if (next === sections) return { ok: false };

  await reorderSections(next.map((section) => section.id));
  return { ok: true };
}

/* ---------------------------------------------------------------------------
 * The banner strip
 * ------------------------------------------------------------------------ */

export type BannerResult = { ok: true } | { ok: false; code: string };

export async function saveBanner(input: {
  bannerId: string | null;
  message: string;
  href: string | null;
  isActive: boolean;
}): Promise<BannerResult> {
  const refusal = validateBanner({ message: input.message, href: input.href });
  if (refusal) return { ok: false, code: refusal };

  const write = {
    message: input.message.trim(),
    href: input.href,
    isActive: input.isActive,
  };

  if (input.bannerId === null) {
    await createBanner(write);
    return { ok: true };
  }

  const written = await updateBanner(input.bannerId, write);
  return written.ok ? { ok: true } : { ok: false, code: 'NOT_FOUND' };
}

export async function removeBanner(bannerId: string): Promise<void> {
  await deleteBanner(bannerId);
}

/** Both languages, for the editor's tabs. */
export const EDITABLE_LOCALES: readonly Locale[] = LOCALES;
