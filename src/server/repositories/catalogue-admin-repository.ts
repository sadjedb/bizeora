import 'server-only';

import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db/client';
import { toPublicAssetUrl } from '@/lib/media/public-asset';
import {
  availableStock,
  stockState,
  type AdjustmentReason,
  type ProductStatus,
  type StockPolicy,
  type StockState,
} from '@/domain/catalogue';
import type { DesignSurface } from '@/domain/customization/placement';
import { publiclyVisibleWhere } from '@/server/repositories/catalogue-repository';

/**
 * The catalogue's **write** path, and the admin's view of it.
 *
 * `catalogue-repository.ts` is the storefront's read path and every query in it
 * carries `publiclyVisibleWhere`. This module is its opposite number: it sees
 * drafts, archived products, inactive variants and stock counts, and it is the
 * only module in the application that changes any of them. Splitting them is
 * not tidiness — one `where` clause forgotten in a shared module is a draft
 * product on the storefront, and keeping the two files apart means the
 * storefront's queries cannot accidentally inherit an admin's visibility.
 *
 * Three rules, the same three as the read path plus one:
 *
 *   1. **Explicit `select`, always.**
 *   2. **Business rules are imported, not re-implemented** — stock state comes
 *      from `domain/catalogue`.
 *   3. **Concurrent writes are decided by the database.** Stock moves through a
 *      conditional `UPDATE ... WHERE` that carries its own precondition, never
 *      through read-then-write. Slug uniqueness is a unique index, not a
 *      lookup somebody could pass at the same moment as somebody else.
 *
 * Nothing here authorises anything. Authorisation is `domain/permissions` over
 * an actor the service resolved, and every caller does it before arriving.
 */

/* ---------------------------------------------------------------------------
 * DTOs
 * ------------------------------------------------------------------------ */

export type AdminProductRow = {
  id: string;
  slug: string;
  name: string;
  status: ProductStatus;
  categoryName: string;
  basePrice: number;
  currency: string;
  stockPolicy: StockPolicy;
  isCustomizable: boolean;
  variantCount: number;
  /** Sum of `available` across active variants. Null when stock is not kept. */
  availableUnits: number | null;
  /** How many variants are out of, or low on, stock right now. */
  alertCount: number;
  imageSrc: string | null;
  updatedAt: Date;
};

export type AdminVariantRow = {
  id: string;
  sku: string;
  options: Readonly<Record<string, string>>;
  priceOverride: number | null;
  stockQuantity: number;
  reservedQuantity: number;
  available: number;
  lowStockThreshold: number | null;
  isActive: boolean;
  state: StockState;
};

export type AdminProductDetail = {
  id: string;
  slug: string;
  name: string;
  subtitle: string | null;
  description: string;
  categoryId: string;
  categoryName: string;
  status: ProductStatus;
  basePrice: number;
  compareAtPrice: number | null;
  currency: string;
  stockPolicy: StockPolicy;
  material: string | null;
  careInstructions: string | null;
  embroideryDetails: string | null;
  isCustomizable: boolean;
  isFeatured: boolean;
  isNewArrival: boolean;
  isBestSeller: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  /** The overlay column, so the form can show what is already translated. */
  translations: unknown;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  options: readonly {
    id: string;
    name: string;
    values: readonly { id: string; value: string }[];
  }[];
  variants: readonly AdminVariantRow[];
  images: readonly AdminImageRow[];
  /** Order lines already reference this product; see `archiveProduct`. */
  orderedCount: number;
};

export type StockRow = AdminVariantRow & {
  productId: string;
  productName: string;
  productSlug: string;
  productStatus: ProductStatus;
  stockPolicy: StockPolicy;
  currency: string;
};

export type AdjustmentRow = {
  id: string;
  delta: number;
  resultingQuantity: number;
  reason: AdjustmentReason;
  note: string | null;
  actorName: string | null;
  createdAt: Date;
};

/* ---------------------------------------------------------------------------
 * Shared shapes
 * ------------------------------------------------------------------------ */

const VARIANT_SELECT = {
  id: true,
  sku: true,
  priceOverride: true,
  stockQuantity: true,
  reservedQuantity: true,
  lowStockThreshold: true,
  isActive: true,
  position: true,
  optionValues: {
    select: {
      optionValue: { select: { value: true, option: { select: { name: true } } } },
    },
  },
} satisfies Prisma.ProductVariantSelect;

type VariantPayload = Prisma.ProductVariantGetPayload<{ select: typeof VARIANT_SELECT }>;

function toVariantRow(variant: VariantPayload, policy: StockPolicy): AdminVariantRow {
  const options: Record<string, string> = {};
  for (const link of variant.optionValues) {
    options[link.optionValue.option.name] = link.optionValue.value;
  }

  return {
    id: variant.id,
    sku: variant.sku,
    options,
    priceOverride: variant.priceOverride,
    stockQuantity: variant.stockQuantity,
    reservedQuantity: variant.reservedQuantity,
    available: availableStock(variant),
    lowStockThreshold: variant.lowStockThreshold,
    isActive: variant.isActive,
    state: stockState(variant, policy),
  };
}

/* ---------------------------------------------------------------------------
 * Reads
 * ------------------------------------------------------------------------ */

export const ADMIN_PAGE_SIZE = 50;

export type ProductListFilters = {
  search?: string | null;
  status?: ProductStatus | null;
  categoryId?: string | null;
};

