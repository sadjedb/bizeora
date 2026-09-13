/**
 * Cart, checkout and order placement, against the real database.
 *
 * Phase 7's submission boundary was the first customer-facing write; this is
 * the first one that takes money, so these tests are written the same way:
 * mostly adversarial, and each one names the invariant it defends.
 *
 * The four that matter most cannot be tested any other way than against
 * PostgreSQL — the conditional stock reservation, the sequence-backed order
 * number under concurrency, the single-order-per-cart claim, and the rollback
 * of a failed placement. A mock cannot have a race.
 */

import dotenv from 'dotenv';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

dotenv.config({ path: ['.env.local', '.env'], quiet: true });

const { addToCart, getCartView, removeCartLine, updateCartLine } =
  await import('../../src/server/services/cart-service');
const { placeOrderFromCart, quoteDelivery } =
  await import('../../src/server/services/checkout-service');
const { placeOrder } = await import('../../src/server/repositories/order-repository');
const { prisma } = await import('../../src/lib/db/client');

/** Seeded, customisable, and the only product with a customisation profile. */
const CUSTOMISABLE_SLUG = 't-shirt-brode-classique';

/**
 * A tracked product this file owns, with far more stock than it can consume.
 *
 * The stock-path tests used to share the seeded t-shirt's twelve units and
 * released them only in `afterAll`, so they competed with each other and with
 * anything else touching that variant — a suite whose passing depended on the
 * order it ran in. Owning the scarcity means a test that is not about running
 * out never runs out.
 */
let stockFixture: LimitedVariant | null = null;
function stockSlug(): string {
  if (!stockFixture) throw new Error('stock fixture not created');
  return stockFixture.productSlug;
}
const CAP_SLUG = 'casquette-brodee';
const DRAFT_SLUG = 'echantillon-interne-non-publie';
/** Seeded `MADE_TO_ORDER`, so it is always available and never reserved. */
const MADE_TO_ORDER_SLUG = 'tote-bag-toile-epaisse';

/** Alger — the Nord zone: HOME 60 000, DESK 40 000, no free-delivery threshold. */
const ALGER = 16;
/** Outside the 1–58 range: refused by the schema, before any lookup. */
const UNSERVED_WILAYA = 999;
/** A real wilaya whose zone mapping one test removes and restores. */
const UNMAPPED_TEST_WILAYA = 58;

let token = 0;
function guest() {
  token += 1;
  return { kind: 'guest' as const, anonymousToken: `test-cart-${Date.now()}-${token}` };
}

async function skuFor(slug: string, index = 0): Promise<string> {
  const variants = await prisma.productVariant.findMany({
    where: { product: { slug }, isActive: true },
    select: { sku: true },
    orderBy: { position: 'asc' },
  });
  return variants[index]!.sku;
}

function checkoutPayload(overrides: Record<string, unknown> = {}) {
  return {
    contactName: 'Amina Bensalem',
    contactEmail: 'amina@example.invalid',
    contactPhone: '0555123456',
    wilayaCode: ALGER,
    communeName: 'Hydra',
    addressLine: '12 rue des Frères Bouadou',
    deliveryType: 'HOME',
    paymentMethod: 'COD',
    customerNote: null,
    termsAccepted: true,
    ...overrides,
  };
}

const createdCartTokens: string[] = [];
const createdOrderNumbers: string[] = [];

async function stockingCart(slug = stockSlug(), quantity = 1) {
  const owner = guest();
  createdCartTokens.push(owner.anonymousToken);

  const sku = await skuFor(slug);
  const added = await addToCart(owner, { productSlug: slug, variantSku: sku, quantity });
  expect(added.ok, added.ok ? '' : added.error).toBe(true);

  return { owner, sku };
}

async function place(owner: Parameters<typeof placeOrderFromCart>[0], overrides = {}) {
  const result = await placeOrderFromCart(owner, checkoutPayload(overrides));
  if (result.ok) createdOrderNumbers.push(result.value.orderNumber);
  return result;
}

beforeAll(async () => {
  // A run that crashes mid-test leaves its fixtures behind, and a leftover
  // product in the catalogue is a defect for every other suite. Clean before
  // as well as after, so one bad run cannot poison the next.
  await purgeStaleFixtures();
  stockFixture = await createLimitedVariant(5_000);
});

beforeEach(() => {
  token += 1;
});

afterAll(async () => {
  // Release anything these tests reserved, then remove what they created.
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
  await prisma.cart.deleteMany({
    where: { anonymousToken: { in: createdCartTokens } },
  });

  if (stockFixture) await cleanUpLimitedVariant(stockFixture);
  await prisma.$disconnect();
});

/* ---------------------------------------------------------------------------
 * Cart
 * ------------------------------------------------------------------------ */

