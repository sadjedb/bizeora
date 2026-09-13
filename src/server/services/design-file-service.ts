import 'server-only';

import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  MAX_FILES_PER_CONFIGURATION,
  MAX_PDF_PAGES,
  UPLOAD_ERROR_LABELS,
  detectSignature,
  inspectSvg,
  isPreviewableType,
  validateUploadIntent,
  verifyContentAgreement,
  type AcceptedMimeType,
} from '@/domain/design-file';
import { CANONICAL_EXTENSION } from '@/domain/design-file';
import { createPreview, inspectRaster } from '@/lib/media/raster';
import {
  newObjectId,
  previewKeyFor,
  promotedKey,
  storage,
  storageKeyFor,
} from '@/lib/storage';
import {
  countLiveFiles,
  createPendingFile,
  findFileAttachedToRequest,
  findFileForPaymentProof,
  findOwnedFile,
  logDesignFileAccess,
  markFileAbandoned,
  markFileReady,
  markFileRejected,
  softDeleteFile,
  type DesignFileRecord,
  type FileOwner,
} from '@/server/repositories/design-file-repository';

/**
 * The design-file pipeline.
 *
 * `SECURITY.md` section 6, implemented:
 *
 *   1. authorise the intent, issue a presigned PUT into `quarantine/`, write a
 *      `PENDING` row
 *   2. the browser PUTs directly to storage — the application never handles the
 *      bytes on the request path (ADR-009)
 *   3. the browser says it finished; the **server** reads the object, checks
 *      the magic number, the agreement, the size, the dimensions and the SVG
 *      contents, generates a raster preview for PNG and JPG, promotes the
 *      object to `designs/` and only then writes `READY`
 *
 * The sentence that governs step 3: **a file is not READY because the browser
 * says the upload worked.** The client's only contribution to finalisation is
 * the file's id, and even that is scoped to its owner before anything is read.
 */

/* ---------------------------------------------------------------------------
 * Limits and input
 * ------------------------------------------------------------------------ */

const PRESIGN_TTL_SECONDS = 15 * 60;
const DOWNLOAD_TTL_SECONDS = 5 * 60;

/**
 * A ceiling on live files per owner.
 *
 * Section 6 caps files per configuration; this caps them per *uploader*, which
 * is the number that matters before a configuration exists. Without it a script
 * with a cookie can fill the bucket one presign at a time. Generous enough that
 * a customer redoing a five-file request several times never meets it.
 */
const MAX_LIVE_FILES_PER_OWNER = 40;

/** How long an unfinished upload survives before the reaper takes it. */
export const PENDING_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

export const uploadIntentInput = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(120),
  sizeBytes: z.number().int().min(1),
});

export const finaliseInput = z.object({ designFileId: z.uuid() });

export type UploadAuthorisation = {
  designFileId: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
};

export type FileView = {
  designFileId: string;
  status: 'PENDING' | 'READY' | 'REJECTED' | 'QUARANTINED';
  filename: string;
  contentType: string;
  byteSize: number;
  previewable: boolean;
  /** Present only for a READY raster. A short-lived signed URL. */
  previewUrl: string | null;
  /**
   * The artwork's own pixel dimensions, when they could be read.
   *
   * The placement editor needs them and nothing else does: a design's height on
   * the garment follows from its aspect ratio, so without these the workshop is
   * told a width and asked to confirm the rest. Null for an SVG or a PDF, which
   * are never decoded here (ADR-024).
   */
  widthPx: number | null;
  heightPx: number | null;
};

export type FileError =
  | { code: 'INVALID_INPUT'; message: string }
  | { code: 'REJECTED'; message: string }
  | { code: 'NOT_FOUND'; message: string }
  | { code: 'TOO_MANY_FILES'; message: string }
  | { code: 'STORAGE_UNAVAILABLE'; message: string };

export type FileResult<T> = { ok: true; value: T } | { ok: false; error: FileError };

function rejected(message: string): FileResult<never> {
  return { ok: false, error: { code: 'REJECTED', message } };
}

/* ---------------------------------------------------------------------------
 * 1. Authorise the upload
 * ------------------------------------------------------------------------ */

