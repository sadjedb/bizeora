'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Alert } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/field';
import { Inline, Stack } from '@/components/layout/layout';
import { Textarea } from '@/components/ui/input';
import { Text } from '@/components/ui/typography';
import { useDictionary } from '@/i18n/client';
import type { ReviewStatus } from '@/domain/review';

import { moderateReviewAction } from './actions';

/**
 * The two verdicts, and an optional public reply.
 *
 * The reply is sent with the verdict rather than as a second action, because a
 * reply without a decision is a half-moderated review and the customer sees
 * neither. It is **published on the product page**, so the placeholder says so
 * — there is no private note here; internal notes live on the order.
 *
 * `from` is the status this row was rendered with. Sending it is what makes the
 * update conditional server-side: if somebody else moderated the review while
 * this page was open, the action refuses instead of overwriting them.
 */
export function ModerationControls({
  reviewId,
  status,
}: {
  reviewId: string;
  status: ReviewStatus;
}) {
  const { t } = useDictionary();
  const router = useRouter();
  const [response, setResponse] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function decide(to: 'APPROVED' | 'REJECTED') {
    setError(null);

    startTransition(async () => {
      const result = await moderateReviewAction({
        reviewId,
        from: status,
        to,
        adminResponse: response.trim() === '' ? null : response,
      });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      setResponse('');
      router.refresh();
    });
  }

  return (
    <Stack gap={4}>
      {error && (
        <Alert tone="danger" title={t.admin.actionRefused}>
          {error}
        </Alert>
      )}

      <FormField
        label={t.admin.publicReply}
        optional
        description={t.admin.publicReplyHint}
      >
        {(props) => (
          <Textarea
            {...props}
            rows={3}
            value={response}
            onChange={(event) => setResponse(event.target.value)}
          />
        )}
      </FormField>

      <Inline gap={3}>
        {status !== 'APPROVED' && (
          <Button onClick={() => decide('APPROVED')} disabled={pending}>
            {pending ? 'Enregistrement…' : 'Publier'}
          </Button>
        )}

        {status !== 'REJECTED' && (
          <Button
            variant="secondary"
            onClick={() => decide('REJECTED')}
            disabled={pending}
          >
            {pending ? 'Enregistrement…' : 'Refuser'}
          </Button>
        )}
      </Inline>

      <Text variant="body-sm" tone="subtle">
        {t.admin.moderationHint}
      </Text>
    </Stack>
  );
}