describe('the cart refuses what it must not trust', () => {
  it('refuses a product that does not exist', async () => {
    const result = await addToCart(guest(), {
      productSlug: 'inexistant',
      variantSku: 'X-1',
      quantity: 1,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('PRODUCT_NOT_FOUND');
  });

  it('refuses an unpublished product, even with a real slug', async () => {
    const sku = await prisma.productVariant.findFirst({
      where: { product: { slug: DRAFT_SLUG } },
      select: { sku: true },
    });

    const result = await addToCart(guest(), {
      productSlug: DRAFT_SLUG,
      variantSku: sku?.sku ?? 'X-1',
      quantity: 1,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('PRODUCT_NOT_FOUND');
  });

  it('refuses a variant belonging to another product', async () => {
    // The SKU is real; it just is not this product's, and the variant is
    // matched *within* the product rather than globally.
    const foreign = await skuFor(CAP_SLUG);

    const result = await addToCart(guest(), {
      productSlug: stockSlug(),
      variantSku: foreign,
      quantity: 1,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('PRODUCT_NOT_FOUND');
  });

  it('refuses an inactive variant', async () => {
    const sku = await skuFor(stockSlug());
    await prisma.productVariant.updateMany({ where: { sku }, data: { isActive: false } });

    try {
      const result = await addToCart(guest(), {
        productSlug: stockSlug(),
        variantSku: sku,
        quantity: 1,
      });

      expect(result.ok).toBe(false);
    } finally {
      await prisma.productVariant.updateMany({
        where: { sku },
        data: { isActive: true },
      });
    }
  });

  it('refuses an invalid quantity', async () => {
    const sku = await skuFor(stockSlug());

    for (const quantity of [0, -5, 1.5, 1000, Number.NaN]) {
      const result = await addToCart(guest(), {
        productSlug: stockSlug(),
        variantSku: sku,
        quantity,
      });

      expect(result.ok, `quantity ${quantity}`).toBe(false);
    }
  });

  it('caps a quantity at the stock that exists rather than promising more', async () => {
    // Its own scarce variant: the cap only means something against a number
    // small enough to hit, and 10.3 says nothing is reserved by adding, so the
    // cap is the only thing keeping the cart honest.
    const scarce = await createLimitedVariant(3);

    try {
      const owner = guest();
      createdCartTokens.push(owner.anonymousToken);

      const result = await addToCart(owner, {
        productSlug: scarce.productSlug,
        variantSku: scarce.sku,
        quantity: 999,
      });

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.quantity).toBe(3);
    } finally {
      await cleanUpLimitedVariant(scarce);
    }
  });

  it('increments rather than duplicating when the same variant is added twice', async () => {
    const { owner } = await stockingCart(stockSlug(), 2);
    const sku = await skuFor(stockSlug());

    await addToCart(owner, {
      productSlug: stockSlug(),
      variantSku: sku,
      quantity: 3,
    });

    const cart = await getCartView(owner);
    expect(cart?.lines).toHaveLength(1);
    expect(cart?.lines[0]!.quantity).toBe(5);
  });
});

describe('the cart never takes money from the client', () => {
  it('ignores a price, subtotal, discount, shipping or total in the payload', async () => {
    const owner = guest();
    createdCartTokens.push(owner.anonymousToken);
    const sku = await skuFor(stockSlug());

    const tampered = await addToCart(owner, {
      productSlug: stockSlug(),
      variantSku: sku,
      quantity: 2,
      // None of these exist in the schema, so they are stripped, not believed.
      price: 1,
      unitPrice: 1,
      subtotal: 1,
      discountTotal: 99_999,
      shippingTotal: 0,
      grandTotal: 1,
      lockedUnitPrice: 1,
    });

    expect(tampered.ok).toBe(true);

    const cart = await getCartView(owner);
    const variant = await prisma.productVariant.findFirstOrThrow({
      where: { sku },
      select: { priceOverride: true, product: { select: { basePrice: true } } },
    });

    const expected = variant.priceOverride ?? variant.product.basePrice;
    expect(cart?.lines[0]!.unitPrice).toBe(expected);
    expect(cart?.totals.subtotal).toBe(expected * 2);
    expect(cart?.totals.discountTotal).toBe(0);
  });

  it('prices two identical carts identically, whatever the client sent', async () => {
    const plain = await stockingCart(stockSlug(), 2);

    const owner = guest();
    createdCartTokens.push(owner.anonymousToken);
    const sku = await skuFor(stockSlug());
    await addToCart(owner, {
      productSlug: stockSlug(),
      variantSku: sku,
      quantity: 2,
      grandTotal: 1,
      discountTotal: 5_000,
    });

    const a = await getCartView(plain.owner);
    const b = await getCartView(owner);
    expect(b?.totals).toEqual(a?.totals);
  });

  it('refuses a line id that belongs to someone else', async () => {
    const mine = await stockingCart();
    const theirs = await stockingCart();

    const theirCart = await getCartView(theirs.owner);
    const theirLineId = theirCart!.lines[0]!.id;

    // My owner, their line: the line is looked up inside my cart, so it is
    // simply not there.
    const updated = await updateCartLine(mine.owner, {
      lineId: theirLineId,
      quantity: 5,
    });
    expect(updated.ok).toBe(false);
    if (!updated.ok) expect(updated.error).toBe('LINE_NOT_FOUND');

    const removed = await removeCartLine(mine.owner, { lineId: theirLineId });
    expect(removed.ok).toBe(false);

    // Their cart is untouched.
    const after = await getCartView(theirs.owner);
    expect(after?.lines).toHaveLength(1);
  });
});

/* ---------------------------------------------------------------------------
 * Delivery
 * ------------------------------------------------------------------------ */

describe('delivery is resolved server-side', () => {
  it('quotes both delivery types from the rate table', async () => {
    const { owner } = await stockingCart();
    const result = await quoteDelivery(owner, ALGER);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const home = result.value.find((option) => option.deliveryType === 'HOME');
    const desk = result.value.find((option) => option.deliveryType === 'DESK');

    // The seeded Nord rates. They moved in Phase 14.6: the seed wrote them as
    // centimes while every other money column in this application is whole
    // dinars, so a checkout charged 60 000 DA of delivery on a 6 400 DA order.
    expect(home?.amount).toBe(600);
    expect(desk?.amount).toBe(400);
    // Each option carries its own total, so the browser adds nothing up.
    expect(home!.grandTotal).toBe(home!.subtotal - home!.discountTotal + home!.amount);
  });

  it('refuses a wilaya nobody delivers to (4.4)', async () => {
    const { owner } = await stockingCart();
    const result = await quoteDelivery(owner, UNSERVED_WILAYA);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('WILAYA_NOT_SERVED');
  });

  it('offers no free delivery when the rate carries no threshold (4.2)', async () => {
    const { owner } = await stockingCart(stockSlug(), 5);
    const result = await quoteDelivery(owner, ALGER);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const option of result.value) {
      expect(option.isFree).toBe(false);
      expect(option.remainingForFree).toBeNull();
    }
  });
});

/* ---------------------------------------------------------------------------
 * Placement
 * ------------------------------------------------------------------------ */

describe('placing an order', () => {
  it('creates an order, its items, its address and its first history row', async () => {
    const { owner } = await stockingCart(stockSlug(), 2);
    const result = await place(owner);

    expect(result.ok, result.ok ? '' : result.error).toBe(true);
    if (!result.ok) return;

    expect(result.value.orderNumber).toMatch(/^CMD-\d{4}-\d{4,}$/);

    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: result.value.orderNumber },
      select: {
        status: true,
        paymentStatus: true,
        subtotal: true,
        discountTotal: true,
        shippingTotal: true,
        grandTotal: true,
        depositRequired: true,
        shippingRateId: true,
        shippingRateLabel: true,
        contactEmail: true,
        items: {
          select: {
            kind: true,
            nameSnapshot: true,
            variantLabelSnapshot: true,
            skuSnapshot: true,
            unitPrice: true,
            quantity: true,
            lineTotal: true,
          },
        },
        addresses: {
          select: { type: true, wilayaNameSnapshot: true, communeName: true },
        },
        statusHistory: { select: { fromStatus: true, toStatus: true, actorType: true } },
        cart: { select: { status: true } },
      },
    });

    expect(order.status).toBe('AWAITING_CONFIRMATION');
    expect(order.paymentStatus).toBe('UNPAID');
    expect(order.shippingTotal).toBe(600);
    expect(order.shippingRateId).not.toBeNull();
    expect(order.shippingRateLabel).toBe('Nord — Livraison à domicile');
    expect(order.grandTotal).toBe(
      order.subtotal - order.discountTotal + order.shippingTotal,
    );

    // A stock-only order has no deposit (5.5).
    expect(order.depositRequired).toBe(0);

    expect(order.items).toHaveLength(1);
    expect(order.items[0]!.skuSnapshot).not.toBeNull();
    expect(order.items[0]!.lineTotal).toBe(
      order.items[0]!.unitPrice * order.items[0]!.quantity,
    );

    expect(order.addresses).toHaveLength(1);
    expect(order.addresses[0]!.wilayaNameSnapshot).toBe('Alger');

    expect(order.statusHistory).toEqual([
      { fromStatus: null, toStatus: 'AWAITING_CONFIRMATION', actorType: 'CUSTOMER' },
    ]);

    // The cart is spent, and points at what it became.
    expect(order.cart?.status).toBe('CONVERTED');
  });

  it('snapshots the name and price so a later catalogue edit cannot rewrite history', async () => {
    const { owner } = await stockingCart(stockSlug(), 1);
    const result = await place(owner);
    if (!result.ok) throw new Error(result.error);

    const before = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: result.value.orderNumber },
      select: {
        grandTotal: true,
        items: { select: { nameSnapshot: true, unitPrice: true } },
      },
    });

    const product = await prisma.product.findFirstOrThrow({
      where: { slug: CUSTOMISABLE_SLUG, deletedAt: null },
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
      const after = await prisma.order.findUniqueOrThrow({
        where: { orderNumber: result.value.orderNumber },
        select: {
          grandTotal: true,
          items: { select: { nameSnapshot: true, unitPrice: true } },
        },
      });

      expect(after).toEqual(before);
      expect(after.items[0]!.nameSnapshot).not.toBe('Nom changé après la commande');
    } finally {
      await prisma.product.update({
        where: { id: product.id },
        data: { name: product.name, basePrice: product.basePrice },
      });
    }
  });

  it('reserves stock atomically for a confirmed-path order', async () => {
    const sku = await skuFor(stockSlug());
    const before = await prisma.productVariant.findFirstOrThrow({
      where: { sku },
      select: { reservedQuantity: true },
    });

    const { owner } = await stockingCart(stockSlug(), 2);
    const result = await place(owner);
    expect(result.ok).toBe(true);

    const after = await prisma.productVariant.findFirstOrThrow({
      where: { sku },
      select: { reservedQuantity: true },
    });

    expect(after.reservedQuantity).toBe(before.reservedQuantity + 2);
  });

  it('reserves nothing for an order awaiting payment (8.10.3)', async () => {
    /**
     * The rule that makes `AWAITING_PAYMENT` safe to leave open: the business
     * has committed nothing. The line here names a **tracked** variant, so a
     * reservation is possible and its absence is a decision rather than an
     * accident — the order carries a deposit, so nothing is held until an
     * admin confirms the payment.
     */
    const config = await createFixedConfiguration();

    const variant = await prisma.customizationConfig.findUniqueOrThrow({
      where: { id: config.id },
      select: { variantId: true },
    });

    const before = await prisma.productVariant.findUniqueOrThrow({
      where: { id: variant.variantId! },
      select: { reservedQuantity: true, stockQuantity: true },
    });

    const owner = guest();
    createdCartTokens.push(owner.anonymousToken);

    const { addCustomizationToCart } =
      await import('../../src/server/services/cart-service');
    await addCustomizationToCart(owner, {
      customizationConfigId: config.id,
      quantity: 1,
    });

    const result = await place(owner, { paymentMethod: 'BANK_TRANSFER' });
    expect(result.ok, result.ok ? '' : result.error).toBe(true);
    if (!result.ok) return;

    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: result.value.orderNumber },
      select: { status: true, depositRequired: true },
    });

    expect(order.status).toBe('AWAITING_PAYMENT');
    expect(order.depositRequired).toBeGreaterThan(0);

    const after = await prisma.productVariant.findUniqueOrThrow({
      where: { id: variant.variantId! },
      select: { reservedQuantity: true },
    });

    expect(after.reservedQuantity).toBe(before.reservedQuantity);
  });

  it('never reserves a made-to-order line', async () => {
    const sku = await skuFor(MADE_TO_ORDER_SLUG);
    const before = await prisma.productVariant.findFirstOrThrow({
      where: { sku },
      select: { reservedQuantity: true, stockQuantity: true },
    });

    const { owner } = await stockingCart(MADE_TO_ORDER_SLUG, 3);
    const result = await place(owner);
    expect(result.ok, result.ok ? '' : result.error).toBe(true);

    const after = await prisma.productVariant.findFirstOrThrow({
      where: { sku },
      select: { reservedQuantity: true },
    });

    // Stock is zero and always will be; reserving would fail the conditional
    // update and refuse a sale the business is happy to make (10.8).
    expect(after.reservedQuantity).toBe(before.reservedQuantity);
  });
});

