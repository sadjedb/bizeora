import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { Badge } from '@/components/ui/feedback';
import { Breadcrumbs } from '@/components/ui/navigation';
import { Button } from '@/components/ui/button';
import { Heading, Overline, Text } from '@/components/ui/typography';
import { Container, Inline, Section, Stack } from '@/components/layout/layout';
import { Link } from '@/components/ui/link';
import { ProductImage } from '@/components/media/product-image';
import {
  getGalleryItemBySlug,
  listProductsRelatedToGalleryItem,
} from '@/server/repositories/gallery-repository';
import { JsonLd } from '@/components/seo/json-ld';
import { breadcrumbLd } from '@/domain/seo';
import { absoluteUrl, notFoundMetadata, publicPageMetadata } from '@/lib/seo';
import { dictionaryFor } from '@/i18n';

/**
 * One piece of work.
 *
 * The image is the page, so it comes first and takes the width; everything else
 * is caption. The two facets are links back into the filtered gallery, which is
 * how a visitor who likes one polo finds the other polos.
 *
 * "Related products" is a **shared-tag join**, not a guess: a gallery item
 * tagged `polo` leads to the polos a visitor can actually buy, filtered by the
 * catalogue's own visibility rule. An item with no visible related product
 * simply offers the custom builder instead, which is the honest next step.
 *
 * An unpublished or unknown slug is a real 404 — the visibility clause is in
 * the query, so an unpublished item is never fetched and then hidden.
 */

type PageProps = { params: Promise<{ slug: string; locale: string }> };

export const revalidate = 300;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, locale: rawLocale } = await params;
  const { locale, t } = dictionaryFor(rawLocale);
  const item = await getGalleryItemBySlug(slug, locale);

  // Unknown, unpublished or soft-deleted are the same answer, and it carries no
  // canonical: an item awaiting a customer's consent (13.6) must not be
  // described in a `<head>` any more than in the page.
  if (!item) return notFoundMetadata(t.gallery.notFoundTitle);

  return publicPageMetadata({
    title: item.title,
    description: item.description ?? item.alt,
    path: `/gallery/${item.slug}`,
    locale,
    type: 'article',
    // The public asset URL, resolved by `lib/media` — never the storage key,
    // and never the private original this piece may have been made from.
    image: item.image,
  });
}

export default async function GalleryItemPage({ params }: PageProps) {
  const { slug, locale: rawLocale } = await params;
  const { locale, t } = dictionaryFor(rawLocale);
  const item = await getGalleryItemBySlug(slug, locale);

  if (!item) notFound();

  const related = await listProductsRelatedToGalleryItem({ slug: item.slug });

  return (
    <Section as="section" spacing="compact" className="pb-20 lg:pb-32">
      <JsonLd
        nodes={[
          breadcrumbLd([
            { name: t.nav.home, url: absoluteUrl('/', locale) },
            { name: t.gallery.metaTitle, url: absoluteUrl('/gallery', locale) },
            { name: item.title, url: absoluteUrl(`/gallery/${item.slug}`) },
          ]),
        ]}
      />

      <Container>
        <Breadcrumbs
          className="mb-8"
          items={[
            { label: t.nav.home, href: '/' },
            { label: t.gallery.metaTitle, href: '/gallery' },
            { label: item.title },
          ]}
        />

        <div className="grid gap-10 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-7">
            <ProductImage
              src={item.image}
              alt={item.alt}
              ratio="square"
              priority
              sizes="(min-width: 1024px) 55vw, 100vw"
            />
          </div>

          <div className="lg:col-span-5">
            <Stack gap={8}>
              <Stack gap={4}>
                {item.embroideryType && <Overline as="p">{item.embroideryType}</Overline>}

                <Heading level={1} variant="display-md">
                  {item.title}
                </Heading>

                {item.description && (
                  <Text variant="body" tone="muted">
                    {item.description}
                  </Text>
                )}

                {item.tags.length > 0 && (
                  <Inline gap={2}>
                    {item.tags.map((tag) => (
                      <Badge key={tag} variant="outline">
                        {tag}
                      </Badge>
                    ))}
                  </Inline>
                )}
              </Stack>

              {/* Both facets lead back into the filtered listing. */}
              <Stack gap={3}>
                <Heading level={2} variant="heading-lg">
                  {t.gallery.details}
                </Heading>

                <dl className="border-border divide-border divide-y border-t">
                  {item.productType && (
                    <div className="grid grid-cols-3 gap-4 py-3">
                      <dt className="text-body-sm text-fg-subtle">{t.gallery.support}</dt>
                      <dd className="text-body-sm col-span-2">
                        <Link
                          href={`/gallery?productType=${encodeURIComponent(item.productType)}`}
                          variant="subtle"
                        >
                          {item.productType}
                        </Link>
                      </dd>
                    </div>
                  )}

                  {item.embroideryType && (
                    <div className="grid grid-cols-3 gap-4 py-3">
                      <dt className="text-body-sm text-fg-subtle">
                        {t.gallery.embroidery}
                      </dt>
                      <dd className="text-body-sm col-span-2">
                        <Link
                          href={`/gallery?embroideryType=${encodeURIComponent(item.embroideryType)}`}
                          variant="subtle"
                        >
                          {item.embroideryType}
                        </Link>
                      </dd>
                    </div>
                  )}
                </dl>
              </Stack>

              {related.length > 0 && (
                <Stack gap={3}>
                  <Heading level={2} variant="heading-lg">
                    {t.gallery.matchingProducts}
                  </Heading>

                  <ul className="flex list-none flex-col gap-2 p-0">
                    {related.map((product) => (
                      <li key={product.slug}>
                        <Link href={`/shop/${product.slug}`} variant="subtle">
                          {product.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Stack>
              )}

              <Button asChild variant="accent" size="lg">
                <Link href="/custom" variant="plain">
                  {t.gallery.makeMine}
                </Link>
              </Button>
            </Stack>
          </div>
        </div>
      </Container>
    </Section>
  );
}
