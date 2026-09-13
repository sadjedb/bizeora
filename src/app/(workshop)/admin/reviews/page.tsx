import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import {
  ArchiveTabs,
  BulkArchive,
  SelectAllToggle,
  SelectToggle,
} from '@/components/admin/bulk-archive';
import { Badge, EmptyState } from '@/components/ui/feedback';
import { Card, CardBody } from '@/components/ui/card';
import { Heading, Text } from '@/components/ui/typography';
import { Inline, Stack } from '@/components/layout/layout';
import { Link } from '@/components/ui/link';
import { ReviewStars } from '@/components/commerce/rating';
import { cn } from '@/components/ui/cn';
import {
  REVIEW_STATUSES,
  REVIEW_STATUS_LABELS,
  type ReviewStatus,
} from '@/domain/review';
import { mayModerateReviews } from '@/domain/permissions';
import { formatDate } from '@/i18n/format';
import { workshopDictionary } from '@/i18n/server';
import { requireStaff } from '@/server/auth/guards';
import { archivedCount } from '@/server/services/archive-service';
import {
  countReviewsByStatus,
  listReviewsForModeration,
} from '@/server/repositories/review-repository';

import { ModerationControls } from './moderation-controls';

export const metadata: Metadata = {
  title: 'Avis',
  robots: { index: false, follow: false },
};

/**
 * The moderation queue.
 *
 * 11A.3: a review is `PENDING` until somebody looks at it, and only `APPROVED`
 * reviews are public. This screen is where that decision is made, and it is the
 * only place in the application that can publish a customer's words.
 *
 * The page authorises, and so does every action it renders — the layout guard
 * is not the boundary, because an action is reachable without a page ever
 * rendering (`SECURITY.md` section 10).
 *
 * The filter is a query parameter rather than component state: a moderator who
 * sends "the pending ones" to a colleague sends a URL, and the back button
 * works.
 */
export const dynamic = 'force-dynamic';

type PageProps = {
  searchParams: Promise<{ status?: string | string[]; archived?: string | string[] }>;
};

function parseStatus(value: string | string[] | undefined): ReviewStatus | null {
  if (typeof value !== 'string') return null;

  return (REVIEW_STATUSES as readonly string[]).includes(value)
    ? (value as ReviewStatus)
    : null;
}

