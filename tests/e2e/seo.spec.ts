import { Client } from 'pg';
import { expect, test, type Page } from '@playwright/test';

/**
 * What a crawler actually receives.
 *
 * Every assertion here is made against the rendered HTML or the served file,
 * because that is the only place the metadata exists: a unit test proves
 * `publicPageMetadata` returns a canonical, and only this proves Next put it in
 * the `<head>` of the page a search engine fetches.
 *
 * The suite runs against a build with `SEO_INDEXABLE=true`, which is the state
 * a launched deployment is in. The other state — every page `noindex`,
 * `robots.txt` disallowing everything — is asserted in
 * `tests/integration/seo.test.ts`, where the module can be re-imported with the
 * switch off.
 */

const DATABASE_URL = process.env.DATABASE_URL;

/** Seeded, published, `MADE_TO_ORDER`. */
const PRODUCT = 'tote-bag-toile-epaisse';
const DRAFT = 'echantillon-interne-non-publie';

async function withDatabase<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/** Every JSON-LD node on the page, parsed. */
async function structuredData(page: Page): Promise<Record<string, unknown>[]> {
  const blocks = await page
    .locator('script[type="application/ld+json"]')
    .allTextContents();

  return blocks.flatMap((block) => {
    const parsed: unknown = JSON.parse(block);
    return (Array.isArray(parsed) ? parsed : [parsed]) as Record<string, unknown>[];
  });
}

function nodeOfType(
  nodes: readonly Record<string, unknown>[],
  type: string,
): Record<string, unknown> | undefined {
  return nodes.find((node) => node['@type'] === type);
}

async function head(page: Page, selector: string): Promise<string | null> {
  const element = page.locator(selector);

  return (await element.count()) === 0
    ? null
    : ((await element.first().getAttribute('content')) ??
        (await element.first().getAttribute('href')));
}

test.describe('the crawlable surface', () => {
  test('robots.txt allows the storefront and disallows the application', async ({
    request,
  }) => {
    const response = await request.get('/robots.txt');
    expect(response.status()).toBe(200);

    const body = await response.text();

    expect(body).toContain('Allow: /');
    for (const path of ['/admin', '/account', '/cart', '/checkout', '/api', '/order']) {
      expect(body).toContain(`Disallow: ${path}`);
    }

    // It must point at the sitemap, and never disallow the storefront itself.
    expect(body).toContain('/sitemap.xml');
    expect(body).not.toContain('Disallow: /shop');
    expect(body).not.toContain('Disallow: /gallery');
  });

  test('sitemap.xml lists the public pages and nothing private', async ({ request }) => {
    const response = await request.get('/sitemap.xml');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('xml');

    const body = await response.text();

    expect(body).toContain(`/shop/${PRODUCT}</loc>`);
    expect(body).toContain('/gallery</loc>');
    expect(body).toContain('/custom</loc>');

    // The seeded draft, and every private surface.
    expect(body).not.toContain(DRAFT);
    for (const path of ['/admin', '/account', '/cart', '/checkout', '/order/', '/api/']) {
      expect(body).not.toContain(path);
    }
  });
});

test.describe('a product page', () => {
  test('describes itself completely, and only with what it shows', async ({ page }) => {
    await page.goto(`/shop/${PRODUCT}`);

    const canonical = await head(page, 'link[rel="canonical"]');
    // The canonical names the language, because `/fr/shop/x` and `/en/shop/x`
    // are two pages that each canonicalise to themselves and point at the
    // other through `hreflang`.
    expect(canonical).toMatch(/^https?:\/\/[^/]+\/fr\/shop\/tote-bag-toile-epaisse$/);

    // The canonical and the Open Graph URL are the same page.
    expect(await head(page, 'meta[property="og:url"]')).toBe(canonical);
    expect(await head(page, 'meta[name="robots"]')).toContain('index');
    expect(await head(page, 'meta[name="description"]')).toBeTruthy();
    expect(await head(page, 'meta[property="og:image"]')).toBeTruthy();

    const nodes = await structuredData(page);
    const product = nodeOfType(nodes, 'Product');
    const breadcrumb = nodeOfType(nodes, 'BreadcrumbList');

    expect(breadcrumb).toBeDefined();
    expect(product).toBeDefined();

    // The offer's price is the one on the page, in the page's own units.
    const offer = product!.offers as { price: string; priceCurrency: string };
    const shown = (await page.getByText(/\d/).allInnerTexts())
      .join(' ')
      .replace(/\D/g, '');

    expect(shown).toContain(offer.price);
    expect(offer.priceCurrency).toBe('DZD');
    expect(product!.url).toBe(canonical);
  });

  test('claims no rating while it has no approved review', async ({ page }) => {
    await page.goto(`/shop/${PRODUCT}`);

    const hasReviews = await page.getByText('Achat vérifié').count();
    const product = nodeOfType(await structuredData(page), 'Product');

    if (hasReviews === 0) {
      // Nothing is shown, so nothing is claimed.
      await expect(page.getByText('Cette pièce n’a pas encore d’avis.')).toBeVisible();
      expect(product).not.toHaveProperty('aggregateRating');
    } else {
      // If another suite left an approved review behind, the claim must match it.
      expect(product!.aggregateRating).toBeDefined();
    }
  });

  test('serves a social card, generated or photographed', async ({ request, page }) => {
    await page.goto(`/shop/${PRODUCT}`);

    const image = await head(page, 'meta[property="og:image"]');
    expect(image).toBeTruthy();

    /*
     * Whichever image the page chose has to be a real, fetchable one.
     *
     * A product with a photograph advertises the photograph; one without falls
     * back to the card `opengraph-image.tsx` draws. Asserting `image/png` here
     * would be asserting the *absence* of photography, which is a state the
     * catalogue is meant to leave behind.
     */
    const response = await request.get(image!);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toMatch(/^image\//);
  });

  test('a slug that resolves to nothing is a 404 that claims nothing', async ({
    page,
  }) => {
    const response = await page.goto('/shop/cette-piece-nexiste-pas');

    expect(response?.status()).toBe(404);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    expect(await head(page, 'meta[name="robots"]')).toContain('noindex');
  });

  test('the seeded draft product is not reachable', async ({ page }) => {
    const response = await page.goto(`/shop/${DRAFT}`);

    expect(response?.status()).toBe(404);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  });
});

test.describe('a renamed product', () => {
  test.skip(!DATABASE_URL, 'DATABASE_URL is required to write a redirect row');

  test('keeps its old URL working, permanently', async ({ page }) => {
    // A slug nothing has requested before, so no cached 404 stands in the way.
    const oldSlug = `e2e-seo-ancien-slug-${Date.now()}`;

    const productId = await withDatabase(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `SELECT "id" FROM "products" WHERE "slug" = $1`,
        [PRODUCT],
      );

      const id = rows[0]!.id;

      await client.query(
        `INSERT INTO "product_redirects" ("from_slug", "product_id") VALUES ($1, $2::uuid)`,
        [oldSlug, id],
      );

      return id;
    });

    try {
      await page.goto(`/shop/${oldSlug}`);

      // 11.6: the old address keeps the links it earned.
      await expect(page).toHaveURL(new RegExp(`/shop/${PRODUCT}$`));
      expect(await head(page, 'link[rel="canonical"]')).toMatch(
        new RegExp(`/shop/${PRODUCT}$`),
      );
    } finally {
      await withDatabase((client) =>
        client.query(`DELETE FROM "product_redirects" WHERE "from_slug" = $1`, [oldSlug]),
      );

      expect(productId).toBeTruthy();
    }
  });
});

