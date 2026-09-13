import 'server-only';

import { prisma } from '@/lib/db/client';

/**
 * The account row, as its owner sees it.
 *
 * Deliberately tiny. `DATABASE.md` section 15 puts `sessions.token`,
 * `accounts.password` and `verification.value` in the never-serialise class,
 * and the way to keep a credential out of a page is not to select it — a
 * projection that fetched the whole user and stripped fields afterwards is one
 * forgotten line from rendering a password hash.
 *
 * `role` is included because a customer may see their own; nothing else on the
 * user row is.
 */

export type UserProfile = {
  name: string | null;
  email: string;
  emailVerified: boolean;
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  role: 'CUSTOMER' | 'STAFF' | 'ADMIN';
  createdAt: Date;
};

export async function getCurrentUserProfile(userId: string): Promise<UserProfile | null> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      name: true,
      email: true,
      emailVerified: true,
      status: true,
      role: true,
      createdAt: true,
    },
  });

  if (!row) return null;

  return {
    name: row.name,
    email: row.email,
    emailVerified: row.emailVerified,
    status: row.status as UserProfile['status'],
    role: row.role as UserProfile['role'],
    createdAt: row.createdAt,
  };
}

/* ---------------------------------------------------------------------------
 * The customer directory (UX.md section 9)
 * ------------------------------------------------------------------------ */

export type CustomerRow = {
  id: string;
  name: string | null;
  email: string;
  emailVerified: boolean;
  status: string;
  createdAt: Date;
  orderCount: number;
  requestCount: number;
  lastOrderAt: Date | null;
};

/**
 * Registered customers, searchable by name or address.
 *
 * Bounded and ordered, per `ARCHITECTURE.md` section 6. Only `CUSTOMER` rows:
 * a staff account is not a customer, and listing colleagues beside buyers makes
 * the directory a worse tool and a wider disclosure.
 *
 * `UX.md` section 9 also describes a guest half — contacts grouped by phone
 * across `orders` — which is not built here and is recorded as outstanding.
 */
export async function listCustomersForStaff(input: {
  query?: string | null;
  limit?: number;
}): Promise<readonly CustomerRow[]> {
  const search = input.query?.trim();

  const rows = await prisma.user.findMany({
    where: {
      role: 'CUSTOMER',
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      name: true,
      email: true,
      emailVerified: true,
      status: true,
      createdAt: true,
      _count: { select: { orders: true, customRequests: true } },
      orders: {
        select: { placedAt: true },
        orderBy: { placedAt: 'desc' },
        take: 1,
      },
    },
    orderBy: { createdAt: 'desc' },
    take: input.limit ?? 50,
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    emailVerified: row.emailVerified,
    status: row.status,
    createdAt: row.createdAt,
    orderCount: row._count.orders,
    requestCount: row._count.customRequests,
    lastOrderAt: row.orders[0]?.placedAt ?? null,
  }));
}

export type CustomerDetail = CustomerRow & {
  phone: string | null;
  orders: readonly {
    orderNumber: string;
    status: string;
    placedAt: Date;
    grandTotal: number;
    currency: string;
  }[];
  requests: readonly {
    requestNumber: string;
    status: string;
    createdAt: Date;
  }[];
  quotes: readonly {
    quoteNumber: string;
    version: number;
    status: string;
    grandTotal: number;
    currency: string;
    validUntil: Date;
  }[];
};

/**
 * One customer, with their history.
 *
 * The projection is the point. `sessions`, `accounts` and every credential on
 * them are **not selected** — `SECURITY.md` section 2.1 puts `sessions.token`
 * and `accounts.password` in the never-serialise class, and the way to keep a
 * password hash off a page is not to fetch it.
 */
export async function findCustomerForStaff(
  userId: string,
): Promise<CustomerDetail | null> {
  const row = await prisma.user.findFirst({
    where: { id: userId, role: 'CUSTOMER' },
    select: {
      id: true,
      name: true,
      email: true,
      emailVerified: true,
      status: true,
      phone: true,
      createdAt: true,
      _count: { select: { orders: true, customRequests: true } },
      orders: {
        select: {
          orderNumber: true,
          status: true,
          placedAt: true,
          grandTotal: true,
          currency: true,
        },
        orderBy: { placedAt: 'desc' },
        take: 25,
      },
      customRequests: {
        select: { requestNumber: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 25,
      },
      quotes: {
        where: { status: { not: 'DRAFT' } },
        select: {
          quoteNumber: true,
          version: true,
          status: true,
          grandTotal: true,
          currency: true,
          validUntil: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 25,
      },
    },
  });

  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    emailVerified: row.emailVerified,
    status: row.status,
    phone: row.phone,
    createdAt: row.createdAt,
    orderCount: row._count.orders,
    requestCount: row._count.customRequests,
    lastOrderAt: row.orders[0]?.placedAt ?? null,
    orders: row.orders,
    requests: row.customRequests,
    quotes: row.quotes,
  };
}

/**
 * The name and address a notification is sent to.
 *
 * The narrowest possible projection, and the authoritative one: a quote's
 * recipient is its owner's stored address, never something a payload carried.
 */
export async function findQuoteOwnerContact(
  userId: string,
): Promise<{ name: string | null; email: string } | null> {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });
}
