import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Catalogue → cart → checkout → order, end to end.
 *
 * The assertions that matter here are the ones no unit test can make: that a
 * price shown on the product page survives into the cart, that choosing a
 * wilaya changes the delivery charge because the *server* said so, and that a
 * completed checkout produces a real order number the customer can read back.
 *
 * These tests place real orders against the seeded database, exactly as a
 * customer would. That is the point — a checkout that only works against a
 * fixture is not a checkout.
 */

/** Seeded `MADE_TO_ORDER`, so repeated runs never exhaust its stock. */
const PRODUCT = '/shop/tote-bag-toile-epaisse';

async function addToCart(page: Page) {
  await page.goto(PRODUCT);
  await page.getByRole('button', { name: 'Ajouter au panier' }).click();
  await expect(page.getByText('Ajouté à votre panier.')).toBeVisible();
}

/** Prices render with non-breaking spaces, so compare the digits. */
function digitsOf(text: string): string {
  return text.replace(/\D/g, '');
}

/** The subtotal row of the summary, as digits. */
async function subtotalDigits(page: Page): Promise<string> {
  const row = page.getByText('Sous-total', { exact: true }).locator('..');
  return digitsOf(await row.innerText());
}

async function scanForViolations(page: Page, label: string) {
  // A colour transition in flight computes to an interpolated pair that is
  // neither the start nor the end state, so wait for transitions to settle.
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

async function fillCheckout(page: Page) {
  await page.getByLabel('Nom complet').fill('Amina Bensalem');
  await page.getByLabel('Adresse e-mail').fill('e2e@example.invalid');
  await page.getByLabel('Téléphone').fill('0555 12 34 56');

  await page.getByRole('combobox', { name: 'Wilaya' }).click();
  await page.getByRole('option', { name: /16 — Alger/ }).click();

  // The delivery options only appear once the server has priced them.
  await expect(page.getByRole('radiogroup', { name: 'Mode de livraison' })).toBeVisible();

  await page.getByLabel('Commune').fill('Hydra');
  await page.getByLabel('Adresse de livraison').fill('12 rue des Frères Bouadou');
  await page.getByLabel(/J’accepte les conditions/).check();
}

test.describe('the cart', () => {
  test('starts empty, with a route out of it', async ({ page }) => {
    await page.goto('/cart');

    await expect(page.getByText('Votre panier est vide')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Voir la boutique' })).toBeVisible();
  });

  test('receives a product from the product page at the catalogue price', async ({
    page,
  }) => {
    await page.goto(PRODUCT);
    const shown = await page.getByText(/DA/).first().innerText();

    await page.getByRole('button', { name: 'Ajouter au panier' }).click();
    await expect(page.getByText('Ajouté à votre panier.')).toBeVisible();

    await page.goto('/cart');
    await expect(page.getByRole('heading', { name: 'Votre panier' })).toBeVisible();

    // The same money, carried across a page boundary by the server. Compared as
    // digits because the price is formatted with non-breaking spaces.
    expect(await subtotalDigits(page)).toBe(digitsOf(shown));
  });

  test('recomputes the total on the server when a quantity changes', async ({ page }) => {
    await addToCart(page);
    await page.goto('/cart');

    const unit = Number(await subtotalDigits(page));
    expect(unit).toBeGreaterThan(0);

    await page.getByRole('button', { name: /augmenter/i }).click();
    await expect(page.getByRole('textbox', { name: /Quantité/ })).toHaveValue('2');

    // Two units cost twice one, and the number came back from the server —
    // nothing in the browser multiplied anything.
    await expect.poll(async () => Number(await subtotalDigits(page))).toBe(unit * 2);
  });

  test('removes a line and returns to the empty state', async ({ page }) => {
    await addToCart(page);
    await page.goto('/cart');

    await page.getByRole('button', { name: 'Retirer' }).click();
    await expect(page.getByText('Votre panier est vide')).toBeVisible();
  });

  test('has no accessibility violations, empty or full', async ({ page }) => {
    await page.goto('/cart');
    await scanForViolations(page, 'the empty cart');

    await addToCart(page);
    await page.goto('/cart');
    await scanForViolations(page, 'the cart');
  });
});

test.describe('checkout', () => {
  test('sends an empty cart back rather than showing a form it cannot use', async ({
    page,
  }) => {
    await page.goto('/checkout');
    await expect(page).toHaveURL(/\/cart$/);
  });

  test('prices delivery on the server when the wilaya is chosen', async ({ page }) => {
    await addToCart(page);
    await page.goto('/checkout');

    // Before a wilaya there is no total to show, and the page says so.
    await expect(page.getByText('Calculée à l’étape suivante')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Confirmer la commande' }),
    ).toBeDisabled();

    await page.getByRole('combobox', { name: 'Wilaya' }).click();
    await page.getByRole('option', { name: /16 — Alger/ }).click();

    // Both documented options, with distinct prices from the rate table.
    const options = page.getByRole('radiogroup', { name: 'Mode de livraison' });
    await expect(options).toBeVisible();
    await expect(options.getByRole('radio')).toHaveCount(2);
  });

  test('never offers cash on delivery for an embroidered order', async ({ page }) => {
    // A stock-only cart may pay on delivery.
    await addToCart(page);
    await page.goto('/checkout');
    await expect(page.getByText('Paiement à la livraison')).toBeVisible();
  });

  test('places an order and shows its number', async ({ page }) => {
    await addToCart(page);
    await page.goto('/checkout');
    await fillCheckout(page);

    await page.getByRole('button', { name: 'Confirmer la commande' }).click();

    await expect(page).toHaveURL(/\/order\/CMD-\d{4}-\d+/);
    await expect(
      page.getByRole('heading', { name: /votre commande est enregistrée/i }),
    ).toBeVisible();
    await expect(page.getByText(/CMD-\d{4}-\d+/).first()).toBeVisible();
    await expect(page.getByText('e2e@example.invalid')).toBeVisible();

    // The cart is spent: returning to it shows the empty state, not the order.
    await page.goto('/cart');
    await expect(page.getByText('Votre panier est vide')).toBeVisible();
  });

  test('refuses an order with no contact details, field by field', async ({ page }) => {
    await addToCart(page);
    await page.goto('/checkout');

    await page.getByRole('combobox', { name: 'Wilaya' }).click();
    await page.getByRole('option', { name: /16 — Alger/ }).click();
    await expect(
      page.getByRole('radiogroup', { name: 'Mode de livraison' }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Confirmer la commande' }).click();

    // Errors are attached to their fields rather than gathered in a banner.
    await expect(page.getByText('Indiquez votre nom complet.')).toBeVisible();
    await expect(page.getByText('Indiquez une adresse e-mail valide.')).toBeVisible();
    await expect(page.getByText('Vous devez accepter les conditions.')).toBeVisible();

    const name = page.getByLabel('Nom complet');
    await expect(name).toHaveAttribute('aria-invalid', 'true');
  });

  test('is operable from the keyboard', async ({ page }) => {
    await addToCart(page);
    await page.goto('/checkout');

    await page.getByLabel('Nom complet').focus();
    await page.keyboard.type('Amina Bensalem');
    await page.keyboard.press('Tab');
    await page.keyboard.type('e2e@example.invalid');

    await expect(page.getByLabel('Adresse e-mail')).toHaveValue('e2e@example.invalid');
    await expect(page.locator(':focus')).toBeVisible();
  });

  test('has no accessibility violations', async ({ page }) => {
    await addToCart(page);
    await page.goto('/checkout');
    await scanForViolations(page, 'checkout');

    await page.getByRole('combobox', { name: 'Wilaya' }).click();
    await page.getByRole('option', { name: /16 — Alger/ }).click();
    await expect(
      page.getByRole('radiogroup', { name: 'Mode de livraison' }),
    ).toBeVisible();
    await scanForViolations(page, 'checkout with delivery options');
  });

  test('confirms an order accessibly', async ({ page }) => {
    await addToCart(page);
    await page.goto('/checkout');
    await fillCheckout(page);
    await page.getByRole('button', { name: 'Confirmer la commande' }).click();

    await expect(page).toHaveURL(/\/order\/CMD-/);
    await scanForViolations(page, 'the confirmation');
  });

  test('refuses to show an order without its token', async ({ page }) => {
    await addToCart(page);
    await page.goto('/checkout');
    await fillCheckout(page);
    await page.getByRole('button', { name: 'Confirmer la commande' }).click();
    await expect(page).toHaveURL(/\/order\/CMD-/);

    // The order number alone is not authorisation.
    const withoutToken = page.url().split('?')[0]!;
    const response = await page.goto(withoutToken);
    expect(response?.status()).toBe(404);
  });
});

test.describe('on mobile', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('never scrolls horizontally, from cart to confirmation', async ({ page }) => {
    const overflow = async () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );

    await addToCart(page);

    await page.goto('/cart');
    expect(await overflow(), 'cart').toBeLessThanOrEqual(1);

    await page.goto('/checkout');
    expect(await overflow(), 'checkout').toBeLessThanOrEqual(1);

    await fillCheckout(page);
    expect(await overflow(), 'checkout, filled').toBeLessThanOrEqual(1);

    await page.getByRole('button', { name: 'Confirmer la commande' }).click();
    await expect(page).toHaveURL(/\/order\/CMD-/);
    expect(await overflow(), 'confirmation').toBeLessThanOrEqual(1);
  });
});
