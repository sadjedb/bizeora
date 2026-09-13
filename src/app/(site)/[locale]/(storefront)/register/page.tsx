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
    title: t.auth.signUpTitle,
    description: t.auth.signUpDescription,
    robots: { index: false, follow: false },
  };
}

export const dynamic = 'force-dynamic';

/**
 * Register.
 *
 * The address used here is what binds a custom request to an account: a request
 * submitted as a guest is claimed by the account whose e-mail it names, which
 * is how a quote reaches somebody who never signed in to ask for one.
 */
export default async function RegisterPage({
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
              {t.auth.signUpTitle}
            </Heading>
            <Text variant="body" tone="muted">
              {t.auth.signUpLead}
            </Text>
          </Stack>

          <CredentialsForm mode="register" redirectTo={next ?? null} />

          <Text variant="body-sm" tone="muted">
            {t.auth.hasAccount} <Link href={`/login${query}`}>{t.auth.signIn}</Link>
          </Text>
        </Stack>
      </Container>
    </Section>
  );
}
