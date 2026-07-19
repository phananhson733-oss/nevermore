import {
  blobStoreDownloadSigner,
  createBlobStoreFromEnv,
  createSupabaseDownloadSigner,
  resolveBlobStorageBackend,
  type BlobStorageEnvironment,
  type BlobStore,
  type DownloadUrlSigner,
  type StorageFetch,
} from "@sf/sources";
import { getEnv } from "@/env";

/**
 * Web and worker consume this identical environment contract. Production always
 * uses the two configured private Supabase buckets; local/test mode requires one
 * explicit absolute `SF_BLOB_DIR` shared by both processes.
 */
export interface WebStorageFactoryOptions {
  readonly environment?: string;
  readonly fetch?: StorageFetch;
}

function environmentOf(options: WebStorageFactoryOptions): string {
  return options.environment ?? process.env["NODE_ENV"] ?? "development";
}

export function createWebBlobStore(
  env: BlobStorageEnvironment,
  options: WebStorageFactoryOptions = {},
): BlobStore {
  return createBlobStoreFromEnv(env, {
    environment: environmentOf(options),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
}

/**
 * Create the project-scoped export signer for the selected backend. Hosted mode
 * signs only from `EXPORT_BUCKET`; local mode retains the same project and fixed
 * 900-second TTL checks through the BlobStore adapter.
 */
export function createWebExportDownloadSigner(
  env: BlobStorageEnvironment,
  projectId: string,
  options: WebStorageFactoryOptions = {},
): DownloadUrlSigner {
  const environment = environmentOf(options);
  const backend = resolveBlobStorageBackend({
    environment,
    ...(env.SF_BLOB_BACKEND ? { backend: env.SF_BLOB_BACKEND } : {}),
  });
  if (backend === "supabase") {
    return createSupabaseDownloadSigner({
      supabaseUrl: env.SUPABASE_URL,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
      bucket: env.EXPORT_BUCKET,
      projectId,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  }
  return blobStoreDownloadSigner(createWebBlobStore(env, options), projectId);
}

let store: BlobStore | undefined;

export function getBlobStore(): BlobStore {
  store ??= createWebBlobStore(getEnv());
  return store;
}

export function getExportDownloadSigner(projectId: string): DownloadUrlSigner {
  return createWebExportDownloadSigner(getEnv(), projectId);
}
