import type { Metadata } from 'next';

import { dictionaryFor } from '@/i18n';
import { formatDate } from '@/i18n/format';
import { notFound } from 'next/navigation';
import { Scissors } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { Heading, Text } from '@/components/ui/typography';
import { Inline, Stack } from '@/components/layout/layout';
import { Link } from '@/components/ui/link';
import { Price } from '@/components/commerce/price';
import { RequestStatusBadge } from '@/components/commerce/status';
import type { RequestStatus as BadgeStatus } from '@/components/commerce/status';
import { requireCustomer } from '@/server/auth/guards';
import { listCustomerRequests } from '@/server/services/account-service';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { t } = dictionaryFor((await params).locale);
  return { title: t.account.requests };
}

export const dynamic = 'force-dynamic';

/**
 * The customer's custom requests.
 *
 * Scoped by `userId` in the query. A guest's request appears here only once it
 * has been claimed by the account whose address it names — which is what
 * pricing it does (Phase 10), so a request in this list is one the workshop has
 * looked at or is looking at.
 */
export default async function AccountRequestsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale, t } = dictionaryFor((await params).locale);
  const authorisation = await requireCustomer();
  if (!authorisation.ok) notFound();

  const requests = await listCustomerRequests(authorisation.actor.userId);

  return (
    <Stack gap={6}>
      <Stack gap={2} className="max-w-prose">
        <Heading level={1} variant="display-md">
          {t.account.requests}
        </Heading>
        <Text variant="body" tone="muted">
          {t.request.listLead}
        </Text>
      </Stack>

      {requests.length === 0 ? (
        <EmptyState
          icon={<Scissors />}
          title={t.account.requestsEmptyTitle}
          description={t.account.requestsEmptyBody}
          action={
            <Button asChild variant="primary">
              <Link href="/custom" variant="plain">
                {t.account.startCustom}
              </Link>
            </Button>
          }
        />
      ) : (
        <Stack gap={4} as="ul">
          {requests.map((request) => (
            <li key={request.id}>
              <Card>
                <CardBody>
                  <Stack gap={3}>
                    <Inline gap={3} wrap className="items-center justify-between">
                      <Heading level={2} variant="heading-md">
                        <Link href={`/account/requests/${request.requestNumber}`}>
                          {request.requestNumber}
                        </Link>
                      </Heading>
                      <RequestStatusBadge status={request.status as BadgeStatus} />
                    </Inline>

                    <Inline gap={4} wrap className="items-baseline justify-between">
                      <Text variant="body-sm" tone="muted">
                        {t.request.itemCount(request.itemCount)} ·{' '}
                        {formatDate(
                          request.submittedAt ?? request.createdAt,
                          locale,
                          'medium',
                        )}
                      </Text>

                      {request.estimateMin !== null && request.estimateMax !== null && (
                        <Text variant="body-sm" tone="muted" as="span">
                          {t.request.estimateShort}{' '}
                          <Price amount={request.estimateMin} size="sm" /> –{' '}
                          <Price amount={request.estimateMax} size="sm" />
                        </Text>
                      )}
                    </Inline>

                    {request.needsInfoReason && (
                      <Text variant="body-sm">
                        <strong>{t.account.needFrom}</strong> {request.needsInfoReason}
                      </Text>
                    )}

                    {request.hasOutstandingQuote && (
                      <Text variant="body-sm" tone="muted">
                        {t.request.quoteWaiting}
                      </Text>
                    )}
                  </Stack>
                </CardBody>
              </Card>
            </li>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
