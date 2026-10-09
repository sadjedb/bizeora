'use client';

import { useRef, useState, useTransition } from 'react';
import { ImagePlus, Plus, Trash2 } from 'lucide-react';

import { Alert } from '@/components/ui/feedback';
import { Button, IconButton } from '@/components/ui/button';
import { FormField } from '@/components/ui/field';
import { Inline, Stack } from '@/components/layout/layout';
import { Input, SwitchField, Textarea } from '@/components/ui/input';
import { Modal } from '@/components/ui/overlay';
import { TabSet } from '@/components/ui/navigation';
import { Text } from '@/components/ui/typography';
import { useDictionary } from '@/i18n/client';
import {
  SECTION_FIELDS,
  SECTION_HAS_CTA,
  type ConfigField,
} from '@/domain/content/editing';
import { SHOP_IMAGE_MIME_TYPES } from '@/domain/media';
import type { HomepageSection, HomepageSectionType } from '@/domain/content';
import type { Dictionary } from '@/i18n';

import { saveSectionAction, uploadSiteImageAction } from './actions';

/**
 * One band's copy and settings, in both languages.
 *
 * The form is generated from `SECTION_FIELDS` rather than written per band
 * type: the declaration says the hero has an eyebrow, a note and an image, and
 * this renders a control for each. A band type that gains a setting gains a
 * control here without this file changing, which is the only way a JSON config
 * column and an editor stay in step.
 *
 * ## The two tabs
 *
 * French is the row. English is an overlay stored inside the same row's
 * `config` (ADR-030), and the tab shows **only what a translator can change** —
 * words. A destination, a photograph, a count and a switch are the same in both
 * languages, so offering them twice would invite two answers to a question with
 * one.
 *
 * A blank English field is not stored, and the band falls back to the French.
 * That is what makes translating a page one paragraph at a time survivable.
 */

export type EditableSection = HomepageSection & { updatedAt?: Date };

type Values = {
  title: string;
  subtitle: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
  config: Record<string, string | number | boolean | readonly unknown[] | null>;
};

type Point = { icon?: string; title: string; body: string };

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asPoints(value: unknown): Point[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    const fields = record(entry);
    const title = typeof fields.title === 'string' ? fields.title : '';
    const body = typeof fields.body === 'string' ? fields.body : '';
    const icon = typeof fields.icon === 'string' ? fields.icon : undefined;

    return title === '' && body === '' ? [] : [{ icon, title, body }];
  });
}

/** The values a tab starts with: the row for French, the overlay for English. */
function initialValues(
  section: EditableSection,
  locale: 'fr' | 'en',
  fields: readonly ConfigField[],
): Values {
  const config = record(section.config);
  const source = locale === 'fr' ? config : record(config.en);

  const values: Values['config'] = {};
  for (const field of fields) {
    const raw = source[field.name];

    if (field.kind === 'points') values[field.name] = asPoints(raw);
    else if (field.kind === 'flag') values[field.name] = raw === true;
    else if (field.kind === 'count')
      values[field.name] = typeof raw === 'number' ? raw : 4;
    else values[field.name] = typeof raw === 'string' ? raw : '';
  }

  const overlay = record(config.en);

  return {
    title: (locale === 'fr' ? section.title : ((overlay.title as string) ?? '')) ?? '',
    subtitle:
      (locale === 'fr' ? section.subtitle : ((overlay.subtitle as string) ?? '')) ?? '',
    body: (locale === 'fr' ? section.body : ((overlay.body as string) ?? '')) ?? '',
    ctaLabel:
      (locale === 'fr' ? section.ctaLabel : ((overlay.ctaLabel as string) ?? '')) ?? '',
    ctaHref: section.ctaHref ?? '',
    config: values,
  };
}

/** Words a translator can change. Everything else is the same in both languages. */
function translatable(field: ConfigField): boolean {
  return (
    (field.kind === 'text' || field.kind === 'longText' || field.kind === 'points') &&
    !field.name.endsWith('Href') &&
    field.name !== 'imageKey'
  );
}

/** What each declared setting is called on screen, in the reader's language. */
function fieldLabels(t: Dictionary): Record<string, string> {
  return {
    eyebrow: t.admin.fieldEyebrow,
    note: t.admin.fieldNote,
    secondaryCtaLabel: t.admin.fieldSecondaryCta,
    secondaryCtaHref: t.admin.fieldSecondaryCtaHref,
    imageKey: t.admin.fieldPhotograph,
    imageAlt: t.admin.fieldPhotographAlt,
    limit: t.admin.fieldLimit,
    showDelivery: t.admin.fieldShowDelivery,
    points: t.admin.fieldPoints,
    words: t.admin.fieldWords,
  };
}

