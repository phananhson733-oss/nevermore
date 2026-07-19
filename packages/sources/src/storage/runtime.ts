import { isAbsolute } from "node:path";
import { LocalFsBlobStore } from "./local-fs.ts";
import {
  SupabaseBlobStore,
  type StorageFetch,
  type SupabaseBlobStoreConfig,
} from "./supabase.ts";
import {
  BlobStoreConfigurationError,
  type BlobStore,
} from "./types.ts";

export type BlobStorageBackend = "local" | "supabase";

export interface RuntimeBlobStoreConfig {
  readonly environment: string;
  readonly backend?: BlobStorageBackend;
  readonly localDirectory?: string;
  readonly supabase?: Omit<SupabaseBlobStoreConfig, "fetch">;
  readonly fetch?: StorageFetch;
}

/** Shared environment contract consumed identically by web and worker. */
export interface BlobStorageEnvironment {
  readonly SUPABASE_URL: string;
  readonly SUPABASE_SERVICE_ROLE_KEY: string;
  readonly RAW_IMPORT_BUCKET: string;
  readonly EXPORT_BUCKET: string;
  readonly SF_BLOB_BACKEND?: BlobStorageBackend | undefined;
  readonly SF_BLOB_DIR?: string | undefined;
}

export interface BlobStoreFromEnvOptions {
  readonly environment: string;
  readonly fetch?: StorageFetch;
}

/** Resolve hosted/local mode without ever deriving a filesystem path from cwd. */
export function resolveBlobStorageBackend(
  config: Pick<RuntimeBlobStoreConfig, "environment" | "backend">,
): BlobStorageBackend {
  const hosted = config.environment === "production" || config.environment === "hosted";
  if (hosted && config.backend === "local") {
    throw new BlobStoreConfigurationError(
      "hosted/production mode requires Supabase blob storage",
    );
  }
  return hosted ? "supabase" : (config.backend ?? "local");
}

export function createRuntimeBlobStore(config: RuntimeBlobStoreConfig): BlobStore {
  const backend = resolveBlobStorageBackend(config);
  if (backend === "supabase") {
    if (!config.supabase) {
      throw new BlobStoreConfigurationError(
        "Supabase blob storage requires URL, service-role key, and raw/export buckets",
      );
    }
    return new SupabaseBlobStore({
      ...config.supabase,
      ...(config.fetch ? { fetch: config.fetch } : {}),
    });
  }

  if (!config.localDirectory || !isAbsolute(config.localDirectory)) {
    throw new BlobStoreConfigurationError(
      "local/test blob storage requires an explicit absolute SF_BLOB_DIR shared by web and worker",
    );
  }
  return new LocalFsBlobStore(config.localDirectory);
}

/** Build the common runtime config from the env names shared by both processes. */
export function createBlobStoreFromEnv(
  env: BlobStorageEnvironment,
  options: BlobStoreFromEnvOptions,
): BlobStore {
  return createRuntimeBlobStore({
    environment: options.environment,
    ...(env.SF_BLOB_BACKEND ? { backend: env.SF_BLOB_BACKEND } : {}),
    ...(env.SF_BLOB_DIR ? { localDirectory: env.SF_BLOB_DIR } : {}),
    supabase: {
      supabaseUrl: env.SUPABASE_URL,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
      rawBucket: env.RAW_IMPORT_BUCKET,
      exportBucket: env.EXPORT_BUCKET,
    },
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
}
