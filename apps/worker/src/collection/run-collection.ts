import {
  AsyncRunsRepository,
  collectionRunParametersHash,
  CollectionRunsRepository,
  contentHash,
  ProjectsRepository,
  SitePagesRepository,
  SitesRepository,
  SourceConnectionsRepository,
  SourceCredentialsRepository,
  toRunAttempt,
  type CollectionRunKeywordLibraryContext,
  type CollectionRunRow,
  type DbTx,
  type ProjectScope,
  type SiteRow,
  type SourceConnectionRow,
  type SourceCredentialRow,
} from "@sf/db";
import {
  BlobObjectAlreadyExistsError,
  BlobObjectNotFoundError,
  CREDENTIAL_CIPHER_VERSION,
  createCrawlAdapter,
  createDefaultCrawlFetcher,
  createDataForSeoAdapter,
  dataForSeoParamsFromCollectionScope,
  dataForSeoSnapshotSummary,
  createGa4Adapter,
  createGscAdapter,
  csvAdapter,
  decryptCredential,
  decodeCredentialEnvelope,
  encodeCredentialEnvelope,
  encryptCredential,
  HttpGoogleTokenRefresher,
  HttpGa4Client,
  HttpGscClient,
  HttpDataForSeoClient,
  parseDataForSeoCollectionScope,
  InvalidBlobObjectKeyError,
  isTransient,
  shouldRefreshCredential,
  SourceError,
  SupabaseStorageError,
  CRAWL_DATASET_KEY,
  CRAWL_METHOD_VERSION,
  DATAFORSEO_DATASET_KEY,
  DEFAULT_CRAWL_USER_AGENT,
  type CollectionContext,
  type CollectionResult,
  type CrawlEngineOptions,
  type CrawlFetcher,
  type CsvColumnMapping,
  type DataForSeoCollectionScope,
  type GoogleTokenFetch,
  type NormalizedObservation,
  type NormalizeContext,
  type OAuthCredentialEnvelope,
  type SourceErrorCode,
} from "@sf/sources";
import type { WorkerContext } from "../context.ts";
import { isTransientInfrastructureError } from "../handlers/transient-errors.ts";
import { persistCollectionResult, type CollectionOutcome } from "./persist.ts";
import {
  ProviderMetricAccumulator,
  type ProviderMetricOutcome,
} from "./provider-metrics.ts";

/**
 * Collection job runner (spec §7, §13.3). Claims the run (queued→running winner
 * only), builds the provider adapter (token-bound for GSC/GA4), collects +
 * normalizes, and persists atomically. Transient adapter errors re-throw so
 * pg-boss retries; permanent errors end the run `failed` with a stable code.
 */

const OBSERVATION_SCHEMA_VERSION = "0.2.0";
const DATASET_KEY: Record<string, string> = {
  crawl: CRAWL_DATASET_KEY,
  gsc: "gsc.page_query_daily.v1",
  ga4: "ga4.organic_landing_daily.v1",
  csv: "csv.keyword_gap.v1",
  dataforseo: DATAFORSEO_DATASET_KEY,
};

const COLLECTION_SHUTDOWN_RETRY_SUMMARY =
  "Collection was interrupted by worker shutdown; automatic retry is scheduled.";

/**
 * Stable queue-facing cancellation. It deliberately never retains the abort
 * reason or the provider error that happened to race shutdown.
 */
export class CollectionShutdownError extends SourceError {
  constructor() {
    super("UNAVAILABLE", "Collection interrupted by worker shutdown.");
    this.name = "CollectionShutdownError";
  }
}

export function collectionFailureForSignal(
  error: unknown,
  signal: AbortSignal | undefined,
): unknown {
  return signal?.aborted ? new CollectionShutdownError() : error;
}

function throwIfCollectionAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new CollectionShutdownError();
}

function transientRetrySummary(code: SourceErrorCode): string {
  switch (code) {
    case "RATE_LIMITED":
      return "Provider rate limit reached; automatic retry is scheduled.";
    case "TIMEOUT":
      return "Provider request timed out; automatic retry is scheduled.";
    case "UNAVAILABLE":
      return "Provider is temporarily unavailable; automatic retry is scheduled.";
    default:
      return "Provider network request failed; automatic retry is scheduled.";
  }
}

export interface TransientCollectionFailure {
  readonly code: SourceErrorCode;
  readonly summary: string;
}

function transientStorageFailure(
  error: SupabaseStorageError,
): TransientCollectionFailure | null {
  const status = error.status;
  if (status === undefined) {
    return {
      code: "NETWORK_ERROR",
      summary: "Storage network request failed; automatic retry is scheduled.",
    };
  }
  if (status === 408) {
    return {
      code: "TIMEOUT",
      summary: "Storage request timed out; automatic retry is scheduled.",
    };
  }
  if (status === 429) {
    return {
      code: "RATE_LIMITED",
      summary: "Storage rate limit reached; automatic retry is scheduled.",
    };
  }
  if (status >= 500) {
    return {
      code: "UNAVAILABLE",
      summary: "Storage is temporarily unavailable; automatic retry is scheduled.",
    };
  }
  return null;
}

