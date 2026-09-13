/**
 * What can be announced, to whom, and how often.
 *
 * `ARCHITECTURE.md` section 11's guarantees, as assertions: eight templates, an
 * audience each, an idempotency key that makes a retry safe, a retry curve that
 * ends, and a warning window that never fires after the thing it warns of.
 *
 * The rendering tests live here too, because a template is a pure function from
 * a payload to a document — and the property that matters most about it is what
 * it does *not* contain.
 */

import { describe, expect, it } from 'vitest';

import {
  EXPIRY_WARNING_LEAD_MS,
  MAX_DELIVERY_ATTEMPTS,
  NOTIFICATION_TEMPLATES,
  TEMPLATE_AUDIENCE,
  audienceOf,
  dedupeKeyFor,
  isCustomerTemplate,
  isStaffTemplate,
  isWithinExpiryWarning,
  nextAttemptAt,
  parseRecipients,
  shouldRetry,
  type NotificationTemplate,
} from '../../src/domain/notification';
import { escapeHtml, renderHtml, renderText } from '../../src/lib/email/layout';
import { renderEmail } from '../../src/lib/email/templates';

/* ---------------------------------------------------------------------------
 * Templates and audiences
 * ------------------------------------------------------------------------ */

describe('the V1 template set', () => {
  it('is the eight events section 11 lists, and no others', () => {
    expect([...NOTIFICATION_TEMPLATES].sort()).toEqual(
      [
        'auth.password_reset',
        'auth.verify_email',
        'order.confirmed',
        'order.placed',
        'quote.expiring',
        'quote.expiring.staff',
        'quote.sent',
        'request.submitted',
      ].sort(),
    );
  });

  it('gives every template exactly one audience', () => {
    for (const template of NOTIFICATION_TEMPLATES) {
      const audience = audienceOf(template);
      expect(['CUSTOMER', 'STAFF']).toContain(audience);
      expect(isCustomerTemplate(template)).toBe(audience === 'CUSTOMER');
      expect(isStaffTemplate(template)).toBe(audience === 'STAFF');
    }

    expect(Object.keys(TEMPLATE_AUDIENCE).sort()).toEqual(
      [...NOTIFICATION_TEMPLATES].sort(),
    );
  });

  it('keeps the customer and workshop expiry warnings apart', () => {
    // Two templates, not one with a flag: a flag is how the customer's copy
    // eventually reaches the workshop's inbox.
    expect(audienceOf('quote.expiring')).toBe('CUSTOMER');
    expect(audienceOf('quote.expiring.staff')).toBe('STAFF');
  });
});

/* ---------------------------------------------------------------------------
 * Idempotency
 * ------------------------------------------------------------------------ */

describe('the idempotency key', () => {
  it('is the template and the business identifier', () => {
    expect(dedupeKeyFor('order.confirmed', 'CMD-2026-0007')).toBe(
      'order.confirmed:CMD-2026-0007',
    );
  });

  it('is stable for the same event and different across events', () => {
    expect(dedupeKeyFor('quote.sent', 'Q-1042')).toBe(
      dedupeKeyFor('quote.sent', 'Q-1042'),
    );

    expect(dedupeKeyFor('quote.sent', 'Q-1042')).not.toBe(
      dedupeKeyFor('quote.expiring', 'Q-1042'),
    );

    // A revision is its own quote number, so version 2 is its own e-mail.
    expect(dedupeKeyFor('quote.sent', 'Q-1042')).not.toBe(
      dedupeKeyFor('quote.sent', 'Q-1042-v2'),
    );
  });
});

/* ---------------------------------------------------------------------------
 * Retry
 * ------------------------------------------------------------------------ */

describe('the retry curve', () => {
  const now = new Date('2026-03-01T10:00:00.000Z');

  it('backs off and then stops', () => {
    // `attempts` is the number already **made** — the dispatcher increments it
    // when it claims a row — so four made still permits a fifth, and the budget
    // is spent at five.
    const delays = [0, 1, 2, 3, 4, 5].map((attempts) => {
      const at = nextAttemptAt({ attempts, now });
      return at ? (at.getTime() - now.getTime()) / 60_000 : null;
    });

    expect(delays).toEqual([1, 5, 15, 60, 60, null]);
  });

  it('gives up at the documented budget', () => {
    expect(shouldRetry(MAX_DELIVERY_ATTEMPTS - 1)).toBe(true);
    expect(shouldRetry(MAX_DELIVERY_ATTEMPTS)).toBe(false);
    expect(nextAttemptAt({ attempts: MAX_DELIVERY_ATTEMPTS, now })).toBeNull();
  });

  it('always schedules forward', () => {
    for (const attempts of [0, 1, 2, 3]) {
      const at = nextAttemptAt({ attempts, now })!;
      expect(at.getTime()).toBeGreaterThan(now.getTime());
    }
  });
});

