import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { Container, Section, Stack } from '@/components/layout/layout';
import { Heading, Text } from '@/components/ui/typography';
import { Link } from '@/components/ui/link';
import { getCurrentActor } from '@/lib/auth';
import { isActive } from '@/domain/auth/actor';
import { dictionaryFor } from '@/i18n';

import { CredentialsForm } from '@/components/auth/credentials-form';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { t } = dictionaryFor((await params).locale);

  return {
    title: t.auth.signInTitle,
    description: t.auth.signInDescription,
    robots: { index: false, follow: false },
  };
}

export const dynamic = 'force-dynamic';

/**
 * Sign in.
 *
 * Exists because a quote can only be accepted by the customer it was addressed
 * to (7.5). Shopping stays guest-first — nothing else on the storefront asks
 * for an account.
 */
export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { t } = dictionaryFor((await params).locale);
  const actor = await getCurrentActor();
  const { next } = await searchParams;

  if (isActive(actor)) redirect(next ?? '/account');

  const query = next ? `?next=${encodeURIComponent(next)}` : '';

  return (
    <Section spacing="compact" className="pb-20">
      <Container width="narrow">
        <Stack gap={8}>
          <Stack gap={2}>
            <Heading level={1} variant="display-md">
              {t.auth.signInTitle}
            </Heading>
            <Text variant="body" tone="muted">
              {t.auth.signInLead}
            </Text>
          </Stack>

          <CredentialsForm mode="sign-in" redirectTo={next ?? null} />

          <Text variant="body-sm" tone="muted">
            {t.auth.noAccount}{' '}
            <Link href={`/register${query}`}>{t.auth.createAccount}</Link>
          </Text>
        </Stack>
      </Container>
    </Section>
  );
}
