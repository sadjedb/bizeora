import { forwardRef, type ElementType, type ReactNode } from 'react';

import { cn } from '@/components/ui/cn';

/**
 * Typography primitives.
 *
 * The scale in `DESIGN-SYSTEM.md` section 3 is expressed as tokens, and these
 * components are how a caller reaches it. Two rules are enforced here rather
 * than left to discipline:
 *
 *   - The display serif is never used below 20px. `display-*` variants map to
 *     the serif; everything smaller maps to the text family.
 *   - Heading *level* and heading *size* are separate props. A section's third
 *     heading is an `h3` whatever size it looks best at, so the document
 *     outline stays correct (section 14: no skipped levels).
 */

export type TextVariant =
  | 'display-2xl'
  | 'display-xl'
  | 'display-lg'
  | 'display-md'
  | 'heading-lg'
  | 'heading-md'
  | 'heading-sm'
  | 'body-lg'
  | 'body'
  | 'body-sm'
  | 'caption'
  | 'overline'
  | 'mono'
  | 'mono-sm';

const VARIANTS: Record<TextVariant, string> = {
  'display-2xl': 'font-display text-display-2xl font-normal',
  'display-xl': 'font-display text-display-xl font-normal',
  'display-lg': 'font-display text-display-lg font-normal',
  'display-md': 'font-display text-display-md font-normal',
  'heading-lg': 'font-sans text-heading-lg font-semibold',
  'heading-md': 'font-sans text-heading-md font-semibold',
  'heading-sm': 'font-sans text-heading-sm font-semibold',
  'body-lg': 'font-sans text-body-lg font-normal',
  body: 'font-sans text-body font-normal',
  'body-sm': 'font-sans text-body-sm font-normal',
  caption: 'font-sans text-caption font-medium',
  overline: 'font-sans text-overline font-semibold uppercase',
  mono: 'font-mono text-mono font-normal',
  'mono-sm': 'font-mono text-mono-sm font-normal',
};

export type TextTone = 'default' | 'muted' | 'subtle' | 'accent' | 'onDark' | 'danger';

const TONES: Record<TextTone, string> = {
  default: 'text-fg',
  muted: 'text-fg-muted',
  subtle: 'text-fg-subtle',
  accent: 'text-accent',
  onDark: 'text-fg-on-dark',
  danger: 'text-status-negative',
};

export type TextProps = {
  variant?: TextVariant;
  tone?: TextTone;
  as?: ElementType;
  /** Clamp to n lines. Product names clamp at 2 (section 8). */
  clamp?: 1 | 2 | 3;
  /** Tabular figures — required in tables, prices and quantities (section 3). */
  numeric?: boolean;
  className?: string;
  children: ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, 'children' | 'className'>;

const CLAMP = { 1: 'line-clamp-1', 2: 'line-clamp-2', 3: 'line-clamp-3' } as const;

export const Text = forwardRef<HTMLElement, TextProps>(function Text(
  {
    variant = 'body',
    tone = 'default',
    as: Component = 'p',
    clamp,
    numeric = false,
    className,
    children,
    ...rest
  },
  ref,
) {
  return (
    <Component
      ref={ref}
      className={cn(
        VARIANTS[variant],
        TONES[tone],
        clamp && CLAMP[clamp],
        numeric && 'tabular-nums',
        className,
      )}
      {...rest}
    >
      {children}
    </Component>
  );
});

export type HeadingProps = Omit<TextProps, 'as'> & {
  /** The document level. Independent of the visual size. */
  level: 1 | 2 | 3 | 4 | 5 | 6;
};

const DEFAULT_SIZE_FOR_LEVEL: Record<number, TextVariant> = {
  1: 'display-lg',
  2: 'display-md',
  3: 'heading-lg',
  4: 'heading-md',
  5: 'heading-sm',
  6: 'heading-sm',
};

export const Heading = forwardRef<HTMLHeadingElement, HeadingProps>(function Heading(
  { level, variant, className, children, ...rest },
  ref,
) {
  const Tag = `h${level}` as ElementType;

  return (
    <Text
      ref={ref as React.Ref<HTMLElement>}
      as={Tag}
      variant={variant ?? DEFAULT_SIZE_FOR_LEVEL[level] ?? 'heading-md'}
      className={cn('text-balance', className)}
      {...rest}
    >
      {children}
    </Text>
  );
});

/**
 * Section eyebrow. The system's most recognisable typographic signature, and
 * for that reason limited to one per section (section 3).
 */
export function Overline({
  tone = 'subtle',
  className,
  children,
  ...rest
}: Omit<TextProps, 'variant'>) {
  return (
    <Text variant="overline" tone={tone} className={className} {...rest}>
      {children}
    </Text>
  );
}

/**
 * A form control's label.
 *
 * Always a real `<label>` with a real `htmlFor` (section 14). The optional
 * marker is shown rather than the required one when a form is mostly required,
 * which is the documented rule in section 8.
 */
export type LabelProps = {
  htmlFor: string;
  required?: boolean;
  optional?: boolean;
  className?: string;
  children: ReactNode;
};

export function Label({
  htmlFor,
  required = false,
  optional = false,
  className,
  children,
}: LabelProps) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn(
        'font-sans text-heading-sm text-fg inline-flex items-center gap-1 font-medium',
        className,
      )}
    >
      {children}
      {required && (
        <span className="text-status-negative" aria-hidden="true">
          *
        </span>
      )}
      {optional && (
        <span className="text-fg-subtle text-caption font-normal">(optionnel)</span>
      )}
    </label>
  );
}
