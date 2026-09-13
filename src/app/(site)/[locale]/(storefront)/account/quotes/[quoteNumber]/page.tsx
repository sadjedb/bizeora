import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { Alert } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Inline, Stack } from '@/components/layout/layout';
import { CustomizationSummary } from '@/components/commerce/customization-summary';
import { Heading, Text } from '@/components/ui/typography';
import { Link } from '@/components/ui/link';
import { QuoteLines } from '@/components/commerce/quote-lines';
import { QuoteStatusBadge } from '@/components/commerce/status';
import type { QuoteStatus as BadgeStatus } from '@/components/commerce/status';
import type { QuoteLineKind } from '@/domain/quote/pricing';
import { dictionaryFor } from '@/i18n';
import { formatDate } from '@/i18n/format';
import { requireCustomer } from '@/server/auth/guards';
import { getCustomerQuotePage } from '@/server/services/quote-service';
import { getRequestFileAccess } from '@/server/services/design-file-service';

import { QuoteResponse } from './quote-response';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { t } = dictionaryFor((await params).locale);
  return { title: t.quote.title, robots: { index: false, follow: false } };
}

export const dynamic = 'force-dynamic';

/**
 * A quote, as its owner sees it.
 *
 * Three rules from `BUSINESS-RULES.md` section 7 are visible on this page:
 *
 *   - **the effective status** (7.4): a quote past `validUntil` reads as
 *     expired whether or not the hourly job has run, so nothing here offers a
 *     customer an acceptance the server would refuse;
 *   - **the freeze** (7.2.1, ADR-016): the configuration is rendered from its
 *     display snapshots, so the quote still describes what was quoted after the
 *     catalogue has moved on;
 *   - **acceptance validity** (7.10): once accepted, the page shows the
 *     redemption deadline and, past it, becomes read-only.
 *
 * Every amount is printed from the stored quote. Nothing on this page adds
 * anything up.
 */
export default async function QuoteDetailPage({
  params,
}: {
  params: Promise<{ locale: string; quoteNumber: string }>;
}) {
  const { locale: localeParam, quoteNumber } = await params;
  const { locale, t } = dictionaryFor(localeParam);
  const authorisation = await requireCustomer();

  if (!authorisation.ok) {
    redirect(
      authorisation.reason === 'UNAUTHENTICATED'
        ? `/login?next=${encodeURIComponent(`/account/quotes/${quoteNumber}`)}`
        : '/',
    );
  }

  const page = await getCustomerQuotePage({
    quoteNumber,
    userId: authorisation.actor.userId,
  });

  // A quote belonging to somebody else is indistinguishable from one that does
  // not exist: the ownership filter is in the query, and this is the only
  // answer either case produces (SECURITY.md section 4).
  if (!page.ok) notFound();

  const { quote, requestId, configurations } = page.value;

  // Signed URLs, resolved here rather than handed to the browser as keys. Each
  // lives five minutes and is scoped to a file this request actually names.
  const artwork = await Promise.all(
    configurations.map(async (configuration) =>
      Promise.all(
        configuration.files.map(async (file) => {
          const access = await getRequestFileAccess({
            designFileId: file.designFileId,
            requestId,
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

  return (
    <Stack gap={8}>
      <Stack gap={3}>
        <Text variant="body-sm" tone="muted">
          <Link href="/account/quotes">{t.account.quotes}</Link>
        </Text>

        <Inline gap={3} wrap className="items-center justify-between">
          <Heading level={1} variant="display-md">
            {t.quote.numbered(quote.quoteNumber)}
          </Heading>
          <QuoteStatusBadge status={quote.status as BadgeStatus} />
        </Inline>

        <Text variant="body-sm" tone="muted">
          {t.quote.versionLine(quote.version, quote.requestNumber)}
        </Text>
      </Stack>

      {quote.acceptable && (
        <Alert tone="info" title={t.quote.awaitingTitle}>
          {t.quote.validUntil(formatDate(quote.validUntil, locale))}
        </Alert>
      )}

      {quote.status === 'EXPIRED' && (
        <Alert tone="warning" title={t.quote.expiredTitle}>
          {t.quote.expiredBody}
        </Alert>
      )}

      {quote.acceptanceLapsed && (
        <Alert tone="warning" title={t.quote.lapsedTitle}>
          {t.quote.lapsedBody}
        </Alert>
      )}

      {quote.customerMessage && (
        <Alert tone="neutral" title={t.quote.workshopMessage}>
          {quote.customerMessage}
        </Alert>
      )}

      <Card>
        <CardHeader title={t.quote.detail} />
        <CardBody>
          <QuoteLines
            currency={quote.currency}
            lines={quote.lines.map((line, index) => ({
              id: `${line.label}-${index}`,
              kindLabel: t.labels.quoteLineKind[line.kind as QuoteLineKind],
              label: line.label,
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              lineTotal: line.lineTotal,
            }))}
            totals={{
              subtotal: quote.subtotal,
              discountTotal: quote.discountTotal,
              shippingTotal: quote.shippingTotal,
              grandTotal: quote.grandTotal,
              depositRequired: quote.depositRequired,
            }}
          />
        </CardBody>
      </Card>

      {configurations.length > 0 && (
        <Card>
          <CardHeader title={t.quote.whatWasQuoted} />
          <CardBody>
            <Stack gap={6}>
              {configurations.map((configuration, index) => (
                <CustomizationSummary
                  key={configuration.requestItemId}
                  configuration={configuration}
                  artwork={artwork[index] ?? []}
                />
              ))}
            </Stack>
          </CardBody>
        </Card>
      )}

      {quote.acceptable && <QuoteResponse quoteNumber={quote.quoteNumber} />}

      {quote.checkout && (
        <Card>
          <CardHeader title={t.quote.acceptedTitle} />
          <CardBody>
            <Stack gap={4}>
              <Text variant="body-sm" tone="muted">
                {quote.checkout.validUntil
                  ? t.quote.finaliseBefore(formatDate(quote.checkout.validUntil, locale))
                  : t.quote.finalise}
              </Text>
              <div>
                <Button asChild variant="primary">
                  <Link href={`/checkout/quote/${quote.checkout.cartId}`} variant="plain">
                    {t.quote.finaliseCta}
                  </Link>
                </Button>
              </div>
            </Stack>
          </CardBody>
        </Card>
      )}

      {quote.status === 'REJECTED' && (
        <Alert tone="neutral" title={t.quote.rejectedTitle}>
          {quote.rejectionReason ?? t.quote.rejectedBody}
        </Alert>
      )}
    </Stack>
  );
}
