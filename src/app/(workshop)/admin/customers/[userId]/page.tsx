import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { Badge } from '@/components/ui/feedback';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Grid, Inline, Stack } from '@/components/layout/layout';
import { Heading, Text } from '@/components/ui/typography';
import { Link } from '@/components/ui/link';
import { OrderStatusBadge, QuoteStatusBadge } from '@/components/commerce/status';
import type {
  OrderStatus as BadgeOrderStatus,
  QuoteStatus as BadgeQuoteStatus,
} from '@/components/commerce/status';
import { Price } from '@/components/commerce/price';
import { REQUEST_STATUS_LABELS, type RequestStatus } from '@/domain/request';
import { workshopDictionary } from '@/i18n/server';
import { requireStaff } from '@/server/auth/guards';
import { findCustomerForStaff } from '@/server/repositories/user-repository';

export const metadata: Metadata = { title: 'Client' };

export const dynamic = 'force-dynamic';

const DATE = new Intl.DateTimeFormat('fr-DZ', { dateStyle: 'medium' });

/**
 * One customer, and everything the workshop holds for them.
 *
 * What is **not** here is the point of the projection: no password hash, no
 * session, no token. `findCustomerForStaff` does not select them, so there is
 * nothing on this page to leak — `SECURITY.md` section 2.1 puts them in the
 * never-serialise class and the way to honour that is not to fetch them.
 *
 * A staff member reaching a customer they have no business with is not a
 * concept in V1: 12.1 gives staff "view any customer's order", so the directory
 * is their capability rather than a relationship. A **customer** reaching it is
 * refused by the layout and by this page.
 */
export default async function AdminCustomerPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { t } = await workshopDictionary();
  const { userId } = await params;
  const authorisation = await requireStaff();
  if (!authorisation.ok) notFound();

  const customer = await findCustomerForStaff(userId);

  // A fabricated id and a staff account's id produce the same answer: the
  // query filters on `role: 'CUSTOMER'`, so a colleague is not in the directory.
  if (!customer) notFound();

  return (
    <Stack gap={8}>
      <Stack gap={3}>
        <Text variant="body-sm" tone="muted">
          <Link href="/admin/customers">Clients</Link>
        </Text>

        <Inline gap={3} wrap className="items-center justify-between">
          <Heading level={1} variant="display-md">
            {customer.name ?? customer.email}
          </Heading>
          <Badge variant={customer.emailVerified ? 'solid' : 'outline'}>
            {customer.emailVerified ? t.admin.addressConfirmed : 'À confirmer'}
          </Badge>
        </Inline>

        <Text variant="body-sm" tone="muted" className="break-all">
          {customer.email}
          {customer.phone ? ` · ${customer.phone}` : ''} · compte créé le{' '}
          {DATE.format(customer.createdAt)} · statut {customer.status}
        </Text>
      </Stack>

      <Grid preset="halves" gap={6}>
        <Card>
          <CardHeader
            title="Commandes"
            description={`${customer.orderCount} au total.`}
          />
          <CardBody>
            {customer.orders.length === 0 ? (
              <Text variant="body-sm" tone="muted">
                {t.admin.noOrdersYet}
              </Text>
            ) : (
              <Stack gap={3} as="ul">
                {customer.orders.map((order) => (
                  <li key={order.orderNumber}>
                    <Inline gap={3} wrap className="items-baseline justify-between">
                      <Stack gap={1}>
                        <Link href={`/admin/orders/${order.orderNumber}`}>
                          {order.orderNumber}
                        </Link>
                        <Text variant="caption" tone="subtle">
                          {DATE.format(order.placedAt)}
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
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Demandes"
            description={`${customer.requestCount} au total.`}
          />
          <CardBody>
            {customer.requests.length === 0 ? (
              <Text variant="body-sm" tone="muted">
                {t.admin.noRequestsYet}
              </Text>
            ) : (
              <Stack gap={3} as="ul">
                {customer.requests.map((request) => (
                  <li key={request.requestNumber}>
                    <Inline gap={3} wrap className="items-baseline justify-between">
                      <Link href={`/admin/requests/${request.requestNumber}`}>
                        {request.requestNumber}
                      </Link>
                      <Text variant="caption" tone="subtle" as="span">
                        {REQUEST_STATUS_LABELS[request.status as RequestStatus] ??
                          request.status}{' '}
                        · {DATE.format(request.createdAt)}
                      </Text>
                    </Inline>
                  </li>
                ))}
              </Stack>
            )}
          </CardBody>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader title={t.admin.navQuotes} description="Brouillons exclus." />
          <CardBody>
            {customer.quotes.length === 0 ? (
              <Text variant="body-sm" tone="muted">
                {t.admin.noQuotesSent}
              </Text>
            ) : (
              <Stack gap={3} as="ul">
                {customer.quotes.map((quote) => (
                  <li key={quote.quoteNumber}>
                    <Inline gap={3} wrap className="items-baseline justify-between">
                      <Stack gap={1}>
                        <Text variant="body-sm" as="span">
                          {quote.quoteNumber}
                        </Text>
                        <Text variant="caption" tone="subtle">
                          version {quote.version} · valable jusqu’au{' '}
                          {DATE.format(quote.validUntil)}
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
            )}
          </CardBody>
        </Card>
      </Grid>
    </Stack>
  );
}
