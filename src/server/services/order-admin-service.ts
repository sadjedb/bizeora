import 'server-only';

import { z } from 'zod';

import {
  PAYMENT_ENTRY_ERROR_LABELS,
  derivePaymentStatus,
  outstandingBalance,
  outstandingDeposit,
  validatePaymentEntry,
} from '@/domain/order/payment';
import {
  ORDER_TRANSITIONS,
  allowsDesignReview,
  canTransition,
  validateTransition,
  type OrderStatus,
} from '@/domain/order/state-machine';
import {
  attachPaymentProof,
  findOrderForStaff,
  findPaymentProof,
  listOrdersForStaff,
  recordPayment,
  reviewPaymentProof,
  setOrderInternalNotes,
  transitionOrder,
  type StaffOrderRow,
  type StaffOrderView,
} from '@/server/repositories/order-repository';

/**
 * The order workspace's use cases.
 *
 * Two rules shape every function here, and both are the reason this layer
 * exists rather than the pages calling the repository:
 *
 *   **The state machine decides, the repository applies.** Every transition is
 *   put to `domain/order/state-machine.validateTransition` first — with its
 *   payload, so 8.7's requirements are enforced by the machine and "not by the
 *   form" — and only an approved move reaches the database. The repository then
 *   claims the row conditionally, so two admins cannot both win.
 *
 *   **Money is re-read, never received.** `recordPaymentAsStaff` takes an
 *   amount and a kind and nothing else; the grand total, the deposit and the
 *   balance all come from the order row inside the same call, and
 *   `paymentStatus` is derived from the payment rows afterwards (8.8). There is
 *   no argument anywhere in this file through which a total could be set.
 */

export type OrderAdminError =
  | { code: 'ORDER_NOT_FOUND'; message: string }
  | { code: 'INVALID_INPUT'; message: string }
  | { code: 'INVALID_TRANSITION'; message: string }
  | { code: 'STATUS_CHANGED'; message: string }
  | { code: 'OUT_OF_STOCK'; message: string }
  | { code: 'PAYMENT_REFUSED'; message: string }
  | { code: 'PROOF_NOT_FOUND'; message: string };

export type OrderAdminResult<T> =
  { ok: true; value: T } | { ok: false; error: OrderAdminError };

function fail(code: OrderAdminError['code'], message: string): OrderAdminResult<never> {
  return { ok: false, error: { code, message } as OrderAdminError };
}

const NOT_FOUND = 'Commande introuvable.';

const TRANSITION_ERROR_LABELS: Record<string, string> = {
  INVALID_TRANSITION: 'Ce changement de statut n’est pas autorisé.',
  MISSING_CANCELLATION_REASON: 'Indiquez le motif de l’annulation.',
  MISSING_TRACKING: 'Un envoi exige un transporteur et un numéro de suivi.',
  MISSING_HOLD_NOTE: 'Indiquez pourquoi la commande est mise en pause.',
  MISSING_HELD_FROM: 'Impossible de déterminer le statut précédent.',
};

/* ---------------------------------------------------------------------------
 * Reads
 * ------------------------------------------------------------------------ */

export async function getOrderQueue(input: {
  status?: OrderStatus | null;
  limit?: number;
  /** `true` reads the archive instead of the live queue (ADR-034). */
  archived?: boolean;
}): Promise<readonly StaffOrderRow[]> {
  return listOrdersForStaff(input);
}

export type OrderWorkspace = {
  order: StaffOrderView;
  /** The moves offered, computed once from the machine (8.1, 8.3, 8.6). */
  available: readonly OrderStatus[];
  outstandingBalance: number;
  outstandingDeposit: number;
};

/**
 * The workspace, with the moves it may offer.
 *
 * `available` is derived here from `ORDER_TRANSITIONS` plus the two conditions
 * that are not in the table: `ON_HOLD` releases only to the status it was held
 * from (8.6), and `DESIGN_REVIEW` exists only for an order with something to
 * make (8.3). A page that filtered the list itself would be a second state
 * machine; this one asks the first.
 */
export async function getOrderWorkspace(
  orderNumber: string,
): Promise<OrderWorkspace | null> {
  const order = await findOrderForStaff(orderNumber);
  if (!order) return null;

  const candidates: readonly OrderStatus[] =
    order.status === 'ON_HOLD' && order.heldFrom
      ? [...ORDER_TRANSITIONS.ON_HOLD, order.heldFrom]
      : ORDER_TRANSITIONS[order.status];

  const available = candidates.filter(
    (target) =>
      canTransition(order.status, target, order.heldFrom) &&
      (target !== 'DESIGN_REVIEW' || allowsDesignReview(order.hasProductionLine)),
  );

  return {
    order,
    available,
    outstandingBalance: outstandingBalance({
      grandTotal: order.grandTotal,
      amountPaid: order.amountPaid,
    }),
    outstandingDeposit: outstandingDeposit({
      depositRequired: order.depositRequired,
      amountPaid: order.amountPaid,
    }),
  };
}