function transientCollectionFailure(
  error: unknown,
): TransientCollectionFailure | null {
  if (error instanceof SourceError && isTransient(error.code)) {
    return { code: error.code, summary: transientRetrySummary(error.code) };
  }
  if (error instanceof SupabaseStorageError) {
    return transientStorageFailure(error);
  }
  // Collection snapshot collisions are frozen as permanent INVALID_RESPONSE:
  // they indicate append-only storage rejected the final write, not a retry-safe
  // export-style destination rollover.
  if (error instanceof BlobObjectAlreadyExistsError) {
    return null;
  }
  if (isTransientInfrastructureError(error)) {
    return {
      code: "UNAVAILABLE",
      summary:
        "Database or runtime infrastructure is temporarily unavailable; automatic retry is scheduled.",
    };
  }
  return null;
}

export function collectionFailureDecision(
  error: unknown,
  signal: AbortSignal | undefined,
): {
  readonly failure: unknown;
  readonly transient: TransientCollectionFailure | null;
} {
  const failure = collectionFailureForSignal(error, signal);
  return {
    failure,
    transient:
      failure instanceof CollectionShutdownError
        ? {
            code: failure.code,
            summary: COLLECTION_SHUTDOWN_RETRY_SUMMARY,
          }
        : transientCollectionFailure(failure),
  };
}

function permanentCollectionErrorCode(error: unknown): SourceErrorCode {
  if (error instanceof SourceError) return error.code;
  if (error instanceof InvalidBlobObjectKeyError) {
    return "INVALID_CONFIGURATION";
  }
  if (
    error instanceof BlobObjectAlreadyExistsError ||
    error instanceof BlobObjectNotFoundError
  ) {
    return "INVALID_RESPONSE";
  }
  if (error instanceof SupabaseStorageError) {
    return error.status === 400 || error.status === 401 || error.status === 403
      ? "INVALID_CONFIGURATION"
      : "INVALID_RESPONSE";
  }
  return "UNAVAILABLE";
}

function permanentSourceProjection(
  code: SourceErrorCode,
  provider?: string,
): {
  readonly state: "permission_denied" | "unavailable";
  readonly limitation: string;
} {
  switch (code) {
    case "PERMISSION_DENIED":
      return {
        state: "permission_denied",
        limitation:
          provider === "dataforseo"
            ? "DataForSEO rejected the configured account permissions. Verify the worker credentials before retrying."
            : "Google provider permission was denied. Disconnect and reconnect a property you can access.",
      };
    case "AUTH_REQUIRED":
      return {
        state: "permission_denied",
        limitation:
          provider === "dataforseo"
            ? "DataForSEO worker credentials are unavailable or no longer valid. Update the worker secrets before retrying."
            : "Google authorization is no longer valid. Disconnect and reconnect the source.",
      };
    case "QUOTA_EXCEEDED":
      return {
        state: "unavailable",
        limitation:
          "Provider quota is exhausted. Retry after quota becomes available.",
      };
    case "INVALID_CONFIGURATION":
      return {
        state: "unavailable",
        limitation:
          "Source configuration is invalid. Reconnect or update the source before retrying.",
      };
    case "FEATURE_DISABLED":
      return {
        state: "unavailable",
        limitation: "This provider is disabled in the current product version.",
      };
    default:
      return {
        state: "unavailable",
        limitation:
          "The provider collection failed. Review the source configuration and retry.",
      };
  }
}

export interface CollectJobPayload {
  readonly runId: string;
  readonly workspaceId: string;
  readonly projectId: string;
}

/** Worker-owned Google OAuth runtime values; tests inject `fetch` and `now`. */
export interface GoogleOAuthRuntime {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly fetch?: GoogleTokenFetch;
  readonly now?: () => Date;
}

/** Offline crawl seams for deterministic worker fixtures; production omits it. */
export interface CrawlRuntime {
  readonly fetcher: CrawlFetcher;
  readonly engineOptions?: CrawlEngineOptions;
}

/** Adds optional test seams without requiring production to supply them. */
export type CollectionWorkerContext = Omit<WorkerContext, "googleOAuth"> & {
  readonly googleOAuth: GoogleOAuthRuntime;
  readonly crawl?: CrawlRuntime;
};

interface CollectProduct {
  readonly outcome: CollectionOutcome;
  readonly observations: readonly NormalizedObservation[];
}

export interface CollectionAttemptMetadata {
  readonly retryCount: number;
  readonly retryLimit: number;
}

function transientMetricOutcome(
  attempt: CollectionAttemptMetadata | undefined,
): ProviderMetricOutcome {
  if (
    !attempt ||
    !Number.isSafeInteger(attempt.retryCount) ||
    attempt.retryCount < 0 ||
    !Number.isSafeInteger(attempt.retryLimit) ||
    attempt.retryLimit < 0
  ) {
    return "transient_failure";
  }
  return attempt.retryCount >= attempt.retryLimit
    ? "retry_exhausted"
    : "retry_scheduled";
}