/* ---------------------------------------------------------------------------
 * The expiry window
 * ------------------------------------------------------------------------ */

describe('the expiry warning window', () => {
  const now = new Date('2026-03-01T10:00:00.000Z');

  function at(offsetMs: number): Date {
    return new Date(now.getTime() + offsetMs);
  }

  it('warns inside the window and not before it', () => {
    expect(isWithinExpiryWarning({ validUntil: at(EXPIRY_WARNING_LEAD_MS), now })).toBe(
      true,
    );
    expect(
      isWithinExpiryWarning({ validUntil: at(EXPIRY_WARNING_LEAD_MS + 1), now }),
    ).toBe(false);
  });

  it('never warns about a quote that has already expired', () => {
    // The e-mail would arrive after the deadline it warns of.
    expect(isWithinExpiryWarning({ validUntil: now, now })).toBe(false);
    expect(isWithinExpiryWarning({ validUntil: at(-1), now })).toBe(false);
    expect(isWithinExpiryWarning({ validUntil: at(-86_400_000), now })).toBe(false);
  });

  it('warns one millisecond before the deadline', () => {
    expect(isWithinExpiryWarning({ validUntil: at(1), now })).toBe(true);
  });

  it('introduces no new validity period — the window is a lead time', () => {
    // Two days, expressed in milliseconds, and nothing else in the module reads
    // or writes `validUntil`.
    expect(EXPIRY_WARNING_LEAD_MS).toBe(2 * 24 * 60 * 60 * 1000);
  });
});

/* ---------------------------------------------------------------------------
 * Recipients
 * ------------------------------------------------------------------------ */

describe('parsing the configured recipients', () => {
  it('splits, trims and preserves order', () => {
    expect(parseRecipients(' a@example.dz , b@example.dz ')).toEqual([
      'a@example.dz',
      'b@example.dz',
    ]);
  });

  it('drops blanks and case-insensitive duplicates', () => {
    expect(parseRecipients('a@example.dz,,A@example.dz,  ,b@example.dz')).toEqual([
      'a@example.dz',
      'b@example.dz',
    ]);
  });

  it('treats absent, empty and whitespace alike', () => {
    for (const value of [null, undefined, '', '   ', ',,,']) {
      expect(parseRecipients(value), JSON.stringify(value)).toEqual([]);
    }
  });
});

/* ---------------------------------------------------------------------------
 * Rendering
 * ------------------------------------------------------------------------ */

describe('the e-mail shell', () => {
  const document = {
    subject: 'Sujet',
    preheader: 'Aperçu',
    blocks: [
      { kind: 'paragraph' as const, text: 'Bonjour' },
      { kind: 'facts' as const, rows: [{ label: 'Total', value: '1 000 DA' }] },
      { kind: 'action' as const, action: { label: 'Ouvrir', url: 'https://x.test/a' } },
      { kind: 'code' as const, value: '12345678' },
    ],
  };

  it('escapes every value it is given', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
    );

    const html = renderHtml({
      ...document,
      blocks: [{ kind: 'paragraph', text: '<img src=x onerror=alert(1)>' }],
    });

    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('declares a language, a title and a preheader', () => {
    const html = renderHtml(document);

    expect(html).toContain('<html lang="fr"');
    expect(html).toContain('<title>Sujet</title>');
    expect(html).toContain('Aperçu');
  });

  it('uses no CSS an e-mail client would drop', () => {
    const html = renderHtml(document);

    // No custom properties, no stylesheet, no web font, no remote image.
    expect(html).not.toContain('var(--');
    expect(html).not.toContain('<link');
    expect(html).not.toContain('@import');
    expect(html).not.toContain('<img');
  });

  it('writes a text part carrying the same facts', () => {
    const text = renderText(document);

    expect(text).toContain('Bonjour');
    expect(text).toContain('Total : 1 000 DA');
    expect(text).toContain('https://x.test/a');
    expect(text).toContain('12345678');
    expect(text).not.toContain('<');
  });
});

