import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { expect, test, type Page } from '@playwright/test';

/**
 * The settings screen, and the three switches that have to mean something.
 *
 * A settings form is only worth having if the site changes when you use it, and
 * "the field saved" is not that. Each test here flips one control in the
 * workshop and then goes and looks at the **public site** — the shop's name in
 * a page title, the closed curtain, the verification banner.
 *
 * Everything it changes, it changes back: these rows are global, and a test
 * that leaves the shop closed takes the rest of the suite with it.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const PASSWORD = 'correct horse battery staple';
const PREFIX = `e2e-settings-${Date.now()}`;

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

/** Put a setting back without going through the screen. */
async function setSetting(key: string, value: string): Promise<void> {
  await withDatabase((client) =>
    client.query(`UPDATE "settings" SET "value" = $2 WHERE "key" = $1`, [key, value]),
  );
}

/**
 * Reopen the shop — through the screen, not through the table.
 *
 * The catalogue is cached (`revalidate = 300`), and the thing that clears that
 * cache is the save action, not the row. A `UPDATE` here would put the database
 * right and leave the running site showing the curtain for five more minutes,
 * which every test after this one would inherit. So this reopens the shop the
 * way an owner would, and then checks the shop is actually back.
 */
async function reopenShop(page: Page): Promise<void> {
  await page.goto('/admin/settings');

  const open = page.getByLabel('Boutique ouverte au public');
  if (!(await open.isChecked())) {
    await open.check();
    await page.getByRole('button', { name: 'Enregistrer les réglages' }).click();
    await expectSaved(page);
  }

  await page.goto('/fr');
  await expect(page.getByRole('link', { name: 'Boutique' }).first()).toBeVisible();
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
}

/** A new customer account, signed in, with an address nobody has confirmed. */
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

async function becomeAdmin(page: Page): Promise<string> {
  const email = await register(page, 'Propriétaire');

  await withDatabase((client) =>
    client.query(`UPDATE "users" SET "role" = 'ADMIN' WHERE "email" = $1`, [email]),
  );

  // The session carries the role, so it has to be reissued.
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForURL(/\/account|\/admin/);
  await settle(page);

  return email;
}

/**
 * The save confirmation, once.
 *
 * A toast renders twice on purpose — the visible line, and a `role="status"`
 * copy for a screen reader — so matching its text finds two elements. `.first()`
 * picks the visible one rather than loosening the assertion.
 */
async function expectSaved(page: Page): Promise<void> {
  await expect(page.getByText(/réglage enregistré/).first()).toBeVisible({
    timeout: 15_000,
  });
}

test.afterAll(async () => {
  if (!DATABASE_URL) return;

  // Whatever a failing test left behind, the seeded values are these.
  await setSetting('brand.name', 'Bizeora');
  await setSetting('site.storefrontEnabled', 'true');
  await setSetting('accounts.emailVerificationRequired', 'true');

  if (createdEmails.length > 0) {
    await withDatabase((client) =>
      client.query(`DELETE FROM "users" WHERE "email" = ANY($1::text[])`, [
        createdEmails,
      ]),
    );
  }
});

