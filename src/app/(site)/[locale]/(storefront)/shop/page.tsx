import type { Metadata } from 'next';

import { EmptyState } from '@/components/ui/feedback';
import { Heading, Overline, Text } from '@/components/ui/typography';
import { Container, Grid, Section, Stack } from '@/components/layout/layout';
import { ProductCard } from '@/components/commerce/product-card';
import { listPublishedProducts } from '@/server/repositories/catalogue-repository';
import { JsonLd } from '@/components/seo/json-ld';
import { breadcrumbLd, itemListLd } from '@/domain/seo';
import { absoluteUrl, publicPageMetadata } from '@/lib/seo';
import { dictionaryFor } from '@/i18n';

import { toCardProduct } from '../product-card-props';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale, t } = dictionaryFor((await params).locale);

  return publicPageMetadata({
    title: t.shop.metaTitle,
    description: t.shop.metaDescription,
    path: '/shop',
    locale,
  });
}

/** See the note on the product route: ISR, five minutes, no build-time DB. */
export const revalidate = 300;

/**
 * The catalogue, from the database.
 *
 * Only published products reach this page — the predicate is in the query, so
 * drafts and archived products are never fetched rather than fetched and
 * filtered.
 *
 * `UX.md` section 4 specifies category chips, a default sort and a visible
 * filter count here. They are still absent, deliberately: a filter that does
 * not filter is worse than no filter. They arrive with the query parameters and
 * the admin that make them meaningful.
 */
export default async function ShopPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale, t } = dictionaryFor((await params).locale);
  const products = await listPublishedProducts();

  return (
    <Section as="section" spacing="compact" className="pb-20 lg:pb-32">
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
            items: products.map((product) => ({
              name: product.name,
              url: absoluteUrl(`/shop/${product.slug}`, locale),
            })),
          }),
        ]}
      />

      <Container>
        <Stack gap={10}>
          {/*
           * An editorial masthead rather than a page title.
           *
           * The heading, the standfirst and the count sit above one rule that
           * runs the full width of the grid beneath it, so the catalogue reads
           * as a spread with a header rather than as a list with a label.
           */}
          <header className="border-border flex flex-col gap-6 border-b pb-8 md:flex-row md:items-end md:justify-between md:gap-16">
            <Stack gap={4} className="max-w-prose">
              <Overline as="p">{t.shop.eyebrow}</Overline>
              <Heading level={1} variant="display-xl">
                {t.shop.title}
              </Heading>
              <Text variant="body-lg" tone="muted">
                {t.shop.lead}
              </Text>
            </Stack>

            {products.length > 0 && (
              <Text variant="body-sm" tone="subtle" numeric className="shrink-0">
                {t.shop.count(products.length)}
              </Text>
            )}
          </header>

          {products.length === 0 ? (
            // A real empty catalogue renders as one. Inventing products to fill
            // the grid would hide exactly the problem worth seeing.
            <EmptyState title={t.shop.emptyTitle} description={t.shop.emptyBody} />
          ) : (
            <Stack gap={6}>
              <Grid preset="products" gap={6}>
                {products.map((product, index) => (
                  <ProductCard
                    key={product.slug}
                    // The first row is above the fold at every breakpoint.
                    priority={index < 4}
                    product={toCardProduct(product, t)}
                  />
                ))}
              </Grid>
            </Stack>
          )}
        </Stack>
      </Container>
    </Section>
  );
}
