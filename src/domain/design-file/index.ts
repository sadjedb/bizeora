import { err, ok, type Result } from '../result';

/**
 * What makes a design file acceptable.
 *
 * `SECURITY.md` section 6 calls uploads "the highest-risk surface" and gives
 * the rules; this module is those rules as pure functions, so they can be
 * tested against a literal rather than against a bucket.
 *
 * The single idea underneath all of it: **nothing the browser says about a file
 * is evidence.** The filename, the extension and the declared content type are
 * three attacker-controlled strings. They are checked here only to refuse the
 * honest mistake early and cheaply; the answer that counts comes from the
 * bytes, and `detectSignature` below is what reads them.
 */

/* ---------------------------------------------------------------------------
 * The allowlist
 * ------------------------------------------------------------------------ */

/** `SECURITY.md` section 6. A denylist is always incomplete. */
export const ACCEPTED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/svg+xml',
  'application/pdf',
] as const;

export type AcceptedMimeType = (typeof ACCEPTED_MIME_TYPES)[number];

export const ACCEPTED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'svg', 'pdf'] as const;

export type AcceptedExtension = (typeof ACCEPTED_EXTENSIONS)[number];

/** Which extensions may accompany which type. `.jpg` and `.jpeg` are one type. */
const EXTENSIONS_FOR_MIME: Record<AcceptedMimeType, readonly AcceptedExtension[]> = {
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/svg+xml': ['svg'],
  'application/pdf': ['pdf'],
};

/** The extension the server gives a stored object, derived from its real type. */
export const CANONICAL_EXTENSION: Record<AcceptedMimeType, AcceptedExtension> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
};

/** ADR-011: PNG and JPG get a raster preview; SVG and PDF get a file card. */
export function isPreviewableType(mimeType: string): boolean {
  return mimeType === 'image/png' || mimeType === 'image/jpeg';
}

export function isAcceptedMimeType(value: string): value is AcceptedMimeType {
  return (ACCEPTED_MIME_TYPES as readonly string[]).includes(value);
}

/* ---------------------------------------------------------------------------
 * Limits
 * ------------------------------------------------------------------------ */

/** `SECURITY.md` section 6: 25 MB per file. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** 5 files per configuration. */
export const MAX_FILES_PER_CONFIGURATION = 5;
/** 50 MB per request, across all of its files. */
export const MAX_REQUEST_BYTES = 50 * 1024 * 1024;

/**
 * Decompression-bomb defence. A 30 000 × 30 000 PNG is a few hundred kilobytes
 * on the wire and 3.6 GB decoded, so the limit that matters is on the decoded
 * pixels, not on the transferred bytes.
 */
export const MAX_IMAGE_DIMENSION = 12_000;
export const MAX_IMAGE_PIXELS = 40_000_000;

/** PDFs are opaque, but not unboundedly so. */
export const MAX_PDF_PAGES = 20;

/** The generated raster preview's longest edge. */
export const PREVIEW_MAX_EDGE = 640;

/* ---------------------------------------------------------------------------
 * Filenames
 * ------------------------------------------------------------------------ */

export const MAX_FILENAME_LENGTH = 120;

/**
 * The original filename, made safe to **store and display**.
 *
 * It is never a storage key — `SECURITY.md` section 6 is explicit that the key
 * is server-generated — so this is not a path-safety function. It exists
 * because the name is shown back to the customer and to the admin, and a name
 * carrying control characters, a newline or a directory separator is a problem
 * in a log line, a header and a UI alike.
 */
export function sanitiseFilename(raw: string): string {
  const withoutPaths = raw.split(/[\\/]/).pop() ?? '';

  const cleaned = withoutPaths
    // Control characters, including the NUL that truncates C-style strings.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned === '' || cleaned === '.' || cleaned === '..') return 'design';
  return cleaned.slice(0, MAX_FILENAME_LENGTH);
}

/** The extension a filename claims, lowercased and without the dot. */
export function extensionOf(filename: string): string {
  const match = /\.([a-zA-Z0-9]+)$/.exec(filename);
  return match ? match[1]!.toLowerCase() : '';
}

/* ---------------------------------------------------------------------------
 * Magic numbers
 * ------------------------------------------------------------------------ */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

/**
 * The type a file's **bytes** claim, or null when they claim nothing we accept.
 *
 * PNG, JPEG and PDF have real magic numbers. SVG does not — it is XML, so the
 * "signature" is that the leading text parses as an XML document whose root is
 * `<svg>`. A UTF-8 BOM, an XML declaration, comments and a DOCTYPE may all
 * precede it, so this looks for the root element rather than for a fixed
 * prefix. A DOCTYPE is separately fatal (see `inspectSvg`).
 */
