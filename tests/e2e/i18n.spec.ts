import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Two languages and two themes.
 *
 * The rest of the suite runs in a French browser (`playwright.config.ts`),
 * which is what the shop's customers are. This file is the other half: that an
 * English speaker arrives in English, that either visitor can change their
 * mind, that the choice survives a reload, and that a crawler is told the two
 * pages are translations rather than duplicates.
 *
 * The theme tests assert the *document*, not a screenshot. `data-theme` is what
 * the palette switches on, and a colour value would be a second copy of
 * `tokens.css` written in a test.
 */

test.describe('language', () => {
  test('sends a French speaker to the French site', async ({ page }) => {
    const response = await page.goto('/');

    expect(page.url()).toContain('/fr');
    expect(response?.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(
      page.getByRole('link', { name: 'Boutique', exact: true }).first(),
    ).toBeVisible();
  });

  test.describe('an English speaker', () => {
    test.use({ locale: 'en-GB' });

    test('arrives in English, without asking', async ({ page }) => {
      await page.goto('/');

      expect(page.url()).toContain('/en');
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(
        page.getByRole('link', { name: 'Shop', exact: true }).first(),
      ).toBeVisible();
    });

    test('reads the shop, the catalogue and the builder in English', async ({ page }) => {
      await page.goto('/en/shop');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByText('Ready-to-wear pieces')).toBeVisible();

      await page.goto('/en/custom');
      await expect(page.getByRole('navigation', { name: /Builder steps/ })).toBeVisible();
      await expect(page.getByRole('heading', { name: /1\. Item/ })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
    });
  });

  test('changes language and stays on the same page', async ({ page }) => {
    await page.goto('/fr/shop');

    await page.getByRole('button', { name: /Langue/ }).click();
    await page.getByRole('menuitem', { name: 'English' }).click();

    await page.waitForURL(/\/en\/shop$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    // The choice is remembered, so a bare internal address keeps it.
    await page.goto('/');
    await page.waitForURL(/\/en$/);
  });

  test('tells a crawler the two pages are the same page', async ({ page }) => {
    await page.goto('/fr/shop');

    const alternates = page.locator('link[rel="alternate"]');
    await expect(alternates.filter({ has: page.locator('[hreflang="fr"]') })).toHaveCount(
      0,
    );

    const hrefs = await alternates.evaluateAll((links) =>
      links.map((link) => [link.getAttribute('hreflang'), link.getAttribute('href')]),
    );

    const map = new Map(hrefs as [string, string][]);
    expect(map.get('fr')).toContain('/fr/shop');
    expect(map.get('en')).toContain('/en/shop');
    expect(map.get('x-default')).toContain('/fr/shop');
  });

  test('leaves the workshop unprefixed', async ({ page }) => {
    const response = await page.goto('/admin');

    // Not signed in, so this is a redirect to the login page — what matters is
    // that no language prefix was added on the way.
    expect(response?.url()).not.toContain('/fr/admin');
    expect(response?.url()).not.toContain('/en/admin');
  });

  test('has no accessibility violations in either language', async ({ page }) => {
    for (const path of ['/fr', '/en']) {
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      expect(results.violations, path).toEqual([]);
    }
  });
});

test.describe('theme', () => {
  test('follows the system by default, in both directions', async ({ browser }) => {
    for (const scheme of ['light', 'dark'] as const) {
      const context = await browser.newContext({
        colorScheme: scheme,
        locale: 'fr-DZ',
      });
      const page = await context.newPage();
      await page.goto('/fr');

      // Nothing is stamped: the palette is `light-dark()` on `color-scheme`,
      // so the system preference needs no JavaScript and no attribute.
      await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.*/);

      const background = await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      );

      // Two different grounds, and the dark one is genuinely dark.
      const [r, g, b] = background.match(/\d+/g)!.map(Number) as [number, number, number];
      const luminance = (r + g + b) / 3;

      if (scheme === 'dark') expect(luminance).toBeLessThan(60);
      else expect(luminance).toBeGreaterThan(200);

      await context.close();
    }
  });

  test('remembers a chosen theme across a reload', async ({ page }) => {
    await page.goto('/fr');

    await page.getByRole('button', { name: /Thème/ }).click();
    await page.getByRole('menuitem', { name: 'Sombre' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.reload();
    // Stamped before the first paint by the inline script, so there is no
    // flash of the other palette.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.getByRole('button', { name: /Thème/ }).click();
    await page.getByRole('menuitem', { name: 'Système' }).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.*/);
  });

  test('has no accessibility violations in the dark palette', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'dark', locale: 'fr-DZ' });
    const page = await context.newPage();

    for (const path of ['/fr', '/fr/shop', '/fr/custom']) {
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      expect(results.violations, path).toEqual([]);
    }

    await context.close();
  });
});
