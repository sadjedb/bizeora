'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireCustomer } from '@/server/auth/guards';
import { submitPaymentProof } from '@/server/services/order-admin-service';

/**
 * Submitting a transfer receipt (8.10.2).
 *
 * The payload is an order number and a file id — **no amount, no status, no
 * payment**. Submitting proof is a claim, not a payment: `paymentStatus` moves
 * only when an admin records a `payments` row after looking at it (8.10.4), and
 * there is no field here through which a customer could assert otherwise.
 *
 * Both identifiers are checked against the customer in the query: the order
 * must be theirs, and the file must be a `READY` one they uploaded.
 */

const submitInput = z.object({
  orderNumber: z.string().min(1).max(50),
  designFileId: z.uuid(),
});

export type ProofResult = { ok: true } | { ok: false; message: string };

export async function submitPaymentProofAction(raw: unknown): Promise<ProofResult> {
  const parsed = submitInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: 'Justificatif invalide.' };

  const authorisation = await requireCustomer();
  if (!authorisation.ok) {
    return {
      ok: false,
      message:
        authorisation.reason === 'UNAUTHENTICATED'
          ? 'Connectez-vous pour envoyer votre justificatif.'
          : 'Cette commande ne vous appartient pas.',
    };
  }

  const submitted = await submitPaymentProof({
    orderNumber: parsed.data.orderNumber,
    userId: authorisation.actor.userId,
    designFileId: parsed.data.designFileId,
  });

  if (!submitted.ok) return { ok: false, message: submitted.error.message };

  revalidatePath(`/account/orders/${parsed.data.orderNumber}`);
  return { ok: true };
}
