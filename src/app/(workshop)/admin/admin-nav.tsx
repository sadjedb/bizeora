'use client';

import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  Boxes,
  ClipboardList,
  FileText,
  FolderTree,
  LayoutDashboard,
  LayoutTemplate,
  Menu,
  MessageSquareQuote,
  Settings,
  Package,
  ShoppingBag,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

import { brand } from '@/config/brand';
import { useDictionary } from '@/i18n/client';
import { LocaleSwitcher } from '@/components/ui/locale-switcher';
import type { Dictionary } from '@/i18n';
import { Button, IconButton } from '@/components/ui/button';
import { Link } from '@/components/ui/link';
import { Sheet } from '@/components/ui/overlay';
import { ThemeToggle } from '@/components/ui/theme';
import { Text } from '@/components/ui/typography';
import { cn } from '@/components/ui/cn';

import { signOutAction } from '@/app/auth-actions';

/**
 * The workshop's navigation.
 *
 * Phase 14.5 replaced a horizontal row of six links with a grouped sidebar.
 * The row was fine at six items and stopped being fine at ten: a single line of
 * peers gives no sense of which screens belong together, and the previous
 * mobile fallback was an absolutely-positioned panel that overlapped the page
 * rather than a real drawer, leaving everything beneath it tabbable.
 *
 * **Only routes that exist appear here.** The gallery, settings and audit-log
 * screens are Phase 12's outstanding half and stay out until somebody builds
 * them; products, stock and — since Phase 14.8 — the homepage editor are in. A
 * navigation item leading to a 404 is worse than a missing one, because it
 * makes the tool look broken rather than unfinished.
 */

type Item = { href: string; label: string; icon: LucideIcon; exact?: boolean };
type Group = { heading: string; items: readonly Item[] };

/**
 * The destinations, named in the reader's language.
 *
 * A function of the dictionary rather than a constant: the workshop speaks two
 * languages since Phase 14.8, and a module-level array would be built once, in
 * whichever language the server started in.
 */
export function navGroups(t: Dictionary): readonly Group[] {
  return [
    {
      heading: t.admin.groupWorkshop,
      items: [
        { href: '/admin', label: t.admin.navToday, icon: LayoutDashboard, exact: true },
      ],
    },
    {
      heading: t.admin.groupSales,
      items: [
        { href: '/admin/requests', label: t.admin.navRequests, icon: ClipboardList },
        { href: '/admin/quotes', label: t.admin.navQuotes, icon: FileText },
        { href: '/admin/orders', label: t.admin.navOrders, icon: ShoppingBag },
        { href: '/admin/payments', label: t.admin.navPayments, icon: Wallet },
      ],
    },
    {
      heading: t.admin.groupCatalogue,
      items: [
        { href: '/admin/products', label: t.admin.navProducts, icon: Package },
        { href: '/admin/categories', label: t.admin.navCategories, icon: FolderTree },
        { href: '/admin/stock', label: t.admin.navStock, icon: Boxes },
      ],
    },
    {
      heading: t.admin.groupShop,
      items: [
        { href: '/admin/content', label: t.admin.navHomepage, icon: LayoutTemplate },
        { href: '/admin/settings', label: t.admin.navSettings, icon: Settings },
      ],
    },
    {
      heading: t.admin.groupCustomers,
      items: [
        { href: '/admin/customers', label: t.admin.navCustomers, icon: Users },
        { href: '/admin/reviews', label: t.admin.navReviews, icon: MessageSquareQuote },
      ],
    },
  ];
}

function isCurrent(pathname: string, item: Item): boolean {
  return item.exact === true ? pathname === item.href : pathname.startsWith(item.href);
}

/**
 * One destination.
 *
 * The sidebar is a near-black band and the mobile drawer is a light sheet, so
 * the item renders in either — the alternative was a dark drawer under the
 * `Sheet`'s light title bar, which reads as a rendering fault rather than a
 * design.
 */
