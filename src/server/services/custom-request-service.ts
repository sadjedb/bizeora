import 'server-only';

import { z } from 'zod';

import {
  clampSize,
  clampTransform,
  designSize,
  fitsWithin,
  resolveSizeBand,
  type DesignSize,
  type SizeBand,
} from '@/domain/customization/placement';

import { resolveUnitPrice } from '@/domain/pricing';
import { estimateFor, priceCustomLine } from '@/domain/pricing/customization';
import {
  determinePricingMode,
  type PricingModeDecision,
} from '@/domain/customization/pricing-mode';
import {
  CONFIGURATION_ISSUE_LABELS,
  validateConfiguration,
} from '@/domain/customization/validation';
import {
  findOwnedFiles,
  type FileOwner,
} from '@/server/repositories/design-file-repository';
import {
  loadBuilderSettings,
  nextRequestNumber,
  persistCustomRequest,
  resolveRequestReferences,
} from '@/server/repositories/customization-repository';
import {
  notifyRequestSubmitted,
  staffRecipients,
} from '@/server/services/notification-service';

/**
 * Creating a custom request.
 *
 * The one write path this phase adds, and the security boundary for it.
 * `SECURITY.md` section 5 and `AGENTS.md` section 8: every mutation is
 * validated server-side, and nothing the client says about money is believed.
 *
 * The payload carries **no price, no estimate, no discount, no deposit and no
 * pricing mode**. Not "they are ignored" — they are absent from the schema, so
 * a request carrying them fails to parse. Every one is derived here from rows
 * the client cannot influence:
 *
 *   - the product and variant, re-read and re-priced by `domain/pricing`
 *   - the placement and size, re-read from *this product's* profile
 *   - the thread colours, re-read by id
 *   - the thresholds and rates, re-read from settings
 *
 * `BUSINESS-RULES.md` 2.3.2 says the mode is computed server-side on every save
 * and a client-supplied `pricingMode` is ignored. Making it unrepresentable in
 * the input is the strongest way to honour that.
 *
 * This service orchestrates. It reads nothing itself: the repository owns the
 * queries, `domain/` owns the rules.
 */

/* ---------------------------------------------------------------------------
 * Input
 * ------------------------------------------------------------------------ */

const OPTION_SELECTION = z.record(z.string().min(1).max(60), z.string().min(1).max(120));

/**
 * A design file the customer attached in the browser.
 *
 * **Identifiers only.** Phase 7 accepted the browser's description of a file
 * because no storage existed; Phase 9 stores the bytes, so what arrives here is
 * a list of `DesignFile` ids. Each is re-read scoped to the owner and must
 * already be `READY` — a status only the server can set, after reading the
 * object's own bytes (`SECURITY.md` section 6). There is nowhere in this
 * schema for a status, a storage key or an owner, so none can be claimed.
 */

export const customRequestInput = z.object({
  productSlug: z.string().min(1).max(200),
  variantSku: z.string().min(1).max(120).nullable(),
  options: OPTION_SELECTION,
  /**
   * Where the design goes, as the customer positioned it (ADR-035).
   *
   * The browser sends **percentages of the surface**, never millimetres. That
   * is not a formatting preference — a millimetre figure from a client is a
   * price the client chose, because the size band is what the embroidery
   * costs. The percentages are converted here against the calibration stored
   * on the photograph, which is a number only the workshop can set.
   *
   * Null when the blank has no measured photograph to place on. A real state,
   * not an error: it sends the configuration to a human quote.
   */
  surfaceImageId: z.uuid().nullable().default(null),
  /**
   * The size, for a garment there is nothing to place on.
   *
   * A blank whose photographs nobody has measured cannot be dragged on, so the
   * customer says how big instead — either by pressing one of the priced bands
   * or by typing millimetres. Both arrive here as millimetres, which is what
   * makes it **one** size path: whatever produced the figure, the band that
   * prices it is resolved from the figure, never from an id the browser chose.
   *
   * Ignored when a placement is present. The dragged box is the size then, and
   * accepting a second opinion would be accepting a contradiction.
   */
  sizeMm: z
    .object({
      widthMm: z.number().min(1).max(2000),
      heightMm: z.number().min(1).max(2000).nullable().default(null),
    })
    .nullable()
    .default(null),
  transform: z
    .object({
      xPercent: z.number().min(0).max(100),
      yPercent: z.number().min(0).max(100),
      widthPercent: z.number().gt(0).max(100),
      rotationDeg: z.number().min(-180).max(180),
    })
    .nullable()
    .default(null),
  threadColorIds: z.array(z.uuid()).min(1).max(16),
  embroideryText: z.string().max(60).nullable(),
  instructions: z.string().max(2000).nullable(),
  quantity: z.number().int().min(1).max(1000),
  // Absent means no artwork, which is the common case: a name or a word to
  // embroider needs no file at all (UX.md section 5).
  designFileIds: z.array(z.uuid()).max(5).default([]),

  contactName: z.string().min(2).max(120),
  // Required: it is how the quote reaches the customer.
  contactEmail: z.email().max(255),
  contactPhone: z.string().min(6).max(40).nullable(),
});

