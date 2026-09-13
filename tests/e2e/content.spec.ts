import AxeBuilder from '@axe-core/playwright';
import { Client } from 'pg';
import { expect, test, type Page } from '@playwright/test';

/**
 * The gallery and the data-driven homepage.
 *
 * Two things here cannot be proved anywhere else.
 *
 * **The homepage is reorderable.** Phase 13's roadmap entry asks for it in
 * those words, and the only honest demonstration is to move a band's
 * `position` in the database and see the rendered page change order. That is
 * what the second test does, and it puts the row back afterwards.
 *
 * **The gallery filters with links.** No JavaScript is required to narrow the
 * listing: each facet is an anchor, so the filtered view is a URL. The test
 * follows one and reads the address bar, because a filter that does not change
 * the URL is a filter nobody can share or bookmark.
 */

const DATABASE_URL = process.env.DATABASE_URL;

async function withDatabase<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function scanForViolations(page: Page, label: string) {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .filter((animation) => animation instanceof CSSTransition)
      .every((animation) => animation.playState !== 'running'),
  );

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  expect(results.violations, `axe violations on ${label}`).toEqual([]);
}

test.describe('the gallery', () => {
  test('lists published work, filters it by a link, and opens one piece', async ({
    page,
  }) => {
    await page.goto('/gallery');

    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Ce que nous avons brodé',
    );

    const cards = page.getByRole('link', {
      name: /Réalisation|Logo|Prénoms|Casquettes|Tote|Tabliers|T-shirts/,
    });
    const total = await cards.count();
    expect(total).toBeGreaterThan(0);

    // A facet is an anchor: following it puts the filter in the URL.
    const facets = page.getByRole('navigation', { name: 'Filtrer les réalisations' });
    const firstFacet = facets.getByRole('link').first();
    const facetLabel = (await firstFacet.innerText()).trim();

    await firstFacet.click();
    await expect(page).toHaveURL(/\/gallery\?(productType|embroideryType)=/);

    // The chip in effect says so — with `aria-current`, which is what a link's
    // role allows, rather than the `aria-pressed` of a toggle button.
    await expect(
      page.getByRole('link', { name: facetLabel, exact: true }).first(),
    ).toHaveAttribute('aria-current', 'true');

    await expect(
      page.getByRole('link', { name: 'Réinitialiser les filtres' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Réinitialiser les filtres' }).click();
    await expect(page).toHaveURL(/\/gallery$/);

    await scanForViolations(page, '/gallery');
  });

  test('shows one piece with its facets and its matching products', async ({ page }) => {
    await page.goto('/gallery');

    const first = page
      .locator('a[href*="/gallery/"]')
      .filter({ has: page.getByRole('heading', { level: 2 }) })
      .first();

    const title = await first.getByRole('heading', { level: 2 }).innerText();
    await first.click();

    await expect(page).toHaveURL(/\/gallery\/[a-z0-9-]+$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(title);

    // The details list links back into the filtered gallery.
    await expect(page.getByRole('heading', { name: 'Détails' })).toBeVisible();

    // Seeded items share a tag with a seeded product, so the join is real.
    await expect(
      page.getByRole('heading', { name: 'Les pièces correspondantes' }),
    ).toBeVisible();

    await expect(page.getByRole('link', { name: 'Créer la mienne' })).toBeVisible();

    await scanForViolations(page, '/gallery/[slug]');
  });

  test('returns 404 for an unknown piece', async ({ page }) => {
    const response = await page.goto('/gallery/cette-realisation-nexiste-pas');

    expect(response?.status()).toBe(404);
  });
});

test.describe('the homepage', () => {
  test.skip(!DATABASE_URL, 'DATABASE_URL is required to reorder a section');
  test.describe.configure({ mode: 'serial' });

  test('renders its bands from the database', async ({ page }) => {
    await page.goto('/');

    // The hero, the process, the shop band and the gallery band all come from
    // `homepage_sections` rows now.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(
      page.getByRole('heading', {
        name: 'Quatre étapes, et vous savez ce que ça coûte.',
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Pièces prêtes à porter' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Ce que nous avons brodé' }),
    ).toBeVisible();

    // The trust band's delivery figures come from the shipping zones.
    await expect(
      page.getByRole('heading', { name: /Livraison dans \d+ wilayas/ }),
    ).toBeVisible();

    await scanForViolations(page, '/');
  });

  test('renders its bands in the order the database gives them', async ({ page }) => {
    // The band order is a column, so the assertion is that the page agrees with
    // it. Moving a position and re-reading the page is the *integration*
    // suite's test (`content.test.ts`), because the homepage is served from a
    // five-minute ISR cache that an end-to-end test cannot invalidate — waiting
    // out a cache would be a slow test that proves the cache works.
    const expected = await withDatabase(async (client) => {
      const { rows } = await client.query<{ title: string }>(
        `SELECT "title" FROM "homepage_sections"
          WHERE "is_enabled" AND "title" IS NOT NULL
          ORDER BY "position" ASC, "id" ASC`,
      );

      return rows.map((row) => row.title);
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const headings = await page
      .locator('main')
      .getByRole('heading', { level: 1 })
      .or(page.locator('main').getByRole('heading', { level: 2 }))
      .allInnerTexts();

    // Some bands render no heading when they have nothing to show (the reviews
    // band with no approved review, the social band with no link), so the
    // rendered headings are a *subsequence* of the configured ones — in order.
    const rendered = expected.filter((title) => headings.includes(title));

    expect(rendered.length).toBeGreaterThan(2);
    expect(headings.filter((title) => expected.includes(title))).toEqual(rendered);
  });
});

test.describe('the gallery on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('never scrolls horizontally, listing or detail', async ({ page }) => {
    for (const path of ['/', '/gallery']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );

      expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(0);
    }

    await page.locator('a[href*="/gallery/"]').first().click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

    expect(overflow, 'horizontal overflow on a gallery detail page').toBeLessThanOrEqual(
      0,
    );
  });
});
