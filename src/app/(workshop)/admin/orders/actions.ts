'use server';

import { revalidatePath } from 'next/cache';

import { mayManageOrders, mayRecordPayments } from '@/domain/permissions';
import { requireStaff } from '@/server/auth/guards';
import {
  recordPaymentAsStaff,
  reviewProofAsStaff,
  saveOrderInternalNotes,
  transitionOrderAsStaff,
} from '@/server/services/order-admin-service';

/**
 * The order workspace's server entry points.
 *
 * Every one of them authorises independently: the layout's guard protects what
 * is rendered, and a server action is reachable without rendering anything. The
 * decision itself is `domain/permissions`, over a plain `Actor` — no role is
 * compared inline here.
 *
 * What none of these accepts is a **total**. The transition payload carries a
 * target status and the evidence 8.7 requires; the payment payload carries an
 * amount, a kind and a method. `grandTotal`, `depositRequired`, `amountPaid`
 * and `paymentStatus` are absent from every schema in this file, re-read from
 * the order inside the service, and — for `paymentStatus` — derived rather than
 * set at all (8.8).
 */

export type OrderActionResult<T = undefined> =
  { ok: true; value: T } | { ok: false; message: string };

const UNAUTHENTICATED = 'Connectez-vous avec un compte de l’atelier.';
const FORBIDDEN = 'Vous n’avez pas les droits nécessaires.';

async function staff(
  capability: (actor: Parameters<typeof mayManageOrders>[0]) => boolean,
): Promise<{ ok: true; userId: string } | { ok: false; message: string }> {
  const authorisation = await requireStaff();

  if (!authorisation.ok) {
    return {
      ok: false,
      message: authorisation.reason === 'UNAUTHENTICATED' ? UNAUTHENTICATED : FORBIDDEN,
    };
  }

  // A second, explicit capability check over the loaded actor. `requireStaff`
  // answers "is this the workshop"; this answers "may they do this".
  if (!capability(authorisation.actor)) return { ok: false, message: FORBIDDEN };

  return { ok: true, userId: authorisation.actor.userId };
}

function refresh(orderNumber: string): void {
  revalidatePath('/admin');
  revalidatePath('/admin/orders');
  revalidatePath(`/admin/orders/${orderNumber}`);
  // The customer sees the same order from the other side.
  revalidatePath(`/account/orders/${orderNumber}`);
}

export async function transitionOrderAction(
  raw: unknown,
): Promise<OrderActionResult<{ status: string }>> {
  const actor = await staff(mayManageOrders);
  if (!actor.ok) return actor;

  const moved = await transitionOrderAsStaff(raw, actor.userId);
  if (!moved.ok) return { ok: false, message: moved.error.message };

  const orderNumber = (raw as { orderNumber?: string }).orderNumber ?? '';
  refresh(orderNumber);

  return { ok: true, value: { status: moved.value.status } };
}

export async function recordPaymentAction(
  raw: unknown,
): Promise<OrderActionResult<{ amountPaid: number; paymentStatus: string }>> {
  const actor = await staff(mayRecordPayments);
  if (!actor.ok) return actor;

  const recorded = await recordPaymentAsStaff(raw, actor.userId);
  if (!recorded.ok) return { ok: false, message: recorded.error.message };

  const orderNumber = (raw as { orderNumber?: string }).orderNumber ?? '';
  refresh(orderNumber);

  return {
    ok: true,
    value: {
      amountPaid: recorded.value.amountPaid,
      paymentStatus: recorded.value.paymentStatus,
    },
  };
}

export async function reviewProofAction(input: {
  proofId: string;
  accept: boolean;
  rejectionReason: string | null;
}): Promise<OrderActionResult> {
  const actor = await staff(mayRecordPayments);
  if (!actor.ok) return actor;

  const reviewed = await reviewProofAsStaff({
    proofId: input.proofId,
    accept: input.accept,
    rejectionReason: input.rejectionReason,
    actorUserId: actor.userId,
  });

  if (!reviewed.ok) return { ok: false, message: reviewed.error.message };

  refresh(reviewed.value.orderNumber);
  return { ok: true, value: undefined };
}

export async function saveInternalNotesAction(input: {
  orderNumber: string;
  notes: string;
}): Promise<OrderActionResult> {
  const actor = await staff(mayManageOrders);
  if (!actor.ok) return actor;

  const saved = await saveOrderInternalNotes({
    orderNumber: input.orderNumber,
    notes: input.notes,
  });

  if (!saved.ok) return { ok: false, message: saved.error.message };

  refresh(input.orderNumber);
  return { ok: true, value: undefined };
}
