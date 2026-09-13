import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';

import { Badge, EmptyState } from '@/components/ui/feedback';
import { Heading, Text } from '@/components/ui/typography';
import { Link } from '@/components/ui/link';
import { OrderStatusBadge, RequestStatusBadge } from '@/components/commerce/status';
import type {
  OrderStatus as BadgeOrderStatus,
  RequestStatus as BadgeRequestStatus,
} from '@/components/commerce/status';
import { PageHeader } from '@/components/ui/page-header';
import { Price } from '@/components/commerce/price';
import { Stack } from '@/components/layout/layout';
import { StatGrid, StatTile } from '@/components/ui/stat';
import {
  Table,
  TableBody,
  TableCell,
  TableCellMeta,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableRowLink,
} from '@/components/ui/table';
import { STOCK_STATE_LABELS } from '@/domain/catalogue';
import { formatDate, formatDateTime } from '@/i18n/format';
import { workshopDictionary } from '@/i18n/server';
import type { Dictionary } from '@/i18n';
import { requireStaff } from '@/server/auth/guards';
import { getAdminDashboard } from '@/server/services/admin-dashboard-service';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await workshopDictionary();
  return { title: t.admin.today };
}

export const dynamic = 'force-dynamic';

/** How many days from now, as a short human phrase. */
function daysUntil(date: Date, now: Date, t: Dictionary): string {
  const days = Math.round((date.getTime() - now.getTime()) / 86_400_000);
  if (days <= 0) return t.admin.dueToday;
  if (days === 1) return t.admin.dueTomorrow;
  return t.admin.dueInDays(days);
}

/**
 * A queue: a heading, a link to the full list, and a table.
 *
 * The previous dashboard put each queue in a `Card` with a `CardHeader` and a
 * bulleted `Stack`, which cost about 180px of chrome per queue and made seven
 * queues into a page nobody could take in. A heading, a rule and a table is the
 * same information in a third of the height.
 */
function Queue({
  title,
  href,
  linkLabel,
  count,
  empty,
  children,
}: {
  title: string;
  href: string;
  linkLabel: string;
  count: number;
  empty: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="border-border flex flex-wrap items-baseline justify-between gap-3 border-b pb-2">
        {/*
         * No count beside the heading. A queue is capped at ten rows and the
         * tile above carries the real total, so "Nouvelles demandes 10" under a
         * tile reading 86 is two numbers for one thing. The link is where the
         * rest of them are.
         */}
        <Heading level={2} variant="heading-md">
          {title}
        </Heading>
        <Link href={href} variant="subtle" className="text-body-sm">
          {linkLabel}
        </Link>
      </div>

      {count === 0 ? (
        <Text variant="body-sm" tone="subtle">
          {empty}
        </Text>
      ) : (
        <div className="border-border bg-surface overflow-hidden rounded-md border max-md:border-0 max-md:bg-transparent">
          {children}
        </div>
      )}
    </section>
  );
}

/**
 * What needs the workshop now.
 *
 * `UX.md` section 9: "`/admin` answers one question: what needs me now", and
 * "every row is a link to the workspace where the action can be completed;
 * there are no informational tiles that lead nowhere".
 *
 * There is deliberately **no revenue figure and no chart**. `PRODUCT.md` puts
 * analytics in V2, and a number nobody can act on is worse than blank space —
 * it makes the screen look like it is doing something. Every tile at the top is
 * the length of a queue below it and links to that queue; every row opens the
 * workspace where the work is done.
 *
 * Phase 14.5 kept that discipline and changed the shape: five tiles, then
 * queues as tables in priority order — the things that expire, then the things
 * that block money, then the things that block production, then stock.
 */