function emitProviderMetric(
  ctx: CollectionWorkerContext,
  metrics: ProviderMetricAccumulator,
  outcome: ProviderMetricOutcome,
  errorCode: SourceErrorCode | "NONE",
): void {
  try {
    ctx.logger.info(
      "provider_collection_metric",
      metrics.fields(outcome, errorCode),
    );
  } catch {
    // Technical metrics are observational and must never change run semantics.
  }
}

async function drain(
  iter: AsyncIterable<NormalizedObservation>,
  signal?: AbortSignal,
): Promise<NormalizedObservation[]> {
  const out: NormalizedObservation[] = [];
  throwIfCollectionAborted(signal);
  for await (const o of iter) {
    throwIfCollectionAborted(signal);
    out.push(o);
  }
  throwIfCollectionAborted(signal);
  return out;
}

function toOutcome<R>(result: CollectionResult<R>): CollectionOutcome {
  return {
    availability: result.availability,
    capturedAt: result.capturedAt,
    sourceWindow: result.sourceWindow,
    rowCount: result.rowCount,
    stopReason: result.stopReason,
    providerUsage: result.providerUsage,
    limitation: result.limitation,
    raw: result.raw,
  };
}

async function lockProjectProjection(
  tx: DbTx,
  scope: ProjectScope,
): Promise<boolean> {
  const project = await new ProjectsRepository(tx).findByIdForUpdate(
    { workspaceId: scope.workspaceId },
    scope.projectId,
  );
  if (!project) {
    throw new Error("collection project disappeared during run transition");
  }
  return project.archived_at === null;
}

export function collectionAdapterContext(
  ctx: Pick<WorkerContext, "signal">,
  run: Pick<CollectionRunRow, "id">,
  site: Pick<SiteRow, "id">,
  scope: { readonly workspaceId: string; readonly projectId: string },
): CollectionContext {
  return {
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    siteId: site.id,
    runId: run.id,
    ...(ctx.signal ? { signal: ctx.signal } : {}),
  };
}

