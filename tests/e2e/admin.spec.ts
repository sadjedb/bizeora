import AxeBuilder from '@axe-core/playwright';
import { Client } from 'pg';
import { expect, test, type Page } from '@playwright/test';

/**
 * The workshop, end to end.
 *
 * Seven journeys through the real interfaces: find the work, ask a customer for
 * something and read their answer, price and send a quote and watch it be
 * accepted, move an order through its statuses and see the customer's page
 * follow, record a payment, keep a note private, and be refused when a customer
 * tries the door.
 *
 * Promoting an account to `STAFF` is done in the database because user
 * management is not V1 — it is the one thing here with no interface, and every
 * other step goes through the pages a person would actually use.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const PASSWORD = 'correct horse battery staple';
/**
 * A prefix per `describe`, because each block cleans up by matching it and the
 * blocks run in parallel. A shared prefix means one block's teardown deletes
 * another's signed-in account mid-test, which surfaces as "User not found" at
 * the next navigation — a fixture race, not a product fault.
 *
 * The three are deliberately **disjoint** rather than nested: a `LIKE 'a-%'`
 * pattern matches `a-b-...` too, so `e2e-admin` and `e2e-admin-rwd` would have
 * been the same bug wearing different names.
 */
const WORKSHOP = 'e2e-wk';
const GATE = 'e2e-gate';
const RESPONSIVE = 'e2e-arwd';

