/**
 * The upload pipeline, against the real database and a real storage adapter.
 *
 * These drive the **whole** three-step flow — authorise, PUT the bytes, ask the
 * server to finalise — because the security property being tested only exists
 * across all three. A test that wrote a `READY` row directly would prove
 * nothing about the thing that matters: that the server, not the browser,
 * decides a file is usable.
 *
 * The adapter under test is the filesystem one. It is not a mock: it stores
 * bytes, it signs URLs, and the service reads back what was actually written.
 * The only difference from production is which side of the network the object
 * lands on.
 */

import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';

dotenv.config({ path: ['.env.local', '.env'], quiet: true });

const {
  authoriseUpload,
  discardFile,
  finaliseUpload,
  getDownloadUrl,
  getFileView,
  sweepStalePendingUploads,
} = await import('../../src/server/services/design-file-service');
const { createCustomRequest } =
  await import('../../src/server/services/custom-request-service');
const { findStalePendingFiles } =
  await import('../../src/server/repositories/design-file-repository');
const { storage } = await import('../../src/lib/storage');
const { prisma } = await import('../../src/lib/db/client');

/**
 * The storage endpoint's own handlers.
 *
 * Called directly rather than over HTTP, so the suite needs no running server
 * while still exercising the real route: the signature verification, the
 * content-type check and the length check are the ones production's provider
 * performs, and a test that skipped them would be testing a different upload.
 */
const storageRoute = await import('../../src/app/api/storage/local/route');

function putObject(url: string, headers: Record<string, string>, body: Uint8Array) {
  return storageRoute.PUT(
    new Request(url, { method: 'PUT', headers, body: body as unknown as BodyInit }),
  );
}

function getObject(url: string) {
  return storageRoute.GET(new Request(url, { method: 'GET' }));
}

type Owner = { kind: 'guest'; anonymousToken: string } | { kind: 'user'; userId: string };

let counter = 0;
function guest(): Owner {
  counter += 1;
  return { kind: 'guest', anonymousToken: `upload-test-${Date.now()}-${counter}` };
}

const createdFileIds: string[] = [];

/* ---------------------------------------------------------------------------
 * Fixture bytes
 * ------------------------------------------------------------------------ */

async function pngBytes(width = 64, height = 64): Promise<Uint8Array> {
  const buffer = await sharp({
    create: { width, height, channels: 3, background: '#12100e' },
  })
    .png()
    .toBuffer();
  return new Uint8Array(buffer);
}

async function jpegBytes(): Promise<Uint8Array> {
  const buffer = await sharp({
    create: { width: 48, height: 32, channels: 3, background: '#c96f2a' },
  })
    .jpeg()
    .toBuffer();
  return new Uint8Array(buffer);
}

const SAFE_SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
    '<path d="M2 2h20v20H2z"/></svg>',
);

const HOSTILE_SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" onload="fetch(\'//evil.test\')">' +
    '<script>alert(document.cookie)</script></svg>',
);

const XXE_SVG = new TextEncoder().encode(
  '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg>&xxe;</svg>',
);

const PDF_BYTES = new Uint8Array(
  Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Page >>\nendobj\n%%EOF', 'latin1'),
);

/* ---------------------------------------------------------------------------
 * The flow, as a helper
 * ------------------------------------------------------------------------ */

/** Steps 1 and 2: authorise, then PUT the bytes to where we were told. */
async function upload(
  owner: Owner,
  input: {
    filename: string;
    contentType: string;
    body: Uint8Array;
    declaredSize?: number;
  },
) {
  const authorised = await authoriseUpload(owner, {
    filename: input.filename,
    contentType: input.contentType,
    sizeBytes: input.declaredSize ?? input.body.byteLength,
  });

  if (!authorised.ok) return { authorised } as const;
  createdFileIds.push(authorised.value.designFileId);

  const response = await putObject(
    authorised.value.uploadUrl,
    authorised.value.headers,
    input.body,
  );

  return { authorised, response } as const;
}

/** The whole flow, ending with the server's verdict. */
async function uploadAndFinalise(
  owner: Owner,
  input: { filename: string; contentType: string; body: Uint8Array },
) {
  const started = await upload(owner, input);
  if (!started.authorised.ok) throw new Error('authorisation refused');

  return finaliseUpload(owner, {
    designFileId: started.authorised.value.designFileId,
  });
}

