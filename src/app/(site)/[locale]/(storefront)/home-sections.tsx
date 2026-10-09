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

import type { ReactElement } from 'react';

import { brand } from '@/config/brand';
import { Button } from '@/components/ui/button';
import { Link } from '@/components/ui/link';
import { Accent, Heading, Overline, Text } from '@/components/ui/typography';
import { Marquee, Reveal, SpinningBadge } from '@/components/ui/motion';
import { Container, Grid, Inline, Section, Stack } from '@/components/layout/layout';
import { ProductCard } from '@/components/commerce/product-card';
import { ProductImage } from '@/components/media/product-image';
import { ReviewStars } from '@/components/commerce/rating';
import { cn } from '@/components/ui/cn';
import { toPublicAssetUrl } from '@/lib/media/public-asset';
import {
  commonConfig,
  headingSegments,
  marqueeConfig,
  heroConfig,
  plainHeading,
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
 * Three rules run through all of them.
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
 *
 * **There is exactly one inverse band.** `DESIGN-SYSTEM.md` section 4 reserves
 * the near-black surface for a single moment per page, and on this page that
 * moment is the closing call to action. Two of them is a stripe pattern, and
 * three is a different website.
 *
 * ## What Phase 16 changed
 *
 * The composition, not the data. Every band still renders the same row with the
 * same fields; what changed is that headings are set a step or two larger with
 * one word in italic brass (`headingSegments`), photography sits in 28px frames
 * rather than 6px ones (ADR-042), and the marketing bands arrive on a scroll
 * reveal. Nothing about `homepage_sections` moved, which is the whole point of
 * ADR-027 — a redesign that needed a migration would have been the wrong
 * architecture.
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

/* ------------------------------------------------------------ the heading */

/**
 * A heading, with its one emphasised word set as lettering.
 *
 * The split is a domain rule (`headingSegments`) rather than a regular
 * expression here, because which word carries the emphasis is content: the
 * owner writes `Vos idées, *brodées.*` in the row and the English overlay
 * emphasises a word in a different position. See `domain/content`.
 */
function BandTitle({
  value,
  level,
  variant,
  className,
  onDark = false,
}: {
  value: string;
  level: 1 | 2 | 3;
  variant: 'display-3xl' | 'display-2xl' | 'display-xl' | 'display-lg' | 'display-md';
  className?: string;
  onDark?: boolean;
}) {
  return (
    <Heading
      level={level}
      variant={variant}
      tone={onDark ? 'onDark' : 'default'}
      className={className}
    >
      {headingSegments(value).map((segment, index) =>
        segment.accent ? (
          <Accent key={index}>{segment.text}</Accent>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </Heading>
  );
}

/** The heading block every band shares: eyebrow, title, optional lead. */
function BandHeading({
  eyebrow,
  title,
  body,
  /** Marketing bands are loud; a sub-band inside one is not. */
  size = 'display-xl',
  className,
}: {
  eyebrow: string | null;
  title: string | null;
  body: string | null;
  size?: 'display-xl' | 'display-lg' | 'display-md';
  className?: string;
}) {
  if (!title && !body && !eyebrow) return null;

  return (
    <Stack gap={5} className={className}>
      {eyebrow && <Overline as="p">{eyebrow}</Overline>}
      {title && <BandTitle value={title} level={2} variant={size} />}
      {body && (
        <Text variant="body-lg" tone="muted" className="max-w-[52ch]">
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
      className="group text-body-sm border-border hover:border-fg hover:text-fg inline-flex min-h-11 items-center gap-2 rounded-full border px-5 no-underline hover:no-underline"
    >
      {label}
      <ArrowRight
        className="size-4 transition-transform duration-fast ease-out group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
        aria-hidden="true"
      />
    </Link>
  );
}

/** The row every list band starts with: heading on the left, link on the right. */
function BandTop({
  eyebrow,
  title,
  body,
  ctaLabel,
  ctaHref,
  className,
}: {
  eyebrow: string | null;
  title: string | null;
  body: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-6', className)}>
      <BandHeading eyebrow={eyebrow} title={title} body={body} />
      <BandLink label={ctaLabel} href={ctaHref} />
    </div>
  );
}

/* ------------------------------------------------------------------- hero */

/**
 * The hero.
 *
 * **Phase 16 turned it inside out, and the reason is the photography.**
 *
 * It used to be a full-bleed photograph a hair under the viewport with the type
 * laid over it inside a gradient scrim. That composition is only as good as the
 * picture behind it, and it spends the whole first screen on an image: the
 * headline competes with whatever is in the frame, and the scrim that
 * guarantees the type is readable is itself a 60% black wash over the one
 * photograph the business most wants seen.
 *
 * It is now the reference's shape, which is the opposite trade. The type owns
 * the first screen on the ivory ground, at `display-3xl` with one word in
 * italic brass; the photograph follows it in a 28px frame, uncovered, at full
 * strength. Nothing is laid over anything, so there is no scrim, no on-dark
 * colour switching, and no class of bug where a light photograph makes the
 * headline vanish — which is what the previous version's long comment about
 * stating every colour explicitly was describing.
 *
 * It also degrades properly. With no `imageKey` the band is simply the type
 * block, and a type block is a complete hero. The old fallback had to invent a
 * second layout with a drawn placeholder beside it.
 */
function HeroContent({
  section,
  config,
}: {
  section: HomepageSection;
  config: HeroConfig;
}) {
  return (
    <Stack gap={8} className="max-w-3xl">
      {config.eyebrow && <Overline as="p">{config.eyebrow}</Overline>}

      {/*
       * The one `display-3xl` on the site (DESIGN-SYSTEM.md section 3). The
       * measure is tight on purpose: at this size the line breaks are the
       * composition, and a headline that runs the full width of a desktop is
       * a banner rather than a statement.
       */}
      {section.title && (
        <BandTitle
          value={section.title}
          level={1}
          variant="display-3xl"
          className="max-w-[13ch] text-balance"
        />
      )}

      {section.body && (
        <Text variant="body-lg" tone="muted" className="max-w-[48ch]">
          {section.body}
        </Text>
      )}

      <Inline gap={3} className="pt-2">
        {section.ctaLabel && section.ctaHref && (
          // Accent is reserved for custom-order CTAs (DESIGN-SYSTEM.md
          // section 8), and this is the one that matters.
          <Button asChild variant="accent" shape="pill" size="xl">
            <Link href={section.ctaHref} variant="plain">
              {section.ctaLabel}
            </Link>
          </Button>
        )}

        {config.secondaryCtaLabel && config.secondaryCtaHref && (
          <Button asChild variant="secondary" shape="pill" size="xl">
            <Link href={config.secondaryCtaHref} variant="plain">
              {config.secondaryCtaLabel}
            </Link>
          </Button>
        )}
      </Inline>

      {config.note && (
        <Text variant="body-sm" tone="subtle">
          {config.note}
        </Text>
      )}
    </Stack>
  );
}

function Hero({ section }: { section: HomepageSection }) {
  const config = heroConfig(section.config);
  const image = toPublicAssetUrl(config.imageKey);

  return (
    <Section spacing="none" as="section" className="pt-12 pb-16 md:pt-20 lg:pb-24">
      <Container>
        <HeroContent section={section} config={config} />
      </Container>

      {image && (
        <Container className="mt-14 lg:mt-20">
          <div className="relative">
            <ProductImage
              src={image}
              alt={config.imageAlt ?? ''}
              ratio="hero"
              // The largest image on the site and the one the Largest
              // Contentful Paint is measured against, so never lazy.
              priority
              sizes="(min-width: 1440px) 1200px, 100vw"
              className="rounded-2xl"
            />

            {/*
             * The badge overlaps the frame's corner, which is the whole of its
             * job: it is what stops a large rounded rectangle reading as a
             * placeholder. Hidden below `md` — on a phone it would cover an
             * eighth of the photograph.
             *
             * The ring is `brand.strapline` because that string is part of the
             * mark the owner supplied and is deliberately not translated
             * (`config/brand.ts`). A ring of text that changes language
             * mid-brand is a different brand.
             */}
            <SpinningBadge
              text={`${brand.strapline} · `}
              size={132}
              className="bg-accent text-fg-on-accent absolute -top-10 right-6 hidden rounded-full shadow-md md:grid lg:right-10"
            />
          </div>
        </Container>
      )}
    </Section>
  );
}

/* --------------------------------------------------------------- marquee */

/**
 * The scrolling strip.
 *
 * The reference's third signature device, after the floating header and the
 * headline with one italic word — and the only one of the three that needed a
 * column. The phrases are copy, so they are a row in `homepage_sections` like
 * every other band and the owner writes them in the content screen, one per
 * line. A marquee hard-coded in a component would be the single piece of the
 * front page that needed a deploy to change, which is exactly what ADR-027
 * exists to prevent.
 *
 * Full-bleed and tilted, so it reads as a printed banner laid across the page
 * rather than as a row of text. `Section` is deliberately not used: this band
 * has no container and no vertical rhythm of its own — it is the width of the
 * window by design, and the tilt has to overhang both edges.
 *
 * `title` becomes the landmark's accessible name rather than being rendered. A
 * strip of three-word phrases is decoration with content in it; a heading over
 * it would be a heading over nothing.
 */
function MarqueeBand({ section }: { section: HomepageSection }) {
  const { words } = marqueeConfig(section.config);
  if (words.length === 0) return null;

  return (
    <section
      className="my-16 overflow-hidden lg:my-24"
      aria-label={plainHeading(section.title) ?? undefined}
    >
      <Marquee items={words} tone="ink" tilt />
    </section>
  );
}

/* ----------------------------------------------------------- how it works */

function PointList({ points }: { points: readonly ContentPoint[] }) {
  return (
    <ol className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-12">
      {points.map((point, index) => {
        const Icon = iconFor(point.icon);

        return (
          <li key={point.title} className="flex flex-col gap-4">
            <Inline gap={3} align="center">
              {/*
               * The step number is the display serif at heading scale, in
               * brass. It replaced a 11px monospaced "01" — which was correct
               * for a specification label and wrong for the only thing on the
               * page a reader is meant to count.
               */}
              <span
                className="font-display text-display-md text-accent leading-none tabular-nums"
                aria-hidden="true"
              >
                {String(index + 1).padStart(2, '0')}
              </span>
              {Icon && <Icon className="text-fg-subtle size-5" aria-hidden="true" />}
            </Inline>

            <Heading level={3} variant="heading-lg">
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
    <Section as="section" className="bg-surface border-hairline border-y">
      <Container>
        <Reveal>
          <Stack gap={12}>
            <BandHeading
              eyebrow={config.eyebrow}
              title={section.title}
              body={section.body}
            />
            <PointList points={config.points} />
          </Stack>
        </Reveal>
      </Container>
    </Section>
  );
}

/* --------------------------------------------------------- category grid */

/** The shared shape of a category tile and a gallery tile. */
function MediaTile({
  href,
  src,
  alt,
  title,
  meta,
  ratio,
}: {
  href: string;
  src: string | null;
  alt: string;
  title: string;
  meta: string | null;
  ratio: 'category' | 'square';
}) {
  return (
    <Link
      href={href}
      variant="plain"
      className="group focus-visible:outline-focus flex flex-col gap-4 rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-4"
    >
      <ProductImage
        src={src}
        alt={alt}
        ratio={ratio}
        zoomOnHover
        sizes="(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw"
        className="rounded-2xl"
      />
      <Stack gap={1} className="px-1">
        <Heading level={3} variant="heading-lg">
          {title}
        </Heading>
        {meta && (
          <Text variant="body-sm" tone="subtle">
            {meta}
          </Text>
        )}
      </Stack>
    </Link>
  );
}

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
        <Reveal>
          <Stack gap={12}>
            <BandTop
              eyebrow={config.eyebrow}
              title={section.title}
              body={section.body}
              ctaLabel={section.ctaLabel}
              ctaHref={section.ctaHref}
            />

            <Grid preset="products">
              {categories.map((category) => (
                <MediaTile
                  key={category.slug}
                  href={`/shop/c/${category.slug}`}
                  src={category.image}
                  alt={category.name}
                  title={category.name}
                  meta={`${category.productCount} ${t.shop.pieceWord(category.productCount)}`}
                  ratio="category"
                />
              ))}
            </Grid>
          </Stack>
        </Reveal>
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
        <Reveal>
          <Stack gap={12}>
            <BandTop
              eyebrow={config.eyebrow}
              title={section.title}
              body={section.body}
              ctaLabel={section.ctaLabel}
              ctaHref={section.ctaHref}
            />

            <Grid preset="products">
              {products.map((product) => (
                <ProductCard key={product.slug} product={toCardProduct(product, t)} />
              ))}
            </Grid>
          </Stack>
        </Reveal>
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
    <Section as="section" className="bg-surface border-hairline border-y">
      <Container>
        <Reveal>
          <Stack gap={12}>
            <BandTop
              eyebrow={config.eyebrow}
              title={section.title}
              body={section.body}
              ctaLabel={section.ctaLabel}
              ctaHref={section.ctaHref}
            />

            <Grid preset="products">
              {gallery.map((item) => (
                <MediaTile
                  key={item.slug}
                  href={`/gallery/${item.slug}`}
                  src={item.thumbnail}
                  alt={item.alt}
                  title={item.title}
                  meta={item.embroideryType}
                  ratio="square"
                />
              ))}
            </Grid>
          </Stack>
        </Reveal>
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
    <Stack gap={3}>
      <Inline gap={3} align="center">
        <Truck className="text-accent size-5" aria-hidden="true" />
        <Heading level={3} variant="heading-lg">
          {t.shop.deliveryInWilayas(wilayas)}
        </Heading>
      </Inline>

      {/* The zones and their day ranges as the checkout charges them — this
       * band is rendered from `shipping_rates`, not from typed-in copy. */}
      <dl className="border-hairline divide-hairline divide-y border-t">
        {delivery.map((zone) => (
          <div key={zone.zone} className="grid grid-cols-3 gap-4 py-2.5">
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
    <Section as="section">
      <Container>
        <Reveal>
          <div className="grid gap-14 lg:grid-cols-[1fr_1.1fr] lg:gap-24">
            {/* Sticky, so the claim stays beside the evidence through a long
             * list of points rather than scrolling away from it. */}
            <BandHeading
              eyebrow={config.eyebrow}
              title={section.title}
              body={section.body}
              className="lg:sticky lg:top-32 lg:self-start"
            />

            <Stack gap={0}>
              {config.points.map((point, index) => (
                <div
                  key={point.title}
                  className={cn(
                    'border-hairline py-7 first:pt-0',
                    index < config.points.length - 1 && 'border-b',
                  )}
                >
                  <Stack gap={2}>
                    <Heading level={3} variant="heading-lg">
                      {point.title}
                    </Heading>
                    {point.body && (
                      <Text variant="body" tone="muted">
                        {point.body}
                      </Text>
                    )}
                  </Stack>
                </div>
              ))}

              {showDelivery && (
                <div
                  className={cn(
                    config.points.length > 0 && 'border-hairline border-t pt-7',
                  )}
                >
                  <DeliveryCard delivery={delivery} t={t} />
                </div>
              )}
            </Stack>
          </div>
        </Reveal>
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
    <Section as="section" className="bg-surface border-hairline border-y">
      <Container>
        <Reveal>
          <Stack gap={12}>
            <BandHeading
              eyebrow={config.eyebrow}
              title={section.title}
              body={section.body}
            />

            <ul className="grid list-none gap-6 p-0 md:grid-cols-3">
              {reviews.map((review) => (
                <li
                  key={review.id}
                  className="border-hairline bg-bg flex flex-col gap-4 rounded-xl border p-7"
                >
                  <ReviewStars rating={review.rating} />

                  {review.title && (
                    <Heading level={3} variant="heading-lg">
                      {review.title}
                    </Heading>
                  )}

                  <Text variant="body" tone="muted" className="flex-1">
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
        </Reveal>
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
        <Reveal>
          <Stack gap={6} align="center" className="text-center">
            {config.eyebrow && <Overline as="p">{config.eyebrow}</Overline>}
            {section.title && (
              <BandTitle value={section.title} level={2} variant="display-lg" />
            )}
            {section.body && (
              <Text variant="body-lg" tone="muted">
                {section.body}
              </Text>
            )}

            <Inline gap={3} wrap>
              {social.map((link) => (
                <Button key={link.id} asChild variant="secondary" shape="pill" size="lg">
                  {/* An external destination: opened in place, with `rel` set,
                   * because a content row is not a trusted origin. */}
                  <a href={link.url} rel="noopener noreferrer nofollow" target="_blank">
                    {link.handle ? `${link.platform} · ${link.handle}` : link.platform}
                  </a>
                </Button>
              ))}
            </Inline>
          </Stack>
        </Reveal>
      </Container>
    </Section>
  );
}

/* ---------------------------------------------------------------- banner */

/**
 * The announcement strip.
 *
 * Deliberately the quietest band on the page, and it has to be: it is the first
 * thing under a header that floats, and anything with a strong ground there
 * reads as a stripe wedged between the navigation and the hero rather than as a
 * notice. A hairline and muted text do the whole job.
 *
 * It is not the reference's dark ticker, and it cannot be — that strip sits
 * *above* the navigation, and this one is a row in `homepage_sections`, which
 * means it renders inside `main`, below the header. Moving it above would make
 * the announcement part of the chrome rather than part of the content, which is
 * a different decision about who owns it.
 */
function BannerBand({ banners }: { banners: HomepageData['banners'] }) {
  if (banners.length === 0) return null;

  return (
    <Section
      as="section"
      spacing="none"
      className="bg-bg-subtle border-hairline border-b py-3"
    >
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
 * Two of these exist on the page, and they are deliberately different shapes.
 *
 * The **mid-page** one sits on paper, centred, at `display-lg`. It is an offer
 * made in passing — "an order for your team?" — and it has a long page after
 * it.
 *
 * The **closing** one is the page's single inverse surface (section 4): a
 * near-black card with `2xl` corners, inset from the page rather than
 * full-bleed. Inset, because the footer below it is *also* near-black — two
 * full-bleed dark bands in contact merge into one undifferentiated block, and
 * the band of ivory between them is what makes this read as a card that ends
 * the page rather than as the point where the footer started early.
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

  if (!editorial) {
    return (
      <Section as="section">
        <Container width="narrow">
          <Reveal>
            <Stack gap={6} align="center" className="text-center">
              {config.eyebrow && <Overline as="p">{config.eyebrow}</Overline>}
              <BandTitle value={section.title} level={2} variant="display-lg" />
              {section.body && (
                <Text variant="body-lg" tone="muted">
                  {section.body}
                </Text>
              )}
              {section.ctaLabel && section.ctaHref && (
                <Button asChild variant="primary" shape="pill" size="lg" className="mt-2">
                  <Link href={section.ctaHref} variant="plain">
                    {section.ctaLabel}
                  </Link>
                </Button>
              )}
            </Stack>
          </Reveal>
        </Container>
      </Section>
    );
  }

  return (
    <Section as="section" spacing="compact">
      <Container>
        <Reveal distance="far">
          <div className="bg-bg-inverse text-fg-on-dark rounded-2xl px-6 py-20 md:px-16 lg:py-28">
            <Stack gap={8} align="center" className="mx-auto max-w-2xl text-center">
              {config.eyebrow && (
                <Overline as="p" className="text-fg-on-dark-muted">
                  {config.eyebrow}
                </Overline>
              )}

              <BandTitle
                value={section.title}
                level={2}
                variant="display-2xl"
                onDark
                className="text-balance"
              />

              {section.body && (
                <Text variant="body-lg" className="text-fg-on-dark-muted">
                  {section.body}
                </Text>
              )}

              {section.ctaLabel && section.ctaHref && (
                <Button asChild variant="accent" shape="pill" size="xl" className="mt-2">
                  <Link href={section.ctaHref} variant="plain">
                    {section.ctaLabel}
                  </Link>
                </Button>
              )}
            </Stack>
          </div>
        </Reveal>
      </Container>
    </Section>
  );
}

/* ------------------------------------------------------------- the switch */

/**
 * Render one band.
 *
 * A `switch` over all twelve enum members with no default branch, **and an
 * explicit return type**, which is what makes adding a thirteenth a type error
 * here rather than a section that silently fails to appear.
 *
 * The annotation is the load-bearing half and was missing until Phase 16 added
 * `MARQUEE` and nothing complained: without it the function's inferred return
 * type simply widens to include `undefined`, a missing case compiles, and the
 * new band renders nothing at all. With it, TypeScript reports that the
 * function can finish without returning.
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
}): ReactElement | null {
  switch (section.type) {
    case 'HERO':
      return <Hero section={section} />;
    case 'MARQUEE':
      return <MarqueeBand section={section} />;
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

/**
 * The hero's headline, as a plain string.
 *
 * Exported for the page's metadata and structured data: those need the words
 * without the `*emphasis*` markup, and an asterisk in a `<title>` is an
 * asterisk in a search result.
 */
export function heroHeadline(sections: readonly HomepageSection[]): string | null {
  const hero = sections.find((section) => section.type === 'HERO');
  return plainHeading(hero?.title ?? null);
}
