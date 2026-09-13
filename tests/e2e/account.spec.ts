import AxeBuilder from '@axe-core/playwright';
import { Client } from 'pg';
import { expect, test, type Page } from '@playwright/test';

/**
 * The customer portal, end to end.
 *
 * Five journeys, driven through the real interfaces: sign up and find your
 * request; answer a blocking question; accept a quote and reach its checkout;
 * read an order back from its snapshots; and — the one that matters most — try
 * to open somebody else's and be told the same thing a made-up number gets.
 *
 * As in the Phase 10 suite, two things are done straight in the database
 * because no interface for them exists yet: promoting an account to `STAFF`
 * (Phase 12) and marking an address verified (the code is deliberately not
 * logged, ADR-021). Both satisfy a rule rather than bypass one.
 */

const DATABASE_URL = process.env.DATABASE_URL;

const PASSWORD = 'correct horse battery staple';

/**
 * A distinct identity, under a **per-block** prefix.
 *
 * The prefix is not decoration: each `describe` cleans up by matching it, and
 * the blocks run in parallel. A single shared prefix meant the responsive
 * block's teardown deleted the journey block's customer mid-test, which
 * presented as "User not found" at the next sign-in — a fixture race, not a
 * product fault, but one that would have been re-run rather than read.
 */
function identity(prefix: string, label: string): { email: string; password: string } {
  return {
    email: `${prefix}-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.invalid`,
    password: PASSWORD,
  };
}

const PORTAL = 'e2e-portal';
const RESPONSIVE = 'e2e-rwd';

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
 * Remove everything this file created, in foreign-key order.
 *
 * The suite shares its database with the integration tests, and a run that
 * leaves accounts behind grows that shared state on every pass.
 */
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

      // Release whatever the placements reserved before the rows go.
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
  await page.getByLabel('Nom complet').fill('Cliente de test');
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

  await page.getByLabel('Nom complet').fill('Cliente de test');
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
  await page.getByLabel('Prix unitaire (DA)').first().fill('350000');
  await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click();
  await expect(page.getByText('Brouillon enregistré.')).toBeVisible();
  await page.getByRole('button', { name: 'Envoyer au client' }).click();
  await expect(page.getByText(/Devis Q-\d+ en attente/)).toBeVisible();
}

