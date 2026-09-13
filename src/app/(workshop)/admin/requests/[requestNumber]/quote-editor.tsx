'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { Alert } from '@/components/ui/feedback';
import { Button, IconButton } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { FormField } from '@/components/ui/field';
import { Inline, Stack } from '@/components/layout/layout';
import { Input, SelectField, Textarea } from '@/components/ui/input';
import { Text } from '@/components/ui/typography';
import { useDictionary } from '@/i18n/client';
import {
  QUOTE_LINE_KINDS,
  QUOTE_LINE_KIND_LABELS,
  type QuoteLineKind,
} from '@/domain/quote/pricing';

import {
  createQuoteDraftAction,
  sendQuoteAction,
  updateQuoteDraftAction,
} from '../actions';

/**
 * The quote editor.
 *
 * 2.6.1: "the system supplies a **suggested** set of lines derived from the
 * configuration; the admin may change every value". So this is a line editor
 * and nothing more.
 *
 * **It computes no totals.** There is no subtotal, no discount and no grand
 * total in this file, because section 16 requires that arithmetic to exist once
 * and it exists in `domain/quote/pricing`. The admin saves the draft, the
 * server prices it, and the page re-renders with the server's numbers beside
 * the customer preview. A total shown here before saving would be a second
 * implementation of the pipeline that agrees right up until it does not.
 */

export type EditorLine = {
  kind: QuoteLineKind;
  label: string;
  description: string | null;
  quantity: number;
  unitPrice: number;
  requestItemId: string | null;
};

export type QuoteEditorProps = {
  requestNumber: string;
  /** Present when a `DRAFT` exists; absent when the next save creates one. */
  draftQuoteId: string | null;
  initialLines: readonly EditorLine[];
  initialCustomerMessage: string;
  initialInternalNotes: string;
  /** False when the outstanding quote is sent: a sent quote is immutable (7.2). */
  editable: boolean;
};

const EMPTY_LINE: EditorLine = {
  kind: 'PRODUCT',
  label: '',
  description: null,
  quantity: 1,
  unitPrice: 0,
  requestItemId: null,
};

