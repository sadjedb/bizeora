import AxeBuilder from '@axe-core/playwright';
import { Client } from 'pg';
import { expect, test, type Page } from '@playwright/test';

/**
 * A review, from the purchase that earns it to the page it appears on.
 *
 * Buy → deliver → write → moderate → read. Nothing is stubbed: the order is
 * placed through the real checkout, the review is written in the account area
 * and approved in the admin, and the assertion at the end is made on the public
 * product page a stranger would see.
 *
 * What this proves that no integration test can is the **gap between writing
 * and publishing**. Between step three and step four the review exists and the
 * product page must not show it — 11A.3 in the only place it is observable, the
 * rendered HTML. And after approval the page must show it *without waiting for
 * a cache to expire*, which is what the moderation action's revalidation is
 * for.
 *
 * Two things are done directly in the database, because no interface for them
 * exists and inventing one would be a worse test: promoting a user to STAFF (as
 * `quote.spec.ts` does) and marking an order delivered, which is Phase 12's
 * status machine and is exercised there.
 */

const DATABASE_URL = process.env.DATABASE_URL;

/** Disjoint from every other spec's prefix. */
const PREFIX = 'e2e-avis';

/** Seeded `MADE_TO_ORDER`, so repeated runs never exhaust its stock. */
const PRODUCT = 'tote-bag-toile-epaisse';

const BODY =
  'La toile est épaisse et la broderie parfaitement nette, même sur les courbes. Livré dans les délais annoncés.';

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

async function promoteToStaff(email: string): Promise<void> {
  await withDatabase((client) =>
    client.query(`UPDATE "users" SET "role" = 'STAFF' WHERE lower("email") = lower($1)`, [
      email,
    ]),
  );
}

async function markDelivered(orderNumber: string): Promise<void> {
  await withDatabase((client) =>
    client.query(`UPDATE "orders" SET "status" = 'DELIVERED' WHERE "order_number" = $1`, [
      orderNumber,
    ]),
  );
}

async function storedRating(): Promise<{ average: number | null; count: number }> {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{
      rating_average: number | null;
      rating_count: number;
    }>(`SELECT "rating_average", "rating_count" FROM "products" WHERE "slug" = $1`, [
      PRODUCT,
    ]);

    return { average: rows[0]!.rating_average, count: rows[0]!.rating_count };
  });
}

/**
 * Remove everything this file created.
 *
 * The reviews go first — they reference users and order items — and the
 * product's denormalised rating is reset with them, because leaving a rating
 * behind would make the storefront's other specs depend on how many times this
 * one has run.
 */
