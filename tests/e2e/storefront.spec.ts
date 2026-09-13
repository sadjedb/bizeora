import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * The storefront, end to end.
 *
 * These run against the production build, which is the point: the storefront is
 * the thing a customer actually loads, and it must be correct there rather than
 * only in development. They check the journey (`UX.md` section 4, journey 1)
 * and the two properties the phase is judged on — that both commercial paths
 * are reachable from the homepage, and that nothing pretends to work.
 */

const ROUTES = ['/', '/shop', '/shop/t-shirt-brode-classique', '/custom'] as const;

test.describe('shell', () => {
  for (const route of ROUTES) {
    test(`${route} renders with the shell and exactly one h1`, async ({ page }) => {
      await page.goto(route);

      await expect(page.getByRole('banner')).toBeVisible();
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByRole('contentinfo')).toBeVisible();

      // One h1 per page, no skipped levels (DESIGN-SYSTEM.md section 14).
      await expect(page.locator('h1')).toHaveCount(1);
    });
  }

  test('has no accessibility violations on any storefront route', async ({ page }) => {
    for (const route of ROUTES) {
      await page.goto(route);

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      expect(results.violations, `axe violations on ${route}`).toEqual([]);
    }
  });

  test('offers only the affordances that lead somewhere', async ({ page }) => {
    await page.goto('/');

    // The cart is real as of Phase 8, so the header links to it.
    await expect(page.getByRole('link', { name: /panier/i })).toHaveCount(1);

    // Search still does not exist. A control that leads nowhere is the failure
    // mode this shell is most exposed to.
    await expect(page.getByRole('button', { name: /rechercher/i })).toHaveCount(0);

    // The account link arrived with Phase 10's quote pages. The rule this test
    // encodes is not "there is no account link" but "every control leads
    // somewhere", so it follows the link rather than asserting its absence.
    const account = page.getByRole('link', { name: /mon compte/i });
    await expect(account).toHaveCount(1);

    const response = await page.goto('/account/quotes');
    expect(response?.status(), '/account/quotes must exist').toBeLessThan(400);
  });
});

test.describe('homepage', () => {
  test('states the value proposition and offers both commercial paths', async ({
    page,
  }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toContainText('brodées');

    // The primary path: bring us a design. PRODUCT.md section 3B.
    const custom = page.getByRole('link', { name: 'Créer ma broderie' }).first();
    await expect(custom).toBeVisible();
    // Every public href carries the language: `Link` adds the prefix so an
    // internal click never costs a middleware redirect.
    await expect(custom).toHaveAttribute('href', '/fr/custom');

    // The secondary path: buy something ready-made. PRODUCT.md section 3A.
    const shop = page.getByRole('link', { name: 'Voir la boutique' }).first();
    await expect(shop).toBeVisible();
    await expect(shop).toHaveAttribute('href', '/fr/shop');
  });

  test('shows a selection of products that link into the catalogue', async ({ page }) => {
    await page.goto('/');

    const cards = page.locator('main article');
    expect(await cards.count()).toBeGreaterThan(0);
    await expect(cards.first().getByRole('link').first()).toHaveAttribute(
      'href',
      /^\/fr\/shop\//,
    );
  });

  test('the primary CTA reaches the custom entry point', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Créer ma broderie' }).first().click();

    await expect(page).toHaveURL(/\/custom$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});

test.describe('shop', () => {
  test('renders database-backed products', async ({ page }) => {
    await page.goto('/shop');

    // Not an exact count: the seed may grow, and a test that pins it would
    // fail for the wrong reason. What matters is that real rows arrived and
    // the count the page prints agrees with the grid it rendered.
    const cards = page.locator('main article');
    const rendered = await cards.count();
    expect(rendered).toBeGreaterThanOrEqual(6);

    await expect(page.getByText(new RegExp(`^${rendered} pièces?$`))).toBeVisible();
  });

  test('never shows an unpublished product', async ({ page }) => {
    await page.goto('/shop');

    // The seed plants one DRAFT product for exactly this assertion.
    await expect(page.getByText('Échantillon interne')).toHaveCount(0);
  });

  test('an unpublished product is not reachable by URL either', async ({ page }) => {
    const response = await page.goto('/shop/echantillon-interne-non-publie');

    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('existe pas');
  });

  test('clicking a product reaches its detail page', async ({ page }) => {
    await page.goto('/shop');

    const first = page.locator('main article').first();
    const name = await first.getByRole('heading').textContent();
    await first.getByRole('link').first().click();

    await expect(page).toHaveURL(/\/shop\/[a-z0-9-]+$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(name!.trim());
  });
});

test.describe('product detail', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/shop/t-shirt-brode-classique');
  });

  test('renders the name, price, options and details', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'T-shirt brodé classique',
    );
    await expect(page.getByText(/4\s*800/).first()).toBeVisible();

    await expect(page.getByRole('radiogroup', { name: 'Taille' })).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Couleur' })).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Détails' })).toBeVisible();
  });

  test('has a breadcrumb trail back to the catalogue', async ({ page }) => {
    const crumbs = page.getByRole('navigation', { name: /fil d’ariane|fil d'ariane/i });
    await expect(crumbs.getByRole('link', { name: 'Boutique' })).toHaveAttribute(
      'href',
      '/fr/shop',
    );
  });

  test('offers a purchase action that reaches a real cart', async ({ page }) => {
    const action = page.getByRole('button', { name: 'Ajouter au panier' });
    await expect(action).toBeVisible();
    await expect(action).toBeEnabled();

    await action.click();

    // The confirmation is announced, not merely shown, and it leads onward.
    await expect(page.getByRole('status')).toContainText('Ajouté à votre panier.');
    await expect(page.getByRole('link', { name: 'Voir le panier' })).toHaveAttribute(
      'href',
      '/fr/cart',
    );
  });

  test('a product with no purchasable variant renders rather than 404s', async ({
    page,
  }) => {
    // BUSINESS-RULES.md 11.3: visible, not purchasable, keeps its URL.
    const response = await page.goto('/shop/bonnet-cotele-brode');

    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Bonnet côtelé brodé',
    );
    await expect(page.getByRole('button', { name: 'Indisponible' })).toBeDisabled();
  });

  test('selects a variant option from the keyboard', async ({ page }) => {
    const size = page.getByRole('radio', { name: 'M' });
    await size.focus();
    await expect(size).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(size).toHaveAttribute('aria-checked', 'true');
  });

  test('changes the quantity', async ({ page }) => {
    const field = page.getByRole('textbox', { name: 'Quantité' });
    await expect(field).toHaveValue('1');

    await page.getByRole('button', { name: /augmenter/i }).click();
    await expect(field).toHaveValue('2');
  });

  test('an unknown slug is a real 404 that keeps the shell', async ({ page }) => {
    const response = await page.goto('/shop/cette-piece-n-existe-pas');

    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('existe pas');
    // The visitor keeps the navigation and can carry on browsing.
    await expect(page.getByRole('banner')).toBeVisible();
  });
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  for (const route of ROUTES) {
    test(`${route} does not scroll horizontally at 375px`, async ({ page }) => {
      await page.goto(route);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );

      expect(overflow, `horizontal overflow on ${route}`).toBeLessThanOrEqual(1);
    });
  }

  test('the drawer opens, navigates, and closes', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'Ouvrir le menu' }).click();

    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();

    await drawer.getByRole('link', { name: 'Boutique' }).click();
    await expect(page).toHaveURL(/\/shop$/);
    await expect(page.getByRole('dialog')).toBeHidden();
  });
});
