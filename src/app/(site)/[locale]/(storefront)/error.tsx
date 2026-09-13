'use client';

import { useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { Link } from '@/components/ui/link';
import { Heading, Overline, Text } from '@/components/ui/typography';
import { Container, Inline, Section, Stack } from '@/components/layout/layout';
import { useDictionary } from '@/i18n/client';

/**
 * The storefront's error boundary.
 *
 * Catches a failure in any storefront route — most plausibly the catalogue
 * queries, which are the first thing on the storefront that can fail for
 * reasons outside the code. It renders inside the layout, so the visitor keeps
 * the header and footer and can go somewhere else.
 *
 * **It shows no error text.** `SECURITY.md` section 10 keeps internal detail
 * away from customers, and a database message is exactly the kind of thing that
 * names a table, a column or a host. `error.digest` is the identifier that ties
 * this screen to the server log, which is where the detail belongs.
 */
export default function StorefrontError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useDictionary();

  useEffect(() => {
    // Server-side failures are already logged where they happened; this covers
    // the client half. Replaced by the Sentry hook in Phase 15.
    console.error('Storefront error', error.digest ?? error.message);
  }, [error]);

  return (
    <Section as="section" spacing="editorial">
      <Container width="narrow">
        <Stack gap={5}>
          <Overline as="p">{t.errors.errorEyebrow}</Overline>

          <Heading level={1} variant="display-md">
            {t.errors.couldNotLoadTitle}
          </Heading>

          <Text variant="body" tone="muted">
            {t.errors.couldNotLoadBody}
          </Text>

          <Inline gap={3} className="pt-2">
            <Button size="lg" onClick={reset}>
              {t.errors.retry}
            </Button>
            <Button asChild variant="secondary" size="lg">
              <Link href="/" variant="plain">
                {t.errors.goHome}
              </Link>
            </Button>
          </Inline>

          {error.digest && (
            <Text variant="mono-sm" tone="subtle">
              {t.errors.reference}&nbsp;: {error.digest}
            </Text>
          )}
        </Stack>
      </Container>
    </Section>
  );
}