/**
 * The catalogue list.
 *
 * Search covers the name, the slug and every SKU beneath the product, because
 * the thing the workshop has in front of them is usually a label with a SKU on
 * it rather than a product name.
 */
export async function listAdminProducts(
  filters: ProductListFilters = {},
): Promise<readonly AdminProductRow[]> {
  const search = filters.search?.trim();

  const where: Prisma.ProductWhereInput = {
    deletedAt: null,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { slug: { contains: search, mode: 'insensitive' } },
            { variants: { some: { sku: { contains: search, mode: 'insensitive' } } } },
          ],
        }
      : {}),
  };

  const products = await prisma.product.findMany({
    where,
    orderBy: [{ updatedAt: 'desc' }],
    take: ADMIN_PAGE_SIZE,
    select: {
      id: true,
      slug: true,
      name: true,
      status: true,
      basePrice: true,
      currency: true,
      stockPolicy: true,
      isCustomizable: true,
      updatedAt: true,
      category: { select: { name: true } },
      images: {
        where: { isPrimary: true },
        take: 1,
        select: { storageKey: true },
      },
      variants: { select: VARIANT_SELECT, orderBy: { position: 'asc' } },
    },
  });

  return products.map((product) => {
    const policy = product.stockPolicy as StockPolicy;
    const variants = product.variants.map((variant) => toVariantRow(variant, policy));
    const active = variants.filter((variant) => variant.isActive);

    return {
      id: product.id,
      slug: product.slug,
      name: product.name,
      status: product.status as ProductStatus,
      categoryName: product.category.name,
      basePrice: product.basePrice,
      currency: product.currency,
      stockPolicy: policy,
      isCustomizable: product.isCustomizable,
      variantCount: variants.length,
      availableUnits:
        policy === 'TRACK'
          ? active.reduce((total, variant) => total + variant.available, 0)
          : null,
      alertCount:
        policy === 'TRACK'
          ? active.filter(
              (variant) =>
                variant.state === 'OUT_OF_STOCK' || variant.state === 'LOW_STOCK',
            ).length
          : 0,
      imageSrc: toPublicAssetUrl(product.images[0]?.storageKey),
      updatedAt: product.updatedAt,
    };
  });
}

export async function getAdminProduct(id: string): Promise<AdminProductDetail | null> {
  const product = await prisma.product.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      slug: true,
      name: true,
      subtitle: true,
      description: true,
      categoryId: true,
      status: true,
      basePrice: true,
      compareAtPrice: true,
      currency: true,
      stockPolicy: true,
      material: true,
      careInstructions: true,
      embroideryDetails: true,
      isCustomizable: true,
      isFeatured: true,
      isNewArrival: true,
      isBestSeller: true,
      seoTitle: true,
      seoDescription: true,
      translations: true,
      publishedAt: true,
      createdAt: true,
      updatedAt: true,
      category: { select: { name: true } },
      options: {
        orderBy: { position: 'asc' },
        select: {
          id: true,
          name: true,
          values: { orderBy: { position: 'asc' }, select: { id: true, value: true } },
        },
      },
      variants: { select: VARIANT_SELECT, orderBy: { position: 'asc' } },
      images: {
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          storageKey: true,
          alt: true,
          position: true,
          isPrimary: true,
          width: true,
          height: true,
          surface: true,
          surfaceWidthMm: true,
        },
      },
      _count: { select: { orderItems: true } },
    },
  });

  if (!product) return null;

  const policy = product.stockPolicy as StockPolicy;

  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    subtitle: product.subtitle,
    description: product.description,
    categoryId: product.categoryId,
    categoryName: product.category.name,
    status: product.status as ProductStatus,
    basePrice: product.basePrice,
    compareAtPrice: product.compareAtPrice,
    currency: product.currency,
    stockPolicy: policy,
    material: product.material,
    careInstructions: product.careInstructions,
    embroideryDetails: product.embroideryDetails,
    isCustomizable: product.isCustomizable,
    isFeatured: product.isFeatured,
    isNewArrival: product.isNewArrival,
    isBestSeller: product.isBestSeller,
    seoTitle: product.seoTitle,
    seoDescription: product.seoDescription,
    translations: product.translations,
    publishedAt: product.publishedAt,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
    options: product.options.map((option) => ({
      id: option.id,
      name: option.name,
      values: option.values.map((value) => ({ id: value.id, value: value.value })),
    })),
    variants: product.variants.map((variant) => toVariantRow(variant, policy)),
    images: product.images.map((image) => ({
      id: image.id,
      storageKey: image.storageKey,
      src: toPublicAssetUrl(image.storageKey),
      alt: image.alt,
      position: image.position,
      isPrimary: image.isPrimary,
      width: image.width,
      height: image.height,
      surface: image.surface as DesignSurface | null,
      surfaceWidthMm: image.surfaceWidthMm,
    })),
    orderedCount: product._count.orderItems,
  };
}

export async function listAdminCategories(): Promise<
  readonly { id: string; name: string }[]
> {
  return prisma.category.findMany({
    where: { deletedAt: null },
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true },
  });
}

export type StockFilter = 'all' | 'alert' | 'out' | 'tracked';

