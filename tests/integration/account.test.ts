/**
 * The customer portal's authorisation, against the real database.
 *
 * Phase 11 adds no business rules — it adds a place to look at Phases 7 to 10 —
 * so almost every test here asks one question: **can customer A reach anything
 * belonging to customer B?** The answer must always be the same one a
 * nonexistent identifier produces, because a portal that distinguishes "not
 * yours" from "no such thing" is an oracle for enumerating other people's
 * orders.
 *
 * These are written against the **services and repositories**, not the pages. A
 * UI test proves a link is missing; only this proves the server refuses when
 * the link is typed in by hand.
 */

import { randomUUID } from 'node:crypto';

import dotenv from 'dotenv';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

dotenv.config({ path: ['.env.local', '.env'], quiet: true });

const {
  getAccountOverview,
  getCustomerOrder,
  getCustomerRequestPage,
  listCustomerOrders,
  listCustomerRequests,
} = await import('../../src/server/services/account-service');

const {
  acceptQuoteAsOwner,
  createQuoteDraft,
  getCustomerQuotePage,
  listQuotesForCustomer,
  postCustomerMessage,
  postRequestMessage,
  sendQuoteToCustomer,
  transitionRequest,
} = await import('../../src/server/services/quote-service');

const { authoriseUpload, finaliseUpload, getRequestFileAccess } =
  await import('../../src/server/services/design-file-service');
const { createCustomRequest } =
  await import('../../src/server/services/custom-request-service');
const { placeOrderFromCart } = await import('../../src/server/services/checkout-service');
const { addToCart } = await import('../../src/server/services/cart-service');
const { getCurrentUserProfile } =
  await import('../../src/server/repositories/user-repository');
const { listRequestEvents } =
  await import('../../src/server/repositories/request-repository');
const { loadBuilderReferenceData } =
  await import('../../src/server/repositories/customization-repository');
const storageRoute = await import('../../src/app/api/storage/local/route');
const { prisma } = await import('../../src/lib/db/client');

const TEMPLATE_SLUG = 't-shirt-brode-classique';
const MADE_TO_ORDER_SLUG = 'tote-bag-toile-epaisse';
const ALGER = 16;

/* ---------------------------------------------------------------------------
 * Fixtures
 * ------------------------------------------------------------------------ */

const PREFIX = `phase11-${Date.now()}`;

let staffUserId: string;
let alice: { userId: string; email: string };
let mallory: { userId: string; email: string };

let productSlug: string;
let fixtureProductId: string;
let variantSku: string;
let threadColorIds: string[];

const createdRequestNumbers: string[] = [];
const createdUserIds: string[] = [];
const createdOrderNumbers: string[] = [];
const createdFileIds: string[] = [];

async function createUser(role: 'CUSTOMER' | 'STAFF', label: string) {
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
    where: { slug: { startsWith: 'test-account-' } },
    select: { id: true },
  });

  if (stale.length === 0) return;
  const ids = stale.map((product) => product.id);

  await prisma.cartItem.deleteMany({ where: { productId: { in: ids } } });
  await prisma.customizationConfig.deleteMany({ where: { productId: { in: ids } } });
  await prisma.productVariant.deleteMany({ where: { productId: { in: ids } } });
  await prisma.product.deleteMany({ where: { id: { in: ids } } });
}