export async function runCollection(
  ctx: CollectionWorkerContext,
  payload: CollectJobPayload,
  delivery?: CollectionAttemptMetadata,
): Promise<void> {
  const { runId, workspaceId, projectId } = payload;
  const scope = { workspaceId, projectId };
  const runs = new AsyncRunsRepository(ctx.db);

  const claimed = await runs.claim(scope, runId);
  if (!claimed) {
    ctx.logger.info("collection_skip_not_queued", { runId });
    return; // already running or terminal — idempotent ack.
  }
  const attempt = toRunAttempt(claimed);

  const collectionRun = await new CollectionRunsRepository(ctx.db).findById(
    runId,
  );
  const site = await new SitesRepository(ctx.db).findPrimary(scope);
  if (!collectionRun || !site) {
    await runs.setTerminal(attempt, {
      status: "failed",
      lastErrorCode: "NOT_FOUND",
      lastErrorSummary: "collection run or site missing",
    });
    return;
  }
  // Defense: the collection run is loaded by id only; verify it belongs to the
  // job payload's scope so a crossed payload can never persist under a foreign run.
  if (
    collectionRun.workspace_id !== workspaceId ||
    collectionRun.project_id !== projectId ||
    collectionRun.site_id !== site.id
  ) {
    await runs.setTerminal(attempt, {
      status: "failed",
      lastErrorCode: "INVALID_CONFIGURATION",
      lastErrorSummary: "collection run scope mismatch",
    });
    return;
  }

  const started = await ctx.db.transaction(async (tx) => {
    if (!(await new AsyncRunsRepository(tx).lockAttemptForUpdate(attempt))) {
      return false;
    }
    const projectionsMutable = await lockProjectProjection(tx, scope);
    if (projectionsMutable && collectionRun.source_connection_id) {
      await new SourceConnectionsRepository(tx).updateState(
        scope,
        collectionRun.source_connection_id,
        "syncing",
      );
    }
    return true;
  });
  if (!started) return;

  const startedAtMs = Date.now();
  const providerMetrics = new ProviderMetricAccumulator(collectionRun.provider);
  try {
    const product = await collectByProvider(
      ctx,
      collectionRun,
      site,
      scope,
      claimed.request_payload,
      providerMetrics,
    );
    // Crawl reports an aborted engine as a partial raw result so callers can
    // inspect progress. A worker shutdown is different: do not persist that
    // operational interruption as a successful partial snapshot.
    throwIfCollectionAborted(ctx.signal);
    providerMetrics.recordResult(product.outcome);
    const snapshotId = await persistCollectionResult(ctx, {
      collectionRun,
      datasetKey: DATASET_KEY[collectionRun.provider] ?? collectionRun.provider,
      schemaVersion: OBSERVATION_SCHEMA_VERSION,
      actorId: claimed.initiated_by,
      startedAtMs,
      attempt,
      outcome: product.outcome,
      observations: product.observations,
    });
    if (snapshotId === null) {
      emitProviderMetric(ctx, providerMetrics, "stale_attempt", "NONE");
      ctx.logger.info("collection_skip_stale_attempt", { runId });
      return;
    }
    emitProviderMetric(ctx, providerMetrics, "success", "NONE");
    ctx.logger.info("collection_done", {
      runId,
      provider: collectionRun.provider,
      availability: product.outcome.availability,
      rowCount: product.outcome.rowCount,
    });
  } catch (error) {
    const { failure, transient } = collectionFailureDecision(
      error,
      ctx.signal,
    );
    providerMetrics.recordFailure(failure);
    if (transient) {
      // Return the run to `queued` so the pg-boss retry can re-claim it (§13.1).
      let reset: boolean;
      try {
        reset = await ctx.db.transaction(async (tx) => {
          const txRuns = new AsyncRunsRepository(tx);
          if (!(await txRuns.lockAttemptForUpdate(attempt))) return false;
          const projectionsMutable = await lockProjectProjection(tx, scope);
          if (projectionsMutable && collectionRun.source_connection_id) {
            await new SourceConnectionsRepository(tx).updateState(
              scope,
              collectionRun.source_connection_id,
              "syncing",
              transient.summary,
            );
          }
          const returnedToQueue = await txRuns.resetToQueued(attempt, {
            code: transient.code,
            summary: transient.summary,
          });
          if (!returnedToQueue) {
            throw new Error(
              "collection attempt ownership changed while resetting retry",
            );
          }
          return true;
        });
      } catch (transitionError) {
        emitProviderMetric(
          ctx,
          providerMetrics,
          "transient_failure",
          transient.code,
        );
        ctx.logger.warn("collection_transient_error", {
          runId,
          code: transient.code,
        });
        // Shutdown failures exposed to pg-boss must stay fixed and body-safe.
        // Recovery can repair a canonical row if the retry reset itself failed.
        throw failure instanceof CollectionShutdownError
          ? failure
          : transitionError;
      }
      if (!reset) {
        emitProviderMetric(
          ctx,
          providerMetrics,
          "stale_attempt",
          transient.code,
        );
        ctx.logger.info("collection_skip_stale_attempt", {
          runId,
          code: transient.code,
        });
        return;
      }
      emitProviderMetric(
        ctx,
        providerMetrics,
        transientMetricOutcome(delivery),
        transient.code,
      );
      ctx.logger.warn("collection_transient_error", {
        runId,
        code: transient.code,
      });
      throw failure; // let pg-boss retry (spec §13.1).
    }
    const code = permanentCollectionErrorCode(failure);
    const projection = permanentSourceProjection(code, collectionRun.provider);
    let terminalized: boolean;
    try {
      terminalized = await ctx.db.transaction(async (tx) => {
        const txRuns = new AsyncRunsRepository(tx);
        if (!(await txRuns.lockAttemptForUpdate(attempt))) return false;
        const projectionsMutable = await lockProjectProjection(tx, scope);
        if (projectionsMutable && collectionRun.source_connection_id) {
          await new SourceConnectionsRepository(tx).updateState(
            scope,
            collectionRun.source_connection_id,
            projection.state,
            projection.limitation,
          );
        }
        const won = await txRuns.setTerminal(attempt, {
          status: "failed",
          lastErrorCode: code,
          lastErrorSummary: "collection failed",
        });
        if (!won) {
          throw new Error(
            "collection attempt ownership changed while terminalizing failure",
          );
        }
        return true;
      });
    } catch (transitionError) {
      emitProviderMetric(
        ctx,
        providerMetrics,
        "permanent_failure",
        code,
      );
      ctx.logger.error("collection_failed", { runId, code });
      throw transitionError;
    }
    if (!terminalized) {
      emitProviderMetric(
        ctx,
        providerMetrics,
        "stale_attempt",
        code,
      );
      ctx.logger.info("collection_skip_stale_attempt", { runId, code });
      return;
    }
    emitProviderMetric(
      ctx,
      providerMetrics,
      "permanent_failure",
      code,
    );
    ctx.logger.error("collection_failed", { runId, code });
  }
}

/**
 * Resolve only the command-time frozen Crawl seed. The worker never consults
 * the project's mutable current Product Profile, so a profile edit after queue
 * acceptance cannot redirect this run.
 */
async function resolveFrozenCrawlSeedUrl(
  ctx: CollectionWorkerContext,
  run: CollectionRunRow,
  scope: { readonly workspaceId: string; readonly projectId: string },
): Promise<string | null> {
  const seedPageId = run.crawl_seed_site_page_id;
  const seedUrl = run.crawl_seed_url;
  if ((seedPageId === null) !== (seedUrl === null)) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "The frozen Crawl seed identity is incomplete.",
    );
  }
  if (run.provider !== "crawl") {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "A non-Crawl collection cannot carry a frozen Crawl seed.",
    );
  }

  const expectedParametersHash = collectionRunParametersHash({
    provider: run.provider,
    operation: run.operation,
    siteId: run.site_id,
    crawlSeedSitePageId: seedPageId,
    crawlSeedUrl: seedUrl,
  });
  // Rows accepted before 0015 had no seed columns in their hash. They remain
  // executable after the forward migration, but arbitrary hashes do not.
  const legacyNullSeedHash =
    seedPageId === null && seedUrl === null
      ? contentHash({
          provider: run.provider,
          operation: run.operation,
          siteId: run.site_id,
        })
      : null;
  if (
    run.parameters_hash !== expectedParametersHash &&
    run.parameters_hash !== legacyNullSeedHash
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "The frozen Crawl seed parameters do not match the accepted command.",
    );
  }
  if (seedPageId === null || seedUrl === null) return null;

  if (seedUrl.length < 1 || seedUrl.length > 2048) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "The frozen Crawl seed URL is invalid.",
    );
  }
  const sourcePage = await new SitePagesRepository(
    ctx.db,
  ).findExactNormalizedUrl(scope, run.site_id, seedUrl);
  if (!sourcePage || sourcePage.id !== seedPageId) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "The frozen Crawl seed does not match its project SitePage.",
    );
  }
  return seedUrl;
}