/**
 * Every variant the workshop can hold stock for.
 *
 * `MADE_TO_ORDER` and `DONT_TRACK` variants are listed too, because a screen
 * that hides them is a screen that cannot answer "why is this not in the stock
 * list" — but they are never counted as alerts, and the filters make the
 * tracked set one click away.
 */
export async function listStockRows(
  filter: StockFilter = 'all',
  search?: string | null,
): Promise<readonly StockRow[]> {
  const term = search?.trim();

  const variants = await prisma.productVariant.findMany({
    where: {
      product: {
        deletedAt: null,
        status: { not: 'ARCHIVED' },
        ...(filter === 'tracked' || filter === 'alert' || filter === 'out'
          ? { stockPolicy: 'TRACK' }
          : {}),
      },
      ...(term
        ? {
            OR: [
              { sku: { contains: term, mode: 'insensitive' } },
              { product: { name: { contains: term, mode: 'insensitive' } } },
            ],
          }
        : {}),
    },
    orderBy: [{ product: { name: 'asc' } }, { position: 'asc' }],
    take: 400,
    select: {
      ...VARIANT_SELECT,
      product: {
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          stockPolicy: true,
          currency: true,
        },
      },
    },
  });

  const rows = variants.map((variant) => {
    const policy = variant.product.stockPolicy as StockPolicy;

    return {
      ...toVariantRow(variant, policy),
      productId: variant.product.id,
      productName: variant.product.name,
      productSlug: variant.product.slug,
      productStatus: variant.product.status as ProductStatus,
      stockPolicy: policy,
      currency: variant.product.currency,
    };
  });

  // The two alert filters are applied here rather than in SQL: "low" compares
  // `stock - reserved` against a per-variant threshold that falls back to a
  // constant, which is a domain rule (`domain/catalogue`) and not something to
  // restate as a `WHERE` clause that could drift from it.
  if (filter === 'alert') {
    return rows.filter(
      (row) => row.state === 'OUT_OF_STOCK' || row.state === 'LOW_STOCK',
    );
  }
  if (filter === 'out') return rows.filter((row) => row.state === 'OUT_OF_STOCK');

  return rows;
}

/** Variants at or below their threshold. The dashboard's low-stock queue. */
export async function listLowStock(limit = 8): Promise<readonly StockRow[]> {
  const rows = await listStockRows('alert');
  return rows.slice(0, limit);
}

export async function listVariantAdjustments(
  variantId: string,
  limit = 20,
): Promise<readonly AdjustmentRow[]> {
  const rows = await prisma.inventoryAdjustment.findMany({
    where: { variantId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      delta: true,
      resultingQuantity: true,
      reason: true,
      note: true,
      createdAt: true,
      actor: { select: { name: true, email: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    delta: row.delta,
    resultingQuantity: row.resultingQuantity,
    reason: row.reason as AdjustmentReason,
    note: row.note,
    actorName: row.actor?.name ?? row.actor?.email ?? null,
    createdAt: row.createdAt,
  }));
}

export async function getVariantForAdjustment(variantId: string): Promise<{
  id: string;
  sku: string;
  stockQuantity: number;
  reservedQuantity: number;
  productName: string;
  productId: string;
} | null> {
  const variant = await prisma.productVariant.findFirst({
    where: { id: variantId, product: { deletedAt: null } },
    select: {
      id: true,
      sku: true,
      stockQuantity: true,
      reservedQuantity: true,
      product: { select: { id: true, name: true } },
    },
  });

  if (!variant) return null;

  return {
    id: variant.id,
    sku: variant.sku,
    stockQuantity: variant.stockQuantity,
    reservedQuantity: variant.reservedQuantity,
    productName: variant.product.name,
    productId: variant.product.id,
  };
}

/* ---------------------------------------------------------------------------
 * Writes
 * ------------------------------------------------------------------------ */

export type WriteFailure =
  | { code: 'SLUG_TAKEN' }
  | { code: 'SKU_TAKEN' }
  | { code: 'NOT_FOUND' }
  | { code: 'CATEGORY_NOT_FOUND' }
  | { code: 'OPTION_EXISTS' }
  | { code: 'STOCK_REFUSED' };

export type WriteResult<T> =
  { ok: true; value: T } | { ok: false; failure: WriteFailure };

/** Prisma's unique-constraint error, narrowed to the field that collided. */
function uniqueViolationTarget(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  if (candidate.code !== 'P2002') return null;

  const target = candidate.meta?.target;
  if (typeof target === 'string') return target;
  if (Array.isArray(target)) return target.join(',');
  return '';
}

/**
 * The overlay column, as Prisma wants it written.
 *
 * `DbNull` clears the column; `JsonNull` would write the JSON value `null`,
 * which the check constraint refuses — see `prisma/seed.ts` for the same trap.
 */
export function translationWrite(
  value: Record<string, Record<string, string>> | null,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null ? Prisma.DbNull : value;
}

/** The overlay a row already carries, for the merge on save. */
export async function getProductTranslations(id: string): Promise<unknown> {
  const row = await prisma.product.findFirst({
    where: { id, deletedAt: null },
    select: { translations: true },
  });

  return row?.translations ?? null;
}

export async function getCategoryTranslations(id: string): Promise<unknown> {
  const row = await prisma.category.findFirst({
    where: { id, deletedAt: null },
    select: { translations: true },
  });

  return row?.translations ?? null;
}

export type ProductWrite = {
  name: string;
  slug: string;
  subtitle: string | null;
  description: string;
  categoryId: string;
  status: ProductStatus;
  basePrice: number;
  compareAtPrice: number | null;
  stockPolicy: StockPolicy;
  material: string | null;
  careInstructions: string | null;
  embroideryDetails: string | null;
  isCustomizable: boolean;
  isFeatured: boolean;
  isNewArrival: boolean;
  isBestSeller: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  /** The whole overlay column, already merged by the service. */
  translations?: Prisma.InputJsonValue | typeof Prisma.DbNull;
};

/**
 * `publishedAt` is set the first time a product becomes `ACTIVE` and never
 * cleared, because the storefront's visibility predicate reads it and because
 * "when did this first go on sale" is a fact rather than a current state. A
 * product taken down and put back up keeps its original date.
 */
function publishedAtFor(status: ProductStatus, existing: Date | null): Date | null {
  if (existing !== null) return existing;
  return status === 'ACTIVE' ? new Date() : null;
}

/** What both writes return, so a caller never has to narrow between them. */
export type SavedProductRow = {
  id: string;
  slug: string;
  /** The slug this product had before, when the write renamed it. */
  previousSlug: string | null;
};

export async function createProduct(
  write: ProductWrite,
): Promise<WriteResult<SavedProductRow>> {
  try {
    const created = await prisma.product.create({
      data: {
        ...write,
        publishedAt: publishedAtFor(write.status, null),
      },
      select: { id: true, slug: true },
    });

    return { ok: true, value: { ...created, previousSlug: null } };
  } catch (error) {
    if (uniqueViolationTarget(error) !== null)
      return { ok: false, failure: { code: 'SLUG_TAKEN' } };
    if (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: unknown }).code === 'P2003'
    ) {
      return { ok: false, failure: { code: 'CATEGORY_NOT_FOUND' } };
    }
    throw error;
  }
}

