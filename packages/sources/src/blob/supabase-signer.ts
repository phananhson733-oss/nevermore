/**
 * Export-bundle download signer (AC-039, spec §10.5, §14.4). Export objects live in
 * a PRIVATE Supabase Storage bucket; the DB stores only the object key, and the
 * download URL is minted on demand, signed for a short TTL, and only from a
 * committed bundle row (spec §13.3).
 *
 * This module is the production `signedUrl` path. It is deliberately a focused
 * `DownloadUrlSigner`, NOT a full `BlobStore`: it signs an existing object key into
 * a time-limited URL and does nothing else. LocalFs / Memory keep their dev URLs for
 * local dev through the same `DownloadUrlSigner` shape (`blobStoreDownloadSigner`).
 *
 * Two safety guarantees, both unit-tested WITHOUT a live Supabase:
 *  - project scope: a key whose projectId segment does not match the caller's
 *    project is rejected BEFORE any network call, so a wrong-project key can never
 *    be signed into a valid URL. The caller maps this to 404 (never a signed URL).
 *  - bucket scope: the signer only ever signs into its configured `EXPORT_BUCKET`,
 *    so an object cannot be signed out of a different bucket.
 *
 * Object lifecycle (spec §12.3): signed URLs have a 15-minute (900s) TTL — enforced
 * here, per URL — while the 30-day object retention is a Supabase bucket lifecycle
 * policy configured on the bucket (out of application-code scope; local dev cannot
 * enforce it). See docs/RUNBOOK.md "Export regeneration".
 *
 * Signing uses the Supabase Storage REST endpoint
 * `POST /storage/v1/object/sign/{bucket}/{path}` with the service-role bearer, via
 * an injectable `fetch` (Node global by default) so tests run fully offline. No
 * Supabase SDK dependency is required.
 */

import { randomBytes } from "node:crypto";
import {
  BlobObjectNotFoundError,
  objectKey,
  parseObjectKey,
  type BlobStore,
} from "../storage/types.ts";
import {
  ResponseBodyTooLargeError,
  cancelResponseBody,
  createRequestAbortScope,
  readBoundedResponseJson,
  readBoundedResponseText,
} from "../storage/bounded-response.ts";

/** The injectable fetch surface (Node global `fetch` by default). */
export type FetchLike = typeof globalThis.fetch;

/** The init half of a `fetch` call, derived from the fetch surface itself. */
type FetchInit = NonNullable<Parameters<FetchLike>[1]>;

// An object key is `<kind>/<projectId>/<runId>/<nonce>` (see `objectKey`).
const OBJECT_KEY_SEGMENT_COUNT = 4;
const EXPORT_KIND = "export";
const EXPORT_NONCE_BYTES = 12;

/** Export download URLs are always valid for exactly 15 minutes. */
export const EXPORT_DOWNLOAD_URL_TTL_SECONDS = 15 * 60;
/** Signing is a small control-plane request and must not hang a web request. */
export const DEFAULT_SUPABASE_SIGN_TIMEOUT_MS = 15_000;
/** Both success and error signing envelopes are expected to be tiny JSON. */
export const SUPABASE_SIGN_RESPONSE_MAX_BYTES = 64 * 1024;

/**
 * Explicit download-URL contract shared by the Supabase signer and the dev stores.
 * `expiresInSeconds` makes the per-URL TTL an explicit part of every call (AC-039:
 * 900s / 15 minutes for export downloads).
 */
export interface DownloadUrlSigner {
  signDownloadUrl(
    key: string,
    options: { readonly expiresInSeconds: number },
  ): Promise<string>;
}

/** Thrown when a key is not under the caller's project. Callers map this to 404. */
export class ObjectOutOfProjectScopeError extends Error {
  readonly key: string;
  readonly projectId: string;
  constructor(key: string, projectId: string) {
    super(`object key is not under project ${projectId}`);
    this.name = "ObjectOutOfProjectScopeError";
    this.key = key;
    this.projectId = projectId;
  }
}

/** Thrown when the Supabase Storage sign request fails or returns an unusable body. */
export class SupabaseSignError extends Error {
  readonly status: number | undefined;

  constructor(message: string, options?: { readonly status?: number; readonly cause?: unknown }) {
    super(message, {
      ...(options && "cause" in options ? { cause: options.cause } : {}),
    });
    this.name = "SupabaseSignError";
    this.status = options?.status;
  }
}

/** A caller tried to weaken or extend the fixed export download lifetime. */
export class InvalidDownloadUrlTtlError extends Error {
  readonly requestedSeconds: number;

