import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { Heading, Text } from '@/components/ui/typography';
import { Container, Section, Stack } from '@/components/layout/layout';
import { availablePaymentMethods } from '@/domain/order/payment-method';
import { getCartView } from '@/server/services/cart-service';
import { listServedWilayas } from '@/server/repositories/shipping-repository';
import { readCartOwner } from '@/server/cart/owner';
import { dictionaryFor } from '@/i18n';

import { CheckoutForm } from './checkout-form';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { t } = dictionaryFor((await params).locale);

  return {
    title: t.checkout.title,
    description: t.checkout.metaDescription,
    robots: { index: false, follow: false },
  };
}

/**
 * Checkout.
 *
 * `UX.md` section 7: **guest by default** — an account is offered after the
 * purchase, never before it. Nothing on this page asks the customer to sign in,
 * and the order carries a contact email so it can be claimed later.
 *
 * The cart is re-validated on entry (section 7, last bullet): an unpurchasable
 * cart sends the customer back to the cart page where the problem is
 * explained, rather than letting them fill in an address and be refused at the
 * end.
 */
export const dynamic = 'force-dynamic';

export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { t } = dictionaryFor((await params).locale);
  const owner = await readCartOwner();
  const cart = owner ? await getCartView(owner) : null;

  if (!cart || cart.lines.length === 0 || !cart.isPurchasable) redirect('/cart');

  const wilayas = await listServedWilayas();
  const paymentMethods = availablePaymentMethods({ hasCustomLine: cart.hasCustomLine });

  return (
    <Section as="section" spacing="compact" className="pb-20">
      <Container>
        <Stack gap={8}>
          <Stack gap={2} className="max-w-prose">
            <Heading level={1} variant="display-md">
              {t.checkout.pageTitle}
            </Heading>
            <Text variant="body" tone="muted">
              {t.checkout.guestNote}
            </Text>
          </Stack>

          <CheckoutForm
            wilayas={wilayas}
            paymentMethods={paymentMethods.filter(
              (method): method is 'COD' | 'BANK_TRANSFER' | 'CCP' => method !== 'ONLINE',
            )}
            currency={cart.currency}
            subtotal={cart.totals.subtotal}
            discountTotal={cart.totals.discountTotal}
            discountBasisPoints={cart.discountBasisPoints}
            preDeliveryTotal={cart.totals.grandTotal}
            totalCustomUnits={cart.totalCustomUnits}
            hasCustomLine={cart.hasCustomLine}
            hasProductionLine={cart.hasProductionLine}
            hasStockLine={cart.lines.some((line) => line.kind === 'STOCK')}
          />
        </Stack>
      </Container>
    </Section>
  );
}
