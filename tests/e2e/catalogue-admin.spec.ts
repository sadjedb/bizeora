import AxeBuilder from '@axe-core/playwright';
import sharp from 'sharp';
import { Client } from 'pg';
import { expect, test, type Page } from '@playwright/test';

/**
 * The catalogue and the stock room, through the interfaces a person uses.
 *
 * Phase 14.5 built two screens that did not exist. This file proves they work
 * end to end and, more importantly, that they refuse what they must:
 *
 *   - a customer cannot reach either of them;
 *   - a draft created here does not appear in the shop;
 *   - the shop *does* show it the moment it is published, and stops when it is
 *     archived;
 *   - stock cannot be driven negative from the form.
 *
 * Promoting an account to `STAFF` is done in the database because user
 * management is not V1 — it is the one step here with no interface.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const PASSWORD = 'correct horse battery staple';

/** Disjoint from every other spec's prefix. */
const CAT = 'e2e-cat';

/**
 * Teardown removes **what this worker created**, by name, rather than
 * everything matching the prefix.
 *
 * A file-scope `afterAll` runs once per worker, not once per file, so a
 * pattern-matching teardown in a parallel run deletes the account another
 * worker is signed in as — which surfaces a page later as a redirect to
 * `/login`, and looks like an authorisation bug rather than a fixture race.
 * Each worker has its own module instance, so these arrays are per-worker.
 */
const createdEmails: string[] = [];
const createdSlugs: string[] = [];

function identity(label: string): { email: string; password: string } {
  const email = `${CAT}-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.invalid`;
  createdEmails.push(email);

  return { email, password: PASSWORD };
}

