import 'server-only';

import { MAX_MODEL_BYTES, acceptModel, type ModelCheck } from '@/domain/model3d';

/**
 * Reading a `.glb` far enough to decide whether to publish it.
 *
 * The container is simple and worth stating in full, because everything below
 * is a check against this and a reader should be able to see why:
 *
 * ```
 *  magic    u32  0x46546C67  "glTF"
 *  version  u32  2
 *  length   u32  the whole file, header included
 *
 *  then one or more chunks:
 *    chunkLength u32
 *    chunkType   u32   0x4E4F534A "JSON"  |  0x004E4942 "BIN\0"
 *    chunkData   chunkLength bytes, padded to 4
 * ```
 *
 * The first chunk must be the JSON — that is the glTF document itself — and
 * everything the model needs must be either in that JSON, in the BIN chunk, or
 * in a `data:` URI. **A reference to anything else is a refusal**, for the
 * reason `domain/model3d` gives at length: a viewer honours those references,
 * and a model that fetches from a host we did not choose is a tracking pixel
 * with a mesh around it.
 *
 * This parser is deliberately shallow. It does not validate the geometry, it
 * does not check that accessors point at real buffer views, and it does not
 * care whether the model looks right — a broken mesh is the modeller's problem
 * and it renders as nothing. It answers exactly two questions: *is this really
 * a glTF 2.0 binary*, and *does it reach outside itself*.
 */

const MAGIC_GLTF = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;

/**
 * The JSON chunk is read as text, and text has to be bounded.
 *
 * A malicious header could declare a 3 GB JSON chunk inside a 2 KB file; the
 * length checks below catch that, but the cap is stated separately so the
 * decoder is never handed a length it would try to allocate for. 8 MB of JSON
 * is an enormous glTF document — the geometry lives in the BIN chunk, not here.
 */
const MAX_JSON_BYTES = 8 * 1024 * 1024;

/** The subset of the glTF document this module reads. Everything else is ignored. */
type GltfDocument = {
  asset?: { version?: unknown };
  materials?: readonly { name?: unknown }[];
  meshes?: readonly unknown[];
  buffers?: readonly { uri?: unknown }[];
  images?: readonly { uri?: unknown }[];
};

/**
 * Inspect the bytes, then ask the domain whether they may be published.
 *
 * Returns the domain's own refusal rather than throwing: every failure here is
 * something the owner needs to be told in a sentence they can act on, and an
 * exception would arrive at the screen as "something went wrong".
 */
export function inspectGlb(bytes: Uint8Array): ModelCheck {
  const inspection = readGlb(bytes);
  if (!inspection.ok) return inspection;

  return acceptModel(inspection.inspection);
}

function readGlb(bytes: Uint8Array): ModelCheck {
  if (bytes.byteLength < HEADER_BYTES + CHUNK_HEADER_BYTES) {
    return { ok: false, reason: 'TOO_SMALL' };
  }

  // Refused before anything is parsed: a file over the cap is not read at all,
  // so a hostile header never gets to influence an allocation.
  if (bytes.byteLength > MAX_MODEL_BYTES) return { ok: false, reason: 'TOO_LARGE' };

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Little-endian throughout: the glTF spec says so, and a big-endian read is
  // how a valid file looks like garbage.
  if (view.getUint32(0, true) !== MAGIC_GLTF) return { ok: false, reason: 'NOT_GLB' };

  const version = view.getUint32(4, true);
  const declaredLength = view.getUint32(8, true);

  /*
   * The declared length must be the actual length.
   *
   * Not "at most": a file that says it is shorter than it is has bytes after
   * its own end, and whether a reader sees them depends on the reader. Two
   * parsers disagreeing about where a file stops is the shape of a real class
   * of bug, so anything but an exact match is refused.
   */
  if (declaredLength !== bytes.byteLength) return { ok: false, reason: 'MALFORMED' };

  const firstChunkLength = view.getUint32(HEADER_BYTES, true);
  const firstChunkType = view.getUint32(HEADER_BYTES + 4, true);

  // The spec requires the JSON chunk to come first. A file that leads with BIN
  // is either not glTF or is trying to be read two different ways.
  if (firstChunkType !== CHUNK_JSON) return { ok: false, reason: 'MALFORMED' };
  if (firstChunkLength === 0 || firstChunkLength > MAX_JSON_BYTES) {
    return { ok: false, reason: 'MALFORMED' };
  }

  const jsonStart = HEADER_BYTES + CHUNK_HEADER_BYTES;
  const jsonEnd = jsonStart + firstChunkLength;
  if (jsonEnd > bytes.byteLength) return { ok: false, reason: 'MALFORMED' };

  let document: GltfDocument;

  try {
    // `fatal` so invalid UTF-8 is an error rather than a string full of
    // replacement characters that then fails to be JSON for the wrong reason.
    const text = new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.subarray(jsonStart, jsonEnd),
    );
    const parsed: unknown = JSON.parse(text);

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, reason: 'MALFORMED' };
    }

    document = parsed as GltfDocument;
  } catch {
    return { ok: false, reason: 'MALFORMED' };
  }

  const assetVersion = Number.parseInt(String(document.asset?.version ?? ''), 10);

  return {
    ok: true,
    inspection: {
      byteSize: bytes.byteLength,
      // The container's version and the document's must agree. Taking the
      // lower of the two means a file claiming 2 in one place and 1 in the
      // other is refused rather than believed selectively.
      version: Number.isFinite(assetVersion) ? Math.min(version, assetVersion) : 0,
      materials: materialNames(document),
      meshCount: Array.isArray(document.meshes) ? document.meshes.length : 0,
      hasExternalResources: reachesOutside(document),
    },
  };
}

/**
 * Material names, in declaration order and de-duplicated.
 *
 * A material with no name is real and common — exporters omit it — and it is
 * given its index instead, because the admin has to be able to pick it out of
 * a list and "(sans nom)" three times over is not a list.
 */
function materialNames(document: GltfDocument): readonly string[] {
  if (!Array.isArray(document.materials)) return [];

  const names = document.materials.map((material, index) =>
    typeof material?.name === 'string' && material.name.trim().length > 0
      ? material.name.trim()
      : `material_${index}`,
  );

  return [...new Set(names)];
}

/**
 * Whether the document names anything that is not inside the file.
 *
 * A `uri` is absent when the resource lives in the BIN chunk, which is the
 * normal case for a `.glb`. When present it is either a `data:` URI — the bytes
 * inline, fine — or a reference to somewhere else, which is the thing being
 * refused. Both `buffers` and `images` can carry one.
 */
function reachesOutside(document: GltfDocument): boolean {
  const uris = [
    ...(Array.isArray(document.buffers) ? document.buffers : []),
    ...(Array.isArray(document.images) ? document.images : []),
  ]
    .map((resource) => resource?.uri)
    .filter((uri): uri is string => typeof uri === 'string');

  return uris.some((uri) => !isInlineDataUri(uri));
}

/**
 * A `data:` URI, matched without being clever about it.
 *
 * Leading whitespace is stripped and the scheme is compared case-insensitively,
 * because `  DATA:image/png;base64,…` is the same URI to a browser and a
 * stricter match here would refuse a valid file. Anything else — `http:`,
 * `file:`, a bare relative path like `texture.png`, or a protocol-relative
 * `//host/x` — is outside.
 */
function isInlineDataUri(uri: string): boolean {
  return /^\s*data:/i.test(uri);
}
