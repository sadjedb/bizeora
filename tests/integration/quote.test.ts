/**
 * The quote lifecycle, against the real database.
 *
 * Phase 10 is the phase where a price becomes a commitment, so these tests are
 * written adversarially: the question is not "does accepting a quote work" but
 * "what happens when the payload lies, when the clock has moved, when two
 * requests arrive at once, and when the catalogue changes underneath a quote
 * that was already sent".
 *
 * Several of them cannot be written any other way than against PostgreSQL — the
 * partial unique index that permits one outstanding quote per request, the
 * conditional `UPDATE` that makes two simultaneous acceptances produce one
 * cart, the sequence behind the quote number, and the check constraints that
 * catch a mapping error at the point of writing rather than in a report weeks
 * later. A mock cannot have a race.
 */

import { randomUUID } from 'node:crypto';

import dotenv from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

dotenv.config({ path: ['.env.local', '.env'], quiet: true });

const {
  acceptQuoteAsOwner,
  cancelQuoteAsStaff,
  createQuoteDraft,
  declineQuoteAsOwner,
  getCustomerQuotePage,
  listQuotesForCustomer,
  postRequestMessage,
  sendQuoteToCustomer,
  summariseConfigurations,
  transitionRequest,
  updateQuoteDraft,
  viewQuoteAsOwner,
} = await import('../../src/server/services/quote-service');

const {
  expireOutstandingQuotes,
  findQuoteForOwner,
  findQuoteForStaff,
  invalidateLapsedQuoteCarts,
  listQuotesForRequest,
} = await import('../../src/server/repositories/quote-repository');

const { findRequestForStaff, listRequestEvents } =
  await import('../../src/server/repositories/request-repository');
const { createCustomRequest } =
  await import('../../src/server/services/custom-request-service');
const { addToCart, updateCartLine, removeCartLine } =
  await import('../../src/server/services/cart-service');
const { getQuoteCheckoutView, placeOrderFromCart } =
  await import('../../src/server/services/checkout-service');
const { loadBuilderReferenceData } =
  await import('../../src/server/repositories/customization-repository');
const { prisma } = await import('../../src/lib/db/client');

const TEMPLATE_SLUG = 't-shirt-brode-classique';
/** Seeded `MADE_TO_ORDER`: always available, never reserved. */
const MADE_TO_ORDER_SLUG = 'tote-bag-toile-epaisse';
const ALGER = 16;

/* ---------------------------------------------------------------------------
 * Fixtures
 * ------------------------------------------------------------------------ */

const PREFIX = `phase10-${Date.now()}`;

let staffUserId: string;
let ownerUserId: string;
let ownerEmail: string;
let strangerUserId: string;

let surfaceImageId: string;
let threadColorIds: string[];
let variantSku: string;

/**
 * A customisable product this suite owns.
 *
 * The seeded t-shirt is twelve units of tracked stock shared with every other
 * suite, so a test that is not about running out would run out anyway,
 * depending on the order the files happened to run in. This fixture is
 * `MADE_TO_ORDER` — the documented default for a blank — so availability is
 * never the variable under test here, and nothing this file does can starve
 * another suite.
 */
let productSlug: string;
let fixtureProductId: string;
/**
 * A placement and a profile this suite owns outright.
 *
 * The freeze test deactivates a placement to prove a sent quote still renders
 * what it quoted. Doing that to a **seeded** placement deactivates it for every
 * other suite running at the same moment, and their requests then fail to
 * resolve it — a cross-file race that presents as "cet emplacement n'est pas
 * disponible" in a test that has nothing to do with placements. Owning the row
 * is the fix; sharing it was the bug.
 */
let fixtureProfileId: string;
let fixturePlacementId: string;

const createdRequestNumbers: string[] = [];
const createdUserIds: string[] = [];
const createdOrderNumbers: string[] = [];

async function createUser(input: {
  email: string;
  role: 'CUSTOMER' | 'STAFF';
  emailVerified?: boolean;
}): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: input.email,
      name: input.email,
      role: input.role,
      status: 'ACTIVE',
      emailVerified: input.emailVerified ?? true,
    },
    select: { id: true },
  });

  createdUserIds.push(user.id);
  return user.id;
}

/**
 * A measured photograph of the blank, so a design can be placed on it.
 *
 * The seed ships no photography — the owner supplies it — so the suite makes
 * its own. 520 mm is a men's medium t-shirt across the chest, which makes the
 * millimetre figures below ones a person can check by eye.
 */
async function ensureSurface(slug: string): Promise<string> {
  const product = await prisma.product.findFirstOrThrow({
    where: { slug },
    select: { id: true },
  });

  /*
   * Reuse the product's own photograph rather than adding one.
   *
   * Marking an existing picture as the front face is exactly what the owner
   * does in the admin, and it keeps the suite from inserting rows other files
   * then find: `catalogue.test.ts` asserts the *first* image of the *first*
   * product with one, and a fixture appended there fails a test about
   * something else entirely.
   */
  const existing = await prisma.productImage.findFirst({
    where: { productId: product.id },
    orderBy: [{ isPrimary: 'desc' }, { position: 'asc' }],
    select: { id: true },
  });

  const image =
    existing ??
    (await prisma.productImage.create({
      data: {
        productId: product.id,
        storageKey: `media/${randomUUID()}.jpg`,
        alt: 'Fixture de placement',
        position: 900,
      },
      select: { id: true },
    }));

  await prisma.productImage.update({
    where: { id: image.id },
    data: { surface: 'FRONT', surfaceWidthMm: 520, width: 1200, height: 1500 },
  });

  return image.id;
}

/** A submitted request owned by the customer, through the real Phase 7 path. */
async function submitRequest(
  overrides: Record<string, unknown> = {},
): Promise<{ requestNumber: string; requestId: string }> {
  const result = await createCustomRequest({
    productSlug,
    variantSku,
    options: { Taille: 'M', Couleur: 'Noir encre' },
    surfaceImageId,
    transform: { xPercent: 50, yPercent: 35, widthPercent: 12, rotationDeg: 0 },
    threadColorIds,
    embroideryText: 'Amina',
    instructions: null,
    quantity: 2,
    designFileIds: [],
    contactName: 'Amina Bensalem',
    contactEmail: ownerEmail,
    contactPhone: null,
    ...overrides,
  });

  if (!result.ok) throw new Error(`request failed: ${result.errors.join(' / ')}`);
  createdRequestNumbers.push(result.requestNumber);

  const request = await prisma.customRequest.findUniqueOrThrow({
    where: { requestNumber: result.requestNumber },
    select: { id: true },
  });

  return { requestNumber: result.requestNumber, requestId: request.id };
}

