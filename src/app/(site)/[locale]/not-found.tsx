'use client';

import Link from 'next/link';

import { useDictionary } from '@/i18n/client';
import { localiseHref } from '@/i18n/routing';

/**
 * The storefront's 404.
 *
 * A client component so it can read the language out of the pathname. A
 * `not-found` file receives no route params — Next renders it for a segment
 * that did not match — so the pathname is the only thing that still knows which
 * language the visitor was reading.
 *
 * It uses `next/link` directly rather than the design system's, because the
 * design system's own `Link` would localise the href a second time.
 */
export default function NotFound() {
  const { locale, t } = useDictionary();

  return (
    <main
      id="main"
      className="mx-auto flex w-full max-w-narrow flex-1 flex-col justify-center px-4 py-20"
    >
      <p className="text-overline text-accent font-semibold tracking-[0.14em] uppercase">
        404
      </p>
      <h1 className="text-display-md text-fg mt-4">{t.errors.notFoundTitle}</h1>
      <p className="text-body text-fg-muted mt-4">{t.errors.notFoundBody}</p>
      <Link
        href={localiseHref('/', locale)}
        className="bg-fg text-body text-fg-inverted duration-fast hover:bg-fg-hover mt-8 inline-flex h-12 w-fit items-center rounded-md px-6 font-medium transition-colors"
      >
        {t.errors.goHome}
      </Link>
    </main>
  );
}