/**
 * Update a product, and keep its old URL alive.
 *
 * 11.6: a slug change writes a `product_redirects` row so the address the
 * product earned keeps working. Phase 14 built the *read* side of that table
 * and recorded that nothing wrote to it, because the screen that renames a
 * product did not exist. This is that screen, and this is the write.
 *
 * Both happen in one transaction: a rename that lost its redirect would be a
 * 404 on a URL somebody has already linked to, and there is no way to
 * reconstruct the old slug afterwards.
 */
export async function updateProduct(
  id: string,
  write: ProductWrite,
): Promise<WriteResult<SavedProductRow>> {
  const existing = await prisma.product.findFirst({
    where: { id, deletedAt: null },
    select: { slug: true, publishedAt: true },
  });

  if (!existing) return { ok: false, failure: { code: 'NOT_FOUND' } };

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const product = await tx.product.update({
        where: { id },
        data: {
          ...write,
          publishedAt: publishedAtFor(write.status, existing.publishedAt),
        },
        select: { id: true, slug: true },
      });

      if (existing.slug !== write.slug) {
        // `upsert` rather than `create`: renaming A -> B -> A leaves a row for
        // A pointing at this same product, and re-pointing it is correct.
        await tx.productRedirect.upsert({
          where: { fromSlug: existing.slug },
          create: { fromSlug: existing.slug, productId: id },
          update: { productId: id },
        });

        // A slug that is now in use cannot also be a redirect to somewhere.
        await tx.productRedirect.deleteMany({ where: { fromSlug: write.slug } });
      }

      return product;
    });

    return {
      ok: true,
      value: {
        ...updated,
        previousSlug: existing.slug === updated.slug ? null : existing.slug,
      },
    };
  } catch (error) {
    if (uniqueViolationTarget(error) !== null)
      return { ok: false, failure: { code: 'SLUG_TAKEN' } };
    if (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: unknown }).code === 'P2003'
    ) {
      return { ok: false, failure: { code: 'CATEGORY_NOT_FOUND' } };
    }
    throw error;
  }
}

/**
 * Archive a product.
 *
 * **Not a delete.** `order_items` carry their own name, SKU and price snapshot
 * (ADR-010), so a past order survives a deleted product — but the `product_id`
 * on the line does not, and losing it means losing the ability to open the
 * product from the order. Archiving keeps the row, keeps the URL resolving to a
 * 404 rather than a redirect loop, and takes it off the storefront, which is
 * what "remove a product" means for a shop with history.
 */
export async function setProductStatus(
  id: string,
  status: ProductStatus,
): Promise<WriteResult<{ slug: string }>> {
  const existing = await prisma.product.findFirst({
    where: { id, deletedAt: null },
    select: { slug: true, publishedAt: true },
  });

  if (!existing) return { ok: false, failure: { code: 'NOT_FOUND' } };

  await prisma.product.update({
    where: { id },
    data: { status, publishedAt: publishedAtFor(status, existing.publishedAt) },
  });

  return { ok: true, value: { slug: existing.slug } };
}

export async function createOption(input: {
  productId: string;
  name: string;
  values: readonly string[];
}): Promise<WriteResult<{ id: string }>> {
  try {
    const option = await prisma.productOption.create({
      data: {
        productId: input.productId,
        name: input.name,
        position: await prisma.productOption.count({
          where: { productId: input.productId },
        }),
        values: {
          create: input.values.map((value, index) => ({ value, position: index })),
        },
      },
      select: { id: true },
    });

    return { ok: true, value: option };
  } catch (error) {
    if (uniqueViolationTarget(error) !== null) {
      return { ok: false, failure: { code: 'OPTION_EXISTS' } };
    }
    throw error;
  }
}

