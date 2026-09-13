import 'server-only';

import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db/client';
import type { RequestStatus } from '@/domain/request';
import { archiveWhere } from '@/server/repositories/archive-repository';

/**
 * Custom requests, as the admin workspace sees them.
 *
 * Phase 7 wrote requests; nothing has read them back until now. Two rules from
 * `DATABASE.md` section 15 shape every select here:
 *
 *   - `internalNotes` and `INTERNAL_NOTE` events **never** appear in a
 *     customer-scoped read. That is enforced by the query, not by a caller
 *     remembering to filter.
 *   - `design_files.storageKey` never leaves the server. The admin sees a file
 *     id and asks Phase 9 for a signed URL, exactly as a customer does.
 */

/* ---------------------------------------------------------------------------
 * The queue
 * ------------------------------------------------------------------------ */

export type RequestQueueRow = {
  id: string;
  requestNumber: string;
  status: RequestStatus;
  contactName: string | null;
  contactEmail: string | null;
  pricingMode: 'FIXED' | 'QUOTE';
  estimateMin: number | null;
  estimateMax: number | null;
  itemCount: number;
  submittedAt: Date | null;
  createdAt: Date;
  needsInfoReason: string | null;
  hasOutstandingQuote: boolean;
};

/**
 * The admin queue.
 *
 * Ordered by what is waiting on the business. `BUSINESS-RULES.md` 6.7 exists so
 * this ordering can be accurate: a request in `NEEDS_INFO` is the customer's
 * move and drops down the list, one in `SUBMITTED` is the business's and rises.
 */
export async function listRequestsForStaff(input: {
  status?: RequestStatus | null;
  limit?: number;
  archived?: boolean;
}): Promise<readonly RequestQueueRow[]> {
  const rows = await prisma.customRequest.findMany({
    where: {
      ...archiveWhere(input.archived),
      status: input.status ? input.status : { notIn: ['DRAFT'] },
    },
    select: {
      id: true,
      requestNumber: true,
      status: true,
      contactName: true,
      contactEmail: true,
      pricingMode: true,
      estimateMin: true,
      estimateMax: true,
      submittedAt: true,
      createdAt: true,
      needsInfoReason: true,
      _count: { select: { items: true } },
      quotes: {
        where: { status: { in: ['SENT', 'VIEWED'] } },
        select: { id: true },
        take: 1,
      },
    },
    orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
    take: input.limit ?? 50,
  });

  return rows.map((row) => ({
    id: row.id,
    requestNumber: row.requestNumber,
    status: row.status as RequestStatus,
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    pricingMode: row.pricingMode as 'FIXED' | 'QUOTE',
    estimateMin: row.estimateMin,
    estimateMax: row.estimateMax,
    itemCount: row._count.items,
    submittedAt: row.submittedAt,
    createdAt: row.createdAt,
    needsInfoReason: row.needsInfoReason,
    hasOutstandingQuote: row.quotes.length > 0,
  }));
}

/* ---------------------------------------------------------------------------
 * The detail
 * ------------------------------------------------------------------------ */

const REQUEST_DETAIL_SELECT = {
  id: true,
  requestNumber: true,
  status: true,
  pricingMode: true,
  contactName: true,
  contactEmail: true,
  contactPhone: true,
  customerNote: true,
  needsInfoReason: true,
  estimateMin: true,
  estimateMax: true,
  submittedAt: true,
  createdAt: true,
  userId: true,
  user: { select: { id: true, name: true, email: true } },
  items: {
    select: {
      id: true,
      quantity: true,
      customizationConfig: {
        select: {
          id: true,
          frozenAt: true,
          embroideryText: true,
          instructions: true,
          threadColorCount: true,
          pricingMode: true,
          estimateMin: true,
          estimateMax: true,
          // The snapshots, which are what a frozen configuration reads from.
          productNameSnapshot: true,
          placementLabel: true,
          designSurfaceLabel: true,
          embroiderySizeLabel: true,
          threadColorNames: true,
          fontLabel: true,
          // Where the design sits, so the workshop can be shown the picture
          // rather than a sentence about it (ADR-035).
          designSurface: true,
          designXPercent: true,
          designYPercent: true,
          designWidthPercent: true,
          designRotationDeg: true,
          embroideryWidthMm: true,
          embroideryHeightMm: true,
          surfaceImage: {
            select: { storageKey: true, alt: true, width: true, height: true },
          },
          // The live rows, for a configuration that is not yet frozen.
          product: { select: { id: true, name: true, basePrice: true, currency: true } },
          variant: { select: { id: true, sku: true, priceOverride: true } },
          placement: { select: { name: true } },
          embroiderySize: { select: { name: true, basePrice: true } },
          threadColors: {
            select: { threadColor: { select: { name: true, hexColor: true } } },
            orderBy: { position: 'asc' },
          },
          files: {
            select: {
              role: true,
              designFile: {
                select: {
                  id: true,
                  originalFilename: true,
                  mimeType: true,
                  byteSize: true,
                  status: true,
                  previewKey: true,
                },
              },
            },
            orderBy: { position: 'asc' },
          },
        },
      },
    },
    orderBy: { position: 'asc' },
  },
} satisfies Prisma.CustomRequestSelect;

