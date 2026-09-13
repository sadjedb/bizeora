import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Boxes } from 'lucide-react';

import { Badge, EmptyState } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { FilterBar, FilterLink, PageHeader } from '@/components/ui/page-header';
import { Link } from '@/components/ui/link';
import { Stack } from '@/components/layout/layout';
import { StatGrid, StatTile } from '@/components/ui/stat';
import { Text } from '@/components/ui/typography';
import {
  Table,
  TableBody,
  TableCell,
  TableCellMeta,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableRowAction,
  TableToolbar,
} from '@/components/ui/table';
import {
  STOCK_POLICY_LABELS,
  STOCK_STATE_LABELS,
  type StockState,
} from '@/domain/catalogue';
import { workshopDictionary } from '@/i18n/server';
import { requireStaff } from '@/server/auth/guards';
import {
  listStockRows,
  type StockFilter,
} from '@/server/repositories/catalogue-admin-repository';

import { ProductSearch } from '../products/product-search';
import { AdjustStockDialog } from './adjust-dialog';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await workshopDictionary();
  return { title: t.admin.navStock };
}

export const dynamic = 'force-dynamic';

const FILTERS: readonly { value: StockFilter; label: string }[] = [
  { value: 'all', label: 'Toutes les variantes' },
  { value: 'tracked', label: 'Stock suivi' },
  { value: 'alert', label: 'En alerte' },
  { value: 'out', label: 'En rupture' },
];

function isFilter(value: string | undefined): value is StockFilter {
  return FILTERS.some((entry) => entry.value === value);
}

function stateTone(state: StockState): 'positive' | 'attention' | 'negative' | 'neutral' {
  if (state === 'OUT_OF_STOCK') return 'negative';
  if (state === 'LOW_STOCK') return 'attention';
  if (state === 'IN_STOCK') return 'positive';
  return 'neutral';
}

/**
 * Stock.
 *
 * The screen the workshop did not have: until Phase 14.5 the only way to change
 * a quantity was a SQL client, and the only record of the change was that the
 * number was different.
 *
 * Three things it deliberately is:
 *
 * **A list of variants, not of products.** 10.1 tracks stock per variant, and a
 * product-level total hides the case where the forty units are all one size.
 *
 * **Honest about what it cannot count.** `MADE_TO_ORDER` and `DONT_TRACK`
 * variants are listed with their policy instead of a quantity, because a zero
 * next to a made-to-order blank reads as a rupture and is not one.
 *
 * **A ledger, not a field.** Every movement goes through `AdjustStockDialog`
 * with a signed delta and a reason, and lands in `inventory_adjustments`
 * (ADR-029). There is no editable quantity anywhere on this page.
 */
