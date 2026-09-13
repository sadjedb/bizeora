import {
  ArrowRight,
  Package,
  Ruler,
  Shirt,
  Sparkles,
  Truck,
  Upload,
  type LucideIcon,
} from 'lucide-react';

import Image from 'next/image';

import { Divider } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { Link } from '@/components/ui/link';
import { Heading, Overline, Text } from '@/components/ui/typography';
import { Container, Grid, Inline, Section, Stack } from '@/components/layout/layout';
import { ProductCard } from '@/components/commerce/product-card';
import { ProductImage } from '@/components/media/product-image';
import { ReviewStars } from '@/components/commerce/rating';
import { cn } from '@/components/ui/cn';
import { toPublicAssetUrl } from '@/lib/media/public-asset';
import {
  commonConfig,
  heroConfig,
  pointsConfig,
  whyUsConfig,
  type ContentPoint,
  type HeroConfig,
  type HomepageSection,
} from '@/domain/content';
import type { HomepageData } from '@/server/services/content-service';

import type { Dictionary } from '@/i18n';

import { toCardProduct } from './product-card-props';

/**
 * The homepage, band by band.
 *
 * Eleven section types, each a function of a row and the data the loader
 * already fetched. Nothing here queries anything: `content-service` loads once
 * for the whole page (see its own comment), so a band added or reordered costs
 * a row in `homepage_sections` and no extra round trip.
 *
 * Two rules run through all of them.
 *
 * **A band with nothing to show renders nothing.** Not an empty grid under a
 * heading, not a "coming soon" — nothing at all. A shop with no approved
 * reviews has no reviews band, and that is the honest page rather than a
 * placeholder pretending there is content behind it.
 *
 * **No copy is invented here.** Every heading, sentence and label comes from
 * the row; the component supplies structure and the design system's tokens. The
 * one exception is the delivery card, which is built from `shipping_rates`
 * because a delivery promise typed into a content row is one nobody reconciles
 * against what the checkout charges.
 */

/**
 * The icons a content row may name.
 *
 * A closed set, looked up by name: `config` is data the owner edits, and an
 * arbitrary string reaching a component registry is how a content field becomes
 * a way to render something nobody intended. An unknown name renders no icon,
 * which is a smaller failure than a broken band.
 */
const ICONS: Record<string, LucideIcon> = {
  shirt: Shirt,
  ruler: Ruler,
  upload: Upload,
  sparkles: Sparkles,
  truck: Truck,
  package: Package,
};

function iconFor(name: string | null): LucideIcon | null {
  return name ? (ICONS[name] ?? null) : null;
}

/** The heading block every band shares: eyebrow, title, optional lead. */
function BandHeading({
  eyebrow,
  title,
  body,
  className,
}: {
  eyebrow: string | null;
  title: string | null;
  body: string | null;
  className?: string;
}) {
  if (!title && !body && !eyebrow) return null;

  return (
    <Stack gap={4} className={className}>
      {eyebrow && <Overline as="p">{eyebrow}</Overline>}
      {title && (
        <Heading level={2} variant="display-md">
          {title}
        </Heading>
      )}
      {body && (
        <Text variant="body" tone="muted">
          {body}
        </Text>
      )}
    </Stack>
  );
}

/** "Tout voir →", when the row supplies both a label and a destination. */
function BandLink({ label, href }: { label: string | null; href: string | null }) {
  if (!label || !href) return null;

  return (
    <Link
      href={href}
      variant="subtle"
      className="text-body-sm inline-flex min-h-11 items-center gap-1.5"
    >
      {label}
      <ArrowRight className="size-4" aria-hidden="true" />
    </Link>
  );
}

/* ------------------------------------------------------------------- hero */

