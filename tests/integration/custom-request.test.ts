/**
 * The custom-request submission boundary, against the real database.
 *
 * This is the first customer-facing **write** in the project, so these tests
 * are mostly adversarial. The question they answer is not "does a valid request
 * work" but "what happens when the payload lies": a draft product's slug, a
 * placement belonging to another profile, a thread colour that does not exist,
 * a price the client would like to pay.
 *
 * `SECURITY.md` section 5 and `BUSINESS-RULES.md` 2.3.2 are the specification.
 */

import dotenv from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

dotenv.config({ path: ['.env.local', '.env'], quiet: true });

const { createCustomRequest } =
  await import('../../src/server/services/custom-request-service');
const { loadBuilderReferenceData } =
  await import('../../src/server/repositories/customization-repository');
const { prisma } = await import('../../src/lib/db/client');

const { randomUUID } = await import('node:crypto');

const CUSTOMIZABLE_SLUG = 't-shirt-brode-classique';
const DRAFT_SLUG = 'echantillon-interne-non-publie';
/** Seeded with `isCustomizable: false` — visible, but not for embroidery. */
const NON_CUSTOMIZABLE_SLUG = 'bonnet-cotele-brode';

let threadColorIds: string[];
let variantSku: string;
let surface: { imageId: string; widthMm: number };

const createdRequestNumbers: string[] = [];
const createdImageIds: string[] = [];

beforeAll(async () => {
  const reference = await loadBuilderReferenceData(CUSTOMIZABLE_SLUG);

  threadColorIds = [reference.threadColors[0]!.id];

  const variant = await prisma.productVariant.findFirstOrThrow({
    where: { product: { slug: CUSTOMIZABLE_SLUG }, isActive: true },
    select: { sku: true },
  });
  variantSku = variant.sku;
  surface = await ensureSurface(CUSTOMIZABLE_SLUG);
});

afterAll(async () => {
  if (createdRequestNumbers.length > 0) {
    const requests = await prisma.customRequest.findMany({
      where: { requestNumber: { in: createdRequestNumbers } },
      select: { id: true, items: { select: { customizationConfigId: true } } },
    });

    const configIds = requests.flatMap((request) =>
      request.items.map((item) => item.customizationConfigId),
    );

    await prisma.customRequest.deleteMany({
      where: { requestNumber: { in: createdRequestNumbers } },
    });
    await prisma.customizationConfig.deleteMany({ where: { id: { in: configIds } } });
  }

  if (createdImageIds.length > 0) {
    await prisma.productImage.deleteMany({ where: { id: { in: createdImageIds } } });
  }

  await prisma.$disconnect();
});

/**
 * A measured photograph of the blank, so a design can actually be placed on it.
 *
 * The seed does not ship one — the owner supplies the photography — so the
 * suite makes its own and takes it away again. 520 mm is a men's medium
 * t-shirt across the chest, which makes every millimetre figure below one a
 * person can check by eye.
 */
async function ensureSurface(
  slug: string,
): Promise<{ imageId: string; widthMm: number }> {
  const product = await prisma.product.findFirstOrThrow({
    where: { slug },
    select: { id: true },
  });

  /*
   * Reuse the product's own photograph rather than adding one.
   *
   * Marking an existing picture as the front face is exactly what the owner
   * does in the admin, and it keeps the suite from inserting rows other files
   * then find: `catalogue.test.ts` asserts the *first* image of the *first*
   * product with one, and a fixture appended there fails a test about
   * something else entirely.
   */
  const existing = await prisma.productImage.findFirst({
    where: { productId: product.id },
    orderBy: [{ isPrimary: 'desc' }, { position: 'asc' }],
    select: { id: true },
  });

  const image =
    existing ??
    (await prisma.productImage.create({
      data: {
        productId: product.id,
        storageKey: `media/${randomUUID()}.jpg`,
        alt: 'Fixture de placement',
        position: 900,
      },
      select: { id: true },
    }));

  await prisma.productImage.update({
    where: { id: image.id },
    data: { surface: 'FRONT', surfaceWidthMm: 520, width: 1200, height: 1500 },
  });

  return { imageId: image.id, widthMm: 520 };
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    productSlug: CUSTOMIZABLE_SLUG,
    variantSku,
    options: { Taille: 'M', Couleur: 'Noir encre' },
    // Where the design goes, as percentages of the photograph (ADR-035).
    // 12% of a 520 mm chest is 62 mm, which the seeded bands price.
    surfaceImageId: surface.imageId,
    transform: { xPercent: 50, yPercent: 35, widthPercent: 12, rotationDeg: 0 },
    threadColorIds,
    embroideryText: 'Amina',
    instructions: null,
    quantity: 2,
    designFileIds: [],
    contactName: 'Amina Bensalem',
    contactEmail: 'amina@example.invalid',
    contactPhone: null,
    ...overrides,
  };
}