/** A submitted request owned by whoever the e-mail names. */
async function submitRequest(
  email: string,
  overrides: Record<string, unknown> = {},
  /**
   * The uploader, when the request attaches files.
   *
   * Phase 9 resolves `designFileIds` **scoped to the owner** and requires each
   * to be `READY`, so a request carrying artwork must name who uploaded it.
   * Omitting it is exactly how a foreign file id fails, which is the point.
   */
  owner: { kind: 'user'; userId: string } | null = null,
): Promise<{ requestNumber: string; requestId: string }> {
  const result = await createCustomRequest(
    {
      productSlug,
      variantSku,
      options: { Taille: 'M' },
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
      contactEmail: email,
      contactPhone: null,
      ...overrides,
    },
    owner,
  );

  if (!result.ok) throw new Error(`request failed: ${result.errors.join(' / ')}`);
  createdRequestNumbers.push(result.requestNumber);

  const request = await prisma.customRequest.findUniqueOrThrow({
    where: { requestNumber: result.requestNumber },
    select: { id: true },
  });

  // Pricing is what binds a guest request to an account (Phase 10). These tests
  // need ownership without a quote, so the binding is made directly.
  const account = await prisma.user.findFirstOrThrow({
    where: { email },
    select: { id: true },
  });

  await prisma.customRequest.update({
    where: { id: request.id },
    data: { userId: account.id },
  });

  return { requestNumber: result.requestNumber, requestId: request.id };
}

function draftPayload() {
  return {
    lines: [
      {
        kind: 'PRODUCT',
        label: 'Pièce brodée',
        description: null,
        quantity: 2,
        unitPrice: 300_000,
        requestItemId: null,
      },
      {
        kind: 'SHIPPING',
        label: 'Livraison devisée',
        description: null,
        quantity: 1,
        unitPrice: 50_000,
        requestItemId: null,
      },
    ],
    customerMessage: 'Voici notre proposition.',
    internalNotes: 'NOTE-INTERNE-SECRETE',
  };
}

async function sentQuoteFor(email: string) {
  const { requestNumber, requestId } = await submitRequest(email);

  const created = await createQuoteDraft(
    { ...draftPayload(), requestNumber },
    staffUserId,
  );
  if (!created.ok) throw new Error(`draft failed: ${created.error.message}`);

  const sent = await sendQuoteToCustomer(created.value.quoteId, staffUserId);
  if (!sent.ok) throw new Error(`send failed: ${sent.error.message}`);

  return {
    requestNumber,
    requestId,
    quoteId: created.value.quoteId,
    quoteNumber: created.value.quoteNumber,
  };
}

/** An order placed by a signed-in customer, through the real Phase 8 path. */
async function placeOrderFor(userId: string, email: string): Promise<string> {
  const owner = { kind: 'user' as const, userId };

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
    contactEmail: email,
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

/** A genuinely `READY` design file, through the whole Phase 9 pipeline. */
async function readyFile(userId: string): Promise<string> {
  const owner = { kind: 'user' as const, userId };

  const bytes = new Uint8Array(
    await sharp({ create: { width: 64, height: 64, channels: 3, background: '#12100e' } })
      .png()
      .toBuffer(),
  );

  const authorised = await authoriseUpload(owner, {
    filename: 'logo.png',
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
      slug: `test-account-${suffix}`,
      name: 'Pièce brodée de test',
      description: 'Produit de test créé par la suite du portail client.',
      categoryId: template.categoryId,
      basePrice: 300_000,
      currency: template.currency,
      status: 'ACTIVE',
      publishedAt: new Date(Date.now() - 1_000),
      stockPolicy: 'MADE_TO_ORDER',
      isCustomizable: true,
      customizationProfileId: template.customizationProfileId,
      variants: {
        create: [
          { sku: `TESTA-${suffix}`, isActive: true, stockQuantity: 0, position: 0 },
        ],
      },
    },
    select: { id: true, slug: true, variants: { select: { sku: true } } },
  });

  fixtureProductId = fixture.id;
  productSlug = fixture.slug;
  variantSku = fixture.variants[0]!.sku;

  const reference = await loadBuilderReferenceData(productSlug);
  threadColorIds = [reference.threadColors[0]!.id];

  staffUserId = (await createUser('STAFF', 'staff')).userId;
  alice = await createUser('CUSTOMER', 'alice');
  mallory = await createUser('CUSTOMER', 'mallory');
});

