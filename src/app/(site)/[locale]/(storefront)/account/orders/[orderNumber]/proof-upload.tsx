'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';

import { Alert } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { Stack } from '@/components/layout/layout';
import { Text } from '@/components/ui/typography';
import { useDictionary } from '@/i18n/client';

import {
  finaliseUploadAction,
  requestUploadAction,
} from '../../../custom/upload-actions';
import { submitPaymentProofAction } from './proof-actions';

/**
 * Sending a transfer receipt.
 *
 * The same three-step Phase 9 pipeline the builder uses — authorise, PUT
 * straight to storage, ask the server to verify the stored bytes — with one
 * step added at the end: attaching the verified file to the order. Nothing here
 * is a second upload mechanism, and the file is not usable until the **server**
 * has read it and said so.
 *
 * The button says what happens next, because 8.10.4 makes that a person's
 * decision rather than an automatic one: sending proof does not mark the order
 * paid.
 */
export function ProofUpload({ orderNumber }: { orderNumber: string }) {
  const { t } = useDictionary();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);

    startTransition(async () => {
      const authorised = await requestUploadAction({
        filename: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });

      if (!authorised.ok) {
        setError(authorised.message);
        return;
      }

      const response = await fetch(authorised.value.uploadUrl, {
        method: authorised.value.method,
        headers: authorised.value.headers,
        body: file,
      });

      if (!response.ok) {
        setError(t.order.proofFailedBody);
        return;
      }

      // The browser reporting success is a prompt to look, not a fact: the
      // server reads the object back and decides whether it is usable.
      const finalised = await finaliseUploadAction({
        designFileId: authorised.value.designFileId,
      });

      if (!finalised.ok) {
        setError(finalised.message);
        return;
      }

      const submitted = await submitPaymentProofAction({
        orderNumber,
        designFileId: authorised.value.designFileId,
      });

      if (!submitted.ok) {
        setError(submitted.message);
        return;
      }

      if (input.current) input.current.value = '';
      router.refresh();
    });
  }

  return (
    <Stack gap={3}>
      {error && (
        <Alert tone="danger" title={t.order.proofFailedTitle}>
          {error}
        </Alert>
      )}

      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,application/pdf"
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        onChange={onChange}
      />

      <div>
        <Button
          type="button"
          variant="primary"
          loading={pending}
          onClick={() => input.current?.click()}
        >
          {t.order.proofSend}
        </Button>
      </div>

      <Text variant="caption" tone="subtle">
        {t.order.proofHint}
      </Text>
    </Stack>
  );
}
