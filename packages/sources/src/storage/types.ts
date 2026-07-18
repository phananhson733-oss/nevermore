/**
 * Blob storage abstraction (spec §7.6, §13.3). Raw crawl/CSV payloads and export
 * bundles live in PRIVATE object storage; the canonical DB stores only the
 * object key + sha256 + row/byte count, never the bytes. For LOCAL dev we use a
 * filesystem-backed store (`LocalFsBlobStore`); Supabase Storage (private
 * bucket, real signed URLs) is swapped in for production behind this same
 * interface.
 *
 * Final object keys are append-only (spec §13.3): a `put` never overwrites an
 * existing key, so a committed key always points at immutable bytes.
 */

/** A single upload. `body` is the raw payload; `contentType` is advisory metadata. */
export interface BlobPutInput {
  readonly key: string;
  readonly body: Buffer;
  readonly contentType: string;
}

/** The receipt persisted to canonical rows: key + integrity digest + size. */
export interface BlobPutResult {
  readonly key: string;
  readonly sha256: string;
  readonly bytes: number;
}

export interface BlobStore {
  /** Store bytes at `key`. Rejects if `key` already exists (append-only). */
  put(input: BlobPutInput): Promise<BlobPutResult>;
  /** Fetch bytes, or `null` if the key does not exist. */
  get(key: string): Promise<Buffer | null>;
  /** A time-limited URL for private read access. */
  signedUrl(key: string, ttlSeconds: number): Promise<string>;
  /** Remove the object. Idempotent: deleting a missing key is a no-op. */
  delete(key: string): Promise<void>;
}

/** The parts of an object key. Each becomes a path segment. */
export interface ObjectKeyParts {
  readonly projectId: string;
  readonly runId: string;
  readonly kind: string;
  readonly nonce: string;
}

// A single path segment: no separators, no traversal, no empties.
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

function assertSegment(name: string, value: string): void {
  if (value === "." || value === ".." || !SAFE_SEGMENT.test(value)) {
    throw new Error(`objectKey ${name} segment is invalid: ${JSON.stringify(value)}`);
  }
}

/**
 * Build an unguessable, non-overwritable object key
 * `"<kind>/<projectId>/<runId>/<nonce>"`. The caller supplies a random `nonce`
 * so the final key cannot be predicted or collided with by another run.
 */
export function objectKey(parts: ObjectKeyParts): string {
  assertSegment("kind", parts.kind);
  assertSegment("projectId", parts.projectId);
  assertSegment("runId", parts.runId);
  assertSegment("nonce", parts.nonce);
  return `${parts.kind}/${parts.projectId}/${parts.runId}/${parts.nonce}`;
}
