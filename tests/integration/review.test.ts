/**
 * Reviews, against the real database.
 *
 * Two questions run through the whole file.
 *
 * **Can somebody review something they did not buy?** The payload names an
 * order line and nothing else, and that line is resolved with `order.userId` in
 * the query — so the answers to "another customer's line", "a line of an order
 * that is not delivered" and "a fee line" must all be refusals, and a foreign
 * id must be indistinguishable from one that does not exist.
 *
 * **Can an unapproved review be read by a stranger?** A review is `PENDING`
 * until a moderator acts (11A.3), and every public read filters on
 * `status = APPROVED` in the query. A pending or rejected review appearing on a
 * product page is the failure this file is mostly about.
 *
 * The reviews here attach to a **fixture product created by this suite**, not
 * to a seeded one: moderation writes `products.ratingAverage`, and a test that
 * moved a shared product's rating would be a test whose result depends on which
 * suites ran alongside it.
 */

import dotenv from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

dotenv.config({ path: ['.env.local', '.env'], quiet: true });

const { submitReview, moderate } =
  await import('../../src/server/services/review-service');
const {
  countReviewsByStatus,
  getProductReviewPanel,
  getRatingSummary,
  listReviewableItems,
  listReviewsByAuthor,
  listReviewsForModeration,
  readStoredRating,
} = await import('../../src/server/repositories/review-repository');
const { placeOrderFromCart } = await import('../../src/server/services/checkout-service');
const { addToCart } = await import('../../src/server/services/cart-service');
const { prisma } = await import('../../src/lib/db/client');

const TEMPLATE_SLUG = 't-shirt-brode-classique';
const ALGER = 16;

const PREFIX = `phase13-review-${Date.now()}`;
const BODY = 'La broderie est nette et le fil ne bouge pas au lavage. Très satisfaite.';

let productId: string;
let productSlug: string;
let variantSku: string;

let alice: { userId: string; email: string };
let mallory: { userId: string; email: string };
let staffUserId: string;

const createdUserIds: string[] = [];
const createdOrderNumbers: string[] = [];

async function createUser(role: 'CUSTOMER' | 'STAFF', label: string) {
  const email = `${PREFIX}-${label}@example.invalid`;

  const user = await prisma.user.create({
    data: { email, name: `Amina ${label}`, role, status: 'ACTIVE', emailVerified: true },
    select: { id: true },
  });

  createdUserIds.push(user.id);
  return { userId: user.id, email };
}