/**
 * Push a quote's validity into the past.
 *
 * `quotes_valid_until_after_creation` requires `valid_until > created_at`, so a
 * quote cannot simply be given a past deadline — the row has to look like one
 * sent a fortnight ago. Moving both columns is what a real lapsed quote looks
 * like, and respecting the constraint here is the point: a test that worked
 * around it would stop proving anything about production rows.
 */
async function backdateValidity(quoteId: string): Promise<void> {
  // The timestamps come from **this process**, not from the database's `now()`.
  // Every date the application writes — `sentAt`, `validUntil`, `acceptedAt` —
  // is a JavaScript `Date`, and the expiry sweep compares against one too, so a
  // fixture built from `now() - interval` would be measuring the difference
  // between two clocks rather than the rule under test.
  const createdAt = new Date(Date.now() - 30 * 86_400_000);
  const validUntil = new Date(Date.now() - 1_000);

  await prisma.$executeRaw`
    UPDATE "quotes"
       SET "created_at"  = ${createdAt},
           "sent_at"     = ${createdAt},
           "valid_until" = ${validUntil}
     WHERE "id" = ${quoteId}::uuid
  `;
}

function draftPayload(overrides: Record<string, unknown> = {}) {
  return {
    lines: [
      {
        kind: 'PRODUCT',
        label: 'T-shirt brodé — poitrine gauche',
        description: null,
        quantity: 2,
        unitPrice: 350_000,
        requestItemId: null,
      },
      {
        kind: 'SETUP_FEE',
        label: 'Frais de préparation',
        description: null,
        quantity: 1,
        unitPrice: 120_000,
        requestItemId: null,
      },
      {
        kind: 'SHIPPING',
        label: 'Livraison devisée',
        description: null,
        quantity: 1,
        unitPrice: 60_000,
        requestItemId: null,
      },
      {
        kind: 'DISCOUNT',
        label: 'Geste commercial',
        description: null,
        quantity: 1,
        unitPrice: -20_000,
        requestItemId: null,
      },
    ],
    customerMessage: 'Voici notre proposition.',
    internalNotes: 'Marge serrée, ne pas descendre.',
    ...overrides,
  };
}

