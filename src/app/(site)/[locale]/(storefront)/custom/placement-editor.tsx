'use client';

import { useCallback, useEffect, useId, useMemo, useRef } from 'react';
import { Move, RotateCw, Scaling } from 'lucide-react';

import { Inline, Stack } from '@/components/layout/layout';
import { Text } from '@/components/ui/typography';
import { cn } from '@/components/ui/cn';
import { StitchPreview } from '@/components/commerce/stitch-preview';
import { useDictionary } from '@/i18n/client';
import {
  DEFAULT_TRANSFORM,
  MAX_WIDTH_PERCENT,
  MIN_WIDTH_PERCENT,
  clampTransform,
  designSize,
  transformForBand,
  type ArtworkAspect,
  type DesignTransform,
  type SizeBand,
} from '@/domain/customization/placement';
import type {
  BuilderSurface,
  BuilderEmbroiderySize,
} from '@/server/repositories/customization-repository';

/**
 * Putting the design where the customer wants it.
 *
 * The screen this whole phase exists for. Before it, a placement was a name off
 * a list and a size was one of three presets — the customer chose two words and
 * hoped, and the workshop read two words and guessed. Here they drag their
 * artwork onto a photograph of the blank and read its real size in millimetres
 * underneath, and what they approve is what gets stitched.
 *
 * ## Why the box is a percentage box
 *
 * The design is positioned with `left`/`top` as percentages of the container
 * and `width` as a percentage of its width, then centred with a
 * `translate(-50%, -50%)`. That is not a styling convenience — it is the
 * storage format made visible. The same four numbers go into the database, and
 * the same four numbers will composite the artwork into a 3D model's texture.
 * Nothing here is ever expressed in pixels, so nothing here breaks when the
 * photograph is replaced with a bigger one or the viewport changes.
 *
 * The design's **height is never set**. The `<img>` inside the box is
 * `width: 100%; height: auto`, so its height is the artwork's own aspect ratio
 * doing the work. A stored height would be a second source of truth that can
 * disagree with the picture.
 *
 * ## Pointer, not mouse
 *
 * Every gesture is a Pointer Event with `setPointerCapture`, which is one code
 * path for mouse, touch and pen. `touch-action: none` on the draggable parts
 * stops the browser scrolling the page when a thumb drags the logo, which is
 * the single thing that makes this usable on a phone — and mobile is the
 * primary platform here, not an adaptation.
 *
 * ## And a keyboard
 *
 * The box is a real `button` in the tab order. Arrows nudge, shift-arrows nudge
 * ten times as far, `+`/`-` resize, `[`/`]` rotate. A drag-and-drop editor
 * reachable only by dragging is one a lot of people cannot use at all, and the
 * keyboard path costs about twenty lines.
 */

export type PlacementEditorProps = {
  surfaces: readonly BuilderSurface[];
  /** The customer's artwork, when it is something a browser can draw. */
  artwork: { previewUrl: string | null; name: string } | null;
  /** Pixel dimensions of the artwork, for its aspect ratio. */
  artworkAspect: ArtworkAspect | null;
  /**
   * Draw the artwork as embroidery rather than as the file.
   *
   * Owned by the builder, because the design step offers the same choice and
   * the two must agree — see its comment. The transform is unaffected either
   * way: the box, the millimetres and what the workshop is told are identical.
   * This changes only what is painted inside the box.
   */
  stitched: boolean;
  /** The priced bands, offered as quick sizes. */
  sizes: readonly BuilderEmbroiderySize[];
  surfaceImageId: string | null;
  transform: DesignTransform;
  onChange: (patch: { surfaceImageId: string; transform: DesignTransform }) => void;
};

/** How far an arrow key moves the design, as a percentage of the garment. */
const NUDGE_PERCENT = 0.5;
const NUDGE_ROTATION_DEG = 2;

