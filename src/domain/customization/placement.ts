/**
 * Where the design sits on the garment, and how big it really is.
 *
 * Until now a placement was a name off a list — "Poitrine gauche" — and a size
 * was one of three presets. The customer chose two words and hoped. This is the
 * replacement: they drag their artwork onto a photograph of the blank, and what
 * they see is what the workshop stitches.
 *
 * ## Texture space
 *
 * A transform is expressed as **percentages of the surface it sits on**, never
 * in pixels and never in millimetres:
 *
 *   - `xPercent` / `yPercent` — the design's **centre**, 0–100 across the
 *     surface. Centre rather than top-left because that is the point rotation
 *     turns about and the point a resize keeps still; storing a corner would
 *     make both operations move the design for no reason the customer asked
 *     for.
 *   - `widthPercent` — the design's width, 0–100 of the surface's width. Its
 *     height is not stored: it follows from the artwork's own aspect ratio, and
 *     a stored height could contradict it.
 *   - `rotationDeg` — clockwise, −180 to 180.
 *
 * Percentages are what make one number serve two renderers. On a photograph the
 * surface is the image, and the transform is a CSS box over it. On a 3D model
 * the surface is the **UV map**, and the identical transform is where the
 * artwork is composited into the texture that gets wrapped round the mesh. A
 * garment that has only a photograph today and gains a `.glb` tomorrow keeps
 * every configuration ever saved against it, because nothing was ever stored in
 * the photograph's pixels.
 *
 * ## Millimetres
 *
 * A percentage is not a size, and a workshop cannot stitch a percentage. The
 * bridge is one number the admin measures once per surface — **how wide the
 * garment is, in millimetres, across the full width of the picture** — and
 * every real dimension follows from it. That is why `surfaceWidthMm` is a
 * parameter here and a column there: a photograph nobody has measured can be
 * looked at but not ordered from.
 *
 * Nothing in this file knows about pricing, and nothing about it decides
 * whether a configuration needs a human. It answers one question: *where is the
 * design, and how big is it in the real world.*
 */

/* ---------------------------------------------------------------------------
 * Surfaces
 * ------------------------------------------------------------------------ */

/**
 * The faces a design can be placed on.
 *
 * Deliberately few, and named for what a person sees rather than for a
 * coordinate system. A t-shirt has a front and a back; a tote has two sides it
 * calls the same two things; a cap has a front, two sides and a back. `WRAP` is
 * the odd one and it belongs to the 3D renderer: a single continuous UV map for
 * a garment modelled in the round, where "front" is an angle rather than a
 * photograph.
 */
export const DESIGN_SURFACES = ['FRONT', 'BACK', 'LEFT', 'RIGHT', 'TOP', 'WRAP'] as const;

export type DesignSurface = (typeof DESIGN_SURFACES)[number];

export function isDesignSurface(value: string): value is DesignSurface {
  return (DESIGN_SURFACES as readonly string[]).includes(value);
}

/* ---------------------------------------------------------------------------
 * The transform
 * ------------------------------------------------------------------------ */

export type DesignTransform = {
  /** The design's centre, as a percentage across the surface. */
  xPercent: number;
  /** The design's centre, as a percentage down the surface. */
  yPercent: number;
  /** The design's width, as a percentage of the surface's width. */
  widthPercent: number;
  /** Clockwise, in degrees. */
  rotationDeg: number;
};

/**
 * Where a design lands before anybody has dragged it.
 *
 * Chest-height and centred: high enough to read as a chest print rather than a
 * belly print, and small enough that the first thing the customer does is make
 * it bigger, which teaches them the handles exist.
 */
export const DEFAULT_TRANSFORM: DesignTransform = {
  xPercent: 50,
  yPercent: 38,
  widthPercent: 22,
  rotationDeg: 0,
};

/**
 * The limits on a transform.
 *
 * `MIN_WIDTH_PERCENT` is not a stylistic preference: below roughly a fiftieth
 * of a garment's width, embroidery loses its detail entirely, and a customer
 * who has accidentally pinched the box down to nothing should be stopped by the
 * editor rather than by an e-mail from the workshop three days later.
 */
