/**
 * The admin workspace, against the real database.
 *
 * Two questions run through every test here. **Can a customer reach any of
 * this?** — and **can anything a browser sends move money or skip a step?**
 *
 * The transitions and the payment writes cannot be tested any other way than
 * against PostgreSQL: the conditional claim that makes two admins pressing two
 * buttons safe, the stock reservation that follows a confirmation, the release
 * that follows a cancellation, and the check constraints that catch a bad
 * payment row are all database behaviour. A mock cannot have a race.
 */

import { randomUUID } from 'node:crypto';

import dotenv from 'dotenv';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

dotenv.config({ path: ['.env.local', '.env'], quiet: true });

const {
  getOrderQueue,
  getOrderWorkspace,
  recordPaymentAsStaff,
  reviewProofAsStaff,
  saveOrderInternalNotes,
  submitPaymentProof,
  transitionOrderAsStaff,
} = await import('../../src/server/services/order-admin-service');

const { getAdminDashboard } =
  await import('../../src/server/services/admin-dashboard-service');
const { getCustomerOrder } = await import('../../src/server/services/account-service');
const { authoriseUpload, finaliseUpload, getPaymentProofAccess } =
  await import('../../src/server/services/design-file-service');
const { createCustomRequest } =
  await import('../../src/server/services/custom-request-service');
const { addToCart } = await import('../../src/server/services/cart-service');
const { placeOrderFromCart } = await import('../../src/server/services/checkout-service');
const { findProofForOwner } =
  await import('../../src/server/repositories/order-repository');
const { listCustomersForStaff, findCustomerForStaff } =
  await import('../../src/server/repositories/user-repository');
const { listRequestsForStaff } =
  await import('../../src/server/repositories/request-repository');
const { loadBuilderReferenceData } =
  await import('../../src/server/repositories/customization-repository');
const storageRoute = await import('../../src/app/api/storage/local/route');
const { prisma } = await import('../../src/lib/db/client');

const TEMPLATE_SLUG = 't-shirt-brode-classique';
const MADE_TO_ORDER_SLUG = 'tote-bag-toile-epaisse';
const ALGER = 16;

const PREFIX = `phase12-${Date.now()}`;

let staffUserId: string;
let adminUserId: string;
let customer: { userId: string; email: string };
let stranger: { userId: string; email: string };

/** A tracked fixture this suite owns, so reservations are its own to move. */
let trackedProductId: string;
let trackedSlug: string;
let trackedSku: string;
let trackedVariantId: string;

let threadColorIds: string[];

const createdUserIds: string[] = [];
const createdOrderNumbers: string[] = [];
const createdRequestNumbers: string[] = [];
const createdFileIds: string[] = [];

async function createUser(role: 'CUSTOMER' | 'STAFF' | 'ADMIN', label: string) {
  const email = `${PREFIX}-${label}@example.invalid`;

  const user = await prisma.user.create({
    data: { email, name: label, role, status: 'ACTIVE', emailVerified: true },
    select: { id: true },
  });

  createdUserIds.push(user.id);
  return { userId: user.id, email };
}

async function purgeStaleFixtures(): Promise<void> {
  const stale = await prisma.product.findMany({
    where: { slug: { startsWith: 'test-admin-' } },
    select: { id: true },
  });

  if (stale.length === 0) return;
  const ids = stale.map((product) => product.id);

  await prisma.orderItem.deleteMany({ where: { productId: { in: ids } } });
  await prisma.cartItem.deleteMany({ where: { productId: { in: ids } } });
  await prisma.customizationConfig.deleteMany({ where: { productId: { in: ids } } });
  await prisma.productVariant.deleteMany({ where: { productId: { in: ids } } });
  await prisma.product.deleteMany({ where: { id: { in: ids } } });
}

/**
 * An order placed by the customer, through the real Phase 8 path.
 *
 * `tracked` decides which fixture is bought: the tracked one when a test is
 * about reservations, and the seeded made-to-order tote otherwise, so nothing
 * that is not about stock can run out of it.
 */
