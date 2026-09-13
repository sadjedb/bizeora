import 'server-only';

/**
 * The storage adapter interface.
 *
 * `ARCHITECTURE.md` section 9: "All access is through `lib/storage`'s adapter
 * interface (`put`, `presignPut`, `presignGet`, `delete`, `head`), so R2, S3 or
 * Supabase Storage are interchangeable." This file is that interface, and it is
 * the only storage vocabulary the rest of the application knows.
 *
 * Nothing above `lib/storage` may import a provider SDK, hold a credential, or
 * construct a provider URL. A service asks for a signed URL and receives a
 * string; it cannot tell which provider produced it, which is what makes the
 * decision reversible.
 */

/** Where an object sits in its lifecycle (`SECURITY.md` section 7). */
/**
 * Where an object lives, and therefore who may read it.
 *
 * The first three are private: customer artwork on its way in, customer artwork
 * that has been verified, and the rasters generated from it. The last two are
 * public — the shop's own photographs (`domain/media`, ADR-032) and the garment
 * models the builder wraps a design round (`domain/model3d`, ADR-036).
 *
 * The two public prefixes are separate because what makes them safe is
 * different, and a single `public` prefix would let one file be written under
 * the other's rules. A photograph is safe because it was **re-encoded** — the
 * bytes on the shelf are ours. A model is safe because it was **inspected and
 * refused if it reached outside itself** — the bytes are the modeller's, kept
 * exactly, and the guarantee is about what they reference rather than what they
 * are.
 */
export type StoragePrefix = 'quarantine' | 'designs' | 'previews' | 'media' | 'models';

export type PresignedUpload = {
  /** The URL the browser PUTs to. Never a credential — a signature with a clock. */
  url: string;
  method: 'PUT';
  /** Headers the browser must send for the signature to verify. */
  headers: Record<string, string>;
  expiresAt: Date;
};

export type ObjectHead = {
  byteSize: number;
  /** What the provider recorded, which is what the *client* declared. Not evidence. */
  contentType: string | null;
};

export type StorageAdapter = {
  /** Names the implementation, for logs and for the health check. Never a secret. */
  readonly name: string;

  /**
   * A time-limited PUT for one key, bound to a content type and a maximum
   * length so an oversized or retyped body fails at the provider rather than
   * at our expense.
   */
  presignPut(input: {
    key: string;
    contentType: string;
    maxBytes: number;
    expiresInSeconds: number;
  }): Promise<PresignedUpload>;

  /**
   * A short-lived GET, issued per request after an authorisation check.
   *
   * `downloadFilename` makes the response an attachment: `SECURITY.md`
   * section 6 requires every design file to be saved rather than rendered, and
   * that is enforced at the provider so it holds even if a URL escapes.
   */
  presignGet(input: {
    key: string;
    expiresInSeconds: number;
    downloadFilename?: string;
  }): Promise<{ url: string; expiresAt: Date }>;

  /** Server-side write, used for generated previews rather than for uploads. */
  put(input: { key: string; body: Uint8Array; contentType: string }): Promise<void>;

  /** Size and declared type, without transferring the object. */
  head(key: string): Promise<ObjectHead | null>;

  /**
   * The first `length` bytes.
   *
   * Validation reads a range rather than the whole object: a magic number lives
   * in the first eight bytes, and pulling 25 MB into a serverless function to
   * look at eight of them is how a validation step becomes a denial of service.
   * Raster processing asks for the whole object separately and deliberately.
   */
  getRange(key: string, length: number): Promise<Uint8Array | null>;

  get(key: string): Promise<Uint8Array | null>;

  /** Promotion out of quarantine. Copy-then-delete where the provider has no move. */
  move(input: { from: string; to: string }): Promise<void>;

  delete(key: string): Promise<void>;
};
