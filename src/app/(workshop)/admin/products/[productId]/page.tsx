import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Boxes, ExternalLink, Plus } from 'lucide-react';

import { Alert, Badge, EmptyState } from '@/components/ui/feedback';
import { Breadcrumbs } from '@/components/ui/navigation';
import { Button } from '@/components/ui/button';
import { Heading, Text } from '@/components/ui/typography';
import { Link } from '@/components/ui/link';
import { PageHeader } from '@/components/ui/page-header';
import { Price } from '@/components/commerce/price';
import { Stack } from '@/components/layout/layout';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui/table';
import {
  PRODUCT_STATUS_LABELS,
  STOCK_STATE_LABELS,
  isStockAlert,
  type StockState,
} from '@/domain/catalogue';
import { workshopDictionary } from '@/i18n/server';
import { requireStaff } from '@/server/auth/guards';
import {
  getAdminProduct,
  listAdminCategories,
  listProductModels,
} from '@/server/repositories/catalogue-admin-repository';

import { ProductForm } from '../product-form';
import { ProductImages } from './product-images';
import { ProductModels } from './product-models';
import { ProductStatusActions } from './status-actions';
import { AddOptionButton, VariantDialog } from './variant-editor';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ productId: string }>;
}): Promise<Metadata> {
  const { productId } = await params;
  const product = await getAdminProduct(productId);

  return { title: product?.name ?? 'Produit' };
}

function stateTone(state: StockState): 'positive' | 'attention' | 'negative' | 'neutral' {
  if (state === 'OUT_OF_STOCK') return 'negative';
  if (state === 'LOW_STOCK') return 'attention';
  if (state === 'IN_STOCK') return 'positive';
  return 'neutral';
}

/**
 * One product: its fields, its options, its variants.
 *
 * The order is the order the work happens in — the fiche first, then the axes
 * of choice, then the sellable combinations — and each section says what it is
 * for rather than assuming the operator knows the schema.
 *
 * **Historical orders are never touched from here.** `order_items` carry their
 * own name, SKU, unit price and customisation snapshot (ADR-010 and ADR-016),
 * so renaming a product, changing its price or deactivating a variant changes
 * what is for sale and nothing about what was sold. The page says so where
 * somebody would worry about it.
 */
