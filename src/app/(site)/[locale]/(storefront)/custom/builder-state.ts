import type {
  BuilderEmbroiderySize,
  BuilderPlacement,
  BuilderProduct,
  BuilderThreadColor,
} from '@/server/repositories/customization-repository';
import {
  DEFAULT_TRANSFORM,
  type DesignTransform,
} from '@/domain/customization/placement';

/**
 * The builder's client state.
 *
 * Deliberately shaped as the **inputs to a `CustomizationConfig`**, not as a
 * second model of one. Every field here maps to a column on
 * `customization_configs` or to the request item beside it, so submission is a
 * projection rather than a translation, and there is no second source of truth
 * for what a configuration is.
 *
 * What is *not* here is as important: no price, no estimate, no discount, no
 * pricing mode. Those are server answers (`BUSINESS-RULES.md` 2.3.2), held
 * separately as the result of a server action so they can never be mistaken for
 * something the client decided.
 *
 * Files are held as `File` objects for the browser to preview. They are not
 * serialisable and never leave the client as bytes — only name, type and size
 * are submitted (`SECURITY.md` section 6; storage is Phase 9).
 */

/**
 * A file the customer attached.
 *
 * Phase 9 made these real: the bytes are in private storage and the row is a
 * `DesignFile`. What the client holds is the id it was given, the name and size
 * it already knew, and whatever status the **server** last reported — it never
 * decides that a file is ready.
 *
 * `localId` is a stable React key that exists from the moment a file is picked,
 * before any server round trip has produced a `designFileId`.
 */
export type AttachedFile = {
  localId: string;
  /** Assigned by the server when the upload is authorised. */
  designFileId: string | null;
  name: string;
  size: number;
  contentType: string;
  status: 'uploading' | 'ready' | 'error';
  /** The server's message when `status` is `error`. */
  error: string | null;
  /**
   * A short-lived signed URL for the **server-generated** preview, or null for
   * SVG and PDF (ADR-011). Never the uploaded file itself: a raster the server
   * re-encoded is safe to render, and the original never is.
   */
  previewUrl: string | null;
  /**
   * The artwork's own pixel dimensions, as the **server** read them.
   *
   * Not measured in the browser: the placement editor turns this ratio into the
   * height the workshop stitches, and a figure taken from a decoded preview
   * would be the preview's proportions rather than the file's. Null for an SVG
   * or a PDF, which are never decoded (ADR-024) — the design is then a region
   * with a width and no derivable height.
   */
  naturalWidth: number | null;
  naturalHeight: number | null;
  /** Kept for a retry, and never sent anywhere but the presigned URL. */
  file: File;
};

export type BuilderState = {
  productSlug: string | null;
  /** Option name -> chosen value, e.g. `{ Taille: 'M', Couleur: 'Noir' }`. */
  options: Record<string, string>;
  /**
   * Which photograph of the blank the design sits on, and where.
   *
   * Replaces the named placement the builder used to ask for (ADR-035). The
   * transform is in the surface's own percentage space, so it is submitted
   * exactly as it is held here and survives the picture being replaced.
   */
  surfaceImageId: string | null;
  transform: DesignTransform;
  /**
   * How big the embroidery is, when there was nothing to drag it onto.
   *
   * A garment whose photographs nobody has measured cannot be placed on, so the
   * customer says the size instead — a preset button or two typed millimetres,
   * both of which land here as millimetres. When a placement exists this is
   * ignored entirely: the box on the garment *is* the size, and asking a second
   * time is asking the same question twice.
   */
  sizeMm: { widthMm: number; heightMm: number | null } | null;
  threadColorIds: string[];
  embroideryText: string;
  instructions: string;
  quantity: number;
  files: AttachedFile[];
  contactName: string;
  contactEmail: string;
  contactPhone: string;
};

export const INITIAL_STATE: BuilderState = {
  productSlug: null,
  options: {},
  surfaceImageId: null,
  transform: { ...DEFAULT_TRANSFORM },
  sizeMm: null,
  threadColorIds: [],
  embroideryText: '',
  instructions: '',
  quantity: 1,
  files: [],
  contactName: '',
  contactEmail: '',
  contactPhone: '',
};

