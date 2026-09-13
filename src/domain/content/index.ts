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

/** The eleven members of the database enum, in their declaration order. */
export const HOMEPAGE_SECTION_TYPES: readonly HomepageSectionType[] = [
  'HERO',
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