afterAll(async () => {
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

  await prisma.order.deleteMany({ where: { orderNumber: { in: createdOrderNumbers } } });
  await prisma.cart.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.quote.deleteMany({ where: { requestId: { in: requestIds } } });
  await prisma.customRequest.deleteMany({ where: { id: { in: requestIds } } });
  await prisma.customizationFile.deleteMany({
    where: { designFileId: { in: createdFileIds } },
  });
  await prisma.customizationConfig.deleteMany({ where: { id: { in: configIds } } });
  await prisma.designFile.deleteMany({ where: { id: { in: createdFileIds } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });

  await prisma.cartItem.deleteMany({ where: { productId: fixtureProductId } });
  await prisma.customizationConfig.deleteMany({ where: { productId: fixtureProductId } });
  await prisma.productVariant.deleteMany({ where: { productId: fixtureProductId } });
  await prisma.product.deleteMany({ where: { id: fixtureProductId } });

  await prisma.$disconnect();
});

/* ---------------------------------------------------------------------------
 * Requests
 * ------------------------------------------------------------------------ */

describe('a request belongs to one customer', () => {
  it('is readable by its owner', async () => {
    const { requestNumber } = await submitRequest(alice.email);

    const page = await getCustomerRequestPage({
      requestNumber,
      userId: alice.userId,
    });

    expect(page).not.toBeNull();
    expect(page!.requestNumber).toBe(requestNumber);
  });

  it('is null for another customer, exactly as a fabricated number is', async () => {
    const { requestNumber } = await submitRequest(alice.email);

    const foreign = await getCustomerRequestPage({
      requestNumber,
      userId: mallory.userId,
    });
    const fabricated = await getCustomerRequestPage({
      requestNumber: 'DEM-2099-9999',
      userId: mallory.userId,
    });

    expect(foreign).toBeNull();
    expect(fabricated).toBeNull();
    expect(foreign).toEqual(fabricated);
  });

  it('never appears in another customer’s list', async () => {
    const { requestNumber } = await submitRequest(alice.email);

    const mine = await listCustomerRequests(alice.userId);
    const theirs = await listCustomerRequests(mallory.userId);

    expect(mine.map((request) => request.requestNumber)).toContain(requestNumber);
    expect(theirs.map((request) => request.requestNumber)).not.toContain(requestNumber);
  });

  it('hides internal notes and draft quotes from the customer’s page', async () => {
    const { requestNumber } = await submitRequest(alice.email);

    // A draft, never sent, carrying an internal note.
    const draft = await createQuoteDraft(
      { ...draftPayload(), requestNumber },
      staffUserId,
    );
    expect(draft.ok).toBe(true);

    await postRequestMessage({
      requestNumber,
      actorType: 'ADMIN',
      actorUserId: staffUserId,
      message: 'NOTE-INTERNE-SECRETE dans le fil',
      internal: true,
    });

    const page = await getCustomerRequestPage({
      requestNumber,
      userId: alice.userId,
    });

    const serialised = JSON.stringify(page);

    expect(serialised).not.toContain('NOTE-INTERNE-SECRETE');
    expect(page!.timeline.some((event) => event.type === 'INTERNAL_NOTE')).toBe(false);
    expect(page!.quotes).toHaveLength(0);
  });

  it('shows a sent quote, its effective status and the blocking reason', async () => {
    const { requestNumber } = await sentQuoteFor(alice.email);

    await transitionRequest({
      requestNumber,
      to: 'NEEDS_INFO',
      actor: 'STAFF',
      actorUserId: staffUserId,
      needsInfoReason: 'Il nous faut le logo en vectoriel.',
    });

    const page = await getCustomerRequestPage({
      requestNumber,
      userId: alice.userId,
    });

    expect(page!.needsInfoReason).toBe('Il nous faut le logo en vectoriel.');
    expect(page!.quotes).toHaveLength(1);
    expect(page!.quotes[0]!.status).toBe('SENT');
  });
});

/* ---------------------------------------------------------------------------
 * Messages
 * ------------------------------------------------------------------------ */

describe('a customer may only write on their own request', () => {
  it('posts a visible MESSAGE and changes no status', async () => {
    const { requestNumber, requestId } = await submitRequest(alice.email);

    const before = await prisma.customRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: { status: true },
    });

    const posted = await postCustomerMessage({
      requestNumber,
      userId: alice.userId,
      message: 'Bonjour, avez-vous reçu mon fichier ?',
    });

    expect(posted.ok).toBe(true);

    const after = await prisma.customRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: { status: true, needsInfoReason: true },
    });

    expect(after.status).toBe(before.status);

    const events = await listRequestEvents({ requestId, customerVisibleOnly: true });
    const message = events.find((event) => event.type === 'MESSAGE');

    expect(message?.actorType).toBe('CUSTOMER');
    expect(message?.message).toBe('Bonjour, avez-vous reçu mon fichier ?');
  });

  it('refuses to post on another customer’s request', async () => {
    const { requestNumber, requestId } = await submitRequest(alice.email);

    const posted = await postCustomerMessage({
      requestNumber,
      userId: mallory.userId,
      message: 'Message injecté',
    });

    expect(posted.ok).toBe(false);
    if (!posted.ok) expect(posted.error.code).toBe('REQUEST_NOT_FOUND');

    const events = await listRequestEvents({ requestId, customerVisibleOnly: false });
    expect(JSON.stringify(events)).not.toContain('Message injecté');
  });

  it('refuses a fabricated request number', async () => {
    const posted = await postCustomerMessage({
      requestNumber: 'DEM-2099-0001',
      userId: alice.userId,
      message: 'Bonjour',
    });

    expect(posted.ok).toBe(false);
  });

  it('cannot write an internal note, because there is no argument for one', async () => {
    const { requestNumber, requestId } = await submitRequest(alice.email);

    // A payload trying to opt into the admin's path. `postCustomerMessage`
    // takes three fields, and TypeScript refuses the extra ones at the call
    // site — this cast is what a compiled-away client could send anyway.
    const smuggled = {
      requestNumber,
      userId: alice.userId,
      message: 'Bonjour',
      internal: true,
      actorType: 'ADMIN',
    } as unknown as Parameters<typeof postCustomerMessage>[0];

    await postCustomerMessage(smuggled);

    const events = await listRequestEvents({ requestId, customerVisibleOnly: false });
    const written = events.find((event) => event.message === 'Bonjour');

    expect(written?.type).toBe('MESSAGE');
    expect(written?.actorType).toBe('CUSTOMER');
  });

  it('does not clear a NEEDS_INFO block by answering (6.7.3)', async () => {
    const { requestNumber, requestId } = await submitRequest(alice.email);

    await transitionRequest({
      requestNumber,
      to: 'NEEDS_INFO',
      actor: 'STAFF',
      actorUserId: staffUserId,
      needsInfoReason: 'Il nous faut le logo en vectoriel.',
    });

    await postCustomerMessage({
      requestNumber,
      userId: alice.userId,
      message: 'Le voici en pièce jointe.',
    });

    const request = await prisma.customRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: { status: true, needsInfoReason: true },
    });

    expect(request.status).toBe('NEEDS_INFO');
    expect(request.needsInfoReason).toBe('Il nous faut le logo en vectoriel.');
  });
});

