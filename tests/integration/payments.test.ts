/**
 * The payment queue, against the real database.
 *
 * This file exists because `/admin/payments` shipped in Phase 14.5 showing
 * nothing. The data was there and correct; the screen opened on a facet that is
 * empty in every ordinary shop — "a transfer receipt is waiting" — and its
 * "acompte attendu" facet keyed off `status = AWAITING_PAYMENT` rather than off
 * the money, so an order sitting in `AWAITING_CONFIRMATION` with an untouched
 * deposit, the commonest shape here, never appeared.
 *
 * So the assertions are about the two things that failed:
 *
 *   **the default view is never empty while orders exist**, and
 *   **a deposit that has not been paid is visible whatever the order status.**
 *
 * Everything else guards the projection: an order that owes money must arrive
 * with its total, its deposit, what has been received, what is left and who it
 * belongs to. A DTO that quietly drops `amountPaid` is a screen that says an
 * order is unpaid when it is settled.
 *
 * The fixtures are created and removed by this file. Nothing here touches the
 * orders a developer left behind.
 */

import dotenv from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

dotenv.config({ path: ['.env.local', '.env'], quiet: true });

const { countOrdersByPaymentPosition, listOrdersForPayments, outstandingAcrossOrders } =
  await import('../../src/server/repositories/order-repository');

const { prisma } = await import('../../src/lib/db/client');

const PREFIX = `p146-pay-${Date.now()}`;

/** One order per payment position, so every facet has something to find. */
const FIXTURES = [
  {
    label: 'unpaid',
    grandTotal: 12_000,
    depositRequired: 0,
    amountPaid: 0,
    paymentStatus: 'UNPAID' as const,
    status: 'AWAITING_CONFIRMATION' as const,
    method: 'COD' as const,
  },
  {
    label: 'deposit-due',
    // The shape the old screen could not see: a deposit is owed, and the order
    // is not in `AWAITING_PAYMENT`.
    grandTotal: 40_000,
    depositRequired: 20_000,
    amountPaid: 0,
    paymentStatus: 'UNPAID' as const,
    status: 'AWAITING_CONFIRMATION' as const,
    method: 'CCP' as const,
  },
  {
    label: 'partial',
    grandTotal: 30_000,
    depositRequired: 15_000,
    amountPaid: 15_000,
    paymentStatus: 'DEPOSIT_PAID' as const,
    status: 'CONFIRMED' as const,
    method: 'BANK_TRANSFER' as const,
  },
  {
    label: 'settled',
    grandTotal: 8_000,
    depositRequired: 0,
    amountPaid: 8_000,
    paymentStatus: 'PAID' as const,
    status: 'DELIVERED' as const,
    method: 'COD' as const,
  },
];

const created: string[] = [];
const orderNumbers = new Map<string, string>();

let customerId: string;

beforeAll(async () => {
  const customer = await prisma.user.create({
    data: {
      email: `${PREFIX}@example.test`,
      name: 'Cliente paiements',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      emailVerified: true,
    },
    select: { id: true },
  });

  customerId = customer.id;

  for (const fixture of FIXTURES) {
    const [generated] = await prisma.$queryRaw<
      { order_number: string }[]
    >`SELECT next_order_number() AS order_number`;

    const orderNumber = generated!.order_number;

    const order = await prisma.order.create({
      data: {
        orderNumber,
        userId: customerId,
        status: fixture.status,
        currency: 'DZD',
        contactName: 'Cliente paiements',
        contactPhone: '0555000000',
        contactEmail: `${PREFIX}@example.test`,
        subtotal: fixture.grandTotal,
        discountTotal: 0,
        shippingTotal: 0,
        taxTotal: 0,
        grandTotal: fixture.grandTotal,
        depositRequired: fixture.depositRequired,
        amountPaid: fixture.amountPaid,
        paymentStatus: fixture.paymentStatus,
        paymentMethod: fixture.method,
        deliveryType: 'HOME',
      },
      select: { id: true, orderNumber: true },
    });

    created.push(order.id);
    orderNumbers.set(fixture.label, order.orderNumber);
  }
});

afterAll(async () => {
  await prisma.order.deleteMany({ where: { id: { in: created } } });
  await prisma.user.deleteMany({ where: { id: customerId } });
});

function rowFor<Row extends { orderNumber: string }>(
  rows: readonly Row[],
  label: string,
): Row | undefined {
  return rows.find((row) => row.orderNumber === orderNumbers.get(label));
}

