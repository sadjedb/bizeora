import type { ReactNode } from 'react';

import { cn } from '@/components/ui/cn';

/**
 * The redesign's three continuous gestures.
 *
 * `DESIGN-SYSTEM.md` section 10 catalogued motion that *responds* to something
 * — a hover, a dialog, a toast. Phase 16 adds the opposite kind: motion that is
 * simply running when you arrive. Three of them, and the list is closed, because
 * the fourth is where a page starts to feel like a demo reel.
 *
 * **Every one of them is CSS.** No component here ships a byte of JavaScript, no
 * `useEffect`, no `IntersectionObserver`, no measurement — which is why they can
 * all be server components and why a page built from them costs the same as a
 * page built from `<div>`s. That is not frugality for its own sake: the
 * storefront renders per request under the nonce policy (ADR-041), so anything
 * that would have to hydrate before it looked right would be visibly late.
 *
 * ## Reduced motion
 *
 * `globals.css` crushes every animation to 0.01ms under
 * `prefers-reduced-motion: reduce`. For a finite animation that is the same as
 * removing it. For an *infinite* one it is not — it is the same animation
 * running at three thousand frames of progress per second, which is the single
 * worst thing to show somebody who asked for less motion. So the two infinite
 * components below carry `motion-reduce:animate-none` themselves — asserted in
 * `tests/components/primitives.test.tsx`, because it is the kind of class that
 * gets dropped in a refactor and never noticed by anybody who does not have the
 * setting on. The scroll reveal cannot be tested the same way: its guard is a
 * `@media` block in `globals.css` rather than a class, and jsdom does not
 * evaluate stylesheets.
 */

/* -------------------------------------------------------------------------
 * Marquee
 * ---------------------------------------------------------------------- */

export type MarqueeTone = 'ink' | 'accent' | 'subtle';

const MARQUEE_TONES: Record<MarqueeTone, string> = {
  ink: 'bg-bg-inverse text-fg-on-dark',
  accent: 'bg-accent text-fg-on-accent',
  subtle: 'bg-bg-subtle text-fg',
};

export type MarqueeProps = {
  /** The words. Short ones — this is a strip, not a sentence. */
  items: readonly string[];
  tone?: MarqueeTone;
  /** Travel right-to-left instead. Two stacked strips should disagree. */
  reverse?: boolean;
  /**
   * Tilt the band off the horizontal, the way a printed banner lies.
   *
   * The band is rendered wider than its container and pulled back by the
   * overhang, because a rotated rectangle that is exactly as wide as the page
   * leaves two triangles of background at the ends.
   */
  tilt?: boolean;
  /**
   * Seconds for one full cycle. Omit it.
   *
   * The default is derived from how much text is in the strip, so that four
   * words and twelve words travel at the same *speed* rather than taking the
   * same *time* — a fixed duration makes a long strip sprint and a short one
   * crawl, and both read as a mistake. Roughly 55 characters per second, which
   * is fast enough to be alive and slow enough to read.
   */
  durationSeconds?: number;
  className?: string;
};

export function Marquee({
  items,
  tone = 'ink',
  reverse = false,
  tilt = false,
  durationSeconds,
  className,
}: MarqueeProps) {
  if (items.length === 0) return null;

  const characters = items.join('').length;
  const seconds = durationSeconds ?? Math.min(90, Math.max(18, characters * 0.75));

  return (
    <div
      className={cn(
        'relative isolate overflow-hidden select-none',
        'py-3 md:py-4',
        MARQUEE_TONES[tone],
        tilt && 'w-[108%] -translate-x-[4%] -rotate-[2.2deg]',
        className,
      )}
    >
      <div
        className={cn(
          'flex w-max animate-marquee',
          // Reading the strip is the point; let a pointer stop it.
          'hover:[animation-play-state:paused]',
          reverse && '[animation-direction:reverse]',
          'motion-reduce:animate-none',
        )}
        style={{ '--marquee-duration': `${seconds}s` } as React.CSSProperties}
      >
        {/*
         * Twice, and the keyframe travels exactly -50%. The second copy is
         * hidden from assistive technology: it is the same words, and a screen
         * reader announcing the strip twice is the accessibility cost of this
         * whole pattern if you forget.
         */}
        <MarqueeRun items={items} />
        <MarqueeRun items={items} aria-hidden="true" />
      </div>
    </div>
  );
}

function MarqueeRun({
  items,
  ...rest
}: { items: readonly string[] } & React.HTMLAttributes<HTMLUListElement>) {
  return (
    <ul className="flex shrink-0 items-center" {...rest}>
      {items.map((item, index) => (
        <li key={`${item}-${index}`} className="flex items-center">
          <span className="font-display text-display-md px-6 whitespace-nowrap md:px-10">
            {item}
          </span>
          <Asterisk />
        </li>
      ))}
    </ul>
  );
}

