'use client';

import { Button } from '@/components/ui/button';
import { Link } from '@/components/ui/link';
import { Heading, Overline, Text } from '@/components/ui/typography';
import { Container, Inline, Section, Stack } from '@/components/layout/layout';
import { useDictionary } from '@/i18n/client';

/**
 * The storefront's 404.
 *
 * Distinct from the root `not-found.tsx` because this one renders inside the
 * storefront layout, so a visitor who mistypes a product slug keeps the header
 * and footer and can carry on browsing. It provides no `<main>` of its own —
 * the layout already does, and two would mean two `id="main"` targets for the
 * skip link.
 */
export default function StorefrontNotFound() {
  const { t } = useDictionary();

  return (
    <Section as="section" spacing="editorial">
      <Container width="narrow">
        <Stack gap={5}>
          <Overline as="p">{t.errors.notFoundEyebrow}</Overline>

          <Heading level={1} variant="display-md">
            {t.errors.notFoundTitle}
          </Heading>

          <Text variant="body" tone="muted">
            {t.errors.storefrontNotFoundBody}
          </Text>

          <Inline gap={3} className="pt-2">
            <Button asChild size="lg">
              <Link href="/shop" variant="plain">
                {t.cart.seeShop}
              </Link>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <Link href="/" variant="plain">
                {t.errors.goHome}
              </Link>
            </Button>
          </Inline>
        </Stack>
      </Container>
    </Section>
  );
}
