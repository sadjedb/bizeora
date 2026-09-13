/**
 * File validation, at its boundaries.
 *
 * `SECURITY.md` section 6 calls uploads the highest-risk surface, and every
 * rule in it comes down to one idea: **the browser's description of a file is
 * not evidence**. These tests are written from the attacker's side — a PDF
 * called `logo.png`, a filename carrying a path, an SVG carrying a script —
 * because that is the input this code exists for.
 */

import { describe, expect, it } from 'vitest';

import {
  ACCEPTED_EXTENSIONS,
  ACCEPTED_MIME_TYPES,
  CANONICAL_EXTENSION,
  MAX_FILE_BYTES,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  detectSignature,
  extensionOf,
  inspectSvg,
  isPreviewableType,
  sanitiseFilename,
  validateUploadIntent,
  verifyContentAgreement,
  verifyImageDimensions,
} from '../../src/domain/design-file';
import {
  isValidStorageKey,
  newObjectId,
  previewKeyFor,
  promotedKey,
  storageKeyFor,
} from '../../src/lib/storage/keys';

/* ---------------------------------------------------------------------------
 * Magic numbers
 * ------------------------------------------------------------------------ */

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PDF = new Uint8Array([...Buffer.from('%PDF-1.7\n%âãÏÓ', 'latin1')]);
const bytes = (text: string) => new TextEncoder().encode(text);