/**
 * Issue an upload authorisation.
 *
 * Everything checkable before bytes exist is checked here, because it is the
 * cheap place to say no. Passing proves nothing about the file: the presign is
 * bound to a key this function chose, a content type and a maximum length, and
 * the object it produces is examined from scratch afterwards.
 */
export async function authoriseUpload(
  owner: FileOwner,
  raw: unknown,
): Promise<FileResult<UploadAuthorisation>> {
  const parsed = uploadIntentInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'Requête invalide.' } };
  }

  const intent = validateUploadIntent(parsed.data);
  if (!intent.ok) return rejected(UPLOAD_ERROR_LABELS[intent.error.code]);

  if ((await countLiveFiles(owner)) >= MAX_LIVE_FILES_PER_OWNER) {
    return {
      ok: false,
      error: {
        code: 'TOO_MANY_FILES',
        message: 'Trop de fichiers envoyés. Supprimez-en avant d’en ajouter d’autres.',
      },
    };
  }

  // The key is ours. Nothing the customer sent reaches it — not the name, not
  // the extension, not a directory (SECURITY.md section 6).
  const objectId = newObjectId();
  const key = storageKeyFor({
    prefix: 'quarantine',
    objectId,
    extension: CANONICAL_EXTENSION[intent.value.mimeType],
  });

  let upload;
  try {
    upload = await storage.presignPut({
      key,
      contentType: intent.value.mimeType,
      maxBytes: intent.value.byteSize,
      expiresInSeconds: PRESIGN_TTL_SECONDS,
    });
  } catch {
    return {
      ok: false,
      error: {
        code: 'STORAGE_UNAVAILABLE',
        message: 'L’envoi de fichiers est momentanément indisponible.',
      },
    };
  }

  const file = await createPendingFile({
    owner,
    storageKey: key,
    originalFilename: intent.value.filename,
    mimeType: intent.value.mimeType,
    extension: intent.value.extension,
    byteSize: intent.value.byteSize,
  });

  return {
    ok: true,
    value: {
      designFileId: file.id,
      uploadUrl: upload.url,
      method: 'PUT',
      headers: upload.headers,
      expiresAt: upload.expiresAt.toISOString(),
    },
  };
}

/* ---------------------------------------------------------------------------
 * 3. Verify and promote
 * ------------------------------------------------------------------------ */

async function inspectContents(
  bytes: Uint8Array,
  declared: AcceptedMimeType,
  extension: string,
  byteSize: number,
): Promise<
  | { ok: true; mimeType: AcceptedMimeType; width: number | null; height: number | null }
  | { ok: false; message: string }
