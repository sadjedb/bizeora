'use client';

import { useRef, useState, useTransition } from 'react';
import { ArrowDown, ArrowUp, ImagePlus, Star, Trash2 } from 'lucide-react';

import { Alert } from '@/components/ui/feedback';
import { Badge } from '@/components/ui/feedback';
import { Button, IconButton } from '@/components/ui/button';
import { Inline, Stack } from '@/components/layout/layout';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/typography';
import { useDictionary } from '@/i18n/client';
import {
  MAX_IMAGES_PER_PRODUCT,
  MAX_SHOP_IMAGE_BYTES,
  SHOP_IMAGE_MIME_TYPES,
} from '@/domain/media';
import {
  DESIGN_SURFACES,
  MAX_SURFACE_WIDTH_MM,
  MIN_SURFACE_WIDTH_MM,
  type DesignSurface,
} from '@/domain/customization/placement';

import {
  deleteImageAction,
  moveImageAction,
  setImageSurfaceAction,
  setPrimaryImageAction,
  updateImageAltAction,
  uploadProductImageAction,
} from '../actions';

/**
 * The product's photographs.
 *
 * Everything here is a single call to a server action, and the page revalidates
 * itself after each one — there is no local copy of the list to drift out of
 * step with the database. On a screen where a mis-click deletes a photograph,
 * "what you see is what is stored" is worth more than an optimistic update.
 *
 * Files upload **one at a time**, in the order they were chosen, so a failure
 * names the file that failed and the operator keeps the rest. A batch that
 * fails halfway leaves the caller guessing which half.
 *
 * The alternative text is a real field rather than a nicety: it is what a screen
 * reader announces and what shows when the network drops the image. It is saved
 * on blur, because a form with a save button per row is a form nobody uses.
 */

export type AdminImage = {
  id: string;
  src: string | null;
  alt: string;
  isPrimary: boolean;
  width: number | null;
  height: number | null;
  /** Null for an ordinary catalogue picture; a face for a placeable blank. */
  surface: DesignSurface | null;
  surfaceWidthMm: number | null;
};

export function ProductImages({
  productId,
  images,
}: {
  productId: string;
  images: readonly AdminImage[];
}) {
  const { t } = useDictionary();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const full = images.length >= MAX_IMAGES_PER_PRODUCT;

  function onFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(event.target.files ?? []);
    if (chosen.length === 0) return;

    setError(null);

    startTransition(async () => {
      for (const file of chosen) {
        if (file.size > MAX_SHOP_IMAGE_BYTES) {
          setError(t.adminMedia.tooLarge(file.name));
          break;
        }

        const form = new FormData();
        form.set('productId', productId);
        form.set('file', file);
        // A sensible default the operator can improve: the file's own name
        // without its extension. Better than an empty string, and honest —
        // nothing here invents a description of a photograph it cannot see.
        form.set('alt', file.name.replace(/\.[^.]+$/, '').slice(0, 160));

        const result = await uploadProductImageAction(form);

        if (!result.ok) {
          setError(`${file.name} — ${result.message}`);
          break;
        }
      }

      if (input.current) input.current.value = '';
    });
  }

  function run(id: string, action: () => Promise<{ ok: boolean; message?: string }>) {
    setError(null);
    setBusy(id);

    startTransition(async () => {
      const result = await action();
      if (!result.ok && result.message) setError(result.message);
      setBusy(null);
    });
  }

  return (
    <Stack gap={4}>
      {error && (
        <Alert tone="danger" title={t.adminMedia.uploadFailed}>
          {error}
        </Alert>
      )}

      <Inline gap={3} wrap className="items-center">
        <input
          ref={input}
          type="file"
          multiple
          accept={SHOP_IMAGE_MIME_TYPES.join(',')}
          className="sr-only"
          aria-hidden="true"
          tabIndex={-1}
          onChange={onFiles}
        />

        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={pending && busy === null}
          disabled={full}
          leadingIcon={<ImagePlus aria-hidden="true" />}
          onClick={() => input.current?.click()}
        >
          {t.adminMedia.add}
        </Button>

        <Text variant="caption" tone="subtle">
          {full
            ? t.adminMedia.full(MAX_IMAGES_PER_PRODUCT)
            : t.adminMedia.hint(MAX_IMAGES_PER_PRODUCT)}
        </Text>
      </Inline>

      {images.length === 0 ? (
        <Text variant="body-sm" tone="muted">
          {t.adminMedia.empty}
        </Text>
      ) : (
        <ul className="flex list-none flex-col gap-3 p-0">
          {images.map((image, index) => (
            <li
              key={image.id}
              className="border-border bg-bg flex flex-wrap items-start gap-4 rounded-md border p-3"
            >
              <div className="bg-surface-sunken size-20 shrink-0 overflow-hidden rounded-sm">
                {image.src && (
                  /*
                   * A plain `img`: these are admin thumbnails of an image the
                   * operator uploaded seconds ago, and routing eight of them
                   * through the optimiser on a screen nobody indexes buys
                   * nothing.
                   */
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={image.src}
                    alt=""
                    className="size-full object-cover"
                    loading="lazy"
                  />
                )}
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Inline gap={2} wrap className="items-center">
                  {image.isPrimary && (
                    <Badge variant="solid">{t.adminMedia.primary}</Badge>
                  )}
                  <Text variant="caption" tone="subtle">
                    {image.width && image.height
                      ? `${image.width} × ${image.height}`
                      : t.adminMedia.unknownSize}
                  </Text>
                </Inline>

                <AltField
                  label={t.adminMedia.altLabel}
                  value={image.alt}
                  disabled={pending}
                  onSave={(alt) =>
                    run(image.id, () => updateImageAltAction({ imageId: image.id, alt }))
                  }
                />

                <SurfaceFields
                  image={image}
                  disabled={pending || busy === image.id}
                  onSave={(surface, surfaceWidthMm) =>
                    run(image.id, () =>
                      setImageSurfaceAction({
                        imageId: image.id,
                        surface,
                        surfaceWidthMm,
                      }),
                    )
                  }
                />
              </div>

              <Inline gap={1} className="items-center">
                <IconButton
                  label={t.adminMedia.moveUp}
                  variant="ghost"
                  size="sm"
                  disabled={index === 0 || pending}
                  onClick={() =>
                    run(image.id, () =>
                      moveImageAction({ imageId: image.id, direction: 'up' }),
                    )
                  }
                >
                  <ArrowUp className="size-4" aria-hidden="true" />
                </IconButton>

                <IconButton
                  label={t.adminMedia.moveDown}
                  variant="ghost"
                  size="sm"
                  disabled={index === images.length - 1 || pending}
                  onClick={() =>
                    run(image.id, () =>
                      moveImageAction({ imageId: image.id, direction: 'down' }),
                    )
                  }
                >
                  <ArrowDown className="size-4" aria-hidden="true" />
                </IconButton>

                <IconButton
                  label={t.adminMedia.makePrimary}
                  variant="ghost"
                  size="sm"
                  disabled={image.isPrimary || pending}
                  onClick={() =>
                    run(image.id, () => setPrimaryImageAction({ imageId: image.id }))
                  }
                >
                  <Star
                    className={
                      image.isPrimary ? 'fill-accent text-accent size-4' : 'size-4'
                    }
                    aria-hidden="true"
                  />
                </IconButton>

                <IconButton
                  label={t.adminMedia.remove}
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    if (!window.confirm(t.adminMedia.confirmRemove)) return;
                    run(image.id, () => deleteImageAction({ imageId: image.id }));
                  }}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </IconButton>
              </Inline>
            </li>
          ))}
        </ul>
      )}
    </Stack>
  );
}

