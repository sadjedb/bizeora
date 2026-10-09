/**
 * Storefront content: the homepage, as data.
 *
 * `ROADMAP.md` Phase 13 asks that "homepage section types all [be] implemented
 * and reorderable", and `DATABASE.md` section 13 supplies the shape: a
 * `homepage_sections` row per band, ordered by `position`, switched by
 * `isEnabled`, with the columns every band shares (`title`, `subtitle`, `body`,
 * `ctaLabel`, `ctaHref`, `imageKey`) and one `config` JSON column for the
 * extras that differ per type. That column is described there as "purely
 * presentational … nothing in `config` is ever queried or joined on", and this
 * file is what keeps that promise honest.
 *
 * The parsing rule throughout: **a malformed `config` must never break the
 * homepage.** Every reader returns a well-formed value with sensible defaults
 * rather than throwing, because the alternative is that one bad JSON edit takes
 * the front page down. What a bad value costs is a section that renders with
 * less in it, which is visible and fixable.
 *
 * Pure: no database, no React, no environment. The renderer decides what a
 * `HERO` looks like; this decides what a `HERO` *is*.
 */

export type HomepageSectionType =
  | 'HERO'
  | 'MARQUEE'
  | 'CATEGORY_GRID'
  | 'HOW_IT_WORKS'
  | 'CUSTOM_CTA'
  | 'FEATURED_PRODUCTS'
  | 'GALLERY'
  | 'WHY_US'
  | 'REVIEWS'
  | 'SOCIAL'
  | 'BANNER'
  | 'FINAL_CTA';

/** The twelve members of the database enum, in their declaration order. */
export const HOMEPAGE_SECTION_TYPES: readonly HomepageSectionType[] = [
  'HERO',
  'MARQUEE',
  'CATEGORY_GRID',
  'HOW_IT_WORKS',
  'CUSTOM_CTA',
  'FEATURED_PRODUCTS',
  'GALLERY',
  'WHY_US',
  'REVIEWS',
  'SOCIAL',
  'BANNER',
  'FINAL_CTA',
];

export function isHomepageSectionType(value: string): value is HomepageSectionType {
  return (HOMEPAGE_SECTION_TYPES as readonly string[]).includes(value);
}

/** A row of `homepage_sections`, as the repository hands it over. */
export type HomepageSection = {
  id: string;
  type: HomepageSectionType;
  position: number;
  isEnabled: boolean;
  title: string | null;
  subtitle: string | null;
  body: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  imageKey: string | null;
  config: unknown;
};

/**
 * The sections to render, in order.
 *
 * Disabled rows are dropped here rather than in the query so that the ordering
 * rule and the enabling rule sit together and are tested together. `position`
 * ascending, ties broken by id so the order is total — two sections sharing a
 * position must not swap places between requests.
 */
