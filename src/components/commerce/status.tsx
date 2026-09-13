'use client';

import { cn } from '@/components/ui/cn';
import { useDictionary } from '@/i18n/client';

/**
 * Status indicators.
 *
 * Section 8: a status is a 6px dot **plus a label**, and colour is never the
 * only signal. Both parts are baked in here, so there is no way to render a
 * bare coloured dot from this module.
 *
 * The status values are declared as string unions rather than imported from
 * the Prisma client. That is not laziness — `components/` is forbidden from
 * importing Prisma (`ARCHITECTURE.md` section 17), and a presentation
 * component should not carry a dependency on the database driver to know that
 * "SHIPPED" is a word. The lists mirror the enums in `DATABASE.md` section 3;
 * the compiler check that they still agree happens where a page maps a row to
 * these props.
 *
 * The tone mapping below is presentation, not business logic: it says what a
 * status *looks* like, never what it *permits*. Transitions and permissions
 * live in `domain/` (BUSINESS-RULES.md section 16).
 *
 * ## Why this is a client component
 *
 * The words are in the dictionaries, in both languages, and the badge reads
 * them from the pathname's locale the same way `Link` reads it — rather than
 * every list, table and detail page threading a label map down to a badge. The
 * tones stay here, because a colour is not a translation.
 */

export type StatusTone = 'neutral' | 'progress' | 'attention' | 'positive' | 'negative';

const TONE_DOT: Record<StatusTone, string> = {
  neutral: 'bg-status-neutral',
  progress: 'bg-status-progress',
  attention: 'bg-status-attention',
  positive: 'bg-status-positive',
  negative: 'bg-status-negative',
};

/* ---------------------------------------------------------------------------
 * The three lifecycles.
 * ------------------------------------------------------------------------ */

/**
 * The eleven statuses `BUSINESS-RULES.md` section 8 defines, mirrored.
 *
 * `components/` may not import `domain/`, so this union is written out rather
 * than derived — and a page mapping a stored row onto these props is where the
 * compiler checks the two still agree.
 */
export type OrderStatus =
  | 'AWAITING_PAYMENT'
  | 'AWAITING_CONFIRMATION'
  | 'CONFIRMED'
  | 'DESIGN_REVIEW'
  | 'IN_PRODUCTION'
  | 'READY'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'ON_HOLD'
  | 'CANCELLED'
  | 'REFUNDED';

export type QuoteStatus =
  | 'DRAFT'
  | 'SENT'
  | 'VIEWED'
  | 'NEEDS_INFO'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'SUPERSEDED'
  | 'CONVERTED';

export type RequestStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'IN_REVIEW'
  | 'NEEDS_INFO'
  | 'QUOTED'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'CONVERTED'
  | 'CANCELLED'
  | 'CLOSED';

/**
 * What each status looks like. The words live in `i18n/dictionaries`.
 *
 * Exported because the design-system showcase renders every one of them, and
 * because a unit test walks these keys to prove both dictionaries name them
 * all.
 */
export const ORDER_STATUS_TONES: Record<OrderStatus, StatusTone> = {
  AWAITING_PAYMENT: 'attention',
  AWAITING_CONFIRMATION: 'neutral',
  CONFIRMED: 'positive',
  DESIGN_REVIEW: 'progress',
  IN_PRODUCTION: 'progress',
  READY: 'positive',
  SHIPPED: 'progress',
  DELIVERED: 'positive',
  ON_HOLD: 'attention',
  CANCELLED: 'negative',
  REFUNDED: 'neutral',
};

export const QUOTE_STATUS_TONES: Record<QuoteStatus, StatusTone> = {
  DRAFT: 'neutral',
  SENT: 'progress',
  VIEWED: 'progress',
  NEEDS_INFO: 'attention',
  ACCEPTED: 'positive',
  REJECTED: 'negative',
  EXPIRED: 'negative',
  CANCELLED: 'neutral',
  SUPERSEDED: 'neutral',
  CONVERTED: 'positive',
};

export const REQUEST_STATUS_TONES: Record<RequestStatus, StatusTone> = {
  DRAFT: 'neutral',
  SUBMITTED: 'neutral',
  IN_REVIEW: 'progress',
  NEEDS_INFO: 'attention',
  QUOTED: 'progress',
  ACCEPTED: 'positive',
  REJECTED: 'negative',
  EXPIRED: 'negative',
  CONVERTED: 'positive',
  CANCELLED: 'neutral',
  CLOSED: 'neutral',
};

/* ---------------------------------------------------------------------------
 * Components
 * ------------------------------------------------------------------------ */

export type StatusIndicatorProps = {
  label: string;
  tone: StatusTone;
  size?: 'sm' | 'md';
  className?: string;
};

/** The generic dot-plus-label. Prefer the typed wrappers below. */
export function StatusIndicator({
  label,
  tone,
  size = 'md',
  className,
}: StatusIndicatorProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 whitespace-nowrap',
        size === 'sm' ? 'text-caption' : 'text-body-sm',
        'text-fg',
        className,
      )}
    >
      <span
        className={cn('size-1.5 shrink-0 rounded-full', TONE_DOT[tone])}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

export function OrderStatusBadge({
  status,
  size,
  className,
}: {
  status: OrderStatus;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const { t } = useDictionary();
  return (
    <StatusIndicator
      label={t.labels.orderStatus[status]}
      tone={ORDER_STATUS_TONES[status]}
      size={size}
      className={className}
    />
  );
}

export function QuoteStatusBadge({
  status,
  size,
  className,
}: {
  status: QuoteStatus;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const { t } = useDictionary();
  return (
    <StatusIndicator
      label={t.labels.quoteStatus[status]}
      tone={QUOTE_STATUS_TONES[status]}
      size={size}
      className={className}
    />
  );
}

export function RequestStatusBadge({
  status,
  size,
  className,
}: {
  status: RequestStatus;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const { t } = useDictionary();
  return (
    <StatusIndicator
      label={t.labels.requestStatus[status]}
      tone={REQUEST_STATUS_TONES[status]}
      size={size}
      className={className}
    />
  );
}
