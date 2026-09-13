/**
 * Garments modelled in three dimensions.
 *
 * The third kind of file this application accepts, and it needed its own rules
 * rather than a row in somebody else's table. The other two are already
 * opposites — customer artwork is private and kept byte-for-byte
 * (`domain/design-file`), shop photography is public and re-encoded
 * (`domain/media`) — and a `.glb` is a third thing again: **public, kept
 * byte-for-byte, and executable-ish.**
 *
 * That last property is the whole reason this file exists. A photograph is
 * inert; a browser decodes it and draws it. A glTF model is a *document that
 * points at things*: it can name external images and buffers by URI, and a
 * viewer will dutifully go and fetch every one of them from whatever host is
 * written there. Publishing an unexamined `.glb` means publishing a page that
 * makes requests somebody else chose — a tracking pixel with a mesh around it,
 * and on a self-hosted viewer a request the *server* might make.
 *
 * So the bytes are not re-encoded (there is no `sharp` for geometry, and
 * re-encoding a mesh is a lossy operation nobody asked for) — they are
 * **inspected and refused**. Everything the model needs must be inside the
 * file.
 *
 * Pure: the limits, the refusals and what counts as a printable material. The
 * binary parsing lives in `lib/model3d/glb`.
 */

/* ---------------------------------------------------------------------------
 * What may be uploaded
 * ------------------------------------------------------------------------ */

/**
 * Binary glTF, and nothing else.
 *
 * Not `.gltf`: the JSON flavour is a *manifest* that references `.bin` buffers
 * and texture images as separate files beside it. Accepting it would mean
 * accepting a folder, keeping the pieces together for the life of the product,
 * and serving a document whose dependencies are paths. `.glb` is the same
 * format with everything in one file, which is the property that makes it
 * storable, cacheable and checkable.
 *
 * Not `.obj`, `.fbx` or `.usdz` either. One format is a decision, not a
 * limitation: every one of them would need its own parser to answer the same
 * question this one answers, and the owner commissioning a model can ask for
 * `.glb` as easily as anything else.
 */
export const MODEL_MIME_TYPES = ['model/gltf-binary'] as const;

export type ModelMimeType = (typeof MODEL_MIME_TYPES)[number];

export function isModelMimeType(value: string): value is ModelMimeType {
  return (MODEL_MIME_TYPES as readonly string[]).includes(value);
}

export const MODEL_EXTENSION = 'glb';

/**
 * 24 MB.
 *
 * A garment is a simple shape. A well-made blank hoodie with a 2K texture is
 * two or three megabytes; twenty-four leaves room for a generous texture and
 * a modeller who did not decimate, and still refuses the 200 MB film asset
 * somebody exports by accident. It is a ceiling on carelessness, not a budget:
 * every megabyte here is downloaded by a customer on a phone before they can
 * place a logo.
 */
export const MAX_MODEL_BYTES = 24 * 1024 * 1024;

/** Below this it is not a glTF container at all. */
export const MIN_MODEL_BYTES = 20;

/* ---------------------------------------------------------------------------
 * Why a model was refused
 * ------------------------------------------------------------------------ */

export type ModelRefusal =
  | 'TOO_LARGE'
  | 'TOO_SMALL'
  | 'NOT_GLB'
  | 'UNSUPPORTED_VERSION'
  | 'MALFORMED'
  | 'EXTERNAL_RESOURCE'
  | 'NO_MATERIAL'
  | 'NO_MESH';

/**
 * What each refusal means to the person who uploaded the file.
 *
 * Written for the owner of an embroidery shop, not for a graphics programmer:
 * every one of these says what to do next, because "malformed GLB" is a
 * sentence that ends a conversation.
 */