describe('placement refuses bad input', () => {
  /*
   * An address that is given must be an address. One that is not given is
   * fine — cash on delivery in Algeria is arranged by telephone, and refusing
   * the sale over a missing e-mail loses the customer at the last screen
   * (Phase 14.11).
   */
  it('refuses a malformed email but accepts none at all', async () => {
    const { owner } = await stockingCart();

    expect((await place(owner, { contactEmail: 'pas-un-email' })).ok).toBe(false);
    expect((await place(owner, { contactEmail: 'a@b' })).ok).toBe(false);
  });

  it('places an order with no e-mail address, and stores none', async () => {
    const { owner } = await stockingCart();

    const placed = await place(owner, { contactEmail: undefined });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;

    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: placed.value.orderNumber },
      select: { contactEmail: true, contactPhone: true },
    });

    // Null, not an empty string: a blank address is one that every
    // `IS NOT NULL` check would believe, and the column forbids it.
    expect(order.contactEmail).toBeNull();
    expect(order.contactPhone.length).toBeGreaterThan(0);
  });

  /*
   * And nothing is queued for nobody. A row with no recipient would sit in the
   * outbox failing forever, which is how a missing e-mail becomes a pager.
   */
  it('queues no customer notification when there is no address', async () => {
    const { owner } = await stockingCart();

    const placed = await place(owner, { contactEmail: undefined });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;

    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: placed.value.orderNumber },
      select: { id: true },
    });

    // The audience is a property of the template, not a column, so the
    // customer's confirmation is named directly.
    const queued = await prisma.notification.findMany({
      where: { relatedOrderId: order.id, template: 'order.confirmed' },
      select: { id: true, recipient: true },
    });

    expect(queued).toHaveLength(0);

    // The workshop is still told: they are the ones who have to ring.
    const staff = await prisma.notification.findMany({
      where: { relatedOrderId: order.id, template: 'order.placed' },
      select: { id: true },
    });

    expect(staff.length).toBeGreaterThan(0);
  });

  it('places an order with an empty-string email, and stores none', async () => {
    const { owner } = await stockingCart();

    const placed = await place(owner, { contactEmail: '' });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;

    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: placed.value.orderNumber },
      select: { contactEmail: true },
    });

    expect(order.contactEmail).toBeNull();
  });

  it('refuses a phone number that is not Algerian', async () => {
    const { owner } = await stockingCart();

    for (const phone of ['123', '+33612345678', 'abcdefghij', '']) {
      const result = await place(owner, { contactPhone: phone });
      expect(result.ok, phone).toBe(false);
    }
  });

  it('refuses an incomplete address', async () => {
    const { owner } = await stockingCart();

    expect((await place(owner, { addressLine: 'x' })).ok).toBe(false);
    expect((await place(owner, { communeName: '' })).ok).toBe(false);
    expect((await place(owner, { contactName: 'A' })).ok).toBe(false);
  });

  it('refuses a wilaya out of range before it ever reaches the rate table', async () => {
    const { owner } = await stockingCart();
    const result = await place(owner, { wilayaCode: UNSERVED_WILAYA });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('INVALID_INPUT');
  });

  it('refuses a real wilaya that is mapped to no zone (4.4)', async () => {
    // Every seeded wilaya is currently mapped, so the gap has to be made:
    // this is the case a shop hits when it adds a wilaya before pricing it.
    const mapping = await prisma.shippingZoneWilaya.findUniqueOrThrow({
      where: { wilayaCode: UNMAPPED_TEST_WILAYA },
      select: { zoneId: true, wilayaCode: true },
    });

    await prisma.shippingZoneWilaya.delete({
      where: { wilayaCode: UNMAPPED_TEST_WILAYA },
    });

    try {
      const { owner } = await stockingCart();
      const result = await place(owner, { wilayaCode: UNMAPPED_TEST_WILAYA });

      expect(result.ok).toBe(false);
      // It never silently falls back to another zone's rate.
      if (!result.ok) expect(result.error).toBe('WILAYA_NOT_SERVED');
    } finally {
      await prisma.shippingZoneWilaya.create({ data: mapping });
    }
  });

  it('refuses an order placed without accepting the terms', async () => {
    const { owner } = await stockingCart();
    expect((await place(owner, { termsAccepted: false })).ok).toBe(false);
  });

  it('refuses an empty cart', async () => {
    const owner = guest();
    const result = await place(owner);
    expect(result.ok).toBe(false);
  });

  it('refuses cash on delivery for an order containing a custom line', async () => {
    const owner = guest();
    createdCartTokens.push(owner.anonymousToken);

    const config = await createFixedConfiguration();
    const { addCustomizationToCart } =
      await import('../../src/server/services/cart-service');

    const added = await addCustomizationToCart(owner, {
      customizationConfigId: config.id,
      quantity: 2,
    });
    expect(added.ok, added.ok ? '' : added.error).toBe(true);

    const cod = await place(owner, { paymentMethod: 'COD' });
    expect(cod.ok).toBe(false);
    if (!cod.ok) expect(cod.error).toBe('PAYMENT_METHOD_NOT_ALLOWED');
  });
});