async function placeOrder(options: { tracked?: boolean } = {}): Promise<string> {
  const owner = { kind: 'user' as const, userId: customer.userId };

  const slug = options.tracked ? trackedSlug : MADE_TO_ORDER_SLUG;
  const sku = options.tracked
    ? trackedSku
    : (
        await prisma.productVariant.findFirstOrThrow({
          where: { product: { slug: MADE_TO_ORDER_SLUG }, isActive: true },
          select: { sku: true },
        })
      ).sku;

  const added = await addToCart(owner, {
    productSlug: slug,
    variantSku: sku,
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

/**
 * An order awaiting a deposit.
 *
 * 8.2 puts an order in `AWAITING_PAYMENT` when a deposit is outstanding, and
 * only a custom line carries one — so the order is placed normally and then
 * given the deposit and the entry status the deposit implies. What is under
 * test is the admin flow out of that state, not how it is entered, which Phase
 * 8's own suite covers.
 */
async function orderAwaitingDeposit(): Promise<string> {
  const orderNumber = await placeOrder({ tracked: true });

  await prisma.order.update({
    where: { orderNumber },
    data: { status: 'AWAITING_PAYMENT', depositRequired: 20_000 },
  });

  const order = await prisma.order.findUniqueOrThrow({
    where: { orderNumber },
    select: { id: true, items: { select: { variantId: true, quantity: true } } },
  });

  // Placement reserved for AWAITING_CONFIRMATION; an AWAITING_PAYMENT order
  // holds nothing (8.10.3), so the fixture releases what placement took and
  // rewrites the entry history to match.
  for (const item of order.items) {
    if (!item.variantId) continue;
    await prisma.$executeRaw`
      UPDATE "product_variants"
         SET "reserved_quantity" = GREATEST(0, "reserved_quantity" - ${item.quantity})
       WHERE "id" = ${item.variantId}::uuid
    `;
  }

  await prisma.orderStatusHistory.deleteMany({ where: { orderId: order.id } });
  await prisma.orderStatusHistory.create({
    data: {
      orderId: order.id,
      fromStatus: null,
      toStatus: 'AWAITING_PAYMENT',
      actorType: 'CUSTOMER',
      isCustomerVisible: true,
    },
  });

  return orderNumber;
}

async function reservedQuantity(): Promise<number> {
  const variant = await prisma.productVariant.findUniqueOrThrow({
    where: { id: trackedVariantId },
    select: { reservedQuantity: true },
  });

  return variant.reservedQuantity;
}

/** A genuinely `READY` file, through the whole Phase 9 pipeline. */
async function readyFile(userId: string): Promise<string> {
  const owner = { kind: 'user' as const, userId };

  const bytes = new Uint8Array(
    await sharp({ create: { width: 48, height: 48, channels: 3, background: '#c96f2a' } })
      .png()
      .toBuffer(),
  );

  const authorised = await authoriseUpload(owner, {
    filename: 'virement.png',
    contentType: 'image/png',
    sizeBytes: bytes.byteLength,
  });

  if (!authorised.ok) throw new Error(`presign failed: ${authorised.error.message}`);
  createdFileIds.push(authorised.value.designFileId);

  const response = await storageRoute.PUT(
    new Request(authorised.value.uploadUrl, {
      method: 'PUT',
      headers: authorised.value.headers,
      body: bytes as unknown as BodyInit,
    }),
  );

  if (!response.ok) throw new Error(`put failed: ${response.status}`);

  const finalised = await finaliseUpload(owner, {
    designFileId: authorised.value.designFileId,
  });

  if (!finalised.ok) throw new Error(`finalise failed: ${finalised.error.message}`);
  return authorised.value.designFileId;
}

beforeAll(async () => {
  await purgeStaleFixtures();

  const template = await prisma.product.findFirstOrThrow({
    where: { slug: TEMPLATE_SLUG, deletedAt: null },
    select: { categoryId: true, currency: true, customizationProfileId: true },
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;

  const fixture = await prisma.product.create({
    data: {
      slug: `test-admin-${suffix}`,
      name: 'Article suivi de test',
      description: 'Produit de test créé par la suite de l’atelier.',
      categoryId: template.categoryId,
      basePrice: 40_000,
      currency: template.currency,
      status: 'ACTIVE',
      publishedAt: new Date(Date.now() - 1_000),
      stockPolicy: 'TRACK',
      // Not customisable, so a fixture surviving a crashed run cannot appear in
      // the builder and displace a seeded product there.
      isCustomizable: false,
      customizationProfileId: template.customizationProfileId,
      variants: {
        create: [
          { sku: `TESTAD-${suffix}`, isActive: true, stockQuantity: 500, position: 0 },
        ],
      },
    },
    select: { id: true, slug: true, variants: { select: { id: true, sku: true } } },
  });

  trackedProductId = fixture.id;
  trackedSlug = fixture.slug;
  trackedSku = fixture.variants[0]!.sku;
  trackedVariantId = fixture.variants[0]!.id;

  const reference = await loadBuilderReferenceData(TEMPLATE_SLUG);
  threadColorIds = [reference.threadColors[0]!.id];

  staffUserId = (await createUser('STAFF', 'staff')).userId;
  adminUserId = (await createUser('ADMIN', 'admin')).userId;
  customer = await createUser('CUSTOMER', 'customer');
  stranger = await createUser('CUSTOMER', 'stranger');
});

afterAll(async () => {
  const orders = await prisma.order.findMany({
    where: { orderNumber: { in: createdOrderNumbers } },
    select: { id: true, items: { select: { variantId: true, quantity: true } } },
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

  await prisma.order.deleteMany({ where: { orderNumber: { in: createdOrderNumbers } } });

  const requests = await prisma.customRequest.findMany({
    where: { requestNumber: { in: createdRequestNumbers } },
    select: { id: true, items: { select: { customizationConfigId: true } } },
  });

  const requestIds = requests.map((request) => request.id);
  const configIds = requests.flatMap((request) =>
    request.items.map((item) => item.customizationConfigId),
  );

  await prisma.cart.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.quote.deleteMany({ where: { requestId: { in: requestIds } } });
  await prisma.customRequest.deleteMany({ where: { id: { in: requestIds } } });
  await prisma.customizationConfig.deleteMany({ where: { id: { in: configIds } } });
  await prisma.designFile.deleteMany({ where: { id: { in: createdFileIds } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });

  await prisma.cartItem.deleteMany({ where: { productId: trackedProductId } });
  await prisma.productVariant.deleteMany({ where: { productId: trackedProductId } });
  await prisma.product.deleteMany({ where: { id: trackedProductId } });

  await prisma.$disconnect();
});

/* ---------------------------------------------------------------------------
 * 8.5 — transitions
 * ------------------------------------------------------------------------ */

describe('an order moves only where the machine allows', () => {
  it('records the move, the actor and the timestamp', async () => {
    const orderNumber = await placeOrder();

    const moved = await transitionOrderAsStaff(
      { orderNumber, to: 'CONFIRMED' },
      staffUserId,
    );

    expect(moved.ok, moved.ok ? '' : moved.error.message).toBe(true);

    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber },
      select: {
        status: true,
        confirmedAt: true,
        statusHistory: {
          select: {
            fromStatus: true,
            toStatus: true,
            actorType: true,
            actorUserId: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    expect(order.status).toBe('CONFIRMED');
    expect(order.confirmedAt).not.toBeNull();

    const entry = order.statusHistory.at(-1)!;
    expect(entry.fromStatus).toBe('AWAITING_CONFIRMATION');
    expect(entry.toStatus).toBe('CONFIRMED');
    expect(entry.actorType).toBe('ADMIN');
    expect(entry.actorUserId).toBe(staffUserId);
    expect(entry.createdAt).toBeInstanceOf(Date);
  });

  it('refuses a move the table does not allow, and changes nothing', async () => {
    const orderNumber = await placeOrder();

    const moved = await transitionOrderAsStaff(
      { orderNumber, to: 'DELIVERED' },
      staffUserId,
    );

    expect(moved.ok).toBe(false);
    if (!moved.ok) expect(moved.error.code).toBe('INVALID_TRANSITION');

    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber },
      select: { status: true, statusHistory: { select: { id: true } } },
    });

    expect(order.status).toBe('AWAITING_CONFIRMATION');
    expect(order.statusHistory).toHaveLength(1);
  });

  it('refuses a status that is not a status at all', async () => {
    const orderNumber = await placeOrder();

    const moved = await transitionOrderAsStaff(
      { orderNumber, to: 'SHIPPED_LOL' },
      staffUserId,
    );

    expect(moved.ok).toBe(false);
    if (!moved.ok) expect(moved.error.code).toBe('INVALID_INPUT');
  });

  it('ignores a forged "from" in the payload and reads the row instead', async () => {
    const orderNumber = await placeOrder();

    // DELIVERED -> REFUNDED is legal *from DELIVERED*. Claiming to be there
    // must not make it legal from AWAITING_CONFIRMATION.
    const moved = await transitionOrderAsStaff(
      { orderNumber, to: 'REFUNDED', from: 'DELIVERED', status: 'DELIVERED' },
      staffUserId,
    );

    expect(moved.ok).toBe(false);

    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber },
      select: { status: true },
    });
    expect(order.status).toBe('AWAITING_CONFIRMATION');
  });

  it('requires a reason to cancel, a note to hold and tracking to ship (8.7)', async () => {
    const orderNumber = await placeOrder();

    const noReason = await transitionOrderAsStaff(
      { orderNumber, to: 'CANCELLED' },
      staffUserId,
    );
    expect(noReason.ok).toBe(false);

    await transitionOrderAsStaff({ orderNumber, to: 'CONFIRMED' }, staffUserId);

    const noNote = await transitionOrderAsStaff(
      { orderNumber, to: 'ON_HOLD' },
      staffUserId,
    );
    expect(noNote.ok).toBe(false);

    await transitionOrderAsStaff({ orderNumber, to: 'READY' }, staffUserId);

    const noTracking = await transitionOrderAsStaff(
      { orderNumber, to: 'SHIPPED' },
      staffUserId,
    );
    expect(noTracking.ok).toBe(false);

    const shipped = await transitionOrderAsStaff(
      {
        orderNumber,
        to: 'SHIPPED',
        carrierName: 'Yalidine',
        trackingNumber: 'YAL-42',
      },
      staffUserId,
    );

    expect(shipped.ok, shipped.ok ? '' : shipped.error.message).toBe(true);

    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber },
      select: { carrierName: true, trackingNumber: true, shippedAt: true },
    });

    expect(order.carrierName).toBe('Yalidine');
    expect(order.trackingNumber).toBe('YAL-42');
    expect(order.shippedAt).not.toBeNull();
  });

  it('releases a hold only back to where it was held from (8.6)', async () => {
    const orderNumber = await placeOrder();

    await transitionOrderAsStaff({ orderNumber, to: 'CONFIRMED' }, staffUserId);
    await transitionOrderAsStaff(
      { orderNumber, to: 'ON_HOLD', note: 'Client injoignable.' },
      staffUserId,
    );

    const workspace = await getOrderWorkspace(orderNumber);
    expect(workspace?.order.heldFrom).toBe('CONFIRMED');
    expect(workspace?.available).toContain('CONFIRMED');
    expect(workspace?.available).not.toContain('READY');

    const skipped = await transitionOrderAsStaff(
      { orderNumber, to: 'READY' },
      staffUserId,
    );
    expect(skipped.ok).toBe(false);

    const released = await transitionOrderAsStaff(
      { orderNumber, to: 'CONFIRMED' },
      staffUserId,
    );
    expect(released.ok, released.ok ? '' : released.error.message).toBe(true);
  });

  it('never offers DESIGN_REVIEW for a stock-only order (8.3)', async () => {
    // The **tracked** fixture, not the seeded tote: a `MADE_TO_ORDER` blank
    // requires production (10.2) and legitimately gets a design review. Only a
    // plain stocked line goes CONFIRMED -> READY -> SHIPPED.
    const orderNumber = await placeOrder({ tracked: true });
    await transitionOrderAsStaff({ orderNumber, to: 'CONFIRMED' }, staffUserId);

    const workspace = await getOrderWorkspace(orderNumber);
    expect(workspace?.order.hasProductionLine).toBe(false);
    expect(workspace?.available).not.toContain('DESIGN_REVIEW');

    const moved = await transitionOrderAsStaff(
      { orderNumber, to: 'DESIGN_REVIEW' },
      staffUserId,
    );
    expect(moved.ok).toBe(false);
  });

  it('offers nothing at all from a terminal status', async () => {
    const orderNumber = await placeOrder();

    await transitionOrderAsStaff(
      { orderNumber, to: 'CANCELLED', cancellationReason: 'Test.' },
      staffUserId,
    );

    const workspace = await getOrderWorkspace(orderNumber);
    expect(workspace?.available).toEqual([]);
  });

  it('lets exactly one of two simultaneous transitions win', async () => {
    const orderNumber = await placeOrder();

    const [first, second] = await Promise.all([
      transitionOrderAsStaff({ orderNumber, to: 'CONFIRMED' }, staffUserId),
      transitionOrderAsStaff(
        { orderNumber, to: 'CANCELLED', cancellationReason: 'Doublon.' },
        staffUserId,
      ),
    ]);

    // One succeeds; the loser is told the order moved rather than overwriting.
    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);

    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber },
      select: { status: true, statusHistory: { select: { id: true } } },
    });

    expect(['CONFIRMED', 'CANCELLED']).toContain(order.status);
    // The entry plus exactly one applied move.
    expect(order.statusHistory).toHaveLength(2);
  });
});

