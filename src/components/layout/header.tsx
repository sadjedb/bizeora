'use client';

import { Menu as MenuIcon, Search, ShoppingBag, User } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { brand } from '@/config/brand';
import { cn } from '@/components/ui/cn';
import { Button, IconButton } from '@/components/ui/button';
import { Link } from '@/components/ui/link';
import { Sheet } from '@/components/ui/overlay';
import { ThemeToggle } from '@/components/ui/theme';
import { LocaleSwitcher } from '@/components/ui/locale-switcher';
import { pathWithoutLocale } from '@/i18n/routing';

/**
 * Header and the primitives that make one.
 *
 * Presentation only: it renders the links it is given and reports the counts it
 * is given. It does not read a session, a cart or a route — a header that knew
 * who was signed in would drag `lib/auth` into `components/`, which the
 * boundary rule forbids. A page resolves the actor and passes `accountHref`.
 *
 * The wordmark comes from `config/brand.ts`. The brand name never appears as a
 * literal in a component (section 2).
 *
 * ## Phase 16: it is a pill that floats
 *
 * It was a full-width bar with a bottom border — the shape every storefront
 * has. It is now a rounded bar inset from the edges of the window, with the
 * page scrolling visibly past it on all four sides.
 *
 * Two things about that are worth knowing before changing it:
 *
 * **It is still `sticky`, not `fixed`.** A sticky element keeps its space in
 * the flow, so the first section of every page starts below the header exactly
 * as it always did and no page needs a compensating top padding. Going
 * `fixed` to win the few pixels of gutter would push that compensation onto
 * every page in the site, and the one that forgot would hide its own heading.
 *
 * **The translucency is doing real work.** `bg-surface/80` plus a backdrop blur
 * is what makes a bar sitting *on top of* a photograph legible without a solid
 * block of colour cutting the image in half. On a ground with no backdrop-blur
 * support it falls back to 80% opaque, which is still legible — so the blur is
 * an enhancement, not a dependency.
 */

export type NavItem = { label: string; href: string; accent?: boolean };

/**
 * Everything the header says in its own voice.
 *
 * Passed in rather than read from a dictionary here, because this component is
 * presentation: it renders the links and the labels it is given, and knows
 * nothing about languages, sessions or routes. The showcase and the component
 * tests supply their own.
 */
export type HeaderLabels = {
  mainNavigation: string;
  openMenu: string;
  menu: string;
  search: string;
  account: string;
  /**
   * A plain string, not a formatter.
   *
   * Labels cross from a server layout into this client component, and a
   * function cannot make that trip — React refuses to serialise one. The count,
   * when there is one, is appended as a parenthetical below.
   */
  cart: string;
  theme: string;
  language: string;
};

const DEFAULT_LABELS: HeaderLabels = {
  mainNavigation: 'Navigation principale',
  openMenu: 'Ouvrir le menu',
  menu: 'Menu',
  search: 'Rechercher',
  account: 'Mon compte',
  cart: 'Panier',
  theme: 'Thème',
  language: 'Langue',
};

export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'font-display text-heading-lg tracking-tight',
        // The mark gets the softened terminals too. It is the same letterform
        // decision as `Accent`, applied to the one word that is always on
        // screen — see `components/ui/typography.tsx`.
        "[font-variation-settings:'SOFT'_60]",
        className,
      )}
    >
      {brand.name}
    </span>
  );
}

export type HeaderProps = {
  items: readonly NavItem[];
  /** Where the current page is, so the active item can be marked. */
  currentPath?: string;
  cartCount?: number;
  /**
   * Cart and account destinations. `null` omits the control entirely.
   *
   * A cart icon leading to a route that does not exist yet is fake
   * functionality, and the storefront shell is assembled before the cart is
   * built — so omitting is the honest default for a destination that is not
   * there.
   */
  cartHref?: string | null;
  accountHref?: string | null;
  /**
   * The one filled call to action in the bar, from `lg` upwards.
   *
   * `null` omits it. It is the only coloured thing in the header, which is what
   * lets it be read at a glance against a row of outline icons — give it to the
   * action the business actually wants, and never to two of them.
   */
  cta?: { label: string; href: string } | null;
  /** `null` omits search; omitting the prop keeps the default trigger. */
  searchSlot?: ReactNode | null;
  labels?: HeaderLabels;
  /**
   * Pin to the top. Section 13 asks the storefront header to reveal on
   * scroll-up only; that is scroll behaviour the owning page drives, so this
   * prop is the seam rather than a scroll listener buried in a primitive.
   */
  sticky?: boolean;
  className?: string;
};

