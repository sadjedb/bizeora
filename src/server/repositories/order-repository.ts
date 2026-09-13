import 'server-only';

import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db/client';
import { toPublicAssetUrl } from '@/lib/media/public-asset';
import { reservesStockAtPlacement, type OrderStatus } from '@/domain/order/state-machine';
import {
  amountPaidFrom,
  derivePaymentStatus,
  outstandingBalance,
  outstandingDeposit,
  type PaymentStatus,
} from '@/domain/order/payment';
import type { PaymentMethod } from '@/domain/order/payment-method';
import type { NotificationTx } from '@/server/repositories/notification-repository';
import { archiveWhere } from '@/server/repositories/archive-repository';

/**
 * Order placement, and reading an order back.
 *
 * The whole of placement is one transaction. `ARCHITECTURE.md` section 6 and
 * `BUSINESS-RULES.md` 5.3 both require it: between adding to cart and paying,
 * prices, stock and quotes can all change, so the totals are recomputed and
 * re-validated *inside* the transaction and everything the order needs is
 * written or nothing is.
 *
 * Two mechanisms here are the point of the phase:
 *
 *   - **`next_order_number()`**, a PostgreSQL sequence. Phase 7 derived a
 *     request number from `MAX(...)`, which its audit flagged as a race: two
 *     simultaneous submissions read the same maximum. `nextval` never returns
 *     the same value twice and never blocks; it leaves gaps when a transaction
 *     rolls back, which is the right trade for an identifier whose job is to be
 *     unique and readable aloud.
 *
 *   - **Conditional reservation.** `reserveStock` is a single UPDATE with the
 *     availability test in its WHERE clause. Reading stock, checking it in
 *     JavaScript and writing it back is the canonical oversell bug; two
 *     concurrent checkouts both pass the check and both write. Here the second
 *     one matches zero rows and the transaction aborts.
 */

/* ---------------------------------------------------------------------------
 * Placement
 * ------------------------------------------------------------------------ */

export type OrderItemInput = {
  kind: 'STOCK' | 'CUSTOM' | 'FEE';
  feeKind: 'SETUP_FEE' | 'DIGITIZING' | 'RUSH_FEE' | 'OTHER' | null;
  productId: string | null;
  variantId: string | null;
  customizationConfigId: string | null;
  quoteItemId: string | null;
  nameSnapshot: string;
  variantLabelSnapshot: string | null;
  skuSnapshot: string | null;
  imageKeySnapshot: string | null;
  unitPrice: number;
  quantity: number;
  lineDiscount: number;
  lineTotal: number;
  requiresProduction: boolean;
  position: number;
};

/**
 * Work to do inside the placement transaction, after the order exists.
 *
 * `ARCHITECTURE.md` section 11 requires a notification row to be written "in
 * the same transaction as the state change", and the order number only exists
 * once the transaction has generated it — so the caller passes a closure rather
 * than a prepared row. It runs with the transaction client, so a failure here
 * rolls the order back with it. That is the correct trade: an order nobody is
 * told about is worse than a placement the customer can retry.
 */
export type PlacementHook = (input: {
  tx: NotificationTx;
  orderId: string;
  orderNumber: string;
  status: OrderStatus;
}) => Promise<void>;

export type PlaceOrderInput = {
  cartId: string;
  userId: string | null;
  guestToken: string | null;
  currency: string;
  status: OrderStatus;
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  paymentMethod: 'COD' | 'BANK_TRANSFER' | 'CCP' | 'ONLINE';
  deliveryType: 'HOME' | 'DESK';
  shippingRateId: string | null;
  shippingRateLabel: string | null;
  subtotal: number;
  discountTotal: number;
  shippingTotal: number;
  taxTotal: number;
  grandTotal: number;
  depositRequired: number;
  customerNote: string | null;
  quoteId: string | null;
  estimatedDeliveryFrom: Date | null;
  estimatedDeliveryTo: Date | null;
  address: {
    fullName: string;
    phone: string;
    wilayaCode: number;
    wilayaNameSnapshot: string;
    communeName: string;
    addressLine: string;
    postalCode: string | null;
    notes: string | null;
  };
  items: readonly OrderItemInput[];
  /**
   * Variants to reserve, already filtered to `TRACK` lines by the service.
   * Empty when the order enters `AWAITING_PAYMENT`: 8.10.3 says an order
   * awaiting payment commits nothing.
   */
  reservations: readonly { variantId: string; quantity: number }[];
  /** Announced inside the transaction (section 11). Optional. */
  onPlaced?: PlacementHook;
};

export type PlacementFailure =
  { code: 'OUT_OF_STOCK'; variantId: string } | { code: 'CART_ALREADY_CONVERTED' };

class PlacementError extends Error {
  constructor(readonly failure: PlacementFailure) {
    super(failure.code);
  }
}

/**
 * Reserve stock for one variant, atomically.
 *
 * `BUSINESS-RULES.md` 10.4: `available = stockQuantity - reservedQuantity`, and
 * the check and the increment happen in one statement so two simultaneous
 * orders cannot oversell. The database also carries
 * `reserved_quantity <= stock_quantity` as a check constraint, so a mistake
 * here fails loudly rather than quietly selling stock twice.
 */
