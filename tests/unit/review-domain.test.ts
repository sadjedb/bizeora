import { describe, expect, it } from 'vitest';

import {
  EMPTY_DISTRIBUTION,
  RATING_MAX,
  RATING_MIN,
  REVIEW_BODY_MAX,
  REVIEW_BODY_MIN,
  REVIEW_STATUSES,
  REVIEW_STATUS_LABELS,
  REVIEW_TITLE_MAX,
  averageAsNumber,
  distributionPercent,
  formatAverage,
  isValidRating,
  mayModerateFrom,
  reviewEligibility,
  summariseFromCounts,
  summariseRatings,
  validateReviewDraft,
} from '@/domain/review';

/**
 * `BUSINESS-RULES.md` 11A, as arithmetic and predicates.
 *
 * The rating maths gets the most attention here because it is denormalised onto
 * `products.ratingAverage`: a mistake in it is not a wrong number on one page,
 * it is a wrong number written into the catalogue and read by every listing
 * until somebody moderates that product again.
 */

describe('rating validity', () => {
  it('accepts exactly one to five, as integers', () => {
    expect(isValidRating(RATING_MIN)).toBe(true);
    expect(isValidRating(RATING_MAX)).toBe(true);
    expect(isValidRating(3)).toBe(true);

    expect(isValidRating(0)).toBe(false);
    expect(isValidRating(6)).toBe(false);
    expect(isValidRating(4.5)).toBe(false);
    expect(isValidRating(Number.NaN)).toBe(false);
  });
});

