'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Alert } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { FormField } from '@/components/ui/field';
import { Inline, Stack } from '@/components/layout/layout';
import { Input, SelectField, Textarea } from '@/components/ui/input';
import { Modal } from '@/components/ui/overlay';
import { Text } from '@/components/ui/typography';
import { useDictionary } from '@/i18n/client';

import {
  recordPaymentAction,
  reviewProofAction,
  saveInternalNotesAction,
  transitionOrderAction,
} from '../actions';

/**
 * The order workspace's controls.
 *
 * Three separate forms, because they are three separate decisions and one
 * combined panel would invite the wrong one. **None of them computes anything**:
 * the available transitions were derived by the state machine on the server, the
 * balance was derived from the order row, and this file renders what it was
 * given.
 *
 * The transition control asks for exactly what 8.7 requires and nothing more —
 * a reason for a cancellation, a carrier and a tracking number for a shipment,
 * a note for a hold — and the server refuses the move anyway if the payload is
 * short. The fields here exist so the admin is not refused after the fact.
 */

export type OrderControlsProps = {
  orderNumber: string;
  status: string;
  statusLabel: string;
  /** Derived by `domain/order/state-machine` on the server (8.1, 8.3, 8.6). */
  available: readonly { value: string; label: string }[];
  currency: string;
  grandTotal: number;
  outstandingBalance: number;
  outstandingDeposit: number;
  amountPaid: number;
  suggestedKind: 'DEPOSIT' | 'BALANCE' | 'FULL' | 'REFUND';
  paymentMethod: string;
  internalNotes: string;
  pendingProof: { id: string; filename: string; previewUrl: string | null } | null;
};

const KINDS = [
  { value: 'DEPOSIT', label: 'Acompte' },
  { value: 'BALANCE', label: 'Solde' },
  { value: 'FULL', label: 'Paiement intégral' },
  { value: 'REFUND', label: 'Remboursement' },
] as const;

const METHODS = [
  { value: 'BANK_TRANSFER', label: 'Virement bancaire' },
  { value: 'CCP', label: 'CCP' },
  { value: 'COD', label: 'Paiement à la livraison' },
] as const;

