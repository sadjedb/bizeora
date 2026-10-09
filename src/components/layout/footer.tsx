import { brand } from '@/config/brand';
import { cn } from '@/components/ui/cn';
import { Link } from '@/components/ui/link';
import { Container } from '@/components/layout/layout';
import { Overline, Text } from '@/components/ui/typography';

/**
 * Footer.
 *
 * Presentational, like the header: it renders the columns and the contact line
 * it is handed. The real values are settings the owner edits (`UX.md` section 3
 * lists the WhatsApp number, phone and delivery note as admin-configurable), so
 * this component must not reach for them — the layout passes what exists today.
 *
 * A footer link to a page that does not exist yet is a 404 with extra steps, so
 * the storefront passes only routes that are real. The documented four-column
 * IA fills in as those pages land.
 *
 * ## Phase 16: it is the end of the page, and it looks like one
 *
 * It was a tinted band with a hairline above it, which is the shape of a footer
 * that is apologising for existing. It is now a full-bleed inverse band with
 * rounded top corners and the mark set at display size — the page closes on the
 * brand rather than trailing off into small print.
 *
 * Everything on it uses the `*-on-dark` roles rather than `fg-muted`, because
 * `bg-inverse` is the one surface in the system that does not flip with the
 * theme (`tokens.css`): it is light-on-dark in *both*. A `fg-muted` link here
 * would be correct in the dark theme and invisible in the light one, which is
 * the failure that is hardest to notice — you have to switch themes to see it.
 */

export type FooterLink = { label: string; href: string };
export type FooterColumn = { heading: string; links: readonly FooterLink[] };

export type FooterProps = {
  columns: readonly FooterColumn[];
  /** Shown under the columns. Omit a line by omitting the value. */
  contact?: {
    whatsapp?: string;
    phone?: string;
    deliveryNote?: string;
    currencyNote?: string;
  };
  /** "Fabriqué et brodé en Algérie", in the reader's language. */
  madeIn?: string;
  className?: string;
};

export function Footer({
  columns,
  contact,
  madeIn = 'Fabriqué et brodé en Algérie',
  className,
}: FooterProps) {
  const year = new Date().getFullYear();
  const contactLines = [
    contact?.whatsapp,
    contact?.phone,
    contact?.deliveryNote,
    contact?.currencyNote,
  ].filter((line): line is string => Boolean(line));

  return (
    <footer
      className={cn(
        'bg-bg-inverse text-fg-on-dark mt-24 rounded-t-2xl lg:mt-40',
        className,
      )}
    >
      <Container>
        <div className="grid gap-12 py-16 md:grid-cols-[1.5fr_repeat(3,1fr)] lg:py-24">
          <div className="flex max-w-xs flex-col gap-5">
            {/*
             * The mark, on its own light chip.
             *
             * The file the owner supplied is a raster on a solid white ground,
             * so it is given a white surface of its own rather than dropped on
             * the page: on the dark palette a bare white square reads as a
             * broken image, and inverting somebody's logo is not ours to do.
             * A transparent SVG would let this become a plain `img`.
             */}
            <span className="inline-flex w-fit items-center gap-3 rounded-lg bg-white p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={brand.logo.src ?? ''}
                alt={brand.logo.alt}
                width={44}
                height={44}
                className="size-11 rounded-sm"
              />
            </span>

            {/*
             * The mark set large. This is the only place on the site the brand
             * name appears at display size with nothing competing with it, and
             * it is the last thing on every page — which is the whole argument
             * for the inverse band above it.
             */}
            <span className="font-display text-display-lg leading-none tracking-tight [font-variation-settings:'SOFT'_60]">
              {brand.name}
            </span>

            <Text variant="body-sm" className="text-fg-on-dark-muted">
              {brand.tagline}
            </Text>
          </div>

          {columns.map((column) => (
            <nav key={column.heading} aria-label={column.heading}>
              <Overline as="h2" className="text-fg-on-dark-muted">
                {column.heading}
              </Overline>
              {/* 44px rows rather than 16px text links. A stacked list of
               * footer links is one of the fiddliest things to tap on a phone,
               * and mobile is the primary platform (section 13). */}
              <ul className="mt-2 flex flex-col">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      variant="onDark"
                      className="text-body-sm flex min-h-11 items-center"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        {contactLines.length > 0 && (
          <div className="border-border-on-dark flex flex-col gap-2 border-t py-8 md:flex-row md:flex-wrap md:gap-x-8">
            {contactLines.map((line) => (
              <Text key={line} variant="body-sm" className="text-fg-on-dark-muted">
                {line}
              </Text>
            ))}
          </div>
        )}

        <div className="border-border-on-dark flex flex-col gap-2 border-t py-8 md:flex-row md:items-center md:justify-between">
          <Text variant="caption" className="text-fg-on-dark-muted">
            © {year} {brand.legalName}
          </Text>
          <Text variant="caption" className="text-fg-on-dark-muted">
            {madeIn}
          </Text>
        </div>
      </Container>
    </footer>
  );
}
