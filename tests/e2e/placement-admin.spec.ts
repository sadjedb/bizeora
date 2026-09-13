import { randomUUID } from 'node:crypto';

import sharp from 'sharp';
import { Client } from 'pg';
import { expect, test, type Page } from '@playwright/test';

/**
 * The placement, from the customer's drag to the workshop's screen.
 *
 * The one journey that proves the whole feature, and the only one that can:
 * every other test checks a half of it. A customer positions their artwork on a
 * photograph of a garment, and the person who has to stitch it sees **the same
 * picture** — not a sentence describing it, not an approximation redrawn from
 * remembered numbers.
 *
 * Everything it creates it removes.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const PASSWORD = 'correct horse battery staple';
const PREFIX = `e2e-placement-${Date.now()}`;

/**
 * A real 4:1 PNG, generated rather than committed.
 *
 * The proportions are the point: the height the workshop is shown is derived
 * from the artwork's own pixels, so a wide logo must come back as a wide
 * measurement. `sharp` is already a dependency and generating it exercises the
 * same decode path a customer's file takes.
 */
async function logo(): Promise<Buffer> {
  return sharp({
    create: {
      width: 400,
      height: 100,
      channels: 3,
      background: { r: 30, g: 40, b: 90 },
    },
  })
    .png()
    .toBuffer();
}

const createdEmails: string[] = [];

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

async function register(page: Page, label: string): Promise<string> {
  const email = `${PREFIX}-${label}-${randomUUID().slice(0, 8)}@example.invalid`;
  createdEmails.push(email);

  await page.goto('/register');
  await page.getByLabel('Nom complet').fill('Atelier placement');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await page.waitForURL(/\/account|\/admin/);
  await settle(page);

  return email;
}

test.afterAll(async () => {
  if (!DATABASE_URL || createdEmails.length === 0) return;

  await withDatabase(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `SELECT "id" FROM "users" WHERE "email" = ANY($1::text[])`,
      [createdEmails],
    );
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return;

    const { rows: requests } = await client.query<{ id: string }>(
      `SELECT "id" FROM "custom_requests" WHERE "user_id" = ANY($1::uuid[])
         OR "contact_email" LIKE $2`,
      [ids, `${PREFIX}%`],
    );

    const requestIds = requests.map((row) => row.id);

    if (requestIds.length > 0) {
      const { rows: configs } = await client.query<{ customization_config_id: string }>(
        `SELECT "customization_config_id" FROM "custom_request_items"
          WHERE "request_id" = ANY($1::uuid[])`,
        [requestIds],
      );

      await client.query(`DELETE FROM "custom_requests" WHERE "id" = ANY($1::uuid[])`, [
        requestIds,
      ]);
      await client.query(
        `DELETE FROM "customization_configs" WHERE "id" = ANY($1::uuid[])`,
        [configs.map((row) => row.customization_config_id)],
      );
    }

    await client.query(
      `DELETE FROM "design_files" WHERE "owner_user_id" = ANY($1::uuid[])`,
      [ids],
    );
    await client.query(`DELETE FROM "users" WHERE "id" = ANY($1::uuid[])`, [ids]);
  });
});

test.describe('a placement reaches the workshop', () => {
  test.skip(!DATABASE_URL, 'DATABASE_URL is required to promote an account to staff');

  test('is dragged by the customer and drawn for the workshop', async ({ page }) => {
    const email = await register(page, 'client');

    /* --- the customer places a design ---------------------------------- */

    await page.goto('/custom');

    /*
     * The t-shirt by name, not "the first one".
     *
     * Only a blank whose photographs the owner has measured can be placed on,
     * and the list is ordered by price. Picking whichever is cheapest would
     * make this test pass or fail on the catalogue's pricing, which is not what
     * it is about.
     */
    await page.getByRole('radio', { name: /T-shirt brodé classique/ }).click();
    await page.getByRole('button', { name: 'Continuer' }).click();

    await page.locator('input[type="file"]').setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: await logo(),
    });
    await expect(page.getByText(/Envoi de logo\.png en cours/)).toHaveCount(0, {
      timeout: 15_000,
    });
    await page.getByRole('button', { name: 'Continuer' }).click();

    // The garment, with the artwork already on it and measured.
    const readout = page.getByRole('status');
    await expect(readout).toContainText('mm');
    const asOpened = await readout.innerText();

    /*
     * Resize it, from the keyboard.
     *
     * The pointer path is what a customer uses and the keyboard path is what
     * makes the editor usable at all for some of them — and it drives the same
     * `clampTransform`, so proving the figure moves proves the whole chain from
     * gesture to millimetre.
     */
    // The design box itself, named by its own instructions. `press` focuses it
    // first, which is the whole keyboard path in one call.
    const design = page.getByRole('button', { name: /Faites glisser le motif/ });
    await design.press('+');
    await design.press('+');
    await design.press('+');

    await expect(readout).not.toHaveText(asOpened);
    const asPlaced = await readout.innerText();

    await page.getByRole('button', { name: 'Continuer' }).click();

    // Options, then submit.
    /*
     * No size question here any more.
     *
     * The design was placed on a measured garment two steps ago, and the box the
     * customer dragged *is* the size (ADR-035). This step confirms it and moves
     * on; asking again with a radio group the server ignores is what it used to
     * do, and is the bug this replaced.
     */
    await expect(
      page.getByRole('radiogroup', { name: 'Taille de la broderie' }),
    ).toHaveCount(0);
    await page.getByRole('checkbox').first().click();
    await page.getByRole('button', { name: 'Continuer' }).click();

    await page.getByLabel('Nom complet').fill('Cliente placement');
    await page.getByLabel('Adresse e-mail').fill(email);
    await page
      .getByRole('button', { name: /Envoyer ma demande|Demander mon devis/ })
      .click();

    await expect(page.getByText('Nous avons bien reçu votre demande')).toBeVisible({
      timeout: 30_000,
    });

    const reference = (
      await page
        .getByText(/DEM-\d{4}-\d{4,}/)
        .first()
        .innerText()
    ).trim();

    /* --- the workshop sees the picture ---------------------------------- */

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

    await page.goto(`/admin/requests/${reference}`);

    const composite = page.locator('figure').first();
    await expect(composite).toBeVisible();

    // The garment underneath, and the customer's artwork on top of it.
    await expect(composite.locator('img')).toHaveCount(2);

    /*
     * The size the customer left it at, to the millimetre.
     *
     * This is the assertion the whole phase is for: the figure under the
     * workshop's picture is the figure that was under the customer's, and
     * neither was recomputed from the other.
     */
    await expect(composite).toContainText(asPlaced.trim());

    await composite.screenshot({ path: 'test-results/placement-admin.png' });

    // Not deleted or approximated: the sentence is there too, for reading out.
    await expect(page.getByText(/Devant/).first()).toBeVisible();
  });
});