async function collectByProvider(
  ctx: CollectionWorkerContext,
  run: CollectionRunRow,
  site: SiteRow,
  scope: { workspaceId: string; projectId: string },
  acceptedRequestPayload: Record<string, unknown>,
  providerMetrics: ProviderMetricAccumulator,
): Promise<CollectProduct> {
  const adapterCtx = collectionAdapterContext(ctx, run, site, scope);
  throwIfCollectionAborted(adapterCtx.signal);
  const normalizeCtx = (capturedAt: string): NormalizeContext => ({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    siteId: site.id,
    capturedAt,
  });

  switch (run.provider) {
    case "crawl": {
      if (run.method_version !== CRAWL_METHOD_VERSION) {
        throw new SourceError(
          "INVALID_CONFIGURATION",
          "The crawl run method version is not supported by this worker.",
        );
      }
      const seedUrl = await resolveFrozenCrawlSeedUrl(ctx, run, scope);
      const fetcher = providerMetrics.wrapCrawlFetcher(
        ctx.crawl?.fetcher ??
          createDefaultCrawlFetcher(DEFAULT_CRAWL_USER_AGENT),
      );
      const adapter = createCrawlAdapter({
        fetcher,
        ...(ctx.crawl?.engineOptions
          ? { engineOptions: ctx.crawl.engineOptions }
          : {}),
      });
      const result = await adapter.collect(
        {
          origin: site.origin,
          host: site.host,
          ...(seedUrl === null ? {} : { seedUrl }),
        },
        adapterCtx,
      );
      const observations = await drain(
        adapter.normalize(result.raw, normalizeCtx(result.capturedAt)),
        adapterCtx.signal,
      );
      return { outcome: toOutcome(result), observations };
    }
    case "gsc": {
      const keywordLibraryContext =
        resolveFrozenGscKeywordLibraryContext(run, acceptedRequestPayload);
      return collectWithGoogleCredential(ctx, scope, run, providerMetrics, async (
        credential,
        providerFetch,
      ) => {
        const propertyUrl =
          readConfigString(credential.connection.config, "propertyUrl") ??
          credential.connection.external_ref ??
          site.origin;
        const client = new HttpGscClient({
          siteUrl: propertyUrl,
          accessToken: credential.envelope.accessToken,
          fetchImpl: providerFetch,
        });
        const adapter = createGscAdapter(client);
        const result = await adapter.collect(
          {
            propertyUrl,
            now: ctx.googleOAuth.now?.() ?? new Date(),
          },
          adapterCtx,
        );
        const observations = await drain(
          adapter.normalize(result.raw, normalizeCtx(result.capturedAt)),
          adapterCtx.signal,
        );
        return {
          outcome: keywordLibraryContext
            ? {
                ...toOutcome(result),
                summary: { keywordLibraryContext },
              }
            : toOutcome(result),
          observations,
        };
      });
    }
    case "ga4": {
      return collectWithGoogleCredential(ctx, scope, run, providerMetrics, async (
        credential,
        providerFetch,
      ) => {
        const rawId =
          readConfigString(credential.connection.config, "propertyId") ??
          credential.connection.external_ref ??
          "";
        const propertyId = rawId.startsWith("properties/")
          ? rawId
          : `properties/${rawId}`;
        const keyEventNames = readConfigStringArray(
          credential.connection.config,
          "keyEventNames",
        );
        const propertyTimeZone = requireGa4PropertyTimeZone(
          credential.connection.config,
        );
        const client = new HttpGa4Client({
          propertyId,
          accessToken: credential.envelope.accessToken,
          fetch: providerFetch,
        });
        const adapter = createGa4Adapter(client);
        const result = await adapter.collect(
          {
            propertyId,
            keyEventNames,
            siteOrigin: site.origin,
            propertyTimeZone,
            now: ctx.googleOAuth.now?.() ?? new Date(),
          },
          adapterCtx,
        );
        const observations = await drain(
          adapter.normalize(result.raw, normalizeCtx(result.capturedAt)),
          adapterCtx.signal,
        );
        return { outcome: toOutcome(result), observations };
      });
    }
    case "csv": {
      throwIfCollectionAborted(adapterCtx.signal);
      const { text, mapping, marketFallback, languageFallback } =
        await loadCsvImport(ctx, scope, run);
      throwIfCollectionAborted(adapterCtx.signal);
      const result = await csvAdapter.collect(
        {
          text,
          mapping,
          ...(marketFallback ? { marketFallback } : {}),
          ...(languageFallback ? { languageFallback } : {}),
        },
        adapterCtx,
      );
      throwIfCollectionAborted(adapterCtx.signal);
      const observations = await drain(
        csvAdapter.normalize(result.raw, normalizeCtx(result.capturedAt)),
        adapterCtx.signal,
      );
      return { outcome: toOutcome(result), observations };
    }
    case "dataforseo": {
      const runtime = ctx.dataForSeo;
      if (!runtime?.enabled) {
        throw new SourceError(
          "FEATURE_DISABLED",
          "DataForSEO collection is disabled on this worker.",
        );
      }
      const collectionScope = resolveFrozenDataForSeoCollectionScope(
        run,
        acceptedRequestPayload,
        runtime.maxKeywords,
      );
      if (!runtime.login || !runtime.password) {
        throw new SourceError(
          "AUTH_REQUIRED",
          "DataForSEO worker credentials are not configured.",
        );
      }
      await loadDataForSeoConnection(ctx, scope, run);
      const params = dataForSeoParamsFromCollectionScope(collectionScope);
      const providerFetch = providerMetrics.wrapGoogleFetch(
        runtime.fetch ?? globalThis.fetch,
      );
      const client = new HttpDataForSeoClient({
        login: runtime.login,
        password: runtime.password,
        fetchImpl: providerFetch,
      });
      const adapter = createDataForSeoAdapter(client);
      const result = await adapter.collect(params, adapterCtx);
      const observations = await drain(
        adapter.normalize(result.raw, normalizeCtx(result.capturedAt)),
        adapterCtx.signal,
      );
      return {
        outcome: {
          ...toOutcome(result),
          summary: dataForSeoSnapshotSummary(
            collectionScope,
            result.capturedAt,
          ),
        },
        observations,
      };
    }
    default:
      throw new SourceError(
        "FEATURE_DISABLED",
        `Unsupported collection provider ${run.provider}.`,
      );
  }
}