/* ---------------------------------------------------------------------------
 * 8.4 and ADR-022 — stock follows the status
 * ------------------------------------------------------------------------ */

describe('stock follows the status', () => {
  it('takes the reservation a deposit order never took, at confirmation', async () => {
    const orderNumber = await orderAwaitingDeposit();
    const before = await reservedQuantity();

    await transitionOrderAsStaff(
      { orderNumber, to: 'AWAITING_CONFIRMATION' },
      staffUserId,
    );
    expect(await reservedQuantity()).toBe(before);

    await transitionOrderAsStaff({ orderNumber, to: 'CONFIRMED' }, staffUserId);
    expect(await reservedQuantity()).toBe(before + 1);
  });

  it('releases it on cancellation, and only once', async () => {
    const orderNumber = await placeOrder({ tracked: true });
    const afterPlacement = await reservedQuantity();

    await transitionOrderAsStaff(
      { orderNumber, to: 'CANCELLED', cancellationReason: 'Test.' },
      staffUserId,
    );

    expect(await reservedQuantity()).toBe(afterPlacement - 1);

    // Terminal: a second cancellation cannot double-release.
    const again = await transitionOrderAsStaff(
      { orderNumber, to: 'CANCELLED', cancellationReason: 'Encore.' },
      staffUserId,
    );

    expect(again.ok).toBe(false);
    expect(await reservedQuantity()).toBe(afterPlacement - 1);
  });

  it('does not reserve twice when an already-reserved order is confirmed', async () => {
    const orderNumber = await placeOrder({ tracked: true });
    const afterPlacement = await reservedQuantity();

    await transitionOrderAsStaff({ orderNumber, to: 'CONFIRMED' }, staffUserId);

    expect(await reservedQuantity()).toBe(afterPlacement);
  });
});

