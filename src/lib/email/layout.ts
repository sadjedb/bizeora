import 'server-only';

import { brand } from '@/config/brand';

/**
 * The e-mail shell.
 *
 * Everything an HTML e-mail needs and nothing an e-mail client will throw away.
 * `DESIGN-SYSTEM.md`'s palette and voice, expressed the only way Outlook and
 * Gmail both understand: a centred table, inline styles, web-safe fonts with
 * the brand face as a first choice, and no CSS the last decade has not agreed
 * on. There is no external stylesheet, no `<link>`, no web font, no media query
 * doing layout work, and no image — a logo would be a remote request most
 * clients block by default, so the wordmark is text.
 *
 * The tokens are **copied** rather than imported. `styles/tokens.css` is a CSS
 * custom-property file, and custom properties are the single most reliably
 * unsupported feature in e-mail. The hexadecimals below are the same values;
 * this comment is the reason they are written twice.
 */

const INK = '#211d18';
const MUTED = '#6f675d';
const PAPER = '#faf7f2';
const SURFACE = '#ffffff';
const BORDER = '#e6dfd4';
const ACCENT = '#8c4a2f';

const FONT =
  "'Instrument Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

export type EmailAction = { label: string; url: string };

export type EmailBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'heading'; text: string }
  /** A label-and-value list — an order summary, a quote's totals. */
  | { kind: 'facts'; rows: readonly { label: string; value: string }[] }
  /** A quiet, bordered aside: a payment reference, a deadline. */
  | { kind: 'callout'; text: string }
  | { kind: 'action'; action: EmailAction }
  /** A one-time code, shown large enough to read off a phone. */
  | { kind: 'code'; value: string };

export type EmailDocument = {
  subject: string;
  preheader: string;
  blocks: readonly EmailBlock[];
  /** Closing line above the signature. Optional. */
  signOff?: string;
};

/**
 * Escape for HTML.
 *
 * Every value in an e-mail is customer or catalogue text — a name typed into a
 * form, a product name, a rejection reason written by an admin. None of it is
 * trusted markup, and an e-mail body is exactly where an unescaped angle
 * bracket goes unnoticed.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${INK}">${escapeHtml(text)}</p>`;
}

function heading(text: string): string {
  return `<h2 style="margin:24px 0 12px;font-size:18px;line-height:1.4;font-weight:600;color:${INK}">${escapeHtml(text)}</h2>`;
}

function facts(rows: readonly { label: string; value: string }[]): string {
  const cells = rows
    .map(
      (row) =>
        `<tr>` +
        `<td style="padding:6px 0;font-size:14px;line-height:1.5;color:${MUTED}">${escapeHtml(row.label)}</td>` +
        `<td align="right" style="padding:6px 0;font-size:14px;line-height:1.5;color:${INK};font-weight:500">${escapeHtml(row.value)}</td>` +
        `</tr>`,
    )
    .join('');

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border-collapse:collapse">${cells}</table>`;
}

function callout(text: string): string {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border-collapse:collapse">` +
    `<tr><td style="padding:14px 16px;background:${PAPER};border:1px solid ${BORDER};border-radius:4px;` +
    `font-size:14px;line-height:1.6;color:${INK}">${escapeHtml(text)}</td></tr>` +
    `</table>`
  );
}

/**
 * The call to action.
 *
 * A bordered table cell rather than a styled anchor, because Outlook renders
 * `padding` on an `<a>` inconsistently and a button that collapses to blue
 * underlined text is worse than no button. The accent is the one place the
 * design system reserves it, and the contrast against white is above 4.5:1.
 */
function action(item: EmailAction): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border-collapse:separate">` +
    `<tr><td style="background:${ACCENT};border-radius:4px">` +
    `<a href="${escapeHtml(item.url)}" style="display:inline-block;padding:12px 24px;font-family:${FONT};` +
    `font-size:16px;line-height:1.2;font-weight:600;color:#ffffff;text-decoration:none">${escapeHtml(item.label)}</a>` +
    `</td></tr></table>`
  );
}

function code(value: string): string {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border-collapse:collapse">` +
    `<tr><td align="center" style="padding:18px;background:${PAPER};border:1px solid ${BORDER};border-radius:4px;` +
    `font-family:'JetBrains Mono',Consolas,monospace;font-size:28px;letter-spacing:6px;color:${INK}">${escapeHtml(value)}</td></tr>` +
    `</table>`
  );
}

function renderBlock(block: EmailBlock): string {
  switch (block.kind) {
    case 'paragraph':
      return paragraph(block.text);
    case 'heading':
      return heading(block.text);
    case 'facts':
      return facts(block.rows);
    case 'callout':
      return callout(block.text);
    case 'action':
      return action(block.action);
    case 'code':
      return code(block.value);
  }
}

/**
 * The HTML body.
 *
 * `lang` and a real `<title>` because a screen reader announces both, and a
 * hidden preheader because every inbox shows the first line of the body beside
 * the subject — leaving it to chance means "View this email in your browser"
 * or a bare greeting is what the recipient decides on.
 */
export function renderHtml(document: EmailDocument): string {
  const body = document.blocks.map(renderBlock).join('\n        ');

  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>${escapeHtml(document.subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:${PAPER};font-family:${FONT};-webkit-font-smoothing:antialiased">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(document.preheader)}</div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};border-collapse:collapse">
      <tr>
        <td align="center" style="padding:32px 16px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;border-collapse:collapse">
            <tr>
              <td style="padding:0 0 20px">
                <span style="font-size:20px;font-weight:700;letter-spacing:2px;color:${INK}">${escapeHtml(brand.name)}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 28px 12px;background:${SURFACE};border:1px solid ${BORDER};border-radius:6px">
                ${body}
                ${document.signOff ? paragraph(document.signOff) : ''}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 4px 0;font-size:12px;line-height:1.6;color:${MUTED}">
                ${escapeHtml(brand.name)} — ${escapeHtml(brand.tagline)}<br />
                Ce message vous est envoyé parce que vous avez une commande, une demande ou un devis en cours.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * The plain-text alternative.
 *
 * Not a stripped copy of the HTML: it is written from the same blocks, so it
 * carries the same facts in the same order. A text part is what a client with
 * images off, a screen reader in text mode, or a spam filter reads, and a
 * missing one is itself a deliverability penalty.
 */
export function renderText(document: EmailDocument): string {
  const lines: string[] = [document.subject, '='.repeat(document.subject.length), ''];

  for (const block of document.blocks) {
    switch (block.kind) {
      case 'paragraph':
        lines.push(block.text, '');
        break;
      case 'heading':
        lines.push(block.text.toUpperCase(), '');
        break;
      case 'facts':
        for (const row of block.rows) lines.push(`${row.label} : ${row.value}`);
        lines.push('');
        break;
      case 'callout':
        lines.push(block.text, '');
        break;
      case 'action':
        lines.push(`${block.action.label} : ${block.action.url}`, '');
        break;
      case 'code':
        lines.push(block.value, '');
        break;
    }
  }

  if (document.signOff) lines.push(document.signOff, '');
  lines.push('—', `${brand.name} — ${brand.tagline}`);

  return lines.join('\n');
}
