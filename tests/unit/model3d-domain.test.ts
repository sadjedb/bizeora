/**
 * The `.glb` guard, against real bytes.
 *
 * The container is built here rather than committed, for the reason the media
 * suite builds its JPEG: a fixture that drifts out of date cannot happen, and
 * constructing a GLB by hand is the only way to test the cases that matter —
 * a truncated chunk, a lying length, a texture fetched from somebody else's
 * server. None of those is a file you can produce with an exporter.
 *
 * The security claim being tested is one sentence: **a published model never
 * reaches outside itself.**
 */

import { describe, expect, it } from 'vitest';

import {
  MAX_MODEL_BYTES,
  MODEL_REFUSAL_LABELS,
  acceptModel,
  isDeclaredMaterial,
  isModelMimeType,
  suggestedMaterial,
  type ModelInspection,
} from '../../src/domain/model3d';
import { inspectGlb } from '../../src/lib/model3d/glb';

/* ---------------------------------------------------------------------------
 * A GLB, assembled by hand
 * ------------------------------------------------------------------------ */

const MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

type GlbOptions = {
  json?: unknown;
  /** Overrides the length written into the header, to fake a lying file. */
  declaredLength?: number;
  magic?: number;
  version?: number;
  firstChunkType?: number;
  /** Bytes lopped off the end after the header has been written. */
  truncateBy?: number;
};

/** A minimal but valid glTF 2.0 document: one mesh, two named materials. */
function document(patch: Record<string, unknown> = {}): unknown {
  return {
    asset: { version: '2.0', generator: 'tests' },
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    materials: [{ name: 'Fabric' }, { name: 'Zipper' }],
    ...patch,
  };
}

function buildGlb(options: GlbOptions = {}): Uint8Array {
  const json = JSON.stringify(options.json ?? document());
  const jsonBytes = new TextEncoder().encode(json);

  // The spec pads each chunk to four bytes; JSON pads with spaces so the
  // padding stays inside the string rather than becoming trailing nulls.
  const jsonPadding = (4 - (jsonBytes.byteLength % 4)) % 4;
  const jsonLength = jsonBytes.byteLength + jsonPadding;

  const binBytes = new Uint8Array(4);
  const total = 12 + 8 + jsonLength + 8 + binBytes.byteLength;

  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  view.setUint32(0, options.magic ?? MAGIC, true);
  view.setUint32(4, options.version ?? 2, true);
  view.setUint32(8, options.declaredLength ?? total, true);

  view.setUint32(12, jsonLength, true);
  view.setUint32(16, options.firstChunkType ?? CHUNK_JSON, true);
  bytes.set(jsonBytes, 20);
  for (let i = 0; i < jsonPadding; i += 1) bytes[20 + jsonBytes.byteLength + i] = 0x20;

  const binStart = 20 + jsonLength;
  view.setUint32(binStart, binBytes.byteLength, true);
  view.setUint32(binStart + 4, CHUNK_BIN, true);
  bytes.set(binBytes, binStart + 8);

  return options.truncateBy ? bytes.subarray(0, total - options.truncateBy) : bytes;
}

/* ---------------------------------------------------------------------------
 * The happy path
 * ------------------------------------------------------------------------ */

