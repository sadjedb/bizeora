'use client';

import { usePathname } from 'next/navigation';
import {
  ClipboardList,
  FileText,
  LayoutGrid,
  MessageSquareQuote,
  ShoppingBag,
  UserRound,
  type LucideIcon,
} from 'lucide-react';

import { Link } from '@/components/ui/link';
import { cn } from '@/components/ui/cn';
import { pathWithoutLocale } from '@/i18n/routing';
import { useDictionary } from '@/i18n/client';

/**
 * The portal's own navigation.
 *
 * A client component only because it marks the current section, which needs the
 * path. `aria-current="page"` rather than colour alone, so the current section
 * is announced and not merely tinted.
 *
 * **Two shapes, one list.** From `lg` it is a rail beside the content, which is
 * what turns `/account` from "a page with tabs" into a place with rooms; below
 * that it is a horizontal scroller inside its own container, which
 * `DESIGN-SYSTEM.md` section 13 permits and which beats three ragged rows of
 * wrapped chips on a 375px screen.
 *
 * The active treatment is a hairline rule in the accent on the rail and a
 * filled chip in the scroller — the same idea rendered the way each orientation
 * can carry it.
 */

type Section = {
  href: string;
  /** Which dictionary entry names this section. */
  key: 'overview' | 'requests' | 'quotes' | 'orders' | 'reviews' | 'profile';
  icon: LucideIcon;
  exact: boolean;
};

const SECTIONS: readonly Section[] = [
  { href: '/account', key: 'overview', icon: LayoutGrid, exact: true },
  { href: '/account/requests', key: 'requests', icon: ClipboardList, exact: false },
  { href: '/account/quotes', key: 'quotes', icon: FileText, exact: false },
  { href: '/account/orders', key: 'orders', icon: ShoppingBag, exact: false },
  { href: '/account/reviews', key: 'reviews', icon: MessageSquareQuote, exact: false },
  { href: '/account/profile', key: 'profile', icon: UserRound, exact: false },
] as const;

function isCurrent(pathname: string, section: Section): boolean {
  return section.exact ? pathname === section.href : pathname.startsWith(section.href);
}

export function AccountNav() {
  // Without the language prefix: the section hrefs are written without one.
  const pathname = pathWithoutLocale(usePathname());
  const { t } = useDictionary();

  return (
    <nav aria-label={t.account.title}>
      {/* Rail, from lg. */}
      <ul className="hidden list-none flex-col gap-0.5 p-0 lg:flex">
        {SECTIONS.map((section) => {
          const current = isCurrent(pathname, section);
          const Icon = section.icon;

          return (
            <li key={section.href}>
              <Link
                href={section.href}
                variant="plain"
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'text-body-sm relative flex min-h-11 items-center gap-3 rounded-md px-3',
                  'duration-fast transition-colors ease-out motion-reduce:transition-none',
                  current
                    ? [
                        'bg-bg-subtle text-fg font-medium',
                        'before:bg-accent before:absolute before:inset-y-2 before:left-0',
                        'before:w-0.5 before:rounded-full',
                      ]
                    : 'text-fg-muted hover:bg-bg-subtle hover:text-fg',
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                {t.account[section.key]}
              </Link>
            </li>
          );
        })}
      </ul>

      {/* Scroller, below lg. */}
      <div className="-mx-4 overflow-x-auto px-4 lg:hidden">
        <ul className="flex list-none gap-1 p-0">
          {SECTIONS.map((section) => {
            const current = isCurrent(pathname, section);

            return (
              <li key={section.href}>
                <Link
                  href={section.href}
                  variant="plain"
                  aria-current={current ? 'page' : undefined}
                  className={cn(
                    'text-body-sm flex min-h-11 items-center rounded-md px-3 whitespace-nowrap',
                    'duration-fast transition-colors ease-out motion-reduce:transition-none',
                    current
                      ? 'bg-fg text-fg-inverted font-medium'
                      : 'text-fg-muted hover:bg-bg-subtle hover:text-fg',
                  )}
                >
                  {t.account[section.key]}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
