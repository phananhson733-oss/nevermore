import {
  AsyncRunsRepository,
  CollectionRunsRepository,
  ProjectsRepository,
  SitesRepository,
  SourceConnectionsRepository,
  SourceCredentialsRepository,
  toRunAttempt,
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
  InvalidBlobObjectKeyError,
  isTransient,
  shouldRefreshCredential,
  SourceError,
  SupabaseStorageError,
  CRAWL_DATASET_KEY,
  DEFAULT_CRAWL_USER_AGENT,
  type CollectionContext,
  type CollectionResult,
  type CrawlEngineOptions,
  type CrawlFetcher,
  type CsvColumnMapping,
  type DataForSeoParams,
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
  dataforseo: "csv.keyword_gap.v1",
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

async function collectByProvider(
  ctx: CollectionWorkerContext,
  run: CollectionRunRow,
  site: SiteRow,
  scope: { workspaceId: string; projectId: string },
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
        { origin: site.origin, host: site.host },
        adapterCtx,
      );
      const observations = await drain(
        adapter.normalize(result.raw, normalizeCtx(result.capturedAt)),
        adapterCtx.signal,
      );
      return { outcome: toOutcome(result), observations };
    }
    case "gsc": {
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
        return { outcome: toOutcome(result), observations };
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
      if (!runtime.login || !runtime.password) {
        throw new SourceError(
          "AUTH_REQUIRED",
          "DataForSEO worker credentials are not configured.",
        );
      }
      const connection = await loadDataForSeoConnection(ctx, scope, run);
      const params = dataForSeoParams(connection.config, site, runtime.maxKeywords);
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
      return { outcome: toOutcome(result), observations };
    }
    default:
      throw new SourceError(
        "FEATURE_DISABLED",
        `Unsupported collection provider ${run.provider}.`,
      );
  }
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

function dataForSeoParams(
  config: Record<string, unknown>,
  site: SiteRow,
  workerMaxKeywords: number,
): DataForSeoParams {
  const target = normalizeDataForSeoTarget(
    readConfigString(config, "target") ?? site.host,
  );
  const marketCode =
    readConfigString(config, "marketCode") ?? site.market_codes[0] ?? "US";
  const languageCode =
    readConfigString(config, "languageCode") ??
    site.language_codes[0] ??
    "en";
  const locationName = readConfigString(config, "locationName");
  const locationCode = readConfigPositiveInteger(config, "locationCode");
  const configuredLimit = readConfigPositiveInteger(config, "maxKeywords");
  const runtimeLimit =
    Number.isSafeInteger(workerMaxKeywords) && workerMaxKeywords > 0
      ? workerMaxKeywords
      : 200;
  const limit = Math.min(configuredLimit ?? runtimeLimit, runtimeLimit);

  return {
    target,
    marketCode,
    ...(locationName
      ? { locationName }
      : locationCode !== null
        ? { locationCode }
        : {}),
    languageCode,
    limit,
  };
}

function normalizeDataForSeoTarget(value: string): string {
  const trimmed = value.trim();
  let hostname = trimmed;
  try {
    const url = new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
    );
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("unsupported target protocol");
    }
    hostname = url.hostname;
  } catch {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO target must be a valid public hostname.",
    );
  }
  const normalized = hostname.toLowerCase().replace(/^www\./, "");
  if (!normalized || normalized.includes("..")) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO target must be a valid public hostname.",
    );
  }
  return normalized;
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

function readConfigPositiveInteger(
  config: Record<string, unknown>,
  key: string,
): number | null {
  const value = config[key];
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
    ? value
    : null;
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