function parseKeywordLibraryContext(
  value: unknown,
): CollectionRunKeywordLibraryContext {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "The frozen GSC Keyword Library context is invalid.",
    );
  }
  const context = value as Record<string, unknown>;
  const keys = Object.keys(context);
  if (
    keys.length !== 3 ||
    !keys.includes("basis") ||
    !keys.includes("marketCode") ||
    !keys.includes("languageTag") ||
    context["basis"] !== "project_context" ||
    typeof context["marketCode"] !== "string" ||
    !/^[A-Z]{2}$/u.test(context["marketCode"]) ||
    typeof context["languageTag"] !== "string"
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "The frozen GSC Keyword Library context is invalid.",
    );
  }
  try {
    const canonical = Intl.getCanonicalLocales(context["languageTag"])[0];
    if (!canonical || canonical !== context["languageTag"]) {
      throw new Error("non-canonical language tag");
    }
  } catch {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "The frozen GSC Keyword Library context is invalid.",
    );
  }
  return {
    basis: "project_context",
    marketCode: context["marketCode"],
    languageTag: context["languageTag"],
  };
}

/**
 * Resolve only command-time context. Legacy/context-free GSC runs remain
 * collectable but deliberately produce no Keyword Library projection.
 */
export function resolveFrozenGscKeywordLibraryContext(
  run: Pick<
    CollectionRunRow,
    | "provider"
    | "operation"
    | "site_id"
    | "source_connection_id"
    | "parameters_hash"
  >,
  requestPayload: Record<string, unknown>,
): CollectionRunKeywordLibraryContext | null {
  const hasContext = Object.hasOwn(
    requestPayload,
    "keywordLibraryContext",
  );
  const context = hasContext
    ? parseKeywordLibraryContext(requestPayload["keywordLibraryContext"])
    : null;
  if (
    run.provider !== "gsc" ||
    (hasContext &&
      (requestPayload["provider"] !== run.provider ||
        requestPayload["operation"] !== run.operation ||
        requestPayload["sourceConnectionId"] !== run.source_connection_id))
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "The frozen GSC command identity is incomplete or inconsistent.",
    );
  }
  const expectedParametersHash = collectionRunParametersHash({
    provider: run.provider,
    operation: run.operation,
    siteId: run.site_id,
    crawlSeedSitePageId: null,
    crawlSeedUrl: null,
    keywordLibraryContext: context,
  });
  if (run.parameters_hash !== expectedParametersHash) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "The frozen GSC Keyword Library context does not match the accepted command.",
    );
  }
  return context;
}

/**
 * Validate the exact command-time DataForSEO scope frozen by Web. The Worker
 * never consults the mutable Site market/language or connection config to
 * reconstruct this input; a missing, changed, or newly over-cap manifest fails
 * closed before provider I/O.
 */