describe('the submitted draft', () => {
  const body = 'a'.repeat(REVIEW_BODY_MIN);

  it('normalises whitespace and turns an empty title into null', () => {
    const result = validateReviewDraft({ rating: 4, title: '   ', body: `  ${body}  ` });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.title).toBeNull();
    expect(result.value.body).toBe(body);
  });

  it('keeps a real title', () => {
    const result = validateReviewDraft({ rating: 4, title: ' Parfait ', body });

    expect(result.ok && result.value.title).toBe('Parfait');
  });

  it('refuses a rating outside the scale, naming the control', () => {
    const result = validateReviewDraft({ rating: 0, title: null, body });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe('INVALID_RATING');
    expect(result.error.field).toBe('rating');
  });

  it('refuses a body that says nothing, and one that never stops', () => {
    const short = validateReviewDraft({
      rating: 5,
      title: null,
      body: 'a'.repeat(REVIEW_BODY_MIN - 1),
    });

    const long = validateReviewDraft({
      rating: 5,
      title: null,
      body: 'a'.repeat(REVIEW_BODY_MAX + 1),
    });

    expect(short.ok).toBe(false);
    expect(long.ok).toBe(false);
    if (short.ok || long.ok) return;

    expect(short.error.code).toBe('BODY_TOO_SHORT');
    expect(long.error.code).toBe('BODY_TOO_LONG');
    expect(short.error.field).toBe('body');
  });

  it('refuses an over-long title', () => {
    const result = validateReviewDraft({
      rating: 5,
      title: 'a'.repeat(REVIEW_TITLE_MAX + 1),
      body,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe('TITLE_TOO_LONG');
    expect(result.error.field).toBe('title');
  });

  it('measures the trimmed body, not the typed one', () => {
    const padded = `${' '.repeat(50)}${'a'.repeat(REVIEW_BODY_MIN - 1)}${' '.repeat(50)}`;

    expect(validateReviewDraft({ rating: 5, title: null, body: padded }).ok).toBe(false);
  });
});

describe('who may review what (11A.1, 11A.2)', () => {
  const base = { orderStatus: 'DELIVERED', namesAProduct: true, alreadyReviewed: false };

  it('allows a delivered order line that names a product', () => {
    expect(reviewEligibility(base)).toEqual({ eligible: true });
  });

  it('refuses every status that is not DELIVERED', () => {
    for (const status of [
      'AWAITING_PAYMENT',
      'AWAITING_CONFIRMATION',
      'CONFIRMED',
      'DESIGN_REVIEW',
      'IN_PRODUCTION',
      'READY',
      'SHIPPED',
      'ON_HOLD',
      'CANCELLED',
      'REFUNDED',
    ]) {
      expect(reviewEligibility({ ...base, orderStatus: status })).toEqual({
        eligible: false,
        reason: 'NOT_DELIVERED',
      });
    }
  });

  it('refuses a fee line, which names no product', () => {
    expect(reviewEligibility({ ...base, namesAProduct: false })).toEqual({
      eligible: false,
      reason: 'NOT_A_PRODUCT',
    });
  });

  it('refuses a second review of the same product', () => {
    expect(reviewEligibility({ ...base, alreadyReviewed: true })).toEqual({
      eligible: false,
      reason: 'ALREADY_REVIEWED',
    });
  });
});

describe('moderation transitions (11A.3)', () => {
  it('allows a verdict that changes something', () => {
    expect(mayModerateFrom('PENDING', 'APPROVED')).toBe(true);
    expect(mayModerateFrom('PENDING', 'REJECTED')).toBe(true);
    expect(mayModerateFrom('APPROVED', 'REJECTED')).toBe(true);
    expect(mayModerateFrom('REJECTED', 'APPROVED')).toBe(true);
  });

  it('refuses a verdict that is already the state', () => {
    expect(mayModerateFrom('APPROVED', 'APPROVED')).toBe(false);
    expect(mayModerateFrom('REJECTED', 'REJECTED')).toBe(false);
  });

  it('labels every status the database can hold', () => {
    for (const status of REVIEW_STATUSES) {
      expect(REVIEW_STATUS_LABELS[status]).toBeTruthy();
    }

    expect(Object.keys(REVIEW_STATUS_LABELS).sort()).toEqual([...REVIEW_STATUSES].sort());
  });
});

describe('the denormalised rating', () => {
  it('is null with no reviews, not zero', () => {
    const summary = summariseRatings([]);

    expect(summary.average).toBeNull();
    expect(summary.count).toBe(0);
    expect(summary.distribution).toEqual(EMPTY_DISTRIBUTION);
  });

  it('stores the mean times one hundred', () => {
    // (5 + 4 + 5) / 3 = 4.666… → 467
    expect(summariseRatings([5, 4, 5]).average).toBe(467);
    expect(summariseRatings([4, 5]).average).toBe(450);
    expect(summariseRatings([4]).average).toBe(400);
  });

  it('rounds half up on the hundredth', () => {
    // (5 + 4 + 4 + 4 + 4 + 4) / 6 = 4.1666… → 417
    expect(summariseRatings([5, 4, 4, 4, 4, 4]).average).toBe(417);
  });

  it('counts each star, in order', () => {
    const summary = summariseRatings([5, 5, 3, 1]);

    expect(summary.distribution).toEqual([1, 0, 1, 0, 2]);
    expect(summary.count).toBe(4);
  });

  it('ignores a rating outside the scale rather than averaging it in', () => {
    const summary = summariseRatings([5, 9, 0, 4]);

    expect(summary.count).toBe(2);
    expect(summary.average).toBe(450);
  });

  it('agrees with itself whether built from ratings or from counts', () => {
    const ratings = [5, 5, 4, 3, 3, 1];
    const fromRatings = summariseRatings(ratings);
    const fromCounts = summariseFromCounts(fromRatings.distribution);

    expect(fromCounts).toEqual(fromRatings);
  });
});

describe('presenting a rating', () => {
  it('writes the average in French decimal notation', () => {
    expect(formatAverage(467)).toBe('4,67');
    expect(formatAverage(500)).toBe('5,00');
    expect(formatAverage(null)).toBeNull();
  });

  it('exposes the average as a plain number for labels', () => {
    expect(averageAsNumber(467)).toBeCloseTo(4.67);
    expect(averageAsNumber(null)).toBeNull();
  });

  it('computes each bar as a whole percentage of the reviews', () => {
    const distribution = summariseRatings([5, 5, 5, 4]).distribution;

    expect(distributionPercent(distribution, 5, 4)).toBe(75);
    expect(distributionPercent(distribution, 4, 4)).toBe(25);
    expect(distributionPercent(distribution, 1, 4)).toBe(0);
  });

  it('never divides by zero', () => {
    expect(distributionPercent(EMPTY_DISTRIBUTION, 5, 0)).toBe(0);
    expect(distributionPercent(EMPTY_DISTRIBUTION, 9, 10)).toBe(0);
  });
});
