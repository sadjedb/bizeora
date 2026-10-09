import { expect, test, type Page } from '@playwright/test';

/**
 * Browsing the catalogue.
 *
 * `/shop` was one ungrouped grid of everything until Phase 14.13. What is
 * proved here is the promise that replaced it: that a narrowed catalogue is a
 * **URL** — one a customer can paste into a message and one a crawler is told
 * not to index — and that the count beside the filters agrees with the grid
 * beneath them.
 *
 * Read-only. Nothing in this file writes, so it runs beside the rest of the
 * suite; the admin half that creates categories lives in its own project.
 */

/** The seeded catalogue is small, so the assertions are about shape, not size. */
async function cardNames(page: Page): Promise<string[]> {
  return page.locator('article a h3, article h3').allInnerTexts();
}

async function shownCount(page: Page): Promise<number> {
  const text = await page
    .getByText(/\d+ pièces?( sur \d+)?/)
    .first()
    .innerText();
  const [shown] = text.match(/\d+/g) ?? [];

  return Number(shown ?? 0);
}

test.describe('the catalogue', () => {
  test('lists the shop, and says how many', async ({ page }) => {
    await page.goto('/fr/shop');

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const names = await cardNames(page);

    expect(names.length).toBeGreaterThan(0);
    expect(await shownCount(page)).toBe(names.length);
  });

  test('searches, and the result is an address', async ({ page }) => {
    await page.goto('/fr/shop');

    await page.getByLabel('Rechercher une pièce').fill('tote');
    await page.getByRole('button', { name: 'Rechercher' }).click();

    // The URL carries the search, which is the whole point of a GET form.
    await expect(page).toHaveURL(/\/fr\/shop\?.*q=tote/);

    const names = await cardNames(page);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name.toLowerCase()).toContain('tote');

    // Reloading the address alone reproduces the view.
    await page.reload();
    expect(await cardNames(page)).toEqual(names);
  });

  test('says how many of how many once something is filtered', async ({ page }) => {
    await page.goto('/fr/shop');
    const total = await shownCount(page);

    await page.goto('/fr/shop?q=tote');

    await expect(page.getByText(new RegExp(`sur ${total}`))).toBeVisible();
    await expect(page.getByText(/1 filtre actif/)).toBeVisible();
  });

  /*
   * A narrow result and an empty shop are different problems. This one is
   * recoverable, and the test checks that the way back actually works rather
   * than only that the words appear.
   */
  test('offers a way out of a search that matches nothing', async ({ page }) => {
    await page.goto('/fr/shop?q=zzzzzzzz');

    await expect(page.getByText(/Aucune pièce ne correspond/)).toBeVisible();

    await page.getByRole('link', { name: 'Voir tout le catalogue' }).click();
    await expect(page).toHaveURL(/\/fr\/shop$/);
    expect((await cardNames(page)).length).toBeGreaterThan(0);
  });

  test('reorders by price, and the order is real', async ({ page }) => {
    await page.goto('/fr/shop?sort=PRICE_ASC');
    const ascending = await cardNames(page);

    await page.goto('/fr/shop?sort=PRICE_DESC');
    const descending = await cardNames(page);

    expect(ascending.length).toBeGreaterThan(1);
    expect(descending).not.toEqual(ascending);
    expect(descending[0]).toBe(ascending[ascending.length - 1]);
  });

  test('keeps only what accepts embroidery', async ({ page }) => {
    await page.goto('/fr/shop');
    const all = await cardNames(page);

    await page.goto('/fr/shop?customisable=1');
    const customisable = await cardNames(page);

    expect(customisable.length).toBeGreaterThan(0);
    expect(customisable.length).toBeLessThanOrEqual(all.length);
    for (const name of customisable) expect(all).toContain(name);
  });

  test('clears every filter at once', async ({ page }) => {
    await page.goto('/fr/shop?q=tote&customisable=1&inStock=1');
    await expect(page.getByText(/3 filtres actifs/)).toBeVisible();

    await page.getByRole('link', { name: 'Tout effacer' }).click();
    await expect(page).toHaveURL(/\/fr\/shop$/);
    await expect(page.getByText(/filtres? actifs?/)).toHaveCount(0);
  });

  /*
   * One listing is indexed and every view of it points back at that listing.
   * The rule is in `isDefaultCatalogueView`; this is the rule as a crawler sees
   * it.
   */
  test('asks to be indexed once, and canonicalises every view to it', async ({
    page,
  }) => {
    await page.goto('/fr/shop');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      /\/fr\/shop$/,
    );

    for (const view of ['?q=tote', '?sort=NAME', '?page=2']) {
      await page.goto(`/fr/shop${view}`);

      await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
        'content',
        /noindex/,
      );
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        'href',
        /\/fr\/shop$/,
      );
    }
  });

  test('survives a query string somebody typed by hand', async ({ page }) => {
    // None of these is an error page; all of them are the catalogue.
    for (const nonsense of ['?page=-4', '?sort=cheapest', '?page=99999', '?q=']) {
      const response = await page.goto(`/fr/shop${nonsense}`);

      expect(response?.status()).toBe(200);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    }
  });
});