test.describe('the settings screen', () => {
  test.skip(!DATABASE_URL, 'DATABASE_URL is required to promote an account to admin');
  test.describe.configure({ mode: 'serial' });

  /*
   * Longer than the default thirty seconds, on purpose.
   *
   * Each of these registers an account, promotes it, signs in again and then
   * walks both sides of the site. None of the steps is slow; there are simply
   * more of them than a default budget was written for.
   */
  test.setTimeout(90_000);

  test('is closed to staff, because settings are an admin matter', async ({ page }) => {
    const email = `${PREFIX}-staff-${randomUUID().slice(0, 8)}@example.invalid`;
    createdEmails.push(email);

    await page.goto('/register');
    await page.getByLabel('Nom complet').fill('Atelier');
    await page.getByLabel('Adresse e-mail').fill(email);
    await page.getByLabel('Mot de passe').fill(PASSWORD);
    await page.getByRole('button', { name: 'Créer mon compte' }).click();
    await page.waitForURL(/\/account|\/admin/);
    await settle(page);

    await withDatabase((client) =>
      client.query(`UPDATE "users" SET "role" = 'STAFF' WHERE "email" = $1`, [email]),
    );

    await page.context().clearCookies();
    await page.goto('/login');
    await page.getByLabel('Adresse e-mail').fill(email);
    await page.getByLabel('Mot de passe').fill(PASSWORD);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await page.waitForURL(/\/account|\/admin/);

    /*
     * Let the sign-in navigation finish before starting another.
     *
     * `waitForURL` resolves the moment the address matches, which is before the
     * client-side navigation it belongs to has settled — and a `goto` issued in
     * that window aborts it (`net::ERR_ABORTED`). The race has always existed;
     * it only started losing once Phase 15 made every page render per request
     * and widened the window.
     */
    await settle(page);

    await page.goto('/admin/settings');

    // Not found, not a disabled form: the screen does not render controls to
    // explain what somebody may not do (12.1).
    await expect(page.getByRole('heading', { name: 'Réglages' })).toHaveCount(0);
  });

  test('renames the shop, and the storefront says so', async ({ page }) => {
    await becomeAdmin(page);
    const renamed = `Atelier ${Date.now()}`;

    await page.goto('/admin/settings');
    await page.getByLabel('Nom de la boutique').fill(renamed);
    await page.getByRole('button', { name: 'Enregistrer les réglages' }).click();

    await expectSaved(page);

    try {
      /*
       * The cart, not the front page.
       *
       * The name belongs in every page's title — it is what a customer sees in
       * their tab and what a search result prints. `/fr/cart` is the page whose
       * every byte is per-request (it holds a session's basket), so a stale
       * title there could only mean the setting itself had not arrived.
       */
      await page.goto('/fr/cart');
      await expect(page).toHaveTitle(new RegExp(renamed));
    } finally {
      await setSetting('brand.name', 'Bizeora');
    }
  });

  test('closes the shop, and leaves the workshop and its door alone', async ({
    page,
    browser,
  }) => {
    await becomeAdmin(page);

    await page.goto('/admin/settings');
    await page.getByLabel('Boutique ouverte au public').uncheck();
    await page.getByRole('button', { name: 'Enregistrer les réglages' }).click();
    await expectSaved(page);

    try {
      /*
       * A visitor, in a context of their own.
       *
       * The admin's own browser carries a session, and a closed shop has to be
       * closed to a stranger — the one visitor who cannot be asked to sign in
       * first. A second context is the only honest way to ask what they get.
       */
      const stranger = await browser.newContext();
      const anonymous = await stranger.newPage();

      /*
       * The next request, not eventually.
       *
       * This is the claim the feature makes: the switch is read per request, so
       * the first visitor after the save meets the curtain. Anything looser
       * would be a test that passed while the shop stayed open to whoever
       * arrived in the meantime.
       */
      await anonymous.goto('/fr');
      await expect(anonymous.getByText(/revenons très bientôt/)).toBeVisible();

      // No way back in: a closed shop with a working catalogue link is not
      // closed.
      await expect(anonymous.getByRole('link', { name: 'Boutique' })).toHaveCount(0);

      // And the shop itself is closed, not just its front page.
      await anonymous.goto('/fr/shop');
      await expect(anonymous.getByText(/revenons très bientôt/)).toBeVisible();

      /*
       * The door, though, is still open.
       *
       * `/admin` sends a signed-out visitor to `/login`, so a curtain over the
       * sign-in page would mean an owner who closed the shop and then lost
       * their session had locked themselves out of their own business. That is
       * why sign-in sits outside the closable part of the site.
       */
      await anonymous.goto('/fr/login');
      await expect(anonymous.getByRole('button', { name: 'Se connecter' })).toBeVisible();

      await stranger.close();

      /*
       * Closed to the owner too, on the storefront.
       *
       * Not an oversight: recognising staff means reading a cookie, and a
       * cookie read cannot coexist with the prerendered catalogue. Closed means
       * closed, and reopening is one click.
       */
      await page.goto('/fr');
      await expect(page.getByText(/revenons très bientôt/)).toBeVisible();

      // And the workshop is untouched — that is the whole point of closing it.
      await page.goto('/admin');
      await expect(page.getByRole('heading', { name: 'Aujourd’hui' })).toBeVisible();
    } finally {
      await reopenShop(page);
    }
  });

  test('switches e-mail confirmation off, and stops asking for it', async ({
    page,
    browser,
  }) => {
    /*
     * Two people, because the nag is a customer's.
     *
     * `/account` belongs to customers and refuses staff outright — an admin
     * acting for a customer is exactly what the account area exists to prevent
     * — so the owner cannot see this banner on their own screen however the
     * setting is set. The customer watches; the owner flips the switch.
     */
    const theirs = await browser.newContext();
    const customer = await theirs.newPage();
    await register(customer, 'Cliente');

    // The banner is there while it is required: this account has never
    // confirmed its address, and no mail provider is configured to let it.
    await customer.goto('/fr/account');
    await expect(customer.getByText(/Confirmez votre adresse/)).toBeVisible();

    await becomeAdmin(page);
    await page.goto('/admin/settings');
    await page.getByLabel('Exiger la confirmation de l’adresse e-mail').uncheck();
    await page.getByRole('button', { name: 'Enregistrer les réglages' }).click();
    await expectSaved(page);

    try {
      /*
       * Asking somebody to do a chore with no consequence is worse than not
       * asking: with verification off an unconfirmed address blocks nothing,
       * so the nag has to go with it.
       */
      await customer.goto('/fr/account');
      await expect(customer.getByText(/Confirmez votre adresse/)).toHaveCount(0);
    } finally {
      // `/account` is rendered per request, so putting the row back is enough
      // — there is no cached page to clear.
      await setSetting('accounts.emailVerificationRequired', 'true');
      await theirs.close();
    }
  });

  test('refuses a value the shop could not survive', async ({ page }) => {
    await becomeAdmin(page);
    await page.goto('/admin/settings');

    // 200 % is an order that can never be paid.
    await page.getByLabel('Acompte (points de base)').fill('20000');
    await page.getByRole('button', { name: 'Enregistrer les réglages' }).click();

    await expect(page.getByText(/hors des limites/)).toBeVisible();

    // And nothing was written: the deposit is still what it was.
    await page.reload();
    await expect(page.getByLabel('Acompte (points de base)')).toHaveValue('5000');
  });
});
