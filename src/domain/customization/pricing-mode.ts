/**
 * Which pricing mode applies.
 *
 * `BUSINESS-RULES.md` section 2.3, and the sentence that governs this whole
 * file: **the system decides, not the customer.** Section 2.3.2 adds that the
 * mode is computed server-side on every save and a client-supplied
 * `pricingMode` is ignored — which is why this function takes inputs and
 * returns a decision, and why nothing in `app/` may reach the same conclusion
 * on its own.
 *
 * A configuration is `FIXED` only when *every* condition holds. Otherwise it is
 * `QUOTE`, and the reason is recorded so the customer is told **why** rather
 * than being stalled.
 *
 * Conditions 4, 5 and 6 read named settings keys. All three are seeded and
 * listed in `DATABASE.md` section 14; none of them is hard-coded here, which is
 * why they arrive as a parameter.
 */

export type PricingMode = 'FIXED' | 'QUOTE';

/** The reasons, in the order section 2.3 lists its conditions. */
export type QuoteReason =
  | 'FREEFORM_PRODUCT'
  | 'CUSTOM_PLACEMENT'
  | 'CUSTOM_DIMENSIONS'
  | 'THREAD_COLORS'
  | 'QUANTITY'
  | 'INSTRUCTIONS'
  | 'ARTWORK_REVIEW';

export type PricingModeThresholds = {
  /** `custom_orders.quoteThresholdThreadColors`, default 3. */
  quoteThresholdThreadColors: number;
  /** `custom_orders.quoteThresholdQuantity`, default 10. */
  quoteThresholdQuantity: number;
  /** `custom_orders.quoteThresholdInstructionLength`, default 200. */
  quoteThresholdInstructionLength: number;
};

/** The configuration facts the decision reads. Deliberately not a Prisma row. */
export type PricingModeInput = {
  /** Condition 1: a catalogue product and a real variant. */
  productId: string | null;
  variantId: string | null;
  freeformProductType: string | null;
  /**
   * Condition 2: the design is on a measured face of the garment.
   *
   * Was "a placement from the profile" — a name off a list. Freeform placement
   * (ADR-035) replaced the list, so the question became the one that was
   * actually being asked underneath it: *does the shop know where this goes?*
   * A design dropped on a photograph the owner has measured is knowable to the
   * millimetre; one described in a sentence is not.
   */
  placedOnSurface: boolean;
  customPlacementNote: string | null;
  /**
   * Condition 3: the dragged size falls inside a priced band.
   *
   * Was "a predefined size, not free dimensions". Now every size is free —
   * that is the point of dragging — so the condition is whether the price table
   * covers it. A design bigger than every band is a real order that a table
   * cannot price, which is exactly what a human quote is for.
   */
  embroiderySizeId: string | null;
  /** Condition 4. */
  threadColorCount: number;
  /** Condition 5. */
  quantity: number;
  /** Condition 6. */
  instructions: string | null;
  /** Condition 7: every attached design file is `READY`. */
  allDesignFilesReady: boolean;
};

export type PricingModeDecision = {
  mode: PricingMode;
  /** Every condition that failed, in section 2.3's order. Empty when FIXED. */
  reasons: readonly QuoteReason[];
};

/**
 * Human-facing copy for each reason.
 *
 * `UX.md` section 5 requires the trigger to be stated explicitly — "bulk
 * quantity", "custom placement", "complex artwork" — so the customer does not
 * read the quote as a stall. French, because V1 is single-locale.
 */
export const QUOTE_REASON_LABELS: Record<QuoteReason, string> = {
  FREEFORM_PRODUCT: 'un produit hors catalogue',
  CUSTOM_PLACEMENT: 'un emplacement sur mesure',
  CUSTOM_DIMENSIONS: 'des dimensions sur mesure',
  THREAD_COLORS: 'le nombre de couleurs de fil',
  QUANTITY: 'la quantité demandée',
  INSTRUCTIONS: 'des instructions détaillées',
  ARTWORK_REVIEW: 'la vérification de votre fichier',
};

export function determinePricingMode(
  input: PricingModeInput,
  thresholds: PricingModeThresholds,
): PricingModeDecision {
  const reasons: QuoteReason[] = [];

  // 1. Names a catalogue product and a real variant.
  if (
    input.freeformProductType !== null ||
    input.productId === null ||
    input.variantId === null
  ) {
    reasons.push('FREEFORM_PRODUCT');
  }

  /*
   * 2. Placed on a measured face.
   *
   * The customer positioned the design on a photograph the owner has measured,
   * and added no note asking for something the picture cannot express. Either
   * failing means the workshop would be reading a description rather than a
   * measurement, and a description is a conversation.
   */
  if (!input.placedOnSurface || input.customPlacementNote !== null) {
    reasons.push('CUSTOM_PLACEMENT');
  }

  // 3. The size the customer dragged falls inside a band the price table
  // covers. `null` means it does not, and nothing here invents a price for it.
  if (input.embroiderySizeId === null) {
    reasons.push('CUSTOM_DIMENSIONS');
  }

  // 4. Thread colours at or below the threshold.
  if (input.threadColorCount > thresholds.quoteThresholdThreadColors) {
    reasons.push('THREAD_COLORS');
  }

  // 5. Quantity at or below the threshold.
  if (input.quantity > thresholds.quoteThresholdQuantity) {
    reasons.push('QUANTITY');
  }

  // 6. Instructions empty or shorter than the threshold. "Shorter than", so a
  // length exactly at the threshold already needs a quote.
  if ((input.instructions?.length ?? 0) >= thresholds.quoteThresholdInstructionLength) {
    reasons.push('INSTRUCTIONS');
  }

  // 7. Every attached design file is READY.
  if (!input.allDesignFilesReady) {
    reasons.push('ARTWORK_REVIEW');
  }

  return { mode: reasons.length === 0 ? 'FIXED' : 'QUOTE', reasons };
}
