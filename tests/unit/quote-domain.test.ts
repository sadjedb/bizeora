/**
 * The quote and request lifecycles, as pure functions.
 *
 * `BUSINESS-RULES.md` sections 6 and 7, and `ROADMAP.md` Phase 10's definition
 * of done: "both state machines have exhaustive rejection tests". These are
 * exhaustive in the literal sense — every ordered pair of statuses is
 * enumerated and checked against the documented table, so a transition added to
 * the code without being added to the documentation fails here rather than in
 * production six weeks later.
 */

import { describe, expect, it } from 'vitest';

import {
  QUOTE_TRANSITIONS,
  acceptanceValidUntilFrom,
  canTransitionQuote,
  effectiveQuoteStatus,
  isAcceptable,
  isCheckoutValid,
  isEditable,
  isOutstanding,
  isTerminalQuoteStatus,
  quoteNumberBase,
  quoteNumberFor,
  statusesThatCanReach,
  validUntilFrom,
  validateQuoteEdit,
  validateQuoteTransition,
  type QuoteStatus,
} from '../../src/domain/quote';
import {
  REQUEST_TRANSITIONS,
  canRequestInformation,
  canTransitionRequest,
  eventChangesStatus,
  eventIsCustomerVisible,
  isWaitingOnCustomer,
  validateRequestTransition,
  type RequestStatus,
} from '../../src/domain/request';
import {
  FEE_LINE_KINDS,
  hasProductionLine,
  quoteLineTotal,
  quoteTotals,
  validateQuoteLines,
  validateSendable,
  type QuoteLineInput,
} from '../../src/domain/quote/pricing';
import { anonymousActor, type Actor } from '../../src/domain/auth/actor';
import { mayReadDesignFile, mayRespondToQuote } from '../../src/domain/permissions';

const QUOTE_STATUSES: readonly QuoteStatus[] = [
  'DRAFT',
  'SENT',
  'VIEWED',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
  'CANCELLED',
  'SUPERSEDED',
];

const REQUEST_STATUSES: readonly RequestStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'IN_REVIEW',
  'NEEDS_INFO',
  'QUOTED',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
  'CONVERTED',
  'CANCELLED',
];

/* ---------------------------------------------------------------------------
 * 7.1 — the quote state machine
 * ------------------------------------------------------------------------ */