export function SectionEditor({
  section,
  name,
  onClose,
}: {
  section: EditableSection;
  name: string;
  onClose: () => void;
}) {
  const { t } = useDictionary();
  const fields = SECTION_FIELDS[section.type as HomepageSectionType];

  const [fr, setFr] = useState<Values>(() => initialValues(section, 'fr', fields));
  const [en, setEn] = useState<Values>(() => initialValues(section, 'en', fields));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);

    startTransition(async () => {
      const result = await saveSectionAction({
        sectionId: section.id,
        fr,
        en,
      });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      onClose();
    });
  }

  const hasCta = SECTION_HAS_CTA[section.type as HomepageSectionType];

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      size="form"
      title={t.admin.editWhat(name)}
      description={t.admin.editorLead}
      footer={
        <Inline gap={3} justify="end" wrap>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t.admin.cancel}
          </Button>
          <Button variant="primary" onClick={save} loading={pending}>
            {t.admin.save}
          </Button>
        </Inline>
      }
    >
      <Stack gap={5}>
        {error && (
          <Alert tone="danger" title={t.admin.changeRefused}>
            {error}
          </Alert>
        )}

        <TabSet
          items={[
            {
              value: 'fr',
              label: 'Français',
              content: (
                <LocalePanel
                  values={fr}
                  onChange={setFr}
                  fields={fields}
                  showAll
                  showCta={hasCta}
                />
              ),
            },
            {
              value: 'en',
              label: 'English',
              content: (
                <LocalePanel
                  values={en}
                  onChange={setEn}
                  fields={fields.filter(translatable)}
                  showAll={false}
                  showCta={hasCta}
                  placeholderFrom={fr}
                />
              ),
            },
          ]}
        />
      </Stack>
    </Modal>
  );
}

/**
 * One language's fields.
 *
 * The English panel shows the French as each control's placeholder, so a
 * translator sees the sentence they are translating without leaving the tab —
 * and an empty control reads as "not translated yet" rather than as "empty".
 */
function LocalePanel({
  values,
  onChange,
  fields,
  showAll,
  showCta,
  placeholderFrom,
}: {
  values: Values;
  onChange: (next: Values) => void;
  fields: readonly ConfigField[];
  showAll: boolean;
  showCta: boolean;
  placeholderFrom?: Values;
}) {
  const { t } = useDictionary();
  function set<K extends keyof Values>(key: K, value: Values[K]) {
    onChange({ ...values, [key]: value });
  }

  function setConfig(name: string, value: Values['config'][string]) {
    onChange({ ...values, config: { ...values.config, [name]: value } });
  }

  return (
    <Stack gap={4} className="pt-4">
      <FormField label={t.admin.fieldTitle}>
        {(props) => (
          <Input
            {...props}
            value={values.title}
            placeholder={placeholderFrom?.title}
            maxLength={120}
            onChange={(event) => set('title', event.target.value)}
          />
        )}
      </FormField>

      <FormField label={t.admin.fieldSubtitle} optional>
        {(props) => (
          <Input
            {...props}
            value={values.subtitle}
            placeholder={placeholderFrom?.subtitle}
            maxLength={160}
            onChange={(event) => set('subtitle', event.target.value)}
          />
        )}
      </FormField>

      <FormField label={t.admin.fieldBody} optional>
        {(props) => (
          <Textarea
            {...props}
            rows={4}
            value={values.body}
            placeholder={placeholderFrom?.body}
            maxLength={600}
            onChange={(event) => set('body', event.target.value)}
          />
        )}
      </FormField>

      {showCta && (
        <Inline gap={4} wrap className="items-start">
          <FormField label={t.admin.fieldButton} optional className="min-w-56 flex-1">
            {(props) => (
              <Input
                {...props}
                value={values.ctaLabel}
                placeholder={placeholderFrom?.ctaLabel}
                maxLength={40}
                onChange={(event) => set('ctaLabel', event.target.value)}
              />
            )}
          </FormField>

          {showAll && (
            <FormField
              label={t.admin.fieldDestination}
              optional
              description={t.admin.destinationHint}
              className="min-w-56 flex-1"
            >
              {(props) => (
                <Input
                  {...props}
                  value={values.ctaHref}
                  placeholder="/shop"
                  onChange={(event) => set('ctaHref', event.target.value)}
                />
              )}
            </FormField>
          )}
        </Inline>
      )}

      {fields.map((field) => (
        <ConfigControl
          key={field.name}
          field={field}
          value={values.config[field.name] ?? ''}
          placeholder={
            typeof placeholderFrom?.config[field.name] === 'string'
              ? (placeholderFrom.config[field.name] as string)
              : undefined
          }
          points={placeholderFrom ? asPoints(placeholderFrom.config[field.name]) : []}
          onChange={(value) => setConfig(field.name, value)}
        />
      ))}
    </Stack>
  );
}

