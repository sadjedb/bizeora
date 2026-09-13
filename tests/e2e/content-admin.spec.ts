import AxeBuilder from '@axe-core/playwright';
import sharp from 'sharp';
import { Client } from 'pg';
import { expect, test, type Page } from '@playwright/test';

/**
 * The landing-page editor.
 *
 * `ADR-027` made the homepage rows so the owner could reorder it without a
 * deploy; Phase 14.8 built the screen that does the reordering. What is proved
 * here is the whole promise, end to end: a headline typed in the workshop is on
 * the front page, in the language it was typed in, without a developer.
 *
 * The homepage is cached (`revalidate = 300`), so every assertion against the
 * storefront is also an assertion that the write invalidated the cache. A test
 * that passed only because five minutes had elapsed would be no test at all.
 *
 * Everything this file changes, it changes back: the seeded content is what the
 * rest of the suite reads.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const PASSWORD = 'correct horse battery staple';
const CMS = 'e2e-cms';

const createdEmails: string[] = [];

function identity(label: string): { email: string; password: string } {
  const email = `${CMS}-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.invalid`;
  createdEmails.push(email);

  return { email, password: PASSWORD };
}

async function withDatabase<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function promoteToStaff(email: string): Promise<void> {
  await withDatabase((client) =>
    client.query(`UPDATE "users" SET "role" = 'STAFF' WHERE "email" = $1`, [email]),
  );
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
}

async function becomeStaff(page: Page): Promise<void> {
  const staff = identity('staff');

  await page.goto('/register');
  await page.getByLabel('Nom complet').fill('Atelier CMS');
  await page.getByLabel('Adresse e-mail').fill(staff.email);
  await page.getByLabel('Mot de passe').fill(staff.password);
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await page.waitForURL(/\/account|\/admin/);
  await page
    .getByRole('button', { name: 'Créer mon compte' })
    .waitFor({ state: 'detached' });
  await settle(page);

  await promoteToStaff(staff.email);
  // The session carries the role, so it has to be reissued.
  await page.context().clearCookies();

  await page.goto('/login');
  await page.getByLabel('Adresse e-mail').fill(staff.email);
  await page.getByLabel('Mot de passe').fill(staff.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForURL(/\/account|\/admin/);
  await page.getByRole('button', { name: 'Se connecter' }).waitFor({ state: 'detached' });
  await settle(page);

  await page.goto('/admin/content');
  await page.waitForURL(/\/admin\/content$/);
}

/**
 * The homepage, until it shows what was just written.
 *
 * `revalidatePath` marks the cached page stale rather than rebuilding it, so
 * the first request afterwards may still be served the old copy while the new
 * one is generated behind it — stale-while-revalidate, working as designed.
 * Reloading until it appears is what a person would do, and it fails loudly
 * within a bounded time if the write genuinely did not reach the page.
 */
async function expectHeadline(page: Page, path: string, headline: string) {
  await expect(async () => {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(headline, {
      timeout: 2_000,
    });
  }).toPass({ timeout: 30_000 });
}

/**
 * Whether a band is on the front page, once the cache has caught up.
 *
 * The same reason `expectHeadline` polls: `revalidatePath` marks the page
 * stale, and the request that follows may still be served the old copy while
 * the new one is built behind it.
 */
async function expectBand(page: Page, heading: string, present: boolean) {
  await expect(async () => {
    await page.goto('/fr');
    await expect(page.getByRole('heading', { name: heading })).toHaveCount(
      present ? 1 : 0,
      { timeout: 2_000 },
    );
  }).toPass({ timeout: 30_000 });
}

/** What the hero says before this file touches it, so it can be put back. */
type HeroSnapshot = { title: string | null; config: unknown };

async function readHero(): Promise<HeroSnapshot> {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ title: string | null; config: unknown }>(
      `SELECT "title", "config" FROM "homepage_sections" WHERE "type" = 'HERO' LIMIT 1`,
    );

    return rows[0] ?? { title: null, config: null };
  });
}

async function restoreHero(snapshot: HeroSnapshot): Promise<void> {
  await withDatabase((client) =>
    client.query(
      `UPDATE "homepage_sections" SET "title" = $1, "config" = $2 WHERE "type" = 'HERO'`,
      [snapshot.title, snapshot.config],
    ),
  );
}

let hero: HeroSnapshot = { title: null, config: null };

test.beforeAll(async () => {
  if (!DATABASE_URL) return;
  hero = await readHero();
});

test.afterAll(async () => {
  if (!DATABASE_URL) return;

  await restoreHero(hero);

  await withDatabase(async (client) => {
    // Anything this file switched off goes back on.
    await client.query(
      `UPDATE "homepage_sections" SET "is_enabled" = true WHERE "type" = 'GALLERY'`,
    );
    await client.query(`DELETE FROM "banners" WHERE "message" LIKE $1`, [`${CMS}%`]);

    if (createdEmails.length > 0) {
      await client.query(`DELETE FROM "users" WHERE "email" = ANY($1::text[])`, [
        createdEmails,
      ]);
    }
  });
});