describe('the quote state machine', () => {
  it('allows exactly the transitions section 7.1 lists, and no others', () => {
    for (const from of QUOTE_STATUSES) {
      for (const to of QUOTE_STATUSES) {
        const allowed = from !== to && QUOTE_TRANSITIONS[from].includes(to);
        expect(canTransitionQuote(from, to), `${from} -> ${to}`).toBe(allowed);
      }
    }
  });

  it('names the six documented moves out of SENT', () => {
    for (const to of [
      'VIEWED',
      'ACCEPTED',
      'REJECTED',
      'EXPIRED',
      'CANCELLED',
      'SUPERSEDED',
    ] as const) {
      expect(canTransitionQuote('SENT', to)).toBe(true);
    }
  });

  it('lets VIEWED do everything SENT does except being viewed again', () => {
    expect(canTransitionQuote('VIEWED', 'VIEWED')).toBe(false);
    for (const to of [
      'ACCEPTED',
      'REJECTED',
      'EXPIRED',
      'CANCELLED',
      'SUPERSEDED',
    ] as const) {
      expect(canTransitionQuote('VIEWED', to)).toBe(true);
    }
  });

  it('never leaves a terminal status', () => {
    for (const from of QUOTE_STATUSES.filter(isTerminalQuoteStatus)) {
      expect(QUOTE_TRANSITIONS[from]).toEqual([]);
      for (const to of QUOTE_STATUSES) {
        expect(canTransitionQuote(from, to), `${from} -> ${to}`).toBe(false);
      }
    }
  });

  it('has no path back to DRAFT from anywhere', () => {
    for (const from of QUOTE_STATUSES) {
      expect(canTransitionQuote(from, 'DRAFT'), `${from} -> DRAFT`).toBe(false);
    }
  });

  it('answers "which statuses reach X" consistently with the table', () => {
    // The repository builds its conditional UPDATEs from this, so a status that
    // can reach a target here is exactly one the query will accept — and the
    // table stays the only place the rule is written (section 16).
    for (const to of QUOTE_STATUSES) {
      const reaching = statusesThatCanReach(to);

      for (const from of QUOTE_STATUSES) {
        expect(reaching.includes(from), `${from} -> ${to}`).toBe(
          canTransitionQuote(from, to),
        );
      }
    }
  });

  it('lists SENT and VIEWED, and nothing else, as able to reach ACCEPTED', () => {
    expect([...statusesThatCanReach('ACCEPTED')].sort()).toEqual(['SENT', 'VIEWED']);
    expect([...statusesThatCanReach('REJECTED')].sort()).toEqual(['SENT', 'VIEWED']);
    expect([...statusesThatCanReach('EXPIRED')].sort()).toEqual(['SENT', 'VIEWED']);
    expect([...statusesThatCanReach('SENT')]).toEqual(['DRAFT']);
    expect([...statusesThatCanReach('CANCELLED')].sort()).toEqual([
      'DRAFT',
      'SENT',
      'VIEWED',
    ]);
    expect(statusesThatCanReach('DRAFT')).toEqual([]);
  });

  it('refuses a self-transition', () => {
    for (const status of QUOTE_STATUSES) {
      expect(canTransitionQuote(status, status)).toBe(false);
    }
  });

  it('reports an invalid transition as a typed error', () => {
    const result = validateQuoteTransition('ACCEPTED', 'SENT');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_TRANSITION');
  });

  it('treats only SENT and VIEWED as outstanding', () => {
    for (const status of QUOTE_STATUSES) {
      expect(isOutstanding(status)).toBe(status === 'SENT' || status === 'VIEWED');
    }
  });
});

/* ---------------------------------------------------------------------------
 * 7.2 — immutability
 * ------------------------------------------------------------------------ */

describe('a sent quote is immutable (7.2)', () => {
  it('is editable in DRAFT and in no other status', () => {
    for (const status of QUOTE_STATUSES) {
      expect(isEditable(status), status).toBe(status === 'DRAFT');
    }
  });

  it('refuses an edit of every non-draft status with the same reason', () => {
    for (const status of QUOTE_STATUSES.filter((candidate) => candidate !== 'DRAFT')) {
      const result = validateQuoteEdit(status);
      expect(result.ok, status).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('SENT_QUOTE_IS_IMMUTABLE');
    }
  });
});

/* ---------------------------------------------------------------------------
 * 7.4 and 7.10 — the two expiries
 * ------------------------------------------------------------------------ */

describe('quote validity (7.4)', () => {
  const validUntil = new Date('2026-03-12T10:00:00.000Z');

  it('is valid up to and including the instant itself', () => {
    // "Valid until" names the last valid moment, not the first invalid one.
    expect(effectiveQuoteStatus({ status: 'SENT', validUntil, now: validUntil })).toBe(
      'SENT',
    );
  });

  it('expires one millisecond later', () => {
    expect(
      effectiveQuoteStatus({
        status: 'SENT',
        validUntil,
        now: new Date(validUntil.getTime() + 1),
      }),
    ).toBe('EXPIRED');
  });

  it('expires a VIEWED quote the same way', () => {
    expect(
      effectiveQuoteStatus({
        status: 'VIEWED',
        validUntil,
        now: new Date(validUntil.getTime() + 1),
      }),
    ).toBe('EXPIRED');
  });

  it('never rewrites a status that is not outstanding', () => {
    const later = new Date(validUntil.getTime() + 86_400_000);

    for (const status of QUOTE_STATUSES.filter(
      (candidate) => !isOutstanding(candidate),
    )) {
      expect(effectiveQuoteStatus({ status, validUntil, now: later }), status).toBe(
        status,
      );
    }
  });

  it('makes an expired quote unacceptable even while the row still says SENT', () => {
    expect(
      isAcceptable({
        status: 'SENT',
        validUntil,
        now: new Date(validUntil.getTime() + 1),
      }),
    ).toBe(false);
  });

  it('counts validity in whole days from the moment of sending', () => {
    const sentAt = new Date('2026-03-01T09:30:00.000Z');
    expect(validUntilFrom(sentAt, 14).toISOString()).toBe('2026-03-15T09:30:00.000Z');
  });
});

