'use client';

import { Badge } from '@/components/ui/feedback';
import { PlacementPreview } from '@/components/commerce/placement-preview';
import { Inline, Stack } from '@/components/layout/layout';
import { Text } from '@/components/ui/typography';
import { useDictionary } from '@/i18n/client';

/**
 * What was configured, as the quote and the admin workspace both show it.
 *
 * Presentational. The caller has already decided whether each value comes from
 * a display snapshot or a live reference row — that decision belongs to
 * `summariseConfigurations`, which implements ADR-016 — so this file has no
 * opinion about which and simply prints what it is given.
 *
 * A value that is missing is omitted rather than rendered as "—", because a
 * frozen configuration whose product has since been deleted has a genuinely
 * absent product name and inventing a dash for it says less than saying
 * nothing.
 */

export type ArtworkView = {
  designFileId: string;
  filename: string;
  /** A short-lived signed URL, resolved on the server. Never a storage key. */
  previewUrl: string | null;
  downloadUrl: string | null;
  role: 'PRIMARY' | 'REFERENCE';
};

export type PlacedDesign = {
  garmentSrc: string | null;
  garmentAlt: string;
  garmentWidthPx: number | null;
  garmentHeightPx: number | null;
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  rotationDeg: number;
  widthMm: number | null;
  heightMm: number | null;
};

export type CustomizationSummaryView = {
  quantity: number;
  frozen: boolean;
  productName: string | null;
  placement: string | null;
  /**
   * Where the design goes, as something that can be drawn.
   *
   * Null for a configuration that was never placed on a measured photograph —
   * an older row, or a blank nobody has measured yet. `placement` still carries
   * the sentence; there is simply nothing to render.
   */
  placed: PlacedDesign | null;
  embroiderySize: string | null;
  font: string | null;
  threadColors: readonly string[];
  embroideryText: string | null;
  instructions: string | null;
};

function Detail({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <Text variant="caption" tone="subtle" as="dt">
        {term}
      </Text>
      <Text variant="body-sm" as="dd">
        {value}
      </Text>
    </div>
  );
}

export function CustomizationSummary({
  configuration,
  artwork = [],
}: {
  configuration: CustomizationSummaryView;
  artwork?: readonly ArtworkView[];
}) {
  const {
    quantity,
    frozen,
    productName,
    placement,
    placed,
    embroiderySize,
    font,
    threadColors,
    embroideryText,
    instructions,
  } = configuration;
  const { t } = useDictionary();

  return (
    <Stack gap={4}>
      <Inline gap={2} wrap className="items-center">
        <Text variant="heading-sm" as="h3">
          {productName ?? t.customization.fallbackName}
        </Text>
        {frozen && <Badge variant="outline">{t.customization.frozen}</Badge>}
      </Inline>

      {/*
       * The picture first, then the numbers.
       *
       * The workshop's first question is "what am I stitching and where", and
       * a composite answers it in one glance where a definition list makes
       * them assemble it from five values. The list stays: it is what gets
       * read back to a customer on the phone.
       */}
      {placed && (
        <div className="max-w-xs">
          <PlacementPreview
            {...placed}
            artworkSrc={artwork.find((file) => file.previewUrl)?.previewUrl ?? null}
            artworkName={artwork[0]?.filename ?? null}
          />
        </div>
      )}

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Detail term={t.customization.quantity} value={String(quantity)} />
        {placement && <Detail term={t.customization.placement} value={placement} />}
        {embroiderySize && <Detail term={t.customization.size} value={embroiderySize} />}
        {font && <Detail term={t.customization.font} value={font} />}
        {threadColors.length > 0 && (
          <Detail term={t.customization.threads} value={threadColors.join(', ')} />
        )}
        {embroideryText && (
          <Detail term={t.customization.embroideredText} value={embroideryText} />
        )}
      </dl>

      {instructions && (
        <Stack gap={1}>
          <Text variant="caption" tone="subtle">
            {t.customization.instructions}
          </Text>
          <Text variant="body-sm" tone="muted">
            {instructions}
          </Text>
        </Stack>
      )}

      {artwork.length > 0 && (
        <Stack gap={2}>
          <Text variant="caption" tone="subtle">
            {t.customization.files}
          </Text>
          <ul className="flex flex-wrap gap-4">
            {artwork.map((file) => (
              <li key={file.designFileId}>
                <Stack gap={2} align="start">
                  {file.previewUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={file.previewUrl}
                      alt={t.upload.previewOf(file.filename)}
                      className="border-border h-24 w-24 rounded-sm border object-cover"
                    />
                  ) : (
                    <div className="border-border bg-bg-sunken flex h-24 w-24 items-center justify-center rounded-sm border">
                      <Text variant="caption" tone="subtle">
                        {t.upload.noPreview}
                      </Text>
                    </div>
                  )}
                  <Text variant="caption" tone="muted" as="span">
                    {file.filename}
                  </Text>
                </Stack>
              </li>
            ))}
          </ul>
        </Stack>
      )}
    </Stack>
  );
}