export const MODEL_REFUSAL_LABELS: Record<ModelRefusal, string> = {
  TOO_LARGE: `Le fichier dépasse ${Math.round(MAX_MODEL_BYTES / (1024 * 1024))} Mo. Demandez au modéliste une version allégée (texture 2K, maillage décimé).`,
  TOO_SMALL: 'Ce fichier est trop petit pour être un modèle 3D.',
  NOT_GLB:
    'Seuls les fichiers .glb sont acceptés. Un .gltf est un dossier de fichiers : demandez un export « GLB (binaire) ».',
  UNSUPPORTED_VERSION:
    'Ce modèle utilise une version de glTF que nous ne lisons pas. Demandez un export glTF 2.0.',
  MALFORMED: 'Ce fichier .glb est incomplet ou corrompu. Réexportez-le.',
  EXTERNAL_RESOURCE:
    'Ce modèle va chercher ses textures dans d’autres fichiers. Réexportez-le en cochant « intégrer les textures » : tout doit tenir dans le .glb.',
  NO_MATERIAL: 'Ce modèle ne déclare aucune matière : impossible de savoir où broder.',
  NO_MESH: 'Ce modèle ne contient aucune forme.',
};

/* ---------------------------------------------------------------------------
 * What an inspection found
 * ------------------------------------------------------------------------ */

/**
 * The facts `lib/model3d/glb` extracts, and the only ones anything else reads.
 *
 * `materials` is the interesting one. A garment model names its surfaces —
 * `Fabric`, `Rib`, `Zipper`, `Label` — and exactly one of them is the thing you
 * embroider. Nothing can guess which, so the admin picks from this list, and
 * the pick is stored on the row (`product_models_3d.material_name`).
 */
export type ModelInspection = {
  byteSize: number;
  /** glTF's own version, which must be 2. */
  version: number;
  materials: readonly string[];
  meshCount: number;
  /** True when the file names something it does not contain. */
  hasExternalResources: boolean;
};

export type ModelCheck =
  { ok: true; inspection: ModelInspection } | { ok: false; reason: ModelRefusal };

/**
 * Whether an inspected model may be published.
 *
 * Separate from the parsing on purpose: the parser answers *what is in this
 * file*, and this answers *may we serve it*. The split is what makes the rule
 * testable without a binary fixture, and what stops the decision drifting into
 * a byte-shuffling module where nobody would look for it.
 */
export function acceptModel(inspection: ModelInspection): ModelCheck {
  if (inspection.byteSize > MAX_MODEL_BYTES) return refuse('TOO_LARGE');
  if (inspection.byteSize < MIN_MODEL_BYTES) return refuse('TOO_SMALL');
  if (inspection.version !== 2) return refuse('UNSUPPORTED_VERSION');

  /*
   * The rule this module exists for.
   *
   * A model that names an external image or buffer is a model whose viewer
   * makes requests we did not choose, to a host we did not choose, carrying
   * whatever the customer's browser attaches. There is no safe subset worth
   * allowing — a same-origin reference is still a reference to a file we do
   * not have — so the answer is "everything is in the file, or it is not
   * published".
   */
  if (inspection.hasExternalResources) return refuse('EXTERNAL_RESOURCE');

  if (inspection.meshCount === 0) return refuse('NO_MESH');
  if (inspection.materials.length === 0) return refuse('NO_MATERIAL');

  return { ok: true, inspection };
}

function refuse(reason: ModelRefusal): ModelCheck {
  return { ok: false, reason };
}

/**
 * Whether a material name is one this model actually declares.
 *
 * The admin's choice arrives from a form as a string, and a string from a form
 * selects which surface of a customer's garment gets embroidered. It is checked
 * against the file rather than trusted.
 */
export function isDeclaredMaterial(name: string, inspection: ModelInspection): boolean {
  return inspection.materials.includes(name);
}

/**
 * The material a garment is most likely embroidered on, as a first guess.
 *
 * Only a default for the admin's dropdown — it is never applied without
 * somebody confirming it. The heuristic is deliberately dumb: the names that
 * appear on garment models in practice, then the first material declared.
 * A cleverer guess would be wrong less often and trusted more, which is worse.
 */
const LIKELY_FABRIC = ['fabric', 'tissu', 'body', 'corps', 'shirt', 'cotton', 'main'];

export function suggestedMaterial(inspection: ModelInspection): string | null {
  const named = inspection.materials.find((material) =>
    LIKELY_FABRIC.some((hint) => material.toLowerCase().includes(hint)),
  );

  return named ?? inspection.materials[0] ?? null;
}
