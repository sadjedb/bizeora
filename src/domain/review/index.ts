import { err, ok, type Result } from '../result';

/**
 * Reviews.
 *
 * `BUSINESS-RULES.md` 11A is four sentences long, and every one of them is a
 * rule this file owns:
 *
 *   - 11A.1 a review requires an authenticated user with a **delivered** order
 *     containing the product, so `isVerifiedPurchase` is always true in V1;
 *   - 11A.2 one review per customer per product;
 *   - 11A.3 reviews are `PENDING` until moderated, only `APPROVED` ones are
 *     public, and moderation recomputes the product's denormalised rating in
 *     the same transaction;
 *   - 11A.4 a guest purchaser cannot review until they claim their order.
 *
 * Nothing here reads a database or decides who is signed in. It takes facts a
 * caller has already loaded — an order's status, whether a review exists — and
 * answers whether the rule permits the thing being asked for.
 *
 * The rating arithmetic lives here for the same reason pricing does: the
 * average is denormalised onto `products.ratingAverage`, and a second
 * implementation of "what is this product's rating" is exactly how a listing
 * and a detail page come to disagree.
 */

export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export const REVIEW_STATUSES: readonly ReviewStatus[] = [
  'PENDING',
  'APPROVED',
  'REJECTED',
];

/** French labels, so a status is written once rather than in each view. */
export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  PENDING: 'En attente',
  APPROVED: 'Publié',
  REJECTED: 'Refusé',
};

/* ---------------------------------------------------------------------------
 * Submission
 * ------------------------------------------------------------------------ */

export const RATING_MIN = 1;
export const RATING_MAX = 5;

/**
 * Body length bounds.
 *
 * A floor because "super" is not a review and gives a reader nothing; a ceiling
 * because the column is unbounded text and an unbounded public write is a way
 * to fill a database. Neither is in `BUSINESS-RULES.md`, which is silent on
 * length — these are the smallest defensible limits, stated here so the form,
 * the action and the test all read the same numbers.
 */
export const REVIEW_BODY_MIN = 20;
export const REVIEW_BODY_MAX = 2000;
export const REVIEW_TITLE_MAX = 120;

export type ReviewDraft = {
  rating: number;
  title: string | null;
  body: string;
};

export type ReviewValidationError = {
  code: 'INVALID_RATING' | 'BODY_TOO_SHORT' | 'BODY_TOO_LONG' | 'TITLE_TOO_LONG';
  message: string;
  /** Which control to move focus to. */
  field: 'rating' | 'title' | 'body';
};

export function isValidRating(rating: number): boolean {
  return Number.isInteger(rating) && rating >= RATING_MIN && rating <= RATING_MAX;
}

/**
 * Validate what the customer typed, and normalise it.
 *
 * Returns the draft with its whitespace collapsed at the edges and an empty
 * title turned into `null`, because `title` is nullable and a row holding `''`
 * renders an empty heading that looks like a bug.
 */
export function validateReviewDraft(
  draft: ReviewDraft,
): Result<ReviewDraft, ReviewValidationError> {
  if (!isValidRating(draft.rating)) {
    return err({
      code: 'INVALID_RATING',
      field: 'rating',
      message: 'Choisissez une note de 1 à 5 étoiles.',
    });
  }

  const title = draft.title?.trim() ?? '';
  const body = draft.body.trim();

  if (title.length > REVIEW_TITLE_MAX) {
    return err({
      code: 'TITLE_TOO_LONG',
      field: 'title',
      message: `Le titre ne peut pas dépasser ${REVIEW_TITLE_MAX} caractères.`,
    });
  }

  if (body.length < REVIEW_BODY_MIN) {
    return err({
      code: 'BODY_TOO_SHORT',
      field: 'body',
      message: `Écrivez au moins ${REVIEW_BODY_MIN} caractères, pour que votre avis soit utile.`,
    });
  }

  if (body.length > REVIEW_BODY_MAX) {
    return err({
      code: 'BODY_TOO_LONG',
      field: 'body',
      message: `Votre avis ne peut pas dépasser ${REVIEW_BODY_MAX} caractères.`,
    });
  }

  return ok({ rating: draft.rating, title: title === '' ? null : title, body });
}

/* ---------------------------------------------------------------------------
 * Eligibility (11A.1, 11A.2)
 * ------------------------------------------------------------------------ */

export type ReviewEligibilityInput = {
  /** The status of the order the line belongs to. */
  orderStatus: string;
  /** False for a fee line, and for a line whose product row has been removed. */
  namesAProduct: boolean;
  /** Whether this customer already has a live review of this product. */
  alreadyReviewed: boolean;
};

