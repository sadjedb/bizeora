import 'server-only';

import {
  MODEL_REFUSAL_LABELS,
  isDeclaredMaterial,
  suggestedMaterial,
  type ModelRefusal,
} from '@/domain/model3d';
import { inspectGlb } from '@/lib/model3d/glb';
import { modelKeyFor, newObjectId, storage } from '@/lib/storage';
import {
  addProductModel,
  deleteProductModel,
  listProductModels,
  updateProductModel,
  type AdminModelRow,
} from '@/server/repositories/catalogue-admin-repository';

/**
 * Garment models, as use cases.
 *
 * Its own module rather than a few more functions in `media-service`, because
 * the rule that makes each of them safe is different and a shared module would
 * blur the two:
 *
 *   - a **photograph** is safe because it is re-encoded. The bytes on the shelf
 *     are ours; whatever the camera wrote is gone.
 *   - a **model** is safe because it was *read and refused*. The bytes are the
 *     modeller's, kept exactly — there is no `sharp` for geometry and
 *     re-encoding a mesh would be a lossy operation nobody asked for — and the
 *     guarantee is about what the file **references**, not about what it is.
 *
 * The order below is the order it has to be in. The file is parsed **before**
 * anything is written, because `models/` is public: an object there is readable
 * the moment it exists, so "verify afterwards" would mean publishing a model
 * that fetches from somebody else's server for as long as the check takes.
 */

export type ModelFailure = {
  ok: false;
  code: ModelRefusal | 'NOT_FOUND';
  message: string;
};
export type ModelResult<T> = { ok: true; value: T } | ModelFailure;

const NOT_FOUND = 'Ce modèle est introuvable.';

function refuse(code: ModelRefusal): ModelFailure {
  return { ok: false, code, message: MODEL_REFUSAL_LABELS[code] };
}

/**
 * Store one `.glb` and attach it to a product.
 *
 * `materialName` is optional and, when omitted, is the parser's own suggestion
 * — a guess for the dropdown, never a decision. When supplied it is checked
 * against the file: the name arrives from a form and decides which surface of a
 * customer's garment gets embroidered, so it is verified rather than trusted.
 */
export async function attachProductModel(input: {
  productId: string;
  bytes: Uint8Array;
  materialName?: string | null;
  surfaceWidthMm?: number | null;
  label?: string | null;
}): Promise<ModelResult<AdminModelRow>> {
  const check = inspectGlb(input.bytes);
  if (!check.ok) return refuse(check.reason);

  const material =
    input.materialName && input.materialName.trim().length > 0
      ? input.materialName.trim()
      : suggestedMaterial(check.inspection);

  if (!material) return refuse('NO_MATERIAL');
  if (!isDeclaredMaterial(material, check.inspection)) return refuse('NO_MATERIAL');

  const key = modelKeyFor(newObjectId());

  await storage.put({
    key,
    body: input.bytes,
    contentType: 'model/gltf-binary',
  });

  const row = await addProductModel({
    productId: input.productId,
    storageKey: key,
    byteSize: check.inspection.byteSize,
    materialName: material,
    surfaceWidthMm: input.surfaceWidthMm ?? null,
    label: input.label?.trim() || null,
  });

  if (!row.ok) {
    // Best effort, like the photography path: a leaked object is a few
    // kilobytes nobody can reach, and throwing here would lose the upload for
    // a reason the operator cannot act on.
    await storage.delete(key).catch(() => undefined);
    return { ok: false, code: 'NOT_FOUND', message: NOT_FOUND };
  }

  return { ok: true, value: row.value };
}

/**
 * The materials a file declares, without storing it.
 *
 * So the upload screen can ask "which of these do you embroider?" *before* the
 * model is attached, rather than attaching it with a guess and making the
 * operator correct it afterwards.
 */
export function readModelMaterials(
  bytes: Uint8Array,
): ModelResult<{ materials: readonly string[]; suggested: string | null }> {
  const check = inspectGlb(bytes);
  if (!check.ok) return refuse(check.reason);

  return {
    ok: true,
    value: {
      materials: check.inspection.materials,
      suggested: suggestedMaterial(check.inspection),
    },
  };
}

export async function setModelSettings(input: {
  modelId: string;
  materialName?: string;
  surfaceWidthMm?: number | null;
  isActive?: boolean;
}): Promise<ModelResult<{ productId: string }>> {
  const updated = await updateProductModel(input);
  if (!updated.ok) return { ok: false, code: 'NOT_FOUND', message: NOT_FOUND };

  return { ok: true, value: updated.value };
}

/**
 * Detach a model and delete its bytes.
 *
 * Row first, object second — the same order and the same reasoning as a
 * photograph: an orphaned object is invisible and costs a few kilobytes, while
 * a row pointing at bytes that are gone is a viewer that fails to load in front
 * of a customer.
 */
export async function removeProductModel(
  modelId: string,
): Promise<ModelResult<{ productId: string }>> {
  const removed = await deleteProductModel(modelId);
  if (!removed.ok) return { ok: false, code: 'NOT_FOUND', message: NOT_FOUND };

  await storage.delete(removed.value.storageKey).catch(() => undefined);

  return { ok: true, value: { productId: removed.value.productId } };
}

export async function modelsFor(productId: string): Promise<readonly AdminModelRow[]> {
  return listProductModels(productId);
}