export function Header({
  items,
  currentPath,
  cartCount = 0,
  cartHref = null,
  accountHref = null,
  cta = null,
  searchSlot,
  labels = DEFAULT_LABELS,
  sticky = true,
  className,
}: HeaderProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  /*
   * The navigation's hrefs are written without a language — `Link` adds it —
   * so "is this the current page?" is asked without one too. Comparing
   * `/fr/shop` against `/shop` would simply never be true, and the active
   * marker would disappear the moment the site gained a prefix.
   */
  const current = currentPath === undefined ? undefined : pathWithoutLocale(currentPath);

  return (
    <header
      className={cn(
        'z-40 px-3 pt-3 md:px-6 md:pt-5',
        sticky && 'sticky top-0',
        className,
      )}
    >
      <div
        className={cn(
          'mx-auto flex max-w-(--container-page) items-center gap-3',
          'rounded-full border border-hairline bg-surface/80 shadow-md backdrop-blur-md',
          'h-14 pr-2 pl-4 md:h-16 md:pr-3 md:pl-6',
        )}
      >
        <div className="flex items-center gap-1">
          <IconButton
            label={labels.openMenu}
            variant="ghost"
            shape="pill"
            size="sm"
            className="-ml-2 md:hidden"
            onClick={() => setMobileOpen(true)}
          >
            <MenuIcon className="size-5" aria-hidden="true" />
          </IconButton>

          <Link href="/" variant="plain" aria-label={brand.name}>
            <Wordmark />
          </Link>
        </div>

        {/*
         * The links sit in the middle of the bar, not beside the mark.
         *
         * `flex-1` plus `justify-center` rather than absolute centring, because
         * absolute centring makes the nav overlap the mark the moment somebody
         * adds a sixth link — this way it runs out of room and wraps the
         * problem into view instead of hiding it under the logo.
         */}
        <nav
          aria-label={labels.mainNavigation}
          className="hidden flex-1 justify-center md:flex"
        >
          <ul className="flex items-center gap-7">
            {items.map((item) => (
              <li key={item.href}>
                <NavLink item={item} current={current === item.href} />
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-0.5 md:ml-0">
          <div className="hidden items-center gap-0.5 md:flex">
            <LocaleSwitcher label={labels.language} className="rounded-full" />
            <ThemeToggle className="rounded-full" />

            {searchSlot === undefined ? (
              <IconButton label={labels.search} variant="ghost" shape="pill" size="sm">
                <Search className="size-5" aria-hidden="true" />
              </IconButton>
            ) : (
              searchSlot
            )}
          </div>

          {accountHref && (
            <Link
              href={accountHref}
              variant="plain"
              aria-label={labels.account}
              className="hidden md:block"
            >
              <span className="text-fg-muted hover:text-fg hover:bg-hover flex size-10 items-center justify-center rounded-full transition-colors">
                <User className="size-5" aria-hidden="true" />
              </span>
            </Link>
          )}

          {cartHref && (
            <Link
              href={cartHref}
              variant="plain"
              aria-label={cartCount > 0 ? `${labels.cart} (${cartCount})` : labels.cart}
            >
              <span className="text-fg-muted hover:text-fg hover:bg-hover relative flex size-10 items-center justify-center rounded-full transition-colors">
                <ShoppingBag className="size-5" aria-hidden="true" />
                {cartCount > 0 && (
                  <span
                    className={cn(
                      'bg-accent text-fg-on-accent absolute top-1 right-1',
                      'text-mono-sm flex min-w-4 items-center justify-center',
                      'rounded-full px-1 tabular-nums',
                    )}
                    aria-hidden="true"
                  >
                    {cartCount}
                  </span>
                )}
              </span>
            </Link>
          )}

          {cta && (
            <Button
              asChild
              variant="accent"
              shape="pill"
              size="md"
              className="ml-1.5 hidden lg:inline-flex"
            >
              <Link href={cta.href} variant="plain">
                {cta.label}
              </Link>
            </Button>
          )}
        </div>
      </div>

      <Sheet
        side="left"
        open={mobileOpen}
        onOpenChange={setMobileOpen}
        title={labels.menu}
      >
        <nav aria-label={labels.mainNavigation}>
          <ul className="flex flex-col gap-1">
            {items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  variant="plain"
                  aria-current={current === item.href ? 'page' : undefined}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    // The sheet is where a phone reads the navigation, so it is
                    // set at display size rather than at body size — it is the
                    // page's primary content while it is open, not a list.
                    'font-display text-display-md flex min-h-12 items-center rounded-sm px-2',
                    item.accent ? 'text-accent' : 'text-fg',
                  )}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {/*
         * Language and theme live down here on a phone rather than in the bar.
         * They are settings somebody changes once; the bar is for the four
         * things they came to do, and a pill with eight controls in it is a
         * toolbar.
         */}
        <div className="border-hairline mt-8 flex items-center gap-1 border-t pt-4">
          <LocaleSwitcher label={labels.language} className="rounded-full" />
          <ThemeToggle className="rounded-full" />
          {accountHref && (
            <Link
              href={accountHref}
              variant="plain"
              aria-label={labels.account}
              onClick={() => setMobileOpen(false)}
            >
              <span className="text-fg-muted hover:text-fg hover:bg-hover flex size-10 items-center justify-center rounded-full transition-colors">
                <User className="size-5" aria-hidden="true" />
              </span>
            </Link>
          )}
        </div>

        {cta && (
          <Button
            asChild
            variant="accent"
            shape="pill"
            size="lg"
            fullWidth
            className="mt-4"
          >
            <Link href={cta.href} variant="plain" onClick={() => setMobileOpen(false)}>
              {cta.label}
            </Link>
          </Button>
        )}
      </Sheet>
    </header>
  );
}

function NavLink({ item, current }: { item: NavItem; current: boolean }) {
  return (
    <Link
      href={item.href}
      variant="plain"
      aria-current={current ? 'page' : undefined}
      className={cn(
        'text-body-sm relative py-2 transition-colors duration-fast ease-out',
        // The active marker is an accent underline, per section 4's list of
        // the few places accent is allowed to appear.
        'after:absolute after:inset-x-0 after:-bottom-0.5 after:h-px',
        current ? 'text-fg after:bg-accent' : 'text-fg-muted hover:text-fg',
        item.accent && !current && 'text-accent',
        'motion-reduce:transition-none',
      )}
    >
      {item.label}
    </Link>
  );
}
