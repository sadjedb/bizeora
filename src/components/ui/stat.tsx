import { type ReactNode } from 'react';

import { cn } from '@/components/ui/cn';
import { Link } from '@/components/ui/link';
import { Text } from '@/components/ui/typography';

/**
 * Operational figures.
 *
 * `UX.md` section 9: the dashboard answers "what needs me now", and
 * `PRODUCT.md` puts analytics in V2 — so a tile here is never a vanity metric.
 * Every one is the length of a queue somebody has to work, and every one is a
 * link to that queue. A figure that leads nowhere is a decoration, and the
 * brief for this phase names gradient KPI cards as the thing to avoid.
 *
 * The treatment is deliberately flat: a hairline-separated cell on the page
 * ground, a tabular figure at `display-md`, a label above it. No card, no
 * shadow, no icon tile, no coloured background — the number is the only thing
 * on the tile that should attract the eye, and `tone` tints only the figure.
 */

export type StatTone = 'default' | 'attention' | 'negative';

const TONE: Record<StatTone, string> = {
  default: 'text-fg',
  attention: 'text-status-attention',
  negative: 'text-status-negative',
};

export function StatGrid({ children }: { children: ReactNode }) {
  return (
    <div
      className={cn(
        'border-border bg-surface grid grid-cols-2 rounded-md border',
        'divide-hairline divide-x divide-y',
        'lg:grid-cols-4 lg:divide-y-0',
      )}
    >
      {children}
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  href,
  tone = 'default',
}: {
  label: string;
  value: number | string;
  /** One short line under the figure. What the number means, not a trend. */
  hint?: string;
  href?: string;
  tone?: StatTone;
}) {
  const body = (
    <>
      <Text variant="overline" as="span" tone="subtle">
        {label}
      </Text>
      <span
        className={cn(
          'font-display text-display-md tabular-nums',
          // A zero is good news on a queue tile, so it is never alarming.
          value === 0 ? 'text-fg-subtle' : TONE[tone],
        )}
      >
        {value}
      </span>
      {hint && (
        <Text variant="caption" tone="subtle" as="span">
          {hint}
        </Text>
      )}
    </>
  );

  const shell = 'flex flex-col gap-1 p-4 lg:p-5';

  if (!href) return <div className={shell}>{body}</div>;

  return (
    <Link
      href={href}
      variant="plain"
      className={cn(
        shell,
        'hover:bg-bg-subtle duration-fast transition-colors ease-out',
        'motion-reduce:transition-none',
      )}
    >
      {body}
    </Link>
  );
}