> {
  const detected = detectSignature(bytes);

  const agreement = verifyContentAgreement({
    declaredMimeType: declared,
    extension,
    detected,
    byteSize,
  });

  if (!agreement.ok)
    return { ok: false, message: UPLOAD_ERROR_LABELS[agreement.error.code] };

  const mimeType = agreement.value;

  if (mimeType === 'image/svg+xml') {
    const findings = inspectSvg(new TextDecoder().decode(bytes));
    if (findings.length > 0) {
      return { ok: false, message: UPLOAD_ERROR_LABELS.SVG_HOSTILE };
    }
    // Never decoded, never rasterised, never rendered (ADR-011, ADR-024).
    return { ok: true, mimeType, width: null, height: null };
  }

  if (mimeType === 'application/pdf') {
    // Opaque by policy. The only thing read is the page count, from the
    // structural markers — no PDF parser runs on the server.
    const text = new TextDecoder('latin1').decode(bytes);
    const pages = (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    if (pages > MAX_PDF_PAGES) {
      return { ok: false, message: UPLOAD_ERROR_LABELS.PDF_TOO_LONG };
    }
    return { ok: true, mimeType, width: null, height: null };
  }

  const raster = await inspectRaster(bytes);
  if (!raster.ok) return { ok: false, message: UPLOAD_ERROR_LABELS[raster.reason] };

  return { ok: true, mimeType, width: raster.width, height: raster.height };
}

/**
 * Finalise an upload.
 *
 * Idempotent by construction: `markFileReady` only moves a `PENDING` row, so a
 * second call finds the file already `READY` and returns the same view. A
 * flaky mobile connection retries this endpoint routinely.
 */
export async function finaliseUpload(
  owner: FileOwner,
  raw: unknown,
): Promise<FileResult<FileView>> {
  const parsed = finaliseInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'Requête invalide.' } };
  }

  // Scoped to the owner: an id belonging to somebody else is simply not found,
  // and the caller cannot tell that from an id that never existed.
  const file = await findOwnedFile(parsed.data.designFileId, owner);
  if (!file) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Fichier introuvable.' } };
  }

  if (file.status === 'READY') return { ok: true, value: await toView(file) };
  if (file.status !== 'PENDING') {
    return rejected(file.rejectionReason ?? UPLOAD_ERROR_LABELS.SIGNATURE_UNRECOGNISED);
  }

  const head = await storage.head(file.storageKey);
  if (!head) {
    // The browser said it uploaded; the bucket disagrees. The row stays PENDING
    // so a retry can still succeed, and the reaper takes it if none comes.
    return {
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Le fichier n’est pas arrivé. Réessayez l’envoi.',
      },
    };
  }

  const bytes = await storage.get(file.storageKey);
  if (!bytes) {
    return {
      ok: false,
      error: { code: 'STORAGE_UNAVAILABLE', message: 'Le fichier n’a pas pu être lu.' },
    };
  }

  const inspection = await inspectContents(
    bytes,
    file.mimeType as AcceptedMimeType,
    file.extension,
    head.byteSize,
  );

  if (!inspection.ok) {
    await markFileRejected({ designFileId: file.id, reason: inspection.message });
    // The object goes: an object that failed validation has no reason to
    // survive, and leaving it in quarantine is storage nobody will reclaim.
    await storage.delete(file.storageKey).catch(() => undefined);
    return rejected(inspection.message);
  }

  const objectId = file.storageKey
    .replace(/^quarantine\//, '')
    .replace(/\.[a-z0-9]+$/, '');
  const finalKey = promotedKey(file.storageKey);

  let previewKey: string | null = null;
  if (isPreviewableType(inspection.mimeType)) {
    const preview = await createPreview(bytes);
    if (preview) {
      previewKey = previewKeyFor(objectId);
      await storage.put({ key: previewKey, body: preview, contentType: 'image/jpeg' });
    }
  }

  try {
    await storage.move({ from: file.storageKey, to: finalKey });
  } catch {
    if (previewKey) await storage.delete(previewKey).catch(() => undefined);
    return {
      ok: false,
      error: {
        code: 'STORAGE_UNAVAILABLE',
        message: 'Le fichier n’a pas pu être enregistré. Réessayez.',
      },
    };
  }

  const promoted = await markFileReady({
    designFileId: file.id,
    storageKey: finalKey,
    previewKey,
    mimeType: inspection.mimeType,
    extension: file.extension,
    byteSize: head.byteSize,
    checksumSha256: createHash('sha256').update(bytes).digest('hex'),
    width: inspection.width,
    height: inspection.height,
  });

  if (!promoted) {
    // Lost a race with a concurrent finalisation. The other call promoted the
    // same object to the same key, so the outcome is identical — read it back
    // rather than reporting a failure the customer cannot act on.
    const current = await findOwnedFile(file.id, owner);
    if (current?.status === 'READY') return { ok: true, value: await toView(current) };

    return {
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Ce fichier n’est plus disponible.' },
    };
  }

  const view = await toView({
    ...file,
    status: 'READY',
    storageKey: finalKey,
    previewKey,
    byteSize: head.byteSize,
    mimeType: inspection.mimeType,
    /*
     * The dimensions the decode just found.
     *
     * `file` is the record as it was *before* promotion, when the row had no
     * width or height — those are written by `markFileReady` on the line
     * above. Spreading it alone therefore reported "dimensions unknown" for a
     * file whose dimensions had just been measured, and the placement editor,
     * which derives a design's height from that ratio, showed a width and no
     * height for every freshly uploaded logo.
     */
    width: inspection.width,
    height: inspection.height,
  });

  return { ok: true, value: view };
}

/* ---------------------------------------------------------------------------
 * Access
 * ------------------------------------------------------------------------ */

