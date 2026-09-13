import type { MetadataRoute } from 'next';

import { absoluteUrl, seoIndexable } from '@/lib/seo';

/**
 * `robots.txt`.
 *
 * **This is not access control.** A `Disallow` is a request that a well-behaved
 * crawler honours and that anybody else ignores; every route named below is
 * already refused to the wrong actor by `server/auth/guards` and by the
 * ownership filters in the repositories (`SECURITY.md` sections 3 and 4). What
 * this file prevents is a private *URL* appearing in a search result — the
 * account area indexed under a customer's order number, the admin discoverable
 * by anyone who types a query — not access to the page behind it.
 *
 * The disallow list is written out rather than derived. A rule generated from
 * the route tree would silently change when the tree does, and the failure mode
 * of that is a private area quietly becoming crawlable.
 *
 * While the deployment is not indexable, the whole site is disallowed. That is
 * the same switch the pages' `noindex` uses, so the two cannot disagree.
 */
export const dynamic = 'force-dynamic';

/** Application surfaces that must never appear in a search result. */
const PRIVATE_PATHS: readonly string[] = [
  '/admin',
  '/account',
  '/cart',
  '/checkout',
  '/login',
  '/register',
  // A guest's order confirmation, addressed by a one-time token.
  '/order',
  // Development-only, and 404 in production.
  '/dev',
  // Route handlers: the auth endpoints, the scheduler, storage.
  '/api',
];

export default function robots(): MetadataRoute.Robots {
  if (!seoIndexable) {
    return {
      rules: [{ userAgent: '*', disallow: '/' }],
    };
  }

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Prefix matching: `/admin` covers `/admin` and everything under it.
        disallow: [...PRIVATE_PATHS],
      },
    ],
    sitemap: absoluteUrl('/sitemap.xml'),
    host: absoluteUrl('/'),
  };
}
