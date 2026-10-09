'use client';

import { Languages } from 'lucide-react';

import { FormField } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Text } from '@/components/ui/typography';
import { LOCALE_NAMES, isLocale } from '@/i18n/locales';
import { useDictionary } from '@/i18n/client';

/**
 * The English half of a catalogue form.
 *
 * Every field here sits beside the French one it translates — the French text
 * is printed above the box rather than left in another tab, because a
 * translator who has to remember the sentence they are translating writes a
 * different sentence. Empty means "not translated", and the storefront shows
 * the French: there is no way to say "translate this to nothing", and none is
 * wanted.
 *
 * Collapsed by default. The product form is already long, and most saves are
 * about a price or a photograph rather than about English; a panel that is open
 * by default would push everything else below the fold for the common case.
 *
 * The fields post as `translations.<locale>.<field>`, which is the shape
 * `collectTranslation` reads on the server. A field the domain does not list as
 * translatable is dropped there rather than trusted from here.
 *
 * **Each label carries its language.** Two controls called "Nom de la
 * catégorie" on one form is ambiguous to a screen reader reading them out of
 * context, and it is the kind of ambiguity that only shows up once somebody
 * tries to fill the form in without looking at it.
 */

export type TranslationField = {
  /** The column being translated, e.g. `name`. */
  field: string;
  label: string;
  /** The French text, shown so the translator can see what they are matching. */
  source: string | null;
  /** What is already stored for this locale. */
  value: string;
  multiline?: boolean;
  maxLength?: number;
};

export function TranslationPanel({
  locale,
  fields,
  errors,
  /** Open on load — used when a save came back with an error inside the panel. */
  defaultOpen = false,
}: {
  locale: string;
  fields: readonly TranslationField[];
  errors?: Readonly<Record<string, string>>;
  defaultOpen?: boolean;
}) {
  const { t } = useDictionary();
  const language = isLocale(locale) ? LOCALE_NAMES[locale] : locale;
  const translated = fields.filter((field) => field.value.trim() !== '').length;
  const owed = fields.filter((field) => (field.source ?? '').trim() !== '').length;

  return (
    <details
      open={defaultOpen}
      /*
       * Named explicitly. A `<details>` is exposed as a `group`, but Chromium
       * does not take its accessible name from the `<summary>` — so without
       * this the panel is an unnamed group, which is what a screen reader
       * announces when somebody steps into it.
       */
      aria-label={t.admin.translationHeading}
      className="border-border bg-surface rounded-md border p-5 md:p-6"
    >
      <summary className="flex cursor-pointer flex-wrap items-center gap-3">
        <Languages className="size-4 shrink-0" aria-hidden="true" />
        <Text variant="heading-md" as="span">
          {t.admin.translationHeading}
        </Text>
        <Text variant="body-sm" tone="subtle" as="span" numeric>
          {t.admin.translationProgress(translated, owed)}
        </Text>
      </summary>

      <Text variant="body-sm" tone="muted" className="mt-2 max-w-prose">
        {t.admin.translationHint}
      </Text>

      <div className="mt-5 flex flex-col gap-5">
        {fields.map((field) => (
          <FormField
            key={field.field}
            label={t.admin.translationFieldLabel(field.label, language)}
            error={errors?.[field.field]}
            description={field.source ?? t.admin.translationNoSource}
            optional
          >
            {(props) =>
              field.multiline ? (
                <Textarea
                  {...props}
                  name={`translations.${locale}.${field.field}`}
                  rows={3}
                  maxLength={field.maxLength}
                  defaultValue={field.value}
                />
              ) : (
                <Input
                  {...props}
                  name={`translations.${locale}.${field.field}`}
                  maxLength={field.maxLength}
                  defaultValue={field.value}
                />
              )
            }
          </FormField>
        ))}
      </div>
    </details>
  );
}
