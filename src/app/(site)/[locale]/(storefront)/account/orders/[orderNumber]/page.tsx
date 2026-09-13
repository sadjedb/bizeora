import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { Alert, Divider } from '@/components/ui/feedback';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Heading, Overline, Text } from '@/components/ui/typography';
import { Inline, Stack } from '@/components/layout/layout';
import { Link } from '@/components/ui/link';
import { OrderStatusBadge } from '@/components/commerce/status';
import type { OrderStatus as BadgeStatus } from '@/components/commerce/status';
import { Price } from '@/components/commerce/price';
import { ProductImage } from '@/components/media/product-image';
import type { PaymentMethod } from '@/domain/order/payment-method';
import { dictionaryFor } from '@/i18n';
import { formatDate, formatDateTime } from '@/i18n/format';
import { requireCustomer } from '@/server/auth/guards';
import { getCustomerOrder } from '@/server/services/account-service';
import { findProofForOwner } from '@/server/repositories/order-repository';

import { ProofUpload } from './proof-upload';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { t } = dictionaryFor((await params).locale);
  return { title: t.order.detailTitle };
}

export const dynamic = 'force-dynamic';

/**
 * One of the customer's own orders.
 *
 * **Every value on this page is a snapshot.** `nameSnapshot`,
 * `variantLabelSnapshot`, `skuSnapshot`, `imageKeySnapshot`,
 * `wilayaNameSnapshot`, `shippingRateLabel` and the stored totals — nothing is
 * re-read from the catalogue, so renaming a product or changing its price
 * tomorrow does not rewrite what this customer bought (ADR-016,
 * `DATABASE.md` section 8).
 *
 * The timeline is `order_status_history`, which `DATABASE.md` section 8 calls
 * the truth to `orders.status`'s convenience, filtered to customer-visible
 * entries **in the query**.
 */