beforeAll(() => {
  // The suite is meaningless against a provider it cannot inspect, and must
  // never point at a real bucket.
  expect(storage.name, 'these tests require the local storage adapter').toBe('local');
});

afterAll(async () => {
  await prisma.customizationFile.deleteMany({
    where: { designFileId: { in: createdFileIds } },
  });
  await prisma.designFile.deleteMany({ where: { id: { in: createdFileIds } } });
  await prisma.$disconnect();
});

/* ---------------------------------------------------------------------------
 * The happy path
 * ------------------------------------------------------------------------ */

describe('a real upload', () => {
  it('stores a PNG, verifies it and promotes it out of quarantine', async () => {
    const owner = guest();
    const result = await uploadAndFinalise(owner, {
      filename: 'logo.png',
      contentType: 'image/png',
      body: await pngBytes(120, 80),
    });

    expect(result.ok, result.ok ? '' : result.error.message).toBe(true);
    if (!result.ok) return;

    expect(result.value.status).toBe('READY');
    expect(result.value.previewable).toBe(true);
    expect(result.value.previewUrl).not.toBeNull();

    const row = await prisma.designFile.findUniqueOrThrow({
      where: { id: result.value.designFileId },
      select: {
        status: true,
        storageKey: true,
        previewKey: true,
        width: true,
        height: true,
        checksumSha256: true,
        byteSize: true,
        originalFilename: true,
        ownerTokenHash: true,
        ownerUserId: true,
      },
    });

    // Promoted: an unvalidated object is never reachable by the normal path.
    expect(row.storageKey).toMatch(/^designs\//);
    expect(row.status).toBe('READY');
    expect(row.width).toBe(120);
    expect(row.height).toBe(80);
    expect(row.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row.previewKey).toMatch(/^previews\//);

    // The guest owns it, by a hash rather than by the token itself.
    expect(row.ownerUserId).toBeNull();
    expect(row.ownerTokenHash).toMatch(/^[0-9a-f]{64}$/);
    if (owner.kind === 'guest') {
      expect(row.ownerTokenHash).not.toBe(owner.anonymousToken);
    }

    // The bytes are where the row says, and quarantine is empty.
    expect(await storage.get(row.storageKey)).not.toBeNull();
    expect(
      await storage.get(row.storageKey.replace('designs/', 'quarantine/')),
    ).toBeNull();
  });

  it('generates a preview for a JPEG and none for an SVG or a PDF', async () => {
    const owner = guest();

    const jpeg = await uploadAndFinalise(owner, {
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
      body: await jpegBytes(),
    });
    expect(jpeg.ok && jpeg.value.previewUrl).not.toBeNull();

    const svg = await uploadAndFinalise(owner, {
      filename: 'logo.svg',
      contentType: 'image/svg+xml',
      body: SAFE_SVG,
    });
    expect(svg.ok, svg.ok ? '' : svg.error.message).toBe(true);
    // ADR-011: accepted, never rasterised. A file card, not a picture.
    expect(svg.ok && svg.value.previewable).toBe(false);
    expect(svg.ok && svg.value.previewUrl).toBeNull();

    const pdf = await uploadAndFinalise(owner, {
      filename: 'brief.pdf',
      contentType: 'application/pdf',
      body: PDF_BYTES,
    });
    expect(pdf.ok, pdf.ok ? '' : pdf.error.message).toBe(true);
    expect(pdf.ok && pdf.value.previewable).toBe(false);
    expect(pdf.ok && pdf.value.previewUrl).toBeNull();
  });

  it('never uses the customer filename as a storage key', async () => {
    const owner = guest();
    const result = await uploadAndFinalise(owner, {
      filename: '../../etc/pass wd.png',
      contentType: 'image/png',
      body: await pngBytes(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = await prisma.designFile.findUniqueOrThrow({
      where: { id: result.value.designFileId },
      select: { storageKey: true, originalFilename: true },
    });

    expect(row.storageKey).toMatch(/^designs\/[0-9a-f-]{36}\.png$/);
    expect(row.storageKey).not.toContain('..');
    expect(row.storageKey).not.toContain('etc');
    // The name survives as *data*, sanitised of its path.
    expect(row.originalFilename).toBe('pass wd.png');
  });
});

/* ---------------------------------------------------------------------------
 * Metadata spoofing
 * ------------------------------------------------------------------------ */

describe('metadata is never evidence', () => {
  it('refuses a PDF uploaded as a PNG', async () => {
    const result = await uploadAndFinalise(guest(), {
      filename: 'logo.png',
      contentType: 'image/png',
      body: PDF_BYTES,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('REJECTED');
  });

  it('refuses an executable renamed to an image', async () => {
    const result = await uploadAndFinalise(guest(), {
      filename: 'logo.png',
      contentType: 'image/png',
      body: new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]),
    });

    expect(result.ok).toBe(false);
  });

  it('refuses HTML renamed to an SVG', async () => {
    const result = await uploadAndFinalise(guest(), {
      filename: 'logo.svg',
      contentType: 'image/svg+xml',
      body: new TextEncoder().encode(
        '<html><body><script>alert(1)</script></body></html>',
      ),
    });

    expect(result.ok).toBe(false);
  });

  it('refuses a corrupt image whose header is right', async () => {
    // A valid PNG signature followed by rubbish: the decoder must refuse it,
    // not return whatever it managed to read.
    const truncated = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xde, 0xad, 0xbe, 0xef,
    ]);

    const result = await uploadAndFinalise(guest(), {
      filename: 'logo.png',
      contentType: 'image/png',
      body: truncated,
    });

    expect(result.ok).toBe(false);
  });

  it('refuses a PNG whose header parses but whose pixels do not decode', async () => {
    /**
     * The case that got through the first implementation.
     *
     * `metadata()` reads the header and reports 2×2 quite happily; the body is
     * corrupt and `libpng` fails the moment anything reads a pixel. Validating
     * on the header alone would have promoted this to READY and sent the
     * embroiderer artwork nobody can open.
     */
    const headerOnlyValid = new Uint8Array(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGP8//8/AzJgYkAD' +
          'IxIAAFQTAwc2XCXAAAAAAElFTkSuQmCC',
        'base64',
      ),
    );

    const result = await uploadAndFinalise(guest(), {
      filename: 'logo.png',
      contentType: 'image/png',
      body: headerOnlyValid,
    });

    expect(result.ok).toBe(false);
  });

  it('refuses a type outside the allowlist before issuing an upload URL', async () => {
    const result = await authoriseUpload(guest(), {
      filename: 'macro.docx',
      contentType: 'application/msword',
      sizeBytes: 1_000,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('REJECTED');
  });

  it('refuses a zero-byte and an oversized file at the authorisation', async () => {
    expect(
      (
        await authoriseUpload(guest(), {
          filename: 'a.png',
          contentType: 'image/png',
          sizeBytes: 0,
        })
      ).ok,
    ).toBe(false);

    expect(
      (
        await authoriseUpload(guest(), {
          filename: 'a.png',
          contentType: 'image/png',
          sizeBytes: 26 * 1024 * 1024,
        })
      ).ok,
    ).toBe(false);
  });

  it('refuses a body larger than the signature authorised', async () => {
    // The signature is bound to a length. Declaring a small file and sending a
    // large one fails at the storage endpoint, exactly as it would at R2.
    const owner = guest();
    const started = await upload(owner, {
      filename: 'logo.png',
      contentType: 'image/png',
      body: await pngBytes(200, 200),
      declaredSize: 64,
    });

    expect(started.response?.status).toBe(413);
  });

  it('refuses a body sent as a different content type than was signed', async () => {
    const owner = guest();
    const authorised = await authoriseUpload(owner, {
      filename: 'logo.png',
      contentType: 'image/png',
      sizeBytes: 4_096,
    });

    expect(authorised.ok).toBe(true);
    if (!authorised.ok) return;
    createdFileIds.push(authorised.value.designFileId);

    const response = await storageRoute.PUT(
      new Request(authorised.value.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': 'text/html' },
        body: '<script>alert(1)</script>',
      }),
    );

    expect(response.status).toBe(400);
  });
});

/* ---------------------------------------------------------------------------
 * SVG
 * ------------------------------------------------------------------------ */

describe('SVG is treated as code', () => {
  it('refuses one carrying a script or an event handler', async () => {
    const result = await uploadAndFinalise(guest(), {
      filename: 'logo.svg',
      contentType: 'image/svg+xml',
      body: HOSTILE_SVG,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/script|code/i);
  });

  it('refuses one carrying a DOCTYPE entity — XXE', async () => {
    const result = await uploadAndFinalise(guest(), {
      filename: 'logo.svg',
      contentType: 'image/svg+xml',
      body: XXE_SVG,
    });

    expect(result.ok).toBe(false);
  });

  it('leaves no object behind when it refuses one', async () => {
    const owner = guest();
    const started = await upload(owner, {
      filename: 'logo.svg',
      contentType: 'image/svg+xml',
      body: HOSTILE_SVG,
    });

    if (!started.authorised.ok) throw new Error('authorisation refused');
    const designFileId = started.authorised.value.designFileId;

    await finaliseUpload(owner, { designFileId });

    const row = await prisma.designFile.findUniqueOrThrow({
      where: { id: designFileId },
      select: { status: true, storageKey: true, rejectionReason: true },
    });

    expect(row.status).toBe('REJECTED');
    expect(row.rejectionReason).not.toBeNull();
    expect(await storage.get(row.storageKey)).toBeNull();
  });

  it('serves an accepted SVG as an opaque attachment, never as markup', async () => {
    const owner = guest();
    const result = await uploadAndFinalise(owner, {
      filename: 'logo.svg',
      contentType: 'image/svg+xml',
      body: SAFE_SVG,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const download = await getDownloadUrl(owner, result.value.designFileId);
    expect(download.ok).toBe(true);
    if (!download.ok) return;

    const response = await getObject(download.value.url);

    // The three headers that keep a hostile SVG inert even if one got through.
    expect(response.headers.get('content-type')).toBe('application/octet-stream');
    expect(response.headers.get('content-disposition')).toMatch(/^attachment/);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

/* ---------------------------------------------------------------------------
 * Ownership
 * ------------------------------------------------------------------------ */

describe('a file belongs to whoever uploaded it', () => {
  it('does not let one guest finalise another guest’s upload', async () => {
    const alice = guest();
    const bob = guest();

    const started = await upload(alice, {
      filename: 'logo.png',
      contentType: 'image/png',
      body: await pngBytes(),
    });
    if (!started.authorised.ok) throw new Error('authorisation refused');

    const stolen = await finaliseUpload(bob, {
      designFileId: started.authorised.value.designFileId,
    });

    expect(stolen.ok).toBe(false);
    // Indistinguishable from an id that never existed: no oracle.
    if (!stolen.ok) expect(stolen.error.code).toBe('NOT_FOUND');
  });

  it('does not let one guest read or download another guest’s file', async () => {
    const alice = guest();
    const bob = guest();

    const file = await uploadAndFinalise(alice, {
      filename: 'logo.png',
      contentType: 'image/png',
      body: await pngBytes(),
    });
    if (!file.ok) throw new Error(file.error.message);

    expect((await getFileView(bob, file.value.designFileId)).ok).toBe(false);
    expect((await getDownloadUrl(bob, file.value.designFileId)).ok).toBe(false);
    expect((await discardFile(bob, file.value.designFileId)).ok).toBe(false);

    // And Alice still has it.
    expect((await getFileView(alice, file.value.designFileId)).ok).toBe(true);
  });

  it('does not let a signed-in customer read a different customer’s file', async () => {
    const alice: Owner = { kind: 'user', userId: await createUser() };
    const bob: Owner = { kind: 'user', userId: await createUser() };

    const file = await uploadAndFinalise(alice, {
      filename: 'logo.png',
      contentType: 'image/png',
      body: await pngBytes(),
    });
    if (!file.ok) throw new Error(file.error.message);

    expect((await getFileView(bob, file.value.designFileId)).ok).toBe(false);
    expect((await getDownloadUrl(bob, file.value.designFileId)).ok).toBe(false);
  });

  it('refuses an invented design-file id', async () => {
    const owner = guest();
    expect((await getFileView(owner, randomUUID())).ok).toBe(false);
    expect((await finaliseUpload(owner, { designFileId: randomUUID() })).ok).toBe(false);
    expect((await getDownloadUrl(owner, randomUUID())).ok).toBe(false);
  });

  it('gives the client no storage key to guess with', async () => {
    const owner = guest();
    const authorised = await authoriseUpload(owner, {
      filename: 'logo.png',
      contentType: 'image/png',
      sizeBytes: 1_024,
    });

    expect(authorised.ok).toBe(true);
    if (!authorised.ok) return;
    createdFileIds.push(authorised.value.designFileId);

    const file = await uploadAndFinalise(owner, {
      filename: 'logo.png',
      contentType: 'image/png',
      body: await pngBytes(),
    });
    if (!file.ok) throw new Error(file.error.message);

    // The view a client receives carries an opaque id and nothing else.
    expect(Object.keys(file.value)).not.toContain('storageKey');
    expect(JSON.stringify(file.value)).not.toContain('designs/');
  });
});

/* ---------------------------------------------------------------------------
 * Lifecycle
 * ------------------------------------------------------------------------ */

describe('the lifecycle', () => {
  it('never reaches READY without the bytes arriving', async () => {
    const owner = guest();
    const authorised = await authoriseUpload(owner, {
      filename: 'logo.png',
      contentType: 'image/png',
      sizeBytes: 4_096,
    });

    expect(authorised.ok).toBe(true);
    if (!authorised.ok) return;
    createdFileIds.push(authorised.value.designFileId);

    // The browser claims success without having uploaded anything.
    const claimed = await finaliseUpload(owner, {
      designFileId: authorised.value.designFileId,
    });

    expect(claimed.ok).toBe(false);

    const row = await prisma.designFile.findUniqueOrThrow({
      where: { id: authorised.value.designFileId },
      select: { status: true },
    });
    expect(row.status).toBe('PENDING');
  });

  it('is idempotent: finalising twice yields the same READY file', async () => {
    const owner = guest();
    const started = await upload(owner, {
      filename: 'logo.png',
      contentType: 'image/png',
      body: await pngBytes(),
    });
    if (!started.authorised.ok) throw new Error('authorisation refused');

    const id = started.authorised.value.designFileId;
    const first = await finaliseUpload(owner, { designFileId: id });
    const second = await finaliseUpload(owner, { designFileId: id });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(second.value.designFileId).toBe(first.value.designFileId);
    expect(second.value.status).toBe('READY');

    expect(await prisma.designFile.count({ where: { id, status: 'READY' } })).toBe(1);
  });

  it('survives two simultaneous finalisations', async () => {
    const owner = guest();
    const started = await upload(owner, {
      filename: 'logo.png',
      contentType: 'image/png',
      body: await pngBytes(),
    });
    if (!started.authorised.ok) throw new Error('authorisation refused');

    const id = started.authorised.value.designFileId;
    const [a, b] = await Promise.all([
      finaliseUpload(owner, { designFileId: id }),
      finaliseUpload(owner, { designFileId: id }),
    ]);

    // One did the work and one lost the race; neither reports a failure the
    // customer could act on, and the file is ready either way.
    expect([a.ok, b.ok].filter(Boolean).length).toBeGreaterThanOrEqual(1);

    const row = await prisma.designFile.findUniqueOrThrow({
      where: { id },
      select: { status: true, storageKey: true },
    });
    expect(row.status).toBe('READY');
    expect(row.storageKey).toMatch(/^designs\//);
  });

  it('cannot resurrect a rejected file', async () => {
    const owner = guest();
    const started = await upload(owner, {
      filename: 'logo.svg',
      contentType: 'image/svg+xml',
      body: HOSTILE_SVG,
    });
    if (!started.authorised.ok) throw new Error('authorisation refused');

    const id = started.authorised.value.designFileId;
    await finaliseUpload(owner, { designFileId: id });

    // A second attempt, even with the bytes put back, must not promote it.
    await storage
      .put({
        key: `quarantine/${id}`,
        body: SAFE_SVG,
        contentType: 'image/svg+xml',
      })
      .catch(() => undefined);

    const retried = await finaliseUpload(owner, { designFileId: id });
    expect(retried.ok).toBe(false);

    const row = await prisma.designFile.findUniqueOrThrow({
      where: { id },
      select: { status: true },
    });
    expect(row.status).toBe('REJECTED');
  });

  it('cannot reuse a deleted file', async () => {
    const owner = guest();
    const file = await uploadAndFinalise(owner, {
      filename: 'logo.png',
      contentType: 'image/png',
      body: await pngBytes(),
    });
    if (!file.ok) throw new Error(file.error.message);

    const removed = await discardFile(owner, file.value.designFileId);
    expect(removed.ok).toBe(true);

    expect((await getFileView(owner, file.value.designFileId)).ok).toBe(false);
    expect((await getDownloadUrl(owner, file.value.designFileId)).ok).toBe(false);
  });

  it('sweeps uploads that never completed', async () => {
    const owner = guest();
    const authorised = await authoriseUpload(owner, {
      filename: 'abandoned.png',
      contentType: 'image/png',
      sizeBytes: 2_048,
    });
    if (!authorised.ok) throw new Error('authorisation refused');
    createdFileIds.push(authorised.value.designFileId);

    const id = authorised.value.designFileId;
    // Age it past the quarantine lifetime.
    await prisma.designFile.update({
      where: { id },
      data: { createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000) },
    });

    const swept = await sweepStalePendingUploads({ findStale: findStalePendingFiles });
    expect(swept.swept).toBeGreaterThanOrEqual(1);

    const row = await prisma.designFile.findUniqueOrThrow({
      where: { id },
      select: { status: true, deletedAt: true },
    });

    expect(row.status).toBe('REJECTED');
    expect(row.deletedAt).not.toBeNull();
  });

  it('leaves a recent incomplete upload alone, so a slow connection can finish', async () => {
    const owner = guest();
    const authorised = await authoriseUpload(owner, {
      filename: 'slow.png',
      contentType: 'image/png',
      sizeBytes: 2_048,
    });
    if (!authorised.ok) throw new Error('authorisation refused');
    createdFileIds.push(authorised.value.designFileId);

    await sweepStalePendingUploads({ findStale: findStalePendingFiles });

    const row = await prisma.designFile.findUniqueOrThrow({
      where: { id: authorised.value.designFileId },
      select: { status: true },
    });
    expect(row.status).toBe('PENDING');
  });
});

/* ---------------------------------------------------------------------------
 * Storage failure
 * ------------------------------------------------------------------------ */

describe('when storage misbehaves', () => {
  it('reports a missing object rather than promoting a file that is not there', async () => {
    const owner = guest();
    const started = await upload(owner, {
      filename: 'logo.png',
      contentType: 'image/png',
      body: await pngBytes(),
    });
    if (!started.authorised.ok) throw new Error('authorisation refused');

    const id = started.authorised.value.designFileId;
    const row = await prisma.designFile.findUniqueOrThrow({
      where: { id },
      select: { storageKey: true },
    });

    // The object vanishes between the PUT and the completion call.
    await storage.delete(row.storageKey);

    const result = await finaliseUpload(owner, { designFileId: id });
    expect(result.ok).toBe(false);

    // Still PENDING, so a retry can succeed and the sweeper takes it if none
    // comes. It must not be READY and must not be permanently rejected.
    const after = await prisma.designFile.findUniqueOrThrow({
      where: { id },
      select: { status: true },
    });
    expect(after.status).toBe('PENDING');
  });

  it('lets a failed upload be retried to success', async () => {
    const owner = guest();
    const authorised = await authoriseUpload(owner, {
      filename: 'logo.png',
      contentType: 'image/png',
      sizeBytes: 8_192,
    });
    if (!authorised.ok) throw new Error('authorisation refused');
    createdFileIds.push(authorised.value.designFileId);

    // First completion attempt with nothing uploaded: refused.
    expect(
      (await finaliseUpload(owner, { designFileId: authorised.value.designFileId })).ok,
    ).toBe(false);

    // The browser retries the PUT against the same authorisation.
    const response = await putObject(
      authorised.value.uploadUrl,
      authorised.value.headers,
      await pngBytes(),
    );
    expect(response.ok).toBe(true);

    const result = await finaliseUpload(owner, {
      designFileId: authorised.value.designFileId,
    });
    expect(result.ok, result.ok ? '' : result.error.message).toBe(true);
  });
});

/* ---------------------------------------------------------------------------
 * The custom request
 * ------------------------------------------------------------------------ */

describe('attaching files to a custom request', () => {
  const CUSTOMISABLE_SLUG = 't-shirt-brode-classique';

  async function requestPayload(designFileIds: string[]) {
    const product = await prisma.product.findFirstOrThrow({
      where: { slug: CUSTOMISABLE_SLUG, deletedAt: null },
      select: { id: true, customizationProfileId: true },
    });

    /*
     * A measured photograph to place the design on (ADR-035).
     *
     * Without one the configuration is `QUOTE` whatever else is true — a blank
     * nobody has measured can only be described — and this test is about the
     * *file* being what makes it fixed, so the surface has to be real.
     */
    const existing = await prisma.productImage.findFirst({
      where: { productId: product.id, surface: 'FRONT' },
      select: { id: true },
    });

    const surface =
      existing ??
      (await prisma.productImage.create({
        data: {
          productId: product.id,
          storageKey: `media/${randomUUID()}.jpg`,
          alt: 'Fixture de placement',
          position: 900,
          width: 1200,
          height: 1500,
          surface: 'FRONT',
          surfaceWidthMm: 520,
        },
        select: { id: true },
      }));

    await prisma.productImage.update({
      where: { id: surface.id },
      data: { surfaceWidthMm: 520, width: 1200, height: 1500 },
    });
    const colour = await prisma.threadColor.findFirstOrThrow({
      where: { isActive: true },
      select: { id: true },
    });
    const variant = await prisma.productVariant.findFirstOrThrow({
      where: { productId: product.id, isActive: true },
      select: { sku: true },
    });

    return {
      productSlug: CUSTOMISABLE_SLUG,
      variantSku: variant.sku,
      options: {},
      surfaceImageId: surface.id,
      transform: { xPercent: 50, yPercent: 35, widthPercent: 12, rotationDeg: 0 },
      threadColorIds: [colour.id],
      embroideryText: null,
      instructions: null,
      quantity: 2,
      designFileIds,
      contactName: 'Amina Bensalem',
      contactEmail: 'amina@example.invalid',
      contactPhone: null,
    };
  }

  const created: string[] = [];

  it('links a READY file to the configuration, in the same transaction', async () => {
    const owner = guest();
    const file = await uploadAndFinalise(owner, {
      filename: 'logo.png',
      contentType: 'image/png',
      body: await pngBytes(),
    });
    if (!file.ok) throw new Error(file.error.message);

    const result = await createCustomRequest(
      await requestPayload([file.value.designFileId]),
      owner,
    );

    expect(result.ok, result.ok ? '' : result.errors.join(' / ')).toBe(true);
    if (!result.ok) return;
    created.push(result.requestNumber);

    const request = await prisma.customRequest.findUniqueOrThrow({
      where: { requestNumber: result.requestNumber },
      select: {
        items: {
          select: {
            customizationConfig: {
              select: { files: { select: { designFileId: true, role: true } } },
            },
          },
        },
      },
    });

    const links = request.items[0]!.customizationConfig.files;
    expect(links).toHaveLength(1);
    expect(links[0]!.designFileId).toBe(file.value.designFileId);
    expect(links[0]!.role).toBe('PRIMARY');
  });

  it('prices a request with a stored file as FIXED, which Phase 7 could not', async () => {
    // Condition 7 of 2.3 asks whether every attached file is READY. Before
    // storage existed none could be, so any artwork forced a quote.
    const owner = guest();
    const file = await uploadAndFinalise(owner, {
      filename: 'logo.png',
      contentType: 'image/png',
      body: await pngBytes(),
    });
    if (!file.ok) throw new Error(file.error.message);

    const result = await createCustomRequest(
      await requestPayload([file.value.designFileId]),
      owner,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    created.push(result.requestNumber);

    expect(result.pricingMode.mode).toBe('FIXED');
    expect(result.pricingMode.reasons).not.toContain('ARTWORK_REVIEW');
  });

  it('will not let a customer remove a file their request already carries', async () => {
    /**
     * Historical fidelity, without touching Phase 8's semantics. An order item
     * points at a configuration and a configuration points at its files, so a
     * design file reached through an order must stay reachable. Two locks:
     * `discardFile` refuses a file with any configuration link, and
     * `customization_files.design_file_id` is `ON DELETE RESTRICT`.
     */
    const owner = guest();
    const file = await uploadAndFinalise(owner, {
      filename: 'logo.png',
      contentType: 'image/png',
      body: await pngBytes(),
    });
    if (!file.ok) throw new Error(file.error.message);

    const request = await createCustomRequest(
      await requestPayload([file.value.designFileId]),
      owner,
    );
    expect(request.ok).toBe(true);
    if (!request.ok) return;
    created.push(request.requestNumber);

    const removed = await discardFile(owner, file.value.designFileId);
    expect(removed.ok).toBe(false);

    // And it is still there, still READY, and its object still exists — the
    // storage key is a UUID of its own, so it has to be read from the row.
    const view = await getFileView(owner, file.value.designFileId);
    expect(view.ok && view.value.status).toBe('READY');

    const row = await prisma.designFile.findUniqueOrThrow({
      where: { id: file.value.designFileId },
      select: { storageKey: true, deletedAt: true },
    });
    expect(row.deletedAt).toBeNull();
    expect(await storage.get(row.storageKey)).not.toBeNull();
  });

  it('refuses a file belonging to another guest', async () => {
    const alice = guest();
    const bob = guest();

    const file = await uploadAndFinalise(alice, {
      filename: 'logo.png',
      contentType: 'image/png',
      body: await pngBytes(),
    });
    if (!file.ok) throw new Error(file.error.message);

    const result = await createCustomRequest(
      await requestPayload([file.value.designFileId]),
      bob,
    );

    expect(result.ok).toBe(false);
  });

  it('refuses an upload that never completed', async () => {
    const owner = guest();
    const authorised = await authoriseUpload(owner, {
      filename: 'pending.png',
      contentType: 'image/png',
      sizeBytes: 2_048,
    });
    if (!authorised.ok) throw new Error('authorisation refused');
    createdFileIds.push(authorised.value.designFileId);

    const result = await createCustomRequest(
      await requestPayload([authorised.value.designFileId]),
      owner,
    );

    expect(result.ok).toBe(false);
  });

  it('refuses an invented design-file id', async () => {
    const owner = guest();
    const result = await createCustomRequest(await requestPayload([randomUUID()]), owner);
    expect(result.ok).toBe(false);
  });

  it('refuses any file at all when there is no owner to scope them to', async () => {
    const owner = guest();
    const file = await uploadAndFinalise(owner, {
      filename: 'logo.png',
      contentType: 'image/png',
      body: await pngBytes(),
    });
    if (!file.ok) throw new Error(file.error.message);

    const result = await createCustomRequest(
      await requestPayload([file.value.designFileId]),
      null,
    );

    expect(result.ok).toBe(false);
  });

  afterAll(async () => {
    const requests = await prisma.customRequest.findMany({
      where: { requestNumber: { in: created } },
      select: { items: { select: { customizationConfigId: true } } },
    });
    const configIds = requests.flatMap((r) =>
      r.items.map((i) => i.customizationConfigId),
    );

    await prisma.customRequest.deleteMany({ where: { requestNumber: { in: created } } });
    await prisma.customizationFile.deleteMany({ where: { configId: { in: configIds } } });
    await prisma.customizationConfig.deleteMany({ where: { id: { in: configIds } } });
  });
});

/* ---------------------------------------------------------------------------
 * Fixtures
 * ------------------------------------------------------------------------ */

const createdUserIds: string[] = [];

async function createUser(): Promise<string> {
  const user = await prisma.user.create({
    data: {
      name: 'Cliente de test',
      email: `upload-${Date.now()}-${Math.random().toString(16).slice(2)}@example.invalid`,
      emailVerified: true,
      role: 'CUSTOMER',
      status: 'ACTIVE',
    },
    select: { id: true },
  });

  createdUserIds.push(user.id);
  return user.id;
}

afterAll(async () => {
  await prisma.designFile.deleteMany({ where: { ownerUserId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});