/**
 * The five steps, in order.
 *
 * Identifiers only. The label a customer reads is in the dictionaries — a step
 * is a stage of the flow, not a French word, and this list is also walked by
 * `isStepComplete`, which has no business knowing how anything is spelled.
 *
 * **Design now comes before placement**, which is the reverse of the original
 * order and is forced by the feature: you cannot drag a logo onto a hoodie
 * before you have the logo. The old flow asked for a placement *name*, which
 * needed nothing; this one asks the customer to position a thing, and the thing
 * has to exist first (ADR-035).
 */
export const STEPS = [
  { id: 'product' },
  { id: 'design' },
  { id: 'placement' },
  { id: 'options' },
  { id: 'review' },
] as const;

export type StepId = (typeof STEPS)[number]['id'];

/* ---------------------------------------------------------------------------
 * Derived lookups. Reads over data the server supplied — not business rules.
 * ------------------------------------------------------------------------ */

export function findProduct(
  products: readonly BuilderProduct[],
  slug: string | null,
): BuilderProduct | undefined {
  return slug === null ? undefined : products.find((product) => product.slug === slug);
}

export function findPlacement(
  placements: readonly BuilderPlacement[],
  id: string | null,
): BuilderPlacement | undefined {
  return id === null ? undefined : placements.find((placement) => placement.id === id);
}

export function findSize(
  sizes: readonly BuilderEmbroiderySize[],
  id: string | null,
): BuilderEmbroiderySize | undefined {
  return id === null ? undefined : sizes.find((size) => size.id === id);
}

export function findThreadColors(
  colors: readonly BuilderThreadColor[],
  ids: readonly string[],
): readonly BuilderThreadColor[] {
  return ids
    .map((id) => colors.find((color) => color.id === id))
    .filter((color): color is BuilderThreadColor => color !== undefined);
}

/**
 * The variant matching the chosen options.
 *
 * A lookup over variants the server already priced, not a price calculation.
 */
export function findVariant(
  product: BuilderProduct | undefined,
  options: Record<string, string>,
): BuilderProduct['variants'][number] | undefined {
  if (!product) return undefined;

  return product.variants.find((variant) =>
    Object.entries(options).every(([name, value]) => variant.options[name] === value),
  );
}

/* ---------------------------------------------------------------------------
 * Step gating — "is this step answered", not "is this configuration valid".
 * The authoritative validation is `domain/customization/validation`, run on
 * the server. This only decides whether Continue is enabled.
 * ------------------------------------------------------------------------ */

export function isStepComplete(step: StepId, state: BuilderState): boolean {
  switch (step) {
    case 'product':
      return state.productSlug !== null;
    case 'placement':
      /*
       * A surface is chosen, or there is none to choose.
       *
       * A blank whose photographs the owner has not measured yet has no
       * placeable face at all. Blocking the customer there would make an
       * unfinished catalogue look like a broken website, so the step passes and
       * the editor says what to do instead — describe it in the instructions.
       * The server records no transform in that case, which is exactly what
       * sends the configuration to a human (`domain/customization/pricing-mode`).
       */
      return true;
    case 'design':
      // UX.md section 5: "skip, I only want text" is a real path, so text
      // alone completes this step.
      return state.files.length > 0 || state.embroideryText.trim().length > 0;
    case 'options':
      /*
       * A size is required, but only where one was not already given.
       *
       * The placement step produces a size by construction — the box the
       * customer dragged — so demanding a second answer here would be asking
       * the same question twice with two different controls, one of which the
       * server ignores. That is exactly what this step used to do (ADR-035).
       */
      return (
        (state.surfaceImageId !== null || state.sizeMm !== null) &&
        state.threadColorIds.length > 0
      );
    case 'review':
      return state.contactName.trim().length >= 2 && isPlausibleEmail(state.contactEmail);
  }
}

/**
 * A shape check, not a validity check.
 *
 * The server validates the address with Zod and is authoritative
 * (`SECURITY.md` section 5). This exists only to keep the submit button honest
 * before the round trip.
 */
export function isPlausibleEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}
