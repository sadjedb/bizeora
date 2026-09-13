import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { Alert, Divider } from '@/components/ui/feedback';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Grid, Inline, Stack } from '@/components/layout/layout';
import { Heading, Overline, Text } from '@/components/ui/typography';
import { Link } from '@/components/ui/link';
import { OrderStatusBadge } from '@/components/commerce/status';
import type { OrderStatus as BadgeStatus } from '@/components/commerce/status';
import { Price } from '@/components/commerce/price';
import { ORDER_STATUS_LABELS } from '@/domain/order/state-machine';
import {
  PAYMENT_KIND_LABELS,
  PAYMENT_STATUS_LABELS,
  suggestPaymentKind,
} from '@/domain/order/payment';
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from '@/domain/order/payment-method';
import { workshopDictionary } from '@/i18n/server';
import { requireStaff } from '@/server/auth/guards';
import { getOrderWorkspace } from '@/server/services/order-admin-service';
import { getPaymentProofAccess } from '@/server/services/design-file-service';

import { OrderControls } from './order-controls';

export const metadata: Metadata = { title: 'Commande' };

export const dynamic = 'force-dynamic';

const DATE = new Intl.DateTimeFormat('fr-DZ', { dateStyle: 'long' });
const DATE_TIME = new Intl.DateTimeFormat('fr-DZ', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/**
 * The order workspace (`UX.md` section 9, "fulfil an order").
 *
 * Left: what was bought, rendered from the order's **snapshots** — nothing on
 * this page is re-read from the catalogue, so an order shows what it was, not
 * what the shop sells today. Then the address, the payments, and the full
 * status history including entries the customer never sees.
 *
 * Right: the moves. Which ones are offered was decided by
 * `domain/order/state-machine` on the server; this page renders the list it was
 * handed and the controls each move requires (8.7).
 *
 * A proof of payment is reached through the Phase 9 boundary — a five-minute
 * signed URL, audit-logged — and never as a storage key.
 */
export default async function AdminOrderPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}) {
  const { t } = await workshopDictionary();
  const { orderNumber } = await params;
  const authorisation = await requireStaff();
  if (!authorisation.ok) notFound();

  const workspace = await getOrderWorkspace(orderNumber);
  if (!workspace) notFound();

  const { order, available } = workspace;

  const pending = order.proofs.find((proof) => proof.status === 'SUBMITTED') ?? null;

  const proofAccess = pending
    ? await getPaymentProofAccess({
        proofId: pending.id,
        actorUserId: authorisation.actor.userId,
        asStaff: true,
      })
    : null;

  return (
    <Stack gap={8}>
      <Stack gap={3}>
        <Text variant="body-sm" tone="muted">
          <Link href="/admin/orders">Commandes</Link>
        </Text>

        <Inline gap={3} wrap className="items-center justify-between">
          <Heading level={1} variant="display-md" className="break-all">
            {order.orderNumber}
          </Heading>
          <OrderStatusBadge status={order.status as BadgeStatus} />
        </Inline>

        <Text variant="body-sm" tone="muted">
          {order.contactName} · {order.contactEmail} · {order.contactPhone} ·{' '}
          {t.admin.placedOn} {DATE.format(order.placedAt)}
        </Text>

        <Inline gap={3} wrap>
          {order.quoteNumber && (
            <Text variant="body-sm" tone="muted">
              Devis {order.quoteNumber}
            </Text>
          )}
          {order.requestNumber && (
            <Text variant="body-sm" tone="muted">
              <Link href={`/admin/requests/${order.requestNumber}`}>
                Demande {order.requestNumber}
              </Link>
            </Text>
          )}
          {order.userId ? (
            <Text variant="body-sm" tone="muted">
              <Link href={`/admin/customers/${order.userId}`}>Fiche client</Link>
            </Text>
          ) : (
            <Text variant="body-sm" tone="muted">
              {t.admin.guestOrder}
            </Text>
          )}
        </Inline>
      </Stack>

      {order.status === 'AWAITING_PAYMENT' && (
        <Alert tone="warning" title={t.admin.awaitingDeposit}>
          {t.admin.depositBlocksNote}
        </Alert>
      )}

      <Grid preset="halves" gap={8}>
        <Stack gap={6}>
          <Card>
            <CardHeader title="Articles" description={t.admin.itemsAsOrdered} />
            <CardBody>
              <Stack gap={5}>
                <ul className="flex list-none flex-col gap-4 p-0">
                  {order.items.map((item, index) => (
                    <li key={`${item.name}-${index}`}>
                      <Inline gap={4} className="items-start justify-between">
                        <Stack gap={1}>
                          <Text variant="body">{item.name}</Text>
                          {item.variantLabel && (
                            <Text variant="body-sm" tone="muted">
                              {item.variantLabel}
                            </Text>
                          )}
                          {item.sku && (
                            <Text variant="caption" tone="subtle">
                              {t.admin.itemRef(item.sku)}
                            </Text>
                          )}
                          <Text variant="body-sm" tone="muted">
                            {item.quantity} × <Price amount={item.unitPrice} size="sm" />
                            {item.requiresProduction ? t.admin.toProduce : ''}
                          </Text>
                        </Stack>
                        <Price
                          amount={item.lineTotal}
                          currency={order.currency}
                          size="sm"
                        />
                      </Inline>
                    </li>
                  ))}
                </ul>

                <Divider />

                <Stack gap={2}>
                  <Inline gap={4} className="items-baseline justify-between">
                    <Text variant="body-sm" tone="muted">
                      Sous-total
                    </Text>
                    <Price amount={order.subtotal} currency={order.currency} size="sm" />
                  </Inline>

                  {order.discountTotal > 0 && (
                    <Inline gap={4} className="items-baseline justify-between">
                      <Text variant="body-sm" tone="muted">
                        Remise
                      </Text>
                      <Text variant="body-sm" as="span">
                        −{' '}
                        <Price
                          amount={order.discountTotal}
                          currency={order.currency}
                          size="sm"
                        />
                      </Text>
                    </Inline>
                  )}

                  <Inline gap={4} className="items-baseline justify-between">
                    <Text variant="body-sm" tone="muted">
                      {order.shippingRateLabel ?? 'Livraison'}
                    </Text>
                    <Price
                      amount={order.shippingTotal}
                      currency={order.currency}
                      size="sm"
                    />
                  </Inline>

                  <Divider />

                  <Inline gap={4} className="items-baseline justify-between">
                    <Text variant="heading-sm" as="span">
                      Total
                    </Text>
                    <Price amount={order.grandTotal} currency={order.currency} />
                  </Inline>
                </Stack>
              </Stack>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Livraison" />
            <CardBody>
              {order.address ? (
                <Stack gap={3}>
                  <Overline as="p">Adresse</Overline>
                  <Text variant="body">{order.address.fullName}</Text>
                  <Text variant="body-sm" tone="muted">
                    {order.address.addressLine}
                    <br />
                    {order.address.communeName}, {order.address.wilayaNameSnapshot}
                    <br />
                    {order.address.phone}
                  </Text>

                  <Text variant="body-sm" tone="muted">
                    {order.deliveryType === 'HOME' ? 'À domicile' : 'Bureau de livraison'}
                    {' · '}
                    {order.shippingRateLabel ?? 'Livraison'}
                  </Text>

                  {order.trackingNumber && (
                    <Text variant="body-sm">
                      Suivi : {order.carrierName ? `${order.carrierName} · ` : ''}
                      {order.trackingNumber}
                    </Text>
                  )}

                  {order.address.notes && (
                    <Text variant="body-sm" tone="muted">
                      Note du client : {order.address.notes}
                    </Text>
                  )}
                </Stack>
              ) : (
                <Text variant="body-sm" tone="muted">
                  {t.admin.noAddress}
                </Text>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Paiements" />
            <CardBody>
              <Stack gap={4}>
                <Inline gap={4} className="items-baseline justify-between">
                  <Text variant="body-sm" tone="muted">
                    État
                  </Text>
                  <Text variant="body-sm" as="span">
                    {PAYMENT_STATUS_LABELS[
                      order.paymentStatus as keyof typeof PAYMENT_STATUS_LABELS
                    ] ?? order.paymentStatus}
                    {' · '}
                    {PAYMENT_METHOD_LABELS[order.paymentMethod as PaymentMethod] ??
                      order.paymentMethod}
                  </Text>
                </Inline>

                {order.depositRequired > 0 && (
                  <Inline gap={4} className="items-baseline justify-between">
                    <Text variant="body-sm" tone="muted">
                      {t.admin.depositAsked}
                    </Text>
                    <Price
                      amount={order.depositRequired}
                      currency={order.currency}
                      size="sm"
                    />
                  </Inline>
                )}

                <Inline gap={4} className="items-baseline justify-between">
                  <Text variant="body-sm" tone="muted">
                    {t.admin.colCollected}
                  </Text>
                  <Price amount={order.amountPaid} currency={order.currency} size="sm" />
                </Inline>

                {order.payments.length > 0 && (
                  <Stack gap={2} as="ul">
                    {order.payments.map((payment) => (
                      <li key={payment.id}>
                        <Inline gap={4} className="items-baseline justify-between">
                          <Text variant="caption" tone="subtle" as="span">
                            {DATE_TIME.format(payment.createdAt)} ·{' '}
                            {PAYMENT_KIND_LABELS[
                              payment.kind as keyof typeof PAYMENT_KIND_LABELS
                            ] ?? payment.kind}
                            {payment.recordedByName ? ` · ${payment.recordedByName}` : ''}
                          </Text>
                          <Price
                            amount={payment.amount}
                            currency={order.currency}
                            size="sm"
                          />
                        </Inline>
                      </li>
                    ))}
                  </Stack>
                )}

                {order.proofs.length > 0 && (
                  <Stack gap={1}>
                    <Text variant="caption" tone="subtle">
                      Justificatifs
                    </Text>
                    {order.proofs.map((proof) => (
                      <Text key={proof.id} variant="caption" tone="muted" as="span">
                        {DATE_TIME.format(proof.createdAt)} · {proof.status}
                        {proof.rejectionReason ? ` — ${proof.rejectionReason}` : ''}
                      </Text>
                    ))}
                  </Stack>
                )}
              </Stack>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Historique" description={t.admin.historyInternal} />
            <CardBody>
              <Stack gap={3} as="ol">
                {order.fullTimeline.map((entry, index) => (
                  <li key={`${entry.toStatus}-${index}`}>
                    <Stack gap={1}>
                      <Text variant="caption" tone="subtle" as="span">
                        {DATE_TIME.format(entry.createdAt)} · {entry.actorType}
                        {entry.actorName ? ` (${entry.actorName})` : ''}
                        {entry.isCustomerVisible ? '' : ' · interne'}
                      </Text>
                      <Text variant="body-sm" as="span">
                        {ORDER_STATUS_LABELS[entry.toStatus]}
                        {entry.note ? ` — ${entry.note}` : ''}
                      </Text>
                    </Stack>
                  </li>
                ))}
              </Stack>
            </CardBody>
          </Card>
        </Stack>

        <OrderControls
          orderNumber={order.orderNumber}
          status={order.status}
          statusLabel={ORDER_STATUS_LABELS[order.status]}
          available={available.map((target) => ({
            value: target,
            label: ORDER_STATUS_LABELS[target],
          }))}
          currency={order.currency}
          grandTotal={order.grandTotal}
          outstandingBalance={workspace.outstandingBalance}
          outstandingDeposit={workspace.outstandingDeposit}
          amountPaid={order.amountPaid}
          suggestedKind={suggestPaymentKind({
            grandTotal: order.grandTotal,
            depositRequired: order.depositRequired,
            amountPaid: order.amountPaid,
            amount: workspace.outstandingDeposit || workspace.outstandingBalance,
          })}
          paymentMethod={order.paymentMethod}
          internalNotes={order.internalNotes ?? ''}
          pendingProof={
            pending
              ? {
                  id: pending.id,
                  filename: proofAccess?.ok ? proofAccess.value.filename : 'justificatif',
                  previewUrl: proofAccess?.ok ? proofAccess.value.previewUrl : null,
                }
              : null
          }
        />
      </Grid>
    </Stack>
  );
}