export function detectSignature(bytes: Uint8Array): AcceptedMimeType | null {
  if (startsWith(bytes, PNG_SIGNATURE)) return 'image/png';
  if (startsWith(bytes, JPEG_SIGNATURE)) return 'image/jpeg';
  if (startsWith(bytes, PDF_SIGNATURE)) return 'application/pdf';

  const text = new TextDecoder('utf-8', { fatal: false })
    .decode(bytes.subarray(0, 2048))
    .replace(/^\ufeff/, '');

  // Only leading whitespace, an XML declaration, comments or a DOCTYPE may
  // precede the root. Anything else and this is not an SVG document.
  const leading = text
    .replace(/^\s+/, '')
    .replace(/^<\?xml[^>]*\?>/i, '')
    .replace(/^\s+/, '')
    .replace(/^<!DOCTYPE[^>]*>/i, '')
    .replace(/^\s*(?:<!--[\s\S]*?-->\s*)*/, '');

  if (/^<svg[\s>]/i.test(leading)) return 'image/svg+xml';

  return null;
}

/* ---------------------------------------------------------------------------
 * SVG
 * ------------------------------------------------------------------------ */

export type SvgFinding =
  | 'SCRIPT'
  | 'EVENT_HANDLER'
  | 'FOREIGN_OBJECT'
  | 'EXTERNAL_REFERENCE'
  | 'DOCTYPE_OR_ENTITY'
  | 'CSS_IMPORT'
  | 'JAVASCRIPT_URL';

/**
 * Everything hostile an SVG carries, or nothing.
 *
 * `SECURITY.md` section 6 treats SVG as code, because it is: an XML document
 * that can carry scripts, external references and entity expansions.
 *
 * The document describes sanitising on ingest. This **refuses** instead, and
 * ADR-024 records why: V1 never renders an SVG — no preview is generated, and
 * downloads are served as an attachment with `nosniff` — so rewriting buys
 * nothing at render time, a hand-written XML rewriter is more attack surface
 * than a detector, and silently altering a customer's logo is worse for them
 * than being told which construct to remove. The original bytes are stored
 * unchanged or not at all.
 *
 * Deliberately conservative: it works on the raw text, so an encoding trick
 * that hides `<script` from this also hides it from a parser that agrees with
 * this one, and anything it cannot read confidently is a finding rather than a
 * pass.
 */
