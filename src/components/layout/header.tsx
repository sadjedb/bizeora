'use client';

import { Menu as MenuIcon, Search, ShoppingBag, User } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { brand } from '@/config/brand';
import { cn } from '@/components/ui/cn';
import { IconButton } from '@/components/ui/button';
import { Link } from '@/components/ui/link';
import { Sheet } from '@/components/ui/overlay';
import { ThemeToggle } from '@/components/ui/theme';
import { LocaleSwitcher } from '@/components/ui/locale-switcher';
import { Container } from '@/components/layout/layout';
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
    <span className={cn('font-display text-heading-lg tracking-tight', className)}>
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
        'bg-bg/95 border-border z-40 border-b backdrop-blur',
        sticky && 'sticky top-0',
        className,
      )}
    >
      <Container>
        <div className="flex h-16 items-center justify-between gap-4 md:h-20">
          <div className="flex items-center gap-2">
            <IconButton
              label={labels.openMenu}
              variant="ghost"
              size="sm"
              className="md:hidden"
              onClick={() => setMobileOpen(true)}
            >
              <MenuIcon className="size-5" aria-hidden="true" />
            </IconButton>

            <Link href="/" variant="plain" aria-label={brand.name}>
              <Wordmark />
            </Link>
          </div>

          <nav aria-label={labels.mainNavigation} className="hidden md:block">
            <ul className="flex items-center gap-6">
              {items.map((item) => (
                <li key={item.href}>
                  <NavLink item={item} current={current === item.href} />
                </li>
              ))}
            </ul>
          </nav>

          <div className="flex items-center gap-1">
            <LocaleSwitcher label={labels.language} />
            <ThemeToggle />

            {searchSlot === undefined ? (
              <IconButton label={labels.search} variant="ghost" size="sm">
                <Search className="size-5" aria-hidden="true" />
              </IconButton>
            ) : (
              searchSlot
            )}

            {accountHref && (
              <Link href={accountHref} variant="plain" aria-label={labels.account}>
                <span className="text-fg-muted hover:text-fg hover:bg-hover flex size-10 items-center justify-center rounded-md transition-colors">
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
                <span className="text-fg-muted hover:text-fg hover:bg-hover relative flex size-10 items-center justify-center rounded-md transition-colors">
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
          </div>
        </div>
      </Container>

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
                    'text-body flex min-h-11 items-center rounded-sm px-2',
                    item.accent ? 'text-accent font-medium' : 'text-fg',
                  )}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
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