/** Request → draft → sent, the state most of these tests need to start from. */
async function sentQuote(payloadOverrides: Record<string, unknown> = {}) {
  const { requestNumber, requestId } = await submitRequest();

  const created = await createQuoteDraft(
    { ...draftPayload(payloadOverrides), requestNumber },
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

/** A crashed run leaves fixtures behind, and a stray customisable product is a
 * defect for every other suite. Clean before as well as after. */
async function purgeStaleFixtures(): Promise<void> {
  const stale = await prisma.product.findMany({
    where: { slug: { startsWith: 'test-quote-' } },
    select: { id: true },
  });

  if (stale.length === 0) return;
  const ids = stale.map((product) => product.id);

  await prisma.cartItem.deleteMany({ where: { productId: { in: ids } } });
  // Configurations before products: `product_id` is ON DELETE SET NULL and a
  // config with neither a product nor a freeform type violates its check.
  await prisma.customizationConfig.deleteMany({ where: { productId: { in: ids } } });
  await prisma.productVariant.deleteMany({ where: { productId: { in: ids } } });
  await prisma.product.deleteMany({ where: { id: { in: ids } } });

  await prisma.customizationProfile.deleteMany({
    where: { name: { startsWith: 'Profil de test ' }, products: { none: {} } },
  });
  await prisma.placement.deleteMany({
    where: { code: { startsWith: 'TEST-PLACEMENT-' } },
  });
}

beforeAll(async () => {
  await purgeStaleFixtures();

  const template = await prisma.product.findFirstOrThrow({
    where: { slug: TEMPLATE_SLUG, deletedAt: null },
    select: { categoryId: true, currency: true, customizationProfileId: true },
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;

  const placement = await prisma.placement.create({
    data: {
      code: `TEST-PLACEMENT-${suffix}`,
      name: 'Emplacement de test',
      maxWidthMm: 120,
      maxHeightMm: 120,
      position: 0,
    },
    select: { id: true },
  });

  fixturePlacementId = placement.id;

  // The seeded sizes are read-only to this suite, so they can be shared.
  const sizes = await prisma.embroiderySize.findMany({
    where: { isActive: true },
    select: { id: true },
    orderBy: { position: 'asc' },
    take: 3,
  });

  const profile = await prisma.customizationProfile.create({
    data: {
      name: `Profil de test ${suffix}`,
      isActive: true,
      placements: { create: [{ placementId: placement.id, position: 0 }] },
      embroiderySizes: {
        create: sizes.map((size, position) => ({
          embroiderySizeId: size.id,
          position,
        })),
      },
    },
    select: { id: true },
  });

  fixtureProfileId = profile.id;

  const fixture = await prisma.product.create({
    data: {
      slug: `test-quote-${suffix}`,
      name: 'Pièce brodée de test',
      description: 'Produit de test créé par la suite de devis.',
      categoryId: template.categoryId,
      basePrice: 300_000,
      currency: template.currency,
      status: 'ACTIVE',
      publishedAt: new Date(Date.now() - 1_000),
      stockPolicy: 'MADE_TO_ORDER',
      isCustomizable: true,
      customizationProfileId: fixtureProfileId,
      variants: {
        create: [
          { sku: `TESTQ-${suffix}`, isActive: true, stockQuantity: 0, position: 0 },
        ],
      },
    },
    select: { id: true, slug: true, variants: { select: { sku: true } } },
  });

  fixtureProductId = fixture.id;
  productSlug = fixture.slug;
  variantSku = fixture.variants[0]!.sku;

  const reference = await loadBuilderReferenceData(productSlug);
  surfaceImageId = await ensureSurface(productSlug);
  threadColorIds = [reference.threadColors[0]!.id];

  ownerEmail = `${PREFIX}-owner@example.invalid`;
  staffUserId = await createUser({
    email: `${PREFIX}-staff@example.invalid`,
    role: 'STAFF',
  });
  ownerUserId = await createUser({ email: ownerEmail, role: 'CUSTOMER' });
  strangerUserId = await createUser({
    email: `${PREFIX}-stranger@example.invalid`,
    role: 'CUSTOMER',
  });
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

  // Release anything a placement reserved before deleting the orders.
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
  await prisma.cart.deleteMany({ where: { quote: { requestId: { in: requestIds } } } });
  await prisma.quote.deleteMany({ where: { requestId: { in: requestIds } } });
  await prisma.customRequest.deleteMany({ where: { id: { in: requestIds } } });
  await prisma.customizationConfig.deleteMany({ where: { id: { in: configIds } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });

  await prisma.cartItem.deleteMany({ where: { productId: fixtureProductId } });
  await prisma.customizationConfig.deleteMany({ where: { productId: fixtureProductId } });
  await prisma.productVariant.deleteMany({ where: { productId: fixtureProductId } });
  await prisma.product.deleteMany({ where: { id: fixtureProductId } });
  // The profile cascades its join rows; the placement is deleted after it.
  await prisma.customizationProfile.deleteMany({ where: { id: fixtureProfileId } });
  await prisma.placement.deleteMany({ where: { id: fixturePlacementId } });

  await prisma.$disconnect();
});

/* ---------------------------------------------------------------------------
 * Drafting and pricing
 * ------------------------------------------------------------------------ */

describe('a draft is priced by the server', () => {
  it('derives every total from the lines, and stores none the client sent', async () => {
    const { requestNumber } = await submitRequest();

    const created = await createQuoteDraft(
      {
        ...draftPayload(),
        requestNumber,
        // Every one of these is absent from the schema. A payload carrying them
        // does not "have them ignored" — it parses without them, because there
        // is no field for them to land in.
        subtotal: 1,
        discountTotal: 0,
        shippingTotal: 0,
        grandTotal: 1,
        depositRequired: 1,
        status: 'SENT',
        quoteNumber: 'Q-9999',
        version: 42,
      },
      staffUserId,
    );

    expect(created.ok, created.ok ? '' : created.error.message).toBe(true);
    if (!created.ok) return;

    const quote = await findQuoteForStaff(created.value.quoteId);

    // 2.6.2: 700 000 + 120 000 subtotal, 20 000 discount, 60 000 shipping.
    expect(quote?.subtotal).toBe(820_000);
    expect(quote?.discountTotal).toBe(20_000);
    expect(quote?.shippingTotal).toBe(60_000);
    expect(quote?.grandTotal).toBe(860_000);

    // Not the 1 that was asked for, and not SENT either.
    expect(quote?.status).toBe('DRAFT');
    expect(quote?.version).toBe(1);
    expect(quote?.quoteNumber).not.toBe('Q-9999');
  });

  it('numbers the first quote from the sequence, in the documented format', async () => {
    const { requestNumber } = await submitRequest();
    const created = await createQuoteDraft(
      { ...draftPayload(), requestNumber },
      staffUserId,
    );

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(created.value.quoteNumber).toMatch(/^Q-\d+$/);
    expect(created.value.version).toBe(1);
  });

  it('gives two quotes distinct numbers, from the sequence rather than a count', async () => {
    const first = await submitRequest();
    const second = await submitRequest();

    const one = await createQuoteDraft(
      { ...draftPayload(), requestNumber: first.requestNumber },
      staffUserId,
    );
    const two = await createQuoteDraft(
      { ...draftPayload(), requestNumber: second.requestNumber },
      staffUserId,
    );

    expect(one.ok && two.ok).toBe(true);
    if (!one.ok || !two.ok) return;

    expect(one.value.quoteNumber).not.toBe(two.value.quoteNumber);
  });

  it('computes the deposit from the settings percentage, not from the payload', async () => {
    const { requestNumber } = await submitRequest();
    const created = await createQuoteDraft(
      { ...draftPayload(), requestNumber },
      staffUserId,
    );

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const quote = await findQuoteForStaff(created.value.quoteId);
    const setting = await prisma.setting.findUniqueOrThrow({
      where: { key: 'custom_orders.depositPercent' },
      select: { value: true },
    });

    const expected = Math.round((860_000 * Number.parseInt(setting.value, 10)) / 10_000);

    expect(quote?.depositRequired).toBe(expected);
  });

  it('refuses a positive discount line at the service, before the constraint sees it', async () => {
    const { requestNumber } = await submitRequest();

    const created = await createQuoteDraft(
      {
        ...draftPayload({
          lines: [
            {
              kind: 'DISCOUNT',
              label: 'Remise qui ajoute',
              description: null,
              quantity: 1,
              unitPrice: 50_000,
              requestItemId: null,
            },
          ],
        }),
        requestNumber,
      },
      staffUserId,
    );

    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.error.code).toBe('INVALID_INPUT');
  });

  it('refuses a quote line bound to another request’s item', async () => {
    const mine = await submitRequest();
    const theirs = await submitRequest();

    const foreign = await findRequestForStaff(theirs.requestNumber);
    const foreignItemId = foreign!.items[0]!.id;

    const created = await createQuoteDraft(
      {
        ...draftPayload({
          lines: [
            {
              kind: 'PRODUCT',
              label: 'Ligne détournée',
              description: null,
              quantity: 1,
              unitPrice: 100_000,
              requestItemId: foreignItemId,
            },
          ],
        }),
        requestNumber: mine.requestNumber,
      },
      staffUserId,
    );

    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.error.code).toBe('INVALID_INPUT');
  });

  it('refuses to draft for a request whose e-mail matches no account', async () => {
    const { requestNumber } = await submitRequest({
      contactEmail: `${PREFIX}-nobody@example.invalid`,
    });

    const created = await createQuoteDraft(
      { ...draftPayload(), requestNumber },
      staffUserId,
    );

    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.error.code).toBe('NO_CUSTOMER');
  });

  it('binds a guest request to the account whose address it names', async () => {
    const { requestNumber, requestId } = await submitRequest();

    const before = await prisma.customRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: { userId: true },
    });
    expect(before.userId).toBeNull();

    await createQuoteDraft({ ...draftPayload(), requestNumber }, staffUserId);

    const after = await prisma.customRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: { userId: true },
    });
    expect(after.userId).toBe(ownerUserId);
  });
});

/* ---------------------------------------------------------------------------
 * 7.2 — a sent quote is immutable
 * ------------------------------------------------------------------------ */

describe('a sent quote cannot be mutated (7.2)', () => {
  it('refuses an update through the service', async () => {
    const { quoteId } = await sentQuote();

    const updated = await updateQuoteDraft(
      quoteId,
      draftPayload({
        lines: [
          {
            kind: 'PRODUCT',
            label: 'Prix cassé',
            description: null,
            quantity: 1,
            unitPrice: 1,
            requestItemId: null,
          },
        ],
      }),
    );

    expect(updated.ok).toBe(false);
    if (!updated.ok) expect(updated.error.code).toBe('NOT_EDITABLE');
  });

  it('leaves the lines, the totals and the deposit exactly as sent', async () => {
    const { quoteId } = await sentQuote();
    const before = await findQuoteForStaff(quoteId);

    await updateQuoteDraft(
      quoteId,
      draftPayload({
        lines: [
          {
            kind: 'PRODUCT',
            label: 'Prix cassé',
            description: null,
            quantity: 1,
            unitPrice: 1,
            requestItemId: null,
          },
        ],
        customerMessage: 'Autre message',
        internalNotes: 'Autre note',
      }),
    );

    const after = await findQuoteForStaff(quoteId);

    expect(after?.subtotal).toBe(before?.subtotal);
    expect(after?.discountTotal).toBe(before?.discountTotal);
    expect(after?.shippingTotal).toBe(before?.shippingTotal);
    expect(after?.grandTotal).toBe(before?.grandTotal);
    expect(after?.depositRequired).toBe(before?.depositRequired);
    expect(after?.validUntil.getTime()).toBe(before?.validUntil.getTime());
    expect(after?.customerMessage).toBe(before?.customerMessage);
    expect(after?.items.map((item) => item.label)).toEqual(
      before?.items.map((item) => item.label),
    );
    expect(after?.items.map((item) => item.unitPrice)).toEqual(
      before?.items.map((item) => item.unitPrice),
    );
    expect(after?.items.map((item) => item.kind)).toEqual(
      before?.items.map((item) => item.kind),
    );
  });

  it('refuses to send the same quote twice', async () => {
    const { quoteId } = await sentQuote();
    const again = await sendQuoteToCustomer(quoteId, staffUserId);

    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe('NOT_SENDABLE');
  });
});