/* ---------------------------------------------------------------------------
 * Quotes
 * ------------------------------------------------------------------------ */

describe('a quote belongs to one customer', () => {
  it('is unreadable by another customer and by a fabricated number alike', async () => {
    const { quoteNumber } = await sentQuoteFor(alice.email);

    const foreign = await getCustomerQuotePage({
      quoteNumber,
      userId: mallory.userId,
    });
    const fabricated = await getCustomerQuotePage({
      quoteNumber: 'Q-999999',
      userId: mallory.userId,
    });

    expect(foreign.ok).toBe(false);
    expect(fabricated.ok).toBe(false);
    if (!foreign.ok && !fabricated.ok) {
      expect(foreign.error.code).toBe(fabricated.error.code);
    }
  });

  it('never carries the workshop’s internal note to the customer', async () => {
    const { quoteNumber } = await sentQuoteFor(alice.email);

    const page = await getCustomerQuotePage({ quoteNumber, userId: alice.userId });
    expect(page.ok).toBe(true);
    expect(JSON.stringify(page)).not.toContain('NOTE-INTERNE-SECRETE');
  });

  it('is absent from another customer’s list', async () => {
    const { quoteNumber } = await sentQuoteFor(alice.email);

    const theirs = await listQuotesForCustomer(mallory.userId);
    expect(theirs.map((quote) => quote.quoteNumber)).not.toContain(quoteNumber);
  });

  it('still runs acceptance through the Phase 10 service, producing one bound cart', async () => {
    const { quoteNumber, quoteId } = await sentQuoteFor(alice.email);

    const accepted = await acceptQuoteAsOwner({ quoteNumber, userId: alice.userId });
    expect(accepted.ok, accepted.ok ? '' : accepted.error.message).toBe(true);
    if (!accepted.ok) return;

    const cart = await prisma.cart.findUniqueOrThrow({
      where: { id: accepted.value.cartId },
      select: { kind: true, userId: true, quoteId: true },
    });

    expect(cart.kind).toBe('QUOTE_BOUND');
    expect(cart.userId).toBe(alice.userId);
    expect(cart.quoteId).toBe(quoteId);
    expect(await prisma.cart.count({ where: { quoteId } })).toBe(1);
  });

  it('refuses acceptance by anyone but the owner', async () => {
    const { quoteNumber, quoteId } = await sentQuoteFor(alice.email);

    const stolen = await acceptQuoteAsOwner({ quoteNumber, userId: mallory.userId });

    expect(stolen.ok).toBe(false);
    expect(await prisma.cart.count({ where: { quoteId } })).toBe(0);
  });
});

