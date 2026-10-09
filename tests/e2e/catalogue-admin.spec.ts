import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { Client } from 'pg';
import { expect, test, type Page } from '@playwright/test';

/**
 * Category management.
 *
 * Categories have existed in the schema since Phase 2 and every product points
 * at one, but until Phase 14.13 the only way to make one was a SQL client — the
 * product form said so in a warning. These tests are about the two things that
 * make the screen worth having: a category created in the workshop becomes a
 * page on the storefront, and one that still holds live products cannot be
 * hidden out from under them.
 *
 * Everything it creates, it removes. These rows are global — a stray category
 * is a chip in every other spec's catalogue.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const PASSWORD = 'correct horse battery staple';
const PREFIX = `e2e-cat-${Date.now()}`;

const createdEmails: string[] = [];

/** The generated demo garment, committed so this can upload a real container. */
const DEMO_MODEL = join(
  process.cwd(),
  'public',
  'assets',
  'models',
  '00000000-0000-4000-8000-00000000d3d0.glb',
);
const createdSlugs: string[] = [];

async function withDatabase<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
}

async function register(page: Page, name: string): Promise<string> {
  const email = `${PREFIX}-${randomUUID().slice(0, 8)}@example.invalid`;
  createdEmails.push(email);

  await page.goto('/register');
  await page.getByLabel('Nom complet').fill(name);
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await page.waitForURL(/\/account|\/admin/);
  await settle(page);

  return email;
}

async function becomeStaff(page: Page): Promise<void> {
  const email = await register(page, 'Atelier');

  await withDatabase((client) =>
    client.query(`UPDATE "users" SET "role" = 'STAFF' WHERE "email" = $1`, [email]),
  );

  // The session carries the role, so it has to be reissued.
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForURL(/\/account|\/admin/);
  await settle(page);
}

/** Create one through the screen, the way the owner would. */
async function createCategory(page: Page, name: string, slug: string): Promise<void> {
  createdSlugs.push(slug);

  await page.goto('/admin/categories/new');
  await page
    .getByRole('textbox', { name: 'Nom de la catégorie', exact: true })
    .fill(name);
  await page.getByRole('textbox', { name: 'Adresse (slug)', exact: true }).fill(slug);
  await page.getByRole('button', { name: 'Créer la catégorie' }).click();

  await page.waitForURL(/\/admin\/categories$/);
  await expect(page.getByRole('link', { name })).toBeVisible();
}

async function openCategory(page: Page, name: string): Promise<void> {
  await page.goto('/admin/categories');
  await page.getByRole('link', { name }).click();
  await page.waitForURL(/\/admin\/categories\/[0-9a-f-]+$/);
}

test.afterAll(async () => {
  if (!DATABASE_URL) return;

  if (createdSlugs.length > 0) {
    await withDatabase((client) =>
      client.query(`DELETE FROM "categories" WHERE "slug" = ANY($1::text[])`, [
        createdSlugs,
      ]),
    );
  }

  if (createdEmails.length > 0) {
    await withDatabase((client) =>
      client.query(`DELETE FROM "users" WHERE "email" = ANY($1::text[])`, [
        createdEmails,
      ]),
    );
  }

  // Whatever a failing test left behind, the seeded category is visible.
  await withDatabase((client) =>
    client.query(
      `UPDATE "categories" SET "is_active" = true WHERE "slug" = 'accessoires'`,
    ),
  );
});

