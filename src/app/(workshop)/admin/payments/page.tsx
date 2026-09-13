import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Wallet } from 'lucide-react';

import { Badge, EmptyState } from '@/components/ui/feedback';
import { FilterBar, FilterLink, PageHeader } from '@/components/ui/page-header';
import { OrderStatusBadge } from '@/components/commerce/status';
import type { OrderStatus as BadgeStatus } from '@/components/commerce/status';
import { formatMoney, Price } from '@/components/commerce/price';
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
  TableRowLink,
  TableToolbar,
} from '@/components/ui/table';
import { PAYMENT_STATUS_LABELS } from '@/domain/order/payment';
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from '@/domain/order/payment-method';
import { formatDate } from '@/i18n/format';
import { workshopDictionary } from '@/i18n/server';
import type { Dictionary } from '@/i18n';
import { requireStaff } from '@/server/auth/guards';
import {
  countOrdersByPaymentPosition,
  listOrdersForPayments,
  outstandingAcrossOrders,
  type PaymentQueueFilter,
} from '@/server/repositories/order-repository';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await workshopDictionary();
  return { title: t.admin.navPayments };
}

export const dynamic = 'force-dynamic';

/**
 * The facets, in the order the work is done.
 *
 * `all` is **first and is the default**. That is the Phase 14.6 fix: the screen
 * used to open on the proof queue, which is empty whenever no customer has
 * uploaded a transfer receipt — always, in a shop whose default method is
 * payment on delivery. An operations screen whose first impression is "rien
 * dans cette file" while two orders owe money is worse than no screen.
 */
const FILTERS: readonly PaymentQueueFilter[] = [
  'all',
  'unpaid',
  'deposit_due',
  'partial',
  'settled',
  'proofs',
];

/** The six facets, named in the reader's language. */
function filterLabels(t: Dictionary): Record<PaymentQueueFilter, string> {
  return {
    all: t.admin.filterAll,
    unpaid: t.admin.filterUnpaid,
    deposit_due: t.admin.colDeposit,
    partial: t.admin.filterPartlyPaid,
    settled: t.admin.filterSettled,
    proofs: t.admin.filterProofs,
  };
}

const METHODS: readonly PaymentMethod[] = ['COD', 'CCP', 'BANK_TRANSFER', 'ONLINE'];

function isFilter(value: string | undefined): value is PaymentQueueFilter {
  return value !== undefined && (FILTERS as readonly string[]).includes(value);
}

function isMethod(value: string | undefined): value is PaymentMethod {
  return value !== undefined && (METHODS as readonly string[]).includes(value);
}

/**
 * Money, as one screen.
 *
 * Phase 12 built the payment operations — recording a payment, reviewing a
 * proof — inside the order workspace, which is the right place to *do* them and
 * the wrong place to *find* them: the person doing the morning bank check had
 * to open orders one at a time to discover which ones had a transfer waiting.
 *
 * This is the finding screen, and Phase 14.6 made it actually find things.
 * Three rules hold it together:
 *
 * **Every figure comes from the order's own columns.** `amountPaid` is derived
 * from the payment rows and stored by the payment service (8.8); nothing here
 * recomputes it, and `outstanding` and `outstandingDeposit` are
 * `domain/order/payment`'s functions rather than arithmetic repeated in a
 * component.
 *
 * **Every facet is a money question**, answered in SQL from `paymentStatus`.
 * None of them keys off an *order* status — the old "acompte attendu" filter
 * did, on `AWAITING_PAYMENT`, so an order sitting in `AWAITING_CONFIRMATION`
 * with an untouched deposit never appeared, which is the commonest shape here.
 *
 * **The tiles count the whole table, not the page.** A figure somebody acts on
 * must not be the length of a truncated fetch.
 *
 * Recording a payment remains a human act performed in the order workspace,
 * which is where every row leads. There is no payment-provider integration.
 * `depositWindowDays` is still a placeholder in the business rules, so this
 * screen shows how long an order has been waiting and never claims a deadline.
 */
