'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { Footer, type FooterColumn, type FooterProps } from '@/components/layout/footer';
import { Header, type HeaderLabels, type NavItem } from '@/components/layout/header';

/**
 * The storefront shell: header, main, footer.
 *
 * A client component for one reason — the header marks the active navigation
 * item, and that needs the current path. Everything language-dependent arrives
 * as props from the layout above, which is a server component and has the
 * dictionary; nothing here reads a locale or a translation itself.
 *
 * The cart **count** is deliberately not passed: reading it needs the cart
 * cookie, and a cookie read in this shell would opt every page beneath it — the
 * homepage, the shop, the product pages — out of static rendering to keep a
 * badge current. The cart page itself shows the truth.
 */
export function StorefrontChrome({
  nav,
  columns,
  contact,
  labels,
  footerMadeIn,
  children,
}: {
  nav: readonly NavItem[];
  columns: readonly FooterColumn[];
  contact: FooterProps['contact'];
  labels: HeaderLabels;
  footerMadeIn: string;
  children: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <>
      <Header
        items={nav}
        currentPath={pathname}
        labels={labels}
        searchSlot={null}
        cartHref="/cart"
        accountHref="/account"
      />

      <main id="main" className="flex-1">
        {children}
      </main>

      <Footer columns={columns} contact={contact} madeIn={footerMadeIn} />
    </>
  );
}