export type CustomRequestInput = z.infer<typeof customRequestInput>;

export type CustomRequestResult =
  | {
      ok: true;
      requestNumber: string;
      pricingMode: PricingModeDecision;
      estimate: { min: number; max: number };
      responseTimeHours: number;
    }
  | { ok: false; errors: readonly string[] };

const FILE_ERROR =
  'Un fichier joint est introuvable ou n’a pas fini d’être vérifié. Réessayez l’envoi.';

const REFERENCE_ERRORS = {
  PRODUCT: 'Ce produit ne peut pas être personnalisé.',
  VARIANT: 'Cette déclinaison n’est pas disponible.',
  PLACEMENT: 'Cette face de vêtement n’appartient pas à ce produit.',
  SIZE: 'Aucune taille de broderie n’est configurée pour ce produit.',
  THREAD_COLOR: 'Une couleur de fil sélectionnée n’existe pas.',
} as const;

/* ---------------------------------------------------------------------------
 * The use case
 * ------------------------------------------------------------------------ */

export async function createCustomRequest(
  raw: unknown,
  owner: FileOwner | null = null,
): Promise<CustomRequestResult> {
  const parsed = customRequestInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((issue) => issue.message) };
  }

  const input = parsed.data;

  /**
   * Resolve the attached files before anything else.
   *
   * Scoped to the owner, so a file id belonging to somebody else resolves to
   * nothing, and required to be `READY`, so an upload that never completed —
   * or that failed validation — cannot reach a request. Both checks are in the
   * query rather than after it.
   */
  const files =
    input.designFileIds.length === 0
      ? []
      : owner
        ? await findOwnedFiles(input.designFileIds, owner)
        : [];

  const readyFiles = files.filter((file) => file.status === 'READY');

  if (readyFiles.length !== input.designFileIds.length) {
    return { ok: false, errors: [FILE_ERROR] };
  }

  const settings = await loadBuilderSettings();

  const resolution = await resolveRequestReferences(input);
  if (!resolution.ok) {
    return { ok: false, errors: [REFERENCE_ERRORS[resolution.reason]] };
  }

  const { product, variant, surface, sizeBands, discountTiers } = resolution.references;

  /* --- Where it goes, and how big that really is ------------------------- */

  /**
   * The conversion the customer is trusting.
   *
   * Percentages in, millimetres out, against a calibration only the workshop
   * can set. The transform is clamped first — a browser can send anything, and
   * a design half off the garment is not a placement — and then checked
   * against the surface's own proportions, because a portrait logo on a
   * portrait garment can pass a width check and still run off the hem.
   */
  const placed =
    surface && input.transform
      ? (() => {
          const transform = clampTransform(input.transform);
          const artwork =
            readyFiles[0]?.width && readyFiles[0]?.height
              ? { widthPx: readyFiles[0].width, heightPx: readyFiles[0].height }
              : null;

          const size = designSize(transform, surface.widthMm, artwork);

          return {
            transform,
            size,
            artwork,
            fits:
              surface.widthPx && surface.heightPx
                ? fitsWithin({
                    transform,
                    surface: { widthPx: surface.widthPx, heightPx: surface.heightPx },
                    artwork,
                  })
                : true,
          };
        })()
      : null;

  if (placed && !placed.fits) {
    return {
      ok: false,
      errors: ['Le motif dépasse du vêtement. Repositionnez-le ou réduisez-le.'],
    };
  }

  /*
   * The band that prices it, chosen from the size that was dragged.
   *
   * Null is not a failure: a design larger than every band is a real order that
   * a price table cannot price, which is exactly the condition that sends it to
   * a human (`domain/customization/pricing-mode`, condition 3).
   */
  /*
   * One size, from whichever source there was.
   *
   * Dragged beats typed: if the customer positioned the design on a photograph,
   * the box they left it at *is* the size, and the `sizeMm` field is whatever
   * an older client happened to send.
   */
  const size = placed ? placed.size : input.sizeMm ? clampSize(input.sizeMm) : null;

  const band = size ? resolveSizeBand(size, sizeBands) : null;

  /* --- Can it be built? -------------------------------------------------- */

  const issues = validateConfiguration(
    {
      productId: product.id,
      variantId: variant?.id ?? null,
      freeformProductType: null,
      // A blank with no measured photograph is described rather than placed.
      // The instructions carry the description, and the workshop reads it.
      customPlacementNote: placed ? null : (input.instructions ?? ''),
      // However it was given — dragged, pressed or typed.
      hasSize: size !== null,
      embroideryText: input.embroideryText,
      threadColorIds: input.threadColorIds,
      instructions: input.instructions,
      quantity: input.quantity,
      hasDesignFile: readyFiles.length > 0,
    },
    settings.limits,
  );

  if (issues.length > 0) {
    return {
      ok: false,
      errors: issues.map((issue) => CONFIGURATION_ISSUE_LABELS[issue]),
    };
  }

  /* --- Fixed price, or a human quote? ------------------------------------ */

  const pricingMode = determinePricingMode(
    {
      productId: product.id,
      variantId: variant?.id ?? null,
      freeformProductType: null,
      placedOnSurface: placed !== null,
      customPlacementNote: null,
      embroiderySizeId: band?.id ?? null,
      threadColorCount: input.threadColorIds.length,
      quantity: input.quantity,
      instructions: input.instructions,
      /**
       * Condition 7, now genuinely answerable. Phase 7 hard-coded this to
       * "there are no files", because no file could be `READY` without
       * storage; a request with artwork was therefore always a quote. The
       * files are stored and validated now, so an ordinary logo on an
       * otherwise simple configuration can be a fixed price again.
       */
      allDesignFilesReady: readyFiles.every((file) => file.status === 'READY'),
    },
    settings,
  );

  /* --- What does it cost? ------------------------------------------------ */

  const priced = priceCustomLine(
    {
      productUnitPrice: resolveUnitPrice(
        { basePrice: product.basePrice, compareAtPrice: null },
        variant
          ? { priceOverride: variant.priceOverride, compareAtPriceOverride: null }
          : null,
      ),
      /*
       * No band means no price table entry, and the configuration is already
       * `QUOTE` because of it. The estimate still has to show a number —
       * 2.4.1 forbids a step with no figure on it — so the largest band is
       * used as the floor it will certainly exceed, and the quote confirms.
       */
      embroiderySizeBasePrice: (band ?? largestBand(sizeBands))?.basePrice ?? 0,
      /*
       * Freeform placement carries no modifier.
       *
       * `profile_placements.priceModifier` priced *which named zone* the
       * customer picked, and there are no named zones any more (ADR-035). The
       * parameter stays because 2.2 still describes the term and a shop that
       * reintroduces zones would want it back; it is zero, explicitly, rather
       * than quietly dropped from the formula.
       */
      placementModifier: 0,
      threadColorCount: input.threadColorIds.length,
      hasText: Boolean(input.embroideryText?.trim()),
      quantity: input.quantity,
    },
    settings,
    discountTiers,
  );

  if (!priced.ok) {
    // A quantity with no matching tier is a data defect (2.5.2), never a
    // silent zero discount. Refuse rather than quote a number built on one.
    return {
      ok: false,
      errors: ['Le tarif ne peut pas être calculé pour cette quantité. Contactez-nous.'],
    };
  }

  const estimate = estimateFor(priced.breakdown.total, pricingMode.mode, settings);

  /* --- Persist ----------------------------------------------------------- */

  const requestNumber = await nextRequestNumber();

  // Before the transaction, for the same reason as at checkout: one connection.
  const workshop = await staffRecipients();

  await persistCustomRequest({
    requestNumber,
    /**
     * A request submitted while signed in belongs to that account from the
     * first moment, so it appears in the customer's portal without waiting to
     * be priced. A guest's stays unattached and is claimed by e-mail when the
     * workshop quotes it (Phase 10).
     */
    userId: owner?.kind === 'user' ? owner.userId : null,
    productId: product.id,
    variantId: variant?.id ?? null,
    placement:
      placed && surface
        ? {
            surface: surface.surface,
            surfaceImageId: surface.imageId,
            xPercent: placed.transform.xPercent,
            yPercent: placed.transform.yPercent,
            widthPercent: placed.transform.widthPercent,
            rotationDeg: placed.transform.rotationDeg,
            // Frozen with the other display snapshots, so a quote sent six
            // months ago still reads correctly after the blank's photograph
            // has been replaced (ADR-016).
            label: describePlacement(surface.surface, placed.size),
          }
        : null,
    embroiderySizeId: band?.id ?? null,
    embroideryWidthMm: size?.widthMm ?? null,
    embroideryHeightMm: size?.heightMm ?? null,
    embroideryText: input.embroideryText,
    threadColorIds: input.threadColorIds,
    instructions: input.instructions,
    quantity: input.quantity,
    pricingMode: pricingMode.mode,
    pricingModeReason:
      pricingMode.reasons.length > 0 ? pricingMode.reasons.join(',') : null,
    estimateMin: estimate.min,
    estimateMax: estimate.max,
    contactName: input.contactName,
    contactEmail: input.contactEmail,
    contactPhone: input.contactPhone,
    designFileIds: readyFiles.map((file) => file.id),
    /**
     * 8A: the workshop is told inside the same transaction
     * (`ARCHITECTURE.md` section 11). Nothing is sent here — the row is queued
     * and the dispatcher delivers it, so a provider outage cannot cost a
     * customer their request.
     */
    onSubmitted: async ({ tx, requestId, requestNumber }) => {
      await notifyRequestSubmitted(
        {
          staffRecipients: workshop,
          requestId,
          requestNumber,
          customerName: input.contactName,
          itemCount: 1,
          pricingMode: pricingMode.mode,
          estimateMin: estimate.min,
          estimateMax: estimate.max,
          // Every price in V1 is in the seeded shop currency (ADR-012).
          currency: 'DZD',
          responseTimeHours: settings.responseTimeHours,
        },
        tx,
      );
    },
    // The files are attached to the configuration now, so the note no longer
    // has to stand in for them.
    customerNote: null,
  });

  return {
    ok: true,
    requestNumber,
    pricingMode,
    estimate,
    responseTimeHours: settings.responseTimeHours,
  };
}

