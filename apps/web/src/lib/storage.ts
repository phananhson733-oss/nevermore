import path from "node:path";
import {
  blobStoreDownloadSigner,
  LocalFsBlobStore,
  type BlobStore,
  type DownloadUrlSigner,
} from "@sf/sources";

/**
 * Blob storage accessor (spec §7.6, §13.3). LOCAL dev uses a filesystem-backed
 * store under `.data/blob`; the hosted deployment swaps in a Supabase Storage
 * implementation of the same `BlobStore` interface (the swap point is here). Raw
 * imports and export bundles are the only blobs; the DB keeps only the object key
 * + sha256 (never the payload).
 */

let store: BlobStore | undefined;

export function getBlobStore(): BlobStore {
  if (!store) {
    const baseDir =
      process.env["SF_BLOB_DIR"] ?? path.join(process.cwd(), ".data", "blob");
    store = new LocalFsBlobStore(baseDir);
  }
  return store;
}

/**
 * Project-scoped export-bundle download signer (AC-039, spec §10.5, §14.4). Local
 * dev signs the on-disk object through the filesystem store's dev URL, wrapped in
 * the explicit `{ expiresInSeconds }` TTL contract and project-scope check (an
 * out-of-project key rejects, which the caller maps to 404 — never a signed URL).
 *
 * The hosted deployment swaps the body here for the real Supabase signer — the same
 * `DownloadUrlSigner` seam — mirroring `getBlobStore()`:
 *   const { getEnv } = await import("@/env");
 *   const env = getEnv();
 *   return createSupabaseDownloadSigner({
 *     supabaseUrl: env.SUPABASE_URL,
 *     serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
 *     bucket: env.EXPORT_BUCKET,
 *     projectId,
 *   });
 * That path signs a 900s URL via `POST /storage/v1/object/sign/{bucket}/{path}`; the
 * 30-day object retention is a Supabase bucket lifecycle policy (out of code scope).
 */
export function getExportDownloadSigner(projectId: string): DownloadUrlSigner {
  return blobStoreDownloadSigner(getBlobStore(), projectId);
}
