'use client';

import { usePathname } from 'next/navigation';
import { createContext, createElement, useContext, type ReactNode } from 'react';

import { getDictionary } from '@/i18n';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';
import { localeFromPath } from '@/i18n/routing';
import type { Dictionary } from '@/i18n/dictionaries/fr';

/**
 * The dictionary, inside a client component.
 *
 * Server components take the locale from `params`; client components cannot,
 * and threading a `t` prop down through every form, panel and dialog is the
 * kind of change that is complete on the day it lands and incomplete a week
 * later. There are therefore two ways the locale reaches this hook, and which
 * one applies is decided by where the component is rendered:
 *
 * **The pathname**, on the storefront. Every public URL is `/fr/…` or `/en/…`,
 * which is the point of prefixing them, so a leaf can read the language off the
 * address exactly as `Link` does.
 *
 * **A provider**, in the workshop. `/admin` has no prefix and never will; its
 * language is a preference in a cookie, read on the server by
 * `workshopDictionary` and handed down through `DictionaryProvider`. A cookie
 * cannot be read during render on the client without a hydration mismatch, so
 * the server's answer is the one that travels.
 *
 * Both dictionaries are a few kilobytes of static object and are already in the
 * bundle for the switcher, so there is nothing to fetch and nothing to await.
 */

const DictionaryContext = createContext<Locale | null>(null);

/**
 * Declare the language for a subtree that has none in its URL.
 *
 * Takes a locale rather than a dictionary: the dictionaries are module
 * constants on both sides of the boundary, so sending the whole object over
 * the wire would serialise a few kilobytes of strings the client already has.
 */
export function DictionaryProvider({
  locale,
  children,
}: {
  locale: string;
  children: ReactNode;
}) {
  return createElement(
    DictionaryContext.Provider,
    { value: isLocale(locale) ? locale : DEFAULT_LOCALE },
    children,
  );
}

export function useDictionary(): { locale: Locale; t: Dictionary } {
  const declared = useContext(DictionaryContext);
  const pathname = usePathname() ?? '';

  const locale = declared ?? localeFromPath(pathname) ?? DEFAULT_LOCALE;

  return { locale, t: getDictionary(locale) };
}
