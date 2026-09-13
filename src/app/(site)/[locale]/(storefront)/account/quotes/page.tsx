import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { FileText } from 'lucide-react';

import { Card, CardBody } from '@/components/ui/card';
import { Inline, Stack } from '@/components/layout/layout';
import { EmptyState } from '@/components/ui/feedback';
import { Heading, Text } from '@/components/ui/typography';
import { Link } from '@/components/ui/link';
import { Price } from '@/components/commerce/price';
import { QuoteStatusBadge } from '@/components/commerce/status';
import type { QuoteStatus as BadgeStatus } from '@/components/commerce/status';
import { Button } from '@/components/ui/button';
import { dictionaryFor } from '@/i18n';
import { formatDate } from '@/i18n/format';
import { requireCustomer } from '@/server/auth/guards';
import { listQuotesForCustomer } from '@/server/services/quote-service';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { t } = dictionaryFor((await params).locale);
  return {
    title: t.account.quotes,
    description: t.account.quotesMetaDescription,
    robots: { index: false, follow: false },
  };
}

export const dynamic = 'force-dynamic';

/**
 * The customer's quotes.
 *
 * The status shown is the **effective** one: a quote whose validity lapsed
 * reads "Expiré" here even before the hourly job has run (7.4), because a
 * customer must never be shown an offer they can no longer take.
 */
export default async function QuotesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale, t } = dictionaryFor((await params).locale);
  const authorisation = await requireCustomer();

  if (!authorisation.ok) {
    redirect(
      authorisation.reason === 'UNAUTHENTICATED'
        ? '/login?next=%2Faccount%2Fquotes'
        : '/',
    );
  }

  const quotes = await listQuotesForCustomer(authorisation.actor.userId);

  return (
    <Stack gap={8}>
      <Stack gap={2} className="max-w-prose">
        <Heading level={1} variant="display-md">
          {t.account.quotes}
        </Heading>
        <Text variant="body" tone="muted">
          {t.quote.listLead}
        </Text>
      </Stack>

      {quotes.length === 0 ? (
        <EmptyState
          icon={<FileText />}
          title={t.account.quotesEmptyTitle}
          description={t.account.quotesEmptyBody}
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
          {quotes.map((quote) => (
            <li key={quote.quoteNumber}>
              <Card>
                <CardBody>
                  <Stack gap={3}>
                    <Inline gap={3} wrap className="items-center justify-between">
                      <Heading level={2} variant="heading-md">
                        <Link href={`/account/quotes/${quote.quoteNumber}`}>
                          {t.quote.numbered(quote.quoteNumber)}
                        </Link>
                      </Heading>
                      <QuoteStatusBadge status={quote.status as BadgeStatus} />
                    </Inline>

                    <Inline gap={4} wrap className="items-baseline justify-between">
                      <Price amount={quote.grandTotal} currency={quote.currency} />
                      <Text variant="body-sm" tone="muted">
                        {quote.acceptable
                          ? t.quote.acceptBefore(formatDate(quote.validUntil, locale))
                          : t.quote.fromRequest(quote.requestNumber)}
                      </Text>
                    </Inline>
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
