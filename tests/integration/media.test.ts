/**
 * Shop photography, against the real database and the real storage adapter.
 *
 * What the unit tests cannot prove is here: that an uploaded photograph is
 * re-encoded and stored where the public route can find it, that the row and
 * the object stay in step through reordering and deletion, and — the one that
 * matters most — that the bytes on the shelf are **not** the bytes that were
 * sent.
 */

import dotenv from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

dotenv.config({ path: ['.env.local', '.env'], quiet: true });

const [
  { prisma },
  { storage, isPublicMediaKey },
  {
    attachProductImage,
    makeImagePrimary,
    moveProductImage,
    removeProductImage,
    renameProductImage,
  },
  { listProductImages },
  { MAX_IMAGES_PER_PRODUCT },
] = await Promise.all([
  import('@/lib/db/client'),
  import('@/lib/storage'),
  import('@/server/services/media-service'),
  import('@/server/repositories/catalogue-admin-repository'),
  import('@/domain/media'),
]);

/**
 * A real JPEG, built here rather than committed.
 *
 * `sharp` is already a dependency and generating the fixture keeps the test
 * honest: it exercises the same decode path a photograph takes, and a fixture
 * that drifts out of date cannot happen.
 */
async function photograph(size = 1200): Promise<Uint8Array> {
  const sharp = (await import('sharp')).default;

  const image = await sharp({
    create: {
      width: size,
      height: Math.round(size * 1.25),
      channels: 3,
      background: { r: 232, g: 226, b: 214 },
    },
  })
    .jpeg()
    .toBuffer();

  return new Uint8Array(image);
}

const SLUG = `media-fixture-${Date.now()}`;
let productId = '';
const written: string[] = [];

beforeAll(async () => {
  const category = await prisma.category.findFirstOrThrow({ select: { id: true } });

  const product = await prisma.product.create({
    data: {
      slug: SLUG,
      name: 'Fixture photographie',
      description: 'Créé par les tests, supprimé par les tests.',
      categoryId: category.id,
      basePrice: 1000,
      status: 'DRAFT',
    },
    select: { id: true },
  });

  productId = product.id;
});

afterAll(async () => {
  const images = await prisma.productImage.findMany({
    where: { productId },
    select: { storageKey: true },
  });

  await prisma.productImage.deleteMany({ where: { productId } });
  await prisma.product.delete({ where: { id: productId } });

  for (const key of [...images.map((image) => image.storageKey), ...written]) {
    await storage.delete(key).catch(() => undefined);
  }
});

describe('attaching a photograph', () => {
  it('stores a re-encoded object and a row that points at it', async () => {
    const original = await photograph();

    const result = await attachProductImage({
      productId,
      file: { bytes: original, contentType: 'image/jpeg', alt: 'Une pièce brodée' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = await prisma.productImage.findUniqueOrThrow({
      where: { id: result.value.id },
      select: {
        storageKey: true,
        alt: true,
        width: true,
        height: true,
        blurDataUrl: true,
        isPrimary: true,
        position: true,
      },
    });

    written.push(row.storageKey);

    // Public prefix, generated key: nothing the uploader supplied reaches it.
    expect(isPublicMediaKey(row.storageKey)).toBe(true);
    expect(row.storageKey).toMatch(/^media\/[0-9a-f-]{36}\.jpg$/);

    // The first one is the main one, and it is at the end of the list.
    expect(row.isPrimary).toBe(true);
    expect(row.position).toBe(0);

    // Dimensions and a placeholder were derived, not guessed.
    expect(row.width).toBe(1200);
    expect(row.height).toBe(1500);
    expect(row.blurDataUrl).toMatch(/^data:image\/jpeg;base64,/);

    const stored = await storage.get(row.storageKey);
    expect(stored).not.toBeNull();

    /*
     * The stored bytes are not the uploaded bytes.
     *
     * This is the assertion the whole re-encode exists for: an image that
     * arrived with EXIF, a camera's colour profile or a hostile payload
     * appended after the end marker is not what ends up on a public URL.
     */
    expect(Buffer.from(stored!).equals(Buffer.from(original))).toBe(false);
    expect(stored!.subarray(0, 3)).toEqual(new Uint8Array([0xff, 0xd8, 0xff]));
  });

  it('refuses a file whose bytes are not an image', async () => {
    const result = await attachProductImage({
      productId,
      file: {
        bytes: new TextEncoder().encode('<html><script>alert(1)</script></html>'),
        // The declared type is a claim, and this is the claim being disbelieved.
        contentType: 'image/jpeg',
        alt: '',
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('TYPE_NOT_ACCEPTED');
  });

  it('refuses one image too many', async () => {
    const existing = await listProductImages(productId);
    const bytes = await photograph(400);

    for (let index = existing.length; index < MAX_IMAGES_PER_PRODUCT; index += 1) {
      const added = await attachProductImage({
        productId,
        file: { bytes, contentType: 'image/jpeg', alt: `Vue ${index}` },
      });

      expect(added.ok).toBe(true);
      if (added.ok) written.push(added.value.id);
    }

    const refused = await attachProductImage({
      productId,
      file: { bytes, contentType: 'image/jpeg', alt: 'Une de trop' },
    });

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.code).toBe('TOO_MANY');
  });
});

describe('arranging photographs', () => {
  it('moves one down and renumbers the rest', async () => {
    const before = await listProductImages(productId);
    expect(before.length).toBeGreaterThan(1);

    const moved = await moveProductImage({
      imageId: before[0]!.id,
      direction: 'down',
    });

    expect(moved.ok).toBe(true);

    const after = await listProductImages(productId);
    expect(after[0]!.id).toBe(before[1]!.id);
    expect(after[1]!.id).toBe(before[0]!.id);
    expect(after.map((image) => image.position)).toEqual(after.map((_, index) => index));
  });

  it('gives the main flag to exactly one image', async () => {
    const images = await listProductImages(productId);
    const last = images[images.length - 1]!;

    await makeImagePrimary(last.id);

    const after = await listProductImages(productId);
    expect(after.filter((image) => image.isPrimary).map((image) => image.id)).toEqual([
      last.id,
    ]);
  });

  it('renames the description without touching the object', async () => {
    const [first] = await listProductImages(productId);

    await renameProductImage({ imageId: first!.id, alt: 'Tote bag brodé, de face' });

    const after = await listProductImages(productId);
    expect(after.find((image) => image.id === first!.id)?.alt).toBe(
      'Tote bag brodé, de face',
    );
    expect(await storage.get(first!.storageKey)).not.toBeNull();
  });
});

describe('removing a photograph', () => {
  it('deletes the row, the object, and promotes the next main image', async () => {
    const before = await listProductImages(productId);
    const primary = before.find((image) => image.isPrimary)!;

    const removed = await removeProductImage(primary.id);
    expect(removed.ok).toBe(true);

    const after = await listProductImages(productId);

    expect(after.some((image) => image.id === primary.id)).toBe(false);
    expect(await storage.get(primary.storageKey)).toBeNull();

    // A product is never left without a main photograph.
    expect(after.filter((image) => image.isPrimary)).toHaveLength(1);
    expect(after[0]!.isPrimary).toBe(true);
  });
});