function ConfigControl({
  field,
  value,
  placeholder,
  points,
  onChange,
}: {
  field: ConfigField;
  value: Values['config'][string];
  placeholder?: string;
  points: readonly Point[];
  onChange: (value: Values['config'][string]) => void;
}) {
  const { t } = useDictionary();
  const label = fieldLabels(t)[field.name] ?? field.name;

  if (field.kind === 'flag') {
    return (
      <SwitchField
        id={`config-${field.name}`}
        label={label}
        checked={value === true}
        onCheckedChange={(checked) => onChange(checked)}
      />
    );
  }

  if (field.kind === 'count') {
    return (
      <FormField label={label}>
        {(props) => (
          <Input
            {...props}
            type="number"
            min={1}
            max={field.max ?? 12}
            value={typeof value === 'number' ? value : 4}
            onChange={(event) => onChange(Number.parseInt(event.target.value, 10) || 1)}
          />
        )}
      </FormField>
    );
  }

  if (field.kind === 'image') {
    return (
      <ImageControl
        label={label}
        storageKey={typeof value === 'string' ? value : ''}
        onChange={onChange}
      />
    );
  }

  if (field.kind === 'points') {
    return (
      <PointsControl
        label={label}
        points={Array.isArray(value) ? (value as Point[]) : []}
        french={points}
        onChange={(next) => onChange(next)}
      />
    );
  }

  return (
    <FormField label={label} optional>
      {(props) => (
        <Input
          {...props}
          value={typeof value === 'string' ? value : ''}
          placeholder={placeholder}
          maxLength={200}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </FormField>
  );
}

/** The hero photograph: upload, or clear it and fall back to the split layout. */
function ImageControl({
  label,
  storageKey,
  onChange,
}: {
  label: string;
  storageKey: string;
  onChange: (value: string) => void;
}) {
  const { t } = useDictionary();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const preview = storageKey ? `/assets/${storageKey}` : null;

  function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);

    startTransition(async () => {
      const form = new FormData();
      form.set('file', file);

      const result = await uploadSiteImageAction(form);
      if (result.ok) onChange(result.storageKey);
      else setError(result.message);

      if (input.current) input.current.value = '';
    });
  }

  return (
    <Stack gap={2}>
      <Text variant="body-sm" as="span" className="font-medium">
        {label}
      </Text>

      {error && (
        <Alert tone="danger" title="Envoi impossible">
          {error}
        </Alert>
      )}

      <Inline gap={3} wrap className="items-center">
        <div className="bg-surface-sunken h-20 w-32 shrink-0 overflow-hidden rounded-sm">
          {preview && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={preview} alt="" className="size-full object-cover" />
          )}
        </div>

        <input
          ref={input}
          type="file"
          accept={SHOP_IMAGE_MIME_TYPES.join(',')}
          className="sr-only"
          aria-hidden="true"
          tabIndex={-1}
          onChange={onFile}
        />

        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={pending}
          leadingIcon={<ImagePlus aria-hidden="true" />}
          onClick={() => input.current?.click()}
        >
          {storageKey ? t.admin.replacePhoto : t.admin.addPhoto}
        </Button>

        {storageKey && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange('')}>
            {t.admin.removePhoto}
          </Button>
        )}
      </Inline>

      <Text variant="caption" tone="subtle">
        {t.admin.heroFallbackNote}
      </Text>
    </Stack>
  );
}

/** The numbered points of "how it works" and "why us". */
function PointsControl({
  label,
  points,
  french,
  onChange,
}: {
  label: string;
  points: readonly Point[];
  french: readonly Point[];
  onChange: (points: readonly Point[]) => void;
}) {
  const { t } = useDictionary();
  function update(index: number, patch: Partial<Point>) {
    onChange(points.map((point, at) => (at === index ? { ...point, ...patch } : point)));
  }

  return (
    <Stack gap={3}>
      <Inline gap={3} className="items-center justify-between">
        <Text variant="body-sm" as="span" className="font-medium">
          {label}
        </Text>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          leadingIcon={<Plus aria-hidden="true" />}
          onClick={() => onChange([...points, { title: '', body: '' }])}
        >
          {t.admin.add}
        </Button>
      </Inline>

      {points.length === 0 && (
        <Text variant="caption" tone="subtle">
          {t.admin.noPoints}
        </Text>
      )}

      <ul className="flex list-none flex-col gap-3 p-0">
        {points.map((point, index) => (
          <li
            key={index}
            className="border-border flex flex-col gap-2 rounded-md border p-3"
          >
            <Inline gap={2} className="items-start">
              <div className="flex flex-1 flex-col gap-2">
                <Input
                  aria-label={`${label} ${index + 1} — titre`}
                  value={point.title}
                  placeholder={french[index]?.title}
                  maxLength={120}
                  onChange={(event) => update(index, { title: event.target.value })}
                />
                <Textarea
                  aria-label={`${label} ${index + 1} — texte`}
                  rows={2}
                  value={point.body}
                  placeholder={french[index]?.body}
                  maxLength={400}
                  onChange={(event) => update(index, { body: event.target.value })}
                />
              </div>

              <IconButton
                label={t.admin.deletePoint(index + 1)}
                variant="ghost"
                size="sm"
                onClick={() => onChange(points.filter((_, at) => at !== index))}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </IconButton>
            </Inline>
          </li>
        ))}
      </ul>
    </Stack>
  );
}
