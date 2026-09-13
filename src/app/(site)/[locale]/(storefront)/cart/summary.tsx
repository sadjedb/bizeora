'use client';

import { Divider } from '@/components/ui/feedback';
import { useDictionary } from '@/i18n/client';
import { Text } from '@/components/ui/typography';
import { Stack } from '@/components/layout/layout';
import { Price } from '@/components/commerce/price';

/**
 * The money summary, shared by the cart and the checkout.
 *
 * Presentation only. Every number arrives already computed by
 * `server/services/cart-pricing`; this component adds nothing up. That is what
 * makes "the cart and the checkout agree" structural rather than a coincidence
 * — there is one summary and one source for its numbers.
 *
 * `BUSINESS-RULES.md` 2.5 requires the quantity discount to be shown as an
 * explicit line rather than folded into a unit price, and 5.5 requires the
 * deposit to be stated as "due now" against a balance.
 */

export type SummaryProps = {
  currency: string;
  subtotal: number;
  discountTotal: number;
  discountBasisPoints: number;
  totalCustomUnits: number;
  /** Null before a wilaya is chosen — the cart cannot know it yet. */
  shippingTotal: number | null;
  grandTotal: number;
  depositRequired?: number;
};

function Row({
  label,
  children,
  emphasis = false,
}: {
  label: string;
  children: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <Text variant={emphasis ? 'body' : 'body-sm'} tone={emphasis ? 'default' : 'muted'}>
        {label}
      </Text>
      {children}
    </div>
  );
}

export function OrderSummary({
  currency,
  subtotal,
  discountTotal,
  discountBasisPoints,
  totalCustomUnits,
  shippingTotal,
  grandTotal,
  depositRequired = 0,
}: SummaryProps) {
  const { t } = useDictionary();
  const balance = Math.max(0, grandTotal - depositRequired);

  return (
    <Stack gap={3}>
      <Row label={t.cart.subtotal}>
        <Price amount={subtotal} currency={currency} size="sm" />
      </Row>

      {discountTotal > 0 && (
        <Row label={t.cart.quantityDiscount(totalCustomUnits, discountBasisPoints / 100)}>
          <Text variant="body-sm" numeric>
            −<Price amount={discountTotal} currency={currency} size="sm" />
          </Text>
        </Row>
      )}

      <Row label={t.cart.delivery}>
        {shippingTotal === null ? (
          <Text variant="body-sm" tone="muted">
            {t.cart.deliveryNextStep}
          </Text>
        ) : shippingTotal === 0 ? (
          <Text variant="body-sm">{t.cart.freeDelivery}</Text>
        ) : (
          <Price amount={shippingTotal} currency={currency} size="sm" />
        )}
      </Row>

      <Divider />

      <Row label={t.cart.total} emphasis>
        <Price amount={grandTotal} currency={currency} />
      </Row>

      {depositRequired > 0 && (
        <>
          <Divider />
          <Row label={t.cart.dueNow} emphasis>
            <Price amount={depositRequired} currency={currency} />
          </Row>
          <Row label={t.cart.dueOnDelivery}>
            <Price amount={balance} currency={currency} size="sm" />
          </Row>
        </>
      )}
    </Stack>
  );
}