test.describe('a category', () => {
  test('has its own page, reachable from the chips', async ({ page }) => {
    await page.goto('/fr/shop');

    const chips = page.getByRole('navigation', { name: 'Filtrer par catégorie' });
    await expect(chips).toBeVisible();

    // "Tout" plus at least one real category.
    const links = chips.getByRole('link');
    expect(await links.count()).toBeGreaterThan(1);

    await links.nth(1).click();
    await expect(page).toHaveURL(/\/fr\/shop\/c\/[a-z0-9-]+$/);

    const names = await cardNames(page);
    expect(names.length).toBeGreaterThan(0);
  });

  /*
   * A category is a page of its own, unlike a filtered catalogue: it carries
   * its own canonical and asks to be indexed.
   */
  test('is indexable on its own address', async ({ page }) => {
    await page.goto('/fr/shop/c/accessoires');

    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      /\/fr\/shop\/c\/accessoires$/,
    );
    await expect(page.locator('meta[name="robots"]')).not.toHaveAttribute(
      'content',
      /noindex/,
    );
  });

  test('narrows within itself and stays on its own address', async ({ page }) => {
    await page.goto('/fr/shop/c/accessoires');
    const all = await cardNames(page);

    await page.getByLabel('Rechercher une pièce').fill('tote');
    await page.getByRole('button', { name: 'Rechercher' }).click();

    await expect(page).toHaveURL(/\/fr\/shop\/c\/accessoires\?.*q=tote/);
    const narrowed = await cardNames(page);

    expect(narrowed.length).toBeGreaterThan(0);
    expect(narrowed.length).toBeLessThanOrEqual(all.length);
  });

  test('leads back to the whole shop', async ({ page }) => {
    await page.goto('/fr/shop/c/accessoires');

    await page.getByRole('link', { name: 'Toute la boutique' }).click();
    await expect(page).toHaveURL(/\/fr\/shop$/);
  });

  test('a slug that is not a category is a 404', async ({ page }) => {
    const response = await page.goto('/fr/shop/c/pas-une-categorie');

    expect(response?.status()).toBe(404);
  });
});

test.describe('the catalogue on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('never scrolls horizontally, filtered or not', async ({ page }) => {
    for (const path of [
      '/fr/shop',
      '/fr/shop?q=tote&customisable=1',
      '/fr/shop/c/polos',
    ]) {
      await page.goto(path);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );

      expect(overflow, path).toBeLessThanOrEqual(1);
    }
  });
});

