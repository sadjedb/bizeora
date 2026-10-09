'use client';

import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ComponentPropsWithoutRef } from 'react';

import { cn } from '@/components/ui/cn';
import { localeFromPath, localiseHref } from '@/i18n/routing';

/**
 * Link.
 *
 * A real `<a>`, always — section 14 is explicit that buttons are `button` and
 * links are `a`, and that a `div` with a click handler is a defect. Anything
 * that navigates uses this; anything that acts uses `Button`.
 *
 * `external` adds the attributes that make a new tab safe (`rel="noreferrer"`
 * closes the `window.opener` hole) and is signalled to assistive technology
 * through the caller's own text rather than an icon alone.
 *
 * ## It carries the language
 *
 * Every public URL is prefixed — `/fr/shop`, `/en/shop` — and this is the one
 * place that knows it. A caller writes `href="/shop"` exactly as before and
 * gets the visitor's current language, because the locale is read from the
 * pathname here rather than threaded through sixty call sites.
 *
 * That is why this is a client component. `usePathname` is the only way to know
 * the current locale from inside a leaf that both server and client pages
 * render, and the alternative — a `locale` prop on every link in the
 * application — is the kind of change that is correct in review and wrong in
 * practice the first time somebody adds a link and forgets it.
 *
 * The cost is honest and small: this renders on the server like any client
 * component, and the JavaScript it ships is an `<a>`.
 *
 * Outside a locale — the admin, where the pathname starts `/admin` —
 * `localeFromPath` returns `null` and nothing is prefixed.
 */

export const linkVariants = cva(
  [
    'rounded-sm transition-colors duration-fast ease-out',
    'focus-visible:outline-none focus-visible:shadow-focus',
    'motion-reduce:transition-none',
  ],
  {
    variants: {
      variant: {
        /** In prose. Accent, underlined — the one place accent carries text. */
        inline: 'text-accent underline underline-offset-4 hover:text-accent-hover',
        /** Navigation and UI. Underline appears on hover only. */
        subtle: 'text-fg-muted hover:text-fg underline-offset-4 hover:underline',
        /**
         * `subtle`, on an inverse band — the footer, a full-bleed dark section.
         *
         * It names the ground it sits on rather than the theme, exactly as
         * `--color-fg-on-dark` does: an inverse band is light-on-dark in *both*
         * themes (`tokens.css`), so a link on one cannot be `fg-muted` and
         * cannot flip.
         */
        onDark:
          'text-fg-on-dark-muted hover:text-fg-on-dark underline-offset-4 hover:underline',
        /** Wraps a card or an image. No text decoration of its own. */
        plain: 'text-inherit no-underline',
      },
    },
    defaultVariants: { variant: 'inline' },
  },
);

export type LinkProps = ComponentPropsWithoutRef<typeof NextLink> &
  VariantProps<typeof linkVariants> & {
    external?: boolean;
  };

export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { className, variant, external = false, href, children, ...props },
  ref,
) {
  const pathname = usePathname();
  const locale = localeFromPath(pathname ?? '');

  /*
   * Only a plain string href is localised. An object href — `{ pathname,
   * query }` — is rare here and is left alone rather than half-understood, and
   * an external link is never touched.
   */
  const resolved =
    typeof href === 'string' && !external ? localiseHref(href, locale) : href;

  return (
    <NextLink
      ref={ref}
      href={resolved}
      className={cn(linkVariants({ variant }), className)}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      {...props}
    >
      {children}
    </NextLink>
  );
});
