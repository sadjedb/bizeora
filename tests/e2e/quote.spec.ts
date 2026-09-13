import AxeBuilder from '@axe-core/playwright';
import { Client } from 'pg';
import { expect, test, type Page } from '@playwright/test';

/**
 * The quote journey, end to end, through the real interfaces.
 *
 * Request → admin review → quote → send → customer accepts → quote-bound
 * checkout. Nothing is stubbed: the request is submitted through the builder,
 * the quote is priced in the admin workspace, and the customer signs in and
 * accepts it. What this proves that no integration test can is that the two
 * halves of the workflow meet — that the number the admin typed is the number
 * the customer is asked to agree to, and that agreeing to it lands on a
 * checkout for exactly that amount.
 *
 * Two things are done directly in the database, because no interface for them
 * exists yet and inventing one would be a worse test:
 *
 *   - **promoting a user to STAFF.** User management is Phase 12; the admin
 *     area needs somebody to be staff before it can be exercised at all.
 *   - **marking an address verified.** Verification is an 8-digit code sent by
 *     e-mail (ADR-021) and the development transport does not log it, on
 *     purpose. Acceptance requires a verified address (`SECURITY.md` section 2),
 *     which is the rule being satisfied here rather than bypassed.
 */

const DATABASE_URL = process.env.DATABASE_URL;

/** A distinct identity per worker, so parallel runs never share an account. */
function identity(role: string, index: number): { email: string; password: string } {
  return {
    email: `e2e-quote-${role}-${Date.now()}-${index}-${Math.floor(Math.random() * 1e6)}@example.invalid`,
    password: 'correct horse battery staple',
  };
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
    client.query(`UPDATE "users" SET "role" = 'STAFF' WHERE lower("email") = lower($1)`, [
      email,
    ]),
  );
}

async function verifyAddress(email: string): Promise<void> {
  await withDatabase((client) =>
    client.query(
      `UPDATE "users" SET "email_verified" = true WHERE lower("email") = lower($1)`,
      [email],
    ),
  );
}

/**
 * Remove everything this file created.
 *
 * These tests run against the same database the integration suite uses, and an
 * end-to-end run that leaves accounts, requests, quotes and carts behind grows
 * that shared state on every run. Nothing here asserts on a global count today,
 * but a suite that accumulates rows forever is a suite whose failures eventually
 * depend on how many times it has been run.
 *
 * Deletion order follows the foreign keys: carts and quotes reference users with
 * `ON DELETE RESTRICT`, so they go first, then the requests, then the
 * configurations they left behind, then the accounts.
 */
async function purgeTestAccounts(): Promise<void> {
  await withDatabase(async (client) => {
    const pattern = 'e2e-quote-%@example.invalid';

    const { rows } = await client.query<{ id: string }>(
      `SELECT "id" FROM "users" WHERE "email" LIKE $1`,
      [pattern],
    );

    if (rows.length === 0) return;
    const ids = rows.map((row) => row.id);

    await client.query(
      `DELETE FROM "carts" WHERE "user_id" = ANY($1::uuid[])
         OR "quote_id" IN (SELECT "id" FROM "quotes" WHERE "user_id" = ANY($1::uuid[]))`,
      [ids],
    );
    await client.query(`DELETE FROM "quotes" WHERE "user_id" = ANY($1::uuid[])`, [ids]);

    const { rows: requests } = await client.query<{ id: string }>(
      `SELECT "id" FROM "custom_requests"
        WHERE "user_id" = ANY($1::uuid[]) OR "contact_email" LIKE $2`,
      [ids, pattern],
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

      const configIds = configs.map((row) => row.customization_config_id);
      if (configIds.length > 0) {
        await client.query(
          `DELETE FROM "customization_configs" WHERE "id" = ANY($1::uuid[])`,
          [configIds],
        );
      }
    }

    await client.query(`DELETE FROM "users" WHERE "id" = ANY($1::uuid[])`, [ids]);
  });
}

/**
 * Wait for the page to stop fetching, within reason.
 *
 * Signing in refreshes the tree it lands on, and a `goto` issued while that
 * refresh is in flight is cancelled — `net::ERR_ABORTED`, intermittently and
 * only under parallel load. Idleness is the signal that the refresh finished.
 *
 * It is deliberately best-effort: a page that holds a connection open never
 * reports idle, and waiting forever for that would trade one flake for
 * another. The assertions that follow are what actually decide the test.
 */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
}

