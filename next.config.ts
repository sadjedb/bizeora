import type { NextConfig } from 'next';

/**
 * Foundation-level security headers.
 *
 * Only the headers that are safe to apply before any feature exists. The
 * nonce-based Content-Security-Policy described in docs/SECURITY.md section 12
 * requires middleware and is deliberately deferred to Phase 15 — a partial
 * script-src here would either break Next.js's inline bootstrap or provide
 * false assurance.
 *
 * The CSP below therefore restricts only directives that cannot break the
 * framework: framing, base URI, object embedding and form targets.
 */
const securityHeaders = [
  /*
   * No Content-Security-Policy here.
   *
   * It moved to `src/middleware.ts` in Phase 15, because the policy carries a
   * nonce and a nonce has to be minted per request. Two CSP headers would both
   * be enforced — a browser intersects them — so a leftover static one here
   * would silently narrow the real policy and be very hard to see.
   */
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    // Camera is not enabled here; the upload flow (Phase 9) will opt in.
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,

  /**
   * Build output directory.
   *
   * Overridable so a development server can run beside a production build
   * without the two fighting over `.next`. The end-to-end suite needs exactly
   * that: the design-system showcase is development-only, so proving it is
   * blocked in production and auditing its accessibility require both servers
   * at once. Unset everywhere else, which keeps the default.
   */
  distDir: process.env.NEXT_DIST_DIR ?? '.next',

  // Do not advertise the framework.
  poweredByHeader: false,

  typescript: {
    // Never ship a build that does not type-check.
    ignoreBuildErrors: false,
  },

  images: {
    // Local images only: shop photography is served from this origin, either
    // as a static file under `public/assets` or by the `/assets/[...path]`
    // route reading the storage adapter. A remote pattern is added the day the
    // public bucket moves to a CDN.
    formats: ['image/avif', 'image/webp'],
  },

  experimental: {
    serverActions: {
      /**
       * Shop photographs are uploaded through a server action.
       *
       * They have to pass through the server to be re-encoded and stripped of
       * EXIF before anything is written to a public prefix
       * (`server/services/media-service`), and the default 1 MB body limit
       * would refuse every photograph a phone produces. It matches
       * `MAX_SHOP_IMAGE_BYTES` in `domain/media`, which is what actually
       * enforces the limit — this only stops the framework refusing first.
       */
      bodySizeLimit: '12mb',
    },
  },

  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
