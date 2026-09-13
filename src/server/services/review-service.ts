import 'server-only';

import {
  REVIEW_INELIGIBILITY_MESSAGES,
  mayModerateFrom,
  reviewEligibility,
  validateReviewDraft,
  type ModerationVerdict,
  type ReviewDraft,
  type ReviewStatus,
} from '@/domain/review';
import { err, ok, type Result } from '@/domain/result';
import {
  createReview,
  findReviewableItem,
  moderateReview,
} from '@/server/repositories/review-repository';

/**
 * Reviews: the two use cases.
 *
 * **Submitting** is the interesting one, because it is the only place in the
 * application where a customer writes something a stranger will read. The
 * defence is that nothing in the payload decides anything that matters:
 *
 *   - the **product** comes from the order line, never from the request. A
 *     payload naming a product is a payload that can review a product the
 *     customer never bought;
 *   - the **order line** is resolved with `order.userId` in the query, so
 *     another customer's line is "not found";
 *   - **eligibility** — delivered, a real product, not already reviewed — is
 *     `domain/review`'s decision over that loaded row;
 *   - **status** is always `PENDING`. There is no path through this module that
 *     publishes anything (11A.3), and `isVerifiedPurchase` is set from the
 *     resolved order rather than claimed.
 *
 * **Moderating** is where the rating changes, and it changes inside the
 * repository's transaction because 11A.3 says the recomputation and the verdict
 * are one act. The service's job is to authorise, to refuse a verdict that is
 * not a change, and to say which product page is now stale.
 */

export type ReviewError = {
  code:
    'NOT_FOUND' | 'NOT_ELIGIBLE' | 'INVALID' | 'DUPLICATE' | 'UNCHANGED' | 'NO_PRODUCT';
  message: string;
  /** Which control the form should move focus to, when the failure has one. */
  field?: 'rating' | 'title' | 'body';
};

export type SubmittedReview = { reviewId: string; productSlug: string };

/**
 * Record a customer's review of something they bought.
 *
 * `orderItemId` is the only identifier the caller supplies, and it is scoped to
 * the customer inside the query. Everything else — product, verified-purchase
 * flag, status — is derived from the row that lookup returns.
 */
export async function submitReview(input: {
  userId: string;
  orderItemId: string;
  draft: ReviewDraft;
}): Promise<Result<SubmittedReview, ReviewError>> {
  const item = await findReviewableItem({
    userId: input.userId,
    orderItemId: input.orderItemId,
  });

  // A line belonging to somebody else is indistinguishable from one that does
  // not exist. Phase 11's rule, applied to a new surface.
  if (!item) {
    return err({ code: 'NOT_FOUND', message: 'Cette commande est introuvable.' });
  }

  const eligibility = reviewEligibility({
    orderStatus: item.orderStatus,
    namesAProduct: item.productId !== null,
    alreadyReviewed: item.alreadyReviewed,
  });

  if (!eligibility.eligible) {
    return err({
      code: 'NOT_ELIGIBLE',
      message: REVIEW_INELIGIBILITY_MESSAGES[eligibility.reason],
    });
  }

  const validated = validateReviewDraft(input.draft);

  if (!validated.ok) {
    return err({
      code: 'INVALID',
      message: validated.error.message,
      field: validated.error.field,
    });
  }

  // `reviewEligibility` has already refused a line with no product; this is the
  // type narrowing that follows from it.
  const productId = item.productId;
  const productSlug = item.productSlug;

  if (productId === null || productSlug === null) {
    return err({
      code: 'NO_PRODUCT',
      message: REVIEW_INELIGIBILITY_MESSAGES.NOT_A_PRODUCT,
    });
  }

  const created = await createReview({
    userId: input.userId,
    productId,
    orderItemId: item.orderItemId,
    rating: validated.value.rating,
    title: validated.value.title,
    body: validated.value.body,
  });

  // The partial unique index, not a prior read, is what decides: two
  // submissions racing each other both pass an eligibility check.
  if (!created.ok) {
    return err({
      code: 'DUPLICATE',
      message: REVIEW_INELIGIBILITY_MESSAGES.ALREADY_REVIEWED,
    });
  }

  return ok({ reviewId: created.reviewId, productSlug });
}

export type ModerationOutcome = {
  productSlug: string;
  rating: { average: number | null; count: number };
};

/**
 * Approve or reject a review.
 *
 * `from` is the status the moderator was looking at, and it is what makes the
 * repository's update conditional: a queue open in two tabs cannot approve the
 * same review twice, and the second attempt is told the review moved rather
 * than silently overwriting the first.
 */
export async function moderate(input: {
  reviewId: string;
  from: ReviewStatus;
  to: ModerationVerdict;
  moderatorUserId: string;
  adminResponse: string | null;
}): Promise<Result<ModerationOutcome, ReviewError>> {
  if (!mayModerateFrom(input.from, input.to)) {
    return err({ code: 'UNCHANGED', message: 'Cet avis est déjà dans cet état.' });
  }

  const response = input.adminResponse?.trim();

  const result = await moderateReview({
    reviewId: input.reviewId,
    from: input.from,
    to: input.to,
    moderatorUserId: input.moderatorUserId,
    adminResponse: response ? response : null,
  });

  if (!result.ok) {
    return err(
      result.reason === 'NOT_FOUND'
        ? { code: 'NOT_FOUND', message: 'Cet avis est introuvable.' }
        : {
            code: 'UNCHANGED',
            message: 'Cet avis a changé entre-temps. Rechargez la liste.',
          },
    );
  }

  return ok({ productSlug: result.productSlug, rating: result.rating });
}
