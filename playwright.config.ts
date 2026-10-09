import dotenv from 'dotenv';
import { defineConfig, devices } from '@playwright/test';

/**
 * The same environment the application reads.
 *
 * The web servers below get `.env.local` through Next.js, but the **test**
 * process does not, and the quote journey needs `DATABASE_URL` to promote a
 * user to staff — an operation with no interface until Phase 12. Without this
 * the suite silently skipped rather than failed, which is the worse outcome.
 */
dotenv.config({ path: ['.env.local', '.env'], quiet: true });

const PORT = 3000;
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

/**
 * A second, development server.
 *
 * The design-system showcase is development-only — in production the route
 * returns 404, which the production project asserts. Auditing the showcase
 * itself therefore needs `next dev`, and the two servers are kept apart by
 * `NEXT_DIST_DIR` so they do not overwrite each other's build output.
 */
const DEV_PORT = 3100;
const devBaseURL = `http://localhost:${DEV_PORT}`;

/**
 * End-to-end tests.
 *
 * Chromium only for now. The full device matrix arrives in Phase 16 with the
 * six critical journeys; running it against a foundation would cost time and
 * prove nothing.
 */
/**
 * The environment, minus the mail provider.
 *
 * The transport is chosen by the **presence** of `RESEND_API_KEY`
 * (`lib/email/transport`), so a developer who configures e-mail for real turns
 * this suite into something that sends actual messages — to the
 * `@example.invalid` addresses it invents, from a live account, dozens of times
 * a run. Resend refuses them, which is how it was noticed: outbox assertions
 * started reading FAILED where they had always read SENT.
 *
 * Removing the two variables restores the console transport, which exercises
 * the whole outbox — enqueue, claim, render, mark sent — and delivers nothing.
 * A test suite that can e-mail strangers is a hazard whatever it asserts.
 *
 * They are **deleted rather than blanked**: `env.ts` validates them as
 * `min(1).optional()`, so an empty string is invalid where an absent one is
 * simply "not configured". And the rest of the environment has to be carried
 * across by hand, because Playwright's `webServer.env` replaces `process.env`
 * rather than extending it — without this the build loses `DATABASE_URL`.
 */