/* ---------------------------------------------------------------------------
 * Transitions
 * ------------------------------------------------------------------------ */

export const transitionInput = z.object({
  orderNumber: z.string().min(1).max(50),
  to: z.enum([
    'AWAITING_PAYMENT',
    'AWAITING_CONFIRMATION',
    'CONFIRMED',
    'DESIGN_REVIEW',
    'IN_PRODUCTION',
    'READY',
    'SHIPPED',
    'DELIVERED',
    'ON_HOLD',
    'CANCELLED',
    'REFUNDED',
  ]),
  note: z.string().trim().max(1_000).nullable().default(null),
  cancellationReason: z.string().trim().max(500).nullable().default(null),
  carrierName: z.string().trim().max(120).nullable().default(null),
  trackingNumber: z.string().trim().max(120).nullable().default(null),
  trackingUrl: z.url().max(500).nullable().default(null),
});

/**
 * Move an order (8.5).
 *
 * Note what the payload does **not** carry: a `from`. The status a transition
 * starts at is read from the row, never supplied — a client that could name its
 * own starting point could pick one from which its target is legal. The
 * conditional claim in the repository then uses that read value, so a
 * concurrent move loses rather than overwrites.
 */
export async function transitionOrderAsStaff(
  raw: unknown,
  actorUserId: string,
): Promise<OrderAdminResult<{ status: OrderStatus }>> {
  const parsed = transitionInput.safeParse(raw);
  if (!parsed.success) return fail('INVALID_INPUT', 'Demande invalide.');

  const input = parsed.data;
  const order = await findOrderForStaff(input.orderNumber);
  if (!order) return fail('ORDER_NOT_FOUND', NOT_FOUND);

  if (input.to === 'DESIGN_REVIEW' && !allowsDesignReview(order.hasProductionLine)) {
    return fail(
      'INVALID_TRANSITION',
      'Cette commande ne contient rien à fabriquer : la validation du design ne s’applique pas.',
    );
  }

  const validated = validateTransition(order.status, input.to, {
    cancellationReason: input.cancellationReason,
    carrierName: input.carrierName,
    trackingNumber: input.trackingNumber,
    note: input.note,
    heldFrom: order.heldFrom,
  });

  if (!validated.ok) {
    return fail(
      'INVALID_TRANSITION',
      TRANSITION_ERROR_LABELS[validated.error.code] ?? 'Transition refusée.',
    );
  }

  const moved = await transitionOrder({
    orderNumber: input.orderNumber,
    from: order.status,
    to: input.to,
    actorUserId,
    // 8.5: a cancellation's reason is what the customer is owed, so it becomes
    // the visible note; a hold's note is internal working detail.
    note: input.to === 'CANCELLED' ? input.cancellationReason : input.note,
    isCustomerVisible: input.to !== 'ON_HOLD',
    cancellationReason: input.cancellationReason,
    carrierName: input.carrierName,
    trackingNumber: input.trackingNumber,
    trackingUrl: input.trackingUrl,
  });

  if (!moved.ok) {
    if (moved.failure.code === 'OUT_OF_STOCK') {
      return fail(
        'OUT_OF_STOCK',
        'Le stock ne couvre plus cette commande. Rien n’a été modifié.',
      );
    }
    if (moved.failure.code === 'STATUS_CHANGED') {
      return fail('STATUS_CHANGED', 'La commande a changé entre-temps. Rechargez.');
    }
    return fail('ORDER_NOT_FOUND', NOT_FOUND);
  }

  return { ok: true, value: { status: moved.status } };
}

/* ---------------------------------------------------------------------------
 * Payments
 * ------------------------------------------------------------------------ */

export const paymentInput = z.object({
  orderNumber: z.string().min(1).max(50),
  kind: z.enum(['DEPOSIT', 'BALANCE', 'FULL', 'REFUND']),
  method: z.enum(['COD', 'BANK_TRANSFER', 'CCP']),
  /** Integer minor units (ADR-012). Validated against the order, not trusted. */
  amount: z.number().int().min(1).max(1_000_000_000),
  reference: z.string().trim().max(120).nullable().default(null),
});

/**
 * Record a payment (8.10.4).
 *
 * The amount is the one thing a person genuinely has to type — it is what the
 * bank statement says — so it is validated against the order rather than
 * trusted: `validatePaymentEntry` re-reads `grandTotal`, `depositRequired` and
 * `amountPaid` from the row and refuses anything beyond the balance, a refund
 * beyond what was taken, or a non-integer.
 *
 * There is no `paymentStatus` in the payload. It is derived from the rows
 * afterwards, inside the same transaction (8.8).
 */
