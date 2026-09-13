import type { Metadata } from 'next';
import { Inbox } from 'lucide-react';

import {
  ArchiveTabs,
  BulkArchive,
  SelectAllCell,
  SelectCell,
} from '@/components/admin/bulk-archive';
import { Badge, EmptyState } from '@/components/ui/feedback';
import { FilterBar, FilterLink, PageHeader } from '@/components/ui/page-header';
import { Price } from '@/components/commerce/price';
import { RequestStatusBadge } from '@/components/commerce/status';
import type { RequestStatus as BadgeStatus } from '@/components/commerce/status';
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
  REQUEST_STATUS_LABELS,
  REQUEST_TRANSITIONS,
  isWaitingOnCustomer,
  type RequestStatus,
} from '@/domain/request';
import {
  listRequestsForStaff,
  type RequestQueueRow,
} from '@/server/repositories/request-repository';
import { archivedCount } from '@/server/services/archive-service';
import { formatDate } from '@/i18n/format';
import { workshopDictionary } from '@/i18n/server';
import type { Dictionary } from '@/i18n';
import type { Locale } from '@/i18n/locales';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await workshopDictionary();
  return { title: t.admin.navRequests };
}

export const dynamic = 'force-dynamic';

/**
 * The statuses worth filtering by.
 *
 * Taken from the transition table rather than typed out, so a status added to
 * `BUSINESS-RULES.md` section 6 appears here without this file being edited.
 * `DRAFT` is excluded because the queue never shows one — a draft request has
 * not been submitted, and the repository filters it out.
 */
type QueueStatus = Exclude<RequestStatus, 'DRAFT'>;

const STATUSES = (Object.keys(REQUEST_TRANSITIONS) as RequestStatus[]).filter(
  (status): status is QueueStatus => status !== 'DRAFT',
);

function isRequestStatus(value: string | undefined): value is QueueStatus {
  return value !== undefined && STATUSES.includes(value as QueueStatus);
}

/** How long a request has been sitting, in whole days. */
function ageInDays(from: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - from.getTime()) / 86_400_000));
}

function ageLabel(days: number, t: Dictionary): string {
  if (days === 0) return t.admin.ageToday;
  if (days === 1) return t.admin.ageOneDay;
  return t.admin.ageDays(days);
}

/**
 * One queue as a table.
 *
 * Declared at module scope rather than inside the page: a component created
 * during render is a new component type on every render, which throws away the
 * subtree's state each time.
 */