async function register(page: Page, credentials: { email: string; password: string }) {
  await page.goto('/register');
  await page.getByLabel('Nom complet').fill('Client de test');
  await page.getByLabel('Adresse e-mail').fill(credentials.email);
  await page.getByLabel('Mot de passe').fill(credentials.password);
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await page.waitForURL(/\/account|\/admin/);
  // The URL changes when the client router *starts* the navigation. Waiting
  // for the form itself to leave the document waits for it to finish — a
  // `goto` issued in between is cancelled (`net::ERR_ABORTED`).
  await page
    .getByRole('button', { name: 'Créer mon compte' })
    .waitFor({ state: 'detached' });
  await settle(page);
}

async function signIn(page: Page, credentials: { email: string; password: string }) {
  await page.goto('/login');

  // `/login` redirects an already-signed-in visitor, so a stale session would
  // otherwise leave this waiting for a form that will never render.
  if (!page.url().includes('/login')) await signOut(page);
  await page.goto('/login');

  await page.getByLabel('Adresse e-mail').fill(credentials.email);
  await page.getByLabel('Mot de passe').fill(credentials.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForURL(/\/account|\/admin/);
  // As in `register`: the form leaving the document is what says the
  // navigation finished, rather than merely having been asked for.
  await page.getByRole('button', { name: 'Se connecter' }).waitFor({ state: 'detached' });
  await settle(page);
}

async function signOut(page: Page, client: Client | null = null) {
  // No sign-out control exists yet (Phase 11 builds the account area), so the
  // session cookie is cleared directly. The alternative — building a header
  // control this phase does not need — would be scope creep in a test.
  void client;
  await page.context().clearCookies();
}

/** Submit a custom request through the builder, returning its number. */
async function submitRequest(page: Page, email: string): Promise<string> {
  await page.goto('/custom');
  // The t-shirt by name: only a measured blank can be placed on, and the list
  // is ordered by price (ADR-035).
  await page.getByRole('radio', { name: /T-shirt brodé classique/ }).click();
  await page.getByRole('button', { name: 'Continuer' }).click();

  /*
   * Design, then placement.
   *
   * Freeform placement (ADR-035) reversed the middle two steps — you cannot
   * drag a logo onto a hoodie before you have the logo — and replaced the list
   * of named zones with a canvas. The design opens already on the garment at
   * chest height, so accepting that default is the path most customers take
   * and the one taken here.
   */
  await page.getByLabel(/Texte à broder/).fill('Amina');
  await page.getByRole('button', { name: 'Continuer' }).click();

  await expect(page.getByRole('status')).toContainText('mm');
  await page.getByRole('button', { name: 'Continuer' }).click();

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

  await page.getByLabel('Nom complet').fill('Client de test');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page
    .getByRole('button', { name: /Envoyer ma demande|Demander mon devis/ })
    .click();

  await expect(page.getByText('Nous avons bien reçu votre demande')).toBeVisible();
  const reference = await page
    .getByText(/DEM-\d{4}-\d{4,}/)
    .first()
    .innerText();

  return /DEM-\d{4}-\d{4,}/.exec(reference)![0];
}

/** Price and send a quote from the admin workspace. */
async function priceAndSend(page: Page, requestNumber: string) {
  await page.goto(`/admin/requests/${requestNumber}`);
  await expect(page.getByRole('heading', { name: requestNumber })).toBeVisible();

  // The editor arrives pre-filled with the suggestion derived from the
  // configuration (2.6.1). The admin overwrites the price, which is the point
  // of a quote.
  await page.getByLabel('Prix unitaire (DA)').first().fill('350000');

  await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click();
  await expect(page.getByText('Brouillon enregistré.')).toBeVisible();

  // The preview is the server's arithmetic, shown before anything is sent.
  await expect(page.getByRole('heading', { name: 'Aperçu client' })).toBeVisible();

  await page.getByRole('button', { name: 'Envoyer au client' }).click();
  await expect(page.getByText(/Devis Q-\d+ en attente/)).toBeVisible();
}

async function scanForViolations(page: Page, label: string) {
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

test.describe('the quote journey', () => {
  test.skip(!DATABASE_URL, 'DATABASE_URL is required to promote a test user to staff');
  test.describe.configure({ mode: 'serial' });

  // Before as well as after: a run that crashes half way leaves accounts
  // behind, and the next run should not inherit them.
  test.beforeAll(purgeTestAccounts);
  test.afterAll(purgeTestAccounts);

  test('runs from a request to an accepted quote and its checkout', async ({ page }) => {
    test.setTimeout(180_000);

    const customer = identity('customer', 1);
    const staff = identity('staff', 1);

    // 1. A customer with an account and a verified address.
    await register(page, customer);
    await expect(page.getByRole('heading', { name: /^Bonjour/ })).toBeVisible();
    await verifyAddress(customer.email);

    // 2. They ask for a quote through the builder.
    const requestNumber = await submitRequest(page, customer.email);

    // 3. The workshop prices it. A fresh browser context, because staff and
    //    customer are different people.
    await signOut(page);
    await register(page, staff);
    // Registration signs the account in, so promoting it is enough — the role
    // is read from the user row on every request, not baked into the cookie.
    await promoteToStaff(staff.email);

    await page.goto('/admin/requests');
    await expect(page.getByRole('link', { name: requestNumber })).toBeVisible();

    await priceAndSend(page, requestNumber);

    // 4. The customer reads the quote.
    await signOut(page);
    await signIn(page, customer);

    await page.goto('/account/quotes');
    const quoteLink = page.getByRole('link', { name: /Devis Q-\d+/ }).first();
    await expect(quoteLink).toBeVisible();

    const quoteLabel = await quoteLink.innerText();
    const quoteNumber = /Q-[\w-]+/.exec(quoteLabel)![0];

    await quoteLink.click();
    await expect(
      page.getByRole('heading', { name: `Devis ${quoteNumber}` }),
    ).toBeVisible();

    // Every line is itemised, and the total is the workshop's number.
    await expect(page.getByRole('table', { name: /lignes du devis/i })).toBeVisible();
    await expect(page.getByText('Total', { exact: true })).toBeVisible();
    await expect(page.getByText('Acompte à verser')).toBeVisible();

    await scanForViolations(page, 'the customer quote page');

    // 5. They accept, and land on the quote-bound checkout.
    await page.getByRole('button', { name: 'Accepter ce devis' }).click();
    await page.waitForURL(/\/checkout\/quote\//);

    await expect(
      page.getByRole('heading', { name: new RegExp(`devis ${quoteNumber}`, 'i') }),
    ).toBeVisible();

    // 5A: no quantity stepper, no coupon field, no add-item control.
    await expect(page.getByRole('spinbutton', { name: /Quantité/ })).toHaveCount(0);
    await expect(page.getByLabel(/code promo/i)).toHaveCount(0);

    await scanForViolations(page, 'the quote-bound checkout');
  });

  test('lets a customer decline, with a reason', async ({ page }) => {
    test.setTimeout(180_000);

    const customer = identity('decline', 2);
    const staff = identity('staff', 2);

    await register(page, customer);
    await verifyAddress(customer.email);
    const requestNumber = await submitRequest(page, customer.email);

    await signOut(page);
    await register(page, staff);
    await promoteToStaff(staff.email);
    await priceAndSend(page, requestNumber);

    await signOut(page);
    await signIn(page, customer);

    await page.goto('/account/quotes');
    await page
      .getByRole('link', { name: /Devis Q-\d+/ })
      .first()
      .click();

    await page.getByRole('button', { name: 'Refuser' }).click();
    await page.getByLabel('Motif').fill('Le délai ne convient pas.');
    await page.getByRole('button', { name: 'Confirmer le refus' }).click();

    await expect(page.getByText('Le délai ne convient pas.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accepter ce devis' })).toHaveCount(0);
  });
});

test.describe('the quote pages on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('sign-in and the empty quote list fit 375px', async ({ page }) => {
    for (const path of ['/login', '/register']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );

      expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(0);
      await scanForViolations(page, path);
    }
  });
});