  constructor(requestedSeconds: number) {
    super(
      `export download URL TTL must be exactly ${EXPORT_DOWNLOAD_URL_TTL_SECONDS} seconds`,
    );
    this.name = "InvalidDownloadUrlTtlError";
    this.requestedSeconds = requestedSeconds;
  }
}

/**
 * Mint a fresh, unguessable export object key `export/<projectId>/<runId>/<nonce>`.
 * A new random nonce per call means every regenerate of the same project/run lands
 * on a DISTINCT, non-overwritable key (spec §13.3; AC-039 "30 天后可重新生成").
 */
export function mintExportObjectKey(parts: {
  readonly projectId: string;
  readonly runId: string;
}): string {
  return objectKey({
    kind: EXPORT_KIND,
    projectId: parts.projectId,
    runId: parts.runId,
    nonce: randomBytes(EXPORT_NONCE_BYTES).toString("hex"),
  });
}

/** Extract the projectId segment from an object key, or `null` if malformed. */
function projectIdOfKey(key: string): string | null {
  const segments = key.split("/");
  if (segments.length !== OBJECT_KEY_SEGMENT_COUNT) return null;
  try {
    return parseObjectKey(key).projectId;
  } catch {
    return null;
  }
}

/**
 * Assert `key` belongs to `projectId`. Throws `ObjectOutOfProjectScopeError` for a
 * wrong-project or malformed key so it is rejected BEFORE any signing round-trip.
 */
export function assertKeyInProjectScope(key: string, projectId: string): void {
  if (projectIdOfKey(key) !== projectId) {
    throw new ObjectOutOfProjectScopeError(key, projectId);
  }
}

function assertExportKeyInProjectScope(key: string, projectId: string): void {
  assertKeyInProjectScope(key, projectId);
  try {
    if (parseObjectKey(key).kind !== EXPORT_KIND) {
      throw new ObjectOutOfProjectScopeError(key, projectId);
    }
  } catch (error) {
    if (error instanceof ObjectOutOfProjectScopeError) throw error;
    throw new ObjectOutOfProjectScopeError(key, projectId);
  }
}

function assertExportDownloadTtl(expiresInSeconds: number): void {
  if (expiresInSeconds !== EXPORT_DOWNLOAD_URL_TTL_SECONDS) {
    throw new InvalidDownloadUrlTtlError(expiresInSeconds);
  }
}

function isMissingObjectResponse(status: number, body: string): boolean {
  return (
    status === 404 ||
    (status >= 400 &&
      status < 500 &&
      status !== 408 &&
      status !== 409 &&
      status !== 429 &&
      /object\s+not\s+found|not_found|"error"\s*:\s*"not.?found"/i.test(body))
  );
}

export interface SupabaseSignerConfig {
  /** `SUPABASE_URL`, e.g. https://xyz.supabase.co (a trailing slash is tolerated). */
  readonly supabaseUrl: string;
  /** `SUPABASE_SERVICE_ROLE_KEY`. Never logged; used only as the bearer + apikey. */
  readonly serviceRoleKey: string;
  /** `EXPORT_BUCKET` private bucket; the only bucket this signer can sign into. */
  readonly bucket: string;
  /** The caller's project scope; keys outside it are rejected before signing. */
  readonly projectId: string;
  /** Injectable fetch for offline tests (defaults to the Node global). */
  readonly fetch?: FetchLike;
  /** Per-sign timeout, including bounded response decoding. */
  readonly requestTimeoutMs?: number;
  /** Optional caller lifecycle signal composed with the request timeout. */
  readonly signal?: AbortSignal;
}

interface SignRequest {
  readonly url: string;
  readonly init: FetchInit;
}

/** Encode an object key for a URL path, preserving `/` between segments. */
function encodeKeyPath(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

function signerTimeoutMs(value: number | undefined): number {
  const resolved = value ?? DEFAULT_SUPABASE_SIGN_TIMEOUT_MS;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new SupabaseSignError("Supabase signer timeout is invalid");
  }
  return resolved;
}