/**
 * Alternative text, saved when the field is left.
 *
 * Uncontrolled on purpose: the value belongs to the row until the operator
 * finishes typing, and re-rendering the whole list on every keystroke is how a
 * text field starts dropping characters on a slow machine.
 */
function AltField({
  label,
  value,
  disabled,
  onSave,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onSave: (alt: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-caption text-fg-subtle">{label}</span>
      <Input
        defaultValue={value}
        maxLength={160}
        disabled={disabled}
        onBlur={(event) => {
          const next = event.target.value.trim();
          if (next !== value) onSave(next);
        }}
      />
    </label>
  );
}

/**
 * The two settings that turn a photograph into a placeable face.
 *
 * They are one control, not two, because they are useless apart: a face with no
 * measurement cannot be ordered from, and a measurement with no face belongs to
 * nothing. Choosing a face reveals the measurement; clearing it hides and
 * clears the measurement too.
 *
 * The measurement is the number the whole feature rests on — **how wide the
 * garment really is across the full width of this picture**. Everything the
 * customer sees in millimetres is derived from it, so the hint says it in
 * plain words and the field refuses centimetres (`MIN_SURFACE_WIDTH_MM`).
 */
function SurfaceFields({
  image,
  disabled,
  onSave,
}: {
  image: AdminImage;
  disabled: boolean;
  onSave: (surface: string | null, surfaceWidthMm: number | null) => void;
}) {
  const { t } = useDictionary();
  const [surface, setSurface] = useState<string>(image.surface ?? '');

  return (
    <div className="border-hairline mt-1 flex flex-col gap-2 border-t pt-2">
      <label className="flex flex-col gap-1">
        <span className="text-caption text-fg-subtle">{t.adminMedia.surfaceLabel}</span>
        <select
          value={surface}
          disabled={disabled}
          className="border-border bg-surface text-body-sm focus-visible:shadow-focus min-h-9 rounded-sm border px-2 focus-visible:outline-none"
          onChange={(event) => {
            const next = event.target.value;
            setSurface(next);

            // Clearing the face is a save on its own: there is nothing left to
            // measure, and leaving it unsaved would show a picture as
            // placeable until the operator touched a second field.
            if (next === '') onSave(null, null);
            else onSave(next, image.surfaceWidthMm);
          }}
        >
          <option value="">{t.adminMedia.surfaceNone}</option>
          {DESIGN_SURFACES.filter((face) => face !== 'WRAP').map((face) => (
            <option key={face} value={face}>
              {t.adminMedia.surfaceNames[face]}
            </option>
          ))}
        </select>
      </label>

      {surface !== '' && (
        <label className="flex flex-col gap-1">
          <span className="text-caption text-fg-subtle">
            {t.adminMedia.surfaceWidthLabel}
          </span>
          <Input
            type="number"
            inputMode="numeric"
            min={MIN_SURFACE_WIDTH_MM}
            max={MAX_SURFACE_WIDTH_MM}
            defaultValue={image.surfaceWidthMm ?? ''}
            disabled={disabled}
            onBlur={(event) => {
              const next = event.target.value.trim();
              const value = next === '' ? null : Number.parseInt(next, 10);
              if (value !== image.surfaceWidthMm) onSave(surface, value);
            }}
          />
          <span className="text-caption text-fg-subtle">
            {t.adminMedia.surfaceWidthHint}
          </span>
        </label>
      )}
    </div>
  );
}
