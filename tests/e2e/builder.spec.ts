import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * A real 8×8 PNG, produced by `sharp` and pasted here.
 *
 * Phase 7's tests used an eight-byte signature stub, which was enough when the
 * bytes went nowhere. They go to storage now and the server decodes them, so a
 * stub is rejected — correctly. An earlier attempt at a hand-written 2×2 file
 * got this wrong in a way worth remembering: its header parsed but its pixels
 * did not decode, which is exactly the case `inspectRaster` was hardened to
 * catch.
 */
const PNG_FIXTURE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1Jr' +
    'AAAAEUlEQVQImWM4ma+FFTEMLQkAvIZYgdgjcmwAAAAASUVORK5CYII=',
  'base64',
);

const SAFE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
  '<path d="M2 2h20v20H2z"/></svg>';

/**
 * The custom embroidery builder, end to end.
 *
 * Drives the real flow against the seeded database: pick a blank, place the
 * embroidery, describe the design, choose options, review, submit. The
 * assertions that matter are the ones a unit test cannot make — that the
 * estimate is a *server* answer that changes when the configuration crosses a
 * documented threshold, and that the review reflects what was chosen.
 *
 * Phase 9 made the uploads real: a file selected here is authorised, PUT to
 * storage and then **verified by the server**, which is the only thing that
 * makes it usable. The fixtures below are therefore whole, valid files.
 */

async function chooseFirstProduct(page: Page) {
  /*
   * The t-shirt by name, not "the first radio".
   *
   * Only a blank whose photographs the owner has measured can be placed on
   * (ADR-035), and the list is ordered by price. Picking whichever is cheapest
   * makes every test downstream depend on the catalogue's pricing and on which
   * products happen to be measured — which is how this suite started failing
   * for a reason that had nothing to do with the builder.
   */
  await page.getByRole('radio', { name: /T-shirt brodé classique/ }).click();
  await page.getByRole('button', { name: 'Continuer' }).click();
}

/**
 * Step 3, which is now a canvas rather than a list of names.
 *
 * Freeform placement (ADR-035) replaced the radio group with an editor the
 * customer drags a design around in, and it needs no answer to continue: a
 * blank whose photographs nobody has measured has no placeable face, and the
 * step passes so an unfinished catalogue does not look like a broken website.
 * The seeded data has no measured surfaces, so this is what the journey
 * actually meets.
 */
async function passPlacement(page: Page) {
  await expect(page.getByRole('heading', { name: /3\. Emplacement/ })).toBeVisible();

  /*
   * The design is already on the garment at chest height, and the live readout
   * proves the calibration reached the browser: the default box is 22% wide,
   * and 22% of the seeded 520 mm chest is 114 mm. Accepting that default is a
   * real path — most customers will — so this takes it.
   */
  await expect(page.getByRole('status')).toContainText('mm');

  await page.getByRole('button', { name: 'Continuer' }).click();
}

async function enterText(page: Page, text = 'Amina') {
  // Design comes **before** placement now: you cannot drag a logo onto a
  // hoodie before you have the logo.
  await expect(page.getByRole('heading', { name: /2\. Design/ })).toBeVisible();
  await page.getByLabel(/Texte à broder/).fill(text);
  await page.getByRole('button', { name: 'Continuer' }).click();
}

async function chooseOptions(page: Page) {
  await expect(page.getByRole('heading', { name: /4\. Personnalisation/ })).toBeVisible();
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
}

