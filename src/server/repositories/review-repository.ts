import 'server-only';

import { prisma } from '@/lib/db/client';
import { toPublicAssetUrl } from '@/lib/media/public-asset';
import { publiclyVisibleWhere } from '@/server/repositories/catalogue-repository';
import { archiveWhere } from '@/server/repositories/archive-repository';
import {
  EMPTY_DISTRIBUTION,
  summariseFromCounts,
  summariseRatings,
  type RatingDistribution,
  type RatingSummary,
  type ReviewStatus,
} from '@/domain/review';

/**
 * Reviews, read and written.
 *
 * The three rules of `catalogue-repository` apply unchanged: visibility lives
 * in the `where`, every query names its columns, and the arithmetic is
 * `domain/review`'s rather than a second copy here.
 *
 * Two of them do real work in this file.
 *
 * **Visibility.** `status = APPROVED` is a clause in every public query, never
 * a filter applied afterwards. A pending review is a customer's unpublished
 * words and a rejected one is words we declined to publish; either appearing on
 * a product page is the failure this module exists to prevent.
 *
 * **Column selection.** A review row carries `moderatedByUserId`, `moderatedAt`
 * and the author's user id. None of those belongs on a public product page, so
 * the public DTO carries a display name and a date and nothing else — the same
 * never-serialise rule `SECURITY.md` section 10 applies to internal notes.
 */

/* ---------------------------------------------------------------------------
 * DTOs
 * ------------------------------------------------------------------------ */

/** A review as a visitor sees it. No identifiers, no moderation trail. */
export type PublicReview = {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  /** The author's first name only — a public page is not a customer list. */
  authorName: string;
  createdAt: Date;
  /** Always true in V1 (11A.1), and shown as a badge. */
  isVerifiedPurchase: boolean;
  /** The workshop's public reply, when there is one. */
  adminResponse: string | null;
};

/** A review as its author sees it in their account, status included. */
export type OwnReview = {
  id: string;
  status: ReviewStatus;
  rating: number;
  title: string | null;
  body: string;
  createdAt: Date;
  adminResponse: string | null;
  productName: string;
  productSlug: string;
};

/** A review as the moderator sees it. */
export type ModerationReview = {
  id: string;
  status: ReviewStatus;
  rating: number;
  title: string | null;
  body: string;
  createdAt: Date;
  authorName: string;
  authorEmail: string;
  productName: string;
  productSlug: string;
  orderNumber: string | null;
  adminResponse: string | null;
};

/** One line of a delivered order, offered to its buyer to review. */
export type ReviewableItem = {
  orderItemId: string;
  orderNumber: string;
  productId: string;
  productName: string;
  productSlug: string;
  variantLabel: string | null;
  image: { src: string | null; alt: string } | null;
};

/* ---------------------------------------------------------------------------
 * Public reads
 * ------------------------------------------------------------------------ */

/**
 * A display name from a full name.
 *
 * "Amina Bensalem" becomes "Amina B." — enough for a reader to see that a
 * person wrote it, not enough to be a directory of customers. An empty or
 * single-word name degrades to what there is rather than to a blank.
 */
function displayName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];

  if (!first) return 'Client';
  if (parts.length === 1) return first;

  return `${first} ${parts[parts.length - 1]!.charAt(0).toUpperCase()}.`;
}

export const PUBLIC_REVIEWS_PAGE_SIZE = 10;

