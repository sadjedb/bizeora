import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as SeoModule from '@/lib/seo';

/**
 * Canonicals, robots directives and the deployment-wide indexing switch.
 *
 * The switch is why this file re-imports the module instead of calling it: it
 * is read once, at module scope, so the only honest way to test both states is
 * to set the variable and import afresh. Both states matter — a staging copy
 * that indexes itself competes with production, and a production site that does
 * not index is invisible.
 */

const REQUIRED: Record<string, string> = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/stitch',
  DIRECT_URL: 'postgresql://user:pass@localhost:5432/stitch',
  BETTER_AUTH_SECRET: 'a'.repeat(32),
};

async function withSeoEnv<T>(
  values: Record<string, string | undefined>,
  read: (seo: typeof SeoModule) => T,
): Promise<T> {
  const overrides = { ...REQUIRED, ...values };
  const previous = new Map<string, string | undefined>();

  for (const [name, value] of Object.entries(overrides)) {
    previous.set(name, process.env[name]);

    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  vi.resetModules();

  try {
    return read(await import('@/lib/seo'));
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }

    vi.resetModules();
  }
}

const ORIGIN = 'https://stitch.example';

afterEach(() => {
  vi.resetModules();
});

describe('absolute URLs', () => {
  it('are built from the configured origin, never a hard-coded domain', async () => {
    const urls = await withSeoEnv(
      { NEXT_PUBLIC_SITE_URL: ORIGIN, SEO_INDEXABLE: 'true' },
      ({ absoluteUrl }) => ({
        root: absoluteUrl('/'),
        page: absoluteUrl('/shop'),
        nested: absoluteUrl('/shop/tote-bag'),
      }),
    );

    expect(urls.root).toBe(ORIGIN);
    expect(urls.page).toBe(`${ORIGIN}/shop`);
    expect(urls.nested).toBe(`${ORIGIN}/shop/tote-bag`);
  });

  it('drop the query string, so a filtered view canonicalises to its listing', async () => {
    const url = await withSeoEnv({ NEXT_PUBLIC_SITE_URL: ORIGIN }, ({ absoluteUrl }) =>
      absoluteUrl('/gallery?productType=Polo&embroideryType=Motif'),
    );

    expect(url).toBe(`${ORIGIN}/gallery`);
  });

  it('produce one URL per page, not two that differ by a slash', async () => {
    const urls = await withSeoEnv({ NEXT_PUBLIC_SITE_URL: ORIGIN }, ({ absoluteUrl }) => [
      absoluteUrl('/shop/'),
      absoluteUrl('shop'),
      absoluteUrl('/shop'),
    ]);

    expect(new Set(urls).size).toBe(1);
  });
});

describe('a public page’s metadata', () => {
  it('carries an absolute canonical that matches its Open Graph URL', async () => {
    const metadata = await withSeoEnv(
      { NEXT_PUBLIC_SITE_URL: ORIGIN, SEO_INDEXABLE: 'true' },
      ({ publicPageMetadata }) =>
        publicPageMetadata({
          title: 'Boutique',
          description: 'Pièces brodées.',
          path: '/shop',
        }),
    );

    expect(metadata.alternates?.canonical).toBe(`${ORIGIN}/shop`);
    expect(metadata.openGraph?.url).toBe(`${ORIGIN}/shop`);
    expect(metadata.openGraph?.title).toBe('Boutique');
    expect(metadata.twitter?.title).toBe('Boutique');
  });

  it('asks to be indexed when the deployment is indexable', async () => {
    const robots = await withSeoEnv(
      { NEXT_PUBLIC_SITE_URL: ORIGIN, SEO_INDEXABLE: 'true' },
      ({ publicPageMetadata }) =>
        publicPageMetadata({ title: 'T', description: 'D', path: '/shop' }).robots,
    );

    expect(robots).toMatchObject({ index: true, follow: true });
  });

  it('asks not to be, when it is not', async () => {
    const robots = await withSeoEnv(
      { NEXT_PUBLIC_SITE_URL: ORIGIN, SEO_INDEXABLE: undefined },
      ({ publicPageMetadata }) =>
        publicPageMetadata({ title: 'T', description: 'D', path: '/shop' }).robots,
    );

    expect(robots).toMatchObject({ index: false, follow: false });
  });

  it('marks a filtered view noindex while still letting a crawler walk it', async () => {
    const metadata = await withSeoEnv(
      { NEXT_PUBLIC_SITE_URL: ORIGIN, SEO_INDEXABLE: 'true' },
      ({ publicPageMetadata }) =>
        publicPageMetadata({
          title: 'Notre travail',
          description: 'Des pièces brodées.',
          path: '/gallery',
          noindex: true,
        }),
    );

    expect(metadata.robots).toMatchObject({ index: false, follow: true });
    // And it still points at the base listing.
    expect(metadata.alternates?.canonical).toBe(`${ORIGIN}/gallery`);
  });

  it('omits the image rather than inventing one', async () => {
    const metadata = await withSeoEnv(
      { NEXT_PUBLIC_SITE_URL: ORIGIN, SEO_INDEXABLE: 'true' },
      ({ publicPageMetadata }) =>
        publicPageMetadata({ title: 'T', description: 'D', path: '/gallery/a' }),
    );

    expect(metadata.openGraph).not.toHaveProperty('images');
  });

  it('uses a public image when the page has one', async () => {
    const metadata = await withSeoEnv(
      { NEXT_PUBLIC_SITE_URL: ORIGIN, SEO_INDEXABLE: 'true' },
      ({ publicPageMetadata }) =>
        publicPageMetadata({
          title: 'T',
          description: 'D',
          path: '/gallery/a',
          image: 'https://cdn.example.test/a.jpg',
        }),
    );

    expect(metadata.openGraph?.images).toEqual([
      { url: 'https://cdn.example.test/a.jpg', alt: 'T' },
    ]);
  });
});

describe('a resource that is not there', () => {
  it('gets no canonical at all', async () => {
    const metadata = await withSeoEnv(
      { NEXT_PUBLIC_SITE_URL: ORIGIN, SEO_INDEXABLE: 'true' },
      ({ notFoundMetadata }) => notFoundMetadata(),
    );

    // A 404 that advertises a canonical is a 404 asking to be indexed as the
    // authoritative address of something that does not exist.
    expect(metadata.alternates).toBeUndefined();
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });
});
