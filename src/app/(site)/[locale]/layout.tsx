import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { Fraunces, Instrument_Sans, JetBrains_Mono } from 'next/font/google';

import { brand } from '@/config/brand';
import { clientEnv } from '@/lib/env';
import { publicRobots } from '@/lib/seo';
import { ThemeScript } from '@/components/ui/theme';
import { LOCALES, LOCALE_TAGS, OG_LOCALES, isLocale, type Locale } from '@/i18n/locales';

import { siteSettings } from '@/server/services/settings-service';

import '@/styles/globals.css';

/*
 * Fonts. next/font downloads and self-hosts these at build time, so there is
 * no request to a third-party origin at runtime and no layout shift.
 * Families and roles: docs/DESIGN-SYSTEM.md section 3.
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
/** The three font variables, as one string. */
const fontVariables = `${fraunces.variable} ${instrumentSans.variable} ${jetBrainsMono.variable}`;

/**
 * Both locales are known at build time, so both trees prerender.
 *
 * Without this every storefront page becomes dynamic: `[locale]` is a segment
 * Next cannot enumerate on its own, and the ISR the shop and the homepage rely
 * on (`revalidate = 300`) would quietly stop applying.
 */
export function generateStaticParams(): { locale: Locale }[] {
  return LOCALES.map((locale) => ({ locale }));
}

/**
 * The site-wide defaults, per language.
 *
 * A function rather than a constant, because `openGraph.locale` and the brand
 * strapline are both language-dependent and a module-level object cannot see
 * the route's params. Every page below overrides the title and the canonical;
 * what this supplies is the fallback and the fuse.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : 'fr';
  const site = clientEnv.NEXT_PUBLIC_SITE_URL;

  /*
   * The name the owner set, not the one that was compiled in.
   *
   * `config/brand.ts` has always said this value would be "read from settings
   * at runtime once Phase 12 exists"; the settings screen is that. The constant
   * stays as the fallback for a database with no row, so an unseeded install
   * still has a title rather than a dash.
   */
  const { brandName } = await siteSettings();

  return {
    metadataBase: new URL(site),
    title: {
      default: `${brandName} — ${brand.tagline}`,
      template: `%s — ${brandName}`,
    },
    description: brand.description,
    applicationName: brandName,
    openGraph: {
      type: 'website',
      siteName: brandName,
      locale: OG_LOCALES[locale],
      alternateLocale: LOCALES.filter((other) => other !== locale).map(
        (other) => OG_LOCALES[other],
      ),
      title: `${brand.name} — ${brand.tagline}`,
      description: brand.description,
      url: `${site}/${locale}`,
    },
    twitter: {
      card: 'summary_large_image',
      title: `${brand.name} — ${brand.tagline}`,
      description: brand.description,
    },
    /**
     * The site-wide default, and the fuse.
     *
     * `publicRobots` is `noindex, nofollow` unless `SEO_INDEXABLE` is set,
     * which `ROADMAP.md` opens at launch (Phase 18). Every public page sets its
     * own directive through the same function, so a deployment cannot be half
     * indexable; a private page overrides this with `noindex` regardless of the
     * switch, which is the direction that must never depend on configuration.
     */
    robots: publicRobots(),
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  /*
   * The page ground, as literals — one per theme.
   *
   * This is the one place a colour may be written outside `tokens.css`: the
   * browser paints its chrome from this value before any stylesheet has loaded,
   * so it cannot be a custom property or a `light-dark()` call. Both must be
   * kept equal to `--color-bg` in the matching theme.
   *
   * Two entries rather than one, because a dark-mode phone with a bone-coloured
   * status bar above a near-black page is the most visible way to get this
   * wrong. Phase 14.5 already shipped one stale value here; the comment is the
   * reminder that this file does not follow the tokens automatically.
   */
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#faf9f6' },
    { media: '(prefers-color-scheme: dark)', color: '#100f0e' },
  ],
};

/**
 * The storefront's root layout — one per locale.
 *
 * This is a **root** layout: it renders `<html>` and `<body>`, and there is no
 * `app/layout.tsx` above it. The admin has its own, under `(workshop)`, which
 * is what lets `/admin` keep its URL while every public page gains a language
 * prefix. Next supports exactly this through route groups.
 *
 * `lang` is the whole reason the routing has a prefix at all. A screen reader
 * picks its voice from it, a browser offers to translate from it, and a search
 * engine indexes from it — none of which works if the language lives in a
 * cookie and every page claims to be French.
 */
export default async function LocaleRootLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale: raw } = await params;

  // A path like `/de/shop` matches the segment but is not a language we speak.
  if (!isLocale(raw)) notFound();
  const locale: Locale = raw;

  return (
    <html
      lang={LOCALE_TAGS[locale]}
      className={fontVariables}
      // The stored theme is applied by `ThemeScript` before paint, so the
      // attribute this adds is expected to differ from the server's output.
      suppressHydrationWarning
    >
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-dvh antialiased">
        <a href="#main" className="skip-link">
          {locale === 'en' ? 'Skip to main content' : 'Aller au contenu principal'}
        </a>
        <div className="flex min-h-dvh flex-col">{children}</div>
      </body>
    </html>
  );
}
