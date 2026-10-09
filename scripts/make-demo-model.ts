/**
 * A garment model, built from arithmetic.
 *
 * Phase 14.10 shipped the `.glb` parser, the public `models/` prefix and the
 * texture-space transform, and then could not ship the viewer: there was no
 * model to view. The owner commissions those from outside the business, and
 * waiting for one would have meant a viewer nobody could run and a pipeline
 * nobody could test.
 *
 * So this writes one. It is not a garment anybody would photograph — a torso
 * box with a collar band — and it is not meant to be. What it is, exactly, is a
 * **real binary glTF**: two materials, a UV map whose front face fills the 0–1
 * square, and a container this project's own parser accepts. That is enough to
 * prove every claim the phase makes, end to end, and to keep proving them in
 * CI after a real model arrives.
 *
 *     npx tsx scripts/make-demo-model.ts
 *
 * The output is deterministic — same bytes every run — so it can be committed
 * and a diff means somebody changed the geometry.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { DEMO_MODEL_KEY } from './demo-model';

/* ---------------------------------------------------------------------------
 * Geometry
 * ------------------------------------------------------------------------ */

type Face = {
  /** Four corners, counter-clockwise seen from outside. */
  corners: readonly [number, number, number][];
  normal: readonly [number, number, number];
  /** The four UVs, in the same order as the corners. */
  uv: readonly [number, number][];
};

/**
 * The whole front face gets the whole texture.
 *
 * This is the one decision in the file that matters. `texturePlacement` maps a
 * placement onto a 0–1 texture, so a face that covers the full UV square is a
 * face where "40% across, 30% down" means exactly what it means on a
 * photograph. Every other face is parked in a corner of the texture where the
 * design never reaches, which is what makes the design appear on the chest and
 * nowhere else.
 */
const FULL: readonly [number, number][] = [
  [0, 1],
  [1, 1],
  [1, 0],
  [0, 0],
];

const PARKED: readonly [number, number][] = [
  [0, 0],
  [0.002, 0],
  [0.002, 0.002],
  [0, 0.002],
];

function box(input: {
  width: number;
  height: number;
  depth: number;
  centreY: number;
  frontIsPrintable: boolean;
}): Face[] {
  const x = input.width / 2;
  const z = input.depth / 2;
  const top = input.centreY + input.height / 2;
  const bottom = input.centreY - input.height / 2;

  const front = input.frontIsPrintable ? FULL : PARKED;

  return [
    {
      // Front — the chest.
      corners: [
        [-x, top, z],
        [x, top, z],
        [x, bottom, z],
        [-x, bottom, z],
      ],
      normal: [0, 0, 1],
      uv: front,
    },
    {
      // Back.
      corners: [
        [x, top, -z],
        [-x, top, -z],
        [-x, bottom, -z],
        [x, bottom, -z],
      ],
      normal: [0, 0, -1],
      uv: PARKED,
    },
    {
      corners: [
        [x, top, z],
        [x, top, -z],
        [x, bottom, -z],
        [x, bottom, z],
      ],
      normal: [1, 0, 0],
      uv: PARKED,
    },
    {
      corners: [
        [-x, top, -z],
        [-x, top, z],
        [-x, bottom, z],
        [-x, bottom, -z],
      ],
      normal: [-1, 0, 0],
      uv: PARKED,
    },
    {
      corners: [
        [-x, top, -z],
        [x, top, -z],
        [x, top, z],
        [-x, top, z],
      ],
      normal: [0, 1, 0],
      uv: PARKED,
    },
    {
      corners: [
        [-x, bottom, z],
        [x, bottom, z],
        [x, bottom, -z],
        [-x, bottom, -z],
      ],
      normal: [0, -1, 0],
      uv: PARKED,
    },
  ];
}

type Mesh = {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
};

function meshFrom(faces: readonly Face[]): Mesh {
  const mesh: Mesh = { positions: [], normals: [], uvs: [], indices: [] };

  for (const face of faces) {
    const first = mesh.positions.length / 3;

    face.corners.forEach((corner, index) => {
      mesh.positions.push(...corner);
      mesh.normals.push(...face.normal);
      mesh.uvs.push(...(face.uv[index] ?? [0, 0]));
    });

    mesh.indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
  }

  return mesh;
}

/* ---------------------------------------------------------------------------
 * The container
 * ------------------------------------------------------------------------ */

function minMax(values: readonly number[], stride: number) {
  const min = Array.from({ length: stride }, () => Number.POSITIVE_INFINITY);
  const max = Array.from({ length: stride }, () => Number.NEGATIVE_INFINITY);

  for (let index = 0; index < values.length; index += 1) {
    const axis = index % stride;
    min[axis] = Math.min(min[axis]!, values[index]!);
    max[axis] = Math.max(max[axis]!, values[index]!);
  }

  return { min, max };
}

/** Pad to a four-byte boundary, which glTF requires of every chunk. */
function pad(length: number): number {
  return (4 - (length % 4)) % 4;
}

