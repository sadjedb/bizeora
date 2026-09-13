import type { Metadata } from 'next';

import { brand } from '@/config/brand';
import { JsonLd } from '@/components/seo/json-ld';
import { localiseSection } from '@/domain/content';
import { organizationLd, webSiteLd } from '@/domain/seo';
import { absoluteUrl, publicPageMetadata } from '@/lib/seo';
import { loadHomepage } from '@/server/services/content-service';
import { siteSettings } from '@/server/services/settings-service';
import { dictionaryFor } from '@/i18n';

import { HomepageBand } from './home-sections';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale, t } = dictionaryFor((await params).locale);
  const tagline = t.common.brandTagline;

  // The owner's name, not the compiled one. This page sets its own absolute
  // title, so the layout's copy of the setting never reaches it.
  const { brandName } = await siteSettings();

  return {
    ...publicPageMetadata({
      title: `${brandName} — ${tagline}`,
      description: brand.description,
      path: '/',
      locale,
    }),
    // The homepage's title is the whole string, not `%s — Bizeora`.
    title: { absolute: `${brandName} — ${tagline}` },
  };
}

/**
 * The homepage.
 *
 * Its job has not changed since Phase 5 — `UX.md` section 4: *"Hero states the
 * value proposition in one sentence with two CTAs"* — but who decides what is
 * on it has. Phase 13 moves the page into `homepage_sections`: eleven band
 * types, each a row with a `position` and an `isEnabled`, so reordering the
 * front page is an `UPDATE` rather than a deploy. That is what `ROADMAP.md`
 * Phase 13 means by "all implemented and reorderable".
 *
 * What is deliberately absent is unchanged and is now enforced by the data
 * rather than by this file's restraint: **no invented statistics, no
 * testimonials from customers who have not spoken, no fabricated review
 * counts.** The reviews band renders only approved reviews and disappears
 * entirely when there are none, and the delivery figures in the trust band come
 * from `shipping_rates` — the numbers the checkout actually charges.
 *
 * One query pass for the whole page: `loadHomepage` asks for exactly what the
 * enabled bands need (`content-service`), so a switched-off band costs nothing.
 */
export const revalidate = 300;

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale, t } = dictionaryFor((await params).locale);
  const [data, { brandName }] = await Promise.all([loadHomepage(), siteSettings()]);

  return (
    <>
      {/*
       * Organization and WebSite, on the homepage only — they describe the site
       * rather than a page, and repeating them on every route tells a crawler
       * the same thing a hundred times.
       *
       * `sameAs` is the social links **this page shows**, not every row in the
       * table: if the owner has switched the social band off, telling a search
       * engine about profiles the page does not display is exactly the kind of
       * claim `domain/seo` exists to avoid. With none, the property is omitted
       * rather than emitted empty. The logo is `brand.logo.src`, which is null
       * until there is one.
       */}
      <JsonLd
        nodes={[
          organizationLd({
            name: brandName,
            legalName: brand.legalName,
            description: brand.description,
            url: absoluteUrl('/', locale),
            logo: brand.logo.src,
            sameAs: data.social.map((link) => link.url),
          }),
          webSiteLd({ name: brandName, url: absoluteUrl('/', locale) }),
        ]}
      />

      {/*
       * The bands' own copy is translated by an overlay inside each row's
       * `config` (`localiseSection`, ADR-030) — what the shop writes about
       * itself is content, and content lives in the database. What it cannot
       * translate is the catalogue those bands list: product names and gallery
       * captions are single-language rows and read in French either way.
       */}
      {data.sections.map((section) => (
        <HomepageBand
          key={section.id}
          section={localiseSection(section, locale)}
          data={data}
          t={t}
        />
      ))}
    </>
  );
}