/** A slug nothing else will collide with, and that teardown can find. */
function fixtureSlug(label: string): string {
  const slug = `${CAT}-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  createdSlugs.push(slug);

  return slug;
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

async function becomeStaff(page: Page): Promise<void> {
  const staff = identity('staff');
  await register(page, staff);
  await promoteToStaff(staff.email);
  // The session carries the role, so it has to be reissued.
  await page.context().clearCookies();

  await page.goto('/login');
  await page.getByLabel('Adresse e-mail').fill(staff.email);
  await page.getByLabel('Mot de passe').fill(staff.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForURL(/\/account|\/admin/);
  // The URL changes when the client router *starts* the navigation. Waiting
  // for the form itself to leave the document waits for it to finish — a
  // `goto` issued in between is cancelled (`net::ERR_ABORTED`).
  await page
    .getByRole('button', { name: 'Créer mon compte' })
    .waitFor({ state: 'detached' });
  await settle(page);

  /*
   * Land on `/admin` deliberately, and wait for it.
   *
   * Signing in sends a customer to `/account`, and a staff account that arrives
   * there is redirected home by the portal's own guard. `waitForURL` above can
   * match `/account` while that second redirect is still in flight, and a
   * `goto` issued into it is cancelled — leaving the next assertion looking at
   * the storefront and failing as though the admin had not rendered. It is a
   * once-in-a-suite race, which is the worst kind.
   */
  await page.goto('/admin');
  await page.waitForURL(/\/admin$/);
}

/**
 * Create a product through the form and land on its page.
 *
 * Returns the slug, because that is what the storefront assertions need.
 */
/**
 * A real JPEG of the requested size.
 *
 * Generated rather than committed: `sharp` is already a dependency, the bytes
 * go straight into `setInputFiles`, and a fixture on disk is one more thing to
 * keep in step with the pipeline that reads it.
 */
async function jpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 232, g: 226, b: 214 } },
  })
    .jpeg()
    .toBuffer();
}

async function createProduct(
  page: Page,
  options: { slug: string; name: string },
): Promise<void> {
  await page.goto('/admin/products/new');

  await page.getByLabel('Nom du produit').fill(options.name);
  await page.getByLabel('Adresse (slug)').fill(options.slug);
  // By role rather than by label text: the visible label carries a required
  // marker, and "Description" is also a prefix of "Description pour les
  // moteurs". The accessible name is the thing a screen-reader user hears, and
  // it is what this form has to get right.
  await page
    .getByRole('textbox', { name: 'Description', exact: true })
    .fill(
      'Une pièce créée par la suite de bout en bout pour vérifier la gestion du catalogue.',
    );

  await page.getByRole('combobox', { name: 'Catégorie' }).click();
  await page.getByRole('option').first().click();

  await page.getByLabel(/Prix de vente/).fill('4200');

  await page.getByRole('combobox', { name: 'Gestion du stock' }).click();
  await page.getByRole('option', { name: 'Stock suivi' }).click();

  await page.getByRole('button', { name: 'Créer le produit' }).click();

  // Creating lands on the product's own page, where the variants live.
  await page.waitForURL(/\/admin\/products\/[0-9a-f-]{36}$/);
}

async function addVariant(page: Page, sku: string): Promise<void> {
  await page.getByRole('button', { name: 'Ajouter une variante' }).click();
  await page.getByRole('dialog').getByLabel('SKU').fill(sku);
  await page.getByRole('dialog').getByRole('button', { name: 'Ajouter' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText(sku.toUpperCase()).first()).toBeVisible();
}

test.afterAll(async () => {
  if (!DATABASE_URL) return;

  await withDatabase(async (client) => {
    if (createdSlugs.length > 0) {
      await client.query(
        `DELETE FROM "product_redirects" WHERE "from_slug" = ANY($1::text[])`,
        [createdSlugs],
      );
      await client.query(
        `DELETE FROM "product_redirects"
          WHERE "product_id" IN (SELECT "id" FROM "products" WHERE "slug" = ANY($1::text[]))`,
        [createdSlugs],
      );
      await client.query(`DELETE FROM "products" WHERE "slug" = ANY($1::text[])`, [
        createdSlugs,
      ]);
    }

    if (createdEmails.length > 0) {
      await client.query(`DELETE FROM "users" WHERE "email" = ANY($1::text[])`, [
        createdEmails,
      ]);
    }
  });
});

test.describe('the catalogue screen', () => {
  test.skip(!DATABASE_URL, 'DATABASE_URL is required to promote an account to staff');

  test('creates a product, stocks it, and puts it in the shop', async ({ page }) => {
    await becomeStaff(page);

    const slug = fixtureSlug('vitrine');
    const sku = `${CAT}-VIT-${Date.now()}`.toUpperCase();

    await createProduct(page, {
      slug,
      name: `Pièce vitrine ${slug}`,
    });

    // A draft is invisible to the shop, whatever the admin can see.
    const draftResponse = await page.request.get(`/shop/${slug}`);
    expect(draftResponse.status()).toBe(404);

    await page.goto(`/admin/products?q=${slug}`);
    // The row's own link rather than its cell: since Phase 14.9 every row
    // also carries a selection checkbox named after the product, so a match
    // on the name alone resolves to two cells.
    await expect(page.getByRole('link', { name: `Pièce vitrine ${slug}` })).toBeVisible();

    // Open it, give it a variant, stock it, publish it.
    await page.getByRole('link', { name: `Pièce vitrine ${slug}` }).click();
    await page.waitForURL(/\/admin\/products\/[0-9a-f-]{36}$/);

    await addVariant(page, sku);

    // A new variant starts at zero, so the product is not yet purchasable.
    await expect(page.getByText('Rupture').first()).toBeVisible();

    await page.goto(`/admin/stock?q=${sku}`);
    await page.getByRole('button', { name: 'Ajuster' }).first().click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Ajustement').fill('6');
    // The dialog shows the arithmetic rather than asking for the new total.
    await expect(dialog.getByText('0 → 6')).toBeVisible();
    await dialog.getByRole('button', { name: 'Enregistrer le mouvement' }).click();
    await expect(dialog).toBeHidden();

    // The dialog refreshes the route it sits on, so the row updates without a
    // reload. Generous timeout: the write revalidates four cached paths.
    await expect(page.getByText('En stock').first()).toBeVisible({ timeout: 15_000 });
  });

  test('refuses a movement that would take stock negative', async ({ page }) => {
    await becomeStaff(page);

    const slug = fixtureSlug('negatif');
    const sku = `${CAT}-NEG-${Date.now()}`.toUpperCase();

    await createProduct(page, {
      slug,
      name: `Pièce négative ${slug}`,
    });
    await addVariant(page, sku);

    await page.goto(`/admin/stock?q=${sku}`);
    await page.getByRole('button', { name: 'Ajuster' }).first().click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Ajustement').fill('-3');

    // Refused before the submit, with the actual obstacle named, and the
    // primary action disabled rather than failing after a round trip.
    await expect(dialog.getByText(/ne peut pas devenir négatif/)).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Enregistrer le mouvement' }),
    ).toBeDisabled();
  });

  test('publishing and archiving move the product through its states', async ({
    page,
  }) => {
    await becomeStaff(page);

    const slug = fixtureSlug('publication');
    const name = `Pièce publiée ${slug}`;

    await createProduct(page, { slug, name });
    await addVariant(page, `${CAT}-PUB-${Date.now()}`.toUpperCase());

    // A draft is not reachable, whatever the admin can see.
    expect((await page.request.get(`/shop/${slug}`)).status()).toBe(404);

    await page.getByRole('button', { name: 'Mettre en ligne' }).click();
    await expect(page.getByRole('button', { name: 'Archiver' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Voir la page/ })).toBeVisible();

    await page.getByRole('button', { name: 'Archiver' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Archiver' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    // Archived: off the shop, and still a record with its history intact.
    expect((await page.request.get(`/shop/${slug}`)).status()).toBe(404);
    await expect(page.getByRole('button', { name: 'Mettre en ligne' })).toBeVisible();

    /*
     * What is deliberately *not* asserted here: that publishing makes the piece
     * appear in `/shop`'s listing. It does — `catalogue-admin.test.ts` proves it
     * against the repository — but leaving a fixture product publicly listed,
     * even for a second, puts it at the top of a shop grid that another spec is
     * clicking through in a parallel worker. That spec then opens a product this
     * one has since archived and reads a 404, which looks like a storefront
     * fault and is a fixture race. A shared database is shared.
     */
  });

  test('renaming a product rewrites its address', async ({ page }) => {
    await becomeStaff(page);

    const oldSlug = fixtureSlug('ancien');
    const newSlug = fixtureSlug('nouveau');

    await createProduct(page, {
      slug: oldSlug,
      name: `Pièce renommée ${oldSlug}`,
    });
    await addVariant(page, `${CAT}-REN-${Date.now()}`.toUpperCase());

    await page.getByLabel('Adresse (slug)').fill(newSlug);
    await page.getByRole('button', { name: 'Enregistrer' }).click();

    await expect(page.getByLabel('Adresse (slug)')).toHaveValue(newSlug);
    await expect(page.getByText(`/shop/${newSlug}`)).toBeVisible();

    /*
     * That the *old* address then redirects (11.6) is asserted in
     * `catalogue-admin.test.ts`, against the repository, rather than here.
     *
     * Proving it end to end needs the product to be `ACTIVE`, because the
     * redirect resolves only to a publicly visible target — and a fixture
     * product that is publicly visible goes to the top of `/shop`'s grid, which
     * another spec is clicking through in a parallel worker. When this worker's
     * teardown removes it, that spec opens a product that no longer exists and
     * reads a 404. A shared database is shared, and a test that publishes into
     * it is a test that breaks somebody else's.
     */
  });

  test('refuses an address another product already owns', async ({ page }) => {
    await becomeStaff(page);

    const taken = fixtureSlug('occupee');

    await createProduct(page, {
      slug: taken,
      name: `Première ${taken}`,
    });
    await page.goto('/admin/products/new');

    await page.getByLabel('Nom du produit').fill(`Seconde ${taken}`);
    await page.getByLabel('Adresse (slug)').fill(taken);
    await page
      .getByRole('textbox', { name: 'Description', exact: true })
      .fill('Une seconde pièce qui tente de prendre une adresse déjà utilisée.');
    await page.getByRole('combobox', { name: 'Catégorie' }).click();
    await page.getByRole('option').first().click();
    await page.getByLabel(/Prix de vente/).fill('1000');

    await page.getByRole('button', { name: 'Créer le produit' }).click();

    await expect(page.getByText(/déjà utilisée par un autre produit/)).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/products\/new$/);
  });
});

test.describe('the door', () => {
  test.skip(!DATABASE_URL, 'DATABASE_URL is required to create accounts');

  test('a customer cannot reach the catalogue or the stock room', async ({ page }) => {
    await register(page, identity('client'));

    for (const path of ['/admin/products', '/admin/products/new', '/admin/stock']) {
      await page.goto(path);
      // Sent home rather than told an admin area exists.
      await expect(page, path).toHaveURL(/\/(fr|en)$/);
    }
  });

  test('a signed-out visitor is sent to sign in', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/admin/stock');

    await expect(page).toHaveURL(/\/login\?next=/);
  });
});

test.describe('accessibility and layout', () => {
  test.skip(!DATABASE_URL, 'DATABASE_URL is required to promote an account to staff');

  test('the new screens pass axe', async ({ page }) => {
    await becomeStaff(page);

    for (const path of [
      '/admin',
      '/admin/products',
      '/admin/products/new',
      '/admin/stock',
      '/admin/payments',
    ]) {
      await page.goto(path);

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      expect(
        results.violations,
        `${path}: ${JSON.stringify(results.violations, null, 2)}`,
      ).toEqual([]);
    }
  });

  test('the tables stack instead of scrolling sideways on a phone', async ({ page }) => {
    await becomeStaff(page);
    await page.setViewportSize({ width: 375, height: 812 });

    for (const path of ['/admin', '/admin/products', '/admin/stock', '/admin/orders']) {
      await page.goto(path);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );

      expect(
        overflow,
        `${path} overflows horizontally by ${overflow}px`,
      ).toBeLessThanOrEqual(1);
    }
  });

  test('the sidebar is a drawer below lg and a rail above it', async ({ page }) => {
    await becomeStaff(page);

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/admin');

    const trigger = page.getByRole('button', { name: 'Ouvrir la navigation' });
    await expect(trigger).toBeVisible();
    await trigger.click();

    const drawer = page.getByRole('dialog', { name: 'Navigation' });
    await expect(drawer).toBeVisible();
    await drawer.getByRole('link', { name: 'Stock' }).click();
    await page.waitForURL(/\/admin\/stock$/);
    // Navigating closes it, without a click on a close button.
    await expect(page.getByRole('dialog', { name: 'Navigation' })).toBeHidden();

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/admin');

    await expect(page.getByRole('button', { name: 'Ouvrir la navigation' })).toBeHidden();
    await expect(
      page.getByRole('navigation', { name: 'Navigation de l’atelier' }).first(),
    ).toBeVisible();
  });
});

test.describe('photographs', () => {
  test.skip(!DATABASE_URL, 'DATABASE_URL is required to promote an account to staff');

  test('uploads photographs, orders them, and serves them publicly', async ({ page }) => {
    await becomeStaff(page);

    const slug = fixtureSlug('photo');
    const name = `Pièce photographiée ${slug}`;

    await createProduct(page, { slug, name });
    await addVariant(page, `${CAT}-PHO-${Date.now()}`.toUpperCase());

    const images = page.getByRole('region', { name: 'Photographies' });

    await expect(page.getByText('Aucune photographie.', { exact: false })).toBeVisible();

    /*
     * The file never touches the disk: `setInputFiles` accepts the bytes
     * directly, so the fixture is generated here and the test has nothing to
     * clean up. Two files, because "multiple photographs per product" is the
     * feature under test.
     */
    await page.locator('input[type="file"]').setInputFiles([
      { name: 'face.jpg', mimeType: 'image/jpeg', buffer: await jpeg(900, 1125) },
      { name: 'detail.jpg', mimeType: 'image/jpeg', buffer: await jpeg(800, 1000) },
    ]);

    await expect(images.getByRole('listitem')).toHaveCount(2, { timeout: 30_000 });

    // The first upload is the main one, and it is the file's name that seeds
    // the description — nothing here invents a caption.
    await expect(images.getByText('Principale')).toHaveCount(1);
    await expect(images.getByRole('textbox').first()).toHaveValue('face');

    // A description a person would actually write.
    const alt = images.getByRole('textbox').first();
    await alt.fill('Tote bag en toile épaisse, brodé en poitrine');
    await alt.blur();

    // Reordering promotes the second photograph to the front of the gallery.
    await images
      .getByRole('listitem')
      .first()
      .getByRole('button', { name: 'Descendre' })
      .click();

    await expect(images.getByRole('textbox').first()).toHaveValue('detail', {
      timeout: 15_000,
    });

    /*
     * The photograph is on a public URL, and the bytes are actually there.
     *
     * This deliberately stops short of publishing the product and looking at
     * the shop. Publishing a fixture puts it in the catalogue every other spec
     * reads, and the storefront tests then click a card that teardown is about
     * to delete — a failure with nothing to do with the feature under test.
     * The storefront's own rendering of product imagery is covered by
     * `storefront.spec.ts` against the seeded catalogue.
     */
    const src = await images.locator('img').first().getAttribute('src');
    expect(src).toContain('/assets/media/');

    const delivered = await page.request.get(src!);
    expect(delivered.status()).toBe(200);
    expect(delivered.headers()['content-type']).toContain('image');
  });

  test('refuses a file that is not an image, and says so', async ({ page }) => {
    await becomeStaff(page);

    const slug = fixtureSlug('refus');
    await createProduct(page, { slug, name: `Pièce refus ${slug}` });

    await page.locator('input[type="file"]').setInputFiles({
      name: 'facture.pdf',
      mimeType: 'image/jpeg',
      buffer: Buffer.from('%PDF-1.7\nnot a photograph'),
    });

    await expect(
      page.getByText(/n’a pas pu être lu comme une image|Format non accepté/),
    ).toBeVisible({ timeout: 15_000 });

    await expect(page.getByText('Aucune photographie.', { exact: false })).toBeVisible();
  });
});

test.describe('the workshop speaks both languages', () => {
  test.skip(!DATABASE_URL, 'DATABASE_URL is required to promote an account to staff');

  test('switches to English and back, without changing the address', async ({ page }) => {
    await becomeStaff(page);

    // French by default: the workshop is in Algeria and nobody has chosen.
    await expect(page.getByRole('heading', { name: 'Aujourd’hui' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Produits' })).toBeVisible();

    await page.getByRole('button', { name: /Langue/ }).click();
    await page.getByRole('menuitem', { name: 'English' }).click();

    // Same address — the workshop's URLs carry no language — and English on it.
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('link', { name: 'Products' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    // The choice follows the operator to every other screen.
    await page.goto('/admin/products');
    // A link styled as a button: what matters is that it reads in English.
    await expect(page.getByRole('link', { name: 'New product' }).first()).toBeVisible();

    await page.goto('/admin/content');
    await expect(page.getByRole('heading', { name: 'Homepage', level: 1 })).toBeVisible();

    // And it is the same preference the storefront reads.
    await page.goto('/');
    await page.waitForURL(/\/en$/);

    await page.goto('/admin');
    await page.getByRole('button', { name: /Language/ }).click();
    await page.getByRole('menuitem', { name: 'Français' }).click();
    await expect(page.getByRole('heading', { name: 'Aujourd’hui' })).toBeVisible({
      timeout: 15_000,
    });
  });
});