/**
 * The separator between marquee items.
 *
 * A four-point star rather than a bullet or a slash: it is the mark an
 * embroidery digitiser puts at a registration point, and it is the one piece of
 * decoration in the system that is allowed to be purely decorative.
 */
function Asterisk() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-3 shrink-0 opacity-70 md:size-4"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 0c.6 5.9 5.5 10.8 11.4 11.4v1.2C17.5 13.2 12.6 18.1 12 24h-1.2C10.2 18.1 5.3 13.2-.6 12.6v-1.2C5.3 10.8 10.2 5.9 10.8 0z" />
    </svg>
  );
}

/* -------------------------------------------------------------------------
 * Spinning badge
 * ---------------------------------------------------------------------- */

/**
 * How many characters go round the ring once.
 *
 * Derived, not guessed: the path is a circle of radius 42 in a 100-unit
 * viewBox, so its circumference is 2π × 42 ≈ 264 units. At `font-size` 9.5 with
 * `letter-spacing` 0.18em an average Latin character advances about 6.5 units.
 * 264 / 6.5 ≈ 40.
 *
 * It matters because `textPath` does not wrap or shrink: text longer than the
 * path keeps going round and overprints itself, which is a smeared ring rather
 * than an obviously broken one — the kind of bug that ships.
 */
const RING_CHARACTERS = 40;

export type SpinningBadgeProps = {
  /**
   * The ring of text, with its own separator — "BRODÉ À LA MAIN · ".
   *
   * It is repeated only as many times as fit, so a two-word phrase circles the
   * badge several times and a sentence circles it once. Anything much past
   * forty characters is simply too long for a badge this size and will be cut
   * where the circle closes.
   */
  text: string;
  /** Diameter in pixels. */
  size?: number;
  /** Seconds per revolution. */
  durationSeconds?: number;
  /** What sits in the middle. An icon, a number, or nothing. */
  children?: ReactNode;
  className?: string;
};

export function SpinningBadge({
  text,
  size = 128,
  durationSeconds = 22,
  children,
  className,
}: SpinningBadgeProps) {
  /*
   * The ring is a circle drawn as two arcs, because a single `A` command
   * cannot describe 360° — the start and end points would coincide and the
   * renderer has no way to know which way round to go.
   */
  const r = 42;
  const ring = `M 50 ${50 - r} A ${r} ${r} 0 1 1 50 ${50 + r} A ${r} ${r} 0 1 1 50 ${50 - r}`;

  const repeats = Math.max(1, Math.floor(RING_CHARACTERS / Math.max(1, text.length)));

  return (
    <div
      className={cn('relative grid shrink-0 place-items-center', className)}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 100 100"
        className="animate-spin-slow absolute inset-0 size-full motion-reduce:animate-none"
        style={{ '--spin-duration': `${durationSeconds}s` } as React.CSSProperties}
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <path id={`badge-ring-${r}`} d={ring} fill="none" />
        </defs>
        <text
          className="fill-current font-sans"
          style={{ fontSize: 9.5, letterSpacing: '0.18em', fontWeight: 600 }}
        >
          <textPath href={`#badge-ring-${r}`}>{text.repeat(repeats)}</textPath>
        </text>
      </svg>

      {children ? <span className="relative">{children}</span> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Scroll reveal
 * ---------------------------------------------------------------------- */

export type RevealProps = {
  children: ReactNode;
  /**
   * How far into the viewport the element is before it has finished arriving,
   * as a percentage of the scroll range. Larger is lazier.
   */
  distance?: 'near' | 'far';
  className?: string;
};

/**
 * A 16px rise and a fade as the element scrolls into view — section 10's
 * "scroll reveal", at last implemented, and implemented with no JavaScript.
 *
 * The animation is driven by a **view timeline** rather than an
 * `IntersectionObserver`: progress through the keyframes is progress through
 * the viewport, so there is no observer to register, no state to hydrate and no
 * flash of hidden content before the client catches up. Where
 * `animation-timeline` is unsupported, the `@supports` guard in `globals.css`
 * means the element is simply *there* — which is the correct degradation for a
 * decoration, and the reason this is safe to use on marketing copy.
 *
 * Not in the application. Section 10 says scroll reveals belong on marketing
 * surfaces only, and a product list that fades its rows in is a product list
 * that feels slow.
 */
export function Reveal({ children, distance = 'near', className }: RevealProps) {
  return (
    <div className={cn(distance === 'far' ? 'reveal-far' : 'reveal', className)}>
      {children}
    </div>
  );
}
