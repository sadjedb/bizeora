'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Alert } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/field';
import { CheckboxField, Input, SelectField, Textarea } from '@/components/ui/input';
import { Link } from '@/components/ui/link';
import { Stack } from '@/components/layout/layout';
import { Heading, Text } from '@/components/ui/typography';
import { useDictionary } from '@/i18n/client';
import {
  PRODUCT_STATUSES,
  PRODUCT_STATUS_HINTS,
  PRODUCT_STATUS_LABELS,
  STOCK_POLICIES,
  STOCK_POLICY_HINTS,
  STOCK_POLICY_LABELS,
  slugify,
  type ProductStatus,
  type StockPolicy,
} from '@/domain/catalogue';

import { saveProductAction } from './actions';
import { EMPTY_PRODUCT_FORM_STATE, type ProductFormState } from './form-state';

/**
 * The product form — create and edit, one component.
 *
 * Two forms would drift within a month, and the difference between them is a
 * hidden `productId` and where you go afterwards.
 *
 * It is a plain `<form action={...}>` driven by `useActionState`, so it submits
 * and reports field errors without JavaScript. The only thing the client
 * genuinely does is suggest a slug while the name is typed, and it stops the
 * moment the operator edits the slug themselves — a URL that keeps rewriting
 * itself under somebody's cursor is worse than one they have to type.
 *
 * **The form posts what the operator typed and nothing else.** No price is
 * computed here, no status is inferred, and `publishedAt` — the field the
 * storefront's visibility predicate actually reads — is set by the repository,
 * never by this form. That is the difference between a form and an API.
 */

export type ProductFormValues = {
  id: string | null;
  name: string;
  slug: string;
  subtitle: string;
  description: string;
  categoryId: string;
  status: ProductStatus;
  basePrice: string;
  compareAtPrice: string;
  stockPolicy: StockPolicy;
  material: string;
  careInstructions: string;
  embroideryDetails: string;
  isCustomizable: boolean;
  isFeatured: boolean;
  isNewArrival: boolean;
  isBestSeller: boolean;
  seoTitle: string;
  seoDescription: string;
};

/**
 * A titled band of fields. The form is long; unbroken it is unreadable.
 *
 * A real `<fieldset>` and `<legend>`, so the group has a name a screen reader
 * announces with each control inside it. The legend is `float-left w-full`
 * rather than a flex child: a `<legend>` is laid out by the browser as part of
 * the fieldset's border, and inside a flex container it escapes the box and
 * sits across the top edge with the fields overlapping it. The float is the
 * long-standing workaround, and it needs the fieldset to be a block with the
 * fields in their own flex wrapper below.
 */
function Fieldset({
  legend,
  description,
  children,
}: {
  legend: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="border-border bg-surface block rounded-md border p-5 md:p-6">
      <legend className="float-left mb-5 w-full p-0">
        <Heading level={2} variant="heading-md">
          {legend}
        </Heading>
        {description && (
          <Text variant="body-sm" tone="muted" className="mt-1 max-w-prose">
            {description}
          </Text>
        )}
      </legend>

      <div className="clear-both flex flex-col gap-5">{children}</div>
    </fieldset>
  );
}

/**
 * A select that submits.
 *
 * `FormField` owns the label, the description and the error, and hands the
 * control the ids that wire them together; `SelectField` owns the control. The
 * two are composed here rather than in a new primitive because this is the only
 * screen in the application that posts a select through `FormData`.
 */
function SelectRow({
  label,
  name,
  options,
  error,
  description,
  value,
  onValueChange,
  defaultValue,
  placeholder,
}: {
  label: string;
  name: string;
  options: readonly { value: string; label: string }[];
  error?: string;
  description?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  defaultValue?: string;
  placeholder?: string;
}) {
  return (
    <FormField label={label} error={error} description={description} required>
      {(field) => (
        <SelectField
          {...field}
          name={name}
          required
          options={options}
          value={value}
          onValueChange={onValueChange}
          defaultValue={defaultValue}
          placeholder={placeholder}
        />
      )}
    </FormField>
  );
}