export const MIN_WIDTH_PERCENT = 2;
export const MAX_WIDTH_PERCENT = 100;
export const MAX_ROTATION_DEG = 180;

/** The smallest thing worth stitching, and the largest a hoop can hold. */
export const MIN_DESIGN_WIDTH_MM = 10;
export const MAX_DESIGN_WIDTH_MM = 600;

/**
 * The range a surface measurement has to fall in.
 *
 * Not a guess at garment sizes — a guard against the two mistakes anybody
 * actually makes when typing this figure. `52` is a chest measured in
 * centimetres; `5200` is one measured in millimetres and then multiplied by ten
 * out of doubt. Both would be accepted silently by a bare "is it a number", and
 * both produce a design stitched at a tenth or ten times the size somebody
 * approved on screen. A tea towel is wider than 50 mm and a marquee is narrower
 * than 3 metres, so the range rejects both and nothing real.
 */
export const MIN_SURFACE_WIDTH_MM = 50;
export const MAX_SURFACE_WIDTH_MM = 3000;

/**
 * How far off the edge of the garment the design may hang: nowhere.
 *
 * A design that runs off the surface cannot be stitched, and on a photograph it
 * would silently be cropped — the customer would approve something that does
 * not exist. So the box is clamped inside, and it is clamped **after**
 * rotation, because a rotated square is wider than its own width.
 */
export function clampTransform(transform: DesignTransform): DesignTransform {
  const rotationDeg = clamp(
    Number.isFinite(transform.rotationDeg) ? transform.rotationDeg : 0,
    -MAX_ROTATION_DEG,
    MAX_ROTATION_DEG,
  );

  const widthPercent = clamp(
    Number.isFinite(transform.widthPercent)
      ? transform.widthPercent
      : DEFAULT_TRANSFORM.widthPercent,
    MIN_WIDTH_PERCENT,
    MAX_WIDTH_PERCENT,
  );

  return {
    widthPercent,
    rotationDeg,
    xPercent: clamp(
      Number.isFinite(transform.xPercent) ? transform.xPercent : 50,
      widthPercent / 2,
      100 - widthPercent / 2,
    ),
    /*
     * The vertical clamp is deliberately looser.
     *
     * The horizontal half-width is known — it is `widthPercent / 2` of the
     * same axis. The vertical one is not: the design's height depends on the
     * artwork's aspect ratio and on the surface's, neither of which this
     * function is given. Clamping the centre to the surface keeps the design
     * anchored to the garment; `fitsWithin` is the exact check, and it is the
     * one the server runs before a configuration is accepted.
     */
    yPercent: clamp(
      Number.isFinite(transform.yPercent) ? transform.yPercent : 50,
      0,
      100,
    ),
  };
}

function clamp(value: number, low: number, high: number): number {
  // A degenerate range — a design as wide as the garment leaves the centre no
  // room to move — collapses to its midpoint rather than inverting.
  if (low > high) return (low + high) / 2;
  return Math.min(high, Math.max(low, value));
}

/* ---------------------------------------------------------------------------
 * Real-world size
 * ------------------------------------------------------------------------ */

/**
 * The artwork's own proportions.
 *
 * Taken from the uploaded file's pixel dimensions, which the design-file
 * pipeline already records. A file whose dimensions could not be read has no
 * aspect ratio, and its height cannot be stated — the workshop is told the
 * width and asked to confirm the rest, which is honest, rather than being given
 * a square that was a guess.
 */
export type ArtworkAspect = {
  widthPx: number;
  heightPx: number;
};

export function aspectRatio(artwork: ArtworkAspect | null): number | null {
  if (!artwork || artwork.widthPx <= 0 || artwork.heightPx <= 0) return null;
  return artwork.heightPx / artwork.widthPx;
}

export type DesignSize = {
  widthMm: number;
  /** Null when the artwork's proportions are unknown. */
  heightMm: number | null;
};

/**
 * What the customer dragged, in millimetres.
 *
 * The whole point of the calibration: `surfaceWidthMm` is the real width of the
 * garment across the full width of the picture, so a box that covers a sixth of
 * the picture covers a sixth of the garment. Rounded to whole millimetres,
 * because a workshop does not stitch to a tenth and a figure with decimals in
 * it invites a precision nobody has.
 */