describe('acceptance validity (7.10)', () => {
  const acceptedAt = new Date('2026-03-01T09:30:00.000Z');
  const acceptanceValidUntil = acceptanceValidUntilFrom(acceptedAt, 7);

  it('counts seven days from acceptance', () => {
    expect(acceptanceValidUntil.toISOString()).toBe('2026-03-08T09:30:00.000Z');
  });

  it('is redeemable up to and including the instant itself', () => {
    expect(
      isCheckoutValid({
        status: 'ACCEPTED',
        acceptanceValidUntil,
        now: acceptanceValidUntil,
      }),
    ).toBe(true);
  });

  it('lapses one millisecond later', () => {
    expect(
      isCheckoutValid({
        status: 'ACCEPTED',
        acceptanceValidUntil,
        now: new Date(acceptanceValidUntil.getTime() + 1),
      }),
    ).toBe(false);
  });

  it('is never redeemable from a status other than ACCEPTED', () => {
    for (const status of QUOTE_STATUSES.filter((candidate) => candidate !== 'ACCEPTED')) {
      expect(
        isCheckoutValid({ status, acceptanceValidUntil, now: acceptedAt }),
        status,
      ).toBe(false);
    }
  });

  it('is not redeemable when no acceptance window was ever set', () => {
    expect(
      isCheckoutValid({
        status: 'ACCEPTED',
        acceptanceValidUntil: null,
        now: acceptedAt,
      }),
    ).toBe(false);
  });
});

/* ---------------------------------------------------------------------------
 * Numbering
 * ------------------------------------------------------------------------ */

describe('quote numbers', () => {
  it('omits the suffix for version 1 and adds it from version 2', () => {
    expect(quoteNumberFor(1042, 1)).toBe('Q-1042');
    expect(quoteNumberFor(1042, 2)).toBe('Q-1042-v2');
    expect(quoteNumberFor(1042, 11)).toBe('Q-1042-v11');
  });

  it('round-trips the base, so a revision can reuse it', () => {
    expect(quoteNumberBase(quoteNumberFor(1042, 1))).toBe(1042);
    expect(quoteNumberBase(quoteNumberFor(1042, 3))).toBe(1042);
  });

  it('refuses a number that is not one of ours', () => {
    for (const value of ['1042', 'Q-', 'QQ-1042', 'Q-1042-v', 'Q-abc']) {
      expect(quoteNumberBase(value), value).toBeNull();
    }
  });
});

/* ---------------------------------------------------------------------------
 * 2.6 — quote pricing
 * ------------------------------------------------------------------------ */

function line(overrides: Partial<QuoteLineInput> = {}): QuoteLineInput {
  return {
    kind: 'PRODUCT',
    label: 'Tee brodé',
    quantity: 2,
    unitPrice: 350_000,
    ...overrides,
  };
}

describe('quote totals (2.6.2)', () => {
  it('adds positive lines into the subtotal', () => {
    const totals = quoteTotals([
      line(),
      line({ kind: 'SETUP_FEE', quantity: 1, unitPrice: 120_000 }),
    ]);

    expect(totals.subtotal).toBe(700_000 + 120_000);
    expect(totals.grandTotal).toBe(820_000);
  });

  it('keeps DISCOUNT out of the subtotal and stores it as a magnitude', () => {
    const totals = quoteTotals([
      line(),
      line({ kind: 'DISCOUNT', label: 'Remise', quantity: 1, unitPrice: -50_000 }),
    ]);

    expect(totals.subtotal).toBe(700_000);
    expect(totals.discountTotal).toBe(50_000);
    expect(totals.grandTotal).toBe(650_000);
  });

  it('keeps SHIPPING out of the subtotal and in its own total', () => {
    const totals = quoteTotals([
      line(),
      line({ kind: 'SHIPPING', label: 'Livraison', quantity: 1, unitPrice: 60_000 }),
    ]);

    expect(totals.subtotal).toBe(700_000);
    expect(totals.shippingTotal).toBe(60_000);
    expect(totals.grandTotal).toBe(760_000);
  });

  it('satisfies grandTotal = subtotal − discount + shipping + tax', () => {
    const totals = quoteTotals(
      [
        line(),
        line({ kind: 'DISCOUNT', label: 'Remise', quantity: 1, unitPrice: -50_000 }),
        line({ kind: 'SHIPPING', label: 'Livraison', quantity: 1, unitPrice: 60_000 }),
      ],
      7_000,
    );

    expect(totals.grandTotal).toBe(
      totals.subtotal - totals.discountTotal + totals.shippingTotal + totals.taxTotal,
    );
  });

  it('computes a line total as unit price times quantity', () => {
    expect(quoteLineTotal(line({ quantity: 3, unitPrice: 1_000 }))).toBe(3_000);
  });
});

