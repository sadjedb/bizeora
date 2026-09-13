import 'server-only';

import { isTest, serverEnv } from '@/lib/env';

/**
 * The e-mail transport.
 *
 * One interface, three implementations, chosen by configuration rather than by
 * `NODE_ENV` — the same rule `lib/storage` follows and for the same reason: a
 * production build on a laptop is still a laptop, and a deployment with no key
 * must fail loudly rather than pretend.
 *
 *   - **Resend**, when `RESEND_API_KEY` and `EMAIL_FROM` are both set. Called
 *     over `fetch`, so no SDK is added for one HTTP POST.
 *   - **Memory**, under `NODE_ENV=test`. Keeps messages so a test can assert on
 *     them, and sends nothing anywhere.
 *   - **Console**, otherwise. Records that a message was due, with the subject
 *     and recipient and **never the body**, because a verification code and a
 *     reset link are live credentials (`SECURITY.md` 2.1).
 *
 * Nothing above this module knows which one it has.
 */

export type EmailMessage = {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
};

export type DeliveryResult =
  | { ok: true; providerId: string | null }
  | { ok: false; error: string; retryable: boolean };

export type EmailTransport = {
  readonly id: 'resend' | 'memory' | 'console';
  /** False when the transport cannot deliver, so the caller can skip cleanly. */
  isEnabled(): boolean;
  send(message: EmailMessage): Promise<DeliveryResult>;
};

/* ---------------------------------------------------------------------------
 * Test
 * ------------------------------------------------------------------------ */

/**
 * Messages a test run has "sent".
 *
 * Exported so a test can read what a flow produced. Nothing writes here outside
 * `NODE_ENV=test`, and no production path reads it.
 */
export const sentEmails: EmailMessage[] = [];

/**
 * A marker a test sets to make matching messages fail.
 *
 * Targeted rather than a counter, because the test database is shared: a
 * counter is spent by whichever message happens to be dispatched first, which
 * may belong to a suite running in parallel. Matching on the message's own text
 * makes the injected failure belong to the test that asked for it.
 */
let failMarker: string | null = null;

export function failEmailsMatching(marker: string | null): void {
  failMarker = marker;
}

export function clearSentEmails(): void {
  sentEmails.length = 0;
  failMarker = null;
}

function createMemoryTransport(): EmailTransport {
  return {
    id: 'memory',
    isEnabled: () => true,
    send(message) {
      if (failMarker !== null && message.text.includes(failMarker)) {
        return Promise.resolve({
          ok: false,
          error: 'Injected failure',
          retryable: true,
        });
      }

      sentEmails.push(message);
      return Promise.resolve({ ok: true, providerId: `memory-${sentEmails.length}` });
    },
  };
}

/* ---------------------------------------------------------------------------
 * Development
 * ------------------------------------------------------------------------ */

function createConsoleTransport(): EmailTransport {
  return {
    id: 'console',
    // Enabled, and deliberately so: a development run should exercise the whole
    // outbox — enqueue, claim, render, mark sent — rather than skip it. What it
    // does not do is put the body anywhere.
    isEnabled: () => true,
    send(message) {
      console.warn(
        `[email] no provider configured — "${message.subject}" for ${message.to} was not sent. ` +
          'The body is withheld from logs by design (SECURITY.md 2.1). ' +
          'Set RESEND_API_KEY and EMAIL_FROM to deliver.',
      );

      return Promise.resolve({ ok: true, providerId: null });
    },
  };
}

/* ---------------------------------------------------------------------------
 * Resend
 * ------------------------------------------------------------------------ */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/**
 * Which failures are worth trying again.
 *
 * A 4xx is the message being wrong — a malformed address, a rejected sender —
 * and re-sending it produces the same 4xx four more times. A 429 or a 5xx is
 * the provider, and that is exactly what the outbox exists for. A network error
 * has no status at all and is always retryable.
 */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * What went wrong, in terms the person who has to fix it can act on.
 *
 * This used to record the status code alone — "Resend responded 403" — on the
 * reasoning that a provider's error body can quote the message it rejected, and
 * this string is stored in `lastError` where an operator reads it.
 *
 * The caution is right about **bodies** and wrong about this. Resend's failures
 * are structured (`{ statusCode, name, message }`), and the two fields taken
 * here carry configuration facts rather than customer content: `name` is a
 * fixed provider code, and `message` for the errors that actually happen says
 * things like *"you can only send testing emails to your own address"* or
 * *"the domain is not verified"*. Neither quotes the e-mail. The recipient —
 * the one identifier such a message might repeat — is already stored in the
 * same row, one column across.
 *
 * A status code by itself is a support ticket. The sentence is the fix.
 *
 * Bounded, and it falls back to the status when the body is not what was
 * expected: a provider having a very bad day can return an HTML error page, and
 * that page does not belong in a database column.
 */
async function describeFailure(response: Response): Promise<string> {
  const fallback = `Resend responded ${response.status}`;

  try {
    const body: unknown = await response.json();

    if (typeof body !== 'object' || body === null) return fallback;

    const { name, message } = body as { name?: unknown; message?: unknown };
    const code = typeof name === 'string' ? name : null;
    const detail = typeof message === 'string' ? message.slice(0, 300) : null;

    if (!code && !detail) return fallback;

    return [fallback, code, detail].filter(Boolean).join(' · ');
  } catch {
    return fallback;
  }
}

function createResendTransport(apiKey: string, from: string): EmailTransport {
  return {
    id: 'resend',
    isEnabled: () => true,
    async send(message) {
      try {
        const response = await fetch(RESEND_ENDPOINT, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            from,
            to: [message.to],
            subject: message.subject,
            html: message.html,
            text: message.text,
          }),
        });

        if (!response.ok) {
          return {
            ok: false,
            error: await describeFailure(response),
            retryable: isRetryableStatus(response.status),
          };
        }

        const body = (await response.json()) as { id?: unknown };

        return { ok: true, providerId: typeof body.id === 'string' ? body.id : null };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.name : 'Network error',
          retryable: true,
        };
      }
    },
  };
}

/* ---------------------------------------------------------------------------
 * Selection
 * ------------------------------------------------------------------------ */

let cached: EmailTransport | null = null;

/**
 * The transport, built once and lazily.
 *
 * Lazily for the reason `lib/storage` learned in Phase 9: building it at module
 * evaluation makes `next build` depend on configuration a build machine does
 * not have.
 */
export function emailTransport(): EmailTransport {
  if (cached) return cached;

  if (isTest) {
    cached = createMemoryTransport();
    return cached;
  }

  // An explicit refusal to deliver, for the end-to-end suite. See `env.ts`.
  if (serverEnv.EMAIL_TRANSPORT === 'console') {
    cached = createConsoleTransport();
    return cached;
  }

  const apiKey = serverEnv.RESEND_API_KEY;
  const from = serverEnv.EMAIL_FROM;

  cached =
    apiKey && from ? createResendTransport(apiKey, from) : createConsoleTransport();

  return cached;
}

/** Test-only: forget the cached transport so configuration can be re-read. */
export function resetEmailTransport(): void {
  cached = null;
}