function withoutMailProvider(): Record<string, string> {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );

  /*
   * An override, not a deletion.
   *
   * Removing `RESEND_API_KEY` here achieves nothing: `next start` loads
   * `.env.local` itself and puts it straight back. `EMAIL_TRANSPORT=console` is
   * read after that and wins (`lib/email/transport`).
   */
  inherited.EMAIL_TRANSPORT = 'console';

  /*
   * And no rate limiting.
   *
   * The suite registers dozens of accounts, signs in dozens of times and
   * uploads repeatedly, all from 127.0.0.1 inside a few minutes — which is
   * precisely the traffic `SECURITY.md` section 9 exists to refuse. Loosening
   * the limits to let the tests through would mean shipping limits chosen by a
   * test runner; turning the limiter off here keeps the real numbers real. The
   * limiter itself is covered directly by `tests/integration/rate-limit`.
   */
  inherited.RATE_LIMIT = 'off';

  return inherited;
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  /*
   * Four, not "half the cores".
   *
   * Every storefront page renders per request since Phase 15 — the nonce in
   * the Content-Security-Policy is request data, so nothing is prerendered
   * (ADR-041). One Next process and one development Postgres serve the whole
   * suite, and at the default worker count the long journeys started timing out
   * while single requests still answered in 30 ms: contention, not a
   * regression. Four keeps the suite parallel and keeps it deterministic.
   */
  workers: process.env.CI ? 1 : 4,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL,
    trace: 'on-first-retry',

    /*
     * A French-speaking browser.
     *
     * The storefront negotiates its language from `Accept-Language`, so a
     * default Chromium — which asks for `en-US` — lands on `/en` and every
     * assertion written against the French copy fails for a reason that has
     * nothing to do with the feature under test. The shop is Algerian and its
     * customers read French; this makes the suite's browser one of them.
     *
     * `tests/e2e/i18n.spec.ts` overrides it where English is the subject.
     */
    locale: 'fr-DZ',
  },

  projects: [
    {
      name: 'chromium',
      testIgnore:
        /design-system|content-admin|archive-admin|settings-admin|catalogue-admin/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      /*
       * The landing-page editor, alone.
       *
       * These tests change the front page every other spec reads — a headline,
       * a band switched off, the hero's photograph. Run in parallel with the
       * rest, they make the storefront's assertions fail for a reason that has
       * nothing to do with the storefront, and the failure lands in whichever
       * file lost the race.
       *
       * `dependencies` makes this project wait for `chromium` to finish, so the
       * shared page is only ever edited when nothing is looking at it. It puts
       * about thirty seconds on the end of the suite and removes an entire
       * class of confusing failure.
       */
      name: 'content-admin',
      testMatch: /content-admin/,
      dependencies: ['chromium'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      /*
       * Archiving, alone, for the same reason.
       *
       * This spec adds requests to the workshop's queue and then takes them off
       * it. Run beside the rest, it changes what `admin.spec.ts` counts while
       * that file is counting, and the failure lands wherever the race was
       * lost rather than where the cause is.
       */
      name: 'archive-admin',
      testMatch: /archive-admin/,
      dependencies: ['chromium'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      /*
       * The settings screen, alone, and for the sharpest version of the reason.
       *
       * These rows are **global**: one of its tests closes the shop, and a spec
       * running beside it would find the storefront replaced by a curtain. It
       * puts everything back, but "puts it back afterwards" is no comfort to a
       * test that read the value in between.
       */
      name: 'settings-admin',
      testMatch: /settings-admin/,
      /*
       * After **content-admin**, not merely after chromium.
       *
       * `dependencies` orders a project behind its dependency, and nothing
       * else: two projects that both depend on `chromium` run beside each
       * other. This one closes the shop, and a spec registering an account in
       * the next process over then meets the curtain — which is how it was
       * found. Chaining them makes the three admin projects a queue.
       */
      dependencies: ['content-admin'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      /*
       * Category management, alone, and last in the admin queue.
       *
       * It creates categories, renames them and hides one. Every category is a
       * chip on `/shop` and a page under `/shop/c/`, so a spec reading the
       * catalogue while this one is running sees a shelf appear and vanish
       * mid-assertion. It cleans up after itself; "cleans up afterwards" is no
       * comfort to a test that read the row in between.
       */
      name: 'catalogue-admin',
      testMatch: /catalogue-admin/,
      dependencies: ['settings-admin'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'design-system-desktop',
      testMatch: /design-system/,
      use: { ...devices['Desktop Chrome'], baseURL: devBaseURL },
    },
    {
      // Mobile is the primary platform (DESIGN-SYSTEM.md section 13), so the
      // showcase is audited on a phone viewport as well as a desktop one.
      // Pixel 5 rather than an iPhone because the suite installs Chromium only.
      name: 'design-system-mobile',
      testMatch: /design-system/,
      use: { ...devices['Pixel 5'], baseURL: devBaseURL },
    },
  ],

  webServer: [
    {
      command: 'npm run build && npm run start',
      url: baseURL,
      /*
       * No mail provider, deliberately.
       *
       * The transport is chosen by the presence of `RESEND_API_KEY`
       * (`lib/email/transport`), so a developer who configures e-mail for real
       * turns this suite into something that sends **actual messages** — to
       * `@example.invalid` addresses it invents, from a live account, hundreds
       * of times a run. Resend refuses them, which is how this was noticed: the
       * outbox assertions started reading FAILED instead of SENT.
       *
       * Blanking it here restores the console transport, which exercises the
       * whole outbox — enqueue, claim, render, mark sent — and delivers
       * nothing. A test suite that can e-mail strangers is a hazard whatever it
       * asserts.
       */
      env: withoutMailProvider(),
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command: `npx next dev -p ${DEV_PORT}`,
      env: { NEXT_DIST_DIR: '.next-dev' },
      url: devBaseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
