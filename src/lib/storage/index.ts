import 'server-only';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { clientEnv, serverEnv } from '@/lib/env';

import { createLocalStorageAdapter } from './local';
import { createS3StorageAdapter } from './s3';
import type { StorageAdapter } from './types';

export type { StorageAdapter, PresignedUpload, ObjectHead, StoragePrefix } from './types';
export {
  isPublicMediaKey,
  isPublicModelKey,
  isValidStorageKey,
  mediaKeyFor,
  modelKeyFor,
  newObjectId,
  previewKeyFor,
  promotedKey,
  publicContentTypeFor,
  storageKeyFor,
} from './keys';

/**
 * The storage boundary.
 *
 * One adapter, chosen once. Everything above this module receives a
 * `StorageAdapter` and cannot discover which one it is.
 *
 * Two decisions here are worth stating, because both were wrong on the first
 * attempt:
 *
 * **The adapter is built lazily.** Constructing it at module evaluation made
 * `next build` fail on a machine with no bucket, because a build runs with
 * `NODE_ENV=production` and collects every route's module graph. A build is not
 * a request; refusing at build time makes the project unbuildable rather than
 * safe.
 *
 * **A real deployment is recognised by its origin, not by `NODE_ENV`.**
 * `npm run build && npm run start` on a laptop — which is how the end-to-end
 * suite runs the application — is also `NODE_ENV=production`, so keying the
 * refusal on that would have forced the test suite to either skip uploads or
 * point at a real bucket. What actually distinguishes a deployment is that it
 * serves a real origin. A site answering on its own domain with the filesystem
 * adapter would write customer artwork to an instance's ephemeral disk and lose
 * it on the next cold start, silently, and the business would find out when it
 * went to stitch the logo.
 */

function isLocalOrigin(): boolean {
  try {
    const { hostname } = new URL(clientEnv.NEXT_PUBLIC_SITE_URL);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

function createAdapter(): StorageAdapter {
  const configured =
    serverEnv.S3_ENDPOINT &&
    serverEnv.S3_BUCKET_PRIVATE &&
    serverEnv.S3_ACCESS_KEY_ID &&
    serverEnv.S3_SECRET_ACCESS_KEY;

  if (configured) {
    return createS3StorageAdapter({
      endpoint: serverEnv.S3_ENDPOINT!,
      region: serverEnv.S3_REGION,
      bucket: serverEnv.S3_BUCKET_PRIVATE!,
      accessKeyId: serverEnv.S3_ACCESS_KEY_ID!,
      secretAccessKey: serverEnv.S3_SECRET_ACCESS_KEY!,
    });
  }

  if (!isLocalOrigin()) {
    throw new Error(
      'Object storage is not configured. Set S3_ENDPOINT, S3_BUCKET_PRIVATE, ' +
        'S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY. See .env.example. ' +
        'The filesystem adapter is only available on a localhost origin.',
    );
  }

  return createLocalStorageAdapter({
    root: serverEnv.STORAGE_LOCAL_ROOT ?? join(tmpdir(), 'stitch-storage'),
    // Reuses the auth secret rather than adding a variable a developer must
    // set to run the project. It never signs anything that leaves development.
    secret: serverEnv.BETTER_AUTH_SECRET,
    baseUrl: clientEnv.NEXT_PUBLIC_SITE_URL,
  });
}

const globalForStorage = globalThis as unknown as { storage: StorageAdapter | undefined };

/** The adapter, built on first use and then reused. */
function adapter(): StorageAdapter {
  globalForStorage.storage ??= createAdapter();
  return globalForStorage.storage;
}

/**
 * The adapter, as a value.
 *
 * Every method forwards to `adapter()`, so the first *call* builds it and an
 * import does not. Call sites read as though this were the adapter itself,
 * which is the point — laziness is this module's problem, not theirs.
 */
export const storage: StorageAdapter = {
  get name() {
    return adapter().name;
  },
  presignPut: (input) => adapter().presignPut(input),
  presignGet: (input) => adapter().presignGet(input),
  put: (input) => adapter().put(input),
  head: (key) => adapter().head(key),
  getRange: (key, length) => adapter().getRange(key, length),
  get: (key) => adapter().get(key),
  move: (input) => adapter().move(input),
  delete: (key) => adapter().delete(key),
};

/** True when the filesystem adapter is in use. Gates the local upload route. */
export function usingLocalStorage(): boolean {
  try {
    return adapter().name === 'local';
  } catch {
    return false;
  }
}
