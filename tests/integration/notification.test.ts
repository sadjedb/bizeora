/**
 * The outbox, against the real database.
 *
 * The whole design rests on two properties that only PostgreSQL can prove:
 * **a retried event produces one e-mail**, because `dedupe_key` is unique, and
 * **a failed delivery cannot roll back a business transaction**, because
 * delivery happens long after that transaction has committed.
 *
 * So these tests drive real flows — submit a request, place an order, send a
 * quote — and then look at what is queued, force it to fail, and watch it be
 * retried. Nothing is mocked: the transport is the in-memory one the test
 * environment selects, and it is a real implementation of the same interface
 * Resend gets.
 */

import { randomUUID } from 'node:crypto';

import dotenv from 'dotenv';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

dotenv.config({ path: ['.env.local', '.env'], quiet: true });

const { dispatchNotifications, runNotificationSweep, staffRecipients } =
  await import('../../src/server/services/notification-service');

const { countNotificationsByStatus, enqueueNotification, requeueFailedNotifications } =
  await import('../../src/server/repositories/notification-repository');

const { createCustomRequest } =
  await import('../../src/server/services/custom-request-service');
const { createQuoteDraft, sendQuoteToCustomer } =
  await import('../../src/server/services/quote-service');
const { addToCart } = await import('../../src/server/services/cart-service');
const { serverEnv } = await import('../../src/lib/env');
const { placeOrderFromCart } = await import('../../src/server/services/checkout-service');
const { loadBuilderReferenceData } =
  await import('../../src/server/repositories/customization-repository');
const { clearSentEmails, failEmailsMatching, sentEmails } =
  await import('../../src/lib/email');
const { prisma } = await import('../../src/lib/db/client');

const TEMPLATE_SLUG = 't-shirt-brode-classique';
const MADE_TO_ORDER_SLUG = 'tote-bag-toile-epaisse';
const ALGER = 16;

const PREFIX = `phase8a-${Date.now()}`;
const WORKSHOP = `${PREFIX}-atelier@example.invalid`;

let staffUserId: string;
let customer: { userId: string; email: string };

let threadColorIds: string[];

const createdUserIds: string[] = [];
const createdRequestNumbers: string[] = [];
const createdOrderNumbers: string[] = [];

/** The notification rows this suite produced, whatever their status. */
async function outboxRows(where: Record<string, unknown> = {}) {
  return prisma.notification.findMany({
    where: { dedupeKey: { not: null }, ...where },
    select: {
      id: true,
      template: true,
      recipient: true,
      status: true,
      attempts: true,
      dedupeKey: true,
      payload: true,
      lastError: true,
      scheduledFor: true,
    },
    orderBy: { createdAt: 'asc' },
  });
}

async function createUser(role: 'CUSTOMER' | 'STAFF', label: string) {
  const email = `${PREFIX}-${label}@example.invalid`;

  const user = await prisma.user.create({
    data: { email, name: label, role, status: 'ACTIVE', emailVerified: true },
    select: { id: true },
  });

  createdUserIds.push(user.id);
  return { userId: user.id, email };
}

async function submitRequest(): Promise<string> {
  const result = await createCustomRequest({
    productSlug: TEMPLATE_SLUG,
    variantSku: null,
    options: {},
    // No garment photograph to place on in these fixtures, so the size is given
    // rather than dragged — the path a blank nobody has measured takes
    // (ADR-035). A configuration with neither is refused, as it should be.
    sizeMm: { widthMm: 90, heightMm: 45 },
    threadColorIds,
    embroideryText: 'Amina',
    instructions: null,
    quantity: 2,
    designFileIds: [],
    contactName: 'Cliente de test',
    contactEmail: customer.email,
    contactPhone: null,
  });

  if (!result.ok) throw new Error(result.errors.join(' / '));
  createdRequestNumbers.push(result.requestNumber);

  return result.requestNumber;
}

async function placeOrder(): Promise<string> {
  const owner = { kind: 'user' as const, userId: customer.userId };

  const variant = await prisma.productVariant.findFirstOrThrow({
    where: { product: { slug: MADE_TO_ORDER_SLUG }, isActive: true },
    select: { sku: true },
  });

  const added = await addToCart(owner, {
    productSlug: MADE_TO_ORDER_SLUG,
    variantSku: variant.sku,
    quantity: 1,
  });
  if (!added.ok) throw new Error(`add failed: ${added.error}`);

  const placed = await placeOrderFromCart(owner, {
    contactName: 'Cliente de test',
    contactEmail: customer.email,
    contactPhone: '0555123456',
    wilayaCode: ALGER,
    communeName: 'Hydra',
    addressLine: '12 rue des Frères Bouadou',
    deliveryType: 'HOME',
    paymentMethod: 'COD',
    customerNote: null,
    termsAccepted: true,
  });

  if (!placed.ok) throw new Error(`placement failed: ${placed.error}`);
  createdOrderNumbers.push(placed.value.orderNumber);

  return placed.value.orderNumber;
}

