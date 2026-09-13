'use server';

import {
  authoriseUpload,
  discardFile,
  finaliseUpload,
  type FileView,
  type UploadAuthorisation,
} from '@/server/services/design-file-service';
import { ensureCartOwner, readCartOwner } from '@/server/cart/owner';

/**
 * The builder's three upload entry points.
 *
 * They carry **no authority at all**. The client sends a filename, a declared
 * type and a size to ask for permission; it sends a file id to say it has
 * finished. Everything else — the storage key, the owner, whether the bytes
 * are what they claim, whether the file is `READY` — is decided on the server
 * from the object itself.
 *
 * The owner comes from the session or the guest cart cookie, never from the
 * payload. There is no parameter here for an owner, a request, a status or a
 * key, so none of them can be supplied.
 */

export type UploadActionResult<T> =
  { ok: true; value: T } | { ok: false; message: string };

/**
 * Step 1: ask for an upload authorisation.
 *
 * `ensureCartOwner` rather than `readCartOwner`, because this is the moment a
 * visitor earns an identity — the same guest token that will own their cart,
 * so one browser is one guest throughout.
 */
export async function requestUploadAction(input: {
  filename: string;
  contentType: string;
  sizeBytes: number;
}): Promise<UploadActionResult<UploadAuthorisation>> {
  const owner = await ensureCartOwner();
  const result = await authoriseUpload(owner, input);

  if (!result.ok) return { ok: false, message: result.error.message };
  return { ok: true, value: result.value };
}

/**
 * Step 3: the browser reports that the PUT completed.
 *
 * That report is a prompt to look, not a fact to record. The server reads the
 * object and decides.
 */
export async function finaliseUploadAction(input: {
  designFileId: string;
}): Promise<UploadActionResult<FileView>> {
  const owner = await readCartOwner();
  if (!owner) return { ok: false, message: 'Session expirée. Rechargez la page.' };

  const result = await finaliseUpload(owner, input);
  if (!result.ok) return { ok: false, message: result.error.message };

  return { ok: true, value: result.value };
}

/** The customer removed a file before submitting. */
export async function discardUploadAction(input: {
  designFileId: string;
}): Promise<UploadActionResult<{ removed: true }>> {
  const owner = await readCartOwner();
  if (!owner) return { ok: false, message: 'Session expirée. Rechargez la page.' };

  const result = await discardFile(owner, input.designFileId);
  if (!result.ok) return { ok: false, message: result.error.message };

  return { ok: true, value: result.value };
}
