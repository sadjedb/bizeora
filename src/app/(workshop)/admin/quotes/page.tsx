import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { FileText } from 'lucide-react';

import {
  ArchiveTabs,
  BulkArchive,
  SelectAllCell,
  SelectCell,
} from '@/components/admin/bulk-archive';
import { Badge, EmptyState } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/page-header';
import { Price } from '@/components/commerce/price';
import { QuoteStatusBadge } from '@/components/commerce/status';
import type { QuoteStatus as BadgeStatus } from '@/components/commerce/status';
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
import { effectiveQuoteStatus } from '@/domain/quote';
import { formatDate } from '@/i18n/format';
import { workshopDictionary } from '@/i18n/server';
import { requireStaff } from '@/server/auth/guards';
import { archivedCount } from '@/server/services/archive-service';
import { listOutstandingQuotesForStaff } from '@/server/repositories/quote-repository';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await workshopDictionary();
  return { title: t.admin.navQuotes };
}

export const dynamic = 'force-dynamic';

/** Days from now, signed: negative once the date has passed. */
function daysFromNow(date: Date, now: Date): number {
  return Math.round((date.getTime() - now.getTime()) / 86_400_000);
}

/**
 * Quotes that are somebody's move.
 *
 * Sent, viewed and accepted — the three states where a quote is waiting on a
 * person. A draft is not listed: it is a document the admin is still writing,
 * and it belongs on its request's workspace beside the configuration it prices.
 *
 * The status shown is the **effective** one (7.4), so a quote past its validity
 * reads as expired here whether or not the sweep has run.
 *
 * **The version is a column, and it is not editable.** 7.3 makes a sent quote
 * immutable: a change is a new version, created from the request. Every row
 * therefore links to the request rather than to a quote editor that does not
 * and must not exist, and the expiry column is the one thing on this screen
 * that decides the order of work.
 */
export default async function AdminQuotesPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const { locale, t } = await workshopDictionary();
  const authorisation = await requireStaff();
  if (!authorisation.ok) notFound();

  const { archived: archivedParam } = await searchParams;
  const archived = archivedParam === '1';

  const [quotes, inArchive] = await Promise.all([
    listOutstandingQuotesForStaff({ limit: 100, archived }),
    archivedCount('quote'),
  ]);
  const now = new Date();

  const decorated = quotes.map((quote) => ({
    quote,
    status: effectiveQuoteStatus({
      status: quote.status,
      validUntil: quote.validUntil,
      now,
    }),
    days: daysFromNow(quote.validUntil, now),
  }));

  const awaiting = decorated.filter(
    (row) => row.status === 'SENT' || row.status === 'VIEWED',
  );
  const expiringSoon = awaiting.filter((row) => row.days <= 3);
  const accepted = decorated.filter((row) => row.status === 'ACCEPTED');

  return (
    <Stack gap={6}>
      <PageHeader
        title={t.admin.quotesTitle}
        description="Les devis envoyés, consultés ou acceptés. Un brouillon se travaille sur sa demande ; un devis envoyé ne se modifie plus, il se remplace par une nouvelle version."
      />

      <TableToolbar
        actions={
          <ArchiveTabs basePath="/admin/quotes" archived={archived} count={inArchive} />
        }
      />

      <StatGrid>
        <StatTile label={t.admin.quotesAwaitingAnswer} value={awaiting.length} />
        <StatTile
          label="Expirent sous 3 jours"
          value={expiringSoon.length}
          tone="attention"
          hint={t.admin.quotesAwaitingHint}
        />
        <StatTile
          label={t.admin.quotesAccepted}
          value={accepted.length}
          hint={t.admin.quotesAcceptedHint}
        />
        <StatTile
          label={t.admin.quotesUnfinished}
          value={accepted.filter((row) => row.quote.hasLiveCart).length}
          hint="Panier issu du devis encore ouvert"
        />
      </StatGrid>

      {decorated.length === 0 ? (
        <EmptyState
          icon={<FileText />}
          title={archived ? t.adminArchive.emptyTitle : t.admin.quotesEmptyTitle}
          description={archived ? t.adminArchive.emptyBody : t.admin.quotesEmptyBody}
        />
      ) : (
        <BulkArchive
          entity="quote"
          archived={archived}
          ids={quotes.map((quote) => quote.id)}
        >
          <div className="border-border bg-surface overflow-hidden rounded-md border max-md:border-0 max-md:bg-transparent">
            <Table caption={t.admin.quotesCaption}>
              <TableHead>
                <TableRow>
                  <SelectAllCell />
                  <TableHeaderCell>{t.admin.colQuote}</TableHeaderCell>
                  <TableHeaderCell>{t.admin.colCustomer}</TableHeaderCell>
                  <TableHeaderCell>{t.admin.colRequest}</TableHeaderCell>
                  <TableHeaderCell align="end" numeric>
                    Montant
                  </TableHeaderCell>
                  <TableHeaderCell align="end">{t.admin.colDue}</TableHeaderCell>
                  <TableHeaderCell align="end">État</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {decorated.map(({ quote, status, days }) => (
                  <TableRow key={quote.id}>
                    <SelectCell id={quote.id} label={quote.quoteNumber} />
                    <TableCell label={t.admin.colQuote} bare>
                      <TableRowLink href={`/admin/requests/${quote.requestNumber}`}>
                        <span className="font-mono break-all">{quote.quoteNumber}</span>
                      </TableRowLink>
                      <TableCellMeta>
                        version {quote.version} · envoyée, non modifiable
                      </TableCellMeta>
                    </TableCell>
                    <TableCell label={t.admin.colCustomer}>
                      {quote.customerName ?? quote.customerEmail}
                      {quote.customerName && (
                        <TableCellMeta>{quote.customerEmail}</TableCellMeta>
                      )}
                    </TableCell>
                    <TableCell label={t.admin.colRequest}>
                      <span className="font-mono">{quote.requestNumber}</span>
                    </TableCell>
                    <TableCell label="Montant" align="end" numeric>
                      <Price
                        amount={quote.grandTotal}
                        currency={quote.currency}
                        size="sm"
                      />
                    </TableCell>
                    <TableCell label={t.admin.colDue} align="end">
                      {status === 'ACCEPTED' ? (
                        <Text variant="body-sm" tone="subtle" as="span">
                          {quote.hasLiveCart
                            ? t.admin.quoteToFinalise
                            : t.admin.quoteWindowClosed}
                        </Text>
                      ) : (
                        <>
                          <span
                            className={
                              days <= 3 && days >= 0 ? 'text-status-attention' : undefined
                            }
                          >
                            {formatDate(quote.validUntil, locale, 'medium')}
                          </span>
                          <TableCellMeta>
                            {days < 0
                              ? t.admin.quoteLapsed
                              : days === 0
                                ? t.admin.quoteExpiresToday
                                : days === 1
                                  ? 'expire demain'
                                  : `dans ${days} jours`}
                          </TableCellMeta>
                        </>
                      )}
                    </TableCell>
                    <TableCell label="État" align="end">
                      <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                        {status === 'ACCEPTED' && quote.hasLiveCart && (
                          <Badge tone="progress">Panier ouvert</Badge>
                        )}
                        <QuoteStatusBadge status={status as BadgeStatus} />
                      </span>
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
