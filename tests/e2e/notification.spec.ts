import { Client } from 'pg';
import { expect, test, type Page } from '@playwright/test';

/**
 * The four customer-facing events, end to end.
 *
 * A request is submitted, a quote is priced and sent, an order is placed and a
 * quote is left to approach its deadline — all through the real interfaces —
 * and each time the outbox is read back to see what the application decided to
 * announce, and to whom.
 *
 * **The outbox row is the assertion, not the inbox.** The transport lives in
 * the server process and this test lives in another, so a captured message is
 * not observable from here; what is observable is the durable record the
 * business transaction wrote — its template, its recipient, its dedupe key and
 * its status once the scheduler has run. That record is also the thing that
 * matters: it is what survives a crash between the order and the e-mail. The
 * rendered content of each of the eight templates is asserted in
 * `tests/unit/notification-domain.test.ts`, and the payload snapshots in
 * `tests/integration/notification.test.ts`, both with the transport in process.
 *
 * Nothing is sent anywhere. The server under test has no `RESEND_API_KEY`, so
 * it runs the console transport: the whole outbox is exercised — claim, render,
 * mark sent — and no message leaves the machine.
 *
 * Three things are done directly in the database, because no interface for them
 * exists and inventing one would be a worse test: promoting a user to STAFF (as
 * `quote.spec.ts` does), configuring the workshop's notification address (a
 * settings row; settings management is not in V1), and pulling a quote's
 * `valid_until` forward so that it falls inside the warning window.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const JOBS_SECRET = process.env.JOBS_SECRET;

/** Distinct from every other spec's prefix, and disjoint from all of them. */
const PREFIX = 'e2e-notif';
const WORKSHOP = `${PREFIX}-workshop@example.invalid`;
const RECIPIENTS_KEY = 'notifications.adminRecipients';

/** Seeded `MADE_TO_ORDER`, so repeated runs never exhaust its stock. */
const PRODUCT = '/shop/tote-bag-toile-epaisse';

function identity(role: string): { email: string; password: string } {
  return {
    email: `${PREFIX}-${role}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.invalid`,
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

type OutboxRow = {
  template: string;
  recipient: string | null;
  status: string;
  dedupe_key: string | null;
  attempts: number;
};

/** Every queued announcement whose key names this subject. */
async function outboxFor(subject: string): Promise<OutboxRow[]> {
  return withDatabase(async (client) => {
    const { rows } = await client.query<OutboxRow>(
      `SELECT "template", "recipient", "status", "dedupe_key", "attempts"
         FROM "notifications"
        WHERE "dedupe_key" LIKE '%' || $1 || '%'
        ORDER BY "template"`,
      [subject],
    );

    return rows;
  });
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

/** Read the workshop address back, so the original can be restored. */
async function readWorkshopSetting(): Promise<string | null> {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ value: string }>(
      `SELECT "value" FROM "settings" WHERE "key" = $1`,
      [RECIPIENTS_KEY],
    );

    return rows[0]?.value ?? null;
  });
}

async function writeWorkshopSetting(value: string): Promise<void> {
  await withDatabase((client) =>
    client.query(
      `UPDATE "settings" SET "value" = $2, "updated_at" = now() WHERE "key" = $1`,
      [RECIPIENTS_KEY, value],
    ),
  );
}

/**
 * Remove everything this file created.
 *
 * Notifications first: they reference users, quotes, requests and orders, and
 * the point of the cleanup is that a suite's failures never depend on how many
 * times it has been run.
 */