export function orderedSections(
  sections: readonly HomepageSection[],
): readonly HomepageSection[] {
  return sections
    .filter((section) => section.isEnabled)
    .slice()
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

/* ---------------------------------------------------------------------------
 * Reading `config`
 * ------------------------------------------------------------------------ */

/**
 * The same band, in another language.
 *
 * The homepage is data (ADR-027), and data has one column per field rather than
 * one per language. Rather than a migration for a table nobody has an editor
 * for yet, a row carries its translations **inside its own `config`**, under
 * the locale's own key:
 *
 * ```json
 * { "eyebrow": "L’atelier", "en": { "title": "The thread makes the difference." } }
 * ```
 *
 * The overlay is merged over both the row's translatable columns and its
 * `config`, so every existing parser below reads the translated values without
 * knowing this function exists. Anything the overlay does not mention keeps the
 * French — a half-translated band reads better than an empty one.
 *
 * This covers the copy the shop writes about itself. It does **not** translate
 * the catalogue: product names, descriptions and gallery captions are their own
 * rows, and giving them a language is a schema change (`PRODUCT.md`).
 */
export function localiseSection(
  section: HomepageSection,
  locale: string,
): HomepageSection {
  const config = record(section.config);
  const overlay = record(config[locale]);

  if (Object.keys(overlay).length === 0) return section;

  // The overlay is spread over the French config; the locale key itself is
  // dropped so a parser never sees a band nested inside a band.
  const merged: Record<string, unknown> = { ...config, ...overlay };
  delete merged[locale];

  return {
    ...section,
    title: text(overlay.title) ?? section.title,
    subtitle: text(overlay.subtitle) ?? section.subtitle,
    body: text(overlay.body) ?? section.body,
    ctaLabel: text(overlay.ctaLabel) ?? section.ctaLabel,
    config: merged,
  };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * A bounded count.
 *
 * Bounded because `limit` reaches a database query: a section configured with
 * `{"limit": 100000}` would otherwise be a way to make the homepage read the
 * whole catalogue. Out-of-range and non-numeric both fall back to `fallback`.
 */
function count(value: unknown, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return fallback;
  if (value < 1 || value > max) return fallback;

  return value;
}

export const MAX_SECTION_ITEMS = 12;

/** A `{ title, body }` list, used by `HOW_IT_WORKS` and `WHY_US`. */
export type ContentPoint = {
  title: string;
  body: string;
  /** A name from the renderer's closed icon set; anything else renders none. */
  icon: string | null;
};

function points(value: unknown): readonly ContentPoint[] {
  if (!Array.isArray(value)) return [];

  const parsed: ContentPoint[] = [];

  for (const entry of value.slice(0, MAX_SECTION_ITEMS)) {
    const fields = record(entry);
    const title = text(fields.title);
    const body = text(fields.body);

    // A point with no title is not a point. Skipping it keeps the rest of the
    // list rendering rather than failing the whole section.
    if (title === null) continue;

    parsed.push({ title, body: body ?? '', icon: text(fields.icon) });
  }

  return parsed;
}

/** Extras every section may carry. */
export type CommonConfig = {
  /** The small label above the heading (`Overline` in the design system). */
  eyebrow: string | null;
};

export type ListConfig = CommonConfig & { limit: number };

export type PointsConfig = CommonConfig & { points: readonly ContentPoint[] };

export type HeroConfig = CommonConfig & {
  note: string | null;
  secondaryCtaLabel: string | null;
  secondaryCtaHref: string | null;
  /**
   * The storage key of the photograph behind the hero, if there is one.
   *
   * A **key**, never a URL: what it resolves to is `lib/media`'s decision, and
   * a content row that could name an arbitrary URL is a content row that can
   * point the front page at somebody else's server. With no key — or with no
   * public asset origin configured — the band falls back to its split layout
   * and the drawn placeholder, which is what it did before any photography
   * existed.
   */
  imageKey: string | null;
  /** Describes the photograph. Empty when it is decorative (section 14). */
  imageAlt: string | null;
};

export type WhyUsConfig = PointsConfig & {
  /**
   * Whether to append a delivery card built from the shipping zones.
   *
   * `ROADMAP.md` asks for "delivery information" as a trust element, and a
   * delivery promise typed into a content row is a promise nobody checks
   * against the rates the checkout actually charges. So the card is rendered
   * from `shipping_rates` instead, and this flag only decides whether it
   * appears.
   */
  showDelivery: boolean;
};

export function commonConfig(config: unknown): CommonConfig {
  return { eyebrow: text(record(config).eyebrow) };
}

export function heroConfig(config: unknown): HeroConfig {
  const fields = record(config);

  return {
    eyebrow: text(fields.eyebrow),
    note: text(fields.note),
    secondaryCtaLabel: text(fields.secondaryCtaLabel),
    secondaryCtaHref: text(fields.secondaryCtaHref),
    imageKey: text(fields.imageKey),
    imageAlt: text(fields.imageAlt),
  };
}

export function listConfig(config: unknown, fallback: number): ListConfig {
  const fields = record(config);

  return {
    eyebrow: text(fields.eyebrow),
    limit: count(fields.limit, fallback, MAX_SECTION_ITEMS),
  };
}

export function pointsConfig(config: unknown): PointsConfig {
  const fields = record(config);

  return { eyebrow: text(fields.eyebrow), points: points(fields.points) };
}

export function whyUsConfig(config: unknown): WhyUsConfig {
  const fields = record(config);

  return {
    ...pointsConfig(config),
    showDelivery: fields.showDelivery === true,
  };
}

/* ---------------------------------------------------------------------------
 * The marquee
 * ------------------------------------------------------------------------ */

/**
 * The most words a marquee may carry.
 *
 * The strip renders its content twice to make the loop seamless, and its
 * duration scales with the text, so a band with fifty phrases in it is both a
 * very long DOM and a strip that takes two minutes to come round. Twelve is
 * more than any real one needs.
 */
export const MAX_MARQUEE_WORDS = 12;

/** The most characters one phrase may be. It is a strip, not a sentence. */
const MAX_MARQUEE_WORD_LENGTH = 48;

export type MarqueeConfig = { words: readonly string[] };

/**
 * The marquee's phrases, one per line.
 *
 * **One `longText` field split on newlines, rather than a repeater control.**
 * The admin's form generator already has a textarea, and a marquee is a list of
 * three-word phrases: a dedicated editor with an add button and a delete button
 * per row would be more code and worse to type into. One per line is also how
 * somebody would write the list down on paper.
 *
 * Blank lines are dropped rather than rendered, because a trailing newline is
 * what a textarea gives you for free and an empty item in the strip is a gap
 * nobody can explain.
 */
export function marqueeConfig(config: unknown): MarqueeConfig {
  const raw = record(config).words;
  if (typeof raw !== 'string') return { words: [] };

  const words = raw
    .split('\n')
    .map((word) => word.trim())
    .filter((word) => word !== '')
    .map((word) => word.slice(0, MAX_MARQUEE_WORD_LENGTH))
    .slice(0, MAX_MARQUEE_WORDS);

  return { words };
}

/* ---------------------------------------------------------------------------
 * What each enabled section needs loading
 * ------------------------------------------------------------------------ */

/**
 * The data a section type depends on.
 *
 * The homepage composes itself from whichever sections are enabled, and each
 * one needs a different query. Declaring the dependency here means the loader
 * asks for exactly what the enabled sections need — a homepage with the gallery
 * band switched off does not query the gallery — without the loader knowing
 * what a `GALLERY` band looks like.
 */
export type SectionDataNeed =
  'products' | 'categories' | 'gallery' | 'reviews' | 'social' | 'banners' | 'delivery';

export function dataNeeds(section: HomepageSection): readonly SectionDataNeed[] {
  switch (section.type) {
    case 'FEATURED_PRODUCTS':
      return ['products'];
    case 'CATEGORY_GRID':
      return ['categories'];
    case 'GALLERY':
      return ['gallery'];
    case 'REVIEWS':
      return ['reviews'];
    case 'SOCIAL':
      return ['social'];
    case 'BANNER':
      return ['banners'];
    case 'WHY_US':
      return whyUsConfig(section.config).showDelivery ? ['delivery'] : [];
    default:
      return [];
  }
}

/** The union of everything the enabled sections need. */
export function collectDataNeeds(
  sections: readonly HomepageSection[],
): ReadonlySet<SectionDataNeed> {
  const needs = new Set<SectionDataNeed>();

  for (const section of sections) {
    for (const need of dataNeeds(section)) needs.add(need);
  }

  return needs;
}

/* ---------------------------------------------------------------------------
 * Banners
 * ------------------------------------------------------------------------ */

export type Banner = {
  id: string;
  message: string;
  href: string | null;
  variant: string | null;
  startsAt: Date;
  endsAt: Date | null;
  isActive: boolean;
  position: number;
};

/**
 * Which banners are live right now.
 *
 * The window is `[startsAt, endsAt)` — a banner whose end has arrived is over,
 * which is what an end date means. A null end runs until it is switched off.
 */
export function activeBanners(banners: readonly Banner[], now: Date): readonly Banner[] {
  return banners
    .filter(
      (banner) =>
        banner.isActive &&
        banner.startsAt.getTime() <= now.getTime() &&
        (banner.endsAt === null || banner.endsAt.getTime() > now.getTime()),
    )
    .slice()
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

/* -------------------------------------------------------------------------
 * The accented word
 * ---------------------------------------------------------------------- */

/**
 * One segment of a heading: a run of plain text, or the emphasised run.
 */
export type HeadingSegment = { text: string; accent: boolean };

/**
 * Split a heading on its `*emphasised*` word.
 *
 * `DESIGN-SYSTEM.md` section 3 makes one word per headline the storefront's
 * loudest typographic move — set in italic with Fraunces' `WONK` axis, in the
 * accent colour. The question this function answers is *which* word, and the
 * answer has to be **content**, not code: the headings live in
 * `homepage_sections` and are written by the owner, in two languages, and the
 * emphasised word is rarely in the same position in both. "Vos idées,
 * *brodées*." and "Your idea, *embroidered*." do not agree about which word is
 * last, let alone which is third.
 *
 * So the convention is a single pair of asterisks, the one piece of markup this
 * system has:
 *
 *     Vos idées, *brodées.*   ->   [ 'Vos idées, ', accent 'brodées.' ]
 *
 * Deliberately **not** Markdown. Nothing else is interpreted — no bold, no
 * links, no lists — because a heading field that renders arbitrary markup is a
 * heading field somebody eventually puts an image in. One pair of asterisks, one
 * emphasis, everything else literal.
 *
 * A heading with no asterisks, an unclosed pair, or an empty `**` comes back as
 * a single plain segment, so a typo degrades to the heading as typed rather
 * than to a broken page or a stray asterisk.
 */
export function headingSegments(value: string | null): readonly HeadingSegment[] {
  if (!value) return [];

  const open = value.indexOf('*');
  if (open === -1) return [{ text: value, accent: false }];

  const close = value.indexOf('*', open + 1);
  // An unclosed asterisk is a typo, not markup. Show what was typed.
  if (close === -1) return [{ text: value, accent: false }];

  const accent = value.slice(open + 1, close);
  if (accent.trim() === '') return [{ text: value, accent: false }];

  return [
    { text: value.slice(0, open), accent: false },
    { text: accent, accent: true },
    { text: value.slice(close + 1), accent: false },
    // A heading is "word *word*" far more often than "*word* word", so the
    // empty outer segments are common and must not render as empty elements.
  ].filter((segment) => segment.text !== '');
}

/**
 * The heading with its markup removed.
 *
 * For anywhere a heading is a *string* rather than a rendering — a `title`
 * attribute, an `aria-label`, metadata, structured data. Emitting
 * "Vos idées, *brodées.*" into a `<title>` would put an asterisk in a search
 * result.
 */
export function plainHeading(value: string | null): string | null {
  if (!value) return null;

  return headingSegments(value)
    .map((segment) => segment.text)
    .join('');
}