/* ---------------------------------------------------------------------------
 * Money the client cannot touch
 * ------------------------------------------------------------------------ */

describe('placement never takes money from the client', () => {
  it('ignores a total, shipping charge, discount or deposit in the payload', async () => {
    const { owner } = await stockingCart(stockSlug(), 2);

    const result = await place(owner, {
      grandTotal: 1,
      subtotal: 1,
      shippingTotal: 0,
      discountTotal: 999_999,
      depositRequired: 0,
      status: 'CONFIRMED',
      orderNumber: 'CMD-0000-0001',
      paymentStatus: 'PAID',
    });

    expect(result.ok, result.ok ? '' : result.error).toBe(true);
    if (!result.ok) return;

    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: result.value.orderNumber },
      select: {
        status: true,
        paymentStatus: true,
        subtotal: true,
        shippingTotal: true,
        discountTotal: true,
        grandTotal: true,
        depositRequired: true,
      },
    });

    // The server's numbers, not the ones that were asked for.
    expect(order.grandTotal).toBeGreaterThan(1);
    expect(order.shippingTotal).toBe(600);
    expect(order.discountTotal).toBe(0);
    expect(order.status).toBe('AWAITING_CONFIRMATION');
    expect(order.paymentStatus).toBe('UNPAID');
    expect(result.value.orderNumber).not.toBe('CMD-0000-0001');
  });

  it('computes a 50% deposit for a custom order rather than accepting one', async () => {
    const owner = guest();
    createdCartTokens.push(owner.anonymousToken);

    const config = await createFixedConfiguration();
    const { addCustomizationToCart } =
      await import('../../src/server/services/cart-service');
    await addCustomizationToCart(owner, {
      customizationConfigId: config.id,
      quantity: 2,
    });

    const result = await place(owner, {
      paymentMethod: 'BANK_TRANSFER',
      depositRequired: 1,
    });

    expect(result.ok, result.ok ? '' : result.error).toBe(true);
    if (!result.ok) return;

    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: result.value.orderNumber },
      select: { grandTotal: true, depositRequired: true, status: true, items: true },
    });

    expect(order.depositRequired).toBe(Math.round(order.grandTotal / 2));
    expect(order.depositRequired).not.toBe(1);
    // 8.2: a deposit that is owed puts the order in AWAITING_PAYMENT.
    expect(order.status).toBe('AWAITING_PAYMENT');

    // 2.2: the setup fee is its own line, charged once, not per unit.
    const fee = order.items.find((item) => item.kind === 'FEE');
    expect(fee?.quantity).toBe(1);
    expect(fee?.feeKind).toBe('SETUP_FEE');
    expect(fee?.requiresProduction).toBe(false);
  });
});

