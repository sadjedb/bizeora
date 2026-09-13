import 'server-only';

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { ObjectHead, PresignedUpload, StorageAdapter } from './types';

/**
 * The S3-compatible adapter — Cloudflare R2 in production (ADR-009).
 *
 * Every provider-specific line in the project is in this file. Nothing above
 * `lib/storage` imports the SDK, sees a credential, or knows that "R2" is a
 * word, which is what makes ADR-009's "R2, S3 or Supabase Storage are
 * interchangeable" true rather than aspirational.
 *
 * R2 is addressed as S3 with `forcePathStyle` and a fixed `auto` region. The
 * two operations that matter for security are the presigns:
 *
 *   - **`presignPut`** is bound to a key, a content type and a content-length
 *     range. A signature is not a licence to write anywhere; it authorises one
 *     object, of one type, up to one size, until one moment.
 *   - **`presignGet`** carries `ResponseContentDisposition: attachment` and
 *     `ResponseContentType: application/octet-stream` whenever it signs a
 *     customer's own file, so `SECURITY.md` section 6's "serve as an
 *     attachment" is enforced by the provider. A URL that escapes still
 *     downloads rather than renders — the control that keeps a hostile SVG
 *     inert. A generated preview is signed without them: its bytes are a
 *     JPEG this server re-encoded, and it is meant to be displayed.
 */

/**
 * A filename safe to place inside a `Content-Disposition` header.
 *
 * Quotes, backslashes and newlines would end the header value early — a
 * response-header injection carried by a filename the customer chose.
 */
function safeFilename(name: string): string {
  return name.replace(/["\\\r\n]/g, '');
}

export type S3StorageOptions = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export function createS3StorageAdapter(options: S3StorageOptions): StorageAdapter {
  const client = new S3Client({
    region: options.region,
    endpoint: options.endpoint,
    // R2 and most S3-compatible services address buckets by path, not by
    // subdomain. Virtual-hosted style silently 404s against them.
    forcePathStyle: true,
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    },
  });

  const bucket = options.bucket;

  async function readBody(key: string, range?: string): Promise<Uint8Array | null> {
    try {
      const result = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key, Range: range }),
      );
      if (!result.Body) return null;
      return new Uint8Array(await result.Body.transformToByteArray());
    } catch {
      return null;
    }
  }

  return {
    name: 's3',

    async presignPut(input): Promise<PresignedUpload> {
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: input.key,
        ContentType: input.contentType,
        // Signed, so a client that sends a different length fails at the
        // provider. The size is re-verified by a HEAD afterwards regardless:
        // this bounds the cost, the HEAD establishes the fact.
        ContentLength: input.maxBytes,
      });

      const url = await getSignedUrl(client, command, {
        expiresIn: input.expiresInSeconds,
        signableHeaders: new Set(['content-type']),
      });

      return {
        url,
        method: 'PUT',
        headers: { 'content-type': input.contentType },
        expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000),
      };
    },

    async presignGet(input) {
      // A download filename means "this is the customer's own file": it goes
      // out as an opaque attachment so it is saved, never rendered. Without
      // one the object is a preview this server generated, and it keeps its
      // own re-encoded content type so an `<img>` can display it.
      const attachment = input.downloadFilename
        ? {
            ResponseContentDisposition: `attachment; filename="${safeFilename(input.downloadFilename)}"`,
            ResponseContentType: 'application/octet-stream',
          }
        : {};

      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: input.key,
        ...attachment,
      });

      const url = await getSignedUrl(client, command, {
        expiresIn: input.expiresInSeconds,
      });

      return { url, expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000) };
    },

    async put(input) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
        }),
      );
    },

    async head(key): Promise<ObjectHead | null> {
      try {
        const result = await client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: key }),
        );
        return {
          byteSize: result.ContentLength ?? 0,
          contentType: result.ContentType ?? null,
        };
      } catch {
        return null;
      }
    },

    async getRange(key, length) {
      return readBody(key, `bytes=0-${Math.max(0, length - 1)}`);
    },

    async get(key) {
      return readBody(key);
    },

    async move(input) {
      // S3 has no move. Copy then delete, in that order, so a failure leaves
      // the object where it was rather than nowhere.
      await client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          CopySource: `${bucket}/${input.from}`,
          Key: input.to,
        }),
      );
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: input.from }));
    },

    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
