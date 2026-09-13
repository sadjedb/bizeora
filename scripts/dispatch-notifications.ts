/**
 * Flush the notification outbox once, by hand.
 *
 * Nothing in this application sends an e-mail at the moment it happens. Placing
 * an order writes a row to `notifications` inside the same transaction as the
 * order (`ARCHITECTURE.md` section 11) and returns; the row is delivered later,
 * by a sweep. That is the right shape — a mail provider having a bad afternoon
 * must not be able to fail a checkout — but it has one consequence people meet
 * before they meet the reasoning:
 *
 *     **nothing is ever sent until something calls the dispatcher.**
 *
 * In production that something is a scheduler hitting
 * `POST /api/jobs/notifications` every few minutes. In development there is no
 * scheduler, so this is it:
 *
 *     npm run jobs:notifications
 *
 * It is the same HTTP call a cron job makes, with the same secret, against
 * whatever `NEXT_PUBLIC_SITE_URL` points at — so if it works here it works
 * there, and if the secret is wrong it fails here the same way.
 */

import dotenv from 'dotenv';

dotenv.config({ path: ['.env.local', '.env'], quiet: true });

const base = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(
  /\/$/,
  '',
);

const secret = process.env.JOBS_SECRET;

async function main(): Promise<void> {
  if (!secret) {
    console.error('JOBS_SECRET is not set. The dispatcher refuses to run without it.');
    process.exitCode = 1;
    return;
  }

  const url = `${base}/api/jobs/notifications`;
  let response: Response;

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
    });
  } catch (error) {
    // The commonest failure by a distance: the server is not running.
    console.error(`Could not reach ${url}.`);
    console.error(error instanceof Error ? error.message : String(error));
    console.error(
      '\nIs the app running? `npm run dev`, or `npm run start` after a build.',
    );
    process.exitCode = 1;
    return;
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    console.error(`${response.status} from ${url}`);
    console.error(body);
    process.exitCode = 1;
    return;
  }

  console.info(JSON.stringify(body, null, 2));

  /*
   * The sweep reports what it did, not what it delivered.
   *
   * A message whose transport is the console one counts as "sent" — the outbox
   * did its job and the provider is what is missing. Saying so here saves the
   * next person from reading `sent: 3` and then searching an empty inbox.
   */
  if (!process.env.RESEND_API_KEY) {
    console.warn(
      '\nNo RESEND_API_KEY is set, so anything "sent" above went to the console\n' +
        'transport and reached nobody. Set RESEND_API_KEY and EMAIL_FROM to deliver.',
    );
  }
}

void main();