async function reserveStock(
  tx: Prisma.TransactionClient,
  variantId: string,
  quantity: number,
): Promise<void> {
  const updated = await tx.$executeRaw`
    UPDATE "product_variants"
       SET "reserved_quantity" = "reserved_quantity" + ${quantity}
     WHERE "id" = ${variantId}::uuid
       AND "is_active" = true
       AND "stock_quantity" - "reserved_quantity" >= ${quantity}
  `;

  if (updated === 0) throw new PlacementError({ code: 'OUT_OF_STOCK', variantId });
}

export type PlacedOrder = { id: string; orderNumber: string; status: OrderStatus };

/**
 * Create the order, its items, its address, its first history row, and the
 * stock reservation — or nothing at all.
 *
 * The cart is marked `CONVERTED` in the same transaction and the update is
 * conditional on it still being `ACTIVE`, so a double submission produces one
 * order rather than two: the second attempt matches no rows and aborts.
 */
export async function placeOrder(
  input: PlaceOrderInput,
): Promise<{ ok: true; order: PlacedOrder } | { ok: false; failure: PlacementFailure }> {
  try {
    const order = await prisma.$transaction(async (tx) => {
      // Idempotency: one order per cart, decided by the database rather than by
      // a check the second request could pass at the same moment as the first.
      const claimed = await tx.cart.updateMany({
        where: { id: input.cartId, status: 'ACTIVE' },
        data: { status: 'CONVERTED' },
      });

      if (claimed.count === 0)
        throw new PlacementError({ code: 'CART_ALREADY_CONVERTED' });

      for (const reservation of input.reservations) {
        await reserveStock(tx, reservation.variantId, reservation.quantity);
      }

      const [generated] = await tx.$queryRaw<
        { order_number: string }[]
      >`SELECT next_order_number() AS order_number`;

      const orderNumber = generated!.order_number;

      const created = await tx.order.create({
        data: {
          orderNumber,
          userId: input.userId,
          guestToken: input.guestToken,
          status: input.status,
          currency: input.currency,
          contactName: input.contactName,
          contactPhone: input.contactPhone,
          contactEmail: input.contactEmail,
          subtotal: input.subtotal,
          discountTotal: input.discountTotal,
          shippingTotal: input.shippingTotal,
          taxTotal: input.taxTotal,
          grandTotal: input.grandTotal,
          depositRequired: input.depositRequired,
          paymentMethod: input.paymentMethod,
          deliveryType: input.deliveryType,
          shippingRateId: input.shippingRateId,
          shippingRateLabel: input.shippingRateLabel,
          quoteId: input.quoteId,
          customerNote: input.customerNote,
          estimatedDeliveryFrom: input.estimatedDeliveryFrom,
          estimatedDeliveryTo: input.estimatedDeliveryTo,
          items: { create: input.items.map((item) => ({ ...item })) },
          addresses: { create: [{ type: 'SHIPPING', ...input.address }] },
          statusHistory: {
            create: [
              {
                fromStatus: null,
                toStatus: input.status,
                actorType: 'CUSTOMER',
                note: 'Commande passée depuis le site.',
                isCustomerVisible: true,
              },
            ],
          },
        },
        select: { id: true, orderNumber: true, status: true },
      });

      await tx.cart.update({
        where: { id: input.cartId },
        data: { convertedOrderId: created.id },
      });

      if (input.onPlaced) {
        await input.onPlaced({
          tx,
          orderId: created.id,
          orderNumber: created.orderNumber,
          status: created.status as OrderStatus,
        });
      }

      return created;
    });

    return {
      ok: true,
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status as OrderStatus,
      },
    };
  } catch (error) {
    if (error instanceof PlacementError) return { ok: false, failure: error.failure };
    throw error;
  }
}

/* ---------------------------------------------------------------------------
 * Reading an order back
 * ------------------------------------------------------------------------ */

export type OrderView = {
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: 'UNPAID' | 'DEPOSIT_PAID' | 'PAID' | string;
  placedAt: Date;
  currency: string;
  contactName: string;
  contactEmail: string | null;
  contactPhone: string;
  subtotal: number;
  discountTotal: number;
  shippingTotal: number;
  grandTotal: number;
  depositRequired: number;
  paymentMethod: string;
  deliveryType: 'HOME' | 'DESK';
  shippingRateLabel: string | null;
  estimatedDeliveryFrom: Date | null;
  estimatedDeliveryTo: Date | null;
  hasProductionLine: boolean;
  /** 8.8: derived from payment rows, never set. Copied here for display. */
  amountPaid: number;
  customerNote: string | null;
  carrierName: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  /** The quote this order was placed against, when it is a quote-bound one. */
  quoteNumber: string | null;
  requestNumber: string | null;
  /**
   * The status timeline, **customer-visible entries only**.
   *
   * `DATABASE.md` section 8 makes `order_status_history` the truth and
   * `orders.status` a materialised convenience, and `UX.md` section 8 asks for
   * it as a real timeline. The `isCustomerVisible` filter is in the query, so a
   * caller cannot forget it.
   */
  timeline: readonly {
    fromStatus: OrderStatus | null;
    toStatus: OrderStatus;
    note: string | null;
    createdAt: Date;
  }[];
  address: {
    fullName: string;
    phone: string;
    wilayaNameSnapshot: string;
    communeName: string;
    addressLine: string;
    notes: string | null;
  } | null;
  items: readonly {
    kind: 'STOCK' | 'CUSTOM' | 'FEE';
    name: string;
    variantLabel: string | null;
    image: { src: string | null; alt: string } | null;
    sku: string | null;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
    requiresProduction: boolean;
  }[];
};