export function inspectSvg(source: string): readonly SvgFinding[] {
  const findings = new Set<SvgFinding>();
  const text = source.replace(/^\ufeff/, '');

  // XXE and billion-laughs. A DOCTYPE has no legitimate use in an uploaded logo.
  if (/<!DOCTYPE/i.test(text) || /<!ENTITY/i.test(text))
    findings.add('DOCTYPE_OR_ENTITY');

  if (/<\s*script/i.test(text)) findings.add('SCRIPT');
  if (/<\s*foreignObject/i.test(text)) findings.add('FOREIGN_OBJECT');

  // `on…=` handlers. Attribute names are letters only, so this cannot be
  // escaped by inserting a comment inside the name.
  if (/\son[a-z]+\s*=/i.test(text)) findings.add('EVENT_HANDLER');

  if (/javascript\s*:/i.test(text)) findings.add('JAVASCRIPT_URL');
  if (/@import/i.test(text)) findings.add('CSS_IMPORT');

  // Any reference that leaves the document: a remote fetch from a viewer is a
  // tracking beacon at best.
  if (/(?:xlink:)?href\s*=\s*["']?\s*(?:https?:)?\/\//i.test(text)) {
    findings.add('EXTERNAL_REFERENCE');
  }
  // The quote must be consumed before the lookahead, or an empty match for
  // `["']?` puts the lookahead on the quote and every reference looks external.
  // An internal `href="#logo"` is how a real SVG reuses a shape.
  if (/<\s*(?:image|use)[^>]*href\s*=\s*(?:"(?!#)|'(?!#)|(?!["'#]))/i.test(text)) {
    findings.add('EXTERNAL_REFERENCE');
  }

  return [...findings];
}

/* ---------------------------------------------------------------------------
 * Validation
 * ------------------------------------------------------------------------ */

export type UploadIntentError = {
  code:
    | 'UNSUPPORTED_TYPE'
    | 'UNSUPPORTED_EXTENSION'
    | 'TYPE_EXTENSION_MISMATCH'
    | 'FILE_TOO_LARGE'
    | 'FILE_EMPTY';
};

export type UploadIntent = {
  filename: string;
  mimeType: AcceptedMimeType;
  extension: AcceptedExtension;
  byteSize: number;
};

/**
 * What can be checked **before** any bytes exist.
 *
 * This gates the presign, so it decides only whether it is worth issuing an
 * upload URL at all. Passing it proves nothing about the file; the object is
 * re-examined after it lands.
 */
export function validateUploadIntent(input: {
  filename: string;
  contentType: string;
  sizeBytes: number;
}): Result<UploadIntent, UploadIntentError> {
  if (!isAcceptedMimeType(input.contentType)) {
    return err({ code: 'UNSUPPORTED_TYPE' as const });
  }

  const filename = sanitiseFilename(input.filename);
  const extension = extensionOf(filename);

  if (!(ACCEPTED_EXTENSIONS as readonly string[]).includes(extension)) {
    return err({ code: 'UNSUPPORTED_EXTENSION' as const });
  }

  // Agreement, first pass: a `.png` declared as a PDF is refused here rather
  // than after 25 MB have crossed the network.
  if (!EXTENSIONS_FOR_MIME[input.contentType].includes(extension as AcceptedExtension)) {
    return err({ code: 'TYPE_EXTENSION_MISMATCH' as const });
  }

  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    return err({ code: 'FILE_EMPTY' as const });
  }
  if (input.sizeBytes > MAX_FILE_BYTES) return err({ code: 'FILE_TOO_LARGE' as const });

  return ok({
    filename,
    mimeType: input.contentType,
    extension: extension as AcceptedExtension,
    byteSize: input.sizeBytes,
  });
}

export type ContentError = {
  code:
    | 'SIGNATURE_UNRECOGNISED'
    | 'SIGNATURE_MISMATCH'
    | 'FILE_EMPTY'
    | 'FILE_TOO_LARGE'
    | 'IMAGE_TOO_LARGE'
    | 'IMAGE_UNREADABLE'
    | 'SVG_HOSTILE'
    | 'PDF_TOO_LONG';
  detail?: string;
};

/**
 * Agreement between what was declared and what arrived.
 *
 * `SECURITY.md` section 6: "extension, MIME and magic number must all agree, or
 * the file is rejected". A file whose bytes are a PDF, whose name ends `.png`
 * and whose declared type is `image/png` is internally consistent in two of
 * three, and is exactly the file this refuses.
 */
export function verifyContentAgreement(input: {
  declaredMimeType: string;
  extension: string;
  detected: AcceptedMimeType | null;
  byteSize: number;
}): Result<AcceptedMimeType, ContentError> {
  if (input.byteSize <= 0) return err({ code: 'FILE_EMPTY' as const });
  if (input.byteSize > MAX_FILE_BYTES) return err({ code: 'FILE_TOO_LARGE' as const });
  if (input.detected === null) return err({ code: 'SIGNATURE_UNRECOGNISED' as const });

  if (input.detected !== input.declaredMimeType) {
    return err({ code: 'SIGNATURE_MISMATCH' as const, detail: input.detected });
  }

  if (
    !EXTENSIONS_FOR_MIME[input.detected].includes(input.extension as AcceptedExtension)
  ) {
    return err({ code: 'SIGNATURE_MISMATCH' as const, detail: input.detected });
  }

  return ok(input.detected);
}

/** Decoded-pixel limits, applied to what the decoder actually reports. */
export function verifyImageDimensions(input: {
  width: number | null | undefined;
  height: number | null | undefined;
}): Result<{ width: number; height: number }, ContentError> {
  const { width, height } = input;

  if (!width || !height || width < 1 || height < 1) {
    return err({ code: 'IMAGE_UNREADABLE' as const });
  }

  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
    return err({ code: 'IMAGE_TOO_LARGE' as const });
  }

  if (width * height > MAX_IMAGE_PIXELS) return err({ code: 'IMAGE_TOO_LARGE' as const });

  return ok({ width, height });
}

/** French copy. V1 is single-locale. */
export const UPLOAD_ERROR_LABELS: Record<
  UploadIntentError['code'] | ContentError['code'],
  string
> = {
  UNSUPPORTED_TYPE: 'Format non accepté. Utilisez PNG, JPG, SVG ou PDF.',
  UNSUPPORTED_EXTENSION: 'Format non accepté. Utilisez PNG, JPG, SVG ou PDF.',
  TYPE_EXTENSION_MISMATCH: 'Le nom du fichier ne correspond pas à son format.',
  FILE_TOO_LARGE: 'Fichier trop volumineux (25 Mo maximum).',
  FILE_EMPTY: 'Ce fichier est vide.',
  SIGNATURE_UNRECOGNISED: 'Ce fichier n’est pas un PNG, JPG, SVG ou PDF valide.',
  SIGNATURE_MISMATCH: 'Le contenu du fichier ne correspond pas à son format annoncé.',
  IMAGE_TOO_LARGE: 'Cette image est trop grande pour être traitée.',
  IMAGE_UNREADABLE: 'Cette image n’a pas pu être lue.',
  SVG_HOSTILE: 'Ce SVG contient du code (script, référence externe). Exportez-le à plat.',
  PDF_TOO_LONG: 'Ce PDF contient trop de pages.',
};