export async function listApprovedReviews(input: {
  productId: string;
  limit?: number;
}): Promise<readonly PublicReview[]> {
  const rows = await prisma.review.findMany({
    // Uses the `(product_id, status, created_at desc)` index.
    where: { productId: input.productId, status: 'APPROVED', deletedAt: null },
    select: {
      id: true,
      rating: true,
      title: true,
      body: true,
      createdAt: true,
      isVerifiedPurchase: true,
      adminResponse: true,
      user: { select: { name: true } },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: Math.min(input.limit ?? PUBLIC_REVIEWS_PAGE_SIZE, PUBLIC_REVIEWS_PAGE_SIZE),
  });

  return rows.map((row) => ({
    id: row.id,
    rating: row.rating,
    title: row.title,
    body: row.body,
    authorName: displayName(row.user.name),
    createdAt: row.createdAt,
    isVerifiedPurchase: row.isVerifiedPurchase,
    adminResponse: row.adminResponse,
  }));
}

/**
 * The rating distribution for a product, straight from a `GROUP BY`.
 *
 * Grouped in the database rather than by loading every review and counting in
 * JavaScript: a product page must not get slower as a product gets popular.
 */
export async function getRatingSummary(productId: string): Promise<RatingSummary> {
  const groups = await prisma.review.groupBy({
    by: ['rating'],
    where: { productId, status: 'APPROVED', deletedAt: null },
    _count: { _all: true },
  });

  const counts: [number, number, number, number, number] = [0, 0, 0, 0, 0];

  for (const group of groups) {
    const index = group.rating - 1;
    if (index < 0 || index > 4) continue;

    counts[index] = group._count._all;
  }

  return summariseFromCounts(counts);
}

/**
 * Approved reviews across the catalogue, for the homepage `REVIEWS` band.
 *
 * Nothing is invented: with no approved reviews this returns none and the band
 * renders nothing at all, which is the honest answer for a shop that has not
 * been reviewed yet.
 */
export async function listApprovedReviewsAcrossCatalogue(input: {
  limit: number;
}): Promise<readonly (PublicReview & { productName: string; productSlug: string })[]> {
  const rows = await prisma.review.findMany({
    where: {
      status: 'APPROVED',
      deletedAt: null,
      // Only reviews of a product a visitor can actually open.
      product: { status: 'ACTIVE', deletedAt: null, publishedAt: { not: null } },
    },
    select: {
      id: true,
      rating: true,
      title: true,
      body: true,
      createdAt: true,
      isVerifiedPurchase: true,
      adminResponse: true,
      user: { select: { name: true } },
      product: { select: { name: true, slug: true } },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: Math.min(Math.max(input.limit, 1), 12),
  });

  return rows.map((row) => ({
    id: row.id,
    rating: row.rating,
    title: row.title,
    body: row.body,
    authorName: displayName(row.user.name),
    createdAt: row.createdAt,
    isVerifiedPurchase: row.isVerifiedPurchase,
    adminResponse: row.adminResponse,
    productName: row.product.name,
    productSlug: row.product.slug,
  }));
}

/* ---------------------------------------------------------------------------
 * The product page's panel
 * ------------------------------------------------------------------------ */

export type ProductReviewPanel = {
  summary: RatingSummary;
  reviews: readonly PublicReview[];
};

/**
 * Everything the product page shows about reviews, addressed by slug.
 *
 * By slug rather than by id because the product DTO deliberately carries no
 * internal identifier (`catalogue-repository`), and a page that had one would
 * be a page that could leak it. The catalogue's own visibility predicate is
 * reused rather than restated, so a draft product's reviews are unreachable for
 * the same reason the product is.
 *
 * The summary is computed from the review rows rather than read from
 * `products.ratingAverage`. The denormalised column exists so a *listing* can
 * render a rating without aggregating per card; on the detail page the rows are
 * being read anyway, and computing from them means the page cannot show a
 * figure that disagrees with the reviews printed under it.
 */
export async function getProductReviewPanel(
  slug: string,
): Promise<ProductReviewPanel | null> {
  const product = await prisma.product.findFirst({
    where: { slug, ...publiclyVisibleWhere() },
    select: { id: true },
  });

  if (!product) return null;

  const [summary, reviews] = await Promise.all([
    getRatingSummary(product.id),
    listApprovedReviews({ productId: product.id }),
  ]);

  return { summary, reviews };
}

/* ---------------------------------------------------------------------------
 * The customer's own reviews
 * ------------------------------------------------------------------------ */

/**
 * What this customer may review.
 *
 * 11A.1 in one query: lines of **their own** `DELIVERED` orders that name a
 * catalogue product, minus the products they have already reviewed. The
 * ownership filter is `order.userId`, applied in the query — a guest order has
 * a null `userId` and therefore matches nobody, which is 11A.4 falling out of
 * the data rather than being coded again.
 */
export async function listReviewableItems(input: {
  userId: string;
  limit?: number;
}): Promise<readonly ReviewableItem[]> {
  const rows = await prisma.orderItem.findMany({
    where: {
      productId: { not: null },
      order: { userId: input.userId, status: 'DELIVERED' },
      // Already reviewed by this customer? Then it is not offered again. The
      // partial unique index makes a second one impossible anyway; this is what
      // stops the interface offering something that would be refused.
      product: {
        reviews: { none: { userId: input.userId, deletedAt: null } },
        deletedAt: null,
      },
    },
    select: {
      id: true,
      nameSnapshot: true,
      variantLabelSnapshot: true,
      imageKeySnapshot: true,
      productId: true,
      product: { select: { slug: true, name: true } },
      order: { select: { orderNumber: true } },
    },
    orderBy: [{ orderId: 'desc' }, { position: 'asc' }],
    take: Math.min(input.limit ?? 20, 50),
  });

  return rows.flatMap((row) => {
    if (!row.productId || !row.product) return [];

    return [
      {
        orderItemId: row.id,
        orderNumber: row.order.orderNumber,
        productId: row.productId,
        // The snapshot is what the customer bought; the slug is where the
        // review will appear. Both are needed and they are not the same thing.
        productName: row.nameSnapshot,
        productSlug: row.product.slug,
        variantLabel: row.variantLabelSnapshot,
        image: row.imageKeySnapshot
          ? { src: toPublicAssetUrl(row.imageKeySnapshot), alt: row.nameSnapshot }
          : null,
      },
    ];
  });
}

/**
 * One reviewable line, scoped to its buyer.
 *
 * The scope is the point: `order.userId` is in the `where`, so another
 * customer's order-item id returns `null` — indistinguishable from an id that
 * does not exist, which is the rule Phase 11 established for the whole portal.
 */
export async function findReviewableItem(input: {
  userId: string;
  orderItemId: string;
}): Promise<{
  orderItemId: string;
  orderNumber: string;
  orderStatus: string;
  productId: string | null;
  productName: string;
  productSlug: string | null;
  variantLabel: string | null;
  alreadyReviewed: boolean;
} | null> {
  const row = await prisma.orderItem.findFirst({
    where: { id: input.orderItemId, order: { userId: input.userId } },
    select: {
      id: true,
      nameSnapshot: true,
      variantLabelSnapshot: true,
      productId: true,
      product: {
        select: {
          slug: true,
          reviews: {
            where: { userId: input.userId, deletedAt: null },
            select: { id: true },
            take: 1,
          },
        },
      },
      order: { select: { orderNumber: true, status: true } },
    },
  });

  if (!row) return null;

  return {
    orderItemId: row.id,
    orderNumber: row.order.orderNumber,
    orderStatus: row.order.status,
    productId: row.productId,
    productName: row.nameSnapshot,
    productSlug: row.product?.slug ?? null,
    variantLabel: row.variantLabelSnapshot,
    alreadyReviewed: (row.product?.reviews.length ?? 0) > 0,
  };
}

export async function listReviewsByAuthor(input: {
  userId: string;
  limit?: number;
}): Promise<readonly OwnReview[]> {
  const rows = await prisma.review.findMany({
    where: { userId: input.userId, deletedAt: null },
    select: {
      id: true,
      status: true,
      rating: true,
      title: true,
      body: true,
      createdAt: true,
      adminResponse: true,
      product: { select: { name: true, slug: true } },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: Math.min(input.limit ?? 20, 50),
  });

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    rating: row.rating,
    title: row.title,
    body: row.body,
    createdAt: row.createdAt,
    adminResponse: row.adminResponse,
    productName: row.product.name,
    productSlug: row.product.slug,
  }));
}

