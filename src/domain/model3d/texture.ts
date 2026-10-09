/**
 * Turning a placement into pixels on a texture.
 *
 * ADR-035 said a placement is four percentages in texture space so that "the
 * same transform positions a design over a photograph and inside a 3D model's
 * UV map". The photograph half shipped in Phase 14.10. This is the other half,
 * and it is the function that makes the claim true rather than aspirational.
 *
 * It computes where the artwork lands on a square texture, in pixels, given
 * nothing but the transform and the texture's size. A caller draws it; this
 * decides where.
 *
 * Pure. No canvas, no `three`, no DOM — which is what lets the arithmetic be
 * tested without a GPU, and what keeps `domain/` free of the renderer.
 */

import type { DesignTransform } from '@/domain/customization/placement';

export type TexturePlacement = {
  /** Centre, in texture pixels from the left. */
  centreX: number;
  /** Centre, in texture pixels from the top. */
  centreY: number;
  /** Drawn width, in texture pixels. */
  width: number;
  /** Drawn height, in texture pixels. Derived from the artwork's aspect. */
  height: number;
  /** Clockwise radians, for a canvas `rotate`. */
  rotation: number;
};

/**
 * Where the artwork sits on the texture.
 *
 * The percentages are of the **texture**, not of the printable area, because a
 * UV map and a photograph agree on exactly one thing: the surface they cover
 * runs 0–100 in both directions. Anything narrower would need the model and the
 * photograph to agree about margins, which is the coupling ADR-035 avoided.
 *
 * `aspect` is the artwork's height divided by its width. It is a parameter
 * rather than a field on the transform for the reason the transform's own
 * comment gives: the height is never stored, because storing it would let a
 * saved placement disagree with the file it points at.
 */
export function texturePlacement(input: {
  transform: DesignTransform;
  /** The square texture's edge length in pixels. */
  textureSize: number;
  /** Artwork height ÷ width. 1 when unknown, which keeps a square square. */
  aspect: number;
}): TexturePlacement {
  const size = Math.max(1, Math.floor(input.textureSize));
  const aspect = Number.isFinite(input.aspect) && input.aspect > 0 ? input.aspect : 1;

  const width = (input.transform.widthPercent / 100) * size;

  return {
    centreX: (input.transform.xPercent / 100) * size,
    centreY: (input.transform.yPercent / 100) * size,
    width,
    height: width * aspect,
    rotation: (input.transform.rotationDeg * Math.PI) / 180,
  };
}

/**
 * How large the texture should be for a given design.
 *
 * Big enough that the artwork is not the thing that looks soft, and no bigger:
 * a texture is uploaded to the GPU whole, and 4096² is 64 MB of video memory
 * before mipmaps — on the mid-range Android phones this shop's customers use,
 * that is the difference between a model that turns and a tab that dies.
 *
 * The rule is "enough pixels that the design is rendered at roughly its own
 * resolution", rounded up to a power of two because non-power-of-two textures
 * lose mipmapping in WebGL 1 and are slower in WebGL 2.
 */
export function textureSizeFor(input: {
  /** The artwork's natural width in pixels. */
  artworkWidth: number;
  transform: DesignTransform;
  max?: number;
}): number {
  const max = input.max ?? 2048;
  const fraction = Math.max(input.transform.widthPercent, 1) / 100;

  // If the design covers a fifth of the texture, the texture needs five times
  // the design's own width to show it unscaled.
  const wanted = input.artworkWidth / fraction;

  let size = 512;
  while (size < wanted && size < max) size *= 2;

  return Math.min(size, max);
}
