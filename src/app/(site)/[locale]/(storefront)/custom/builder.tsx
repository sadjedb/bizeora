'use client';

import { Check, Pencil } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Card } from '@/components/ui/card';
import { FormField } from '@/components/ui/field';
import { Alert, Badge, Divider, Skeleton } from '@/components/ui/feedback';
import { Input, Textarea } from '@/components/ui/input';
import { Heading, Overline, Text } from '@/components/ui/typography';
import { Inline, Stack } from '@/components/layout/layout';
import { Price } from '@/components/commerce/price';
import { QuantitySelector } from '@/components/commerce/quantity-selector';
import { ProductImage } from '@/components/media/product-image';
import { FileCard, UploadDropzone } from '@/components/upload/upload-dropzone';
import { useDictionary } from '@/i18n/client';
import type { Dictionary } from '@/i18n';
import type {
  BuilderProduct,
  BuilderReferenceData,
} from '@/server/repositories/customization-repository';

import { quoteEstimate, submitCustomRequest, type EstimateResult } from './actions';
import {
  discardUploadAction,
  finaliseUploadAction,
  requestUploadAction,
} from './upload-actions';
import {
  INITIAL_STATE,
  STEPS,
  findProduct,
  findThreadColors,
  findVariant,
  isStepComplete,
  type AttachedFile,
  type BuilderState,
  type StepId,
} from './builder-state';
import { PlacementEditor } from './placement-editor';
import {
  MAX_DESIGN_WIDTH_MM,
  MIN_DESIGN_WIDTH_MM,
  designSize,
} from '@/domain/customization/placement';
import {
  ACCEPT_ATTRIBUTE,
  MAX_FILES,
  checkFile,
  isPreviewableType,
  type FileRejection,
} from './file-rules';

/**
 * What each step is called.
 *
 * `STEPS` carries identifiers; the words are here, so a step's name is
 * translated in one place and `builder-state` stays free of copy.
 */
const STEP_LABELS: Record<StepId, keyof Dictionary['custom']> = {
  product: 'stepProduct',
  placement: 'stepPlacement',
  design: 'stepDesign',
  options: 'stepOptions',
  review: 'stepReview',
};

function stepLabel(id: StepId, t: Dictionary): string {
  return t.custom[STEP_LABELS[id]] as string;
}

/**
 * The five-step custom embroidery builder.
 *
 * `UX.md` section 5. One decision per screen on mobile, a running estimate at
 * every step, Back and a single primary action.
 *
 * The division of labour is the point of this file:
 *
 *   - it holds **selections**, never conclusions
 *   - the estimate, the pricing mode and the reason for it come from a server
 *     action and are only rendered here
 *   - submission re-validates everything server-side; nothing this component
 *     believes is trusted
 *
 * Nothing is persisted between sessions. `UX.md` describes local-storage drafts
 * and server-side resumable drafts; both are recorded as deferred rather than
 * half-built, because a draft that silently loses an upload is worse than none.
 */
