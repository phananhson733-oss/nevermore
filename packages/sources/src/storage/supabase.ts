import { createHash } from "node:crypto";
import {
  BlobObjectAlreadyExistsError,
  BlobObjectNotFoundError,
  BlobStoreConfigurationError,
  BlobStorageError,
  InvalidBlobObjectKeyError,
  assertBlobListInput,
  parseObjectKey,
  type BlobListInput,
  type BlobListPage,
  type BlobPutInput,
  type BlobPutResult,
  type BlobStore,
  type PrivateBlobObjectKind,
} from "./types.ts";
import {
  cancelResponseBody,
  createRequestAbortScope,
  readBoundedResponseBytes,
  readBoundedResponseJson,
  readBoundedResponseText,
  type RequestAbortScope,
} from "./bounded-response.ts";

export type StorageFetch = typeof globalThis.fetch;

/** Hosted object operations may not occupy a worker indefinitely. */
export const DEFAULT_SUPABASE_STORAGE_TIMEOUT_MS = 60_000;
/** CSV imports are capped at 20 MiB; 64 MiB leaves room for internal exports. */
export const DEFAULT_SUPABASE_DOWNLOAD_MAX_BYTES = 64 * 1024 * 1024;
/** Supabase error and signed-URL envelopes should remain tiny. */
export const SUPABASE_METADATA_RESPONSE_MAX_BYTES = 64 * 1024;
/** A list-v2 page contains metadata only, but up to 1,000 bounded entries. */
export const SUPABASE_LIST_RESPONSE_MAX_BYTES = 1024 * 1024;

export interface SupabaseBlobStoreConfig {
  readonly supabaseUrl: string;
  readonly serviceRoleKey: string;
  readonly rawBucket: string;
  readonly exportBucket: string;
  readonly fetch?: StorageFetch;
  /** Per-operation timeout, including decoded response consumption. */
  readonly requestTimeoutMs?: number;
  /** Maximum decoded bytes returned by `get`; defaults to 64 MiB. */
  readonly maxDownloadBytes?: number;
  /** Optional lifecycle signal composed with every operation timeout. */
  readonly signal?: AbortSignal;
}

type StorageOperation = "put" | "get" | "sign" | "delete" | "list";

/** A Supabase dependency/network/protocol failure, distinct from object absence. */
export class SupabaseStorageError extends BlobStorageError {
  readonly operation: StorageOperation;
  readonly status: number | undefined;

  constructor(
    operation: StorageOperation,
    key: string,
    options?: { readonly status?: number; readonly cause?: unknown },
  ) {
    const suffix = options?.status === undefined ? "" : ` (HTTP ${options.status})`;
    super(`Supabase Storage ${operation} failed${suffix}`, key, {
      ...(options && "cause" in options ? { cause: options.cause } : {}),
    });
    this.name = "SupabaseStorageError";
    this.operation = operation;
    this.status = options?.status;
  }
}

const RAW_KINDS = new Set(["raw", "raw-import", "snapshot-raw"]);
const SAFE_BUCKET = /^[A-Za-z0-9._-]+$/;

function requireConfigValue(name: string, value: string): void {
  if (!value.trim()) {
    throw new BlobStoreConfigurationError(`${name} must not be empty`);
  }
}

function requireBucket(name: string, value: string): void {
  requireConfigValue(name, value);
  if (value === "." || value === ".." || !SAFE_BUCKET.test(value)) {
    throw new BlobStoreConfigurationError(`${name} is invalid`);
  }
}

function encodePath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}

function permitsBodySemanticHint(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

function isMissing(status: number, body: string): boolean {
  return (
    status === 404 ||
    (status !== 409 &&
      permitsBodySemanticHint(status) &&
      /object\s+not\s+found|not_found|"error"\s*:\s*"not.?found"/i.test(body))
  );
}

function positiveInteger(
  name: string,
  value: number | undefined,
  fallback: number,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new BlobStoreConfigurationError(`${name} must be a positive integer`);
  }
  return resolved;
}

