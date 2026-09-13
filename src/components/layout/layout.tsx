import { type ElementType, type ReactNode } from 'react';

import { cn } from '@/components/ui/cn';

/**
 * Layout primitives.
 *
 * These exist so that spacing decisions are made once, here, rather than as a
 * scattering of one-off margins across pages. `DESIGN-SYSTEM.md` section 5 is
 * explicit that under-spacing is the usual failure, and section 6 fixes the
 * container widths, so both live in props rather than in a caller's judgement.
 *
 * All of them are server components. Nothing here holds state.
 */

/* ---------------------------------------------------------------------------
 * Container — the horizontal frame. Gutters step 16 / 24 / 40 with viewport.
 * ------------------------------------------------------------------------ */

export type ContainerWidth = 'page' | 'content' | 'prose' | 'narrow' | 'full';

const CONTAINER_WIDTHS: Record<ContainerWidth, string> = {
  page: 'max-w-page',
  content: 'max-w-content',
  prose: 'max-w-prose',
  narrow: 'max-w-narrow',
  /** Full-bleed: no max width and no gutters. Heroes and gallery bands. */
  full: 'max-w-none',
};

export type ContainerProps = {
  width?: ContainerWidth;
  /** Drop the horizontal padding, for a section that manages its own. */
  bleed?: boolean;
  as?: ElementType;
  className?: string;
  children: ReactNode;
};

export function Container({
  width = 'content',
  bleed = false,
  as: Component = 'div',
  className,
  children,
}: ContainerProps) {
  return (
    <Component
      className={cn(
        'mx-auto w-full',
        CONTAINER_WIDTHS[width],
        !bleed && 'px-4 md:px-6 lg:px-10',
        className,
      )}
    >
      {children}
    </Component>
  );
}

/* ---------------------------------------------------------------------------
 * Section — vertical rhythm between page sections.
 * ------------------------------------------------------------------------ */

export type SectionSpacing = 'compact' | 'default' | 'editorial' | 'none';

const SECTION_SPACING: Record<SectionSpacing, string> = {
  /** Between subsections — step 12. */
  compact: 'py-12',
  /** Between page sections — 20 mobile / 32 desktop. */
  default: 'py-20 lg:py-32',
  /** Between major editorial sections — 24 mobile / 40 desktop. */
  editorial: 'py-24 lg:py-40',
  none: '',
};

export type SectionProps = {
  spacing?: SectionSpacing;
  as?: ElementType;
  className?: string;
  children: ReactNode;
};

export function Section({
  spacing = 'default',
  as: Component = 'section',
  className,
  children,
}: SectionProps) {
  return (
    <Component className={cn(SECTION_SPACING[spacing], className)}>{children}</Component>
  );
}

/* ---------------------------------------------------------------------------
 * Stack — vertical flow. The workhorse.
 * ------------------------------------------------------------------------ */

/** Steps from the 4px scale in DESIGN-SYSTEM.md section 5. */
export type SpaceStep = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12 | 16 | 20 | 24;

const GAP: Record<SpaceStep, string> = {
  0: 'gap-0',
  1: 'gap-1',
  2: 'gap-2',
  3: 'gap-3',
  4: 'gap-4',
  5: 'gap-5',
  6: 'gap-6',
  8: 'gap-8',
  10: 'gap-10',
  12: 'gap-12',
  16: 'gap-16',
  20: 'gap-20',
  24: 'gap-24',
};

const ALIGN = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
  stretch: 'items-stretch',
  baseline: 'items-baseline',
} as const;

const JUSTIFY = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
  between: 'justify-between',
} as const;

export type StackProps = {
  gap?: SpaceStep;
  align?: keyof typeof ALIGN;
  justify?: keyof typeof JUSTIFY;
  as?: ElementType;
  className?: string;
  children: ReactNode;
};

export function Stack({
  gap = 4,
  align,
  justify,
  as: Component = 'div',
  className,
  children,
}: StackProps) {
  return (
    <Component
      className={cn(
        'flex flex-col',
        GAP[gap],
        align && ALIGN[align],
        justify && JUSTIFY[justify],
        className,
      )}
    >
      {children}
    </Component>
  );
}

/* ---------------------------------------------------------------------------
 * Inline — horizontal flow. Wraps by default, because a row of chips on a
 * 375px screen that refuses to wrap is a horizontal scrollbar (section 13).
 * ------------------------------------------------------------------------ */

export type InlineProps = StackProps & { wrap?: boolean };

export function Inline({
  gap = 2,
  align = 'center',
  justify,
  wrap = true,
  as: Component = 'div',
  className,
  children,
}: InlineProps) {
  return (
    <Component
      className={cn(
        'flex flex-row',
        wrap ? 'flex-wrap' : 'flex-nowrap',
        GAP[gap],
        ALIGN[align],
        justify && JUSTIFY[justify],
        className,
      )}
    >
      {children}
    </Component>
  );
}

/* ---------------------------------------------------------------------------
 * Grid — the documented responsive column counts, as named presets rather
 * than a free-form column prop, so a product grid is 2/3/4 everywhere.
 * ------------------------------------------------------------------------ */

export type GridPreset = 'products' | 'categories' | 'gallery' | 'halves' | 'thirds';

const GRID_PRESETS: Record<GridPreset, string> = {
  /** Product grid: 2 up mobile, 3 tablet, 4 desktop (section 6). */
  products: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4',
  /** Category cards: 1 mobile, 2 tablet, 3 desktop. */
  categories: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  /** Gallery: 1 / 2 / 3. */
  gallery: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  halves: 'grid-cols-1 md:grid-cols-2',
  thirds: 'grid-cols-1 md:grid-cols-3',
};

export type GridProps = {
  preset?: GridPreset;
  /** 4 on mobile, 6 on desktop for card grids (section 5). */
  gap?: SpaceStep;
  className?: string;
  children: ReactNode;
};

export function Grid({ preset = 'products', gap, className, children }: GridProps) {
  return (
    <div
      className={cn(
        'grid',
        GRID_PRESETS[preset],
        gap === undefined ? 'gap-4 lg:gap-6' : GAP[gap],
        className,
      )}
    >
      {children}
    </div>
  );
}
