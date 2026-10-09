'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Alert } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { CheckboxField, Input, Textarea } from '@/components/ui/input';
import { FormField } from '@/components/ui/field';
import { Heading, Text } from '@/components/ui/typography';
import { Link } from '@/components/ui/link';
import { Stack } from '@/components/layout/layout';
import { TranslationPanel } from '@/components/admin/translation-panel';
import { slugify } from '@/domain/catalogue';
import { translationFor } from '@/domain/translation';
import { useDictionary } from '@/i18n/client';
import { useToast } from '@/components/ui/toast';

import { saveCategoryAction } from './actions';
import { EMPTY_CATEGORY_FORM_STATE, type CategoryFormState } from './form-state';

/**
 * The category form — create and edit, one component.
 *
 * Deliberately short. A category is a name, an address and a place in a row;
 * everything that makes a shop interesting belongs to the products inside it.
 * A form with six fields is one somebody will actually fill in rather than
 * skip, which is how categories end up with descriptions at all.
 *
 * A plain `<form action={...}>` driven by `useActionState`, so it submits and
 * reports field errors with JavaScript off. The one thing the client does is
 * suggest a slug while the name is typed, and it stops the moment the operator
 * edits the slug themselves.
 */

export type CategoryFormValues = {
  id: string | null;
  name: string;
  slug: string;
  description: string;
  position: string;
  isActive: boolean;
  seoTitle: string;
  seoDescription: string;
  /** The overlay column as stored, so the English panel opens filled in. */
  translations: unknown;
};

