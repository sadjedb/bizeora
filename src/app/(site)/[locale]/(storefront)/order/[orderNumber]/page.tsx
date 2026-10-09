import { CheckCircle2 } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { Alert, Divider } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Heading, Overline, Text } from '@/components/ui/typography';
import { Link } from '@/components/ui/link';
import { Container, Section, Stack } from '@/components/layout/layout';
import { Price } from '@/components/commerce/price';
import { ProductImage } from '@/components/media/product-image';
import { findOrderForViewer } from '@/server/repositories/order-repository';
import { getCurrentActor } from '@/lib/auth';
import { throttle } from '@/server/security/throttle';
import { isActive } from '@/domain/auth/actor';
import { dictionaryFor, type Dictionary } from '@/i18n';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { t } = dictionaryFor((await params).locale);
  return { title: t.order.title, robots: { index: false, follow: false } };
}

/**
 * The order confirmation.
 *
 * `UX.md` section 7: order number, itemised summary, delivery estimate, what
 * happens next — specific to whether the order contains custom lines — and a
 * track-order link.
 *
 * Authorisation is a **single-use-style guest token in the URL**, checked in
 * the repository query, or ownership for a signed-in customer. A guest who
 * loses the link can still find the order through the order-number-plus-phone
 * lookup, which is Phase 8's tracking work and deliberately rate-limited; an
 * order number alone is never enough here.
 *
 * Everything rendered is a **snapshot**: `nameSnapshot`, `variantLabelSnapshot`
 * and the stored totals. Renaming a product tomorrow does not rewrite this page.
 */
export const dynamic = 'force-dynamic';

function statusCopy(t: Dictionary): Record<string, { title: string; body: string }> {
  return {
    AWAITING_PAYMENT: {
      title: t.order.awaitingDepositTitle,
      body: t.order.awaitingDepositBody,
    },
    AWAITING_CONFIRMATION: {
      title: t.order.awaitingConfirmationTitle,
      body: t.order.awaitingConfirmationBody,
    },
  };
}

