'use client';

import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Alert } from '@/components/ui/feedback';
import { useDictionary } from '@/i18n/client';
import { Button } from '@/components/ui/button';
import { Link } from '@/components/ui/link';
import { Text } from '@/components/ui/typography';
import { Inline, Stack } from '@/components/layout/layout';
import { Price } from '@/components/commerce/price';
import { ProductImage } from '@/components/media/product-image';
import { QuantitySelector } from '@/components/commerce/quantity-selector';

import { removeCartLineAction, updateCartLineAction } from './actions';

/**
 * The editable cart lines.
 *
 * A client component because quantities change without leaving the page. It
 * receives **already-priced lines** and renders them; it never multiplies a
 * price by a quantity itself. When a quantity changes it calls a server action
 * and re-renders from what the server sends back, so the number on screen is
 * always one the server computed (`BUSINESS-RULES.md` 5.2).
 */

export type CartLineView = {
  id: string;
  kind: 'STOCK' | 'CUSTOM' | 'FEE';
  name: string;
  variantLabel: string | null;
  productSlug: string | null;
  image: { src: string | null; alt: string } | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  maxQuantity: number | null;
  editable: boolean;
  issue: string | null;
};

export function CartLines({
  lines,
  currency,
}: {
  lines: readonly CartLineView[];
  currency: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busyLineId, setBusyLineId] = useState<string | null>(null);

  const { t } = useDictionary();

  function run(lineId: string, action: () => Promise<{ ok: boolean; message?: string }>) {
    setBusyLineId(lineId);
    startTransition(async () => {
      const result = await action();
      setBusyLineId(null);
      setError(result.ok ? null : (result.message ?? t.cart.genericError));
      if (result.ok) router.refresh();
    });
  }

  return (
    <Stack gap={4}>
      {error && (
        <Alert tone="danger" title={t.cart.updateFailedTitle}>
          {error}
        </Alert>
      )}

      <ul className="flex list-none flex-col gap-4 p-0">
        {lines.map((line) => (
          <li key={line.id} className="border-border border-b pb-4 last:border-b-0">
            <div className="flex gap-4">
              <div className="w-20 shrink-0 sm:w-24">
                <ProductImage
                  src={line.image?.src ?? null}
                  alt={line.image?.alt ?? line.name}
                  ratio="square"
                />
              </div>

              <Stack gap={2} className="min-w-0 flex-1">
                <Stack gap={1}>
                  {line.productSlug ? (
                    <Link href={`/shop/${line.productSlug}`} variant="subtle">
                      {line.name}
                    </Link>
                  ) : (
                    <Text variant="body">{line.name}</Text>
                  )}

                  {line.variantLabel && (
                    <Text variant="body-sm" tone="muted">
                      {line.variantLabel}
                    </Text>
                  )}

                  {line.kind === 'CUSTOM' && (
                    <Text variant="body-sm" tone="muted">
                      {t.cart.customEmbroidery}
                    </Text>
                  )}
                </Stack>

                {line.issue && (
                  <Text variant="body-sm" tone="danger">
                    {line.issue}
                  </Text>
                )}

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  {line.editable ? (
                    <Inline gap={3} align="center">
                      <QuantitySelector
                        value={line.quantity}
                        min={1}
                        max={line.maxQuantity ?? 999}
                        disabled={pending && busyLineId === line.id}
                        onChange={(quantity) =>
                          run(line.id, () =>
                            updateCartLineAction({ lineId: line.id, quantity }),
                          )
                        }
                        label={t.cart.quantityFor(line.name)}
                      />

                      <Button
                        variant="ghost"
                        size="sm"
                        leadingIcon={<Trash2 aria-hidden="true" />}
                        disabled={pending && busyLineId === line.id}
                        onClick={() =>
                          run(line.id, () => removeCartLineAction({ lineId: line.id }))
                        }
                      >
                        {t.cart.remove}
                      </Button>
                    </Inline>
                  ) : (
                    <Text variant="body-sm" tone="muted">
                      {t.cart.quantityLabel(line.quantity)}
                    </Text>
                  )}

                  <div className="text-right">
                    <Price amount={line.lineTotal} currency={currency} />
                    {line.quantity > 1 && (
                      <Text variant="caption" tone="muted">
                        <Price amount={line.unitPrice} currency={currency} size="sm" />
                        {' × '}
                        {line.quantity}
                      </Text>
                    )}
                  </div>
                </div>
              </Stack>
            </div>
          </li>
        ))}
      </ul>
    </Stack>
  );
}