export function designSize(
  transform: DesignTransform,
  surfaceWidthMm: number,
  artwork: ArtworkAspect | null,
): DesignSize {
  const widthMm = Math.round((transform.widthPercent / 100) * surfaceWidthMm);
  const ratio = aspectRatio(artwork);

  return {
    widthMm,
    heightMm: ratio === null ? null : Math.round(widthMm * ratio),
  };
}

/** The inverse: the box that produces a given real width. */
export function widthPercentForMm(widthMm: number, surfaceWidthMm: number): number {
  if (surfaceWidthMm <= 0) return DEFAULT_TRANSFORM.widthPercent;
  return clamp((widthMm / surfaceWidthMm) * 100, MIN_WIDTH_PERCENT, MAX_WIDTH_PERCENT);
}

/**
 * Whether the design is wholly on the garment.
 *
 * The exact check `clampTransform` cannot make, because it needs the surface's
 * own proportions to know what a percentage down the picture is worth against a
 * percentage across it. Run on the server before a configuration is stored: the
 * editor prevents this, and prevention in a browser is a courtesy rather than a
 * rule.
 */
export function fitsWithin(input: {
  transform: DesignTransform;
  /** The surface's pixel dimensions, for its aspect ratio. */
  surface: { widthPx: number; heightPx: number };
  artwork: ArtworkAspect | null;
}): boolean {
  const { transform, surface } = input;
  if (surface.widthPx <= 0 || surface.heightPx <= 0) return false;

  const ratio = aspectRatio(input.artwork);

  // Width is a percentage of the surface's width; height has to be converted
  // through both aspect ratios to become a percentage of the surface's height.
  const widthPercent = transform.widthPercent;
  const heightPercent =
    ratio === null
      ? widthPercent
      : widthPercent * ratio * (surface.widthPx / surface.heightPx);

  const radians = (transform.rotationDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));

  // The axis-aligned box a rotated rectangle occupies. At 0° it is the
  // rectangle itself; at 45° a square grows by √2, which is exactly the case
  // that would otherwise hang off the shoulder.
  const spanX = widthPercent * cos + heightPercent * sin;
  const spanY = heightPercent * cos + widthPercent * sin;

  const withinX =
    transform.xPercent - spanX / 2 >= -TOLERANCE_PERCENT &&
    transform.xPercent + spanX / 2 <= 100 + TOLERANCE_PERCENT;

  const withinY =
    transform.yPercent - spanY / 2 >= -TOLERANCE_PERCENT &&
    transform.yPercent + spanY / 2 <= 100 + TOLERANCE_PERCENT;

  return withinX && withinY;
}

/**
 * A hair of slack, for the arithmetic rather than for the customer.
 *
 * The editor clamps in floating point over a pixel grid; a box dragged flush to
 * the edge can land on 100.0000001 and be refused for a hundred-thousandth of a
 * millimetre. Half a percent is invisible on a garment and immune to that.
 */
const TOLERANCE_PERCENT = 0.5;

/* ---------------------------------------------------------------------------
 * Pricing bands
 * ------------------------------------------------------------------------ */

/**
 * One of the priced size bands — `embroidery_sizes`.
 *
 * Freeform dragging did not make these obsolete; it made them the **price
 * table** rather than the input. The customer drags a continuous size and the
 * band it falls in is what it costs, which is how a workshop actually charges:
 * nobody quotes per square millimetre.
 */
export type SizeBand = {
  id: string;
  name: string;
  basePrice: number;
  /** Null means unbounded on that axis. */
  maxWidthMm: number | null;
  maxHeightMm: number | null;
};

/**
 * The band that prices a given design, or nothing.
 *
 * The **cheapest sufficient** band, not the nearest: a design that fits in
 * "Petit" is charged as small even if the customer thinks of it as medium, and
 * a shop that charged otherwise would be overcharging by opinion.
 *
 * Returning `null` is not a failure — it is the answer "no band covers this",
 * which is precisely the condition that sends a configuration to a human quote
 * (`./pricing-mode`). A design bigger than every band is a real order; it is
 * just not one a table can price.
 */
