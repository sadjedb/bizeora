'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { FormField } from '@/components/ui/field';
import { Inline, Stack } from '@/components/layout/layout';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/typography';
import { useDictionary } from '@/i18n/client';
import { useToast } from '@/components/ui/toast';
import {
  EDITABLE_SETTINGS,
  editableSetting,
  validateSettings,
  type SettingGroup,
  type SettingKind,
} from '@/domain/settings';

import { saveSettingsAction } from './actions';

/**
 * The shop's own settings, as one form.
 *
 * One form and one save, rather than a save per field. These values are read
 * together — a deposit percentage and a quote validity are two halves of the
 * same commercial decision — and a screen that commits each keystroke makes a
 * half-changed policy reachable, which is worse than a screen that asks for a
 * deliberate act.
 *
 * **Nothing is disabled while it is invalid.** The save button stays live and
 * the refusals appear against the fields, because a greyed-out button with no
 * explanation is the most common way a form wastes somebody's afternoon. The
 * server validates again regardless; the client's copy of the rules is a
 * courtesy.
 */

export type SettingView = {
  key: string;
  value: string;
  group: SettingGroup;
  label: string | null;
  description: string | null;
  updatedBy: string | null;
};

const GROUP_ORDER: readonly SettingGroup[] = [
  'brand',
  'availability',
  'accounts',
  'notifications',
  'pricing',
];

export function SettingsForm({ settings }: { settings: readonly SettingView[] }) {
  const { t } = useDictionary();
  const router = useRouter();
  const toast = useToast();

  const initial = useMemo(
    () => Object.fromEntries(settings.map((setting) => [setting.key, setting.value])),
    [settings],
  );

  const [values, setValues] = useState<Record<string, string>>(initial);
  const [refusals, setRefusals] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const dirty = useMemo(
    () => Object.keys(values).filter((key) => values[key] !== initial[key]),
    [values, initial],
  );

  function set(key: string, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
    // Clearing the refusal as they type means the message belongs to the value
    // that caused it, not to the one they are fixing it with.
    setRefusals((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function save() {
    const local = validateSettings(values);

    if (Object.keys(local).length > 0) {
      setRefusals(
        Object.fromEntries(
          Object.entries(local).map(([key, code]) => [
            key,
            t.adminSettings.refusals[code],
          ]),
        ),
      );
      return;
    }

    startTransition(async () => {
      const result = await saveSettingsAction(values);

      if (!result.ok) {
        if (result.reason === 'INVALID') {
          setRefusals(
            Object.fromEntries(
              Object.entries(result.refusals).map(([key, code]) => [
                key,
                t.adminSettings.refusals[code],
              ]),
            ),
          );
          return;
        }

        toast({ tone: 'danger', title: t.adminSettings.forbidden });
        return;
      }

      setRefusals({});
      toast({
        tone: result.changed.length === 0 ? 'neutral' : 'success',
        title:
          result.changed.length === 0
            ? t.adminSettings.nothingChanged
            : t.adminSettings.saved(result.changed.length),
      });

      router.refresh();
    });
  }

  const byGroup = GROUP_ORDER.map((group) => ({
    group,
    rows: settings.filter((setting) => setting.group === group),
  })).filter((section) => section.rows.length > 0);

  return (
    <Stack gap={6}>
      {byGroup.map(({ group, rows }) => (
        <Card key={group}>
          <CardHeader
            title={t.adminSettings.groups[group].title}
            description={t.adminSettings.groups[group].description}
          />
          <CardBody>
            <Stack gap={5}>
              {rows.map((setting) => (
                <SettingField
                  key={setting.key}
                  setting={setting}
                  value={values[setting.key] ?? ''}
                  error={refusals[setting.key] ?? null}
                  disabled={pending}
                  onChange={(next) => set(setting.key, next)}
                />
              ))}
            </Stack>
          </CardBody>
        </Card>
      ))}

      <Inline gap={3} wrap className="items-center">
        <Button onClick={save} loading={pending} disabled={dirty.length === 0}>
          {t.adminSettings.save}
        </Button>

        <Text variant="body-sm" tone="subtle" as="span" aria-live="polite">
          {dirty.length === 0
            ? t.adminSettings.noChanges
            : t.adminSettings.pendingChanges(dirty.length)}
        </Text>
      </Inline>
    </Stack>
  );
}

/**
 * One setting, rendered as whatever its kind deserves.
 *
 * A boolean is a switch, money is a number with its unit spelled out, and a
 * percentage in basis points shows the human figure underneath — nobody thinks
 * in ten-thousandths, and `5000` looking like fifty percent is exactly the sort
 * of thing that gets typed as `50` by mistake.
 */
function SettingField({
  setting,
  value,
  error,
  disabled,
  onChange,
}: {
  setting: SettingView;
  value: string;
  error: string | null;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useDictionary();
  const definition = editableSetting(setting.key);
  const kind: SettingKind = definition?.kind ?? 'TEXT';

  const copy = t.adminSettings.fields[setting.key as keyof typeof t.adminSettings.fields];
  const label = copy?.label ?? setting.label ?? setting.key;
  const help = copy?.help ?? setting.description ?? undefined;

  if (kind === 'BOOLEAN') {
    const on = value === 'true';

    return (
      <Stack gap={1}>
        <label className="flex min-h-11 items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 size-5 shrink-0"
            checked={on}
            disabled={disabled}
            onChange={(event) => onChange(event.target.checked ? 'true' : 'false')}
          />
          <span className="flex flex-col gap-0.5">
            <Text variant="body" as="span">
              {label}
            </Text>
            {help && (
              <Text variant="body-sm" tone="subtle" as="span">
                {help}
              </Text>
            )}
          </span>
        </label>
        <Meta setting={setting} />
      </Stack>
    );
  }

  const numeric = kind === 'NUMBER' || kind === 'MONEY' || kind === 'PERCENT';

  return (
    <Stack gap={1}>
      <FormField
        label={label}
        description={help}
        error={error ?? undefined}
        optional={definition?.optional}
      >
        {(props) => (
          <Input
            {...props}
            value={value}
            disabled={disabled}
            inputMode={numeric ? 'numeric' : undefined}
            maxLength={definition?.maxLength}
            onChange={(event) => onChange(event.target.value)}
          />
        )}
      </FormField>

      {/*
       * The same number, in the unit a person thinks in.
       *
       * Money is stored in minor units and a percentage in basis points, and
       * both are a keystroke away from being wrong by a factor of a hundred.
       */}
      {kind === 'PERCENT' && /^\d+$/.test(value) && (
        <Text variant="caption" tone="subtle">
          {t.adminSettings.percentHint(Number(value) / 100)}
        </Text>
      )}

      <Meta setting={setting} />
    </Stack>
  );
}

/** Who last changed it — the question the table exists to answer. */
function Meta({ setting }: { setting: SettingView }) {
  const { t } = useDictionary();
  if (!setting.updatedBy) return null;

  return (
    <Text variant="caption" tone="subtle">
      {t.adminSettings.lastChangedBy(setting.updatedBy)}
    </Text>
  );
}

export { EDITABLE_SETTINGS };