/** Build the Supabase Storage sign request. Pure: no network, deterministic. */
export function buildSignRequest(
  config: SupabaseSignerConfig,
  key: string,
  expiresInSeconds: number,
): SignRequest {
  const base = config.supabaseUrl.replace(/\/+$/, "");
  const path = encodeKeyPath(key);
  const bucket = encodeURIComponent(config.bucket);
  return {
    url: `${base}/storage/v1/object/sign/${bucket}/${path}`,
    init: {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.serviceRoleKey}`,
        apikey: config.serviceRoleKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({ expiresIn: expiresInSeconds }),
    },
  };
}

/**
 * Resolve Supabase's `{ signedURL }` (a path relative to `/storage/v1`) into an
 * absolute URL. Throws `SupabaseSignError` when the field is missing.
 */
export function resolveSignedUrl(supabaseUrl: string, body: unknown): string {
  const signedPath =
    typeof body === "object" && body !== null && "signedURL" in body
      ? (body as { signedURL?: unknown }).signedURL
      : undefined;
  if (typeof signedPath !== "string" || signedPath.length === 0) {
    throw new SupabaseSignError("Supabase sign response is missing signedURL");
  }
  const base = supabaseUrl.replace(/\/+$/, "");
  const rel = signedPath.startsWith("/") ? signedPath : `/${signedPath}`;
  return `${base}/storage/v1${rel}`;
}

/**
 * Create a project-scoped Supabase Storage download signer (AC-039). The returned
 * `signDownloadUrl` rejects out-of-scope keys before signing and otherwise returns a
 * short-lived absolute signed URL for the configured export bucket.
 */
export function createSupabaseDownloadSigner(
  config: SupabaseSignerConfig,
): DownloadUrlSigner {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const requestTimeoutMs = signerTimeoutMs(config.requestTimeoutMs);
  return {
    async signDownloadUrl(key, options): Promise<string> {
      assertExportKeyInProjectScope(key, config.projectId);
      assertExportDownloadTtl(options.expiresInSeconds);
      const { url, init } = buildSignRequest(
        config,
        key,
        options.expiresInSeconds,
      );
      const abortScope = createRequestAbortScope(requestTimeoutMs, [
        config.signal,
        init.signal,
      ]);
      let responseStatus: number | undefined;
      try {
        if (abortScope.signal.aborted) throw abortScope.signal.reason;
        const res = await fetchImpl(url, {
          ...init,
          signal: abortScope.signal,
        });
        responseStatus = res.status;
        if (!res.ok) {
          if (res.status === 404) {
            await cancelResponseBody(res);
            throw new BlobObjectNotFoundError(key);
          }
          let detail: string;
          try {
            detail = await readBoundedResponseText(
              res,
              SUPABASE_SIGN_RESPONSE_MAX_BYTES,
              abortScope.signal,
            );
          } catch (error) {
            if (abortScope.timedOut()) {
              throw new SupabaseSignError("Supabase sign request timed out", {
                status: 408,
              });
            }
            if (error instanceof ResponseBodyTooLargeError) {
              throw new SupabaseSignError(
                "Supabase sign error response exceeded the size limit",
                { status: res.status },
              );
            }
            throw new SupabaseSignError(
              "Supabase sign error response could not be read",
              { status: res.status },
            );
          }
          if (isMissingObjectResponse(res.status, detail)) {
            throw new BlobObjectNotFoundError(key);
          }
          throw new SupabaseSignError(
            `Supabase sign returned HTTP ${res.status}`,
            { status: res.status },
          );
        }

        let body: unknown;
        try {
          body = await readBoundedResponseJson(
            res,
            SUPABASE_SIGN_RESPONSE_MAX_BYTES,
            abortScope.signal,
          );
        } catch (error) {
          if (abortScope.timedOut()) {
            throw new SupabaseSignError("Supabase sign request timed out", {
              status: 408,
            });
          }
          if (error instanceof ResponseBodyTooLargeError) {
            throw new SupabaseSignError(
              "Supabase sign response exceeded the size limit",
            );
          }
          throw new SupabaseSignError(
            "Supabase sign returned a non-JSON body",
          );
        }
        return resolveSignedUrl(config.supabaseUrl, body);
      } catch (error) {
        if (
          error instanceof SupabaseSignError ||
          error instanceof BlobObjectNotFoundError
        ) {
          throw error;
        }
        throw new SupabaseSignError(
          abortScope.timedOut()
            ? "Supabase sign request timed out"
            : "Supabase sign request failed",
          {
            ...(abortScope.timedOut()
              ? { status: 408 }
              : responseStatus !== undefined && responseStatus >= 400
                ? { status: responseStatus }
                : {}),
          },
        );
      } finally {
        abortScope.dispose();
      }
    },
  };
}

/**
 * Adapt a `BlobStore` to the `DownloadUrlSigner` seam for local dev. LocalFs / Memory
 * keep returning their dev URLs, but through the explicit `{ expiresInSeconds }` TTL
 * contract and with the same project-scope rejection as production.
 */
export function blobStoreDownloadSigner(
  store: Pick<BlobStore, "signedUrl">,
  projectId: string,
): DownloadUrlSigner {
  return {
    async signDownloadUrl(key, options): Promise<string> {
      assertExportKeyInProjectScope(key, projectId);
      assertExportDownloadTtl(options.expiresInSeconds);
      return store.signedUrl(key, options.expiresInSeconds);
    },
  };
}
