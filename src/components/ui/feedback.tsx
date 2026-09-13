import { Progress, Separator } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { type ComponentPropsWithoutRef, type ReactNode } from 'react';

import { cn } from '@/components/ui/cn';
import { Heading, Text } from '@/components/ui/typography';

/**
 * Feedback primitives: Alert, Badge, Progress, Skeleton, EmptyState, Separator.
 *
 * The rule that shapes all of them is section 8's: **colour is never the sole
 * carrier of meaning**. Every variant here pairs its colour with an icon, a
 * label, or both, so the component still works in greyscale and for a
 * colour-blind reader.
 */

/* ---------------------------------------------------------------------------
 * Alert — an inline message attached to a region of the page.
 * ------------------------------------------------------------------------ */

const alertVariants = cva('flex gap-3 rounded-md border p-4 text-left', {
  variants: {
    tone: {
      neutral: 'border-border bg-bg-subtle text-fg',
      info: 'border-status-progress/30 bg-status-progress-subtle text-fg',
      success: 'border-status-positive/30 bg-status-positive-subtle text-fg',
      warning: 'border-status-attention/30 bg-status-attention-subtle text-fg',
      danger: 'border-status-negative/30 bg-status-negative-subtle text-fg',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

const ALERT_ICONS = {
  neutral: Info,
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
} as const;

const ALERT_ICON_TONE = {
  neutral: 'text-fg-subtle',
  info: 'text-status-progress',
  success: 'text-status-positive',
  warning: 'text-status-attention',
  danger: 'text-status-negative',
} as const;

export type AlertProps = VariantProps<typeof alertVariants> & {
  title?: ReactNode;
  /** Rendered at the end. A single action, not a row of them. */
  action?: ReactNode;
  /**
   * Announce this alert when it appears.
   *
   * Defaults to true only for `danger`, because a live-region role on static
   * page content makes a screen reader read every alert on load. An error
   * interrupts; a standing note waits its turn (section 14).
   */
  live?: boolean;
  className?: string;
  children?: ReactNode;
};

export function Alert({
  tone = 'neutral',
  title,
  action,
  live,
  className,
  children,
}: AlertProps) {
  const key = tone ?? 'neutral';
  const Icon = ALERT_ICONS[key];
  const announce = live ?? key === 'danger';

  return (
    <div
      role={announce ? (key === 'danger' ? 'alert' : 'status') : undefined}
      className={cn(alertVariants({ tone }), className)}
    >
      <Icon
        className={cn('mt-0.5 size-5 shrink-0', ALERT_ICON_TONE[key])}
        aria-hidden="true"
      />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {title && (
          <Text variant="heading-sm" as="p">
            {title}
          </Text>
        )}
        {children && (
          <Text variant="body-sm" tone="muted" as="div">
            {children}
          </Text>
        )}
      </div>

      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Badge — the catalogue markers from section 8.
 * ------------------------------------------------------------------------ */

const badgeVariants = cva(
  [
    'inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5',
    'font-sans text-caption font-medium uppercase tracking-wide whitespace-nowrap',
  ],
  {
    variants: {
      variant: {
        /** "New", "Best seller". */
        solid: 'bg-fg text-fg-inverted',
        /** "Sale". */
        accentOutline: 'border border-accent text-accent',
        /** "Sold out". */
        muted: 'bg-status-neutral-subtle text-fg-muted',
        /** "Customisable". */
        accentSubtle: 'bg-accent-subtle text-accent',
        outline: 'border border-border-strong text-fg-muted',
      },
      /**
       * Status, for the admin.
       *
       * Separate from `variant` because the two answer different questions: a
       * storefront badge says what kind of thing this is ("Nouveau"), while an
       * operations badge says what state a record is in. Section 8 pairs every
       * status colour with a label, so the text always carries the meaning and
       * the tint only speeds up scanning — which is why these are subtle fills
       * rather than solid ones. A table of twenty solid badges is a rainbow.
       */
      tone: {
        neutral: 'bg-status-neutral-subtle text-fg-muted',
        progress: 'bg-status-progress-subtle text-status-progress',
        attention: 'bg-status-attention-subtle text-status-attention',
        positive: 'bg-status-positive-subtle text-status-positive',
        negative: 'bg-status-negative-subtle text-status-negative',
      },
    },
    defaultVariants: {},
  },
);

export type BadgeProps = VariantProps<typeof badgeVariants> & {
  className?: string;
  children: ReactNode;
};

export function Badge({ variant, tone, className, children }: BadgeProps) {
  // `solid` is the historical default and stays the default *only* when no
  // tone is asked for, so `<Badge tone="positive">` is not silently black.
  const resolved = variant ?? (tone ? undefined : 'solid');

  return (
    <span className={cn(badgeVariants({ variant: resolved, tone }), className)}>
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------------------
 * Progress
 * ------------------------------------------------------------------------ */

export type ProgressBarProps = {
  /** 0–100. Omit for an indeterminate bar. */
  value?: number;
  label: string;
  /** Show the percentage as text beside the label. */
  showValue?: boolean;
  className?: string;
};

export function ProgressBar({
  value,
  label,
  showValue = false,
  className,
}: ProgressBarProps) {
  const clamped = value === undefined ? undefined : Math.min(100, Math.max(0, value));

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {(label || showValue) && (
        <div className="flex items-baseline justify-between gap-2">
          <Text variant="body-sm" tone="muted" as="span">
            {label}
          </Text>
          {showValue && clamped !== undefined && (
            <Text variant="mono-sm" tone="subtle" as="span" numeric>
              {Math.round(clamped)}%
            </Text>
          )}
        </div>
      )}

      <Progress.Root
        value={clamped ?? null}
        aria-label={label}
        className="bg-surface-sunken relative h-1.5 w-full overflow-hidden rounded-full"
      >
        <Progress.Indicator
          className={cn(
            'bg-fg h-full transition-transform duration-base ease-out',
            'motion-reduce:transition-none',
            clamped === undefined && 'animate-pulse motion-reduce:animate-none',
          )}
          style={{ transform: `translateX(-${100 - (clamped ?? 40)}%)` }}
        />
      </Progress.Root>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Skeleton — a slow shimmer, disabled under reduced motion (section 10).
 * ------------------------------------------------------------------------ */

export type SkeletonProps = ComponentPropsWithoutRef<'div'>;

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'bg-surface-sunken animate-shimmer rounded-sm',
        'motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  );
}

/**
 * A skeleton standing in for a whole region.
 *
 * Loading is announced, not only shown (section 14): the live region carries
 * the message while the shimmer carries the shape.
 */
export function SkeletonRegion({
  label = 'Chargement…',
  className,
  children,
}: {
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * EmptyState — every list has one (section 12). Never a blank screen.
 * ------------------------------------------------------------------------ */

export type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  /** The way out. An empty state without one is a dead end. */
  action?: ReactNode;
  className?: string;
};

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'border-border flex flex-col items-center gap-4 rounded-md border border-dashed',
        'px-6 py-16 text-center',
        className,
      )}
    >
      {icon && (
        <div className="text-fg-subtle [&_svg]:size-8" aria-hidden="true">
          {icon}
        </div>
      )}

      <div className="flex max-w-prose flex-col gap-2">
        <Heading level={3} variant="heading-lg">
          {title}
        </Heading>
        {description && (
          <Text variant="body-sm" tone="muted">
            {description}
          </Text>
        )}
      </div>

      {action}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Separator — a hairline. Section 7: borders define surfaces, not shadows.
 * ------------------------------------------------------------------------ */

export type SeparatorProps = {
  orientation?: 'horizontal' | 'vertical';
  className?: string;
};

export function Divider({ orientation = 'horizontal', className }: SeparatorProps) {
  return (
    <Separator.Root
      orientation={orientation}
      decorative
      className={cn(
        'bg-border shrink-0',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
    />
  );
}