export default async function AdminStockPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; q?: string }>;
}) {
  const { t } = await workshopDictionary();
  const authorisation = await requireStaff();
  if (!authorisation.ok) notFound();

  const { filter: rawFilter, q } = await searchParams;
  const filter: StockFilter = isFilter(rawFilter) ? rawFilter : 'all';
  const search = q?.trim() ?? '';

  const rows = await listStockRows(filter, search.length > 0 ? search : null);

  // The counts are over the rows this filter returned, so the tiles describe
  // what is on the screen rather than a global figure the list contradicts.
  const tracked = rows.filter((row) => row.stockPolicy === 'TRACK');
  const out = tracked.filter((row) => row.state === 'OUT_OF_STOCK').length;
  const low = tracked.filter((row) => row.state === 'LOW_STOCK').length;
  const units = tracked.reduce((total, row) => total + row.available, 0);

  function hrefFor(candidate: StockFilter): string {
    const params = new URLSearchParams();
    if (candidate !== 'all') params.set('filter', candidate);
    if (search) params.set('q', search);
    const query = params.toString();
    return query ? `/admin/stock?${query}` : '/admin/stock';
  }

  return (
    <Stack gap={6}>
      <PageHeader title={t.admin.stockTitle} description={t.admin.stockLead} />

      <StatGrid>
        <StatTile label="Variantes suivies" value={tracked.length} />
        <StatTile
          label="En rupture"
          value={out}
          tone="negative"
          hint={t.admin.stockOutHint}
        />
        <StatTile
          label={t.admin.stockLow}
          value={low}
          tone="attention"
          hint={t.admin.stockLowHint}
        />
        <StatTile
          label={t.admin.stockAvailableUnits}
          value={units}
          hint={t.admin.stockAvailableHint}
        />
      </StatGrid>

      <TableToolbar
        actions={
          <ProductSearch
            defaultValue={search}
            action="/admin/stock"
            placeholder={t.admin.stockSearchPlaceholder}
          />
        }
      >
        <FilterBar label="Filtrer le stock">
          {FILTERS.map((entry) => (
            <FilterLink
              key={entry.value}
              href={hrefFor(entry.value)}
              current={filter === entry.value}
            >
              {entry.label}
            </FilterLink>
          ))}
        </FilterBar>
      </TableToolbar>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Boxes />}
          title={filter === 'all' && !search ? 'Aucune variante' : 'Rien dans cette file'}
          description={
            filter === 'all' && !search
              ? 'Les variantes apparaissent ici dès qu’un produit en a.'
              : 'Modifiez la recherche ou le filtre.'
          }
        />
      ) : (
        <div className="border-border bg-surface overflow-hidden rounded-md border max-md:border-0 max-md:bg-transparent">
          <Table caption={t.admin.stockCaption}>
            <TableHead>
              <TableRow>
                <TableHeaderCell>{t.admin.colProduct}</TableHeaderCell>
                <TableHeaderCell>{t.admin.colSku}</TableHeaderCell>
                <TableHeaderCell align="end" numeric>
                  {t.admin.colStock}
                </TableHeaderCell>
                <TableHeaderCell align="end" numeric>
                  {t.admin.colReserved}
                </TableHeaderCell>
                <TableHeaderCell align="end" numeric>
                  Disponible
                </TableHeaderCell>
                <TableHeaderCell align="end">État</TableHeaderCell>
                <TableHeaderCell align="end">Action</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => {
                const combination = Object.entries(row.options)
                  .map(([name, value]) => `${name} : ${value}`)
                  .join(' · ');
                const tracked = row.stockPolicy === 'TRACK';

                return (
                  <TableRow key={row.id}>
                    <TableCell label={t.admin.colProduct} bare>
                      <Link
                        href={`/admin/products/${row.productId}`}
                        variant="plain"
                        className="text-fg hover:text-accent font-medium"
                      >
                        {row.productName}
                      </Link>
                      <TableCellMeta>
                        {combination || 'Taille unique'}
                        {!tracked ? ` · ${STOCK_POLICY_LABELS[row.stockPolicy]}` : ''}
                      </TableCellMeta>
                    </TableCell>
                    <TableCell label={t.admin.colSku}>
                      <span className="text-mono font-mono">{row.sku}</span>
                    </TableCell>
                    <TableCell label={t.admin.colStock} align="end" numeric>
                      {tracked ? (
                        row.stockQuantity
                      ) : (
                        <Text variant="body-sm" tone="subtle" as="span">
                          —
                        </Text>
                      )}
                    </TableCell>
                    <TableCell label={t.admin.colReserved} align="end" numeric>
                      {row.reservedQuantity === 0 ? (
                        <Text variant="body-sm" tone="subtle" as="span">
                          —
                        </Text>
                      ) : (
                        row.reservedQuantity
                      )}
                    </TableCell>
                    <TableCell label="Disponible" align="end" numeric>
                      {tracked ? (
                        <span
                          className={row.available === 0 ? 'text-status-negative' : ''}
                        >
                          {row.available}
                        </span>
                      ) : (
                        <Text variant="body-sm" tone="subtle" as="span">
                          —
                        </Text>
                      )}
                    </TableCell>
                    <TableCell label="État" align="end">
                      <Badge tone={stateTone(row.state)}>
                        {STOCK_STATE_LABELS[row.state]}
                      </Badge>
                    </TableCell>
                    <TableCell label="Action" align="end">
                      <TableRowAction>
                        {tracked ? (
                          <AdjustStockDialog
                            variantId={row.id}
                            sku={row.sku}
                            productName={row.productName}
                            stockQuantity={row.stockQuantity}
                            reservedQuantity={row.reservedQuantity}
                            trigger={
                              <Button variant="secondary" size="sm">
                                Ajuster
                              </Button>
                            }
                          />
                        ) : (
                          <Text variant="caption" tone="subtle" as="span">
                            {t.admin.stockUntracked}
                          </Text>
                        )}
                      </TableRowAction>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </Stack>
  );
}
