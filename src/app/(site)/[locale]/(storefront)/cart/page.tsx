import { ShoppingBag } from 'lucide-react';
import type { Metadata } from 'next';

import { Alert, EmptyState } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Heading, Text } from '@/components/ui/typography';
import { Link } from '@/components/ui/link';
import { Container, Section, Stack } from '@/components/layout/layout';
import { getCartView } from '@/server/services/cart-service';
import { readCartOwner } from '@/server/cart/owner';
import { NOINDEX_FOLLOW } from '@/lib/seo';
import { dictionaryFor, type Dictionary } from '@/i18n';
import type { LineIssue } from '@/server/services/cart-pricing';

import { CartLines, type CartLineView } from './cart-lines';
import { OrderSummary } from './summary';

/**
 * Not indexable, and no canonical.
 *
 * A cart is one visitor's session state: there is nothing at `/cart` for a
 * crawler to index, and a canonical would assert that this page is the
 * authoritative address of something. It was the one public route still
 * missing its directive when Phase 14 audited them.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { t } = dictionaryFor((await params).locale);

  return {
    title: t.cart.title,
    description: t.cart.metaDescription,
    robots: NOINDEX_FOLLOW,
  };
}

/**
 * The cart.
 *
 * Dynamic by necessity: it reads the cart cookie, so it can never be
 * prerendered. A server component that prices the cart through the one pricing
 * path and hands the client component numbers it only renders.
 *
 * `UX.md` section 13 requires every screen to have a loading, empty, error and
 * success state. The empty state is a real screen with a route out of it, not
 * a blank page.
 */
export const dynamic = 'force-dynamic';

function issueLabels(t: Dictionary): Record<LineIssue, string> {
  return {
    PRODUCT_UNAVAILABLE: t.cart.issueProductUnavailable,
    VARIANT_INACTIVE: t.cart.issueVariantInactive,
    INSUFFICIENT_STOCK: t.cart.issueInsufficientStock,
    CONFIGURATION_NEEDS_QUOTE: t.cart.issueNeedsQuote,
    PRICE_UNRESOLVABLE: t.cart.issuePriceUnresolvable,
  };
}

export default async function CartPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { t } = dictionaryFor((await params).locale);
  const labels = issueLabels(t);
  const owner = await readCartOwner();
  const cart = owner ? await getCartView(owner) : null;

  if (!cart || cart.lines.length === 0) {
    return (
      <Section as="section" spacing="compact">
        <Container width="narrow">
          <Stack gap={8}>
            <Heading level={1} variant="display-md">
              {t.cart.title}
            </Heading>

            <EmptyState
              icon={<ShoppingBag aria-hidden="true" />}
              title={t.cart.empty}
              description={t.cart.emptyBody}
              action={
                <div className="flex flex-wrap justify-center gap-3">
                  <Button asChild>
                    <Link href="/shop">{t.cart.seeShop}</Link>
                  </Button>
                  <Button variant="secondary" asChild>
                    <Link href="/custom">{t.cart.startCustom}</Link>
                  </Button>
                </div>
              }
            />
          </Stack>
        </Container>
      </Section>
    );
  }

  const lines: CartLineView[] = cart.lines.map((line) => ({
    id: line.id,
    kind: line.kind,
    name: line.name,
    variantLabel: line.variantLabel,
    productSlug: line.productSlug,
    image: line.image,
    unitPrice: line.unitPrice,
    quantity: line.quantity,
    lineTotal: line.lineTotal,
    maxQuantity: line.maxQuantity,
    editable: line.editable,
    issue: line.issue ? labels[line.issue] : null,
  }));

  return (
    <Section as="section" spacing="compact" className="pb-20">
      <Container>
        <Stack gap={8}>
          <Heading level={1} variant="display-md">
            {t.cart.title}
          </Heading>

          {cart.issues.length > 0 && (
            <Alert tone="warning" title={t.cart.needsFixTitle}>
              {t.cart.needsFixBody}
            </Alert>
          )}

          <div className="grid gap-8 lg:grid-cols-[1fr_22rem] lg:items-start">
            <CartLines lines={lines} currency={cart.currency} />

            <Card className="lg:sticky lg:top-24">
              <CardBody>
                <Stack gap={5}>
                  <Heading level={2} variant="heading-sm">
                    {t.checkout.summary}
                  </Heading>

                  <OrderSummary
                    currency={cart.currency}
                    subtotal={cart.totals.subtotal}
                    discountTotal={cart.totals.discountTotal}
                    discountBasisPoints={cart.discountBasisPoints}
                    totalCustomUnits={cart.totalCustomUnits}
                    shippingTotal={null}
                    grandTotal={cart.totals.grandTotal}
                  />

                  {/*
                    A disabled anchor is not a thing: `asChild` renders a link,
                    and a link cannot be disabled. So an unpurchasable cart gets
                    a real disabled button with its reason in text, which is
                    what DESIGN-SYSTEM.md section 8 requires anyway.
                  */}
                  {cart.isPurchasable ? (
                    <Button asChild fullWidth>
                      <Link href="/checkout">{t.cart.checkout}</Link>
                    </Button>
                  ) : (
                    <Stack gap={2}>
                      <Button fullWidth disabled>
                        {t.cart.checkout}
                      </Button>
                      <Text variant="body-sm" tone="muted">
                        {t.cart.fixToContinue}
                      </Text>
                    </Stack>
                  )}

                  {cart.hasCustomLine && (
                    <Text variant="body-sm" tone="muted">
                      {t.cart.depositNotice}
                    </Text>
                  )}
                </Stack>
              </CardBody>
            </Card>
          </div>
        </Stack>
      </Container>
    </Section>
  );
}
