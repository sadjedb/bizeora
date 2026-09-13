'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Alert } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/field';
import { Inline, Stack } from '@/components/layout/layout';
import { Modal } from '@/components/ui/overlay';
import { Textarea } from '@/components/ui/input';
import { useDictionary } from '@/i18n/client';

import { acceptQuoteAction, declineQuoteAction } from '../actions';

/**
 * Accept or decline.
 *
 * Neither button sends a number. They send the quote number, and the server
 * re-reads everything else — which is why there is no way for this component to
 * be wrong about the price, only about what it displays.
 *
 * Declining is behind a confirmation with an optional reason (7.8), because it
 * is not reversible: a rejected quote is answered, and a new price means a new
 * version.
 */
export function QuoteResponse({ quoteNumber }: { quoteNumber: string }) {
  const { t } = useDictionary();
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();

  function accept() {
    setMessage(null);
    startTransition(async () => {
      const result = await acceptQuoteAction({ quoteNumber });

      if (!result.ok) {
        setMessage(result.message);
        return;
      }

      // Acceptance produces the quote-bound checkout, and that is where the
      // customer wanted to go. 7.6 created it in the same transaction.
      router.push(`/checkout/quote/${result.cartId}`);
    });
  }

  function decline() {
    setMessage(null);
    startTransition(async () => {
      const result = await declineQuoteAction({
        quoteNumber,
        reason: reason.trim() === '' ? null : reason.trim(),
      });

      setDeclining(false);
      if (!result.ok) setMessage(result.message);
      else router.refresh();
    });
  }

  return (
    <Stack gap={4}>
      {message && (
        <Alert tone="danger" title={t.quote.impossible}>
          {message}
        </Alert>
      )}

      <Inline gap={3} wrap>
        <Button variant="primary" onClick={accept} loading={pending}>
          {t.quote.accept}
        </Button>
        <Button variant="ghost" onClick={() => setDeclining(true)} disabled={pending}>
          {t.quote.decline}
        </Button>
      </Inline>

      <Modal
        open={declining}
        onOpenChange={setDeclining}
        title={t.quote.declineTitle}
        description={t.quote.declineBody}
        footer={
          <Inline gap={3} justify="end" wrap>
            <Button variant="ghost" onClick={() => setDeclining(false)}>
              {t.common.cancel}
            </Button>
            <Button variant="danger" onClick={decline} loading={pending}>
              {t.quote.declineConfirm}
            </Button>
          </Inline>
        }
      >
        <FormField label={t.quote.declineReason} optional>
          {(props) => (
            <Textarea
              {...props}
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </FormField>
      </Modal>
    </Stack>
  );
}
