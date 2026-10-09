import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';

import { Badge } from '@/components/ui/feedback';
import { Breadcrumbs } from '@/components/ui/navigation';
import { Heading, Overline, Text } from '@/components/ui/typography';
import { Container, Grid, Section, Stack } from '@/components/layout/layout';
import { ProductCard } from '@/components/commerce/product-card';
import { ProductMedia } from './product-media';
import {
  findProductRedirect,
  getProductPageData,
} from '@/server/repositories/catalogue-repository';
import { getProductReviewPanel } from '@/server/repositories/review-repository';
import { StarRating } from '@/components/commerce/rating';
import { JsonLd } from '@/components/seo/json-ld';
import { breadcrumbLd, productLd } from '@/domain/seo';
import { absoluteUrl, notFoundMetadata, publicPageMetadata } from '@/lib/seo';
import { dictionaryFor } from '@/i18n';
import { badgeFor } from '@/i18n/catalogue';

import { toCardProduct } from '../../product-card-props';
import { ProductReviews } from './product-reviews';
import { PurchasePanel } from './purchase-panel';

/**
 * Product detail, from the database.
 *
 * A server component. It calls the repository, which returns DTOs; no Prisma
 * model reaches this file, and none reaches `PurchasePanel` below it.
 *
 * A slug that is unknown — or that belongs to a draft, an archived or a
 * soft-deleted product — is a real 404 through `notFound()`. The visibility
 * predicate lives in the query, so an unpublished product is not fetched and
 * then hidden; it is never fetched.
 */

type PageProps = { params: Promise<{ slug: string; locale: string }> };

/**
 * Incremental static regeneration rather than build-time prerendering.
 *
 * Phase 5 prerendered every product with `generateStaticParams` against a
 * fixture module. Against a database that would tie each deploy to a snapshot
 * of the catalogue and leave every product edit stale until the next build.
 * A five-minute window is right for a catalogue the owner edits occasionally,
 * and it keeps the build independent of the database.
 *
 * Tag-based revalidation replaces the timer once the admin can mutate products
 * and knows which tags to invalidate — that is Phase 6's admin half, and
 * guessing at the tags before the mutations exist would be inventing a cache
 * key nothing writes to.
 */
export const revalidate = 300;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, locale: rawLocale } = await params;
  const { locale, t } = dictionaryFor(rawLocale);
  const data = await getProductPageData(slug, locale);

  // A slug that resolves to nothing describes nothing. No canonical, no Open
  // Graph, `noindex` — a 404 must never advertise itself as the canonical
  // address of a page that does not exist.
  if (!data) return notFoundMetadata(t.product.notFoundTitle);

  const { product } = data;

  // The SEO columns win when the owner has set them; the customer-facing name
  // and description are the fallback rather than a separately invented string.
  return publicPageMetadata({
    title: product.seoTitle ?? product.name,
    description: product.seoDescription ?? product.description,
    path: `/shop/${product.slug}`,
    locale,
    // The photograph when there is one; otherwise none here, and the colocated
    // `opengraph-image` generates a card instead.
    image: product.image?.src ?? null,
  });
}