export function PlacementEditor({
  surfaces,
  artwork,
  artworkAspect,
  stitched,
  sizes,
  surfaceImageId,
  transform,
  onChange,
}: PlacementEditorProps) {
  const { t } = useDictionary();
  const frame = useRef<HTMLDivElement>(null);
  const labelId = useId();

  const active =
    surfaces.find((surface) => surface.imageId === surfaceImageId) ?? surfaces[0] ?? null;

  const bands = useMemo<readonly SizeBand[]>(
    () =>
      sizes.map((size) => ({
        id: size.id,
        name: size.name,
        basePrice: size.basePrice,
        maxWidthMm: size.maxWidthMm,
        maxHeightMm: size.maxHeightMm,
      })),
    [sizes],
  );

  const size = active ? designSize(transform, active.widthMm, artworkAspect) : null;

  const apply = useCallback(
    (next: DesignTransform) => {
      if (!active) return;
      onChange({ surfaceImageId: active.imageId, transform: clampTransform(next) });
    },
    [active, onChange],
  );

  /*
   * A design that has not been dragged is still placed.
   *
   * The editor opens with the artwork already sitting at chest height, and that
   * is where it goes if the customer is happy with it. Requiring a drag to
   * *record* what they can already see would mean somebody who agrees with the
   * default submits a configuration with no placement at all — which reads to
   * the server as "this blank could not be placed on" and sends a perfectly
   * ordinary order to a human quote.
   *
   * Fires once, when a surface exists and none has been chosen.
   */
  useEffect(() => {
    if (active && surfaceImageId === null) {
      onChange({ surfaceImageId: active.imageId, transform: clampTransform(transform) });
    }
  }, [active, surfaceImageId, transform, onChange]);

  /*
   * One gesture handler for all three grips.
   *
   * `setPointerCapture` means the browser keeps sending moves to this element
   * even when the finger leaves it — without it, dragging quickly off the
   * photograph drops the design wherever it was last seen, which feels broken
   * in exactly the way a customer would blame themselves for.
   */
  const startGesture = useCallback(
    (mode: 'move' | 'resize' | 'rotate') => (event: React.PointerEvent) => {
      if (!active || !frame.current) return;

      event.preventDefault();
      event.stopPropagation();

      const box = frame.current.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return;

      const target = event.currentTarget as HTMLElement;
      target.setPointerCapture(event.pointerId);

      const start = { x: event.clientX, y: event.clientY, ...transform };

      // The design's centre in page coordinates, which both resize and rotate
      // measure against. Read once: it does not move during the gesture.
      const centre = {
        x: box.left + (start.xPercent / 100) * box.width,
        y: box.top + (start.yPercent / 100) * box.height,
      };

      const startDistance = Math.hypot(start.x - centre.x, start.y - centre.y);
      const startAngle = Math.atan2(start.y - centre.y, start.x - centre.x);

      function onMove(moveEvent: PointerEvent) {
        if (mode === 'move') {
          apply({
            ...start,
            xPercent: start.xPercent + ((moveEvent.clientX - start.x) / box.width) * 100,
            yPercent: start.yPercent + ((moveEvent.clientY - start.y) / box.height) * 100,
          });
          return;
        }

        if (mode === 'resize') {
          const distance = Math.hypot(
            moveEvent.clientX - centre.x,
            moveEvent.clientY - centre.y,
          );

          // Scale by the ratio of distances from the centre, so the handle
          // stays under the finger and the design grows about its middle
          // rather than about a corner that then wanders.
          if (startDistance <= 0) return;

          apply({
            ...start,
            widthPercent: start.widthPercent * (distance / startDistance),
          });
          return;
        }

        const angle = Math.atan2(
          moveEvent.clientY - centre.y,
          moveEvent.clientX - centre.x,
        );
        const delta = ((angle - startAngle) * 180) / Math.PI;

        apply({ ...start, rotationDeg: normaliseAngle(start.rotationDeg + delta) });
      }

      function onEnd(endEvent: PointerEvent) {
        target.releasePointerCapture?.(endEvent.pointerId);
        target.removeEventListener('pointermove', onMove);
        target.removeEventListener('pointerup', onEnd);
        target.removeEventListener('pointercancel', onEnd);
      }

      target.addEventListener('pointermove', onMove);
      target.addEventListener('pointerup', onEnd);
      target.addEventListener('pointercancel', onEnd);
    },
    [active, apply, transform],
  );

  function onKeyDown(event: React.KeyboardEvent) {
    const step = event.shiftKey ? NUDGE_PERCENT * 10 : NUDGE_PERCENT;

    const moves: Record<string, Partial<DesignTransform>> = {
      ArrowLeft: { xPercent: transform.xPercent - step },
      ArrowRight: { xPercent: transform.xPercent + step },
      ArrowUp: { yPercent: transform.yPercent - step },
      ArrowDown: { yPercent: transform.yPercent + step },
      '+': { widthPercent: transform.widthPercent + step },
      '=': { widthPercent: transform.widthPercent + step },
      '-': { widthPercent: transform.widthPercent - step },
      '[': { rotationDeg: normaliseAngle(transform.rotationDeg - NUDGE_ROTATION_DEG) },
      ']': { rotationDeg: normaliseAngle(transform.rotationDeg + NUDGE_ROTATION_DEG) },
    };

    const patch = moves[event.key];
    if (!patch) return;

    event.preventDefault();
    apply({ ...transform, ...patch });
  }

  if (!active) {
    return (
      <div className="border-border bg-bg-subtle rounded-md border p-6">
        <Text variant="body" tone="muted">
          {t.custom.placementNoSurface}
        </Text>
      </div>
    );
  }

  const ratio =
    active.widthPx && active.heightPx ? active.widthPx / active.heightPx : 4 / 5;

  return (
    <Stack gap={4}>
      {/*
       * The faces, as photographs rather than as words.
       *
       * Phase 16, and it is a small change that removes a real hesitation:
       * "Devant" and "Dos" are unambiguous for a T-shirt and much less so for
       * a cap or an apron, where the customer is choosing between pictures they
       * have not seen yet. A strip of thumbnails answers "which one is that?"
       * before it is asked, which is what the reference designer does.
       *
       * Still a `tablist` with the same keys and the same aria — this is the
       * same control wearing a picture.
       */}
      {surfaces.length > 1 && (
        <div
          role="tablist"
          aria-label={t.custom.placementFaces}
          className="flex flex-wrap gap-2"
        >
          {surfaces.map((surface) => {
            const selected = surface.imageId === active.imageId;

            return (
              <button
                key={surface.imageId}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => onChange({ surfaceImageId: surface.imageId, transform })}
                className={cn(
                  'flex w-20 flex-col items-center gap-1.5 rounded-xl p-1.5',
                  'duration-fast transition-colors ease-out motion-reduce:transition-none',
                  'focus-visible:shadow-focus focus-visible:outline-none',
                  selected ? 'bg-bg-subtle' : 'hover:bg-bg-subtle',
                )}
              >
                <span
                  className={cn(
                    'bg-surface-sunken block w-full overflow-hidden rounded-lg border',
                    // The selected face is marked by a solid border, not by
                    // colour alone — the names below it are the label, and the
                    // border is the second signal (section 8).
                    selected ? 'border-fg border-2' : 'border-hairline',
                  )}
                  style={{ aspectRatio: '4 / 5' }}
                >
                  {surface.src && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={surface.src}
                      alt=""
                      draggable={false}
                      className="size-full object-cover"
                    />
                  )}
                </span>

                <span
                  className={cn(
                    'text-caption text-center leading-tight',
                    selected ? 'text-fg font-medium' : 'text-fg-muted',
                  )}
                >
                  {t.custom.surfaceNames[surface.surface]}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div
        ref={frame}
        style={{ aspectRatio: String(ratio) }}
        className="border-hairline bg-bg-subtle relative w-full select-none overflow-hidden rounded-2xl border"
      >
        {active.src && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={active.src}
            alt={active.alt}
            draggable={false}
            className="pointer-events-none absolute inset-0 size-full object-contain"
          />
        )}

        <button
          type="button"
          aria-labelledby={labelId}
          onKeyDown={onKeyDown}
          onPointerDown={startGesture('move')}
          style={{
            left: `${transform.xPercent}%`,
            top: `${transform.yPercent}%`,
            width: `${transform.widthPercent}%`,
            transform: `translate(-50%, -50%) rotate(${transform.rotationDeg}deg)`,
            // Without this a thumb dragging the logo scrolls the page instead.
            touchAction: 'none',
          }}
          className={cn(
            'absolute cursor-move p-0',
            'outline-accent outline-2 outline-dashed outline-offset-2',
            'focus-visible:shadow-focus focus-visible:outline-solid',
          )}
        >
          {artwork?.previewUrl ? (
            <StitchPreview
              src={artwork.previewUrl}
              alt=""
              stitched={stitched}
              className="pointer-events-none w-full"
            />
          ) : (
            /*
             * No preview to draw.
             *
             * An SVG or a PDF is never rendered in a browser here (ADR-011,
             * ADR-024) and a text-only order has no artwork at all. The box is
             * still positioned and still measured — the customer is placing a
             * *region*, and the workshop is told exactly which one. Pretending
             * to show the file would be worse than admitting we cannot.
             */
            <span
              className="bg-accent-subtle text-fg flex w-full items-center justify-center px-1 py-4 text-center"
              style={{ aspectRatio: '2 / 1' }}
            >
              <span className="text-caption truncate">
                {artwork?.name ?? t.custom.placementYourDesign}
              </span>
            </span>
          )}

          <span
            onPointerDown={startGesture('resize')}
            style={{ touchAction: 'none' }}
            className="border-accent bg-surface absolute -right-3 -bottom-3 flex size-6 cursor-nwse-resize items-center justify-center rounded-full border shadow-sm"
          >
            <Scaling className="text-fg size-3" aria-hidden="true" />
          </span>

          <span
            onPointerDown={startGesture('rotate')}
            style={{ touchAction: 'none' }}
            className="border-accent bg-surface absolute -top-3 -right-3 flex size-6 cursor-grab items-center justify-center rounded-full border shadow-sm"
          >
            <RotateCw className="text-fg size-3" aria-hidden="true" />
          </span>
        </button>
      </div>

      <p id={labelId} className="sr-only">
        {t.custom.placementInstructions}
      </p>

      <Inline gap={3} wrap className="items-center justify-between">
        <Inline gap={2} wrap className="items-center">
          <Move className="text-fg-subtle size-4" aria-hidden="true" />
          <Text variant="body-sm" tone="muted" as="span">
            {t.custom.placementHint}
          </Text>
        </Inline>

        {/*
         * The measurement, live.
         *
         * `role="status"` — which implies a polite live region — because this
         * is the answer to the question the customer is actually asking while
         * they drag, and somebody using a screen reader gets no feedback from
         * the picture at all. It is also the one unambiguous handle on the
         * figure: the quick-size buttons print millimetres too.
         */}
        <Text variant="heading-sm" as="span" role="status">
          {size
            ? size.heightMm === null
              ? t.custom.placementWidthOnly(size.widthMm)
              : t.custom.placementSize(size.widthMm, size.heightMm)
            : ''}
        </Text>
      </Inline>

      <Inline gap={2} wrap className="items-center">
        <Text variant="caption" tone="subtle" as="span">
          {t.custom.placementQuickSizes}
        </Text>
        {bands
          .filter((band) => band.maxWidthMm !== null)
          .map((band) => (
            <button
              key={band.id}
              type="button"
              onClick={() => apply(transformForBand(band, transform, active.widthMm))}
              className={cn(
                'text-body-sm border-border min-h-10 rounded-full border px-4',
                'hover:border-border-strong duration-fast transition-colors ease-out',
                'focus-visible:shadow-focus focus-visible:outline-none',
                'motion-reduce:transition-none',
              )}
            >
              {band.name}
              <span className="text-fg-subtle ml-1 tabular-nums">
                {band.maxWidthMm} mm
              </span>
            </button>
          ))}
      </Inline>
    </Stack>
  );
}

/** Keeps rotation in −180…180 so the stored value matches the column's check. */
function normaliseAngle(degrees: number): number {
  const wrapped = (((degrees + 180) % 360) + 360) % 360;
  return wrapped - 180;
}

/**
 * A transform that is valid before the customer has touched anything.
 *
 * Exported so the builder's initial state and this editor cannot disagree about
 * where a design starts.
 */
export function initialTransform(): DesignTransform {
  return { ...DEFAULT_TRANSFORM };
}

export { MIN_WIDTH_PERCENT, MAX_WIDTH_PERCENT };