export function QuoteEditor({
  requestNumber,
  draftQuoteId,
  initialLines,
  initialCustomerMessage,
  initialInternalNotes,
  editable,
}: QuoteEditorProps) {
  const { t } = useDictionary();
  const router = useRouter();
  const [lines, setLines] = useState<EditorLine[]>([...initialLines]);
  const [customerMessage, setCustomerMessage] = useState(initialCustomerMessage);
  const [internalNotes, setInternalNotes] = useState(initialInternalNotes);
  /*
   * The refusal, and which button produced it.
   *
   * Both buttons wrote into one banner headed "Enregistrement impossible",
   * which meant a *send* that was refused reported itself as a failed save —
   * and the reason it gave was about the draft, which had saved perfectly well.
   */
  const [message, setMessage] = useState<{ title: string; body: string } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function patch(index: number, change: Partial<EditorLine>) {
    setLines((current) =>
      current.map((line, position) =>
        position === index ? { ...line, ...change } : line,
      ),
    );
  }

  function payload() {
    return {
      lines: lines.map((line) => ({
        kind: line.kind,
        label: line.label.trim(),
        description: line.description?.trim() || null,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        requestItemId: line.requestItemId,
      })),
      customerMessage: customerMessage.trim() || null,
      internalNotes: internalNotes.trim() || null,
    };
  }

  function save() {
    setMessage(null);
    setSaved(null);

    startTransition(async () => {
      const result = draftQuoteId
        ? await updateQuoteDraftAction(requestNumber, draftQuoteId, payload())
        : await createQuoteDraftAction(requestNumber, payload());

      if (!result.ok) {
        setMessage({ title: 'Enregistrement impossible', body: result.message });
        return;
      }

      setSaved(t.admin.draftSaved);
      router.refresh();
    });
  }

  function send() {
    if (!draftQuoteId) return;
    setMessage(null);

    startTransition(async () => {
      const result = await sendQuoteAction(requestNumber, draftQuoteId);

      if (!result.ok) {
        setMessage({ title: 'Envoi impossible', body: result.message });
        return;
      }

      router.refresh();
    });
  }

  if (!editable) {
    return (
      <Alert tone="info" title={t.admin.quoteSent}>
        Un devis envoyé ne peut plus être modifié (7.2). Pour changer un prix, créez une
        nouvelle version : elle remplacera la précédente.
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader title="Lignes du devis" description={t.admin.quoteEditorHint} />
      <CardBody>
        <Stack gap={5}>
          {message && (
            <Alert tone="danger" title={message.title}>
              {message.body}
            </Alert>
          )}
          {saved && <Alert tone="success">{saved}</Alert>}

          <Stack gap={4} as="ul">
            {lines.map((line, index) => (
              <li key={index} className="border-border rounded-md border p-4">
                <Stack gap={3}>
                  <Inline gap={3} className="items-start justify-between">
                    <Text variant="caption" tone="subtle" as="span">
                      Ligne {index + 1}
                    </Text>
                    <IconButton
                      label={`Supprimer la ligne ${index + 1}`}
                      variant="ghost"
                      onClick={() =>
                        setLines((current) =>
                          current.filter((_, position) => position !== index),
                        )
                      }
                    >
                      <Trash2 aria-hidden="true" />
                    </IconButton>
                  </Inline>

                  <FormField label="Type" required>
                    {(props) => (
                      <SelectField
                        {...props}
                        value={line.kind}
                        onValueChange={(value) =>
                          patch(index, { kind: value as QuoteLineKind })
                        }
                        options={QUOTE_LINE_KINDS.map((kind) => ({
                          value: kind,
                          label: QUOTE_LINE_KIND_LABELS[kind],
                        }))}
                      />
                    )}
                  </FormField>

                  <FormField label={t.admin.lineLabel} required>
                    {(props) => (
                      <Input
                        {...props}
                        value={line.label}
                        maxLength={200}
                        onChange={(event) => patch(index, { label: event.target.value })}
                      />
                    )}
                  </FormField>

                  <FormField label={t.admin.lineDetail} optional>
                    {(props) => (
                      <Input
                        {...props}
                        value={line.description ?? ''}
                        maxLength={500}
                        onChange={(event) =>
                          patch(index, { description: event.target.value })
                        }
                      />
                    )}
                  </FormField>

                  <Inline gap={4} wrap>
                    <FormField
                      label={t.admin.quantity}
                      required
                      className="min-w-32 flex-1"
                    >
                      {(props) => (
                        <Input
                          {...props}
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={9999}
                          value={line.quantity}
                          onChange={(event) =>
                            patch(index, {
                              quantity: Number.parseInt(event.target.value, 10) || 0,
                            })
                          }
                        />
                      )}
                    </FormField>

                    <FormField
                      label="Prix unitaire (DA)"
                      required
                      className="min-w-40 flex-1"
                      description={
                        line.kind === 'DISCOUNT' ? t.admin.negativeForDiscount : undefined
                      }
                    >
                      {(props) => (
                        <Input
                          {...props}
                          type="number"
                          inputMode="numeric"
                          value={line.unitPrice}
                          onChange={(event) =>
                            patch(index, {
                              unitPrice: Number.parseInt(event.target.value, 10) || 0,
                            })
                          }
                        />
                      )}
                    </FormField>
                  </Inline>
                </Stack>
              </li>
            ))}
          </Stack>

          <div>
            <Button
              variant="secondary"
              onClick={() => setLines((current) => [...current, { ...EMPTY_LINE }])}
              leadingIcon={<Plus aria-hidden="true" />}
            >
              Ajouter une ligne
            </Button>
          </div>

          <FormField label="Message au client" optional>
            {(props) => (
              <Textarea
                {...props}
                rows={3}
                maxLength={2000}
                value={customerMessage}
                onChange={(event) => setCustomerMessage(event.target.value)}
              />
            )}
          </FormField>

          <FormField
            label={t.admin.internalNote}
            optional
            description="Jamais visible par le client."
          >
            {(props) => (
              <Textarea
                {...props}
                rows={2}
                maxLength={2000}
                value={internalNotes}
                onChange={(event) => setInternalNotes(event.target.value)}
              />
            )}
          </FormField>

          <Inline gap={3} wrap>
            <Button variant="secondary" onClick={save} loading={pending}>
              Enregistrer le brouillon
            </Button>
            <Button
              variant="primary"
              onClick={send}
              disabled={!draftQuoteId || pending}
              loading={pending && Boolean(draftQuoteId)}
            >
              Envoyer au client
            </Button>
          </Inline>

          {!draftQuoteId && (
            <Text variant="caption" tone="subtle">
              {t.admin.saveDraftFirst}
            </Text>
          )}
        </Stack>
      </CardBody>
    </Card>
  );
}
