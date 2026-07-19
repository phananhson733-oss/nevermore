/**
 * Blob storage abstraction (spec §7.6, §13.3). Raw crawl/CSV payloads and export
 * bundles live in PRIVATE object storage; the canonical DB stores only the
 * object key + sha256 + row/byte count, never the bytes. For LOCAL dev we use a
 * filesystem-backed store (`LocalFsBlobStore`); hosted production uses
 * `SupabaseBlobStore` with private raw/export buckets behind this same interface.
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

/** The only append-only object families stored in the two private buckets. */
export const PRIVATE_BLOB_OBJECT_KINDS = [
  "raw",
  "raw-import",
  "snapshot-raw",
  "export",
] as const;

export type PrivateBlobObjectKind =
  (typeof PRIVATE_BLOB_OBJECT_KINDS)[number];

/** Keep maintenance pages bounded across local and hosted backends. */
export const MAX_BLOB_LIST_PAGE_SIZE = 1_000;

export interface BlobListInput {
  readonly kind: PrivateBlobObjectKind;
  /** Opaque backend cursor returned by the preceding page. */
  readonly cursor: string | null;
  readonly limit: number;
}

export interface BlobObjectMetadata {
  readonly key: string;
  /** Immutable upload timestamp, serialized as ISO-8601. */
  readonly createdAt: string;
}

export interface BlobListPage {
  readonly objects: readonly BlobObjectMetadata[];
  readonly nextCursor: string | null;
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
  /**
   * List one fixed private object family for conservative orphan maintenance.
   * Implementations must return only canonical keys of the requested kind.
   */
  list(input: BlobListInput): Promise<BlobListPage>;
}

/** Base class for storage failures that callers may handle without string matching. */
export class BlobStorageError extends Error {
  readonly key: string;

  constructor(message: string, key: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BlobStorageError";
    this.key = key;
  }
}

/** The final object key already exists, so an append-only write was refused. */
export class BlobObjectAlreadyExistsError extends BlobStorageError {
  constructor(key: string, options?: ErrorOptions) {
    super(`object already exists (append-only): ${key}`, key, options);
    this.name = "BlobObjectAlreadyExistsError";
  }
}

/** The requested private object does not exist. */
export class BlobObjectNotFoundError extends BlobStorageError {
  constructor(key: string, options?: ErrorOptions) {
    super(`object not found: ${key}`, key, options);
    this.name = "BlobObjectNotFoundError";
  }
}

/** The key is malformed or cannot be routed to one of the private buckets. */
export class InvalidBlobObjectKeyError extends BlobStorageError {
  constructor(key: string, detail = "malformed object key") {
    super(`${detail}: ${key}`, key);
    this.name = "InvalidBlobObjectKeyError";
  }
}

/** Hosted/local storage selection is incomplete or unsafe. */
export class BlobStoreConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlobStoreConfigurationError";
  }
}

const PRIVATE_BLOB_OBJECT_KIND_SET = new Set<string>(
  PRIVATE_BLOB_OBJECT_KINDS,
);

/** Runtime guard for maintenance inputs that may cross an untyped boundary. */
export function assertBlobListInput(input: BlobListInput): void {
  if (!PRIVATE_BLOB_OBJECT_KIND_SET.has(input.kind)) {
    throw new BlobStoreConfigurationError(
      "blob list kind must target a supported private object family",
    );
  }
  if (
    !Number.isSafeInteger(input.limit) ||
    input.limit <= 0 ||
    input.limit > MAX_BLOB_LIST_PAGE_SIZE
  ) {
    throw new BlobStoreConfigurationError(
      `blob list limit must be between 1 and ${MAX_BLOB_LIST_PAGE_SIZE}`,
    );
  }
  if (
    input.cursor !== null &&
    (typeof input.cursor !== "string" || input.cursor.length === 0)
  ) {
    throw new BlobStoreConfigurationError(
      "blob list cursor must be null or a non-empty opaque string",
    );
  }
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

/** Parse and validate a canonical four-segment object key. */
export function parseObjectKey(key: string): ObjectKeyParts {
  const segments = key.split("/");
  if (segments.length !== 4) {
    throw new InvalidBlobObjectKeyError(key);
  }
  const [kind, projectId, runId, nonce] = segments;
  try {
    assertSegment("kind", kind!);
    assertSegment("projectId", projectId!);
    assertSegment("runId", runId!);
    assertSegment("nonce", nonce!);
  } catch {
    throw new InvalidBlobObjectKeyError(key);
  }
  return { kind: kind!, projectId: projectId!, runId: runId!, nonce: nonce! };
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
