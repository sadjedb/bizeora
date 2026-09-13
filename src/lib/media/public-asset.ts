import { clientEnv } from '@/lib/env';

/**
 * Turning a stored object key into a URL a browser can fetch.
 *
 * Product images are stored as `storageKey` — a path inside the **public**
 * asset bucket, not a URL. `SECURITY.md` section 7 keeps customer design files
 * in a private bucket behind signed URLs; product photography is different,
 * being marketing material the business publishes deliberately, so it is served
 * straight from a CDN origin with no signing.
 *
 * The origin is `NEXT_PUBLIC_PUBLIC_ASSET_URL`, and it takes either form: a CDN
 * origin, or a root-relative path such as `/assets`, which serves the files in
 * `public/assets` and needs no infrastructure at all. The second is what this
 * project uses; the bucket the earlier phases were waiting for turned out not
 * to be a prerequisite for showing photography.
 *
 * With the variable unset this still returns `null` for every key, and the
 * media primitives render their placeholder. Returning `null` rather than
 * guessing a URL is the point: a broken image tells a visitor the site is
 * broken, whereas the placeholder tells them a photograph is not there yet.
 */
export function toPublicAssetUrl(storageKey: string | null | undefined): string | null {
  if (!storageKey) return null;

  const origin = clientEnv.NEXT_PUBLIC_PUBLIC_ASSET_URL;
  if (!origin) return null;

  // Keys are stored without a leading slash; tolerate one either way rather
  // than emitting a double slash that some CDNs treat as a different object.
  return `${origin}/${storageKey.replace(/^\/+/, '')}`;
}
