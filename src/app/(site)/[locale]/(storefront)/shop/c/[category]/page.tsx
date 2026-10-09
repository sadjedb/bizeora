import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { Heading, Overline, Text } from '@/components/ui/typography';
import { Link } from '@/components/ui/link';
import { Stack } from '@/components/layout/layout';
import { JsonLd } from '@/components/seo/json-ld';
import { breadcrumbLd, itemListLd } from '@/domain/seo';
import { absoluteUrl, notFoundMetadata, publicPageMetadata } from '@/lib/seo';
import { dictionaryFor } from '@/i18n';
import { isDefaultCatalogueView, parseCatalogueQuery } from '@/domain/catalogue/browse';
import {
  getCatalogueCategoryBySlug,
  listCatalogue,
  listCatalogueCategories,
} from '@/server/repositories/catalogue-repository';

import { CatalogueView } from '../../catalogue-view';

type PageProps = {
  params: Promise<{ locale: string; category: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Why `/shop/c/<slug>` and not `/shop/<slug>`.
 *
 * `UX.md` section 2 settled this before either route existed: a product reads
 * better at `/shop/t-shirt-brode` than at `/shop/t-shirts/t-shirt-brode`, and
 * two dynamic segments cannot share `/shop/*` — Next would not know whether
 * `/shop/polos` is a product or a category. The `c` segment is the smallest
 * thing that tells them apart, and it keeps the products at the shorter URL,
 * which is the one customers are given.
 *
 * Unlike a filtered view of `/shop`, a category **is** its own page: a distinct
 * set of products, its own heading and description, its own canonical. It is
 * meant to be indexed.
 */
export async function generateMetadata({
  params,
  searchParams,
}: PageProps): Promise<Metadata> {
  const { locale: raw, category: slug } = await params;
  const { locale, t } = dictionaryFor(raw);

  const category = await getCatalogueCategoryBySlug(slug, locale);
  if (!category) return notFoundMetadata(t.shop.categoryNotFound);

  const query = parseCatalogueQuery(await searchParams);

  return publicPageMetadata({
    title: category.seoTitle ?? t.shop.categoryMetaTitle(category.name),
    description: category.seoDescription ?? category.description ?? t.shop.lead,
    path: `/shop/c/${category.slug}`,
    locale,
    // A narrowed category still canonicalises to the category, exactly as a
    // narrowed catalogue canonicalises to the catalogue.
    noindex: !isDefaultCatalogueView(query),
  });
}

/**
 * One category of the catalogue.
 *
 * The same view as `/shop` with the same toolbar, scoped by a clause in the
 * query rather than by anything this page does to the results. An unknown,
 * inactive or deleted slug is a **404**, not an empty listing: a heading over
 * no products, at an address that used to work, is the kind of page that gets
 * indexed and then wastes somebody's click.
 */
export default async function CategoryPage({ params, searchParams }: PageProps) {
  const { locale: raw, category: slug } = await params;
  const { locale, t } = dictionaryFor(raw);
  const query = parseCatalogueQuery(await searchParams);

  const category = await getCatalogueCategoryBySlug(slug, locale);
  if (!category) notFound();

  const [listing, categories] = await Promise.all([
    listCatalogue({ query, categoryId: category.id, locale }),
    listCatalogueCategories(locale),
  ]);

  const base = `/shop/c/${category.slug}`;

  return (
    <>
      <JsonLd
        nodes={[
          breadcrumbLd([
            { name: t.nav.home, url: absoluteUrl('/', locale) },
            { name: t.shop.eyebrow, url: absoluteUrl('/shop', locale) },
            { name: category.name, url: absoluteUrl(base, locale) },
          ]),
          itemListLd({
            name: category.name,
            items: listing.items.map((product) => ({
              name: product.name,
              url: absoluteUrl(`/shop/${product.slug}`, locale),
            })),
          }),
        ]}
      />

      <CatalogueView
        locale={locale}
        base={base}
        query={query}
        listing={listing}
        categories={categories}
        activeCategory={category.slug}
        header={
          <header className="border-border flex flex-col gap-6 border-b pb-8">
            <Stack gap={4} className="max-w-prose">
              <Overline as="p">{t.shop.categoryEyebrow}</Overline>
              <Heading level={1} variant="display-xl">
                {category.name}
              </Heading>

              {/*
               * The category's own words when it has them, and the shop's
               * standfirst when it does not — rather than a sentence generated
               * from the name, which reads like a placeholder because it is
               * one.
               */}
              <Text variant="body-lg" tone="muted">
                {category.description ?? t.shop.lead}
              </Text>

              <Text variant="body-sm" tone="subtle">
                <Link href="/shop" variant="inline">
                  {t.shop.backToShop}
                </Link>
              </Text>
            </Stack>
          </header>
        }
      />
    </>
  );
}
