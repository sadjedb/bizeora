/**
 * The arithmetic that puts a design on a model, and the model it is put on.
 *
 * ADR-035 chose to store a placement as four percentages "so one number serves
 * both a photograph and a 3D model's UV map". For two phases that was a claim
 * with one implementation. `texturePlacement` is the second, and these are the
 * cases where the two could disagree: the centre, the rotation, and what
 * happens to the height when the artwork is not square.
 *
 * The second half of the file is about the demo model. It is generated rather
 * than committed by hand (`scripts/make-demo-model.ts`), and a generator that
 * silently starts producing something this project's own parser refuses is
 * exactly the kind of breakage nobody notices until a customer opens the
 * viewer.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { texturePlacement, textureSizeFor } from '../../src/domain/model3d/texture';
import {
  acceptModel,
  isDeclaredMaterial,
  suggestedMaterial,
} from '../../src/domain/model3d';
import { inspectGlb } from '../../src/lib/model3d/glb';
import { DEFAULT_TRANSFORM } from '../../src/domain/customization/placement';

describe('placing a design on a texture', () => {
  it('puts the centre where the percentages say', () => {
    const placed = texturePlacement({
      transform: { xPercent: 25, yPercent: 75, widthPercent: 20, rotationDeg: 0 },
      textureSize: 1024,
      aspect: 1,
    });

    expect(placed.centreX).toBe(256);
    expect(placed.centreY).toBe(768);
  });

  it('sizes the width as a fraction of the texture', () => {
    const placed = texturePlacement({
      transform: { ...DEFAULT_TRANSFORM, widthPercent: 25 },
      textureSize: 2048,
      aspect: 1,
    });

    expect(placed.width).toBe(512);
  });

  /*
   * The height is never stored — it follows from the artwork, which is what
   * stops a saved placement from disagreeing with the file it points at.
   */
  it('derives the height from the artwork, not from the transform', () => {
    const wide = texturePlacement({
      transform: { ...DEFAULT_TRANSFORM, widthPercent: 50 },
      textureSize: 1000,
      aspect: 0.5,
    });

    expect(wide.width).toBe(500);
    expect(wide.height).toBe(250);
  });

  it('turns degrees into radians, clockwise', () => {
    const placed = texturePlacement({
      transform: { ...DEFAULT_TRANSFORM, rotationDeg: 90 },
      textureSize: 512,
      aspect: 1,
    });

    expect(placed.rotation).toBeCloseTo(Math.PI / 2);
  });

  it.each([
    ['zero', 0],
    ['negative', -2],
    ['not a number', Number.NaN],
  ])('treats %s aspect as square rather than collapsing the design', (_label, aspect) => {
    const placed = texturePlacement({
      transform: { ...DEFAULT_TRANSFORM, widthPercent: 40 },
      textureSize: 1000,
      aspect,
    });

    expect(placed.height).toBe(placed.width);
  });
});

describe('choosing a texture size', () => {
  /*
   * A texture is uploaded to the GPU whole. 4096² is 64 MB before mipmaps, and
   * on the phones this shop's customers use that is the difference between a
   * model that turns and a tab that dies.
   */
  it('never exceeds its ceiling', () => {
    const size = textureSizeFor({
      artworkWidth: 8000,
      transform: { ...DEFAULT_TRANSFORM, widthPercent: 5 },
    });

    expect(size).toBe(2048);
  });

  it('is a power of two', () => {
    for (const artworkWidth of [100, 512, 900, 1500, 3000]) {
      const size = textureSizeFor({ artworkWidth, transform: DEFAULT_TRANSFORM });

      expect(Math.log2(size) % 1).toBe(0);
    }
  });

  it('grows when the design covers less of the surface', () => {
    const large = textureSizeFor({
      artworkWidth: 512,
      transform: { ...DEFAULT_TRANSFORM, widthPercent: 60 },
    });
    const small = textureSizeFor({
      artworkWidth: 512,
      transform: { ...DEFAULT_TRANSFORM, widthPercent: 10 },
    });

    expect(small).toBeGreaterThan(large);
  });
});

describe('the demo model', () => {
  const bytes = new Uint8Array(
    readFileSync(
      join(
        process.cwd(),
        'public',
        'assets',
        'models',
        '00000000-0000-4000-8000-00000000d3d0.glb',
      ),
    ),
  );

  it('is a container this project accepts', () => {
    const result = inspectGlb(bytes);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(acceptModel(result.inspection).ok).toBe(true);
  });

  /*
   * The whole point of having two. ADR-036: nothing can guess which surface of
   * a garment is the one you embroider, so the workshop picks and the pick is
   * verified against the file.
   */
  it('declares the two materials the workshop chooses between', () => {
    const result = inspectGlb(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect([...result.inspection.materials].sort()).toEqual(['Fabric', 'Rib']);
    expect(isDeclaredMaterial('Fabric', result.inspection)).toBe(true);
    expect(isDeclaredMaterial('Cuir', result.inspection)).toBe(false);
    expect(suggestedMaterial(result.inspection)).toBe('Fabric');
  });

  it('reaches outside itself for nothing', () => {
    const result = inspectGlb(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The refusal this guard exists for is `EXTERNAL_RESOURCE`; a model that
    // passes must therefore be self-contained by construction.
    expect(result.inspection.byteSize).toBe(bytes.byteLength);
  });
});