export type VariantWrite = {
  sku: string;
  priceOverride: number | null;
  lowStockThreshold: number | null;
  isActive: boolean;
};

/**
 * Add a variant.
 *
 * `stockQuantity` is **not** part of the payload: a variant is created at zero
 * and stocked through an adjustment, so the first units on the shelf are a
 * ledger entry like every other movement. The alternative — a stock field on
 * the create form — would be the one quantity change in the system with no
 * record of who made it.
 */
export async function createVariant(input: {
  productId: string;
  write: VariantWrite;
  optionValueIds: readonly string[];
}): Promise<WriteResult<{ id: string }>> {
  try {
    const variant = await prisma.productVariant.create({
      data: {
        productId: input.productId,
        sku: input.write.sku,
        priceOverride: input.write.priceOverride,
        lowStockThreshold: input.write.lowStockThreshold,
        isActive: input.write.isActive,
        stockQuantity: 0,
        reservedQuantity: 0,
        position: await prisma.productVariant.count({
          where: { productId: input.productId },
        }),
        optionValues: {
          create: input.optionValueIds.map((optionValueId) => ({ optionValueId })),
        },
      },
      select: { id: true },
    });

    return { ok: true, value: variant };
  } catch (error) {
    if (uniqueViolationTarget(error) !== null) {
      return { ok: false, failure: { code: 'SKU_TAKEN' } };
    }
    throw error;
  }
}

export async function updateVariant(
  variantId: string,
  write: VariantWrite,
): Promise<WriteResult<{ productId: string }>> {
  const existing = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: { productId: true },
  });

  if (!existing) return { ok: false, failure: { code: 'NOT_FOUND' } };

  try {
    await prisma.productVariant.update({
      where: { id: variantId },
      data: {
        sku: write.sku,
        priceOverride: write.priceOverride,
        lowStockThreshold: write.lowStockThreshold,
        isActive: write.isActive,
      },
    });

    return { ok: true, value: { productId: existing.productId } };
  } catch (error) {
    if (uniqueViolationTarget(error) !== null) {
      return { ok: false, failure: { code: 'SKU_TAKEN' } };
    }
    throw error;
  }
}

export type AdjustmentApplied = {
  variantId: string;
  productId: string;
  sku: string;
  resultingQuantity: number;
};

/**
 * Move stock, atomically, and write the ledger entry in the same transaction.
 *
 * The `UPDATE` carries its own precondition:
 *
 *     SET stock_quantity = stock_quantity + $delta
 *     WHERE id = $id
 *       AND stock_quantity + $delta >= 0
 *       AND stock_quantity + $delta >= reserved_quantity
 *
 * so the two rules that keep this feature safe — stock never goes negative,
 * stock never drops below what orders have already reserved — are enforced by
 * the row itself rather than by a check the caller performed a moment earlier
 * against a value that has since changed. `domain/catalogue` checks the same
 * two conditions to produce a *message*; this is what makes them true.
 *
 * Zero rows updated therefore means "the precondition no longer holds", and the
 * service re-reads to tell the operator which of the two it was.
 *
 * The delta is applied by the database, never by the client. A form that posted
 * a final quantity would silently discard whatever a shipment did in between.
 */
export async function adjustStock(input: {
  variantId: string;
  delta: number;
  reason: AdjustmentReason;
  note: string | null;
  actorUserId: string;
}): Promise<WriteResult<AdjustmentApplied>> {
  const variant = await prisma.productVariant.findFirst({
    where: { id: input.variantId, product: { deletedAt: null } },
    select: { id: true, sku: true, productId: true },
  });

  if (!variant) return { ok: false, failure: { code: 'NOT_FOUND' } };

  const applied = await prisma.$transaction(async (tx) => {
    const changed = await tx.$executeRaw`
      UPDATE "product_variants"
         SET "stock_quantity" = "stock_quantity" + ${input.delta}
       WHERE "id" = ${input.variantId}::uuid
         AND "stock_quantity" + ${input.delta} >= 0
         AND "stock_quantity" + ${input.delta} >= "reserved_quantity"
    `;

    if (changed === 0) return null;

    const [row] = await tx.$queryRaw<{ stock_quantity: number }[]>`
      SELECT "stock_quantity" FROM "product_variants" WHERE "id" = ${input.variantId}::uuid
    `;

    const resulting = row!.stock_quantity;

    await tx.inventoryAdjustment.create({
      data: {
        variantId: input.variantId,
        delta: input.delta,
        resultingQuantity: resulting,
        reason: input.reason,
        note: input.note,
        actorUserId: input.actorUserId,
      },
    });

    return resulting;
  });

  if (applied === null) return { ok: false, failure: { code: 'STOCK_REFUSED' } };

  return {
    ok: true,
    value: {
      variantId: variant.id,
      productId: variant.productId,
      sku: variant.sku,
      resultingQuantity: applied,
    },
  };
}

/* ---------------------------------------------------------------------------
 * Product images (Phase 14.8)
 * ------------------------------------------------------------------------ */

