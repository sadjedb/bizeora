import type { Metadata } from 'next';

import { dictionaryFor, type Dictionary } from '@/i18n';
import { notFound } from 'next/navigation';

import { Alert, Badge } from '@/components/ui/feedback';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Heading, Text } from '@/components/ui/typography';
import { Inline, Stack } from '@/components/layout/layout';
import { requireCustomer } from '@/server/auth/guards';
import { getCurrentUserProfile } from '@/server/repositories/user-repository';

import { SignOutButton } from './sign-out-button';

export const metadata: Metadata = { title: 'Mon profil' };

export const dynamic = 'force-dynamic';

const DATE = new Intl.DateTimeFormat('fr-DZ', { dateStyle: 'long' });

function statusLabels(t: Dictionary): Record<string, string> {
  return {
    ACTIVE: t.account.statusActive,
    SUSPENDED: t.account.statusSuspended,
    DELETED: t.account.statusDeleted,
  };
}

/**
 * The account itself.
 *
 * Four facts and one action, which is the whole of V1: a customer needs to know
 * which address the workshop writes to, whether it is confirmed — because
 * acceptance depends on it — and how to end the session.
 *
 * What is deliberately absent: no session list, no token, no password hash, no
 * role management, no deletion. `SECURITY.md` section 2.1 keeps
 * `sessions.token` and `accounts.password` out of every projection, and the
 * repository behind this page does not select them at all. Editing the name,
 * changing the password and the address book are Phase 11's documented
 * follow-ons; inventing half of them here would be worse than saying so.
 */
export default async function AccountProfilePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { t } = dictionaryFor((await params).locale);
  const authorisation = await requireCustomer();
  if (!authorisation.ok) notFound();

  const profile = await getCurrentUserProfile(authorisation.actor.userId);
  if (!profile) notFound();

  return (
    <Stack gap={6}>
      <Stack gap={2} className="max-w-prose">
        <Heading level={1} variant="display-md">
          {t.account.profile}
        </Heading>
        <Text variant="body" tone="muted">
          {t.account.profileLead}
        </Text>
      </Stack>

      {!profile.emailVerified && (
        <Alert tone="warning" title={t.account.profileUnverifiedTitle}>
          {t.account.profileVerifyBody(profile.email)}
        </Alert>
      )}

      <Card>
        <CardHeader title={t.account.profileInformation} />
        <CardBody>
          <dl className="grid gap-5 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Text variant="caption" tone="subtle" as="dt">
                {t.account.fieldName}
              </Text>
              <Text variant="body" as="dd">
                {profile.name ?? t.account.profileNotGiven}
              </Text>
            </div>

            <div className="flex flex-col gap-1">
              <Text variant="caption" tone="subtle" as="dt">
                {t.account.fieldEmail}
              </Text>
              <Text variant="body" as="dd" className="break-all">
                {profile.email}
              </Text>
            </div>

            <div className="flex flex-col gap-1">
              <Text variant="caption" tone="subtle" as="dt">
                {t.account.fieldEmailConfirmed}
              </Text>
              <dd>
                <Badge variant={profile.emailVerified ? 'solid' : 'outline'}>
                  {profile.emailVerified
                    ? t.account.profileConfirmed
                    : t.account.profileToConfirm}
                </Badge>
              </dd>
            </div>

            <div className="flex flex-col gap-1">
              <Text variant="caption" tone="subtle" as="dt">
                {t.account.fieldAccountStatus}
              </Text>
              <Text variant="body" as="dd">
                {statusLabels(t)[profile.status] ?? profile.status}
              </Text>
            </div>

            <div className="flex flex-col gap-1">
              <Text variant="caption" tone="subtle" as="dt">
                {t.account.fieldCustomerSince}
              </Text>
              <Text variant="body" as="dd">
                {DATE.format(profile.createdAt)}
              </Text>
            </div>
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t.account.sessionTitle} description={t.account.sessionBody} />
        <CardBody>
          <Inline gap={3} wrap>
            <SignOutButton />
          </Inline>
        </CardBody>
      </Card>

      <Text variant="body-sm" tone="muted" className="max-w-prose">
        {t.account.changeDetailsNote}
      </Text>
    </Stack>
  );
}
