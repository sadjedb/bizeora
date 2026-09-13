import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

import { isValidStorageKey } from './keys';
import type { ObjectHead, PresignedUpload, StorageAdapter } from './types';

/**
 * The filesystem adapter — development and automated tests.
 *
 * Its purpose is that **the flow is identical to production**. The browser
 * still asks for an upload authorisation, still PUTs the bytes somewhere that
 * is not the application's own action handler, and the server still validates
 * the stored object afterwards. Only the destination differs, so an integration
 * test exercises the real sequence rather than a shortcut around it.
 *
 * The signature is an HMAC over the key, the method, the content type, the
 * maximum length and an expiry, which is the same shape a provider signature
 * has — a claim about one object, for one operation, until one moment. The
 * route handler in `app/api/storage/local` verifies it before writing a byte.
 *
 * It is never selected in production: `lib/storage/index.ts` refuses.
 */

export type LocalStorageOptions = {
  /** Directory the objects live under. Outside the served tree. */
  root: string;
  /** Signing key for the local signatures. Never a production credential. */
  secret: string;
  /** Origin the browser PUTs to — the application's own, in dev and test. */
  baseUrl: string;
};

export type LocalSignaturePayload = {
  key: string;
  method: 'PUT' | 'GET';
  contentType?: string;
  maxBytes?: number;
  expiresAt: number;
};

function canonical(payload: LocalSignaturePayload): string {
  return [
    payload.method,
    payload.key,
    payload.contentType ?? '',
    String(payload.maxBytes ?? 0),
    String(payload.expiresAt),
  ].join('\n');
}

export function signLocalUrl(payload: LocalSignaturePayload, secret: string): string {
  return createHmac('sha256', secret).update(canonical(payload)).digest('base64url');
}

/**
 * Constant-time verification, and expiry before signature.
 *
 * A local adapter is not a security boundary, but writing it as though it were
 * keeps the test honest: a test that can forge an upload URL is not testing the
 * thing production does.
 */
export function verifyLocalSignature(
  payload: LocalSignaturePayload,
  signature: string,
  secret: string,
  now: Date = new Date(),
): boolean {
  if (payload.expiresAt < now.getTime()) return false;

  const expected = Buffer.from(signLocalUrl(payload, secret));
  const provided = Buffer.from(signature);

  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

export function createLocalStorageAdapter(options: LocalStorageOptions): StorageAdapter {
  const root = resolve(options.root);

  /**
   * Resolve a key to a path, and refuse anything that escapes the root.
   *
   * Keys are server-generated and already pattern-checked, so this is the
   * second of two locks on the same door. Traversal is the failure that ends
   * with someone reading `.env`, and two cheap checks are the right price.
   */
  function pathFor(key: string): string {
    if (!isValidStorageKey(key)) throw new Error(`Refused storage key: ${key}`);

    const path = resolve(join(root, key));
    if (path !== root && !path.startsWith(root + sep)) {
      throw new Error(`Refused storage key: ${key}`);
    }
    return path;
  }

  async function writeObject(key: string, body: Uint8Array): Promise<void> {
    const path = pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  return {
    name: 'local',

    async presignPut(input): Promise<PresignedUpload> {
      const expiresAt = new Date(Date.now() + input.expiresInSeconds * 1000);
      const payload: LocalSignaturePayload = {
        key: input.key,
        method: 'PUT',
        contentType: input.contentType,
        maxBytes: input.maxBytes,
        expiresAt: expiresAt.getTime(),
      };

      const query = new URLSearchParams({
        key: input.key,
        contentType: input.contentType,
        maxBytes: String(input.maxBytes),
        expires: String(expiresAt.getTime()),
        signature: signLocalUrl(payload, options.secret),
      });

      return {
        url: `${options.baseUrl}/api/storage/local?${query.toString()}`,
        method: 'PUT',
        headers: { 'content-type': input.contentType },
        expiresAt,
      };
    },

    async presignGet(input) {
      const expiresAt = new Date(Date.now() + input.expiresInSeconds * 1000);
      const payload: LocalSignaturePayload = {
        key: input.key,
        method: 'GET',
        expiresAt: expiresAt.getTime(),
      };

      const query = new URLSearchParams({
        key: input.key,
        expires: String(expiresAt.getTime()),
        signature: signLocalUrl(payload, options.secret),
      });

      if (input.downloadFilename) query.set('filename', input.downloadFilename);

      return {
        url: `${options.baseUrl}/api/storage/local?${query.toString()}`,
        expiresAt,
      };
    },

    async put(input) {
      await writeObject(input.key, input.body);
    },

    async head(key): Promise<ObjectHead | null> {
      try {
        const info = await stat(pathFor(key));
        // The filesystem records no content type, and the production adapter's
        // answer here is the *client's* declaration anyway. Neither is evidence.
        return { byteSize: info.size, contentType: null };
      } catch {
        return null;
      }
    },

    async getRange(key, length) {
      try {
        const buffer = await readFile(pathFor(key));
        return new Uint8Array(buffer.subarray(0, length));
      } catch {
        return null;
      }
    },

    async get(key) {
      try {
        return new Uint8Array(await readFile(pathFor(key)));
      } catch {
        return null;
      }
    },

    async move(input) {
      const from = pathFor(input.from);
      const to = pathFor(input.to);
      await mkdir(dirname(to), { recursive: true });
      await rename(from, to);
    },

    async delete(key) {
      await rm(pathFor(key), { force: true });
    },
  };
}