export type AdminImageRow = {
  id: string;
  storageKey: string;
  src: string | null;
  alt: string;
  position: number;
  isPrimary: boolean;
  width: number | null;
  height: number | null;
  /**
   * Which face of the garment this shows, when it is a placeable blank.
   *
   * Null is the ordinary case and the default: a photograph sells the product
   * and nothing is dropped onto it. It becomes a surface only when the owner
   * says which face it is (ADR-035).
   */
  surface: DesignSurface | null;
  /** How wide the garment really is across this picture. Null is unmeasured. */
  surfaceWidthMm: number | null;
};

/**
 * Every image on a product, in the order the storefront shows them.
 *
 * Ordered by `position` with the id as a tie-break, so the sequence is total:
 * two rows that somehow share a position must not swap places between two
 * renders of the same page.
 */
export async function listProductImages(
  productId: string,
): Promise<readonly AdminImageRow[]> {
  const rows = await prisma.productImage.findMany({
    where: { productId },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      storageKey: true,
      alt: true,
      position: true,
      isPrimary: true,
      width: true,
      height: true,
      surface: true,
      surfaceWidthMm: true,
    },
  });

  return rows.map((row) => ({
    ...row,
    surface: row.surface as DesignSurface | null,
    src: toPublicAssetUrl(row.storageKey),
  }));
}

/**
 * Say which face a photograph shows, and how wide the garment is in it.
 *
 * The two settings that turn a picture into something a customer can drop a
 * design onto. They are written together because they are useless apart: a face
 * with no measurement cannot be ordered from, and a measurement with no face
 * belongs to nothing. Clearing the surface clears the measurement with it,
 * rather than leaving a number attached to an ordinary catalogue picture where
 * it would look like data somebody meant.
 */
export async function setImageSurface(input: {
  imageId: string;
  surface: DesignSurface | null;
  surfaceWidthMm: number | null;
}): Promise<WriteResult<{ productId: string }>> {
  const image = await prisma.productImage.findUnique({
    where: { id: input.imageId },
    select: { productId: true },
  });

  if (!image) return { ok: false, failure: { code: 'NOT_FOUND' } };

  await prisma.productImage.update({
    where: { id: input.imageId },
    data: {
      surface: input.surface,
      surfaceWidthMm: input.surface === null ? null : input.surfaceWidthMm,
    },
  });

  return { ok: true, value: { productId: image.productId } };
}

/* ---------------------------------------------------------------------------
 * Models in three dimensions
 * ------------------------------------------------------------------------ */

export type AdminModelRow = {
  id: string;
  storageKey: string;
  src: string | null;
  byteSize: number;
  materialName: string;
  surfaceWidthMm: number | null;
  label: string | null;
  isActive: boolean;
};

export async function listProductModels(
  productId: string,
): Promise<readonly AdminModelRow[]> {
  const rows = await prisma.productModel3d.findMany({
    where: { productId },
    orderBy: [{ createdAt: 'asc' }],
    select: {
      id: true,
      storageKey: true,
      byteSize: true,
      materialName: true,
      surfaceWidthMm: true,
      label: true,
      isActive: true,
    },
  });

  return rows.map((row) => ({ ...row, src: toPublicAssetUrl(row.storageKey) }));
}

/**
 * Attach an inspected model to a product.
 *
 * The object is written and parsed by the service before this row exists, for
 * the same reason a photograph is: a row pointing at bytes nobody has examined
 * is a promise the storage layer cannot keep.
 */
export async function addProductModel(input: {
  productId: string;
  storageKey: string;
  byteSize: number;
  materialName: string;
  surfaceWidthMm: number | null;
  label: string | null;
}): Promise<WriteResult<AdminModelRow>> {
  const product = await prisma.product.findFirst({
    where: { id: input.productId, deletedAt: null },
    select: { id: true },
  });

  if (!product) return { ok: false, failure: { code: 'NOT_FOUND' } };

  const created = await prisma.productModel3d.create({
    data: {
      productId: input.productId,
      storageKey: input.storageKey,
      byteSize: input.byteSize,
      materialName: input.materialName,
      surfaceWidthMm: input.surfaceWidthMm,
      label: input.label,
    },
    select: {
      id: true,
      storageKey: true,
      byteSize: true,
      materialName: true,
      surfaceWidthMm: true,
      label: true,
      isActive: true,
    },
  });

  return { ok: true, value: { ...created, src: toPublicAssetUrl(created.storageKey) } };
}

export async function updateProductModel(input: {
  modelId: string;
  materialName?: string;
  surfaceWidthMm?: number | null;
  isActive?: boolean;
}): Promise<WriteResult<{ productId: string }>> {
  const model = await prisma.productModel3d.findUnique({
    where: { id: input.modelId },
    select: { productId: true },
  });

  if (!model) return { ok: false, failure: { code: 'NOT_FOUND' } };

  await prisma.productModel3d.update({
    where: { id: input.modelId },
    data: {
      ...(input.materialName === undefined ? {} : { materialName: input.materialName }),
      ...(input.surfaceWidthMm === undefined
        ? {}
        : { surfaceWidthMm: input.surfaceWidthMm }),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
    },
  });

  return { ok: true, value: { productId: model.productId } };
}

/** Remove the row, and hand back the key so the caller can delete the bytes. */
export async function deleteProductModel(
  modelId: string,
): Promise<WriteResult<{ productId: string; storageKey: string }>> {
  const model = await prisma.productModel3d.findUnique({
    where: { id: modelId },
    select: { productId: true, storageKey: true },
  });

  if (!model) return { ok: false, failure: { code: 'NOT_FOUND' } };

  await prisma.productModel3d.delete({ where: { id: modelId } });

  return { ok: true, value: model };
}