/* ---------------------------------------------------------------------------
 * 8.8 and 8.10.4 — money
 * ------------------------------------------------------------------------ */

describe('payments are recorded, never asserted', () => {
  it('writes a row with its author and derives the status from the rows', async () => {
    const orderNumber = await orderAwaitingDeposit();

    const recorded = await recordPaymentAsStaff(
      {
        orderNumber,
        kind: 'DEPOSIT',
        method: 'BANK_TRANSFER',
        amount: 20_000,
        reference: orderNumber,
      },
      staffUserId,
    );

    expect(recorded.ok, recorded.ok ? '' : recorded.error.message).toBe(true);

    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber },
      select: {
        amountPaid: true,
        paymentStatus: true,
        payments: {
          select: { amount: true, status: true, recordedByUserId: true, kind: true },
        },
      },
    });

    expect(order.amountPaid).toBe(20_000);
    expect(order.paymentStatus).toBe('DEPOSIT_PAID');
    expect(order.payments).toHaveLength(1);
    expect(order.payments[0]!.recordedByUserId).toBe(staffUserId);
    expect(order.payments[0]!.status).toBe('SUCCEEDED');
  });

  it('refuses a payment beyond the balance, and writes nothing', async () => {
    const orderNumber = await placeOrder();

    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber },
      select: { grandTotal: true },
    });

    const recorded = await recordPaymentAsStaff(
      {
        orderNumber,
        kind: 'FULL',
        method: 'CCP',
        amount: order.grandTotal + 1,
        reference: null,
      },
      staffUserId,
    );

    expect(recorded.ok).toBe(false);
    if (!recorded.ok) expect(recorded.error.code).toBe('PAYMENT_REFUSED');

    expect(await prisma.payment.count({ where: { order: { orderNumber } } })).toBe(0);
  });

  it('ignores a total, a deposit and a payment status sent in the payload', async () => {
    const orderNumber = await placeOrder();

    const before = await prisma.order.findUniqueOrThrow({
      where: { orderNumber },
      select: { grandTotal: true, depositRequired: true },
    });

    await recordPaymentAsStaff(
      {
        orderNumber,
        kind: 'BALANCE',
        method: 'CCP',
        amount: 1_000,
        reference: null,
        // None of these is a field on the schema. They parse away.
        grandTotal: 1,
        depositRequired: 0,
        paymentStatus: 'PAID',
        amountPaid: 999_999,
      },
      staffUserId,
    );

    const after = await prisma.order.findUniqueOrThrow({
      where: { orderNumber },
      select: {
        grandTotal: true,
        depositRequired: true,
        amountPaid: true,
        paymentStatus: true,
      },
    });

    expect(after.grandTotal).toBe(before.grandTotal);
    expect(after.depositRequired).toBe(before.depositRequired);
    expect(after.amountPaid).toBe(1_000);
    expect(after.paymentStatus).not.toBe('PAID');
  });

  it('refuses a non-positive amount at the database as well as the domain', async () => {
    const orderNumber = await placeOrder();

    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber },
      select: { id: true },
    });

    // Bypassing the service entirely: `payments_amount_positive` is the floor.
    await expect(
      prisma.payment.create({
        data: {
          orderId: order.id,
          provider: 'manual',
          method: 'CCP',
          kind: 'BALANCE',
          amount: -5_000,
          status: 'SUCCEEDED',
        },
      }),
    ).rejects.toThrow();
  });

  it('refuses a second payment recorded against a stale balance', async () => {
    const orderNumber = await placeOrder();

    const workspace = await getOrderWorkspace(orderNumber);
    const half = Math.floor(workspace!.outstandingBalance / 2);

    const [first, second] = await Promise.all([
      recordPaymentAsStaff(
        { orderNumber, kind: 'BALANCE', method: 'CCP', amount: half, reference: null },
        staffUserId,
      ),
      recordPaymentAsStaff(
        { orderNumber, kind: 'BALANCE', method: 'CCP', amount: half, reference: null },
        staffUserId,
      ),
    ]);

    // Both read the same balance; the second write finds it moved and is
    // refused rather than applied to a total that no longer holds.
    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    expect(await prisma.payment.count({ where: { order: { orderNumber } } })).toBe(1);
  });
});

