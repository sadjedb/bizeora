'use server';

import {
  createCustomRequest,
  type CustomRequestResult,
} from '@/server/services/custom-request-service';
import {
  loadBuilderSettings,
  resolveRequestReferences,
} from '@/server/repositories/customization-repository';
import { resolveUnitPrice } from '@/domain/pricing';
import { estimateFor, priceCustomLine } from '@/domain/pricing/customization';
import {
  determinePricingMode,
  type QuoteReason,
} from '@/domain/customization/pricing-mode';
import {
  clampSize,
  clampTransform,
  designSize,
  resolveSizeBand,
} from '@/domain/customization/placement';
import { readCartOwner } from '@/server/cart/owner';
import { findOwnedFiles } from '@/server/repositories/design-file-repository';

/**
 * The builder's two server entry points.
 *
 * `UX.md` section 5 requires a running estimate at every step, and
 * `BUSINESS-RULES.md` 2.3.2 requires the pricing mode to be computed
 * server-side. Both are the same call: the client sends its selections, the
 * server re-reads the referenced rows, runs the domain functions and returns a
 * number with an explanation.
 *
 * The client never computes an estimate, a discount or a mode. It renders what
 * comes back. That is why `quoteEstimate` exists at all rather than the numbers
 * being derived in the browser from data the page already has — data the page
 * has is data a user can edit.
 */

export type EstimateResult =
  | {
      ok: true;
      mode: 'FIXED' | 'QUOTE';
      reasons: readonly QuoteReason[];
      min: number;
      max: number;
      /** Shown as its own line, never folded into a unit price (2.5). */
      discountBasisPoints: number;
      discountAmount: number;
      setupFee: number;
      responseTimeHours: number;
    }
  | { ok: false; reason: string };

export type EstimateRequest = {
  productSlug: string;
  variantSku: string | null;
  /** The photograph the design sits on, and where on it (ADR-035). */
  surfaceImageId: string | null;
  transform: {
    xPercent: number;
    yPercent: number;
    widthPercent: number;
    rotationDeg: number;
  } | null;
  /** Pixel dimensions of the artwork, so its height can be derived. */
  artwork: { widthPx: number; heightPx: number } | null;
  /** The size, for a garment there is nothing to place on. */
  sizeMm: { widthMm: number; heightMm: number | null } | null;
  threadColorIds: string[];
  hasText: boolean;
  instructions: string | null;
  quantity: number;
  /**
   * The files the customer has attached so far.
   *
   * Ids, not a claim about them. Condition 7 of 2.3 asks whether every
   * attached file is `READY`, and only the database knows — a client that said
   * "all ready" while an upload was still in flight would be choosing its own
   * pricing mode.
   */
  designFileIds: string[];
};

/**
 * Price a configuration in progress.
 *
 * Reads nothing from the client but identifiers, then resolves each against the
 * database. A tampered payload cannot lower a price: it can only name rows that
 * do not exist, and then this returns an error.
 */
export async function quoteEstimate(request: EstimateRequest): Promise<EstimateResult> {
  const settings = await loadBuilderSettings();

  const owner = await readCartOwner();
  const files =
    request.designFileIds.length > 0 && owner
      ? await findOwnedFiles(request.designFileIds, owner)
      : [];

  // An id we cannot see is not a file we can call ready.
  const allFilesReady =
    files.length === request.designFileIds.length &&
    files.every((file) => file.status === 'READY');

  const resolution = await resolveRequestReferences({
    productSlug: request.productSlug,
    variantSku: request.variantSku,
    surfaceImageId: request.surfaceImageId,
    threadColorIds: request.threadColorIds,
  });

  if (!resolution.ok) {
    return { ok: false, reason: resolution.reason };
  }

  const { product, variant, surface, sizeBands, discountTiers } = resolution.references;

  /*
   * The same conversion the submit path does, for the same reason.
   *
   * The estimate has to agree with the price the request is finally submitted
   * at, so the band is chosen here exactly as it is there: from the size the
   * customer dragged, converted against the photograph's own calibration.
   * Duplicating the *call* is fine; duplicating the *arithmetic* would not be,
   * and it is not — both go through `domain/customization/placement`.
   */
  const size =
    surface && request.transform
      ? designSize(clampTransform(request.transform), surface.widthMm, request.artwork)
      : request.sizeMm
        ? clampSize(request.sizeMm)
        : null;

  const band = size ? resolveSizeBand(size, sizeBands) : null;

  const mode = determinePricingMode(
    {
      productId: product.id,
      variantId: variant?.id ?? null,
      freeformProductType: null,
      placedOnSurface: surface !== null && request.transform !== null,
      customPlacementNote: null,
      embroiderySizeId: band?.id ?? null,
      threadColorCount: request.threadColorIds.length,
      quantity: request.quantity,
      instructions: request.instructions,
      allDesignFilesReady: allFilesReady,
    },
    settings,
  );

  const priced = priceCustomLine(
    {
      productUnitPrice: resolveUnitPrice(
        { basePrice: product.basePrice, compareAtPrice: null },
        variant
          ? { priceOverride: variant.priceOverride, compareAtPriceOverride: null }
          : null,
      ),
      // The band, or the largest one as a floor when nothing covers the size.
      // Same rule as the submit path: 2.4.1 requires a figure on every step.
      embroiderySizeBasePrice:
        (
          band ??
          sizeBands.reduce<(typeof sizeBands)[number] | null>(
            (largest, candidate) =>
              largest === null || candidate.basePrice > largest.basePrice
                ? candidate
                : largest,
            null,
          )
        )?.basePrice ?? 0,
      // Freeform placement carries no modifier (ADR-035).
      placementModifier: 0,
      threadColorCount: request.threadColorIds.length,
      hasText: request.hasText,
      quantity: request.quantity,
    },
    settings,
    discountTiers,
  );

  if (!priced.ok) return { ok: false, reason: priced.reason };

  const estimate = estimateFor(priced.breakdown.total, mode.mode, settings);

  return {
    ok: true,
    mode: mode.mode,
    reasons: mode.reasons,
    min: estimate.min,
    max: estimate.max,
    discountBasisPoints: priced.breakdown.discountBasisPoints,
    discountAmount: priced.breakdown.discountAmount,
    setupFee: priced.breakdown.setupFee,
    responseTimeHours: settings.responseTimeHours,
  };
}

/**
 * Submit the request.
 *
 * All validation is the service's; this only forwards — and supplies the
 * **owner**, which the payload cannot. The owner is what scopes the attached
 * design files, so a request naming somebody else's file finds nothing.
 */
export async function submitCustomRequest(raw: unknown): Promise<CustomRequestResult> {
  const owner = await readCartOwner();
  return createCustomRequest(raw, owner);
}
