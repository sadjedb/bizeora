'use server';

import { revalidatePath } from 'next/cache';

import { mayRespondToQuote } from '@/domain/permissions';
import { siteSettings } from '@/server/services/settings-service';
import { requireCustomer } from '@/server/auth/guards';
import { acceptQuoteAsOwner, declineQuoteAsOwner } from '@/server/services/quote-service';
import { findQuoteForOwner } from '@/server/repositories/quote-repository';

/**
 * The customer's two decisions.
 *
 * Both take a **quote number and nothing else**. There is no amount, no total,
 * no deposit and no status in either payload — the same absence Phases 7, 8 and
 * 9 rely on. Everything the acceptance writes is re-read from the quote row
 * inside the acceptance transaction.
 *
 * Authorisation is three checks in order, and none of them is the UI:
 *
 *   1. `requireCustomer` — signed in, active, and a customer rather than staff
 *      (12.3: an admin accepting on a customer's behalf destroys the meaning
 *      of acceptance)
 *   2. `findQuoteForOwner` — the ownership filter is **in the query**, so a
 *      foreign quote number is "not found" rather than "not yours"
 *   3. `mayRespondToQuote` — ownership again over the loaded row, plus the
 *      verified-address requirement (`SECURITY.md` section 2)
 *
 * Validity is checked a fourth time, inside the transaction, by the conditional
 * `UPDATE`. That is the one that actually decides.
 */

export type QuoteActionResult =
  { ok: true; cartId: string | null } | { ok: false; message: string };

const UNAUTHENTICATED = 'Connectez-vous pour répondre à ce devis.';
const FORBIDDEN = 'Ce devis ne vous est pas adressé.';
const UNVERIFIED =
  'Confirmez votre adresse e-mail avant d’accepter un devis. Nous vous avons envoyé un code.';

async function authorise(quoteNumber: string) {
  const authorisation = await requireCustomer();

  if (!authorisation.ok) {
    return {
      ok: false as const,
      message: authorisation.reason === 'UNAUTHENTICATED' ? UNAUTHENTICATED : FORBIDDEN,
    };
  }

  const actor = authorisation.actor;
  const quote = await findQuoteForOwner({ quoteNumber, userId: actor.userId });

  if (!quote) return { ok: false as const, message: FORBIDDEN };

  // The shop may have switched verification off entirely, in which case every
  // signed-in customer counts as verified (`accounts.emailVerificationRequired`).
  const { emailVerificationRequired } = await siteSettings();

  if (!mayRespondToQuote(actor, quote.userId, { required: emailVerificationRequired })) {
    return { ok: false as const, message: UNVERIFIED };
  }

  return { ok: true as const, userId: actor.userId };
}

export async function acceptQuoteAction(input: {
  quoteNumber: string;
}): Promise<QuoteActionResult> {
  const authorised = await authorise(input.quoteNumber);
  if (!authorised.ok) return authorised;

  const accepted = await acceptQuoteAsOwner({
    quoteNumber: input.quoteNumber,
    userId: authorised.userId,
  });

  if (!accepted.ok) return { ok: false, message: accepted.error.message };

  revalidatePath('/account/quotes');
  revalidatePath(`/account/quotes/${input.quoteNumber}`);

  return { ok: true, cartId: accepted.value.cartId };
}

export async function declineQuoteAction(input: {
  quoteNumber: string;
  reason: string | null;
}): Promise<QuoteActionResult> {
  const authorised = await authorise(input.quoteNumber);
  if (!authorised.ok) return authorised;

  const declined = await declineQuoteAsOwner({
    quoteNumber: input.quoteNumber,
    userId: authorised.userId,
    reason: input.reason,
  });

  if (!declined.ok) return { ok: false, message: declined.error.message };

  revalidatePath('/account/quotes');
  revalidatePath(`/account/quotes/${input.quoteNumber}`);

  return { ok: true, cartId: null };
}
