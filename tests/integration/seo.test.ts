/**
 * `sitemap.xml` and `robots.txt`, against the real database.
 *
 * A sitemap is the one artefact that hands a crawler a list of URLs and asks it
 * to fetch every one. Everything here is therefore an exclusion test: the
 * seeded draft product must not be in it, an unpublished gallery item must not
 * be in it, a soft-deleted one must not be in it, and no account, admin, cart,
 * checkout or order path may appear however the routes change.
 *
 * The deployment-wide indexing switch is exercised in both positions. It is
 * read once at module scope, so flipping it means importing the modules afresh
 * — which is what `withSeo` does.
 */

import type { MetadataRoute } from 'next';

import dotenv from 'dotenv';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

dotenv.config({ path: ['.env.local', '.env'], quiet: true });

const { prisma } = await import('../../src/lib/db/client');

const DRAFT_SLUG = 'echantillon-interne-non-publie';
const PREFIX = `phase14-seo-${Date.now()}`;

const createdGallerySlugs: string[] = [];

/**
 * Load the sitemap and robots modules under a given indexing setting.
 *
 * `vi.resetModules()` is what makes this honest: `lib/seo` reads the variable
 * once, so a test that only changed `process.env` would be asserting against
 * the value the first import happened to see.
 */
async function withSeo<T>(
  indexable: boolean,
  read: (modules: {
    sitemap: () => Promise<MetadataRoute.Sitemap>;
    robots: () => MetadataRoute.Robots;
  }) => Promise<T>,
): Promise<T> {
  const previous = process.env.SEO_INDEXABLE;
  process.env.SEO_INDEXABLE = indexable ? 'true' : 'false';

  vi.resetModules();

  try {
    const sitemapModule = await import('../../src/app/sitemap');
    const robotsModule = await import('../../src/app/robots');

    return await read({
      sitemap: sitemapModule.default,
      robots: robotsModule.default,
    });
  } finally {
    if (previous === undefined) delete process.env.SEO_INDEXABLE;
    else process.env.SEO_INDEXABLE = previous;

    vi.resetModules();
  }
}

async function createGalleryItem(input: {
  slug: string;
  isPublished: boolean;
  deleted?: boolean;
}): Promise<void> {
  await prisma.galleryItem.create({
    data: {
      slug: input.slug,
      title: `Réalisation ${input.slug}`,
      imageKey: `gallery/${input.slug}.jpg`,
      alt: 'Une pièce brodée',
      isPublished: input.isPublished,
      ...(input.deleted ? { deletedAt: new Date() } : {}),
    },
  });

  createdGallerySlugs.push(input.slug);
}

const PUBLISHED = `${PREFIX}-published`;
const UNPUBLISHED = `${PREFIX}-unpublished`;
const REMOVED = `${PREFIX}-removed`;

beforeAll(async () => {
  await createGalleryItem({ slug: PUBLISHED, isPublished: true });
  await createGalleryItem({ slug: UNPUBLISHED, isPublished: false });
  await createGalleryItem({ slug: REMOVED, isPublished: true, deleted: true });
});

afterAll(async () => {
  await prisma.galleryItem.deleteMany({ where: { slug: { in: createdGallerySlugs } } });
});

afterEach(() => {
  vi.resetModules();
});