function NavItem({
  item,
  current,
  onDark,
  onNavigate,
}: {
  item: Item;
  current: boolean;
  onDark: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      variant="plain"
      aria-current={current ? 'page' : undefined}
      onClick={onNavigate}
      className={cn(
        'text-body-sm relative flex min-h-11 items-center gap-3 rounded-md px-3',
        'duration-fast transition-colors ease-out motion-reduce:transition-none',
        // The accent appears exactly once in the navigation: on the rule
        // marking where you are (DESIGN-SYSTEM.md section 4).
        current && [
          'font-medium',
          'before:bg-accent before:absolute before:inset-y-2 before:left-0',
          'before:w-0.5 before:rounded-full',
        ],
        onDark
          ? current
            ? 'bg-surface-inverse text-fg-on-dark'
            : 'text-fg-on-dark-muted hover:bg-surface-inverse hover:text-fg-on-dark'
          : current
            ? 'bg-bg-sunken text-fg'
            : 'text-fg-muted hover:bg-bg-sunken hover:text-fg',
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {item.label}
    </Link>
  );
}

function NavGroups({
  pathname,
  onNavigate,
  onDark = true,
}: {
  pathname: string;
  onNavigate?: () => void;
  onDark?: boolean;
}) {
  const { t } = useDictionary();

  return (
    <nav aria-label={t.admin.navigation} className="flex flex-col gap-6">
      {navGroups(t).map((group) => (
        <div key={group.heading} className="flex flex-col gap-1">
          {/*
           * `fg-on-dark-muted` rather than `fg-on-dark` at 60% opacity.
           * Opacity looked the same and measured 3.1:1 against the sidebar —
           * axe caught it. A muted token is a colour somebody chose and can
           * check; an opacity is a colour nobody knows the value of.
           */}
          <Text
            variant="overline"
            as="h2"
            tone={onDark ? 'onDark' : 'subtle'}
            className={cn('px-3 pb-1', onDark && 'text-fg-on-dark-muted')}
          >
            {group.heading}
          </Text>
          {group.items.map((item) => (
            <NavItem
              key={item.href}
              item={item}
              current={isCurrent(pathname, item)}
              onDark={onDark}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ))}
    </nav>
  );
}

function SignOut({ onDark }: { onDark: boolean }) {
  const { t } = useDictionary();

  return (
    <form action={signOutAction}>
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        fullWidth
        className={cn(
          'justify-start',
          onDark &&
            'text-fg-on-dark-muted hover:bg-surface-inverse hover:text-fg-on-dark',
        )}
      >
        {t.admin.signOut}
      </Button>
    </form>
  );
}

/** The persistent sidebar. Rendered from `lg` up; hidden below it. */
export function AdminSidebar({ actorName }: { actorName: string | null }) {
  const { t } = useDictionary();
  const pathname = usePathname();

  return (
    <div className="bg-bg-inverse border-border-on-dark sticky top-0 hidden h-dvh w-60 shrink-0 flex-col justify-between gap-8 border-r py-5 lg:flex">
      <div className="flex flex-col gap-7 overflow-y-auto px-3">
        <Link href="/admin" variant="plain" className="block px-3">
          <span className="font-display text-heading-lg text-fg-on-dark block tracking-tight">
            {brand.name}
          </span>
          <span className="text-fg-on-dark-muted text-mono-sm mt-0.5 block lowercase">
            {t.admin.workshop}
          </span>
        </Link>

        <NavGroups pathname={pathname} />
      </div>

      <div className="border-border-on-dark mx-3 flex flex-col gap-1 border-t pt-4">
        {actorName && (
          <p className="text-fg-on-dark-muted text-caption truncate px-3 pb-1">
            {actorName}
          </p>
        )}
        <div className="flex items-center gap-1 px-1">
          <ThemeToggle onDark />
          <LocaleSwitcher label={t.a11y.language} onDark />
          <div className="min-w-0 flex-1">
            <SignOut onDark />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The mobile bar and its drawer.
 *
 * A real `Sheet` — focus trapped, escape closes, the page behind it inert.
 */
export function AdminMobileBar({ actorName }: { actorName: string | null }) {
  const { t } = useDictionary();
  const pathname = usePathname();

  /*
   * Open-ness is derived, not stored.
   *
   * A navigation that stays open after navigating is a navigation nobody
   * trusts. Rather than an effect that closes the drawer when the path
   * changes — a `setState` during an effect, which cascades a render — the
   * state records *which page* the drawer was opened on, and it is open only
   * while that is still the page. Navigating closes it by arithmetic, including
   * through the back button, which no click handler would catch.
   */
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn === pathname;

  const setOpen = (next: boolean) => setOpenedOn(next ? pathname : null);

  return (
    <div className="bg-bg-inverse border-border-on-dark sticky top-0 z-30 border-b lg:hidden">
      <div className="flex h-14 items-center justify-between gap-3 px-4">
        <Link href="/admin" variant="plain" className="flex items-baseline gap-2">
          <span className="font-display text-heading-md text-fg-on-dark tracking-tight">
            {brand.name}
          </span>
          <span className="text-fg-on-dark-muted text-mono-sm lowercase">
            {t.admin.workshop}
          </span>
        </Link>

        <div className="flex items-center gap-1">
          <ThemeToggle onDark />
          <LocaleSwitcher label={t.a11y.language} onDark />

          <IconButton
            label={t.admin.openNavigation}
            variant="ghost"
            size="sm"
            aria-expanded={open}
            className="text-fg-on-dark-muted hover:bg-surface-inverse hover:text-fg-on-dark"
            onClick={() => setOpen(true)}
          >
            <Menu className="size-5" aria-hidden="true" />
          </IconButton>
        </div>
      </div>

      <Sheet side="left" open={open} onOpenChange={setOpen} title={t.admin.navigation}>
        <div className="flex flex-col gap-6">
          <NavGroups
            pathname={pathname}
            onDark={false}
            onNavigate={() => setOpen(false)}
          />
          <div className="border-border flex flex-col gap-1 border-t pt-4">
            {actorName && (
              <p className="text-fg-subtle text-caption truncate px-3">{actorName}</p>
            )}
            <SignOut onDark={false} />
          </div>
        </div>
      </Sheet>
    </div>
  );
}
