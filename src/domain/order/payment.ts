import { err, ok, type Result } from '../result';

/**
 * Payment status, derived.
 *
 * `BUSINESS-RULES.md` 8.8 is emphatic that this is **derived, never set by
 * hand**, and 8.10.4 adds that an admin records a payment row rather than
 * editing a status. So this module offers no way to assert a status: it takes
 * payment rows and returns the only answer they support.
 *
 *     amountPaid    = sum(succeeded payments) - sum(refunds)
 *     paymentStatus = amountPaid == 0           -> UNPAID
 *                   | amountPaid >= grandTotal  -> PAID
 *                   | amountPaid >= depositRequired -> DEPOSIT_PAID
 *                   | otherwise                 -> UNPAID
 *
 * The order of those branches matters: an order with no deposit
 * (`depositRequired = 0`) and a part payment must not read as `DEPOSIT_PAID`
 * merely because any amount clears a threshold of zero, which is why the
 * zero-amount branch comes first and `DEPOSIT_PAID` is guarded below.
 */

export type PaymentStatus = 'UNPAID' | 'DEPOSIT_PAID' | 'PAID';

export type PaymentRecord = {
  kind: 'DEPOSIT' | 'BALANCE' | 'FULL' | 'REFUND';
  amount: number;
  /** Only a succeeded payment counts towards the balance. */
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED';
};

/** 8.8: succeeded payments less refunds, in integer minor units. */
export function amountPaidFrom(payments: readonly PaymentRecord[]): number {
  return payments
    .filter((payment) => payment.status === 'SUCCEEDED')
    .reduce(
      (total, payment) =>
        payment.kind === 'REFUND' ? total - payment.amount : total + payment.amount,
      0,
    );
}

export function derivePaymentStatus(input: {
  amountPaid: number;
  grandTotal: number;
  depositRequired: number;
}): PaymentStatus {
  if (input.amountPaid <= 0) return 'UNPAID';
  if (input.amountPaid >= input.grandTotal) return 'PAID';
  if (input.depositRequired > 0 && input.amountPaid >= input.depositRequired) {
    return 'DEPOSIT_PAID';
  }
  return 'UNPAID';
}

/**
 * 5.5: an order with a deposit cannot leave `AWAITING_PAYMENT` until the
 * deposit is covered.
 */
export function depositSatisfied(input: {
  amountPaid: number;
  depositRequired: number;
}): boolean {
  return input.amountPaid >= input.depositRequired;
}

/* ---------------------------------------------------------------------------
 * Recording a payment (8.10.4)
 * ------------------------------------------------------------------------ */

export type PaymentKind = PaymentRecord['kind'];

/** What is still owed, never below zero. */
export function outstandingBalance(input: {
  grandTotal: number;
  amountPaid: number;
}): number {
  return Math.max(0, input.grandTotal - input.amountPaid);
}

/** What is still owed **on the deposit**, which is what unblocks confirmation. */
export function outstandingDeposit(input: {
  depositRequired: number;
  amountPaid: number;
}): number {
  return Math.max(0, input.depositRequired - input.amountPaid);
}

export type PaymentEntryError = {
  code:
    | 'NON_INTEGER_AMOUNT'
    | 'NON_POSITIVE_AMOUNT'
    | 'EXCEEDS_BALANCE'
    | 'EXCEEDS_AMOUNT_PAID'
    | 'NOTHING_OUTSTANDING';
};

/**
 * Whether an amount may be recorded against this order.
 *
 * 8.10.4 says an admin records a `payments` row and never edits
 * `paymentStatus`; this is the rule that decides whether the row is allowed at
 * all, and it is the only place the answer is computed.
 *
 * Three things it refuses, each for a different reason:
 *
 *   - **a non-integer or non-positive amount** — money is integer minor units
 *     (ADR-012), and a refund is a positive `REFUND` row that the arithmetic
 *     subtracts, never a negative payment;
 *   - **more than the balance** — an order cannot be overpaid into existence,
 *     and a typo of an extra zero is the likeliest mistake at this keyboard;
 *   - **a refund larger than what was actually taken** — refunding more than
 *     was paid is a transfer, not a refund.
 *
 * Note what it does *not* take: a `paymentStatus`. That is derived (8.8), and
 * there is no argument here through which to assert one.
 */
export function validatePaymentEntry(input: {
  kind: PaymentKind;
  amount: number;
  grandTotal: number;
  amountPaid: number;
}): Result<{ amount: number }, PaymentEntryError> {
  if (!Number.isInteger(input.amount)) {
    return err({ code: 'NON_INTEGER_AMOUNT' as const });
  }

  if (input.amount <= 0) return err({ code: 'NON_POSITIVE_AMOUNT' as const });

  if (input.kind === 'REFUND') {
    if (input.amountPaid <= 0) return err({ code: 'NOTHING_OUTSTANDING' as const });
    if (input.amount > input.amountPaid) {
      return err({ code: 'EXCEEDS_AMOUNT_PAID' as const });
    }
    return ok({ amount: input.amount });
  }

  const balance = outstandingBalance(input);
  if (balance === 0) return err({ code: 'NOTHING_OUTSTANDING' as const });
  if (input.amount > balance) return err({ code: 'EXCEEDS_BALANCE' as const });

  return ok({ amount: input.amount });
}

/**
 * The kind an amount most likely is, offered as a default the admin may change.
 *
 * A first payment that exactly covers an outstanding deposit is a `DEPOSIT`;
 * one that covers the whole order at once is `FULL`; anything after a deposit
 * is a `BALANCE`. It is a suggestion, not a rule — `validatePaymentEntry` is
 * what decides whether the row is allowed.
 */
export function suggestPaymentKind(input: {
  grandTotal: number;
  depositRequired: number;
  amountPaid: number;
  amount: number;
}): PaymentKind {
  if (input.amountPaid > 0) return 'BALANCE';
  if (input.amount >= input.grandTotal) return 'FULL';
  if (input.depositRequired > 0) return 'DEPOSIT';
  return 'BALANCE';
}

export const PAYMENT_ENTRY_ERROR_LABELS: Record<PaymentEntryError['code'], string> = {
  NON_INTEGER_AMOUNT: 'Le montant doit être un nombre entier de centimes.',
  NON_POSITIVE_AMOUNT: 'Le montant doit être supérieur à zéro.',
  EXCEEDS_BALANCE: 'Ce montant dépasse le reste à payer.',
  EXCEEDS_AMOUNT_PAID: 'Un remboursement ne peut pas dépasser ce qui a été encaissé.',
  NOTHING_OUTSTANDING: 'Cette commande est déjà soldée.',
};

export const PAYMENT_KIND_LABELS: Record<PaymentKind, string> = {
  DEPOSIT: 'Acompte',
  BALANCE: 'Solde',
  FULL: 'Paiement intégral',
  REFUND: 'Remboursement',
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  UNPAID: 'Non réglée',
  DEPOSIT_PAID: 'Acompte reçu',
  PAID: 'Réglée',
};
