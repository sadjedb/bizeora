import 'server-only';

import {
  listOrdersForStaff,
  type StaffOrderRow,
} from '@/server/repositories/order-repository';
import {
  listRequestsForStaff,
  type RequestQueueRow,
} from '@/server/repositories/request-repository';
import { listOutstandingQuotesForStaff } from '@/server/repositories/quote-repository';
import type { StaffQuoteSummary } from '@/server/repositories/quote-repository';
import {
  listStockRows,
  type StockRow,
} from '@/server/repositories/catalogue-admin-repository';

/**
 * The dashboard's queues.
 *
 * `UX.md` section 9: "`/admin` answers one question: what needs me now", and
 * "there are no informational tiles that lead nowhere". So every list here is
 * work that can be started by clicking it, and there is **no statistic** — no
 * revenue figure, no conversion rate, no chart. Analytics are V2
 * (`PRODUCT.md`), and a number nobody can act on is worse than an empty screen
 * because it looks like the screen is doing something.
 *
 * Each queue is a bounded, authoritative query. Nothing is counted in the
 * browser and nothing is estimated.
 */

export type AdminDashboard = {
  /** New work, oldest first — the six-hour response promise starts here. */
  newRequests: readonly RequestQueueRow[];
  /** Under review or blocked on the customer. */
  requestsInReview: readonly RequestQueueRow[];
  /** Sent and unanswered, soonest expiry first. */
  outstandingQuotes: readonly StaffQuoteSummary[];
  /** Accepted and not yet ordered — the follow-up that converts. */
  acceptedQuotes: readonly StaffQuoteSummary[];
  /** Placed and not yet confirmed. */
  newOrders: readonly StaffOrderRow[];
  /** Waiting on a transfer, oldest first (8.10.5). */
  awaitingPayment: readonly StaffOrderRow[];
  /** Confirmed, in production or ready — the fulfilment column. */
  inFulfilment: readonly StaffOrderRow[];
  /**
   * Tracked variants at or below their threshold, worst first.
   *
   * Added in Phase 14.5, with the screen that can act on it. Before there was
   * a stock screen this would have been an informational tile leading nowhere,
   * which section 9 forbids; now every row opens the adjustment it needs.
   */
  lowStock: readonly StockRow[];
  counts: {
    newRequests: number;
    outstandingQuotes: number;
    awaitingPayment: number;
    inFulfilment: number;
    proofsToReview: number;
    outOfStock: number;
    lowStock: number;
  };
};

export async function getAdminDashboard(now = new Date()): Promise<AdminDashboard> {
  const [requests, quotes, orders, stockAlerts] = await Promise.all([
    listRequestsForStaff({ limit: 100 }),
    listOutstandingQuotesForStaff({ limit: 100 }),
    listOrdersForStaff({ limit: 100 }),
    listStockRows('alert'),
  ]);

  const newRequests = requests
    .filter((request) => request.status === 'SUBMITTED')
    // Oldest first: the queue is a promise about response time, and the oldest
    // request is the one closest to breaking it.
    .sort(
      (a, b) =>
        (a.submittedAt ?? a.createdAt).getTime() -
        (b.submittedAt ?? b.createdAt).getTime(),
    );

  const requestsInReview = requests.filter(
    (request) => request.status === 'IN_REVIEW' || request.status === 'NEEDS_INFO',
  );

  const outstandingQuotes = quotes
    .filter((quote) => quote.status === 'SENT' || quote.status === 'VIEWED')
    .filter((quote) => quote.validUntil.getTime() >= now.getTime())
    .sort((a, b) => a.validUntil.getTime() - b.validUntil.getTime());

  const acceptedQuotes = quotes.filter((quote) => quote.status === 'ACCEPTED');

  const newOrders = orders.filter((order) => order.status === 'AWAITING_CONFIRMATION');

  const awaitingPayment = orders
    .filter((order) => order.status === 'AWAITING_PAYMENT')
    .sort((a, b) => a.placedAt.getTime() - b.placedAt.getTime());

  const inFulfilment = orders.filter(
    (order) =>
      order.status === 'CONFIRMED' ||
      order.status === 'DESIGN_REVIEW' ||
      order.status === 'IN_PRODUCTION' ||
      order.status === 'READY',
  );

  // A rupture is worse than a low count, so it sorts first; within each, the
  // smallest available count is the most urgent.
  const lowStock = [...stockAlerts].sort((a, b) => a.available - b.available);

  return {
    newRequests: newRequests.slice(0, 10),
    requestsInReview: requestsInReview.slice(0, 10),
    outstandingQuotes: outstandingQuotes.slice(0, 10),
    acceptedQuotes: acceptedQuotes.slice(0, 10),
    newOrders: newOrders.slice(0, 10),
    awaitingPayment: awaitingPayment.slice(0, 10),
    inFulfilment: inFulfilment.slice(0, 10),
    lowStock: lowStock.slice(0, 8),
    counts: {
      newRequests: newRequests.length,
      outstandingQuotes: outstandingQuotes.length,
      awaitingPayment: awaitingPayment.length,
      inFulfilment: inFulfilment.length,
      proofsToReview: orders.filter((order) => order.hasPendingProof).length,
      outOfStock: lowStock.filter((row) => row.state === 'OUT_OF_STOCK').length,
      lowStock: lowStock.filter((row) => row.state === 'LOW_STOCK').length,
    },
  };
}