export default async function ProductPage({ params }: PageProps) {
  const { slug, locale: rawLocale } = await params;
  const { locale, t } = dictionaryFor(rawLocale);
  const data = await getProductPageData(slug, locale);

  if (!data) {
    // 11.6: a slug change leaves a redirect behind, so the old URL keeps the
    // links and the ranking it earned instead of becoming a 404. Next issues a
    // 308, which is the permanent redirect it supports and which search engines
    // treat as a 301. Checked only after the slug fails to resolve, so a live
    // product costs no extra query.
    const target = await findProductRedirect(slug);
    if (target) permanentRedirect(`/shop/${target}`);

    notFound();
  }

  const { product, related } = data;

  // Loaded after the product, because an unknown slug must 404 before anything
  // else is queried. Never null here: the same visibility clause resolved it.
  const reviews = await getProductReviewPanel(slug);

  const url = absoluteUrl(`/shop/${product.slug}`, locale);

  return (
    <>
      {/*
       * Product, Offer and — only when the product has approved reviews — an
       * AggregateRating. Every value is the one the page renders: the price
       * `domain/pricing` resolved, the availability `domain/order` decided, and
       * the rating the approved reviews produced. The `sku` is emitted only for
       * a product with exactly one variant, because a Product node carrying one
       * of several SKUs describes the wrong thing.
       */}
      <JsonLd
        nodes={[
          breadcrumbLd([
            { name: t.nav.home, url: absoluteUrl('/', locale) },
            { name: t.shop.eyebrow, url: absoluteUrl('/shop', locale) },
            { name: product.name, url },
          ]),
          productLd({
            name: product.name,
            description: product.seoDescription ?? product.description,
            url,
            images: product.images.flatMap((image) => (image.src ? [image.src] : [])),
            price: product.price,
            currency: product.currency,
            available: product.available,
            category: product.category,
            sku:
              product.variants.length === 1 ? (product.variants[0]?.sku ?? null) : null,
            rating: reviews
              ? { average: reviews.summary.average, count: reviews.summary.count }
              : { average: null, count: 0 },
          }),
        ]}
      />

      <Section as="section" spacing="compact" className="pb-16 lg:pb-24">
        <Container>
          <Breadcrumbs
            className="mb-8"
            items={[
              { label: t.nav.home, href: '/' },
              { label: t.shop.eyebrow, href: '/shop' },
              { label: product.name },
            ]}
          />

          <div className="grid gap-10 lg:grid-cols-12 lg:items-start lg:gap-16">
            {/* Gallery — 7 of 12 on desktop (DESIGN-SYSTEM.md section 6). */}
            <div className="lg:col-span-7">
              <ProductMedia
                images={product.images}
                productName={product.name}
                /*
                 * Only when the file is actually reachable. A model row whose
                 * storage key resolves to nothing — the bucket is unset, say —
                 * would otherwise offer a tab that shows a failure message.
                 */
                model={
                  data.model?.src
                    ? {
                        src: data.model.src,
                        materialName: data.model.materialName,
                        poster: data.model.poster,
                      }
                    : null
                }
              />
            </div>

            {/*
             * Purchase — 5 of 12, and sticky from `lg`.
             *
             * The gallery is taller than the panel on every product that has
             * more than one photograph, so without this the price and the
             * button scroll away while the customer is still looking at the
             * piece. `top-24` clears the sticky header.
             */}
            <div className="lg:sticky lg:top-24 lg:col-span-5">
              <Stack gap={8}>
                <Stack gap={4}>
                  <Overline as="p">{product.category}</Overline>

                  <Heading level={1} variant="display-lg">
                    {product.name}
                  </Heading>

                  {(product.subtitle || product.badge || !product.available) && (
                    <div className="flex flex-wrap items-center gap-3">
                      {product.subtitle && (
                        <Text variant="body" tone="muted">
                          {product.subtitle}
                        </Text>
                      )}
                      {product.badge && (
                        <Badge variant={badgeFor(product.badge, t).variant}>
                          {badgeFor(product.badge, t).label}
                        </Badge>
                      )}
                      {/* Section 11.3: a visible product with nothing
                       * purchasable is not hidden — it says so and keeps its
                       * URL. */}
                      {!product.available && (
                        <Badge variant="muted">{t.product.soldOut}</Badge>
                      )}
                    </div>
                  )}

                  {reviews && reviews.summary.count > 0 && (
                    <a
                      href="#avis"
                      className="focus-visible:outline-focus rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      <StarRating
                        average={reviews.summary.average}
                        count={reviews.summary.count}
                      />
                    </a>
                  )}
                </Stack>

                <PurchasePanel
                  productSlug={product.slug}
                  options={product.options}
                  variants={product.variants}
                  fallbackPrice={product.price}
                  fallbackCompareAtPrice={product.compareAtPrice}
                  currency={product.currency}
                  customisable={product.isCustomizable}
                />

                {/*
                 * The description sits *under* the buy panel, not above it.
                 * Above, it pushed the price and the button below the fold on
                 * a phone for the sake of a paragraph nobody reads before
                 * deciding they like the piece.
                 */}
                <Stack gap={4}>
                  <Heading level={2} variant="heading-lg">
                    {t.product.description}
                  </Heading>
                  <Text variant="body" tone="muted">
                    {product.description}
                  </Text>
                </Stack>

                {(product.details.length > 0 || product.embroideryDetails) && (
                  <Stack gap={4}>
                    <Heading level={2} variant="heading-lg">
                      {t.product.details}
                    </Heading>

                    {product.details.length > 0 && (
                      <dl className="border-border divide-border divide-y border-t">
                        {product.details.map((detail) => (
                          <div key={detail.term} className="grid grid-cols-3 gap-4 py-3">
                            <dt className="text-body-sm text-fg-subtle">{detail.term}</dt>
                            <dd className="text-body-sm text-fg col-span-2">
                              {detail.value}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    )}

                    {product.embroideryDetails && (
                      <Text variant="body-sm" tone="muted">
                        {product.embroideryDetails}
                      </Text>
                    )}
                  </Stack>
                )}
              </Stack>
            </div>
          </div>
        </Container>
      </Section>

      {reviews && (
        <div id="avis" className="scroll-mt-24">
          <ProductReviews panel={reviews} />
        </div>
      )}

      {related.length > 0 && (
        <Section as="section" className="bg-surface border-border border-t">
          <Container>
            <Stack gap={10}>
              <Heading level={2} variant="display-md">
                {t.product.relatedTitle}
              </Heading>

              <Grid preset="products">
                {related.map((candidate) => (
                  <ProductCard
                    key={candidate.slug}
                    product={toCardProduct(candidate, t)}
                  />
                ))}
              </Grid>
            </Stack>
          </Container>
        </Section>
      )}
    </>
  );
}