function build(): Buffer {
  const body = meshFrom(
    box({ width: 1.1, height: 1.5, depth: 0.45, centreY: 0, frontIsPrintable: true }),
  );
  const collar = meshFrom(
    box({
      width: 0.44,
      height: 0.16,
      depth: 0.42,
      centreY: 0.82,
      frontIsPrintable: false,
    }),
  );

  const meshes = [body, collar];

  const buffers: Buffer[] = [];
  const views: { byteOffset: number; byteLength: number; target: number }[] = [];
  const accessors: Record<string, unknown>[] = [];
  let offset = 0;

  function push(data: Buffer, target: number): number {
    const padding = pad(offset);
    if (padding > 0) {
      buffers.push(Buffer.alloc(padding));
      offset += padding;
    }

    views.push({ byteOffset: offset, byteLength: data.byteLength, target });
    buffers.push(data);
    offset += data.byteLength;

    return views.length - 1;
  }

  const primitives = meshes.map((mesh, index) => {
    const positions = Buffer.from(new Float32Array(mesh.positions).buffer);
    const normals = Buffer.from(new Float32Array(mesh.normals).buffer);
    const uvs = Buffer.from(new Float32Array(mesh.uvs).buffer);
    const indices = Buffer.from(new Uint16Array(mesh.indices).buffer);

    const positionView = push(positions, 34962);
    const normalView = push(normals, 34962);
    const uvView = push(uvs, 34962);
    const indexView = push(indices, 34963);

    const bounds = minMax(mesh.positions, 3);

    const positionAccessor = accessors.push({
      bufferView: positionView,
      componentType: 5126,
      count: mesh.positions.length / 3,
      type: 'VEC3',
      // Required on POSITION by the specification, and used by every loader
      // to compute a bounding box without reading the vertices.
      min: bounds.min,
      max: bounds.max,
    });

    const normalAccessor = accessors.push({
      bufferView: normalView,
      componentType: 5126,
      count: mesh.normals.length / 3,
      type: 'VEC3',
    });

    const uvAccessor = accessors.push({
      bufferView: uvView,
      componentType: 5126,
      count: mesh.uvs.length / 2,
      type: 'VEC2',
    });

    const indexAccessor = accessors.push({
      bufferView: indexView,
      componentType: 5123,
      count: mesh.indices.length,
      type: 'SCALAR',
    });

    return {
      attributes: {
        POSITION: positionAccessor - 1,
        NORMAL: normalAccessor - 1,
        TEXCOORD_0: uvAccessor - 1,
      },
      indices: indexAccessor - 1,
      material: index,
    };
  });

  const binary = Buffer.concat(buffers);

  const json = {
    asset: {
      version: '2.0',
      generator: 'Bizeora demo model (scripts/make-demo-model.ts)',
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'Garment' }],
    meshes: [{ name: 'Garment', primitives }],
    /*
     * Two materials, and the names matter.
     *
     * "Fabric" is what you embroider and "Rib" is the collar, which is exactly
     * the distinction ADR-036 says nothing can guess reliably — the workshop
     * picks, and the pick is verified against the file. A demo model with one
     * material would make that machinery look like ceremony.
     */
    materials: [
      {
        name: 'Fabric',
        pbrMetallicRoughness: {
          baseColorFactor: [0.93, 0.92, 0.89, 1],
          metallicFactor: 0,
          roughnessFactor: 0.9,
        },
      },
      {
        name: 'Rib',
        pbrMetallicRoughness: {
          baseColorFactor: [0.82, 0.8, 0.76, 1],
          metallicFactor: 0,
          roughnessFactor: 1,
        },
      },
    ],
    accessors,
    bufferViews: views.map((view) => ({ buffer: 0, ...view })),
    buffers: [{ byteLength: binary.byteLength }],
  };

  const jsonChunk = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPadding = Buffer.alloc(pad(jsonChunk.byteLength), 0x20); // spaces
  const binaryPadding = Buffer.alloc(pad(binary.byteLength), 0);

  const jsonLength = jsonChunk.byteLength + jsonPadding.byteLength;
  const binaryLength = binary.byteLength + binaryPadding.byteLength;
  const total = 12 + 8 + jsonLength + 8 + binaryLength;

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // "glTF"
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonLength, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4); // "JSON"

  const binaryHeader = Buffer.alloc(8);
  binaryHeader.writeUInt32LE(binaryLength, 0);
  binaryHeader.writeUInt32LE(0x004e4942, 4); // "BIN\0"

  return Buffer.concat([
    header,
    jsonHeader,
    jsonChunk,
    jsonPadding,
    binaryHeader,
    binary,
    binaryPadding,
  ]);
}

/* ---------------------------------------------------------------------------
 * Writing it
 * ------------------------------------------------------------------------ */

const target = join(process.cwd(), 'public', 'assets', DEMO_MODEL_KEY);

mkdirSync(dirname(target), { recursive: true });
const bytes = build();
writeFileSync(target, bytes);

console.log(`Wrote ${target} (${bytes.byteLength} bytes)`);
