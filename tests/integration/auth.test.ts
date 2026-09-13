/**
 * Authentication integration tests (Phase 3).
 *
 * These drive the real Better Auth 1.7.2 instance from `src/lib/auth/config.ts`
 * against the real migrated database, through its own server API — no mocks,
 * no hand-rolled substitute for the flows under test. They are deliberately
 * narrow and cover the security-critical behaviour only: where the password
 * lands, what a session is, and that a single-use credential is genuinely
 * single-use.
 *
 * Vitest sets NODE_ENV to `test`, which is what selects the in-memory mailer in
 * `lib/email`, so verification and reset links can be followed here without any
 * transport being configured. The dynamic imports below keep `lib/auth` from
 * loading until dotenv has populated the environment that `lib/env` validates.
 */

import dotenv from 'dotenv';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../src/generated/prisma/client';

dotenv.config({ path: ['.env.local', '.env'], quiet: true });

const { auth } = await import('../../src/lib/auth/config');
const { sentEmails } = await import('../../src/lib/email');

/**
 * The credential inside a rendered message.
 *
 * Phase 8A replaced the structured `{ url, otp }` seam with real templates, so
 * these read the **body a recipient would actually receive**. That is a
 * stronger assertion than the old one, not a weaker one: it proves the code
 * reaches the reader, and that the reset link is in the message rather than
 * merely passed to a function.
 */
function otpIn(message: { text: string } | undefined): string | undefined {
  return /\b(\d{8})\b/.exec(message?.text ?? '')?.[1];
}

function urlIn(message: { text: string } | undefined): string | undefined {
  return /(https?:\/\/\S+)/.exec(message?.text ?? '')?.[1];
}

const outbox = sentEmails;
const { hashPassword, verifyPassword } = await import('../../src/lib/auth/password');

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: connectionString ?? '' }),
});

/** Every user this file creates, removed afterwards. Sessions and accounts cascade. */
const createdUserIds = new Set<string>();

const PASSWORD = 'correct horse battery staple';

function uniqueEmail(label: string): string {
  return `phase3-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.invalid`;
}

async function register(email: string, name = 'Test Customer') {
  const result = await auth.api.signUpEmail({
    body: { email, password: PASSWORD, name },
  });

  createdUserIds.add(result.user.id);
  return result;
}

/**
 * Signs in and returns both forms of the session credential.
 *
 * The cookie value is `<token>.<signature>` — Better Auth signs it, and
 * `getSession` rejects a value whose signature does not verify. The database
 * row stores only the token, so requests need `cookiePair` and row lookups
 * need `token`.
 */
async function signIn(email: string, password = PASSWORD) {
  const response = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });

  const setCookie = response.headers.get('set-cookie') ?? '';
  const cookiePair = /(stitch\.session_token=[^;]+)/.exec(setCookie)?.[1] ?? '';
  const value = cookiePair.slice('stitch.session_token='.length);

  return {
    response: response.response,
    setCookie,
    cookiePair,
    token: value ? decodeURIComponent(value).split('.')[0] : undefined,
  };
}

function headersWithSession(cookiePair: string): Headers {
  return new Headers({ cookie: cookiePair });
}

beforeEach(() => {
  outbox.length = 0;
});

afterAll(async () => {
  // The duplicate-sign-up decoy returns a synthetic, non-UUID id; only real
  // rows can be deleted by id.
  const realIds = [...createdUserIds].filter((id) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
  );
  if (realIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: realIds } } });
  }
  await prisma.$disconnect();
});

describe('password hashing', () => {
  it('uses Argon2id with the documented parameters', async () => {
    const hash = await hashPassword(PASSWORD);

    // The encoded prefix is the record of what was actually used, so it is
    // asserted rather than the options object we passed in.
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).toContain('m=19456');
    expect(hash).toContain('t=2');
    expect(hash).toContain('p=1');
  });

  it('salts per password, and verifies both ways round', async () => {
    const first = await hashPassword(PASSWORD);
    const second = await hashPassword(PASSWORD);

    expect(first).not.toBe(second);
    expect(await verifyPassword({ hash: first, password: PASSWORD })).toBe(true);
    expect(await verifyPassword({ hash: second, password: PASSWORD })).toBe(true);
    expect(await verifyPassword({ hash: first, password: 'wrong password!!' })).toBe(
      false,
    );
  });

  it('fails closed on a corrupt stored hash rather than throwing', async () => {
    expect(await verifyPassword({ hash: 'not-a-hash', password: PASSWORD })).toBe(false);
  });
});

