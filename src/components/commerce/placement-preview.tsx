'use client';

import { Text } from '@/components/ui/typography';
import { useDictionary } from '@/i18n/client';

/**
 * What the customer approved, redrawn.
 *
 * The workshop used to receive a sentence — "Poitrine gauche, Moyen" — and had
 * to imagine the rest. This is the picture instead: the garment, the artwork,
 * and the artwork exactly where it was put, at the size it was dragged to.
 *
 * **It is the same arithmetic as the editor, and deliberately so.** The design
 * is positioned with `left`/`top` as percentages of the container and `width`
 * as a percentage of its width, then centred with `translate(-50%, -50%)` and
 * rotated. Nothing is recomputed and nothing is approximated: the workshop is
 * not shown a rendering *of* the customer's screen, it is shown the customer's
 * screen, driven by the four numbers on the row.
 *
 * The design's **height is never set** — the `<img>` is `width: 100%` and lets
 * the artwork's own aspect ratio do the work, which is exactly what the editor
 * does and why the two cannot drift.
 *
 * Presentational. It resolves nothing, signs nothing and fetches nothing: the
 * caller has already turned a private design file into a short-lived signed
 * preview URL and a storage key into a public one.
 */

export type PlacementPreviewProps = {
  garmentSrc: string | null;
  garmentAlt: string;
  garmentWidthPx: number | null;
  garmentHeightPx: number | null;
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  rotationDeg: number;
  /** The customer's artwork, when there is a preview a browser can draw. */
  artworkSrc: string | null;
  artworkName: string | null;
  widthMm: number | null;
  heightMm: number | null;
};

export function PlacementPreview({
  garmentSrc,
  garmentAlt,
  garmentWidthPx,
  garmentHeightPx,
  xPercent,
  yPercent,
  widthPercent,
  rotationDeg,
  artworkSrc,
  artworkName,
  widthMm,
  heightMm,
}: PlacementPreviewProps) {
  const { t } = useDictionary();

  // The garment photograph's own proportions, so the box the design sits in is
  // the same shape it was in the editor. 4:5 is the fallback for a row whose
  // picture predates the dimensions being recorded.
  const ratio =
    garmentWidthPx && garmentHeightPx ? garmentWidthPx / garmentHeightPx : 4 / 5;

  const size =
    widthMm === null
      ? null
      : heightMm === null
        ? t.custom.placementWidthOnly(widthMm)
        : t.custom.placementSize(widthMm, heightMm);

  return (
    <figure className="m-0 flex flex-col gap-2">
      <div
        style={{ aspectRatio: String(ratio) }}
        className="border-border bg-bg-subtle relative w-full overflow-hidden rounded-md border"
      >
        {garmentSrc && (
          /*
           * Plain `img` for both layers.
           *
           * The garment is already a re-encoded, capped JPEG from `media/`, and
           * the artwork is a short-lived **signed** URL that the optimiser
           * would cache under a key outliving the signature. Neither belongs in
           * `next/image`.
           */
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={garmentSrc}
            alt={garmentAlt}
            className="absolute inset-0 size-full object-contain"
          />
        )}

        <div
          style={{
            left: `${xPercent}%`,
            top: `${yPercent}%`,
            width: `${widthPercent}%`,
            transform: `translate(-50%, -50%) rotate(${rotationDeg}deg)`,
          }}
          className="absolute"
        >
          {artworkSrc ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={artworkSrc} alt="" className="block w-full" />
          ) : (
            /*
             * No preview to draw — an SVG, a PDF, or a text-only order.
             *
             * The region is still shown, outlined, because *where and how big*
             * is the information the workshop needs and it is not lost just
             * because the file cannot be rasterised (ADR-011, ADR-024).
             */
            <span
              className="border-accent text-fg-muted flex w-full items-center justify-center border-2 border-dashed px-1 py-3 text-center"
              style={{ aspectRatio: '2 / 1' }}
            >
              <span className="text-caption truncate">
                {artworkName ?? t.custom.placementYourDesign}
              </span>
            </span>
          )}
        </div>
      </div>

      {size && (
        <figcaption>
          <Text variant="caption" tone="subtle">
            {size}
          </Text>
        </figcaption>
      )}
    </figure>
  );
}
