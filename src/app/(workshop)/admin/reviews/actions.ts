'use server';

import { revalidatePath } from 'next/cache';

import { REVIEW_STATUSES, type ReviewStatus } from '@/domain/review';
import { mayModerateReviews } from '@/domain/permissions';
import { LOCALES } from '@/i18n/locales';
import { requireStaff } from '@/server/auth/guards';
import { moderate } from '@/server/services/review-service';

/**
 * Moderating a review.
 *
 * **Every action authorises independently.** The `/admin` layout guards what is
 * rendered, and that is not authorisation: an action is reachable without a
 * page ever rendering. So this calls `requireStaff` and then the capability
 * predicate from `domain/permissions` over the loaded actor, exactly as Phase
 * 12's actions do.
 *
 * The payload carries the review, the status the moderator was looking at, the
 * verdict and an optional public reply. It carries **no rating and no product**
 * — the rating is recomputed inside the repository's transaction from the
 * approved rows (11A.3), and the product is the review's own.
 *
 * `from` makes the update conditional: two moderators with the queue open
 * cannot both believe they decided, and the loser is told the review moved.
 *
 * Approving or rejecting changes what the product page shows, so its path is
 * revalidated here. Without that the storefront's five-minute ISR window would
 * leave a just-approved review invisible, or a just-rejected one visible.
 */

export type ModerationActionResult = { ok: true } | { ok: false; message: string };

const UNAUTHENTICATED = 'Connectez-vous pour modérer les avis.';
const FORBIDDEN = 'Vous n’avez pas accès à la modération des avis.';

function isReviewStatus(value: string): value is ReviewStatus {
  return (REVIEW_STATUSES as readonly string[]).includes(value);
}

export async function moderateReviewAction(input: {
  reviewId: string;
  from: string;
  to: 'APPROVED' | 'REJECTED';
  adminResponse: string | null;
}): Promise<ModerationActionResult> {
  const authorisation = await requireStaff();

  if (!authorisation.ok) {
    return {
      ok: false,
      message: authorisation.reason === 'UNAUTHENTICATED' ? UNAUTHENTICATED : FORBIDDEN,
    };
  }

  const actor = authorisation.actor;
  if (!mayModerateReviews(actor)) return { ok: false, message: FORBIDDEN };

  // The status the moderator was looking at arrives as a string from a form.
  // An unrecognised one is refused rather than coerced.
  if (!isReviewStatus(input.from)) {
    return { ok: false, message: 'État inconnu. Rechargez la liste.' };
  }

  const result = await moderate({
    reviewId: input.reviewId,
    from: input.from,
    to: input.to,
    moderatorUserId: actor.userId,
    adminResponse: input.adminResponse,
  });

  if (!result.ok) return { ok: false, message: result.error.message };

  revalidatePath('/admin/reviews');
  for (const locale of LOCALES) {
    revalidatePath(`/${locale}/shop/${result.value.productSlug}`);
  }

  return { ok: true };
}