function QueueTable({
  caption,
  rows,
  now,
  locale,
  t,
}: {
  caption: string;
  rows: readonly RequestQueueRow[];
  now: Date;
  locale: Locale;
  t: Dictionary;
}) {
  // Scoped to this table's own rows: the screen is two tables under one
  // selection, and a header box that swept both would not mean what it says.
  const ids = rows.map((request) => request.id);

  return (
    <div className="border-border bg-surface overflow-hidden rounded-md border max-md:border-0 max-md:bg-transparent">
      <Table caption={caption}>
        <TableHead>
          <TableRow>
            <SelectAllCell ids={ids} />
            <TableHeaderCell>{t.admin.colRequest}</TableHeaderCell>
            <TableHeaderCell>{t.admin.colCustomer}</TableHeaderCell>
            <TableHeaderCell align="end" numeric>
              {t.admin.colItems}
            </TableHeaderCell>
            <TableHeaderCell align="end">{t.admin.colEstimate}</TableHeaderCell>
            <TableHeaderCell align="end">{t.admin.colAge}</TableHeaderCell>
            <TableHeaderCell align="end">{t.admin.colState}</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((request) => {
            const received = request.submittedAt ?? request.createdAt;
            const days = ageInDays(received, now);

            return (
              <TableRow key={request.id}>
                <SelectCell id={request.id} label={request.requestNumber} />
                <TableCell label={t.admin.colRequest} bare>
                  <TableRowLink href={`/admin/requests/${request.requestNumber}`}>
                    <span className="font-mono break-all">{request.requestNumber}</span>
                  </TableRowLink>
                  {request.needsInfoReason && (
                    <TableCellMeta>
                      {t.admin.informationAsked} {request.needsInfoReason}
                    </TableCellMeta>
                  )}
                </TableCell>
                <TableCell label={t.admin.colCustomer}>
                  {request.contactName ?? t.admin.colCustomer}
                  {request.contactEmail && (
                    <TableCellMeta>{request.contactEmail}</TableCellMeta>
                  )}
                </TableCell>
                <TableCell label={t.admin.colItems} align="end" numeric>
                  {request.itemCount}
                </TableCell>
                <TableCell label={t.admin.colEstimate} align="end">
                  {request.estimateMin !== null && request.estimateMax !== null ? (
                    <span className="whitespace-nowrap">
                      <Price amount={request.estimateMin} size="sm" /> –{' '}
                      <Price amount={request.estimateMax} size="sm" />
                    </span>
                  ) : (
                    <Text variant="body-sm" tone="subtle" as="span">
                      {t.admin.onQuote}
                    </Text>
                  )}
                </TableCell>
                <TableCell label={t.admin.colAge} align="end">
                  <span
                    className={
                      days >= 2 && !isWaitingOnCustomer(request.status)
                        ? 'text-status-attention'
                        : undefined
                    }
                  >
                    {ageLabel(days, t)}
                  </span>
                  <TableCellMeta>{formatDate(received, locale, 'medium')}</TableCellMeta>
                </TableCell>
                <TableCell label={t.admin.colState} align="end">
                  <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                    {request.hasOutstandingQuote && (
                      <Badge tone="progress">{t.admin.requestQuoteSent}</Badge>
                    )}
                    <RequestStatusBadge status={request.status as BadgeStatus} />
                  </span>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * The request queue.
 *
 * `UX.md` section 6 wants needs-attention pinned. `BUSINESS-RULES.md` 6.7
 * exists so that ordering can be honest: a request in `NEEDS_INFO` or `QUOTED`
 * is the **customer's** move and drops below one in `SUBMITTED`, which is the
 * business's. A message thread does not affect either, which is the whole point
 * of keeping `MESSAGE` and `NEEDS_INFO` apart.
 *
 * Phase 14.5 made that split visible instead of implicit: the two groups are
 * two tables under two headings, so "what is mine" no longer depends on the
 * operator remembering that the list is sorted. Age is a column, because a
 * six-hour response promise is a thing you measure.
 */
export default async function AdminRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; archived?: string }>;
}) {
  const { locale, t } = await workshopDictionary();
  const { status, archived: archivedParam } = await searchParams;
  const filter = isRequestStatus(status) ? status : null;
  const archived = archivedParam === '1';

  const [requests, inArchive] = await Promise.all([
    listRequestsForStaff({ status: filter, archived }),
    archivedCount('request'),
  ]);
  const now = new Date();

  // Switching status must not drop the operator out of the archive, and the
  // other way round, so every link on this screen carries both halves of
  // where they are.
  function hrefFor(candidate: QueueStatus | null): string {
    const params = new URLSearchParams();
    if (candidate) params.set('status', candidate);
    if (archived) params.set('archived', '1');
    const query = params.toString();
    return query ? `/admin/requests?${query}` : '/admin/requests';
  }

  const ours = requests.filter((request) => !isWaitingOnCustomer(request.status));
  const theirs = requests.filter((request) => isWaitingOnCustomer(request.status));

  return (
    <Stack gap={6}>
      <PageHeader
        title="Demandes"
        description="Celles qui attendent une action de l’atelier sont en tête. Les autres attendent une réponse du client."
      />

      <TableToolbar
        actions={
          <ArchiveTabs
            basePath="/admin/requests"
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
              {REQUEST_STATUS_LABELS[candidate]}
            </FilterLink>
          ))}
        </FilterBar>
      </TableToolbar>

      {requests.length === 0 ? (
        <EmptyState
          icon={<Inbox />}
          title={
            archived
              ? t.adminArchive.emptyTitle
              : filter
                ? t.admin.noRequestInQueue
                : t.admin.noRequests
          }
          description={
            archived
              ? t.adminArchive.emptyBody
              : filter
                ? t.admin.nothingInStatus
                : t.admin.requestsAppearHere
          }
        />
      ) : (
        <BulkArchive
          entity="request"
          archived={archived}
          ids={requests.map((request) => request.id)}
        >
          <Stack gap={10}>
            {ours.length > 0 && (
              <section className="flex flex-col gap-3">
                <h2 className="border-border text-heading-md font-sans font-semibold border-b pb-2">
                  {t.admin.toHandle}
                  <span className="text-fg-subtle text-body-sm ml-2 tabular-nums">
                    {ours.length}
                  </span>
                </h2>
                <QueueTable
                  caption={t.admin.requestsWaitingWorkshop}
                  rows={ours}
                  now={now}
                  locale={locale}
                  t={t}
                />
              </section>
            )}

            {theirs.length > 0 && (
              <section className="flex flex-col gap-3">
                <h2 className="border-border text-heading-md font-sans font-semibold border-b pb-2">
                  {t.admin.waitingOnCustomer}
                  <span className="text-fg-subtle text-body-sm ml-2 tabular-nums">
                    {theirs.length}
                  </span>
                </h2>
                <QueueTable
                  caption={t.admin.requestsWaitingCustomer}
                  rows={theirs}
                  now={now}
                  locale={locale}
                  t={t}
                />
              </section>
            )}
          </Stack>
        </BulkArchive>
      )}
    </Stack>
  );
}
