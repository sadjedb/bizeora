import { err, ok, type Result } from '../result';

/**
 * The order state machine.
 *
 * `BUSINESS-RULES.md` section 8, and section 16 requires it in `domain/order`
 * exactly once. `DATABASE.md` section 8 adds that `order_status_history` is the
 * truth and `orders.status` a materialised convenience — **every write goes
 * through this machine**, so an admin form cannot invent a transition the rules
 * do not allow.
 */

export type OrderStatus =
  | 'AWAITING_PAYMENT'
  | 'AWAITING_CONFIRMATION'
  | 'CONFIRMED'
  | 'DESIGN_REVIEW'
  | 'IN_PRODUCTION'
  | 'READY'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'ON_HOLD'
  | 'CANCELLED'
  | 'REFUNDED';

/**
 * 8.1, transcribed. `ON_HOLD` is the one entry that cannot be written as a
 * fixed list: it returns to *the status it was held from* (8.6), so its
 * released target is supplied by the caller and validated below.
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  AWAITING_PAYMENT: ['AWAITING_CONFIRMATION', 'CANCELLED'],
  AWAITING_CONFIRMATION: ['CONFIRMED', 'CANCELLED', 'ON_HOLD'],
  CONFIRMED: ['DESIGN_REVIEW', 'IN_PRODUCTION', 'READY', 'CANCELLED', 'ON_HOLD'],
  DESIGN_REVIEW: ['IN_PRODUCTION', 'ON_HOLD', 'CANCELLED'],
  IN_PRODUCTION: ['READY', 'ON_HOLD', 'CANCELLED'],
  READY: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED', 'ON_HOLD'],
  DELIVERED: ['REFUNDED'],
  ON_HOLD: ['CANCELLED'],
  CANCELLED: [],
  REFUNDED: [],
};

/** Statuses from which nothing further is possible (8.1). */
export const TERMINAL_STATUSES: readonly OrderStatus[] = ['CANCELLED', 'REFUNDED'];

export type TransitionError = {
  code:
    | 'INVALID_TRANSITION'
    | 'MISSING_CANCELLATION_REASON'
    | 'MISSING_TRACKING'
    | 'MISSING_HOLD_NOTE'
    | 'MISSING_HELD_FROM';
};

/**
 * 8.7: a transition may require a payload, and the state machine enforces it —
 * "not the form". A `SHIPPED` order with no tracking number is a customer
 * asking where their parcel is and nobody able to answer.
 */
export type TransitionPayload = {
  cancellationReason?: string | null;
  carrierName?: string | null;
  trackingNumber?: string | null;
  note?: string | null;
  /** Required when leaving `ON_HOLD`: the status it was held from (8.6). */
  heldFrom?: OrderStatus | null;
};

function isBlank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim().length === 0;
}

/**
 * Whether one status may follow another.
 *
 * `ON_HOLD` releases only back to the status it was held from, so a hold can
 * never be used to skip a step — held from `CONFIRMED`, an order returns to
 * `CONFIRMED`, not to `READY`.
 */
export function canTransition(
  from: OrderStatus,
  to: OrderStatus,
  heldFrom?: OrderStatus | null,
): boolean {
  if (from === to) return false;
  if (ORDER_TRANSITIONS[from].includes(to)) return true;

  return (
    from === 'ON_HOLD' && heldFrom !== null && heldFrom !== undefined && to === heldFrom
  );
}

