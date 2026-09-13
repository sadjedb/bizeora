import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { Alert } from '@/components/ui/feedback';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { CustomizationSummary } from '@/components/commerce/customization-summary';
import { Grid, Inline, Stack } from '@/components/layout/layout';
import { Heading, Text } from '@/components/ui/typography';
import { Link } from '@/components/ui/link';
import { QuoteLines } from '@/components/commerce/quote-lines';
import { QuoteStatusBadge, RequestStatusBadge } from '@/components/commerce/status';
import type {
  QuoteStatus as BadgeQuoteStatus,
  RequestStatus as BadgeRequestStatus,
} from '@/components/commerce/status';
import { canRequestInformation, canTransitionRequest } from '@/domain/request';
import { QUOTE_LINE_KIND_LABELS, type QuoteLineKind } from '@/domain/quote/pricing';
import { formatDateTime } from '@/i18n/format';
import { workshopDictionary } from '@/i18n/server';
import { requireStaff } from '@/server/auth/guards';
import {
  findRequestForStaff,
  listRequestEvents,
} from '@/server/repositories/request-repository';
import { getRequestFileAccess } from '@/server/services/design-file-service';
import {
  listQuoteVersions,
  suggestQuoteLines,
  summariseConfigurations,
} from '@/server/services/quote-service';

import { QuoteEditor, type EditorLine } from './quote-editor';
import { RequestConversation } from './request-conversation';

export const metadata: Metadata = { title: 'Demande' };

export const dynamic = 'force-dynamic';

/**
 * The request workspace (`UX.md` section 6, admin side).
 *
 * Left: who asked, what they configured, their artwork, and the whole event
 * timeline **including internal notes** — this is the one place they are read,
 * and the query that fetches them is the staff query.
 *
 * Right: the quote. A draft is editable; a sent quote is not, and the editor
 * says so rather than showing disabled fields (7.2). Every previous version
 * stays listed and readable forever, which is what makes a version history
 * worth having.
 *
 * The artwork is reached through Phase 9: a signed URL, five minutes, and an
 * audit-log row per access (12.5). No storage key is rendered.
 */