describe('rendering each template', () => {
  const payloads: Record<NotificationTemplate, unknown> = {
    'auth.verify_email': { otp: '12345678' },
    'auth.password_reset': { url: 'https://x.test/reset/abc' },
    'order.confirmed': {
      orderNumber: 'CMD-2026-0007',
      contactName: 'Amina',
      items: [{ name: 'Tote bag', variant: 'Écru', quantity: 2, total: '2 000 DA' }],
      subtotal: '2 000 DA',
      discountTotal: null,
      shippingLabel: 'Livraison',
      shippingTotal: '600 DA',
      grandTotal: '2 600 DA',
      depositRequired: '1 300 DA',
      paymentMethod: 'Virement bancaire',
      address: '12 rue, Hydra, Alger',
      statusMessage: 'En attente de votre acompte.',
      orderUrl: 'https://x.test/order/CMD-2026-0007',
    },
    'quote.sent': {
      quoteNumber: 'Q-1042',
      version: 1,
      contactName: 'Amina',
      requestNumber: 'DEM-2026-0001',
      lines: [{ label: 'Tee brodé', quantity: 2, total: '7 000 DA' }],
      grandTotal: '7 600 DA',
      depositRequired: '3 800 DA',
      validUntil: '15 mars 2026',
      message: 'Voici notre proposition.',
      quoteUrl: 'https://x.test/account/quotes/Q-1042',
    },
    'quote.expiring': {
      quoteNumber: 'Q-1042',
      contactName: 'Amina',
      grandTotal: '7 600 DA',
      validUntil: '15 mars 2026',
      quoteUrl: 'https://x.test/account/quotes/Q-1042',
    },
    'request.submitted': {
      requestNumber: 'DEM-2026-0001',
      customerName: 'Amina',
      itemCount: 2,
      pricingMode: 'Devis nécessaire',
      estimate: '5 000 DA – 7 000 DA',
      responseTimeHours: 6,
      adminUrl: 'https://x.test/admin/requests/DEM-2026-0001',
    },
    'order.placed': {
      orderNumber: 'CMD-2026-0007',
      customerName: 'Amina',
      grandTotal: '2 600 DA',
      paymentMethod: 'CCP',
      depositRequired: null,
      itemCount: 2,
      adminUrl: 'https://x.test/admin/orders/CMD-2026-0007',
    },
    'quote.expiring.staff': {
      quoteNumber: 'Q-1042',
      customerName: 'Amina',
      grandTotal: '7 600 DA',
      validUntil: '15 mars 2026',
      adminUrl: 'https://x.test/admin/requests/DEM-2026-0001',
    },
  };

  it('produces a subject, an HTML part and a text part for all eight', () => {
    for (const template of NOTIFICATION_TEMPLATES) {
      const rendered = renderEmail(template, payloads[template]);

      expect(rendered, template).not.toBeNull();
      expect(rendered!.subject.length, template).toBeGreaterThan(0);
      expect(rendered!.html, template).toContain('<html lang="fr"');
      expect(rendered!.text.length, template).toBeGreaterThan(0);
    }
  });

  it('returns null for a template that does not exist', () => {
    // A dispatcher works through rows; one unknown row must not stop the queue.
    expect(renderEmail('marketing.newsletter', {})).toBeNull();
  });

  it('carries the payload’s own values, not a re-read of anything', () => {
    const rendered = renderEmail('order.confirmed', payloads['order.confirmed'])!;

    expect(rendered.text).toContain('CMD-2026-0007');
    expect(rendered.text).toContain('Tote bag');
    expect(rendered.text).toContain('Écru');
    expect(rendered.text).toContain('2 600 DA');
    expect(rendered.text).toContain('12 rue, Hydra, Alger');
  });

  it('tells the customer the payment reference is the order number (8.10.1)', () => {
    const rendered = renderEmail('order.confirmed', payloads['order.confirmed'])!;
    expect(rendered.text).toContain('1 300 DA');
    expect(rendered.text).toContain('CMD-2026-0007');
  });

  it('puts the credential in the body and never in the subject', () => {
    const verify = renderEmail('auth.verify_email', { otp: '12345678' })!;
    expect(verify.text).toContain('12345678');
    expect(verify.subject).not.toContain('12345678');

    const reset = renderEmail('auth.password_reset', {
      url: 'https://x.test/reset/secret-token',
    })!;
    expect(reset.text).toContain('secret-token');
    expect(reset.subject).not.toContain('secret-token');
  });

  it('never leaks a staff link into a customer e-mail', () => {
    for (const template of NOTIFICATION_TEMPLATES.filter(isCustomerTemplate)) {
      const rendered = renderEmail(template, payloads[template])!;
      expect(rendered.html, template).not.toContain('/admin/');
      expect(rendered.text, template).not.toContain('/admin/');
    }
  });
});