export default async function CustomerOrderPage({
  params,
}: {
  params: Promise<{ locale: string; orderNumber: string }>;
}) {
  const { locale: localeParam, orderNumber } = await params;
  const { locale, t } = dictionaryFor(localeParam);
  const authorisation = await requireCustomer();
  if (!authorisation.ok) notFound();

  const order = await getCustomerOrder({
    orderNumber,
    userId: authorisation.actor.userId,
  });

  // No guest token is consulted inside the account area: here, owning the row
  // is the only thing that grants access.
  if (!order) notFound();

  const balance = order.grandTotal - order.amountPaid;

  // 8.10.2: where the customer's transfer receipt stands. Scoped to an order
  // they own, in the query.
  const proof = await findProofForOwner({
    orderNumber,
    userId: authorisation.actor.userId,
  });

  const awaitingDeposit =
    order.status === 'AWAITING_PAYMENT' && order.depositRequired > 0;

  return (
    <Stack gap={8}>
      <Stack gap={3}>
        <Text variant="body-sm" tone="muted">
          <Link href="/account/orders">{t.account.orders}</Link>
        </Text>

        <Inline gap={3} wrap className="items-center justify-between">
          <Heading level={1} variant="display-md" className="break-all">
            {t.order.numbered(order.orderNumber)}
          </Heading>
          <OrderStatusBadge status={order.status as BadgeStatus} />
        </Inline>

        <Text variant="body-sm" tone="muted">
          {t.order.statusLine(
            t.labels.orderStatus[order.status],
            formatDate(order.placedAt, locale),
          )}
        </Text>
      </Stack>

      {awaitingDeposit && (
        <Alert tone="warning" title={t.order.awaitingDepositTitle}>
          {t.order.awaitingDepositReferenceBefore}
          <strong>{order.orderNumber}</strong>
          {t.order.awaitingDepositReferenceAfter}
        </Alert>
      )}

      {proof?.status === 'SUBMITTED' && (
        <Alert tone="info" title={t.order.proofReceivedTitle}>
          {t.order.proofReceivedBody(formatDate(proof.createdAt, locale))}
        </Alert>
      )}

      {proof?.status === 'REJECTED' && (
        <Alert tone="warning" title={t.order.proofRejectedTitle}>
          {proof.rejectionReason ?? t.order.proofRejectedBody}
        </Alert>
      )}

      {proof?.status === 'ACCEPTED' && (
        <Alert tone="success" title={t.order.proofAcceptedTitle}>
          {t.order.proofAcceptedBody}
        </Alert>
      )}

      {awaitingDeposit && proof?.status !== 'SUBMITTED' && (
        <Card>
          <CardHeader
            title={t.order.proofUploadTitle}
            description={t.order.proofUploadBody}
          />
          <CardBody>
            <ProofUpload orderNumber={order.orderNumber} />
          </CardBody>
        </Card>
      )}

      {order.quoteNumber && (
        <Alert tone="neutral" title={t.order.fromQuoteTitle}>
          {t.order.fromQuoteBefore}
          <Link href={`/account/quotes/${order.quoteNumber}`}>{order.quoteNumber}</Link>.
        </Alert>
      )}

      <Card>
        <CardHeader title={t.order.items} />
        <CardBody>
          <Stack gap={5}>
            <ul className="flex list-none flex-col gap-4 p-0">
              {order.items.map((item, index) => (
                <li key={`${item.name}-${index}`} className="flex items-start gap-4">
                  {item.kind !== 'FEE' && (
                    <div className="w-16 shrink-0">
                      <ProductImage
                        src={item.image?.src ?? null}
                        alt={item.image?.alt ?? item.name}
                        ratio="square"
                      />
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <Text variant="body">{item.name}</Text>
                    {item.variantLabel && (
                      <Text variant="body-sm" tone="muted">
                        {item.variantLabel}
                      </Text>
                    )}
                    {item.sku && (
                      <Text variant="caption" tone="subtle">
                        {t.order.reference(item.sku)}
                      </Text>
                    )}
                    <Text variant="body-sm" tone="muted">
                      {item.quantity} × <Price amount={item.unitPrice} size="sm" />
                    </Text>
                  </div>

                  <Price amount={item.lineTotal} currency={order.currency} size="sm" />
                </li>
              ))}
            </ul>

            <Divider />

            <Stack gap={2}>
              <Inline gap={4} className="items-baseline justify-between">
                <Text variant="body-sm" tone="muted">
                  {t.order.subtotal}
                </Text>
                <Price amount={order.subtotal} currency={order.currency} size="sm" />
              </Inline>

              {order.discountTotal > 0 && (
                <Inline gap={4} className="items-baseline justify-between">
                  <Text variant="body-sm" tone="muted">
                    {t.order.discount}
                  </Text>
                  <Text variant="body-sm" as="span">
                    −{' '}
                    <Price
                      amount={order.discountTotal}
                      currency={order.currency}
                      size="sm"
                    />
                  </Text>
                </Inline>
              )}

              <Inline gap={4} className="items-baseline justify-between">
                <Text variant="body-sm" tone="muted">
                  {order.shippingRateLabel ?? t.order.delivery}
                </Text>
                {order.shippingTotal === 0 ? (
                  <Text variant="body-sm" as="span">
                    {t.order.free}
                  </Text>
                ) : (
                  <Price
                    amount={order.shippingTotal}
                    currency={order.currency}
                    size="sm"
                  />
                )}
              </Inline>

              <Divider />

              <Inline gap={4} className="items-baseline justify-between">
                <Text variant="heading-sm" as="span">
                  {t.order.total}
                </Text>
                <Price amount={order.grandTotal} currency={order.currency} />
              </Inline>
            </Stack>
          </Stack>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t.order.payment} />
        <CardBody>
          <Stack gap={2}>
            <Inline gap={4} className="items-baseline justify-between">
              <Text variant="body-sm" tone="muted">
                {t.order.paymentMethod}
              </Text>
              <Text variant="body-sm" as="span">
                {t.labels.paymentMethod[order.paymentMethod as PaymentMethod] ??
                  order.paymentMethod}
              </Text>
            </Inline>

            <Inline gap={4} className="items-baseline justify-between">
              <Text variant="body-sm" tone="muted">
                {t.order.paymentState}
              </Text>
              <Text variant="body-sm" as="span">
                {t.labels.paymentStatus[
                  order.paymentStatus as keyof typeof t.labels.paymentStatus
                ] ?? order.paymentStatus}
              </Text>
            </Inline>

            {order.depositRequired > 0 && (
              <Inline gap={4} className="items-baseline justify-between">
                <Text variant="body-sm" tone="muted">
                  {t.order.depositRequired}
                </Text>
                <Price
                  amount={order.depositRequired}
                  currency={order.currency}
                  size="sm"
                />
              </Inline>
            )}

            {order.amountPaid > 0 && (
              <Inline gap={4} className="items-baseline justify-between">
                <Text variant="body-sm" tone="muted">
                  {t.order.alreadyPaid}
                </Text>
                <Price amount={order.amountPaid} currency={order.currency} size="sm" />
              </Inline>
            )}

            {balance > 0 && (
              <Inline gap={4} className="items-baseline justify-between">
                <Text variant="body-sm" tone="muted">
                  {t.order.balance}
                </Text>
                <Price amount={balance} currency={order.currency} size="sm" />
              </Inline>
            )}
          </Stack>
        </CardBody>
      </Card>

      {order.address && (
        <Card>
          <CardHeader title={t.order.delivery} />
          <CardBody>
            <Stack gap={3}>
              <Overline as="p">{t.order.address}</Overline>
              <Text variant="body">{order.address.fullName}</Text>
              <Text variant="body-sm" tone="muted">
                {order.address.addressLine}
                <br />
                {order.address.communeName}, {order.address.wilayaNameSnapshot}
                <br />
                {order.address.phone}
              </Text>

              {order.trackingNumber && (
                <Text variant="body-sm">
                  {t.order.tracking}&nbsp;:{' '}
                  {order.carrierName ? `${order.carrierName} · ` : ''}
                  {order.trackingUrl ? (
                    <Link href={order.trackingUrl} external>
                      {order.trackingNumber}
                    </Link>
                  ) : (
                    order.trackingNumber
                  )}
                </Text>
              )}

              {order.hasProductionLine && (
                <Text variant="body-sm" tone="muted">
                  {t.order.mixedShipment}
                </Text>
              )}
            </Stack>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title={t.order.timeline} />
        <CardBody>
          {order.timeline.length === 0 ? (
            <Text variant="body-sm" tone="muted">
              {t.order.placedAt(formatDateTime(order.placedAt, locale))}
            </Text>
          ) : (
            <Stack gap={4} as="ol">
              {order.timeline.map((entry, index) => (
                <li key={`${entry.toStatus}-${index}`}>
                  <Stack gap={1}>
                    <Text variant="caption" tone="subtle" as="span">
                      {formatDateTime(entry.createdAt, locale)}
                    </Text>
                    <Text variant="body-sm" as="span">
                      {t.labels.orderStatus[entry.toStatus]}
                    </Text>
                    {entry.note && (
                      <Text variant="caption" tone="muted" as="span">
                        {entry.note}
                      </Text>
                    )}
                  </Stack>
                </li>
              ))}
            </Stack>
          )}
        </CardBody>
      </Card>
    </Stack>
  );
}
