import { MAX_SECTION_ITEMS, type HomepageSectionType } from '@/domain/content';

/**
 * What each band lets the owner change, and what counts as a valid answer.
 *
 * The homepage is data (ADR-027) and its `config` is a JSON column, which is
 * exactly the shape that rots: the renderer reads `config.limit`, the editor
 * offers a field called `limit`, and the two agree only as long as somebody
 * keeps them in step by hand.
 *
 * So the fields are **declared once, here**, and both sides read this list. The
 * editor renders a control per entry; the service validates the submitted value
 * per entry and refuses anything that is not in the list at all. A band type
 * that gains a setting gains it in one place.
 *
 * Pure data and pure functions: no Prisma, no React, no request. The editor
 * screen is a rendering of this file.
 */

export type ConfigFieldKind = 'text' | 'longText' | 'count' | 'flag' | 'image' | 'points';

export type ConfigField = {
  name: string;
  kind: ConfigFieldKind;
  /** Bounds for `count`; ignored otherwise. */
  max?: number;
};

const EYEBROW: ConfigField = { name: 'eyebrow', kind: 'text' };
const LIMIT: ConfigField = { name: 'limit', kind: 'count', max: MAX_SECTION_ITEMS };

/**
 * The eleven band types and their settings.
 *
 * `BANNER` has none of its own: it renders the promotional strip, which is its
 * own table and its own editor. It is in the list because it is a band that can
 * be positioned and switched off like any other.
 */
export const SECTION_FIELDS: Record<HomepageSectionType, readonly ConfigField[]> = {
  BANNER: [],
  HERO: [
    EYEBROW,
    { name: 'note', kind: 'text' },
    { name: 'secondaryCtaLabel', kind: 'text' },
    { name: 'secondaryCtaHref', kind: 'text' },
    { name: 'imageKey', kind: 'image' },
    { name: 'imageAlt', kind: 'text' },
  ],
  HOW_IT_WORKS: [EYEBROW, { name: 'points', kind: 'points' }],
  CATEGORY_GRID: [EYEBROW, LIMIT],
  FEATURED_PRODUCTS: [EYEBROW, LIMIT],
  GALLERY: [EYEBROW, LIMIT],
  WHY_US: [
    EYEBROW,
    { name: 'showDelivery', kind: 'flag' },
    { name: 'points', kind: 'points' },
  ],
  REVIEWS: [EYEBROW, LIMIT],
  SOCIAL: [EYEBROW],
  CUSTOM_CTA: [EYEBROW],
  FINAL_CTA: [EYEBROW],
};

/**
 * Which bands render a button.
 *
 * The columns exist on every row — they are the same table — but only these
 * types read them. Offering the field on a band that ignores it is offering a
 * control that does nothing, which is how an editor teaches people not to trust
 * it.
 */
export const SECTION_HAS_CTA: Record<HomepageSectionType, boolean> = {
  BANNER: false,
  HERO: true,
  HOW_IT_WORKS: false,
  CATEGORY_GRID: true,
  FEATURED_PRODUCTS: true,
  GALLERY: true,
  WHY_US: false,
  REVIEWS: false,
  SOCIAL: false,
  CUSTOM_CTA: true,
  FINAL_CTA: true,
};

/* ---------------------------------------------------------------------------
 * Limits
 * ------------------------------------------------------------------------ */

export const SECTION_TITLE_MAX = 120;
export const SECTION_SUBTITLE_MAX = 160;
export const SECTION_BODY_MAX = 600;
export const SECTION_CTA_MAX = 40;
export const SECTION_TEXT_MAX = 200;
export const BANNER_MESSAGE_MAX = 200;

export type SectionField =
  'title' | 'subtitle' | 'body' | 'ctaLabel' | 'ctaHref' | 'config' | 'form';

export type SectionErrors = Partial<Record<SectionField, string>>;

/**
 * A link the front page may point at.
 *
 * Internal, absolute-from-root, and without a language prefix — `Link` adds the
 * visitor's own. An external URL is refused rather than accepted: a homepage
 * band that sends people off-site is not a thing this shop does, and the field
 * is one paste away from being an advertisement somebody else wrote.
 *
 * `//evil.example` is the case worth naming: a browser reads it as a
 * protocol-relative *external* URL, and a naive "starts with /" check lets it
 * through.
 */
