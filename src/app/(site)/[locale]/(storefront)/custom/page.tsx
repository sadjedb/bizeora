import type { Metadata } from 'next';

import { Alert } from '@/components/ui/feedback';
import { Heading, Overline, Text } from '@/components/ui/typography';
import { Container, Section, Stack } from '@/components/layout/layout';
import {
  listCustomizableProducts,
  loadBuilderReferenceData,
} from '@/server/repositories/customization-repository';

import { publicPageMetadata } from '@/lib/seo';
import { dictionaryFor } from '@/i18n';

import { Builder } from './builder';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale, t } = dictionaryFor((await params).locale);

  return publicPageMetadata({
    title: t.custom.metaTitle,
    description: t.custom.metaDescription,
    path: '/custom',
    locale,
  });
}

/**
 * The custom embroidery builder.
 *
 * `UX.md` section 2 puts the entry point at `/custom`; section 5 describes five
 * steps. The whole flow is one route rather than `/custom/[step]`, because the
 * step is transient UI state and a URL per step would invite a customer to
 * bookmark or share a half-built configuration that nothing persists.
 *
 * A server component: it loads the blanks and the reference data once, on the
 * server, and hands them to the client builder as plain props. The browser
 * never queries the catalogue, and the reference lists are not refetched as the
 * customer moves between steps.
 *
 * Prices are **not** computed here. The running estimate is a server action, so
 * that `BUSINESS-RULES.md` 2.3.2 holds: the mode and the number are decided
 * server-side from rows the client cannot edit.
 */
export const revalidate = 300;

export default async function CustomPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { t } = dictionaryFor((await params).locale);
  const [products, reference] = await Promise.all([
    listCustomizableProducts(),
    loadBuilderReferenceData(null),
  ]);

  const ready =
    products.length > 0 &&
    reference.placements.length > 0 &&
    reference.embroiderySizes.length > 0 &&
    reference.threadColors.length > 0;

  return (
    <Section as="section" spacing="compact" className="pb-20 lg:pb-32">
      <Container width={ready ? 'content' : 'narrow'}>
        <Stack gap={10}>
          <Stack gap={4} className="max-w-prose">
            <Overline as="p">{t.custom.eyebrow}</Overline>
            <Heading level={1} variant="display-lg">
              {t.custom.heading}
            </Heading>
            <Text variant="body-lg" tone="muted">
              {t.custom.lead}
            </Text>
          </Stack>

          {ready ? (
            <Builder products={products} reference={reference} />
          ) : (
            // The reference data is seeded, so this is a misconfiguration
            // rather than a normal state — but it renders as a designed screen
            // instead of an empty stepper.
            <Alert tone="warning" title={t.custom.unavailableTitle}>
              {t.custom.unavailableBody}
            </Alert>
          )}
        </Stack>
      </Container>
    </Section>
  );
}
