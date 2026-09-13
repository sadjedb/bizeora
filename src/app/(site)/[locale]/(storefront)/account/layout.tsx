import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';

import { Container, Section, Stack } from '@/components/layout/layout';
import { requireCustomer } from '@/server/auth/guards';

import { AccountNav } from './account-nav';

export const metadata: Metadata = {
  title: { default: 'Mon compte', template: '%s · Mon compte' },
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = 'force-dynamic';

/**
 * The portal shell, and the gate in front of it.
 *
 * One guard for the whole area, so "every account route requires a signed-in
 * customer" is a property of the route group rather than a habit each page has
 * to remember. Every page and every action checks again on its own — a layout
 * protects what is rendered, and a server action is reachable without ever
 * rendering one.
 *
 * A signed-out visitor is sent to sign in **with a return path**, so following
 * a link from an e-mail lands where it meant to. Staff are sent to the shop
 * rather than told the portal exists; 12.3 makes the portal a customer's place,
 * and a staff member has the admin area instead.
 */
export default async function AccountLayout({ children }: { children: ReactNode }) {
  const authorisation = await requireCustomer();

  if (!authorisation.ok) {
    redirect(authorisation.reason === 'UNAUTHENTICATED' ? '/login?next=%2Faccount' : '/');
  }

  return (
    <Section spacing="compact" className="pb-20 lg:pb-28">
      <Container>
        {/*
         * A rail and a working area, from `lg`.
         *
         * Before Phase 14.5 the portal was a horizontal strip of six chips with
         * the page stacked underneath, which is the shape of a tab bar and gave
         * a customer no sense of a place they had arrived at. Sticky, because
         * `Mes commandes` is a long page and the way out should not be at the
         * bottom of it.
         */}
        <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-start lg:gap-14">
          <div className="lg:sticky lg:top-28">
            <AccountNav />
          </div>

          <Stack gap={8} className="min-w-0">
            {children}
          </Stack>
        </div>
      </Container>
    </Section>
  );
}
