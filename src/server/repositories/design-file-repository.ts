import 'server-only';

import { createHash } from 'node:crypto';

import { prisma } from '@/lib/db/client';
import type { CartOwner } from '@/server/repositories/cart-repository';

/**
 * Design-file rows.
 *
 * Ownership is the whole point of this module, so it is expressed once, here,
 * and every read goes through it. `DATABASE.md` section 15 puts `design_files`
 * in the customer-owned class: "every customer-scoped query filters on it **in
 * the query**". A function that returns a file and leaves the caller to check
 * who owns it is one forgotten line from handing a customer somebody else's
 * artwork.
 */

/** The same owner the cart uses. One browser is one guest across both. */
export type FileOwner = CartOwner;

/**
 * A guest's token is stored hashed. It is a bearer credential living in an
 * HttpOnly cookie, and a database dump should not be a set of usable ones.
 */
export function hashOwnerToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function ownerWhere(owner: FileOwner) {
  return owner.kind === 'user'
    ? { ownerUserId: owner.userId }
    : { ownerTokenHash: hashOwnerToken(owner.anonymousToken) };
}

export type DesignFileRecord = {
  id: string;
  status: 'PENDING' | 'READY' | 'REJECTED' | 'QUARANTINED';
  storageKey: string;
  previewKey: string | null;
  originalFilename: string;
  mimeType: string;
  extension: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  rejectionReason: string | null;
  createdAt: Date;
};

const FILE_SELECT = {
  id: true,
  status: true,
  storageKey: true,
  previewKey: true,
  originalFilename: true,
  mimeType: true,
  extension: true,
  byteSize: true,
  width: true,
  height: true,
  rejectionReason: true,
  createdAt: true,
} as const;

/* ---------------------------------------------------------------------------
 * Reads
 * ------------------------------------------------------------------------ */

/**
 * One file, if it belongs to this owner and has not been deleted.
 *
 * Returns null rather than throwing for a file that exists but belongs to
 * somebody else: the caller must not be able to distinguish "no such file"
 * from "not yours", or the endpoint becomes an oracle for enumerating ids.
 */
export async function findOwnedFile(
  designFileId: string,
  owner: FileOwner,
): Promise<DesignFileRecord | null> {
  const row = await prisma.designFile.findFirst({
    where: { id: designFileId, deletedAt: null, ...ownerWhere(owner) },
    select: FILE_SELECT,
  });

  return row;
}

/** The owner's files by id, in one query. Missing or foreign ids simply absent. */
export async function findOwnedFiles(
  designFileIds: readonly string[],
  owner: FileOwner,
): Promise<readonly DesignFileRecord[]> {
  if (designFileIds.length === 0) return [];

  return prisma.designFile.findMany({
    where: { id: { in: [...designFileIds] }, deletedAt: null, ...ownerWhere(owner) },
    select: FILE_SELECT,
  });
}

/** How many live files this owner already has, for the per-owner ceiling. */
export async function countLiveFiles(owner: FileOwner): Promise<number> {
  return prisma.designFile.count({
    where: {
      deletedAt: null,
      status: { in: ['PENDING', 'READY'] },
      ...ownerWhere(owner),
    },
  });
}

/* ---------------------------------------------------------------------------
 * Writes
 * ------------------------------------------------------------------------ */

export async function createPendingFile(input: {
  owner: FileOwner;
  storageKey: string;
  originalFilename: string;
  mimeType: string;
  extension: string;
  byteSize: number;
}): Promise<{ id: string }> {
  return prisma.designFile.create({
    data: {
      ownerUserId: input.owner.kind === 'user' ? input.owner.userId : null,
      ownerTokenHash:
        input.owner.kind === 'guest' ? hashOwnerToken(input.owner.anonymousToken) : null,
      storageKey: input.storageKey,
      originalFilename: input.originalFilename,
      mimeType: input.mimeType,
      extension: input.extension,
      // The declared size. Replaced at finalisation by what the object weighs.
      byteSize: input.byteSize,
      // Replaced by the digest of the stored bytes. A PENDING row's checksum is
      // a placeholder, never used for anything, and never trusted.
      checksumSha256: '',
      status: 'PENDING',
    },
    select: { id: true },
  });
}

/**
 * Promote a validated file.
 *
 * Conditional on the row still being `PENDING`, so a second finalisation of the
 * same file changes nothing and the caller can tell: duplicate completion calls
 * are ordinary on a flaky mobile connection, and each must be safe.
 */
export async function markFileReady(input: {
  designFileId: string;
  storageKey: string;
  previewKey: string | null;
  mimeType: string;
  extension: string;
  byteSize: number;
  checksumSha256: string;
  width: number | null;
  height: number | null;
}): Promise<boolean> {
  const updated = await prisma.designFile.updateMany({
    where: { id: input.designFileId, status: 'PENDING', deletedAt: null },
    data: {
      status: 'READY',
      storageKey: input.storageKey,
      previewKey: input.previewKey,
      mimeType: input.mimeType,
      extension: input.extension,
      byteSize: input.byteSize,
      checksumSha256: input.checksumSha256,
      width: input.width,
      height: input.height,
      rejectionReason: null,
      savedAt: new Date(),
    },
  });

  return updated.count === 1;
}

/**
 * Refuse a file, with the reason kept.
 *
 * `REJECTED` rather than deleted: the customer is told why, the admin can see
 * that something was attempted, and a file that failed validation must remain
 * distinguishable from one that was never uploaded.
 */
