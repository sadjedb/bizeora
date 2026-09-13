import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { Alert } from '@/components/ui/feedback';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { CustomizationSummary } from '@/components/commerce/customization-summary';
import { Heading, Text } from '@/components/ui/typography';
import { Inline, Stack } from '@/components/layout/layout';
import { Link } from '@/components/ui/link';
import { Price } from '@/components/commerce/price';
import { QuoteStatusBadge, RequestStatusBadge } from '@/components/commerce/status';
import type {
  QuoteStatus as BadgeQuoteStatus,
  RequestStatus as BadgeRequestStatus,
} from '@/components/commerce/status';
import { dictionaryFor, type Dictionary } from '@/i18n';
import { formatDate, formatDateTime } from '@/i18n/format';
import { requireCustomer } from '@/server/auth/guards';
import { getCustomerRequestPage } from '@/server/services/account-service';
import { getRequestFileAccess } from '@/server/services/design-file-service';

import { ReplyForm } from './reply-form';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { t } = dictionaryFor((await params).locale);
  return { title: t.request.title };
}

export const dynamic = 'force-dynamic';

function eventLabels(t: Dictionary): Record<string, string> {
  return {
    STATUS_CHANGE: t.request.eventStatusChange,
    MESSAGE: t.request.eventMessage,
    FILE_ADDED: t.request.eventFileAdded,
    QUOTE_SENT: t.request.eventQuoteSent,
  };
}

/**
 * One of the customer's own requests.
 *
 * What is **not** on this page is as deliberate as what is. No internal note —
 * `listRequestEvents` filters `INTERNAL_NOTE` and `isCustomerVisible: false` in
 * the query, so they are not fetched rather than hidden. No storage key: the
 * artwork is a five-minute signed URL from the Phase 9 boundary. No draft
 * quote: a draft is the workshop's working copy, and only what has actually
 * been sent is listed.
 *
 * A blocked request (`NEEDS_INFO`) leads with what is needed, verbatim (6.7.1),
 * because that sentence is the whole reason the request stopped.
 */
export default async function CustomerRequestPage({
  params,
}: {
  params: Promise<{ locale: string; requestNumber: string }>;
}) {
  const { locale: localeParam, requestNumber } = await params;
  const { locale, t } = dictionaryFor(localeParam);
  const authorisation = await requireCustomer();
  if (!authorisation.ok) notFound();

  const request = await getCustomerRequestPage({
    requestNumber,
    userId: authorisation.actor.userId,
  });

  // Somebody else's request number and one that never existed produce the same
  // page, because the ownership filter is in the query and this is the only
  // answer either case yields (`SECURITY.md` section 4).
  if (!request) notFound();

  const artwork = await Promise.all(
    request.configurations.map(async (configuration) =>
      Promise.all(
        configuration.files.map(async (file) => {
          const access = await getRequestFileAccess({
            designFileId: file.designFileId,
            requestId: request.requestId,
            actorUserId: authorisation.actor.userId,
            asStaff: false,
          });

          return {
            designFileId: file.designFileId,
            filename: file.filename,
            role: file.role,
            previewUrl: access.ok ? access.value.previewUrl : null,
            downloadUrl: access.ok ? access.value.downloadUrl : null,
          };
        }),
      ),
    ),
  );

  const blocked = request.status === 'NEEDS_INFO';

  return (
    <Stack gap={8}>
      <Stack gap={3}>
        <Text variant="body-sm" tone="muted">
          <Link href="/account/requests">{t.account.requests}</Link>
        </Text>

        <Inline gap={3} wrap className="items-center justify-between">
          <Heading level={1} variant="display-md">
            {t.request.numbered(request.requestNumber)}
          </Heading>
          <RequestStatusBadge status={request.status as BadgeRequestStatus} />
        </Inline>

        <Text variant="body-sm" tone="muted">
          {t.request.statusLine(
            t.labels.requestStatus[request.status],
            formatDate(request.submittedAt ?? request.createdAt, locale),
          )}
        </Text>
      </Stack>

      {blocked && request.needsInfoReason && (
        <Alert tone="warning" title={t.request.needsInfoTitle}>
          {request.needsInfoReason}
        </Alert>
      )}

      {request.quotes.length > 0 && (
        <Card>
          <CardHeader title={t.request.quotes} />
          <CardBody>
            <Stack gap={4} as="ul">
              {request.quotes.map((quote) => (
                <li key={quote.quoteNumber}>
                  <Inline gap={4} wrap className="items-baseline justify-between">
                    <Stack gap={1}>
                      <Link href={`/account/quotes/${quote.quoteNumber}`}>
                        {t.quote.numbered(quote.quoteNumber)}
                      </Link>
                      <Text variant="caption" tone="subtle">
                        {t.request.quoteVersion(quote.version)}
                        {quote.acceptable
                          ? t.request.quoteAnswerBefore(
                              formatDate(quote.validUntil, locale),
                            )
                          : ''}
                      </Text>
                    </Stack>
                    <Inline gap={3} className="items-center">
                      <Price amount={quote.grandTotal} currency={quote.currency} />
                      <QuoteStatusBadge status={quote.status as BadgeQuoteStatus} />
                    </Inline>
                  </Inline>
                </li>
              ))}
            </Stack>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title={t.request.whatYouAsked} />
        <CardBody>
          <Stack gap={6}>
            {request.customerNote && (
              <Stack gap={1}>
                <Text variant="caption" tone="subtle">
                  {t.request.yourNote}
                </Text>
                <Text variant="body-sm" tone="muted">
                  {request.customerNote}
                </Text>
              </Stack>
            )}

            {request.configurations.map((configuration, index) => (
              <CustomizationSummary
                key={configuration.requestItemId}
                configuration={configuration}
                artwork={artwork[index] ?? []}
              />
            ))}

            {request.estimateMin !== null && request.estimateMax !== null && (
              <Text variant="body-sm" tone="muted">
                {t.request.estimateLead}&nbsp;:{' '}
                <Price amount={request.estimateMin} size="sm" /> –{' '}
                <Price amount={request.estimateMax} size="sm" />
                {t.request.estimateCaveat}
              </Text>
            )}
          </Stack>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t.request.timeline} />
        <CardBody>
          {request.timeline.length === 0 ? (
            <Text variant="body-sm" tone="muted">
              {t.request.timelineEmpty}
            </Text>
          ) : (
            <Stack gap={4} as="ol">
              {request.timeline.map((event) => (
                <li key={event.id}>
                  <Stack gap={1}>
                    <Text variant="caption" tone="subtle" as="span">
                      {formatDateTime(event.createdAt, locale)} ·{' '}
                      {event.actorType === 'CUSTOMER'
                        ? t.request.actorYou
                        : t.request.actorWorkshop}
                    </Text>
                    <Text variant="body-sm" as="span">
                      {event.message ??
                        (event.toStatus
                          ? t.request.statusEvent(
                              t.labels.requestStatus[
                                event.toStatus as keyof typeof t.labels.requestStatus
                              ] ?? event.toStatus,
                            )
                          : (eventLabels(t)[event.type] ?? event.type))}
                    </Text>
                  </Stack>
                </li>
              ))}
            </Stack>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={blocked ? t.request.replyTitle : t.request.askTitle}
          description={t.request.replyDescription}
        />
        <CardBody>
          <ReplyForm requestNumber={request.requestNumber} blocked={blocked} />
        </CardBody>
      </Card>
    </Stack>
  );
}
