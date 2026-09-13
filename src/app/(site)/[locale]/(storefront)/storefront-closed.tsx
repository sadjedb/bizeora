import { Heading, Text } from '@/components/ui/typography';
import { Stack } from '@/components/layout/layout';
import { brand } from '@/config/brand';
import type { Locale } from '@/i18n/locales';

/**
 * What a visitor sees while the shop is closed.
 *
 * `site.storefrontEnabled` is off, so there is no catalogue, no cart and no
 * builder — and this page is deliberately none of those things either. No
 * navigation, no footer links, nothing to click: a closed shop that still
 * offers a route into itself is a closed shop with broken doors.
 *
 * It says **who** is closed and, when there is one, how to reach them. A
 * WhatsApp number is the most useful thing a small Algerian business can leave
 * on a door, which is why `contact.whatsapp` is surfaced here and nowhere else
 * in this state.
 *
 * Deliberately not a 503. The shop is closed on purpose and expects to reopen;
 * telling a crawler the server is broken invites it to retry and, eventually,
 * to drop the pages. The site is not indexable before launch anyway (ADR-028),
 * and once it is, a temporary curtain should not cost the rankings behind it.
 */

export function StorefrontClosed({
  locale,
  brandName,
  whatsapp,
}: {
  locale: Locale;
  /** The name from settings, so the curtain agrees with the sign. */
  brandName: string;
  whatsapp: string | null;
}) {
  const copy =
    locale === 'en'
      ? {
          title: 'We will be back very soon.',
          body: `${brandName} is closed for the moment. Our embroidery is still being made — the shop is simply not taking orders today.`,
          reach: 'Reach us on WhatsApp:',
        }
      : {
          title: 'Nous revenons très bientôt.',
          body: `${brandName} est fermé pour le moment. L’atelier brode toujours — la boutique ne prend simplement pas de commandes aujourd’hui.`,
          reach: 'Écrivez-nous sur WhatsApp :',
        };

  return (
    <main
      id="main"
      className="flex min-h-dvh items-center justify-center px-6 py-16 text-center"
    >
      <Stack gap={4} className="max-w-prose">
        <Text variant="overline" tone="subtle" as="p">
          {brandName}
        </Text>

        <Heading level={1} variant="display-md">
          {copy.title}
        </Heading>

        <Text variant="body-lg" tone="muted">
          {copy.body}
        </Text>

        {whatsapp && (
          <Text variant="body" tone="muted">
            {copy.reach}{' '}
            <a
              className="text-accent underline underline-offset-4"
              href={whatsappHref(whatsapp)}
            >
              {whatsapp}
            </a>
          </Text>
        )}

        <Text variant="caption" tone="subtle">
          {brand.tagline}
        </Text>
      </Stack>
    </main>
  );
}

/**
 * A `wa.me` link from however the owner typed the number.
 *
 * Spaces, dots and dashes are how a person writes a phone number and none of
 * them belong in the URL. A local `0…` number is given Algeria's country code,
 * because that is the only country this shop delivers to.
 */
function whatsappHref(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, '');
  const international = digits.startsWith('+')
    ? digits.slice(1)
    : digits.startsWith('0')
      ? `213${digits.slice(1)}`
      : digits;

  return `https://wa.me/${international}`;
}
