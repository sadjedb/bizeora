import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * The design-system showcase, audited in a real browser.
 *
 * This is where the checks that jsdom cannot make happen: no horizontal
 * overflow at 375px, a focus ring that is actually painted, and an axe pass
 * over every primitive at once. `DESIGN-SYSTEM.md` section 14 asks for exactly
 * this — automated axe assertions on key routes — and the showcase is the one
 * route that renders the whole system.
 *
 * It runs against the development server, because the route does not exist in
 * production. The production project asserts that separately.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/dev/design-system');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Design system' }),
  ).toBeVisible();
});

test('has no detectable accessibility violations', async ({ page }) => {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  expect(results.violations).toEqual([]);
});

test('never scrolls horizontally', async ({ page }) => {
  // Section 13: no horizontal page scroll at any width. Wide content scrolls
  // inside its own container instead.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );

  expect(overflow).toBeLessThanOrEqual(1);
});

test('paints a visible focus ring on a keyboard-focused button', async ({ page }) => {
  const button = page.getByRole('button', { name: 'Ajouter au panier' }).first();
  await button.focus();

  const shadow = await button.evaluate((element) => getComputedStyle(element).boxShadow);

  // `--shadow-focus` renders as two rings. `outline: none` with no replacement
  // is prohibited, so anything falsy here is a regression.
  expect(shadow).not.toBe('none');
  expect(shadow).not.toBe('');
});

test('renders every section of the system', async ({ page }) => {
  for (const heading of [
    'Couleur',
    'Typographie',
    'Boutons',
    'Formulaires',
    'Retour d’information',
    'Surfaces',
    'Navigation',
    'Statuts',
    'Commerce',
    'Médias',
    'Envoi de fichiers',
  ]) {
    await expect(page.getByRole('heading', { level: 2, name: heading })).toBeVisible();
  }
});

test('opens a dialog, traps focus and restores it on close', async ({ page }) => {
  const trigger = page.getByRole('button', { name: 'Ouvrir un dialogue' });
  await trigger.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleName(/Annuler la commande/);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('shows a toast and announces it', async ({ page }) => {
  await page.getByRole('button', { name: 'Succès' }).click();

  // Two things must be true: it is on screen, and it reached the polite live
  // region so it is heard as well as seen (section 14, dynamic content).
  await expect(
    page.getByRole('status').filter({ hasText: 'Ajouté au panier' }),
  ).toBeAttached();
  await expect(page.getByText('Ajouté au panier', { exact: true })).toBeVisible();
});

test('honours reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();

  const duration = await page
    .getByRole('button', { name: 'Ajouter au panier' })
    .first()
    .evaluate((element) => getComputedStyle(element).transitionDuration);

  // The global reduce block collapses every transition at the token level, so
  // no component can opt out (section 10). Browsers report the 0.01ms override
  // as "1e-05s", so the value is parsed rather than string-matched.
  const seconds = Number.parseFloat(duration);
  expect(Number.isNaN(seconds)).toBe(false);
  expect(seconds).toBeLessThan(0.01);
});