export type ReviewEligibility =
  | { eligible: true }
  | { eligible: false; reason: 'NOT_DELIVERED' | 'NOT_A_PRODUCT' | 'ALREADY_REVIEWED' };

/**
 * Whether this order line may be reviewed.
 *
 * `DELIVERED` and nothing else: 11A.1 ties the right to review to the product
 * having arrived, which is what makes the review worth reading. A shipped order
 * is not delivered, and a refunded one is no longer a purchase.
 */
export function reviewEligibility(input: ReviewEligibilityInput): ReviewEligibility {
  if (input.orderStatus !== 'DELIVERED') {
    return { eligible: false, reason: 'NOT_DELIVERED' };
  }

  if (!input.namesAProduct) return { eligible: false, reason: 'NOT_A_PRODUCT' };
  if (input.alreadyReviewed) return { eligible: false, reason: 'ALREADY_REVIEWED' };

  return { eligible: true };
}

export const REVIEW_INELIGIBILITY_MESSAGES: Record<
  Exclude<ReviewEligibility, { eligible: true }>['reason'],
  string
> = {
  NOT_DELIVERED: 'Vous pourrez donner votre avis une fois la commande livrée.',
  NOT_A_PRODUCT: 'Cette ligne ne correspond pas à un produit du catalogue.',
  ALREADY_REVIEWED: 'Vous avez déjà donné votre avis sur ce produit.',
};

/* ---------------------------------------------------------------------------
 * Moderation (11A.3)
 * ------------------------------------------------------------------------ */

/** The moderator's two verdicts. `PENDING` is not something one moves back to. */
export type ModerationVerdict = 'APPROVED' | 'REJECTED';

/**
 * Whether a review may move from `from` to `to`.
 *
 * Every transition into a verdict is allowed, including changing one's mind
 * about an already-moderated review — the rating is recomputed either way, so a
 * mistaken approval is undone by rejecting it. Moving *to* `PENDING` is not:
 * "not yet looked at" is a fact about history, not a state to return to.
 */
export function mayModerateFrom(from: ReviewStatus, to: ModerationVerdict): boolean {
  return from !== to;
}

/* ---------------------------------------------------------------------------
 * The denormalised rating
 * ------------------------------------------------------------------------ */

/** How many approved reviews gave each star count. Index 0 is one star. */
export type RatingDistribution = readonly [number, number, number, number, number];

export const EMPTY_DISTRIBUTION: RatingDistribution = [0, 0, 0, 0, 0];

export type RatingSummary = {
  /** `products.ratingAverage`: the mean × 100, or null with no reviews. */
  average: number | null;
  count: number;
  distribution: RatingDistribution;
};

/**
 * The rating a product's approved reviews add up to.
 *
 * `DATABASE.md` section 6 stores the average as an integer × 100 — 465 is 4.65
 * — for the same reason money is an integer: a float average that round-trips
 * through a column is a number nobody can reproduce. Rounding is half-up on the
 * hundredth, which is the only place the value loses information.
 *
 * With no approved reviews the average is `null`, not `0`. Zero is a rating; no
 * rating is not, and a card that renders "0/5" for an unreviewed product is
 * actively misleading.
 */
export function summariseRatings(ratings: readonly number[]): RatingSummary {
  const distribution: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  let total = 0;
  let count = 0;

  for (const rating of ratings) {
    if (!isValidRating(rating)) continue;

    // Indexed writes are widened by `noUncheckedIndexedAccess`, and `rating`
    // has already been checked to be 1–5, so the read cannot be undefined.
    distribution[rating - 1] = (distribution[rating - 1] ?? 0) + 1;
    total += rating;
    count += 1;
  }

  return {
    average: count === 0 ? null : Math.round((total * 100) / count),
    count,
    distribution,
  };
}

/** Build the same summary from counts per star, which is what a `GROUP BY` returns. */
export function summariseFromCounts(counts: RatingDistribution): RatingSummary {
  const ratings: number[] = [];

  counts.forEach((occurrences, index) => {
    for (let n = 0; n < occurrences; n += 1) ratings.push(index + 1);
  });

  return summariseRatings(ratings);
}

/** `465` → `"4,65"`, in the French decimal notation the rest of the UI uses. */
export function formatAverage(average: number | null): string | null {
  if (average === null) return null;

  return (average / 100).toFixed(2).replace('.', ',');
}

/** `465` → `4.65`, for `aria-label` and structured data. */
export function averageAsNumber(average: number | null): number | null {
  return average === null ? null : average / 100;
}

/** What share of the approved reviews gave this many stars, 0–100. */
export function distributionPercent(
  distribution: RatingDistribution,
  stars: number,
  count: number,
): number {
  if (count === 0 || !isValidRating(stars)) return 0;

  return Math.round(((distribution[stars - 1] ?? 0) * 100) / count);
}
