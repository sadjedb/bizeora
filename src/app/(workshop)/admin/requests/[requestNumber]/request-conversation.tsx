'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Alert } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { FormField } from '@/components/ui/field';
import { Inline, Stack } from '@/components/layout/layout';
import { SwitchField, Textarea } from '@/components/ui/input';
import { Text } from '@/components/ui/typography';
import { useDictionary } from '@/i18n/client';
import type { RequestStatus } from '@/domain/request';

import { postMessageAction, transitionRequestAction } from '../actions';

/**
 * The conversation, and the one thing that is not conversation.
 *
 * 6.7 is the distinction this component exists to make visible, because it is
 * the one an interface most easily destroys:
 *
 *   - **Message** is talking. It writes a `MESSAGE` event and **changes no
 *     status** — there is no status in its payload and no code path from the
 *     action to one. An internal note is the same thing with
 *     `isCustomerVisible: false`, filtered out of every customer query.
 *   - **Ask for information** is a workflow block. It moves the request to
 *     `NEEDS_INFO`, requires a reason that the customer is shown verbatim, and
 *     is refused without one.
 *
 * They are two separate forms with two separate buttons for exactly that
 * reason. One control with a "this is blocking" checkbox would make the
 * distinction an afterthought.
 */

export type RequestConversationProps = {
  requestNumber: string;
  status: RequestStatus;
  /** 6.7.4: only these three statuses may be blocked. */
  canRequestInformation: boolean;
  canReview: boolean;
};

export function RequestConversation({
  requestNumber,
  status,
  canRequestInformation,
  canReview,
}: RequestConversationProps) {
  const { t } = useDictionary();
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [internal, setInternal] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(work: () => Promise<{ ok: boolean; message?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await work();
      if (!result.ok) setError(result.message ?? 'Action impossible.');
      else router.refresh();
    });
  }

  return (
    <Stack gap={4}>
      {error && (
        <Alert tone="danger" title="Action impossible">
          {error}
        </Alert>
      )}

      <Card>
        <CardHeader title="Message" description={t.admin.conversationHint} />
        <CardBody>
          <Stack gap={4}>
            <FormField label={t.admin.yourMessage} required>
              {(props) => (
                <Textarea
                  {...props}
                  rows={3}
                  maxLength={2000}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                />
              )}
            </FormField>

            <SwitchField
              label={t.admin.internalNote}
              description={t.admin.workshopOnly}
              checked={internal}
              onCheckedChange={setInternal}
            />

            <div>
              <Button
                variant="secondary"
                loading={pending}
                disabled={message.trim() === ''}
                onClick={() =>
                  run(async () => {
                    const result = await postMessageAction({
                      requestNumber,
                      message,
                      internal,
                    });
                    if (result.ok) setMessage('');
                    return result;
                  })
                }
              >
                Envoyer le message
              </Button>
            </div>
          </Stack>
        </CardBody>
      </Card>

      {canRequestInformation && (
        <Card>
          <CardHeader
            title="Demander une information"
            description={t.admin.blocksRequestHint}
          />
          <CardBody>
            <Stack gap={4}>
              <FormField
                label="De quoi avez-vous besoin ?"
                required
                description={t.admin.readAsIs}
              >
                {(props) => (
                  <Textarea
                    {...props}
                    rows={2}
                    maxLength={500}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                )}
              </FormField>

              <div>
                <Button
                  variant="secondary"
                  loading={pending}
                  disabled={reason.trim() === ''}
                  onClick={() =>
                    run(() =>
                      transitionRequestAction({
                        requestNumber,
                        to: 'NEEDS_INFO',
                        needsInfoReason: reason,
                      }),
                    )
                  }
                >
                  Demander cette information
                </Button>
              </div>
            </Stack>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title={t.admin.requestStatusHeading} />
        <CardBody>
          <Stack gap={3}>
            <Text variant="body-sm" tone="muted">
              Statut actuel : {status}
            </Text>

            <Inline gap={3} wrap>
              {canReview && (
                <Button
                  variant="secondary"
                  loading={pending}
                  onClick={() =>
                    run(() => transitionRequestAction({ requestNumber, to: 'IN_REVIEW' }))
                  }
                >
                  {t.admin.takeIntoReview}
                </Button>
              )}

              <Button
                variant="ghost"
                loading={pending}
                onClick={() =>
                  run(() => transitionRequestAction({ requestNumber, to: 'REJECTED' }))
                }
              >
                Refuser la demande
              </Button>
            </Inline>
          </Stack>
        </CardBody>
      </Card>
    </Stack>
  );
}
