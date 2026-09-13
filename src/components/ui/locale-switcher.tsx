'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Check, Languages } from 'lucide-react';

import { IconButton } from '@/components/ui/button';
import { Menu } from '@/components/ui/overlay';
import { LOCALES, LOCALE_NAMES, type Locale } from '@/i18n/locales';
import { localeFromPath, switchLocalePath } from '@/i18n/routing';
import { useDictionary } from '@/i18n/client';

/**
 * Changing language.
 *
 * Two properties matter and both are easy to get wrong.
 *
 * **It keeps you on the page you are on.** `switchLocalePath` swaps the prefix
 * and preserves everything after it, so switching from a product page lands on
 * that product in the other language rather than on the homepage — which is the
 * behaviour that makes a switcher useful rather than annoying.
 *
 * **It remembers.** The cookie the middleware reads is written here, so a bare
 * internal link or a return visit stays in the chosen language instead of
 * renegotiating from `Accept-Language` every time.
 *
 * The languages name themselves — "Français", "English" — never translated. A
 * switcher that says "French" to an English reader cannot be used in reverse by
 * a French one.
 */

/** The name the middleware reads. Kept in step with `middleware.ts`. */
const LOCALE_COOKIE = 'NEXT_LOCALE';
const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * Remember the choice, before navigating.
 *
 * Written here rather than inside the component because the cookie is the
 * document's state, not React's — and because the middleware has to see it on
 * the very next request rather than one navigation later.
 */
function remember(locale: Locale): void {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
}

export function LocaleSwitcher({
  label,
  onDark = false,
  className,
}: {
  /** "Langue" / "Language" — supplied by the caller's dictionary. */
  label: string;
  onDark?: boolean;
  className?: string;
}) {
  const pathname = usePathname() ?? '/';
  const router = useRouter();
  const { locale } = useDictionary();
  // In the workshop the pathname carries no language, so the switcher shows
  // what the dictionary resolved from the cookie.
  const current: Locale = localeFromPath(pathname) ?? locale;

  function choose(next: Locale): void {
    remember(next);

    /*
     * Two shapes of switch, because there are two shapes of page.
     *
     * On the storefront the language is in the address, so switching is a
     * navigation: the same page, the other prefix. In the workshop it is only
     * the cookie — `/admin/orders` has no prefix — so there is nowhere to
     * navigate to, and what has to happen is a re-render on the server, which
     * is what `refresh` asks for.
     */
    if (localeFromPath(pathname) === null) {
      router.refresh();
      return;
    }

    router.push(switchLocalePath(pathname, next));
  }

  return (
    <Menu
      trigger={
        <IconButton
          label={`${label} : ${LOCALE_NAMES[current]}`}
          variant="ghost"
          size="sm"
          className={
            onDark
              ? `text-fg-on-dark-muted hover:bg-surface-inverse hover:text-fg-on-dark ${className ?? ''}`
              : className
          }
        >
          <Languages className="size-5" aria-hidden="true" />
        </IconButton>
      }
      items={LOCALES.map((locale) => ({
        label: LOCALE_NAMES[locale],
        icon:
          locale === current ? (
            <Check className="text-accent size-4" aria-hidden="true" />
          ) : (
            <span className="size-4" aria-hidden="true" />
          ),
        onSelect: () => choose(locale),
      }))}
    />
  );
}
