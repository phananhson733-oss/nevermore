import {
  AsyncRunsRepository,
  CollectionRunsRepository,
  SitesRepository,
  SourceConnectionsRepository,
  SourceCredentialsRepository,
  type CollectionRunRow,
  type SiteRow,
  type SourceConnectionRow,
} from "@sf/db";
import {
  crawlAdapter,
  createGa4Adapter,
  createGscAdapter,
  csvAdapter,
  decryptCredential,
  HttpGa4Client,
  HttpGscClient,
  isTransient,
  SourceError,
  CRAWL_DATASET_KEY,
  type CollectionContext,
  type CollectionResult,
  type CsvColumnMapping,
  type NormalizedObservation,
  type NormalizeContext,
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
const DEFAULT_GA4_TIMEZONE = "America/Los_Angeles";

export interface CollectJobPayload {
  readonly runId: string;
  readonly workspaceId: string;
  readonly projectId: string;
}

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
  ctx: WorkerContext,
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
    if (error instanceof SourceError && isTransient(error.code)) {
      ctx.logger.warn("collection_transient_error", {
        runId,
        code: error.code,
      });
      // Return the run to `queued` so the pg-boss retry can re-claim it (§13.1).
      await runs.resetToQueued(runId);
      throw error; // let pg-boss retry (spec §13.1).
    }
    const code = error instanceof SourceError ? error.code : "UNAVAILABLE";
    ctx.logger.error("collection_failed", { runId, code });
    await runs.setTerminal(runId, {
      status: "failed",
      lastErrorCode: code,
      lastErrorSummary: "collection failed",
    });
  }
}

async function collectByProvider(
  ctx: WorkerContext,
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
      const result = await crawlAdapter.collect(
        { origin: site.origin, host: site.host },
        adapterCtx,
      );
      const observations = await drain(
        crawlAdapter.normalize(result.raw, normalizeCtx(result.capturedAt)),
      );
      return { outcome: toOutcome(result), observations };
    }
    case "gsc": {
      const { connection, token } = await loadConnectionToken(ctx, scope, run);
      const propertyUrl =
        readConfigString(connection.config, "propertyUrl") ??
        connection.external_ref ??
        site.origin;
      const client = new HttpGscClient({
        siteUrl: propertyUrl,
        accessToken: token,
      });
      const adapter = createGscAdapter(client);
      const result = await adapter.collect({ propertyUrl }, adapterCtx);
      const observations = await drain(
        adapter.normalize(result.raw, normalizeCtx(result.capturedAt)),
      );
      return { outcome: toOutcome(result), observations };
    }
    case "ga4": {
      const { connection, token } = await loadConnectionToken(ctx, scope, run);
      const rawId =
        readConfigString(connection.config, "propertyId") ??
        connection.external_ref ??
        "";
      const propertyId = rawId.startsWith("properties/")
        ? rawId
        : `properties/${rawId}`;
      const keyEventNames = readConfigStringArray(
        connection.config,
        "keyEventNames",
      );
      const client = new HttpGa4Client({ propertyId, accessToken: token });
      const adapter = createGa4Adapter(client);
      const result = await adapter.collect(
        {
          propertyId,
          keyEventNames,
          siteOrigin: site.origin,
          propertyTimeZone:
            readConfigString(connection.config, "propertyTimeZone") ??
            DEFAULT_GA4_TIMEZONE,
          now: new Date(),
        },
        adapterCtx,
      );
      const observations = await drain(
        adapter.normalize(result.raw, normalizeCtx(result.capturedAt)),
      );
      return { outcome: toOutcome(result), observations };
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

async function loadConnectionToken(
  ctx: WorkerContext,
  scope: { workspaceId: string; projectId: string },
  run: CollectionRunRow,
): Promise<{ connection: SourceConnectionRow; token: string }> {
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
  const token = decryptCredential(
    cred.encrypted_payload,
    ctx.credentialKey,
  ).toString("utf8");
  return { connection, token };
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
      "UNAVAILABLE",
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
