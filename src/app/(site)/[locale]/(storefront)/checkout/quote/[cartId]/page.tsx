import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { Alert } from '@/components/ui/feedback';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Container, Section, Stack } from '@/components/layout/layout';
import { Heading, Text } from '@/components/ui/typography';
import { Link } from '@/components/ui/link';
import { QuoteLines } from '@/components/commerce/quote-lines';
import { availablePaymentMethods } from '@/domain/order/payment-method';
import { dictionaryFor } from '@/i18n';
import { formatDate } from '@/i18n/format';
import { requireCustomer } from '@/server/auth/guards';
import { getQuoteCheckoutView } from '@/server/services/checkout-service';
import { listServedWilayas } from '@/server/repositories/shipping-repository';
import { readCartOwner } from '@/server/cart/owner';

import { QuoteCheckoutForm } from './quote-checkout-form';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { t } = dictionaryFor((await params).locale);
  return { title: t.checkout.quoteTitle, robots: { index: false, follow: false } };
}

export const dynamic = 'force-dynamic';

/**
 * The accepted quote's own checkout (5A, `UX.md` section 7).
 *
 * It reads as a confirmation of an agreed price rather than as a cart. The
 * lines are the quote's, in the order the admin wrote them; delivery is the
 * quoted amount and no rate lookup happens; the total is the accepted total to
 * the centime, and placement fails outright rather than charging anything else
 * (5A.6).
 *
 * A quote-bound cart is always a signed-in customer's — `carts_quote_bound_check`
 * requires `user_id` — so this page requires a session, unlike the guest-first
 * standard checkout.
 */
export default async function QuoteCheckoutPage({
  params,
}: {
  params: Promise<{ locale: string; cartId: string }>;
}) {
  const { locale: localeParam, cartId } = await params;
  const { locale, t } = dictionaryFor(localeParam);
  const authorisation = await requireCustomer();

  if (!authorisation.ok) {
    redirect(
      authorisation.reason === 'UNAUTHENTICATED'
        ? `/login?next=${encodeURIComponent(`/checkout/quote/${cartId}`)}`
        : '/',
    );
  }

  const owner = await readCartOwner();
  if (!owner) notFound();

  const view = await getQuoteCheckoutView(owner, cartId);

  if (!view.ok) {
    // The acceptance window is the one failure worth a page of its own: the
    // customer did everything right and time ran out (7.10.3).
    if (view.error === 'QUOTE_ACCEPTANCE_LAPSED') {
      return (
        <Section spacing="compact" className="pb-20">
          <Container width="narrow">
            <Stack gap={6}>
              <Heading level={1} variant="display-md">
                {t.checkout.quoteLapsedTitle}
              </Heading>
              <Alert tone="warning" title={t.checkout.quoteLapsedAlert}>
                {t.checkout.quoteLapsedBody}
              </Alert>
              <Text variant="body-sm" tone="muted">
                <Link href="/account/quotes">{t.checkout.backToQuotes}</Link>
              </Text>
            </Stack>
          </Container>
        </Section>
      );
    }

    notFound();
  }

  const {
    quoteNumber,
    priced,
    subtotal,
    discountTotal,
    shippingTotal,
    grandTotal,
    depositRequired,
  } = view.value;
  const wilayas = await listServedWilayas();

  const paymentMethods = availablePaymentMethods({
    hasCustomLine: priced.hasCustomLine,
  }).filter((method): method is 'COD' | 'BANK_TRANSFER' | 'CCP' => method !== 'ONLINE');

  return (
    <Section spacing="compact" className="pb-20">
      <Container>
        <Stack gap={8}>
          <Stack gap={2} className="max-w-prose">
            <Heading level={1} variant="display-md">
              {t.checkout.quoteHeading(quoteNumber)}
            </Heading>
            <Text variant="body" tone="muted">
              {t.checkout.quoteLead(quoteNumber)}
            </Text>
          </Stack>

          {view.value.acceptanceValidUntil && (
            <Alert tone="info" title={t.checkout.quoteAcceptedTitle}>
              {t.checkout.quoteFinaliseBefore(
                formatDate(view.value.acceptanceValidUntil, locale),
              )}
            </Alert>
          )}

          <Card>
            <CardHeader title={t.checkout.quoteAccepted} />
            <CardBody>
              <QuoteLines
                currency={priced.currency}
                lines={priced.lines.map((line) => ({
                  id: line.id,
                  kindLabel:
                    line.kind === 'FEE' ? t.checkout.lineFee : t.checkout.lineItem,
                  label: line.name,
                  description: null,
                  quantity: line.quantity,
                  unitPrice: line.unitPrice,
                  lineTotal: line.lineTotal,
                }))}
                totals={{
                  subtotal,
                  discountTotal,
                  shippingTotal,
                  grandTotal,
                  depositRequired,
                }}
              />
            </CardBody>
          </Card>

          <QuoteCheckoutForm
            cartId={cartId}
            wilayas={wilayas}
            paymentMethods={paymentMethods}
            defaultName=""
            defaultEmail=""
          />
        </Stack>
      </Container>
    </Section>
  );
}
