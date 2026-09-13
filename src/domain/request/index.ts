import { err, ok, type Result } from '../result';

/**
 * The custom-request lifecycle.
 *
 * `BUSINESS-RULES.md` section 6. The distinction this module exists to protect
 * is 6.7's, and it is the one most easily lost:
 *
 *   **`NEEDS_INFO` is a workflow blocker, not a conversation marker.**
 *
 * The admin queue's whole value is being able to tell "waiting on me" from
 * "waiting on the customer". A customer asking "how long will this take?" is a
 * `MESSAGE` and changes nothing (6.7.2). Only an admin, naming a specific
 * blocking thing they need, sets `NEEDS_INFO` (6.7.1) — and only an admin
 * clears it, because only they can judge whether what arrived is sufficient
 * (6.7.3).
 */

export type RequestStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'IN_REVIEW'
  | 'NEEDS_INFO'
  | 'QUOTED'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'CONVERTED'
  | 'CANCELLED';

/** 6.1, transcribed. Anything not listed is rejected. */
export const REQUEST_TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  DRAFT: ['SUBMITTED', 'CANCELLED', 'EXPIRED'],
  SUBMITTED: ['IN_REVIEW', 'NEEDS_INFO', 'REJECTED', 'CANCELLED'],
  IN_REVIEW: ['QUOTED', 'NEEDS_INFO', 'REJECTED', 'CANCELLED'],
  NEEDS_INFO: ['IN_REVIEW', 'CANCELLED', 'EXPIRED'],
  // IN_REVIEW = the admin is revising the quote; NEEDS_INFO = they need
  // blocking information before the quote can stand (6.7.4).
  QUOTED: ['ACCEPTED', 'REJECTED', 'EXPIRED', 'IN_REVIEW', 'NEEDS_INFO'],
  ACCEPTED: ['CONVERTED', 'CANCELLED'],
  CONVERTED: [],
  REJECTED: [],
  EXPIRED: [],
  CANCELLED: [],
};

export type RequestActor = 'CUSTOMER' | 'STAFF' | 'SYSTEM';

export type RequestTransitionError = {
  code:
    | 'INVALID_TRANSITION'
    | 'ACTOR_NOT_PERMITTED'
    | 'MISSING_NEEDS_INFO_REASON'
    | 'MISSING_CANCELLATION_ACTOR';
};

export function canTransitionRequest(from: RequestStatus, to: RequestStatus): boolean {
  if (from === to) return false;
  return REQUEST_TRANSITIONS[from].includes(to);
}

/**
 * 6.2, the actor table.
 *
 * The two rows that matter most: only a **customer** moves `QUOTED` to
 * `ACCEPTED` or `REJECTED` (12.3 — an admin accepting on their behalf would
 * destroy the meaning of acceptance), and only **staff** review, price or
 * block a request.
 */
function actorMayTransition(
  from: RequestStatus,
  to: RequestStatus,
  actor: RequestActor,
): boolean {
  if (actor === 'SYSTEM') {
    // The system converts at order placement, and expires on a schedule.
    return to === 'CONVERTED' || to === 'EXPIRED';
  }

  if (to === 'CANCELLED') {
    // 6.6: a customer may cancel until the request reaches QUOTED; an admin at
    // any time. After QUOTED, rejecting the quote is the path — it keeps the
    // record of what was offered.
    if (actor === 'STAFF') return true;
    return from === 'DRAFT' || from === 'SUBMITTED' || from === 'IN_REVIEW';
  }

  if (from === 'DRAFT' && to === 'SUBMITTED') return actor === 'CUSTOMER';

  if (from === 'QUOTED' && (to === 'ACCEPTED' || to === 'REJECTED')) {
    return actor === 'CUSTOMER';
  }

  if (to === 'CONVERTED') return false;

  // Everything else — review, blocking, pricing, rejecting a request outright —
  // is staff work.
  return actor === 'STAFF';
}

export function validateRequestTransition(
  from: RequestStatus,
  to: RequestStatus,
  input: { actor: RequestActor; needsInfoReason?: string | null },
): Result<{ from: RequestStatus; to: RequestStatus }, RequestTransitionError> {
  if (!canTransitionRequest(from, to))
    return err({ code: 'INVALID_TRANSITION' as const });

  if (!actorMayTransition(from, to, input.actor)) {
    return err({ code: 'ACTOR_NOT_PERMITTED' as const });
  }

  // 6.7.1: setting NEEDS_INFO requires a reason, shown to the customer
  // verbatim. A block with no stated cause is a request that stalls silently.
  if (to === 'NEEDS_INFO' && !input.needsInfoReason?.trim()) {
    return err({ code: 'MISSING_NEEDS_INFO_REASON' as const });
  }

  return ok({ from, to });
}

/* ---------------------------------------------------------------------------
 * Events
 * ------------------------------------------------------------------------ */

export type RequestEventType =
  'STATUS_CHANGE' | 'MESSAGE' | 'FILE_ADDED' | 'QUOTE_SENT' | 'INTERNAL_NOTE';

/**
 * 6.7.2: ordinary conversation does not change the request status.
 *
 * A customer question, an admin answer, a progress note and a courtesy message
 * are all `MESSAGE` rows with **no status effect whatsoever**. This predicate
 * is what the service asks before it even considers a transition, so the rule
 * is a branch in code rather than a paragraph nobody re-reads.
 */
export function eventChangesStatus(type: RequestEventType): boolean {
  return type === 'STATUS_CHANGE';
}

/** `INTERNAL_NOTE` never leaves the admin (`DATABASE.md` section 15). */
export function eventIsCustomerVisible(type: RequestEventType): boolean {
  return type !== 'INTERNAL_NOTE';
}

/** 6.7.4: the three statuses from which an admin may block a request. */
export function canRequestInformation(from: RequestStatus): boolean {
  return from === 'SUBMITTED' || from === 'IN_REVIEW' || from === 'QUOTED';
}

/**
 * Whether the request is waiting on the customer.
 *
 * The queue ordering 6.7 exists to support: a request in `NEEDS_INFO` is the
 * customer's move, everything else in flight is the admin's.
 */
export function isWaitingOnCustomer(status: RequestStatus): boolean {
  return status === 'NEEDS_INFO' || status === 'QUOTED';
}

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  DRAFT: 'Brouillon',
  SUBMITTED: 'Reçue',
  IN_REVIEW: 'En cours d’étude',
  NEEDS_INFO: 'Information demandée',
  QUOTED: 'Devis envoyé',
  ACCEPTED: 'Devis accepté',
  REJECTED: 'Refusée',
  EXPIRED: 'Expirée',
  CONVERTED: 'Commande passée',
  CANCELLED: 'Annulée',
};