describe('the default view', () => {
  it('returns rows whenever any order exists', async () => {
    // The regression itself. `all` is what the screen opens on, and an
    // operations screen whose first impression is an empty state while money is
    // outstanding is the defect this file exists for.
    const rows = await listOrdersForPayments({ filter: 'all' });

    expect(rows.length).toBeGreaterThanOrEqual(FIXTURES.length);
    for (const fixture of FIXTURES) {
      expect(rowFor(rows, fixture.label), fixture.label).toBeDefined();
    }
  });

  it('agrees with the counts the tiles are drawn from', async () => {
    const rows = await listOrdersForPayments({ filter: 'all', limit: 1000 });
    const counts = await countOrdersByPaymentPosition();

    // The tiles count the whole table; the page shows a bounded slice. The
    // count may therefore exceed the page, and must never fall below it — that
    // would mean the two disagree about the filter rather than about the bound.
    //
    // Not an equality: another suite placing an order between the two queries
    // would move one and not the other, and this file runs beside them.
    expect(counts.all).toBeGreaterThanOrEqual(rows.length);
    expect(rows.length).toBeLessThanOrEqual(1000);

    // Each facet is a subset of the whole, and together the three exclusive
    // money positions cannot exceed it.
    expect(counts.unpaid + counts.partial + counts.settled).toBeLessThanOrEqual(
      counts.all,
    );
  });
});

describe('the projection', () => {
  it('carries every figure the screen prints', async () => {
    const rows = await listOrdersForPayments({ filter: 'all', limit: 1000 });
    const partial = rowFor(rows, 'partial');

    expect(partial).toBeDefined();
    expect(partial!.grandTotal).toBe(30_000);
    expect(partial!.depositRequired).toBe(15_000);
    expect(partial!.amountPaid).toBe(15_000);
    expect(partial!.paymentMethod).toBe('BANK_TRANSFER');
    expect(partial!.paymentStatus).toBe('DEPOSIT_PAID');
    expect(partial!.status).toBe('CONFIRMED');
    // A DTO that drops `amountPaid` reads as unpaid; one that drops the
    // customer breaks the only link back to a person.
    expect(partial!.contactEmail).toContain(PREFIX);
    expect(partial!.contactName).toBe('Cliente paiements');
  });

  it('computes what is outstanding from the domain, not from the row', async () => {
    const rows = await listOrdersForPayments({ filter: 'all', limit: 1000 });

    expect(rowFor(rows, 'partial')!.outstanding).toBe(15_000);
    expect(rowFor(rows, 'partial')!.outstandingDeposit).toBe(0);

    expect(rowFor(rows, 'deposit-due')!.outstanding).toBe(40_000);
    // The figure the screen leads with for a custom order.
    expect(rowFor(rows, 'deposit-due')!.outstandingDeposit).toBe(20_000);

    // Never negative, and a settled order says so with a zero rather than a
    // small negative from a rounding mistake.
    expect(rowFor(rows, 'settled')!.outstanding).toBe(0);
    expect(rowFor(rows, 'settled')!.outstandingDeposit).toBe(0);
  });
});

describe('the facets', () => {
  it('finds an unpaid order', async () => {
    const rows = await listOrdersForPayments({ filter: 'unpaid', limit: 1000 });

    expect(rowFor(rows, 'unpaid')).toBeDefined();
    expect(rowFor(rows, 'settled')).toBeUndefined();
  });

  it('finds a deposit that is owed whatever the order status', async () => {
    // The second half of the original defect: this order is
    // `AWAITING_CONFIRMATION`, not `AWAITING_PAYMENT`.
    const rows = await listOrdersForPayments({ filter: 'deposit_due', limit: 1000 });
    const row = rowFor(rows, 'deposit-due');

    expect(row).toBeDefined();
    expect(row!.status).not.toBe('AWAITING_PAYMENT');
    expect(row!.outstandingDeposit).toBeGreaterThan(0);

    // An order with no deposit is not in this queue, however little it has paid.
    expect(rowFor(rows, 'unpaid')).toBeUndefined();
  });

  it('separates partially paid from settled', async () => {
    const partial = await listOrdersForPayments({ filter: 'partial', limit: 1000 });
    const settled = await listOrdersForPayments({ filter: 'settled', limit: 1000 });

    expect(rowFor(partial, 'partial')).toBeDefined();
    expect(rowFor(partial, 'settled')).toBeUndefined();
    expect(rowFor(settled, 'settled')).toBeDefined();
    expect(rowFor(settled, 'partial')).toBeUndefined();
  });

  it('is empty for proofs only when no proof is waiting', async () => {
    const rows = await listOrdersForPayments({ filter: 'proofs', limit: 1000 });

    // None of these fixtures submitted one — which is exactly the state the
    // screen used to open in, and why it must not be the default.
    for (const fixture of FIXTURES) {
      expect(rowFor(rows, fixture.label), fixture.label).toBeUndefined();
    }
  });

  it('filters by payment method without losing the position filter', async () => {
    const rows = await listOrdersForPayments({
      filter: 'all',
      method: 'CCP',
      limit: 1000,
    });

    expect(rowFor(rows, 'deposit-due')).toBeDefined();
    expect(rowFor(rows, 'settled')).toBeUndefined();
    for (const row of rows) expect(row.paymentMethod).toBe('CCP');
  });
});

describe('the outstanding total', () => {
  it('counts only what is still owed, and never goes negative', async () => {
    const owed = await outstandingAcrossOrders();

    expect(owed).toBeGreaterThanOrEqual(0);
    // The three unsettled fixtures owe 12 000 + 40 000 + 15 000 between them,
    // and the settled one contributes nothing.
    expect(owed).toBeGreaterThanOrEqual(67_000);
  });
});