/* ---------------------------------------------------------------------------
 * 7.2 — versioning
 * ------------------------------------------------------------------------ */

describe('versioning (7.2)', () => {
  it('creates version 2 reusing the base number, and leaves version 1 intact', async () => {
    const first = await sentQuote();
    const before = await findQuoteForStaff(first.quoteId);

    const second = await createQuoteDraft(
      {
        ...draftPayload({
          lines: [
            {
              kind: 'PRODUCT',
              label: 'Nouveau prix',
              description: null,
              quantity: 2,
              unitPrice: 400_000,
              requestItemId: null,
            },
          ],
        }),
        requestNumber: first.requestNumber,
      },
      staffUserId,
    );

    expect(second.ok, second.ok ? '' : second.error.message).toBe(true);
    if (!second.ok) return;

    expect(second.value.version).toBe(2);
    expect(second.value.quoteNumber).toBe(`${first.quoteNumber}-v2`);

    const v1 = await findQuoteForStaff(first.quoteId);
    expect(v1?.grandTotal).toBe(before?.grandTotal);
    expect(v1?.items).toHaveLength(before?.items.length ?? -1);
  });

  it('supersedes version 1 when version 2 is sent, and never has two outstanding', async () => {
    const first = await sentQuote();

    const second = await createQuoteDraft(
      { ...draftPayload(), requestNumber: first.requestNumber },
      staffUserId,
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const sent = await sendQuoteToCustomer(second.value.quoteId, staffUserId);
    expect(sent.ok, sent.ok ? '' : sent.error.message).toBe(true);

    const versions = await listQuotesForRequest(first.requestId);
    const outstanding = versions.filter(
      (quote) => quote.status === 'SENT' || quote.status === 'VIEWED',
    );

    expect(outstanding).toHaveLength(1);
    expect(outstanding[0]!.version).toBe(2);
    expect(versions.find((quote) => quote.version === 1)?.status).toBe('SUPERSEDED');
  });

  it('keeps version 1 readable forever after being superseded', async () => {
    const first = await sentQuote();
    const before = await findQuoteForStaff(first.quoteId);

    const second = await createQuoteDraft(
      { ...draftPayload(), requestNumber: first.requestNumber },
      staffUserId,
    );
    if (!second.ok) throw new Error('draft failed');
    await sendQuoteToCustomer(second.value.quoteId, staffUserId);

    const v1 = await findQuoteForStaff(first.quoteId);
    expect(v1).not.toBeNull();
    expect(v1?.status).toBe('SUPERSEDED');
    expect(v1?.grandTotal).toBe(before?.grandTotal);
    expect(v1?.items.map((item) => item.unitPrice)).toEqual(
      before?.items.map((item) => item.unitPrice),
    );
  });

  it('refuses a second outstanding quote at the database, not only in code', async () => {
    const first = await sentQuote();

    // Bypassing the service entirely: this is what a bug or a stray script
    // would do, and the partial unique index is what stops it.
    await expect(
      prisma.quote.create({
        data: {
          quoteNumber: `Q-BYPASS-${Date.now()}`,
          requestId: first.requestId,
          userId: ownerUserId,
          createdByUserId: staffUserId,
          version: 99,
          status: 'SENT',
          currency: 'DZD',
          subtotal: 1,
          grandTotal: 1,
          validUntil: new Date(Date.now() + 86_400_000),
        },
      }),
    ).rejects.toThrow();
  });
});

/* ---------------------------------------------------------------------------
 * 7.2.1 and ADR-016 — the freeze
 * ------------------------------------------------------------------------ */

describe('sending freezes the configuration (7.2.1, ADR-016)', () => {
  it('writes frozenAt and every display snapshot in the send transaction', async () => {
    const { requestId } = await sentQuote();

    const item = await prisma.customRequestItem.findFirstOrThrow({
      where: { requestId },
      select: {
        customizationConfig: {
          select: {
            frozenAt: true,
            productNameSnapshot: true,
            placementLabel: true,
            embroiderySizeLabel: true,
            threadColorNames: true,
          },
        },
      },
    });

    const config = item.customizationConfig;
    expect(config.frozenAt).not.toBeNull();
    expect(config.productNameSnapshot).not.toBeNull();
    expect(config.placementLabel).not.toBeNull();
    expect(config.embroiderySizeLabel).not.toBeNull();
    expect(config.threadColorNames.length).toBeGreaterThan(0);
  });

  it('still describes what was quoted after the catalogue is renamed', async () => {
    const { requestNumber, requestId } = await sentQuote();

    const item = await prisma.customRequestItem.findFirstOrThrow({
      where: { requestId },
      select: {
        customizationConfig: {
          select: { designSurfaceImageId: true, designSurfaceLabel: true },
        },
      },
    });

    const imageId = item.customizationConfig.designSurfaceImageId!;
    const frozen = item.customizationConfig.designSurfaceLabel!;

    /*
     * The freeform equivalent of the old "rename the placement" test.
     *
     * A placement is now a face and a measurement on a photograph rather than
     * a row in a reference table, so the thing that can change underneath a
     * sent quote is the *calibration*. Re-measuring the blank must not rewrite
     * what somebody was quoted — that is ADR-016, and it is why the sentence is
     * frozen onto the configuration rather than recomputed on read.
     */
    try {
      await prisma.productImage.update({
        where: { id: imageId },
        data: { surfaceWidthMm: 1000, alt: 'Recalibré après le devis' },
      });

      const request = await findRequestForStaff(requestNumber);
      const summary = summariseConfigurations(request!);

      expect(summary[0]!.placement).toBe(frozen);
      expect(summary[0]!.placement).toContain('Devant');
    } finally {
      await prisma.productImage.update({
        where: { id: imageId },
        data: { surfaceWidthMm: 520, alt: 'Fixture de placement' },
      });
    }
  });

  it('does not let version 2 overwrite what version 1 froze', async () => {
    const first = await sentQuote();

    const frozenAtV1 = await prisma.customRequestItem.findFirstOrThrow({
      where: { requestId: first.requestId },
      select: { customizationConfig: { select: { frozenAt: true, id: true } } },
    });

    const second = await createQuoteDraft(
      { ...draftPayload(), requestNumber: first.requestNumber },
      staffUserId,
    );
    if (!second.ok) throw new Error('draft failed');
    await sendQuoteToCustomer(second.value.quoteId, staffUserId);

    const after = await prisma.customizationConfig.findUniqueOrThrow({
      where: { id: frozenAtV1.customizationConfig.id },
      select: { frozenAt: true },
    });

    expect(after.frozenAt?.getTime()).toBe(
      frozenAtV1.customizationConfig.frozenAt?.getTime(),
    );
  });
});

/* ---------------------------------------------------------------------------
 * Authorisation
 * ------------------------------------------------------------------------ */

describe('a quote belongs to one customer', () => {
  it('is invisible to another customer, and returns "not found" rather than "not yours"', async () => {
    const { quoteNumber } = await sentQuote();

    const stranger = await findQuoteForOwner({ quoteNumber, userId: strangerUserId });
    expect(stranger).toBeNull();

    const page = await getCustomerQuotePage({ quoteNumber, userId: strangerUserId });
    expect(page.ok).toBe(false);
    if (!page.ok) expect(page.error.code).toBe('QUOTE_NOT_FOUND');
  });

  it('cannot be accepted by another customer', async () => {
    const { quoteNumber, quoteId } = await sentQuote();

    const accepted = await acceptQuoteAsOwner({ quoteNumber, userId: strangerUserId });
    expect(accepted.ok).toBe(false);

    const quote = await findQuoteForStaff(quoteId);
    expect(quote?.status).toBe('SENT');
  });

  it('cannot be declined by another customer', async () => {
    const { quoteNumber, quoteId } = await sentQuote();

    const declined = await declineQuoteAsOwner({
      quoteNumber,
      userId: strangerUserId,
      reason: null,
    });

    expect(declined.ok).toBe(false);

    const quote = await findQuoteForStaff(quoteId);
    expect(quote?.status).toBe('SENT');
  });

  it('never exposes internal notes on the customer projection', async () => {
    const { quoteNumber } = await sentQuote();
    const quote = await findQuoteForOwner({ quoteNumber, userId: ownerUserId });

    expect(quote).not.toBeNull();
    expect(Object.keys(quote!)).not.toContain('internalNotes');
    expect(JSON.stringify(quote)).not.toContain('Marge serrée');
  });

  it('hides a draft from the customer’s list entirely', async () => {
    const { requestNumber } = await submitRequest();
    const created = await createQuoteDraft(
      { ...draftPayload(), requestNumber },
      staffUserId,
    );
    if (!created.ok) throw new Error('draft failed');

    const quotes = await listQuotesForCustomer(ownerUserId);
    expect(quotes.map((quote) => quote.quoteNumber)).not.toContain(
      created.value.quoteNumber,
    );
  });
});

/* ---------------------------------------------------------------------------
 * 7.3 — viewing
 * ------------------------------------------------------------------------ */

describe('viewing (7.3)', () => {
  it('marks the quote VIEWED on the owner’s first read, and only once', async () => {
    const { quoteNumber, quoteId } = await sentQuote();

    await viewQuoteAsOwner({ quoteNumber, userId: ownerUserId });
    const first = await findQuoteForStaff(quoteId);
    expect(first?.status).toBe('VIEWED');
    const viewedAt = first?.viewedAt;

    await viewQuoteAsOwner({ quoteNumber, userId: ownerUserId });
    const second = await findQuoteForStaff(quoteId);
    expect(second?.viewedAt?.getTime()).toBe(viewedAt?.getTime());
  });

  it('is not marked VIEWED by a staff read', async () => {
    const { quoteId } = await sentQuote();

    await findQuoteForStaff(quoteId);
    const quote = await findQuoteForStaff(quoteId);

    expect(quote?.status).toBe('SENT');
    expect(quote?.viewedAt).toBeNull();
  });
});

/* ---------------------------------------------------------------------------
 * 7.6 — acceptance
 * ------------------------------------------------------------------------ */

describe('acceptance (7.6)', () => {
  it('creates a quote-bound cart holding exactly the quote’s priced lines', async () => {
    const { quoteNumber, quoteId } = await sentQuote();

    const accepted = await acceptQuoteAsOwner({ quoteNumber, userId: ownerUserId });
    expect(accepted.ok, accepted.ok ? '' : accepted.error.message).toBe(true);
    if (!accepted.ok) return;

    const cart = await prisma.cart.findUniqueOrThrow({
      where: { id: accepted.value.cartId },
      select: {
        kind: true,
        status: true,
        userId: true,
        quoteId: true,
        couponId: true,
        items: {
          select: {
            kind: true,
            lockedUnitPrice: true,
            quantity: true,
            quoteItemId: true,
          },
          orderBy: { position: 'asc' },
        },
      },
    });

    expect(cart.kind).toBe('QUOTE_BOUND');
    expect(cart.userId).toBe(ownerUserId);
    expect(cart.quoteId).toBe(quoteId);
    expect(cart.couponId).toBeNull();

    // 2.6.5: SHIPPING and DISCOUNT become order totals, not cart lines. The
    // product and the setup fee do become lines.
    expect(cart.items).toHaveLength(2);
    expect(cart.items.map((item) => item.kind)).toEqual(['CUSTOM', 'FEE']);
    expect(cart.items[0]!.lockedUnitPrice).toBe(350_000);
    expect(cart.items[1]!.lockedUnitPrice).toBe(120_000);
    expect(cart.items.every((item) => item.quoteItemId !== null)).toBe(true);
  });

  it('moves both the quote and the request, and writes the events', async () => {
    const { quoteNumber, quoteId, requestId } = await sentQuote();

    await acceptQuoteAsOwner({ quoteNumber, userId: ownerUserId });

    const quote = await findQuoteForStaff(quoteId);
    expect(quote?.status).toBe('ACCEPTED');
    expect(quote?.acceptedAt).not.toBeNull();
    expect(quote?.acceptanceValidUntil).not.toBeNull();

    const request = await prisma.customRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: { status: true },
    });
    expect(request.status).toBe('ACCEPTED');

    const events = await listRequestEvents({ requestId, customerVisibleOnly: false });
    expect(events.some((event) => event.toStatus === 'ACCEPTED')).toBe(true);
  });

  it('sets the acceptance window from the settings value', async () => {
    const { quoteNumber, quoteId } = await sentQuote();
    const before = Date.now();

    await acceptQuoteAsOwner({ quoteNumber, userId: ownerUserId });

    const quote = await findQuoteForStaff(quoteId);
    const setting = await prisma.setting.findUniqueOrThrow({
      where: { key: 'custom_orders.acceptanceValidityDays' },
      select: { value: true },
    });

    const days = Number.parseInt(setting.value, 10);
    const window = quote!.acceptanceValidUntil!.getTime() - before;

    // Within a second of the documented window, allowing for the round trip.
    expect(Math.abs(window - days * 86_400_000)).toBeLessThan(5_000);
  });

  it('is idempotent: accepting twice yields the same one cart', async () => {
    const { quoteNumber, quoteId } = await sentQuote();

    const first = await acceptQuoteAsOwner({ quoteNumber, userId: ownerUserId });
    const second = await acceptQuoteAsOwner({ quoteNumber, userId: ownerUserId });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(second.value.cartId).toBe(first.value.cartId);
    expect(second.value.alreadyAccepted).toBe(true);

    const carts = await prisma.cart.count({ where: { quoteId } });
    expect(carts).toBe(1);
  });

  it('produces exactly one cart under two simultaneous acceptances', async () => {
    const { quoteNumber, quoteId } = await sentQuote();

    const results = await Promise.all([
      acceptQuoteAsOwner({ quoteNumber, userId: ownerUserId }),
      acceptQuoteAsOwner({ quoteNumber, userId: ownerUserId }),
      acceptQuoteAsOwner({ quoteNumber, userId: ownerUserId }),
    ]);

    // Every caller gets an answer it can act on, and they all name one cart.
    const cartIds = new Set(
      results.filter((result) => result.ok).map((result) => result.value.cartId),
    );

    expect(cartIds.size).toBe(1);
    expect(await prisma.cart.count({ where: { quoteId } })).toBe(1);

    const quote = await findQuoteForStaff(quoteId);
    expect(quote?.status).toBe('ACCEPTED');
  });

  it('refuses an expired quote, whether or not the sweep has run', async () => {
    const { quoteNumber, quoteId } = await sentQuote();

    // Push validity into the past without touching the status: this is exactly
    // the state a stalled expiry job leaves behind.
    await backdateValidity(quoteId);

    const accepted = await acceptQuoteAsOwner({ quoteNumber, userId: ownerUserId });
    expect(accepted.ok).toBe(false);
    if (!accepted.ok) expect(accepted.error.code).toBe('NOT_ACCEPTABLE');

    expect(await prisma.cart.count({ where: { quoteId } })).toBe(0);
  });

  it('refuses a superseded quote', async () => {
    const first = await sentQuote();

    const second = await createQuoteDraft(
      { ...draftPayload(), requestNumber: first.requestNumber },
      staffUserId,
    );
    if (!second.ok) throw new Error('draft failed');
    await sendQuoteToCustomer(second.value.quoteId, staffUserId);

    const accepted = await acceptQuoteAsOwner({
      quoteNumber: first.quoteNumber,
      userId: ownerUserId,
    });

    expect(accepted.ok).toBe(false);
  });

  it('refuses a cancelled quote', async () => {
    const { quoteNumber, quoteId } = await sentQuote();

    const cancelled = await cancelQuoteAsStaff(quoteId, staffUserId);
    expect(cancelled.ok).toBe(true);

    const accepted = await acceptQuoteAsOwner({ quoteNumber, userId: ownerUserId });
    expect(accepted.ok).toBe(false);
  });

  it('refuses to accept a quote already declined', async () => {
    const { quoteNumber } = await sentQuote();

    await declineQuoteAsOwner({ quoteNumber, userId: ownerUserId, reason: 'Trop cher' });
    const accepted = await acceptQuoteAsOwner({ quoteNumber, userId: ownerUserId });

    expect(accepted.ok).toBe(false);
  });
});