async function submit(overrides: Record<string, unknown> = {}) {
  const result = await createCustomRequest(payload(overrides));
  if (result.ok) createdRequestNumbers.push(result.requestNumber);
  return result;
}

describe('a valid request', () => {
  it('is created with a configuration, an item and an event', async () => {
    const result = await submit();

    expect(result.ok, result.ok ? '' : result.errors.join(' / ')).toBe(true);
    if (!result.ok) return;

    // `DEM-YYYY-NNNN`, zero-padded to **at least** four digits. The sequence is
    // global and never restarts (ADR-023), so the counter grows past 9999 and
    // the number grows with it — a fixed four would truncate, which is exactly
    // the collision Phase 14 found and fixed.
    expect(result.requestNumber).toMatch(/^DEM-\d{4}-\d{4,}$/);

    const stored = await prisma.customRequest.findUniqueOrThrow({
      where: { requestNumber: result.requestNumber },
      select: {
        status: true,
        source: true,
        pricingMode: true,
        contactEmail: true,
        estimateMin: true,
        estimateMax: true,
        submittedAt: true,
        items: {
          select: {
            quantity: true,
            customizationConfig: {
              select: {
                productId: true,
                designSurface: true,
                designSurfaceImageId: true,
                designWidthPercent: true,
                embroideryWidthMm: true,
                designSurfaceLabel: true,
                embroiderySizeId: true,
                threadColorCount: true,
                pricingMode: true,
                estimateMin: true,
                threadColors: { select: { threadColorId: true } },
              },
            },
          },
        },
        events: { select: { type: true, toStatus: true, actorType: true } },
      },
    });

    expect(stored.status).toBe('SUBMITTED');
    expect(stored.source).toBe('BUILDER');
    expect(stored.submittedAt).not.toBeNull();
    expect(stored.contactEmail).toBe('amina@example.invalid');

    expect(stored.items).toHaveLength(1);
    const config = stored.items[0]!.customizationConfig;
    expect(stored.items[0]!.quantity).toBe(2);
    /*
     * The placement, stored as the customer left it.
     *
     * Percentages, plus the millimetre figure derived from the photograph's
     * own calibration — never from anything the browser sent, because the size
     * band is what the embroidery costs.
     */
    expect(config.designSurface).toBe('FRONT');
    expect(config.designSurfaceImageId).toBe(surface.imageId);
    expect(Number(config.designWidthPercent)).toBeCloseTo(12, 3);
    expect(config.embroideryWidthMm).toBe(62);
    expect(config.designSurfaceLabel).toContain('Devant');
    /*
     * The band is **derived**, not chosen.
     *
     * The customer drags a size; the cheapest band that covers it prices the
     * embroidery. That is the whole reason the browser no longer sends a size
     * id — it would be sending itself a price (ADR-035).
     */
    const band = await prisma.embroiderySize.findUniqueOrThrow({
      where: { id: config.embroiderySizeId! },
      select: { maxWidthMm: true, basePrice: true },
    });

    expect(band.maxWidthMm === null || band.maxWidthMm >= 62).toBe(true);

    const cheaperThatFits = await prisma.embroiderySize.findFirst({
      where: {
        isActive: true,
        basePrice: { lt: band.basePrice },
        OR: [{ maxWidthMm: null }, { maxWidthMm: { gte: 62 } }],
      },
      select: { id: true },
    });

    expect(cheaperThatFits).toBeNull();
    expect(config.threadColorCount).toBe(1);
    expect(config.threadColors).toHaveLength(1);

    // 2.4.3: the estimate is snapshotted for the admin's reference.
    expect(stored.estimateMin).toBeGreaterThan(0);
    expect(stored.estimateMax).toBeGreaterThanOrEqual(stored.estimateMin!);
    expect(config.estimateMin).toBe(stored.estimateMin);

    expect(stored.events).toEqual([
      { type: 'STATUS_CHANGE', toStatus: 'SUBMITTED', actorType: 'CUSTOMER' },
    ]);
  });

  it('is FIXED for a simple configuration and QUOTE past a threshold', async () => {
    const simple = await submit({ quantity: 2 });
    expect(simple.ok && simple.pricingMode.mode).toBe('FIXED');

    // Quantity 11 crosses the seeded threshold of 10.
    const bulk = await submit({ quantity: 11 });
    expect(bulk.ok && bulk.pricingMode.mode).toBe('QUOTE');
    if (bulk.ok) expect(bulk.pricingMode.reasons).toContain('QUANTITY');
  });

  it('widens the estimate into a band in quote mode', async () => {
    const result = await submit({ quantity: 11 });
    if (!result.ok) throw new Error(result.errors.join(' / '));

    expect(result.estimate.max).toBeGreaterThan(result.estimate.min);
  });

  it('refuses a design-file id it cannot resolve to a READY file', async () => {
    /**
     * Phase 7 accepted the browser's *description* of a file and forced every
     * request carrying one into quote mode, because no file could be `READY`
     * without storage. Phase 9 stores and verifies them, so what arrives here
     * is an id — and an id that resolves to nothing is refused rather than
     * described. The happy path, and condition 7 being genuinely satisfiable,
     * are covered in `design-file.test.ts`, which can create a real file.
     */
    const result = await createCustomRequest(
      payload({ designFileIds: ['00000000-0000-7000-8000-000000000000'] }),
      { kind: 'guest', anonymousToken: 'phase7-suite' },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/fichier/i);
  });
});

