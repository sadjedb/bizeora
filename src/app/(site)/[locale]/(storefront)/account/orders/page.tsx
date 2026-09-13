import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Package } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { Heading, Text } from '@/components/ui/typography';
import { Inline, Stack } from '@/components/layout/layout';
import { Link } from '@/components/ui/link';
import { OrderStatusBadge } from '@/components/commerce/status';
import type { OrderStatus as BadgeStatus } from '@/components/commerce/status';
import { Price } from '@/components/commerce/price';
import { requireCustomer } from '@/server/auth/guards';
import { dictionaryFor } from '@/i18n';
import { formatDate } from '@/i18n/format';
import { listCustomerOrders } from '@/server/services/account-service';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { t } = dictionaryFor((await params).locale);
  return { title: t.account.orders };
}

export const dynamic = 'force-dynamic';

/**
 * The customer's orders.
 *
 * A list of cards rather than a table: `DESIGN-SYSTEM.md` section 13 asks for
 * the stacked-card treatment on a phone, and a five-column table that becomes
 * cards below 768px is two layouts to keep in step. Cards read the same at
 * every width.
 *
 * Guest orders are deliberately absent — an order placed without an account
 * belongs to its token until it is claimed, and claiming is the flow that
 * arrives with post-purchase account creation.
 */
export default async function AccountOrdersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale, t } = dictionaryFor((await params).locale);
  const authorisation = await requireCustomer();
  if (!authorisation.ok) notFound();

  const orders = await listCustomerOrders(authorisation.actor.userId);

  return (
    <Stack gap={6}>
      <Stack gap={2} className="max-w-prose">
        <Heading level={1} variant="display-md">
          {t.account.orders}
        </Heading>
        <Text variant="body" tone="muted">
          {t.order.listLead}
        </Text>
      </Stack>

      {orders.length === 0 ? (
        <EmptyState
          icon={<Package />}
          title={t.account.ordersEmptyTitle}
          description={t.account.ordersEmptyBody}
          action={
            <Button asChild variant="primary">
              <Link href="/shop" variant="plain">
                {t.cart.seeShop}
              </Link>
            </Button>
          }
        />
      ) : (
        <Stack gap={4} as="ul">
          {orders.map((order) => (
            <li key={order.orderNumber}>
              <Card>
                <CardBody>
                  <Stack gap={3}>
                    <Inline gap={3} wrap className="items-center justify-between">
                      <Heading level={2} variant="heading-md">
                        <Link
                          href={`/account/orders/${order.orderNumber}`}
                          className="break-all"
                        >
                          {order.orderNumber}
                        </Link>
                      </Heading>
                      <OrderStatusBadge status={order.status as BadgeStatus} />
                    </Inline>

                    <Inline gap={4} wrap className="items-baseline justify-between">
                      <Text variant="body-sm" tone="muted">
                        {formatDate(order.placedAt, locale, 'medium')} ·{' '}
                        {t.order.itemCount(order.itemCount)} ·{' '}
                        {t.labels.paymentMethod[
                          order.paymentMethod as keyof typeof t.labels.paymentMethod
                        ] ?? order.paymentMethod}
                      </Text>
                      <Price amount={order.grandTotal} currency={order.currency} />
                    </Inline>

                    <Text variant="caption" tone="subtle">
                      {t.labels.paymentStatus[
                        order.paymentStatus as keyof typeof t.labels.paymentStatus
                      ] ?? order.paymentStatus}
                      {order.depositRequired > 0 && order.amountPaid < order.grandTotal
                        ? t.order.depositAsked
                        : ''}
                    </Text>
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
