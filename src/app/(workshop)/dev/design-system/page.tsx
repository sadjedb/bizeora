import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { isProd } from '@/lib/env';

import { DesignSystemShowcase } from './showcase';

/**
 * The design-system showcase.
 *
 * Development only. `notFound()` in production means the route does not exist
 * on a deployed site rather than merely being unlinked — an internal page that
 * is only unlisted is a page that gets found. It is also `noindex` for the
 * preview deployments where it does render.
 *
 * It is not in any navigation, and it contains no business functionality: every
 * value on it is a literal in this file, so nothing here can drift into being
 * a real feature.
 */

/**
 * Rendered per request, not at build time.
 *
 * The guard below asks what environment it is running in, and a statically
 * prerendered page answers that question once, during the build, on the
 * machine that ran it. Since the workshop moved into its own route group this
 * page became prerenderable — and a production deployment started serving the
 * showcase it is supposed to hide. Rendering on demand puts the question back
 * where it belongs.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Design system',
  robots: { index: false, follow: false },
};

export default function DesignSystemPage() {
  if (isProd) notFound();

  return <DesignSystemShowcase />;
}
