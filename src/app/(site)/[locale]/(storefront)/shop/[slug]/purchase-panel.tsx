'use client';

import { useMemo, useState, useTransition } from 'react';

import { Alert } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { Link } from '@/components/ui/link';
import { Overline, Text } from '@/components/ui/typography';
import { Inline, Stack } from '@/components/layout/layout';
import { Price } from '@/components/commerce/price';
import { QuantitySelector } from '@/components/commerce/quantity-selector';

import { addToCartAction } from '../../cart/actions';
import { useDictionary } from '@/i18n/client';

/**
 * The buying controls: options, quantity, price, and the primary action.
 *
 * The one client component on the product page. It receives **DTOs, never
 * Prisma models** — plain serialisable objects the server already resolved.
 *
 * It performs no business calculation. The price shown for a selection is the
 * `price` the server put on that variant, resolved by `domain/pricing`
 * (`BUSINESS-RULES.md` section 16 requires unit-price resolution to exist
 * exactly once). Matching a set of chosen option values to a variant is a
 * lookup over data it was handed, not a rule it decides.
 *
 * Adding to the cart sends a **slug, an SKU and a quantity** — never a price.
 * The server re-reads the product, re-checks that it is published and the
 * variant active, and caps the quantity at what is actually available. Nothing
 * this component believes about availability is trusted at the boundary; it is
 * shown so the customer is not surprised.
 */

export type PanelOptionValue = { value: string; hexColor: string | null };
export type PanelOption = { name: string; values: readonly PanelOptionValue[] };
export type PanelVariant = {
  sku: string;
  options: Readonly<Record<string, string>>;
  price: number;
  compareAtPrice: number | null;
  available: boolean;
};