export function resolveSizeBand(
  size: DesignSize,
  bands: readonly SizeBand[],
): SizeBand | null {
  const sufficient = bands.filter(
    (band) =>
      (band.maxWidthMm === null || size.widthMm <= band.maxWidthMm) &&
      (band.maxHeightMm === null ||
        size.heightMm === null ||
        size.heightMm <= band.maxHeightMm),
  );

  if (sufficient.length === 0) return null;

  return sufficient.reduce((cheapest, band) =>
    band.basePrice < cheapest.basePrice ? band : cheapest,
  );
}

/**
 * The box that exactly fills a band, for the "Petit / Moyen / Grand" buttons.
 *
 * The buttons survive freeform placement, and they are worth keeping: most
 * customers do not want to negotiate with a resize handle, they want the usual
 * chest size. Pressing one sets the width and leaves the position alone.
 */
export function transformForBand(
  band: SizeBand,
  current: DesignTransform,
  surfaceWidthMm: number,
): DesignTransform {
  if (band.maxWidthMm === null) return current;

  return clampTransform({
    ...current,
    widthPercent: widthPercentForMm(band.maxWidthMm, surfaceWidthMm),
  });
}

/* ---------------------------------------------------------------------------
 * Describing it
 * ------------------------------------------------------------------------ */

export type PlacementIssue =
  'NO_SURFACE' | 'SURFACE_NOT_MEASURED' | 'OFF_THE_GARMENT' | 'TOO_SMALL';

/**
 * Everything wrong with a placement, or nothing.
 *
 * Returns the whole list for the same reason `validateConfiguration` does: a
 * form that reveals one problem per submit is a form people abandon.
 */
export function validatePlacement(input: {
  surface: { widthPx: number; heightPx: number; widthMm: number | null } | null;
  transform: DesignTransform;
  artwork: ArtworkAspect | null;
}): readonly PlacementIssue[] {
  const issues: PlacementIssue[] = [];

  if (!input.surface) {
    issues.push('NO_SURFACE');
    return issues;
  }

  if (input.surface.widthMm === null || input.surface.widthMm <= 0) {
    issues.push('SURFACE_NOT_MEASURED');
  } else {
    const size = designSize(input.transform, input.surface.widthMm, input.artwork);
    if (size.widthMm < MIN_DESIGN_WIDTH_MM) issues.push('TOO_SMALL');
  }

  if (
    !fitsWithin({
      transform: input.transform,
      surface: input.surface,
      artwork: input.artwork,
    })
  ) {
    issues.push('OFF_THE_GARMENT');
  }

  return issues;
}

/* ---------------------------------------------------------------------------
 * A size given rather than dragged
 * ------------------------------------------------------------------------ */

/**
 * The size a named band stands for.
 *
 * For the customer who is not placing anything — a blank with no measured
 * photograph — the bands are still offered as buttons, and pressing one has to
 * mean a real number of millimetres rather than an id the server would have to
 * trust. An unbounded band has no size of its own and returns nothing.
 */
export function sizeOfBand(band: SizeBand): DesignSize | null {
  if (band.maxWidthMm === null) return null;

  return { widthMm: band.maxWidthMm, heightMm: band.maxHeightMm };
}

/**
 * A size the customer typed, made safe.
 *
 * The manual path exists because "allow custom sizes" is the whole point: a
 * band is a price bracket, not a menu, and somebody who wants 73 mm should be
 * able to say 73 mm. What they may not do is say something no hoop can hold or
 * no needle can resolve, so it is clamped to the same bounds the dragged path
 * obeys — and a height that was not given stays absent rather than becoming a
 * square nobody asked for.
 */
export function clampSize(size: {
  widthMm: number;
  heightMm: number | null;
}): DesignSize | null {
  if (!Number.isFinite(size.widthMm)) return null;

  const widthMm = Math.round(
    Math.min(MAX_DESIGN_WIDTH_MM, Math.max(MIN_DESIGN_WIDTH_MM, size.widthMm)),
  );

  const heightMm =
    size.heightMm === null || !Number.isFinite(size.heightMm)
      ? null
      : Math.round(
          Math.min(MAX_DESIGN_WIDTH_MM, Math.max(MIN_DESIGN_WIDTH_MM, size.heightMm)),
        );

  return { widthMm, heightMm };
}
