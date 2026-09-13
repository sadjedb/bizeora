'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Alert } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/field';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Modal } from '@/components/ui/overlay';
import { Stack } from '@/components/layout/layout';
import { Text } from '@/components/ui/typography';
import { useDictionary } from '@/i18n/client';
import {
  ADJUSTMENT_NOTE_MAX,
  ADJUSTMENT_REASONS,
  ADJUSTMENT_REASON_LABELS,
  resultingQuantity,
  validateStockAdjustment,
  type AdjustmentReason,
} from '@/domain/catalogue';

import { adjustStockAction } from './actions';

/**
 * Adjusting one variant's stock.
 *
 * The control is a **signed delta**, not a new total, and the dialog shows the
 * arithmetic while it is typed: `12 → 15`. That is not decoration. An operator
 * counting a shelf thinks "there are three more than the system says", and a
 * form that makes them compute the new total is a form that will eventually
 * receive somebody's mental arithmetic instead of their count.
 *
 * `validateStockAdjustment` runs here purely to render the refusal *before* the
 * submit — the same function runs on the server, and the database carries the
 * same two conditions on the `UPDATE` itself. Three layers, and only the last
 * one is authoritative: this one exists so the operator is told "3 units are
 * reserved to an order" while they are still looking at the field.
 */
export function AdjustStockDialog({
  variantId,
  sku,
  productName,
  stockQuantity,
  reservedQuantity,
  trigger,
}: {
  variantId: string;
  sku: string;
  productName: string;
  stockQuantity: number;
  reservedQuantity: number;
  trigger: React.ReactNode;
}) {
  const { t } = useDictionary();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState('');
  const [reason, setReason] = useState<AdjustmentReason>('RECEIVED');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const trimmed = raw.trim();
  const parsed = /^[+-]?\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : Number.NaN;
  const hasDelta = Number.isInteger(parsed) && parsed !== 0;

  const preview = hasDelta ? resultingQuantity(stockQuantity, parsed) : null;

  const localRefusal = hasDelta
    ? validateStockAdjustment(
        { delta: parsed, reason, note: note.length === 0 ? null : note },
        { stockQuantity, reservedQuantity },
      )
    : null;

  function submit() {
    setError(null);

    startTransition(async () => {
      const result = await adjustStockAction({
        variantId,
        delta: parsed,
        reason,
        note: note.trim().length === 0 ? null : note.trim(),
      });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      setRaw('');
      setNote('');
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Modal
      open={open}
      onOpenChange={setOpen}
      size="form"
      title="Ajuster le stock"
      description={`${productName} · ${sku}`}
      trigger={trigger}
    >
      <Stack gap={4}>
        {error && (
          <Alert tone="danger" title={t.admin.adjustmentRefused}>
            {error}
          </Alert>
        )}

        <dl className="border-border grid grid-cols-3 gap-3 rounded-md border p-3">
          <div className="flex flex-col gap-0.5">
            <dt className="text-overline text-fg-subtle">En stock</dt>
            <dd className="text-heading-md tabular-nums">{stockQuantity}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-overline text-fg-subtle">{t.admin.colReserved}</dt>
            <dd className="text-heading-md tabular-nums">{reservedQuantity}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-overline text-fg-subtle">Disponible</dt>
            <dd className="text-heading-md tabular-nums">
              {Math.max(0, stockQuantity - reservedQuantity)}
            </dd>
          </div>
        </dl>

        <FormField
          label="Ajustement"
          required
          error={localRefusal?.message}
          description={t.admin.adjustmentHint}
        >
          {(field) => (
            <Input
              {...field}
              value={raw}
              onChange={(event) => setRaw(event.target.value)}
              inputMode="numeric"
              autoComplete="off"
              placeholder="+3"
              className="font-mono tabular-nums"
            />
          )}
        </FormField>

        <Text
          variant="body-sm"
          tone={preview === null ? 'subtle' : 'default'}
          aria-live="polite"
        >
          {preview === null ? (
            t.admin.resultingStockHere
          ) : (
            <>
              Stock après ajustement :{' '}
              <span className="font-mono tabular-nums">
                {stockQuantity} → {preview}
              </span>
            </>
          )}
        </Text>

        <FormField label={t.admin.reason} required>
          {(field) => (
            <NativeSelect
              {...field}
              value={reason}
              onChange={(event) => setReason(event.target.value as AdjustmentReason)}
            >
              {ADJUSTMENT_REASONS.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {ADJUSTMENT_REASON_LABELS[candidate]}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>

        <FormField label={t.admin.note} optional description={t.admin.adjustmentNoteHint}>
          {(field) => (
            <Textarea
              {...field}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={ADJUSTMENT_NOTE_MAX}
              rows={2}
            />
          )}
        </FormField>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Annuler
          </Button>
          <Button
            size="sm"
            loading={pending}
            disabled={!hasDelta || localRefusal !== null}
            onClick={submit}
          >
            Enregistrer le mouvement
          </Button>
        </div>
      </Stack>
    </Modal>
  );
}