/**
 * An order, by number, for the customer who may see it.
 *
 * Authorisation is **in the query**: a guest must present the order's
 * `guestToken`, and a signed-in customer must own the row. `internalNotes` is
 * not selected at all — `DATABASE.md` section 15 requires the DTO mapper to
 * exclude it rather than a caller to remember to.
 */
/**
 * The projection both sides render from.
 *
 * One select and one mapper, so the customer's order page and the admin's
 * workspace can never disagree about a total, a snapshot or a label. What
 * separates them is the **where clause**, not the columns: `internalNotes` and
 * internal history entries are absent from this select entirely, and staff read
 * them through their own query rather than through a flag that widens this one.
 */
const ORDER_VIEW_SELECT = {
  orderNumber: true,
  status: true,
  paymentStatus: true,
  placedAt: true,
  currency: true,
  contactName: true,
  contactEmail: true,
  contactPhone: true,
  subtotal: true,
  discountTotal: true,
  shippingTotal: true,
  grandTotal: true,
  depositRequired: true,
  paymentMethod: true,
  deliveryType: true,
  shippingRateLabel: true,
  estimatedDeliveryFrom: true,
  estimatedDeliveryTo: true,
  amountPaid: true,
  customerNote: true,
  carrierName: true,
  trackingNumber: true,
  trackingUrl: true,
  quote: { select: { quoteNumber: true } },
  request: { select: { requestNumber: true } },
  // `internalNotes` and any history row marked internal stay out of the
  // query rather than being stripped afterwards (DATABASE.md section 15).
  statusHistory: {
    where: { isCustomerVisible: true },
    select: {
      fromStatus: true,
      toStatus: true,
      note: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  },
  addresses: {
    where: { type: 'SHIPPING' },
    select: {
      fullName: true,
      phone: true,
      wilayaNameSnapshot: true,
      communeName: true,
      addressLine: true,
      notes: true,
    },
    take: 1,
  },
  items: {
    select: {
      kind: true,
      nameSnapshot: true,
      variantLabelSnapshot: true,
      skuSnapshot: true,
      imageKeySnapshot: true,
      unitPrice: true,
      quantity: true,
      lineTotal: true,
      requiresProduction: true,
    },
    orderBy: { position: 'asc' },
  },
} satisfies Prisma.OrderSelect;

type OrderViewRow = Prisma.OrderGetPayload<{ select: typeof ORDER_VIEW_SELECT }>;

function toOrderView(row: OrderViewRow): OrderView {
  return {
    orderNumber: row.orderNumber,
    status: row.status as OrderStatus,
    paymentStatus: row.paymentStatus,
    placedAt: row.placedAt,
    currency: row.currency,
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    subtotal: row.subtotal,
    discountTotal: row.discountTotal,
    shippingTotal: row.shippingTotal,
    grandTotal: row.grandTotal,
    depositRequired: row.depositRequired,
    paymentMethod: row.paymentMethod,
    deliveryType: row.deliveryType as 'HOME' | 'DESK',
    shippingRateLabel: row.shippingRateLabel,
    estimatedDeliveryFrom: row.estimatedDeliveryFrom,
    estimatedDeliveryTo: row.estimatedDeliveryTo,
    hasProductionLine: row.items.some((item) => item.requiresProduction),
    amountPaid: row.amountPaid,
    customerNote: row.customerNote,
    carrierName: row.carrierName,
    trackingNumber: row.trackingNumber,
    trackingUrl: row.trackingUrl,
    quoteNumber: row.quote?.quoteNumber ?? null,
    requestNumber: row.request?.requestNumber ?? null,
    timeline: row.statusHistory.map((entry) => ({
      fromStatus: entry.fromStatus as OrderStatus | null,
      toStatus: entry.toStatus as OrderStatus,
      note: entry.note,
      createdAt: entry.createdAt,
    })),
    address: row.addresses[0] ?? null,
    items: row.items.map((item) => ({
      kind: item.kind as 'STOCK' | 'CUSTOM' | 'FEE',
      // The snapshot, never the live product: an order must render identically
      // forever, whatever the catalogue does afterwards.
      name: item.nameSnapshot,
      variantLabel: item.variantLabelSnapshot,
      image: item.imageKeySnapshot
        ? { src: toPublicAssetUrl(item.imageKeySnapshot), alt: item.nameSnapshot }
        : null,
      sku: item.skuSnapshot,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      lineTotal: item.lineTotal,
      requiresProduction: item.requiresProduction,
    })),
  };
}

/**
 * An order, by number, for the customer who may see it.
 *
 * Authorisation is **in the query**: a guest must present the order's
 * `guestToken`, and a signed-in customer must own the row. With neither, there
 * is no viewer and nothing is returned — there is no argument that turns this
 * into an unscoped read.
 */
export async function findOrderForViewer(input: {
  orderNumber: string;
  guestToken?: string | null;
  userId?: string | null;
}): Promise<OrderView | null> {
  const viewer: Prisma.OrderWhereInput[] = [];
  if (input.guestToken) viewer.push({ guestToken: input.guestToken });
  if (input.userId) viewer.push({ userId: input.userId });
  if (viewer.length === 0) return null;

  const row = await prisma.order.findFirst({
    where: { orderNumber: input.orderNumber, OR: viewer },
    select: ORDER_VIEW_SELECT,
  });

  return row ? toOrderView(row) : null;
}

/* ---------------------------------------------------------------------------
 * The customer's own orders
 * ------------------------------------------------------------------------ */

export type OrderSummary = {
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: string;
  placedAt: Date;
  currency: string;
  grandTotal: number;
  depositRequired: number;
  amountPaid: number;
  paymentMethod: string;
  itemCount: number;
  hasProductionLine: boolean;
};

/**
 * Every order this customer placed, newest first.
 *
 * `userId` is a filter in the query, not a check after the fetch
 * (`DATABASE.md` section 15). A guest order is deliberately absent: it belongs
 * to a token, not to an account, until it is claimed.
 */
export async function listOrdersForOwner(
  userId: string,
  limit = 50,
): Promise<readonly OrderSummary[]> {
  const rows = await prisma.order.findMany({
    where: { userId },
    select: {
      orderNumber: true,
      status: true,
      paymentStatus: true,
      placedAt: true,
      currency: true,
      grandTotal: true,
      depositRequired: true,
      amountPaid: true,
      paymentMethod: true,
      items: { select: { quantity: true, requiresProduction: true } },
    },
    orderBy: { placedAt: 'desc' },
    take: limit,
  });

  return rows.map((row) => ({
    orderNumber: row.orderNumber,
    status: row.status as OrderStatus,
    paymentStatus: row.paymentStatus,
    placedAt: row.placedAt,
    currency: row.currency,
    grandTotal: row.grandTotal,
    depositRequired: row.depositRequired,
    amountPaid: row.amountPaid,
    paymentMethod: row.paymentMethod,
    itemCount: row.items.reduce((total, item) => total + item.quantity, 0),
    hasProductionLine: row.items.some((item) => item.requiresProduction),
  }));
}

/* ---------------------------------------------------------------------------
 * The admin's reads
 * ------------------------------------------------------------------------ */

export type StaffOrderRow = {
  /** The row's identity, for the list's own selection checkbox. */
  id: string;
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: string;
  placedAt: Date;
  currency: string;
  contactName: string;
  contactEmail: string | null;
  grandTotal: number;
  depositRequired: number;
  amountPaid: number;
  paymentMethod: string;
  itemCount: number;
  hasProductionLine: boolean;
  /** A proof waiting to be looked at, which is what puts an order in the queue. */
  hasPendingProof: boolean;
};

/**
 * The order queue.
 *
 * Filtered by status because that is how the work is actually divided
 * (`UX.md` section 9: "order list, filtered by status → order workspace"), and
 * bounded, because `ARCHITECTURE.md` section 6 allows no unbounded `findMany`.
 */
export async function listOrdersForStaff(input: {
  status?: OrderStatus | null;
  limit?: number;
  archived?: boolean;
}): Promise<readonly StaffOrderRow[]> {
  const rows = await prisma.order.findMany({
    where: {
      ...archiveWhere(input.archived),
      ...(input.status ? { status: input.status } : {}),
    },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      paymentStatus: true,
      placedAt: true,
      currency: true,
      contactName: true,
      contactEmail: true,
      grandTotal: true,
      depositRequired: true,
      amountPaid: true,
      paymentMethod: true,
      items: { select: { quantity: true, requiresProduction: true } },
      paymentProofs: { where: { status: 'SUBMITTED' }, select: { id: true }, take: 1 },
    },
    orderBy: { placedAt: 'desc' },
    take: input.limit ?? 50,
  });

  return rows.map((row) => ({
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status as OrderStatus,
    paymentStatus: row.paymentStatus,
    placedAt: row.placedAt,
    currency: row.currency,
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    grandTotal: row.grandTotal,
    depositRequired: row.depositRequired,
    amountPaid: row.amountPaid,
    paymentMethod: row.paymentMethod,
    itemCount: row.items.reduce((total, item) => total + item.quantity, 0),
    hasProductionLine: row.items.some((item) => item.requiresProduction),
    hasPendingProof: row.paymentProofs.length > 0,
  }));
}