/* ---------------------------------------------------------------------------
 * 8.10.2 — proof of payment
 * ------------------------------------------------------------------------ */

describe('proof of payment', () => {
  it('is submitted by its owner and reviewed by staff', async () => {
    const orderNumber = await orderAwaitingDeposit();
    const designFileId = await readyFile(customer.userId);

    const submitted = await submitPaymentProof({
      orderNumber,
      userId: customer.userId,
      designFileId,
    });

    expect(submitted.ok, submitted.ok ? '' : submitted.error.message).toBe(true);

    const workspace = await getOrderWorkspace(orderNumber);
    const proof = workspace!.order.proofs[0]!;
    expect(proof.status).toBe('SUBMITTED');

    const reviewed = await reviewProofAsStaff({
      proofId: proof.id,
      accept: true,
      rejectionReason: null,
      actorUserId: staffUserId,
    });

    expect(reviewed.ok).toBe(true);

    const owner = await findProofForOwner({ orderNumber, userId: customer.userId });
    expect(owner?.status).toBe('ACCEPTED');
  });

  it('refuses submission against another customer’s order', async () => {
    const orderNumber = await orderAwaitingDeposit();
    const designFileId = await readyFile(stranger.userId);

    const submitted = await submitPaymentProof({
      orderNumber,
      userId: stranger.userId,
      designFileId,
    });

    expect(submitted.ok).toBe(false);
    expect(
      await prisma.orderPaymentProof.count({ where: { order: { orderNumber } } }),
    ).toBe(0);
  });

  it('refuses a file the submitter does not own', async () => {
    const orderNumber = await orderAwaitingDeposit();
    const foreign = await readyFile(stranger.userId);

    const submitted = await submitPaymentProof({
      orderNumber,
      userId: customer.userId,
      designFileId: foreign,
    });

    expect(submitted.ok).toBe(false);
  });

  it('permits one outstanding proof per order', async () => {
    const orderNumber = await orderAwaitingDeposit();

    const first = await submitPaymentProof({
      orderNumber,
      userId: customer.userId,
      designFileId: await readyFile(customer.userId),
    });
    expect(first.ok).toBe(true);

    const second = await submitPaymentProof({
      orderNumber,
      userId: customer.userId,
      designFileId: await readyFile(customer.userId),
    });
    expect(second.ok).toBe(false);
  });

  it('requires a reason to refuse, and shows it to the customer', async () => {
    const orderNumber = await orderAwaitingDeposit();

    await submitPaymentProof({
      orderNumber,
      userId: customer.userId,
      designFileId: await readyFile(customer.userId),
    });

    const workspace = await getOrderWorkspace(orderNumber);
    const proofId = workspace!.order.proofs[0]!.id;

    const noReason = await reviewProofAsStaff({
      proofId,
      accept: false,
      rejectionReason: '  ',
      actorUserId: staffUserId,
    });

    expect(noReason.ok).toBe(false);

    const refused = await reviewProofAsStaff({
      proofId,
      accept: false,
      rejectionReason: 'Le montant ne correspond pas.',
      actorUserId: staffUserId,
    });

    expect(refused.ok).toBe(true);

    const owner = await findProofForOwner({ orderNumber, userId: customer.userId });
    expect(owner?.status).toBe('REJECTED');
    expect(owner?.rejectionReason).toBe('Le montant ne correspond pas.');
  });

  it('is invisible to another customer, and signs no URL for them', async () => {
    const orderNumber = await orderAwaitingDeposit();

    await submitPaymentProof({
      orderNumber,
      userId: customer.userId,
      designFileId: await readyFile(customer.userId),
    });

    const workspace = await getOrderWorkspace(orderNumber);
    const proofId = workspace!.order.proofs[0]!.id;

    const stolen = await getPaymentProofAccess({
      proofId,
      actorUserId: stranger.userId,
      asStaff: false,
    });

    expect(stolen.ok).toBe(false);

    const theirs = await findProofForOwner({ orderNumber, userId: stranger.userId });
    expect(theirs).toBeNull();
  });

  it('signs a URL for staff and audit-logs the access (12.5)', async () => {
    const orderNumber = await orderAwaitingDeposit();

    await submitPaymentProof({
      orderNumber,
      userId: customer.userId,
      designFileId: await readyFile(customer.userId),
    });

    const workspace = await getOrderWorkspace(orderNumber);
    const proofId = workspace!.order.proofs[0]!.id;

    const access = await getPaymentProofAccess({
      proofId,
      actorUserId: staffUserId,
      asStaff: true,
    });

    expect(access.ok, access.ok ? '' : access.error.message).toBe(true);
    if (!access.ok) return;

    expect(Object.keys(access.value)).not.toContain('storageKey');
    expect(access.value.downloadUrl).toContain('signature=');

    const logged = await prisma.auditLog.count({
      where: { actorUserId: staffUserId, entityType: 'design_file' },
    });

    expect(logged).toBeGreaterThan(0);
  });

  it('refuses a fabricated proof id, for staff and customer alike', async () => {
    const fabricated = randomUUID();

    expect(
      (
        await getPaymentProofAccess({
          proofId: fabricated,
          actorUserId: staffUserId,
          asStaff: true,
        })
      ).ok,
    ).toBe(false);

    expect(
      (
        await getPaymentProofAccess({
          proofId: fabricated,
          actorUserId: customer.userId,
          asStaff: false,
        })
      ).ok,
    ).toBe(false);
  });
});

