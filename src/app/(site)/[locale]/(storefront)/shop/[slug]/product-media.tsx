'use client';

import { useState } from 'react';
import { Box, Images } from 'lucide-react';

import { ModelViewer } from '@/components/commerce/model-viewer';
import { ProductImage } from '@/components/media/product-image';
import { Stack } from '@/components/layout/layout';
import { cn } from '@/components/ui/cn';
import { useDictionary } from '@/i18n/client';
import type { CatalogueImage } from '@/server/repositories/catalogue-repository';

/**
 * The photographs, and the garment itself.
 *
 * A product with no model renders exactly what it rendered before: a hero
 * photograph and a strip of thumbnails, with **no tabs at all**. Two tabs where
 * one has nothing behind it is a control that teaches a visitor the site is
 * confusing, so the switch only exists once there is something to switch to.
 *
 * ## Photographs first, deliberately
 *
 * The 3D view is the more impressive of the two and it is not the default. A
 * photograph is the real garment, in real light, with the real stitching; the
 * model is a representation, and it costs a download measured in megabytes on a
 * connection this shop's customers pay for by the megabyte. Somebody who wants
 * to turn it will press the button — and that press is the signal that loads
 * `three` at all.
 */

export type ProductMediaModel = {
  src: string;
  materialName: string;
  poster: string | null;
};

export function ProductMedia({
  images,
  model,
  productName,
}: {
  images: readonly CatalogueImage[];
  model: ProductMediaModel | null;
  productName: string;
}) {
  const { t } = useDictionary();
  const [view, setView] = useState<'photos' | 'model'>('photos');

  const hero = images[0];
  const rest = images.slice(1);

  return (
    <Stack gap={4}>
      {model && (
        <div
          role="tablist"
          aria-label={t.model.label}
          className="border-border flex items-center gap-1 self-start rounded-full border p-1"
        >
          <MediaTab
            current={view === 'photos'}
            onClick={() => setView('photos')}
            icon={<Images className="size-4" aria-hidden="true" />}
            label={t.model.tabPhotos}
          />
          <MediaTab
            current={view === 'model'}
            onClick={() => setView('model')}
            icon={<Box className="size-4" aria-hidden="true" />}
            label={t.model.tab3d}
          />
        </div>
      )}

      {model && view === 'model' ? (
        <ModelViewer
          src={model.src}
          materialName={model.materialName}
          poster={model.poster ?? hero?.src ?? null}
        />
      ) : (
        <>
          <ProductImage
            src={hero?.src ?? null}
            alt={hero?.alt ?? productName}
            ratio="product"
            priority
            sizes="(min-width: 1024px) 55vw, 100vw"
            className="rounded-2xl"
            {...(hero?.blurDataUrl ? { blurDataURL: hero.blurDataUrl } : {})}
          />

          {rest.length > 0 && (
            <div className="grid grid-cols-4 gap-3">
              {rest.map((image) => (
                <ProductImage
                  key={image.alt}
                  src={image.src}
                  alt={image.alt}
                  ratio="square"
                  sizes="14vw"
                  className="rounded-xl"
                />
              ))}
            </div>
          )}
        </>
      )}
    </Stack>
  );
}

/**
 * One of the two.
 *
 * A real `<button>` with `role="tab"`, not a link: switching views is an action
 * on this page rather than a destination, and giving it an address would put a
 * second URL in the history for every product somebody looked at twice.
 */
function MediaTab({
  current,
  onClick,
  icon,
  label,
}: {
  current: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={current}
      onClick={onClick}
      className={cn(
        'text-body-sm flex min-h-9 items-center gap-2 rounded-full px-4',
        'duration-fast transition-colors ease-out motion-reduce:transition-none',
        'focus-visible:shadow-focus focus-visible:outline-none',
        current
          ? 'bg-fg text-fg-inverted font-medium'
          : 'text-fg-muted hover:bg-bg-sunken hover:text-fg',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
