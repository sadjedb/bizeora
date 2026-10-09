'use client';

import { useRef, useState, useTransition } from 'react';
import { Box, Trash2 } from 'lucide-react';

import { Alert, Badge } from '@/components/ui/feedback';
import { Button, IconButton } from '@/components/ui/button';
import { Inline, Stack } from '@/components/layout/layout';
import { Input, NativeSelect } from '@/components/ui/input';
import { Text } from '@/components/ui/typography';
import { useDictionary } from '@/i18n/client';
import { MAX_MODEL_BYTES, MODEL_EXTENSION } from '@/domain/model3d';
import {
  MAX_SURFACE_WIDTH_MM,
  MIN_SURFACE_WIDTH_MM,
} from '@/domain/customization/placement';

import {
  deleteProductModelAction,
  readModelMaterialsAction,
  updateProductModelAction,
  uploadProductModelAction,
} from '../actions';

/**
 * The product's 3D model.
 *
 * Phase 14.10 built the parser, the storage prefix and the transform, and wrote
 * down that the screen did not exist. This is the screen.
 *
 * ## The material is chosen before the file is stored
 *
 * A garment model names its surfaces — `Fabric`, `Rib`, `Zipper`, `Label` — and
 * exactly one of them is the thing you embroider. ADR-036: nothing can guess
 * that reliably, so the operator picks. What makes the picking bearable is that
 * the file is **read twice**: once here, without storing anything, to list what
 * it declares; and once on upload, to verify the pick against the file. The
 * alternative is attaching a model with a guess and making somebody correct it
 * afterwards, which means a period where a customer's design lands on a zip.
 *
 * ## One model, in practice
 *
 * The schema allows several — one per variant, plus one for the product — and
 * the storefront shows exactly one (`getProductModel`). This screen lists what
 * is there rather than hiding the extra rows, because a row nobody can see is a
 * row nobody can delete.
 */

export type AdminModel = {
  id: string;
  src: string | null;
  byteSize: number;
  materialName: string;
  surfaceWidthMm: number | null;
  label: string | null;
  isActive: boolean;
};

type Stage =
  | { step: 'idle' }
  | { step: 'reading' }
  /** The file is in hand and its materials are known; the operator picks one. */
  | {
      step: 'choosing';
      file: File;
      materials: readonly string[];
      suggested: string | null;
    }
  | { step: 'uploading' };

