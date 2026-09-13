import { cn } from '@/components/ui/cn';

/**
 * Price.
 *
 * Takes an integer of minor units and renders it. It does **not** calculate:
 * no discounts, no totals, no tax, no shipping. Those are `domain/` and are
 * required to exist exactly once (ADR-012, BUSINESS-RULES.md section 16). A
 * component that did its own arithmetic would be the second implementation.
 *
 * The Algerian dinar has no minor unit in practice — prices are whole dinars —
 * so `fractionDigits` defaults to 0. The parameter exists because the currency
 * is a column, not a constant.
 */

export type PriceProps = {
  /** Integer minor units. Never a float (ADR-012). */
  amount: number;
  currency?: string;
  locale?: string;
  fractionDigits?: number;
  /** The struck-through original. Rendered only when higher than `amount`. */
  compareAt?: number;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
};

const SIZES = {
  sm: 'text-body-sm',
  md: 'text-body',
  lg: 'text-heading-lg',
} as const;

export function formatMoney(
  amount: number,
  {
    currency = 'DZD',
    locale = 'fr-DZ',
    fractionDigits = 0,
  }: Omit<PriceProps, 'amount'> = {},
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(amount);
}

export function Price({
  amount,
  currency = 'DZD',
  locale = 'fr-DZ',
  fractionDigits = 0,
  compareAt,
  size = 'md',
  className,
}: PriceProps) {
  const options = { currency, locale, fractionDigits };
  const formatted = formatMoney(amount, options);
  // A "compare at" below the price is a data error, not a discount. Rendering
  // it would advertise a price rise as a saving.
  const showCompareAt = compareAt !== undefined && compareAt > amount;

  return (
    <span className={cn('inline-flex items-baseline gap-2', SIZES[size], className)}>
      <span className="text-fg font-medium tabular-nums">{formatted}</span>

      {showCompareAt && (
        <span className="text-fg-subtle text-body-sm tabular-nums line-through">
          <span className="sr-only">Ancien prix&nbsp;</span>
          {formatMoney(compareAt, options)}
        </span>
      )}
    </span>
  );
}