/**
 * The hero.
 *
 * Two shapes, and which one you get depends on whether there is a photograph.
 *
 * **With one** — the shape this is designed around — it is a full-bleed
 * picture a hair under the viewport, the type laid over it inside a gradient
 * scrim that runs from the left edge. The scrim is not decoration: text over an
 * uncontrolled photograph is the classic way to ship a heading nobody can read
 * on half the images somebody will later upload, and a gradient guarantees the
 * contrast whatever the picture behind it turns out to be.
 *
 * **Without one** it falls back to the split layout — type on paper, drawn
 * placeholder beside it. That is what the page did before there was any
 * photography, and it must keep working, because an operator who clears the
 * image key should get a coherent page rather than white text on white.
 *
 * `svh` rather than `vh` throughout: a mobile browser's toolbar makes `100vh`
 * taller than the screen, which pushed the primary call to action under the
 * fold on exactly the platform `DESIGN-SYSTEM.md` section 13 calls primary.
 */
function HeroContent({
  section,
  config,
  onImage,
}: {
  section: HomepageSection;
  config: HeroConfig;
  /**
   * Laid over the photograph rather than sitting on the page.
   *
   * Every colour below has to be stated rather than inherited: `Heading`,
   * `Text` and `Overline` each set their own `text-*` from their `tone`, so a
   * `text-fg-on-dark` on the wrapper is overridden by the default `text-fg` on
   * the child — which is near-black, on a near-black photograph. That is
   * exactly what the first build of this band shipped.
   */
  onImage: boolean;
}) {
  return (
    <Stack gap={6} className="max-w-xl">
      {config.eyebrow && (
        <Overline as="p" tone={onImage ? 'onDark' : 'subtle'}>
          {config.eyebrow}
        </Overline>
      )}

      {/* The one display-2xl on the page (DESIGN-SYSTEM.md section 3). */}
      {section.title && (
        <Heading
          level={1}
          variant="display-2xl"
          tone={onImage ? 'onDark' : 'default'}
          className="max-w-[13ch]"
        >
          {section.title}
        </Heading>
      )}

      {section.body && (
        <Text
          variant="body-lg"
          tone={onImage ? 'onDark' : 'muted'}
          className={cn('max-w-[44ch]', onImage && 'opacity-90')}
        >
          {section.body}
        </Text>
      )}

      <Inline gap={3} className="pt-1">
        {section.ctaLabel && section.ctaHref && (
          // Accent is reserved for custom-order CTAs (DESIGN-SYSTEM.md
          // section 8), and this is the one that matters.
          <Button asChild variant="accent" size="lg">
            <Link href={section.ctaHref} variant="plain">
              {section.ctaLabel}
            </Link>
          </Button>
        )}

        {config.secondaryCtaLabel && config.secondaryCtaHref && (
          <Button
            asChild
            variant="secondary"
            size="lg"
            // The secondary button's border and label are page colours. Over a
            // photograph they have to become the on-dark pair, whatever theme
            // the visitor is in.
            className={
              onImage
                ? 'border-border-on-dark text-fg-on-dark hover:bg-surface-inverse'
                : undefined
            }
          >
            <Link href={config.secondaryCtaHref} variant="plain">
              {config.secondaryCtaLabel}
            </Link>
          </Button>
        )}
      </Inline>

      {config.note && (
        <Text
          variant="body-sm"
          tone={onImage ? 'onDark' : 'subtle'}
          className={onImage ? 'opacity-75' : undefined}
        >
          {config.note}
        </Text>
      )}
    </Stack>
  );
}

