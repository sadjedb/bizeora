/**
 * The rules the admin workspace applies, as pure functions.
 *
 * `BUSINESS-RULES.md` section 8 in full — the transition table enumerated over
 * every ordered pair, the payload each move requires, `ON_HOLD`'s release rule,
 * and the money rules that decide whether a payment may be recorded at all.
 *
 * The order state machine already had a partial suite; this is the exhaustive
 * one Phase 12's brief asks for, because Phase 12 is the first phase in which
 * anything actually drives it.
 */

import { describe, expect, it } from 'vitest';

import {
  ORDER_STATUS_LABELS,
  ORDER_TRANSITIONS,
  TERMINAL_STATUSES,
  allowsDesignReview,
  canTransition,
  customerMayCancel,
  entryStatus,
  isOrderInFlight,
  reservesStockAtPlacement,
  validateTransition,
  type OrderStatus,
} from '../../src/domain/order/state-machine';
import {
  PAYMENT_ENTRY_ERROR_LABELS,
  amountPaidFrom,
  depositSatisfied,
  derivePaymentStatus,
  outstandingBalance,
  outstandingDeposit,
  suggestPaymentKind,
  validatePaymentEntry,
} from '../../src/domain/order/payment';
import { anonymousActor, type Actor } from '../../src/domain/auth/actor';
import {
  mayManageOrders,
  mayReadAuditLog,
  mayRecordPayments,
  mayViewCustomerDirectory,
} from '../../src/domain/permissions';

const STATUSES = Object.keys(ORDER_TRANSITIONS) as OrderStatus[];

/* ---------------------------------------------------------------------------
 * 8.1 — the transition table
 * ------------------------------------------------------------------------ */

describe('the order state machine', () => {
  it('allows exactly the transitions section 8.1 lists, and no others', () => {
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        const allowed = from !== to && ORDER_TRANSITIONS[from].includes(to);
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(allowed);
      }
    }
  });

  it('refuses every self-transition', () => {
    for (const status of STATUSES) {
      expect(canTransition(status, status), status).toBe(false);
    }
  });

  it('never leaves a terminal status', () => {
    for (const from of TERMINAL_STATUSES) {
      expect(ORDER_TRANSITIONS[from]).toEqual([]);

      for (const to of STATUSES) {
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(false);
        expect(canTransition(from, to, 'CONFIRMED'), `${from} -> ${to} held`).toBe(false);
      }
    }
  });

  it('never returns to AWAITING_PAYMENT', () => {
    // An order that has left the waiting-for-money state cannot be put back
    // into it: the deposit was either received or the order was cancelled.
    for (const from of STATUSES) {
      expect(canTransition(from, 'AWAITING_PAYMENT'), from).toBe(false);
    }
  });

  it('reaches AWAITING_CONFIRMATION only from AWAITING_PAYMENT', () => {
    // 8.1's one move into the confirmation queue: the deposit arrived. Every
    // other status is past it.
    for (const from of STATUSES) {
      expect(canTransition(from, 'AWAITING_CONFIRMATION'), from).toBe(
        from === 'AWAITING_PAYMENT',
      );
    }
  });

  it('releases ON_HOLD only to the status it was held from (8.6)', () => {
    // Held from CONFIRMED, an order returns to CONFIRMED — not to READY, which
    // would let a hold be used to skip production.
    expect(canTransition('ON_HOLD', 'CONFIRMED', 'CONFIRMED')).toBe(true);
    expect(canTransition('ON_HOLD', 'READY', 'CONFIRMED')).toBe(false);
    expect(canTransition('ON_HOLD', 'SHIPPED', 'CONFIRMED')).toBe(false);

    // And cancellation is always available from a hold.
    expect(canTransition('ON_HOLD', 'CANCELLED')).toBe(true);
  });

  it('refuses to release a hold when the held-from status is unknown', () => {
    const result = validateTransition('ON_HOLD', 'CONFIRMED', {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('MISSING_HELD_FROM');
  });

  it('labels every status the table can hold', () => {
    expect(Object.keys(ORDER_STATUS_LABELS).sort()).toEqual([...STATUSES].sort());
  });
});

/* ---------------------------------------------------------------------------
 * 8.7 — the payload a transition requires
 * ------------------------------------------------------------------------ */