test.describe('the landing-page editor', () => {
  test.skip(!DATABASE_URL, 'DATABASE_URL is required to promote an account to staff');
  test.describe.configure({ mode: 'serial' });

  test('writes a headline that reaches the front page in both languages', async ({
    page,
  }) => {
    await becomeStaff(page);

    const french = `Broderie ${Date.now()}`;
    const english = `Embroidery ${Date.now()}`;

    await page
      .getByRole('listitem')
      .filter({ hasText: 'Accroche' })
      .getByRole('button', { name: 'Modifier' })
      .click();

    const editor = page.getByRole('dialog');
    await expect(editor).toBeVisible();

    // Exact: "Titre" is also a prefix of "Sous-titre" and a suffix of
    // "Sur-titre", and the accessible name is what a person hears.
    await editor.getByRole('textbox', { name: 'Titre', exact: true }).fill(french);

    // The English tab writes the overlay, not the row.
    await editor.getByRole('tab', { name: 'English' }).click();
    await editor.getByRole('textbox', { name: 'Titre', exact: true }).fill(english);

    await editor.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(editor).toBeHidden({ timeout: 15_000 });

    await expectHeadline(page, '/fr', french);
    await expectHeadline(page, '/en', english);
  });

  test('refuses a destination that leaves the site', async ({ page }) => {
    await becomeStaff(page);

    await page
      .getByRole('listitem')
      .filter({ hasText: 'Accroche' })
      .getByRole('button', { name: 'Modifier' })
      .click();

    const editor = page.getByRole('dialog');
    await editor
      .getByRole('textbox', { name: 'Destination (optionnel)', exact: true })
      .fill('https://ailleurs.example');
    await editor.getByRole('button', { name: 'Enregistrer' }).click();

    await expect(editor.getByText(/doit être une page du site/)).toBeVisible();
    await expect(editor).toBeVisible();
  });

  test('switches a band off and the front page loses it', async ({ page }) => {
    await becomeStaff(page);

    const row = page.getByRole('listitem').filter({ hasText: 'Galerie' });

    await row.getByRole('button', { name: 'Masquer' }).click();
    await expect(row.getByRole('button', { name: 'Afficher' })).toBeVisible({
      timeout: 15_000,
    });

    await expectBand(page, 'Ce que nous avons brodé', false);

    await page.goto('/admin/content');
    await page
      .getByRole('listitem')
      .filter({ hasText: 'Galerie' })
      .getByRole('button', { name: 'Afficher' })
      .click();

    await expectBand(page, 'Ce que nous avons brodé', true);
  });

  test('puts an uploaded photograph behind the hero', async ({ page }) => {
    await becomeStaff(page);

    await page
      .getByRole('listitem')
      .filter({ hasText: 'Accroche' })
      .getByRole('button', { name: 'Modifier' })
      .click();

    const editor = page.getByRole('dialog');

    await editor.locator('input[type="file"]').setInputFiles({
      name: 'hero.jpg',
      mimeType: 'image/jpeg',
      buffer: await sharp({
        create: {
          width: 1600,
          height: 900,
          channels: 3,
          background: { r: 40, g: 36, b: 32 },
        },
      })
        .jpeg()
        .toBuffer(),
    });

    // The upload replaces the preview, which is how the operator knows it
    // worked before saving.
    await expect(editor.getByRole('button', { name: 'Remplacer' })).toBeVisible({
      timeout: 30_000,
    });

    await editor.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(editor).toBeHidden({ timeout: 15_000 });

    await page.goto('/fr');

    const hero = page.locator('img').first();
    const src = await hero.getAttribute('src');
    expect(decodeURIComponent(src ?? '')).toContain('/assets/media/');
  });

  test('adds a banner message and shows it above the header', async ({ page }) => {
    await becomeStaff(page);

    const message = `${CMS} livraison offerte cette semaine`;

    await page.getByRole('button', { name: 'Ajouter un message' }).click();

    const row = page.getByRole('listitem').filter({ hasText: 'Message' }).last();
    await row.getByRole('textbox', { name: 'Message', exact: true }).fill(message);
    await row.getByRole('button', { name: 'Enregistrer' }).click();

    // Saved, and the screen says so by listing it — before looking at the
    // storefront, so a failure names which half broke.
    await expect(
      page.getByRole('textbox', { name: 'Message', exact: true }).last(),
    ).toHaveValue(message, { timeout: 15_000 });

    // Same as the headline: the front page is cached, and invalidating it marks
    // it stale rather than rebuilding it on the spot.
    await expect(async () => {
      await page.goto('/fr');
      await expect(page.getByText(message)).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
  });

  test('has no accessibility violations', async ({ page }) => {
    await becomeStaff(page);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('is closed to a customer', async ({ page }) => {
    const customer = identity('client');

    await page.goto('/register');
    await page.getByLabel('Nom complet').fill('Client CMS');
    await page.getByLabel('Adresse e-mail').fill(customer.email);
    await page.getByLabel('Mot de passe').fill(customer.password);
    await page.getByRole('button', { name: 'Créer mon compte' }).click();
    await page.waitForURL(/\/account/);
    await settle(page);

    await page.goto('/admin/content');

    // The workshop's layout turns a customer away at the door and sends them
    // home, in their own language — it does not render the screen and hide the
    // controls, and it does not admit that the address exists.
    await expect(page).toHaveURL(/\/(fr|en)$/);
    await expect(page.getByRole('heading', { name: 'Page d’accueil' })).toHaveCount(0);
  });
});
