import 'server-only';

import type { NotificationTemplate } from '@/domain/notification';

import { renderHtml, renderText, type EmailDocument } from './layout';

/**
 * The eight V1 e-mails.
 *
 * Each is a function from a **payload the outbox already stored** to a
 * document. That is the whole discipline of this file: it reads its arguments
 * and formats them, and it reaches for nothing. It does not query, it does not
 * price, it does not decide whether an event happened, and it does not look up
 * a customer's current address — the payload was written from snapshots at the
 * moment of the event, and a template that re-read the catalogue would put
 * today's product name on last month's order.
 *
 * Money arrives pre-formatted for the same reason: `domain/money` and the
 * `Price` primitive are the two places that turn minor units into a string, and
 * a third one here would be a third opinion about rounding.
 */

/* ---------------------------------------------------------------------------
 * Payloads
 * ------------------------------------------------------------------------ */

export type VerifyEmailPayload = { otp: string };
export type PasswordResetPayload = { url: string };

export type OrderConfirmedPayload = {
  orderNumber: string;
  contactName: string;
  /** Already formatted, from the order's stored currency and totals. */
  items: readonly {
    name: string;
    variant: string | null;
    quantity: number;
    total: string;
  }[];
  subtotal: string;
  discountTotal: string | null;
  shippingLabel: string;
  shippingTotal: string;
  grandTotal: string;
  depositRequired: string | null;
  paymentMethod: string;
  address: string;
  statusMessage: string;
  orderUrl: string;
};

export type QuoteSentPayload = {
  quoteNumber: string;
  version: number;
  contactName: string;
  requestNumber: string;
  lines: readonly { label: string; quantity: number; total: string }[];
  grandTotal: string;
  depositRequired: string | null;
  validUntil: string;
  message: string | null;
  quoteUrl: string;
};

export type QuoteExpiringPayload = {
  quoteNumber: string;
  contactName: string;
  grandTotal: string;
  validUntil: string;
  quoteUrl: string;
};

export type RequestSubmittedPayload = {
  requestNumber: string;
  customerName: string;
  itemCount: number;
  pricingMode: string;
  estimate: string | null;
  responseTimeHours: number;
  adminUrl: string;
};

export type OrderPlacedPayload = {
  orderNumber: string;
  customerName: string;
  grandTotal: string;
  paymentMethod: string;
  depositRequired: string | null;
  itemCount: number;
  adminUrl: string;
};

export type QuoteExpiringStaffPayload = {
  quoteNumber: string;
  customerName: string;
  grandTotal: string;
  validUntil: string;
  adminUrl: string;
};

export type TemplatePayloads = {
  'auth.verify_email': VerifyEmailPayload;
  'auth.password_reset': PasswordResetPayload;
  'order.confirmed': OrderConfirmedPayload;
  'quote.sent': QuoteSentPayload;
  'quote.expiring': QuoteExpiringPayload;
  'request.submitted': RequestSubmittedPayload;
  'order.placed': OrderPlacedPayload;
  'quote.expiring.staff': QuoteExpiringStaffPayload;
};

/* ---------------------------------------------------------------------------
 * Documents
 * ------------------------------------------------------------------------ */

function verifyEmail(payload: VerifyEmailPayload): EmailDocument {
  return {
    subject: 'Confirmez votre adresse e-mail',
    preheader: 'Votre code de confirmation, valable 15 minutes.',
    blocks: [
      { kind: 'paragraph', text: 'Voici votre code de confirmation :' },
      { kind: 'code', value: payload.otp },
      {
        kind: 'paragraph',
        text: 'Il est valable 15 minutes et ne peut servir qu’une fois. Si vous n’avez pas créé de compte, ignorez ce message.',
      },
    ],
  };
}

function passwordReset(payload: PasswordResetPayload): EmailDocument {
  return {
    subject: 'Réinitialisation de votre mot de passe',
    preheader: 'Un lien pour choisir un nouveau mot de passe, valable une heure.',
    blocks: [
      {
        kind: 'paragraph',
        text: 'Vous avez demandé à changer votre mot de passe. Ce lien est valable une heure et ne fonctionne qu’une fois.',
      },
      { kind: 'action', action: { label: 'Choisir un mot de passe', url: payload.url } },
      {
        kind: 'paragraph',
        text: 'Si vous n’êtes pas à l’origine de cette demande, ignorez ce message : votre mot de passe actuel reste valable.',
      },
    ],
  };
}

