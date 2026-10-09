import type { Metadata } from 'next';

import { Heading, Overline, Text } from '@/components/ui/typography';
import { Stack } from '@/components/layout/layout';
import { JsonLd } from '@/components/seo/json-ld';
import { breadcrumbLd, itemListLd } from '@/domain/seo';
import { absoluteUrl, publicPageMetadata } from '@/lib/seo';
import { dictionaryFor } from '@/i18n';
import { isDefaultCatalogueView, parseCatalogueQuery } from '@/domain/catalogue/browse';
import {
  listCatalogue,
  listCatalogueCategories,
} from '@/server/repositories/catalogue-repository';

import { CatalogueView } from './catalogue-view';

type PageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * One indexable catalogue, however it is narrowed.
 *
 * The same rule Phase 14 set for the gallery: a search, an order or a page is a
 * *view* of the catalogue rather than a page of its own, so every one of them
 * canonicalises to `/shop` and carries `noindex, follow` — a crawler is welcome
 * to walk through them to reach the products, and should index the listing
 * once. `isDefaultCatalogueView` is the predicate, and the argument for
 * including the page number in it is written there.
 */
export async function generateMetadata({
  params,
  searchParams,
}: PageProps): Promise<Metadata> {
  const { locale, t } = dictionaryFor((await params).locale);
  const query = parseCatalogueQuery(await searchParams);

  return publicPageMetadata({
    title: t.shop.metaTitle,
    description: t.shop.metaDescription,
    path: '/shop',
    locale,
    noindex: !isDefaultCatalogueView(query),
  });
}

/**
 * The catalogue, from the database.
 *
 * Only published products reach this page — the predicate is in the query, so
 * drafts and archived products are never fetched rather than fetched and
 * filtered.
 *
 * **No longer ISR.** It reads `searchParams`, so it renders per request: a page
 * whose content depends on the address cannot be one cached copy. What it costs
 * is three indexed reads — the page, its total, and the unfiltered total — and
 * what it buys is a catalogue somebody can actually search. `/` and `/custom`
 * keep their five-minute cache; see ADR-038 for what that means for the
 * storefront switch.
 */
export default async function ShopPage({ params, searchParams }: PageProps) {
  const { locale, t } = dictionaryFor((await params).locale);
  const query = parseCatalogueQuery(await searchParams);

  const [listing, categories] = await Promise.all([
    listCatalogue({ query, locale }),
    listCatalogueCategories(locale),
  ]);

  return (
    <>
      {/*
       * An ItemList of the products actually listed, in the order they are
       * shown — links, not copies of each product's data, so nothing here can
       * disagree with a detail page.
       */}
      <JsonLd
        nodes={[
          breadcrumbLd([
            { name: t.nav.home, url: absoluteUrl('/', locale) },
            { name: t.shop.eyebrow, url: absoluteUrl('/shop', locale) },
          ]),
          itemListLd({
            name: t.shop.eyebrow,
            items: listing.items.map((product) => ({
              name: product.name,
              url: absoluteUrl(`/shop/${product.slug}`, locale),
            })),
          }),
        ]}
      />

      <CatalogueView
        locale={locale}
        base="/shop"
        query={query}
        listing={listing}
        categories={categories}
        activeCategory={null}
        header={
          /*
           * An editorial masthead rather than a page title.
           *
           * The heading and the standfirst sit above the rule that runs the
           * full width of the grid beneath, so the catalogue reads as a spread
           * with a header rather than as a list with a label. The count moved
           * down beside the filters, where it answers "how many of these am I
           * looking at" rather than decorating the title.
           */
          <header className="border-border flex flex-col gap-6 border-b pb-8">
            <Stack gap={4} className="max-w-prose">
              <Overline as="p">{t.shop.eyebrow}</Overline>
              <Heading level={1} variant="display-xl">
                {t.shop.title}
              </Heading>
              <Text variant="body-lg" tone="muted">
                {t.shop.lead}
              </Text>
            </Stack>
          </header>
        }
      />
    </>
  );
}