export default async function RequestWorkspacePage({
  params,
}: {
  params: Promise<{ requestNumber: string }>;
}) {
  const { locale, t } = await workshopDictionary();
  const { requestNumber } = await params;
  const authorisation = await requireStaff();

  // The layout has already redirected an unauthorised visitor; this is the
  // belt-and-braces check that keeps the page honest if it is ever rendered
  // outside that layout.
  if (!authorisation.ok) notFound();

  const request = await findRequestForStaff(requestNumber);
  if (!request) notFound();

  const [events, quotes, suggestion] = await Promise.all([
    listRequestEvents({ requestId: request.id, customerVisibleOnly: false }),
    listQuoteVersions(request.id),
    suggestQuoteLines(requestNumber),
  ]);

  const configurations = summariseConfigurations(request);

  const artwork = await Promise.all(
    configurations.map(async (configuration) =>
      Promise.all(
        configuration.files.map(async (file) => {
          const access = await getRequestFileAccess({
            designFileId: file.designFileId,
            requestId: request.id,
            actorUserId: authorisation.actor.userId,
            asStaff: true,
          });

          return {
            designFileId: file.designFileId,
            filename: file.filename,
            role: file.role,
            previewUrl: access.ok ? access.value.previewUrl : null,
            downloadUrl: access.ok ? access.value.downloadUrl : null,
          };
        }),
      ),
    ),
  );

  const draft = quotes.find((quote) => quote.status === 'DRAFT') ?? null;
  const outstanding =
    quotes.find((quote) => quote.status === 'SENT' || quote.status === 'VIEWED') ?? null;

  // A draft may always be edited. With a sent quote outstanding and no draft,
  // the next save creates version N+1, which supersedes it on send (7.2).
  const editorLines: readonly EditorLine[] = draft
    ? draft.items.map((item) => ({
        kind: item.kind as QuoteLineKind,
        label: item.label,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        requestItemId: item.requestItemId,
      }))
    : suggestion.ok
      ? suggestion.value.map((line) => ({ ...line }))
      : [];

  return (
    <Stack gap={8}>
      <Stack gap={3}>
        <Text variant="body-sm" tone="muted">
          <Link href="/admin/requests">Demandes</Link>
        </Text>

        <Inline gap={3} wrap className="items-center justify-between">
          <Heading level={1} variant="display-md">
            {request.requestNumber}
          </Heading>
          <RequestStatusBadge status={request.status as BadgeRequestStatus} />
        </Inline>

        <Text variant="body-sm" tone="muted">
          {request.contactName ?? t.admin.colCustomer} ·{' '}
          {request.contactEmail ?? t.admin.noEmail} ·{' '}
          {request.contactPhone ?? t.admin.noPhone}
        </Text>
      </Stack>

      {request.needsInfoReason && (
        <Alert tone="warning" title={t.admin.informationAskedTitle}>
          {request.needsInfoReason}
        </Alert>
      )}

      {!request.userId && !request.contactEmail && (
        <Alert tone="warning" title={t.admin.noCustomerAccount}>
          Cette demande ne porte aucune adresse e-mail, donc aucun compte ne peut la
          revendiquer et personne ne pourra accepter un devis.
        </Alert>
      )}

      <Grid preset="halves" gap={8}>
        <Stack gap={6}>
          <Card>
            <CardHeader title={t.admin.theRequest} />
            <CardBody>
              <Stack gap={6}>
                {request.customerNote && (
                  <Stack gap={1}>
                    <Text variant="caption" tone="subtle">
                      {t.admin.customerNote}
                    </Text>
                    <Text variant="body-sm" tone="muted">
                      {request.customerNote}
                    </Text>
                  </Stack>
                )}

                {configurations.map((configuration, index) => (
                  <CustomizationSummary
                    key={configuration.requestItemId}
                    configuration={configuration}
                    artwork={artwork[index] ?? []}
                  />
                ))}
              </Stack>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Historique" description={t.admin.historyInternal} />
            <CardBody>
              {events.length === 0 ? (
                <Text variant="body-sm" tone="muted">
                  {t.admin.nothingYet}
                </Text>
              ) : (
                <Stack gap={3} as="ol">
                  {events.map((event) => (
                    <li key={event.id}>
                      <Stack gap={1}>
                        <Text variant="caption" tone="subtle" as="span">
                          {formatDateTime(event.createdAt, locale)} · {event.actorType}
                          {event.type === 'INTERNAL_NOTE' ? ' · note interne' : ''}
                        </Text>
                        <Text variant="body-sm" as="span">
                          {event.message ??
                            (event.toStatus
                              ? `Statut : ${event.fromStatus ?? '—'} → ${event.toStatus}`
                              : event.type)}
                        </Text>
                      </Stack>
                    </li>
                  ))}
                </Stack>
              )}
            </CardBody>
          </Card>

          <RequestConversation
            requestNumber={request.requestNumber}
            status={request.status}
            canRequestInformation={canRequestInformation(request.status)}
            canReview={canTransitionRequest(request.status, 'IN_REVIEW')}
          />
        </Stack>

        <Stack gap={6}>
          <QuoteEditor
            requestNumber={request.requestNumber}
            draftQuoteId={draft?.id ?? null}
            initialLines={editorLines}
            initialCustomerMessage={draft?.customerMessage ?? ''}
            initialInternalNotes={draft?.internalNotes ?? ''}
            editable
          />

          {draft && (
            <Card>
              <CardHeader
                title={t.admin.customerPreview}
                description={t.admin.customerPreviewHint}
              />
              <CardBody>
                <QuoteLines
                  currency={draft.currency}
                  lines={draft.items.map((item) => ({
                    id: item.id,
                    kindLabel: QUOTE_LINE_KIND_LABELS[item.kind as QuoteLineKind],
                    label: item.label,
                    description: item.description,
                    quantity: item.quantity,
                    unitPrice: item.unitPrice,
                    lineTotal: item.lineTotal,
                  }))}
                  totals={{
                    subtotal: draft.subtotal,
                    discountTotal: draft.discountTotal,
                    shippingTotal: draft.shippingTotal,
                    grandTotal: draft.grandTotal,
                    depositRequired: draft.depositRequired,
                  }}
                />
              </CardBody>
            </Card>
          )}

          {outstanding && (
            <Alert tone="info" title={t.admin.quoteWaitingTitle(outstanding.quoteNumber)}>
              {t.admin.quoteSentOn(
                formatDateTime(outstanding.sentAt ?? outstanding.createdAt, locale),
              )}{' '}
              {t.admin.quoteSupersedeNote(outstanding.version + 1)}
            </Alert>
          )}

          <Card>
            <CardHeader title="Versions" />
            <CardBody>
              {quotes.length === 0 ? (
                <Text variant="body-sm" tone="muted">
                  {t.admin.noQuoteForRequest}
                </Text>
              ) : (
                <Stack gap={3} as="ul">
                  {quotes.map((quote) => (
                    <li key={quote.id}>
                      <Inline gap={3} wrap className="items-center justify-between">
                        <Text variant="body-sm" as="span">
                          {quote.quoteNumber} · version {quote.version}
                        </Text>
                        <QuoteStatusBadge status={quote.status as BadgeQuoteStatus} />
                      </Inline>
                    </li>
                  ))}
                </Stack>
              )}
            </CardBody>
          </Card>
        </Stack>
      </Grid>
    </Stack>
  );
}