function orderConfirmed(payload: OrderConfirmedPayload): EmailDocument {
  const rows = payload.items.map((item) => ({
    label: `${item.name}${item.variant ? ` — ${item.variant}` : ''} × ${item.quantity}`,
    value: item.total,
  }));

  const totals = [
    { label: 'Sous-total', value: payload.subtotal },
    ...(payload.discountTotal
      ? [{ label: 'Remise', value: `− ${payload.discountTotal}` }]
      : []),
    { label: payload.shippingLabel, value: payload.shippingTotal },
    { label: 'Total', value: payload.grandTotal },
  ];

  return {
    subject: `Commande ${payload.orderNumber} enregistrée`,
    preheader: `Merci ${payload.contactName}. Votre commande est enregistrée.`,
    blocks: [
      {
        kind: 'paragraph',
        text: `Merci ${payload.contactName}, votre commande est enregistrée.`,
      },
      { kind: 'paragraph', text: payload.statusMessage },
      { kind: 'heading', text: 'Votre commande' },
      { kind: 'facts', rows },
      { kind: 'facts', rows: totals },
      ...(payload.depositRequired
        ? [
            {
              kind: 'callout' as const,
              text: `Acompte à régler maintenant : ${payload.depositRequired}. Utilisez ${payload.orderNumber} comme référence de votre virement — c’est le seul identifiant à retenir.`,
            },
          ]
        : []),
      { kind: 'heading', text: 'Livraison' },
      {
        kind: 'facts',
        rows: [
          { label: 'Adresse', value: payload.address },
          { label: 'Paiement', value: payload.paymentMethod },
        ],
      },
      { kind: 'action', action: { label: 'Voir ma commande', url: payload.orderUrl } },
    ],
    signOff: 'À très vite.',
  };
}

function quoteSent(payload: QuoteSentPayload): EmailDocument {
  return {
    subject: `Votre devis ${payload.quoteNumber}`,
    preheader: `Votre devis est prêt : ${payload.grandTotal}, valable jusqu’au ${payload.validUntil}.`,
    blocks: [
      {
        kind: 'paragraph',
        text: `Bonjour ${payload.contactName}, votre devis pour la demande ${payload.requestNumber} est prêt.`,
      },
      ...(payload.message ? [{ kind: 'callout' as const, text: payload.message }] : []),
      { kind: 'heading', text: 'Détail' },
      {
        kind: 'facts',
        rows: payload.lines.map((line) => ({
          label: `${line.label} × ${line.quantity}`,
          value: line.total,
        })),
      },
      {
        kind: 'facts',
        rows: [
          { label: 'Total', value: payload.grandTotal },
          ...(payload.depositRequired
            ? [{ label: 'Acompte à la commande', value: payload.depositRequired }]
            : []),
        ],
      },
      {
        kind: 'callout',
        text: `Ce devis est valable jusqu’au ${payload.validUntil}. Passé ce délai, il faudra en demander un nouveau.`,
      },
      {
        kind: 'action',
        action: { label: 'Voir et accepter le devis', url: payload.quoteUrl },
      },
    ],
  };
}

function quoteExpiring(payload: QuoteExpiringPayload): EmailDocument {
  return {
    subject: `Votre devis ${payload.quoteNumber} expire bientôt`,
    preheader: `Valable jusqu’au ${payload.validUntil}.`,
    blocks: [
      {
        kind: 'paragraph',
        text: `Bonjour ${payload.contactName}, votre devis ${payload.quoteNumber} (${payload.grandTotal}) arrive à échéance.`,
      },
      {
        kind: 'callout',
        text: `Il reste acceptable jusqu’au ${payload.validUntil}. Ensuite, il faudra nous demander un devis actualisé.`,
      },
      { kind: 'action', action: { label: 'Voir le devis', url: payload.quoteUrl } },
      {
        kind: 'paragraph',
        text: 'Si vous avez une question avant de décider, répondez simplement à ce message.',
      },
    ],
  };
}