/* ---------------------------------------------------------------------------
 * Orders
 * ------------------------------------------------------------------------ */

describe('an order belongs to one customer', () => {
  it('is readable by its owner, from snapshots', async () => {
    const orderNumber = await placeOrderFor(alice.userId, alice.email);

    const order = await getCustomerOrder({ orderNumber, userId: alice.userId });
    expect(order).not.toBeNull();

    const stored = await prisma.order.findUniqueOrThrow({
      where: { orderNumber },
      select: {
        grandTotal: true,
        items: { select: { nameSnapshot: true, unitPrice: true } },
      },
    });

    expect(order!.grandTotal).toBe(stored.grandTotal);
    expect(order!.items[0]!.name).toBe(stored.items[0]!.nameSnapshot);
  });

  it('keeps showing what was bought after the catalogue changes', async () => {
    const orderNumber = await placeOrderFor(alice.userId, alice.email);

    const before = await getCustomerOrder({ orderNumber, userId: alice.userId });

    const product = await prisma.product.findFirstOrThrow({
      where: { slug: MADE_TO_ORDER_SLUG, deletedAt: null },
      select: { id: true, name: true, basePrice: true },
    });

    await prisma.product.update({
      where: { id: product.id },
      data: {
        name: 'Nom changé après la commande',
        basePrice: product.basePrice + 100_000,
      },
    });

    try {
      const after = await getCustomerOrder({ orderNumber, userId: alice.userId });

      expect(after!.items).toEqual(before!.items);
      expect(after!.grandTotal).toBe(before!.grandTotal);
      expect(JSON.stringify(after)).not.toContain('Nom changé après la commande');
    } finally {
      await prisma.product.update({
        where: { id: product.id },
        data: { name: product.name, basePrice: product.basePrice },
      });
    }
  });

  it('is null for another customer, exactly as a fabricated number is', async () => {
    const orderNumber = await placeOrderFor(alice.userId, alice.email);

    const foreign = await getCustomerOrder({ orderNumber, userId: mallory.userId });
    const fabricated = await getCustomerOrder({
      orderNumber: 'CMD-2099-9999',
      userId: mallory.userId,
    });

    expect(foreign).toBeNull();
    expect(fabricated).toBeNull();
  });

  it('is not reachable inside the portal with a guest token', async () => {
    const orderNumber = await placeOrderFor(alice.userId, alice.email);

    // Give the row a guest token, as a claimed guest order would have, and try
    // to read it as somebody else. `getCustomerOrder` passes no token at all.
    const token = randomUUID();
    await prisma.order.update({ where: { orderNumber }, data: { guestToken: token } });

    const stolen = await getCustomerOrder({ orderNumber, userId: mallory.userId });
    expect(stolen).toBeNull();
  });

  it('never appears in another customer’s list', async () => {
    const orderNumber = await placeOrderFor(alice.userId, alice.email);

    const mine = await listCustomerOrders(alice.userId);
    const theirs = await listCustomerOrders(mallory.userId);

    expect(mine.map((order) => order.orderNumber)).toContain(orderNumber);
    expect(theirs.map((order) => order.orderNumber)).not.toContain(orderNumber);
  });

  it('never exposes internal notes on the customer projection', async () => {
    const orderNumber = await placeOrderFor(alice.userId, alice.email);

    await prisma.order.update({
      where: { orderNumber },
      data: { internalNotes: 'NOTE-INTERNE-COMMANDE' },
    });

    const order = await getCustomerOrder({ orderNumber, userId: alice.userId });
    expect(JSON.stringify(order)).not.toContain('NOTE-INTERNE-COMMANDE');
  });

  it('hides a status-history entry marked internal', async () => {
    const orderNumber = await placeOrderFor(alice.userId, alice.email);

    const stored = await prisma.order.findUniqueOrThrow({
      where: { orderNumber },
      select: { id: true, status: true },
    });

    await prisma.orderStatusHistory.create({
      data: {
        orderId: stored.id,
        toStatus: stored.status,
        actorType: 'ADMIN',
        note: 'HISTORIQUE-INTERNE',
        isCustomerVisible: false,
      },
    });

    const order = await getCustomerOrder({ orderNumber, userId: alice.userId });
    expect(JSON.stringify(order)).not.toContain('HISTORIQUE-INTERNE');
  });
});