describe('detectSignature', () => {
  it('recognises each accepted format from its bytes', () => {
    expect(detectSignature(PNG)).toBe('image/png');
    expect(detectSignature(JPEG)).toBe('image/jpeg');
    expect(detectSignature(PDF)).toBe('application/pdf');
    expect(detectSignature(bytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe(
      'image/svg+xml',
    );
  });

  it('recognises an SVG behind a declaration, a comment and whitespace', () => {
    const source = `\n<?xml version="1.0"?>\n<!-- exported -->\n<svg width="10"></svg>`;
    expect(detectSignature(bytes(source))).toBe('image/svg+xml');
  });

  it('recognises an SVG behind a byte-order mark', () => {
    expect(detectSignature(bytes('\ufeff<svg></svg>'))).toBe('image/svg+xml');
  });

  it('refuses anything it does not recognise', () => {
    expect(detectSignature(bytes('GIF89a'))).toBeNull();
    expect(detectSignature(bytes('MZ\u0090'))).toBeNull();
    expect(detectSignature(bytes('#!/bin/sh\nrm -rf /'))).toBeNull();
    expect(detectSignature(bytes('<html><svg></svg></html>'))).toBeNull();
    expect(detectSignature(new Uint8Array(0))).toBeNull();
  });

  it('is not fooled by a magic number that appears later in the file', () => {
    const padded = new Uint8Array([0x00, 0x00, ...PNG]);
    expect(detectSignature(padded)).toBeNull();
  });
});

/* ---------------------------------------------------------------------------
 * Agreement
 * ------------------------------------------------------------------------ */

describe('verifyContentAgreement', () => {
  it('accepts a file whose name, declared type and bytes agree', () => {
    const result = verifyContentAgreement({
      declaredMimeType: 'image/png',
      extension: 'png',
      detected: 'image/png',
      byteSize: 1_000,
    });

    expect(result.ok && result.value).toBe('image/png');
  });

  it('accepts both spellings of a JPEG extension', () => {
    for (const extension of ['jpg', 'jpeg']) {
      const result = verifyContentAgreement({
        declaredMimeType: 'image/jpeg',
        extension,
        detected: 'image/jpeg',
        byteSize: 10,
      });
      expect(result.ok, extension).toBe(true);
    }
  });

  it('refuses a PDF wearing a PNG name and a PNG declaration', () => {
    // The attack the whole check exists for.
    const result = verifyContentAgreement({
      declaredMimeType: 'image/png',
      extension: 'png',
      detected: 'application/pdf',
      byteSize: 1_000,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SIGNATURE_MISMATCH');
  });

  it('refuses bytes that match the declaration but not the extension', () => {
    const result = verifyContentAgreement({
      declaredMimeType: 'image/png',
      extension: 'pdf',
      detected: 'image/png',
      byteSize: 1_000,
    });

    expect(result.ok).toBe(false);
  });

  it('refuses an unrecognised signature outright', () => {
    const result = verifyContentAgreement({
      declaredMimeType: 'image/png',
      extension: 'png',
      detected: null,
      byteSize: 1_000,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SIGNATURE_UNRECOGNISED');
  });

  it('holds the size limit at exactly 25 MB, and refuses an empty file', () => {
    const at = verifyContentAgreement({
      declaredMimeType: 'image/png',
      extension: 'png',
      detected: 'image/png',
      byteSize: MAX_FILE_BYTES,
    });
    expect(at.ok).toBe(true);

    const over = verifyContentAgreement({
      declaredMimeType: 'image/png',
      extension: 'png',
      detected: 'image/png',
      byteSize: MAX_FILE_BYTES + 1,
    });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error.code).toBe('FILE_TOO_LARGE');

    const empty = verifyContentAgreement({
      declaredMimeType: 'image/png',
      extension: 'png',
      detected: 'image/png',
      byteSize: 0,
    });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.code).toBe('FILE_EMPTY');
  });
});

/* ---------------------------------------------------------------------------
 * The intent
 * ------------------------------------------------------------------------ */

describe('validateUploadIntent', () => {
  it('accepts each documented format', () => {
    const cases: [string, string][] = [
      ['logo.png', 'image/png'],
      ['photo.jpg', 'image/jpeg'],
      ['photo.jpeg', 'image/jpeg'],
      ['logo.svg', 'image/svg+xml'],
      ['brief.pdf', 'application/pdf'],
    ];

    for (const [filename, contentType] of cases) {
      const result = validateUploadIntent({ filename, contentType, sizeBytes: 2_048 });
      expect(result.ok, filename).toBe(true);
    }
  });

  it('refuses a type outside the allowlist', () => {
    for (const contentType of ['image/gif', 'text/html', 'application/x-msdownload']) {
      const result = validateUploadIntent({
        filename: 'x.png',
        contentType,
        sizeBytes: 10,
      });
      expect(result.ok, contentType).toBe(false);
    }
  });

  it('refuses a name whose extension contradicts the declared type', () => {
    const result = validateUploadIntent({
      filename: 'payload.pdf',
      contentType: 'image/png',
      sizeBytes: 10,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('TYPE_EXTENSION_MISMATCH');
  });

  it('refuses a double extension that hides an executable', () => {
    const result = validateUploadIntent({
      filename: 'logo.png.exe',
      contentType: 'image/png',
      sizeBytes: 10,
    });

    expect(result.ok).toBe(false);
  });

  it('refuses an empty or oversized file before issuing an upload URL', () => {
    expect(
      validateUploadIntent({ filename: 'a.png', contentType: 'image/png', sizeBytes: 0 })
        .ok,
    ).toBe(false);

    expect(
      validateUploadIntent({
        filename: 'a.png',
        contentType: 'image/png',
        sizeBytes: MAX_FILE_BYTES + 1,
      }).ok,
    ).toBe(false);
  });
});

/* ---------------------------------------------------------------------------
 * Filenames
 * ------------------------------------------------------------------------ */

describe('sanitiseFilename', () => {
  it('keeps only the final path segment', () => {
    expect(sanitiseFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitiseFilename('C:\\Users\\amina\\logo.png')).toBe('logo.png');
    expect(sanitiseFilename('/var/www/logo.png')).toBe('logo.png');
  });

  it('strips control characters, including a NUL', () => {
    expect(sanitiseFilename('lo\u0000go\u001b.png')).toBe('logo.png');
    // A newline is a control character, so it is removed rather than collapsed
    // to a space — the two rules apply in that order.
    expect(sanitiseFilename('logo\n.png')).toBe('logo.png');
    expect(sanitiseFilename('logo  spaced.png')).toBe('logo spaced.png');
  });

  it('never returns an empty or dot-only name', () => {
    expect(sanitiseFilename('')).toBe('design');
    expect(sanitiseFilename('.')).toBe('design');
    expect(sanitiseFilename('..')).toBe('design');
    expect(sanitiseFilename('   ')).toBe('design');
  });

  it('truncates a name long enough to be a denial of service', () => {
    expect(sanitiseFilename('a'.repeat(5_000)).length).toBeLessThanOrEqual(120);
  });

  it('reads the extension case-insensitively', () => {
    expect(extensionOf('LOGO.PNG')).toBe('png');
    expect(extensionOf('no-extension')).toBe('');
    expect(extensionOf('archive.tar.gz')).toBe('gz');
  });
});

/* ---------------------------------------------------------------------------
 * Storage keys
 * ------------------------------------------------------------------------ */

describe('storage keys', () => {
  it('never contains anything the customer supplied', () => {
    const key = storageKeyFor({
      prefix: 'quarantine',
      objectId: newObjectId(),
      extension: 'png',
    });

    expect(key).toMatch(/^quarantine\/[0-9a-f-]{36}\.png$/);
    expect(isValidStorageKey(key)).toBe(true);
  });

  it('cannot be made to traverse', () => {
    const key = storageKeyFor({
      prefix: 'designs',
      objectId: newObjectId(),
      // Even if a caller passed this, it cannot survive the allowlist.
      extension: '../../../etc/passwd',
    });

    expect(key).not.toContain('..');
    expect(key).not.toContain('/etc/');
    expect(isValidStorageKey(key)).toBe(true);
  });

  it('refuses a key it did not generate', () => {
    expect(isValidStorageKey('quarantine/../../../etc/passwd')).toBe(false);
    expect(isValidStorageKey('designs/logo.png')).toBe(false);
    expect(isValidStorageKey('/etc/passwd')).toBe(false);
    expect(isValidStorageKey('secrets/key.pem')).toBe(false);
  });

  it('is unpredictable', () => {
    const keys = new Set(
      Array.from({ length: 200 }, () =>
        storageKeyFor({
          prefix: 'quarantine',
          objectId: newObjectId(),
          extension: 'png',
        }),
      ),
    );

    expect(keys.size).toBe(200);
  });

  it('keeps the same identity through promotion', () => {
    const objectId = newObjectId();
    const quarantine = storageKeyFor({
      prefix: 'quarantine',
      objectId,
      extension: 'png',
    });

    expect(promotedKey(quarantine)).toBe(`designs/${objectId}.png`);
    expect(previewKeyFor(objectId)).toBe(`previews/${objectId}.jpg`);
  });
});

/* ---------------------------------------------------------------------------
 * SVG
 * ------------------------------------------------------------------------ */

describe('inspectSvg', () => {
  it('passes an ordinary exported logo', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
      '<path d="M0 0h24v24H0z" fill="#12100e"/><circle cx="12" cy="12" r="4"/></svg>';

    expect(inspectSvg(svg)).toEqual([]);
  });

  it('finds a script element', () => {
    expect(inspectSvg('<svg><script>alert(1)</script></svg>')).toContain('SCRIPT');
    // Whitespace inside the tag does not hide it.
    expect(inspectSvg('<svg><  script >alert(1)</script></svg>')).toContain('SCRIPT');
  });

  it('finds an event handler', () => {
    expect(inspectSvg('<svg onload="alert(1)"></svg>')).toContain('EVENT_HANDLER');
    expect(inspectSvg('<svg><circle onmouseover="fetch(1)"/></svg>')).toContain(
      'EVENT_HANDLER',
    );
  });

  it('finds a foreignObject, which can carry arbitrary HTML', () => {
    expect(inspectSvg('<svg><foreignObject><iframe/></foreignObject></svg>')).toContain(
      'FOREIGN_OBJECT',
    );
  });

  it('finds a DOCTYPE or entity — XXE and billion laughs', () => {
    const xxe =
      '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg>&xxe;</svg>';

    expect(inspectSvg(xxe)).toContain('DOCTYPE_OR_ENTITY');
  });

  it('finds an external reference', () => {
    expect(inspectSvg('<svg><image href="https://evil.test/x.png"/></svg>')).toContain(
      'EXTERNAL_REFERENCE',
    );
    expect(inspectSvg('<svg><use xlink:href="//evil.test/x#a"/></svg>')).toContain(
      'EXTERNAL_REFERENCE',
    );
  });

  it('finds a javascript: URL and a CSS import', () => {
    expect(inspectSvg('<svg><a href="javascript:alert(1)">x</a></svg>')).toContain(
      'JAVASCRIPT_URL',
    );
    expect(inspectSvg('<svg><style>@import url(//evil.test)</style></svg>')).toContain(
      'CSS_IMPORT',
    );
  });

  it('allows an internal reference, which is how a real SVG reuses a shape', () => {
    expect(
      inspectSvg('<svg><use href="#logo"/><path id="logo" d="M0 0"/></svg>'),
    ).toEqual([]);
  });
});

/* ---------------------------------------------------------------------------
 * Images
 * ------------------------------------------------------------------------ */

describe('verifyImageDimensions', () => {
  it('accepts ordinary artwork', () => {
    expect(verifyImageDimensions({ width: 2_000, height: 1_400 }).ok).toBe(true);
  });

  it('refuses a decompression bomb by edge and by area', () => {
    const wide = verifyImageDimensions({ width: MAX_IMAGE_DIMENSION + 1, height: 10 });
    expect(wide.ok).toBe(false);
    if (!wide.ok) expect(wide.error.code).toBe('IMAGE_TOO_LARGE');

    // Inside both edges, far outside the pixel budget.
    const area = Math.ceil(MAX_IMAGE_PIXELS / MAX_IMAGE_DIMENSION) + 100;
    const huge = verifyImageDimensions({ width: MAX_IMAGE_DIMENSION, height: area });
    expect(huge.ok).toBe(false);
  });

  it('refuses an image the decoder could not measure', () => {
    expect(verifyImageDimensions({ width: null, height: null }).ok).toBe(false);
    expect(verifyImageDimensions({ width: 0, height: 100 }).ok).toBe(false);
    expect(verifyImageDimensions({ width: undefined, height: undefined }).ok).toBe(false);
  });
});

describe('the format allowlist', () => {
  it('previews raster only — ADR-011', () => {
    expect(isPreviewableType('image/png')).toBe(true);
    expect(isPreviewableType('image/jpeg')).toBe(true);
    expect(isPreviewableType('image/svg+xml')).toBe(false);
    expect(isPreviewableType('application/pdf')).toBe(false);
  });

  it('has not grown', () => {
    // Widening it is a documented decision, not a passing edit.
    expect([...ACCEPTED_MIME_TYPES]).toEqual([
      'image/png',
      'image/jpeg',
      'image/svg+xml',
      'application/pdf',
    ]);
    expect([...ACCEPTED_EXTENSIONS]).toEqual(['png', 'jpg', 'jpeg', 'svg', 'pdf']);
  });

  it('gives every accepted type one canonical stored extension', () => {
    expect(CANONICAL_EXTENSION['image/jpeg']).toBe('jpg');
    for (const mime of ACCEPTED_MIME_TYPES) {
      expect(ACCEPTED_EXTENSIONS).toContain(CANONICAL_EXTENSION[mime]);
    }
  });
});