async function purge(): Promise<void> {
  await withDatabase(async (client) => {
    const pattern = `${PREFIX}-%@example.invalid`;

    const { rows } = await client.query<{ id: string }>(
      `SELECT "id" FROM "users" WHERE "email" LIKE $1`,
      [pattern],
    );

    const ids = rows.map((row) => row.id);

    await client.query(
      `DELETE FROM "notifications"
        WHERE "recipient" LIKE $1
           OR "user_id" = ANY($2::uuid[])
           OR "related_order_id" IN
              (SELECT "id" FROM "orders" WHERE "contact_email" LIKE $1)`,
      [pattern, ids],
    );

    if (ids.length === 0) return;

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

async function signOut(page: Page) {
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

/** Price and send a quote from the admin workspace, returning its number. */
async function priceAndSend(page: Page, requestNumber: string): Promise<string> {
  await page.goto(`/admin/requests/${requestNumber}`);
  await expect(page.getByRole('heading', { name: requestNumber })).toBeVisible();

  await page.getByLabel('Prix unitaire (DA)').first().fill('350000');
  await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click();
  await expect(page.getByText('Brouillon enregistré.')).toBeVisible();

  await page.getByRole('button', { name: 'Envoyer au client' }).click();

  const banner = page.getByText(/Devis Q-\d+ en attente/);
  await expect(banner).toBeVisible();

  return /Q-[\w-]+/.exec(await banner.innerText())![0];
}

/** Run the scheduler exactly as a cron job would. */
async function runSweep(page: Page): Promise<number> {
  const response = await page.request.post('/api/jobs/notifications', {
    headers: { authorization: `Bearer ${JOBS_SECRET}` },
  });

  return response.status();
}

test.describe('transactional notifications', () => {
  test.skip(!DATABASE_URL, 'DATABASE_URL is required to read the outbox');
  test.skip(!JOBS_SECRET, 'JOBS_SECRET is required to run the scheduled sweep');
  test.describe.configure({ mode: 'serial' });

  let previousWorkshop: string | null = null;

  test.beforeAll(async () => {
    await purge();
    previousWorkshop = await readWorkshopSetting();
    await writeWorkshopSetting(WORKSHOP);
  });

  test.afterAll(async () => {
    await writeWorkshopSetting(previousWorkshop ?? '');
    await purge();
  });

  test('announces a request, a quote, an order and an approaching deadline', async ({
    page,
  }) => {
    test.setTimeout(240_000);

    const customer = identity('customer');
    const staff = identity('staff');

    await register(page, customer);
    await verifyAddress(customer.email);

    /* 1. A custom request tells the workshop. --------------------------- */

    const requestNumber = await submitRequest(page, customer.email);

    const submitted = await outboxFor(requestNumber);
    const toWorkshop = submitted.filter((row) => row.template === 'request.submitted');

    expect(toWorkshop).toHaveLength(1);
    expect(toWorkshop[0]!.recipient).toBe(WORKSHOP);
    expect(toWorkshop[0]!.dedupe_key).toBe(
      `request.submitted:${requestNumber}:${WORKSHOP}`,
    );

    // The address the customer typed into the form routes nothing: it is their
    // own contact detail, not a destination for a staff announcement.
    expect(submitted.some((row) => row.recipient === customer.email)).toBe(false);

    /* 2. A sent quote reaches the customer. ----------------------------- */

    await signOut(page);
    await register(page, staff);
    await promoteToStaff(staff.email);

    const quoteNumber = await priceAndSend(page, requestNumber);

    const sent = await outboxFor(quoteNumber);
    const toCustomer = sent.filter((row) => row.template === 'quote.sent');

    expect(toCustomer).toHaveLength(1);
    // The account's address, resolved on the server from the quote's owner —
    // not the contact field of the form that started the request.
    expect(toCustomer[0]!.recipient).toBe(customer.email);
    expect(toCustomer[0]!.dedupe_key).toBe(`quote.sent:${quoteNumber}`);

    /* 3. An order confirms to the customer and alerts the workshop. ----- */

    await signOut(page);
    await page.goto(PRODUCT);
    await page.getByRole('button', { name: 'Ajouter au panier' }).click();
    await expect(page.getByText('Ajouté à votre panier.')).toBeVisible();

    const buyer = identity('buyer').email;

    await page.goto('/checkout');
    await page.getByLabel('Nom complet').fill('Amina Bensalem');
    await page.getByLabel('Adresse e-mail').fill(buyer);
    await page.getByLabel('Téléphone').fill('0555 12 34 56');
    await page.getByRole('combobox', { name: 'Wilaya' }).click();
    await page.getByRole('option', { name: /16 — Alger/ }).click();
    await expect(
      page.getByRole('radiogroup', { name: 'Mode de livraison' }),
    ).toBeVisible();
    await page.getByLabel('Commune').fill('Hydra');
    await page.getByLabel('Adresse de livraison').fill('12 rue des Frères Bouadou');
    await page.getByLabel(/J’accepte les conditions/).check();
    await page.getByRole('button', { name: 'Confirmer la commande' }).click();

    await page.waitForURL(/\/order\/CMD-\d{4}-\d+/);
    const orderNumber = /CMD-\d{4}-\d+/.exec(page.url())![0];

    const placed = await outboxFor(orderNumber);
    const confirmation = placed.find((row) => row.template === 'order.confirmed');
    const alert = placed.find((row) => row.template === 'order.placed');

    expect(confirmation).toBeDefined();
    expect(alert).toBeDefined();

    // The confirmation goes to the address stored *on the order*, which is the
    // contact detail the checkout validated and persisted.
    const storedContact = await withDatabase(async (client) => {
      const { rows } = await client.query<{ contact_email: string }>(
        `SELECT "contact_email" FROM "orders" WHERE "order_number" = $1`,
        [orderNumber],
      );

      return rows[0]!.contact_email;
    });

    expect(confirmation!.recipient).toBe(storedContact);
    expect(alert!.recipient).toBe(WORKSHOP);
    expect(alert!.dedupe_key).toBe(`order.placed:${orderNumber}:${WORKSHOP}`);

    /* 4. A quote approaching its deadline is warned about, once. -------- */

    // Two days is the warning lead, so a deadline one day out is inside it.
    await withDatabase((client) =>
      client.query(`UPDATE "quotes" SET "valid_until" = $2 WHERE "quote_number" = $1`, [
        quoteNumber,
        new Date(Date.now() + 24 * 60 * 60 * 1000),
      ]),
    );

    expect(await runSweep(page)).toBe(200);

    const warned = (await outboxFor(quoteNumber)).filter((row) =>
      row.template.startsWith('quote.expiring'),
    );

    expect(warned.map((row) => row.template).sort()).toEqual([
      'quote.expiring',
      'quote.expiring.staff',
    ]);
    expect(warned.find((row) => row.template === 'quote.expiring')!.recipient).toBe(
      customer.email,
    );
    expect(warned.find((row) => row.template === 'quote.expiring.staff')!.recipient).toBe(
      WORKSHOP,
    );

    // A scheduler runs on a timer, so the same window is swept again and again.
    // The dedupe key is what makes that one warning rather than one per run.
    // (A warning queued during a sweep goes out on the next one: dispatch uses
    // the instant the sweep started, so it does not claim rows that appeared
    // after it. On a five-minute timer that is the difference between an e-mail
    // now and an e-mail in five minutes.)
    await runSweep(page);
    await runSweep(page);

    // Everything the journey announced has now been delivered, and nothing is
    // left waiting or retrying.
    for (const subject of [quoteNumber, orderNumber, requestNumber]) {
      const rows = await outboxFor(subject);

      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.status).toBe('SENT');
        expect(row.attempts).toBe(1);
      }
    }

    const afterThreeSweeps = (await outboxFor(quoteNumber)).filter((row) =>
      row.template.startsWith('quote.expiring'),
    );

    expect(afterThreeSweeps).toHaveLength(2);
  });

  test('refuses a scheduler call without the shared secret', async ({ page }) => {
    const anonymous = await page.request.post('/api/jobs/notifications');
    expect(anonymous.status()).toBe(401);

    const wrong = await page.request.post('/api/jobs/notifications', {
      headers: { authorization: 'Bearer not-the-secret' },
    });
    expect(wrong.status()).toBe(401);

    // And it is a POST: a prefetched GET must not flush the outbox.
    const read = await page.request.get('/api/jobs/notifications', {
      headers: { authorization: `Bearer ${JOBS_SECRET}` },
    });
    expect(read.status()).toBe(405);
  });
});