export function ProductModels({
  productId,
  models,
}: {
  productId: string;
  models: readonly AdminModel[];
}) {
  const { t } = useDictionary();
  const input = useRef<HTMLInputElement | null>(null);
  const [stage, setStage] = useState<Stage>({ step: 'idle' });
  const [material, setMaterial] = useState('');
  const [width, setWidth] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setStage({ step: 'idle' });
    setMaterial('');
    setWidth('');
    if (input.current) input.current.value = '';
  }

  async function chooseFile(file: File | undefined) {
    if (!file) return;

    setError(null);

    if (file.size > MAX_MODEL_BYTES) {
      setError(t.admin.modelTooLarge(Math.round(MAX_MODEL_BYTES / (1024 * 1024))));
      return;
    }

    setStage({ step: 'reading' });

    const form = new FormData();
    form.set('file', file);

    const result = await readModelMaterialsAction(form);

    if (!result.ok) {
      setError(result.message);
      reset();
      return;
    }

    setMaterial(result.suggested ?? result.materials[0] ?? '');
    setStage({
      step: 'choosing',
      file,
      materials: result.materials,
      suggested: result.suggested,
    });
  }

  function upload() {
    if (stage.step !== 'choosing') return;

    const chosen = stage;

    const form = new FormData();
    form.set('productId', productId);
    form.set('file', chosen.file);
    form.set('materialName', material);
    if (width.trim()) form.set('surfaceWidthMm', width.trim());

    setStage({ step: 'uploading' });

    startTransition(async () => {
      const result = await uploadProductModelAction(form);

      if (!result.ok) {
        // Back to the chooser with the same file, so a refused upload does not
        // cost the operator the file picker again.
        setError(result.message);
        setStage(chosen);
        return;
      }

      setError(null);
      reset();
    });
  }

  function act(work: () => Promise<{ ok: boolean; message?: string }>) {
    startTransition(async () => {
      const result = await work();
      setError(result.ok ? null : (result.message ?? t.admin.actionRefused));
    });
  }

  return (
    <Stack gap={4}>
      <Inline gap={3} className="items-center justify-between">
        <Text variant="heading-md" as="h2">
          {t.admin.modelHeading}
        </Text>

        <Button
          variant="secondary"
          size="sm"
          onClick={() => input.current?.click()}
          loading={stage.step === 'reading'}
          disabled={pending}
        >
          <Box className="size-4" aria-hidden="true" />
          {t.admin.modelAdd}
        </Button>
      </Inline>

      <Text variant="body-sm" tone="muted" className="max-w-prose">
        {t.admin.modelHint(MODEL_EXTENSION, Math.round(MAX_MODEL_BYTES / (1024 * 1024)))}
      </Text>

      <input
        ref={input}
        type="file"
        accept={`.${MODEL_EXTENSION},model/gltf-binary`}
        className="sr-only"
        onChange={(event) => void chooseFile(event.target.files?.[0])}
      />

      {error && (
        <Alert tone="danger" title={t.admin.actionRefused}>
          {error}
        </Alert>
      )}

      {stage.step === 'choosing' && (
        <div className="border-border bg-surface flex flex-col gap-4 rounded-md border p-4">
          <Text variant="body-sm" tone="muted">
            {t.admin.modelChooseMaterial}
          </Text>

          <Inline gap={3} wrap className="items-end">
            <label className="flex flex-col gap-1">
              <Text variant="body-sm" as="span">
                {t.admin.modelMaterial}
              </Text>
              <NativeSelect
                value={material}
                onChange={(event) => setMaterial(event.target.value)}
                className="w-auto"
              >
                {stage.materials.map((name) => (
                  <option key={name} value={name}>
                    {name}
                    {name === stage.suggested ? ` — ${t.admin.modelSuggested}` : ''}
                  </option>
                ))}
              </NativeSelect>
            </label>

            <label className="flex flex-col gap-1">
              <Text variant="body-sm" as="span">
                {t.admin.modelWidthMm}
              </Text>
              <Input
                value={width}
                inputMode="numeric"
                min={MIN_SURFACE_WIDTH_MM}
                max={MAX_SURFACE_WIDTH_MM}
                onChange={(event) => setWidth(event.target.value)}
                className="max-w-32"
              />
            </label>

            <Button onClick={upload} loading={pending} disabled={material === ''}>
              {t.admin.modelUpload}
            </Button>

            <Button variant="ghost" onClick={reset} disabled={pending}>
              {t.common.cancel}
            </Button>
          </Inline>
        </div>
      )}

      {models.length === 0 ? (
        <Text variant="body-sm" tone="subtle">
          {t.admin.modelNone}
        </Text>
      ) : (
        <ul className="flex list-none flex-col gap-2 p-0">
          {models.map((model) => (
            <li
              key={model.id}
              className="border-border bg-surface flex flex-wrap items-center gap-3 rounded-md border p-3"
            >
              <Box className="text-fg-subtle size-5 shrink-0" aria-hidden="true" />

              <Stack gap={0} className="min-w-40 flex-1">
                <Text variant="body-sm" as="span">
                  {model.label ?? t.admin.modelUnnamed}
                </Text>
                <Text variant="caption" tone="subtle" as="span" numeric>
                  {model.materialName} · {Math.round(model.byteSize / 1024)} Ko
                  {model.surfaceWidthMm ? ` · ${model.surfaceWidthMm} mm` : ''}
                </Text>
              </Stack>

              {!model.isActive && <Badge tone="neutral">{t.admin.modelInactive}</Badge>}

              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() =>
                  act(() =>
                    updateProductModelAction({
                      modelId: model.id,
                      isActive: !model.isActive,
                    }),
                  )
                }
              >
                {model.isActive ? t.admin.modelDeactivate : t.admin.modelActivate}
              </Button>

              <IconButton
                label={t.admin.modelDelete}
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => act(() => deleteProductModelAction({ modelId: model.id }))}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </Stack>
  );
}