/* ---------------------------------------------------------------------------
 * Writes
 * ------------------------------------------------------------------------ */

export type CreateReviewResult =
  { ok: true; reviewId: string } | { ok: false; reason: 'DUPLICATE' };

/**
 * Record a review, pending moderation.
 *
 * `isVerifiedPurchase` is set from the fact that an `orderItemId` was resolved
 * against a delivered order of this customer's — never from the payload, which
 * carries no such field. 11A.1 makes it always true in V1, and it is written
 * here rather than defaulted so the column means what it says.
 *
 * The unique violation is caught rather than pre-checked: two submissions
 * racing each other both pass a prior `SELECT`, and only the index decides.
 */
export async function createReview(input: {
  userId: string;
  productId: string;
  orderItemId: string;
  rating: number;
  title: string | null;
  body: string;
}): Promise<CreateReviewResult> {
  try {
    const review = await prisma.review.create({
      data: {
        userId: input.userId,
        productId: input.productId,
        orderItemId: input.orderItemId,
        rating: input.rating,
        title: input.title,
        body: input.body,
        status: 'PENDING',
        isVerifiedPurchase: true,
      },
      select: { id: true },
    });

    return { ok: true, reviewId: review.id };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: 'DUPLICATE' };

    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;

  return code === 'P2002' || code === '23505';
}

/* ---------------------------------------------------------------------------
 * Moderation
 * ------------------------------------------------------------------------ */