/* ---------------------------------------------------------------------------
 * 7.8 — decline
 * ------------------------------------------------------------------------ */

describe('decline (7.8)', () => {
  it('records the reason and moves the request, without deleting anything', async () => {
    const { quoteNumber, quoteId, requestId } = await sentQuote();

    const declined = await declineQuoteAsOwner({
      quoteNumber,
      userId: ownerUserId,
      reason: 'Le délai ne convient pas.',
    });

    expect(declined.ok).toBe(true);

    const quote = await findQuoteForStaff(quoteId);
    expect(quote?.status).toBe('REJECTED');
    expect(quote?.rejectionReason).toBe('Le délai ne convient pas.');
    expect(quote?.items.length).toBeGreaterThan(0);

    const request = await prisma.customRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: { status: true },
    });
    expect(request.status).toBe('REJECTED');
  });

  it('cannot be declined twice', async () => {
    const { quoteNumber } = await sentQuote();

    await declineQuoteAsOwner({ quoteNumber, userId: ownerUserId, reason: null });
    const again = await declineQuoteAsOwner({
      quoteNumber,
      userId: ownerUserId,
      reason: null,
    });

    expect(again.ok).toBe(false);
  });
});

/* ---------------------------------------------------------------------------
 * 5A — the quote-bound cart cannot be escaped
 * ------------------------------------------------------------------------ */