/** A real order through the Phase 8 path, then marked delivered. */
async function deliveredOrder(user: { userId: string; email: string }): Promise<{
  orderNumber: string;
  orderItemId: string;
}> {
  const owner = { kind: 'user' as const, userId: user.userId };

  const added = await addToCart(owner, { productSlug, variantSku, quantity: 1 });
  if (!added.ok) throw new Error(`add failed: ${added.error}`);

  const placed = await placeOrderFromCart(owner, {
    contactName: 'Cliente de test',
    contactEmail: user.email,
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

  // 11A.1 requires delivery. The status machine is Phase 12's and is exercised
  // there; here the fact is what matters, so it is set directly.
  const order = await prisma.order.update({
    where: { orderNumber: placed.value.orderNumber },
    data: { status: 'DELIVERED' },
    select: { items: { select: { id: true, productId: true } } },
  });

  const item = order.items.find((line) => line.productId === productId);
  if (!item) throw new Error('the placed order has no line for the fixture product');

  return { orderNumber: placed.value.orderNumber, orderItemId: item.id };
}

beforeAll(async () => {
  const template = await prisma.product.findFirstOrThrow({
    where: { slug: TEMPLATE_SLUG, deletedAt: null },
    select: { categoryId: true, currency: true },
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;

  const fixture = await prisma.product.create({
    data: {
      slug: `test-review-${suffix}`,
      name: 'Pièce brodée à évaluer',
      description: 'Produit de test créé par la suite des avis.',
      categoryId: template.categoryId,
      basePrice: 250_000,
      currency: template.currency,
      status: 'ACTIVE',
      publishedAt: new Date(Date.now() - 1_000),
      stockPolicy: 'MADE_TO_ORDER',
      variants: {
        create: [
          { sku: `TESTR-${suffix}`, isActive: true, stockQuantity: 0, position: 0 },
        ],
      },
    },
    select: { id: true, slug: true, variants: { select: { sku: true } } },
  });

  productId = fixture.id;
  productSlug = fixture.slug;
  variantSku = fixture.variants[0]!.sku;

  alice = await createUser('CUSTOMER', 'alice');
  mallory = await createUser('CUSTOMER', 'mallory');
  staffUserId = (await createUser('STAFF', 'staff')).userId;
});

afterAll(async () => {
  await prisma.review.deleteMany({ where: { productId } });
  await prisma.order.deleteMany({ where: { orderNumber: { in: createdOrderNumbers } } });
  await prisma.cart.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.cartItem.deleteMany({ where: { productId } });
  await prisma.productVariant.deleteMany({ where: { productId } });
  await prisma.product.deleteMany({ where: { id: productId } });
});

/* ---------------------------------------------------------------------------
 * Submitting
 * ------------------------------------------------------------------------ */

describe('writing a review', () => {
  it('offers a delivered line, and records the review unpublished', async () => {
    const order = await deliveredOrder(alice);

    const offered = await listReviewableItems({ userId: alice.userId });
    expect(offered.map((item) => item.orderItemId)).toContain(order.orderItemId);

    const submitted = await submitReview({
      userId: alice.userId,
      orderItemId: order.orderItemId,
      draft: { rating: 5, title: 'Impeccable', body: BODY },
    });

    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;

    const row = await prisma.review.findUniqueOrThrow({
      where: { id: submitted.value.reviewId },
      select: {
        status: true,
        isVerifiedPurchase: true,
        productId: true,
        orderItemId: true,
        userId: true,
      },
    });

    // 11A.3: nothing is published by writing it.
    expect(row.status).toBe('PENDING');
    // 11A.1: verified because the order line said so, not because a payload did.
    expect(row.isVerifiedPurchase).toBe(true);
    // The product came from the order line: the payload never named one.
    expect(row.productId).toBe(productId);
    expect(row.orderItemId).toBe(order.orderItemId);
    expect(row.userId).toBe(alice.userId);
  });

  it('keeps a pending review off the product page', async () => {
    const panel = await getProductReviewPanel(productSlug);

    expect(panel).not.toBeNull();
    expect(panel!.reviews).toHaveLength(0);
    expect(panel!.summary.count).toBe(0);
    expect(panel!.summary.average).toBeNull();
  });

  it('shows the author their own review, with its status', async () => {
    const own = await listReviewsByAuthor({ userId: alice.userId });

    expect(own).toHaveLength(1);
    expect(own[0]!.status).toBe('PENDING');
    expect(own[0]!.productSlug).toBe(productSlug);
  });

  it('stops offering a product the customer has already reviewed', async () => {
    const offered = await listReviewableItems({ userId: alice.userId });

    expect(offered.some((item) => item.productSlug === productSlug)).toBe(false);
  });

  it('refuses a second review of the same product', async () => {
    const order = await deliveredOrder(alice);

    const again = await submitReview({
      userId: alice.userId,
      orderItemId: order.orderItemId,
      draft: { rating: 1, title: null, body: BODY },
    });

    expect(again.ok).toBe(false);
    if (again.ok) return;

    // Either the eligibility check or the unique index refuses it; both are the
    // same answer to the customer, and both must refuse.
    expect(['NOT_ELIGIBLE', 'DUPLICATE']).toContain(again.error.code);

    const count = await prisma.review.count({
      where: { userId: alice.userId, productId, deletedAt: null },
    });

    expect(count).toBe(1);
  });

  it('treats another customer’s order line as nonexistent', async () => {
    const order = await deliveredOrder(mallory);

    const stolen = await submitReview({
      userId: alice.userId,
      orderItemId: order.orderItemId,
      draft: { rating: 5, title: null, body: BODY },
    });

    expect(stolen.ok).toBe(false);
    if (stolen.ok) return;

    // The same code a made-up id produces: the portal is not an oracle.
    expect(stolen.error.code).toBe('NOT_FOUND');

    const invented = await submitReview({
      userId: alice.userId,
      orderItemId: '00000000-0000-4000-8000-000000000000',
      draft: { rating: 5, title: null, body: BODY },
    });

    expect(invented.ok).toBe(false);
    if (invented.ok) return;
    expect(invented.error.code).toBe('NOT_FOUND');
  });

  it('refuses a line whose order has not been delivered', async () => {
    const owner = { kind: 'user' as const, userId: mallory.userId };

    const added = await addToCart(owner, { productSlug, variantSku, quantity: 1 });
    expect(added.ok).toBe(true);

    const placed = await placeOrderFromCart(owner, {
      contactName: 'Cliente de test',
      contactEmail: mallory.email,
      contactPhone: '0555123456',
      wilayaCode: ALGER,
      communeName: 'Hydra',
      addressLine: '12 rue des Frères Bouadou',
      deliveryType: 'HOME',
      paymentMethod: 'COD',
      customerNote: null,
      termsAccepted: true,
    });

    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    createdOrderNumbers.push(placed.value.orderNumber);

    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: placed.value.orderNumber },
      select: { status: true, items: { select: { id: true, productId: true } } },
    });

    expect(order.status).not.toBe('DELIVERED');

    const line = order.items.find((item) => item.productId === productId)!;

    const refused = await submitReview({
      userId: mallory.userId,
      orderItemId: line.id,
      draft: { rating: 5, title: null, body: BODY },
    });

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.code).toBe('NOT_ELIGIBLE');
    expect(refused.error.message).toContain('livrée');
  });

  it('refuses words that say nothing, before touching the database', async () => {
    const order = await deliveredOrder(mallory);

    const before = await prisma.review.count({ where: { productId } });

    const refused = await submitReview({
      userId: mallory.userId,
      orderItemId: order.orderItemId,
      draft: { rating: 5, title: null, body: 'top' },
    });

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.code).toBe('INVALID');
    expect(refused.error.field).toBe('body');

    expect(await prisma.review.count({ where: { productId } })).toBe(before);
  });

  it('offers a guest purchaser nothing, because a guest order has no owner (11A.4)', async () => {
    const token = `${PREFIX}-guest`;
    const owner = { kind: 'guest' as const, anonymousToken: token };

    const added = await addToCart(owner, { productSlug, variantSku, quantity: 1 });
    expect(added.ok).toBe(true);

    const placed = await placeOrderFromCart(owner, {
      contactName: 'Invité de test',
      contactEmail: `${PREFIX}-guest@example.invalid`,
      contactPhone: '0555123456',
      wilayaCode: ALGER,
      communeName: 'Hydra',
      addressLine: '12 rue des Frères Bouadou',
      deliveryType: 'HOME',
      paymentMethod: 'COD',
      customerNote: null,
      termsAccepted: true,
    });

    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    createdOrderNumbers.push(placed.value.orderNumber);

    const order = await prisma.order.update({
      where: { orderNumber: placed.value.orderNumber },
      data: { status: 'DELIVERED' },
      select: { userId: true, items: { select: { id: true, productId: true } } },
    });

    // The order has no owner, which is what 11A.4 turns on.
    expect(order.userId).toBeNull();

    const line = order.items.find((item) => item.productId === productId)!;

    // Nobody is offered it, and naming its line directly is "not found" —
    // there is no unauthenticated write path onto public content.
    for (const user of [alice, mallory]) {
      const offered = await listReviewableItems({ userId: user.userId });
      expect(offered.map((item) => item.orderItemId)).not.toContain(line.id);

      const attempted = await submitReview({
        userId: user.userId,
        orderItemId: line.id,
        draft: { rating: 5, title: null, body: BODY },
      });

      expect(attempted.ok).toBe(false);
      if (attempted.ok) return;
      expect(attempted.error.code).toBe('NOT_FOUND');
    }
  });
});

