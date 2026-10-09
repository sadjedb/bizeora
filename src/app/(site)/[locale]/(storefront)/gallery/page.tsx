import type { Metadata } from 'next';

import { EmptyState } from '@/components/ui/feedback';
import { Heading, Overline, Text } from '@/components/ui/typography';
import { Container, Grid, Section, Stack } from '@/components/layout/layout';
import { Link } from '@/components/ui/link';
import { ProductImage } from '@/components/media/product-image';
import { cn } from '@/components/ui/cn';
import {
  hasActiveGalleryFilters,
  parseGalleryFilters,
  toggleGalleryFilter,
  type GalleryFilters,
} from '@/domain/gallery';
import {
  listGalleryFacets,
  listGalleryItems,
} from '@/server/repositories/gallery-repository';
import { JsonLd } from '@/components/seo/json-ld';
import { breadcrumbLd, itemListLd } from '@/domain/seo';
import { absoluteUrl, publicPageMetadata } from '@/lib/seo';
import { dictionaryFor } from '@/i18n';

/**
 * One indexable listing, however it is filtered.
 *
 * `ROADMAP.md` Phase 14: "parameterised filter pages canonicalised to the base
 * listing". A filtered view is the same set of work seen through a facet, not a
 * page of its own, so every combination canonicalises to `/gallery` and the
 * filtered ones carry `noindex, follow` — a crawler is welcome to walk them to
 * reach the detail pages, and should index the listing once.
 */
export async function generateMetadata({
  params: routeParams,
  searchParams,
}: PageProps): Promise<Metadata> {
  const { locale, t } = dictionaryFor((await routeParams).locale);
  const params = await searchParams;
  const filters = parseGalleryFilters({
    productType: params.productType,
    embroideryType: params.embroideryType,
  });

  return publicPageMetadata({
    title: t.gallery.metaTitle,
    description: t.gallery.metaDescription,
    path: '/gallery',
    locale,
    noindex: hasActiveGalleryFilters(filters),
  });
}

/**
 * "Our Work" — the gallery.
 *
 * Published items only, and that clause lives in the query
 * (`gallery-repository`). An unpublished item is frequently a piece of customer
 * work whose consent has not been recorded (13.6), so this page is not a place
 * to fetch first and filter afterwards.
 *
 * Filtering is done with **links, not JavaScript**: each facet value is an
 * anchor to the same page with a different query string, so the filtered view
 * is shareable, survives the back button, works with scripts off, and needs no
 * client component. `UX.md` section 12 asks for exactly this on mobile.
 *
 * Not ISR: the page reads `searchParams`, so it renders per request. The
 * queries behind it are two indexed reads.
 */

type PageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function FacetGroup({
  legend,
  facet,
  values,
  filters,
}: {
  legend: string;
  facet: keyof GalleryFilters;
  values: readonly string[];
  filters: GalleryFilters;
}) {
  if (values.length === 0) return null;

  return (
    <Stack gap={3}>
      <Text as="h2" variant="body-sm" tone="subtle">
        {legend}
      </Text>

      <ul className="flex list-none flex-wrap gap-2 p-0">
        {values.map((value) => {
          const active = filters[facet] === value;

          return (
            <li key={value}>
              <Link
                href={toggleGalleryFilter(filters, facet, value)}
                variant="plain"
                // A link, not a toggle button: `aria-pressed` is not allowed on
                // a link's role, and `aria-current` is the attribute that says
                // "this is the one in effect" for a set of navigation choices.
                aria-current={active ? 'true' : undefined}
                className={cn(
                  'text-body-sm inline-flex min-h-11 items-center rounded-sm border px-3',
                  'duration-fast transition-colors ease-out motion-reduce:transition-none',
                  active
                    ? 'border-fg bg-fg text-fg-inverted font-medium'
                    : 'border-border text-fg-muted hover:border-border-strong hover:text-fg',
                )}
              >
                {value}
              </Link>
            </li>
          );
        })}
      </ul>
    </Stack>
  );
}

export default async function GalleryPage({
  params: routeParams,
  searchParams,
}: PageProps) {
  const { locale, t } = dictionaryFor((await routeParams).locale);
  const params = await searchParams;
  const filters = parseGalleryFilters({
    productType: params.productType,
    embroideryType: params.embroideryType,
  });

  const [items, facets] = await Promise.all([
    listGalleryItems({ filters, locale }),
    listGalleryFacets(),
  ]);

  const filtered = hasActiveGalleryFilters(filters);

  return (
    <Section as="section" spacing="compact" className="pb-20 lg:pb-32">
      {/* The pieces this view actually lists, in the order it lists them. */}
      <JsonLd
        nodes={[
          breadcrumbLd([
            { name: t.nav.home, url: absoluteUrl('/', locale) },
            { name: t.gallery.metaTitle, url: absoluteUrl('/gallery', locale) },
          ]),
          itemListLd({
            name: t.gallery.metaTitle,
            items: items.map((item) => ({
              name: item.title,
              url: absoluteUrl(`/gallery/${item.slug}`, locale),
            })),
          }),
        ]}
      />

      <Container>
        <Stack gap={10}>
          <Stack gap={4} className="max-w-prose">
            <Overline as="p">{t.gallery.eyebrow}</Overline>
            <Heading level={1} variant="display-lg">
              {t.gallery.heading}
            </Heading>
            <Text variant="body-lg" tone="muted">
              {t.gallery.lead}
            </Text>
          </Stack>

          {(facets.productTypes.length > 0 || facets.embroideryTypes.length > 0) && (
            <nav aria-label={t.gallery.filterLabel}>
              <Stack gap={6}>
                <FacetGroup
                  legend={t.gallery.facetProductType}
                  facet="productType"
                  values={facets.productTypes}
                  filters={filters}
                />
                <FacetGroup
                  legend={t.gallery.facetEmbroideryType}
                  facet="embroideryType"
                  values={facets.embroideryTypes}
                  filters={filters}
                />

                {filtered && (
                  <Link
                    href="/gallery"
                    variant="subtle"
                    className="text-body-sm self-start"
                  >
                    {t.gallery.resetFilters}
                  </Link>
                )}
              </Stack>
            </nav>
          )}

          {items.length === 0 ? (
            <EmptyState
              title={filtered ? t.gallery.emptyFilteredTitle : t.gallery.emptyTitle}
              description={
                filtered ? t.gallery.emptyFilteredBody : t.gallery.emptyBodyUnfiltered
              }
              action={
                <Link href={filtered ? '/gallery' : '/shop'} variant="subtle">
                  {filtered ? t.gallery.seeAll : t.cart.seeShop}
                </Link>
              }
            />
          ) : (
            <Stack gap={6}>
              <Text variant="body-sm" tone="subtle" numeric>
                {t.gallery.count(items.length)}
              </Text>

              <Grid preset="products">
                {items.map((item) => (
                  <Link
                    key={item.slug}
                    href={`/gallery/${item.slug}`}
                    variant="plain"
                    className="group focus-visible:outline-focus flex flex-col gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4"
                  >
                    <ProductImage
                      src={item.thumbnail}
                      alt={item.alt}
                      ratio="square"
                      zoomOnHover
                      sizes="(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw"
                    />
                    <Stack gap={1}>
                      <Heading level={2} variant="heading-md">
                        {item.title}
                      </Heading>
                      <Text variant="body-sm" tone="subtle">
                        {[item.productType, item.embroideryType]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    </Stack>
                  </Link>
                ))}
              </Grid>
            </Stack>
          )}
        </Stack>
      </Container>
    </Section>
  );
}