describe('a quote-bound cart is not a cart (5A.1)', () => {
  async function acceptedCart() {
    const { quoteNumber, quoteId, requestId } = await sentQuote();
    const accepted = await acceptQuoteAsOwner({ quoteNumber, userId: ownerUserId });
    if (!accepted.ok) throw new Error('acceptance failed');

    return { cartId: accepted.value.cartId, quoteId, quoteNumber, requestId };
  }

  it('refuses an added catalogue product, which lands in the standard cart instead', async () => {
    const { cartId } = await acceptedCart();
    const owner = { kind: 'user' as const, userId: ownerUserId };

    const variant = await prisma.productVariant.findFirstOrThrow({
      where: { product: { slug: MADE_TO_ORDER_SLUG }, isActive: true },
      select: { sku: true },
    });

    const added = await addToCart(owner, {
      productSlug: MADE_TO_ORDER_SLUG,
      variantSku: variant.sku,
      quantity: 1,
    });

    // The add succeeds — into a *standard* cart, which is 5A.2's point — and
    // the quote-bound cart is untouched.
    expect(added.ok).toBe(true);
    if (added.ok) expect(added.value.cartId).not.toBe(cartId);

    const lines = await prisma.cartItem.count({ where: { cartId } });
    expect(lines).toBe(2);
  });

  it('refuses a quantity change on one of its lines', async () => {
    const { cartId } = await acceptedCart();
    const owner = { kind: 'user' as const, userId: ownerUserId };

    const line = await prisma.cartItem.findFirstOrThrow({
      where: { cartId },
      select: { id: true, quantity: true },
    });

    const updated = await updateCartLine(owner, { lineId: line.id, quantity: 99 });
    expect(updated.ok).toBe(false);

    const after = await prisma.cartItem.findUniqueOrThrow({
      where: { id: line.id },
      select: { quantity: true },
    });
    expect(after.quantity).toBe(line.quantity);
  });

  it('refuses a line removal', async () => {
    const { cartId } = await acceptedCart();
    const owner = { kind: 'user' as const, userId: ownerUserId };

    const line = await prisma.cartItem.findFirstOrThrow({
      where: { cartId },
      select: { id: true },
    });

    const removed = await removeCartLine(owner, { lineId: line.id });
    expect(removed.ok).toBe(false);
    expect(await prisma.cartItem.count({ where: { cartId } })).toBe(2);
  });

  it('cannot carry a coupon, by database constraint (5A.4)', async () => {
    const { cartId } = await acceptedCart();

    const coupon = await prisma.coupon.create({
      data: {
        code: `PHASE10-${Date.now()}`,
        type: 'PERCENTAGE',
        value: 1_000,
        isActive: true,
        startsAt: new Date(),
      },
      select: { id: true },
    });

    try {
      await expect(
        prisma.cart.update({ where: { id: cartId }, data: { couponId: coupon.id } }),
      ).rejects.toThrow();
    } finally {
      await prisma.coupon.delete({ where: { id: coupon.id } });
    }
  });

  it('cannot be turned into an ordinary cart', async () => {
    const { cartId } = await acceptedCart();

    // `carts_standard_check` requires a STANDARD cart to name no quote, so the
    // conversion cannot be done by flipping the kind. There is no application
    // path to it either; this is the floor underneath that.
    await expect(
      prisma.cart.update({ where: { id: cartId }, data: { kind: 'STANDARD' } }),
    ).rejects.toThrow();

    const cart = await prisma.cart.findUniqueOrThrow({
      where: { id: cartId },
      select: { kind: true, quoteId: true },
    });

    expect(cart.kind).toBe('QUOTE_BOUND');
    expect(cart.quoteId).not.toBeNull();
  });

  it('is invisible to another customer', async () => {
    const { cartId } = await acceptedCart();

    const view = await getQuoteCheckoutView(
      { kind: 'user', userId: strangerUserId },
      cartId,
    );

    expect(view.ok).toBe(false);
    if (!view.ok) expect(view.error).toBe('CART_NOT_FOUND');
  });

  it('shows the accepted total, not a recomputed one', async () => {
    const { cartId, quoteId } = await acceptedCart();

    const view = await getQuoteCheckoutView(
      { kind: 'user', userId: ownerUserId },
      cartId,
    );

    expect(view.ok).toBe(true);
    if (!view.ok) return;

    const quote = await findQuoteForStaff(quoteId);
    expect(view.value.grandTotal).toBe(quote?.grandTotal);
    expect(view.value.shippingTotal).toBe(quote?.shippingTotal);
    expect(view.value.discountTotal).toBe(quote?.discountTotal);
    expect(view.value.depositRequired).toBe(quote?.depositRequired);
  });

  it('places an order whose total equals the quote exactly (5A.6)', async () => {
    const { cartId, quoteId } = await acceptedCart();

    const placed = await placeOrderFromCart(
      { kind: 'user', userId: ownerUserId },
      {
        contactName: 'Amina Bensalem',
        contactEmail: ownerEmail,
        contactPhone: '0555123456',
        wilayaCode: ALGER,
        communeName: 'Hydra',
        addressLine: '12 rue des Frères Bouadou',
        deliveryType: 'HOME',
        paymentMethod: 'BANK_TRANSFER',
        customerNote: null,
        termsAccepted: true,
      },
      { cartId },
    );

    expect(placed.ok, placed.ok ? '' : placed.error).toBe(true);
    if (!placed.ok) return;

    createdOrderNumbers.push(placed.value.orderNumber);

    const quote = await findQuoteForStaff(quoteId);
    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: placed.value.orderNumber },
      select: {
        grandTotal: true,
        shippingTotal: true,
        discountTotal: true,
        depositRequired: true,
        shippingRateId: true,
        shippingRateLabel: true,
        items: { select: { kind: true, feeKind: true, quantity: true } },
      },
    });

    expect(order.grandTotal).toBe(quote!.grandTotal);
    expect(order.shippingTotal).toBe(quote!.shippingTotal);
    expect(order.discountTotal).toBe(quote!.discountTotal);
    // 5.5.1: copied from the quote, never recomputed.
    expect(order.depositRequired).toBe(quote!.depositRequired);
    // 4.6 / 5A.3: quoted delivery, no rate lookup.
    expect(order.shippingRateId).toBeNull();
    expect(order.shippingRateLabel).toBe('Livraison devisée');
    expect(order.items.find((item) => item.kind === 'FEE')?.feeKind).toBe('SETUP_FEE');
  });

  it('refuses checkout once the acceptance window has lapsed (7.10.1)', async () => {
    const { cartId, quoteId } = await acceptedCart();

    await prisma.quote.update({
      where: { id: quoteId },
      data: { acceptanceValidUntil: new Date(Date.now() - 1_000) },
    });

    const placed = await placeOrderFromCart(
      { kind: 'user', userId: ownerUserId },
      {
        contactName: 'Amina Bensalem',
        contactEmail: ownerEmail,
        contactPhone: '0555123456',
        wilayaCode: ALGER,
        communeName: 'Hydra',
        addressLine: '12 rue des Frères Bouadou',
        deliveryType: 'HOME',
        paymentMethod: 'BANK_TRANSFER',
        customerNote: null,
        termsAccepted: true,
      },
      { cartId },
    );

    expect(placed.ok).toBe(false);
    if (!placed.ok) expect(placed.error).toBe('QUOTE_ACCEPTANCE_LAPSED');

    // And the lazy check invalidated the cart on its way out (7.10.2).
    const cart = await prisma.cart.findUniqueOrThrow({
      where: { id: cartId },
      select: { status: true },
    });
    expect(cart.status).toBe('INVALIDATED');
  });
});

