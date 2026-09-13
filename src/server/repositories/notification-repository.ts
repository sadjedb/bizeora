import 'server-only';

import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db/client';
import type { NotificationTemplate } from '@/domain/notification';

/**
 * The notification outbox.
 *
 * `ARCHITECTURE.md` section 11: "a service writes a `Notification` row inside
 * the same transaction as the state change, and a dispatcher delivers it. A
 * failed email never rolls back an order." Every function here serves one half
 * of that sentence.
 *
 * The write is idempotent by `dedupeKey`, which is unique: enqueuing the same
 * event twice is a constraint violation this module swallows, so a retried
 * server action produces one e-mail rather than two. That is the property the
 * whole design rests on, and it is enforced by the database rather than by a
 * check the second request could pass at the same moment as the first.
 */

/**
 * The transaction handle and the payload shape, re-exported.
 *
 * A service must be able to say "write this row in my transaction" and "here
 * are the template variables", and both are Prisma types. The boundary rule
 * confines Prisma to this layer, so the types cross it under names that do not
 * mention the ORM — a caller passes a `NotificationTx` without ever importing
 * one.
 */
export type NotificationTx = Prisma.TransactionClient;
export type NotificationPayload = Prisma.InputJsonValue;

export type EnqueueInput = {
  template: NotificationTemplate;
  /** `<template>:<business id>`. Null only for a genuinely repeatable message. */
  dedupeKey: string | null;
  recipient: string;
  /** Template variables, snapshotted at the moment of the event. */
  payload: NotificationPayload;
  userId?: string | null;
  relatedOrderId?: string | null;
  relatedQuoteId?: string | null;
  relatedRequestId?: string | null;
  scheduledFor?: Date;
};

export type EnqueueResult = { enqueued: boolean };

/**
 * Write one notification, optionally inside the caller's transaction.
 *
 * Passing `tx` is what makes "in the same transaction as the state change"
 * true: an order that is placed and a confirmation that is queued either both
 * happen or neither does. Passing nothing is for the events that are not part
 * of a transaction — a scheduled expiry sweep, say.
 *
 * Returns `{ enqueued: false }` when the row already existed. That is a
 * success, not an error: the event has been recorded once, which is the point.
 */
export async function enqueueNotification(
  input: EnqueueInput,
  tx?: NotificationTx,
): Promise<EnqueueResult> {
  const client = tx ?? prisma;

  try {
    await client.notification.create({
      data: {
        channel: 'EMAIL',
        template: input.template,
        dedupeKey: input.dedupeKey,
        recipient: input.recipient,
        payload: input.payload,
        userId: input.userId ?? null,
        relatedOrderId: input.relatedOrderId ?? null,
        relatedQuoteId: input.relatedQuoteId ?? null,
        relatedRequestId: input.relatedRequestId ?? null,
        status: 'PENDING',
        scheduledFor: input.scheduledFor ?? new Date(),
      },
    });

    return { enqueued: true };
  } catch (error) {
    if (isUniqueViolation(error)) return { enqueued: false };
    throw error;
  }
}

/**
 * Record that an event happened but will not be delivered.
 *
 * A staff notification with no configured recipient, for instance. Writing a
 * `SKIPPED` row rather than nothing means the gap is visible in the outbox
 * instead of being a silence nobody can distinguish from a bug.
 */
export async function skipNotification(
  input: Omit<EnqueueInput, 'recipient'> & { reason: string },
  tx?: NotificationTx,
): Promise<EnqueueResult> {
  const client = tx ?? prisma;

  try {
    await client.notification.create({
      data: {
        channel: 'EMAIL',
        template: input.template,
        dedupeKey: input.dedupeKey,
        recipient: null,
        payload: input.payload,
        userId: input.userId ?? null,
        relatedOrderId: input.relatedOrderId ?? null,
        relatedQuoteId: input.relatedQuoteId ?? null,
        relatedRequestId: input.relatedRequestId ?? null,
        status: 'SKIPPED',
        lastError: input.reason,
      },
    });

    return { enqueued: true };
  } catch (error) {
    if (isUniqueViolation(error)) return { enqueued: false };
    throw error;
  }
}