export function CategoryForm({
  values,
  /** Live products in it, which is what decides whether it may be hidden. */
  liveProducts,
}: {
  values: CategoryFormValues;
  liveProducts: number;
}) {
  const { t } = useDictionary();
  const router = useRouter();
  const toast = useToast();
  const [state, formAction, pending] = useActionState<CategoryFormState, FormData>(
    saveCategoryAction,
    EMPTY_CATEGORY_FORM_STATE,
  );

  const creating = values.id === null;

  const [name, setName] = useState(values.name);
  const [slug, setSlug] = useState(values.slug);
  const [slugTouched, setSlugTouched] = useState(values.slug.length > 0);

  const suggestedSlug = slugTouched ? slug : slugify(name);

  // Creating lands on the list, because the next thing anybody does with a new
  // category is put a product in it, and that happens on the product's page.
  useEffect(() => {
    if (creating && state.savedId) router.push('/admin/categories');
  }, [creating, router, state.savedId]);
  /*
   * Say so, and show it.
   *
   * Creating navigates, which is its own confirmation. Editing did not: the
   * form posted, the server wrote, and nothing on the screen changed — so the
   * only way to know a save had worked was to reload. The toast is the
   * feedback and `router.refresh()` is what makes the page agree with the
   * database, which matters most for the English panel, whose progress count
   * is read from the row.
   */
  useEffect(() => {
    if (creating || state.savedAt === undefined) return;

    toast({ tone: 'success', title: t.admin.changesSaved });
    router.refresh();
  }, [creating, router, state.savedAt, t.admin.changesSaved, toast]);

  const errors = state.errors;
  const english = translationFor(values.translations, 'en');
  const translationErrors = state.translationErrors ?? {};

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-6">
      {values.id && <input type="hidden" name="categoryId" value={values.id} />}

      {errors.form && (
        <Alert tone="danger" title={t.admin.saveRefused}>
          {errors.form}
        </Alert>
      )}

      <fieldset className="border-border bg-surface block rounded-md border p-5 md:p-6">
        <legend className="float-left mb-5 w-full p-0">
          <Heading level={2} variant="heading-md">
            {t.admin.fieldsetIdentity}
          </Heading>
          <Text variant="body-sm" tone="muted" className="mt-1 max-w-prose">
            {t.admin.identityHint}
          </Text>
        </legend>

        <div className="clear-both flex flex-col gap-5">
          <FormField label={t.admin.fieldCategoryName} error={errors.name} required>
            {(field) => (
              <Input
                {...field}
                name="name"
                required
                maxLength={60}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </FormField>

          <FormField
            label={t.admin.fieldSlug}
            error={errors.slug}
            description={t.admin.slugHint(suggestedSlug || '…')}
            required
          >
            {(field) => (
              <Input
                {...field}
                name="slug"
                required
                value={suggestedSlug}
                onChange={(event) => {
                  setSlugTouched(true);
                  setSlug(event.target.value);
                }}
              />
            )}
          </FormField>

          <FormField
            label={t.admin.fieldDescription}
            error={errors.description}
            description={t.admin.categoryDescriptionHint}
            optional
          >
            {(field) => (
              <Textarea
                {...field}
                name="description"
                rows={3}
                maxLength={600}
                defaultValue={values.description}
              />
            )}
          </FormField>
        </div>
      </fieldset>

      <fieldset className="border-border bg-surface block rounded-md border p-5 md:p-6">
        <legend className="float-left mb-5 w-full p-0">
          <Heading level={2} variant="heading-md">
            {t.admin.fieldsetAvailability}
          </Heading>
        </legend>

        <div className="clear-both flex flex-col gap-5">
          <FormField
            label={t.admin.fieldCategoryPosition}
            error={errors.position}
            description={t.admin.categoryPositionHint}
          >
            {(field) => (
              <Input
                {...field}
                name="position"
                inputMode="numeric"
                defaultValue={values.position}
                className="max-w-32"
              />
            )}
          </FormField>

          <Stack gap={2}>
            <CheckboxField
              id="category-active"
              name="isActive"
              defaultChecked={values.isActive}
              label={t.admin.fieldCategoryActive}
              description={t.admin.categoryActiveHint}
            />

            {/*
             * The refusal, before it is a refusal.
             *
             * The rule is enforced on the server (`mayDeactivateCategory`), and
             * saying so here turns a rejected save into a sentence somebody
             * reads before they try. It is a warning rather than a disabled
             * checkbox: the operator may well be about to unpublish those
             * products, and a control that cannot be touched explains nothing.
             */}
            {errors.isActive && (
              <Alert tone="warning" title={t.admin.saveRefused}>
                {errors.isActive}
              </Alert>
            )}

            {!errors.isActive && values.isActive && liveProducts > 0 && (
              <Text variant="body-sm" tone="subtle">
                {t.admin.categoryActiveHint}
              </Text>
            )}
          </Stack>
        </div>
      </fieldset>

      <fieldset className="border-border bg-surface block rounded-md border p-5 md:p-6">
        <legend className="float-left mb-5 w-full p-0">
          <Heading level={2} variant="heading-md">
            {t.admin.fieldsetSeo}
          </Heading>
          <Text variant="body-sm" tone="muted" className="mt-1 max-w-prose">
            {t.admin.seoBlankHint}
          </Text>
        </legend>

        <div className="clear-both flex flex-col gap-5">
          <FormField label={t.admin.fieldSeoTitle} error={errors.seoTitle} optional>
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
                rows={2}
                defaultValue={values.seoDescription}
              />
            )}
          </FormField>
        </div>
      </fieldset>

      <TranslationPanel
        locale="en"
        errors={translationErrors}
        defaultOpen={Object.keys(translationErrors).length > 0}
        fields={[
          {
            field: 'name',
            label: t.admin.fieldCategoryName,
            source: values.name,
            value: english.name ?? '',
            maxLength: 60,
          },
          {
            field: 'description',
            label: t.admin.fieldDescription,
            source: values.description,
            value: english.description ?? '',
            multiline: true,
            maxLength: 600,
          },
          {
            field: 'seoTitle',
            label: t.admin.fieldSeoTitle,
            source: values.seoTitle,
            value: english.seoTitle ?? '',
            maxLength: 120,
          },
          {
            field: 'seoDescription',
            label: t.admin.fieldSeoDescription,
            source: values.seoDescription,
            value: english.seoDescription ?? '',
            multiline: true,
            maxLength: 320,
          },
        ]}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={pending}>
          {creating ? t.admin.createCategory : t.admin.saveChanges}
        </Button>

        <Button asChild variant="ghost">
          <Link href="/admin/categories" variant="plain">
            {t.common.cancel}
          </Link>
        </Button>
      </div>
    </form>
  );
}
