import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PackagePlus } from 'lucide-react';

import { BulkArchive, SelectAllCell, SelectCell } from '@/components/admin/bulk-archive';
import { Badge, EmptyState } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { FilterBar, FilterLink, PageHeader } from '@/components/ui/page-header';
import { Link } from '@/components/ui/link';
import { Price } from '@/components/commerce/price';
import { Stack } from '@/components/layout/layout';
import { Text } from '@/components/ui/typography';
import {
  Table,
  TableBody,
  TableCell,
  TableCellMeta,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableRowLink,
  TableToolbar,
} from '@/components/ui/table';
import {
  PRODUCT_STATUSES,
  PRODUCT_STATUS_LABELS,
  STOCK_POLICY_LABELS,
  type ProductStatus,
} from '@/domain/catalogue';
import { formatDate } from '@/i18n/format';
import { workshopDictionary } from '@/i18n/server';
import { requireStaff } from '@/server/auth/guards';
import {
  listAdminProducts,
  type AdminProductRow,
} from '@/server/repositories/catalogue-admin-repository';

import { ProductSearch } from './product-search';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await workshopDictionary();
  return { title: t.admin.navProducts };
}

export const dynamic = 'force-dynamic';

function isProductStatus(value: string | undefined): value is ProductStatus {
  return value !== undefined && (PRODUCT_STATUSES as readonly string[]).includes(value);
}

function StatusBadge({ status }: { status: ProductStatus }) {
  const tone =
    status === 'ACTIVE' ? 'positive' : status === 'DRAFT' ? 'attention' : 'neutral';

  return <Badge tone={tone}>{PRODUCT_STATUS_LABELS[status]}</Badge>;
}

/**
 * Stock, in one column.
 *
 * A tracked product shows units and, when any variant is low or out, says so —
 * the count alone hides the case where 40 units are all one size and the other
 * three are empty. An untracked one says which policy it is under rather than
 * printing a zero that means nothing.
 */