export function resolveFrozenDataForSeoCollectionScope(
  run: Pick<
    CollectionRunRow,
    | "provider"
    | "operation"
    | "site_id"
    | "source_connection_id"
    | "parameters_hash"
  >,
  requestPayload: Record<string, unknown>,
  workerMaxKeywords: number,
): DataForSeoCollectionScope {
  if (
    run.provider !== "dataforseo" ||
    requestPayload["provider"] !== run.provider ||
    requestPayload["operation"] !== run.operation ||
    requestPayload["sourceConnectionId"] !== run.source_connection_id
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "The frozen DataForSEO command identity is incomplete or inconsistent.",
    );
  }
  const collectionScope = parseDataForSeoCollectionScope(
    requestPayload["collectionScope"],
  );
  if (
    !Number.isSafeInteger(workerMaxKeywords) ||
    workerMaxKeywords < 1 ||
    collectionScope.limit > workerMaxKeywords
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "The frozen DataForSEO keyword limit exceeds the current worker cap.",
    );
  }
  const expectedParametersHash = contentHash({
    provider: run.provider,
    operation: run.operation,
    siteId: run.site_id,
    collectionScope,
  });
  if (run.parameters_hash !== expectedParametersHash) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "The frozen DataForSEO scope does not match the accepted command.",
    );
  }
  return collectionScope;
}

async function loadDataForSeoConnection(
  ctx: CollectionWorkerContext,
  scope: { readonly workspaceId: string; readonly projectId: string },
  run: CollectionRunRow,
): Promise<SourceConnectionRow> {
  if (!run.source_connection_id) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO collection run has no source connection.",
    );
  }
  const connection = await new SourceConnectionsRepository(
    ctx.db,
  ).findConnectedById(scope, run.source_connection_id);
  if (!connection || connection.provider !== "dataforseo") {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO source connection is missing or inactive.",
    );
  }
  return connection;
}

interface LoadedGoogleCredential {
  readonly connection: SourceConnectionRow;
  readonly credential: SourceCredentialRow;
  readonly envelope: OAuthCredentialEnvelope;
}

async function collectWithGoogleCredential(
  ctx: CollectionWorkerContext,
  scope: { workspaceId: string; projectId: string },
  run: CollectionRunRow,
  providerMetrics: ProviderMetricAccumulator,
  collect: (
    credential: LoadedGoogleCredential,
    providerFetch: GoogleTokenFetch,
  ) => Promise<CollectProduct>,
): Promise<CollectProduct> {
  const providerFetch = providerMetrics.wrapGoogleFetch(
    ctx.googleOAuth.fetch ?? globalThis.fetch,
  );
  let credential = await loadConnectionCredential(ctx, scope, run);
  const now = ctx.googleOAuth.now?.() ?? new Date();
  if (shouldRefreshCredential(credential.envelope, now)) {
    credential = await refreshConnectionCredential(
      ctx,
      scope,
      credential,
      providerFetch,
    );
  }

  try {
    return await collect(credential, providerFetch);
  } catch (error) {
    if (!(error instanceof SourceError) || error.code !== "AUTH_REQUIRED") {
      throw error;
    }
  }

  // A token can be revoked before its recorded expiry. Refresh after the first
  // 401 and replay this in-memory collection once; a second 401 escapes as
  // AUTH_REQUIRED and is never looped.
  credential = await refreshConnectionCredential(
    ctx,
    scope,
    credential,
    providerFetch,
  );
  return collect(credential, providerFetch);
}

async function loadConnectionCredential(
  ctx: CollectionWorkerContext,
  scope: { workspaceId: string; projectId: string },
  run: CollectionRunRow,
): Promise<LoadedGoogleCredential> {
  if (!run.source_connection_id) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "collection run has no source connection",
    );
  }
  const connection = await new SourceConnectionsRepository(ctx.db).findById(
    scope,
    run.source_connection_id,
  );
  if (!connection)
    throw new SourceError("INVALID_CONFIGURATION", "source connection missing");
  const cred = await new SourceCredentialsRepository(ctx.db).findByConnection(
    scope,
    run.source_connection_id,
  );
  if (!cred)
    throw new SourceError(
      "AUTH_REQUIRED",
      "no stored credential; reconnect required",
    );
  // The stored credential is a full envelope (access + refresh + expiry + scope);
  // collection uses the access token. A legacy bare-token payload decodes to an
  // envelope carrying only the access token (backward compatible).
  const envelope = decodeCredentialEnvelope(
    decryptCredential(cred.encrypted_payload, ctx.credentialKey).toString(
      "utf8",
    ),
  );
  return { connection, credential: cred, envelope };
}