/* ---------------------------------------------------------------------------
 * Concurrency and transactional consistency
 * ------------------------------------------------------------------------ */

describe('concurrency', () => {
  it('never issues the same order number twice under concurrent placement', async () => {
    const carts = await Promise.all([
      stockingCart(MADE_TO_ORDER_SLUG, 1),
      stockingCart(MADE_TO_ORDER_SLUG, 1),
      stockingCart(MADE_TO_ORDER_SLUG, 1),
      stockingCart(MADE_TO_ORDER_SLUG, 1),
      stockingCart(MADE_TO_ORDER_SLUG, 1),
      stockingCart(MADE_TO_ORDER_SLUG, 1),
    ]);

    const results = await Promise.all(carts.map(({ owner }) => place(owner)));

    const numbers = results.flatMap((result) =>
      result.ok ? [result.value.orderNumber] : [],
    );

    expect(numbers).toHaveLength(6);
    expect(new Set(numbers).size).toBe(6);
  });

  it('cannot oversell the last unit of a tracked variant', async () => {
    // A dedicated variant so the test owns its stock and cannot be perturbed
    // by another test's reservation.
    const variant = await createLimitedVariant(1);

    try {
      const owners = await Promise.all([
        addToLimitedCart(variant.productSlug, variant.sku, 1),
        addToLimitedCart(variant.productSlug, variant.sku, 1),
      ]);

      const results = await Promise.all(owners.map((owner) => place(owner)));

      const succeeded = results.filter((result) => result.ok);
      const failed = results.filter((result) => !result.ok);

      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(1);
      expect(failed[0]!.ok === false && failed[0]!.error).toBe('OUT_OF_STOCK');

      const after = await prisma.productVariant.findFirstOrThrow({
        where: { sku: variant.sku },
        select: { stockQuantity: true, reservedQuantity: true },
      });

      // The invariant the whole mechanism exists for.
      expect(after.reservedQuantity).toBeLessThanOrEqual(after.stockQuantity);
      expect(after.reservedQuantity).toBe(1);
    } finally {
      await cleanUpLimitedVariant(variant);
    }
  });

  it('produces one order for a double submission of the same cart', async () => {
    const { owner } = await stockingCart(MADE_TO_ORDER_SLUG, 1);

    const [first, second] = await Promise.all([place(owner), place(owner)]);

    const succeeded = [first, second].filter((result) => result.ok);
    expect(succeeded).toHaveLength(1);

    const cart = await prisma.cart.findFirstOrThrow({
      where: { anonymousToken: owner.anonymousToken },
      select: { status: true, convertedOrderId: true },
    });

    expect(cart.status).toBe('CONVERTED');
    expect(cart.convertedOrderId).not.toBeNull();
  });

  it('refuses to place a cart that has already been converted', async () => {
    const { owner } = await stockingCart(MADE_TO_ORDER_SLUG, 1);
    expect((await place(owner)).ok).toBe(true);

    const again = await place(owner);
    expect(again.ok).toBe(false);
  });
});