export default async function AdminProductPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { t } = await workshopDictionary();
  const authorisation = await requireStaff();
  if (!authorisation.ok) notFound();

  const { productId } = await params;
  const [product, categories, models] = await Promise.all([
    getAdminProduct(productId),
    listAdminCategories(),
    listProductModels(productId),
  ]);

  if (!product) notFound();

  const options = product.options;

  return (
    <Stack gap={6}>
      <Breadcrumbs
        items={[{ label: 'Produits', href: '/admin/products' }, { label: product.name }]}
      />

      <PageHeader
        eyebrow={PRODUCT_STATUS_LABELS[product.status]}
        title={product.name}
        description={`/shop/${product.slug} · ${product.categoryName}`}
        actions={
          <>
            {product.status === 'ACTIVE' && (
              <Button asChild variant="ghost" size="sm">
                <Link
                  href={`/shop/${product.slug}`}
                  variant="plain"
                  className="inline-flex items-center gap-1.5"
                >
                  {t.admin.seePage}
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                </Link>
              </Button>
            )}
            <ProductStatusActions productId={product.id} status={product.status} />
          </>
        }
      />

      {product.orderedCount > 0 && (
        <Alert tone="info" title={t.admin.productOrdered}>
          {t.admin.orderLines(product.orderedCount)} {t.admin.orderedSnapshotNote}
        </Alert>
      )}

      <ProductForm
        currency={product.currency}
        categories={categories}
        values={{
          id: product.id,
          name: product.name,
          slug: product.slug,
          subtitle: product.subtitle ?? '',
          description: product.description,
          categoryId: product.categoryId,
          status: product.status,
          basePrice: String(product.basePrice),
          compareAtPrice: product.compareAtPrice?.toString() ?? '',
          stockPolicy: product.stockPolicy,
          material: product.material ?? '',
          careInstructions: product.careInstructions ?? '',
          embroideryDetails: product.embroideryDetails ?? '',
          isCustomizable: product.isCustomizable,
          isFeatured: product.isFeatured,
          isNewArrival: product.isNewArrival,
          isBestSeller: product.isBestSeller,
          seoTitle: product.seoTitle ?? '',
          seoDescription: product.seoDescription ?? '',
          translations: product.translations,
        }}
      />

      {/* ------------------------------------------------------------ options */}
      <section className="border-border bg-surface flex flex-col gap-5 rounded-md border p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <Heading level={2} variant="heading-md">
              {t.admin.options}
            </Heading>
            <Text variant="body-sm" tone="muted" className="max-w-prose">
              Les axes de choix du produit — une taille, une couleur. Une variante est une
              combinaison de leurs valeurs.
            </Text>
          </div>
          <AddOptionButton productId={product.id} />
        </div>

        {options.length === 0 ? (
          <Text variant="body-sm" tone="subtle">
            {t.admin.noOptionNote}
          </Text>
        ) : (
          <dl className="flex flex-col gap-3">
            {options.map((option) => (
              <div
                key={option.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
              >
                <dt className="text-body-sm text-fg font-medium">{option.name}</dt>
                <dd className="flex flex-wrap gap-1.5">
                  {option.values.map((value) => (
                    <Badge key={value.id} variant="outline">
                      {value.value}
                    </Badge>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      {/* ----------------------------------------------------------- variants */}
      <section className="border-border bg-surface flex flex-col gap-5 rounded-md border p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <Heading level={2} variant="heading-md">
              {t.admin.variants}
            </Heading>
            <Text variant="body-sm" tone="muted" className="max-w-prose">
              {t.admin.variantsLead}
            </Text>
          </div>

          <VariantDialog
            productId={product.id}
            variant={null}
            options={options}
            currency={product.currency}
            trigger={
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<Plus className="size-4" />}
              >
                {t.admin.addVariant}
              </Button>
            }
          />
        </div>

        {product.variants.length === 0 ? (
          <EmptyState
            icon={<Boxes />}
            title={t.admin.noVariant}
            description="Un produit sans variante active n’est pas vendable, même en ligne. Ajoutez-en une."
          />
        ) : (
          <Table caption={t.admin.variantsOf(product.name)}>
            <TableHead>
              <TableRow>
                <TableHeaderCell>SKU</TableHeaderCell>
                <TableHeaderCell>{t.admin.options}</TableHeaderCell>
                <TableHeaderCell align="end" numeric>
                  {t.admin.colPrice}
                </TableHeaderCell>
                <TableHeaderCell align="end" numeric>
                  {t.admin.colStock}
                </TableHeaderCell>
                <TableHeaderCell align="end" numeric>
                  {t.admin.colReserved}
                </TableHeaderCell>
                <TableHeaderCell align="end">État</TableHeaderCell>
                <TableHeaderCell align="end">Action</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {product.variants.map((variant) => {
                const combination = Object.entries(variant.options)
                  .map(([name, value]) => `${name} : ${value}`)
                  .join(' · ');

                return (
                  <TableRow key={variant.id}>
                    <TableCell label="SKU" bare>
                      <span className="font-mono text-mono">{variant.sku}</span>
                    </TableCell>
                    <TableCell label={t.admin.options}>
                      {combination === '' ? (
                        <Text variant="body-sm" tone="subtle" as="span">
                          Taille unique
                        </Text>
                      ) : (
                        combination
                      )}
                    </TableCell>
                    <TableCell label={t.admin.colPrice} align="end" numeric>
                      <Price
                        amount={variant.priceOverride ?? product.basePrice}
                        currency={product.currency}
                        size="sm"
                      />
                    </TableCell>
                    <TableCell label={t.admin.colStock} align="end" numeric>
                      {variant.stockQuantity}
                    </TableCell>
                    <TableCell label={t.admin.colReserved} align="end" numeric>
                      {variant.reservedQuantity}
                    </TableCell>
                    <TableCell label="État" align="end">
                      <Badge tone={stateTone(variant.state)}>
                        {STOCK_STATE_LABELS[variant.state]}
                        {isStockAlert(variant.state) && variant.available > 0
                          ? ` · ${variant.available}`
                          : ''}
                      </Badge>
                    </TableCell>
                    <TableCell label="Action" align="end">
                      <VariantDialog
                        productId={product.id}
                        variant={{
                          id: variant.id,
                          sku: variant.sku,
                          priceOverride: variant.priceOverride,
                          lowStockThreshold: variant.lowStockThreshold,
                          isActive: variant.isActive,
                        }}
                        options={options}
                        currency={product.currency}
                        trigger={
                          <Button variant="ghost" size="sm">
                            Éditer
                          </Button>
                        }
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        <Text variant="caption" tone="subtle">
          Pour approvisionner ou corriger une quantité, passez par{' '}
          <Link href={`/admin/stock?q=${encodeURIComponent(product.name)}`}>
            {t.admin.stockScreenLink}
          </Link>
          .
        </Text>
      </section>

      {/* ------------------------------------------------------------- images */}
      <section
        aria-labelledby="product-images"
        className="border-border bg-surface flex flex-col gap-4 rounded-md border p-5 md:p-6"
      >
        <Heading level={2} variant="heading-md" id="product-images">
          Photographies
        </Heading>

        {/*
         * The first image is the one on the product card and in every social
         * card; the rest are the gallery, in this order. Uploading re-encodes
         * and strips EXIF server-side before anything reaches a public URL
         * (`server/services/media-service`).
         */}
        <ProductImages productId={product.id} images={product.images} />

        <ProductModels productId={product.id} models={models} />
      </section>
    </Stack>
  );
}