function isDuplicate(status: number, body: string): boolean {
  return (
    status === 409 ||
    (status !== 404 &&
      permitsBodySemanticHint(status) &&
      /duplicate|already\s+exists/i.test(body))
  );
}

function resolveSignedUrl(supabaseUrl: string, body: unknown): string | null {
  const signedPath =
    typeof body === "object" && body !== null && "signedURL" in body
      ? (body as { signedURL?: unknown }).signedURL
      : undefined;
  if (typeof signedPath !== "string" || !signedPath) return null;
  const base = supabaseUrl.replace(/\/+$/, "");
  const relative = signedPath.startsWith("/") ? signedPath : `/${signedPath}`;
  return `${base}/storage/v1${relative}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeListedObjectKey(
  bucket: string,
  kind: PrivateBlobObjectKind,
  value: Record<string, unknown>,
): string | null {
  const raw =
    typeof value["key"] === "string"
      ? value["key"]
      : typeof value["name"] === "string"
        ? value["name"]
        : null;
  if (!raw) return null;
  const withoutBucket = raw.startsWith(`${bucket}/`)
    ? raw.slice(bucket.length + 1)
    : raw;
  const candidates = withoutBucket.startsWith(`${kind}/`)
    ? [withoutBucket]
    : [withoutBucket, `${kind}/${withoutBucket}`];
  for (const candidate of candidates) {
    try {
      if (parseObjectKey(candidate).kind === kind) return candidate;
    } catch {
      // Try the next safe normalization form before failing the whole page.
    }
  }
  return null;
}

function parseListPage(
  body: unknown,
  bucket: string,
  input: BlobListInput,
): BlobListPage | null {
  const envelope = asRecord(body);
  if (
    !envelope ||
    typeof envelope["hasNext"] !== "boolean" ||
    !Array.isArray(envelope["folders"]) ||
    !Array.isArray(envelope["objects"]) ||
    envelope["objects"].length > input.limit
  ) {
    return null;
  }
  const objects: Array<{ key: string; createdAt: string }> = [];
  const seenKeys = new Set<string>();
  for (const value of envelope["objects"]) {
    const object = asRecord(value);
    const key = object
      ? normalizeListedObjectKey(bucket, input.kind, object)
      : null;
    const createdAt = object?.["created_at"];
    if (
      !key ||
      seenKeys.has(key) ||
      typeof createdAt !== "string" ||
      !Number.isFinite(Date.parse(createdAt))
    ) {
      return null;
    }
    seenKeys.add(key);
    objects.push({ key, createdAt: new Date(createdAt).toISOString() });
  }
  const hasNext = envelope["hasNext"];
  const nextCursor = envelope["nextCursor"];
  if (
    hasNext &&
    (typeof nextCursor !== "string" ||
      nextCursor.length === 0 ||
      nextCursor === input.cursor)
  ) {
    return null;
  }
  return {
    objects,
    nextCursor: hasNext ? (nextCursor as string) : null,
  };
}

/**
 * Service-role Supabase Storage implementation for the two private application
 * buckets. Keys are routed solely from their validated kind segment.
 */
export class SupabaseBlobStore implements BlobStore {
  readonly #baseUrl: string;
  readonly #serviceRoleKey: string;
  readonly #rawBucket: string;
  readonly #exportBucket: string;
  readonly #fetch: StorageFetch;
  readonly #requestTimeoutMs: number;
  readonly #maxDownloadBytes: number;
  readonly #signal: AbortSignal | undefined;

  constructor(config: SupabaseBlobStoreConfig) {
    requireConfigValue("supabaseUrl", config.supabaseUrl);
    requireConfigValue("serviceRoleKey", config.serviceRoleKey);
    requireBucket("rawBucket", config.rawBucket);
    requireBucket("exportBucket", config.exportBucket);
    this.#baseUrl = config.supabaseUrl.replace(/\/+$/, "");
    this.#serviceRoleKey = config.serviceRoleKey;
    this.#rawBucket = config.rawBucket;
    this.#exportBucket = config.exportBucket;
    this.#fetch = config.fetch ?? globalThis.fetch;
    this.#requestTimeoutMs = positiveInteger(
      "requestTimeoutMs",
      config.requestTimeoutMs,
      DEFAULT_SUPABASE_STORAGE_TIMEOUT_MS,
    );
    this.#maxDownloadBytes = positiveInteger(
      "maxDownloadBytes",
      config.maxDownloadBytes,
      DEFAULT_SUPABASE_DOWNLOAD_MAX_BYTES,
    );
    this.#signal = config.signal;
  }

  #route(key: string): { readonly bucket: string; readonly path: string } {
    const parts = parseObjectKey(key);
    const bucket =
      parts.kind === "export"
        ? this.#exportBucket
        : RAW_KINDS.has(parts.kind)
          ? this.#rawBucket
          : null;
    if (!bucket) {
      throw new InvalidBlobObjectKeyError(key, "unsupported object kind");
    }
    return { bucket, path: encodePath(key) };
  }

  #bucketForKind(kind: PrivateBlobObjectKind): string {
    return kind === "export" ? this.#exportBucket : this.#rawBucket;
  }

  #headers(extra?: Readonly<Record<string, string>>): Record<string, string> {
    return {
      authorization: `Bearer ${this.#serviceRoleKey}`,
      apikey: this.#serviceRoleKey,
      ...extra,
    };
  }

  async #withResponse<T>(
    operation: StorageOperation,
    key: string,
    url: string,
    init: RequestInit,
    consume: (response: Response, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const abortScope: RequestAbortScope = createRequestAbortScope(
      this.#requestTimeoutMs,
      [this.#signal, init.signal],
    );
    let responseStatus: number | undefined;
    try {
      if (abortScope.signal.aborted) throw abortScope.signal.reason;
      const response = await this.#fetch(url, {
        ...init,
        signal: abortScope.signal,
      });
      responseStatus = response.status;
      return await consume(response, abortScope.signal);
    } catch (cause) {
      if (
        cause instanceof SupabaseStorageError ||
        cause instanceof BlobObjectAlreadyExistsError ||
        cause instanceof BlobObjectNotFoundError
      ) {
        throw cause;
      }
      throw new SupabaseStorageError(operation, key, {
        ...(abortScope.timedOut()
          ? { status: 408 }
          : responseStatus !== undefined && responseStatus >= 400
            ? { status: responseStatus }
            : {}),
      });
    } finally {
      abortScope.dispose();
    }
  }

  async put(input: BlobPutInput): Promise<BlobPutResult> {
    const { bucket, path } = this.#route(input.key);
    const body = Buffer.from(input.body);
    return this.#withResponse(
      "put",
      input.key,
      `${this.#baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${path}`,
      {
        method: "POST",
        headers: this.#headers({
          "content-type": input.contentType,
          "x-upsert": "false",
        }),
        body,
      },
      async (response, signal) => {
        if (!response.ok) {
          if (response.status === 409) {
            await cancelResponseBody(response);
            throw new BlobObjectAlreadyExistsError(input.key);
          }
          const detail = await readBoundedResponseText(
            response,
            SUPABASE_METADATA_RESPONSE_MAX_BYTES,
            signal,
          );
          if (isDuplicate(response.status, detail)) {
            throw new BlobObjectAlreadyExistsError(input.key);
          }
          throw new SupabaseStorageError("put", input.key, {
            status: response.status,
          });
        }
        await cancelResponseBody(response);
        return {
          key: input.key,
          sha256: createHash("sha256").update(body).digest("hex"),
          bytes: body.length,
        };
      },
    );
  }

  async get(key: string): Promise<Buffer | null> {
    const { bucket, path } = this.#route(key);
    return this.#withResponse(
      "get",
      key,
      `${this.#baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${path}`,
      { method: "GET", headers: this.#headers() },
      async (response, signal) => {
        if (!response.ok) {
          if (response.status === 404) {
            await cancelResponseBody(response);
            return null;
          }
          const detail = await readBoundedResponseText(
            response,
            SUPABASE_METADATA_RESPONSE_MAX_BYTES,
            signal,
          );
          if (isMissing(response.status, detail)) return null;
          throw new SupabaseStorageError("get", key, {
            status: response.status,
          });
        }
        return Buffer.from(
          await readBoundedResponseBytes(
            response,
            this.#maxDownloadBytes,
            signal,
          ),
        );
      },
    );
  }

  async signedUrl(key: string, ttlSeconds: number): Promise<string> {
    const { bucket, path } = this.#route(key);
    return this.#withResponse(
      "sign",
      key,
      `${this.#baseUrl}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${path}`,
      {
        method: "POST",
        headers: this.#headers({ "content-type": "application/json" }),
        body: JSON.stringify({ expiresIn: ttlSeconds }),
      },
      async (response, signal) => {
        if (!response.ok) {
          if (response.status === 404) {
            await cancelResponseBody(response);
            throw new BlobObjectNotFoundError(key);
          }
          const detail = await readBoundedResponseText(
            response,
            SUPABASE_METADATA_RESPONSE_MAX_BYTES,
            signal,
          );
          if (isMissing(response.status, detail)) {
            throw new BlobObjectNotFoundError(key);
          }
          throw new SupabaseStorageError("sign", key, {
            status: response.status,
          });
        }
        const body = await readBoundedResponseJson(
          response,
          SUPABASE_METADATA_RESPONSE_MAX_BYTES,
          signal,
        );
        const url = resolveSignedUrl(this.#baseUrl, body);
        if (!url) throw new SupabaseStorageError("sign", key);
        return url;
      },
    );
  }

  async delete(key: string): Promise<void> {
    const { bucket } = this.#route(key);
    return this.#withResponse(
      "delete",
      key,
      `${this.#baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}`,
      {
        method: "DELETE",
        headers: this.#headers({ "content-type": "application/json" }),
        body: JSON.stringify({ prefixes: [key] }),
      },
      async (response, signal) => {
        if (response.ok || response.status === 404) {
          await cancelResponseBody(response);
          return;
        }
        const detail = await readBoundedResponseText(
          response,
          SUPABASE_METADATA_RESPONSE_MAX_BYTES,
          signal,
        );
        if (isMissing(response.status, detail)) return;
        throw new SupabaseStorageError("delete", key, {
          status: response.status,
        });
      },
    );
  }

  async list(input: BlobListInput): Promise<BlobListPage> {
    assertBlobListInput(input);
    const bucket = this.#bucketForKind(input.kind);
    return this.#withResponse(
      "list",
      `${input.kind}/`,
      `${this.#baseUrl}/storage/v1/object/list-v2/${encodeURIComponent(bucket)}`,
      {
        method: "POST",
        headers: this.#headers({ "content-type": "application/json" }),
        body: JSON.stringify({
          prefix: `${input.kind}/`,
          ...(input.cursor === null ? {} : { cursor: input.cursor }),
          limit: input.limit,
          with_delimiter: false,
          sortBy: { column: "name", order: "asc" },
        }),
      },
      async (response, signal) => {
        if (!response.ok) {
          await readBoundedResponseText(
            response,
            SUPABASE_METADATA_RESPONSE_MAX_BYTES,
            signal,
          );
          throw new SupabaseStorageError("list", `${input.kind}/`, {
            status: response.status,
          });
        }
        const body = await readBoundedResponseJson(
          response,
          SUPABASE_LIST_RESPONSE_MAX_BYTES,
          signal,
        );
        const page = parseListPage(body, bucket, input);
        if (!page) throw new SupabaseStorageError("list", `${input.kind}/`);
        return page;
      },
    );
  }
}