/* ---------------------------------------------------------------------------
 * 7.4 and 7.10.2 — the sweeps
 * ------------------------------------------------------------------------ */

describe('the expiry sweeps agree with the lazy checks', () => {
  it('expires an outstanding quote past its validity', async () => {
    const { quoteId } = await sentQuote();

    await backdateValidity(quoteId);

    await expireOutstandingQuotes();

    const quote = await findQuoteForStaff(quoteId);
    expect(quote?.status).toBe('EXPIRED');
  });

  it('leaves a quote inside its validity alone', async () => {
    const { quoteId } = await sentQuote();

    await expireOutstandingQuotes();

    const quote = await findQuoteForStaff(quoteId);
    expect(quote?.status).toBe('SENT');
  });

  it('invalidates a quote-bound cart past its acceptance window', async () => {
    const { quoteNumber, quoteId } = await sentQuote();
    const accepted = await acceptQuoteAsOwner({ quoteNumber, userId: ownerUserId });
    if (!accepted.ok) throw new Error('acceptance failed');

    await prisma.cart.update({
      where: { id: accepted.value.cartId },
      data: { quoteValidUntil: new Date(Date.now() - 1_000) },
    });
    await prisma.quote.update({
      where: { id: quoteId },
      data: { acceptanceValidUntil: new Date(Date.now() - 1_000) },
    });

    await invalidateLapsedQuoteCarts();

    const cart = await prisma.cart.findUniqueOrThrow({
      where: { id: accepted.value.cartId },
      select: { status: true },
    });
    expect(cart.status).toBe('INVALIDATED');
  });

  it('still reads as expired to the customer before the sweep runs', async () => {
    const { quoteNumber, quoteId } = await sentQuote();

    await backdateValidity(quoteId);

    const page = await getCustomerQuotePage({ quoteNumber, userId: ownerUserId });
    expect(page.ok).toBe(true);
    if (!page.ok) return;

    expect(page.value.quote.status).toBe('EXPIRED');
    expect(page.value.quote.acceptable).toBe(false);

    // The stored row has *not* been expired: it is still outstanding, and the
    // customer was told otherwise by the lazy check alone. (Reading it marked
    // it VIEWED, per 7.3 — that is the view, not the expiry.)
    const stored = await findQuoteForStaff(quoteId);
    expect(stored?.status).toBe('VIEWED');
  });
});

