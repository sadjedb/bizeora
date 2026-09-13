import { NextResponse } from 'next/server';

import { publicContentTypeFor, storage } from '@/lib/storage';

/**
 * The public asset origin, when the application is its own CDN.
 *
 * `NEXT_PUBLIC_PUBLIC_ASSET_URL` is `/assets` in development and on a
 * single-server deployment, so `toPublicAssetUrl('media/…')` produces
 * `/assets/media/…` and lands here. Pointed at a bucket or a CDN instead, this
 * route is simply never reached — which is the intended production shape, and
 * the reason the storage key is the same string either way.
 *
 * **Static files win.** Next serves anything present in `public/` before it
 * consults a route, so the placeholder photography in `public/assets/products/…`
 * is still served from disk without passing through here. This route answers
 * only for keys the storage adapter holds.
 *
 * Two things it will not do:
 *
 *   - **Serve anything outside the public prefixes.** `publicContentTypeFor` is
 *     the whole authorisation model of this endpoint, and it is a whitelist:
 *     `designs/` and `previews/` hold customer artwork, reachable only through
 *     a signed URL after an ownership check (`SECURITY.md` section 6). A path
 *     that is not a public key is a 404, not a 403 — this endpoint tells nobody
 *     what exists.
 *   - **Guess a content type.** The same function that grants access states the
 *     type, because both facts come from the prefix and neither is sniffed from
 *     a name. Everything under `media/` was written by `prepareShopImage`,
 *     which produces JPEG and nothing else; everything under `models/` was
 *     parsed by `inspectGlb` before it was written (ADR-036).
 */

export const dynamic = 'force-dynamic';

/** A year, immutable: the key contains a UUID, so the bytes never change. */
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const key = path.join('/');

  const contentType = publicContentTypeFor(key);
  if (!contentType) return new NextResponse(null, { status: 404 });

  const bytes = await storage.get(key).catch(() => null);
  if (!bytes) return new NextResponse(null, { status: 404 });

  return new NextResponse(bytes as unknown as BodyInit, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': CACHE_CONTROL,
      // The bytes are ours and re-encoded, but a public image endpoint that
      // lets a browser decide what a file is remains a bad idea.
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
