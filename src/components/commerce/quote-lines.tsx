'use client';

import { Divider } from '@/components/ui/feedback';
import { useDictionary } from '@/i18n/client';
import { Inline, Stack } from '@/components/layout/layout';
import { Text } from '@/components/ui/typography';
import { formatMoney } from '@/components/commerce/price';

/**
 * An itemised quote, as the customer and the admin preview both render it.
 *
 * Presentational and total: it receives numbers and prints them. `UX.md`
 * section 6 asks for every line to be shown — "an itemised quote is what
 * business customers need in order to approve a purchase internally, and it
 * makes the price feel derived rather than invented" — so nothing is collapsed
 * or hidden here.
 *
 * **No arithmetic happens in this file.** The totals are props, computed once
 * by `domain/quote/pricing` (section 16). A component that added a subtotal up
 * would be a second pricing implementation that agrees until it does not.
 */

export type QuoteLineView = {
  id: string;
  kindLabel: string;
  label: string;
  description: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type QuoteTotalsView = {
  subtotal: number;
  discountTotal: number;
  shippingTotal: number;
  grandTotal: number;
  depositRequired: number;
};

function Row({
  label,
  amount,
  currency,
  strong = false,
}: {
  label: string;
  amount: string | number;
  currency: string;
  strong?: boolean;
}) {
  return (
    <Inline gap={4} className="items-baseline justify-between">
      <Text
        variant={strong ? 'heading-sm' : 'body-sm'}
        tone={strong ? 'default' : 'muted'}
      >
        {label}
      </Text>
      <Text
        variant={strong ? 'heading-sm' : 'body-sm'}
        className="tabular-nums"
        as="span"
      >
        {typeof amount === 'number' ? formatMoney(amount, { currency }) : amount}
      </Text>
    </Inline>
  );
}

export function QuoteLines({
  lines,
  totals,
  currency = 'DZD',
}: {
  lines: readonly QuoteLineView[];
  totals: QuoteTotalsView;
  currency?: string;
}) {
  const { t } = useDictionary();

  return (
    <Stack gap={5}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] border-collapse text-left">
          <caption className="sr-only">{t.quote.linesCaption}</caption>
          <thead>
            <tr className="border-border border-b">
              <th scope="col" className="py-2 pr-4">
                <Text variant="caption" tone="subtle" as="span">
                  {t.quote.columnLine}
                </Text>
              </th>
              <th scope="col" className="py-2 pr-4 text-right">
                <Text variant="caption" tone="subtle" as="span">
                  {t.quote.columnQuantity}
                </Text>
              </th>
              <th scope="col" className="py-2 pr-4 text-right">
                <Text variant="caption" tone="subtle" as="span">
                  {t.quote.columnUnitPrice}
                </Text>
              </th>
              <th scope="col" className="py-2 text-right">
                <Text variant="caption" tone="subtle" as="span">
                  {t.quote.columnAmount}
                </Text>
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id} className="border-border/60 border-b align-top">
                <td className="py-3 pr-4">
                  <Stack gap={1}>
                    <Text variant="body-sm" as="span">
                      {line.label}
                    </Text>
                    <Text variant="caption" tone="subtle" as="span">
                      {line.kindLabel}
                    </Text>
                    {line.description && (
                      <Text variant="caption" tone="muted" as="span">
                        {line.description}
                      </Text>
                    )}
                  </Stack>
                </td>
                <td className="py-3 pr-4 text-right tabular-nums">
                  <Text variant="body-sm" as="span">
                    {line.quantity}
                  </Text>
                </td>
                <td className="py-3 pr-4 text-right tabular-nums">
                  <Text variant="body-sm" as="span">
                    {formatMoney(line.unitPrice, { currency })}
                  </Text>
                </td>
                <td className="py-3 text-right tabular-nums">
                  <Text variant="body-sm" as="span">
                    {formatMoney(line.lineTotal, { currency })}
                  </Text>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Stack gap={2}>
        <Row label={t.order.subtotal} amount={totals.subtotal} currency={currency} />
        {totals.discountTotal > 0 && (
          <Row
            label={t.order.discount}
            amount={`− ${formatMoney(totals.discountTotal, { currency })}`}
            currency={currency}
          />
        )}
        <Row label={t.order.delivery} amount={totals.shippingTotal} currency={currency} />
        <Divider />
        <Row
          label={t.order.total}
          amount={totals.grandTotal}
          currency={currency}
          strong
        />
        {totals.depositRequired > 0 && (
          <Row
            label={t.quote.depositDue}
            amount={totals.depositRequired}
            currency={currency}
          />
        )}
      </Stack>
    </Stack>
  );
}
