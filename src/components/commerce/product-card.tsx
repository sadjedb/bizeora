'use client';

import { cn } from '@/components/ui/cn';
import { useDictionary } from '@/i18n/client';
import { Badge } from '@/components/ui/feedback';
import { Link } from '@/components/ui/link';
import { Overline, Text } from '@/components/ui/typography';
import { Price } from '@/components/commerce/price';
import { ProductImage } from '@/components/media/product-image';

/**
 * ProductCard — the most-used component in the system (section 8).
 *
 * It is **pure presentation**. It receives a plain object and renders it: no
 * Prisma, no repository, no auth, no availability logic, no price arithmetic.
 * Whether a product can be customised, whether it is in stock, and what it
 * costs are all decided upstream — in `domain/` and the services above it —
 * and arrive here as data. That separation is what `AGENTS.md` section 5 asks
 * for, and it is why this component can be rendered in a test with a literal.
 *
 * The frame disappears: no shadow, no border on the image, and no rating stars
 * (they clutter a fashion grid; ratings live on the product page).
 */

export type ProductCardColour = { name: string; hex: string };

export type ProductCardProduct = {
  name: string;
  href: string;
  /** Overline above the name. Usually the category. */
  eyebrow?: string;
  imageSrc: string | null;
  imageAlt: string;
  blurDataURL?: string;
  /** Integer minor units (ADR-012). */
  price: number;
  compareAtPrice?: number;
  currency?: string;
  /** Rendered top-left, and only when true — section 8. */
  badge?: {
    label: string;
    variant?: 'solid' | 'accentOutline' | 'muted' | 'accentSubtle';
  };
  /** `false` renders the sold-out treatment. */
  available?: boolean;
  /** Up to four dots, then a count. */
  colours?: readonly ProductCardColour[];
  /** What "sold out" is called, in the reader's language. */
  soldOutLabel?: string;
};

const MAX_COLOUR_DOTS = 4;

export function ProductCard({
  product,
  priority = false,
  sizes,
  className,
}: {
  product: ProductCardProduct;
  priority?: boolean;
  sizes?: string;
  className?: string;
}) {
  const {
    name,
    href,
    eyebrow,
    imageSrc,
    imageAlt,
    blurDataURL,
    price,
    compareAtPrice,
    currency,
    badge,
    available = true,
    colours = [],
    soldOutLabel,
  } = product;

  const { t } = useDictionary();
  const visibleColours = colours.slice(0, MAX_COLOUR_DOTS);
  const extraColours = colours.length - visibleColours.length;

  return (
    <article className={cn('group relative flex flex-col gap-3', className)}>
      <div className="relative">
        <ProductImage
          src={imageSrc}
          alt={imageAlt}
          ratio="product"
          priority={priority}
          zoomOnHover
          {...(sizes ? { sizes } : {})}
          {...(blurDataURL ? { blurDataURL } : {})}
        />

        {badge && (
          <div className="absolute top-3 left-3">
            <Badge variant={badge.variant ?? 'solid'}>{badge.label}</Badge>
          </div>
        )}

        {!available && (
          <div className="absolute right-3 bottom-3">
            <Badge variant="muted">{soldOutLabel ?? t.product.soldOut}</Badge>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1">
        {eyebrow && <Overline as="span">{eyebrow}</Overline>}

        {/* The link wraps the name and stretches over the card, so the whole
         * tile is clickable while the accessible name stays the product name
         * rather than "image, link, link". */}
        <Text variant="heading-md" as="h3" clamp={2}>
          <Link href={href} variant="plain" className="after:absolute after:inset-0">
            {name}
          </Link>
        </Text>

        <Price
          amount={price}
          {...(compareAtPrice !== undefined ? { compareAt: compareAtPrice } : {})}
          {...(currency ? { currency } : {})}
        />

        {visibleColours.length > 0 && (
          <ul className="mt-1 flex items-center gap-1.5">
            {visibleColours.map((colour) => (
              <li
                key={colour.name}
                // The colour has a name, so a swatch is never colour alone.
                title={colour.name}
                className="border-border size-3 rounded-full border"
                style={{ backgroundColor: colour.hex }}
              >
                <span className="sr-only">{colour.name}</span>
              </li>
            ))}
            {extraColours > 0 && (
              <li className="text-caption text-fg-subtle tabular-nums">
                +{extraColours}
              </li>
            )}
          </ul>
        )}
      </div>
    </article>
  );
}

/** The card's loading shape. Same ratio, so the grid does not reflow. */
export function ProductCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3', className)} aria-hidden="true">
      <div className="bg-surface-sunken animate-shimmer aspect-4/5 w-full rounded-lg motion-reduce:animate-none" />
      <div className="flex flex-col gap-2">
        <div className="bg-surface-sunken animate-shimmer h-3 w-16 rounded-sm motion-reduce:animate-none" />
        <div className="bg-surface-sunken animate-shimmer h-4 w-3/4 rounded-sm motion-reduce:animate-none" />
        <div className="bg-surface-sunken animate-shimmer h-4 w-20 rounded-sm motion-reduce:animate-none" />
      </div>
    </div>
  );
}