describe('quote line validation', () => {
  it('refuses a positive DISCOUNT line', () => {
    const result = validateQuoteLines([
      line({ kind: 'DISCOUNT', unitPrice: 500, quantity: 1 }),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DISCOUNT_MUST_BE_NEGATIVE');
  });

  it('refuses a negative price on anything else', () => {
    const result = validateQuoteLines([line({ unitPrice: -1 })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NEGATIVE_PRICE');
  });

  it('refuses a non-integer amount (ADR-012)', () => {
    const result = validateQuoteLines([line({ unitPrice: 350_000.5 })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NON_INTEGER_AMOUNT');
  });

  it('refuses a fee quoted at more than quantity 1 (2.6.5)', () => {
    for (const kind of FEE_LINE_KINDS) {
      const result = validateQuoteLines([line({ kind, quantity: 3, unitPrice: 1_000 })]);
      expect(result.ok, kind).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('MULTI_QUANTITY_FEE');
    }
  });

  it('refuses a line with no label, and reports which line', () => {
    const result = validateQuoteLines([line(), line({ label: '   ' })]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('MISSING_LABEL');
      expect(result.error.index).toBe(1);
    }
  });
});

describe('sendability (2.6.3)', () => {
  const future = new Date(Date.now() + 86_400_000);

  it('refuses a quote with no lines', () => {
    const result = validateSendable({
      lines: [],
      totals: quoteTotals([]),
      validUntil: future,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NO_LINES');
  });

  it('refuses a non-positive grand total', () => {
    const lines = [
      line({ unitPrice: 100, quantity: 1 }),
      line({ kind: 'DISCOUNT', label: 'Remise', quantity: 1, unitPrice: -100 }),
    ];

    const result = validateSendable({
      lines,
      totals: quoteTotals(lines),
      validUntil: future,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NON_POSITIVE_TOTAL');
  });

  it('refuses a validity date in the past', () => {
    const lines = [line()];
    const result = validateSendable({
      lines,
      totals: quoteTotals(lines),
      validUntil: new Date(Date.now() - 1),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALID_UNTIL_IN_THE_PAST');
  });

  it('refuses a quote of pure fees', () => {
    const lines = [line({ kind: 'SETUP_FEE', quantity: 1, unitPrice: 100_000 })];
    const result = validateSendable({
      lines,
      totals: quoteTotals(lines),
      validUntil: future,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ONLY_FEE_LINES');
  });

  it('accepts a product line, a positive total and a future date', () => {
    const lines = [line()];
    expect(
      validateSendable({ lines, totals: quoteTotals(lines), validUntil: future }).ok,
    ).toBe(true);
  });

  /*
   * The regression. This check used to demand a `PRODUCT` line specifically, so
   * a quote for embroidery priced as `EMBROIDERY` — which is what an embroidery
   * shop types, and what the editor offers directly beneath `PRODUCT` — saved
   * as a draft and then refused to send. 2.6.5 maps both to a `CUSTOM` order
   * item, so there was never a downstream reason for the distinction.
   */
  it('accepts a quote priced entirely as embroidery', () => {
    const lines = [line({ kind: 'EMBROIDERY', label: 'Broderie poitrine' })];
    const result = validateSendable({
      lines,
      totals: quoteTotals(lines),
      validUntil: future,
    });

    expect(result.ok).toBe(true);
  });

  it('accepts embroidery beside its fees', () => {
    const lines = [
      line({ kind: 'EMBROIDERY', label: 'Broderie dos' }),
      line({ kind: 'SETUP_FEE', label: 'Préparation', quantity: 1, unitPrice: 2_000 }),
    ];

    expect(
      validateSendable({ lines, totals: quoteTotals(lines), validUntil: future }).ok,
    ).toBe(true);
  });

  it('sees a production line in PRODUCT and EMBROIDERY only', () => {
    expect(hasProductionLine([line({ kind: 'EMBROIDERY' })])).toBe(true);
    expect(hasProductionLine([line({ kind: 'SETUP_FEE', quantity: 1 })])).toBe(false);
  });
});

/* ---------------------------------------------------------------------------
 * Section 6 — the request state machine
 * ------------------------------------------------------------------------ */

describe('the request state machine', () => {
  it('allows exactly the transitions section 6.1 lists, and no others', () => {
    for (const from of REQUEST_STATUSES) {
      for (const to of REQUEST_STATUSES) {
        const allowed = from !== to && REQUEST_TRANSITIONS[from].includes(to);
        expect(canTransitionRequest(from, to), `${from} -> ${to}`).toBe(allowed);
      }
    }
  });

  it('lets a quoted request be revised, blocked, accepted, rejected or expired', () => {
    for (const to of [
      'ACCEPTED',
      'REJECTED',
      'EXPIRED',
      'IN_REVIEW',
      'NEEDS_INFO',
    ] as const) {
      expect(canTransitionRequest('QUOTED', to)).toBe(true);
    }
  });

  it('never leaves CONVERTED, REJECTED, EXPIRED or CANCELLED', () => {
    for (const from of ['CONVERTED', 'REJECTED', 'EXPIRED', 'CANCELLED'] as const) {
      expect(REQUEST_TRANSITIONS[from]).toEqual([]);
    }
  });
});

describe('who may move a request (6.2, 12.3)', () => {
  it('lets only a customer accept or reject a quoted request', () => {
    for (const to of ['ACCEPTED', 'REJECTED'] as const) {
      expect(validateRequestTransition('QUOTED', to, { actor: 'CUSTOMER' }).ok).toBe(
        true,
      );

      const staff = validateRequestTransition('QUOTED', to, { actor: 'STAFF' });
      expect(staff.ok, `staff -> ${to}`).toBe(false);
      if (!staff.ok) expect(staff.error.code).toBe('ACTOR_NOT_PERMITTED');
    }
  });

  it('lets a customer cancel only before the request is quoted (6.6)', () => {
    for (const from of ['DRAFT', 'SUBMITTED', 'IN_REVIEW'] as const) {
      expect(
        validateRequestTransition(from, 'CANCELLED', { actor: 'CUSTOMER' }).ok,
        from,
      ).toBe(true);
    }

    expect(
      validateRequestTransition('QUOTED', 'CANCELLED', { actor: 'CUSTOMER' }).ok,
    ).toBe(false);
  });

  it('refuses NEEDS_INFO with no reason (6.7.1)', () => {
    for (const reason of [undefined, null, '', '   ']) {
      const result = validateRequestTransition('IN_REVIEW', 'NEEDS_INFO', {
        actor: 'STAFF',
        needsInfoReason: reason,
      });

      expect(result.ok, JSON.stringify(reason)).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('MISSING_NEEDS_INFO_REASON');
    }
  });

  it('accepts NEEDS_INFO with a reason', () => {
    expect(
      validateRequestTransition('IN_REVIEW', 'NEEDS_INFO', {
        actor: 'STAFF',
        needsInfoReason: 'Il nous faut le logo en vectoriel.',
      }).ok,
    ).toBe(true);
  });

  it('refuses a customer converting their own request', () => {
    expect(
      validateRequestTransition('ACCEPTED', 'CONVERTED', { actor: 'CUSTOMER' }).ok,
    ).toBe(false);
    expect(
      validateRequestTransition('ACCEPTED', 'CONVERTED', { actor: 'STAFF' }).ok,
    ).toBe(false);
    expect(
      validateRequestTransition('ACCEPTED', 'CONVERTED', { actor: 'SYSTEM' }).ok,
    ).toBe(true);
  });
});

describe('MESSAGE is not NEEDS_INFO (6.7.2)', () => {
  it('changes a status for STATUS_CHANGE and for nothing else', () => {
    expect(eventChangesStatus('STATUS_CHANGE')).toBe(true);

    for (const type of [
      'MESSAGE',
      'FILE_ADDED',
      'QUOTE_SENT',
      'INTERNAL_NOTE',
    ] as const) {
      expect(eventChangesStatus(type), type).toBe(false);
    }
  });

  it('keeps an internal note away from the customer', () => {
    expect(eventIsCustomerVisible('INTERNAL_NOTE')).toBe(false);
    expect(eventIsCustomerVisible('MESSAGE')).toBe(true);
  });

  it('allows a block only from the three statuses 6.7.4 names', () => {
    for (const status of REQUEST_STATUSES) {
      const expected =
        status === 'SUBMITTED' || status === 'IN_REVIEW' || status === 'QUOTED';
      expect(canRequestInformation(status), status).toBe(expected);
    }
  });

  it('counts NEEDS_INFO and QUOTED as waiting on the customer', () => {
    expect(isWaitingOnCustomer('NEEDS_INFO')).toBe(true);
    expect(isWaitingOnCustomer('QUOTED')).toBe(true);
    expect(isWaitingOnCustomer('SUBMITTED')).toBe(false);
    expect(isWaitingOnCustomer('IN_REVIEW')).toBe(false);
  });
});

/* ---------------------------------------------------------------------------
 * 12.3 — who may respond
 * ------------------------------------------------------------------------ */

function customer(overrides: Partial<Extract<Actor, { kind: 'authenticated' }>> = {}) {
  return {
    kind: 'authenticated' as const,
    userId: 'user-1',
    role: 'CUSTOMER' as const,
    emailVerified: true,
    status: 'ACTIVE' as const,
    ...overrides,
  };
}

describe('who may accept a quote (12.3)', () => {
  it('lets the owning, verified, active customer respond', () => {
    expect(mayRespondToQuote(customer(), 'user-1')).toBe(true);
  });

  it('refuses another customer', () => {
    expect(mayRespondToQuote(customer(), 'user-2')).toBe(false);
  });

  it('refuses an anonymous visitor', () => {
    expect(mayRespondToQuote(anonymousActor, 'user-1')).toBe(false);
  });

  it('refuses staff and admin, even over their own user id', () => {
    expect(mayRespondToQuote(customer({ role: 'STAFF' }), 'user-1')).toBe(false);
    expect(mayRespondToQuote(customer({ role: 'ADMIN' }), 'user-1')).toBe(false);
  });

  it('refuses a suspended account', () => {
    expect(mayRespondToQuote(customer({ status: 'SUSPENDED' }), 'user-1')).toBe(false);
  });

  it('refuses an unverified address, because acceptance is a commitment', () => {
    expect(mayRespondToQuote(customer({ emailVerified: false }), 'user-1')).toBe(false);
  });

  it('refuses a quote with no owner at all', () => {
    expect(mayRespondToQuote(customer(), null)).toBe(false);
  });
});

describe('who may read a design file (12.1)', () => {
  it('lets the owner read their own', () => {
    expect(mayReadDesignFile(customer(), 'user-1')).toBe(true);
  });

  it('refuses another customer', () => {
    expect(mayReadDesignFile(customer(), 'user-2')).toBe(false);
  });

  it('lets staff read anyone’s', () => {
    expect(mayReadDesignFile(customer({ role: 'STAFF' }), 'user-2')).toBe(true);
    expect(mayReadDesignFile(customer({ role: 'ADMIN' }), 'user-2')).toBe(true);
  });

  it('refuses an anonymous visitor', () => {
    expect(mayReadDesignFile(anonymousActor, 'user-1')).toBe(false);
  });
});
