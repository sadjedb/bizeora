'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireCustomer } from '@/server/auth/guards';
import { postCustomerMessage } from '@/server/services/quote-service';

/**
 * The one thing a customer may write on their own request.
 *
 * 6.7.2: a message is a message. This action carries **no status, no type and
 * no internal flag** — the payload has three fields, and none of them can turn
 * the message into an `INTERNAL_NOTE` or move the request. Clearing a
 * `NEEDS_INFO` block is 6.7.3's, and it belongs to the admin who asked, because
 * only they can judge whether what arrived is enough.
 *
 * Ownership is resolved by the service through `findRequestForOwner`, which
 * filters on `userId` in the query — so a request number belonging to somebody
 * else is "not found" rather than a message on their thread.
 */

const replyInput = z.object({
  requestNumber: z.string().min(1).max(50),
  message: z.string().trim().min(1).max(2_000),
});

export type ReplyResult = { ok: true } | { ok: false; message: string };

export async function replyToRequestAction(raw: unknown): Promise<ReplyResult> {
  const parsed = replyInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: 'Votre message est vide ou trop long.' };
  }

  const authorisation = await requireCustomer();
  if (!authorisation.ok) {
    return {
      ok: false,
      message:
        authorisation.reason === 'UNAUTHENTICATED'
          ? 'Connectez-vous pour répondre.'
          : 'Cette demande ne vous appartient pas.',
    };
  }

  const posted = await postCustomerMessage({
    requestNumber: parsed.data.requestNumber,
    userId: authorisation.actor.userId,
    message: parsed.data.message,
  });

  if (!posted.ok) return { ok: false, message: posted.error.message };

  revalidatePath(`/account/requests/${parsed.data.requestNumber}`);
  return { ok: true };
}