export async function recordPaymentAsStaff(
  raw: unknown,
  actorUserId: string,
): Promise<
  OrderAdminResult<{ amountPaid: number; paymentStatus: string; balance: number }>
> {
  const parsed = paymentInput.safeParse(raw);
  if (!parsed.success) return fail('INVALID_INPUT', 'Paiement invalide.');

  const input = parsed.data;
  const order = await findOrderForStaff(input.orderNumber);
  if (!order) return fail('ORDER_NOT_FOUND', NOT_FOUND);

  const entry = validatePaymentEntry({
    kind: input.kind,
    amount: input.amount,
    grandTotal: order.grandTotal,
    amountPaid: order.amountPaid,
  });

  if (!entry.ok) {
    return fail('PAYMENT_REFUSED', PAYMENT_ENTRY_ERROR_LABELS[entry.error.code]);
  }

  const recorded = await recordPayment({
    orderNumber: input.orderNumber,
    kind: input.kind,
    method: input.method,
    amount: entry.value.amount,
    reference: input.reference,
    recordedByUserId: actorUserId,
    // The balance the admin's screen was showing. A payment that landed in
    // between makes this stale, and the write is refused rather than applied to
    // a total that has moved.
    expectedAmountPaid: order.amountPaid,
  });

  if (!recorded.ok) {
    return recorded.failure.code === 'AMOUNT_CHANGED'
      ? fail(
          'STATUS_CHANGED',
          'Un autre paiement a été enregistré entre-temps. Rechargez.',
        )
      : fail('ORDER_NOT_FOUND', NOT_FOUND);
  }

  return {
    ok: true,
    value: {
      amountPaid: recorded.amountPaid,
      paymentStatus: recorded.paymentStatus,
      balance: outstandingBalance({
        grandTotal: order.grandTotal,
        amountPaid: recorded.amountPaid,
      }),
    },
  };
}

/**
 * What the payment status *would* be at a given amount.
 *
 * Exported so a preview can be rendered without a second implementation of 8.8
 * in a component. Reading it changes nothing.
 */
export function previewPaymentStatus(input: {
  grandTotal: number;
  depositRequired: number;
  amountPaid: number;
}): string {
  return derivePaymentStatus(input);
}

/* ---------------------------------------------------------------------------
 * Proof of payment
 * ------------------------------------------------------------------------ */

export async function reviewProofAsStaff(input: {
  proofId: string;
  accept: boolean;
  rejectionReason: string | null;
  actorUserId: string;
}): Promise<OrderAdminResult<{ orderNumber: string }>> {
  const proof = await findPaymentProof(input.proofId);
  if (!proof) return fail('PROOF_NOT_FOUND', 'Justificatif introuvable.');

  const reason = input.rejectionReason?.trim() || null;
  if (!input.accept && !reason) {
    return fail('INVALID_INPUT', 'Indiquez pourquoi le justificatif est refusé.');
  }

  const reviewed = await reviewPaymentProof({
    proofId: input.proofId,
    accept: input.accept,
    rejectionReason: reason,
    reviewedByUserId: input.actorUserId,
  });

  if (!reviewed) {
    return fail('PROOF_NOT_FOUND', 'Ce justificatif a déjà été traité.');
  }

  return { ok: true, value: { orderNumber: proof.orderNumber } };
}

/**
 * The customer's submission of a transfer receipt.
 *
 * Lives here rather than in the customer service because the ownership rule is
 * the order's, and the repository enforces both halves in the query: the order
 * must be theirs and the file must be a `READY` one of their own.
 */
export async function submitPaymentProof(input: {
  orderNumber: string;
  userId: string;
  designFileId: string;
}): Promise<OrderAdminResult<{ submitted: true }>> {
  const attached = await attachPaymentProof(input);

  if (!attached.ok) {
    return attached.reason === 'ALREADY_PENDING'
      ? fail('INVALID_INPUT', 'Un justificatif est déjà en cours de vérification.')
      : fail('ORDER_NOT_FOUND', NOT_FOUND);
  }

  return { ok: true, value: { submitted: true } };
}

/* ---------------------------------------------------------------------------
 * Internal notes
 * ------------------------------------------------------------------------ */

export async function saveOrderInternalNotes(input: {
  orderNumber: string;
  notes: string | null;
}): Promise<OrderAdminResult<{ saved: true }>> {
  const trimmed = input.notes?.trim();
  const saved = await setOrderInternalNotes({
    orderNumber: input.orderNumber,
    notes: trimmed ? trimmed.slice(0, 4_000) : null,
  });

  if (!saved) return fail('ORDER_NOT_FOUND', NOT_FOUND);
  return { ok: true, value: { saved: true } };
}