/* ---------------------------------------------------------------------------
 * The payment queue
 * ------------------------------------------------------------------------ */

/**
 * The facets `/admin/payments` offers.
 *
 * Every one is a **money** question answered from `paymentStatus`, which 8.8
 * derives from the payment rows and stores on the order. None of them is a new
 * payment status, and none of them keys off an order *status* — that was the
 * defect Phase 14.6 found: the screen filtered "acompte attendu" on
 * `status = AWAITING_PAYMENT`, so an order sitting in `AWAITING_CONFIRMATION`
 * with an untouched deposit — the commonest shape in this shop — never
 * appeared.
 *
 *   unpaid       nothing received yet
 *   deposit_due  a deposit is required and has not been covered
 *   partial      something received, the balance still open (8.8 DEPOSIT_PAID)
 *   settled      the balance is closed
 *   proofs       a transfer receipt is waiting to be looked at (8.10.5)
 */
export type PaymentQueueFilter =
  'all' | 'unpaid' | 'deposit_due' | 'partial' | 'settled' | 'proofs';

export type StaffPaymentRow = StaffOrderRow & {
  /** `outstandingBalance` from `domain/order/payment`, computed once here. */
  outstanding: number;
  /** What is still owed **on the deposit**, which is what unblocks confirmation. */
  outstandingDeposit: number;
};