describe('a well-formed model', () => {
  it('is accepted, and its materials are read out', () => {
    const result = inspectGlb(buildGlb());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.inspection.version).toBe(2);
    expect(result.inspection.meshCount).toBe(1);
    expect([...result.inspection.materials]).toEqual(['Fabric', 'Zipper']);
    expect(result.inspection.hasExternalResources).toBe(false);
  });

  /*
   * The normal case for a `.glb`: the texture lives in the BIN chunk and has
   * no `uri` at all. This is what "self-contained" looks like in practice.
   */
  it('accepts a model whose texture is in the binary chunk', () => {
    const result = inspectGlb(
      buildGlb({
        json: document({
          images: [{ bufferView: 1, mimeType: 'image/png' }],
          buffers: [{ byteLength: 4 }],
        }),
      }),
    );

    expect(result.ok).toBe(true);
  });

  it('accepts a texture inlined as a data URI', () => {
    const result = inspectGlb(
      buildGlb({
        json: document({
          images: [{ uri: 'data:image/png;base64,iVBORw0KGgo=' }],
        }),
      }),
    );

    expect(result.ok).toBe(true);
  });

  it('names an unnamed material by its index, so a list is usable', () => {
    const result = inspectGlb(
      buildGlb({ json: document({ materials: [{}, { name: '' }, { name: 'Rib' }] }) }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect([...result.inspection.materials]).toEqual(['material_0', 'material_1', 'Rib']);
  });
});

/* ---------------------------------------------------------------------------
 * The reason this module exists
 * ------------------------------------------------------------------------ */

describe('a model that reaches outside itself', () => {
  /*
   * The refusal the whole design is built around. A viewer honours these
   * references: publishing this model would publish a page that fetches from a
   * host nobody here chose, on every customer's browser.
   */
  it.each([
    ['an http texture', { images: [{ uri: 'https://elsewhere.example/logo.png' }] }],
    ['a relative texture', { images: [{ uri: 'texture.png' }] }],
    ['a protocol-relative texture', { images: [{ uri: '//host/x.png' }] }],
    ['a file:// buffer', { buffers: [{ uri: 'file:///etc/passwd', byteLength: 4 }] }],
    ['an external buffer', { buffers: [{ uri: 'scene.bin', byteLength: 4 }] }],
  ])('refuses %s', (_label, patch) => {
    const result = inspectGlb(buildGlb({ json: document(patch) }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('EXTERNAL_RESOURCE');
  });

  it('is not fooled by case or leading whitespace on a data URI', () => {
    const upper = inspectGlb(
      buildGlb({ json: document({ images: [{ uri: '  DATA:image/png;base64,AA==' }] }) }),
    );
    expect(upper.ok).toBe(true);

    // …but a scheme that merely starts with the letters is still external.
    const lookalike = inspectGlb(
      buildGlb({ json: document({ images: [{ uri: 'database://host/x.png' }] }) }),
    );
    expect(lookalike.ok).toBe(false);
  });
});

/* ---------------------------------------------------------------------------
 * Files that are not what they say
 * ------------------------------------------------------------------------ */

describe('a container that does not hold up', () => {
  it('refuses something that is not a GLB at all', () => {
    const result = inspectGlb(buildGlb({ magic: 0x12345678 }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('NOT_GLB');
  });

  it('refuses a file too short to hold a header', () => {
    const result = inspectGlb(new Uint8Array([0x67, 0x6c, 0x54, 0x46]));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('TOO_SMALL');
  });

  /*
   * A file that says it is shorter than it is has bytes after its own end, and
   * whether a reader sees them depends on the reader. Two parsers disagreeing
   * about where a file stops is a real class of bug, so it is refused rather
   * than trimmed.
   */
  it('refuses a file whose declared length is a lie', () => {
    const short = inspectGlb(buildGlb({ declaredLength: 40 }));
    expect(short.ok).toBe(false);

    const long = inspectGlb(buildGlb({ declaredLength: 40_000 }));
    expect(long.ok).toBe(false);
  });

  it('refuses a truncated file', () => {
    const result = inspectGlb(buildGlb({ truncateBy: 6 }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('MALFORMED');
  });

  it('refuses a file that does not lead with its JSON', () => {
    const result = inspectGlb(buildGlb({ firstChunkType: CHUNK_BIN }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('MALFORMED');
  });

  it('refuses glTF 1', () => {
    const result = inspectGlb(
      buildGlb({ version: 1, json: document({ asset: { version: '1.0' } }) }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('UNSUPPORTED_VERSION');
  });

  /*
   * A file claiming 2 in the container and 1 in the document is refused rather
   * than believed selectively — taking the lower of the two is what makes that
   * true without a second branch.
   */
  it('refuses a file whose two version numbers disagree', () => {
    const result = inspectGlb(
      buildGlb({ version: 2, json: document({ asset: { version: '1.0' } }) }),
    );

    expect(result.ok).toBe(false);
  });

  it('refuses JSON that is not an object', () => {
    expect(inspectGlb(buildGlb({ json: [1, 2, 3] })).ok).toBe(false);
    expect(inspectGlb(buildGlb({ json: 'not a document' })).ok).toBe(false);
  });

  it('refuses a model with nothing in it', () => {
    const noMesh = inspectGlb(buildGlb({ json: document({ meshes: [] }) }));
    expect(noMesh.ok).toBe(false);
    if (!noMesh.ok) expect(noMesh.reason).toBe('NO_MESH');

    const noMaterial = inspectGlb(buildGlb({ json: document({ materials: [] }) }));
    expect(noMaterial.ok).toBe(false);
    if (!noMaterial.ok) expect(noMaterial.reason).toBe('NO_MATERIAL');
  });
});

/* ---------------------------------------------------------------------------
 * The rules, without the bytes
 * ------------------------------------------------------------------------ */

describe('the publishing rules', () => {
  function inspection(patch: Partial<ModelInspection> = {}): ModelInspection {
    return {
      byteSize: 1024,
      version: 2,
      materials: ['Fabric'],
      meshCount: 1,
      hasExternalResources: false,
      ...patch,
    };
  }

  it('accepts a sound inspection', () => {
    expect(acceptModel(inspection()).ok).toBe(true);
  });

  it('refuses a model past the size ceiling', () => {
    const result = acceptModel(inspection({ byteSize: MAX_MODEL_BYTES + 1 }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('TOO_LARGE');
  });

  it('has a sentence for every refusal, and each says what to do next', () => {
    for (const label of Object.values(MODEL_REFUSAL_LABELS)) {
      expect(label.length).toBeGreaterThan(20);
    }
  });

  it('accepts only binary glTF', () => {
    expect(isModelMimeType('model/gltf-binary')).toBe(true);
    expect(isModelMimeType('model/gltf+json')).toBe(false);
    expect(isModelMimeType('application/octet-stream')).toBe(false);
  });
});

describe('choosing the material that gets embroidered', () => {
  /*
   * A guess for a dropdown, never applied without confirmation. It is
   * deliberately dumb: a cleverer guess would be wrong less often and trusted
   * more, which is the worse failure.
   */
  it('prefers a material that sounds like fabric', () => {
    expect(
      suggestedMaterial({
        byteSize: 1,
        version: 2,
        meshCount: 1,
        hasExternalResources: false,
        materials: ['Zipper', 'Cotton_Body', 'Label'],
      }),
    ).toBe('Cotton_Body');
  });

  it('falls back to the first one declared', () => {
    expect(
      suggestedMaterial({
        byteSize: 1,
        version: 2,
        meshCount: 1,
        hasExternalResources: false,
        materials: ['Mat_01', 'Mat_02'],
      }),
    ).toBe('Mat_01');
  });

  it('has nothing to suggest for a model with no materials', () => {
    expect(
      suggestedMaterial({
        byteSize: 1,
        version: 2,
        meshCount: 0,
        hasExternalResources: false,
        materials: [],
      }),
    ).toBeNull();
  });

  /*
   * The admin's choice arrives from a form as a string, and that string decides
   * which surface of a customer's garment gets embroidered. It is checked
   * against the file rather than trusted.
   */
  it('refuses a material the file does not declare', () => {
    const found = {
      byteSize: 1,
      version: 2,
      meshCount: 1,
      hasExternalResources: false,
      materials: ['Fabric'],
    };

    expect(isDeclaredMaterial('Fabric', found)).toBe(true);
    expect(isDeclaredMaterial('Anything', found)).toBe(false);
  });
});
