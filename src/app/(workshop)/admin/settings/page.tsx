import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { Alert } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/page-header';
import { Stack } from '@/components/layout/layout';
import { mayManageSettings } from '@/domain/permissions';
import { workshopDictionary } from '@/i18n/server';
import { requireStaff } from '@/server/auth/guards';
import { editableSettings } from '@/server/services/settings-service';

import { SettingsForm } from './settings-form';

/**
 * The shop's own settings.
 *
 * The screen `ROADMAP.md` has listed as Phase 12's outstanding half since Phase
 * 12. The `settings` table has been read from the first day — every rate, every
 * threshold, the deposit percentage — and until now the only way to change any
 * of it was a SQL client. Two of those rows have already cost this project an
 * afternoon: `notifications.adminRecipients` sat empty and silently dropped
 * every "new order" e-mail to the workshop.
 *
 * **Admin only** (12.1). Staff run the workshop; they do not decide what the
 * shop is called, whether it is open, or what a deposit is. A member of staff
 * who reaches this address gets the same "not found" as anybody else — the
 * screen does not render disabled controls to explain what they cannot do.
 */

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await workshopDictionary();
  return { title: t.admin.navSettings };
}

export const dynamic = 'force-dynamic';

export default async function AdminSettingsPage() {
  const { t } = await workshopDictionary();

  const authorisation = await requireStaff();
  if (!authorisation.ok) notFound();
  if (!mayManageSettings(authorisation.actor)) notFound();

  const settings = await editableSettings();

  return (
    <Stack gap={6}>
      <PageHeader title={t.admin.navSettings} description={t.adminSettings.lead} />

      {settings.length === 0 ? (
        /*
         * An empty list means the rows are not in the database, not that there
         * is nothing to configure — every one of them is declared in
         * `domain/settings`. Saying "run the seed" is the actionable version.
         */
        <Alert tone="warning" title={t.adminSettings.emptyTitle}>
          {t.adminSettings.emptyBody}
        </Alert>
      ) : (
        <SettingsForm settings={settings} />
      )}
    </Stack>
  );
}
