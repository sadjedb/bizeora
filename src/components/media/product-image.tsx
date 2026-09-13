import Image from 'next/image';
import { ImageIcon } from 'lucide-react';

import { cn } from '@/components/ui/cn';

/**
 * Media primitives.
 *
 * Section 9 fixes the aspect ratios, and consistent ratios are what make a
 * grid look designed rather than assembled — so the ratio is a named prop, not
 * a class the caller invents.
 *
 * Two rules are enforced here:
 *
 *   - **`alt` is required.** It is `NOT NULL` in the database for this exact
 *     reason (section 14). A decorative image passes `alt=""` explicitly, which
 *     is a decision rather than an omission.
 *   - **Loading sits on `--color-surface-sunken`**, so a slow image is a warm
 *     neutral block rather than a grey hole.
 */

export type MediaRatio = 'product' | 'category' | 'hero' | 'square' | 'auto';

const RATIOS: Record<MediaRatio, string> = {
  /** Product cards and the detail gallery: 4:5. */
  product: 'aspect-4/5',
  /** Category cards: 3:2. */
  category: 'aspect-3/2',
  /** Hero: 4:5 on mobile, 16:9 from md. */
  hero: 'aspect-4/5 md:aspect-video',
  square: 'aspect-square',
  /** Gallery masonry: natural height. */
  auto: '',
};

export type ProductImageProps = {
  src: string | null | undefined;
  /** Describes the product, never the file name (section 14). */
  alt: string;
  ratio?: MediaRatio;
  /** Feed the real breakpoints; a wrong `sizes` downloads a desktop image to a phone. */
  sizes?: string;
  /** Base64 placeholder from the stored `blurDataUrl`. */
  blurDataURL?: string;
  priority?: boolean;
  /** Adds the section 10 hover: the image scales 1.03, the card does not move. */
  zoomOnHover?: boolean;
  className?: string;
};

export function ProductImage({
  src,
  alt,
  ratio = 'product',
  sizes = '(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw',
  blurDataURL,
  priority = false,
  zoomOnHover = false,
  className,
}: ProductImageProps) {
  return (
    <div
      className={cn(
        'bg-surface-sunken relative w-full overflow-hidden rounded-lg',
        RATIOS[ratio],
        className,
      )}
    >
      {src ? (
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          {...(blurDataURL ? { placeholder: 'blur' as const, blurDataURL } : {})}
          className={cn(
            'object-cover',
            zoomOnHover && [
              'transition-transform duration-[250ms] ease-out',
              'group-hover:scale-103',
              'motion-reduce:transition-none motion-reduce:group-hover:scale-100',
            ],
          )}
        />
      ) : (
        <MediaPlaceholder />
      )}
    </div>
  );
}

/**
 * The fallback when a record has no image.
 *
 * Deliberately quiet: a missing photograph should read as "not yet" rather
 * than as a broken page.
 */
export function MediaPlaceholder({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'bg-surface-sunken text-fg-subtle absolute inset-0 flex items-center justify-center',
        className,
      )}
      aria-hidden="true"
    >
      {/* A running-stitch texture rather than a bare icon. Every tile in the
       * catalogue shows this until real photography exists, so it has to read
       * as an intentional blank — clearly not a photograph, and clearly not a
       * broken image either. Drawn from `currentColor`, so it follows a
       * rebrand rather than pinning a literal. */}
      <svg
        className="absolute inset-0 size-full"
        aria-hidden="true"
        preserveAspectRatio="xMidYMid slice"
        viewBox="0 0 120 150"
        fill="none"
      >
        <g stroke="currentColor" strokeWidth="0.75" strokeLinecap="round" opacity="0.3">
          {[30, 50, 70, 90, 110, 130].map((y, index) => (
            <line
              key={y}
              x1="14"
              y1={y}
              x2="106"
              y2={y}
              strokeDasharray="5 7"
              strokeDashoffset={index % 2 === 0 ? 0 : 3}
            />
          ))}
        </g>
        <circle
          cx="60"
          cy="75"
          r="26"
          stroke="currentColor"
          strokeWidth="0.75"
          opacity="0.4"
        />
      </svg>

      <ImageIcon className="relative size-7 opacity-50" />
    </div>
  );
}

/**
 * The skeleton for an image that is still loading its record.
 *
 * Matches the ratio so the grid does not reflow when the data arrives — the
 * layout-shift rule in section 9.
 */
export function MediaSkeleton({
  ratio = 'product',
  className,
}: {
  ratio?: MediaRatio;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'bg-surface-sunken animate-shimmer w-full rounded-lg motion-reduce:animate-none',
        RATIOS[ratio],
        className,
      )}
    />
  );
}
