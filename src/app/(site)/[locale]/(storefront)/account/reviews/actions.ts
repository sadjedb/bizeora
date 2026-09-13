'use server';

import { revalidatePath } from 'next/cache';

import { mayWriteReview } from '@/domain/permissions';
import { requireCustomer } from '@/server/auth/guards';
import { submitReview } from '@/server/services/review-service';

/**
 * Writing a review.
 *
 * The payload is an **order-item id, a rating and words**. It names no product,
 * no user, no status and no verified-purchase flag, because every one of those
 * is decided on the server from the order line the id resolves to — and that
 * resolution is scoped to the signed-in customer inside the query, so somebody
 * else's line is "not found" rather than "not yours".
 *
 * Three checks in order, none of them the interface:
 *
 *   1. `requireCustomer` — signed in, active, and a customer. Staff are refused
 *      for the reason 12.3 refuses them a quote acceptance: a review is a
 *      customer's statement about their own purchase.
 *   2. `mayWriteReview` — the same decision as a pure predicate over the actor,
 *      so it is unit-testable without a session.
 *   3. the service — delivered, a real product, not already reviewed (11A.1,
 *      11A.2), with the partial unique index having the last word.
 *
 * Nothing published: a new review is `PENDING` until a moderator acts (11A.3).
 */

export type SubmitReviewResult =
  { ok: true } | { ok: false; message: string; field?: 'rating' | 'title' | 'body' };

const UNAUTHENTICATED = 'Connectez-vous pour donner votre avis.';
const FORBIDDEN = 'Seuls les clients peuvent donner un avis.';

export async function submitReviewAction(input: {
  orderItemId: string;
  rating: number;
  title: string;
  body: string;
}): Promise<SubmitReviewResult> {
  const authorisation = await requireCustomer();

  if (!authorisation.ok) {
    return {
      ok: false,
      message: authorisation.reason === 'UNAUTHENTICATED' ? UNAUTHENTICATED : FORBIDDEN,
    };
  }

  const actor = authorisation.actor;
  if (!mayWriteReview(actor)) return { ok: false, message: FORBIDDEN };

  const result = await submitReview({
    userId: actor.userId,
    orderItemId: input.orderItemId,
    draft: { rating: input.rating, title: input.title, body: input.body },
  });

  if (!result.ok) {
    return {
      ok: false,
      message: result.error.message,
      ...(result.error.field ? { field: result.error.field } : {}),
    };
  }

  revalidatePath('/account/reviews');

  return { ok: true };
}