export function Builder({
  products,
  reference,
}: {
  products: readonly BuilderProduct[];
  reference: BuilderReferenceData;
}) {
  const { t } = useDictionary();
  const [state, setState] = useState<BuilderState>(INITIAL_STATE);
  const [stepIndex, setStepIndex] = useState(0);
  const [rejections, setRejections] = useState<readonly FileRejection[]>([]);
  const [estimate, setEstimate] = useState<EstimateResult | null>(null);
  const [estimating, startEstimating] = useTransition();
  const [submitting, startSubmitting] = useTransition();
  const [submission, setSubmission] = useState<
    | {
        ok: true;
        requestNumber: string;
        mode: 'FIXED' | 'QUOTE';
        responseTimeHours: number;
      }
    | { ok: false; errors: readonly string[] }
    | null
  >(null);

  const step = STEPS[stepIndex]!;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const skipFocus = useRef(true);

  const product = findProduct(products, state.productSlug);
  const variant = findVariant(product, state.options);
  const placedSurface = product?.surfaces.find(
    (candidate) => candidate.imageId === state.surfaceImageId,
  );

  const threadColors = findThreadColors(reference.threadColors, state.threadColorIds);

  // Only the fields that affect a price. Contact details deliberately do not,
  // so typing an email does not re-quote the configuration.
  const {
    productSlug,
    surfaceImageId,
    transform,
    sizeMm,
    threadColorIds,
    embroideryText,
    instructions,
    quantity,
  } = state;

  /**
   * The artwork's pixel dimensions, for its aspect ratio.
   *
   * Read from the image the browser has already decoded for the preview, so
   * there is no second fetch and no guess. Null for an SVG or a PDF, which are
   * never rendered here (ADR-011) — the design is then a positioned *region*
   * with a width and no derivable height, which is what the workshop is told.
   */
  const artworkAspect = useMemo(() => {
    const ready = state.files.find((file) => file.status === 'ready' && file.previewUrl);
    return ready?.naturalWidth && ready?.naturalHeight
      ? { widthPx: ready.naturalWidth, heightPx: ready.naturalHeight }
      : null;
  }, [state.files]);

  /**
   * The size, from wherever it came.
   *
   * The box on the garment when there is one, the customer's own figure when
   * there is not. One value, so the review, the estimate and the payload cannot
   * disagree about what was asked for.
   */
  const chosenSize = placedSurface
    ? designSize(state.transform, placedSurface.widthMm, artworkAspect)
    : state.sizeMm;
  /**
   * The attached files, as a stable string.
   *
   * The estimate depends on *which* files are attached and whether they have
   * finished uploading, because condition 7 of 2.3 reads their status — so an
   * upload completing must re-price. A joined key rather than the array keeps
   * the effect from firing on every render.
   */
  const fileKey = state.files
    .map((file) => `${file.designFileId ?? file.localId}:${file.status}`)
    .join('|');
  const attachedFileIds = useMemo(
    () => state.files.filter((f) => f.designFileId).map((f) => f.designFileId!),
    // `fileKey` changes exactly when the set or a status does, which is when
    // the estimate must be asked again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fileKey],
  );

  // The three identifiers the server needs before it can price anything.
  /*
   * A product is enough to price something.
   *
   * It used to take a product, a placement and a size. Two of those are gone:
   * the placement is a position rather than a choice, and the size is derived
   * from it (ADR-035). So an estimate appears as soon as a blank is picked,
   * which is what 2.4.1 asks for — a figure on every step, from the first.
   */
  const canEstimate = Boolean(productSlug);

  const update = useCallback((patch: Partial<BuilderState>) => {
    setState((current) => ({ ...current, ...patch }));
  }, []);

  /**
   * Move focus to the step heading on every change.
   *
   * A stepper replaces the whole main region; without this a screen-reader or
   * keyboard user stays focused on a Continue button that no longer exists and
   * is never told what happened (`DESIGN-SYSTEM.md` section 14).
   */
  useEffect(() => {
    if (skipFocus.current) {
      skipFocus.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [stepIndex]);

  /**
   * Re-price whenever an input that affects the price changes.
   *
   * Every value here is an identifier or a count. The server resolves each one
   * and computes the number, so this effect cannot influence a price — only ask
   * for one.
   */
  useEffect(() => {
    // Whether an estimate applies is *derived*, not stored: clearing it with a
    // setState here would be a cascading render, and a stale number would be
    // rendered for one frame before it cleared.
    // `canEstimate` already proved all three; this narrows them for the
    // compiler and keeps the dependency list to the fields that affect a price.
    if (!canEstimate || !productSlug) return;

    const request = {
      productSlug,
      variantSku: variant?.sku ?? null,
      surfaceImageId,
      transform,
      artwork: artworkAspect,
      sizeMm,
      threadColorIds,
      hasText: embroideryText.trim().length > 0,
      instructions: instructions.trim() || null,
      quantity,
      designFileIds: attachedFileIds,
    };

    startEstimating(() => {
      void quoteEstimate(request).then(setEstimate);
    });
  }, [
    canEstimate,
    productSlug,
    surfaceImageId,
    transform,
    artworkAspect,
    sizeMm,
    threadColorIds,
    embroideryText,
    instructions,
    quantity,
    fileKey,
    attachedFileIds,
    variant?.sku,
  ]);

  /* --- files ------------------------------------------------------------- */

  /**
   * Send one file, in the three steps `SECURITY.md` section 6 specifies.
   *
   * The browser asks for permission, PUTs the bytes straight to storage, and
   * then tells the server it has finished. What comes back from that last call
   * is the only thing that turns the card green — this function cannot decide a
   * file is ready, and does not try.
   */
  const uploadOne = useCallback(
    async (localId: string, file: File) => {
      function patch(update: Partial<AttachedFile>) {
        setState((current) => ({
          ...current,
          files: current.files.map((entry) =>
            entry.localId === localId ? { ...entry, ...update } : entry,
          ),
        }));
      }

      const authorised = await requestUploadAction({
        filename: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });

      if (!authorised.ok) {
        patch({ status: 'error', error: authorised.message });
        return;
      }

      patch({ designFileId: authorised.value.designFileId });

      try {
        const response = await fetch(authorised.value.uploadUrl, {
          method: authorised.value.method,
          headers: authorised.value.headers,
          body: file,
        });

        if (!response.ok) throw new Error(String(response.status));
      } catch {
        patch({ status: 'error', error: t.order.proofFailedBody });
        return;
      }

      const finalised = await finaliseUploadAction({
        designFileId: authorised.value.designFileId,
      });

      if (!finalised.ok) {
        patch({ status: 'error', error: finalised.message });
        return;
      }

      patch({
        status: 'ready',
        error: null,
        // The server's preview of its own re-encoded raster, or nothing at all
        // for SVG and PDF. Never a blob URL of the uploaded file.
        previewUrl: finalised.value.previewUrl,
        // The *file's* proportions, as the server read them — not the
        // preview's. The placement editor turns this ratio into the height the
        // workshop stitches.
        naturalWidth: finalised.value.widthPx,
        naturalHeight: finalised.value.heightPx,
      });
    },
    [t],
  );

  const addFiles = useCallback(
    (incoming: File[]) => {
      const accepted: AttachedFile[] = [];
      const refused: FileRejection[] = [];

      for (const file of incoming) {
        const rejection = checkFile(file, t.custom);
        if (rejection) {
          refused.push(rejection);
          continue;
        }

        accepted.push({
          localId: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`,
          designFileId: null,
          name: file.name,
          size: file.size,
          contentType: file.type,
          status: 'uploading',
          error: null,
          previewUrl: null,
          naturalWidth: null,
          naturalHeight: null,
          file,
        });
      }

      setRejections(refused);
      setState((current) => {
        const room = MAX_FILES - current.files.length;
        const admitted = accepted.slice(0, Math.max(0, room));

        for (const attached of admitted) {
          void uploadOne(attached.localId, attached.file);
        }

        return { ...current, files: [...current.files, ...admitted] };
      });
    },
    [uploadOne, t],
  );

  const retryFile = useCallback(
    (localId: string) => {
      setState((current) => {
        const target = current.files.find((file) => file.localId === localId);
        if (target) void uploadOne(localId, target.file);

        return {
          ...current,
          files: current.files.map((file) =>
            file.localId === localId
              ? { ...file, status: 'uploading' as const, error: null }
              : file,
          ),
        };
      });
    },
    [uploadOne],
  );

  const removeFile = useCallback((localId: string) => {
    setState((current) => {
      const target = current.files.find((file) => file.localId === localId);

      // Tell the server too, so the object and its row do not outlive the
      // customer's decision. Best effort: a failure here leaves a file the
      // sweeper will take, which is better than blocking the interaction.
      if (target?.designFileId) {
        void discardUploadAction({ designFileId: target.designFileId });
      }

      return { ...current, files: current.files.filter((f) => f.localId !== localId) };
    });
  }, []);

  /* --- submit ------------------------------------------------------------ */

  function submit() {
    if (!state.productSlug) return;

    const payload = {
      productSlug: state.productSlug,
      variantSku: variant?.sku ?? null,
      options: state.options,
      // Percentages, never millimetres: the size band is what the embroidery
      // costs, so a millimetre figure from the browser would be a price the
      // browser chose. The server converts (ADR-035).
      surfaceImageId: state.surfaceImageId,
      transform: state.surfaceImageId ? state.transform : null,
      // Ignored by the server when a placement is present. Sent anyway so a
      // customer who switches garments mid-flow does not lose what they typed.
      sizeMm: state.sizeMm,
      threadColorIds: state.threadColorIds,
      embroideryText: state.embroideryText.trim() || null,
      instructions: state.instructions.trim() || null,
      quantity: state.quantity,
      // Identifiers only. The bytes went straight to storage and the server
      // decided each file was READY by reading them (SECURITY.md section 6).
      designFileIds: state.files
        .filter((attached) => attached.status === 'ready' && attached.designFileId)
        .map((attached) => attached.designFileId!),
      contactName: state.contactName.trim(),
      contactEmail: state.contactEmail.trim(),
      contactPhone: state.contactPhone.trim() || null,
    };

    startSubmitting(() => {
      void submitCustomRequest(payload).then((result) => {
        setSubmission(
          result.ok
            ? {
                ok: true,
                requestNumber: result.requestNumber,
                mode: result.pricingMode.mode,
                responseTimeHours: result.responseTimeHours,
              }
            : { ok: false, errors: result.errors },
        );
      });
    });
  }

  if (submission?.ok) {
    return <Submitted submission={submission} />;
  }

  const canContinue = isStepComplete(step.id, state);

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_20rem] lg:items-start lg:gap-16">
      <Stack gap={8}>
        <Stepper current={stepIndex} onJump={setStepIndex} state={state} />

        <Stack gap={6}>
          <Heading
            level={2}
            variant="display-md"
            ref={headingRef}
            tabIndex={-1}
            className="focus-visible:shadow-focus rounded-sm focus-visible:outline-none"
          >
            {stepIndex + 1}. {stepLabel(step.id, t)}
          </Heading>

          {step.id === 'product' && (
            <ProductStep
              products={products}
              state={state}
              onChange={update}
              product={product}
            />
          )}

          {step.id === 'placement' && (
            <Stack gap={6}>
              <Text variant="body" tone="muted" className="max-w-prose">
                {t.custom.placementLead}
              </Text>

              <PlacementEditor
                surfaces={product?.surfaces ?? []}
                artwork={firstArtwork(state)}
                artworkAspect={artworkAspect}
                sizes={reference.embroiderySizes}
                surfaceImageId={state.surfaceImageId}
                transform={state.transform}
                onChange={(patch) => update(patch)}
              />
            </Stack>
          )}

          {step.id === 'design' && (
            <DesignStep
              state={state}
              onChange={update}
              onFiles={addFiles}
              onRemoveFile={removeFile}
              onRetryFile={retryFile}
              rejections={rejections}
            />
          )}

          {step.id === 'options' && (
            <OptionsStep
              reference={reference}
              state={state}
              onChange={update}
              placedSize={chosenSize}
            />
          )}

          {step.id === 'review' && (
            <ReviewStep
              state={state}
              onChange={update}
              onEdit={setStepIndex}
              product={product}
              placementName={placementSummary(state, product, t)}
              sizeName={
                chosenSize
                  ? chosenSize.heightMm === null
                    ? t.custom.placementWidthOnly(chosenSize.widthMm)
                    : t.custom.placementSize(chosenSize.widthMm, chosenSize.heightMm)
                  : null
              }
              threadColorNames={threadColors.map((color) => color.name)}
              errors={submission?.ok === false ? submission.errors : []}
            />
          )}
        </Stack>

        <Divider />

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
          <Button
            variant="secondary"
            size="lg"
            disabled={stepIndex === 0}
            onClick={() => setStepIndex((index) => Math.max(0, index - 1))}
          >
            {t.custom.back}
          </Button>

          {step.id === 'review' ? (
            <Button
              size="lg"
              loading={submitting}
              disabled={!canContinue}
              onClick={submit}
            >
              {estimate?.ok && estimate.mode === 'QUOTE'
                ? t.custom.askQuote
                : t.custom.sendRequest}
            </Button>
          ) : (
            <Button
              size="lg"
              disabled={!canContinue}
              onClick={() =>
                setStepIndex((index) => Math.min(STEPS.length - 1, index + 1))
              }
            >
              Continuer
            </Button>
          )}
        </div>

        {!canContinue && (
          // A disabled primary action carries its reason in text
          // (DESIGN-SYSTEM.md section 8).
          <Text variant="body-sm" tone="subtle">
            {step.id === 'review'
              ? 'Renseignez votre nom et une adresse e-mail valide pour envoyer la demande.'
              : 'Faites un choix pour continuer.'}
          </Text>
        )}
      </Stack>

      <EstimatePanel
        estimate={canEstimate ? estimate : null}
        loading={estimating}
        currency={product?.currency}
      />
    </div>
  );
}

/* -------------------------------------------------------------------- steps */

/**
 * The progress indicator.
 *
 * Phase 14.5 replaced a wrapped row of text buttons separated by middots — five
 * peers, no sense of distance travelled, and on a 375px screen a ragged
 * two-line paragraph that read as navigation rather than as progress.
 *
 * What it is now: numbered markers on a rule, the rule filled up to where you
 * are. The number is the affordance and the label sits under it from `sm`; on a
 * phone only the current step is labelled, because five labels at 11px is a
 * caption nobody reads and the heading below already names the step.
 *
 * The behaviour is unchanged and is the part that matters: only steps already
 * reached are navigable, because jumping ahead skips choices the later steps
 * depend on, and `aria-current="step"` announces the position rather than
 * relying on the fill.
 */
function Stepper({
  current,
  onJump,
  state,
}: {
  current: number;
  onJump: (index: number) => void;
  state: BuilderState;
}) {
  const { t } = useDictionary();

  return (
    <nav aria-label={t.custom.stepperLabel}>
      <p className="text-overline text-fg-subtle mb-3">
        {t.custom.stepOf(current + 1, STEPS.length)}
      </p>

      <ol className="flex items-start">
        {STEPS.map((step, index) => {
          const done = index < current && isStepComplete(step.id, state);
          const isCurrent = index === current;
          const reachable = index <= current;
          const isLast = index === STEPS.length - 1;

          return (
            <li
              key={step.id}
              className={cn('relative flex min-w-0 flex-col', !isLast && 'flex-1')}
            >
              {/* The rule between this marker and the next, filled once passed. */}
              {!isLast && (
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute top-4 left-8 right-0 h-px',
                    index < current ? 'bg-accent' : 'bg-border',
                  )}
                />
              )}

              <button
                type="button"
                disabled={!reachable}
                aria-current={isCurrent ? 'step' : undefined}
                onClick={() => onJump(index)}
                className={cn(
                  'group relative flex flex-col items-start gap-2 pr-3 text-left',
                  'focus-visible:outline-none',
                  'disabled:cursor-not-allowed',
                )}
              >
                <span
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-full border',
                    'text-mono-sm tabular-nums',
                    'duration-fast transition-colors ease-out motion-reduce:transition-none',
                    'group-focus-visible:shadow-focus',
                    isCurrent && 'border-accent bg-accent text-fg-on-accent font-medium',
                    done && !isCurrent && 'border-accent text-accent bg-surface',
                    !isCurrent && !done && 'border-border text-fg-subtle bg-surface',
                    reachable && !isCurrent && 'group-hover:border-border-strong',
                  )}
                >
                  {done ? (
                    <Check className="size-4" aria-hidden="true" />
                  ) : (
                    <span aria-hidden="true">{index + 1}</span>
                  )}
                </span>

                <span
                  className={cn(
                    'text-caption truncate',
                    isCurrent ? 'text-fg font-medium' : 'text-fg-muted',
                    // One label on a phone: the heading below names the step,
                    // and five 11px labels across 375px is unreadable.
                    !isCurrent && 'sr-only sm:not-sr-only',
                  )}
                >
                  {stepLabel(step.id, t)}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function ProductStep({
  products,
  state,
  onChange,
  product,
}: {
  products: readonly BuilderProduct[];
  state: BuilderState;
  onChange: (patch: Partial<BuilderState>) => void;
  product: BuilderProduct | undefined;
}) {
  const { t } = useDictionary();

  return (
    <Stack gap={6}>
      <Text variant="body" tone="muted" className="max-w-prose">
        {t.custom.productLead}
      </Text>

      <div
        role="radiogroup"
        aria-label={t.custom.stepProduct}
        className="grid gap-4 sm:grid-cols-3"
      >
        {products.map((candidate) => {
          const selected = state.productSlug === candidate.slug;

          return (
            <button
              key={candidate.slug}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() =>
                onChange({
                  productSlug: candidate.slug,
                  // Options belong to the previous product.
                  options: defaultOptionsFor(candidate),
                })
              }
              className={[
                'flex flex-col gap-3 rounded-md border p-3 text-left',
                'transition-colors duration-fast ease-out motion-reduce:transition-none',
                'focus-visible:shadow-focus focus-visible:outline-none',
                selected
                  ? 'border-fg bg-bg-subtle'
                  : 'border-border hover:border-border-strong',
              ].join(' ')}
            >
              <ProductImage
                src={candidate.image?.src ?? null}
                alt={candidate.image?.alt ?? candidate.name}
                ratio="product"
                sizes="(min-width: 640px) 20vw, 90vw"
              />
              <Stack gap={1}>
                <Text variant="heading-sm" as="span">
                  {candidate.name}
                </Text>
                <Text variant="body-sm" tone="muted" as="span">
                  {t.custom.fromPrice}{' '}
                  <Price
                    amount={candidate.fromPrice}
                    currency={candidate.currency}
                    size="sm"
                  />
                </Text>
              </Stack>
            </button>
          );
        })}
      </div>

      {product && product.options.length > 0 && (
        <Stack gap={5}>
          {product.options.map((option) => (
            <Stack key={option.name} gap={3}>
              <Overline as="p">{option.name}</Overline>
              <div
                role="radiogroup"
                aria-label={option.name}
                className="flex flex-wrap gap-2"
              >
                {option.values.map((value) => {
                  const selected = state.options[option.name] === value;

                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() =>
                        onChange({ options: { ...state.options, [option.name]: value } })
                      }
                      className={[
                        'min-h-11 min-w-11 rounded-sm border px-4 text-body-sm',
                        'transition-colors duration-fast ease-out motion-reduce:transition-none',
                        'focus-visible:shadow-focus focus-visible:outline-none',
                        selected
                          ? 'border-fg bg-fg text-fg-inverted'
                          : 'border-border-strong text-fg hover:bg-hover',
                      ].join(' ')}
                    >
                      {value}
                    </button>
                  );
                })}
              </div>
            </Stack>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

function defaultOptionsFor(product: BuilderProduct): Record<string, string> {
  const preferred = product.variants.find((variant) => variant.available);
  if (preferred) return { ...preferred.options };

  return Object.fromEntries(
    product.options.flatMap((option) =>
      option.values[0] ? [[option.name, option.values[0]]] : [],
    ),
  );
}

/**
 * The design the editor draws, when there is one a browser can draw.
 *
 * The first ready file with a preview. An SVG or a PDF has none (ADR-011), and
 * a text-only order has no file at all — both cases fall through to a labelled
 * box that is still positioned and still measured, because the customer is
 * placing a *region* and the workshop is told exactly which one.
 */
function firstArtwork(
  state: BuilderState,
): { previewUrl: string | null; name: string } | null {
  const ready = state.files.find((file) => file.status === 'ready');
  if (!ready) return null;

  return { previewUrl: ready.previewUrl, name: ready.name };
}

/**
 * The placement, in one line, for the review step.
 *
 * The server writes its own snapshot at submission (`describePlacement`); this
 * is the same sentence computed in the browser so the customer reads the same
 * words before and after they press send.
 */
function placementSummary(
  state: BuilderState,
  product: BuilderProduct | undefined,
  t: Dictionary,
): string | null {
  const surface = product?.surfaces.find(
    (candidate) => candidate.imageId === state.surfaceImageId,
  );

  if (!surface) return null;

  const size = designSize(state.transform, surface.widthMm, null);
  const face = t.custom.surfaceNames[surface.surface];

  return `${face} · ${t.custom.placementWidthOnly(size.widthMm)}`;
}

function DesignStep({
  state,
  onChange,
  onFiles,
  onRemoveFile,
  onRetryFile,
  rejections,
}: {
  state: BuilderState;
  onChange: (patch: Partial<BuilderState>) => void;
  onFiles: (files: File[]) => void;
  onRemoveFile: (localId: string) => void;
  onRetryFile: (localId: string) => void;
  rejections: readonly FileRejection[];
}) {
  const { t } = useDictionary();

  return (
    <Stack gap={6}>
      <Text variant="body" tone="muted" className="max-w-prose">
        {t.custom.designLead}
      </Text>

      <UploadDropzone
        accept={ACCEPT_ATTRIBUTE}
        multiple
        onFilesSelected={onFiles}
        hint={t.custom.designHint}
        disabled={state.files.length >= MAX_FILES}
      />

      <Text variant="body-sm" tone="subtle" className="max-w-prose">
        {t.custom.designAdvice}
      </Text>

      {rejections.length > 0 && (
        <Alert tone="danger" title={t.custom.filesRejectedTitle}>
          <ul className="list-disc pl-4">
            {rejections.map((rejection) => (
              <li key={rejection.name}>
                {rejection.name} — {rejection.reason}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      {state.files.length > 0 && (
        <Stack gap={3}>
          <Overline as="p">{t.custom.attachedFiles}</Overline>

          {/*
            The list is a live region: an upload finishing is a change the
            customer did not trigger at that instant, so a screen reader is
            told rather than left to discover it.
          */}
          <div role="status" aria-live="polite" className="flex flex-col gap-3">
            {state.files.map((attached) => (
              <Stack key={attached.localId} gap={2}>
                <FileCard
                  name={attached.name}
                  size={attached.size}
                  contentType={attached.contentType}
                  {...(attached.previewUrl ? { thumbnailSrc: attached.previewUrl } : {})}
                  onRemove={() => onRemoveFile(attached.localId)}
                />

                {attached.status === 'uploading' && (
                  <Text variant="body-sm" tone="muted">
                    {t.custom.uploadingFile(attached.name)}
                  </Text>
                )}

                {attached.status === 'error' && (
                  <Inline gap={3} align="center">
                    <Text variant="body-sm" tone="danger">
                      {attached.error ?? t.upload.failed}
                    </Text>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onRetryFile(attached.localId)}
                    >
                      {t.custom.uploadRetry}
                    </Button>
                  </Inline>
                )}
              </Stack>
            ))}
          </div>

          {state.files.some((file) => !isPreviewableType(file.contentType)) && (
            <Text variant="body-sm" tone="subtle">
              {t.custom.noPreviewNote}
            </Text>
          )}
        </Stack>
      )}

      <Divider />

      <FormField
        label={t.custom.embroideryTextLabel}
        description={t.custom.embroideryTextHint}
        optional
      >
        {(props) => (
          <Input
            maxLength={60}
            placeholder={t.custom.namePlaceholder}
            value={state.embroideryText}
            onChange={(event) => onChange({ embroideryText: event.target.value })}
            {...props}
          />
        )}
      </FormField>
    </Stack>
  );
}

/**
 * How big the embroidery is — asked once, and only when it has to be.
 *
 * The placement step already answers this for any garment with a measured
 * photograph: the box the customer dragged *is* the size, in millimetres, shown
 * live under the canvas. Asking again here with a second control — which is
 * what this step used to do — is asking the same question twice and then
 * ignoring one of the answers.
 *
 * So when a placement exists this is a **read-only line** confirming what was
 * dragged. When one does not, because the blank has no measured photograph, it
 * becomes the only place the size can be given: three presets for the common
 * cases and two fields for everything else. A band is a price bracket, not a
 * menu — somebody who wants 73 mm should be able to say 73 mm.
 */
function SizeSection({
  reference,
  state,
  onChange,
  placedSize,
}: {
  reference: BuilderReferenceData;
  state: BuilderState;
  onChange: (patch: Partial<BuilderState>) => void;
  /** The dragged size, when the design was placed on a garment. */
  placedSize: { widthMm: number; heightMm: number | null } | null;
}) {
  const { t } = useDictionary();

  if (placedSize) {
    return (
      <Stack gap={2}>
        <Overline as="p">{t.custom.embroiderySize}</Overline>
        <Inline gap={3} wrap className="items-baseline">
          <Text variant="heading-sm" as="p">
            {placedSize.heightMm === null
              ? t.custom.placementWidthOnly(placedSize.widthMm)
              : t.custom.placementSize(placedSize.widthMm, placedSize.heightMm)}
          </Text>
          <Text variant="body-sm" tone="subtle" as="p">
            {t.custom.sizeFromPlacement}
          </Text>
        </Inline>
      </Stack>
    );
  }

  const current = state.sizeMm;

  return (
    <Stack gap={3}>
      <Overline as="p">{t.custom.embroiderySize}</Overline>
      <Text variant="body-sm" tone="muted" className="max-w-prose">
        {t.custom.sizeLead}
      </Text>

      <div
        role="radiogroup"
        aria-label={t.custom.embroiderySize}
        className="grid gap-3 sm:grid-cols-3"
      >
        {reference.embroiderySizes.map((band) => {
          const size = band.maxWidthMm
            ? { widthMm: band.maxWidthMm, heightMm: band.maxHeightMm }
            : null;

          const selected =
            size !== null &&
            current?.widthMm === size.widthMm &&
            current?.heightMm === size.heightMm;

          return (
            <button
              key={band.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={size === null}
              onClick={() => onChange({ sizeMm: size })}
              className={[
                'flex min-h-11 flex-col gap-1 rounded-md border p-4 text-left',
                'transition-colors duration-fast ease-out motion-reduce:transition-none',
                'focus-visible:shadow-focus focus-visible:outline-none',
                selected
                  ? 'border-fg bg-bg-subtle'
                  : 'border-border hover:border-border-strong',
              ].join(' ')}
            >
              <Text variant="heading-sm" as="span">
                {band.name}
              </Text>
              {band.maxWidthMm && (
                <Text variant="caption" tone="subtle" as="span">
                  {t.custom.sizeUpTo(band.maxWidthMm)}
                </Text>
              )}
            </button>
          );
        })}
      </div>

      {/*
       * The custom pair.
       *
       * Not hidden behind a "custom" toggle: a toggle is one more thing to
       * discover, and typing a number into a field that already shows the
       * preset's value is the most direct way to say "like that, but 73".
       */}
      <Inline gap={4} wrap>
        <FormField label={t.custom.sizeWidthMm} className="min-w-32 flex-1">
          {(props) => (
            <Input
              {...props}
              type="number"
              inputMode="numeric"
              min={MIN_DESIGN_WIDTH_MM}
              max={MAX_DESIGN_WIDTH_MM}
              value={current?.widthMm ?? ''}
              onChange={(event) => {
                const widthMm = Number.parseInt(event.target.value, 10);
                onChange({
                  sizeMm: Number.isFinite(widthMm)
                    ? { widthMm, heightMm: current?.heightMm ?? null }
                    : null,
                });
              }}
            />
          )}
        </FormField>

        <FormField label={t.custom.sizeHeightMm} optional className="min-w-32 flex-1">
          {(props) => (
            <Input
              {...props}
              type="number"
              inputMode="numeric"
              min={MIN_DESIGN_WIDTH_MM}
              max={MAX_DESIGN_WIDTH_MM}
              disabled={!current}
              value={current?.heightMm ?? ''}
              onChange={(event) => {
                if (!current) return;
                const heightMm = Number.parseInt(event.target.value, 10);
                onChange({
                  sizeMm: {
                    widthMm: current.widthMm,
                    heightMm: Number.isFinite(heightMm) ? heightMm : null,
                  },
                });
              }}
            />
          )}
        </FormField>
      </Inline>
    </Stack>
  );
}

function OptionsStep({
  reference,
  state,
  onChange,
  placedSize,
}: {
  reference: BuilderReferenceData;
  state: BuilderState;
  onChange: (patch: Partial<BuilderState>) => void;
  placedSize: { widthMm: number; heightMm: number | null } | null;
}) {
  const { t } = useDictionary();
  const max = reference.settings.limits.maxThreadColors;
  const quoteThreshold = reference.settings.quoteThresholdThreadColors;

  function toggleColor(id: string) {
    const selected = state.threadColorIds.includes(id);
    if (selected) {
      onChange({ threadColorIds: state.threadColorIds.filter((value) => value !== id) });
      return;
    }
    if (state.threadColorIds.length >= max) return;
    onChange({ threadColorIds: [...state.threadColorIds, id] });
  }

  return (
    <Stack gap={8}>
      <SizeSection
        reference={reference}
        state={state}
        onChange={onChange}
        placedSize={placedSize}
      />

      <Stack gap={3}>
        <Inline gap={2} justify="between">
          <Overline as="p">{t.custom.threadColors}</Overline>
          <Text variant="body-sm" tone="muted" numeric>
            {state.threadColorIds.length} / {max}
          </Text>
        </Inline>

        <Text variant="body-sm" tone="subtle" className="max-w-prose">
          {t.custom.threadThreshold(quoteThreshold)}
        </Text>

        <div className="flex flex-wrap gap-2">
          {reference.threadColors.map((color) => {
            const selected = state.threadColorIds.includes(color.id);
            const atLimit = !selected && state.threadColorIds.length >= max;

            return (
              <button
                key={color.id}
                type="button"
                role="checkbox"
                aria-checked={selected}
                aria-disabled={atLimit || undefined}
                onClick={() => toggleColor(color.id)}
                className={[
                  'flex min-h-11 items-center gap-2 rounded-sm border px-3 text-body-sm',
                  'transition-colors duration-fast ease-out motion-reduce:transition-none',
                  'focus-visible:shadow-focus focus-visible:outline-none',
                  selected
                    ? 'border-fg bg-fg text-fg-inverted'
                    : 'border-border-strong text-fg hover:bg-hover',
                  atLimit && 'cursor-not-allowed opacity-40',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <span
                  aria-hidden="true"
                  className="border-border inline-block size-3 rounded-full border"
                  style={{ backgroundColor: color.hexColor }}
                />
                {color.name}
              </button>
            );
          })}
        </div>
      </Stack>

      <Stack gap={3}>
        <Overline as="p">{t.product.quantity}</Overline>
        <QuantitySelector
          value={state.quantity}
          onChange={(quantity) => onChange({ quantity })}
          max={reference.settings.limits.maxQuantity}
        />
        <Text variant="body-sm" tone="subtle">
          {t.custom.quantityDiscountNote}
        </Text>
      </Stack>

      <FormField
        label={t.customization.instructions}
        description={t.custom.instructionsHint}
        optional
      >
        {(props) => (
          <Textarea
            rows={4}
            maxLength={reference.settings.limits.maxInstructionsLength}
            value={state.instructions}
            onChange={(event) => onChange({ instructions: event.target.value })}
            {...props}
          />
        )}
      </FormField>
    </Stack>
  );
}

function ReviewStep({
  state,
  onChange,
  onEdit,
  product,
  placementName,
  sizeName,
  threadColorNames,
  errors,
}: {
  state: BuilderState;
  onChange: (patch: Partial<BuilderState>) => void;
  onEdit: (index: number) => void;
  product: BuilderProduct | undefined;
  placementName: string | null;
  sizeName: string | null;
  threadColorNames: readonly string[];
  errors: readonly string[];
}) {
  const { t } = useDictionary();
  const rows: { label: string; value: string; step: number }[] = [
    { label: t.custom.rowProduct, value: product?.name ?? '—', step: 0 },
    ...Object.entries(state.options).map(([name, value]) => ({
      label: name,
      value,
      step: 0,
    })),
    { label: t.custom.rowPlacement, value: placementName ?? '—', step: 1 },
    {
      label: t.custom.rowDesign,
      value:
        state.files.length > 0
          ? state.files.map((file) => file.name).join(', ')
          : state.embroideryText || '—',
      step: 2,
    },
    { label: t.custom.rowSize, value: sizeName ?? '—', step: 3 },
    {
      label: t.custom.rowThreads,
      value: threadColorNames.join(', ') || '—',
      step: 3,
    },
    { label: t.custom.rowQuantity, value: String(state.quantity), step: 3 },
    { label: t.custom.rowInstructions, value: state.instructions || '—', step: 3 },
  ];

  return (
    <Stack gap={8}>
      {errors.length > 0 && (
        <Alert tone="danger" title={t.custom.submitFailedTitle}>
          <ul className="list-disc pl-4">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </Alert>
      )}

      <Card padding="none">
        <dl className="divide-border divide-y">
          {rows.map((row) => (
            <div
              key={`${row.label}-${row.value}`}
              className="flex flex-col gap-1 p-4 sm:flex-row sm:items-start sm:gap-4"
            >
              <dt className="text-body-sm text-fg-subtle sm:w-40 sm:shrink-0">
                {row.label}
              </dt>
              {/* The edit action lives inside the <dd>: a <dl> may only contain
               * <dt>, <dd> and grouping <div>s, so a sibling <button> is
               * invalid markup as well as an axe failure. */}
              <dd className="text-body-sm text-fg flex min-w-0 flex-1 items-start justify-between gap-3">
                <span className="min-w-0 break-words">{row.value}</span>
                <button
                  type="button"
                  onClick={() => onEdit(row.step)}
                  className="text-fg-muted hover:text-fg focus-visible:shadow-focus flex min-h-11 shrink-0 items-center gap-1 rounded-sm px-2 text-body-sm focus-visible:outline-none"
                >
                  <Pencil className="size-3.5" aria-hidden="true" />
                  {t.custom.edit}
                  <span className="sr-only"> {row.label}</span>
                </button>
              </dd>
            </div>
          ))}
        </dl>
      </Card>

      <Stack gap={5}>
        <Heading level={3} variant="heading-lg">
          {t.custom.contactHeading}
        </Heading>

        <Text variant="body-sm" tone="muted" className="max-w-prose">
          {t.custom.contactLead}
        </Text>

        <FormField label={t.checkout.fullName} required>
          {(props) => (
            <Input
              autoComplete="name"
              value={state.contactName}
              onChange={(event) => onChange({ contactName: event.target.value })}
              {...props}
            />
          )}
        </FormField>

        <FormField label={t.checkout.email} required>
          {(props) => (
            <Input
              type="email"
              autoComplete="email"
              placeholder={t.custom.emailPlaceholder}
              value={state.contactEmail}
              onChange={(event) => onChange({ contactEmail: event.target.value })}
              {...props}
            />
          )}
        </FormField>

        <FormField label={t.checkout.phone} optional>
          {(props) => (
            <Input
              type="tel"
              autoComplete="tel"
              value={state.contactPhone}
              onChange={(event) => onChange({ contactPhone: event.target.value })}
              {...props}
            />
          )}
        </FormField>
      </Stack>
    </Stack>
  );
}

/* ----------------------------------------------------------------- estimate */

function EstimatePanel({
  estimate,
  loading,
  currency,
}: {
  estimate: EstimateResult | null;
  loading: boolean;
  currency: string | undefined;
}) {
  const { t } = useDictionary();

  return (
    <Card className="lg:sticky lg:top-28">
      <Stack gap={4}>
        <Overline as="p">{t.custom.estimate}</Overline>

        {loading && !estimate ? (
          <Skeleton className="h-8 w-32" />
        ) : !estimate ? (
          <Text variant="body-sm" tone="muted">
            {t.custom.estimateEmpty}
          </Text>
        ) : !estimate.ok ? (
          <Text variant="body-sm" tone="muted">
            {t.custom.estimatePending}
          </Text>
        ) : (
          <Stack gap={4}>
            <div aria-live="polite">
              {estimate.mode === 'FIXED' ? (
                <Price
                  amount={estimate.min}
                  {...(currency ? { currency } : {})}
                  size="lg"
                />
              ) : (
                <Inline gap={2} align="baseline">
                  <Price
                    amount={estimate.min}
                    {...(currency ? { currency } : {})}
                    size="lg"
                  />
                  <Text variant="body" tone="muted" as="span">
                    –
                  </Text>
                  <Price
                    amount={estimate.max}
                    {...(currency ? { currency } : {})}
                    size="lg"
                  />
                </Inline>
              )}
            </div>

            {estimate.mode === 'QUOTE' ? (
              <Stack gap={2}>
                <Badge variant="accentOutline">{t.custom.quoteNeeded}</Badge>
                <Text variant="body-sm" tone="muted">
                  {estimate.reasons.length > 0 && (
                    <>
                      {t.custom.quoteBecause}{' '}
                      {estimate.reasons
                        .map((reason) => t.labels.quoteReason[reason])
                        .join(', ')}
                      .{' '}
                    </>
                  )}
                  {t.custom.quoteConfirmWithin(estimate.responseTimeHours)}
                </Text>
              </Stack>
            ) : (
              <Text variant="body-sm" tone="muted">
                {t.custom.fixedPriceNote}
              </Text>
            )}

            {estimate.discountAmount > 0 && (
              <Text variant="body-sm" tone="muted">
                {t.custom.quantityDiscount(estimate.discountBasisPoints / 100)}
                &nbsp;:{' '}
                <Price
                  amount={estimate.discountAmount}
                  {...(currency ? { currency } : {})}
                  size="sm"
                />
              </Text>
            )}

            {estimate.setupFee > 0 && (
              <Text variant="body-sm" tone="subtle">
                {t.custom.setupFeeIncluded}&nbsp;:{' '}
                <Price
                  amount={estimate.setupFee}
                  {...(currency ? { currency } : {})}
                  size="sm"
                />{' '}
                {t.custom.setupFeeOnce}
              </Text>
            )}

            <Text variant="caption" tone="subtle">
              {t.custom.estimateCaveat}
            </Text>
          </Stack>
        )}
      </Stack>
    </Card>
  );
}

function Submitted({
  submission,
}: {
  submission: {
    requestNumber: string;
    mode: 'FIXED' | 'QUOTE';
    responseTimeHours: number;
  };
}) {
  const { t } = useDictionary();

  return (
    <Stack gap={6} className="max-w-prose">
      <Alert tone="success" title={t.custom.receivedTitle}>
        {t.custom.referenceBefore}
        <strong>{submission.requestNumber}</strong>
        {t.custom.referenceAfter}
      </Alert>

      <Text variant="body">
        {submission.mode === 'QUOTE'
          ? t.custom.nextQuote(submission.responseTimeHours)
          : t.custom.nextFixed(submission.responseTimeHours)}
      </Text>

      {/*
       * This used to say the opposite — that a joined file would be asked for
       * again by e-mail because uploading from the site was "coming soon".
       * Phase 9 shipped the upload pipeline and the line was never revisited,
       * so a customer who had just watched their file upload, be validated and
       * come back as a server-generated preview was then told it had not
       * arrived. Phase 14.6's journey walked into it.
       */}
      <Text variant="body-sm" tone="muted">
        {t.custom.filesKept}
      </Text>
    </Stack>
  );
}
