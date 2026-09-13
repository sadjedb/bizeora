import {
  ACCEPTED_MIME_TYPES,
  MAX_FILE_BYTES,
  MAX_FILES_PER_CONFIGURATION,
  isPreviewableType as isPreviewableMimeType,
} from '@/domain/design-file';

/**
 * Client-side file pre-checks.
 *
 * `UX.md` section 5: pre-checks give instant feedback, **but the server
 * re-validates everything**. `SECURITY.md` section 6 is blunter — a
 * client-side file check is a convenience and never the boundary, and the
 * declared MIME type is attacker-controlled.
 *
 * So this module is named for what it is. Nothing here is a security control;
 * it exists to save a customer a round trip. The authoritative check reads the
 * stored object's own bytes in `server/services/design-file-service`.
 *
 * Every limit is **re-exported from `domain/design-file`** rather than restated.
 * Phase 7 wrote its own copies and they drifted: the client refused files at
 * 10 MB while `SECURITY.md` section 6 accepted 25 MB, so a customer with a
 * 12 MB scan was told no by a rule the business had never agreed to. A limit
 * that exists twice is a limit that will disagree with itself.
 */

export { MAX_FILE_BYTES };

/** `UX.md` section 5: PNG, JPG, SVG and PDF are accepted. */
export const ACCEPTED_TYPES = ACCEPTED_MIME_TYPES;

export const ACCEPT_ATTRIBUTE = '.png,.jpg,.jpeg,.svg,.pdf';

export const MAX_FILES = MAX_FILES_PER_CONFIGURATION;

/**
 * ADR-011: PNG and JPG get a thumbnail; SVG and PDF get a file card.
 *
 * Not a limitation of their file — SVG is the *best* format to send — so the
 * copy that accompanies this never frames it as a problem.
 */
export function isPreviewableType(contentType: string): boolean {
  return isPreviewableMimeType(contentType);
}

export type FileRejection = { name: string; reason: string };

/**
 * Why a file was refused, in the reader's language.
 *
 * The caller passes its dictionary rather than this module importing one: the
 * rules are the same in every language and only the sentence changes.
 */
export type FileRejectionCopy = {
  fileTypeRejected: string;
  fileTooLarge: string;
  fileEmpty: string;
};

export function checkFile(file: File, copy: FileRejectionCopy): FileRejection | null {
  // `file.type` comes from the browser and is trivially spoofed. It is checked
  // to catch the honest mistake, not the dishonest one.
  if (!(ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
    return { name: file.name, reason: copy.fileTypeRejected };
  }

  if (file.size > MAX_FILE_BYTES) {
    return { name: file.name, reason: copy.fileTooLarge };
  }

  if (file.size === 0) {
    return { name: file.name, reason: copy.fileEmpty };
  }

  return null;
}
