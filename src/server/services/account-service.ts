import 'server-only';

import { isOrderInFlight, type OrderStatus } from '@/domain/order/state-machine';
import { isWaitingOnCustomer, type RequestStatus } from '@/domain/request';
import {
  listOrdersForOwner,
  findOrderForViewer,
  type OrderSummary,
  type OrderView,
} from '@/server/repositories/order-repository';
import {
  findRequestForOwner,
  listRequestEvents,
  listRequestsForOwner,
  type RequestEvent,
  type RequestQueueRow,
} from '@/server/repositories/request-repository';
import { listQuotesForRequest } from '@/server/repositories/quote-repository';
import {
  listQuotesForCustomer,
  summariseConfigurations,
  toCustomerView,
  type CustomerQuoteSummary,
  type QuotedConfiguration,
} from '@/server/services/quote-service';

/**
 * The customer portal's reads.
 *
 * This module **composes** — it holds no business rules of its own. Ordering
 * comes from `domain/request.isWaitingOnCustomer` and
 * `domain/order.isOrderInFlight`, quote status from `toCustomerView`, and every
 * row from a repository that already filters by owner in the query. Phase 11
 * adds a place to look at Phases 7 to 10, not a second version of them.
 *
 * Every function here takes a `userId` that came from the session, never from a
 * URL or a payload. `BUSINESS-RULES.md` 12.1 gives a customer "view own orders,
 * requests, quotes, files" and nothing wider, so there is no variant of any of
 * these that takes an actor and a target.
 */

/* ---------------------------------------------------------------------------
 * The overview
 * ------------------------------------------------------------------------ */

export type AccountOverview = {
  /** Quotes awaiting an answer, soonest expiry first. `UX.md` section 8, first. */
  quotesAwaitingResponse: readonly CustomerQuoteSummary[];
  /** Orders still moving, newest first. Second. */
  ordersInFlight: readonly OrderSummary[];
  /** Requests the business is holding, or that are waiting on the customer. Third. */
  requestsInProgress: readonly RequestQueueRow[];
  /** Fourth. Everything, capped, newest first. */
  recentOrders: readonly OrderSummary[];
  counts: {
    quotes: number;
    orders: number;
    requests: number;
  };
};

/**
 * The account overview, in `UX.md` section 8's priority order.
 *
 * "A triage screen, not a vanity dashboard": quotes awaiting a response come
 * first because they are the only place money is blocked, then orders in
 * flight, then requests under review. Nothing here is a statistic.
 */
export async function getAccountOverview(userId: string): Promise<AccountOverview> {
  const [quotes, orders, requests] = await Promise.all([
    listQuotesForCustomer(userId),
    listOrdersForOwner(userId),
    listRequestsForOwner(userId),
  ]);

  const quotesAwaitingResponse = [...quotes]
    .filter((quote) => quote.acceptable)
    .sort((a, b) => a.validUntil.getTime() - b.validUntil.getTime());

  const ordersInFlight = orders.filter((order) => isOrderInFlight(order.status));

  // A request that has been answered — accepted, rejected, converted, expired,
  // cancelled — is history rather than triage. `isWaitingOnCustomer` covers the
  // two that need the customer; the rest of the live ones are with the
  // business, and both belong on this screen.
  const requestsInProgress = requests.filter(
    (request) =>
      isWaitingOnCustomer(request.status) ||
      request.status === 'SUBMITTED' ||
      request.status === 'IN_REVIEW',
  );

  return {
    quotesAwaitingResponse,
    ordersInFlight,
    requestsInProgress,
    recentOrders: orders.slice(0, 5),
    counts: { quotes: quotes.length, orders: orders.length, requests: requests.length },
  };
}

/* ---------------------------------------------------------------------------
 * Requests
 * ------------------------------------------------------------------------ */

export type CustomerRequestPage = {
  requestId: string;
  requestNumber: string;
  status: RequestStatus;
  submittedAt: Date | null;
  createdAt: Date;
  customerNote: string | null;
  /** 6.7.1: shown verbatim, because it is what the customer must answer. */
  needsInfoReason: string | null;
  estimateMin: number | null;
  estimateMax: number | null;
  configurations: readonly QuotedConfiguration[];
  /** Customer-visible events only. Internal notes are filtered in the query. */
  timeline: readonly RequestEvent[];
  /** Quotes the customer has been sent for this request, newest version first. */
  quotes: readonly {
    quoteNumber: string;
    version: number;
    status: string;
    grandTotal: number;
    currency: string;
    validUntil: Date;
    acceptable: boolean;
  }[];
};

/**
 * One of the customer's own requests.
 *
 * `findRequestForOwner` filters on `userId` inside the query, so a request
 * number belonging to somebody else returns null and the page renders a 404 —
 * indistinguishable from a number that never existed (`SECURITY.md` section 4).
 *
 * The quote list is filtered to what the customer has actually been sent: a
 * `DRAFT` is the workshop's working copy and appears nowhere here.
 */
export async function getCustomerRequestPage(input: {
  requestNumber: string;
  userId: string;
  now?: Date;
}): Promise<CustomerRequestPage | null> {
  const request = await findRequestForOwner(input);
  if (!request) return null;

  const [timeline, quotes] = await Promise.all([
    listRequestEvents({ requestId: request.id, customerVisibleOnly: true }),
    listQuotesForRequest(request.id),
  ]);

  const now = input.now ?? new Date();

  return {
    requestId: request.id,
    requestNumber: request.requestNumber,
    status: request.status,
    submittedAt: request.submittedAt,
    createdAt: request.createdAt,
    customerNote: request.customerNote,
    needsInfoReason: request.needsInfoReason,
    estimateMin: request.estimateMin,
    estimateMax: request.estimateMax,
    configurations: summariseConfigurations(request),
    timeline,
    quotes: quotes
      .filter((quote) => quote.status !== 'DRAFT')
      .map((quote) => {
        // The **effective** status, so a lapsed quote reads as expired here as
        // well as on its own page (7.4).
        const view = toCustomerView(quote, now);

        return {
          quoteNumber: view.quoteNumber,
          version: view.version,
          status: view.status,
          grandTotal: view.grandTotal,
          currency: view.currency,
          validUntil: view.validUntil,
          acceptable: view.acceptable,
        };
      }),
  };
}

export async function listCustomerRequests(
  userId: string,
): Promise<readonly RequestQueueRow[]> {
  return listRequestsForOwner(userId);
}

/* ---------------------------------------------------------------------------
 * Orders
 * ------------------------------------------------------------------------ */

export async function listCustomerOrders(
  userId: string,
): Promise<readonly OrderSummary[]> {
  return listOrdersForOwner(userId);
}

/**
 * One of the customer's own orders.
 *
 * Deliberately calls `findOrderForViewer` with **no guest token**: inside the
 * account area the only thing that grants access is owning the row. A guest
 * link is a separate path with its own bearer token, and mixing the two here
 * would mean a signed-in customer could read any order whose token they had
 * once seen.
 *
 * Everything it returns is a snapshot — `nameSnapshot`, `variantLabelSnapshot`,
 * `skuSnapshot`, the stored totals. Nothing is re-read from the catalogue.
 */
export async function getCustomerOrder(input: {
  orderNumber: string;
  userId: string;
}): Promise<OrderView | null> {
  return findOrderForViewer({
    orderNumber: input.orderNumber,
    userId: input.userId,
    guestToken: null,
  });
}

/** Re-exported so pages import one module rather than three. */
export type { OrderStatus, OrderSummary, OrderView, RequestEvent, RequestQueueRow };
