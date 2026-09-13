'use server';

import { revalidatePath } from 'next/cache';

import type { RequestStatus } from '@/domain/request';
import { requireStaff } from '@/server/auth/guards';
import {
  cancelQuoteAsStaff,
  createQuoteDraft,
  postRequestMessage,
  sendQuoteToCustomer,
  transitionRequest,
  updateQuoteDraft,
} from '@/server/services/quote-service';

/**
 * The admin workspace's server entry points.
 *
 * Every one of them starts with `requireStaff`, which is the only place a role
 * becomes permission to proceed (ADR-006). The decision itself is
 * `domain/permissions.isStaff`, over a plain `Actor` — no Better Auth type
 * reaches this file, and Better Auth's admin plugin is deliberately unused.
 *
 * What none of these actions accepts is a total. The quote payload carries
 * lines; `subtotal`, `discountTotal`, `shippingTotal`, `grandTotal` and
 * `depositRequired` are absent from the schema, derived by
 * `domain/quote/pricing`, and written by the repository. An admin who mistypes
 * a unit price changes the total; an admin who posts a total changes nothing,
 * because there is no field for it.
 */

export type AdminActionResult<T = undefined> =
  { ok: true; value: T } | { ok: false; message: string };

const UNAUTHENTICATED = 'Connectez-vous avec un compte de l’atelier.';
const FORBIDDEN = 'Vous n’avez pas les droits nécessaires.';

async function staff(): Promise<
  { ok: true; userId: string } | { ok: false; message: string }
> {
  const authorisation = await requireStaff();

  if (!authorisation.ok) {
    return {
      ok: false,
      message: authorisation.reason === 'UNAUTHENTICATED' ? UNAUTHENTICATED : FORBIDDEN,
    };
  }

  return { ok: true, userId: authorisation.actor.userId };
}

function refresh(requestNumber: string): void {
  revalidatePath('/admin/requests');
  revalidatePath(`/admin/requests/${requestNumber}`);
}

/* ---------------------------------------------------------------------------
 * Quotes
 * ------------------------------------------------------------------------ */

export async function createQuoteDraftAction(
  requestNumber: string,
  raw: unknown,
): Promise<AdminActionResult<{ quoteId: string; quoteNumber: string }>> {
  const actor = await staff();
  if (!actor.ok) return actor;

  const created = await createQuoteDraft(
    { ...(raw as object), requestNumber },
    actor.userId,
  );

  if (!created.ok) return { ok: false, message: created.error.message };

  refresh(requestNumber);
  return {
    ok: true,
    value: { quoteId: created.value.quoteId, quoteNumber: created.value.quoteNumber },
  };
}

export async function updateQuoteDraftAction(
  requestNumber: string,
  quoteId: string,
  raw: unknown,
): Promise<AdminActionResult<{ quoteId: string }>> {
  const actor = await staff();
  if (!actor.ok) return actor;

  const updated = await updateQuoteDraft(quoteId, raw);
  if (!updated.ok) return { ok: false, message: updated.error.message };

  refresh(requestNumber);
  return { ok: true, value: { quoteId } };
}

export async function sendQuoteAction(
  requestNumber: string,
  quoteId: string,
): Promise<AdminActionResult<{ quoteNumber: string }>> {
  const actor = await staff();
  if (!actor.ok) return actor;

  const sent = await sendQuoteToCustomer(quoteId, actor.userId);
  if (!sent.ok) return { ok: false, message: sent.error.message };

  refresh(requestNumber);
  return { ok: true, value: { quoteNumber: sent.value.quoteNumber } };
}

export async function cancelQuoteAction(
  requestNumber: string,
  quoteId: string,
): Promise<AdminActionResult> {
  const actor = await staff();
  if (!actor.ok) return actor;

  const cancelled = await cancelQuoteAsStaff(quoteId, actor.userId);
  if (!cancelled.ok) return { ok: false, message: cancelled.error.message };

  refresh(requestNumber);
  return { ok: true, value: undefined };
}

/* ---------------------------------------------------------------------------
 * The request
 * ------------------------------------------------------------------------ */

/**
 * Move a request.
 *
 * 6.4: no code sets a status without the transition function. This action does
 * not write one either — it hands the target to the service, which asks
 * `domain/request` whether staff may make that move from where the request
 * actually is, and refuses otherwise.
 */
export async function transitionRequestAction(input: {
  requestNumber: string;
  to: RequestStatus;
  needsInfoReason?: string | null;
}): Promise<AdminActionResult<{ status: RequestStatus }>> {
  const actor = await staff();
  if (!actor.ok) return actor;

  const moved = await transitionRequest({
    requestNumber: input.requestNumber,
    to: input.to,
    actor: 'STAFF',
    actorUserId: actor.userId,
    needsInfoReason: input.needsInfoReason ?? null,
  });

  if (!moved.ok) return { ok: false, message: moved.error.message };

  refresh(input.requestNumber);
  return { ok: true, value: { status: moved.value.status } };
}

/**
 * Post a message on the request.
 *
 * 6.7.2: **this cannot change a status**, and the reason it cannot is that
 * there is no code path from here to one. Asking for blocking information is a
 * different action — `transitionRequestAction` with `NEEDS_INFO` — and it
 * requires a reason.
 *
 * `internal: true` writes an `INTERNAL_NOTE`, which is filtered out of every
 * customer-facing query rather than hidden by a caller (`DATABASE.md` 15).
 */
export async function postMessageAction(input: {
  requestNumber: string;
  message: string;
  internal: boolean;
}): Promise<AdminActionResult> {
  const actor = await staff();
  if (!actor.ok) return actor;

  const posted = await postRequestMessage({
    requestNumber: input.requestNumber,
    actorType: 'ADMIN',
    actorUserId: actor.userId,
    message: input.message,
    internal: input.internal,
  });

  if (!posted.ok) return { ok: false, message: posted.error.message };

  refresh(input.requestNumber);
  return { ok: true, value: undefined };
}