/* ---------------------------------------------------------------------------
 * Artwork
 * ------------------------------------------------------------------------ */

describe('artwork stays with the request it belongs to', () => {
  it('issues a signed URL to the owner and never a storage key', async () => {
    const designFileId = await readyFile(alice.userId);
    const { requestId } = await submitRequest(
      alice.email,
      { designFileIds: [designFileId] },
      { kind: 'user', userId: alice.userId },
    );

    const access = await getRequestFileAccess({
      designFileId,
      requestId,
      actorUserId: alice.userId,
      asStaff: false,
    });

    expect(access.ok, access.ok ? '' : access.error.message).toBe(true);
    if (!access.ok) return;

    const file = await prisma.designFile.findUniqueOrThrow({
      where: { id: designFileId },
      select: { storageKey: true },
    });

    // The URL is signed and short-lived; the key itself is never in the DTO.
    expect(Object.keys(access.value)).not.toContain('storageKey');
    expect(access.value.downloadUrl).toContain('signature=');
    expect(JSON.stringify({ ...access.value, downloadUrl: '' })).not.toContain(
      file.storageKey,
    );
  });

  it('refuses a file that is not attached to the request named', async () => {
    const designFileId = await readyFile(alice.userId);
    await submitRequest(
      alice.email,
      { designFileIds: [designFileId] },
      { kind: 'user', userId: alice.userId },
    );

    // A different request of Alice's own: the file is hers, but it is not this
    // request's, and the join is what authorises rather than ownership.
    const other = await submitRequest(alice.email);

    const access = await getRequestFileAccess({
      designFileId,
      requestId: other.requestId,
      actorUserId: alice.userId,
      asStaff: false,
    });

    expect(access.ok).toBe(false);
    if (!access.ok) expect(access.error.code).toBe('NOT_FOUND');
  });

  it('refuses a fabricated design-file id', async () => {
    const { requestId } = await submitRequest(alice.email);

    const access = await getRequestFileAccess({
      designFileId: randomUUID(),
      requestId,
      actorUserId: alice.userId,
      asStaff: false,
    });

    expect(access.ok).toBe(false);
  });

  it('refuses a deleted file', async () => {
    const designFileId = await readyFile(alice.userId);
    const { requestId } = await submitRequest(
      alice.email,
      { designFileIds: [designFileId] },
      { kind: 'user', userId: alice.userId },
    );

    await prisma.designFile.update({
      where: { id: designFileId },
      data: { deletedAt: new Date() },
    });

    const access = await getRequestFileAccess({
      designFileId,
      requestId,
      actorUserId: alice.userId,
      asStaff: false,
    });

    expect(access.ok).toBe(false);
  });

  it('refuses a file that is not READY', async () => {
    const designFileId = await readyFile(alice.userId);
    const { requestId } = await submitRequest(
      alice.email,
      { designFileIds: [designFileId] },
      { kind: 'user', userId: alice.userId },
    );

    await prisma.designFile.update({
      where: { id: designFileId },
      data: { status: 'QUARANTINED' },
    });

    const access = await getRequestFileAccess({
      designFileId,
      requestId,
      actorUserId: alice.userId,
      asStaff: false,
    });

    expect(access.ok).toBe(false);
  });

  it('writes no audit row for a customer reading their own artwork', async () => {
    const designFileId = await readyFile(alice.userId);
    const { requestId } = await submitRequest(
      alice.email,
      { designFileIds: [designFileId] },
      { kind: 'user', userId: alice.userId },
    );

    await getRequestFileAccess({
      designFileId,
      requestId,
      actorUserId: alice.userId,
      asStaff: false,
    });

    const logged = await prisma.auditLog.count({
      where: { entityId: designFileId, actorUserId: alice.userId },
    });

    expect(logged).toBe(0);
  });
});

