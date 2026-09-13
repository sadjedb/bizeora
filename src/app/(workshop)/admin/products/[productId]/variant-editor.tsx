'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { Plus } from 'lucide-react';

import { Alert } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { CheckboxField, Input, NativeSelect } from '@/components/ui/input';
import { FormField } from '@/components/ui/field';
import { Modal } from '@/components/ui/overlay';
import { Stack } from '@/components/layout/layout';
import { Text } from '@/components/ui/typography';
import { useDictionary } from '@/i18n/client';

import { addOptionAction, saveVariantAction } from '../actions';
import {
  EMPTY_OPTION_FORM_STATE,
  EMPTY_VARIANT_FORM_STATE,
  type OptionFormState,
  type VariantFormState,
} from '../form-state';

/**
 * Options and variants, edited in place.
 *
 * The two forms are modals rather than pages of their own because the thing
 * being edited is one row of a table the operator is already looking at, and
 * because the schema makes them cheap: a variant is a SKU, an optional price
 * override, a threshold, an active flag and a set of option values.
 *
 * **Stock is not on either form.** A variant is created at zero and stocked
 * through an adjustment, so every unit that has ever been on the shelf has a
 * ledger row saying who put it there (ADR-029). A quantity field here would be
 * the one stock change in the system with no record behind it.
 *
 * Both submit through `useTransition` and a direct call rather than
 * `useActionState`, which is the idiom the rest of the admin already uses
 * (`reviews/moderation-controls.tsx`). The reason is the dialog: a modal has to
 * close itself on success and stay open on refusal, and `useActionState` gives
 * no place to decide that other than an effect writing state during render.
 */

export type OptionView = {
  id: string;
  name: string;
  values: readonly { id: string; value: string }[];
};

export type VariantView = {
  id: string;
  sku: string;
  priceOverride: number | null;
  lowStockThreshold: number | null;
  isActive: boolean;
};

function hasAnyError(errors: Record<string, string | undefined>): boolean {
  return Object.values(errors).some((message) => message !== undefined);
}

/* ------------------------------------------------------------------ option */

export function AddOptionButton({ productId }: { productId: string }) {
  const { t } = useDictionary();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<OptionFormState>(EMPTY_OPTION_FORM_STATE);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await addOptionAction(EMPTY_OPTION_FORM_STATE, form);
      setState(result);

      if (hasAnyError(result.errors)) return;

      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Modal
      open={open}
      onOpenChange={setOpen}
      title={t.admin.addOption}
      description={t.admin.optionHint}
      trigger={
        <Button variant="secondary" size="sm" leadingIcon={<Plus className="size-4" />}>
          {t.admin.addOption}
        </Button>
      }
    >
      <form onSubmit={submit}>
        <Stack gap={4}>
          <input type="hidden" name="productId" value={productId} />

          <FormField label={t.admin.fieldOptionName} error={state.errors.name} required>
            {(field) => (
              <Input
                {...field}
                name="optionName"
                placeholder="Taille"
                autoComplete="off"
              />
            )}
          </FormField>

          <FormField
            label="Valeurs"
            error={state.errors.values}
            required
            description={t.admin.optionValuesHint}
          >
            {(field) => (
              <Input
                {...field}
                name="optionValues"
                placeholder="S, M, L, XL"
                autoComplete="off"
              />
            )}
          </FormField>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
            >
              {t.admin.cancel}
            </Button>
            <Button type="submit" size="sm" loading={pending}>
              {t.admin.add}
            </Button>
          </div>
        </Stack>
      </form>
    </Modal>
  );
}

/* ----------------------------------------------------------------- variant */

export function VariantDialog({
  productId,
  variant,
  options,
  currency,
  trigger,
}: {
  productId: string;
  /** `null` creates. An existing variant edits — its options are then fixed. */
  variant: VariantView | null;
  options: readonly OptionView[];
  currency: string;
  trigger: ReactNode;
}) {
  const { t } = useDictionary();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<VariantFormState>(EMPTY_VARIANT_FORM_STATE);
  const [pending, startTransition] = useTransition();

  const creating = variant === null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await saveVariantAction(EMPTY_VARIANT_FORM_STATE, form);
      setState(result);

      if (hasAnyError(result.errors)) return;

      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Modal
      open={open}
      onOpenChange={setOpen}
      size="form"
      title={creating ? t.admin.addVariant : `Variante ${variant.sku}`}
      description={creating ? t.admin.variantCreatedEmpty : t.admin.variantEditHint}
      trigger={trigger}
    >
      <form onSubmit={submit}>
        <Stack gap={4}>
          <input type="hidden" name="productId" value={productId} />
          {variant && <input type="hidden" name="variantId" value={variant.id} />}

          {state.errors.form && (
            <Alert tone="danger" title={t.admin.saveRefused}>
              {state.errors.form}
            </Alert>
          )}

          <FormField
            label="SKU"
            error={state.errors.sku}
            required
            description={t.admin.skuHint}
          >
            {(field) => (
              <Input
                {...field}
                name="sku"
                defaultValue={variant?.sku ?? ''}
                autoComplete="off"
                spellCheck={false}
                className="font-mono uppercase"
              />
            )}
          </FormField>

          {creating &&
            options.map((option) => (
              <FormField key={option.id} label={option.name} optional>
                {(field) => (
                  <NativeSelect {...field} name="optionValueId" defaultValue="">
                    <option value="">—</option>
                    {option.values.map((value) => (
                      <option key={value.id} value={value.id}>
                        {value.value}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
            ))}

          <FormField
            label={t.admin.specificPrice(currency)}
            error={state.errors.priceOverride}
            optional
            description="Laissez vide pour utiliser le prix du produit."
          >
            {(field) => (
              <Input
                {...field}
                name="priceOverride"
                defaultValue={variant?.priceOverride?.toString() ?? ''}
                inputMode="numeric"
                className="font-mono tabular-nums"
              />
            )}
          </FormField>

          <FormField
            label={t.admin.fieldLowStockThreshold}
            error={state.errors.lowStockThreshold}
            optional
            description={t.admin.thresholdHint}
          >
            {(field) => (
              <Input
                {...field}
                name="lowStockThreshold"
                defaultValue={variant?.lowStockThreshold?.toString() ?? ''}
                inputMode="numeric"
                className="font-mono tabular-nums"
              />
            )}
          </FormField>

          <CheckboxField
            id={`variant-active-${variant?.id ?? 'new'}`}
            name="isActive"
            label={t.admin.fieldVariantActive}
            description={t.admin.variantActiveHint}
            defaultChecked={variant?.isActive ?? true}
          />

          <Text variant="caption" tone="subtle">
            {t.admin.ordersKeepSnapshot}
          </Text>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
            >
              {t.admin.cancel}
            </Button>
            <Button type="submit" size="sm" loading={pending}>
              {creating ? 'Ajouter' : 'Enregistrer'}
            </Button>
          </div>
        </Stack>
      </form>
    </Modal>
  );
}
