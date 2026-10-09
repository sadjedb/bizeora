import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { cn } from '@/components/ui/cn';

/**
 * Button.
 *
 * The variants and sizes are exactly those in `DESIGN-SYSTEM.md` section 8.
 * Three behaviours there are load-bearing and are implemented rather than left
 * to the caller:
 *
 *   - **Loading preserves width.** The label stays and the spinner replaces the
 *     leading icon, so the layout does not jump. The control is `aria-busy` and
 *     disabled while it runs.
 *   - **Focus is always visible.** `--shadow-focus` on `:focus-visible`, never
 *     removed. Section 14 prohibits an outline reset without a replacement.
 *   - **Weight is 500, never 700.** Bold buttons read as shouting.
 *
 * A disabled primary action must be accompanied by a reason in text. That is a
 * page's responsibility, but it is why `disabled` is never set silently here.
 */

export const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap',
    'font-sans font-medium',
    'border border-transparent',
    'transition-[background-color,border-color,color,transform]',
    'duration-fast ease-out',
    'cursor-pointer select-none',
    'focus-visible:outline-none focus-visible:shadow-focus',
    // Active nudges down. No scale — scaling a button reads as a toy.
    'active:translate-y-px',
    'disabled:pointer-events-none disabled:opacity-40 disabled:cursor-not-allowed',
    'motion-reduce:transition-none motion-reduce:active:translate-y-0',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-fg text-fg-inverted hover:bg-fg-hover',
        secondary: 'border-border-strong text-fg bg-transparent hover:bg-hover',
        accent: 'bg-accent text-fg-on-accent hover:bg-accent-hover',
        ghost: 'text-fg-muted bg-transparent hover:bg-hover hover:text-fg',
        link: 'text-accent bg-transparent underline-offset-4 hover:underline p-0 h-auto',
        danger:
          'border-status-negative text-status-negative bg-transparent hover:bg-status-negative-subtle',
        /** Solid destructive. Only inside a confirmation dialog (section 8). */
        dangerSolid: 'bg-status-negative text-fg-on-accent hover:opacity-90',
      },
      size: {
        sm: 'h-8 px-3 text-body-sm',
        md: 'h-10 px-4 text-body-sm',
        lg: 'h-12 px-6 text-body',
        xl: 'h-14 px-8 text-body-lg',
      },
      /**
       * Corner treatment, and the one place the two halves of the product are
       * allowed to look different (ADR-042).
       *
       * `tight` is the system's original 3px and stays the default, so the
       * workshop — where a screen is an instrument and a soft control reads as
       * a toy — did not change at all when this was added. `pill` is the
       * storefront's call to action.
       *
       * It is a variant rather than a token change because those are genuinely
       * two decisions: `--radius-md` is "how round is a control", and this is
       * "which side of the product is the control on".
       */
      shape: {
        tight: 'rounded-md',
        pill: 'rounded-full',
      },
      fullWidth: {
        true: 'w-full',
        false: '',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md', shape: 'tight', fullWidth: false },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    /** Render as the single child element — a Next `Link`, typically. */
    asChild?: boolean;
    loading?: boolean;
    /** Replaced by the spinner while loading. */
    leadingIcon?: ReactNode;
    trailingIcon?: ReactNode;
  };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant,
    size,
    shape,
    fullWidth,
    asChild = false,
    loading = false,
    leadingIcon,
    trailingIcon,
    disabled,
    children,
    type,
    ...props
  },
  ref,
) {
  if (asChild) {
    /**
     * `Slot` clones a single element child, so the spinner and icon slots
     * cannot be rendered alongside it — `React.Children.only` throws. A caller
     * using `asChild` owns its own content, and anything needing a spinner is
     * an action rather than a link and should be a real button.
     */
    return (
      <Slot.Root
        ref={ref}
        className={cn(buttonVariants({ variant, size, shape, fullWidth }), className)}
        {...props}
      >
        {children}
      </Slot.Root>
    );
  }

  return (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size, shape, fullWidth }), className)}
      // A button inside a form defaults to submit, which is rarely intended.
      type={type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <Loader2
          className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
      ) : (
        leadingIcon
      )}
      {children}
      {!loading && trailingIcon}
    </button>
  );
});

/**
 * A button whose entire content is an icon.
 *
 * `label` is required and becomes the accessible name — section 11 allows an
 * icon to stand alone only for universally understood actions, and only with a
 * label. Making the prop mandatory is how that stops being a convention.
 */
export type IconButtonProps = Omit<ButtonProps, 'children' | 'fullWidth'> & {
  label: string;
  children: ReactNode;
};

const ICON_SIZES = { sm: 'size-8', md: 'size-10', lg: 'size-12', xl: 'size-14' } as const;

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton({ label, size = 'md', className, children, ...props }, ref) {
    return (
      <Button
        ref={ref}
        size={size}
        aria-label={label}
        className={cn('px-0', ICON_SIZES[size ?? 'md'], className)}
        {...props}
      >
        {children}
      </Button>
    );
  },
);