/**
 * The `where` for one facet.
 *
 * `DEPOSIT_PAID` means the deposit is covered and the balance is not (8.8), so
 * "a deposit is still owed" is `depositRequired > 0` and `UNPAID` — there is no
 * third state to check and no column-to-column comparison to write.
 */
function paymentFilterWhere(filter: PaymentQueueFilter): Prisma.OrderWhereInput {
  return { ...archiveWhere(undefined), ...paymentPosition(filter) };
}

/**
 * The money half of the facet, without the archive clause.
 *
 * Split out so the archive filter is applied once, above, and cannot be
 * forgotten by a facet added later — every one of them goes through
 * `paymentFilterWhere`, and `all` returning `{}` was exactly the shape that
 * would have quietly listed archived orders.
 */
function paymentPosition(filter: PaymentQueueFilter): Prisma.OrderWhereInput {
  switch (filter) {
    case 'unpaid':
      return { paymentStatus: 'UNPAID', grandTotal: { gt: 0 } };
    case 'deposit_due':
      return { paymentStatus: 'UNPAID', depositRequired: { gt: 0 } };
    case 'partial':
      return { paymentStatus: 'DEPOSIT_PAID' };
    case 'settled':
      return { paymentStatus: 'PAID' };
    case 'proofs':
      return { paymentProofs: { some: { status: 'SUBMITTED' } } };
    case 'all':
      return {};
  }
}

export type PaymentQueueCounts = Record<PaymentQueueFilter, number>;

/**
 * How many orders sit in each facet — over the whole table, not over the page.
 *
 * The tiles on the screen are counts somebody acts on, so they must not be the
 * length of a truncated fetch. Six bounded `count`s in one round trip is
 * cheaper than reading every order to tally them in JavaScript, and it is the
 * only way the figure stays true once the shop has more orders than the page
 * shows.
 */
export async function countOrdersByPaymentPosition(): Promise<PaymentQueueCounts> {
  const filters: readonly PaymentQueueFilter[] = [
    'all',
    'unpaid',
    'deposit_due',
    'partial',
    'settled',
    'proofs',
  ];

  const counts = await prisma.$transaction(
    filters.map((filter) => prisma.order.count({ where: paymentFilterWhere(filter) })),
  );

  return Object.fromEntries(
    filters.map((filter, index) => [filter, counts[index] ?? 0]),
  ) as PaymentQueueCounts;
}

/** The total still owed across the orders that owe anything. */
export async function outstandingAcrossOrders(): Promise<number> {
  // Archived orders are out of this figure on purpose. The number is read as
  // "what is still to collect", and an order somebody archived is one they
  // have stopped chasing — leaving it in would make the total disagree with
  // the list printed directly beneath it.
  const where = { ...archiveWhere(undefined), paymentStatus: { not: 'PAID' as const } };

  const [totals, paid] = await Promise.all([
    prisma.order.aggregate({ where, _sum: { grandTotal: true } }),
    prisma.order.aggregate({ where, _sum: { amountPaid: true } }),
  ]);

  return Math.max(0, (totals._sum.grandTotal ?? 0) - (paid._sum.amountPaid ?? 0));
}

/**
 * Orders, seen as money.
 *
 * Same projection as the order queue plus the two figures the payment screen is
 * read for, computed from `domain/order/payment` rather than restated here.
 */
export async function listOrdersForPayments(input: {
  filter?: PaymentQueueFilter;
  method?: PaymentMethod | null;
  status?: OrderStatus | null;
  limit?: number;
}): Promise<readonly StaffPaymentRow[]> {
  const rows = await prisma.order.findMany({
    where: {
      ...paymentFilterWhere(input.filter ?? 'all'),
      ...(input.method ? { paymentMethod: input.method } : {}),
      ...(input.status ? { status: input.status } : {}),
    },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      paymentStatus: true,
      placedAt: true,
      currency: true,
      contactName: true,
      contactEmail: true,
      grandTotal: true,
      depositRequired: true,
      amountPaid: true,
      paymentMethod: true,
      items: { select: { quantity: true, requiresProduction: true } },
      paymentProofs: { where: { status: 'SUBMITTED' }, select: { id: true }, take: 1 },
    },
    orderBy: { placedAt: 'desc' },
    take: input.limit ?? 100,
  });

  return rows.map((row) => ({
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status as OrderStatus,
    paymentStatus: row.paymentStatus,
    placedAt: row.placedAt,
    currency: row.currency,
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    grandTotal: row.grandTotal,
    depositRequired: row.depositRequired,
    amountPaid: row.amountPaid,
    paymentMethod: row.paymentMethod,
    itemCount: row.items.reduce((total, item) => total + item.quantity, 0),
    hasProductionLine: row.items.some((item) => item.requiresProduction),
    hasPendingProof: row.paymentProofs.length > 0,
    outstanding: outstandingBalance(row),
    outstandingDeposit: outstandingDeposit(row),
  }));
}