/* ---------------------------------------------------------------------------
 * The overview and the profile
 * ------------------------------------------------------------------------ */

describe('the account overview', () => {
  it('shows only this customer’s work', async () => {
    const hers = await sentQuoteFor(alice.email);
    await sentQuoteFor(mallory.email);

    const overview = await getAccountOverview(alice.userId);
    const serialised = JSON.stringify(overview);

    expect(serialised).toContain(hers.quoteNumber);
    expect(serialised).toContain(hers.requestNumber);

    const theirs = await getAccountOverview(mallory.userId);
    expect(JSON.stringify(theirs)).not.toContain(hers.quoteNumber);
  });

  it('puts the soonest expiry first among quotes awaiting a response', async () => {
    const overview = await getAccountOverview(alice.userId);
    const deadlines = overview.quotesAwaitingResponse.map((quote) =>
      quote.validUntil.getTime(),
    );

    expect([...deadlines].sort((a, b) => a - b)).toEqual(deadlines);
  });

  it('leaves a delivered order out of "in flight"', async () => {
    const orderNumber = await placeOrderFor(alice.userId, alice.email);

    await prisma.order.update({
      where: { orderNumber },
      data: { status: 'DELIVERED' },
    });

    const overview = await getAccountOverview(alice.userId);

    expect(overview.ordersInFlight.map((order) => order.orderNumber)).not.toContain(
      orderNumber,
    );
    expect(overview.recentOrders.map((order) => order.orderNumber)).toContain(
      orderNumber,
    );
  });
});

describe('the profile', () => {
  it('returns the four facts the portal shows and no credential', async () => {
    const profile = await getCurrentUserProfile(alice.userId);

    expect(profile?.email).toBe(alice.email);
    expect(profile?.status).toBe('ACTIVE');

    const keys = Object.keys(profile!);
    for (const forbidden of ['password', 'token', 'sessions', 'accounts']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('is null for a user id that does not exist', async () => {
    expect(await getCurrentUserProfile(randomUUID())).toBeNull();
  });
});