type RequestDetailRow = Prisma.CustomRequestGetPayload<{
  select: typeof REQUEST_DETAIL_SELECT;
}>;

export type RequestDetail = Omit<RequestDetailRow, 'status'> & { status: RequestStatus };

export async function findRequestForStaff(
  requestNumber: string,
): Promise<RequestDetail | null> {
  const row = await prisma.customRequest.findUnique({
    where: { requestNumber },
    select: REQUEST_DETAIL_SELECT,
  });

  return row ? { ...row, status: row.status as RequestStatus } : null;
}

/** The same request, scoped to its owner. Used by the customer's quote page. */
export async function findRequestForOwner(input: {
  requestNumber: string;
  userId: string;
}): Promise<RequestDetail | null> {
  const row = await prisma.customRequest.findFirst({
    where: { requestNumber: input.requestNumber, userId: input.userId },
    select: REQUEST_DETAIL_SELECT,
  });

  return row ? { ...row, status: row.status as RequestStatus } : null;
}

/* ---------------------------------------------------------------------------
 * The conversation
 * ------------------------------------------------------------------------ */

export type RequestEvent = {
  id: string;
  type: 'STATUS_CHANGE' | 'MESSAGE' | 'FILE_ADDED' | 'QUOTE_SENT' | 'INTERNAL_NOTE';
  fromStatus: string | null;
  toStatus: string | null;
  actorType: 'CUSTOMER' | 'ADMIN' | 'SYSTEM';
  actorName: string | null;
  message: string | null;
  createdAt: Date;
};

/**
 * The event timeline.
 *
 * `customerVisibleOnly` is not a convenience flag: `INTERNAL_NOTE` rows and
 * anything marked `isCustomerVisible: false` must never reach a customer, and
 * the filter belongs in the query so a caller cannot forget it.
 */
export async function listRequestEvents(input: {
  requestId: string;
  customerVisibleOnly: boolean;
}): Promise<readonly RequestEvent[]> {
  const rows = await prisma.customRequestEvent.findMany({
    where: {
      requestId: input.requestId,
      ...(input.customerVisibleOnly
        ? { isCustomerVisible: true, type: { not: 'INTERNAL_NOTE' } }
        : {}),
    },
    select: {
      id: true,
      type: true,
      fromStatus: true,
      toStatus: true,
      actorType: true,
      message: true,
      createdAt: true,
      actor: { select: { name: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  return rows.map((row) => ({
    id: row.id,
    type: row.type as RequestEvent['type'],
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    actorType: row.actorType as RequestEvent['actorType'],
    actorName: row.actor?.name ?? null,
    message: row.message,
    createdAt: row.createdAt,
  }));
}

/**
 * Attach a request to a customer account.
 *
 * A Phase 7 request carries contact details and no `userId`, because the
 * builder never asked anyone to sign in. A quote, by contrast, requires one:
 * `quotes.userId` is NOT NULL, and 7.5 gives acceptance to the owning customer.
 * So pricing a request binds it to the account whose email it names — the same
 * "claim by verified email" rule `DATABASE.md` section 15 gives for orders.
 */
export async function attachRequestToUser(input: {
  requestId: string;
  userId: string;
}): Promise<void> {
  await prisma.customRequest.updateMany({
    where: { id: input.requestId, userId: null },
    data: { userId: input.userId },
  });
}

/** A customer's own requests, for their account area. */
export async function listRequestsForOwner(
  userId: string,
): Promise<readonly RequestQueueRow[]> {
  const rows = await prisma.customRequest.findMany({
    where: { userId },
    select: {
      id: true,
      requestNumber: true,
      status: true,
      contactName: true,
      contactEmail: true,
      pricingMode: true,
      estimateMin: true,
      estimateMax: true,
      submittedAt: true,
      createdAt: true,
      needsInfoReason: true,
      _count: { select: { items: true } },
      quotes: {
        where: { status: { in: ['SENT', 'VIEWED'] } },
        select: { id: true },
        take: 1,
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return rows.map((row) => ({
    id: row.id,
    requestNumber: row.requestNumber,
    status: row.status as RequestStatus,
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    pricingMode: row.pricingMode as 'FIXED' | 'QUOTE',
    estimateMin: row.estimateMin,
    estimateMax: row.estimateMax,
    itemCount: row._count.items,
    submittedAt: row.submittedAt,
    createdAt: row.createdAt,
    needsInfoReason: row.needsInfoReason,
    hasOutstandingQuote: row.quotes.length > 0,
  }));
}