export default async function OrderConfirmationPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; orderNumber: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { locale: localeParam, orderNumber } = await params;
  const { t } = dictionaryFor(localeParam);
  const { token } = await searchParams;

  const actor = await getCurrentActor();
  const signedIn = isActive(actor);

  /*
   * Rate limited, but only for a guest.
   *
   * `SECURITY.md` section 9 gives this the tightest limit in the application —
   * five an hour per address — and gives the reason: it is the one endpoint
   * that maps an order number to a customer's data, and it is unauthenticated
   * by design. Somebody checking their own delivery looks it up once or twice;
   * anything enumerating order numbers does it thousands of times.
   *
   * A signed-in customer is exempt: they are already limited by owning the
   * order, and counting their visits would throttle somebody refreshing their
   * own account page.
   */
  if (!signedIn) {
    const allowed = await throttle({ action: 'guestOrderLookup' });

    // A 404, not a "slow down". Telling an enumerator that they were rate
    // limited tells them the endpoint is worth attacking; telling them the
    // order does not exist tells them nothing they did not already have.
    if (!allowed.ok) notFound();
  }

  const order = await findOrderForViewer({
    orderNumber,
    guestToken: token ?? null,
    userId: signedIn ? actor.userId : null,
  });

  if (!order) notFound();

  const status = statusCopy(t)[order.status] ?? {
    title: t.order.recordedTitle,
    body: t.order.recordedBody,
  };

  return (
    <Section as="section" spacing="compact" className="pb-20">
      <Container width="narrow">
        <Stack gap={8}>
          <Stack gap={3}>
            <div className="text-status-positive" aria-hidden="true">
              <CheckCircle2 className="size-8" />
            </div>
            <Heading level={1} variant="display-md">
              {t.order.thanksTitle}
            </Heading>
            <Text variant="body-lg" tone="muted">
              {t.order.thanksNumberBefore}
              <strong>{order.orderNumber}</strong>
              {/*
               * Without an address there is no confirmation to promise.
               *
               * Saying "we have sent you an e-mail" to somebody who gave no
               * e-mail is the kind of small lie that has people refreshing an
               * inbox for an hour. The order number on this screen is their
               * receipt, and the copy says so instead.
               */}
              {order.contactEmail
                ? t.order.thanksNumberAfter(order.contactEmail)
                : t.order.thanksNoEmail}
            </Text>
          </Stack>

          <Alert
            tone={order.status === 'AWAITING_PAYMENT' ? 'warning' : 'info'}
            title={status.title}
          >
            {status.body}
          </Alert>

          {order.depositRequired > 0 && (
            <Card>
              <CardBody>
                <Stack gap={4}>
                  <Heading level={2} variant="heading-sm">
                    {t.order.depositTitle}
                  </Heading>

                  <div className="flex items-baseline justify-between gap-4">
                    <Text variant="body">{t.order.payNow}</Text>
                    <Price amount={order.depositRequired} currency={order.currency} />
                  </div>

                  <Text variant="body-sm" tone="muted">
                    {t.order.depositReferenceBefore}
                    <strong>{order.orderNumber}</strong>
                    {t.order.depositReferenceAfter}
                  </Text>
                </Stack>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardBody>
              <Stack gap={5}>
                <Heading level={2} variant="heading-sm">
                  {t.order.yourOrder}
                </Heading>

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
                        <Text variant="body-sm" tone="muted">
                          {t.order.quantityLabel(item.quantity)}
                        </Text>
                      </div>

                      <Price
                        amount={item.lineTotal}
                        currency={order.currency}
                        size="sm"
                      />
                    </li>
                  ))}
                </ul>

                <Divider />

                <Stack gap={2}>
                  <div className="flex items-baseline justify-between gap-4">
                    <Text variant="body-sm" tone="muted">
                      {t.order.subtotal}
                    </Text>
                    <Price amount={order.subtotal} currency={order.currency} size="sm" />
                  </div>

                  {order.discountTotal > 0 && (
                    <div className="flex items-baseline justify-between gap-4">
                      <Text variant="body-sm" tone="muted">
                        {t.order.discount}
                      </Text>
                      <Text variant="body-sm" numeric>
                        −
                        <Price
                          amount={order.discountTotal}
                          currency={order.currency}
                          size="sm"
                        />
                      </Text>
                    </div>
                  )}

                  <div className="flex items-baseline justify-between gap-4">
                    <Text variant="body-sm" tone="muted">
                      {order.shippingRateLabel ?? t.order.delivery}
                    </Text>
                    {order.shippingTotal === 0 ? (
                      <Text variant="body-sm">{t.order.free}</Text>
                    ) : (
                      <Price
                        amount={order.shippingTotal}
                        currency={order.currency}
                        size="sm"
                      />
                    )}
                  </div>

                  <Divider />

                  <div className="flex items-baseline justify-between gap-4">
                    <Text variant="body">{t.order.total}</Text>
                    <Price amount={order.grandTotal} currency={order.currency} />
                  </div>
                </Stack>
              </Stack>
            </CardBody>
          </Card>

          {order.address && (
            <Card>
              <CardBody>
                <Stack gap={3}>
                  <Overline as="p">{t.order.delivery}</Overline>
                  <Text variant="body">{order.address.fullName}</Text>
                  <Text variant="body-sm" tone="muted">
                    {order.address.addressLine}
                    <br />
                    {order.address.communeName}, {order.address.wilayaNameSnapshot}
                    <br />
                    {order.address.phone}
                  </Text>

                  {order.hasProductionLine && (
                    <Text variant="body-sm" tone="muted">
                      {t.order.mixedShipment}
                    </Text>
                  )}
                </Stack>
              </CardBody>
            </Card>
          )}

          <div className="flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/shop">{t.order.continueShopping}</Link>
            </Button>
          </div>
        </Stack>
      </Container>
    </Section>
  );
}