describe('a failed placement leaves nothing behind', () => {
  it('rolls back the order, its items and the stock reservation', async () => {
    const variant = await createLimitedVariant(5);

    try {
      const owner = await addToLimitedCart(variant.productSlug, variant.sku, 2);
      const cart = await prisma.cart.findFirstOrThrow({
        where: { anonymousToken: owner.anonymousToken },
        select: { id: true },
      });

      const before = await prisma.productVariant.findFirstOrThrow({
        where: { sku: variant.sku },
        select: { reservedQuantity: true },
      });
      // Scoped to this fixture's variant, not a global `order.count()`.
      // A global count is a shared-state assertion: any other suite placing an
      // order in parallel changes it, and the test then fails for a reason that
      // has nothing to do with rollback. What this test actually claims is that
      // *this* placement left nothing behind, and that is what is counted.
      const ordersBefore = await prisma.order.count({
        where: { items: { some: { variantId: variant.variantId } } },
      });

      // A line whose stored total contradicts its own arithmetic. The check
      // constraint `line_total = unit_price * quantity - line_discount` rejects
      // it *after* the cart has been claimed and the stock reserved, so this
      // exercises the rollback of everything that came before it.
      await expect(
        placeOrder({
          cartId: cart.id,
          userId: null,
          guestToken: 'rollback-probe',
          currency: 'DZD',
          status: 'AWAITING_CONFIRMATION',
          contactName: 'Amina Bensalem',
          contactPhone: '0555123456',
          contactEmail: 'amina@example.invalid',
          paymentMethod: 'COD',
          deliveryType: 'HOME',
          shippingRateId: null,
          shippingRateLabel: 'Nord — Livraison à domicile',
          subtotal: 1_000,
          discountTotal: 0,
          shippingTotal: 0,
          taxTotal: 0,
          grandTotal: 1_000,
          depositRequired: 0,
          customerNote: null,
          quoteId: null,
          estimatedDeliveryFrom: null,
          estimatedDeliveryTo: null,
          address: {
            fullName: 'Amina Bensalem',
            phone: '0555123456',
            wilayaCode: ALGER,
            wilayaNameSnapshot: 'Alger',
            communeName: 'Hydra',
            addressLine: '12 rue des Frères Bouadou',
            postalCode: null,
            notes: null,
          },
          items: [
            {
              kind: 'STOCK',
              feeKind: null,
              productId: variant.productId,
              variantId: variant.variantId,
              customizationConfigId: null,
              quoteItemId: null,
              nameSnapshot: 'Article',
              variantLabelSnapshot: null,
              skuSnapshot: variant.sku,
              imageKeySnapshot: null,
              unitPrice: 500,
              quantity: 2,
              lineDiscount: 0,
              // Deliberately wrong: 500 * 2 - 0 = 1000, not 999.
              lineTotal: 999,
              requiresProduction: false,
              position: 0,
            },
          ],
          reservations: [{ variantId: variant.variantId, quantity: 2 }],
        }),
      ).rejects.toThrow();

      // No order.
      expect(
        await prisma.order.count({
          where: { items: { some: { variantId: variant.variantId } } },
        }),
      ).toBe(ordersBefore);
      expect(
        await prisma.order.findFirst({ where: { guestToken: 'rollback-probe' } }),
      ).toBeNull();

      // No orphan items.
      expect(
        await prisma.orderItem.count({ where: { variantId: variant.variantId } }),
      ).toBe(0);

      // No reservation.
      const after = await prisma.productVariant.findFirstOrThrow({
        where: { sku: variant.sku },
        select: { reservedQuantity: true },
      });
      expect(after.reservedQuantity).toBe(before.reservedQuantity);

      // And the cart is not falsely marked as converted.
      const cartAfter = await prisma.cart.findUniqueOrThrow({
        where: { id: cart.id },
        select: { status: true, convertedOrderId: true },
      });
      expect(cartAfter.status).toBe('ACTIVE');
      expect(cartAfter.convertedOrderId).toBeNull();
    } finally {
      await cleanUpLimitedVariant(variant);
    }
  });
});

/* ---------------------------------------------------------------------------
 * Fixtures
 * ------------------------------------------------------------------------ */

/** A `FIXED` customisation, created the way Phase 7 creates one. */
async function createFixedConfiguration() {
  const product = await prisma.product.findFirstOrThrow({
    where: { slug: stockSlug(), deletedAt: null },
    select: { id: true, customizationProfileId: true },
  });

  const placement = await prisma.profilePlacement.findFirstOrThrow({
    where: { profileId: product.customizationProfileId! },
    select: { placementId: true },
  });

  const size = await prisma.profileEmbroiderySize.findFirstOrThrow({
    where: { profileId: product.customizationProfileId! },
    select: { embroiderySizeId: true },
  });

  const variant = await prisma.productVariant.findFirstOrThrow({
    where: { productId: product.id, isActive: true },
    select: { id: true },
    // Deterministic: the most-stocked variant, so a configuration is never
    // built on a sold-out one by accident of row order.
    orderBy: [{ stockQuantity: 'desc' }, { position: 'asc' }],
  });

  return prisma.customizationConfig.create({
    data: {
      productId: product.id,
      variantId: variant.id,
      placementId: placement.placementId,
      embroiderySizeId: size.embroiderySizeId,
      embroideryText: 'Amina',
      threadColorCount: 1,
      pricingMode: 'FIXED',
    },
    select: { id: true },
  });
}

type LimitedVariant = {
  productId: string;
  productSlug: string;
  variantId: string;
  sku: string;
};

/**
 * A tracked variant with exactly `stock` units, owned by this test.
 *
 * Racing two checkouts over a seeded variant would make the test depend on
 * whatever else has reserved it. This creates the scarcity it needs.
 */