export async function markFileRejected(input: {
  designFileId: string;
  reason: string;
}): Promise<void> {
  await prisma.designFile.updateMany({
    where: { id: input.designFileId, status: 'PENDING' },
    data: { status: 'REJECTED', rejectionReason: input.reason },
  });
}

/** Soft-delete. The row survives so a linked configuration keeps its history. */
export async function softDeleteFile(input: {
  designFileId: string;
  owner: FileOwner;
}): Promise<boolean> {
  const deleted = await prisma.designFile.updateMany({
    where: {
      id: input.designFileId,
      deletedAt: null,
      // A file already attached to a configuration is part of a submitted
      // request and is no longer the customer's to remove from the builder.
      configs: { none: {} },
      ...ownerWhere(input.owner),
    },
    data: { deletedAt: new Date() },
  });

  return deleted.count === 1;
}

/**
 * Uploads that never completed, older than the quarantine lifetime.
 *
 * `SECURITY.md` section 7 gives the bucket a lifecycle rule that removes
 * `quarantine/` objects after 24 hours. That rule cannot touch the database, so
 * this is the half of the sweep the application owns: without it the rows
 * outlive the objects and the table fills with files that never existed.
 */
export async function findStalePendingFiles(input: {
  olderThan: Date;
  limit: number;
}): Promise<readonly { id: string; storageKey: string }[]> {
  return prisma.designFile.findMany({
    where: { status: 'PENDING', deletedAt: null, createdAt: { lt: input.olderThan } },
    select: { id: true, storageKey: true },
    orderBy: { createdAt: 'asc' },
    take: input.limit,
  });
}

export async function markFileAbandoned(designFileId: string): Promise<void> {
  await prisma.designFile.updateMany({
    where: { id: designFileId, status: 'PENDING' },
    data: {
      status: 'REJECTED',
      rejectionReason: 'Upload never completed.',
      deletedAt: new Date(),
    },
  });
}

/**
 * Attach files to a configuration, inside the caller's transaction.
 *
 * Takes the transaction client because this happens as part of submitting a
 * custom request: a request whose files failed to link is a job with no
 * artwork, which is exactly the partial write Phase 7's transaction exists to
 * prevent.
 */
export type FileLink = { designFileId: string; role: 'PRIMARY' | 'REFERENCE' };

export function linkFilesData(links: readonly FileLink[]) {
  return links.map((link, position) => ({
    designFileId: link.designFileId,
    role: link.role,
    position,
  }));
}

/* ---------------------------------------------------------------------------
 * Staff access
 * ------------------------------------------------------------------------ */

/**
 * A file, resolved through the request it is attached to rather than through
 * its uploader.
 *
 * Staff are **not** owners (`domain/permissions.ownsResource` is explicit about
 * it), so they cannot reach a file by the customer path. They reach it by the
 * work: a file is visible to staff when it is linked to a customisation that a
 * submitted request prices. A file still sitting in a builder nobody submitted
 * is nobody's business, which is why the join is required rather than optional.
 *
 * The caller has already proven it is staff. This function proves the file is
 * one of the business's to look at.
 */
export async function findFileAttachedToRequest(input: {
  designFileId: string;
  requestId: string;
}): Promise<DesignFileRecord | null> {
  const row = await prisma.designFile.findFirst({
    where: {
      id: input.designFileId,
      deletedAt: null,
      configs: {
        some: {
          config: { requestItems: { some: { requestId: input.requestId } } },
        },
      },
    },
    select: FILE_SELECT,
  });

  return row;
}

/**
 * Record a staff read of a customer's artwork.
 *
 * `SECURITY.md` section 7 and `CLAUDE.md` rule 4: design files are private and
 * "access audit-logged". A customer reading their own file is the expected
 * case and is not logged; a member of staff opening somebody else's artwork is
 * the case the log exists for.
 */
export async function logDesignFileAccess(input: {
  designFileId: string;
  actorUserId: string;
  /** What the file was reached through — a request, or a proof of payment. */
  context: { kind: 'request' | 'payment_proof'; id: string };
  purpose: 'PREVIEW' | 'DOWNLOAD';
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      actorType: 'ADMIN',
      action: `design_file.${input.purpose.toLowerCase()}`,
      entityType: 'design_file',
      entityId: input.designFileId,
      metadata: { via: input.context.kind, contextId: input.context.id },
    },
  });
}

/* ---------------------------------------------------------------------------
 * Proof of payment (BUSINESS-RULES.md 8.10.2)
 * ------------------------------------------------------------------------ */

/**
 * The file behind a proof of payment, resolved through the proof.
 *
 * `viewerUserId` is the customer's when the customer is looking, and `null`
 * when staff are — staff reach it by the work rather than by ownership, exactly
 * as they reach a design file (12.1). Passing a `viewerUserId` narrows the
 * query; it never widens it.
 */
export async function findFileForPaymentProof(input: {
  proofId: string;
  viewerUserId: string | null;
}): Promise<DesignFileRecord | null> {
  const row = await prisma.designFile.findFirst({
    where: {
      deletedAt: null,
      paymentProof: {
        id: input.proofId,
        ...(input.viewerUserId ? { order: { userId: input.viewerUserId } } : {}),
      },
    },
    select: FILE_SELECT,
  });

  return row;
}