export type StaffOrderView = OrderView & {
  /** Never selected by any customer projection (`DATABASE.md` section 15). */
  internalNotes: string | null;
  userId: string | null;
  /** The whole history, internal entries included. */
  fullTimeline: readonly {
    fromStatus: OrderStatus | null;
    toStatus: OrderStatus;
    actorType: string;
    actorName: string | null;
    note: string | null;
    isCustomerVisible: boolean;
    createdAt: Date;
  }[];
  payments: readonly {
    id: string;
    kind: string;
    method: string;
    amount: number;
    status: string;
    reference: string | null;
    recordedByName: string | null;
    createdAt: Date;
  }[];
  proofs: readonly {
    id: string;
    designFileId: string;
    status: 'SUBMITTED' | 'ACCEPTED' | 'REJECTED';
    rejectionReason: string | null;
    createdAt: Date;
  }[];
  /** Derived once, here, so the workspace never recomputes it (8.6). */
  heldFrom: OrderStatus | null;
  /** Whether the order currently holds a stock reservation. */
  holdsReservation: boolean;
};

/**
 * One order, for staff.
 *
 * Two things this returns that no customer projection does: `internalNotes`,
 * and the whole status history rather than the customer-visible slice. Both are
 * the reason it is a separate function rather than a flag on
 * `findOrderForViewer` — a boolean that switched a query between "safe" and
 * "everything" would be one wrong argument away from a leak.
 */
