'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Alert } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/field';
import { Stack } from '@/components/layout/layout';
import { Text } from '@/components/ui/typography';
import { Textarea } from '@/components/ui/input';
import { useDictionary } from '@/i18n/client';

import { replyToRequestAction } from '../actions';

/**
 * The customer's side of the thread.
 *
 * It sends a request number and a message. There is no status control here and
 * no hidden field carrying one, because 6.7.2 gives a message no status effect
 * and 6.7.3 gives clearing a block to the admin. The copy says so rather than
 * leaving the customer to wonder why answering did not visibly unblock
 * anything.
 */
export function ReplyForm({
  requestNumber,
  blocked,
}: {
  requestNumber: string;
  blocked: boolean;
}) {
  const { t } = useDictionary();
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSent(false);

    startTransition(async () => {
      const result = await replyToRequestAction({ requestNumber, message });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      setMessage('');
      setSent(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} noValidate>
      <Stack gap={4}>
        {error && (
          <Alert tone="danger" title={t.request.replyFailed}>
            {error}
          </Alert>
        )}

        {sent && <Alert tone="success">{t.request.replySent}</Alert>}

        <FormField
          label={blocked ? t.request.replyLabelBlocked : t.request.replyLabel}
          required
          description={blocked ? t.request.replyHintBlocked : t.request.replyHint}
        >
          {(props) => (
            <Textarea
              {...props}
              rows={4}
              maxLength={2000}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
          )}
        </FormField>

        <div>
          <Button
            type="submit"
            variant="primary"
            loading={pending}
            disabled={message.trim() === ''}
          >
            {t.request.replySend}
          </Button>
        </div>

        <Text variant="caption" tone="subtle">
          {t.request.replyFootnote}
        </Text>
      </Stack>
    </form>
  );
}
