import { brand } from '@/config/brand';
import { cn } from '@/components/ui/cn';

/**
 * The opening — a line of running stitch laid under the mark.
 *
 * The reference site opens on a brand panel before the page arrives, and the
 * owner asked for the same thing in this shop's own language. That language is
 * thread: the mark rises, a dashed line is stitched left to right beneath it,
 * and the panel lifts away. Dashes rather than a solid rule because a running
 * stitch is literally a dashed line — it is the first thing anybody learns to
 * sew, and it is the only mark in the system that means *embroidery* without a
 * caption.
 *
 * ## Four rules, and they are the whole design
 *
 * **It never hides the page from somebody who cannot see it leave.** The panel
 * is `pointer-events: none` for its entire life, the markup is `aria-hidden`,
 * and the animation ends at `visibility: hidden` so it leaves the accessibility
 * tree and hit-testing completely. A visitor can click a link through it on the
 * first frame if they know where it is.
 *
 * **It is opt-in, and the default is off.** The panel is `display: none` until
 * `IntroScript` stamps `data-intro="play"` on the document. So a browser with
 * JavaScript off, a blocked script, or a CSP that refuses the nonce gets the
 * page immediately rather than a blank ivory rectangle that never leaves. The
 * failure mode of an intro must never be "the shop is gone".
 *
 * **Once per session, not once per navigation.** The flag lives in
 * `sessionStorage`, so it plays on arrival and never again until the tab is
 * closed — a visitor who reloads a product page twice does not sit through it
 * twice. Client-side navigations never re-run it at all, because the script
 * runs on document load.
 *
 * **It costs about 1.4 seconds of Largest Contentful Paint on a cold arrival,
 * and that is the trade.** The page renders underneath it the whole time —
 * nothing is deferred, no data waits — but an opaque panel is an opaque panel.
 * It is kept under a second and a half for that reason, and it is why the
 * duration lives in one token rather than being spread across three
 * components.
 */

/**
 * The script that decides whether the intro plays, before the first paint.
 *
 * Same shape and the same reasoning as `ThemeScript`: tiny, synchronous, and it
 * does nothing at all when storage is unavailable. Anything that waited for
 * hydration would already have let the panel flash.
 *
 * Two things stop it, and both are checked here rather than in CSS because
 * both must be decided before a frame is drawn:
 *
 *   - `sessionStorage` already holds the flag — this is not a first arrival;
 *   - the visitor asked for reduced motion.
 *
 * The reduced-motion check cannot be left to the stylesheet's global rule. That
 * rule crushes animation *durations*, and this animation's panel is held up by
 * a one-second **delay** — which a duration rule does not touch. The result
 * would be a blank panel sitting for a second and then blinking out, which is
 * precisely the experience the setting exists to prevent.
 */
export const INTRO_STORAGE_KEY = 'stitch-intro';

export function IntroScript({ nonce }: { nonce?: string }) {
  const script = `try{if(!sessionStorage.getItem(${JSON.stringify(INTRO_STORAGE_KEY)})&&!matchMedia('(prefers-reduced-motion: reduce)').matches){sessionStorage.setItem(${JSON.stringify(INTRO_STORAGE_KEY)},'1');document.documentElement.dataset.intro='play'}}catch(e){}`;

  return <script nonce={nonce} dangerouslySetInnerHTML={{ __html: script }} />;
}

/**
 * The panel itself.
 *
 * Rendered on every page and inert on almost all of them: without
 * `data-intro="play"` on the document it is `display: none` and costs one
 * element. The gating is an arbitrary variant rather than a class the script
 * adds, so there is no frame in which the panel exists but has not yet been
 * told what to do.
 */
export function Intro({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'bg-bg pointer-events-none fixed inset-0 z-100 hidden',
        // Shown only when the script opted in. Everything below animates as
        // soon as it is displayed; there is no second trigger to go wrong.
        '[html[data-intro="play"]_&]:flex',
        'flex-col items-center justify-center gap-5',
        'animate-intro-panel',
        className,
      )}
    >
      <span className="font-display text-display-xl animate-intro-mark leading-none tracking-tight [font-variation-settings:'SOFT'_60]">
        {brand.name}
      </span>

      {/*
       * The running stitch.
       *
       * A dashed stroke along a shallow wave — thread does not lie perfectly
       * straight — revealed left to right by a `clip-path` rather than by a
       * `stroke-dashoffset` animation. Dash offset is the usual way to draw a
       * line, and it cannot be used here: the dashes *are* the stitches, so
       * animating the offset would march them along the path like a barber's
       * pole instead of laying them down one after another.
       *
       * `preserveAspectRatio="none"` is deliberately absent — the wave keeps
       * its shape and the whole figure scales with the type.
       */}
      <svg
        viewBox="0 0 240 24"
        className="animate-intro-thread text-accent h-5 w-60 overflow-visible"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M4 16C40 5 78 23 120 14c42-9 80-9 116 2"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="9 7"
        />
      </svg>
    </div>
  );
}
