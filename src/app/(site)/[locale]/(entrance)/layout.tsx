import type { ReactNode } from 'react';

import { SiteShell } from '../shell';

/**
 * The way in, and the one part of the public site that never closes.
 *
 * `/login` lives here rather than in `(storefront)` for a single reason: the
 * workshop signs in through it. `/admin` sends a signed-out visitor to
 * `/login?next=%2Fadmin`, so putting sign-in behind the storefront's switch
 * would mean an owner who closed the shop and then lost their session had shut
 * themselves out of their own business with no way back.
 *
 * The group changes no URL — it is a folder in brackets — and the page looks
 * exactly as it did, because this renders the same shell the shop does.
 */
export default async function EntranceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  return <SiteShell locale={locale}>{children}</SiteShell>;
}