function Hero({ section }: { section: HomepageSection }) {
  const config = heroConfig(section.config);
  const image = toPublicAssetUrl(config.imageKey);

  /* ---------------------------------------------------- no photograph yet */
  if (!image) {
    return (
      <Section spacing="none" as="section" className="border-border relative border-b">
        <div className="grid lg:min-h-[calc(100svh-5rem)] lg:grid-cols-[1.02fr_1fr]">
          <div className="text-fg flex items-center">
            <Container bleed className="px-6 py-16 md:px-10 lg:px-16 lg:py-24 xl:px-24">
              <HeroContent section={section} config={config} onImage={false} />
            </Container>
          </div>

          <div className="border-border relative min-h-[38svh] border-t lg:min-h-0 lg:border-t-0 lg:border-l">
            <ProductImage
              src={null}
              alt=""
              ratio="auto"
              priority
              className="h-full rounded-none"
              sizes="(min-width: 1024px) 50vw, 100vw"
            />
          </div>
        </div>
      </Section>
    );
  }

  /* ------------------------------------------------------- full-bleed image */
  return (
    <Section
      spacing="none"
      as="section"
      className="relative isolate min-h-[calc(100svh-4rem)] md:min-h-[calc(100svh-5rem)]"
    >
      <Image
        src={image}
        alt={config.imageAlt ?? ''}
        fill
        // The hero is the largest image on the site and the one the Largest
        // Contentful Paint is measured against, so it is never lazy.
        priority
        sizes="100vw"
        className="-z-10 object-cover"
      />

      {/*
       * The scrim. Two gradients rather than one flat wash: a horizontal ramp
       * that carries the type column on a wide screen, and a vertical one that
       * takes over when the columns collapse and the text sits over the middle
       * of the picture.
       */}
      <div
        aria-hidden="true"
        className={cn(
          '-z-10 absolute inset-0',
          'bg-linear-to-t from-black/85 via-black/45 to-black/20',
          'md:bg-linear-to-r md:from-black/85 md:via-black/50 md:to-black/10',
        )}
      />

      <Container
        bleed
        className="flex min-h-[calc(100svh-4rem)] items-end px-6 pt-24 pb-16 md:min-h-[calc(100svh-5rem)] md:items-center md:px-10 lg:px-16 lg:py-24 xl:px-24"
      >
        {/*
         * Always the light foreground, in both themes. The type sits on a
         * photograph under a dark scrim, and a dark-theme flip would put near
         * black on it.
         */}
        <HeroContent section={section} config={config} onImage />
      </Container>
    </Section>
  );
}

/* ----------------------------------------------------------- how it works */

