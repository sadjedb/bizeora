import type { Metadata, Viewport } from 'next';
import { Fraunces, Instrument_Sans, JetBrains_Mono } from 'next/font/google';

import { ThemeScript } from '@/components/ui/theme';
import { scriptNonce } from '@/lib/security/nonce';
import { ToastProvider } from '@/components/ui/toast';
import { DictionaryProvider } from '@/i18n/client';
import { LOCALE_TAGS } from '@/i18n/locales';
import { workshopDictionary } from '@/i18n/server';

import '@/styles/globals.css';

/*
 * Fonts. Declared again rather than shared, because `next/font` attaches its
 * CSS variables to the element it is applied to and each root layout has its
 * own `<html>`. The two calls resolve to the same self-hosted files.
 */

const fraunces = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-fraunces',
});

const instrumentSans = Instrument_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-instrument-sans',
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains-mono',
});

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await workshopDictionary();

  return {
    title: { default: t.admin.workshop, template: `%s · ${t.admin.workshop}` },
    robots: { index: false, follow: false, nocache: true },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#faf9f6' },
    { media: '(prefers-color-scheme: dark)', color: '#100f0e' },
  ],
};

/**
 * The workshop's root layout.
 *
 * A second root layout, beside the storefront's. That is what lets the public
 * site carry a language prefix — `/fr/shop`, `/en/shop` — while `/admin` keeps
 * the URL it has always had.
 *
 * **It speaks both languages, without a prefix.** Phase 14.7 left the workshop
 * French on the grounds that it had one reader; Phase 14.8 translated it
 * because the owner asked. The language is a preference in the `NEXT_LOCALE`
 * cookie rather than a segment in the address — `/admin/orders` is bookmarked,
 * unindexed and behind a session, so a prefix would cost every bookmark and buy
 * nothing (`i18n/server`).
 *
 * The cookie is read here, once, and travels two ways: into `<html lang>`,
 * which is what a screen reader switches voice on, and into a provider that
 * every client component below reads through `useDictionary`.
 *
 * **Toasts are provided here too**, from Phase 14.9. The primitive had existed
 * since the design system and had no provider outside its own showcase, so the
 * first screen to reach for `useToast` threw at render. The workshop is where
 * it belongs: a bulk action reports a count — "4 éléments archivés" — and a
 * count is exactly what section 8 means by a toast that confirms rather than
 * informs.
 */
export default async function WorkshopRootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [{ locale, t }, nonce] = await Promise.all([workshopDictionary(), scriptNonce()]);

  return (
    <html
      lang={LOCALE_TAGS[locale]}
      className={`${fraunces.variable} ${instrumentSans.variable} ${jetBrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <ThemeScript nonce={nonce} />
      </head>
      <body className="min-h-dvh antialiased">
        <a href="#main" className="skip-link">
          {t.a11y.skipToContent}
        </a>
        <DictionaryProvider locale={locale}>
          <ToastProvider>
            <div className="flex min-h-dvh flex-col">{children}</div>
          </ToastProvider>
        </DictionaryProvider>
      </body>
    </html>
  );
}
