/**
 * Configuration validation.
 *
 * `BUSINESS-RULES.md` section 16 lists "Configuration validation" as
 * `domain/customization`, consumed by the builder, the request service and the
 * order service. It answers *can this be built*, which is a different question
 * from *what does it cost* (`domain/pricing`) and from *does it need a human*
 * (`./pricing-mode`).
 *
 * The distinction that matters here is the two thread-colour limits, which
 * `DATABASE.md` section 14 warns must not be conflated:
 *
 *   - `maxThreadColors` (8) — above this a configuration **cannot be built**.
 *     That is this file.
 *   - `quoteThresholdThreadColors` (3) — above this it can be built but needs a
 *     human quote. That is `./pricing-mode`.
 *
 * Everything here is a rejection. Nothing here decides a price or a mode.
 */

export type ConfigurationLimits = {
  /** `custom_orders.maxThreadColors`, default 8. */
  maxThreadColors: number;
  /** Hard ceiling on a single request line. */
  maxQuantity: number;
  maxInstructionsLength: number;
  maxEmbroideryTextLength: number;
};

/** Defensible ceilings for the fields that have no settings key of their own. */
export const DEFAULT_CONFIGURATION_LIMITS: ConfigurationLimits = {
  maxThreadColors: 8,
  // A single line beyond this is a conversation, not a form submission.
  maxQuantity: 1000,
  maxInstructionsLength: 2000,
  maxEmbroideryTextLength: 60,
};

export type ConfigurationIssue =
  | 'NO_PRODUCT'
  | 'NO_EMBROIDERY_SIZE'
  | 'NO_DESIGN'
  | 'TOO_MANY_THREAD_COLORS'
  | 'NO_THREAD_COLOR'
  | 'QUANTITY_TOO_LOW'
  | 'QUANTITY_TOO_HIGH'
  | 'TEXT_TOO_LONG'
  | 'INSTRUCTIONS_TOO_LONG';

export type ConfigurationInput = {
  productId: string | null;
  variantId: string | null;
  freeformProductType: string | null;
  customPlacementNote: string | null;
  /**
   * Whether the configuration says how big the embroidery is.
   *
   * Not *which band*, because a band is a price bracket rather than a size: a
   * customer may drag a box, press a preset or type millimetres, and all three
   * are answers to this question (ADR-035). What is forbidden is no answer —
   * a workshop with a logo and no dimension cannot stitch anything.
   */
  hasSize: boolean;
  embroideryText: string | null;
  threadColorIds: readonly string[];
  instructions: string | null;
  quantity: number;
  /** A file the customer supplied, by name. Bytes are not the domain's concern. */
  hasDesignFile: boolean;
};

/**
 * Everything wrong with a configuration, or nothing.
 *
 * Returns the whole list rather than the first failure, so a form can mark
 * every bad field at once instead of making the customer discover them one
 * submit at a time.
 */
export function validateConfiguration(
  input: ConfigurationInput,
  limits: ConfigurationLimits = DEFAULT_CONFIGURATION_LIMITS,
): readonly ConfigurationIssue[] {
  const issues: ConfigurationIssue[] = [];

  // Something must be embroidered: a catalogue product or a described one.
  if (input.productId === null && input.freeformProductType === null) {
    issues.push('NO_PRODUCT');
  }

  /*
   * Where it goes is no longer a *validity* question.
   *
   * Freeform placement (ADR-035) removed the list a customer used to pick
   * from, and with it the "you did not choose an emplacement" error. A design
   * dropped on a measured photograph is knowable to the millimetre; one on a
   * blank the owner has not measured yet is knowable only from a sentence.
   * Both are buildable — the second just needs a person to read it, which is a
   * *pricing mode*, not a rejection (`./pricing-mode`, condition 2).
   *
   * How big it is, though, still is: a logo with no dimension is not an order.
   */
  if (!input.hasSize) issues.push('NO_EMBROIDERY_SIZE');

  /**
   * Something to stitch. `UX.md` section 5 describes a "skip, I only want text"
   * path, so text alone is a complete configuration — but text *or* a file must
   * be present, because an empty design is not an order.
   */
  if (!input.hasDesignFile && !input.embroideryText?.trim()) {
    issues.push('NO_DESIGN');
  }

  if (input.threadColorIds.length === 0) issues.push('NO_THREAD_COLOR');
  if (input.threadColorIds.length > limits.maxThreadColors) {
    issues.push('TOO_MANY_THREAD_COLORS');
  }

  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    issues.push('QUANTITY_TOO_LOW');
  } else if (input.quantity > limits.maxQuantity) {
    issues.push('QUANTITY_TOO_HIGH');
  }

  if ((input.embroideryText?.length ?? 0) > limits.maxEmbroideryTextLength) {
    issues.push('TEXT_TOO_LONG');
  }

  if ((input.instructions?.length ?? 0) > limits.maxInstructionsLength) {
    issues.push('INSTRUCTIONS_TOO_LONG');
  }

  return issues;
}

/** French copy for each issue. V1 is single-locale. */
export const CONFIGURATION_ISSUE_LABELS: Record<ConfigurationIssue, string> = {
  NO_PRODUCT: 'Choisissez un produit à broder.',
  NO_EMBROIDERY_SIZE: 'Choisissez une taille de broderie.',
  NO_DESIGN: 'Ajoutez un fichier ou saisissez le texte à broder.',
  TOO_MANY_THREAD_COLORS: 'Trop de couleurs de fil sélectionnées.',
  NO_THREAD_COLOR: 'Choisissez au moins une couleur de fil.',
  QUANTITY_TOO_LOW: 'La quantité doit être d’au moins 1.',
  QUANTITY_TOO_HIGH: 'Cette quantité dépasse ce qui peut être commandé en ligne.',
  TEXT_TOO_LONG: 'Le texte à broder est trop long.',
  INSTRUCTIONS_TOO_LONG: 'Les instructions sont trop longues.',
};
