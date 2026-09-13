import { brand } from '@/config/brand';

/**
 * The social card, as one design used by every Open Graph image route.
 *
 * Colours are hex literals rather than the design system's custom properties:
 * this is rendered by satori into a PNG, not by a browser, and
 * `var(--color-fg)` resolves to nothing there. The values are copied from
 * `styles/tokens.css` deliberately — the same trade the e-mail templates make,
 * for the same reason.
 *
 * Two routes use it: the site-wide card, and the product card that adds a name
 * and a price. Keeping the layout here means they cannot drift into two
 * different-looking brands.
 */

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = 'image/png';

/*
 * Satori resolves no CSS custom properties, so the card's palette is written
 * out. These track `tokens.css` by hand and were re-synchronised with the
 * Phase 14.5 values; a social card in last season's colours is the one place a
 * stale token is visible to somebody who has never seen the site.
 */
const PAPER = '#faf9f6';
const INK = '#100f0e';
const MUTED = '#6c675e';
const ACCENT = '#8a3623';
const BORDER = '#e7e3dc';

export function OgCard({
  headline,
  detail,
  footer = 'Atelier de broderie · Algérie',
}: {
  headline: string;
  detail: string | null;
  /** The strip along the bottom, in the card's language. */
  footer?: string;
}) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        backgroundColor: PAPER,
        padding: 72,
        borderBottom: `16px solid ${ACCENT}`,
      }}
    >
      <div
        style={{
          display: 'flex',
          fontSize: 28,
          letterSpacing: 6,
          textTransform: 'uppercase',
          color: MUTED,
        }}
      >
        {brand.name}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div
          style={{
            display: 'flex',
            fontSize: headline.length > 40 ? 64 : 84,
            lineHeight: 1.05,
            color: INK,
          }}
        >
          {headline}
        </div>

        {detail !== null && (
          <div style={{ display: 'flex', fontSize: 40, color: MUTED }}>{detail}</div>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          fontSize: 26,
          color: MUTED,
          borderTop: `2px solid ${BORDER}`,
          paddingTop: 24,
        }}
      >
        {footer}
      </div>
    </div>
  );
}
