/**
 * Writing the catalogue, against the real database.
 *
 * Phase 14.5 gave the admin the ability to create, rename, publish and archive
 * a product, and to move stock. Four questions run through this file, and each
 * one is a way the feature could quietly do damage.
 *
 * **Can a draft reach the storefront?** The admin read path sees drafts by
 * design; the storefront's does not. Every write here is checked against
 * `catalogue-repository`, which carries `publiclyVisibleWhere`, rather than
 * against the module that wrote it.
 *
 * **Does a rename lose the old URL?** 11.6 says a slug change writes a
 * `product_redirects` row. Phase 14 built the read and recorded that nothing
 * wrote to it; this is the write, and it happens in the same transaction as the
 * rename because there is no way to reconstruct the old slug afterwards.
 *
 * **Can stock go negative, or below what orders reserved?** The conditional
 * `UPDATE` is the authority, so these are asserted by *attempting* the write,
 * not by asking the validator.
 *
 * **Does every movement leave a trace?** A count nobody can explain is the
 * whole reason `inventory_adjustments` exists (ADR-029).
 *
 * Everything is created by this suite and removed afterwards. Nothing here
 * touches a seeded product: stock is shared mutable state, and a test that
 * moved a seeded variant's count would be a test whose result depends on which
 * suites ran alongside it.
 */

import dotenv from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

dotenv.config({ path: ['.env.local', '.env'], quiet: true });

const {
  adjustStock,
  createOption,
  createProduct,
  createVariant,
  getAdminProduct,
  listAdminCategories,
  listAdminProducts,
  listStockRows,
  listVariantAdjustments,
  setProductStatus,
  updateProduct,
} = await import('../../src/server/repositories/catalogue-admin-repository');

const { applyStockAdjustment, saveProduct } =
  await import('../../src/server/services/catalogue-admin-service');

const { findProductRedirect, getPublishedProductBySlug } =
  await import('../../src/server/repositories/catalogue-repository');

const { prisma } = await import('../../src/lib/db/client');

const PREFIX = `p145-cat-${Date.now()}`;

let categoryId: string;
let staffUserId: string;

const createdProductIds: string[] = [];

function draft(overrides: Partial<Parameters<typeof createProduct>[0]> = {}) {
  return {
    name: `Pièce d’essai ${PREFIX}`,
    slug: `${PREFIX}-piece`,
    subtitle: null,
    description:
      'Une pièce créée par la suite de tests pour vérifier l’écriture du catalogue.',
    categoryId,
    status: 'DRAFT' as const,
    basePrice: 3200,
    compareAtPrice: null,
    stockPolicy: 'TRACK' as const,
    material: null,
    careInstructions: null,
    embroideryDetails: null,
    isCustomizable: false,
    isFeatured: false,
    isNewArrival: false,
    isBestSeller: false,
    seoTitle: null,
    seoDescription: null,
    ...overrides,
  };
}

async function newProduct(overrides = {}): Promise<string> {
  const result = await createProduct(draft(overrides));
  if (!result.ok) throw new Error(`fixture product failed: ${result.failure.code}`);

  createdProductIds.push(result.value.id);
  return result.value.id;
}

async function newVariant(productId: string, sku: string): Promise<string> {
  const result = await createVariant({
    productId,
    write: { sku, priceOverride: null, lowStockThreshold: null, isActive: true },
    optionValueIds: [],
  });

  if (!result.ok) throw new Error(`fixture variant failed: ${result.failure.code}`);
  return result.value.id;
}

beforeAll(async () => {
  const categories = await listAdminCategories();
  categoryId = categories[0]!.id;

  const staff = await prisma.user.create({
    data: {
      email: `${PREFIX}-staff@example.test`,
      name: 'Atelier essai',
      role: 'STAFF',
      status: 'ACTIVE',
      emailVerified: true,
    },
    select: { id: true },
  });

  staffUserId = staff.id;
});

afterAll(async () => {
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await prisma.user.deleteMany({ where: { id: staffUserId } });
});

/* ---------------------------------------------------------------------------
 * Creating and publishing
 * ------------------------------------------------------------------------ */