/* ---------------------------------------------------------------------------
 * Internal notes and the customer's projection
 * ------------------------------------------------------------------------ */

describe('what the customer never sees', () => {
  it('keeps an order’s internal note out of their projection', async () => {
    const orderNumber = await placeOrder();

    await saveOrderInternalNotes({
      orderNumber,
      notes: 'NOTE-INTERNE-ATELIER : marge faible.',
    });

    const staffView = await getOrderWorkspace(orderNumber);
    expect(staffView!.order.internalNotes).toContain('NOTE-INTERNE-ATELIER');

    const customerView = await getCustomerOrder({
      orderNumber,
      userId: customer.userId,
    });

    expect(JSON.stringify(customerView)).not.toContain('NOTE-INTERNE-ATELIER');
  });

  it('keeps a hold’s note internal while a cancellation’s reason is shown', async () => {
    const orderNumber = await placeOrder();

    await transitionOrderAsStaff({ orderNumber, to: 'CONFIRMED' }, staffUserId);
    await transitionOrderAsStaff(
      { orderNumber, to: 'ON_HOLD', note: 'PAUSE-INTERNE : fil en rupture.' },
      staffUserId,
    );

    const customerView = await getCustomerOrder({
      orderNumber,
      userId: customer.userId,
    });

    expect(JSON.stringify(customerView)).not.toContain('PAUSE-INTERNE');
    // The hold itself is internal, so the customer's timeline does not gain it.
    expect(customerView!.timeline.some((entry) => entry.toStatus === 'ON_HOLD')).toBe(
      false,
    );

    const staffView = await getOrderWorkspace(orderNumber);
    expect(
      staffView!.order.fullTimeline.some((entry) => entry.toStatus === 'ON_HOLD'),
    ).toBe(true);
  });

  it('shows a customer-visible transition on both sides', async () => {
    const orderNumber = await placeOrder();
    await transitionOrderAsStaff({ orderNumber, to: 'CONFIRMED' }, staffUserId);

    const customerView = await getCustomerOrder({
      orderNumber,
      userId: customer.userId,
    });

    expect(customerView!.status).toBe('CONFIRMED');
    expect(customerView!.timeline.some((entry) => entry.toStatus === 'CONFIRMED')).toBe(
      true,
    );
  });
});

