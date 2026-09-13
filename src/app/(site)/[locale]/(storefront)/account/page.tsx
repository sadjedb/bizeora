import type { Metadata } from 'next';

import { dictionaryFor } from '@/i18n';
import { formatDate } from '@/i18n/format';
import { ArrowRight, PackageSearch } from 'lucide-react';
import { notFound } from 'next/navigation';

import { Alert, Divider, EmptyState } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Grid, Inline, Stack } from '@/components/layout/layout';
import { Heading, Text } from '@/components/ui/typography';
import { Link } from '@/components/ui/link';
import { Price } from '@/components/commerce/price';
import { OrderStatusBadge, RequestStatusBadge } from '@/components/commerce/status';
import type {
  OrderStatus as BadgeOrderStatus,
  RequestStatus as BadgeRequestStatus,
} from '@/components/commerce/status';
import { requireCustomer } from '@/server/auth/guards';
import { getAccountOverview } from '@/server/services/account-service';
import { siteSettings } from '@/server/services/settings-service';
import { getCurrentUserProfile } from '@/server/repositories/user-repository';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { t } = dictionaryFor((await params).locale);
  return { title: t.account.overview };
}

export const dynamic = 'force-dynamic';

/**
 * The account overview.
 *
 * `UX.md` section 8: "a triage screen, not a vanity dashboard", in a fixed
 * priority order — quotes awaiting a response first, because they are the only
 * place money is blocked; then orders in flight; then requests under review;
 * then recent orders; then the ways out.
 *
 * There is no statistic on this page. A count of orders placed is a number a
 * customer already knows and cannot act on, and `PRODUCT.md` keeps analytics
 * out of V1 entirely.
 */
export default async function AccountOverviewPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale, t } = dictionaryFor((await params).locale);
  const authorisation = await requireCustomer();
  if (!authorisation.ok) notFound();

  const [overview, profile, { emailVerificationRequired: verificationRequired }] =
    await Promise.all([
      getAccountOverview(authorisation.actor.userId),
      getCurrentUserProfile(authorisation.actor.userId),
      siteSettings(),
    ]);

  const nothingInFlight =
    overview.quotesAwaitingResponse.length === 0 &&
    overview.ordersInFlight.length === 0 &&
    overview.requestsInProgress.length === 0;

  return (
    <Stack gap={8}>
      <Stack gap={2} className="max-w-prose">
        <Heading level={1} variant="display-md">
          {t.account.greeting(profile?.name ?? null)}
        </Heading>
        <Text variant="body" tone="muted">
          {t.account.lead}
        </Text>
      </Stack>

      {/*
       * Only nag when it means something.
       *
       * With `accounts.emailVerificationRequired` off, an unverified address
       * blocks nothing — so telling the customer to confirm it is asking them
       * to do a chore with no consequence, about an e-mail the shop may not
       * even be able to send.
       */}
      {verificationRequired && profile && !profile.emailVerified && (
        <Alert tone="warning" title={t.account.verifyTitle}>
          {t.account.verifyBody(profile.email)}
        </Alert>
      )}

      {nothingInFlight && overview.counts.orders === 0 && (
        <EmptyState
          icon={<PackageSearch />}
          title={t.account.nothingTitle}
          description={t.account.nothingBody}
          action={
            <Button asChild variant="primary">
              <Link href="/custom" variant="plain">
                {t.account.startCustom}
              </Link>
            </Button>
          }
        />
      )}

      {overview.quotesAwaitingResponse.length > 0 && (
        <Card>
          <CardHeader
            title={t.account.quotesAwaiting}
            description={t.account.quotesAwaitingHint}
          />
          <CardBody>
            <Stack gap={4} as="ul">
              {overview.quotesAwaitingResponse.map((quote) => (
                <li key={quote.quoteNumber}>
                  <Inline gap={4} wrap className="items-baseline justify-between">
                    <Stack gap={1}>
                      <Link href={`/account/quotes/${quote.quoteNumber}`}>
                        {t.quote.numbered(quote.quoteNumber)}
                      </Link>
                      <Text variant="caption" tone="subtle">
                        {t.account.quoteAnswerBy(
                          formatDate(quote.validUntil, locale, 'medium'),
                        )}
                      </Text>
                    </Stack>
                    <Price amount={quote.grandTotal} currency={quote.currency} />
                  </Inline>
                </li>
              ))}
            </Stack>
          </CardBody>
        </Card>
      )}

      <Grid preset="halves" gap={6}>
        <Card>
          <CardHeader title={t.account.ordersInFlight} />
          <CardBody>
            {overview.ordersInFlight.length === 0 ? (
              <Text variant="body-sm" tone="muted">
                {t.account.noOrdersInFlight}
              </Text>
            ) : (
              <Stack gap={4} as="ul">
                {overview.ordersInFlight.map((order) => (
                  <li key={order.orderNumber}>
                    <Stack gap={2}>
                      <Inline gap={3} wrap className="items-center justify-between">
                        <Link href={`/account/orders/${order.orderNumber}`}>
                          {order.orderNumber}
                        </Link>
                        <OrderStatusBadge status={order.status as BadgeOrderStatus} />
                      </Inline>
                      <Text variant="caption" tone="subtle">
                        {formatDate(order.placedAt, locale, 'medium')}
                      </Text>
                    </Stack>
                  </li>
                ))}
              </Stack>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t.account.requestsInReview} />
          <CardBody>
            {overview.requestsInProgress.length === 0 ? (
              <Text variant="body-sm" tone="muted">
                {t.account.noRequests}
              </Text>
            ) : (
              <Stack gap={4} as="ul">
                {overview.requestsInProgress.map((request) => (
                  <li key={request.id}>
                    <Stack gap={2}>
                      <Inline gap={3} wrap className="items-center justify-between">
                        <Link href={`/account/requests/${request.requestNumber}`}>
                          {request.requestNumber}
                        </Link>
                        <RequestStatusBadge
                          status={request.status as BadgeRequestStatus}
                        />
                      </Inline>
                      {request.needsInfoReason && (
                        <Text variant="caption" tone="subtle">
                          {t.account.needFrom} {request.needsInfoReason}
                        </Text>
                      )}
                    </Stack>
                  </li>
                ))}
              </Stack>
            )}
          </CardBody>
        </Card>
      </Grid>

      {overview.recentOrders.length > 0 && (
        <Card>
          <CardHeader title={t.account.recentOrders} />
          <CardBody>
            <Stack gap={4} as="ul">
              {overview.recentOrders.map((order) => (
                <li key={order.orderNumber}>
                  <Inline gap={4} wrap className="items-baseline justify-between">
                    <Stack gap={1}>
                      <Link href={`/account/orders/${order.orderNumber}`}>
                        {order.orderNumber}
                      </Link>
                      <Text variant="caption" tone="subtle">
                        {formatDate(order.placedAt, locale, 'medium')}
                      </Text>
                    </Stack>
                    <Inline gap={3} className="items-center">
                      <Price amount={order.grandTotal} currency={order.currency} />
                      <OrderStatusBadge status={order.status as BadgeOrderStatus} />
                    </Inline>
                  </Inline>
                </li>
              ))}
            </Stack>
          </CardBody>
        </Card>
      )}

      <Divider />

      <Inline gap={3} wrap>
        <Button asChild variant="primary">
          <Link href="/custom" variant="plain">
            {t.account.startCustom}
          </Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/shop" variant="plain">
            {t.cart.seeShop}
          </Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/account/orders" variant="plain">
            {t.account.seeAllOrders} <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </Button>
      </Inline>
    </Stack>
  );
}