describe('registration', () => {
  it('stores the Argon2id hash on the credential account, never on the user', async () => {
    const email = uniqueEmail('register');
    const { user } = await register(email);

    const account = await prisma.account.findFirst({ where: { userId: user.id } });

    expect(account).not.toBeNull();
    expect(account?.providerId).toBe('credential');
    expect(account?.issuer).toBe('local:credential');
    expect(account?.password?.startsWith('$argon2id$')).toBe(true);

    // The password itself must appear nowhere in the row.
    expect(JSON.stringify(account)).not.toContain(PASSWORD);

    // `users` has no password column at all — the Phase 2.3 reconciliation.
    const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users'
        AND column_name LIKE '%password%'
    `;
    expect(columns).toHaveLength(0);
  });

  it('creates the user with a database-generated UUID v7', async () => {
    const { user } = await register(uniqueEmail('uuid'));

    expect(user.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('starts unverified and keeps our own domain defaults', async () => {
    const { user } = await register(uniqueEmail('defaults'));

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

    expect(row.emailVerified).toBe(false);
    expect(row.role).toBe('CUSTOMER');
    expect(row.status).toBe('ACTIVE');
    expect(row.marketingOptIn).toBe(false);
  });

  it('does not create a second account for an email already registered', async () => {
    const email = uniqueEmail('duplicate');
    const first = await register(email);
    outbox.length = 0;

    /**
     * Better Auth answers a duplicate sign-up with a synthetic user and a null
     * token rather than an error, so a stranger cannot use the registration
     * form to discover which addresses hold accounts. Verified against the
     * installed 1.7.2 source: with `autoSignIn: false` the handler returns
     * `buildGenericDuplicateResponse()` and still hashes the submitted password
     * so the timing matches a real registration.
     *
     * The security property is therefore not "it throws" — it is that nothing
     * is created and nothing is disclosed.
     */
    const second = await register(email);

    expect(second.token).toBeNull();
    expect(second.user.id).not.toBe(first.user.id);

    expect(await prisma.user.count({ where: { email, deletedAt: null } })).toBe(1);
    expect(await prisma.account.count({ where: { userId: first.user.id } })).toBe(1);
    // No second verification mail: the real owner is not notified, and the
    // requester learns nothing.
    expect(outbox).toHaveLength(0);
  });

  it('refuses to create a second row at the database level as well', async () => {
    const email = uniqueEmail('duplicate-db');
    await register(email);

    // Defence in depth: even if the application check were bypassed, the
    // partial unique index on active users rejects the row.
    await expect(
      prisma.user.create({ data: { name: 'Impostor', email } }),
    ).rejects.toThrow();
  });

  it('sends the verification email to the address that registered', async () => {
    const email = uniqueEmail('sendsmail');
    await register(email);

    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.to).toBe(email);
    // The credential travels in its own field and never in the subject, which
    // is the part most likely to end up in a notification or a log line.
    expect(outbox[0]?.subject).not.toContain(otpIn(outbox[0])!);
  });
});

describe('sessions', () => {
  it('creates a database row on sign-in and resolves it back', async () => {
    const email = uniqueEmail('session');
    await register(email);

    const { token, cookiePair } = await signIn(email);
    expect(token).toBeTruthy();

    const row = await prisma.session.findUniqueOrThrow({ where: { token: token! } });
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const session = await auth.api.getSession({
      headers: headersWithSession(cookiePair),
    });
    expect(session?.user.email).toBe(email);
  });

  it('refuses a wrong password and creates no session', async () => {
    const email = uniqueEmail('wrongpw');
    const { user } = await register(email);

    await expect(signIn(email, 'definitely not it')).rejects.toThrow();

    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it('gives a customer the documented 30-day lifetime', async () => {
    const email = uniqueEmail('ttl-customer');
    await register(email);
    const { token } = await signIn(email);

    const row = await prisma.session.findUniqueOrThrow({ where: { token: token! } });
    const days = (row.expiresAt.getTime() - Date.now()) / 86_400_000;

    expect(days).toBeGreaterThan(29.5);
    expect(days).toBeLessThan(30.5);
  });

  it('clamps a staff or admin session to seven days', async () => {
    const email = uniqueEmail('ttl-admin');
    const { user } = await register(email);
    await prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });

    const { token } = await signIn(email);

    const row = await prisma.session.findUniqueOrThrow({ where: { token: token! } });
    const days = (row.expiresAt.getTime() - Date.now()) / 86_400_000;

    expect(days).toBeGreaterThan(6.5);
    expect(days).toBeLessThan(7.5);
  });

  it('treats an expired session as no session', async () => {
    const email = uniqueEmail('expired');
    await register(email);
    const { token, cookiePair } = await signIn(email);

    await prisma.session.update({
      where: { token: token! },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect(
      await auth.api.getSession({ headers: headersWithSession(cookiePair) }),
    ).toBeNull();
  });

  it('revokes instantly when the row is deleted', async () => {
    const email = uniqueEmail('revoke');
    await register(email);
    const { token, cookiePair } = await signIn(email);

    expect(
      await auth.api.getSession({ headers: headersWithSession(cookiePair) }),
    ).not.toBeNull();

    await prisma.session.delete({ where: { token: token! } });

    expect(
      await auth.api.getSession({ headers: headersWithSession(cookiePair) }),
    ).toBeNull();
  });

  it('deletes the row on sign-out rather than only clearing the cookie', async () => {
    const email = uniqueEmail('signout');
    await register(email);
    const { token, cookiePair } = await signIn(email);

    await auth.api.signOut({ headers: headersWithSession(cookiePair) });

    expect(await prisma.session.findUnique({ where: { token: token! } })).toBeNull();
  });
});

describe('email verification', () => {
  /**
   * Every registration in this file leaves an unconsumed verification row, so
   * the row-count assertions below are only meaningful against a clean table.
   */
  beforeEach(async () => {
    await prisma.verification.deleteMany();
  });

  /** The code from the most recent verification email. */
  function lastOtp(): string {
    const otp = otpIn(outbox.at(-1));
    if (!otp) throw new Error('no verification code was sent');
    return otp;
  }

  it('sends a one-time code on sign-up, and no link', async () => {
    await register(uniqueEmail('otp-sent'));

    expect(outbox).toHaveLength(1);
    // The regression guard for ADR-021: plugin options are merged with
    // `defu(userOptions, pluginOptions)`, so re-adding
    // `emailVerification.sendVerificationEmail` to the config would silently
    // win and restore the replayable JWT link. If that ever happens, `url` is
    // populated and `otp` is not, and this fails.
    expect(urlIn(outbox[0])).toBeUndefined();
    expect(otpIn(outbox[0])).toMatch(/^\d{8}$/);
  });

  it('verifies the address with the emailed code', async () => {
    const email = uniqueEmail('verify');
    const { user } = await register(email);

    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified,
    ).toBe(false);

    await auth.api.verifyEmailOTP({ body: { email, otp: lastOtp() } });

    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified,
    ).toBe(true);
  });

  it('rejects a replay of the same code — this is the Phase 3.1 finding', async () => {
    const verificationsBefore = await prisma.verification.count();

    const email = uniqueEmail('replay');
    const { user } = await register(email);
    const otp = lastOtp();

    await auth.api.verifyEmailOTP({ body: { email, otp } });

    // The row was consumed by the delete-on-read that verified it, and is not
    // recreated on success. A second presentation of the identical, still
    // unexpired code finds nothing.
    await expect(auth.api.verifyEmailOTP({ body: { email, otp } })).rejects.toThrow();

    // And the replay changed nothing: still verified once, still one user, no
    // session minted, no stray verification row left behind.
    //
    // A **delta**, not an absolute count. `verification.identifier` is hashed
    // (ADR-020), so a row cannot be matched back to an address, and an absolute
    // zero would be asserting that nothing anywhere else in the database has an
    // outstanding code — which a parallel suite, or a leftover from an
    // end-to-end run, makes false for reasons that have nothing to do with
    // replay.
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.emailVerified).toBe(true);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.verification.count()).toBe(verificationsBefore);
  });

  it('leaves the row consumed, so nothing is replayable from the table', async () => {
    const before = await prisma.verification.count();

    const email = uniqueEmail('consumed');
    await register(email);

    // One row appeared, and the verification consumed exactly it.
    expect(await prisma.verification.count()).toBe(before + 1);

    await auth.api.verifyEmailOTP({ body: { email, otp: lastOtp() } });

    expect(await prisma.verification.count()).toBe(before);
  });

  it('rejects an expired code, and does not verify the address', async () => {
    const email = uniqueEmail('expired-otp');
    const { user } = await register(email);
    const otp = lastOtp();

    await prisma.verification.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(auth.api.verifyEmailOTP({ body: { email, otp } })).rejects.toThrow();

    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified,
    ).toBe(false);
  });

  it('rejects a wrong code without verifying the address', async () => {
    const email = uniqueEmail('wrong-otp');
    const { user } = await register(email);
    const otp = lastOtp();

    const wrong = otp === '00000000' ? '11111111' : '00000000';
    await expect(
      auth.api.verifyEmailOTP({ body: { email, otp: wrong } }),
    ).rejects.toThrow();

    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified,
    ).toBe(false);

    // A wrong guess costs an attempt but must not burn the real code.
    await auth.api.verifyEmailOTP({ body: { email, otp } });
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified,
    ).toBe(true);
  });

  it('locks the code out after three failed attempts', async () => {
    const email = uniqueEmail('attempts');
    const { user } = await register(email);
    const otp = lastOtp();
    const wrong = otp === '00000000' ? '11111111' : '00000000';

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(
        auth.api.verifyEmailOTP({ body: { email, otp: wrong } }),
      ).rejects.toThrow();
    }

    // The budget is spent, so even the correct code is refused: the row is
    // left consumed rather than recreated, which locks the identifier out.
    await expect(auth.api.verifyEmailOTP({ body: { email, otp } })).rejects.toThrow();

    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified,
    ).toBe(false);
  });

  it('stores the code encrypted, so the table does not carry a usable credential', async () => {
    const email = uniqueEmail('otp-at-rest');
    await register(email);
    const otp = lastOtp();

    const rows = await prisma.verification.findMany();
    expect(rows).toHaveLength(1);

    const row = rows[0]!;
    // Neither the code nor the address it belongs to is readable. The
    // identifier is hashed by `storeIdentifier`, the value encrypted under
    // BETTER_AUTH_SECRET by `storeOTP` (ADR-021).
    expect(row.value).not.toContain(otp);
    expect(row.identifier).not.toContain(otp);
    expect(row.identifier).not.toContain(email);
    expect(row.value.length).toBeGreaterThan(otp.length);
  });

  it('is the only verification mechanism — the JWT link path issues nothing', async () => {
    const email = uniqueEmail('no-jwt');
    await register(email);

    // Nothing in the flow hands out a link any more, so a plausible-looking
    // JWT must not verify anybody.
    await expect(
      auth.api.verifyEmail({ query: { token: 'not.a.valid-jwt' } }),
    ).rejects.toThrow();

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.emailVerified).toBe(false);
  });
});
describe('password reset', () => {
  async function requestReset(email: string) {
    await auth.api.requestPasswordReset({ body: { email, redirectTo: '/reset' } });
    const link = urlIn(outbox.at(-1));
    return link ? /reset-password\/([^?]+)/.exec(link)?.[1] : undefined;
  }

  it('hashes the reset token at rest, so the stored row is not a usable credential', async () => {
    const email = uniqueEmail('reset-hash');
    await register(email);

    const token = await requestReset(email);
    expect(token).toBeTruthy();

    const rows = await prisma.verification.findMany({
      where: { identifier: { contains: 'reset-password' } },
    });

    // The identifier is stored as a SHA-256 digest, so neither the literal
    // prefix nor the token appears in the table (ADR-020).
    expect(rows).toHaveLength(0);

    const all = await prisma.verification.findMany();
    expect(all.some((row) => row.identifier.includes(token!))).toBe(false);
  });

  it('sets a new Argon2id password and lets it sign in', async () => {
    const email = uniqueEmail('reset-ok');
    await register(email);
    const token = await requestReset(email);

    const newPassword = 'a completely different passphrase';
    await auth.api.resetPassword({ body: { token: token!, newPassword } });

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const account = await prisma.account.findFirstOrThrow({ where: { userId: user.id } });

    expect(account.password?.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword({ hash: account.password!, password: newPassword })).toBe(
      true,
    );

    const { token: sessionToken } = await signIn(email, newPassword);
    expect(sessionToken).toBeTruthy();
  });

  it('cannot reuse a reset token — consumption is atomic and single-use', async () => {
    const email = uniqueEmail('reset-reuse');
    await register(email);
    const token = await requestReset(email);

    await auth.api.resetPassword({
      body: { token: token!, newPassword: 'first replacement pw' },
    });

    await expect(
      auth.api.resetPassword({
        body: { token: token!, newPassword: 'second replacement pw' },
      }),
    ).rejects.toThrow();
  });

  it('rejects an expired reset token, and does not leave it replayable', async () => {
    const email = uniqueEmail('reset-expired');
    await register(email);
    const token = await requestReset(email);

    await prisma.verification.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(
      auth.api.resetPassword({
        body: { token: token!, newPassword: 'should not apply' },
      }),
    ).rejects.toThrow();

    // The original password still works, so the failed reset changed nothing.
    const { token: sessionToken } = await signIn(email);
    expect(sessionToken).toBeTruthy();
  });

  it('answers identically for an unknown address, so reset does not enumerate users', async () => {
    const result = await auth.api.requestPasswordReset({
      body: { email: uniqueEmail('nobody'), redirectTo: '/reset' },
    });

    expect(result.status).toBe(true);
    expect(outbox).toHaveLength(0);
  });
});

describe('security posture', () => {
  it('never returns the password hash or session token in an API response', async () => {
    const email = uniqueEmail('leak');
    await register(email);
    const { cookiePair, response } = await signIn(email);

    const signInBody = JSON.stringify(response);
    expect(signInBody).not.toContain('$argon2id$');
    expect(signInBody).not.toContain(PASSWORD);

    const session = await auth.api.getSession({
      headers: headersWithSession(cookiePair),
    });
    const sessionBody = JSON.stringify(session?.user);

    expect(sessionBody).not.toContain('$argon2id$');
    expect(sessionBody).not.toContain('password');
  });

  it('sets HttpOnly, SameSite=Lax and a path on the session cookie', async () => {
    const email = uniqueEmail('cookie');
    await register(email);
    const { setCookie } = await signIn(email);

    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
  });

  it('does not create a Better Auth user for a guest order', async () => {
    // Guests carry contact details on the order and an opaque guest token;
    // no user row is created for them (docs/DATABASE.md section 4).
    //
    // The evidence is the schema, not a row count: this test creates no order
    // and no user, and counting every user in the database would only assert
    // that no *other* suite created one while it ran.
    const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'orders'
        AND column_name IN ('guest_token', 'contact_email', 'user_id')
    `;
    expect(columns).toHaveLength(3);

    const userId = await prisma.$queryRaw<Array<{ is_nullable: string }>>`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'user_id'
    `;
    // Nullable is what makes a guest order possible without a fake user.
    expect(userId[0]?.is_nullable).toBe('YES');

    // And no guest order anywhere carries a user: the two are exclusive.
    expect(
      await prisma.order.count({
        where: { guestToken: { not: null }, userId: { not: null } },
      }),
    ).toBe(0);
  });
});
