'use client';

import { Tabs } from 'radix-ui';
import { ChevronLeft, ChevronRight, ChevronRight as Chevron } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';

import { cn } from '@/components/ui/cn';
import { Link } from '@/components/ui/link';
import { useDictionary } from '@/i18n/client';

/**
 * Navigation primitives: Breadcrumbs, Tabs, Pagination.
 *
 * Each renders the landmark or list structure a screen reader expects rather
 * than a row of styled divs — `nav` with an accessible name for breadcrumbs
 * and pagination, an ordered list for the trail, `aria-current` for the item
 * you are on (section 14).
 */

/* ---------------------------------------------------------------------------
 * Breadcrumbs
 * ------------------------------------------------------------------------ */

export type Crumb = { label: string; href?: string };

export function Breadcrumbs({
  items,
  className,
}: {
  items: readonly Crumb[];
  className?: string;
}) {
  return (
    <nav aria-label="Fil d'Ariane" className={className}>
      <ol className="text-body-sm text-fg-muted flex flex-wrap items-center gap-1.5">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;

          return (
            <Fragment key={`${item.label}-${index}`}>
              <li>
                {item.href && !isLast ? (
                  <Link href={item.href} variant="subtle">
                    {item.label}
                  </Link>
                ) : (
                  // The current page is not a link, and says so.
                  <span aria-current={isLast ? 'page' : undefined} className="text-fg">
                    {item.label}
                  </span>
                )}
              </li>

              {!isLast && (
                <li aria-hidden="true" className="text-fg-subtle flex items-center">
                  <Chevron className="size-3.5" />
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

/* ---------------------------------------------------------------------------
 * Tabs
 * ------------------------------------------------------------------------ */

export type TabItem = { value: string; label: string; content: ReactNode };

export function TabSet({
  items,
  defaultValue,
  className,
}: {
  items: readonly TabItem[];
  defaultValue?: string;
  className?: string;
}) {
  return (
    <Tabs.Root defaultValue={defaultValue ?? items[0]?.value} className={className}>
      <Tabs.List
        className={cn(
          'border-border flex gap-1 border-b',
          // Many tabs on a narrow screen scroll inside their own container
          // rather than widening the page (section 13).
          'overflow-x-auto',
        )}
      >
        {items.map((item) => (
          <Tabs.Trigger
            key={item.value}
            value={item.value}
            className={cn(
              'text-body-sm text-fg-muted relative shrink-0 px-3 py-3 font-medium',
              'transition-colors duration-fast ease-out',
              'hover:text-fg focus-visible:outline-none focus-visible:shadow-focus rounded-sm',
              'data-[state=active]:text-fg',
              // The active marker is a rule, not a colour change alone.
              'after:absolute after:inset-x-0 after:-bottom-px after:h-0.5',
              'data-[state=active]:after:bg-accent',
              'motion-reduce:transition-none',
            )}
          >
            {item.label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>

      {items.map((item) => (
        <Tabs.Content
          key={item.value}
          value={item.value}
          className="focus-visible:outline-none pt-6"
        >
          {item.content}
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}

/* ---------------------------------------------------------------------------
 * Pagination
 * ------------------------------------------------------------------------ */

/**
 * Page numbers with ellipses, never more than seven slots wide.
 *
 * Presentation only: it renders hrefs built by the caller and knows nothing
 * about how a list is queried.
 */
function pageWindow(current: number, total: number): (number | 'gap')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages: (number | 'gap')[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);

  if (start > 2) pages.push('gap');
  for (let page = start; page <= end; page += 1) pages.push(page);
  if (end < total - 1) pages.push('gap');

  pages.push(total);
  return pages;
}

export function Pagination({
  page,
  totalPages,
  hrefFor,
  className,
}: {
  page: number;
  totalPages: number;
  hrefFor: (page: number) => string;
  className?: string;
}) {
  const { t } = useDictionary();

  if (totalPages <= 1) return null;

  const slots = pageWindow(page, totalPages);
  const linkBase = cn(
    'inline-flex h-11 min-w-11 items-center justify-center rounded-sm px-3',
    'text-body-sm transition-colors duration-fast ease-out',
    'focus-visible:outline-none focus-visible:shadow-focus',
    'motion-reduce:transition-none',
  );

  return (
    <nav aria-label={t.a11y.pagination} className={className}>
      <ul className="flex flex-wrap items-center justify-center gap-1">
        <li>
          {page > 1 ? (
            <Link
              href={hrefFor(page - 1)}
              variant="plain"
              aria-label={t.a11y.previousPage}
              className={cn(linkBase, 'text-fg-muted hover:bg-bg-subtle hover:text-fg')}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </Link>
          ) : (
            <span
              className={cn(linkBase, 'text-fg-subtle opacity-40')}
              aria-hidden="true"
            >
              <ChevronLeft className="size-4" />
            </span>
          )}
        </li>

        {slots.map((slot, index) =>
          slot === 'gap' ? (
            <li key={`gap-${index}`} aria-hidden="true" className="text-fg-subtle px-1">
              …
            </li>
          ) : (
            <li key={slot}>
              <Link
                href={hrefFor(slot)}
                variant="plain"
                aria-label={t.a11y.pageNumber(slot)}
                aria-current={slot === page ? 'page' : undefined}
                className={cn(
                  linkBase,
                  'tabular-nums',
                  slot === page
                    ? 'bg-fg text-fg-inverted'
                    : 'text-fg-muted hover:bg-bg-subtle hover:text-fg',
                )}
              >
                {slot}
              </Link>
            </li>
          ),
        )}

        <li>
          {page < totalPages ? (
            <Link
              href={hrefFor(page + 1)}
              variant="plain"
              aria-label={t.a11y.nextPage}
              className={cn(linkBase, 'text-fg-muted hover:bg-bg-subtle hover:text-fg')}
            >
              <ChevronRight className="size-4" aria-hidden="true" />
            </Link>
          ) : (
            <span
              className={cn(linkBase, 'text-fg-subtle opacity-40')}
              aria-hidden="true"
            >
              <ChevronRight className="size-4" />
            </span>
          )}
        </li>
      </ul>
    </nav>
  );
}
