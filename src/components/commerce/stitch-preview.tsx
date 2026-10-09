'use client';

import { useEffect, useState } from 'react';

import { cn } from '@/components/ui/cn';
import { renderStitch } from '@/lib/embroidery/render';

/**
 * The customer's artwork, shown as it will be stitched.
 *
 * Phase 16. A flat PNG of a logo answers almost none of the questions somebody
 * has before paying to have it embroidered: thread has a small palette, a
 * direction and a sheen, and a design with gradients in it comes back as bands
 * of colour. This renders that in the browser so the conversation happens
 * before the order rather than in a complaint afterwards.
 *
 * ## It never replaces the picture
 *
 * The component renders the original `src` immediately and swaps in the
 * stitched render when it is ready. If the render fails — a tainted canvas, no
 * 2D context, an image that never loads — the original simply stays. There is
 * no spinner and no error state, because a failed *preview* is not a failed
 * upload and must not look like one.
 *
 * And it never touches the file. The stored artwork is byte-for-byte what was
 * uploaded (ADR-024, rule 9B); this is a canvas in a browser tab.
 *
 * ## `stitched` is the caller's decision, not a toggle in here
 *
 * The builder lets the customer switch between the two and keeps that choice in
 * its own state, because the same choice has to drive the placement editor and
 * the review step at the same time. A toggle owned by this component would make
 * three previews that disagree with each other.
 *
 * The **workshop never passes `stitched`**. The admin digitises the real
 * artwork, and showing a stylised version of a file somebody has to trace would
 * be actively harmful.
 */
export type StitchPreviewProps = {
  src: string;
  alt: string;
  /** Show the stitched render when it is available. */
  stitched: boolean;
  className?: string;
  /** Drawn on the garment, so it must not intercept the drag gesture. */
  draggable?: boolean;
};

export function StitchPreview({
  src,
  alt,
  stitched,
  className,
  draggable = false,
}: StitchPreviewProps) {
  /*
   * The render carries the source it was made from.
   *
   * A customer who replaces their file gets a new `src` while the old render is
   * still in state, and a bare `string | null` would show the new artwork as
   * the *old* stitched image for a paint. Pairing them makes that
   * unrepresentable rather than merely unlikely — and it keeps the comparison
   * in state, where the render may read it, instead of in a ref, where it may
   * not.
   */
  const [rendered, setRendered] = useState<{ src: string; url: string } | null>(null);
  const isCurrent = rendered?.src === src;

  useEffect(() => {
    if (!stitched || isCurrent) return;

    let cancelled = false;
    const image = new Image();
    // Ask for CORS so a preview served from a storage host can still be read
    // back. Without it the canvas is tainted and `renderStitch` returns null —
    // which is handled, but silently loses the effect.
    image.crossOrigin = 'anonymous';

    image.onload = () => {
      if (cancelled) return;

      const result = renderStitch(image);
      if (!result) return;

      setRendered({ src, url: result.url });
    };

    image.src = src;

    return () => {
      cancelled = true;
    };
  }, [src, stitched, isCurrent]);

  const showStitched = stitched && isCurrent;

  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={showStitched ? rendered.url : src}
      alt={alt}
      draggable={draggable}
      className={cn('block', className)}
    />
  );
}