describe('rejects what it must not trust', () => {
  it('refuses a product that is not customisable', async () => {
    const result = await createCustomRequest(
      payload({ productSlug: NON_CUSTOMIZABLE_SLUG, variantSku: null }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/personnalis/i);
  });

  it('refuses an unpublished product, even with a real slug', async () => {
    const result = await createCustomRequest(
      payload({ productSlug: DRAFT_SLUG, variantSku: null }),
    );
    expect(result.ok).toBe(false);
  });

  it('refuses a product that does not exist', async () => {
    expect((await createCustomRequest(payload({ productSlug: 'inexistant' }))).ok).toBe(
      false,
    );
  });

  it('refuses a variant belonging to another product', async () => {
    const other = await prisma.productVariant.findFirstOrThrow({
      where: { product: { slug: 'casquette-brodee' } },
      select: { sku: true },
    });

    const result = await createCustomRequest(payload({ variantSku: other.sku }));
    expect(result.ok).toBe(false);
  });

  /*
   * The surface id decides which garment a design is *measured against*. A
   * photograph of another product would produce a millimetre figure computed
   * from the wrong calibration — a wrong order that looks right on every
   * screen — so the query scopes it to this product rather than checking after.
   */
  it('refuses a surface that is not this product’s', async () => {
    const result = await createCustomRequest(
      payload({ surfaceImageId: '00000000-0000-7000-8000-000000000000' }),
    );
    expect(result.ok).toBe(false);
  });

  it('refuses a thread colour that does not exist', async () => {
    const result = await createCustomRequest(
      payload({ threadColorIds: ['00000000-0000-7000-8000-000000000000'] }),
    );
    expect(result.ok).toBe(false);
  });

  it('refuses an invalid email', async () => {
    expect(
      (await createCustomRequest(payload({ contactEmail: 'pas-un-email' }))).ok,
    ).toBe(false);
    expect((await createCustomRequest(payload({ contactEmail: '' }))).ok).toBe(false);
  });

  it('refuses a missing name', async () => {
    expect((await createCustomRequest(payload({ contactName: 'A' }))).ok).toBe(false);
  });

  it('refuses an out-of-range quantity', async () => {
    expect((await createCustomRequest(payload({ quantity: 0 }))).ok).toBe(false);
    expect((await createCustomRequest(payload({ quantity: -5 }))).ok).toBe(false);
    expect((await createCustomRequest(payload({ quantity: 1.5 }))).ok).toBe(false);
    expect((await createCustomRequest(payload({ quantity: 100_000 }))).ok).toBe(false);
  });

  it('refuses more thread colours than may be configured', async () => {
    const colors = await prisma.threadColor.findMany({
      where: { isActive: true },
      select: { id: true },
      take: 9,
    });

    // Nine is above the seeded maxThreadColors of 8.
    const result = await createCustomRequest(
      payload({ threadColorIds: colors.map((color) => color.id) }),
    );
    expect(result.ok).toBe(false);
  });

  it('refuses a configuration with neither a file nor text', async () => {
    const result = await createCustomRequest(
      payload({ embroideryText: null, designFileIds: [] }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/fichier|texte/i);
  });

  it('refuses instructions longer than the schema allows', async () => {
    const result = await createCustomRequest(payload({ instructions: 'x'.repeat(2001) }));
    expect(result.ok).toBe(false);
  });

  it('creates nothing when it refuses', async () => {
    // Scoped to this file's contact address rather than counting every request
    // in the database: a suite creating one in parallel would otherwise fail
    // this test for a reason that has nothing to do with refusal.
    const where = { contactEmail: 'amina@example.invalid' };

    const before = await prisma.customRequest.count({ where });
    await createCustomRequest(payload({ productSlug: DRAFT_SLUG }));
    await createCustomRequest(payload({ contactEmail: 'nope' }));
    expect(await prisma.customRequest.count({ where })).toBe(before);
  });
});

describe('never trusts client-supplied money', () => {
  it('ignores a price, discount, deposit or mode sent by the client', async () => {
    // The schema has no such fields, so these are stripped rather than
    // believed. 2.3.2: a client-supplied pricingMode is ignored.
    const result = await submit({
      quantity: 11,
      price: 1,
      total: 1,
      estimateMin: 1,
      estimateMax: 1,
      discountBasisPoints: 9999,
      depositAmount: 0,
      pricingMode: 'FIXED',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Quantity 11 must still be QUOTE despite the client asking for FIXED,
    // and the estimate must be the server's, not the 1 that was sent.
    expect(result.pricingMode.mode).toBe('QUOTE');
    expect(result.estimate.min).toBeGreaterThan(100);

    const stored = await prisma.customRequest.findUniqueOrThrow({
      where: { requestNumber: result.requestNumber },
      select: { pricingMode: true, estimateMin: true },
    });

    expect(stored.pricingMode).toBe('QUOTE');
    expect(stored.estimateMin).toBe(result.estimate.min);
  });

  it('prices identical configurations identically, whatever the client sends', async () => {
    const plain = await submit({ quantity: 3 });
    const tampered = await submit({ quantity: 3, total: 1, discountBasisPoints: 5000 });

    if (!plain.ok || !tampered.ok) throw new Error('expected both to succeed');
    expect(tampered.estimate).toEqual(plain.estimate);
  });
});