export function OrderControls(props: OrderControlsProps) {
  const { t } = useDictionary();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const [target, setTarget] = useState(props.available[0]?.value ?? '');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [carrier, setCarrier] = useState('');
  const [tracking, setTracking] = useState('');
  const [confirming, setConfirming] = useState(false);

  const [kind, setKind] = useState<string>(props.suggestedKind);
  const [method, setMethod] = useState<string>(
    props.paymentMethod === 'ONLINE' ? 'BANK_TRANSFER' : props.paymentMethod,
  );
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState(props.orderNumber);

  const [notes, setNotes] = useState(props.internalNotes);
  const [rejecting, setRejecting] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');

  function run(work: () => Promise<{ ok: boolean; message?: string }>, success: string) {
    setError(null);
    setDone(null);

    startTransition(async () => {
      const result = await work();

      if (!result.ok) {
        setError(result.message ?? 'Action impossible.');
        return;
      }

      setDone(success);
      router.refresh();
    });
  }

  // 8.4: cancelling an order that is already being made is the one move worth
  // stopping to confirm, because materials are committed.
  const needsConfirmation = target === 'CANCELLED';

  function submitTransition() {
    setConfirming(false);

    run(
      () =>
        transitionOrderAction({
          orderNumber: props.orderNumber,
          to: target,
          note: note.trim() || null,
          cancellationReason: reason.trim() || null,
          carrierName: carrier.trim() || null,
          trackingNumber: tracking.trim() || null,
          trackingUrl: null,
        }),
      t.admin.statusUpdated,
    );
  }

  return (
    <Stack gap={6}>
      {error && (
        <Alert tone="danger" title="Action impossible">
          {error}
        </Alert>
      )}
      {done && <Alert tone="success">{done}</Alert>}

      <Card>
        <CardHeader
          title={t.admin.statusHeading}
          description={t.admin.currentStatusNote(props.statusLabel)}
        />
        <CardBody>
          {props.available.length === 0 ? (
            <Text variant="body-sm" tone="muted">
              {t.admin.finalStatus}
            </Text>
          ) : (
            <Stack gap={4}>
              <FormField label={t.admin.newStatus} required>
                {(field) => (
                  <SelectField
                    {...field}
                    value={target}
                    onValueChange={setTarget}
                    options={props.available.map((option) => ({
                      value: option.value,
                      label: option.label,
                    }))}
                  />
                )}
              </FormField>

              {target === 'CANCELLED' && (
                <FormField
                  label={t.admin.cancelReason}
                  required
                  description={t.admin.toldToCustomer}
                >
                  {(field) => (
                    <Textarea
                      {...field}
                      rows={2}
                      maxLength={500}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                    />
                  )}
                </FormField>
              )}

              {target === 'SHIPPED' && (
                <Inline gap={4} wrap>
                  <FormField label="Transporteur" required className="min-w-40 flex-1">
                    {(field) => (
                      <Input
                        {...field}
                        value={carrier}
                        maxLength={120}
                        onChange={(event) => setCarrier(event.target.value)}
                      />
                    )}
                  </FormField>
                  <FormField
                    label={t.admin.trackingNumber}
                    required
                    className="min-w-40 flex-1"
                  >
                    {(field) => (
                      <Input
                        {...field}
                        value={tracking}
                        maxLength={120}
                        onChange={(event) => setTracking(event.target.value)}
                      />
                    )}
                  </FormField>
                </Inline>
              )}

              {target === 'ON_HOLD' && (
                <FormField
                  label={t.admin.holdReason}
                  required
                  description={t.admin.internalNoteHint}
                >
                  {(field) => (
                    <Textarea
                      {...field}
                      rows={2}
                      maxLength={1000}
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                    />
                  )}
                </FormField>
              )}

              <div>
                <Button
                  variant="primary"
                  loading={pending}
                  onClick={() =>
                    needsConfirmation ? setConfirming(true) : submitTransition()
                  }
                >
                  Appliquer
                </Button>
              </div>
            </Stack>
          )}
        </CardBody>
      </Card>

      <Modal
        open={confirming}
        onOpenChange={setConfirming}
        title={t.admin.cancelOrderTitle}
        description={t.admin.cancelHint}
        footer={
          <Inline gap={3} justify="end" wrap>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Revenir
            </Button>
            <Button variant="danger" onClick={submitTransition} loading={pending}>
              {t.admin.cancelOrder}
            </Button>
          </Inline>
        }
      >
        <Text variant="body-sm" tone="muted">
          {t.admin.productionStarted}
        </Text>
      </Modal>

      <Card>
        <CardHeader title="Encaissement" description={t.admin.paymentHint} />
        <CardBody>
          <Stack gap={4}>
            <Text variant="body-sm" tone="muted">
              {t.admin.outstandingLabel}{' '}
              <strong>{formatAmount(props.outstandingBalance, props.currency)}</strong>
              {props.outstandingDeposit > 0 && (
                <>
                  {' '}
                  · acompte attendu :{' '}
                  <strong>
                    {formatAmount(props.outstandingDeposit, props.currency)}
                  </strong>
                </>
              )}
            </Text>

            <Inline gap={4} wrap>
              <FormField label="Type" required className="min-w-40 flex-1">
                {(field) => (
                  <SelectField
                    {...field}
                    value={kind}
                    onValueChange={setKind}
                    options={KINDS.map((option) => ({ ...option }))}
                  />
                )}
              </FormField>

              <FormField label="Moyen" required className="min-w-40 flex-1">
                {(field) => (
                  <SelectField
                    {...field}
                    value={method}
                    onValueChange={setMethod}
                    options={METHODS.map((option) => ({ ...option }))}
                  />
                )}
              </FormField>
            </Inline>

            <FormField
              label={t.admin.amountInCentimes}
              required
              description={t.admin.amountRefusedAbove}
            >
              {(field) => (
                <Input
                  {...field}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              )}
            </FormField>

            <FormField label={t.admin.reference} optional>
              {(field) => (
                <Input
                  {...field}
                  value={reference}
                  maxLength={120}
                  onChange={(event) => setReference(event.target.value)}
                />
              )}
            </FormField>

            <div>
              <Button
                variant="secondary"
                loading={pending}
                disabled={amount.trim() === ''}
                onClick={() =>
                  run(async () => {
                    const result = await recordPaymentAction({
                      orderNumber: props.orderNumber,
                      kind,
                      method,
                      amount: Number.parseInt(amount, 10),
                      reference: reference.trim() || null,
                    });

                    if (result.ok) setAmount('');
                    return result;
                  }, t.admin.paymentRecorded)
                }
              >
                {t.admin.savePayment}
              </Button>
            </div>
          </Stack>
        </CardBody>
      </Card>

      {props.pendingProof && (
        <Card>
          <CardHeader title={t.admin.proofToVerify} description={t.admin.proofHint} />
          <CardBody>
            <Stack gap={4}>
              {props.pendingProof.previewUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={props.pendingProof.previewUrl}
                  alt={`Justificatif : ${props.pendingProof.filename}`}
                  className="border-border max-h-64 w-auto rounded-sm border object-contain"
                />
              ) : (
                <Text variant="body-sm" tone="muted">
                  {props.pendingProof.filename} {t.admin.proofNoPreview}
                </Text>
              )}

              <Inline gap={3} wrap>
                <Button
                  variant="primary"
                  loading={pending}
                  onClick={() =>
                    run(
                      () =>
                        reviewProofAction({
                          proofId: props.pendingProof!.id,
                          accept: true,
                          rejectionReason: null,
                        }),
                      t.admin.proofAccepted,
                    )
                  }
                >
                  Accepter
                </Button>
                <Button variant="ghost" onClick={() => setRejecting(true)}>
                  Refuser
                </Button>
              </Inline>
            </Stack>
          </CardBody>
        </Card>
      )}

      <Modal
        open={rejecting}
        onOpenChange={setRejecting}
        title="Refuser ce justificatif"
        description={t.admin.reasonShownAsIs}
        footer={
          <Inline gap={3} justify="end" wrap>
            <Button variant="ghost" onClick={() => setRejecting(false)}>
              {t.admin.cancel}
            </Button>
            <Button
              variant="danger"
              loading={pending}
              disabled={rejectionReason.trim() === ''}
              onClick={() => {
                setRejecting(false);
                run(
                  () =>
                    reviewProofAction({
                      proofId: props.pendingProof!.id,
                      accept: false,
                      rejectionReason,
                    }),
                  t.admin.proofRejected,
                );
              }}
            >
              Refuser
            </Button>
          </Inline>
        }
      >
        <FormField label={t.admin.reason} required>
          {(field) => (
            <Textarea
              {...field}
              rows={2}
              maxLength={500}
              value={rejectionReason}
              onChange={(event) => setRejectionReason(event.target.value)}
            />
          )}
        </FormField>
      </Modal>

      <Card>
        <CardHeader title={t.admin.internalNote} description={t.admin.neverVisible} />
        <CardBody>
          <Stack gap={4}>
            <FormField label={t.admin.note} optional>
              {(field) => (
                <Textarea
                  {...field}
                  rows={4}
                  maxLength={4000}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              )}
            </FormField>

            <div>
              <Button
                variant="secondary"
                loading={pending}
                onClick={() =>
                  run(
                    () =>
                      saveInternalNotesAction({
                        orderNumber: props.orderNumber,
                        notes,
                      }),
                    t.admin.noteSaved,
                  )
                }
              >
                {t.admin.saveNote}
              </Button>
            </div>
          </Stack>
        </CardBody>
      </Card>
    </Stack>
  );
}

/**
 * Money, formatted for a sentence.
 *
 * The `Price` primitive renders a standalone amount; this is the inline case
 * inside running text. Both go through `Intl.NumberFormat` over integer minor
 * units — no arithmetic happens here.
 */
function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat('fr-DZ', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}