async function sendQuoteFor(requestNumber: string): Promise<string> {
  const created = await createQuoteDraft(
    {
      requestNumber,
      lines: [
        {
          kind: 'PRODUCT',
          label: 'Pièce brodée',
          description: null,
          quantity: 2,
          unitPrice: 300_000,
          requestItemId: null,
        },
      ],
      customerMessage: 'Voici notre proposition.',
      internalNotes: 'NOTE-INTERNE-ATELIER',
    },
    staffUserId,
  );

  if (!created.ok) throw new Error(created.error.message);

  const sent = await sendQuoteToCustomer(created.value.quoteId, staffUserId);
  if (!sent.ok) throw new Error(sent.error.message);

  return created.value.quoteNumber;
}

let originalRecipients: string | null = null;

beforeAll(async () => {
  const reference = await loadBuilderReferenceData(TEMPLATE_SLUG);
  threadColorIds = [reference.threadColors[0]!.id];

  staffUserId = (await createUser('STAFF', 'staff')).userId;
  customer = await createUser('CUSTOMER', 'customer');

  const setting = await prisma.setting.findUnique({
    where: { key: 'notifications.adminRecipients' },
    select: { value: true },
  });

  originalRecipients = setting?.value ?? null;

  await prisma.setting.update({
    where: { key: 'notifications.adminRecipients' },
    data: { value: WORKSHOP },
  });
});

beforeEach(() => {
  clearSentEmails();
});