/** Buy the seeded made-to-order tote bag as the signed-in customer. */
async function placeOrder(page: Page, email: string): Promise<string> {
  await page.goto('/shop/tote-bag-toile-epaisse');
  await page.getByRole('button', { name: 'Ajouter au panier' }).click();
  await expect(page.getByText('Ajouté à votre panier.')).toBeVisible();

  await page.goto('/checkout');
  await page.getByLabel('Nom complet').fill('Cliente de test');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Téléphone').fill('0555 12 34 56');

  await page.getByRole('combobox', { name: 'Wilaya' }).click();
  await page.getByRole('option', { name: /16 — Alger/ }).click();

  // The delivery options only appear once the server has priced them.
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
 * The portal, signed out
 * ------------------------------------------------------------------------ */

test.describe('the portal is closed to visitors', () => {
  const ROUTES = [
    '/account',
    '/account/requests',
    '/account/quotes',
    '/account/orders',
    '/account/profile',
    '/account/requests/DEM-2099-0001',
    '/account/quotes/Q-999999',
    '/account/orders/CMD-2099-0001',
  ];

  test('sends a signed-out visitor to sign in, never to the content', async ({
    page,
  }) => {
    for (const route of ROUTES) {
      await page.goto(route);
      await expect(page, `${route} must require a session`).toHaveURL(/\/login/);
    }
  });
});

/* ---------------------------------------------------------------------------
 * Journeys A to E
 * ------------------------------------------------------------------------ */

test.describe('the customer portal', () => {
  test.skip(!DATABASE_URL, 'DATABASE_URL is required to promote a test user to staff');
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(() => purgeTestAccounts(PORTAL));
  test.afterAll(() => purgeTestAccounts(PORTAL));

  test('A and B — finds a request, is asked for information, and answers', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const customer = identity(PORTAL, 'a');
    const staff = identity(PORTAL, 'staff-a');

    await register(page, customer);
    await verifyAddress(customer.email);

    // The overview greets by name and is honest about having nothing yet.
    await expect(page.getByRole('heading', { name: /^Bonjour/ })).toBeVisible();
    await scanForViolations(page, '/account');

    const requestNumber = await submitRequest(page, customer.email);

    // A guest request is claimed by the account its address names when the
    // workshop prices it. Until then the portal says so rather than showing an
    // empty list with no explanation.
    await signOut(page);
    await register(page, staff);
    await promoteToStaff(staff.email);

    await page.goto(`/admin/requests/${requestNumber}`);
    await page
      .getByLabel('De quoi avez-vous besoin ?')
      .fill('Il nous faut votre logo en vectoriel.');
    await page.getByRole('button', { name: 'Demander cette information' }).click();
    await expect(page.getByText('Il nous faut votre logo en vectoriel.')).toBeVisible();

    // Journey A: the customer finds the request in their own portal.
    await signOut(page);
    await signIn(page, customer);

    await page.goto('/account/requests');
    await expect(page.getByRole('link', { name: requestNumber })).toBeVisible();
    await scanForViolations(page, '/account/requests');

    await page.getByRole('link', { name: requestNumber }).click();
    await expect(
      page.getByRole('heading', { name: `Demande ${requestNumber}` }),
    ).toBeVisible();

    // Journey B: the blocking question is shown verbatim, and answering it is
    // one control away.
    await expect(
      page.getByText('Il nous faut votre logo en vectoriel.').first(),
    ).toBeVisible();

    await scanForViolations(page, '/account/requests/[requestNumber]');

    await page.getByLabel('Votre réponse').fill('Le voici, exporté en SVG.');
    await page.getByRole('button', { name: 'Envoyer' }).click();

    await expect(
      page.getByText('Message envoyé. Nous vous répondons vite.'),
    ).toBeVisible();
    await expect(page.getByText('Le voici, exporté en SVG.')).toBeVisible();

    // 6.7.3: answering does not clear the block — only the workshop can judge
    // whether what arrived is enough.
    await expect(
      page.getByText('Il nous faut votre logo en vectoriel.').first(),
    ).toBeVisible();
  });

  test('C — accepts a quote from the portal and reaches its checkout', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const customer = identity(PORTAL, 'c');
    const staff = identity(PORTAL, 'staff-c');

    await register(page, customer);
    await verifyAddress(customer.email);
    const requestNumber = await submitRequest(page, customer.email);

    await signOut(page);
    await register(page, staff);
    await promoteToStaff(staff.email);
    await priceAndSend(page, requestNumber);

    await signOut(page);
    await signIn(page, customer);

    // The overview leads with the quote, because it is the only thing blocking.
    await page.goto('/account');
    const overviewLink = page.getByRole('link', { name: /Devis Q-\d+/ }).first();
    await expect(overviewLink).toBeVisible();

    await page.goto('/account/quotes');
    const quoteLink = page.getByRole('link', { name: /Devis Q-\d+/ }).first();
    const quoteNumber = /Q-[\w-]+/.exec(await quoteLink.innerText())![0];

    await quoteLink.click();
    await expect(
      page.getByRole('heading', { name: `Devis ${quoteNumber}` }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Accepter ce devis' }).click();
    await page.waitForURL(/\/checkout\/quote\//);

    await expect(
      page.getByRole('heading', { name: new RegExp(`devis ${quoteNumber}`, 'i') }),
    ).toBeVisible();

    // Back in the portal, the quote now offers the way to finish rather than
    // the way to accept.
    await page.goto(`/account/quotes/${quoteNumber}`);
    await expect(page.getByRole('link', { name: 'Finaliser ma commande' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accepter ce devis' })).toHaveCount(0);
  });

  test('D — reads an order back from its snapshots', async ({ page }) => {
    test.setTimeout(180_000);

    const customer = identity(PORTAL, 'd');
    await register(page, customer);

    const orderNumber = await placeOrder(page, customer.email);

    await page.goto('/account/orders');
    await expect(page.getByRole('link', { name: orderNumber })).toBeVisible();
    await scanForViolations(page, '/account/orders');

    await page.getByRole('link', { name: orderNumber }).click();
    await expect(
      page.getByRole('heading', { name: `Commande ${orderNumber}` }),
    ).toBeVisible();

    // The snapshot, the address and the payment section are all present.
    await expect(page.getByText('Tote bag')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Paiement' })).toBeVisible();
    await expect(page.getByText('Hydra')).toBeVisible();

    await scanForViolations(page, '/account/orders/[orderNumber]');

    // And the overview counts it as in flight.
    await page.goto('/account');
    await expect(page.getByRole('link', { name: orderNumber }).first()).toBeVisible();
  });

  test('E — cannot open another customer’s request, quote or order', async ({ page }) => {
    test.setTimeout(180_000);

    const victim = identity(PORTAL, 'victim');
    const attacker = identity(PORTAL, 'attacker');
    const staff = identity(PORTAL, 'staff-e');

    await register(page, victim);
    await verifyAddress(victim.email);

    const requestNumber = await submitRequest(page, victim.email);
    const orderNumber = await placeOrder(page, victim.email);

    await signOut(page);
    await register(page, staff);
    await promoteToStaff(staff.email);
    await priceAndSend(page, requestNumber);

    await signOut(page);
    await signIn(page, victim);
    await page.goto('/account/quotes');
    const quoteNumber = /Q-[\w-]+/.exec(
      await page
        .getByRole('link', { name: /Devis Q-\d+/ })
        .first()
        .innerText(),
    )![0];

    // Now somebody else, with every real identifier in hand.
    await signOut(page);
    await register(page, attacker);

    const targets = [
      `/account/requests/${requestNumber}`,
      `/account/quotes/${quoteNumber}`,
      `/account/orders/${orderNumber}`,
    ];

    for (const target of targets) {
      const response = await page.goto(target);
      expect(response?.status(), `${target} must be refused`).toBe(404);
    }

    // A fabricated identifier produces exactly the same answer, so the portal
    // is not an oracle for which numbers exist.
    for (const target of [
      '/account/requests/DEM-2099-0001',
      '/account/quotes/Q-999999',
      '/account/orders/CMD-2099-0001',
    ]) {
      const response = await page.goto(target);
      expect(response?.status(), `${target} must be refused`).toBe(404);
    }

    // Their own portal is empty, which is the other half of the same fact.
    await page.goto('/account/requests');
    await expect(page.getByText('Aucune demande')).toBeVisible();

    await page.goto('/account/orders');
    await expect(page.getByText('Aucune commande')).toBeVisible();
  });

  test('shows the profile without exposing anything sensitive', async ({ page }) => {
    const customer = identity(PORTAL, 'profile');
    await register(page, customer);

    await page.goto('/account/profile');
    await expect(page.getByRole('heading', { name: 'Mon profil' })).toBeVisible();
    await expect(page.getByText(customer.email).first()).toBeVisible();
    await expect(page.getByText('À confirmer')).toBeVisible();

    const body = (await page.textContent('body')) ?? '';
    expect(body).not.toContain('$argon2');
    expect(body).not.toContain('stitch.session_token');

    await scanForViolations(page, '/account/profile');

    await page.getByRole('button', { name: 'Se déconnecter' }).click();
    await page.waitForURL(/\/$/);

    // The session is gone, not merely the page.
    await page.goto('/account');
    await expect(page).toHaveURL(/\/login/);
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

test.describe('the portal at every documented width', () => {
  test.skip(!DATABASE_URL, 'DATABASE_URL is required to create a portal account');
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
        await register(page, identity(RESPONSIVE, `${viewport.width}`));

        for (const route of [
          '/account',
          '/account/requests',
          '/account/quotes',
          '/account/orders',
          '/account/profile',
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