export function ProductForm({
  values,
  categories,
  currency,
}: {
  values: ProductFormValues;
  categories: readonly { id: string; name: string }[];
  currency: string;
}) {
  const { t } = useDictionary();
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ProductFormState, FormData>(
    saveProductAction,
    EMPTY_PRODUCT_FORM_STATE,
  );

  const creating = values.id === null;

  const [name, setName] = useState(values.name);
  const [slug, setSlug] = useState(values.slug);
  const [slugTouched, setSlugTouched] = useState(values.slug.length > 0);
  const [status, setStatus] = useState<ProductStatus>(values.status);
  const [policy, setPolicy] = useState<StockPolicy>(values.stockPolicy);

  const suggestedSlug = slugTouched ? slug : slugify(name);

  // Creating lands on the new product's own page, where the variants live —
  // a product with no variants is not sellable, so the next step is there.
  useEffect(() => {
    if (creating && state.savedId) router.push(`/admin/products/${state.savedId}`);
  }, [creating, router, state.savedId]);

  const errors = state.errors;

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {values.id && <input type="hidden" name="productId" value={values.id} />}

      {errors.form && (
        <Alert tone="danger" title={t.admin.saveRefused}>
          {errors.form}
        </Alert>
      )}

      <Fieldset legend={t.admin.fieldsetIdentity} description={t.admin.identityHint}>
        <FormField label={t.admin.fieldProductName} error={errors.name} required>
          {(field) => (
            <Input
              {...field}
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              autoComplete="off"
            />
          )}
        </FormField>

        <FormField
          label="Adresse (slug)"
          error={errors.slug}
          description={t.admin.slugHint(suggestedSlug || '…')}
        >
          {(field) => (
            <Input
              {...field}
              name="slug"
              value={suggestedSlug}
              onChange={(event) => {
                setSlugTouched(true);
                setSlug(event.target.value);
              }}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
          )}
        </FormField>

        <FormField label="Accroche" error={errors.subtitle} optional>
          {(field) => (
            <Input
              {...field}
              name="subtitle"
              defaultValue={values.subtitle}
              maxLength={160}
            />
          )}
        </FormField>

        <FormField
          label={t.admin.fieldDescription}
          error={errors.description}
          required
          description={t.admin.descriptionHint}
        >
          {(field) => (
            <Textarea
              {...field}
              name="description"
              defaultValue={values.description}
              rows={6}
            />
          )}
        </FormField>

        <SelectRow
          label={t.admin.fieldCategory}
          name="categoryId"
          error={errors.categoryId}
          defaultValue={values.categoryId === '' ? undefined : values.categoryId}
          options={categories.map((category) => ({
            value: category.id,
            label: category.name,
          }))}
          placeholder={t.admin.chooseCategory}
        />
      </Fieldset>

      <Fieldset legend={t.admin.fieldsetPrice} description={t.admin.amountsIn(currency)}>
        <FormField
          label={`Prix de vente (${currency})`}
          error={errors.basePrice}
          required
        >
          {(field) => (
            <Input
              {...field}
              name="basePrice"
              defaultValue={values.basePrice}
              inputMode="numeric"
              className="font-mono tabular-nums"
            />
          )}
        </FormField>

        <FormField
          label={t.admin.compareAtPrice(currency)}
          error={errors.compareAtPrice}
          optional
          description={t.admin.compareAtHint}
        >
          {(field) => (
            <Input
              {...field}
              name="compareAtPrice"
              defaultValue={values.compareAtPrice}
              inputMode="numeric"
              className="font-mono tabular-nums"
            />
          )}
        </FormField>
      </Fieldset>

      <Fieldset legend={t.admin.fieldsetAvailability}>
        <SelectRow
          label="État"
          name="status"
          error={errors.status}
          value={status}
          onValueChange={(next) => setStatus(next as ProductStatus)}
          description={PRODUCT_STATUS_HINTS[status]}
          options={PRODUCT_STATUSES.map((candidate) => ({
            value: candidate,
            label: PRODUCT_STATUS_LABELS[candidate],
          }))}
        />

        <SelectRow
          label="Gestion du stock"
          name="stockPolicy"
          error={errors.stockPolicy}
          value={policy}
          onValueChange={(next) => setPolicy(next as StockPolicy)}
          description={STOCK_POLICY_HINTS[policy]}
          options={STOCK_POLICIES.map((candidate) => ({
            value: candidate,
            label: STOCK_POLICY_LABELS[candidate],
          }))}
        />

        <Stack gap={1}>
          <CheckboxField
            id="product-customizable"
            name="isCustomizable"
            label="Personnalisable"
            description="Ouvre le configurateur de broderie sur la page produit."
            defaultChecked={values.isCustomizable}
          />
          <CheckboxField
            id="product-featured"
            name="isFeatured"
            label="Mis en avant"
            description={t.admin.featuredHint}
            defaultChecked={values.isFeatured}
          />
          <CheckboxField
            id="product-new"
            name="isNewArrival"
            label={t.admin.fieldNewArrival}
            defaultChecked={values.isNewArrival}
          />
          <CheckboxField
            id="product-bestseller"
            name="isBestSeller"
            label="Meilleure vente"
            defaultChecked={values.isBestSeller}
          />
        </Stack>
      </Fieldset>

      <Fieldset legend={t.admin.fieldsetDetails} description={t.admin.detailsHint}>
        <FormField label={t.admin.fieldMaterial} error={errors.material} optional>
          {(field) => (
            <Textarea
              {...field}
              name="material"
              defaultValue={values.material}
              rows={2}
            />
          )}
        </FormField>

        <FormField label="Entretien" error={errors.careInstructions} optional>
          {(field) => (
            <Textarea
              {...field}
              name="careInstructions"
              defaultValue={values.careInstructions}
              rows={2}
            />
          )}
        </FormField>

        <FormField
          label={t.admin.fieldEmbroideryDetails}
          error={errors.embroideryDetails}
          optional
        >
          {(field) => (
            <Textarea
              {...field}
              name="embroideryDetails"
              defaultValue={values.embroideryDetails}
              rows={2}
            />
          )}
        </FormField>
      </Fieldset>

      <Fieldset
        legend={t.admin.fieldsetSeo}
        description="Laissez vide pour utiliser le nom et la description du produit."
      >
        <FormField label="Titre pour les moteurs" error={errors.seoTitle} optional>
          {(field) => (
            <Input
              {...field}
              name="seoTitle"
              defaultValue={values.seoTitle}
              maxLength={120}
            />
          )}
        </FormField>

        <FormField
          label={t.admin.fieldSeoDescription}
          error={errors.seoDescription}
          optional
        >
          {(field) => (
            <Textarea
              {...field}
              name="seoDescription"
              defaultValue={values.seoDescription}
              rows={3}
            />
          )}
        </FormField>
      </Fieldset>

      <div className="border-border bg-surface sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-md border p-4">
        <Text variant="caption" tone="subtle">
          {creating ? t.admin.createProductThenVariants : t.admin.ordersUnchanged}
        </Text>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/admin/products" variant="plain">
              Annuler
            </Link>
          </Button>
          <Button type="submit" loading={pending} size="md">
            {creating ? t.admin.createProduct : 'Enregistrer'}
          </Button>
        </div>
      </div>
    </form>
  );
}