test.describe('the catalogue in English', () => {
  /*
   * The shell has been bilingual since Phase 14.7; the catalogue inside it was
   * not. These assert the half that was missing, and in particular the shape of
   * the fallback: the seed translates some products fully and some by name
   * only, which is the state a catalogue is actually in while somebody is
   * translating it.
   */

  test('lists products under their English names', async ({ page }) => {
    await page.goto('/en/shop');

    const names = await cardNames(page);

    expect(names).toContain('Classic embroidered t-shirt');
    expect(names).not.toContain('T-shirt brodé classique');
  });

  test('names the categories in English too', async ({ page }) => {
    await page.goto('/en/shop');

    const chips = page.getByRole('navigation', { name: 'Filter by category' });

    await expect(chips.getByRole('link', { name: 'Accessories' })).toBeVisible();
    await expect(chips.getByRole('link', { name: 'Accessoires' })).toHaveCount(0);
  });

  /*
   * Field by field, not row by row. This product has an English name and no
   * English description, and both halves have to be right.
   */
  test('falls back to French for what is not translated yet', async ({ page }) => {
    await page.goto('/en/shop/bonnet-cotele-brode');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Embroidered ribbed beanie',
    );
    await expect(page.getByText(/Maille côtelée double/)).toBeVisible();
  });

  test('finds a product by its English name', async ({ page }) => {
    await page.goto('/en/shop?q=hooded');

    expect(await cardNames(page)).toEqual(['Embroidered hooded sweatshirt']);
  });

  test('shows the same products in both languages', async ({ page }) => {
    await page.goto('/fr/shop');
    const french = (await cardNames(page)).length;

    await page.goto('/en/shop');
    expect((await cardNames(page)).length).toBe(french);
  });

  test('puts the English name in the page title', async ({ page }) => {
    await page.goto('/en/shop/t-shirt-brode-classique');

    await expect(page).toHaveTitle(/Classic embroidered t-shirt/);
  });
});

test.describe('the 3D view', () => {
  /*
   * Phase 14.10 built the parser, the storage prefix and the texture-space
   * transform, and shipped no viewer — there was no model to view. What is
   * proved here is the whole chain: a `.glb` served from public storage, loaded
   * by a real WebGL context, framed and turnable.
   *
   * Headless Chromium renders WebGL through SwiftShader, so this is a genuine
   * render rather than a mock.
   */

  test('is offered only where there is a model', async ({ page }) => {
    await page.goto('/fr/shop/t-shirt-brode-classique');
    await expect(page.getByRole('tab', { name: 'Vue 360°' })).toBeVisible();

    // Two tabs where one has nothing behind it is a control that teaches a
    // visitor the site is confusing.
    await page.goto('/fr/shop/casquette-brodee');
    await expect(page.getByRole('tab')).toHaveCount(0);
  });

  test('shows photographs first, and loads nothing 3D until asked', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));

    await page.goto('/fr/shop/t-shirt-brode-classique');
    await expect(page.getByRole('tab', { name: 'Photos' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    expect(requests.some((url) => url.endsWith('.glb'))).toBe(false);
  });

  test('renders the garment when asked, and says how to turn it', async ({ page }) => {
    await page.goto('/fr/shop/t-shirt-brode-classique');
    await page.getByRole('tab', { name: 'Vue 360°' }).click();

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible({ timeout: 30_000 });

    // "Ready" is the only state that draws the hint, so this asserts the model
    // loaded rather than merely that a canvas element exists.
    await expect(page.getByText('Faites glisser pour tourner')).toBeVisible({
      timeout: 30_000,
    });

    await expect(page.getByText(/ne s.affiche pas/)).toHaveCount(0);
  });

  /*
   * A blank canvas and a rendered one are the same element. The difference is
   * in the pixels, so the pixels are what this looks at: a shaded solid has a
   * spread of values, a failure to draw anything is one flat colour.
   */
  test('actually draws something', async ({ page }) => {
    await page.goto('/fr/shop/t-shirt-brode-classique');
    await page.getByRole('tab', { name: 'Vue 360°' }).click();
    await expect(page.getByText('Faites glisser pour tourner')).toBeVisible({
      timeout: 30_000,
    });

    const shot = await page.locator('canvas').screenshot();
    const tones = new Set<number>();

    // A PNG is compressed, so the bytes are sampled rather than decoded: a
    // uniform image compresses to far fewer distinct bytes than a shaded one.
    for (let index = 0; index < shot.length; index += 7) tones.add(shot[index]!);

    expect(tones.size).toBeGreaterThan(32);
  });

  test('is reachable in English too', async ({ page }) => {
    await page.goto('/en/shop/t-shirt-brode-classique');

    await page.getByRole('tab', { name: '360° view' }).click();
    await expect(page.getByText('Drag to turn')).toBeVisible({ timeout: 30_000 });
  });
});