async function toView(file: DesignFileRecord): Promise<FileView> {
  let previewUrl: string | null = null;

  if (file.status === 'READY' && file.previewKey) {
    try {
      const signed = await storage.presignGet({
        key: file.previewKey,
        expiresInSeconds: DOWNLOAD_TTL_SECONDS,
      });
      previewUrl = signed.url;
    } catch {
      previewUrl = null;
    }
  }

  return {
    designFileId: file.id,
    status: file.status,
    filename: file.originalFilename,
    contentType: file.mimeType,
    previewable: isPreviewableType(file.mimeType),
    byteSize: file.byteSize,
    previewUrl,
    widthPx: file.width ?? null,
    heightPx: file.height ?? null,
  };
}

export async function getFileView(
  owner: FileOwner,
  designFileId: string,
): Promise<FileResult<FileView>> {
  const file = await findOwnedFile(designFileId, owner);
  if (!file) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Fichier introuvable.' } };
  }
  return { ok: true, value: await toView(file) };
}

/**
 * A short-lived download URL, after an authorisation check.
 *
 * `SECURITY.md` section 7: five minutes, issued per request, never cached, and
 * always an attachment. The attachment part is enforced by the adapter at the
 * provider, so a URL that escapes downloads rather than renders — which is what
 * keeps an SVG inert even if one slipped past `inspectSvg`.
 */
export async function getDownloadUrl(
  owner: FileOwner,
  designFileId: string,
): Promise<FileResult<{ url: string; expiresAt: string }>> {
  const file = await findOwnedFile(designFileId, owner);

  if (!file || file.status !== 'READY') {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Fichier introuvable.' } };
  }

  const signed = await storage.presignGet({
    key: file.storageKey,
    expiresInSeconds: DOWNLOAD_TTL_SECONDS,
    downloadFilename: file.originalFilename,
  });

  return {
    ok: true,
    value: { url: signed.url, expiresAt: signed.expiresAt.toISOString() },
  };
}

/* ---------------------------------------------------------------------------
 * Removal and cleanup
 * ------------------------------------------------------------------------ */

/** Remove a file the customer took off the builder, before it is submitted. */
export async function discardFile(
  owner: FileOwner,
  designFileId: string,
): Promise<FileResult<{ removed: true }>> {
  const file = await findOwnedFile(designFileId, owner);
  if (!file) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Fichier introuvable.' } };
  }

  const removed = await softDeleteFile({ designFileId, owner });
  if (!removed) {
    // Attached to a configuration: it belongs to a submitted request now, and
    // removing it from the builder would leave a job without its artwork.
    return {
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Ce fichier fait partie d’une demande envoyée.',
      },
    };
  }

  await storage.delete(file.storageKey).catch(() => undefined);
  if (file.previewKey) await storage.delete(file.previewKey).catch(() => undefined);

  return { ok: true, value: { removed: true } };
}

/**
 * Sweep uploads that never completed.
 *
 * The bucket's own lifecycle rule removes `quarantine/` objects after 24 hours
 * (`SECURITY.md` section 7); that rule cannot see the database, so this is the
 * half the application owns. It is a **function, not a schedule** — the cron
 * that calls it arrives with the rest of the scheduled jobs in Phase 8A, and
 * inventing a scheduler here to call one function would be the larger sin.
 */
export async function sweepStalePendingUploads(input: {
  now?: Date;
  limit?: number;
  findStale: (input: {
    olderThan: Date;
    limit: number;
  }) => Promise<readonly { id: string; storageKey: string }[]>;
}): Promise<{ swept: number }> {
  const now = input.now ?? new Date();
  const stale = await input.findStale({
    olderThan: new Date(now.getTime() - PENDING_UPLOAD_TTL_MS),
    limit: input.limit ?? 100,
  });

  for (const file of stale) {
    await storage.delete(file.storageKey).catch(() => undefined);
    await markFileAbandoned(file.id);
  }

  return { swept: stale.length };
}

export const MAX_FILES_PER_REQUEST = MAX_FILES_PER_CONFIGURATION;

/* ---------------------------------------------------------------------------
 * Staff access to a customer's artwork
 * ------------------------------------------------------------------------ */

