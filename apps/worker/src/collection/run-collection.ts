import {
  AsyncRunsRepository,
  CollectionRunsRepository,
  SitesRepository,
  SourceConnectionsRepository,
  SourceCredentialsRepository,
  type CollectionRunRow,
  type SiteRow,
  type SourceConnectionRow,
  type SourceCredentialRow,
} from "@sf/db";
import {
  BlobObjectAlreadyExistsError,
  BlobObjectNotFoundError,
  CREDENTIAL_CIPHER_VERSION,
  crawlAdapter,
  createCrawlAdapter,
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
  InvalidBlobObjectKeyError,
  isTransient,
  shouldRefreshCredential,
  SourceError,
  SupabaseStorageError,
  CRAWL_DATASET_KEY,
  type CollectionContext,
  type CollectionResult,
  type CrawlEngineOptions,
  type CrawlFetcher,
  type CsvColumnMapping,
  type GoogleTokenFetch,
  type NormalizedObservation,
  type NormalizeContext,
  type OAuthCredentialEnvelope,
  type SourceErrorCode,
} from "@sf/sources";
import type { WorkerContext } from "../context.ts";
import { persistCollectionResult, type CollectionOutcome } from "./persist.ts";

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
};

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

interface TransientCollectionFailure {
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
  return null;
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

function permanentSourceProjection(code: SourceErrorCode): {
  readonly state: "permission_denied" | "unavailable";
  readonly limitation: string;
} {
  switch (code) {
    case "PERMISSION_DENIED":
      return {
        state: "permission_denied",
        limitation:
          "Google provider permission was denied. Disconnect and reconnect a property you can access.",
      };
    case "AUTH_REQUIRED":
      return {
        state: "permission_denied",
        limitation:
          "Google authorization is no longer valid. Disconnect and reconnect the source.",
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

async function drain(
  iter: AsyncIterable<NormalizedObservation>,
): Promise<NormalizedObservation[]> {
  const out: NormalizedObservation[] = [];
  for await (const o of iter) out.push(o);
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

export async function runCollection(
  ctx: CollectionWorkerContext,
  payload: CollectJobPayload,
): Promise<void> {
  const { runId, workspaceId, projectId } = payload;
  const scope = { workspaceId, projectId };
  const runs = new AsyncRunsRepository(ctx.db);

  const claimed = await runs.claim(runId);
  if (!claimed) {
    ctx.logger.info("collection_skip_not_queued", { runId });
    return; // already running or terminal — idempotent ack.
  }

  const collectionRun = await new CollectionRunsRepository(ctx.db).findById(
    runId,
  );
  const site = await new SitesRepository(ctx.db).findPrimary(scope);
  if (!collectionRun || !site) {
    await runs.setTerminal(runId, {
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
    await runs.setTerminal(runId, {
      status: "failed",
      lastErrorCode: "INVALID_CONFIGURATION",
      lastErrorSummary: "collection run scope mismatch",
    });
    return;
  }

  if (collectionRun.source_connection_id) {
    await new SourceConnectionsRepository(ctx.db).updateState(
      scope,
      collectionRun.source_connection_id,
      "syncing",
    );
  }

  const startedAtMs = Date.now();
  try {
    const product = await collectByProvider(ctx, collectionRun, site, scope);
    await persistCollectionResult(ctx, {
      collectionRun,
      datasetKey: DATASET_KEY[collectionRun.provider] ?? collectionRun.provider,
      schemaVersion: OBSERVATION_SCHEMA_VERSION,
      actorId: claimed.initiated_by,
      startedAtMs,
      outcome: product.outcome,
      observations: product.observations,
    });
    ctx.logger.info("collection_done", {
      runId,
      provider: collectionRun.provider,
      availability: product.outcome.availability,
      rowCount: product.outcome.rowCount,
    });
  } catch (error) {
    const transient = transientCollectionFailure(error);
    if (transient) {
      ctx.logger.warn("collection_transient_error", {
        runId,
        code: transient.code,
      });
      // Return the run to `queued` so the pg-boss retry can re-claim it (§13.1).
      await ctx.db.transaction(async (tx) => {
        await new AsyncRunsRepository(tx).resetToQueued(runId, {
          code: transient.code,
          summary: transient.summary,
        });
        if (collectionRun.source_connection_id) {
          await new SourceConnectionsRepository(tx).updateState(
            scope,
            collectionRun.source_connection_id,
            "syncing",
            transient.summary,
          );
        }
      });
      throw error; // let pg-boss retry (spec §13.1).
    }
    const code = permanentCollectionErrorCode(error);
    ctx.logger.error("collection_failed", { runId, code });
    const projection = permanentSourceProjection(code);
    await ctx.db.transaction(async (tx) => {
      await new AsyncRunsRepository(tx).setTerminal(runId, {
        status: "failed",
        lastErrorCode: code,
        lastErrorSummary: "collection failed",
      });
      if (collectionRun.source_connection_id) {
        await new SourceConnectionsRepository(tx).updateState(
          scope,
          collectionRun.source_connection_id,
          projection.state,
          projection.limitation,
        );
      }
    });
  }
}

async function collectByProvider(
  ctx: CollectionWorkerContext,
  run: CollectionRunRow,
  site: SiteRow,
  scope: { workspaceId: string; projectId: string },
): Promise<CollectProduct> {
  const adapterCtx: CollectionContext = {
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    siteId: site.id,
    runId: run.id,
  };
  const normalizeCtx = (capturedAt: string): NormalizeContext => ({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    siteId: site.id,
    capturedAt,
  });

  switch (run.provider) {
    case "crawl": {
      const adapter = ctx.crawl
        ? createCrawlAdapter({
            fetcher: ctx.crawl.fetcher,
            ...(ctx.crawl.engineOptions
              ? { engineOptions: ctx.crawl.engineOptions }
              : {}),
          })
        : crawlAdapter;
      const result = await adapter.collect(
        { origin: site.origin, host: site.host },
        adapterCtx,
      );
      const observations = await drain(
        adapter.normalize(result.raw, normalizeCtx(result.capturedAt)),
      );
      return { outcome: toOutcome(result), observations };
    }
    case "gsc": {
      return collectWithGoogleCredential(ctx, scope, run, async (credential) => {
        const propertyUrl =
          readConfigString(credential.connection.config, "propertyUrl") ??
          credential.connection.external_ref ??
          site.origin;
        const client = new HttpGscClient({
          siteUrl: propertyUrl,
          accessToken: credential.envelope.accessToken,
          ...(ctx.googleOAuth.fetch
            ? { fetchImpl: ctx.googleOAuth.fetch }
            : {}),
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
        );
        return { outcome: toOutcome(result), observations };
      });
    }
    case "ga4": {
      return collectWithGoogleCredential(ctx, scope, run, async (credential) => {
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
          ...(ctx.googleOAuth.fetch ? { fetch: ctx.googleOAuth.fetch } : {}),
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
        );
        return { outcome: toOutcome(result), observations };
      });
    }
    case "csv": {
      const { text, mapping, marketFallback, languageFallback } =
        await loadCsvImport(ctx, scope, run);
      const result = await csvAdapter.collect(
        {
          text,
          mapping,
          ...(marketFallback ? { marketFallback } : {}),
          ...(languageFallback ? { languageFallback } : {}),
        },
        adapterCtx,
      );
      const observations = await drain(
        csvAdapter.normalize(result.raw, normalizeCtx(result.capturedAt)),
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

interface LoadedGoogleCredential {
  readonly connection: SourceConnectionRow;
  readonly credential: SourceCredentialRow;
  readonly envelope: OAuthCredentialEnvelope;
}

async function collectWithGoogleCredential(
  ctx: CollectionWorkerContext,
  scope: { workspaceId: string; projectId: string },
  run: CollectionRunRow,
  collect: (credential: LoadedGoogleCredential) => Promise<CollectProduct>,
): Promise<CollectProduct> {
  let credential = await loadConnectionCredential(ctx, scope, run);
  const now = ctx.googleOAuth.now?.() ?? new Date();
  if (shouldRefreshCredential(credential.envelope, now)) {
    credential = await refreshConnectionCredential(ctx, scope, credential);
  }

  try {
    return await collect(credential);
  } catch (error) {
    if (!(error instanceof SourceError) || error.code !== "AUTH_REQUIRED") {
      throw error;
    }
  }

  // A token can be revoked before its recorded expiry. Refresh after the first
  // 401 and replay this in-memory collection once; a second 401 escapes as
  // AUTH_REQUIRED and is never looped.
  credential = await refreshConnectionCredential(ctx, scope, credential);
  return collect(credential);
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
      ...(runtime.fetch ? { fetch: runtime.fetch } : {}),
      ...(runtime.now ? { now: runtime.now } : {}),
    });
    const refreshedEnvelope = await refresher.refresh(currentEnvelope);
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
  const { ImportPreviewsRepository } = await import("@sf/db");
  const payload = run.import_preview_id
    ? await new ImportPreviewsRepository(ctx.db).findById(
        scope,
        run.import_preview_id,
      )
    : null;
  if (!payload)
    throw new SourceError("INVALID_CONFIGURATION", "import preview missing");

  const raw = await ctx.blobStore.get(payload.raw_object_key);
  if (!raw)
    throw new SourceError(
      "INVALID_RESPONSE",
      "raw import object missing from storage",
    );
  const text = raw.toString("utf8");

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
  return typeof v === "string" ? v : null;
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