/* ---------------------------------------------------------------------------
 * 6.7 — MESSAGE is not NEEDS_INFO
 * ------------------------------------------------------------------------ */

describe('messages and information requests (6.7)', () => {
  it('leaves the status alone when a message is posted', async () => {
    const { requestNumber, requestId } = await submitRequest();

    const before = await prisma.customRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: { status: true },
    });

    const posted = await postRequestMessage({
      requestNumber,
      actorType: 'ADMIN',
      actorUserId: staffUserId,
      message: 'Bonjour, nous étudions votre demande.',
      internal: false,
    });

    expect(posted.ok).toBe(true);

    const after = await prisma.customRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: { status: true, needsInfoReason: true },
    });

    expect(after.status).toBe(before.status);
    expect(after.needsInfoReason).toBeNull();
  });

  it('blocks the request and records the reason for NEEDS_INFO', async () => {
    const { requestNumber, requestId } = await submitRequest();

    const moved = await transitionRequest({
      requestNumber,
      to: 'NEEDS_INFO',
      actor: 'STAFF',
      actorUserId: staffUserId,
      needsInfoReason: 'Il nous faut le logo en vectoriel.',
    });

    expect(moved.ok, moved.ok ? '' : moved.error.message).toBe(true);

    const request = await prisma.customRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: { status: true, needsInfoReason: true },
    });

    expect(request.status).toBe('NEEDS_INFO');
    expect(request.needsInfoReason).toBe('Il nous faut le logo en vectoriel.');
  });

  it('refuses NEEDS_INFO with no reason', async () => {
    const { requestNumber } = await submitRequest();

    const moved = await transitionRequest({
      requestNumber,
      to: 'NEEDS_INFO',
      actor: 'STAFF',
      actorUserId: staffUserId,
      needsInfoReason: '   ',
    });

    expect(moved.ok).toBe(false);
    if (!moved.ok) expect(moved.error.code).toBe('INVALID_TRANSITION');
  });

  it('clears the block when the request returns to review', async () => {
    const { requestNumber, requestId } = await submitRequest();

    await transitionRequest({
      requestNumber,
      to: 'NEEDS_INFO',
      actor: 'STAFF',
      actorUserId: staffUserId,
      needsInfoReason: 'Il nous faut le logo en vectoriel.',
    });

    const back = await transitionRequest({
      requestNumber,
      to: 'IN_REVIEW',
      actor: 'STAFF',
      actorUserId: staffUserId,
    });

    expect(back.ok).toBe(true);

    const request = await prisma.customRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: { status: true, needsInfoReason: true },
    });

    expect(request.status).toBe('IN_REVIEW');
    expect(request.needsInfoReason).toBeNull();
  });

  it('refuses a transition the actor table forbids', async () => {
    const { requestNumber } = await submitRequest();

    const moved = await transitionRequest({
      requestNumber,
      to: 'ACCEPTED',
      actor: 'STAFF',
      actorUserId: staffUserId,
    });

    expect(moved.ok).toBe(false);
  });

  it('keeps an internal note out of the customer’s timeline', async () => {
    const { requestNumber, requestId } = await submitRequest();

    await postRequestMessage({
      requestNumber,
      actorType: 'ADMIN',
      actorUserId: staffUserId,
      message: 'Client difficile, prévoir une marge.',
      internal: true,
    });

    const staffView = await listRequestEvents({ requestId, customerVisibleOnly: false });
    const customerView = await listRequestEvents({
      requestId,
      customerVisibleOnly: true,
    });

    expect(staffView.some((event) => event.type === 'INTERNAL_NOTE')).toBe(true);
    expect(customerView.some((event) => event.type === 'INTERNAL_NOTE')).toBe(false);
    expect(JSON.stringify(customerView)).not.toContain('Client difficile');
  });

  it('refuses an empty message', async () => {
    const { requestNumber } = await submitRequest();

    const posted = await postRequestMessage({
      requestNumber,
      actorType: 'ADMIN',
      actorUserId: staffUserId,
      message: '   ',
      internal: false,
    });

    expect(posted.ok).toBe(false);
  });
});

/* ---------------------------------------------------------------------------
 * Sending moves the request, and cancelling puts it back
 * ------------------------------------------------------------------------ */

describe('sending and cancelling', () => {
  it('moves the request to QUOTED and writes a QUOTE_SENT event', async () => {
    const { requestId } = await sentQuote();

    const request = await prisma.customRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: { status: true, quotedAt: true },
    });

    expect(request.status).toBe('QUOTED');
    expect(request.quotedAt).not.toBeNull();

    const events = await listRequestEvents({ requestId, customerVisibleOnly: true });
    expect(events.some((event) => event.type === 'QUOTE_SENT')).toBe(true);
  });

  it('returns the request to IN_REVIEW when the outstanding quote is cancelled', async () => {
    const { quoteId, requestId } = await sentQuote();

    const cancelled = await cancelQuoteAsStaff(quoteId, staffUserId);
    expect(cancelled.ok).toBe(true);

    const quote = await findQuoteForStaff(quoteId);
    expect(quote?.status).toBe('CANCELLED');

    const request = await prisma.customRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: { status: true },
    });
    expect(request.status).toBe('IN_REVIEW');
  });

  it('refuses to cancel an accepted quote', async () => {
    const { quoteNumber, quoteId } = await sentQuote();
    await acceptQuoteAsOwner({ quoteNumber, userId: ownerUserId });

    const cancelled = await cancelQuoteAsStaff(quoteId, staffUserId);
    expect(cancelled.ok).toBe(false);
  });
});