async function refreshConnectionCredential(
  ctx: CollectionWorkerContext,
  scope: { workspaceId: string; projectId: string },
  expected: LoadedGoogleCredential,
  providerFetch: GoogleTokenFetch,
): Promise<LoadedGoogleCredential> {
  const runtime = ctx.googleOAuth;

  // Deliberately keep the refresh grant inside the row-lock transaction. A CAS
  // after an unlocked HTTP request would prevent stale persistence but would
  // still issue concurrent grants and could invalidate a rotated refresh token.
  // HttpGoogleTokenRefresher bounds this critical section with a 10s timeout.
  return ctx.db.transaction(async (tx) => {
    const credentials = new SourceCredentialsRepository(tx);
    const locked = await credentials.findByConnectionForUpdate(
      scope,
      expected.connection.id,
    );
    if (!locked) {
      throw new SourceError(
        "AUTH_REQUIRED",
        "stored credential disappeared; reconnect required",
      );
    }
    const currentEnvelope = decodeCredentialEnvelope(
      decryptCredential(locked.encrypted_payload, ctx.credentialKey).toString(
        "utf8",
      ),
    );

    // Another worker refreshed while this transaction waited for the row lock.
    // AES-GCM uses a random IV, so any successful write changes the ciphertext
    // even if Google happened to return the same access token.
    if (!locked.encrypted_payload.equals(expected.credential.encrypted_payload)) {
      return {
        connection: expected.connection,
        credential: locked,
        envelope: currentEnvelope,
      };
    }

    const refresher = new HttpGoogleTokenRefresher({
      clientId: runtime.clientId,
      clientSecret: runtime.clientSecret,
      fetch: providerFetch,
      ...(runtime.now ? { now: runtime.now } : {}),
    });
    const refreshedEnvelope = await refresher.refresh(
      currentEnvelope,
      ctx.signal,
    );
    if (refreshedEnvelope.expiresAt === null) {
      throw new SourceError(
        "INVALID_RESPONSE",
        "Google token refresh did not return an expiry",
      );
    }
    const encryptedPayload = encryptCredential(
      encodeCredentialEnvelope(refreshedEnvelope),
      ctx.credentialKey,
    );
    const updated = await credentials.updateAfterRefresh({
      scope,
      credentialId: locked.id,
      sourceConnectionId: expected.connection.id,
      encryptedPayload,
      keyVersion: locked.key_version,
      cipherVersion: CREDENTIAL_CIPHER_VERSION,
      expiresAt: refreshedEnvelope.expiresAt,
    });
    if (!updated) {
      throw new SourceError(
        "NETWORK_ERROR",
        "credential refresh could not be persisted",
      );
    }
    return {
      connection: expected.connection,
      credential: updated,
      envelope: refreshedEnvelope,
    };
  });
}

async function loadCsvImport(
  ctx: WorkerContext,
  scope: { workspaceId: string; projectId: string },
  run: CollectionRunRow,
): Promise<{
  text: string;
  mapping: CsvColumnMapping;
  marketFallback: string | null;
  languageFallback: string | null;
}> {
  throwIfCollectionAborted(ctx.signal);
  const { ImportPreviewsRepository } = await import("@sf/db");
  const payload = run.import_preview_id
    ? await new ImportPreviewsRepository(ctx.db).findById(
        scope,
        run.import_preview_id,
      )
    : null;
  if (!payload)
    throw new SourceError("INVALID_CONFIGURATION", "import preview missing");

  throwIfCollectionAborted(ctx.signal);
  const raw = ctx.signal
    ? await ctx.blobStore.get(payload.raw_object_key, { signal: ctx.signal })
    : await ctx.blobStore.get(payload.raw_object_key);
  throwIfCollectionAborted(ctx.signal);
  if (!raw)
    throw new SourceError(
      "INVALID_RESPONSE",
      "raw import object missing from storage",
    );
  const text = raw.toString("utf8");
  throwIfCollectionAborted(ctx.signal);

  const runPayload = await new AsyncRunsRepository(ctx.db).findById(
    scope,
    run.id,
  );
  const req = (runPayload?.request_payload ?? {}) as {
    mapping?: Record<string, string | null>;
    marketFallback?: string | null;
    languageFallback?: string | null;
  };
  const headers = payload.detected_columns.map((c) => String(c));
  const mapping = buildIndexMapping(req.mapping ?? {}, headers);
  return {
    text,
    mapping,
    marketFallback: req.marketFallback ?? null,
    languageFallback: req.languageFallback ?? null,
  };
}

/** Translate the operator's name-based mapping to the adapter's index mapping. */
function buildIndexMapping(
  nameMapping: Record<string, string | null>,
  headers: readonly string[],
): CsvColumnMapping {
  const idx = (field: string): number | null => {
    const name = nameMapping[field];
    if (!name) return null;
    const position = headers.indexOf(name);
    return position >= 0 ? position : null;
  };
  return {
    keyword: idx("keyword"),
    searchVolume: idx("searchVolume"),
    cluster: idx("cluster"),
    currentUrl: idx("currentUrl"),
    currentRank: idx("currentRank"),
    competitorDomain: idx("competitorDomain"),
    competitorRank: idx("competitorRank"),
    marketCode: idx("marketCode"),
    languageCode: idx("languageCode"),
  };
}

function readConfigString(
  config: Record<string, unknown>,
  key: string,
): string | null {
  const v = config[key];
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readConfigStringArray(
  config: Record<string, unknown>,
  key: string,
): string[] {
  const v = config[key];
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
}

function requireGa4PropertyTimeZone(
  config: Record<string, unknown>,
): string {
  const value = readConfigString(config, "propertyTimeZone");
  if (!value) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "GA4 connection is missing the property timezone; reconnect required",
    );
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
  } catch {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "GA4 connection has an invalid property timezone; reconnect required",
    );
  }
  return value;
}
