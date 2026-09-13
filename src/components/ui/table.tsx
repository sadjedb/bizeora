import { type ReactNode } from 'react';

import { cn } from '@/components/ui/cn';
import { Link } from '@/components/ui/link';
import { Text } from '@/components/ui/typography';

/**
 * The data table.
 *
 * The admin is an operations tool and an operations tool is read in rows, not
 * in cards. Phase 14.5 replaced every admin list — orders, requests, quotes,
 * customers, products, stock — with this component, because a stack of bordered
 * cards costs six times the vertical space per record and gives the eye no
 * column to run down.
 *
 * **One markup, two representations.** The element is always a real `<table>`,
 * so the header cells are announced with their data and keyboard order is the
 * reading order. Below `md` the rows become stacked blocks and each cell prints
 * its own column heading from `data-label`; the `<thead>` goes `sr-only` rather
 * than `display: none`, so the table keeps its structure for a screen reader.
 * `DESIGN-SYSTEM.md` section 13 forbids the alternative — a 900px table inside
 * a horizontal scroller on a 375px screen, where the columns that matter are
 * the ones off the right edge.
 *
 * **Rows are hairlines, not boxes.** `--color-hairline` separates rows without
 * drawing a grid over the data (section 4).
 */

export function Table({
  caption,
  className,
  children,
}: {
  /** Visually hidden by default; it names the table for a screen reader. */
  caption: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <table
      className={cn(
        'text-body-sm w-full border-collapse text-left',
        'max-md:block',
        className,
      )}
    >
      <caption className="sr-only">{caption}</caption>
      {children}
    </table>
  );
}

export function TableHead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-border text-fg-subtle border-b max-md:sr-only">
      {children}
    </thead>
  );
}

export function TableBody({ children }: { children: ReactNode }) {
  return <tbody className="max-md:flex max-md:flex-col max-md:gap-3">{children}</tbody>;
}

export type ColumnAlign = 'start' | 'end';

const ALIGN: Record<ColumnAlign, string> = {
  start: 'text-left',
  end: 'text-right md:text-right',
};

export function TableHeaderCell({
  align = 'start',
  numeric = false,
  className,
  children,
}: {
  align?: ColumnAlign;
  numeric?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <th
      scope="col"
      className={cn(
        'text-overline text-fg-subtle px-3 py-2.5 font-semibold uppercase',
        ALIGN[align],
        numeric && 'tabular-nums',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function TableRow({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <tr
      className={cn(
        'border-hairline relative border-b last:border-b-0',
        'duration-fast transition-colors ease-out motion-reduce:transition-none',
        'md:hover:bg-bg-subtle focus-within:bg-bg-subtle',
        // Stacked representation: the row becomes its own bordered block.
        'max-md:bg-surface max-md:border-border max-md:flex max-md:flex-col',
        'max-md:gap-1.5 max-md:rounded-md max-md:border max-md:p-4',
        className,
      )}
    >
      {children}
    </tr>
  );
}

export function TableCell({
  label,
  align = 'start',
  numeric = false,
  /** Suppress the stacked-view label row for a cell that speaks for itself. */
  bare = false,
  className,
  children,
}: {
  /** The column heading, reprinted beside this cell in the stacked view. */
  label: string;
  align?: ColumnAlign;
  numeric?: boolean;
  bare?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <td
      data-label={label}
      className={cn(
        'px-3 py-3 align-middle',
        ALIGN[align],
        numeric && 'tabular-nums',
        'max-md:flex max-md:items-baseline max-md:justify-between max-md:gap-4',
        'max-md:px-0 max-md:py-0 max-md:text-left',
        !bare && [
          'max-md:before:text-overline max-md:before:text-fg-subtle',
          'max-md:before:shrink-0 max-md:before:uppercase',
          'max-md:before:content-[attr(data-label)]',
        ],
        className,
      )}
    >
      {/*
       * A cell usually holds a value and a second line under it. In the stacked
       * view the label is a `::before` on the same flex row, so without this
       * wrapper the value and its second line become two more items on that row
       * and sit side by side. `contents` from `md` up means the wrapper does not
       * exist as far as the table layout is concerned.
       */}
      <span className="max-md:flex max-md:min-w-0 max-md:flex-col max-md:items-end max-md:text-right md:contents">
        {children}
      </span>
    </td>
  );
}

/**
 * The row's primary cell: the identifier, and the link that opens the record.
 *
 * The anchor stretches over the whole row (`after:absolute inset-0`) so the
 * entire row is a click target, while remaining exactly one tab stop with a
 * real href. Any control that must stay clickable inside the row sits above it
 * with `relative z-10` — `TableRowAction` does that.
 */
export function TableRowLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      variant="plain"
      className={cn(
        'text-fg font-medium after:absolute after:inset-0',
        'hover:text-accent duration-fast transition-colors ease-out',
        'motion-reduce:transition-none',
        className,
      )}
    >
      {children}
    </Link>
  );
}

/** Anything interactive that must sit above a `TableRowLink`'s overlay. */
export function TableRowAction({ children }: { children: ReactNode }) {
  return <span className="relative z-10 inline-flex items-center gap-2">{children}</span>;
}

/**
 * A secondary line under the identifier — the customer, the date, the SKU.
 *
 * Two facts in one column is what keeps a table at seven columns instead of
 * eleven, which is the difference between scanning and scrolling.
 */
export function TableCellMeta({ children }: { children: ReactNode }) {
  return (
    <Text variant="caption" tone="subtle" as="span" className="mt-0.5 block">
      {children}
    </Text>
  );
}

/**
 * A toolbar above a table: filters on the left, actions on the right.
 *
 * It is `sticky` nowhere and scrolls with the page — a filter bar pinned over a
 * long queue eats the top of the viewport on a laptop, which is where this
 * screen is used.
 */
export function TableToolbar({
  children,
  actions,
}: {
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0 flex-1">{children}</div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