async function createLimitedVariant(stock: number): Promise<LimitedVariant> {
  const template = await prisma.product.findFirstOrThrow({
    where: { slug: CUSTOMISABLE_SLUG, deletedAt: null },
    select: { categoryId: true, currency: true, customizationProfileId: true },
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;

  const product = await prisma.product.create({
    data: {
      slug: `test-scarce-${suffix}`,
      name: 'Article de test',
      description: 'Produit de test créé par la suite d’intégration.',
      categoryId: template.categoryId,
      basePrice: 500,
      currency: template.currency,
      status: 'ACTIVE',
      publishedAt: new Date(Date.now() - 1000),
      stockPolicy: 'TRACK',
      /**
       * Deliberately **not** customisable. It carries a profile so a
       * configuration can name a placement, but `listCustomizableProducts`
       * filters on `isCustomizable`, so a fixture that survives a crashed run
       * cannot appear in the builder and displace a seeded product there.
       */
      isCustomizable: false,
      customizationProfileId: template.customizationProfileId,
      variants: {
        create: [
          {
            sku: `TEST-${suffix}`,
            isActive: true,
            stockQuantity: stock,
            reservedQuantity: 0,
            position: 0,
          },
        ],
      },
    },
    select: { id: true, slug: true, variants: { select: { id: true, sku: true } } },
  });

  return {
    productId: product.id,
    productSlug: product.slug,
    variantId: product.variants[0]!.id,
    sku: product.variants[0]!.sku,
  };
}

async function addToLimitedCart(productSlug: string, sku: string, quantity: number) {
  const owner = guest();
  createdCartTokens.push(owner.anonymousToken);

  const added = await addToCart(owner, { productSlug, variantSku: sku, quantity });
  expect(added.ok, added.ok ? '' : added.error).toBe(true);

  return owner;
}

async function cleanUpLimitedVariant(variant: LimitedVariant): Promise<void> {
  await prisma.order.deleteMany({
    where: { items: { some: { variantId: variant.variantId } } },
  });
  await prisma.cartItem.deleteMany({ where: { productId: variant.productId } });

  /**
   * Configurations before the product. `customization_configs.product_id` is
   * `ON DELETE SET NULL`, and a config with neither a product nor a freeform
   * type violates `customization_configs_names_a_product` — so deleting the
   * product first fails on a constraint that is doing exactly its job.
   */
  await prisma.customizationConfig.deleteMany({
    where: { productId: variant.productId },
  });
  await prisma.productVariant.deleteMany({ where: { id: variant.variantId } });
  await prisma.product.deleteMany({ where: { id: variant.productId } });
}

/* ---------------------------------------------------------------------------
 * Quote-bound checkout (BUSINESS-RULES.md section 5A, ADR-015)
 * ------------------------------------------------------------------------ */

describe('a quote-bound cart is a commitment, not a cart', () => {
  it('uses the quote price, the quote shipping and the quote deposit', async () => {
    const fixture = await createQuoteBoundCart({
      unitPrice: 7_000,
      quantity: 2,
      setupFee: 1_500,
      shippingTotal: 30_000,
      discountTotal: 500,
      depositRequired: 21_000,
    });

    try {
      const result = await placeOrderFromCart(
        fixture.owner,
        checkoutPayload({ paymentMethod: 'BANK_TRANSFER' }),
        { cartId: fixture.cartId },
      );

      expect(result.ok, result.ok ? '' : result.error).toBe(true);
      if (!result.ok) return;
      createdOrderNumbers.push(result.value.orderNumber);

      const order = await prisma.order.findUniqueOrThrow({
        where: { orderNumber: result.value.orderNumber },
        select: {
          subtotal: true,
          discountTotal: true,
          shippingTotal: true,
          grandTotal: true,
          depositRequired: true,
          shippingRateId: true,
          shippingRateLabel: true,
          items: { select: { unitPrice: true, quantity: true, kind: true } },
        },
      });

      // 5A.3 / 4.6: the quote shipping supersedes rate resolution entirely, so
      // no zone or rate lookup occurred and no rate is recorded.
      expect(order.shippingTotal).toBe(30_000);
      expect(order.shippingRateId).toBeNull();
      expect(order.shippingRateLabel).toBe('Livraison devisée');

      // 2.7: locked prices, not catalogue prices.
      expect(order.items.map((item) => item.unitPrice).sort((a, b) => a - b)).toEqual([
        1_500, 7_000,
      ]);

      // 5A.6: the reconstructed total equals the accepted total exactly.
      expect(order.grandTotal).toBe(fixture.quoteGrandTotal);
      // 5.5.1: the deposit is copied, never recomputed from the percentage.
      expect(order.depositRequired).toBe(21_000);
      expect(order.discountTotal).toBe(500);
    } finally {
      await cleanUpQuoteFixture(fixture);
    }
  });

  it('refuses placement when the reconstructed total no longer matches (5A.6)', async () => {
    const fixture = await createQuoteBoundCart({
      unitPrice: 7_000,
      quantity: 2,
      setupFee: 1_500,
      shippingTotal: 30_000,
      discountTotal: 500,
      depositRequired: 21_000,
    });

    try {
      /**
       * The quote's own totals cannot be made inconsistent — a
       * `quotes_totals_reconcile` check constraint guards them. So the drift
       * is introduced where it could really occur: a quote-bound cart line
       * whose locked price no longer reconstructs the accepted total.
       */
      await prisma.cartItem.updateMany({
        where: { cartId: fixture.cartId, kind: 'CUSTOM' },
        data: { lockedUnitPrice: 6_999 },
      });

      const result = await placeOrderFromCart(
        fixture.owner,
        checkoutPayload({ paymentMethod: 'BANK_TRANSFER' }),
        { cartId: fixture.cartId },
      );

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe('QUOTE_TOTAL_MISMATCH');

      // Nothing was created, and the cart survives for the customer to return to.
      const cart = await prisma.cart.findUniqueOrThrow({
        where: { id: fixture.cartId },
        select: { status: true },
      });
      expect(cart.status).toBe('ACTIVE');
    } finally {
      await cleanUpQuoteFixture(fixture);
    }
  });

  it('ignores a catalogue price change entirely (2.7)', async () => {
    const fixture = await createQuoteBoundCart({
      unitPrice: 7_000,
      quantity: 1,
      setupFee: 0,
      shippingTotal: 0,
      discountTotal: 0,
      depositRequired: 3_500,
    });

    try {
      const product = await prisma.product.findFirstOrThrow({
        where: { slug: CUSTOMISABLE_SLUG, deletedAt: null },
        select: { id: true, basePrice: true },
      });

      await prisma.product.update({
        where: { id: product.id },
        data: { basePrice: product.basePrice * 3 },
      });

      try {
        const { priceCartData } = await import('../../src/server/services/cart-service');
        const { findOwnedCart } =
          await import('../../src/server/repositories/cart-repository');

        const cart = await findOwnedCart(fixture.cartId, fixture.owner);
        const priced = await priceCartData(cart!);

        expect(priced.lines[0]!.unitPrice).toBe(7_000);
        expect(priced.lines[0]!.editable).toBe(false);
        // 5A.5: quantity discounts are not re-applied — they were priced in.
        expect(priced.totals.discountTotal).toBe(0);
      } finally {
        await prisma.product.update({
          where: { id: product.id },
          data: { basePrice: product.basePrice },
        });
      }
    } finally {
      await cleanUpQuoteFixture(fixture);
    }
  });
});

type QuoteFixture = {
  owner: { kind: 'user'; userId: string };
  userId: string;
  requestId: string;
  quoteId: string;
  cartId: string;
  quoteGrandTotal: number;
};

/**
 * An accepted quote and the quote-bound cart it produced.
 *
 * Quote acceptance itself is Phase 10. What this builds is the *state* that
 * flow will leave behind, so the checkout rules that must already hold can be
 * tested now rather than assumed.
 */
async function createQuoteBoundCart(input: {
  unitPrice: number;
  quantity: number;
  setupFee: number;
  shippingTotal: number;
  discountTotal: number;
  depositRequired: number;
}): Promise<QuoteFixture> {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;

  const user = await prisma.user.create({
    data: {
      name: 'Cliente de test',
      email: `quote-${suffix}@example.invalid`,
      emailVerified: true,
      role: 'CUSTOMER',
      status: 'ACTIVE',
    },
    select: { id: true },
  });

  const request = await prisma.customRequest.create({
    data: {
      requestNumber: `TEST-${suffix}`,
      userId: user.id,
      status: 'QUOTED',
      source: 'BUILDER',
      pricingMode: 'QUOTE',
      contactEmail: `quote-${suffix}@example.invalid`,
    },
    select: { id: true },
  });

  const subtotal = input.unitPrice * input.quantity + input.setupFee;
  const grandTotal = subtotal - input.discountTotal + input.shippingTotal;

  const quote = await prisma.quote.create({
    data: {
      quoteNumber: `DEV-${suffix}`,
      requestId: request.id,
      userId: user.id,
      createdByUserId: user.id,
      status: 'ACCEPTED',
      subtotal,
      discountTotal: input.discountTotal,
      shippingTotal: input.shippingTotal,
      grandTotal,
      depositRequired: input.depositRequired,
      validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      acceptedAt: new Date(),
      acceptanceValidUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      items: {
        create: [
          {
            kind: 'PRODUCT',
            label: 'T-shirt brodé',
            quantity: input.quantity,
            unitPrice: input.unitPrice,
            lineTotal: input.unitPrice * input.quantity,
            position: 0,
          },
          ...(input.setupFee > 0
            ? [
                {
                  kind: 'SETUP_FEE' as const,
                  label: 'Frais de préparation',
                  quantity: 1,
                  unitPrice: input.setupFee,
                  lineTotal: input.setupFee,
                  position: 1,
                },
              ]
            : []),
        ],
      },
    },
    select: { id: true, items: { select: { id: true, kind: true } } },
  });

  const productLine = quote.items.find((item) => item.kind === 'PRODUCT')!;
  const feeLine = quote.items.find((item) => item.kind === 'SETUP_FEE');
  const config = await createFixedConfiguration();
  const configured = await prisma.customizationConfig.findUniqueOrThrow({
    where: { id: config.id },
    select: { productId: true, variantId: true },
  });

  const cart = await prisma.cart.create({
    data: {
      kind: 'QUOTE_BOUND',
      status: 'ACTIVE',
      userId: user.id,
      quoteId: quote.id,
      quoteValidUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      items: {
        create: [
          {
            kind: 'CUSTOM',
            productId: configured.productId,
            variantId: configured.variantId,
            customizationConfigId: config.id,
            quoteItemId: productLine.id,
            lockedUnitPrice: input.unitPrice,
            quantity: input.quantity,
            position: 0,
          },
          ...(feeLine
            ? [
                {
                  kind: 'FEE' as const,
                  nameSnapshot: 'Frais de préparation',
                  quoteItemId: feeLine.id,
                  lockedUnitPrice: input.setupFee,
                  quantity: 1,
                  position: 1,
                },
              ]
            : []),
        ],
      },
    },
    select: { id: true },
  });

  return {
    owner: { kind: 'user', userId: user.id },
    userId: user.id,
    requestId: request.id,
    quoteId: quote.id,
    cartId: cart.id,
    quoteGrandTotal: grandTotal,
  };
}

async function cleanUpQuoteFixture(fixture: QuoteFixture): Promise<void> {
  await prisma.order.deleteMany({ where: { quoteId: fixture.quoteId } });
  await prisma.cart.deleteMany({ where: { id: fixture.cartId } });
  await prisma.quote.deleteMany({ where: { id: fixture.quoteId } });
  await prisma.customRequest.deleteMany({ where: { id: fixture.requestId } });
  await prisma.user.deleteMany({ where: { id: fixture.userId } });
}

/**
 * Remove fixture products, and everything hanging off them, left by an earlier
 * run that did not finish.
 *
 * The order is the foreign-key order: orders and carts release the quotes,
 * requests release the configurations, and only then can a product go.
 */
async function purgeStaleFixtures(): Promise<void> {
  const products = await prisma.product.findMany({
    where: { slug: { startsWith: 'test-scarce-' } },
    select: { id: true },
  });
  const productIds = products.map((product) => product.id);
  if (productIds.length === 0) return;

  const configs = await prisma.customizationConfig.findMany({
    where: { productId: { in: productIds } },
    select: { id: true },
  });
  const configIds = configs.map((config) => config.id);

  const requestItems = await prisma.customRequestItem.findMany({
    where: { customizationConfigId: { in: configIds } },
    select: { requestId: true },
  });
  const requestIds = [...new Set(requestItems.map((item) => item.requestId))];

  const quotes = await prisma.quote.findMany({
    where: { requestId: { in: requestIds } },
    select: { id: true },
  });
  const quoteIds = quotes.map((quote) => quote.id);

  await prisma.order.deleteMany({
    where: {
      OR: [
        { quoteId: { in: quoteIds } },
        { items: { some: { productId: { in: productIds } } } },
      ],
    },
  });
  await prisma.cart.deleteMany({ where: { quoteId: { in: quoteIds } } });
  await prisma.cartItem.deleteMany({ where: { productId: { in: productIds } } });
  await prisma.cartItem.deleteMany({
    where: { customizationConfigId: { in: configIds } },
  });
  await prisma.customRequest.deleteMany({ where: { id: { in: requestIds } } });
  await prisma.customizationConfig.deleteMany({ where: { id: { in: configIds } } });
  await prisma.productVariant.deleteMany({ where: { productId: { in: productIds } } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
}
