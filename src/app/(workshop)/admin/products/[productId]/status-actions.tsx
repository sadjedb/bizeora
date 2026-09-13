'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Alert } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/overlay';
import { Stack } from '@/components/layout/layout';
import { Text } from '@/components/ui/typography';
import { useDictionary } from '@/i18n/client';
import { PRODUCT_STATUS_HINTS, type ProductStatus } from '@/domain/catalogue';

import { changeProductStatusAction } from '../actions';

/**
 * Publish, unpublish, archive.
 *
 * Separate from the product form on purpose. Changing what a page says and
 * changing whether the world can see it are different decisions made at
 * different moments, and putting "Archiver" in a form whose primary button is
 * "Enregistrer" is how somebody archives a product they meant to save.
 *
 * Archiving is confirmed, because it is the one action here that removes a
 * product from the shop, and because the dialog is where the consequence can be
 * stated: past orders keep their own snapshot, and the URL starts returning a
 * 404 rather than redirecting anywhere.
 */
export function ProductStatusActions({
  productId,
  status,
}: {
  productId: string;
  status: ProductStatus;
}) {
  const { t } = useDictionary();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function change(next: ProductStatus) {
    setError(null);

    startTransition(async () => {
      const result = await changeProductStatusAction({ productId, status: next });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      setConfirming(false);
      router.refresh();
    });
  }

  return (
    <>
      {error && (
        <Alert tone="danger" title={t.admin.actionRefused}>
          {error}
        </Alert>
      )}

      {status !== 'ACTIVE' && (
        <Button size="sm" loading={pending} onClick={() => change('ACTIVE')}>
          Mettre en ligne
        </Button>
      )}

      {status === 'ACTIVE' && (
        <Button
          variant="secondary"
          size="sm"
          loading={pending}
          onClick={() => change('DRAFT')}
        >
          Repasser en brouillon
        </Button>
      )}

      {status !== 'ARCHIVED' && (
        <Modal
          open={confirming}
          onOpenChange={setConfirming}
          size="confirm"
          title="Archiver ce produit ?"
          description={t.admin.archiveHint}
          trigger={
            <Button variant="danger" size="sm">
              Archiver
            </Button>
          }
        >
          <Stack gap={4}>
            <Text variant="body-sm" tone="muted">
              {t.admin.archiveSnapshotNote}
            </Text>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                Annuler
              </Button>
              <Button
                variant="dangerSolid"
                size="sm"
                loading={pending}
                onClick={() => change('ARCHIVED')}
              >
                Archiver
              </Button>
            </div>
          </Stack>
        </Modal>
      )}

      {status === 'ARCHIVED' && (
        <Text variant="caption" tone="subtle" as="span">
          {PRODUCT_STATUS_HINTS.ARCHIVED}
        </Text>
      )}
    </>
  );
}