function PointList({ points }: { points: readonly ContentPoint[] }) {
  return (
    <ol className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-10">
      {points.map((point, index) => {
        const Icon = iconFor(point.icon);

        return (
          <li key={point.title} className="flex flex-col gap-3">
            <Inline gap={3} align="center">
              <span className="text-mono-sm text-fg-subtle tabular-nums">
                {String(index + 1).padStart(2, '0')}
              </span>
              {Icon && <Icon className="text-accent size-5" aria-hidden="true" />}
            </Inline>
            <Heading level={3} variant="heading-md">
              {point.title}
            </Heading>
            {point.body && (
              <Text variant="body-sm" tone="muted">
                {point.body}
              </Text>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function HowItWorks({ section }: { section: HomepageSection }) {
  const config = pointsConfig(section.config);
  if (config.points.length === 0) return null;

  return (
    <Section as="section" className="bg-surface border-border border-y">
      <Container>
        <Stack gap={12}>
          <BandHeading
            eyebrow={config.eyebrow}
            title={section.title}
            body={section.body}
            className="max-w-prose"
          />
          <PointList points={config.points} />
        </Stack>
      </Container>
    </Section>
  );
}

/* --------------------------------------------------------- category grid */

function CategoryGrid({
  t,
  section,
  categories,
}: {
  t: Dictionary;
  section: HomepageSection;
  categories: HomepageData['categories'];
}) {
  if (categories.length === 0) return null;

  const config = commonConfig(section.config);

  return (
    <Section as="section">
      <Container>
        <Stack gap={10}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <BandHeading
              eyebrow={config.eyebrow}
              title={section.title}
              body={section.body}
            />
            <BandLink label={section.ctaLabel} href={section.ctaHref} />
          </div>

          <Grid preset="products">
            {categories.map((category) => (
              <Link
                key={category.slug}
                href={`/shop/c/${category.slug}`}
                variant="plain"
                className="group focus-visible:outline-focus flex flex-col gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4"
              >
                <ProductImage
                  src={category.image}
                  alt={category.name}
                  ratio="category"
                  zoomOnHover
                  sizes="(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw"
                />
                <Stack gap={1}>
                  <Heading level={3} variant="heading-md">
                    {category.name}
                  </Heading>
                  <Text variant="body-sm" tone="subtle">
                    {category.productCount} {t.shop.pieceWord(category.productCount)}
                  </Text>
                </Stack>
              </Link>
            ))}
          </Grid>
        </Stack>
      </Container>
    </Section>
  );
}

/* ------------------------------------------------------ featured products */

function FeaturedProducts({
  t,
  section,
  products,
}: {
  t: Dictionary;
  section: HomepageSection;
  products: HomepageData['products'];
}) {
  if (products.length === 0) return null;

  const config = commonConfig(section.config);

  return (
    <Section as="section">
      <Container>
        <Stack gap={10}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <BandHeading
              eyebrow={config.eyebrow}
              title={section.title}
              body={section.body}
            />
            <BandLink label={section.ctaLabel} href={section.ctaHref} />
          </div>

          <Grid preset="products">
            {products.map((product) => (
              <ProductCard key={product.slug} product={toCardProduct(product, t)} />
            ))}
          </Grid>
        </Stack>
      </Container>
    </Section>
  );
}

/* ---------------------------------------------------------------- gallery */

function GalleryBand({
  section,
  gallery,
}: {
  section: HomepageSection;
  gallery: HomepageData['gallery'];
}) {
  if (gallery.length === 0) return null;

  const config = commonConfig(section.config);

  return (
    <Section as="section" className="bg-surface border-border border-y">
      <Container>
        <Stack gap={10}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <BandHeading
              eyebrow={config.eyebrow}
              title={section.title}
              body={section.body}
              className="max-w-prose"
            />
            <BandLink label={section.ctaLabel} href={section.ctaHref} />
          </div>

          <Grid preset="products">
            {gallery.map((item) => (
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
                  <Heading level={3} variant="heading-md">
                    {item.title}
                  </Heading>
                  {item.embroideryType && (
                    <Text variant="body-sm" tone="subtle">
                      {item.embroideryType}
                    </Text>
                  )}
                </Stack>
              </Link>
            ))}
          </Grid>
        </Stack>
      </Container>
    </Section>
  );
}

/* ---------------------------------------------------------------- why us */

function DeliveryCard({
  delivery,
  t,
}: {
  delivery: HomepageData['delivery'];
  t: Dictionary;
}) {
  if (delivery.length === 0) return null;

  const wilayas = delivery.reduce((total, zone) => total + zone.wilayaCount, 0);

  return (
    <Stack gap={2}>
      <Inline gap={3} align="center">
        <Truck className="text-accent size-5" aria-hidden="true" />
        <Heading level={3} variant="heading-lg">
          {t.shop.deliveryInWilayas(wilayas)}
        </Heading>
      </Inline>

      {/* The zones and their day ranges as the checkout charges them — this
       * band is rendered from `shipping_rates`, not from typed-in copy. */}
      <dl className="border-border divide-border divide-y border-t">
        {delivery.map((zone) => (
          <div key={zone.zone} className="grid grid-cols-3 gap-4 py-2">
            <dt className="text-body-sm text-fg-subtle">{zone.zone}</dt>
            <dd className="text-body-sm text-fg col-span-2 tabular-nums">
              {t.shop.daysRange(zone.minDays, zone.maxDays)} ·{' '}
              {t.shop.wilayaCount(zone.wilayaCount)}
            </dd>
          </div>
        ))}
      </dl>
    </Stack>
  );
}

function WhyUs({
  section,
  delivery,
  t,
}: {
  section: HomepageSection;
  delivery: HomepageData['delivery'];
  t: Dictionary;
}) {
  const config = whyUsConfig(section.config);
  const showDelivery = config.showDelivery && delivery.length > 0;

  if (config.points.length === 0 && !showDelivery) return null;

  return (
    <Section as="section" className="bg-surface border-border border-y">
      <Container>
        <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:gap-20">
          <BandHeading
            eyebrow={config.eyebrow}
            title={section.title}
            body={section.body}
            className="max-w-prose"
          />

          <Stack gap={0}>
            {config.points.map((point, index) => (
              <div key={point.title}>
                {index > 0 && <Divider className="my-6" />}
                <Stack gap={2}>
                  <Heading level={3} variant="heading-lg">
                    {point.title}
                  </Heading>
                  {point.body && (
                    <Text variant="body-sm" tone="muted">
                      {point.body}
                    </Text>
                  )}
                </Stack>
              </div>
            ))}

            {showDelivery && (
              <>
                {config.points.length > 0 && <Divider className="my-6" />}
                <DeliveryCard delivery={delivery} t={t} />
              </>
            )}
          </Stack>
        </div>
      </Container>
    </Section>
  );
}

/* --------------------------------------------------------------- reviews */

function Reviews({
  section,
  reviews,
}: {
  section: HomepageSection;
  reviews: HomepageData['reviews'];
}) {
  // Nothing is invented: with no approved review the band does not exist.
  if (reviews.length === 0) return null;

  const config = commonConfig(section.config);

  return (
    <Section as="section">
      <Container>
        <Stack gap={10}>
          <BandHeading
            eyebrow={config.eyebrow}
            title={section.title}
            body={section.body}
            className="max-w-prose"
          />

          <ul className="grid list-none gap-8 p-0 md:grid-cols-3">
            {reviews.map((review) => (
              <li key={review.id} className="flex flex-col gap-3">
                <ReviewStars rating={review.rating} />

                {review.title && (
                  <Heading level={3} variant="heading-md">
                    {review.title}
                  </Heading>
                )}

                <Text variant="body-sm" tone="muted">
                  {review.body}
                </Text>

                <Text variant="body-sm" tone="subtle">
                  {review.authorName} ·{' '}
                  <Link href={`/shop/${review.productSlug}`} variant="subtle">
                    {review.productName}
                  </Link>
                </Text>
              </li>
            ))}
          </ul>
        </Stack>
      </Container>
    </Section>
  );
}

/* ---------------------------------------------------------------- social */

function Social({
  section,
  social,
}: {
  section: HomepageSection;
  social: HomepageData['social'];
}) {
  if (social.length === 0) return null;

  const config = commonConfig(section.config);

  return (
    <Section as="section" spacing="compact">
      <Container width="narrow">
        <Stack gap={6} align="center" className="text-center">
          <BandHeading
            eyebrow={config.eyebrow}
            title={section.title}
            body={section.body}
          />

          <Inline gap={3}>
            {social.map((link) => (
              <Button key={link.id} asChild variant="secondary">
                {/* An external destination: opened in place, with `rel` set,
                 * because a content row is not a trusted origin. */}
                <a href={link.url} rel="noopener noreferrer nofollow" target="_blank">
                  {link.handle ? `${link.platform} · ${link.handle}` : link.platform}
                </a>
              </Button>
            ))}
          </Inline>
        </Stack>
      </Container>
    </Section>
  );
}

/* ---------------------------------------------------------------- banner */

function BannerBand({ banners }: { banners: HomepageData['banners'] }) {
  if (banners.length === 0) return null;

  return (
    <Section as="section" spacing="none" className="bg-surface-sunken py-3">
      <Container>
        <Stack gap={1} align="center" className="text-center">
          {banners.map((banner) => (
            <Text key={banner.id} variant="body-sm" tone="muted">
              {banner.href ? (
                <Link href={banner.href} variant="subtle">
                  {banner.message}
                </Link>
              ) : (
                banner.message
              )}
            </Text>
          ))}
        </Stack>
      </Container>
    </Section>
  );
}

/* ------------------------------------------------------------------- CTAs */

/**
 * A call to action.
 *
 * Two of these exist on the page: a mid-page one, and the closing band. The
 * closing band (`editorial`) is the page's one **inverse** surface — near-black,
 * full-bleed, the accent button on it. That is the editorial device
 * `DESIGN-SYSTEM.md` section 4 reserves for a single moment per page, and it is
 * what makes the bottom of a long scroll read as an ending rather than as the
 * point where the content ran out. The mid-page one stays on paper, because two
 * black bands is a stripe pattern.
 */
function CallToAction({
  section,
  editorial,
}: {
  section: HomepageSection;
  editorial: boolean;
}) {
  const config = commonConfig(section.config);
  if (!section.title) return null;

  return (
    <Section
      as="section"
      spacing={editorial ? 'editorial' : 'default'}
      className={editorial ? 'bg-bg-inverse text-fg-on-dark' : undefined}
    >
      <Container width="narrow">
        <Stack gap={6} align="center" className="text-center">
          {config.eyebrow && (
            <Overline as="p" className={editorial ? 'text-fg-on-dark-muted' : undefined}>
              {config.eyebrow}
            </Overline>
          )}

          <Heading
            level={2}
            variant={editorial ? 'display-lg' : 'display-md'}
            className={editorial ? 'text-fg-on-dark' : undefined}
          >
            {section.title}
          </Heading>

          {section.body && (
            <Text
              variant="body-lg"
              tone={editorial ? 'onDark' : 'muted'}
              className={editorial ? 'opacity-80' : undefined}
            >
              {section.body}
            </Text>
          )}

          {section.ctaLabel && section.ctaHref && (
            <Button asChild variant="accent" size="lg" className="mt-2">
              <Link href={section.ctaHref} variant="plain">
                {section.ctaLabel}
              </Link>
            </Button>
          )}
        </Stack>
      </Container>
    </Section>
  );
}

/* ------------------------------------------------------------- the switch */

/**
 * Render one band.
 *
 * A `switch` over the eleven enum members with no default branch, so adding a
 * twelfth type is a type error here rather than a section that silently fails
 * to appear.
 */
export function HomepageBand({
  section,
  data,
  t,
}: {
  section: HomepageSection;
  data: HomepageData;
  /**
   * The dictionary, for the handful of words the bands say themselves.
   *
   * Almost everything on this page is content — every heading, sentence and
   * label comes from `homepage_sections`, in whatever language the row is
   * written in. What needs translating here is only the chrome around it: a
   * pluralised count, a product badge, a sold-out marker.
   */
  t: Dictionary;
}) {
  switch (section.type) {
    case 'HERO':
      return <Hero section={section} />;
    case 'HOW_IT_WORKS':
      return <HowItWorks section={section} />;
    case 'CATEGORY_GRID':
      return <CategoryGrid t={t} section={section} categories={data.categories} />;
    case 'FEATURED_PRODUCTS':
      return <FeaturedProducts t={t} section={section} products={data.products} />;
    case 'GALLERY':
      return <GalleryBand section={section} gallery={data.gallery} />;
    case 'WHY_US':
      return <WhyUs section={section} delivery={data.delivery} t={t} />;
    case 'REVIEWS':
      return <Reviews section={section} reviews={data.reviews} />;
    case 'SOCIAL':
      return <Social section={section} social={data.social} />;
    case 'BANNER':
      return <BannerBand banners={data.banners} />;
    case 'CUSTOM_CTA':
      return <CallToAction section={section} editorial={false} />;
    case 'FINAL_CTA':
      return <CallToAction section={section} editorial />;
  }
}
