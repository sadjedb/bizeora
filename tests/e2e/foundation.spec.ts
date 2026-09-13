import { expect, test } from '@playwright/test';

/**
 * Foundation smoke test.
 *
 * Proves the chain the phase exists to prove: Next.js renders, the token
 * stylesheet is applied, the fonts load, and the security headers are set.
 * It is not a storefront test — that arrives with the storefront in Phase 5.
 */

test('the page renders with content', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('main')).toBeVisible();
});

test('design tokens are applied', async ({ page }) => {
  await page.goto('/');

  const tokens = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    return {
      accent: styles.getPropertyValue('--stitch-accent').trim(),
      fg: styles.getPropertyValue('--stitch-fg').trim(),
      radiusMd: styles.getPropertyValue('--radius-md').trim(),
      background: getComputedStyle(document.body).backgroundColor,
    };
  });

  // Semantic roles resolve, and the bone ground is painted rather than left
  // transparent. Both literals moved in Phase 14.5 — the radius flattened from
  // 4px to 3px and the ground cooled from #f6f2ec to #faf9f6 — and pinning them
  // is the point: a redesign that changes the tokens should have to say so here.
  expect(tokens.accent).not.toBe('');
  expect(tokens.fg).not.toBe('');
  expect(tokens.radiusMd).toBe('3px');
  expect(tokens.background).toBe('rgb(250, 249, 246)');
});

test('the three font roles are loaded', async ({ page }) => {
  await page.goto('/');

  const fonts = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    return {
      display: styles.getPropertyValue('--font-fraunces').trim(),
      sans: styles.getPropertyValue('--font-instrument-sans').trim(),
      mono: styles.getPropertyValue('--font-jetbrains-mono').trim(),
    };
  });

  expect(fonts.display).not.toBe('');
  expect(fonts.sans).not.toBe('');
  expect(fonts.mono).not.toBe('');
});

test('the skip link is reachable by keyboard', async ({ page }) => {
  await page.goto('/');

  await page.keyboard.press('Tab');

  const focused = page.locator('a.skip-link');
  await expect(focused).toBeFocused();
});

test('security headers are set', async ({ page }) => {
  const response = await page.goto('/');
  const headers = response?.headers() ?? {};

  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['permissions-policy']).toContain('camera=()');

  // The framework must not advertise itself.
  expect(headers['x-powered-by']).toBeUndefined();
});

test('an unknown route returns the 404 page', async ({ page }) => {
  const response = await page.goto('/this-route-does-not-exist');

  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('the design-system showcase does not exist in production', async ({ request }) => {
  // The showcase is a development tool. Unlisted is not the same as absent —
  // an internal page that is merely unlinked is a page that gets found — so the
  // route returns 404 from a production build.
  const response = await request.get('/dev/design-system');

  expect(response.status()).toBe(404);
  expect(await response.text()).not.toContain('Chaque primitive');
});
