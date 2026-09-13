'use client';

import { useState, useTransition } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { Alert } from '@/components/ui/feedback';
import { Button, IconButton } from '@/components/ui/button';
import { FormField } from '@/components/ui/field';
import { Inline, Stack } from '@/components/layout/layout';
import { Input, SwitchField } from '@/components/ui/input';
import { Text } from '@/components/ui/typography';
import { useDictionary } from '@/i18n/client';

import { deleteBannerAction, saveBannerAction } from './actions';

/**
 * The strip above the header.
 *
 * One row per message, each editable in place and saved on its own — a form
 * with one save button for four independent messages is a form where changing
 * one and abandoning another is impossible.
 *
 * The strip is **not translated**. It is a `banners` row with a single
 * `message` column and no JSON to hang an overlay from, unlike the homepage
 * bands; giving it a second language is a migration, and it is recorded as
 * outstanding rather than half-built (ADR-030). Until then a message written
 * here shows in both languages, which is the honest behaviour for a column that
 * holds one sentence.
 */

export type AdminBanner = {
  id: string;
  message: string;
  href: string | null;
  isActive: boolean;
};

export function BannerEditor({ banners }: { banners: readonly AdminBanner[] }) {
  const { t } = useDictionary();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: boolean; message?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok && result.message) setError(result.message);
      else setAdding(false);
    });
  }

  return (
    <Stack gap={3}>
      {error && (
        <Alert tone="danger" title={t.admin.changeRefused}>
          {error}
        </Alert>
      )}

      {banners.length === 0 && !adding && (
        <Text variant="body-sm" tone="muted">
          {t.admin.noBanner}
        </Text>
      )}

      <ul className="flex list-none flex-col gap-3 p-0">
        {banners.map((banner) => (
          <li key={banner.id}>
            <BannerRow banner={banner} pending={pending} onRun={run} />
          </li>
        ))}

        {adding && (
          <li>
            <BannerRow
              banner={{ id: '', message: '', href: null, isActive: true }}
              pending={pending}
              onRun={run}
              onCancel={() => setAdding(false)}
            />
          </li>
        )}
      </ul>

      {!adding && (
        <div>
          <Button
            variant="secondary"
            size="sm"
            disabled={pending}
            leadingIcon={<Plus aria-hidden="true" />}
            onClick={() => setAdding(true)}
          >
            {t.admin.addMessage}
          </Button>
        </div>
      )}
    </Stack>
  );
}

function BannerRow({
  banner,
  pending,
  onRun,
  onCancel,
}: {
  banner: AdminBanner;
  pending: boolean;
  onRun: (action: () => Promise<{ ok: boolean; message?: string }>) => void;
  onCancel?: () => void;
}) {
  const { t } = useDictionary();
  const [message, setMessage] = useState(banner.message);
  const [href, setHref] = useState(banner.href ?? '');
  const [isActive, setIsActive] = useState(banner.isActive);

  const dirty =
    message !== banner.message ||
    (href === '' ? null : href) !== banner.href ||
    isActive !== banner.isActive;

  return (
    <div className="border-border bg-surface flex flex-col gap-3 rounded-md border p-3">
      <FormField label={t.admin.bannerMessage}>
        {(props) => (
          <Input
            {...props}
            value={message}
            maxLength={200}
            onChange={(event) => setMessage(event.target.value)}
          />
        )}
      </FormField>

      <Inline gap={4} wrap className="items-end">
        <FormField
          label="Destination"
          optional
          description={t.admin.bannerDestinationHint}
          className="min-w-56 flex-1"
        >
          {(props) => (
            <Input
              {...props}
              value={href}
              placeholder="/shop"
              onChange={(event) => setHref(event.target.value)}
            />
          )}
        </FormField>

        <SwitchField
          id={`banner-active-${banner.id || 'new'}`}
          label={t.admin.bannerShown}
          checked={isActive}
          onCheckedChange={setIsActive}
          className="min-w-48"
        />
      </Inline>

      <Inline gap={2} justify="end" wrap className="items-center">
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
            {t.admin.cancel}
          </Button>
        )}

        {banner.id !== '' && (
          <IconButton
            label={t.admin.deleteMessage}
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => {
              if (!window.confirm(t.admin.confirmDeleteMessage)) return;
              onRun(() => deleteBannerAction({ bannerId: banner.id }));
            }}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </IconButton>
        )}

        <Button
          variant="primary"
          size="sm"
          disabled={pending || (!dirty && banner.id !== '')}
          onClick={() =>
            onRun(() =>
              saveBannerAction({
                bannerId: banner.id === '' ? null : banner.id,
                message,
                href: href.trim() === '' ? null : href.trim(),
                isActive,
              }),
            )
          }
        >
          {t.admin.save}
        </Button>
      </Inline>
    </div>
  );
}
