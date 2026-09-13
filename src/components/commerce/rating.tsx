'use client';

import { Star } from 'lucide-react';

import { cn } from '@/components/ui/cn';
import { Text } from '@/components/ui/typography';
import {
  RATING_MAX,
  averageAsNumber,
  distributionPercent,
  formatAverage,
  type RatingDistribution,
} from '@/domain/review';
import { useDictionary } from '@/i18n/client';
import type { Dictionary } from '@/i18n';

/**
 * Showing a rating.
 *
 * Two rules, both accessibility rather than decoration.
 *
 * **The stars are not the information.** Five glyphs of which three are filled
 * is a picture; it is announced as "4,3 sur 5, 12 avis" because a screen reader
 * cannot count fills, and because at a 200% zoom the fills are what break
 * first. The glyphs carry `aria-hidden` and the sentence carries the meaning.
 *
 * **A partial star is rounded for display only.** The stored average is an
 * integer × 100 and the text says exactly that; the fifth star is filled or not
 * on the nearest half, because a 63%-clipped glyph reads as a rendering bug on
 * a phone.
 *
 * No colour is introduced: the filled state is `--color-accent`, which
 * `DESIGN-SYSTEM.md` section 8 reserves for the things the customer is meant to
 * act on and the marks of quality. There is no literal here.
 */

export type StarRatingProps = {
  /** The stored average: an integer × 100, or null when nothing is rated. */
  average: number | null;
  count: number;
  size?: 'sm' | 'md';
  /** Hide the "(12 avis)" suffix where the count is stated nearby. */
  showCount?: boolean;
  className?: string;
};

function starLabel(average: number | null, count: number, t: Dictionary): string {
  if (average === null || count === 0) return t.review.noneYet;

  return t.review.averageOutOf(formatAverage(average) ?? '', RATING_MAX, count);
}

export function StarRating({
  average,
  count,
  size = 'md',
  showCount = true,
  className,
}: StarRatingProps) {
  const { t } = useDictionary();
  const value = averageAsNumber(average);
  const glyph = size === 'sm' ? 'size-3.5' : 'size-4';

  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span className="inline-flex items-center gap-0.5" aria-hidden="true">
        {Array.from({ length: RATING_MAX }, (_, index) => {
          // Half-up on the nearest whole star: 4.3 fills four, 4.6 fills five.
          const filled = value !== null && index + 1 <= Math.round(value);

          return (
            <Star
              key={index}
              className={cn(
                glyph,
                filled ? 'fill-accent text-accent' : 'text-border-strong',
              )}
            />
          );
        })}
      </span>

      <Text as="span" variant="body-sm" tone="muted" className="tabular-nums">
        {value === null || count === 0
          ? t.review.noneYet
          : showCount
            ? t.review.averageWithCount(formatAverage(average) ?? '', count)
            : formatAverage(average)}
      </Text>

      <span className="sr-only">{starLabel(average, count, t)}</span>
    </span>
  );
}

/**
 * One review's own rating.
 *
 * Separate from `StarRating` because the sentence is different: an aggregate is
 * "4,3 sur 5, 12 avis" and a single review is "Noté 4 sur 5". Reusing the
 * aggregate here would announce "4,00 sur 5, 1 avis", which is arithmetic
 * nobody asked for.
 */
export function ReviewStars({
  rating,
  className,
}: {
  rating: number;
  className?: string;
}) {
  const { t } = useDictionary();

  return (
    <span className={cn('inline-flex items-center gap-0.5', className)}>
      <span className="sr-only">{t.review.ratedOutOf(rating, RATING_MAX)}</span>

      {Array.from({ length: RATING_MAX }, (_, index) => (
        <Star
          key={index}
          aria-hidden="true"
          className={cn(
            'size-4',
            index < rating ? 'fill-accent text-accent' : 'text-border-strong',
          )}
        />
      ))}
    </span>
  );
}

/**
 * The distribution: how many people gave each number of stars.
 *
 * `ROADMAP.md` Phase 13 asks for it by name, and it is the part that makes a
 * rating readable: 4,2 from ten fives and two ones is a different product from
 * 4,2 from twelve fours, and only the distribution says which.
 *
 * A definition list rather than a table: each row is a term ("5 étoiles") and
 * its value ("8"), the bar is presentational, and the percentage is inside the
 * row's own text so the meaning survives with styles off.
 */
export type RatingBreakdownProps = {
  average: number | null;
  count: number;
  distribution: RatingDistribution;
  className?: string;
};

export function RatingBreakdown({
  average,
  count,
  distribution,
  className,
}: RatingBreakdownProps) {
  const { t } = useDictionary();

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-display-sm font-serif tabular-nums">
          {formatAverage(average) ?? '—'}
        </span>
        <StarRating average={average} count={count} showCount={false} />
      </div>

      <dl className="flex flex-col gap-1.5">
        {[5, 4, 3, 2, 1].map((stars) => {
          const occurrences = distribution[stars - 1] ?? 0;
          const percent = distributionPercent(distribution, stars, count);

          return (
            <div
              key={stars}
              className="grid grid-cols-[4.5rem_1fr_2.5rem] items-center gap-3"
            >
              <dt className="text-body-sm text-fg-muted">{t.review.starsRow(stars)}</dt>

              <div
                className="bg-surface-sunken h-2 overflow-hidden rounded-full"
                aria-hidden="true"
              >
                <div
                  className="bg-accent h-full rounded-full"
                  style={{ width: `${percent}%` }}
                />
              </div>

              <dd className="text-body-sm text-fg-subtle text-right tabular-nums">
                {occurrences}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