export default async function AdminDashboardPage() {
  const authorisation = await requireStaff();
  if (!authorisation.ok) notFound();

  const { locale, t } = await workshopDictionary();
  const now = new Date();
  const board = await getAdminDashboard(now);

  const nothingWaiting =
    board.newRequests.length === 0 &&
    board.requestsInReview.length === 0 &&
    board.outstandingQuotes.length === 0 &&
    board.acceptedQuotes.length === 0 &&
    board.newOrders.length === 0 &&
    board.awaitingPayment.length === 0 &&
    board.inFulfilment.length === 0 &&
    board.lowStock.length === 0;

  return (
    <Stack gap={8}>
      <PageHeader title={t.admin.today} description={t.admin.todayLead} />

      <StatGrid>
        <StatTile
          label={t.admin.tileRequests}
          value={board.counts.newRequests}
          href="/admin/requests?status=SUBMITTED"
          tone="attention"
          hint={t.admin.tileRequestsHint}
        />
        <StatTile
          label={t.admin.tileQuotes}
          value={board.counts.outstandingQuotes}
          href="/admin/quotes"
          hint={t.admin.tileQuotesHint}
        />
        <StatTile
          label={t.admin.tileProofs}
          value={board.counts.proofsToReview}
          href="/admin/payments"
          tone="attention"
          hint={t.admin.tileProofsHint}
        />
        <StatTile
          label={t.admin.tileOutOfStock}
          value={board.counts.outOfStock}
          href="/admin/stock?filter=out"
          tone="negative"
          hint={t.admin.tileLowStockHint(board.counts.lowStock)}
        />
      </StatGrid>

      {nothingWaiting ? (
        <EmptyState
          icon={<CheckCircle2 />}
          title={t.admin.allClearTitle}
          description={t.admin.allClearBody}
        />
      ) : (
        <Stack gap={10}>
          {/* ------------------------------------------------------ requests */}
          <Queue
            title={t.admin.queueNewRequests}
            href="/admin/requests"
            linkLabel={t.admin.allRequests}
            count={board.newRequests.length}
            empty={t.admin.queueNewRequestsEmpty}
          >
            <Table caption={t.admin.queueNewRequestsCaption}>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>{t.admin.colRequest}</TableHeaderCell>
                  <TableHeaderCell>{t.admin.colCustomer}</TableHeaderCell>
                  <TableHeaderCell align="end">{t.admin.colReceived}</TableHeaderCell>
                  <TableHeaderCell align="end">{t.admin.colState}</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {board.newRequests.map((request) => (
                  <TableRow key={request.id}>
                    <TableCell label={t.admin.colRequest} bare>
                      <TableRowLink href={`/admin/requests/${request.requestNumber}`}>
                        <span className="font-mono">{request.requestNumber}</span>
                      </TableRowLink>
                    </TableCell>
                    <TableCell label={t.admin.colCustomer}>
                      {request.contactName ?? 'Client'}
                    </TableCell>
                    <TableCell label={t.admin.colReceived} align="end">
                      <Text variant="caption" tone="subtle" as="span">
                        {formatDateTime(request.submittedAt ?? request.createdAt, locale)}
                      </Text>
                    </TableCell>
                    <TableCell label={t.admin.colState} align="end">
                      <RequestStatusBadge status={request.status as BadgeRequestStatus} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Queue>

          {/* -------------------------------------------------------- quotes */}
          <Queue
            title={t.admin.queueQuotes}
            href="/admin/quotes"
            linkLabel={t.admin.allQuotes}
            count={board.outstandingQuotes.length}
            empty={t.admin.queueQuotesEmpty}
          >
            <Table caption={t.admin.queueQuotesCaption}>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>{t.admin.colQuote}</TableHeaderCell>
                  <TableHeaderCell>{t.admin.colCustomer}</TableHeaderCell>
                  <TableHeaderCell align="end">{t.admin.colExpires}</TableHeaderCell>
                  <TableHeaderCell align="end" numeric>
                    {t.admin.colAmount}
                  </TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {board.outstandingQuotes.map((quote) => (
                  <TableRow key={quote.quoteNumber}>
                    <TableCell label={t.admin.colQuote} bare>
                      <TableRowLink href={`/admin/requests/${quote.requestNumber}`}>
                        <span className="font-mono">{quote.quoteNumber}</span>
                      </TableRowLink>
                    </TableCell>
                    <TableCell label={t.admin.colCustomer}>
                      {quote.customerName ?? quote.customerEmail}
                    </TableCell>
                    <TableCell label={t.admin.colExpires} align="end">
                      <span>{formatDate(quote.validUntil, locale, 'medium')}</span>
                      <TableCellMeta>{daysUntil(quote.validUntil, now, t)}</TableCellMeta>
                    </TableCell>
                    <TableCell label={t.admin.colAmount} align="end" numeric>
                      <Price
                        amount={quote.grandTotal}
                        currency={quote.currency}
                        size="sm"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Queue>

          {/* ------------------------------------------------------ payments */}
          <Queue
            title={t.admin.queueDeposits}
            href="/admin/payments"
            linkLabel={t.admin.paymentsScreen}
            count={board.awaitingPayment.length}
            empty={t.admin.queueDepositsEmpty}
          >
            <Table caption={t.admin.queueDepositsCaption}>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>{t.admin.colOrder}</TableHeaderCell>
                  <TableHeaderCell>{t.admin.colCustomer}</TableHeaderCell>
                  <TableHeaderCell align="end">{t.admin.colSince}</TableHeaderCell>
                  <TableHeaderCell align="end" numeric>
                    {t.admin.colDeposit}
                  </TableHeaderCell>
                  <TableHeaderCell align="end">{t.admin.colProof}</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {board.awaitingPayment.map((order) => (
                  <TableRow key={order.orderNumber}>
                    <TableCell label={t.admin.colOrder} bare>
                      <TableRowLink href={`/admin/orders/${order.orderNumber}`}>
                        <span className="font-mono">{order.orderNumber}</span>
                      </TableRowLink>
                    </TableCell>
                    <TableCell label={t.admin.colCustomer}>{order.contactName}</TableCell>
                    <TableCell label={t.admin.colSince} align="end">
                      <Text variant="caption" tone="subtle" as="span">
                        {formatDate(order.placedAt, locale, 'medium')}
                      </Text>
                    </TableCell>
                    <TableCell label={t.admin.colDeposit} align="end" numeric>
                      <Price
                        amount={order.depositRequired}
                        currency={order.currency}
                        size="sm"
                      />
                    </TableCell>
                    <TableCell label={t.admin.colProof} align="end">
                      {order.hasPendingProof ? (
                        <Badge tone="attention">{t.admin.proofToCheck}</Badge>
                      ) : (
                        <Text variant="caption" tone="subtle" as="span">
                          Aucun
                        </Text>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Queue>

          {/* -------------------------------------------------- new orders */}
          <Queue
            title={t.admin.queueToConfirm}
            href="/admin/orders?status=AWAITING_CONFIRMATION"
            linkLabel={t.admin.allOrders}
            count={board.newOrders.length}
            empty={t.admin.queueToConfirmEmpty}
          >
            <Table caption={t.admin.queueToConfirmCaption}>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>{t.admin.colOrder}</TableHeaderCell>
                  <TableHeaderCell>{t.admin.colCustomer}</TableHeaderCell>
                  <TableHeaderCell align="end">{t.admin.colPlaced}</TableHeaderCell>
                  <TableHeaderCell align="end" numeric>
                    {t.admin.colTotal}
                  </TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {board.newOrders.map((order) => (
                  <TableRow key={order.orderNumber}>
                    <TableCell label={t.admin.colOrder} bare>
                      <TableRowLink href={`/admin/orders/${order.orderNumber}`}>
                        <span className="font-mono">{order.orderNumber}</span>
                      </TableRowLink>
                    </TableCell>
                    <TableCell label={t.admin.colCustomer}>{order.contactName}</TableCell>
                    <TableCell label={t.admin.colPlaced} align="end">
                      <Text variant="caption" tone="subtle" as="span">
                        {formatDate(order.placedAt, locale, 'medium')}
                      </Text>
                    </TableCell>
                    <TableCell label={t.admin.colTotal} align="end" numeric>
                      <Price
                        amount={order.grandTotal}
                        currency={order.currency}
                        size="sm"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Queue>

          {/* ---------------------------------------------------- fulfilment */}
          <Queue
            title={t.admin.queueInProduction}
            href="/admin/orders"
            linkLabel={t.admin.allOrders}
            count={board.inFulfilment.length}
            empty={t.admin.queueInProductionEmpty}
          >
            <Table caption={t.admin.queueInProductionCaption}>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>{t.admin.colOrder}</TableHeaderCell>
                  <TableHeaderCell>{t.admin.colCustomer}</TableHeaderCell>
                  <TableHeaderCell align="end">{t.admin.colPlaced}</TableHeaderCell>
                  <TableHeaderCell align="end">{t.admin.colStatus}</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {board.inFulfilment.map((order) => (
                  <TableRow key={order.orderNumber}>
                    <TableCell label={t.admin.colOrder} bare>
                      <TableRowLink href={`/admin/orders/${order.orderNumber}`}>
                        <span className="font-mono">{order.orderNumber}</span>
                      </TableRowLink>
                    </TableCell>
                    <TableCell label={t.admin.colCustomer}>{order.contactName}</TableCell>
                    <TableCell label={t.admin.colPlaced} align="end">
                      <Text variant="caption" tone="subtle" as="span">
                        {formatDate(order.placedAt, locale, 'medium')}
                      </Text>
                    </TableCell>
                    <TableCell label={t.admin.colStatus} align="end">
                      <OrderStatusBadge status={order.status as BadgeOrderStatus} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Queue>

          {/* --------------------------------------------------------- stock */}
          <Queue
            title={t.admin.queueStock}
            href="/admin/stock?filter=alert"
            linkLabel={t.admin.stockScreen}
            count={board.lowStock.length}
            empty={t.admin.queueStockEmpty}
          >
            <Table caption={t.admin.queueStockCaption}>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>{t.admin.colProduct}</TableHeaderCell>
                  <TableHeaderCell>SKU</TableHeaderCell>
                  <TableHeaderCell align="end" numeric>
                    {t.admin.colAvailable}
                  </TableHeaderCell>
                  <TableHeaderCell align="end">{t.admin.colState}</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {board.lowStock.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell label={t.admin.colProduct} bare>
                      <TableRowLink href={`/admin/products/${row.productId}`}>
                        {row.productName}
                      </TableRowLink>
                    </TableCell>
                    <TableCell label="SKU">
                      <span className="text-mono font-mono">{row.sku}</span>
                    </TableCell>
                    <TableCell label={t.admin.colAvailable} align="end" numeric>
                      {row.available}
                    </TableCell>
                    <TableCell label={t.admin.colState} align="end">
                      <Badge
                        tone={row.state === 'OUT_OF_STOCK' ? 'negative' : 'attention'}
                      >
                        {STOCK_STATE_LABELS[row.state]}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Queue>
        </Stack>
      )}
    </Stack>
  );
}