test.describe('the builder', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/custom');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('loads with the first step and a stepper', async ({ page }) => {
    await expect(page.getByRole('navigation', { name: /Étapes/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /1\. Produit/ })).toBeVisible();

    // Nothing is chosen, so Continue is off — and says why.
    await expect(page.getByRole('button', { name: 'Continuer' })).toBeDisabled();
    await expect(page.getByText('Faites un choix pour continuer.')).toBeVisible();
  });

  test('offers only customisable blanks', async ({ page }) => {
    const options = page.getByRole('radiogroup', { name: 'Produit' }).getByRole('radio');
    expect(await options.count()).toBeGreaterThan(0);

    // The seeded bonnet is not customisable and must not be offered.
    await expect(page.getByText('Bonnet côtelé brodé')).toHaveCount(0);
  });

  test('walks the five steps and reflects the choices at review', async ({ page }) => {
    await chooseFirstProduct(page);
    await enterText(page, 'Amina');
    await passPlacement(page);
    await chooseOptions(page);

    await page.getByRole('button', { name: 'Continuer' }).click();
    await expect(page.getByRole('heading', { name: /5\. Récapitulatif/ })).toBeVisible();

    // The summary reads like a spec sheet and carries what was chosen.
    await expect(page.getByText('Amina', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Vos coordonnées' })).toBeVisible();
  });

  test('shows a server-computed estimate that reacts to the configuration', async ({
    page,
  }) => {
    await chooseFirstProduct(page);
    await enterText(page);
    await passPlacement(page);
    await chooseOptions(page);

    // An estimate is shown at every step (BUSINESS-RULES 2.4.1), and a simple
    // configuration is a firm price rather than a range.
    await expect(page.getByText('Prix ferme pour cette configuration')).toBeVisible();
    await expect(page.getByText('Devis nécessaire')).toHaveCount(0);

    // Crossing the seeded quantity threshold of 10 flips the mode, and the
    // reason is stated rather than left as a stall.
    await page.getByRole('textbox', { name: 'Quantité' }).fill('20');
    await page.getByRole('textbox', { name: 'Quantité' }).blur();

    await expect(page.getByText('Devis nécessaire')).toBeVisible();
    await expect(page.getByText(/la quantité demandée/)).toBeVisible();
  });

  test('prevents submission until the required contact details are given', async ({
    page,
  }) => {
    await chooseFirstProduct(page);
    await enterText(page);
    await passPlacement(page);
    await chooseOptions(page);
    await page.getByRole('button', { name: 'Continuer' }).click();

    const submit = page.getByRole('button', {
      name: /Envoyer ma demande|Demander mon devis/,
    });
    await expect(submit).toBeDisabled();

    await page.getByLabel('Nom complet').fill('Amina Bensalem');
    await expect(submit).toBeDisabled();

    await page.getByLabel('Adresse e-mail').fill('pas-un-email');
    await expect(submit).toBeDisabled();

    await page.getByLabel('Adresse e-mail').fill('amina@example.invalid');
    await expect(submit).toBeEnabled();
  });

  test('submits and returns a request reference', async ({ page }) => {
    await chooseFirstProduct(page);
    await enterText(page);
    await passPlacement(page);
    await chooseOptions(page);
    await page.getByRole('button', { name: 'Continuer' }).click();

    await page.getByLabel('Nom complet').fill('Amina Bensalem');
    await page.getByLabel('Adresse e-mail').fill('e2e@example.invalid');
    await page
      .getByRole('button', { name: /Envoyer ma demande|Demander mon devis/ })
      .click();

    await expect(page.getByText('Nous avons bien reçu votre demande')).toBeVisible();
    await expect(page.getByText(/DEM-\d{4}-\d{4,}/)).toBeVisible();
  });

  test('uploads a real PNG and shows the server-generated preview', async ({ page }) => {
    await chooseFirstProduct(page);

    // A real PNG, not a magic-number stub: the server decodes it, checks its
    // dimensions and re-encodes a preview, and none of that works on a fake.
    await page.locator('input[type="file"]').setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: PNG_FIXTURE,
    });

    await expect(page.getByText('logo.png', { exact: true })).toBeVisible();

    // Readiness is the server's word. Until it arrives the card says so.
    await expect(page.getByText(/Envoi de logo\.png en cours/)).toBeVisible();
    await expect(page.getByText(/Envoi de logo\.png en cours/)).toHaveCount(0, {
      timeout: 15_000,
    });

    await expect(page.getByRole('button', { name: 'Retirer logo.png' })).toBeVisible();

    // The thumbnail is the preview the **server** generated, fetched from a
    // signed URL — never a blob of the uploaded file, and never the file
    // itself. Its source proves which of the two it is.
    await expect(page.locator('img[src*="/api/storage/local"]')).toHaveCount(1);
  });

  test('shows a file card and no preview for an SVG', async ({ page }) => {
    await chooseFirstProduct(page);

    await page.locator('input[type="file"]').setInputFiles({
      name: 'logo.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(SAFE_SVG),
    });

    await expect(page.getByText('logo.svg', { exact: true })).toBeVisible();
    await expect(page.getByText(/Envoi de logo\.svg en cours/)).toHaveCount(0, {
      timeout: 15_000,
    });

    // ADR-011: accepted, never rasterised, and the absence is explained rather
    // than left as a puzzle.
    await expect(
      page.getByText(/Nous ne pouvons pas afficher d’aperçu pour ce type de fichier/),
    ).toBeVisible();
  });

  test('shows a file card for a PDF', async ({ page }) => {
    await chooseFirstProduct(page);

    await page.locator('input[type="file"]').setInputFiles({
      name: 'brief.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(
        '%PDF-1.7\n1 0 obj\n<< /Type /Page >>\nendobj\n%%EOF',
        'latin1',
      ),
    });

    await expect(page.getByText('brief.pdf', { exact: true })).toBeVisible();
    await expect(page.getByText(/Envoi de brief\.pdf en cours/)).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(
      page.getByText(/Nous ne pouvons pas afficher d’aperçu pour ce type de fichier/),
    ).toBeVisible();
  });

  test('rejects an SVG carrying a script, and says why', async ({ page }) => {
    await chooseFirstProduct(page);

    await page.locator('input[type="file"]').setInputFiles({
      name: 'logo.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg onload="alert(1)"><script>alert(1)</script></svg>'),
    });

    // The client-side check cannot see this — only the server can, after
    // reading the stored bytes.
    await expect(page.getByText(/contient du code/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Réessayer' })).toBeVisible();
  });

  test('rejects bytes that do not match the declared type', async ({ page }) => {
    await chooseFirstProduct(page);

    // A PDF wearing a PNG name and a PNG content type: the browser's checks
    // all pass, and the server refuses it on its bytes.
    await page.locator('input[type="file"]').setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: Buffer.from('%PDF-1.7\n%%EOF', 'latin1'),
    });

    await expect(page.getByText(/ne correspond pas|n’est pas un/)).toBeVisible({
      timeout: 15_000,
    });
  });

  test('refuses a file type that is not accepted', async ({ page }) => {
    await chooseFirstProduct(page);

    await page.locator('input[type="file"]').setInputFiles({
      name: 'notes.gif',
      mimeType: 'image/gif',
      buffer: Buffer.from('GIF89a'),
    });

    await expect(page.getByText('Certains fichiers n’ont pas été ajoutés')).toBeVisible();
  });

  test('refuses a file over the documented size limit', async ({ page }) => {
    await chooseFirstProduct(page);

    await page.locator('input[type="file"]').setInputFiles({
      name: 'huge.png',
      mimeType: 'image/png',
      // One byte past 25 MB. Refused in the browser so the customer is not
      // made to wait for an upload that was always going to be refused.
      buffer: Buffer.alloc(25 * 1024 * 1024 + 1),
    });

    // Scoped to the rejection list: the dropzone hint mentions the same limit,
    // and a locator that matches both proves nothing about either.
    const rejections = page.getByRole('listitem').filter({ hasText: 'huge.png' });
    await expect(page.getByText('Certains fichiers n’ont pas été ajoutés')).toBeVisible();
    await expect(rejections).toContainText('25 Mo maximum');
  });

  test('removes an uploaded file', async ({ page }) => {
    await chooseFirstProduct(page);

    await page.locator('input[type="file"]').setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: PNG_FIXTURE,
    });

    await expect(page.getByRole('button', { name: 'Retirer logo.png' })).toBeVisible();
    await page.getByRole('button', { name: 'Retirer logo.png' }).click();
    await expect(page.getByText('logo.png', { exact: true })).toHaveCount(0);
  });

  test('keeps the bytes on our own origin', async ({ page }) => {
    await chooseFirstProduct(page);

    const destinations: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'PUT' || request.method() === 'POST') {
        destinations.push(request.url());
      }
    });

    await page.locator('input[type="file"]').setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: PNG_FIXTURE,
    });

    await expect(page.getByRole('button', { name: 'Retirer logo.png' })).toBeVisible();

    // In development the presigned PUT points at this application; in
    // production it points at the bucket. Either way it never reaches a third
    // party, and this asserts the development case the suite actually runs.
    for (const url of destinations) {
      expect(new URL(url).host).toBe(new URL(page.url()).host);
    }
  });

  test('submits a request carrying a stored file', async ({ page }) => {
    await chooseFirstProduct(page);

    await page.locator('input[type="file"]').setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: PNG_FIXTURE,
    });

    await expect(page.getByText(/Envoi de logo\.png en cours/)).toHaveCount(0, {
      timeout: 15_000,
    });

    await page.getByRole('button', { name: 'Continuer' }).click();
    await passPlacement(page);
    await chooseOptions(page);
    await page.getByRole('button', { name: 'Continuer' }).click();

    await page.getByLabel('Nom complet').fill('Amina Bensalem');
    await page.getByLabel('Adresse e-mail').fill('e2e-upload@example.invalid');
    await page
      .getByRole('button', { name: /Envoyer ma demande|Demander mon devis/ })
      .click();

    await expect(page.getByText('Nous avons bien reçu votre demande')).toBeVisible();
    await expect(page.getByText(/DEM-\d{4}-\d{4,}/)).toBeVisible();
  });

  test('changes the quantity from the stepper', async ({ page }) => {
    await chooseFirstProduct(page);
    await enterText(page);
    await passPlacement(page);
    await chooseOptions(page);

    const quantity = page.getByRole('textbox', { name: 'Quantité' });
    await expect(quantity).toHaveValue('1');

    await page.getByRole('button', { name: /augmenter/i }).click();
    await expect(quantity).toHaveValue('2');
  });

  test('is operable from the keyboard, and moves focus between steps', async ({
    page,
  }) => {
    await chooseFirstProduct(page);

    // Focus lands on the new step's heading, so a keyboard user is told where
    // they are rather than left on a button that no longer exists.
    await expect(page.getByRole('heading', { name: /2\. Design/ })).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toBeVisible();
  });

  test('has no accessibility violations at each step', async ({ page }) => {
    const scan = async (label: string) => {
      // axe reads *computed* colours, and a colour transition in flight
      // computes to an interpolation that is neither the start state nor the
      // end state. Scanning immediately after a click therefore reported a
      // contrast failure against a colour pair that never exists at rest —
      // a selected thread-colour swatch settles at 18:1, but was sampled
      // partway there. Wait for the transitions to finish so the scan
      // describes the interface a person actually sees.
      await page.waitForFunction(() =>
        document
          .getAnimations()
          .filter((animation) => animation instanceof CSSTransition)
          .every((animation) => animation.playState !== 'running'),
      );

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(results.violations, `axe violations at ${label}`).toEqual([]);
    };

    await scan('step 1');
    await chooseFirstProduct(page);
    await scan('step 2');
    await enterText(page);
    await scan('step 3');
    await passPlacement(page);
    await chooseOptions(page);
    await scan('step 4');
    await page.getByRole('button', { name: 'Continuer' }).click();
    await scan('step 5');
  });
});

test.describe('the builder on mobile', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('never scrolls horizontally, at any step', async ({ page }) => {
    await page.goto('/custom');

    const overflow = async () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );

    expect(await overflow(), 'step 1').toBeLessThanOrEqual(1);

    await chooseFirstProduct(page);
    expect(await overflow(), 'step 2').toBeLessThanOrEqual(1);

    await enterText(page);
    expect(await overflow(), 'step 3').toBeLessThanOrEqual(1);

    await passPlacement(page);
    await chooseOptions(page);
    expect(await overflow(), 'step 4').toBeLessThanOrEqual(1);

    await page.getByRole('button', { name: 'Continuer' }).click();
    expect(await overflow(), 'step 5').toBeLessThanOrEqual(1);
  });
});