export async function findOrderForStaff(
  orderNumber: string,
): Promise<StaffOrderView | null> {
  const row = await prisma.order.findUnique({
    where: { orderNumber },
    select: {
      userId: true,
      internalNotes: true,
      statusHistory: {
        select: {
          fromStatus: true,
          toStatus: true,
          actorType: true,
          note: true,
          isCustomerVisible: true,
          createdAt: true,
          actor: { select: { name: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
      payments: {
        select: {
          id: true,
          kind: true,
          method: true,
          amount: true,
          status: true,
          providerReference: true,
          createdAt: true,
          recordedBy: { select: { name: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
      paymentProofs: {
        select: {
          id: true,
          designFileId: true,
          status: true,
          rejectionReason: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!row) return null;

  // The same projection the customer sees, so the two can never disagree about
  // a total or a snapshot. Staff reach it by their own unscoped query, which is
  // what their capability actually is (12.1).
  const shared = await prisma.order.findUnique({
    where: { orderNumber },
    select: ORDER_VIEW_SELECT,
  });

  if (!shared) return null;
  const base = toOrderView(shared);

  const sequence = row.statusHistory.map((entry) => entry.toStatus as OrderStatus);

  return {
    ...base,
    userId: row.userId,
    internalNotes: row.internalNotes,
    fullTimeline: row.statusHistory.map((entry) => ({
      fromStatus: entry.fromStatus as OrderStatus | null,
      toStatus: entry.toStatus as OrderStatus,
      actorType: entry.actorType,
      actorName: entry.actor?.name ?? null,
      note: entry.note,
      isCustomerVisible: entry.isCustomerVisible,
      createdAt: entry.createdAt,
    })),
    payments: row.payments.map((payment) => ({
      id: payment.id,
      kind: payment.kind,
      method: payment.method,
      amount: payment.amount,
      status: payment.status,
      reference: payment.providerReference,
      recordedByName: payment.recordedBy?.name ?? null,
      createdAt: payment.createdAt,
    })),
    proofs: row.paymentProofs.map((proof) => ({
      id: proof.id,
      designFileId: proof.designFileId,
      status: proof.status as 'SUBMITTED' | 'ACCEPTED' | 'REJECTED',
      rejectionReason: proof.rejectionReason,
      createdAt: proof.createdAt,
    })),
    heldFrom: heldFromOf(sequence),
    holdsReservation: holdsReservation(sequence),
  };
}

/**
 * The status an `ON_HOLD` order was held from (8.6).
 *
 * Read from `order_status_history`, which `DATABASE.md` section 8 makes the
 * truth to `orders.status`'s convenience. Storing it in a column as well would
 * be a second copy of a fact the history already carries exactly.
 */
export function heldFromOf(sequence: readonly OrderStatus[]): OrderStatus | null {
  const last = sequence[sequence.length - 1];
  if (last !== 'ON_HOLD') return null;

  for (let index = sequence.length - 2; index >= 0; index -= 1) {
    const status = sequence[index]!;
    if (status !== 'ON_HOLD') return status;
  }

  return null;
}

/**
 * Whether the order currently holds a stock reservation.
 *
 * Derived from the history rather than stored, for the same reason as
 * `heldFromOf`. ADR-022: placement reserves only for an order that entered
 * `AWAITING_CONFIRMATION`; one that entered `AWAITING_PAYMENT` reserves nothing
 * until an admin confirms it (8.10.3). Cancellation releases whatever is held
 * (8.4) and is terminal, so nothing can be re-taken afterwards.
 */
export function holdsReservation(sequence: readonly OrderStatus[]): boolean {
  const entry = sequence[0];
  if (!entry) return false;

  const taken = reservesStockAtPlacement(entry) || sequence.includes('CONFIRMED');
  const released = sequence.includes('CANCELLED');

  return taken && !released;
}

/* ---------------------------------------------------------------------------
 * The admin's writes
 * ------------------------------------------------------------------------ */

export type TransitionFailure =
  | { code: 'ORDER_NOT_FOUND' }
  | { code: 'STATUS_CHANGED' }
  | { code: 'OUT_OF_STOCK'; variantId: string };

/** The columns 8.5 requires a transition to move, by target status. */
const TIMESTAMP_COLUMN: Partial<Record<OrderStatus, string>> = {
  CONFIRMED: 'confirmedAt',
  IN_PRODUCTION: 'productionStartedAt',
  READY: 'readyAt',
  SHIPPED: 'shippedAt',
  DELIVERED: 'deliveredAt',
  CANCELLED: 'cancelledAt',
};

/**
 * Move an order, atomically (8.5).
 *
 * One transaction: claim the row **conditionally on the status the caller saw**,
 * write the `order_status_history` entry, move the denormalised `status` and its
 * timestamp column, and take or release the stock reservation the move implies.
 *
 * The conditional claim is what makes two admins pressing two buttons safe:
 * `updateMany … where { status: from }` matches for exactly one of them, and the
 * other is told the order moved rather than silently overwriting it. The same
 * technique as Phase 8's placement and Phase 10's acceptance.
 *
 * Stock follows ADR-022 and 8.4:
 *
 *   - confirming an order that reserved nothing at placement reserves it now,
 *     and fails the whole transition if the stock is gone;
 *   - cancelling releases whatever is held;
 *   - every other transition touches no inventory.
 *
 * The caller has already validated the move against `domain/order/state-machine`.
 * This function does not re-derive the rules; it applies one that was approved.
 */
export async function transitionOrder(input: {
  orderNumber: string;
  from: OrderStatus;
  to: OrderStatus;
  actorUserId: string;
  note: string | null;
  isCustomerVisible: boolean;
  cancellationReason?: string | null;
  carrierName?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
}): Promise<
  { ok: true; status: OrderStatus } | { ok: false; failure: TransitionFailure }
> {
  try {
    return await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { orderNumber: input.orderNumber },
        select: {
          id: true,
          status: true,
          statusHistory: { select: { toStatus: true }, orderBy: { createdAt: 'asc' } },
          items: { select: { variantId: true, quantity: true, kind: true } },
        },
      });

      if (!order)
        return { ok: false as const, failure: { code: 'ORDER_NOT_FOUND' as const } };

      const sequence = order.statusHistory.map((entry) => entry.toStatus as OrderStatus);
      const held = holdsReservation(sequence);

      const timestampColumn = TIMESTAMP_COLUMN[input.to];

      const moved = await tx.order.updateMany({
        where: { id: order.id, status: input.from },
        data: {
          status: input.to,
          ...(timestampColumn ? { [timestampColumn]: new Date() } : {}),
          ...(input.to === 'CANCELLED'
            ? { cancellationReason: input.cancellationReason ?? null }
            : {}),
          ...(input.to === 'SHIPPED'
            ? {
                carrierName: input.carrierName ?? null,
                trackingNumber: input.trackingNumber ?? null,
                trackingUrl: input.trackingUrl ?? null,
              }
            : {}),
        },
      });

      if (moved.count === 0) {
        return { ok: false as const, failure: { code: 'STATUS_CHANGED' as const } };
      }

      // 8.4: confirming takes the reservation an AWAITING_PAYMENT order never
      // took, and cancelling gives back whatever is held.
      const reservable = order.items.filter(
        (item) => item.kind !== 'FEE' && item.variantId !== null,
      );

      if (input.to === 'CONFIRMED' && !held) {
        for (const item of reservable) {
          await reserveStock(tx, item.variantId!, item.quantity);
        }
      }

      if (input.to === 'CANCELLED' && held) {
        for (const item of reservable) {
          await tx.$executeRaw`
            UPDATE "product_variants"
               SET "reserved_quantity" = GREATEST(0, "reserved_quantity" - ${item.quantity})
             WHERE "id" = ${item.variantId!}::uuid
          `;
        }
      }

      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: input.from,
          toStatus: input.to,
          actorType: 'ADMIN',
          actorUserId: input.actorUserId,
          note: input.note,
          isCustomerVisible: input.isCustomerVisible,
        },
      });

      return { ok: true as const, status: input.to };
    });
  } catch (error) {
    if (error instanceof PlacementError && error.failure.code === 'OUT_OF_STOCK') {
      return {
        ok: false,
        failure: { code: 'OUT_OF_STOCK', variantId: error.failure.variantId },
      };
    }
    throw error;
  }
}

export type PaymentFailure = { code: 'ORDER_NOT_FOUND' } | { code: 'AMOUNT_CHANGED' };

/**
 * Record a payment, and recompute what it implies (8.8, 8.10.4).
 *
 * One transaction: insert the `payments` row with its `recordedByUserId`, then
 * recompute `amountPaid` and `paymentStatus` **from the rows** rather than from
 * anything the caller supplied. An admin never edits `paymentStatus`; they
 * write a payment and the status follows.
 *
 * `expectedAmountPaid` is the figure the admin's screen was showing. If another
 * payment landed in between, the write is refused rather than applied to a
 * balance that has moved — the same conditional-claim technique as the status
 * transition, applied to money.
 */
export async function recordPayment(input: {
  orderNumber: string;
  kind: 'DEPOSIT' | 'BALANCE' | 'FULL' | 'REFUND';
  method: 'COD' | 'BANK_TRANSFER' | 'CCP';
  amount: number;
  reference: string | null;
  recordedByUserId: string;
  expectedAmountPaid: number;
}): Promise<
  | { ok: true; amountPaid: number; paymentStatus: PaymentStatus }
  | { ok: false; failure: PaymentFailure }
> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { orderNumber: input.orderNumber },
      select: {
        id: true,
        currency: true,
        grandTotal: true,
        depositRequired: true,
        amountPaid: true,
      },
    });

    if (!order)
      return { ok: false as const, failure: { code: 'ORDER_NOT_FOUND' as const } };

    if (order.amountPaid !== input.expectedAmountPaid) {
      return { ok: false as const, failure: { code: 'AMOUNT_CHANGED' as const } };
    }

    await tx.payment.create({
      data: {
        orderId: order.id,
        provider: 'manual',
        method: input.method,
        kind: input.kind,
        amount: input.amount,
        currency: order.currency,
        // Offline transfers are confirmed by a person looking at a statement,
        // so the row is SUCCEEDED at the moment it is recorded (8.10.4).
        status: 'SUCCEEDED',
        providerReference: input.reference,
        capturedAt: new Date(),
        recordedByUserId: input.recordedByUserId,
      },
    });

    const rows = await tx.payment.findMany({
      where: { orderId: order.id },
      select: { kind: true, amount: true, status: true },
    });

    const amountPaid = amountPaidFrom(
      rows.map((row) => ({
        kind: row.kind as 'DEPOSIT' | 'BALANCE' | 'FULL' | 'REFUND',
        amount: row.amount,
        status: row.status as 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED',
      })),
    );

    const paymentStatus = derivePaymentStatus({
      amountPaid,
      grandTotal: order.grandTotal,
      depositRequired: order.depositRequired,
    });

    await tx.order.update({
      where: { id: order.id },
      data: { amountPaid, paymentStatus },
    });

    return { ok: true as const, amountPaid, paymentStatus };
  });
}