function identity(prefix: string, label: string): { email: string; password: string } {
  return {
    email: `${prefix}-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.invalid`,
    password: PASSWORD,
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

/** Remove everything this file created, in foreign-key order. */
async function purgeTestAccounts(prefix: string): Promise<void> {
  await withDatabase(async (client) => {
    const pattern = `${prefix}-%@example.invalid`;

    const { rows } = await client.query<{ id: string }>(
      `SELECT "id" FROM "users" WHERE "email" LIKE $1`,
      [pattern],
    );

    if (rows.length === 0) return;
    const ids = rows.map((row) => row.id);

    const { rows: orders } = await client.query<{ id: string }>(
      `SELECT "id" FROM "orders" WHERE "user_id" = ANY($1::uuid[])`,
      [ids],
    );

    if (orders.length > 0) {
      const orderIds = orders.map((row) => row.id);

      await client.query(
        `UPDATE "product_variants" v
            SET "reserved_quantity" = GREATEST(0, v."reserved_quantity" - i."quantity")
           FROM "order_items" i
          WHERE i."order_id" = ANY($1::uuid[]) AND i."variant_id" = v."id"`,
        [orderIds],
      );
      await client.query(`DELETE FROM "orders" WHERE "id" = ANY($1::uuid[])`, [orderIds]);
    }

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

    await client.query(
      `DELETE FROM "audit_logs" WHERE "actor_user_id" = ANY($1::uuid[])`,
      [ids],
    );
    await client.query(`DELETE FROM "users" WHERE "id" = ANY($1::uuid[])`, [ids]);
  });
}

async function signOut(page: Page) {
  await page.context().clearCookies();
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
  await page.getByLabel('Nom complet').fill('Compte de test');
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
  if (!page.url().includes('/login')) {
    await signOut(page);
    await page.goto('/login');
  }

  await page.getByLabel('Adresse e-mail').fill(credentials.email);
  await page.getByLabel('Mot de passe').fill(credentials.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForURL(/\/account|\/admin/);
  // The URL changes when the client router *starts* the navigation. Waiting
  // for the form itself to leave the document waits for it to finish — a
  // `goto` issued in between is cancelled (`net::ERR_ABORTED`).
  await page
    .getByRole('button', { name: 'Créer mon compte' })
    .waitFor({ state: 'detached' });
  await settle(page);
}

/** A signed-in staff account, ready to work. */
async function becomeStaff(
  page: Page,
  prefix: string,
): Promise<{ email: string; password: string }> {
  const staff = identity(prefix, 'staff');
  await register(page, staff);
  await promoteToStaff(staff.email);
  return staff;
}

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

  await page.getByLabel('Nom complet').fill('Compte de test');
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

/** Buy the seeded made-to-order tote as the signed-in customer. */
async function placeOrder(page: Page, email: string): Promise<string> {
  await page.goto('/shop/tote-bag-toile-epaisse');
  await page.getByRole('button', { name: 'Ajouter au panier' }).click();
  await expect(page.getByText('Ajouté à votre panier.')).toBeVisible();

  await page.goto('/checkout');
  await page.getByLabel('Nom complet').fill('Compte de test');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Téléphone').fill('0555 12 34 56');

  await page.getByRole('combobox', { name: 'Wilaya' }).click();
  await page.getByRole('option', { name: /16 — Alger/ }).click();

  await expect(page.getByRole('radiogroup', { name: 'Mode de livraison' })).toBeVisible();

  await page.getByLabel('Commune').fill('Hydra');
  await page.getByLabel('Adresse de livraison').fill('12 rue des Frères Bouadou');
  await page.getByLabel(/J’accepte les conditions/).check();

  await page.getByRole('button', { name: 'Confirmer la commande' }).click();
  await page.waitForURL(/\/order\//);

  const reference = await page
    .getByText(/CMD-\d{4}-\d+/)
    .first()
    .innerText();

  return /CMD-\d{4}-\d+/.exec(reference)![0];
}

/**
 * Move an order to a target status from the workspace.
 *
 * Waits for the panel to say the order is *now* in the target status, not
 * merely for the success alert: the alert appears as soon as the action
 * returns, while the list of next moves arrives with the refresh behind it.
 * Acting on the older list is how this reads as "the option does not exist".
 */
async function moveOrder(page: Page, orderNumber: string, label: string) {
  await page.goto(`/admin/orders/${orderNumber}`);
  await page.getByRole('combobox', { name: 'Nouveau statut' }).click();
  await page.getByRole('option', { name: label, exact: true }).click();
  await page.getByRole('button', { name: 'Appliquer' }).click();
  await expect(page.getByText('Statut mis à jour.')).toBeVisible();
  await expect(page.getByText(`Actuellement : ${label}.`)).toBeVisible();
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

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

/* ---------------------------------------------------------------------------
 * Journey F — the door
 * ------------------------------------------------------------------------ */

test.describe('the workshop is closed to everyone else', () => {
  // Serial, so the teardown runs after both tests rather than once per worker:
  // with `fullyParallel`, an `afterAll` on a split describe fires as each
  // worker finishes and deletes the account the other is still signed in as.
  test.describe.configure({ mode: 'serial' });

  test.afterAll(() => purgeTestAccounts(GATE));

  const ROUTES = [
    '/admin',
    '/admin/requests',
    '/admin/quotes',
    '/admin/orders',
    '/admin/customers',
    '/admin/orders/CMD-2099-0001',
    '/admin/requests/DEM-2099-0001',
    '/admin/customers/00000000-0000-0000-0000-000000000000',
  ];

  test('sends a signed-out visitor to sign in', async ({ page }) => {
    for (const route of ROUTES) {
      await page.goto(route);
      await expect(page, `${route} must require a session`).toHaveURL(/\/login/);
    }
  });

  test('F — turns a signed-in customer away without admitting the area exists', async ({
    page,
  }) => {
    test.skip(!DATABASE_URL, 'DATABASE_URL is required to create accounts');
    test.setTimeout(120_000);

    await register(page, identity(GATE, 'intruder'));

    for (const route of ROUTES) {
      await page.goto(route);
      // Home, not a 403 and not a login form: a customer is not told there is
      // a workshop behind the door.
      // Home, in the visitor's language — the storefront's routes are
      // prefixed, so "the homepage" is `/fr` rather than `/`.
      await expect(page, `${route} must refuse a customer`).toHaveURL(
        /localhost:\d+\/(fr|en)$/,
      );
    }
  });
});

/* ---------------------------------------------------------------------------
 * Journeys A to E and G
 * ------------------------------------------------------------------------ */

test.describe('the workshop', () => {
  test.skip(!DATABASE_URL, 'DATABASE_URL is required to promote a test user to staff');
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(() => purgeTestAccounts(WORKSHOP));
  test.afterAll(() => purgeTestAccounts(WORKSHOP));

  test('A and B — finds the work, asks for information, reads the answer', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const customer = identity(WORKSHOP, 'customer-ab');
    await register(page, customer);
    await verifyAddress(customer.email);
    const requestNumber = await submitRequest(page, customer.email);

    await signOut(page);
    const staff = await becomeStaff(page, WORKSHOP);

    // Journey A: dashboard → queue → detail.
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Aujourd’hui' })).toBeVisible();
    await scanForViolations(page, '/admin');

    await page.getByRole('link', { name: 'Demandes', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/requests/);
    await scanForViolations(page, '/admin/requests');

    // The filter is a URL, so a queue can be bookmarked.
    await page.goto('/admin/requests?status=SUBMITTED');
    await page.getByRole('link', { name: requestNumber }).click();
    await expect(page.getByRole('heading', { name: requestNumber })).toBeVisible();

    // Journey B: ask for something blocking.
    await page
      .getByLabel('De quoi avez-vous besoin ?')
      .fill('Il nous faut votre logo en vectoriel.');
    await page.getByRole('button', { name: 'Demander cette information' }).click();
    await expect(
      page.getByText('Il nous faut votre logo en vectoriel.').first(),
    ).toBeVisible();

    // The customer answers.
    await signOut(page);
    await signIn(page, customer);
    await page.goto(`/account/requests/${requestNumber}`);
    await page.getByLabel('Votre réponse').fill('Le voici en SVG.');
    await page.getByRole('button', { name: 'Envoyer' }).click();
    await expect(
      page.getByText('Message envoyé. Nous vous répondons vite.'),
    ).toBeVisible();

    // And the workshop reads it, then takes the request back into review.
    await signOut(page);
    await signIn(page, staff);
    await page.goto(`/admin/requests/${requestNumber}`);
    await expect(page.getByText('Le voici en SVG.')).toBeVisible();

    await page.getByRole('button', { name: 'Prendre en étude' }).click();
    await expect(page.getByText('Information demandée')).toHaveCount(0);
  });

  test('C — prices a quote, sends it, and sees it accepted', async ({ page }) => {
    test.setTimeout(180_000);

    const customer = identity(WORKSHOP, 'customer-c');
    await register(page, customer);
    await verifyAddress(customer.email);
    const requestNumber = await submitRequest(page, customer.email);

    await signOut(page);
    await becomeStaff(page, WORKSHOP);

    await page.goto(`/admin/requests/${requestNumber}`);
    await page.getByLabel('Prix unitaire (DA)').first().fill('350000');
    await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click();
    await expect(page.getByText('Brouillon enregistré.')).toBeVisible();
    await page.getByRole('button', { name: 'Envoyer au client' }).click();

    // This request's own quote number, from its own workspace. Reading it from
    // the shared queue would pick up whichever suite happened to send last.
    const banner = page.getByText(/Devis Q-[\w-]+ en attente/);
    await expect(banner).toBeVisible();
    const quoteNumber = /Q-[\w-]+/.exec(await banner.innerText())![0];

    // The quotes queue lists it, among everyone else's.
    await page.goto('/admin/quotes');
    await expect(page.getByRole('link', { name: quoteNumber })).toBeVisible();
    await scanForViolations(page, '/admin/quotes');

    // The customer accepts.
    await signOut(page);
    await signIn(page, customer);
    await page.goto(`/account/quotes/${quoteNumber}`);
    await page.getByRole('button', { name: 'Accepter ce devis' }).click();
    await page.waitForURL(/\/checkout\/quote\//);

    // And the workshop sees the acceptance on that quote, not on some other.
    await signOut(page);
    await becomeStaff(page, WORKSHOP);
    await page.goto('/admin/quotes');

    // The queue is a table since Phase 14.5, so the row containing this quote
    // is a `row` rather than a `listitem`. The assertion is unchanged: this
    // quote's own row, not whichever one a shared queue happened to show.
    const row = page
      .getByRole('row')
      .filter({ has: page.getByRole('link', { name: quoteNumber }) });

    await expect(row.getByText('Accepté', { exact: true })).toBeVisible();
  });

  test('D and G — moves an order, and the customer sees only their half', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const customer = identity(WORKSHOP, 'customer-d');
    await register(page, customer);
    const orderNumber = await placeOrder(page, customer.email);

    await signOut(page);
    await becomeStaff(page, WORKSHOP);

    await page.goto('/admin/orders');
    await expect(page.getByRole('link', { name: orderNumber })).toBeVisible();
    await scanForViolations(page, '/admin/orders');

    await page.goto(`/admin/orders/${orderNumber}`);
    await expect(page.getByRole('heading', { name: orderNumber })).toBeVisible();
    await scanForViolations(page, '/admin/orders/[orderNumber]');

    // Journey D: a valid move, and one the machine refuses.
    await moveOrder(page, orderNumber, 'Confirmée');
    await moveOrder(page, orderNumber, 'En production');

    // Journey G: an internal note, which the customer must never see.
    await page.getByLabel('Note').fill('NOTE-INTERNE-ATELIER : fil commandé.');
    await page.getByRole('button', { name: 'Enregistrer la note' }).click();
    await expect(page.getByText('Note enregistrée.')).toBeVisible();

    // A hold's note is internal too.
    await page.reload();
    await expect(page.getByText('Actuellement : En production.')).toBeVisible();
    await page.getByRole('combobox', { name: 'Nouveau statut' }).click();
    await page.getByRole('option', { name: 'En pause', exact: true }).click();
    await page.getByLabel('Motif de la pause').fill('PAUSE-INTERNE : machine en panne.');
    await page.getByRole('button', { name: 'Appliquer' }).click();
    await expect(page.getByText('Statut mis à jour.')).toBeVisible();

    // The customer's page follows the status and carries neither note.
    await signOut(page);
    await signIn(page, customer);
    await page.goto(`/account/orders/${orderNumber}`);

    await expect(page.getByText('En production').first()).toBeVisible();

    const body = (await page.textContent('body')) ?? '';
    expect(body).not.toContain('NOTE-INTERNE-ATELIER');
    expect(body).not.toContain('PAUSE-INTERNE');
  });

  test('E — records a payment, and the customer sees the new state', async ({ page }) => {
    test.setTimeout(180_000);

    const customer = identity(WORKSHOP, 'customer-e');
    await register(page, customer);
    const orderNumber = await placeOrder(page, customer.email);

    await signOut(page);
    await becomeStaff(page, WORKSHOP);

    /*
     * The payment queue finds the order before a penny has been recorded.
     *
     * Phase 14.6's regression: `/admin/payments` opened on the proof queue,
     * which is empty in a shop where nobody uploads a transfer receipt, so the
     * screen greeted the morning bank check with an empty state while orders
     * owed money. The default view must contain the order, and the unpaid facet
     * must find it too.
     */
    await page.goto('/admin/payments');
    await expect(page.getByRole('link', { name: orderNumber })).toBeVisible();

    await page.goto('/admin/payments?filter=unpaid');
    await expect(page.getByRole('link', { name: orderNumber })).toBeVisible();
    await scanForViolations(page, '/admin/payments');

    await page.goto(`/admin/orders/${orderNumber}`);

    // Refused: more than the balance. The server re-reads the order.
    await page.getByLabel('Montant (centimes)').fill('999999999');
    await page.getByRole('button', { name: 'Enregistrer le paiement' }).click();
    await expect(page.getByText('Ce montant dépasse le reste à payer.')).toBeVisible();

    // Accepted: the whole balance, which the page was told.
    const balance = await page
      .getByText(/Reste à encaisser/)
      .first()
      .innerText();
    const amount = balance.replace(/\D/g, '');

    await page.getByLabel('Montant (centimes)').fill(amount);
    await page.getByRole('button', { name: 'Enregistrer le paiement' }).click();
    await expect(page.getByText('Paiement enregistré.')).toBeVisible();
    await expect(page.getByText('Réglée').first()).toBeVisible();

    // And the queue has moved it: settled, not unpaid. A projection that lost
    // `amountPaid` would leave it in the unpaid facet for ever.
    await page.goto('/admin/payments?filter=settled');
    await expect(page.getByRole('link', { name: orderNumber })).toBeVisible();

    await page.goto('/admin/payments?filter=unpaid');
    await expect(page.getByRole('link', { name: orderNumber })).toHaveCount(0);

    // The customer's order page reflects it.
    await signOut(page);
    await signIn(page, customer);
    await page.goto(`/account/orders/${orderNumber}`);
    await expect(page.getByText('Réglée').first()).toBeVisible();
  });

  test('lists customers and their history, without a credential in sight', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const customer = identity(WORKSHOP, 'customer-dir');
    await register(page, customer);
    const orderNumber = await placeOrder(page, customer.email);

    await signOut(page);
    await becomeStaff(page, WORKSHOP);

    await page.goto('/admin/customers');
    await page.getByLabel('Rechercher un client').fill(customer.email);
    await page.getByRole('button', { name: 'Rechercher' }).click();

    const row = page.getByRole('link', { name: 'Compte de test' }).first();
    await expect(row).toBeVisible();
    await scanForViolations(page, '/admin/customers');

    await row.click();
    await expect(page.getByRole('link', { name: orderNumber })).toBeVisible();

    const body = (await page.textContent('body')) ?? '';
    expect(body).not.toContain('$argon2');
    expect(body).not.toContain('stitch.session_token');

    await scanForViolations(page, '/admin/customers/[userId]');
  });
});

/* ---------------------------------------------------------------------------
 * Responsive
 * ------------------------------------------------------------------------ */

const VIEWPORTS = [
  { name: '375px', width: 375, height: 812 },
  { name: '768px', width: 768, height: 1024 },
  { name: '1024px', width: 1024, height: 768 },
  { name: '1440px', width: 1440, height: 900 },
] as const;

test.describe('the workshop at every documented width', () => {
  test.skip(!DATABASE_URL, 'DATABASE_URL is required to create a staff account');
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(() => purgeTestAccounts(RESPONSIVE));
  test.afterAll(() => purgeTestAccounts(RESPONSIVE));

  for (const viewport of VIEWPORTS) {
    test(`never scrolls horizontally at ${viewport.name}`, async ({ browser }) => {
      test.setTimeout(120_000);

      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
      });
      const page = await context.newPage();

      try {
        await becomeStaff(page, RESPONSIVE);

        for (const route of [
          '/admin',
          '/admin/requests',
          '/admin/quotes',
          '/admin/orders',
          '/admin/customers',
        ]) {
          await page.goto(route);
          await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

          expect(
            await horizontalOverflow(page),
            `horizontal overflow on ${route} at ${viewport.name}`,
          ).toBeLessThanOrEqual(0);
        }
      } finally {
        await context.close();
      }
    });
  }
});