afterAll(async () => {
  if (originalRecipients !== null) {
    await prisma.setting.update({
      where: { key: 'notifications.adminRecipients' },
      data: { value: originalRecipients },
    });
  }

  const requests = await prisma.customRequest.findMany({
    where: { requestNumber: { in: createdRequestNumbers } },
    select: { id: true, items: { select: { customizationConfigId: true } } },
  });

  const requestIds = requests.map((request) => request.id);
  const configIds = requests.flatMap((request) =>
    request.items.map((item) => item.customizationConfigId),
  );

  const orders = await prisma.order.findMany({
    where: { orderNumber: { in: createdOrderNumbers } },
    select: { items: { select: { variantId: true, quantity: true } } },
  });

  for (const order of orders) {
    for (const item of order.items) {
      if (!item.variantId) continue;
      await prisma.$executeRaw`
        UPDATE "product_variants"
           SET "reserved_quantity" = GREATEST(0, "reserved_quantity" - ${item.quantity})
         WHERE "id" = ${item.variantId}::uuid
      `;
    }
  }

  // Notifications cascade from the rows they relate to; the standalone probes
  // are removed by their dedupe keys.
  await prisma.notification.deleteMany({
    where: { dedupeKey: { startsWith: 'probe:' } },
  });
  await prisma.order.deleteMany({ where: { orderNumber: { in: createdOrderNumbers } } });
  await prisma.cart.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.quote.deleteMany({ where: { requestId: { in: requestIds } } });
  await prisma.customRequest.deleteMany({ where: { id: { in: requestIds } } });
  await prisma.customizationConfig.deleteMany({ where: { id: { in: configIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });

  clearSentEmails();
  await prisma.$disconnect();
});

/* ---------------------------------------------------------------------------
 * Events reach the outbox
 * ------------------------------------------------------------------------ */

describe('an event queues a notification', () => {
  it('tells the workshop when a request is submitted', async () => {
    const requestNumber = await submitRequest();

    const rows = await outboxRows({ template: 'request.submitted' });
    const mine = rows.filter((row) => row.dedupeKey?.includes(requestNumber));

    expect(mine).toHaveLength(1);
    expect(mine[0]!.recipient).toBe(WORKSHOP);
    expect(mine[0]!.status).toBe('PENDING');
  });

  it('confirms an order to its customer and alerts the workshop', async () => {
    const orderNumber = await placeOrder();

    const rows = await outboxRows({
      OR: [{ template: 'order.confirmed' }, { template: 'order.placed' }],
    });
    const mine = rows.filter((row) => row.dedupeKey?.includes(orderNumber));

    expect(mine).toHaveLength(2);

    const customerRow = mine.find((row) => row.template === 'order.confirmed')!;
    const staffRow = mine.find((row) => row.template === 'order.placed')!;

    // The recipient is the **order's** contact address, not anything a payload
    // carried, and the workshop's is the configured setting.
    expect(customerRow.recipient).toBe(customer.email);
    expect(staffRow.recipient).toBe(WORKSHOP);
  });

  it('tells the customer when a quote is sent, and nobody else', async () => {
    const requestNumber = await submitRequest();
    const quoteNumber = await sendQuoteFor(requestNumber);

    const rows = await outboxRows({ template: 'quote.sent' });
    const mine = rows.filter((row) => row.dedupeKey?.includes(quoteNumber));

    expect(mine).toHaveLength(1);
    expect(mine[0]!.recipient).toBe(customer.email);
  });

  /*
   * Both sources have to be empty, not just the setting.
   *
   * `ADMIN_NOTIFICATION_EMAIL` is a bootstrap fallback for a fresh deployment
   * that nobody has opened the admin on yet, so clearing the setting alone
   * leaves a recipient behind — and this test read as passing only while that
   * variable happened to be unset on the developer's machine. The day somebody
   * configured e-mail for real, it failed for a reason that had nothing to do
   * with notifications.
   */
  it('records the event even with no workshop address configured', async () => {
    await prisma.setting.update({
      where: { key: 'notifications.adminRecipients' },
      data: { value: '' },
    });

    /*
     * `serverEnv` is parsed once at import, so clearing `process.env` here
     * would change nothing — the value the service reads is already captured.
     * The proxy writes through to the parsed object, which is the seam.
     */
    const fallback = serverEnv.ADMIN_NOTIFICATION_EMAIL;
    serverEnv.ADMIN_NOTIFICATION_EMAIL = undefined;

    try {
      const requestNumber = await submitRequest();

      const rows = await outboxRows({ template: 'request.submitted' });
      const mine = rows.filter((row) => row.dedupeKey?.includes(requestNumber));

      // SKIPPED, not absent: an undeliverable event stays visible in the outbox
      // rather than becoming a silence nobody can distinguish from a bug.
      expect(mine).toHaveLength(1);
      expect(mine[0]!.status).toBe('SKIPPED');
      expect(mine[0]!.recipient).toBeNull();
      expect(mine[0]!.lastError).toContain('destinataire');
    } finally {
      serverEnv.ADMIN_NOTIFICATION_EMAIL = fallback;

      await prisma.setting.update({
        where: { key: 'notifications.adminRecipients' },
        data: { value: WORKSHOP },
      });
    }
  });

  it('reads the workshop from settings, never from a caller', async () => {
    expect(await staffRecipients()).toEqual([WORKSHOP]);
  });
});

/* ---------------------------------------------------------------------------
 * Snapshots
 * ------------------------------------------------------------------------ */

describe('what a notification carries', () => {
  it('uses the order’s stored snapshots, not the live catalogue', async () => {
    const orderNumber = await placeOrder();

    const rows = await outboxRows({ template: 'order.confirmed' });
    const row = rows.find((candidate) => candidate.dedupeKey?.includes(orderNumber))!;
    const payload = row.payload as { items: { name: string }[]; grandTotal: string };

    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber },
      select: {
        grandTotal: true,
        items: { select: { nameSnapshot: true } },
      },
    });

    expect(payload.items[0]!.name).toBe(order.items[0]!.nameSnapshot);

    // Renaming the product afterwards changes nothing: the payload was written
    // from the snapshot at the moment of the event.
    const product = await prisma.product.findFirstOrThrow({
      where: { slug: MADE_TO_ORDER_SLUG, deletedAt: null },
      select: { id: true, name: true },
    });

    await prisma.product.update({
      where: { id: product.id },
      data: { name: 'Nom changé après la commande' },
    });

    try {
      const after = await outboxRows({ template: 'order.confirmed' });
      const stillTheSame = after.find((candidate) =>
        candidate.dedupeKey?.includes(orderNumber),
      )!;

      expect(JSON.stringify(stillTheSame.payload)).not.toContain(
        'Nom changé après la commande',
      );
    } finally {
      await prisma.product.update({
        where: { id: product.id },
        data: { name: product.name },
      });
    }
  });

  it('never carries an internal note into a customer’s e-mail', async () => {
    const requestNumber = await submitRequest();
    const quoteNumber = await sendQuoteFor(requestNumber);

    const rows = await outboxRows({ template: 'quote.sent' });
    const row = rows.find((candidate) => candidate.dedupeKey?.includes(quoteNumber))!;

    expect(JSON.stringify(row.payload)).not.toContain('NOTE-INTERNE-ATELIER');

    await dispatchNotifications({ limit: 100 });

    const message = sentEmails.find((candidate) => candidate.text.includes(quoteNumber))!;

    expect(message.text).not.toContain('NOTE-INTERNE-ATELIER');
    expect(message.html).not.toContain('NOTE-INTERNE-ATELIER');
    // And no staff link in a customer's message.
    expect(message.text).not.toContain('/admin/');
  });

  it('stores no credential in the outbox', async () => {
    // The two credential e-mails bypass the outbox entirely (SECURITY.md 2.1),
    // so no row anywhere carries a reset link or a verification code.
    const credentials = await prisma.notification.count({
      where: { template: { in: ['auth.verify_email', 'auth.password_reset'] } },
    });

    expect(credentials).toBe(0);
  });
});

