import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PackageSearch } from 'lucide-react';

import {
  ArchiveTabs,
  BulkArchive,
  SelectAllCell,
  SelectCell,
} from '@/components/admin/bulk-archive';
import { Badge, EmptyState } from '@/components/ui/feedback';
import { FilterBar, FilterLink, PageHeader } from '@/components/ui/page-header';
import { OrderStatusBadge } from '@/components/commerce/status';
import type { OrderStatus as BadgeStatus } from '@/components/commerce/status';
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
  ORDER_STATUS_LABELS,
  ORDER_TRANSITIONS,
  type OrderStatus,
} from '@/domain/order/state-machine';
import { PAYMENT_STATUS_LABELS } from '@/domain/order/payment';
import { formatDate } from '@/i18n/format';
import { workshopDictionary } from '@/i18n/server';
import { requireStaff } from '@/server/auth/guards';
import { archivedCount } from '@/server/services/archive-service';
import { getOrderQueue } from '@/server/services/order-admin-service';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await workshopDictionary();
  return { title: t.admin.navOrders };
}

export const dynamic = 'force-dynamic';

const STATUSES = Object.keys(ORDER_TRANSITIONS) as OrderStatus[];

function isOrderStatus(value: string | undefined): value is OrderStatus {
  return value !== undefined && STATUSES.includes(value as OrderStatus);
}

/**
 * The order queue.
 *
 * `UX.md` section 9: "order list, filtered by status → order workspace". The
 * filter is a set of links rather than a control, so a filtered queue is a URL
 * the owner can bookmark and return to — which is what a working queue needs to
 * be. The status list comes from `ORDER_TRANSITIONS`, so a status added to the
 * business rules appears here without this file being edited, and one that does
 * not exist cannot be filtered for.
 *
 * Phase 14.5 turned the stack of cards into a table. Eight columns fit the
 * information three cards used to carry, and the operator can run an eye down
 * "Restant" instead of reading twenty paragraphs. Below `md` each row folds
 * into a labelled block — the same markup, and no horizontal scroller.
 */
export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; archived?: string }>;
}) {
  const { locale, t } = await workshopDictionary();
  const authorisation = await requireStaff();
  if (!authorisation.ok) notFound();

  const { status, archived: archivedParam } = await searchParams;
  const filter = isOrderStatus(status) ? status : null;
  const archived = archivedParam === '1';

  const [orders, inArchive] = await Promise.all([
    getOrderQueue({ status: filter, archived }),
    archivedCount('order'),
  ]);

  // Switching status must not drop the operator out of the archive, and vice
  // versa, so every link on this screen carries both halves of where they are.
  function hrefFor(candidate: OrderStatus | null): string {
    const params = new URLSearchParams();
    if (candidate) params.set('status', candidate);
    if (archived) params.set('archived', '1');
    const query = params.toString();
    return query ? `/admin/orders?${query}` : '/admin/orders';
  }

  return (
    <Stack gap={6}>
      <PageHeader
        title="Commandes"
        description="Filtrez par statut pour travailler une file à la fois. Chaque ligne ouvre l’atelier de la commande."
      />

      <TableToolbar
        actions={
          <ArchiveTabs
            basePath="/admin/orders"
            archived={archived}
            count={inArchive}
            search={filter ? { status: filter } : undefined}
          />
        }
      >
        <FilterBar label="Filtrer par statut">
          <FilterLink href={hrefFor(null)} current={filter === null}>
            Toutes
          </FilterLink>
          {STATUSES.map((candidate) => (
            <FilterLink
              key={candidate}
              href={hrefFor(candidate)}
              current={filter === candidate}
            >
              {ORDER_STATUS_LABELS[candidate]}
            </FilterLink>
          ))}
        </FilterBar>
      </TableToolbar>

      {orders.length === 0 ? (
        <EmptyState
          icon={<PackageSearch />}
          title={
            archived
              ? t.adminArchive.emptyTitle
              : filter
                ? t.admin.noOrderInQueue
                : t.admin.noOrders
          }
          description={
            archived
              ? t.adminArchive.emptyBody
              : filter
                ? t.admin.nothingInStatus
                : t.admin.ordersAppearHere
          }
        />
      ) : (
        <BulkArchive
          entity="order"
          archived={archived}
          ids={orders.map((order) => order.id)}
        >
          <div className="border-border bg-surface overflow-hidden rounded-md border max-md:border-0 max-md:bg-transparent">
            <Table caption="File des commandes">
              <TableHead>
                <TableRow>
                  <SelectAllCell />
                  <TableHeaderCell>{t.admin.colOrder}</TableHeaderCell>
                  <TableHeaderCell>{t.admin.colCustomer}</TableHeaderCell>
                  <TableHeaderCell align="end" numeric>
                    Articles
                  </TableHeaderCell>
                  <TableHeaderCell align="end" numeric>
                    {t.admin.colTotal}
                  </TableHeaderCell>
                  <TableHeaderCell>{t.admin.colSettlement}</TableHeaderCell>
                  <TableHeaderCell align="end">{t.admin.colStatus}</TableHeaderCell>
                  <TableHeaderCell align="end">{t.admin.colPlaced}</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {orders.map((order) => (
                  <TableRow key={order.id}>
                    <SelectCell id={order.id} label={order.orderNumber} />
                    <TableCell label={t.admin.colOrder} bare>
                      <TableRowLink href={`/admin/orders/${order.orderNumber}`}>
                        <span className="font-mono break-all">{order.orderNumber}</span>
                      </TableRowLink>
                      {order.hasProductionLine && (
                        <TableCellMeta>Sur mesure</TableCellMeta>
                      )}
                    </TableCell>
                    <TableCell label={t.admin.colCustomer}>
                      {order.contactName}
                      <TableCellMeta>{order.contactEmail}</TableCellMeta>
                    </TableCell>
                    <TableCell label="Articles" align="end" numeric>
                      {order.itemCount}
                    </TableCell>
                    <TableCell label={t.admin.colTotal} align="end" numeric>
                      <Price
                        amount={order.grandTotal}
                        currency={order.currency}
                        size="sm"
                      />
                    </TableCell>
                    <TableCell label={t.admin.colSettlement}>
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        {PAYMENT_STATUS_LABELS[
                          order.paymentStatus as keyof typeof PAYMENT_STATUS_LABELS
                        ] ?? order.paymentStatus}
                        {order.hasPendingProof && (
                          <Badge tone="attention">Justificatif</Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell label={t.admin.colStatus} align="end">
                      <OrderStatusBadge status={order.status as BadgeStatus} />
                    </TableCell>
                    <TableCell label={t.admin.colPlaced} align="end">
                      <Text variant="caption" tone="subtle" as="span">
                        {formatDate(order.placedAt, locale, 'medium')}
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