export function isInternalHref(href: string): boolean {
  if (!href.startsWith('/')) return false;
  if (href.startsWith('//')) return false;
  if (/^\/(fr|en)(\/|$)/.test(href)) return false;

  return true;
}

export type SectionDraft = {
  type: HomepageSectionType;
  title: string | null;
  subtitle: string | null;
  body: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  config: Record<string, unknown>;
};

/**
 * Whether a submitted band may be written.
 *
 * Length limits are the boring half. The interesting half is that a value is
 * only accepted for a field the band type actually declares: a payload naming
 * `limit` on the hero, or `imageKey` on the reviews band, is a payload that was
 * not produced by the editor, and it is dropped rather than stored. Storing it
 * would be harmless today and a surprise the day a renderer starts reading that
 * key.
 */
export function validateSectionDraft(draft: SectionDraft): SectionErrors {
  const errors: SectionErrors = {};

  const tooLong = (value: string | null, max: number): boolean =>
    value !== null && value.length > max;

  if (tooLong(draft.title, SECTION_TITLE_MAX)) errors.title = 'TITLE_TOO_LONG';
  if (tooLong(draft.subtitle, SECTION_SUBTITLE_MAX))
    errors.subtitle = 'SUBTITLE_TOO_LONG';
  if (tooLong(draft.body, SECTION_BODY_MAX)) errors.body = 'BODY_TOO_LONG';
  if (tooLong(draft.ctaLabel, SECTION_CTA_MAX)) errors.ctaLabel = 'CTA_TOO_LONG';

  if (draft.ctaHref !== null && !isInternalHref(draft.ctaHref)) {
    errors.ctaHref = 'HREF_NOT_INTERNAL';
  }

  // A button with a destination and no words, or words and no destination, is
  // half a control. Either both or neither.
  if ((draft.ctaLabel === null) !== (draft.ctaHref === null)) {
    errors.ctaLabel = 'CTA_INCOMPLETE';
  }

  const declared = new Map(
    SECTION_FIELDS[draft.type].map((field) => [field.name, field]),
  );

  for (const [key, value] of Object.entries(draft.config)) {
    // The translation overlay is not a config field; it is checked below.
    if (key === 'en' || key === 'fr') continue;

    const field = declared.get(key);
    if (!field) {
      errors.config = 'UNKNOWN_FIELD';
      continue;
    }

    if (field.kind === 'count') {
      if (!Number.isInteger(value) || (value as number) < 1) {
        errors.config = 'COUNT_INVALID';
      } else if (field.max !== undefined && (value as number) > field.max) {
        errors.config = 'COUNT_TOO_LARGE';
      }
      continue;
    }

    if (field.kind === 'flag') {
      if (typeof value !== 'boolean') errors.config = 'FLAG_INVALID';
      continue;
    }

    if (field.kind === 'points') {
      if (!Array.isArray(value) || value.length > MAX_SECTION_ITEMS) {
        errors.config = 'POINTS_INVALID';
      }
      continue;
    }

    if (value !== null && typeof value !== 'string') {
      errors.config = 'TEXT_INVALID';
      continue;
    }

    if (typeof value === 'string' && value.length > SECTION_TEXT_MAX) {
      errors.config = 'TEXT_TOO_LONG';
    }

    if (
      field.name.endsWith('Href') &&
      typeof value === 'string' &&
      value !== '' &&
      !isInternalHref(value)
    ) {
      errors.config = 'HREF_NOT_INTERNAL';
    }
  }

  return errors;
}

export function hasSectionErrors(errors: SectionErrors): boolean {
  return Object.keys(errors).length > 0;
}

export function validateBanner(input: {
  message: string;
  href: string | null;
}): 'MESSAGE_EMPTY' | 'MESSAGE_TOO_LONG' | 'HREF_NOT_INTERNAL' | null {
  const message = input.message.trim();

  if (message.length === 0) return 'MESSAGE_EMPTY';
  if (message.length > BANNER_MESSAGE_MAX) return 'MESSAGE_TOO_LONG';
  if (input.href !== null && !isInternalHref(input.href)) return 'HREF_NOT_INTERNAL';

  return null;
}
