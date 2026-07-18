import path from "node:path";
import type { Db, DbHandle, PgBoss } from "@sf/db";
import { LocalFsBlobStore, type BlobStore } from "@sf/sources";
import type { Logger } from "@sf/observability";
import { resolveLlmClientConfig, type WorkerEnv } from "./env.ts";

/**
 * Shared worker runtime dependencies threaded into every job handler. The blob
 * store is filesystem-backed for local dev (Supabase Storage swaps in later); the
 * credential key decrypts Google tokens for GSC/GA4 sync (spec §14.3).
 */
export interface WorkerContext {
  readonly db: Db;
  readonly boss: PgBoss;
  readonly blobStore: BlobStore;
  readonly credentialKey: Buffer;
  readonly appOrigin: string;
  /**
   * LLM config for artifact generation (spec §10.2); the client is built per job.
   * `baseUrl`/`authScheme` are set when the OpenAI provider is reached via an
   * Azure OpenAI deployment (same models/API, different host + auth header).
   */
  readonly openai: {
    readonly apiKey: string;
    readonly model: string;
    readonly baseUrl?: string;
    readonly authScheme?: "bearer" | "api-key";
  };
  readonly logger: Logger;
}

export function buildWorkerContext(input: {
  db: DbHandle;
  boss: PgBoss;
  env: WorkerEnv;
  logger: Logger;
}): WorkerContext {
  const baseDir =
    process.env["SF_BLOB_DIR"] ?? path.join(process.cwd(), ".data", "blob");
  return {
    db: input.db.db,
    boss: input.boss,
    blobStore: new LocalFsBlobStore(baseDir),
    credentialKey: Buffer.from(input.env.CREDENTIAL_ENCRYPTION_KEY, "base64"),
    appOrigin: input.env.APP_ORIGIN,
    openai: resolveLlmClientConfig(input.env),
    logger: input.logger,
  };
}