describe('creating a product', () => {
  it('creates it as a draft that the storefront cannot see', async () => {
    const id = await newProduct({ slug: `${PREFIX}-invisible` });

    const stored = await getAdminProduct(id);
    expect(stored?.status).toBe('DRAFT');
    expect(stored?.publishedAt).toBeNull();

    // The admin sees it; the shop does not.
    expect(await getPublishedProductBySlug(`${PREFIX}-invisible`)).toBeNull();
  });

  it('refuses a slug another product already owns', async () => {
    await newProduct({ slug: `${PREFIX}-collision` });

    // The database decides, not a lookup two writers could both pass.
    const second = await createProduct(draft({ slug: `${PREFIX}-collision` }));

    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.failure.code).toBe('SLUG_TAKEN');
  });

  it('reports the collision on the slug field, through the service', async () => {
    await newProduct({ slug: `${PREFIX}-service-collision` });

    const result = await saveProduct({
      productId: null,
      draft: draft({ slug: `${PREFIX}-service-collision` }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.slug).toBeDefined();
  });

  it('stamps publishedAt the first time it goes live, and never clears it', async () => {
    const id = await newProduct({ slug: `${PREFIX}-published` });

    await setProductStatus(id, 'ACTIVE');
    const live = await getAdminProduct(id);
    expect(live?.publishedAt).not.toBeNull();

    // Taken down and put back up, it keeps its original date: "when did this
    // first go on sale" is a fact, not a current state.
    await setProductStatus(id, 'DRAFT');
    await setProductStatus(id, 'ACTIVE');

    const again = await getAdminProduct(id);
    expect(again?.publishedAt?.getTime()).toBe(live?.publishedAt?.getTime());
  });

  it('takes an archived product off the storefront and keeps the record', async () => {
    const id = await newProduct({ slug: `${PREFIX}-archived`, status: 'ACTIVE' });
    await newVariant(id, `${PREFIX}-ARCH`.toUpperCase());

    await setProductStatus(id, 'ARCHIVED');

    expect(await getPublishedProductBySlug(`${PREFIX}-archived`)).toBeNull();
    // Not a delete: the row, and the order history that points at it, survive.
    expect(await getAdminProduct(id)).not.toBeNull();
  });
});

/* ---------------------------------------------------------------------------
 * Renaming
 * ------------------------------------------------------------------------ */

describe('renaming a product', () => {
  it('leaves a redirect behind, so the old address keeps working (11.6)', async () => {
    const oldSlug = `${PREFIX}-ancien`;
    const newSlug = `${PREFIX}-nouveau`;

    const id = await newProduct({ slug: oldSlug, status: 'ACTIVE' });
    const renamed = await updateProduct(id, draft({ slug: newSlug, status: 'ACTIVE' }));

    expect(renamed.ok).toBe(true);
    if (renamed.ok) expect(renamed.value.previousSlug).toBe(oldSlug);

    // The read side Phase 14 built now has something to read.
    expect(await findProductRedirect(oldSlug)).toBe(newSlug);
  });

  it('reports no rename when the slug did not change', async () => {
    const id = await newProduct({ slug: `${PREFIX}-stable` });
    const saved = await updateProduct(
      id,
      draft({ slug: `${PREFIX}-stable`, name: 'Nom modifié' }),
    );

    expect(saved.ok).toBe(true);
    if (saved.ok) expect(saved.value.previousSlug).toBeNull();
  });

  it('drops a stale redirect when a slug is taken back into use', async () => {
    const first = `${PREFIX}-aller`;
    const second = `${PREFIX}-retour`;

    const id = await newProduct({ slug: first, status: 'ACTIVE' });
    await updateProduct(id, draft({ slug: second, status: 'ACTIVE' }));
    expect(await findProductRedirect(first)).toBe(second);

    // Renamed back: `first` is a live slug again and must not also redirect.
    await updateProduct(id, draft({ slug: first, status: 'ACTIVE' }));
    expect(await findProductRedirect(first)).toBeNull();
    expect(await findProductRedirect(second)).toBe(first);
  });
});

/* ---------------------------------------------------------------------------
 * Variants
 * ------------------------------------------------------------------------ */

describe('variants', () => {
  it('creates one at zero stock, so its first units come from the ledger', async () => {
    const id = await newProduct({ slug: `${PREFIX}-variantes` });
    const variantId = await newVariant(id, `${PREFIX}-V1`.toUpperCase());

    const stored = await getAdminProduct(id);
    const variant = stored?.variants.find((row) => row.id === variantId);

    expect(variant?.stockQuantity).toBe(0);
    expect(variant?.reservedQuantity).toBe(0);
    expect(variant?.state).toBe('OUT_OF_STOCK');
  });

  it('refuses a SKU that already exists anywhere', async () => {
    const sku = `${PREFIX}-DUP`.toUpperCase();
    const first = await newProduct({ slug: `${PREFIX}-sku-a` });
    const second = await newProduct({ slug: `${PREFIX}-sku-b` });

    await newVariant(first, sku);

    // A SKU identifies one variant in the whole catalogue, not one per product.
    const clash = await createVariant({
      productId: second,
      write: { sku, priceOverride: null, lowStockThreshold: null, isActive: true },
      optionValueIds: [],
    });

    expect(clash.ok).toBe(false);
    if (!clash.ok) expect(clash.failure.code).toBe('SKU_TAKEN');
  });

  it('attaches option values chosen by id', async () => {
    const id = await newProduct({ slug: `${PREFIX}-options` });

    const option = await createOption({
      productId: id,
      name: 'Taille',
      values: ['S', 'M', 'L'],
    });

    expect(option.ok).toBe(true);

    const withOptions = await getAdminProduct(id);
    const medium = withOptions?.options[0]?.values.find((value) => value.value === 'M');
    expect(medium).toBeDefined();

    await createVariant({
      productId: id,
      write: {
        sku: `${PREFIX}-M`.toUpperCase(),
        priceOverride: 4000,
        lowStockThreshold: 2,
        isActive: true,
      },
      optionValueIds: [medium!.id],
    });

    const stored = await getAdminProduct(id);
    expect(stored?.variants[0]?.options).toEqual({ Taille: 'M' });
    expect(stored?.variants[0]?.priceOverride).toBe(4000);
  });

  it('refuses a second option with the same name on one product', async () => {
    const id = await newProduct({ slug: `${PREFIX}-option-dup` });

    await createOption({ productId: id, name: 'Couleur', values: ['Noir'] });
    const again = await createOption({
      productId: id,
      name: 'Couleur',
      values: ['Écru'],
    });

    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.failure.code).toBe('OPTION_EXISTS');
  });
});