/**
 * The largest band, as a floor for an estimate that has no band at all.
 *
 * 2.4.1 requires a figure on every step, including in quote mode, so a design
 * bigger than the price table still has to produce a number. The biggest band
 * is the honest one to use: whatever the quote comes back at, it will not be
 * less.
 */
function largestBand(bands: readonly SizeBand[]): SizeBand | null {
  return bands.reduce<SizeBand | null>(
    (largest, band) =>
      largest === null || band.basePrice > largest.basePrice ? band : largest,
    null,
  );
}

/**
 * "Devant · 85 × 43 mm", for the workshop's screens.
 *
 * A sentence rather than four numbers, because every screen that shows a
 * configuration shows this and none of them should be doing arithmetic. Frozen
 * onto the row at submission so it survives the photograph being replaced.
 */
function describePlacement(surface: string, size: DesignSize): string {
  const face = SURFACE_LABELS[surface] ?? surface;

  return size.heightMm === null
    ? `${face} · ${size.widthMm} mm de large`
    : `${face} · ${size.widthMm} × ${size.heightMm} mm`;
}

/**
 * French, like every other snapshot written on the server.
 *
 * The workshop's screens are translated, but a value frozen onto a row has no
 * request locale to read — the limitation ADR-030 records and ADR-033 repeats.
 * It is written once, in the language the shop is run in.
 */
const SURFACE_LABELS: Record<string, string> = {
  FRONT: 'Devant',
  BACK: 'Dos',
  LEFT: 'Côté gauche',
  RIGHT: 'Côté droit',
  TOP: 'Dessus',
  WRAP: 'Vue 3D',
};
