import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';

import { requireStaff } from '@/server/auth/guards';
import { getCurrentUserProfile } from '@/server/repositories/user-repository';

import { AdminMobileBar, AdminSidebar } from './admin-nav';

export const metadata: Metadata = {
  title: { default: 'Atelier', template: '%s · Atelier' },
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = 'force-dynamic';

/**
 * The admin shell, and the gate in front of it.
 *
 * The guard is here rather than in each page because "every admin route is
 * behind a staff check" is easier to prove when there is one check. Each page
 * and each action checks again on its own — a layout protects what is rendered,
 * never what is executed, and a server action is reachable without ever
 * rendering this file.
 *
 * A signed-out visitor is sent to sign in; a signed-in customer is sent home
 * rather than told an admin area exists.
 *
 * **The shape changed in Phase 14.5.** A centred 1200px column under a header
 * bar is a document layout, and the admin is not a document — it is a tool used
 * on a laptop for hours at a time. The sidebar is persistent from `lg` up and
 * the working area is full width up to a wide cap, so an eight-column table has
 * somewhere to be. Below `lg` the sidebar becomes a drawer behind a top bar.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const authorisation = await requireStaff();

  if (!authorisation.ok) {
    redirect(authorisation.reason === 'UNAUTHENTICATED' ? '/login?next=%2Fadmin' : '/');
  }

  const profile = await getCurrentUserProfile(authorisation.actor.userId);
  const actorName = profile?.name ?? profile?.email ?? null;

  return (
    <div className="bg-bg-sunken flex min-h-dvh flex-col lg:flex-row">
      <AdminMobileBar actorName={actorName} />
      <AdminSidebar actorName={actorName} />

      <main id="main" className="min-w-0 flex-1">
        <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-4 py-6 md:px-6 md:py-8 lg:gap-8 lg:px-10">
          {children}
        </div>
      </main>
    </div>
  );
}
