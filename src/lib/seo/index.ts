import 'server-only';

import type { Metadata } from 'next';

import { brand } from '@/config/brand';
import { clientEnv, serverEnv } from '@/lib/env';
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_TAGS,
  OG_LOCALES,
  localePath,
  type Locale,
} from '@/i18n/locales';

/**
 * The one place a public URL is built.
 *
 * Every canonical, every `sitemap.xml` entry, every `og:url` and every JSON-LD
 * `url` resolves through here, against `NEXT_PUBLIC_SITE_URL`. Not because
 * absolute URLs are hard, but because a second way of building them is how a
 * canonical ends up pointing at `localhost` in production, or at `http` on an
 * `https` site — a mistake nobody sees until the pages stop ranking.
 *
 * There is no production domain written anywhere in this module.
 */

/** The configured origin, with no trailing slash (the env schema enforces that). */
export const siteOrigin = clientEnv.NEXT_PUBLIC_SITE_URL;

/**
 * An absolute URL for a path inside this site.
 *
 * Query strings are dropped on purpose: a canonical is the address of the
 * *thing*, and a filtered or sorted view of a listing is the same thing seen
 * differently. `/gallery?productType=Polo` canonicalises to `/gallery`, which
 * is what `ROADMAP.md` means by "parameterised filter pages canonicalised to
 * the base listing".
 */
export function absoluteUrl(path: string, locale?: Locale): string {
  const [withoutQuery = '/'] = path.split('?');
  const normalised = withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;

  /*
   * A public page's URL carries its language.
   *
   * `locale` is optional so the unlocalised routes — `robots.txt`, the site
   * Open Graph image — can still build a URL. Passing it is the default for
   * anything a visitor reads, and forgetting it produces a URL that redirects
   * rather than one that 404s, which is the safer of the two failures.
   */
  const withLocale = locale === undefined ? normalised : localePath(locale, normalised);

  // The root is the origin itself; every other path keeps no trailing slash, so
  // one URL per page rather than two that differ by a character.
  if (withLocale === '/') return siteOrigin;

  return `${siteOrigin}${withLocale.replace(/\/+$/, '')}`;
}

/**
 * Every language's URL for one path, for `hreflang`.
 *
 * A bilingual site has to tell a crawler that `/fr/shop` and `/en/shop` are the
 * same page in two languages; without it they compete as duplicates. `x-default`
 * points at French, which is what a visitor with no preference is sent to.
 */
export function languageAlternates(path: string): Record<string, string> {
  const alternates: Record<string, string> = {};

  for (const locale of LOCALES) {
    alternates[LOCALE_TAGS[locale]] = absoluteUrl(path, locale);
  }

  alternates['x-default'] = absoluteUrl(path, DEFAULT_LOCALE);

  return alternates;
}

/* ---------------------------------------------------------------------------
 * Indexing
 * ------------------------------------------------------------------------ */

/**
 * Whether this deployment may be indexed at all.
 *
 * A deployment-wide switch, off unless set (`lib/env`). It gates the site the
 * way a fuse gates a circuit: with it off, every public page carries `noindex`
 * and `robots.txt` disallows everything, whatever the per-page rules below say.
 * Phase 18 turns it on at launch.
 */
export const seoIndexable: boolean = serverEnv.SEO_INDEXABLE;

/** What a public page asks of a crawler. */
export const INDEX_FOLLOW: Metadata['robots'] = {
  index: true,
  follow: true,
  googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
};

/** A private or duplicate page: not indexed, but its links are still worth following. */
export const NOINDEX_FOLLOW: Metadata['robots'] = { index: false, follow: true };

/** A page a crawler should neither index nor walk. */
export const NOINDEX_NOFOLLOW: Metadata['robots'] = {
  index: false,
  follow: false,
  nocache: true,
};

/**
 * The robots directive for a page that would like to be indexed.
 *
 * Collapses to `noindex` while the deployment-wide switch is off, so a single
 * variable is the difference between a staging copy that is invisible and a
 * production site that is not.
 */
export function publicRobots(): Metadata['robots'] {
  return seoIndexable ? INDEX_FOLLOW : NOINDEX_NOFOLLOW;
}

/* ---------------------------------------------------------------------------
 * Metadata
 * ------------------------------------------------------------------------ */

export type PublicPageMetadata = {
  title: string;
  description: string;
  /** Path, not a URL. Query strings are dropped by `absoluteUrl`. */
  path: string;
  /** An absolute, public image URL. Never a storage key, never a signed URL. */
  image?: string | null;
  /** `article` for a single piece of work; `website` for everything else. */
  type?: 'website' | 'article';
  /** Set for a filtered or otherwise duplicate view of an indexable page. */
  noindex?: boolean;
  /**
   * The language this page is being rendered in.
   *
   * Optional only so the handful of unlocalised surfaces can still use this
   * helper. Any page a visitor reads passes it, and gets a canonical inside its
   * own language plus the `hreflang` set for the others.
   */
  locale?: Locale;
};

/**
 * The metadata every public page shares, built once.
 *
 * Title, description, canonical, Open Graph and Twitter all come from the same
 * three values, so a page cannot end up with a canonical that disagrees with
 * its `og:url`, or a social card describing something else. `ROADMAP.md` Phase
 * 14 asks for the set; this is what makes it consistent rather than repeated.
 *
 * The image is optional and omitted when absent. A social card with no image is
 * a plain card; a card pointing at a URL that 404s is a broken one, and until
 * the public asset bucket exists most products have no photograph.
 */
export function publicPageMetadata(input: PublicPageMetadata): Metadata {
  const url = absoluteUrl(input.path, input.locale);
  const images = input.image ? [{ url: input.image, alt: input.title }] : undefined;
  const locale = input.locale ?? DEFAULT_LOCALE;

  return {
    title: input.title,
    description: input.description,
    alternates: {
      canonical: url,
      /*
       * Omitted on a `noindex` view. A filtered gallery canonicalises to the
       * base listing, and offering language alternates for a page that asks not
       * to be indexed tells a crawler two contradictory things.
       */
      ...(input.noindex ? {} : { languages: languageAlternates(input.path) }),
    },
    robots: input.noindex ? NOINDEX_FOLLOW : publicRobots(),
    openGraph: {
      type: input.type ?? 'website',
      siteName: brand.name,
      locale: OG_LOCALES[locale],
      title: input.title,
      description: input.description,
      url,
      ...(images ? { images } : {}),
    },
    twitter: {
      // Always the large card: a page with no photograph still inherits the
      // drawn Open Graph image from `app/opengraph-image`, so there is always a
      // 1200×630 picture to fill it.
      card: 'summary_large_image',
      title: input.title,
      description: input.description,
      ...(images ? { images: images.map((image) => image.url) } : {}),
    },
  };
}

/**
 * Metadata for a resource that does not exist, or is not public.
 *
 * A `generateMetadata` that cannot find its row must not describe the page it
 * would have been: an unknown or unpublished slug gets a plain title and
 * `noindex`, and **no canonical**, so a 404 never advertises itself as the
 * canonical address of anything.
 */
export function notFoundMetadata(title = 'Page introuvable'): Metadata {
  return { title, robots: NOINDEX_NOFOLLOW };
}