async function purge(): Promise<void> {
  await withDatabase(async (client) => {
    const pattern = `${PREFIX}-%@example.invalid`;

    const { rows } = await client.query<{ id: string }>(
      `SELECT "id" FROM "users" WHERE "email" LIKE $1`,
      [pattern],
    );

    const ids = rows.map((row) => row.id);

    if (ids.length > 0) {
      await client.query(`DELETE FROM "reviews" WHERE "user_id" = ANY($1::uuid[])`, [
        ids,
      ]);
      await client.query(
        `DELETE FROM "notifications" WHERE "user_id" = ANY($1::uuid[])`,
        [ids],
      );
      await client.query(`DELETE FROM "carts" WHERE "user_id" = ANY($1::uuid[])`, [ids]);
      await client.query(`DELETE FROM "orders" WHERE "user_id" = ANY($1::uuid[])`, [ids]);
      await client.query(`DELETE FROM "users" WHERE "id" = ANY($1::uuid[])`, [ids]);
    }

    await client.query(
      `UPDATE "products"
          SET "rating_average" = sub.average, "rating_count" = sub.count
         FROM (
           SELECT p."id",
                  CASE WHEN count(r."id") = 0 THEN NULL
                       ELSE round(avg(r."rating") * 100)::int END AS average,
                  count(r."id")::int AS count
             FROM "products" p
             LEFT JOIN "reviews" r
               ON r."product_id" = p."id"
              AND r."status" = 'APPROVED'
              AND r."deleted_at" IS NULL
            WHERE p."slug" = $1
            GROUP BY p."id"
         ) AS sub
        WHERE "products"."id" = sub."id"`,
      [PRODUCT],
    );
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
  await page.getByLabel('Nom complet').fill('Amina Bensalem');
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

/**
 * Drop the session, once the page has stopped doing things.
 *
 * Clearing cookies is instant; the page may not be. Every moderation control
 * ends in a `router.refresh()`, and clearing the session mid-refresh — then
 * navigating — supersedes that in-flight request, which surfaces as
 * `net::ERR_ABORTED` on the *next* `goto` and reads like a broken product page.
 * Waiting for quiet first is the difference between a suite that is green and
 * one that is green four times out of five.
 */
async function signOut(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
  await page.context().clearCookies();
}

async function signIn(page: Page, credentials: { email: string; password: string }) {
  await page.goto('/login');
  if (!page.url().includes('/login')) await signOut(page);
  await page.goto('/login');

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

/** Buy the seeded tote bag, and return the order number. */
/**
 * Navigate, and tolerate a cancelled attempt.
 *
 * Chromium reports `net::ERR_ABORTED` when a document request is superseded —
 * here, by the streaming response of the page just left, which the server logs
 * as "the destination stream closed early". It is not a failure of the page
 * being asked for: the next attempt loads it.
 *
 * Three attempts, with a pause between them, and the last one throws. A route
 * that is genuinely broken still fails the test; a race that resolves in a
 * quarter of a second no longer does.
 */
async function visit(page: Page, path: string): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await page.goto(path);
      return;
    } catch (error) {
      if (attempt === 3 || !String(error).includes('ERR_ABORTED')) throw error;
      await page.waitForTimeout(250);
    }
  }
}

async function buy(page: Page, email: string): Promise<string> {
  /*
   * The language is written into the address rather than negotiated.
   *
   * `/shop/x` answers with a redirect, and a redirect issued while the client
   * router is still settling the page registration just left is cancelled —
   * `net::ERR_ABORTED`, intermittently and only under parallel load. Naming
   * the localised URL removes the redirect, and with it the race.
   */
  await visit(page, `/fr/shop/${PRODUCT}`);
  await page.getByRole('button', { name: 'Ajouter au panier' }).click();
  await expect(page.getByText('Ajouté à votre panier.')).toBeVisible();

  await visit(page, '/fr/checkout');
  await page.getByLabel('Nom complet').fill('Amina Bensalem');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Téléphone').fill('0555 12 34 56');
  await page.getByRole('combobox', { name: 'Wilaya' }).click();
  await page.getByRole('option', { name: /16 — Alger/ }).click();
  await expect(page.getByRole('radiogroup', { name: 'Mode de livraison' })).toBeVisible();
  await page.getByLabel('Commune').fill('Hydra');
  await page.getByLabel('Adresse de livraison').fill('12 rue des Frères Bouadou');
  await page.getByLabel(/J’accepte les conditions/).check();
  await page.getByRole('button', { name: 'Confirmer la commande' }).click();

  await page.waitForURL(/\/order\/CMD-\d{4}-\d+/);

  return /CMD-\d{4}-\d+/.exec(page.url())![0];
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

test.describe('a verified review', () => {
  test.skip(
    !DATABASE_URL,
    'DATABASE_URL is required to deliver an order and promote staff',
  );
  /*
   * Serial, and retried once.
   *
   * The journey registers an account and then navigates straight out of the
   * page that registration lands on. Under a full parallel run the server is
   * still streaming that page, Chromium cancels the document request it was
   * asked for next — `net::ERR_ABORTED`, logged server-side as "the destination
   * stream closed early" — and `visit` above absorbs it only when it resolves
   * inside three attempts. It always passes on the retry, and it always passes
   * when this file runs alone; the retry is here so a genuine failure in the
   * review flow is still visible rather than drowned in an environment race.
   */
  test.describe.configure({ mode: 'serial', retries: 1 });

  test.beforeAll(purge);
  test.afterAll(purge);

  test('is written after delivery, held back, then published by the workshop', async ({
    page,
  }) => {
    test.setTimeout(240_000);

    const customer = identity('client');
    const staff = identity('atelier');

    /* 1. Buy, and take delivery. -------------------------------------- */

    await register(page, customer);
    const orderNumber = await buy(page, customer.email);
    await markDelivered(orderNumber);

    /* 2. The piece is offered for review. ----------------------------- */

    await page.goto('/account/reviews');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Mes avis');

    const card = page.getByRole('heading', { name: /Tote bag/ }).first();
    await expect(card).toBeVisible();

    await scanForViolations(page, '/account/reviews');

    /* 3. Write it. The rating is a real radio group. ------------------- */

    await page.getByRole('radio', { name: '5 étoiles' }).check();
    await page.getByLabel(/Titre/).fill('Toile épaisse, broderie nette');
    await page.getByLabel('Votre avis').fill(BODY);
    await page.getByRole('button', { name: 'Envoyer mon avis' }).click();

    // It moves out of "to review" and into "written", awaiting moderation.
    await expect(page.getByText('En attente').first()).toBeVisible();
    await expect(page.getByText(BODY)).toBeVisible();

    /* 4. Nobody else can see it yet (11A.3). -------------------------- */

    await signOut(page);
    await page.goto(`/fr/shop/${PRODUCT}`);

    await expect(page.getByRole('heading', { name: 'Avis clients' })).toBeVisible();
    await expect(page.getByText(BODY)).toHaveCount(0);
    await expect(page.getByText('Cette pièce n’a pas encore d’avis.')).toBeVisible();

    /* 5. The workshop publishes it. ----------------------------------- */

    await register(page, staff);
    await promoteToStaff(staff.email);

    await page.goto('/admin/reviews?status=PENDING');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Avis clients');

    const queued = page.getByText(BODY);
    await expect(queued).toBeVisible();

    await scanForViolations(page, '/admin/reviews');

    await page
      .getByRole('textbox', { name: /Réponse publique/ })
      .first()
      .fill('Merci beaucoup, à bientôt à l’atelier.');
    await page.getByRole('button', { name: 'Publier' }).first().click();

    await expect(page.getByText('Publié').first()).toBeVisible();

    /* 6. It is on the product page, with the rating it produced. ------- */

    await signOut(page);
    await page.goto(`/fr/shop/${PRODUCT}`);

    await expect(page.getByText(BODY)).toBeVisible();
    await expect(page.getByText('Achat vérifié').first()).toBeVisible();
    await expect(page.getByText('Merci beaucoup, à bientôt à l’atelier.')).toBeVisible();
    await expect(page.getByText('Toile épaisse, broderie nette')).toBeVisible();

    // The denormalised rating was recomputed by the moderation, and the page
    // shows the same figure.
    const rating = await storedRating();
    expect(rating.count).toBeGreaterThanOrEqual(1);
    expect(rating.average).not.toBeNull();

    const written = (rating.average! / 100).toFixed(2).replace('.', ',');
    await expect(page.getByText(written).first()).toBeVisible();

    await scanForViolations(page, 'the product page with reviews');
  });

  test('is refused to a customer who has not taken delivery', async ({ page }) => {
    test.setTimeout(180_000);

    const customer = identity('impatient');

    await register(page, customer);
    await buy(page, customer.email);

    // The order exists but has not been delivered, so nothing is offered.
    await page.goto('/account/reviews');

    await expect(
      page.getByRole('heading', { name: 'Rien à évaluer pour le moment' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Envoyer mon avis' })).toHaveCount(0);
  });

  test('keeps the moderation queue away from a customer', async ({ page }) => {
    const customer = identity('curieux');

    await register(page, customer);
    await signIn(page, customer);

    await page.goto('/admin/reviews');

    // Redirected home rather than refused: the workshop's existence is not
    // confirmed to a customer (Phase 12's rule).
    await expect(page).toHaveURL(/\/(fr|en)$/);
    await expect(page.getByRole('heading', { name: 'Avis clients' })).toHaveCount(0);
  });
});

test.describe('reviewing on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('the product page’s review section fits 375px', async ({ page }) => {
    await page.goto(`/fr/shop/${PRODUCT}`);
    await expect(page.getByRole('heading', { name: 'Avis clients' })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

    expect(overflow, 'horizontal overflow on the product page').toBeLessThanOrEqual(0);
  });
});