export const MODERATION_PAGE_SIZE = 25;

export async function listReviewsForModeration(input: {
  status?: ReviewStatus | null;
  limit?: number;
  archived?: boolean;
}): Promise<readonly ModerationReview[]> {
  const rows = await prisma.review.findMany({
    where: {
      deletedAt: null,
      ...archiveWhere(input.archived),
      ...(input.status ? { status: input.status } : {}),
    },
    select: {
      id: true,
      status: true,
      rating: true,
      title: true,
      body: true,
      createdAt: true,
      adminResponse: true,
      user: { select: { name: true, email: true } },
      product: { select: { name: true, slug: true } },
      orderItem: { select: { order: { select: { orderNumber: true } } } },
    },
    // Newest first. "What needs a decision" is the `status` filter the queue
    // defaults to, not an ordering trick that depends on the enum's order.
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: Math.min(input.limit ?? MODERATION_PAGE_SIZE, MODERATION_PAGE_SIZE),
  });

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    rating: row.rating,
    title: row.title,
    body: row.body,
    createdAt: row.createdAt,
    authorName: row.user.name,
    authorEmail: row.user.email,
    productName: row.product.name,
    productSlug: row.product.slug,
    orderNumber: row.orderItem?.order.orderNumber ?? null,
    adminResponse: row.adminResponse,
  }));
}

export async function countReviewsByStatus(): Promise<Record<ReviewStatus, number>> {
  const groups = await prisma.review.groupBy({
    by: ['status'],
    where: { deletedAt: null },
    _count: { _all: true },
  });

  const counts: Record<ReviewStatus, number> = { PENDING: 0, APPROVED: 0, REJECTED: 0 };
  for (const group of groups) counts[group.status] = group._count._all;

  return counts;
}

export type ModerationResult =
  | {
      ok: true;
      productSlug: string;
      rating: { average: number | null; count: number };
    }
  | { ok: false; reason: 'NOT_FOUND' | 'UNCHANGED' };

/**
 * Approve or reject a review, and recompute the product's rating with it.
 *
 * 11A.3 requires the recomputation to happen "in the same transaction", and
 * this is that transaction. The average is not adjusted incrementally — it is
 * recomputed from the approved rows, because an incremental update is how a
 * denormalised aggregate drifts from the rows it summarises and there is no
 * cheap way to notice.
 *
 * The verdict is applied with a **conditional** update on the status the
 * moderator was looking at, so two moderators acting at once do not both
 * believe they decided. The loser is told the review changed rather than
 * silently overwriting the winner.
 */
export async function moderateReview(input: {
  reviewId: string;
  from: ReviewStatus;
  to: 'APPROVED' | 'REJECTED';
  moderatorUserId: string;
  adminResponse: string | null;
}): Promise<ModerationResult> {
  return prisma.$transaction(async (tx) => {
    const review = await tx.review.findFirst({
      where: { id: input.reviewId, deletedAt: null },
      select: { id: true, productId: true, product: { select: { slug: true } } },
    });

    if (!review) return { ok: false as const, reason: 'NOT_FOUND' as const };

    const claimed = await tx.review.updateMany({
      where: { id: input.reviewId, status: input.from, deletedAt: null },
      data: {
        status: input.to,
        adminResponse: input.adminResponse,
        moderatedByUserId: input.moderatorUserId,
        moderatedAt: new Date(),
      },
    });

    if (claimed.count !== 1) return { ok: false as const, reason: 'UNCHANGED' as const };

    const approved = await tx.review.findMany({
      where: { productId: review.productId, status: 'APPROVED', deletedAt: null },
      select: { rating: true },
    });

    const summary = summariseRatings(approved.map((row) => row.rating));

    await tx.product.update({
      where: { id: review.productId },
      data: { ratingAverage: summary.average, ratingCount: summary.count },
    });

    return {
      ok: true as const,
      productSlug: review.product.slug,
      rating: { average: summary.average, count: summary.count },
    };
  });
}

/** The stored aggregate, for a test that wants to compare it against the rows. */
export async function readStoredRating(
  productId: string,
): Promise<{ average: number | null; count: number } | null> {
  const row = await prisma.product.findUnique({
    where: { id: productId },
    select: { ratingAverage: true, ratingCount: true },
  });

  return row ? { average: row.ratingAverage, count: row.ratingCount } : null;
}

export { EMPTY_DISTRIBUTION };
export type { RatingDistribution, RatingSummary };