function requestSubmitted(payload: RequestSubmittedPayload): EmailDocument {
  return {
    subject: `Nouvelle demande ${payload.requestNumber}`,
    preheader: `${payload.customerName} — à traiter sous ${payload.responseTimeHours} h.`,
    blocks: [
      { kind: 'paragraph', text: 'Une nouvelle demande de broderie vient d’arriver.' },
      {
        kind: 'facts',
        rows: [
          { label: 'Référence', value: payload.requestNumber },
          { label: 'Client', value: payload.customerName },
          {
            label: 'Articles',
            value:
              payload.itemCount === 1 ? '1 article' : `${payload.itemCount} articles`,
          },
          { label: 'Mode', value: payload.pricingMode },
          ...(payload.estimate ? [{ label: 'Estimation', value: payload.estimate }] : []),
        ],
      },
      {
        kind: 'callout',
        text: `La promesse de réponse est de ${payload.responseTimeHours} heures ouvrées.`,
      },
      { kind: 'action', action: { label: 'Ouvrir la demande', url: payload.adminUrl } },
    ],
  };
}

function orderPlaced(payload: OrderPlacedPayload): EmailDocument {
  return {
    subject: `Nouvelle commande ${payload.orderNumber}`,
    preheader: `${payload.customerName} — ${payload.grandTotal}.`,
    blocks: [
      {
        kind: 'paragraph',
        text: 'Une commande vient d’être passée et attend d’être confirmée.',
      },
      {
        kind: 'facts',
        rows: [
          { label: 'Référence', value: payload.orderNumber },
          { label: 'Client', value: payload.customerName },
          {
            label: 'Articles',
            value:
              payload.itemCount === 1 ? '1 article' : `${payload.itemCount} articles`,
          },
          { label: 'Total', value: payload.grandTotal },
          { label: 'Paiement', value: payload.paymentMethod },
          ...(payload.depositRequired
            ? [{ label: 'Acompte attendu', value: payload.depositRequired }]
            : []),
        ],
      },
      { kind: 'action', action: { label: 'Ouvrir la commande', url: payload.adminUrl } },
    ],
  };
}

function quoteExpiringStaff(payload: QuoteExpiringStaffPayload): EmailDocument {
  return {
    subject: `Devis ${payload.quoteNumber} sans réponse`,
    preheader: `${payload.customerName} — échéance le ${payload.validUntil}.`,
    blocks: [
      {
        kind: 'paragraph',
        text: 'Un devis envoyé arrive à échéance sans avoir reçu de réponse.',
      },
      {
        kind: 'facts',
        rows: [
          { label: 'Devis', value: payload.quoteNumber },
          { label: 'Client', value: payload.customerName },
          { label: 'Montant', value: payload.grandTotal },
          { label: 'Échéance', value: payload.validUntil },
        ],
      },
      {
        kind: 'callout',
        text: 'Un appel avant l’échéance vaut souvent mieux qu’un devis réémis après.',
      },
      { kind: 'action', action: { label: 'Ouvrir la demande', url: payload.adminUrl } },
    ],
  };
}

/* ---------------------------------------------------------------------------
 * The registry
 * ------------------------------------------------------------------------ */

const BUILDERS: {
  [K in NotificationTemplate]: (payload: TemplatePayloads[K]) => EmailDocument;
} = {
  'auth.verify_email': verifyEmail,
  'auth.password_reset': passwordReset,
  'order.confirmed': orderConfirmed,
  'quote.sent': quoteSent,
  'quote.expiring': quoteExpiring,
  'request.submitted': requestSubmitted,
  'order.placed': orderPlaced,
  'quote.expiring.staff': quoteExpiringStaff,
};

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

/**
 * Render one notification.
 *
 * Returns `null` rather than throwing, for **both** failure modes: a template
 * nothing knows, and a payload that does not fit the template it names. The
 * caller is a dispatcher working through rows, and one bad row must not stop
 * the queue behind it — it is recorded as a permanent failure and the next row
 * is tried.
 *
 * A malformed payload is unretryable by nature: it will not become well-formed
 * on its own, and a person has to look at it. That is what `FAILED` means here.
 */
export function renderEmail(template: string, payload: unknown): RenderedEmail | null {
  const build = BUILDERS[template as NotificationTemplate] as
    ((value: unknown) => EmailDocument) | undefined;

  if (!build) return null;

  try {
    const document = build(payload);

    return {
      subject: document.subject,
      html: renderHtml(document),
      text: renderText(document),
    };
  } catch {
    return null;
  }
}