/**
 * Attach an uploaded image to a product.
 *
 * The object is already written and verified by the service; this is the row
 * that makes it visible. Two rules are enforced here rather than left to the
 * caller:
 *
 *   - **it goes last**, so uploading never silently changes which photograph is
 *     on the product card;
 *   - **the first one is primary**, because a product whose only image is not
 *     its main image has no main image.
 */
export async function addProductImage(input: {
  productId: string;
  storageKey: string;
  alt: string;
  width: number;
  height: number;
  blurDataUrl: string;
}): Promise<WriteResult<AdminImageRow>> {
  const product = await prisma.product.findFirst({
    where: { id: input.productId, deletedAt: null },
    select: { id: true },
  });

  if (!product) return { ok: false, failure: { code: 'NOT_FOUND' } };

  const existing = await prisma.productImage.count({ where: { productId: product.id } });

  const created = await prisma.productImage.create({
    data: {
      productId: product.id,
      storageKey: input.storageKey,
      alt: input.alt,
      width: input.width,
      height: input.height,
      blurDataUrl: input.blurDataUrl,
      position: existing,
      isPrimary: existing === 0,
    },
    select: {
      id: true,
      storageKey: true,
      alt: true,
      position: true,
      isPrimary: true,
      width: true,
      height: true,
      surface: true,
      surfaceWidthMm: true,
    },
  });

  return {
    ok: true,
    value: {
      ...created,
      surface: created.surface as DesignSurface | null,
      src: toPublicAssetUrl(created.storageKey),
    },
  };
}

export async function updateImageAlt(input: {
  imageId: string;
  alt: string;
}): Promise<WriteResult<{ productId: string }>> {
  const image = await prisma.productImage.findUnique({
    where: { id: input.imageId },
    select: { productId: true },
  });

  if (!image) return { ok: false, failure: { code: 'NOT_FOUND' } };

  await prisma.productImage.update({
    where: { id: input.imageId },
    data: { alt: input.alt },
  });

  return { ok: true, value: { productId: image.productId } };
}

/**
 * Remove an image, and hand back the object key so the caller can delete the
 * bytes.
 *
 * The row goes first and the object second, deliberately: an orphaned object is
 * invisible and costs a few kilobytes, while a row pointing at bytes that are
 * gone is a broken image on the shop. If the object delete fails afterwards,
 * the sweep that already exists for stale uploads is the right place to catch
 * it — not a rollback that would put a broken row back.
 *
 * Promotion of the next image to primary happens in the same transaction, so
 * deleting the main photograph never leaves a product without one.
 */
export async function deleteProductImage(
  imageId: string,
): Promise<WriteResult<{ productId: string; storageKey: string }>> {
  const image = await prisma.productImage.findUnique({
    where: { id: imageId },
    select: { id: true, productId: true, storageKey: true, isPrimary: true },
  });

  if (!image) return { ok: false, failure: { code: 'NOT_FOUND' } };

  await prisma.$transaction(async (tx) => {
    await tx.productImage.delete({ where: { id: imageId } });

    const remaining = await tx.productImage.findMany({
      where: { productId: image.productId },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });

    for (const [index, row] of remaining.entries()) {
      await tx.productImage.update({
        where: { id: row.id },
        data: { position: index, isPrimary: image.isPrimary ? index === 0 : undefined },
      });
    }
  });

  return {
    ok: true,
    value: { productId: image.productId, storageKey: image.storageKey },
  };
}

/**
 * Write a new order for one product's images.
 *
 * Takes the whole sequence rather than a pair to swap: the caller computed it
 * with `movedOrder`, and writing positions 0…n in one transaction is what makes
 * the result independent of what the positions were before. Anything not in the
 * list, or belonging to another product, is refused rather than reordered.
 */
export async function reorderProductImages(input: {
  productId: string;
  orderedIds: readonly string[];
}): Promise<WriteResult<{ productId: string }>> {
  const owned = await prisma.productImage.findMany({
    where: { productId: input.productId },
    select: { id: true },
  });

  const ownedIds = new Set(owned.map((row) => row.id));
  const requested = new Set(input.orderedIds);

  if (ownedIds.size !== requested.size)
    return { ok: false, failure: { code: 'NOT_FOUND' } };
  for (const id of requested) {
    if (!ownedIds.has(id)) return { ok: false, failure: { code: 'NOT_FOUND' } };
  }

  await prisma.$transaction(
    input.orderedIds.map((id, index) =>
      prisma.productImage.update({ where: { id }, data: { position: index } }),
    ),
  );

  return { ok: true, value: { productId: input.productId } };
}

/** Which product an image belongs to, or null when it no longer exists. */
export async function findImageProduct(imageId: string): Promise<string | null> {
  const image = await prisma.productImage.findUnique({
    where: { id: imageId },
    select: { productId: true },
  });

  return image?.productId ?? null;
}