export type StaffFileView = FileView & { downloadUrl: string };

/**
 * A signed URL for a file attached to a request, through the media boundary.
 *
 * ADR-009 and `SECURITY.md` section 7: the bucket is private, the application
 * never proxies bytes, and **no storage key leaves the server**. The admin
 * workspace therefore does exactly what the builder does — it asks for a
 * short-lived signed URL — and differs only in how the request is authorised:
 * by the request the file is attached to rather than by ownership, because
 * staff are not owners.
 *
 * A staff call is written to the audit log before the URL is issued (12.5).
 * The customer reading their own request's artwork takes the same path and is
 * not logged, because that is the expected case rather than the one the log
 * exists for.
 */
export async function getRequestFileAccess(input: {
  designFileId: string;
  requestId: string;
  actorUserId: string;
  /** 12.5: a staff read is audit-logged; a customer reading their own is not. */
  asStaff: boolean;
}): Promise<FileResult<StaffFileView>> {
  const file = await findFileAttachedToRequest({
    designFileId: input.designFileId,
    requestId: input.requestId,
  });

  if (!file || file.status !== 'READY') {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Fichier introuvable.' } };
  }

  if (input.asStaff) {
    await logDesignFileAccess({
      designFileId: file.id,
      actorUserId: input.actorUserId,
      context: { kind: 'request', id: input.requestId },
      purpose: 'DOWNLOAD',
    });
  }

  const [download, preview] = await Promise.all([
    storage.presignGet({
      key: file.storageKey,
      expiresInSeconds: DOWNLOAD_TTL_SECONDS,
      downloadFilename: file.originalFilename,
    }),
    file.previewKey
      ? storage.presignGet({
          key: file.previewKey,
          expiresInSeconds: DOWNLOAD_TTL_SECONDS,
        })
      : Promise.resolve(null),
  ]);

  return {
    ok: true,
    value: {
      designFileId: file.id,
      status: file.status,
      filename: file.originalFilename,
      contentType: file.mimeType,
      byteSize: file.byteSize,
      widthPx: file.width ?? null,
      heightPx: file.height ?? null,
      previewable: preview !== null,
      previewUrl: preview?.url ?? null,
      downloadUrl: download.url,
    },
  };
}

/**
 * A signed URL for a proof of payment (8.10.2).
 *
 * The same boundary as design-file access, differing only in how the file is
 * reached: through the `order_payment_proofs` row rather than a request. A
 * customer's read is scoped to an order they own; staff read by capability and
 * the access is audit-logged (12.5).
 *
 * As everywhere else, no storage key leaves the server — the caller receives a
 * five-minute signed URL and nothing that would let them construct another.
 */
export async function getPaymentProofAccess(input: {
  proofId: string;
  actorUserId: string;
  asStaff: boolean;
}): Promise<FileResult<StaffFileView>> {
  const file = await findFileForPaymentProof({
    proofId: input.proofId,
    viewerUserId: input.asStaff ? null : input.actorUserId,
  });

  if (!file || file.status !== 'READY') {
    return {
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Justificatif introuvable.' },
    };
  }

  if (input.asStaff) {
    await logDesignFileAccess({
      designFileId: file.id,
      actorUserId: input.actorUserId,
      context: { kind: 'payment_proof', id: input.proofId },
      purpose: 'DOWNLOAD',
    });
  }

  const [download, preview] = await Promise.all([
    storage.presignGet({
      key: file.storageKey,
      expiresInSeconds: DOWNLOAD_TTL_SECONDS,
      downloadFilename: file.originalFilename,
    }),
    file.previewKey
      ? storage.presignGet({
          key: file.previewKey,
          expiresInSeconds: DOWNLOAD_TTL_SECONDS,
        })
      : Promise.resolve(null),
  ]);

  return {
    ok: true,
    value: {
      designFileId: file.id,
      status: file.status,
      filename: file.originalFilename,
      contentType: file.mimeType,
      byteSize: file.byteSize,
      widthPx: file.width ?? null,
      heightPx: file.height ?? null,
      previewable: preview !== null,
      previewUrl: preview?.url ?? null,
      downloadUrl: download.url,
    },
  };
}