export type PendingNotification = {
  id: string;
  template: string;
  recipient: string | null;
  payload: unknown;
  attempts: number;
};

/**
 * How long a claimed row is held before another dispatcher may take it.
 *
 * A lease, not a lock: a dispatcher that crashes mid-send leaves the row held
 * for five minutes and then it is retried, rather than held for ever. Long
 * enough that a slow provider call cannot cause a double send, short enough
 * that a crash costs one cycle.
 */
const CLAIM_LEASE_MS = 5 * 60 * 1000;

/**
 * Claim work, exclusively.
 *
 * Each row is claimed with its own conditional `updateMany`, matching only a
 * `PENDING` row that is **due**, and pushing `scheduledFor` a lease into the
 * future as it goes. Two dispatchers running at once therefore split the queue
 * rather than both sending it: the first `updateMany` moves the row out of
 * "due", and the second matches nothing.
 *
 * A batch `updateMany` would not do. It reports a count, not which rows it won,
 * and — worse — leaving `status` and `scheduledFor` untouched would let a second
 * dispatcher match the very same rows. The row-by-row compare-and-swap is what
 * makes the claim mean something.
 *
 * `attempts` is incremented on claim rather than on failure, so a message that
 * kills the process still spends an attempt and cannot be retried for ever.
 */
export async function claimPendingNotifications(input: {
  limit: number;
  now: Date;
}): Promise<readonly PendingNotification[]> {
  const due = await prisma.notification.findMany({
    where: {
      status: 'PENDING',
      channel: 'EMAIL',
      scheduledFor: { lte: input.now },
    },
    select: { id: true },
    orderBy: { scheduledFor: 'asc' },
    take: input.limit,
  });

  if (due.length === 0) return [];

  const leaseUntil = new Date(input.now.getTime() + CLAIM_LEASE_MS);
  const claimed: string[] = [];

  for (const row of due) {
    const won = await prisma.notification.updateMany({
      where: { id: row.id, status: 'PENDING', scheduledFor: { lte: input.now } },
      data: { attempts: { increment: 1 }, scheduledFor: leaseUntil },
    });

    if (won.count === 1) claimed.push(row.id);
  }

  if (claimed.length === 0) return [];

  const rows = await prisma.notification.findMany({
    where: { id: { in: claimed } },
    select: {
      id: true,
      template: true,
      recipient: true,
      payload: true,
      attempts: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    template: row.template,
    recipient: row.recipient,
    payload: row.payload,
    attempts: row.attempts,
  }));
}

export async function markNotificationSent(id: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { id, status: 'PENDING' },
    data: { status: 'SENT', sentAt: new Date(), lastError: null },
  });
}

/**
 * Record a failure.
 *
 * `retryAt` present means the row stays `PENDING` and comes back later;
 * `null` means the budget is spent and it becomes `FAILED`, where a person can
 * find it. Either way the reason is kept — the transport supplies a status, not
 * a provider body, so nothing of the message is stored here.
 */
export async function markNotificationFailed(input: {
  id: string;
  error: string;
  retryAt: Date | null;
}): Promise<void> {
  await prisma.notification.updateMany({
    where: { id: input.id, status: 'PENDING' },
    data: input.retryAt
      ? { lastError: input.error.slice(0, 500), scheduledFor: input.retryAt }
      : { status: 'FAILED', lastError: input.error.slice(0, 500) },
  });
}

/** Put a `FAILED` notification back in the queue, for an operator's retry. */
export async function requeueFailedNotifications(input: {
  ids?: readonly string[];
  now?: Date;
}): Promise<number> {
  const requeued = await prisma.notification.updateMany({
    where: { status: 'FAILED', ...(input.ids ? { id: { in: [...input.ids] } } : {}) },
    data: { status: 'PENDING', attempts: 0, scheduledFor: input.now ?? new Date() },
  });

  return requeued.count;
}

/** What the outbox holds, for an operator and for the tests. */
export async function countNotificationsByStatus(): Promise<Record<string, number>> {
  const rows = await prisma.notification.groupBy({
    by: ['status'],
    _count: { _all: true },
  });

  return Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
}

/** Prisma's `P2002`, and PostgreSQL's `23505` underneath it. */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === 'P2002' || code === '23505';
}