/** Exactly one image carries the flag, in one transaction. */
export async function setPrimaryProductImage(
  imageId: string,
): Promise<WriteResult<{ productId: string }>> {
  const image = await prisma.productImage.findUnique({
    where: { id: imageId },
    select: { id: true, productId: true },
  });

  if (!image) return { ok: false, failure: { code: 'NOT_FOUND' } };

  await prisma.$transaction([
    prisma.productImage.updateMany({
      where: { productId: image.productId },
      data: { isPrimary: false },
    }),
    prisma.productImage.update({ where: { id: imageId }, data: { isPrimary: true } }),
  ]);

  return { ok: true, value: { productId: image.productId } };
}

/* ---------------------------------------------------------------------------
 * Categories
 * ------------------------------------------------------------------------ */

export type AdminCategoryRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  position: number;
  isActive: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  /** The overlay column, so the form can show what is already translated. */
  translations: unknown;
  /** Products of any status that sit in it. */
  products: number;
  /** Of those, the ones a customer can see right now. */
  liveProducts: number;
};

const CATEGORY_SELECT = {
  id: true,
  slug: true,
  name: true,
  description: true,
  position: true,
  isActive: true,
  seoTitle: true,
  seoDescription: true,
  translations: true,
  _count: {
    select: {
      products: { where: { deletedAt: null } },
    },
  },
} as const;

/**
 * Both counts, in one extra query rather than one per row.
 *
 * Prisma will count a filtered relation inside a `select`, but only once per
 * relation — and this screen needs two different counts of the same relation:
 * everything in the category, and the live half of it. The second is a
 * `groupBy` over the products, joined in memory over a handful of rows.
 */
async function liveProductCounts(): Promise<Map<string, number>> {
  const rows = await prisma.product.groupBy({
    by: ['categoryId'],
    where: publiclyVisibleWhere(),
    _count: { _all: true },
  });

  return new Map(rows.map((row) => [row.categoryId, row._count._all]));
}

/**
 * Every category the workshop has, with what is in it.
 *
 * Inactive ones included: this is the screen where somebody turns one back on,
 * so hiding them here would make that impossible. Soft-deleted ones are
 * excluded — nothing in the application deletes a category, and the column is
 * there for a future that has not happened.
 */
export async function listAdminCategoryRows(): Promise<readonly AdminCategoryRow[]> {
  const [rows, live] = await Promise.all([
    prisma.category.findMany({
      where: { deletedAt: null },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      select: CATEGORY_SELECT,
    }),
    liveProductCounts(),
  ]);

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    position: row.position,
    isActive: row.isActive,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    translations: row.translations,
    products: row._count.products,
    liveProducts: live.get(row.id) ?? 0,
  }));
}

export async function getAdminCategory(id: string): Promise<AdminCategoryRow | null> {
  const [row, live] = await Promise.all([
    prisma.category.findFirst({
      where: { id, deletedAt: null },
      select: CATEGORY_SELECT,
    }),
    liveProductCounts(),
  ]);

  if (!row) return null;

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    position: row.position,
    isActive: row.isActive,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    translations: row.translations,
    products: row._count.products,
    liveProducts: live.get(row.id) ?? 0,
  };
}

export type CategoryWrite = {
  name: string;
  slug: string;
  description: string | null;
  position: number;
  isActive: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  /** The whole overlay column, already merged by the service. */
  translations?: Prisma.InputJsonValue | typeof Prisma.DbNull;
};

export type SavedCategoryRow = {
  id: string;
  slug: string;
  /** Non-null only when the write renamed the category's address. */
  previousSlug: string | null;
};

export async function createCategory(
  write: CategoryWrite,
): Promise<WriteResult<SavedCategoryRow>> {
  try {
    const created = await prisma.category.create({
      data: write,
      select: { id: true, slug: true },
    });

    return { ok: true, value: { ...created, previousSlug: null } };
  } catch (error) {
    if (uniqueViolationTarget(error) !== null) {
      return { ok: false, failure: { code: 'SLUG_TAKEN' } };
    }
    throw error;
  }
}

/**
 * Update a category.
 *
 * **No redirect table for a renamed category**, unlike a product. `11.6` gives
 * products that guarantee because a product URL is what a customer is sent and
 * what a search engine ranks; a category listing is navigation, reachable from
 * the chip row on every catalogue page, and building a second redirect table
 * for it would be machinery for a URL nobody bookmarks. The old address 404s,
 * which is the honest answer for a shelf that was renamed.
 *
 * The previous slug comes back regardless, because the caller has a cached page
 * at the old address to invalidate.
 */
export async function updateCategory(
  id: string,
  write: CategoryWrite,
): Promise<WriteResult<SavedCategoryRow>> {
  const existing = await prisma.category.findFirst({
    where: { id, deletedAt: null },
    select: { slug: true },
  });

  if (!existing) return { ok: false, failure: { code: 'NOT_FOUND' } };

  try {
    const saved = await prisma.category.update({
      where: { id },
      data: write,
      select: { id: true, slug: true },
    });

    return {
      ok: true,
      value: {
        ...saved,
        previousSlug: existing.slug === saved.slug ? null : existing.slug,
      },
    };
  } catch (error) {
    if (uniqueViolationTarget(error) !== null) {
      return { ok: false, failure: { code: 'SLUG_TAKEN' } };
    }
    throw error;
  }
}

/** How many live products a category holds, for the deactivation rule. */
export async function countLiveProductsInCategory(categoryId: string): Promise<number> {
  return prisma.product.count({
    where: { categoryId, ...publiclyVisibleWhere() },
  });
}
