import { type ReactNode } from 'react';

import { cn } from '@/components/ui/cn';
import { Link } from '@/components/ui/link';
import { Heading, Overline, Text } from '@/components/ui/typography';

/**
 * The page header, used by every admin screen and every account screen.
 *
 * Before Phase 14.5 each page hand-rolled a `Stack` with a `Heading` and a
 * `Text`, and no two agreed on the gap, the heading size or where the primary
 * action went. One component is the only way a dozen screens line up.
 *
 * The title is `display-md` in the admin and `display-lg` on the storefront's
 * account pages — that is the caller's choice through `size`, because an
 * operations screen wants its content above the fold and a customer page wants
 * to feel like a place rather than a form.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  size = 'md',
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Primary and secondary actions, right-aligned on desktop. */
  actions?: ReactNode;
  size?: 'md' | 'lg';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-8',
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-2">
        {eyebrow && <Overline as="p">{eyebrow}</Overline>}
        <Heading level={1} variant={size === 'lg' ? 'display-lg' : 'display-md'}>
          {title}
        </Heading>
        {description && (
          <Text variant="body-sm" tone="muted" className="max-w-prose">
            {description}
          </Text>
        )}
      </div>

      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

/**
 * A row of filter links.
 *
 * Links rather than a control, so a filtered queue is a URL the owner can
 * bookmark, share and return to — which is what a working queue has to be. The
 * pattern was copied by hand into three admin pages before this existed, each
 * with its own `aria-current` handling and its own hard-coded classes.
 */
export function FilterBar({
  label,
  children,
}: {
  /** Names the group for a screen reader: "Filtrer par statut". */
  label: string;
  children: ReactNode;
}) {
  return (
    <nav aria-label={label} className="-mx-1 overflow-x-auto px-1 pb-1">
      <ul className="flex list-none items-center gap-1 p-0">{children}</ul>
    </nav>
  );
}

export function FilterLink({
  href,
  current,
  count,
  shape = 'tight',
  children,
}: {
  href: string;
  current: boolean;
  /** Shown as a trailing figure. Omit rather than render a zero nobody needs. */
  count?: number;
  /**
   * `tight` in the workshop, `pill` on the storefront — ADR-042.
   *
   * This primitive is rendered by both halves of the product, which is exactly
   * the case that ADR names as the cost of splitting the radius scale: a shared
   * component has to be told which side it is on. The default is the
   * conservative one, so every admin list was unchanged when this was added.
   */
  shape?: 'tight' | 'pill';
  children: ReactNode;
}) {
  return (
    <li>
      <Link
        href={href}
        variant="plain"
        aria-current={current ? 'page' : undefined}
        className={cn(
          'text-body-sm flex items-center gap-2 whitespace-nowrap',
          'duration-fast transition-colors ease-out motion-reduce:transition-none',
          shape === 'pill'
            ? 'border-hairline min-h-10 rounded-full border px-4'
            : 'min-h-9 rounded-md px-3',
          current
            ? 'bg-fg text-fg-inverted border-fg font-medium'
            : 'text-fg-muted hover:bg-bg-sunken hover:text-fg',
        )}
      >
        {children}
        {count !== undefined && count > 0 && (
          <span
            className={cn(
              'text-mono-sm tabular-nums',
              current ? 'text-fg-on-dark-muted' : 'text-fg-subtle',
            )}
          >
            {count}
          </span>
        )}
      </Link>
    </li>
  );
}
