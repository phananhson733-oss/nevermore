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
import { objectKey } from "../storage/types.ts";
import type { BlobStore } from "../storage/types.ts";

/** The injectable fetch surface (Node global `fetch` by default). */
export type FetchLike = typeof globalThis.fetch;

/** The init half of a `fetch` call, derived from the fetch surface itself. */
type FetchInit = NonNullable<Parameters<FetchLike>[1]>;

// An object key is `<kind>/<projectId>/<runId>/<nonce>` (see `objectKey`).
const OBJECT_KEY_SEGMENT_COUNT = 4;
const PROJECT_ID_SEGMENT_INDEX = 1;
const EXPORT_KIND = "export";
const EXPORT_NONCE_BYTES = 12;

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
  constructor(message: string) {
    super(message);
    this.name = "SupabaseSignError";
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
  const projectId = segments[PROJECT_ID_SEGMENT_INDEX];
  return projectId && projectId.length > 0 ? projectId : null;
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
}

interface SignRequest {
  readonly url: string;
  readonly init: FetchInit;
}

/** Encode an object key for a URL path, preserving `/` between segments. */
function encodeKeyPath(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

/** Build the Supabase Storage sign request. Pure: no network, deterministic. */
export function buildSignRequest(
  config: SupabaseSignerConfig,
  key: string,
  expiresInSeconds: number,
): SignRequest {
  const base = config.supabaseUrl.replace(/\/+$/, "");
  const path = encodeKeyPath(key);
  return {
    url: `${base}/storage/v1/object/sign/${config.bucket}/${path}`,
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
  return {
    async signDownloadUrl(key, options): Promise<string> {
      assertKeyInProjectScope(key, config.projectId);
      const { url, init } = buildSignRequest(config, key, options.expiresInSeconds);
      let res: Response;
      try {
        res = await fetchImpl(url, init);
      } catch (error) {
        const detail = error instanceof Error ? error.message : "unknown";
        throw new SupabaseSignError(`Supabase sign request failed: ${detail}`);
      }
      if (!res.ok) {
        throw new SupabaseSignError(`Supabase sign returned HTTP ${res.status}`);
      }
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        throw new SupabaseSignError("Supabase sign returned a non-JSON body");
      }
      return resolveSignedUrl(config.supabaseUrl, body);
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
      assertKeyInProjectScope(key, projectId);
      return store.signedUrl(key, options.expiresInSeconds);
    },
  };
}