export function PurchasePanel({
  productSlug,
  options,
  variants,
  fallbackPrice,
  fallbackCompareAtPrice,
  currency,
  customisable,
}: {
  productSlug: string;
  options: readonly PanelOption[];
  variants: readonly PanelVariant[];
  /** Used when a product has no variants at all. */
  fallbackPrice: number;
  fallbackCompareAtPrice: number | null;
  currency: string;
  customisable: boolean;
}) {
  const { t } = useDictionary();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [selection, setSelection] = useState<Record<string, string>>(() =>
    initialSelection(options, variants),
  );
  const [quantity, setQuantity] = useState(1);

  const selectedVariant = useMemo(
    () => findVariant(variants, selection),
    [variants, selection],
  );

  /**
   * Which values are stocked at all.
   *
   * `UX.md` journey 1 asks for unavailable combinations to be marked at
   * selection rather than discovered at add-to-cart. This marks a value when
   * **no** available variant carries it anywhere in the matrix — a size that is
   * simply sold out.
   *
   * It deliberately does not narrow as the user chooses. Filtering each axis by
   * the others reads as clever and traps people: with "S / Noir" selected, an
   * available "M / Écru" piece would show Écru as disabled, and there is no
   * click that escapes. Marking only globally-unavailable values keeps every
   * product reachable, and a combination that happens not to exist is reported
   * by the action below, which is where the user is about to act on it.
   */
  const stocked = useMemo(() => stockedValues(options, variants), [options, variants]);

  const price = selectedVariant?.price ?? fallbackPrice;
  const compareAtPrice = selectedVariant
    ? selectedVariant.compareAtPrice
    : fallbackCompareAtPrice;
  const available = selectedVariant ? selectedVariant.available : variants.length === 0;

  return (
    <Stack gap={6}>
      <div className="flex flex-wrap items-center gap-3">
        <Price
          amount={price}
          currency={currency}
          size="lg"
          {...(compareAtPrice !== null ? { compareAt: compareAtPrice } : {})}
        />
        {selectedVariant && (
          <Text variant="mono-sm" tone="subtle">
            {selectedVariant.sku}
          </Text>
        )}
      </div>

      {options.map((option) => (
        <Stack key={option.name} gap={3}>
          <Inline gap={2} justify="between">
            <Overline as="p">{option.name}</Overline>
            <Text variant="body-sm" tone="muted">
              {selection[option.name]}
            </Text>
          </Inline>

          {/* A radiogroup: one value can be chosen, and arrow keys move
           * between them (DESIGN-SYSTEM.md section 8). */}
          <div
            role="radiogroup"
            aria-label={option.name}
            className="flex flex-wrap gap-2"
          >
            {option.values.map((optionValue) => {
              const selected = selection[option.name] === optionValue.value;
              const enabled = stocked.get(option.name)?.has(optionValue.value) ?? false;

              return (
                <button
                  key={optionValue.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  // Not `disabled`: an unavailable choice must stay reachable
                  // by keyboard so a screen-reader user can discover that it
                  // exists and is out of stock, rather than finding a gap.
                  aria-disabled={!enabled || undefined}
                  onClick={() => {
                    if (!enabled) return;
                    setSelection((current) => ({
                      ...current,
                      [option.name]: optionValue.value,
                    }));
                  }}
                  className={[
                    'min-h-11 min-w-11 rounded-full border px-5',
                    'text-body-sm transition-colors duration-fast ease-out',
                    'focus-visible:shadow-focus focus-visible:outline-none',
                    'motion-reduce:transition-none',
                    selected
                      ? 'border-fg bg-fg text-fg-inverted'
                      : 'border-border-strong text-fg hover:bg-hover',
                    !enabled && 'cursor-not-allowed line-through opacity-40',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {optionValue.hexColor && (
                    <span
                      aria-hidden="true"
                      className="border-border mr-2 inline-block size-3 rounded-full border align-middle"
                      style={{ backgroundColor: optionValue.hexColor }}
                    />
                  )}
                  {optionValue.value}
                </button>
              );
            })}
          </div>
        </Stack>
      ))}

      <Stack gap={3}>
        <Overline as="p">{t.product.quantity}</Overline>
        <QuantitySelector
          value={quantity}
          onChange={setQuantity}
          max={99}
          disabled={!available}
        />
      </Stack>

      <Stack gap={3}>
        <Button
          size="xl"
          shape="pill"
          fullWidth
          loading={pending}
          disabled={!available || !selectedVariant}
          onClick={() => {
            if (!selectedVariant) return;
            setFeedback(null);

            startTransition(async () => {
              const result = await addToCartAction({
                productSlug,
                variantSku: selectedVariant.sku,
                quantity,
              });

              // Nothing on this page renders cart state, so there is nothing
              // to refresh — the confirmation and the link to the cart are the
              // whole feedback.
              setFeedback(
                result.ok
                  ? { ok: true, message: t.product.addedToCart }
                  : { ok: false, message: result.message },
              );
            });
          }}
        >
          {available ? t.product.addToCart : t.product.unavailable}
        </Button>

        {/* The result is announced rather than only shown: a customer using a
         * screen reader gets the same confirmation as one watching the page. */}
        <div role="status" aria-live="polite">
          {feedback && (
            <Text variant="body-sm" tone={feedback.ok ? 'muted' : 'danger'}>
              {feedback.message}{' '}
              {feedback.ok && <Link href="/cart">{t.product.seeCart}</Link>}
            </Text>
          )}
        </div>

        {!available && (
          <Text variant="body-sm" tone="subtle">
            {t.product.combinationUnavailable}
          </Text>
        )}
      </Stack>

      {customisable && (
        <Alert tone="neutral" title={t.product.ownEmbroideryTitle}>
          {t.product.ownEmbroideryBody}{' '}
          <Link href="/custom">{t.product.ownEmbroideryLink}</Link>
        </Alert>
      )}
    </Stack>
  );
}

/* ---------------------------------------------------------------------------
 * Selection helpers. Lookups over supplied data, not business rules.
 * ------------------------------------------------------------------------ */

/** Start on the first available variant, so the page does not open sold out. */
function initialSelection(
  options: readonly PanelOption[],
  variants: readonly PanelVariant[],
): Record<string, string> {
  const preferred = variants.find((variant) => variant.available) ?? variants[0];
  if (preferred) return { ...preferred.options };

  return Object.fromEntries(
    options.flatMap((option) =>
      option.values[0] ? [[option.name, option.values[0].value]] : [],
    ),
  );
}

function findVariant(
  variants: readonly PanelVariant[],
  selection: Record<string, string>,
): PanelVariant | undefined {
  return variants.find((variant) =>
    Object.entries(selection).every(([name, value]) => variant.options[name] === value),
  );
}

function stockedValues(
  options: readonly PanelOption[],
  variants: readonly PanelVariant[],
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();

  for (const option of options) {
    const values = new Set<string>();

    for (const variant of variants) {
      if (!variant.available) continue;

      const candidate = variant.options[option.name];
      if (candidate !== undefined) values.add(candidate);
    }

    // A product with no variants at all has nothing to mark: every declared
    // value stays selectable rather than every one appearing sold out.
    if (variants.length === 0) {
      for (const value of option.values) values.add(value.value);
    }

    result.set(option.name, values);
  }

  return result;
}