export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; method?: string }>;
}) {
  const { locale, t } = await workshopDictionary();
  const authorisation = await requireStaff();
  if (!authorisation.ok) notFound();

  const { filter: rawFilter, method: rawMethod } = await searchParams;
  const filter: PaymentQueueFilter = isFilter(rawFilter) ? rawFilter : 'all';
  const method = isMethod(rawMethod) ? rawMethod : null;

  const [rows, counts, owed] = await Promise.all([
    listOrdersForPayments({ filter, method }),
    countOrdersByPaymentPosition(),
    outstandingAcrossOrders(),
  ]);

  function hrefFor(next: {
    filter?: PaymentQueueFilter;
    method?: PaymentMethod | null;
  }): string {
    const params = new URLSearchParams();
    const candidate = next.filter ?? filter;
    const candidateMethod = next.method === undefined ? method : next.method;

    if (candidate !== 'all') params.set('filter', candidate);
    if (candidateMethod) params.set('method', candidateMethod);

    const query = params.toString();
    return query ? `/admin/payments?${query}` : '/admin/payments';
  }

  return (
    <Stack gap={6}>
      <PageHeader title="Paiements" description={t.admin.paymentsLead} />

      <StatGrid>
        <StatTile
          label={t.admin.paymentsUnpaid}
          value={counts.unpaid}
          href={hrefFor({ filter: 'unpaid' })}
          tone="attention"
          hint={t.admin.paymentsUnpaidHint}
        />
        <StatTile
          label="Acompte attendu"
          value={counts.deposit_due}
          href={hrefFor({ filter: 'deposit_due' })}
          tone="attention"
          hint="Bloque la confirmation"
        />
        <StatTile
          label={t.admin.paymentsProofs}
          value={counts.proofs}
          href={hrefFor({ filter: 'proofs' })}
          hint={t.admin.paymentsProofsHint}
        />
        <StatTile
          label={t.admin.paymentsOutstanding}
          value={formatMoney(owed)}
          hint={t.admin.paymentsOutstandingHint}
        />
      </StatGrid>

      <TableToolbar
        actions={
          <FilterBar label="Filtrer par moyen de paiement">
            <FilterLink href={hrefFor({ method: null })} current={method === null}>
              {t.admin.paymentsAllMethods}
            </FilterLink>
            {METHODS.map((candidate) => (
              <FilterLink
                key={candidate}
                href={hrefFor({ method: candidate })}
                current={method === candidate}
              >
                {PAYMENT_METHOD_LABELS[candidate]}
              </FilterLink>
            ))}
          </FilterBar>
        }
      >
        <FilterBar label="Filtrer par position de paiement">
          {FILTERS.map((candidate) => (
            <FilterLink
              key={candidate}
              href={hrefFor({ filter: candidate })}
              current={filter === candidate}
              count={counts[candidate]}
            >
              {filterLabels(t)[candidate]}
            </FilterLink>
          ))}
        </FilterBar>
      </TableToolbar>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Wallet />}
          title={counts.all === 0 ? t.admin.noOrders : t.admin.noOrderInQueue}
          description={
            counts.all === 0
              ? t.admin.ordersAppearHere
              : 'Modifiez le filtre ou le moyen de paiement.'
          }
        />
      ) : (
        <div className="border-border bg-surface overflow-hidden rounded-md border max-md:border-0 max-md:bg-transparent">
          <Table caption="Suivi des paiements">
            <TableHead>
              <TableRow>
                <TableHeaderCell>{t.admin.colOrder}</TableHeaderCell>
                <TableHeaderCell>{t.admin.colCustomer}</TableHeaderCell>
                <TableHeaderCell>Moyen</TableHeaderCell>
                <TableHeaderCell align="end" numeric>
                  {t.admin.colTotal}
                </TableHeaderCell>
                <TableHeaderCell align="end" numeric>
                  Acompte
                </TableHeaderCell>
                <TableHeaderCell align="end" numeric>
                  {t.admin.colCollected}
                </TableHeaderCell>
                <TableHeaderCell align="end" numeric>
                  Restant
                </TableHeaderCell>
                <TableHeaderCell align="end">{t.admin.colSettlement}</TableHeaderCell>
                <TableHeaderCell align="end">{t.admin.colOrder}</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((order) => (
                <TableRow key={order.orderNumber}>
                  <TableCell label={t.admin.colOrder} bare>
                    <TableRowLink href={`/admin/orders/${order.orderNumber}`}>
                      <span className="font-mono break-all">{order.orderNumber}</span>
                    </TableRowLink>
                    <TableCellMeta>
                      {formatDate(order.placedAt, locale, 'medium')}
                      {order.hasProductionLine ? ' · sur mesure' : ''}
                    </TableCellMeta>
                  </TableCell>

                  <TableCell label={t.admin.colCustomer}>
                    {order.contactName}
                    <TableCellMeta>{order.contactEmail}</TableCellMeta>
                  </TableCell>

                  <TableCell label="Moyen">
                    {PAYMENT_METHOD_LABELS[order.paymentMethod as PaymentMethod] ??
                      order.paymentMethod}
                  </TableCell>

                  <TableCell label={t.admin.colTotal} align="end" numeric>
                    <Price
                      amount={order.grandTotal}
                      currency={order.currency}
                      size="sm"
                    />
                  </TableCell>

                  {/*
                   * The deposit position, which is the whole reason a custom
                   * order is on this screen. The figure is the order's own
                   * `depositRequired` — copied from the quote at placement, not
                   * recomputed here — and the second line is what is still
                   * missing before the order can be confirmed (5.5).
                   */}
                  <TableCell label="Acompte" align="end" numeric>
                    {order.depositRequired === 0 ? (
                      <Text variant="body-sm" tone="subtle" as="span">
                        —
                      </Text>
                    ) : (
                      <>
                        <Price
                          amount={order.depositRequired}
                          currency={order.currency}
                          size="sm"
                        />
                        {order.outstandingDeposit > 0 && (
                          <TableCellMeta>
                            reste{' '}
                            {formatMoney(order.outstandingDeposit, {
                              currency: order.currency,
                            })}
                          </TableCellMeta>
                        )}
                      </>
                    )}
                  </TableCell>

                  <TableCell label={t.admin.colCollected} align="end" numeric>
                    {order.amountPaid === 0 ? (
                      <Text variant="body-sm" tone="subtle" as="span">
                        —
                      </Text>
                    ) : (
                      <Price
                        amount={order.amountPaid}
                        currency={order.currency}
                        size="sm"
                      />
                    )}
                  </TableCell>

                  <TableCell label="Restant" align="end" numeric>
                    {order.outstanding === 0 ? (
                      <Badge tone="positive">{t.admin.paymentsSettled}</Badge>
                    ) : (
                      <span className="text-status-attention">
                        <Price
                          amount={order.outstanding}
                          currency={order.currency}
                          size="sm"
                        />
                      </span>
                    )}
                  </TableCell>

                  <TableCell label={t.admin.colSettlement} align="end">
                    <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                      {order.hasPendingProof && (
                        <Badge tone="attention">Justificatif</Badge>
                      )}
                      <Badge
                        tone={
                          order.paymentStatus === 'PAID'
                            ? 'positive'
                            : order.paymentStatus === 'DEPOSIT_PAID'
                              ? 'progress'
                              : 'neutral'
                        }
                      >
                        {PAYMENT_STATUS_LABELS[
                          order.paymentStatus as keyof typeof PAYMENT_STATUS_LABELS
                        ] ?? order.paymentStatus}
                      </Badge>
                    </span>
                  </TableCell>

                  <TableCell label={t.admin.colOrder} align="end">
                    <OrderStatusBadge status={order.status as BadgeStatus} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Stack>
  );
}
