import { NextResponse, type NextRequest } from 'next/server';

import { DEFAULT_LOCALE, isLocale, negotiateLocale } from '@/i18n/locales';

/**
 * Sending a visitor to a language.
 *
 * Every public URL carries its locale — `/fr/shop`, `/en/shop` — so something
 * has to answer a request for the bare `/shop`. This is that something, and it
 * does exactly one thing: it redirects a public path that has no locale to the
 * same path with one.
 *
 * **It is a redirect, not a rewrite.** A rewrite would serve French content at
 * `/shop` and leave two URLs for one page, which is the duplicate-content
 * problem Phase 14's canonicals exist to avoid. A 307 tells the browser, the
 * crawler and the address bar the same thing.
 *
 * Which language a visitor lands in comes from, in order: the `NEXT_LOCALE`
 * cookie the switcher writes, then `Accept-Language`, then French. The cookie
 * is what makes the choice stick — without it, following a bare link would
 * bounce an English reader back into French every time.
 *
 * **`/admin` is untouched.** It has its own root layout and stays French; see
 * the comment in `app/(workshop)/layout.tsx`.
 *
 * Note for Phase 15: this file does **not** set a Content-Security-Policy. The
 * nonce-based CSP in `SECURITY.md` section 12 is still that phase's work, and
 * it belongs here when it lands.
 */

export const LOCALE_COOKIE = 'NEXT_LOCALE';

/** A year: a language preference is not a session. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Paths that are not part of the localised site.
 *
 * The workshop, the API, the development showcase, and the files a crawler or
 * the framework fetches by exact name. A locale prefix on any of them would be
 * a 404 at best.
 */
const UNLOCALISED = [
  '/admin',
  '/api',
  '/dev',
  '/_next',
  '/assets',
  '/sitemap.xml',
  '/robots.txt',
  '/opengraph-image',
  '/favicon.ico',
];

function isUnlocalised(pathname: string): boolean {
  return UNLOCALISED.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  if (isUnlocalised(pathname)) return NextResponse.next();

  // A file with an extension — `/apple-touch-icon.png` and friends.
  if (/\.[a-z0-9]+$/i.test(pathname)) return NextResponse.next();

  const first = pathname.split('/')[1] ?? '';
  if (isLocale(first)) return NextResponse.next();

  const cookie = request.cookies.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(cookie)
    ? cookie
    : negotiateLocale(request.headers.get('accept-language')) || DEFAULT_LOCALE;

  const url = request.nextUrl.clone();
  url.pathname = pathname === '/' ? `/${locale}` : `/${locale}${pathname}`;

  const response = NextResponse.redirect(url);

  // Remember the negotiated choice, so the next bare link does not renegotiate
  // and so a visitor who switched language stays switched.
  if (!isLocale(cookie)) {
    response.cookies.set(LOCALE_COOKIE, locale, {
      maxAge: COOKIE_MAX_AGE,
      sameSite: 'lax',
      path: '/',
    });
  }

  return response;
}

export const config = {
  /*
   * Everything except the framework's own assets. The list above is what
   * actually decides; this matcher only keeps the middleware off the hot path
   * for static files.
   */
  matcher: ['/((?!_next/static|_next/image|assets|favicon.ico).*)'],
};