function StockCell({ product }: { product: AdminProductRow }) {
  if (product.availableUnits === null) {
    return (
      <Text variant="body-sm" tone="subtle" as="span">
        {STOCK_POLICY_LABELS[product.stockPolicy]}
      </Text>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <span className="tabular-nums">{product.availableUnits}</span>
      {product.alertCount > 0 && (
        <Badge tone={product.availableUnits === 0 ? 'negative' : 'attention'}>
          {product.alertCount === 1
            ? '1 variante en alerte'
            : `${product.alertCount} variantes en alerte`}
        </Badge>
      )}
    </span>
  );
}

/**
 * The catalogue.
 *
 * The screen that did not exist. Until Phase 14.5 the only way a product
 * entered this shop was the seed script, which meant the business could not add
 * the thing it sells without a developer and a deploy — recorded phase after
 * phase as "Phase 6's unfinished half".
 *
 * Filters are links, so a filtered catalogue is a URL. Search is a form that
 * submits to the same URL, so it is one too.
 */
export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { locale, t } = await workshopDictionary();
  const authorisation = await requireStaff();
  if (!authorisation.ok) notFound();

  const { status, q } = await searchParams;
  const filter = isProductStatus(status) ? status : null;
  const search = q?.trim() ?? '';

  const products = await listAdminProducts({
    status: filter,
    search: search.length > 0 ? search : null,
  });

  /*
   * The catalogue has no separate archive tab, because it already had one.
   * A product's archived-ness is `products.status`, which is customer-facing —
   * an archived product leaves the shop — so the `Archivé` filter that has
   * been on this screen since Phase 14.5 *is* the archive view, and adding a
   * second switch beside it would give the same product two kinds of archived.
   * Ticking rows in that view restores them to drafts; ticking them anywhere
   * else archives them, and a published one is refused (ADR-034).
   */
  const archived = filter === 'ARCHIVED';

  function hrefFor(candidate: ProductStatus | null): string {
    const params = new URLSearchParams();
    if (candidate) params.set('status', candidate);
    if (search) params.set('q', search);
    const query = params.toString();
    return query ? `/admin/products?${query}` : '/admin/products';
  }

  return (
    <Stack gap={6}>
      <PageHeader
        title="Produits"
        description={t.admin.productsLead}
        actions={
          <Button asChild leadingIcon={<PackagePlus className="size-4" />}>
            <Link href="/admin/products/new" variant="plain">
              {t.admin.newProduct}
            </Link>
          </Button>
        }
      />

      <TableToolbar actions={<ProductSearch defaultValue={search} status={filter} />}>
        <FilterBar label={t.admin.filterByState}>
          <FilterLink href={hrefFor(null)} current={filter === null}>
            Tous
          </FilterLink>
          {PRODUCT_STATUSES.map((candidate) => (
            <FilterLink
              key={candidate}
              href={hrefFor(candidate)}
              current={filter === candidate}
            >
              {PRODUCT_STATUS_LABELS[candidate]}
            </FilterLink>
          ))}
        </FilterBar>
      </TableToolbar>

      {products.length === 0 ? (
        <EmptyState
          icon={<PackagePlus />}
          title={search || filter ? t.admin.noProductMatches : t.admin.catalogueEmpty}
          description={
            search || filter
              ? 'Modifiez la recherche ou le filtre.'
              : t.admin.createFirstProduct
          }
          action={
            search || filter ? undefined : (
              <Button asChild>
                <Link href="/admin/products/new" variant="plain">
                  {t.admin.newProduct}
                </Link>
              </Button>
            )
          }
        />
      ) : (
        <BulkArchive
          entity="product"
          archived={archived}
          ids={products.map((product) => product.id)}
        >
          <div className="border-border bg-surface overflow-hidden rounded-md border max-md:border-0 max-md:bg-transparent">
            <Table caption="Catalogue des produits">
              <TableHead>
                <TableRow>
                  <SelectAllCell />
                  <TableHeaderCell>{t.admin.colProduct}</TableHeaderCell>
                  <TableHeaderCell>{t.admin.colCategory}</TableHeaderCell>
                  <TableHeaderCell>État</TableHeaderCell>
                  <TableHeaderCell align="end" numeric>
                    Prix
                  </TableHeaderCell>
                  <TableHeaderCell align="end" numeric>
                    Variantes
                  </TableHeaderCell>
                  <TableHeaderCell align="end">{t.admin.colStock}</TableHeaderCell>
                  <TableHeaderCell align="end">{t.admin.colModified}</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {products.map((product) => (
                  <TableRow key={product.id}>
                    <SelectCell id={product.id} label={product.name} />
                    <TableCell label={t.admin.colProduct} bare>
                      <TableRowLink href={`/admin/products/${product.id}`}>
                        {product.name}
                      </TableRowLink>
                      <TableCellMeta>
                        /{product.slug}
                        {product.isCustomizable ? ' · personnalisable' : ''}
                      </TableCellMeta>
                    </TableCell>
                    <TableCell label={t.admin.colCategory}>
                      {product.categoryName}
                    </TableCell>
                    <TableCell label="État">
                      <StatusBadge status={product.status} />
                    </TableCell>
                    <TableCell label="Prix" align="end" numeric>
                      <Price
                        amount={product.basePrice}
                        currency={product.currency}
                        size="sm"
                      />
                    </TableCell>
                    <TableCell label="Variantes" align="end" numeric>
                      {product.variantCount}
                    </TableCell>
                    <TableCell label={t.admin.colStock} align="end">
                      <StockCell product={product} />
                    </TableCell>
                    <TableCell label={t.admin.colModified} align="end">
                      <Text variant="caption" tone="subtle" as="span">
                        {formatDate(product.updatedAt, locale, 'medium')}
                      </Text>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </BulkArchive>
      )}
    </Stack>
  );
}
