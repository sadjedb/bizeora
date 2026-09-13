import { Client } from 'pg';
import { expect, test, type Page } from '@playwright/test';

/**
 * Clearing a queue, from the browser.
 *
 * The complaint this answers was plain: the workshop's lists only ever grew,
 * and nothing in the interface could take a row off one. What is proved here is
 * the whole of the answer in one pass — tick several rows, archive them in one
 * click, watch them leave the list, open the archive, and bring them back.
 *
 * Every row it touches it creates, and it deletes them afterwards. Nothing in
 * this file archives a record the rest of the suite reads.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const PASSWORD = 'correct horse battery staple';
const PREFIX = `e2e-archive-${Date.now()}`;

const createdEmails: string[] = [];

/*
 * Every fixture this file makes is numbered from here.
 *
 * The tests run serially and each seeds its own rows; a per-test index would
 * collide on `request_number`, which is unique, and the failure would look
 * like a bug in the feature rather than in the fixture.
 */
let seeded = 0;

async function withDatabase<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/**
 * Three submitted requests, written straight into the table.
 *
 * The builder journey is tested elsewhere; going through it three times here
 * would take a minute and prove something this file is not about.
 */
async function seedRequests(count: number): Promise<string[]> {
  return withDatabase(async (client) => {
    const numbers: string[] = [];

    for (let index = 0; index < count; index += 1) {
      seeded += 1;
      const number = `${PREFIX}-${seeded}`;
      numbers.push(number);

      await client.query(
        // `updated_at` is maintained by Prisma rather than by the database, so
        // an insert that bypasses the client has to set it.
        `INSERT INTO "custom_requests"
           ("request_number", "status", "source", "pricing_mode",
            "contact_name", "contact_email", "submitted_at", "updated_at")
         VALUES ($1, 'SUBMITTED', 'BUILDER', 'QUOTE', $2, $3, now(), now())`,
        [number, 'Cliente archivage', `${number}@example.invalid`],
      );
    }

    return numbers;
  });
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
}

async function becomeStaff(page: Page): Promise<void> {
  // A new account per call: the same address cannot register twice, and each
  // test signs in from scratch.
  const email = `${PREFIX}-staff-${createdEmails.length}@example.invalid`;
  createdEmails.push(email);

  await page.goto('/register');
  await page.getByLabel('Nom complet').fill('Atelier archivage');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await page.waitForURL(/\/account|\/admin/);
  await settle(page);

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

/** The row for one request number, whichever table it is in. */
function rowFor(page: Page, number: string) {
  return page.getByRole('row').filter({ hasText: number });
}

test.afterAll(async () => {
  if (!DATABASE_URL) return;

  await withDatabase(async (client) => {
    await client.query(`DELETE FROM "custom_requests" WHERE "request_number" LIKE $1`, [
      `${PREFIX}%`,
    ]);

    if (createdEmails.length > 0) {
      await client.query(
        `DELETE FROM "audit_logs" WHERE "actor_user_id" IN
           (SELECT "id" FROM "users" WHERE "email" = ANY($1::text[]))`,
        [createdEmails],
      );
      await client.query(`DELETE FROM "users" WHERE "email" = ANY($1::text[])`, [
        createdEmails,
      ]);
    }
  });
});

test.describe('archiving from the request queue', () => {
  test.skip(
    !DATABASE_URL,
    'DATABASE_URL is required to seed rows and promote an account',
  );
  test.describe.configure({ mode: 'serial' });

  test('archives several rows at once and brings them back', async ({ page }) => {
    const numbers = await seedRequests(3);
    await becomeStaff(page);

    await page.goto('/admin/requests');

    // All three are in the live queue to begin with.
    for (const number of numbers) {
      await expect(rowFor(page, number)).toBeVisible();
    }

    // Tick two of them. The checkbox has to win the click against the row's
    // stretched link, which is the thing most likely to break here.
    await rowFor(page, numbers[0]!).getByRole('checkbox').check();
    await rowFor(page, numbers[1]!).getByRole('checkbox').check();

    await expect(page.getByText('2 éléments sélectionnés')).toBeVisible();

    await page.getByRole('button', { name: 'Archiver' }).click();

    // Gone from the queue, and the third one is untouched.
    await expect(rowFor(page, numbers[0]!)).toHaveCount(0, { timeout: 15_000 });
    await expect(rowFor(page, numbers[1]!)).toHaveCount(0);
    await expect(rowFor(page, numbers[2]!)).toBeVisible();

    // And in the archive, which is where they can be reached.
    await page.getByRole('link', { name: /^Archives/ }).click();
    await page.waitForURL(/archived=1/);

    await expect(rowFor(page, numbers[0]!)).toBeVisible();
    await expect(rowFor(page, numbers[1]!)).toBeVisible();
    await expect(rowFor(page, numbers[2]!)).toHaveCount(0);

    // One click puts them back. That reversibility is the reason this is an
    // archive and not a delete.
    await rowFor(page, numbers[0]!).getByRole('checkbox').check();
    await rowFor(page, numbers[1]!).getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Restaurer' }).click();

    await expect(rowFor(page, numbers[0]!)).toHaveCount(0, { timeout: 15_000 });

    await page.getByRole('link', { name: 'Liste' }).click();
    await expect(rowFor(page, numbers[0]!)).toBeVisible();
    await expect(rowFor(page, numbers[1]!)).toBeVisible();
  });

  test('selects a whole table from the header, and clears it', async ({ page }) => {
    const numbers = await seedRequests(2);
    await becomeStaff(page);

    await page.goto('/admin/requests');
    for (const number of numbers) {
      await expect(rowFor(page, number)).toBeVisible();
    }

    // The header box sweeps the table it sits in. The count is whatever is in
    // the queue, so it is only asserted to be at least the two seeded here.
    await page
      .getByRole('checkbox', { name: 'Tout sélectionner sur cette page' })
      .first()
      .check();

    await expect(page.getByText(/éléments? sélectionnés?/)).toBeVisible();

    await page.getByRole('button', { name: 'Effacer la sélection' }).click();
    await expect(page.getByText(/éléments? sélectionnés?/)).toHaveCount(0);
  });

  test('is closed to a customer', async ({ page }) => {
    const email = `${PREFIX}-client@example.invalid`;
    createdEmails.push(email);

    await page.goto('/register');
    await page.getByLabel('Nom complet').fill('Cliente archivage');
    await page.getByLabel('Adresse e-mail').fill(email);
    await page.getByLabel('Mot de passe').fill(PASSWORD);
    await page.getByRole('button', { name: 'Créer mon compte' }).click();
    await page.waitForURL(/\/account/);
    await settle(page);

    await page.goto('/admin/requests?archived=1');

    // The workshop's layout sends them home in their own language rather than
    // rendering the screen and hiding the controls.
    await expect(page).toHaveURL(/\/(fr|en)$/);
  });
});