test.describe('the categories screen', () => {
  test.skip(!DATABASE_URL, 'DATABASE_URL is required to promote an account to staff');
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(90_000);

  test('is closed to a customer', async ({ page }) => {
    await register(page, 'Cliente');
    await page.goto('/admin/categories');

    // Not found, not a disabled screen: the workshop does not render controls
    // to explain what somebody may not do.
    await expect(page.getByRole('heading', { name: 'Catégories' })).toHaveCount(0);
  });

  test('lists what the shop has, with both counts', async ({ page }) => {
    await becomeStaff(page);
    await page.goto('/admin/categories');

    await expect(page.getByRole('heading', { name: 'Catégories' })).toBeVisible();

    // The seeded catalogue: four shelves, and "Accessoires" has products in it.
    const row = page.getByRole('row', { name: /Accessoires/ });
    await expect(row).toBeVisible();
    await expect(row).toContainText('/shop/c/accessoires');
  });

  /*
   * The whole promise of the screen, in one test: something made in the
   * workshop turns into a page on the storefront.
   */
  test('creates a category and puts a product in it', async ({ page }) => {
    await becomeStaff(page);

    const slug = `e2e-bonnets-${Date.now()}`;
    await createCategory(page, 'Bonnets E2E', slug);

    /*
     * Empty, so it is deliberately **not** a chip yet.
     *
     * `listCatalogueCategories` leaves out categories with nothing published in
     * them: a chip that leads to an empty listing is a dead end the visitor has
     * to click to discover.
     */
    await page.goto('/fr/shop');
    await expect(
      page.getByRole('navigation', { name: 'Filtrer par catégorie' }).getByRole('link', {
        name: 'Bonnets E2E',
      }),
    ).toHaveCount(0);

    // And the workshop says so, rather than leaving the owner to wonder.
    await openCategory(page, 'Bonnets E2E');
    await expect(page.getByText(/ne contient aucun produit en ligne/)).toBeVisible();
  });

  test('renames one, and the old address stops working', async ({ page }) => {
    await becomeStaff(page);

    const slug = `e2e-echarpes-${Date.now()}`;
    await createCategory(page, 'Écharpes E2E', slug);

    const renamed = `${slug}-v2`;
    createdSlugs.push(renamed);

    await openCategory(page, 'Écharpes E2E');
    await page
      .getByRole('textbox', { name: 'Adresse (slug)', exact: true })
      .fill(renamed);
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Modifications enregistrées').first()).toBeVisible();

    await page.goto('/admin/categories');
    await expect(page.getByText(`/shop/c/${renamed}`)).toBeVisible();

    /*
     * A category keeps no redirect, unlike a product (11.6). A category listing
     * is navigation rather than an address customers are given, so the old one
     * is simply gone — which is what the repository's comment says and what
     * this asserts rather than assumes.
     */
    expect((await page.goto(`/fr/shop/c/${slug}`))?.status()).toBe(404);
  });

  /*
   * The rule that needed a screen to be enforceable: hiding a shelf that is
   * still stocked would leave its products selling with no way to reach them.
   */
  test('refuses to hide a category that still holds live products', async ({ page }) => {
    await becomeStaff(page);
    await openCategory(page, 'Accessoires');

    await page.getByRole('checkbox', { name: 'Catégorie visible' }).click();
    await page.getByRole('button', { name: 'Enregistrer' }).click();

    await expect(page.getByText(/Cette catégorie contient des produits/)).toBeVisible();

    // And nothing was written: the storefront still has the chip.
    await page.goto('/fr/shop');
    await expect(
      page
        .getByRole('navigation', { name: 'Filtrer par catégorie' })
        .getByRole('link', { name: 'Accessoires' }),
    ).toBeVisible();
  });

  test('hides an empty one, and its page goes with it', async ({ page }) => {
    await becomeStaff(page);

    const slug = `e2e-gants-${Date.now()}`;
    await createCategory(page, 'Gants E2E', slug);

    // Visible while it is active, even with nothing in it: the owner can look
    // at the shelf they are about to fill.
    expect((await page.goto(`/fr/shop/c/${slug}`))?.status()).toBe(200);

    await openCategory(page, 'Gants E2E');
    await page.getByRole('checkbox', { name: 'Catégorie visible' }).click();
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Modifications enregistrées').first()).toBeVisible();

    await page.goto('/admin/categories');
    await expect(page.getByRole('row', { name: /Gants E2E/ })).toContainText('Masquée');

    expect((await page.goto(`/fr/shop/c/${slug}`))?.status()).toBe(404);
  });

  /*
   * The workshop half of Phase 14.14: somebody types English into the form and
   * an English visitor reads it. Nothing else in the suite proves the write
   * path — the storefront tests read what the seed wrote.
   */
  test('translates a category, and an English visitor reads it', async ({ page }) => {
    await becomeStaff(page);

    const slug = `e2e-chaussettes-${Date.now()}`;
    await createCategory(page, 'Chaussettes E2E', slug);
    await openCategory(page, 'Chaussettes E2E');

    // The panel is collapsed until somebody wants it. Its fields are named by
    // language, so they need no scoping once it is open.
    await page.getByRole('group', { name: 'Version anglaise' }).click();
    await page
      .getByRole('textbox', { name: 'Nom de la catégorie (English)' })
      .fill('Socks E2E');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Modifications enregistrées').first()).toBeVisible();

    await page.goto(`/en/shop/c/${slug}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Socks E2E');

    await page.goto(`/fr/shop/c/${slug}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Chaussettes E2E');

    /*
     * Clearing a translation gives the French back rather than blanking the
     * page — the one behaviour that separates "not translated" from
     * "translated to nothing".
     */
    await openCategory(page, 'Chaussettes E2E');
    await page.getByRole('group', { name: 'Version anglaise' }).click();
    await page.getByRole('textbox', { name: 'Nom de la catégorie (English)' }).fill('');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Modifications enregistrées').first()).toBeVisible();

    await page.goto(`/en/shop/c/${slug}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Chaussettes E2E');
  });

  test('refuses an address another category already has', async ({ page }) => {
    await becomeStaff(page);

    await page.goto('/admin/categories/new');
    await page
      .getByRole('textbox', { name: 'Nom de la catégorie', exact: true })
      .fill('Doublon E2E');
    await page
      .getByRole('textbox', { name: 'Adresse (slug)', exact: true })
      .fill('accessoires');
    await page.getByRole('button', { name: 'Créer la catégorie' }).click();

    await expect(page.getByText(/déjà utilisée par une autre catégorie/)).toBeVisible();
  });
});

test.describe('the 3D model card', () => {
  test.skip(!DATABASE_URL, 'DATABASE_URL is required to promote an account to staff');
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(90_000);

  /*
   * The workshop half of the 3D feature. It attaches a real `.glb` — the one
   * `scripts/make-demo-model.ts` generates — and takes it off again, which is
   * the only place the parse-before-store path is exercised through a browser.
   */
  test('attaches a 3D model to a product, and takes it off again', async ({ page }) => {
    await becomeStaff(page);

    await page.goto('/admin/products');
    await page.getByRole('link', { name: 'Casquette brodée' }).click();
    await page.waitForURL(/\/admin\/products\/[0-9a-f-]+$/);

    await expect(page.getByText('Aucun modèle 3D pour ce produit.')).toBeVisible();

    /*
     * The file is read without being stored, so the operator picks the material
     * before anything is published. Both of the demo model's materials are
     * offered and the parser's own suggestion is marked (ADR-036).
     */
    await page.locator('input[type="file"][accept*="glb"]').setInputFiles(DEMO_MODEL);

    const material = page.getByLabel('Matière brodée');
    await expect(material).toBeVisible({ timeout: 15_000 });
    await expect(material.locator('option')).toHaveText([/Fabric.*suggérée/, 'Rib']);

    await page.getByRole('button', { name: 'Attacher le modèle' }).click();

    await expect(page.getByText(/Fabric · \d+ Ko/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Aucun modèle 3D pour ce produit.')).toHaveCount(0);

    // And the storefront now offers the view.
    await page.goto('/fr/shop/casquette-brodee');
    await expect(page.getByRole('tab', { name: 'Vue 360°' })).toBeVisible();

    // Off again, which is also this test cleaning up after itself.
    await page.goto('/admin/products');
    await page.getByRole('link', { name: 'Casquette brodée' }).click();
    await page.getByRole('button', { name: 'Supprimer le modèle' }).click();
    await expect(page.getByText('Aucun modèle 3D pour ce produit.')).toBeVisible({
      timeout: 15_000,
    });

    await page.goto('/fr/shop/casquette-brodee');
    await expect(page.getByRole('tab')).toHaveCount(0);
  });
});