/** A transition with its payload requirements applied (8.7). */
export function validateTransition(
  from: OrderStatus,
  to: OrderStatus,
  payload: TransitionPayload = {},
): Result<{ from: OrderStatus; to: OrderStatus }, TransitionError> {
  if (from === 'ON_HOLD' && to !== 'CANCELLED' && !payload.heldFrom) {
    return err({ code: 'MISSING_HELD_FROM' as const });
  }

  if (!canTransition(from, to, payload.heldFrom)) {
    return err({ code: 'INVALID_TRANSITION' as const });
  }

  if (to === 'CANCELLED' && isBlank(payload.cancellationReason)) {
    return err({ code: 'MISSING_CANCELLATION_REASON' as const });
  }

  if (
    to === 'SHIPPED' &&
    (isBlank(payload.carrierName) || isBlank(payload.trackingNumber))
  ) {
    return err({ code: 'MISSING_TRACKING' as const });
  }

  if (to === 'ON_HOLD' && isBlank(payload.note)) {
    return err({ code: 'MISSING_HOLD_NOTE' as const });
  }

  return ok({ from, to });
}

/**
 * 8.2, the status an order is placed in.
 *
 * The consequence is 8.10.3: `AWAITING_PAYMENT` means the business has
 * committed nothing — no stock reserved, no materials ordered, no production —
 * which is exactly what makes it safe to leave open while a customer walks to
 * the bank. `reservesStockAtPlacement` below reads from this, so the two
 * cannot disagree.
 */
export function entryStatus(input: {
  depositRequired: number;
  amountPaid: number;
}): OrderStatus {
  const unpaid = input.amountPaid < input.depositRequired;
  return input.depositRequired > 0 && unpaid
    ? 'AWAITING_PAYMENT'
    : 'AWAITING_CONFIRMATION';
}

/**
 * Whether placement reserves stock.
 *
 * Section 10.4 reserves at confirmation and 8.10.3 states that an order
 * awaiting payment reserves nothing. The reconciliation, recorded as ADR-022:
 * availability is **validated** for every placement, and reservation is taken
 * at placement only for an order that needs no deposit. An order that enters
 * `AWAITING_PAYMENT` holds nothing until an admin confirms it, because holding
 * inventory against money that may never arrive is precisely what 8.10.3
 * forbids.
 */
export function reservesStockAtPlacement(status: OrderStatus): boolean {
  return status === 'AWAITING_CONFIRMATION';
}

/**
 * 8.3: `DESIGN_REVIEW` applies only to an order with at least one
 * `requiresProduction` line. A stock-only order goes CONFIRMED → READY →
 * SHIPPED and must never be routed through a review of artwork that does not
 * exist.
 */
export function allowsDesignReview(hasProductionLine: boolean): boolean {
  return hasProductionLine;
}

/** 8.4: a customer may cancel only before the business has committed. */
export function customerMayCancel(status: OrderStatus): boolean {
  return status === 'AWAITING_PAYMENT' || status === 'AWAITING_CONFIRMATION';
}

/**
 * French copy for the statuses a customer sees. V1 is single-locale.
 *
 * Here rather than in the design system for the same reason
 * `QUOTE_STATUS_LABELS` and `REQUEST_STATUS_LABELS` are in their own domains:
 * the eleven statuses are a business fact, and a component that carried its own
 * list would be a second place for them to disagree with the database.
 */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  AWAITING_PAYMENT: 'En attente de votre acompte',
  AWAITING_CONFIRMATION: 'En attente de confirmation',
  CONFIRMED: 'Confirmée',
  DESIGN_REVIEW: 'Validation du design',
  IN_PRODUCTION: 'En production',
  READY: 'Prête',
  SHIPPED: 'Expédiée',
  DELIVERED: 'Livrée',
  // "En pause", not "En attente": the order is stopped, and "en attente"
  // already means "waiting for your deposit" two rows above.
  ON_HOLD: 'En pause',
  CANCELLED: 'Annulée',
  REFUNDED: 'Remboursée',
};

/**
 * Whether the order is still moving.
 *
 * Drives the account overview's ordering (`UX.md` section 8): an order in
 * production or shipped is something the customer is waiting on, and belongs
 * above one that was delivered last month.
 */
export function isOrderInFlight(status: OrderStatus): boolean {
  return !TERMINAL_STATUSES.includes(status) && status !== 'DELIVERED';
}