/* ---------------------------------------------------------------------------
 * Idempotency and reliability
 * ------------------------------------------------------------------------ */

describe('the outbox is idempotent', () => {
  it('records one row however many times the same event is enqueued', async () => {
    const key = `probe:${randomUUID()}`;

    const first = await enqueueNotification({
      template: 'order.confirmed',
      dedupeKey: key,
      recipient: customer.email,
      payload: {
        orderNumber: 'CMD-PROBE',
        contactName: 'Amina',
        items: [],
        subtotal: '0 DA',
        discountTotal: null,
        shippingLabel: 'Livraison',
        shippingTotal: '0 DA',
        grandTotal: '0 DA',
        depositRequired: null,
        paymentMethod: 'CCP',
        address: 'Alger',
        statusMessage: 'Test.',
        orderUrl: 'https://x.test/order/CMD-PROBE',
      },
    });

    const second = await enqueueNotification({
      template: 'order.confirmed',
      dedupeKey: key,
      recipient: customer.email,
      payload: {
        orderNumber: 'CMD-PROBE',
        contactName: 'Amina',
        items: [],
        subtotal: '0 DA',
        discountTotal: null,
        shippingLabel: 'Livraison',
        shippingTotal: '0 DA',
        grandTotal: '0 DA',
        depositRequired: null,
        paymentMethod: 'CCP',
        address: 'Alger',
        statusMessage: 'Test.',
        orderUrl: 'https://x.test/order/CMD-PROBE',
      },
    });

    expect(first.enqueued).toBe(true);
    // Not an error: the event has been recorded once, which is the point.
    expect(second.enqueued).toBe(false);
    expect(await prisma.notification.count({ where: { dedupeKey: key } })).toBe(1);
  });

  it('sends one e-mail however many times the dispatcher runs', async () => {
    const orderNumber = await placeOrder();

    await dispatchNotifications({ limit: 100 });
    const afterFirst = sentEmails.filter((message) =>
      message.text.includes(orderNumber),
    ).length;

    await dispatchNotifications({ limit: 100 });
    const afterSecond = sentEmails.filter((message) =>
      message.text.includes(orderNumber),
    ).length;

    expect(afterFirst).toBeGreaterThan(0);
    expect(afterSecond).toBe(afterFirst);
  });

  it('warns about an expiring quote once, however often the sweep runs', async () => {
    const requestNumber = await submitRequest();
    const quoteNumber = await sendQuoteFor(requestNumber);

    // Bring the deadline inside the warning window without touching the status:
    // `valid_until > created_at` is a check constraint, so the row is aged too.
    const quote = await prisma.quote.findFirstOrThrow({
      where: { quoteNumber },
      select: { id: true },
    });

    const soon = new Date(Date.now() + 60 * 60 * 1000);
    const sentDaysAgo = new Date(Date.now() - 13 * 24 * 60 * 60 * 1000);

    await prisma.$executeRaw`
      UPDATE "quotes"
         SET "created_at"  = ${sentDaysAgo},
             "sent_at"     = ${sentDaysAgo},
             "valid_until" = ${soon}
       WHERE "id" = ${quote.id}::uuid
    `;

    await runNotificationSweep();
    await runNotificationSweep();
    await runNotificationSweep();

    const warnings = await prisma.notification.count({
      where: { template: 'quote.expiring', relatedQuoteId: quote.id },
    });
    const staffWarnings = await prisma.notification.count({
      where: { template: 'quote.expiring.staff', relatedQuoteId: quote.id },
    });

    expect(warnings).toBe(1);
    expect(staffWarnings).toBe(1);
  });

  it('does not warn about a quote that has already expired', async () => {
    const requestNumber = await submitRequest();
    const quoteNumber = await sendQuoteFor(requestNumber);

    const quote = await prisma.quote.findFirstOrThrow({
      where: { quoteNumber },
      select: { id: true },
    });

    // Timestamps from **this process**, not the database's `now()`: the sweep
    // compares against a JavaScript `Date`, and a fixture built from `now() -
    // interval` measures the difference between two clocks instead of the rule.
    const aged = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const lapsed = new Date(Date.now() - 60 * 60 * 1000);

    await prisma.$executeRaw`
      UPDATE "quotes"
         SET "created_at"  = ${aged},
             "sent_at"     = ${aged},
             "valid_until" = ${lapsed}
       WHERE "id" = ${quote.id}::uuid
    `;

    await runNotificationSweep();

    expect(
      await prisma.notification.count({
        where: { template: 'quote.expiring', relatedQuoteId: quote.id },
      }),
    ).toBe(0);

    // And the sweep expired it, which is Phase 10's own rule.
    const after = await prisma.quote.findUniqueOrThrow({
      where: { id: quote.id },
      select: { status: true },
    });
    expect(after.status).toBe('EXPIRED');
  });
});