/* ---------------------------------------------------------------------------
 * The directory and the queues
 * ------------------------------------------------------------------------ */

describe('the customer directory', () => {
  it('finds a customer by name or address, and never a colleague', async () => {
    const byEmail = await listCustomersForStaff({ query: customer.email });
    expect(byEmail.map((row) => row.id)).toContain(customer.userId);

    const staff = await listCustomersForStaff({ query: `${PREFIX}-staff` });
    expect(staff).toHaveLength(0);
  });

  it('returns null for a staff id and for a fabricated one alike', async () => {
    expect(await findCustomerForStaff(staffUserId)).toBeNull();
    expect(await findCustomerForStaff(adminUserId)).toBeNull();
    expect(await findCustomerForStaff(randomUUID())).toBeNull();
  });

  it('carries no credential in the projection', async () => {
    const detail = await findCustomerForStaff(customer.userId);
    expect(detail).not.toBeNull();

    const serialised = JSON.stringify(detail);
    for (const forbidden of ['password', 'token', 'sessions', 'accounts', '$argon2']) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it('carries the customer’s own history', async () => {
    const orderNumber = await placeOrder();
    const detail = await findCustomerForStaff(customer.userId);

    expect(detail!.orders.map((order) => order.orderNumber)).toContain(orderNumber);
  });
});

describe('the queues', () => {
  it('filters the order list by status', async () => {
    const orderNumber = await placeOrder();
    await transitionOrderAsStaff({ orderNumber, to: 'CONFIRMED' }, staffUserId);

    const confirmed = await getOrderQueue({ status: 'CONFIRMED', limit: 100 });
    expect(confirmed.map((row) => row.orderNumber)).toContain(orderNumber);

    const shipped = await getOrderQueue({ status: 'SHIPPED', limit: 100 });
    expect(shipped.map((row) => row.orderNumber)).not.toContain(orderNumber);
  });

  it('puts a submitted request and a waiting order in front of the workshop', async () => {
    const result = await createCustomRequest({
      productSlug: TEMPLATE_SLUG,
      variantSku: null,
      options: {},
      // No garment photograph to place on in these fixtures, so the size is
      // given rather than dragged — the path a blank nobody has measured takes
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

    const orderNumber = await orderAwaitingDeposit();

    const board = await getAdminDashboard();

    // The queues are capped for display, and the database is shared with every
    // other suite, so this asserts the **properties** rather than membership of
    // a top-ten slice: the counts are non-zero and each queue is ordered oldest
    // first, which is the promise the response-time target rests on.
    expect(board.counts.newRequests).toBeGreaterThan(0);
    expect(board.counts.awaitingPayment).toBeGreaterThan(0);

    const requestOrder = board.newRequests.map((row) =>
      (row.submittedAt ?? row.createdAt).getTime(),
    );
    expect([...requestOrder].sort((a, b) => a - b)).toEqual(requestOrder);

    const paymentOrder = board.awaitingPayment.map((row) => row.placedAt.getTime());
    expect([...paymentOrder].sort((a, b) => a - b)).toEqual(paymentOrder);

    // And the authoritative queries do contain this suite's own rows.
    const submitted = await listRequestsForStaff({ status: 'SUBMITTED', limit: 500 });
    expect(submitted.map((row) => row.requestNumber)).toContain(result.requestNumber);

    const awaiting = await getOrderQueue({ status: 'AWAITING_PAYMENT', limit: 500 });
    expect(awaiting.map((row) => row.orderNumber)).toContain(orderNumber);
  });

  it('carries no statistic, only work', async () => {
    const board = await getAdminDashboard();

    // Analytics are V2. Every count here is the length of a queue somebody can
    // click, and there is no revenue figure to be found. `lowStock` and
    // `outOfStock` joined the list in Phase 14.5 *with* the screen that acts on
    // them — before `/admin/stock` existed they would have been the
    // informational tile leading nowhere that UX.md section 9 forbids.
    expect(Object.keys(board.counts).sort()).toEqual([
      'awaitingPayment',
      'inFulfilment',
      'lowStock',
      'newRequests',
      'outOfStock',
      'outstandingQuotes',
      'proofsToReview',
    ]);

    expect(JSON.stringify(board)).not.toContain('revenue');
  });
});

/* ---------------------------------------------------------------------------
 * Fabricated identifiers
 * ------------------------------------------------------------------------ */

describe('a fabricated identifier reaches nothing', () => {
  it('returns null for an order that does not exist', async () => {
    expect(await getOrderWorkspace('CMD-2099-9999')).toBeNull();
  });

  it('refuses a transition and a payment against a fabricated order', async () => {
    const moved = await transitionOrderAsStaff(
      { orderNumber: 'CMD-2099-9999', to: 'CONFIRMED' },
      staffUserId,
    );
    expect(moved.ok).toBe(false);
    if (!moved.ok) expect(moved.error.code).toBe('ORDER_NOT_FOUND');

    const paid = await recordPaymentAsStaff(
      {
        orderNumber: 'CMD-2099-9999',
        kind: 'FULL',
        method: 'CCP',
        amount: 1_000,
        reference: null,
      },
      staffUserId,
    );
    expect(paid.ok).toBe(false);
  });

  it('refuses an internal note against a fabricated order', async () => {
    const saved = await saveOrderInternalNotes({
      orderNumber: 'CMD-2099-9999',
      notes: 'x',
    });

    expect(saved.ok).toBe(false);
  });
});