/* ---------------------------------------------------------------------------
 * Moderation
 * ------------------------------------------------------------------------ */

describe('moderation (11A.3)', () => {
  async function pendingReview(user: { userId: string; email: string }): Promise<string> {
    const order = await deliveredOrder(user);

    const submitted = await submitReview({
      userId: user.userId,
      orderItemId: order.orderItemId,
      draft: { rating: 4, title: 'Bien', body: BODY },
    });

    if (!submitted.ok) throw new Error(`submission failed: ${submitted.error.message}`);
    return submitted.value.reviewId;
  }

  it('publishes a review and recomputes the product’s rating in the same act', async () => {
    const review = await prisma.review.findFirstOrThrow({
      where: { productId, userId: alice.userId },
      select: { id: true, status: true, rating: true },
    });

    expect(review.status).toBe('PENDING');

    const result = await moderate({
      reviewId: review.id,
      from: 'PENDING',
      to: 'APPROVED',
      moderatorUserId: staffUserId,
      adminResponse: 'Merci pour votre retour.',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.productSlug).toBe(productSlug);
    expect(result.value.rating.count).toBe(1);
    expect(result.value.rating.average).toBe(review.rating * 100);

    // The denormalised columns agree with the rows they summarise.
    const stored = await readStoredRating(productId);
    const computed = await getRatingSummary(productId);

    expect(stored).toEqual({ average: computed.average, count: computed.count });

    // And the moderation trail is recorded on the row.
    const moderated = await prisma.review.findUniqueOrThrow({
      where: { id: review.id },
      select: { status: true, moderatedByUserId: true, moderatedAt: true },
    });

    expect(moderated.status).toBe('APPROVED');
    expect(moderated.moderatedByUserId).toBe(staffUserId);
    expect(moderated.moderatedAt).not.toBeNull();
  });

  it('makes the approved review visible, without its author’s identifiers', async () => {
    const panel = await getProductReviewPanel(productSlug);

    expect(panel!.reviews).toHaveLength(1);
    expect(panel!.summary.count).toBe(1);

    const published = panel!.reviews[0]!;

    expect(published.body).toBe(BODY);
    expect(published.isVerifiedPurchase).toBe(true);
    expect(published.adminResponse).toBe('Merci pour votre retour.');

    // A display name, not an identity: no e-mail, no user id, no trail.
    expect(published.authorName).not.toContain('@');
    expect(published.authorName).not.toBe(alice.email);

    const serialised = JSON.stringify(panel);
    expect(serialised).not.toContain(alice.email);
    expect(serialised).not.toContain(alice.userId);
    expect(serialised).not.toContain(staffUserId);
    expect(serialised).not.toContain('moderatedBy');
  });

  it('recomputes the average across several approved reviews', async () => {
    const second = await pendingReview(mallory);

    const approved = await moderate({
      reviewId: second,
      from: 'PENDING',
      to: 'APPROVED',
      moderatorUserId: staffUserId,
      adminResponse: null,
    });

    expect(approved.ok).toBe(true);
    if (!approved.ok) return;

    // Five and four: 4.5 stored as 450.
    expect(approved.value.rating.count).toBe(2);
    expect(approved.value.rating.average).toBe(450);
    expect(await readStoredRating(productId)).toEqual({ average: 450, count: 2 });
  });

  it('takes a review back down, and the rating with it', async () => {
    const target = await prisma.review.findFirstOrThrow({
      where: { productId, userId: mallory.userId, status: 'APPROVED' },
      select: { id: true },
    });

    const rejected = await moderate({
      reviewId: target.id,
      from: 'APPROVED',
      to: 'REJECTED',
      moderatorUserId: staffUserId,
      adminResponse: null,
    });

    expect(rejected.ok).toBe(true);

    const panel = await getProductReviewPanel(productSlug);
    expect(panel!.reviews).toHaveLength(1);

    // Back to the single five-star review.
    expect(await readStoredRating(productId)).toEqual({ average: 500, count: 1 });
  });

  it('refuses a verdict that is already the state', async () => {
    const approved = await prisma.review.findFirstOrThrow({
      where: { productId, status: 'APPROVED' },
      select: { id: true },
    });

    const result = await moderate({
      reviewId: approved.id,
      from: 'APPROVED',
      to: 'APPROVED',
      moderatorUserId: staffUserId,
      adminResponse: null,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('UNCHANGED');
  });

  it('lets only one of two simultaneous moderators decide', async () => {
    const review = await pendingReview(await createUser('CUSTOMER', 'chloe'));

    const [first, second] = await Promise.all([
      moderate({
        reviewId: review,
        from: 'PENDING',
        to: 'APPROVED',
        moderatorUserId: staffUserId,
        adminResponse: null,
      }),
      moderate({
        reviewId: review,
        from: 'PENDING',
        to: 'REJECTED',
        moderatorUserId: staffUserId,
        adminResponse: null,
      }),
    ]);

    const outcomes = [first.ok, second.ok];
    expect(outcomes.filter(Boolean)).toHaveLength(1);

    const loser = first.ok ? second : first;
    if (loser.ok) return;
    expect(loser.error.code).toBe('UNCHANGED');
  });

  it('refuses a review that does not exist', async () => {
    const result = await moderate({
      reviewId: '00000000-0000-4000-8000-000000000000',
      from: 'PENDING',
      to: 'APPROVED',
      moderatorUserId: staffUserId,
      adminResponse: null,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
  });

  it('shows the moderator every state, filtered', async () => {
    const pending = await listReviewsForModeration({ status: 'PENDING' });
    const rejected = await listReviewsForModeration({ status: 'REJECTED' });

    expect(pending.every((review) => review.status === 'PENDING')).toBe(true);
    expect(rejected.every((review) => review.status === 'REJECTED')).toBe(true);

    const counts = await countReviewsByStatus();
    expect(counts.APPROVED).toBeGreaterThanOrEqual(1);
  });
});