describe('a transition carries what section 8.7 requires', () => {
  it('refuses a cancellation with no reason, from every status that allows one', () => {
    for (const from of STATUSES.filter((status) =>
      ORDER_TRANSITIONS[status].includes('CANCELLED'),
    )) {
      for (const reason of [undefined, null, '', '   ']) {
        const result = validateTransition(from, 'CANCELLED', {
          cancellationReason: reason,
          heldFrom: from === 'ON_HOLD' ? 'CONFIRMED' : null,
        });

        expect(result.ok, `${from} with ${JSON.stringify(reason)}`).toBe(false);
        if (!result.ok) expect(result.error.code).toBe('MISSING_CANCELLATION_REASON');
      }
    }
  });

  it('accepts a cancellation with a reason', () => {
    expect(
      validateTransition('CONFIRMED', 'CANCELLED', {
        cancellationReason: 'Rupture de matière.',
      }).ok,
    ).toBe(true);
  });

  it('refuses a shipment without both a carrier and a tracking number', () => {
    for (const payload of [
      {},
      { carrierName: 'Yalidine' },
      { trackingNumber: 'YAL-1' },
      { carrierName: '  ', trackingNumber: 'YAL-1' },
      { carrierName: 'Yalidine', trackingNumber: '   ' },
    ]) {
      const result = validateTransition('READY', 'SHIPPED', payload);
      expect(result.ok, JSON.stringify(payload)).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('MISSING_TRACKING');
    }

    expect(
      validateTransition('READY', 'SHIPPED', {
        carrierName: 'Yalidine',
        trackingNumber: 'YAL-1',
      }).ok,
    ).toBe(true);
  });

  it('refuses a hold with no note', () => {
    const result = validateTransition('CONFIRMED', 'ON_HOLD', { note: '  ' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('MISSING_HOLD_NOTE');
  });

  it('reports an impossible move as INVALID_TRANSITION, whatever the payload', () => {
    const result = validateTransition('DELIVERED', 'IN_PRODUCTION', {
      note: 'peu importe',
      cancellationReason: 'peu importe',
      carrierName: 'x',
      trackingNumber: 'y',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_TRANSITION');
  });
});

/* ---------------------------------------------------------------------------
 * 8.2, 8.3, 8.4 and ADR-022
 * ------------------------------------------------------------------------ */

describe('entry, reservation and who may cancel', () => {
  it('enters AWAITING_PAYMENT only for an unpaid deposit (8.2)', () => {
    expect(entryStatus({ depositRequired: 5_000, amountPaid: 0 })).toBe(
      'AWAITING_PAYMENT',
    );
    expect(entryStatus({ depositRequired: 5_000, amountPaid: 5_000 })).toBe(
      'AWAITING_CONFIRMATION',
    );
    expect(entryStatus({ depositRequired: 0, amountPaid: 0 })).toBe(
      'AWAITING_CONFIRMATION',
    );
  });

  it('reserves at placement only from AWAITING_CONFIRMATION (ADR-022, 8.10.3)', () => {
    for (const status of STATUSES) {
      expect(reservesStockAtPlacement(status), status).toBe(
        status === 'AWAITING_CONFIRMATION',
      );
    }
  });

  it('offers DESIGN_REVIEW only where something is made (8.3)', () => {
    expect(allowsDesignReview(true)).toBe(true);
    expect(allowsDesignReview(false)).toBe(false);
  });

  it('lets a customer cancel only before the business commits (8.4)', () => {
    for (const status of STATUSES) {
      const expected =
        status === 'AWAITING_PAYMENT' || status === 'AWAITING_CONFIRMATION';
      expect(customerMayCancel(status), status).toBe(expected);
    }
  });

  it('counts everything but delivered, cancelled and refunded as in flight', () => {
    for (const status of STATUSES) {
      const settled =
        status === 'DELIVERED' || status === 'CANCELLED' || status === 'REFUNDED';
      expect(isOrderInFlight(status), status).toBe(!settled);
    }
  });
});

/* ---------------------------------------------------------------------------
 * 8.8 and 8.10.4 — money
 * ------------------------------------------------------------------------ */

describe('payment status is derived (8.8)', () => {
  it('sums succeeded payments and subtracts refunds', () => {
    expect(
      amountPaidFrom([
        { kind: 'DEPOSIT', amount: 5_000, status: 'SUCCEEDED' },
        { kind: 'BALANCE', amount: 5_000, status: 'SUCCEEDED' },
        { kind: 'REFUND', amount: 2_000, status: 'SUCCEEDED' },
        // Neither counts: only a succeeded row moves the balance.
        { kind: 'BALANCE', amount: 9_999, status: 'PENDING' },
        { kind: 'BALANCE', amount: 9_999, status: 'FAILED' },
      ]),
    ).toBe(8_000);
  });

  it('reads UNPAID at zero, even when the deposit is zero too', () => {
    expect(
      derivePaymentStatus({ amountPaid: 0, grandTotal: 10_000, depositRequired: 0 }),
    ).toBe('UNPAID');
  });

  it('does not call a part payment DEPOSIT_PAID when no deposit was asked', () => {
    expect(
      derivePaymentStatus({ amountPaid: 1, grandTotal: 10_000, depositRequired: 0 }),
    ).toBe('UNPAID');
  });

  it('reads DEPOSIT_PAID once the deposit is covered, PAID once the total is', () => {
    expect(
      derivePaymentStatus({
        amountPaid: 5_000,
        grandTotal: 10_000,
        depositRequired: 5_000,
      }),
    ).toBe('DEPOSIT_PAID');
    expect(
      derivePaymentStatus({
        amountPaid: 10_000,
        grandTotal: 10_000,
        depositRequired: 5_000,
      }),
    ).toBe('PAID');
  });

  it('satisfies the deposit at exactly the deposit (5.5)', () => {
    expect(depositSatisfied({ amountPaid: 5_000, depositRequired: 5_000 })).toBe(true);
    expect(depositSatisfied({ amountPaid: 4_999, depositRequired: 5_000 })).toBe(false);
  });

  it('never reports a negative outstanding amount', () => {
    expect(outstandingBalance({ grandTotal: 10_000, amountPaid: 12_000 })).toBe(0);
    expect(outstandingDeposit({ depositRequired: 5_000, amountPaid: 9_000 })).toBe(0);
  });
});

describe('recording a payment (8.10.4)', () => {
  const order = { grandTotal: 10_000, amountPaid: 0 };

  it('accepts an amount within the balance', () => {
    expect(validatePaymentEntry({ kind: 'DEPOSIT', amount: 5_000, ...order }).ok).toBe(
      true,
    );
    expect(validatePaymentEntry({ kind: 'FULL', amount: 10_000, ...order }).ok).toBe(
      true,
    );
  });

  it('refuses more than the balance — an extra zero is the likeliest typo', () => {
    const result = validatePaymentEntry({ kind: 'FULL', amount: 100_000, ...order });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('EXCEEDS_BALANCE');
  });

  it('refuses a non-integer and a non-positive amount (ADR-012)', () => {
    for (const amount of [0, -1, 10.5, Number.NaN]) {
      const result = validatePaymentEntry({ kind: 'BALANCE', amount, ...order });
      expect(result.ok, String(amount)).toBe(false);
    }
  });

  it('refuses anything once the order is settled', () => {
    const result = validatePaymentEntry({
      kind: 'BALANCE',
      amount: 1,
      grandTotal: 10_000,
      amountPaid: 10_000,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOTHING_OUTSTANDING');
  });

  it('refunds only what was actually taken', () => {
    const tooMuch = validatePaymentEntry({
      kind: 'REFUND',
      amount: 6_000,
      grandTotal: 10_000,
      amountPaid: 5_000,
    });

    expect(tooMuch.ok).toBe(false);
    if (!tooMuch.ok) expect(tooMuch.error.code).toBe('EXCEEDS_AMOUNT_PAID');

    expect(
      validatePaymentEntry({
        kind: 'REFUND',
        amount: 5_000,
        grandTotal: 10_000,
        amountPaid: 5_000,
      }).ok,
    ).toBe(true);
  });

  it('refuses a refund when nothing was taken', () => {
    const result = validatePaymentEntry({ kind: 'REFUND', amount: 1, ...order });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOTHING_OUTSTANDING');
  });

  it('labels every refusal', () => {
    for (const code of Object.keys(PAYMENT_ENTRY_ERROR_LABELS)) {
      expect(
        PAYMENT_ENTRY_ERROR_LABELS[code as keyof typeof PAYMENT_ENTRY_ERROR_LABELS],
      ).toBeTruthy();
    }
  });

  it('suggests a kind without ever deciding one', () => {
    expect(
      suggestPaymentKind({
        grandTotal: 10_000,
        depositRequired: 5_000,
        amountPaid: 0,
        amount: 5_000,
      }),
    ).toBe('DEPOSIT');

    expect(
      suggestPaymentKind({
        grandTotal: 10_000,
        depositRequired: 5_000,
        amountPaid: 5_000,
        amount: 5_000,
      }),
    ).toBe('BALANCE');

    expect(
      suggestPaymentKind({
        grandTotal: 10_000,
        depositRequired: 0,
        amountPaid: 0,
        amount: 10_000,
      }),
    ).toBe('FULL');
  });
});

/* ---------------------------------------------------------------------------
 * 12.1 — the capability table
 * ------------------------------------------------------------------------ */

function actor(overrides: Partial<Extract<Actor, { kind: 'authenticated' }>> = {}) {
  return {
    kind: 'authenticated' as const,
    userId: 'user-1',
    role: 'CUSTOMER' as const,
    emailVerified: true,
    status: 'ACTIVE' as const,
    ...overrides,
  };
}

describe('who may run the workshop (12.1)', () => {
  it('gives order management, the directory and payments to staff and admin', () => {
    for (const capability of [
      mayManageOrders,
      mayViewCustomerDirectory,
      mayRecordPayments,
    ]) {
      expect(capability(actor({ role: 'STAFF' }))).toBe(true);
      expect(capability(actor({ role: 'ADMIN' }))).toBe(true);
      expect(capability(actor({ role: 'CUSTOMER' }))).toBe(false);
      expect(capability(anonymousActor)).toBe(false);
      // Suspended is refused before permissions are consulted at all.
      expect(capability(actor({ role: 'STAFF', status: 'SUSPENDED' }))).toBe(false);
    }
  });

  it('keeps the audit log to admins', () => {
    expect(mayReadAuditLog(actor({ role: 'ADMIN' }))).toBe(true);
    expect(mayReadAuditLog(actor({ role: 'STAFF' }))).toBe(false);
    expect(mayReadAuditLog(actor({ role: 'CUSTOMER' }))).toBe(false);
    expect(mayReadAuditLog(anonymousActor)).toBe(false);
  });

  it('does not require a verified address to do workshop work', () => {
    // Verification gates commitment — accepting a quote — not doing the job.
    expect(mayManageOrders(actor({ role: 'STAFF', emailVerified: false }))).toBe(true);
  });
});