test.describe('the gallery', () => {
  test('canonicalises a filtered view to the base listing', async ({ page }) => {
    await page.goto('/gallery');

    const base = await head(page, 'link[rel="canonical"]');
    expect(base).toMatch(/\/gallery$/);
    expect(await head(page, 'meta[name="robots"]')).toContain('index');

    // Follow a facet, and the canonical must not follow it.
    await page
      .getByRole('navigation', { name: 'Filtrer les réalisations' })
      .getByRole('link')
      .first()
      .click();

    await expect(page).toHaveURL(/\?/);
    expect(await head(page, 'link[rel="canonical"]')).toBe(base);

    // A filtered view is not a page of its own, but its links are worth walking.
    const robots = await head(page, 'meta[name="robots"]');
    expect(robots).toContain('noindex');
    expect(robots).toContain('follow');
  });

  test('a detail page carries its own canonical and breadcrumbs', async ({ page }) => {
    await page.goto('/gallery');

    // Fetched directly rather than clicked: a crawler makes a fresh request,
    // and a soft navigation would be asserting the client router's head rather
    // than the document a search engine receives.
    const href = await page.locator('a[href*="/gallery/"]').first().getAttribute('href');
    expect(href).toBeTruthy();
    await page.goto(href!);

    const canonical = await head(page, 'link[rel="canonical"]');
    expect(canonical).toMatch(/\/gallery\/[a-z0-9-]+$/);
    expect(await head(page, 'meta[property="og:type"]')).toBe('article');

    const breadcrumb = nodeOfType(await structuredData(page), 'BreadcrumbList');
    expect(breadcrumb).toBeDefined();

    const trail = breadcrumb!.itemListElement as { name: string }[];
    expect(trail.map((entry) => entry.name)).toContain('Notre travail');
  });

  test('an unknown piece is a 404 that claims nothing', async ({ page }) => {
    const response = await page.goto('/gallery/cette-realisation-nexiste-pas');

    expect(response?.status()).toBe(404);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  });
});

test.describe('the homepage', () => {
  test('carries the site-level structured data, and no invented claim', async ({
    page,
  }) => {
    await page.goto('/');

    const nodes = await structuredData(page);
    const organisation = nodeOfType(nodes, 'Organization');
    const website = nodeOfType(nodes, 'WebSite');

    expect(organisation).toBeDefined();
    expect(website).toBeDefined();
    expect(website!.inLanguage).toBe('fr');

    // No social profiles are configured, so none are claimed.
    expect(organisation).not.toHaveProperty('sameAs');

    // The homepage of a language, not a bare origin: `/` redirects to one of
    // `/fr` or `/en`, and the page that answers is the one that canonicalises.
    expect(await head(page, 'link[rel="canonical"]')).toMatch(
      /^https?:\/\/[^/]+\/(fr|en)$/,
    );
  });

  test('is in French, title and description', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    expect(await page.title()).toContain('Vos idées, brodées.');
    expect(await head(page, 'meta[name="description"]')).toContain('Broderie');
  });
});

test.describe('private surfaces', () => {
  test('are never asked to be indexed', async ({ page }) => {
    for (const path of ['/cart', '/checkout', '/login', '/register', '/account']) {
      await page.goto(path);

      const robots = await head(page, 'meta[name="robots"]');
      expect(robots, `robots on ${path}`).toContain('noindex');
    }
  });

  test('expose no canonical that would invite indexing', async ({ page }) => {
    for (const path of ['/cart', '/login', '/register']) {
      await page.goto(path);
      await expect(page.locator('link[rel="canonical"]'), path).toHaveCount(0);
    }
  });
});