/* ---------------------------------------------------------------------------
 * Stock
 * ------------------------------------------------------------------------ */

describe('adjusting stock', () => {
  async function stocked(units: number, reserved = 0) {
    const productId = await newProduct({
      slug: `${PREFIX}-stock-${Math.random().toString(36).slice(2, 8)}`,
      status: 'ACTIVE',
    });

    const variantId = await newVariant(
      productId,
      `${PREFIX}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase(),
    );

    if (units > 0) {
      await adjustStock({
        variantId,
        delta: units,
        reason: 'RECEIVED',
        note: null,
        actorUserId: staffUserId,
      });
    }

    if (reserved > 0) {
      // Written directly: reserving is order placement's job (10.4), and this
      // suite is about what the *adjustment* path does when units are spoken
      // for, not about how they came to be reserved.
      await prisma.productVariant.update({
        where: { id: variantId },
        data: { reservedQuantity: reserved },
      });
    }

    return { productId, variantId };
  }

  it('applies a positive movement and records it', async () => {
    const { variantId } = await stocked(0);

    const result = await applyStockAdjustment({
      variantId,
      delta: 12,
      reason: 'RECEIVED',
      note: 'Réception fournisseur',
      actorUserId: staffUserId,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.resultingQuantity).toBe(12);

    const ledger = await listVariantAdjustments(variantId);
    expect(ledger[0]?.delta).toBe(12);
    expect(ledger[0]?.resultingQuantity).toBe(12);
    expect(ledger[0]?.reason).toBe('RECEIVED');
    expect(ledger[0]?.note).toBe('Réception fournisseur');
    expect(ledger[0]?.actorName).toBe('Atelier essai');
  });

  it('applies a negative movement down to zero', async () => {
    const { variantId } = await stocked(4);

    const result = await applyStockAdjustment({
      variantId,
      delta: -4,
      reason: 'DAMAGED',
      note: null,
      actorUserId: staffUserId,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.resultingQuantity).toBe(0);
  });

  it('refuses to take stock negative, and does not write a ledger row', async () => {
    const { variantId } = await stocked(4);

    const result = await applyStockAdjustment({
      variantId,
      delta: -5,
      reason: 'COUNT',
      note: null,
      actorUserId: staffUserId,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('4');

    const variant = await prisma.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stockQuantity: true },
    });

    expect(variant.stockQuantity).toBe(4);

    // One row, from stocking it. A refused movement is not a movement.
    const ledger = await listVariantAdjustments(variantId);
    expect(ledger).toHaveLength(1);
  });

  it('refuses to take stock below what orders have reserved', async () => {
    const { variantId } = await stocked(10, 3);

    const result = await applyStockAdjustment({
      variantId,
      delta: -8,
      reason: 'COUNT',
      note: null,
      actorUserId: staffUserId,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('3');
      expect(result.message).toContain('commande');
    }

    // Down to exactly the reserved count is allowed: those units exist and are
    // promised, which is a consistent state.
    const toReserved = await applyStockAdjustment({
      variantId,
      delta: -7,
      reason: 'COUNT',
      note: null,
      actorUserId: staffUserId,
    });

    expect(toReserved.ok).toBe(true);
  });

  it('composes concurrent movements instead of overwriting them', async () => {
    const { variantId } = await stocked(20);

    // A form that posted a final quantity would lose one of these entirely.
    const results = await Promise.all([
      applyStockAdjustment({
        variantId,
        delta: -5,
        reason: 'DAMAGED',
        note: null,
        actorUserId: staffUserId,
      }),
      applyStockAdjustment({
        variantId,
        delta: 3,
        reason: 'RETURNED',
        note: null,
        actorUserId: staffUserId,
      }),
    ]);

    expect(results.every((result) => result.ok)).toBe(true);

    const variant = await prisma.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stockQuantity: true },
    });

    expect(variant.stockQuantity).toBe(18);

    const ledger = await listVariantAdjustments(variantId);
    expect(ledger).toHaveLength(3);
    // Every resulting quantity recorded is a real state the row passed through.
    expect(ledger.map((row) => row.resultingQuantity).sort((a, b) => a - b)).toEqual([
      15, 18, 20,
    ]);
  });

  it('refuses a movement against a variant that does not exist', async () => {
    const result = await applyStockAdjustment({
      variantId: '00000000-0000-7000-8000-000000000000',
      delta: 1,
      reason: 'RECEIVED',
      note: null,
      actorUserId: staffUserId,
    });

    expect(result.ok).toBe(false);
  });

  it('never lets an adjustment touch the reserved count', async () => {
    const { variantId } = await stocked(10, 4);

    await applyStockAdjustment({
      variantId,
      delta: 5,
      reason: 'RECEIVED',
      note: null,
      actorUserId: staffUserId,
    });

    const variant = await prisma.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stockQuantity: true, reservedQuantity: true },
    });

    // 10.5 releases a reservation on shipment or cancellation. Nothing on the
    // stock screen may.
    expect(variant.stockQuantity).toBe(15);
    expect(variant.reservedQuantity).toBe(4);
  });
});

/* ---------------------------------------------------------------------------
 * The admin's own reads
 * ------------------------------------------------------------------------ */

describe('the admin catalogue list', () => {
  it('finds a product by name, by slug and by SKU', async () => {
    const id = await newProduct({
      slug: `${PREFIX}-cherchable`,
      name: `Trouvable ${PREFIX}`,
      status: 'ACTIVE',
    });

    const sku = `${PREFIX}-FIND`.toUpperCase();
    await newVariant(id, sku);

    for (const term of [`Trouvable ${PREFIX}`, `${PREFIX}-cherchable`, sku]) {
      const found = await listAdminProducts({ search: term });
      expect(
        found.map((row) => row.id),
        term,
      ).toContain(id);
    }
  });

  it('summarises tracked stock and counts variants in alert', async () => {
    const id = await newProduct({ slug: `${PREFIX}-resume`, status: 'ACTIVE' });

    const full = await newVariant(id, `${PREFIX}-FULL`.toUpperCase());
    await newVariant(id, `${PREFIX}-EMPTY`.toUpperCase());

    await adjustStock({
      variantId: full,
      delta: 40,
      reason: 'RECEIVED',
      note: null,
      actorUserId: staffUserId,
    });

    const [row] = await listAdminProducts({ search: `${PREFIX}-resume` });

    expect(row?.availableUnits).toBe(40);
    // The empty variant is the reason a total alone would mislead.
    expect(row?.alertCount).toBe(1);
  });

  it('reports a policy rather than a quantity when stock is not tracked', async () => {
    const id = await newProduct({
      slug: `${PREFIX}-a-la-commande`,
      status: 'ACTIVE',
      stockPolicy: 'MADE_TO_ORDER',
    });

    await newVariant(id, `${PREFIX}-MTO`.toUpperCase());

    const [row] = await listAdminProducts({ search: `${PREFIX}-a-la-commande` });
    expect(row?.availableUnits).toBeNull();
    expect(row?.alertCount).toBe(0);

    const stock = await listStockRows('all', `${PREFIX}-MTO`);
    expect(stock[0]?.state).toBe('MADE_TO_ORDER');

    // And it is never in an alert queue, because a rupture it cannot have is
    // not a rupture.
    const alerts = await listStockRows('alert', `${PREFIX}-MTO`);
    expect(alerts).toHaveLength(0);
  });
});