export default async function AdminReviewsPage({ searchParams }: PageProps) {
  const { locale, t } = await workshopDictionary();
  const authorisation = await requireStaff();

  if (!authorisation.ok) {
    redirect(
      authorisation.reason === 'UNAUTHENTICATED' ? '/login?next=/admin/reviews' : '/',
    );
  }

  if (!mayModerateReviews(authorisation.actor)) redirect('/');

  const params = await searchParams;
  const status = parseStatus(params.status);
  const archived = params.archived === '1';

  const [reviews, counts, inArchive] = await Promise.all([
    listReviewsForModeration({ status, archived }),
    countReviewsByStatus(),
    archivedCount('review'),
  ]);

  // A filter link must not drop the moderator out of the half they are in.
  function hrefFor(candidate: ReviewStatus | null): string {
    const query = new URLSearchParams();
    if (candidate) query.set('status', candidate);
    if (archived) query.set('archived', '1');
    const search = query.toString();
    return search ? `/admin/reviews?${search}` : '/admin/reviews';
  }

  const filters: readonly {
    label: string;
    href: string;
    active: boolean;
    count: number;
  }[] = [
    {
      label: 'Tous',
      href: hrefFor(null),
      active: status === null,
      count: counts.PENDING + counts.APPROVED + counts.REJECTED,
    },
    ...REVIEW_STATUSES.map((candidate) => ({
      label: REVIEW_STATUS_LABELS[candidate],
      href: hrefFor(candidate),
      active: status === candidate,
      count: counts[candidate],
    })),
  ];

  return (
    <Stack gap={10}>
      <Stack gap={3}>
        <Heading level={1} variant="display-md">
          {t.admin.reviewsTitle}
        </Heading>
        <Text variant="body" tone="muted" className="max-w-prose">
          {t.admin.reviewsModerationLead}
        </Text>
      </Stack>

      <ArchiveTabs
        basePath="/admin/reviews"
        archived={archived}
        count={inArchive}
        search={status ? { status } : undefined}
      />

      <nav aria-label={t.admin.filterByState}>
        <ul className="flex list-none flex-wrap gap-2 p-0">
          {filters.map((filter) => (
            <li key={filter.href}>
              <Link
                href={filter.href}
                variant="plain"
                aria-current={filter.active ? 'page' : undefined}
                className={cn(
                  'text-body-sm inline-flex min-h-11 items-center gap-2 rounded-sm border px-3',
                  filter.active
                    ? 'border-fg bg-fg text-fg-inverted font-medium'
                    : 'border-border text-fg-muted hover:border-border-strong hover:text-fg',
                )}
              >
                {filter.label}
                <span className="tabular-nums">{filter.count}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {reviews.length === 0 ? (
        <EmptyState
          title={archived ? t.adminArchive.emptyTitle : t.admin.reviewsEmptyTitle}
          description={
            archived
              ? t.adminArchive.emptyBody
              : status === 'PENDING'
                ? t.admin.reviewsEmptyBody
                : 'Changez de filtre pour voir les autres avis.'
          }
        />
      ) : (
        <BulkArchive
          entity="review"
          archived={archived}
          ids={reviews.map((review) => review.id)}
        >
          <Stack gap={6}>
            {/*
             * The moderation queue is cards rather than a table — a review is a
             * paragraph of somebody's writing and does not fit a column — so the
             * selection controls are the bare toggles rather than table cells.
             */}
            <Inline gap={3} align="center">
              <SelectAllToggle />
              <Text variant="body-sm" tone="subtle">
                {t.adminArchive.selectAll}
              </Text>
            </Inline>

            {reviews.map((review) => (
              <Card key={review.id}>
                <CardBody>
                  <Stack gap={4}>
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <Stack gap={2} className="min-w-0">
                        <Inline gap={3} align="center">
                          <SelectToggle
                            id={review.id}
                            label={`${review.authorName} · ${review.productName}`}
                          />
                          <ReviewStars rating={review.rating} />
                          <Badge
                            variant={review.status === 'APPROVED' ? 'solid' : 'outline'}
                          >
                            {REVIEW_STATUS_LABELS[review.status]}
                          </Badge>
                        </Inline>

                        <Heading level={2} variant="heading-md">
                          <Link href={`/shop/${review.productSlug}`} variant="subtle">
                            {review.productName}
                          </Link>
                        </Heading>

                        <Text variant="body-sm" tone="subtle">
                          {review.authorName} · {review.authorEmail}
                          {review.orderNumber ? ` · ${review.orderNumber}` : ''}
                        </Text>
                      </Stack>

                      <Text variant="body-sm" tone="subtle" className="shrink-0">
                        {formatDate(review.createdAt, locale, 'medium')}
                      </Text>
                    </div>

                    <Stack gap={2}>
                      {review.title && (
                        <Heading level={3} variant="heading-md">
                          {review.title}
                        </Heading>
                      )}

                      {/* Customer-written text. Rendered as text — React escapes
                       * it and nothing here sets inner HTML. */}
                      <Text variant="body" tone="muted" className="whitespace-pre-line">
                        {review.body}
                      </Text>
                    </Stack>

                    {review.adminResponse && (
                      <div className="border-border bg-surface rounded-md border p-4">
                        <Stack gap={2}>
                          <Text variant="body-sm" tone="subtle">
                            {t.admin.reviewResponsePublished}
                          </Text>
                          <Text
                            variant="body-sm"
                            tone="muted"
                            className="whitespace-pre-line"
                          >
                            {review.adminResponse}
                          </Text>
                        </Stack>
                      </div>
                    )}

                    <ModerationControls reviewId={review.id} status={review.status} />
                  </Stack>
                </CardBody>
              </Card>
            ))}
          </Stack>
        </BulkArchive>
      )}
    </Stack>
  );
}