describe('the sitemap', () => {
  it('lists the public routes and the published records', async () => {
    const urls = await withSeo(true, async ({ sitemap }) =>
      (await sitemap()).map((entry) => entry.url),
    );

    const origin = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

    // Every page is listed once per language, because both are real pages a
    // crawler should find (ADR-030). The `hreflang` alternates below are what
    // tell it they are one page in two languages.
    for (const locale of ['fr', 'en']) {
      expect(urls).toContain(`${origin}/${locale}`);
      expect(urls).toContain(`${origin}/${locale}/shop`);
      expect(urls).toContain(`${origin}/${locale}/custom`);
      expect(urls).toContain(`${origin}/${locale}/gallery`);
      expect(urls).toContain(`${origin}/${locale}/gallery/${PUBLISHED}`);
    }

    // Every entry is absolute and on this origin — a relative or foreign URL in
    // a sitemap is silently ignored by a crawler.
    for (const url of urls) expect(url.startsWith(origin)).toBe(true);
  });

  it('excludes the seeded draft product', async () => {
    const urls = await withSeo(true, async ({ sitemap }) =>
      (await sitemap()).map((entry) => entry.url),
    );

    // The product exists and is deliberately unpublished.
    const draft = await prisma.product.findFirst({
      where: { slug: DRAFT_SLUG },
      select: { status: true },
    });

    expect(draft?.status).toBe('DRAFT');
    expect(urls.some((url) => url.includes(DRAFT_SLUG))).toBe(false);
  });

  it('excludes an unpublished and a deleted gallery item', async () => {
    const urls = await withSeo(true, async ({ sitemap }) =>
      (await sitemap()).map((entry) => entry.url),
    );

    expect(urls.some((url) => url.includes(UNPUBLISHED))).toBe(false);
    expect(urls.some((url) => url.includes(REMOVED))).toBe(false);
  });

  it('contains no private, parameterised or duplicate URL', async () => {
    const urls = await withSeo(true, async ({ sitemap }) =>
      (await sitemap()).map((entry) => entry.url),
    );

    for (const path of [
      '/admin',
      '/account',
      '/cart',
      '/checkout',
      '/order',
      '/login',
      '/register',
      '/api',
      '/dev',
    ]) {
      expect(urls.some((url) => url.includes(path))).toBe(false);
    }

    // No query strings, and no URL listed twice.
    for (const url of urls) expect(url).not.toContain('?');
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('carries a real modification date for each record', async () => {
    const entries = await withSeo(true, async ({ sitemap }) => sitemap());
    const origin = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

    const entry = entries.find((row) => row.url === `${origin}/fr/gallery/${PUBLISHED}`);
    const stored = await prisma.galleryItem.findFirstOrThrow({
      where: { slug: PUBLISHED },
      select: { updatedAt: true },
    });

    expect(entry?.lastModified).toEqual(stored.updatedAt);
  });

  it('names each page in both languages, and a default', async () => {
    const entries = await withSeo(true, async ({ sitemap }) => sitemap());
    const origin = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

    const french = entries.find((row) => row.url === `${origin}/fr/shop`);

    expect(french?.alternates?.languages).toEqual({
      fr: `${origin}/fr/shop`,
      en: `${origin}/en/shop`,
      'x-default': `${origin}/fr/shop`,
    });
  });

  it('is empty while the deployment is not indexable', async () => {
    const urls = await withSeo(false, async ({ sitemap }) => sitemap());

    expect(urls).toEqual([]);
  });
});

describe('robots.txt', () => {
  it('allows the storefront and disallows every application surface', async () => {
    const rules = await withSeo(true, async ({ robots }) => robots());

    const rule = Array.isArray(rules.rules) ? rules.rules[0] : rules.rules;
    const disallow = rule?.disallow;
    const disallowed = Array.isArray(disallow) ? disallow : disallow ? [disallow] : [];

    expect(rule?.allow).toBe('/');

    for (const path of [
      '/admin',
      '/account',
      '/cart',
      '/checkout',
      '/login',
      '/register',
      '/order',
      '/api',
      '/dev',
    ]) {
      expect(disallowed).toContain(path);
    }

    // And not the pages that must be crawlable.
    for (const path of ['/shop', '/gallery', '/custom', '/']) {
      expect(disallowed).not.toContain(path);
    }
  });

  it('points at the sitemap on the configured origin', async () => {
    const rules = await withSeo(true, async ({ robots }) => robots());
    const origin = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

    expect(rules.sitemap).toBe(`${origin}/sitemap.xml`);
  });

  it('disallows everything while the deployment is not indexable', async () => {
    const rules = await withSeo(false, async ({ robots }) => robots());

    const rule = Array.isArray(rules.rules) ? rules.rules[0] : rules.rules;

    expect(rule?.disallow).toBe('/');
    expect(rules.sitemap).toBeUndefined();
  });
});

describe('what feeds the sitemap', () => {
  it('uses the storefront’s own visibility predicate, not a copy of it', async () => {
    const { listProductsForSitemap, listPublishedProducts } =
      await import('../../src/server/repositories/catalogue-repository');

    const [sitemapProducts, listed] = await Promise.all([
      listProductsForSitemap(),
      listPublishedProducts({ limit: 24 }),
    ]);

    const sitemapSlugs = new Set(sitemapProducts.map((product) => product.slug));

    // Everything the shop lists is in the sitemap. The reverse is not asserted:
    // the listing is paginated and the sitemap is not.
    for (const product of listed) expect(sitemapSlugs.has(product.slug)).toBe(true);
  });
});
