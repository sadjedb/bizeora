'use client';

import { cn } from '@/components/ui/cn';
import { Stack } from '@/components/layout/layout';
import { Overline, Text } from '@/components/ui/typography';
import { StitchPreview } from '@/components/commerce/stitch-preview';
import { useDictionary } from '@/i18n/client';

/**
 * "Here is your logo, stitched."
 *
 * The design step's answer to the question the whole custom flow is really
 * about: *will this look good embroidered?* Until this existed the customer saw
 * a 48-pixel thumbnail of the file they had just chosen from their own
 * computer, which told them nothing they did not already know.
 *
 * The toggle is a two-button group rather than a switch because the two states
 * are not on and off — they are two views of the same thing, and "stitched"
 * versus "original file" is what a customer needs to read to trust the first
 * one. A switch labelled "embroidery" invites the reading that turning it off
 * changes the order.
 *
 * The sentence underneath is load-bearing for the same reason: somebody who
 * thinks we have modified their artwork will upload it again, or write to ask
 * why it looks wrong. The file is untouched (ADR-024) and the copy says so.
 */
export function StitchPanel({
  src,
  name,
  stitched,
  onStitchedChange,
}: {
  src: string;
  name: string;
  stitched: boolean;
  onStitchedChange: (next: boolean) => void;
}) {
  const { t } = useDictionary();

  return (
    <Stack gap={4}>
      <Overline as="p">{t.custom.stitchPreviewTitle}</Overline>

      <div
        role="group"
        aria-label={t.custom.stitchPreviewToggle}
        className="border-hairline inline-flex self-start rounded-full border p-1"
      >
        <ToggleButton
          selected={stitched}
          onClick={() => onStitchedChange(true)}
          label={t.custom.stitchPreviewStitched}
        />
        <ToggleButton
          selected={!stitched}
          onClick={() => onStitchedChange(false)}
          label={t.custom.stitchPreviewOriginal}
        />
      </div>

      {/*
       * A chequerboard behind the artwork, not a flat panel.
       *
       * Most logos arrive as a PNG with a transparent ground, and the stitch
       * effect leaves transparency alone — so on a plain surface a white logo
       * is invisible and a customer concludes the preview is broken. The
       * chequer says "this part is transparent" the way every image editor
       * does.
       */}
      <div
        className={cn(
          'border-hairline relative flex items-center justify-center rounded-2xl border p-6',
          'bg-surface-sunken',
          '[background-image:repeating-conic-gradient(var(--color-bg)_0%_25%,transparent_0%_50%)]',
          '[background-size:14px_14px]',
        )}
      >
        {/*
         * Small artwork is shown large on purpose. The panel's whole job is the
         * texture, and `renderStitch` already produces the render at a workable
         * size whatever the file's resolution was (`PREVIEW_MIN_PX`).
         */}
        <StitchPreview
          src={src}
          alt={name}
          stitched={stitched}
          className="h-56 w-auto max-w-full object-contain sm:h-72"
        />
      </div>

      <Text variant="body-sm" tone="muted" className="max-w-prose">
        {t.custom.stitchPreviewLead}
      </Text>
    </Stack>
  );
}

function ToggleButton({
  selected,
  onClick,
  label,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      // `aria-pressed` rather than `aria-selected`: these are two toggle
      // buttons, not tabs, and nothing below them changes identity.
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'text-body-sm min-h-10 rounded-full px-5',
        'duration-fast transition-colors ease-out motion-reduce:transition-none',
        'focus-visible:shadow-focus focus-visible:outline-none',
        selected ? 'bg-fg text-fg-inverted font-medium' : 'text-fg-muted hover:text-fg',
      )}
    >
      {label}
    </button>
  );
}
