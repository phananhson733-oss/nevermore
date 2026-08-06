import type { Db, DbHandle, PgBoss } from "@sf/db";
import {
  createBlobStoreFromEnv,
  type BlobStorageEnvironment,
  type BlobStore,
  type StorageFetch,
} from "@sf/sources";
import type { Logger } from "@sf/observability";
import { resolveLlmClientConfig, type WorkerEnv } from "./env.ts";

/**
 * Shared worker runtime dependencies threaded into every job handler. Hosted
 * workers use the same private Supabase buckets as web; local/test workers must
 * receive the same explicit filesystem path. The credential key decrypts Google
 * tokens for GSC/GA4 sync (spec §14.3).
 */
export interface WorkerContext {
  readonly db: Db;
  readonly boss: PgBoss;
  readonly blobStore: BlobStore;
  readonly credentialKey: Buffer;
  readonly appOrigin: string;
  readonly googleOAuth: {
    readonly clientId: string;
    readonly clientSecret: string;
  };
  /**
   * DataForSEO is a worker-owned, account-level provider. Credentials are read
   * only from the worker secret store and are never carried in queue payloads,
   * source-connection config, canonical rows, or logs. This remains optional at
   * the type boundary so rolling workers and focused non-collection test
   * contexts fail closed; `buildWorkerContext` always supplies it.
   */
  readonly dataForSeo?: {
    readonly enabled: boolean;
    readonly login: string | null;
    readonly password: string | null;
    readonly maxKeywords: number;
    readonly maxCompetitors: number;
    readonly backlinksEnabled?: boolean;
    readonly maxBacklinks?: number;
    readonly maxReferringDomains?: number;
    readonly maxBacklinkPages?: number;
    readonly maxSourceVerifications?: number;
    /** Offline provider seam used only by collection fixtures. */
    readonly fetch?: typeof globalThis.fetch;
  };
  /**
   * LLM config for artifact generation (spec §10.2); the client is built per job.
   * `baseUrl`/`authScheme` are set when the OpenAI provider is reached via an
   * Azure OpenAI deployment (same models/API, different host + auth header).
   */
  readonly openai: {
    readonly apiKey: string;
    readonly model: string;
    /** Explicit only when a deployment needs a non-default sampling policy. */
    readonly temperature?: number;
    readonly baseUrl?: string;
    readonly authScheme?: "bearer" | "api-key";
  };
  /** Whether optional non-English/Chinese finding localization may call an LLM. */
  readonly findingSummariesEnabled: boolean;
  readonly logger: Logger;
  /** Aborted synchronously when process shutdown begins. */
  readonly signal?: AbortSignal;
}

/** Canonical correlation keys carried by every project-scoped queue job. */
export interface RunContextPayload {
  readonly runId: string;
  readonly workspaceId: string;
  readonly projectId: string;
}

/**
 * Bind canonical queue correlation keys to the logger context. The structured
 * logger deliberately drops these reserved keys from ordinary event fields,
 * so passing them only as fields would make production job logs untraceable.
 */
export function withRunContext(
  ctx: WorkerContext,
  payload: RunContextPayload,
): WorkerContext {
  return {
    ...ctx,
    logger: ctx.logger.child({
      runId: payload.runId,
      workspaceId: payload.workspaceId,
      projectId: payload.projectId,
    }),
  };
}

export interface WorkerStorageFactoryOptions {
  readonly environment?: string;
  readonly fetch?: StorageFetch;
}

export function createWorkerBlobStore(
  env: BlobStorageEnvironment,
  options: WorkerStorageFactoryOptions = {},
): BlobStore {
  return createBlobStoreFromEnv(env, {
    environment:
      options.environment ?? process.env["NODE_ENV"] ?? "development",
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
}

export function buildWorkerContext(input: {
  db: DbHandle;
  boss: PgBoss;
  env: WorkerEnv;
  logger: Logger;
  signal: AbortSignal;
}): WorkerContext {
  return {
    db: input.db.db,
    boss: input.boss,
    blobStore: createWorkerBlobStore(input.env),
    credentialKey: Buffer.from(input.env.CREDENTIAL_ENCRYPTION_KEY, "base64"),
    appOrigin: input.env.APP_ORIGIN,
    googleOAuth: {
      clientId: input.env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: input.env.GOOGLE_OAUTH_CLIENT_SECRET,
    },
    dataForSeo: {
      enabled: input.env.DATAFORSEO_ENABLED === "true",
      login: input.env.DATAFORSEO_LOGIN ?? null,
      password: input.env.DATAFORSEO_PASSWORD ?? null,
      maxKeywords: input.env.DATAFORSEO_MAX_KEYWORDS,
      maxCompetitors: input.env.DATAFORSEO_MAX_COMPETITORS,
      backlinksEnabled:
        input.env.DATAFORSEO_ENABLED === "true" &&
        input.env.DATAFORSEO_BACKLINKS_ENABLED === "true",
      maxBacklinks: input.env.DATAFORSEO_MAX_BACKLINKS,
      maxReferringDomains: input.env.DATAFORSEO_MAX_REFERRING_DOMAINS,
      maxBacklinkPages: input.env.DATAFORSEO_MAX_BACKLINK_PAGES,
      maxSourceVerifications:
        input.env.DATAFORSEO_MAX_BACKLINK_SOURCE_VERIFICATIONS,
    },
    openai: resolveLlmClientConfig(input.env),
    findingSummariesEnabled:
      input.env.FINDING_SUMMARIES_ENABLED === "true",
    logger: input.logger,
    signal: input.signal,
  };
}
