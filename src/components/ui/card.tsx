import { type ElementType, type ReactNode } from 'react';

import { cn } from '@/components/ui/cn';
import { Heading, Text } from '@/components/ui/typography';

/**
 * Card.
 *
 * "A bordered white rectangle on warm paper — not a floating shadow box"
 * (section 7). There is deliberately no `elevated` variant: shadows are for
 * things that genuinely float, and a card sitting in the page is not one of
 * them. If a card ever needs to lift, the image lifts, not the card.
 */

export type CardProps = {
  /** `interactive` adds the hover treatment for a whole-card link or button. */
  interactive?: boolean;
  padding?: 'none' | 'compact' | 'default';
  as?: ElementType;
  className?: string;
  children: ReactNode;
};

const PADDING = {
  none: '',
  /** Admin density — steps 3–4 (section 12). */
  compact: 'p-4',
  /** Storefront — steps 5–6 (section 8). */
  default: 'p-5 md:p-6',
} as const;

export function Card({
  interactive = false,
  padding = 'default',
  as: Component = 'div',
  className,
  children,
}: CardProps) {
  return (
    <Component
      className={cn(
        'bg-surface border-border rounded-md border',
        PADDING[padding],
        interactive && [
          'transition-colors duration-fast ease-out',
          'hover:border-border-strong',
          'focus-within:shadow-focus',
          'motion-reduce:transition-none',
        ],
        className,
      )}
    >
      {children}
    </Component>
  );
}

export function CardHeader({
  title,
  description,
  action,
  level = 3,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Rendered top-right. A status badge, or one action. */
  action?: ReactNode;
  level?: 2 | 3 | 4;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <Heading level={level} variant="heading-md">
          {title}
        </Heading>
        {description && (
          <Text variant="body-sm" tone="muted">
            {description}
          </Text>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** Content blocks inside a card sit 4 apart (section 5). */
export function CardBody({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn('flex flex-col gap-4', className)}>{children}</div>;
}

export function CardFooter({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('border-border flex items-center gap-3 border-t pt-4', className)}>
      {children}
    </div>
  );
}
