import 'server-only';

import { headers } from 'next/headers';

import { NONCE_HEADER } from '@/middleware';

/**
 * The nonce this request's inline scripts must carry.
 *
 * The middleware mints one per request, puts it in the policy it sends to the
 * browser, and forwards it on the request headers; this is the other end of
 * that. A component that renders an inline `<script>` asks for it here.
 *
 * ## Reading it makes the route dynamic, and that is the point
 *
 * `headers()` is request data, so any route that reaches this function renders
 * per request. That is not an accident of the implementation — it is what a
 * nonce *is*. A value that is the same for every visitor is not a nonce, and a
 * page cached with one baked in would hand every visitor the same token. The
 * cost is recorded in ADR-041 rather than worked around.
 *
 * ## Why it can be absent
 *
 * Returns `undefined` rather than throwing when the header is not there. Two
 * real cases: a request that never passed through the middleware (its matcher
 * excludes `_next/static`), and `next build`, which renders pages with no
 * request at all. In both, a script with no nonce attribute is correct — there
 * is no policy in force to satisfy.
 */
export async function scriptNonce(): Promise<string | undefined> {
  const store = await headers();

  return store.get(NONCE_HEADER) ?? undefined;
}