/* ---------------------------------------------------------------------------
 * Proof of payment (8.10.2)
 * ------------------------------------------------------------------------ */

/**
 * Attach a customer's transfer receipt to their order.
 *
 * Both halves are scoped: the order must be the customer's, and the file must
 * be one the Phase 9 pipeline already marked `READY` for that same owner. The
 * partial unique index permits one outstanding proof per order, so a customer
 * cannot fill the queue by submitting repeatedly.
 */
export async function attachPaymentProof(input: {
  orderNumber: string;
  userId: string;
  designFileId: string;
}): Promise<{ ok: true } | { ok: false; reason: 'NOT_FOUND' | 'ALREADY_PENDING' }> {
  const order = await prisma.order.findFirst({
    where: { orderNumber: input.orderNumber, userId: input.userId },
    select: { id: true },
  });

  if (!order) return { ok: false, reason: 'NOT_FOUND' };

  const file = await prisma.designFile.findFirst({
    where: {
      id: input.designFileId,
      ownerUserId: input.userId,
      status: 'READY',
      deletedAt: null,
    },
    select: { id: true },
  });

  if (!file) return { ok: false, reason: 'NOT_FOUND' };

  try {
    await prisma.orderPaymentProof.create({
      data: {
        orderId: order.id,
        designFileId: file.id,
        submittedByUserId: input.userId,
        status: 'SUBMITTED',
      },
    });

    return { ok: true };
  } catch {
    // The partial unique index refused a second outstanding proof.
    return { ok: false, reason: 'ALREADY_PENDING' };
  }
}

/** 8.10.4: accepting or refusing a proof, with a reason the customer reads. */
export async function reviewPaymentProof(input: {
  proofId: string;
  accept: boolean;
  rejectionReason: string | null;
  reviewedByUserId: string;
}): Promise<boolean> {
  const reviewed = await prisma.orderPaymentProof.updateMany({
    where: { id: input.proofId, status: 'SUBMITTED' },
    data: {
      status: input.accept ? 'ACCEPTED' : 'REJECTED',
      rejectionReason: input.accept ? null : input.rejectionReason,
      reviewedByUserId: input.reviewedByUserId,
      reviewedAt: new Date(),
    },
  });

  return reviewed.count > 0;
}

/** The proof a staff member is about to open, with the order it belongs to. */
export async function findPaymentProof(proofId: string): Promise<{
  id: string;
  orderNumber: string;
  designFileId: string;
  status: string;
} | null> {
  const row = await prisma.orderPaymentProof.findUnique({
    where: { id: proofId },
    select: {
      id: true,
      designFileId: true,
      status: true,
      order: { select: { orderNumber: true } },
    },
  });

  if (!row) return null;

  return {
    id: row.id,
    orderNumber: row.order.orderNumber,
    designFileId: row.designFileId,
    status: row.status,
  };
}

/** The customer's own view of where their proof stands. */
export async function findProofForOwner(input: {
  orderNumber: string;
  userId: string;
}): Promise<{
  id: string;
  status: 'SUBMITTED' | 'ACCEPTED' | 'REJECTED';
  rejectionReason: string | null;
  createdAt: Date;
} | null> {
  const row = await prisma.orderPaymentProof.findFirst({
    where: { order: { orderNumber: input.orderNumber, userId: input.userId } },
    select: { id: true, status: true, rejectionReason: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });

  if (!row) return null;

  return {
    id: row.id,
    status: row.status as 'SUBMITTED' | 'ACCEPTED' | 'REJECTED',
    rejectionReason: row.rejectionReason,
    createdAt: row.createdAt,
  };
}

/** The admin's private working notes on an order (`DATABASE.md` section 15). */
export async function setOrderInternalNotes(input: {
  orderNumber: string;
  notes: string | null;
}): Promise<boolean> {
  const updated = await prisma.order.updateMany({
    where: { orderNumber: input.orderNumber },
    data: { internalNotes: input.notes },
  });

  return updated.count > 0;
}