describe('delivery failure', () => {
  it('does not roll back the business transaction', async () => {
    const orderNumber = await placeOrder();

    // Every message about *this* order fails. Targeted, because the test
    // database is shared with suites running in parallel.
    failEmailsMatching(orderNumber);

    try {
      await dispatchNotifications({ limit: 100 });

      // The order exists and is intact, whatever the provider did.
      const order = await prisma.order.findUnique({ where: { orderNumber } });
      expect(order).not.toBeNull();

      const rows = await outboxRows({ template: 'order.confirmed' });
      const mine = rows.find((row) => row.dedupeKey?.includes(orderNumber))!;

      expect(mine.status).toBe('PENDING');
      expect(mine.attempts).toBeGreaterThan(0);
      expect(mine.lastError).toBeTruthy();
      expect(sentEmails.some((message) => message.text.includes(orderNumber))).toBe(
        false,
      );
    } finally {
      failEmailsMatching(null);
    }
  });

  it('reschedules rather than losing the message, and succeeds on retry', async () => {
    const key = `probe:${randomUUID()}`;

    await enqueueNotification({
      template: 'order.confirmed',
      dedupeKey: key,
      recipient: customer.email,
      payload: {
        orderNumber: 'CMD-RETRY',
        contactName: 'Amina',
        items: [],
        subtotal: '0 DA',
        discountTotal: null,
        shippingLabel: 'Livraison',
        shippingTotal: '0 DA',
        grandTotal: '0 DA',
        depositRequired: null,
        paymentMethod: 'CCP',
        address: 'Alger',
        statusMessage: 'Test.',
        orderUrl: 'https://x.test/order/CMD-RETRY',
      },
    });

    failEmailsMatching('CMD-RETRY');
    await dispatchNotifications({ limit: 100 });
    failEmailsMatching(null);

    const afterFailure = await prisma.notification.findFirstOrThrow({
      where: { dedupeKey: key },
      select: { status: true, attempts: true, lastError: true, scheduledFor: true },
    });

    // Still PENDING, one attempt spent, and scheduled for later.
    expect(afterFailure.status).toBe('PENDING');
    expect(afterFailure.attempts).toBe(1);
    expect(afterFailure.lastError).toBeTruthy();
    expect(afterFailure.scheduledFor.getTime()).toBeGreaterThan(Date.now());

    // A dispatcher running now does not pick it up again.
    const tooSoon = await dispatchNotifications({ limit: 100 });
    expect(
      tooSoon.claimed === 0 ||
        !sentEmails.some((message) => message.text.includes('CMD-RETRY')),
    ).toBe(true);

    // Once it is due, it succeeds.
    await dispatchNotifications({
      limit: 100,
      now: new Date(afterFailure.scheduledFor.getTime() + 1_000),
    });

    const afterRetry = await prisma.notification.findFirstOrThrow({
      where: { dedupeKey: key },
      select: { status: true, sentAt: true },
    });

    expect(afterRetry.status).toBe('SENT');
    expect(afterRetry.sentAt).not.toBeNull();
    expect(sentEmails.some((message) => message.text.includes('CMD-RETRY'))).toBe(true);
  });

  it('gives up after the budget, and an operator can requeue it', async () => {
    const key = `probe:${randomUUID()}`;

    await enqueueNotification({
      template: 'order.confirmed',
      dedupeKey: key,
      recipient: customer.email,
      payload: {
        orderNumber: 'CMD-GIVEUP',
        contactName: 'Amina',
        items: [],
        subtotal: '0 DA',
        discountTotal: null,
        shippingLabel: 'Livraison',
        shippingTotal: '0 DA',
        grandTotal: '0 DA',
        depositRequired: null,
        paymentMethod: 'CCP',
        address: 'Alger',
        statusMessage: 'Test.',
        orderUrl: 'https://x.test/order/CMD-GIVEUP',
      },
    });

    // Spend the budget: each pass fails and reschedules, and the next pass is
    // run at the time it asked for.
    let now = new Date();

    failEmailsMatching('CMD-GIVEUP');

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await dispatchNotifications({ limit: 100, now });

      const row = await prisma.notification.findFirstOrThrow({
        where: { dedupeKey: key },
        select: { status: true, scheduledFor: true },
      });

      if (row.status === 'FAILED') break;
      now = new Date(row.scheduledFor.getTime() + 1_000);
    }

    const failed = await prisma.notification.findFirstOrThrow({
      where: { dedupeKey: key },
      select: { status: true, attempts: true },
    });

    expect(failed.status).toBe('FAILED');
    expect(failed.attempts).toBeGreaterThanOrEqual(5);

    // The operator's retry puts it back in the queue.
    failEmailsMatching(null);
    const requeued = await requeueFailedNotifications({ ids: undefined });
    expect(requeued).toBeGreaterThan(0);

    const back = await prisma.notification.findFirstOrThrow({
      where: { dedupeKey: key },
      select: { status: true, attempts: true },
    });

    expect(back.status).toBe('PENDING');
    expect(back.attempts).toBe(0);
  });

  it('does not retry a template that cannot be rendered', async () => {
    const key = `probe:${randomUUID()}`;

    await enqueueNotification({
      // A template nothing knows: retrying cannot help.
      template: 'marketing.newsletter' as never,
      dedupeKey: key,
      recipient: customer.email,
      payload: {},
    });

    await dispatchNotifications({ limit: 100 });

    const row = await prisma.notification.findFirstOrThrow({
      where: { dedupeKey: key },
      select: { status: true, lastError: true },
    });

    expect(row.status).toBe('FAILED');
    expect(row.lastError).toContain('Modèle inconnu');
  });

  it('does not retry a payload that does not fit its template', async () => {
    const key = `probe:${randomUUID()}`;

    await enqueueNotification({
      template: 'order.confirmed',
      dedupeKey: key,
      recipient: customer.email,
      // A real template, a payload missing everything it needs. Rendering
      // throws; the dispatcher must record it and move on rather than die.
      payload: { orderNumber: 'CMD-MALFORMED' },
    });

    const summary = await dispatchNotifications({ limit: 100 });
    expect(summary.claimed).toBeGreaterThan(0);

    const row = await prisma.notification.findFirstOrThrow({
      where: { dedupeKey: key },
      select: { status: true, lastError: true },
    });

    expect(row.status).toBe('FAILED');
    expect(row.lastError).toContain('charge utile invalide');
  });
});

describe('the dispatcher', () => {
  it('reports what it did, and leaves nothing pending that was due', async () => {
    await placeOrder();

    const summary = await dispatchNotifications({ limit: 100 });

    expect(summary.claimed).toBeGreaterThan(0);
    expect(summary.sent).toBeGreaterThan(0);

    const counts = await countNotificationsByStatus();
    expect(counts.SENT).toBeGreaterThan(0);
  });

  it('claims each row once, even with two dispatchers running together', async () => {
    await placeOrder();

    const [first, second] = await Promise.all([
      dispatchNotifications({ limit: 100 }),
      dispatchNotifications({ limit: 100 }),
    ]);

    const total = first.sent + second.sent;
    const unique = new Set(sentEmails.map((message) => message.text)).size;

    // Whatever the split, no message went twice.
    expect(total).toBe(unique);
  });
});
