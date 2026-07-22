import {
  AsyncRunsRepository,
  collectionRunParametersHash,
  CollectionRunsRepository,
  contentHash,
  enqueueRunInTx,
  IcpProfilesRepository,
  IdempotencyRepository,
  ProjectsRepository,
  SitePagesRepository,
  SitesRepository,
  SourceConnectionsRepository,
  type QueueName,
  type WorkspaceScope,
} from "@sf/db";
import {
  CONTRACT_VERSION,
  ProductProfileDraft,
  type CreateCollectionRunRequest,
} from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import {
  createDataForSeoCollectionScope,
  CRAWL_METHOD_VERSION,
  SourceError,
  type DataForSeoCollectionScope,
} from "@sf/sources";
import { getDb } from "@/lib/db";
import { getBoss } from "@/lib/boss";
import { getEnv } from "@/env";
import { isPostgresUniqueViolation } from "./db-errors";
import { toAsyncRunDto, runStatusUrl, type AsyncRunDto } from "./runs";

const IDEMPOTENCY_SCOPE = "createCollectionRun";
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** Fixed provider → operation/queue/method wiring (spec §7.5). */
const PROVIDER_CONFIG = {
  crawl: {
    operation: "site_graph",
    queue: "collect.crawl",
    methodVersion: CRAWL_METHOD_VERSION,
  },
  gsc: {
    operation: "search_analytics",
    queue: "collect.gsc",
    methodVersion: "gsc.page_query_daily.v1",
  },
  ga4: {
    operation: "organic_landing",
    queue: "collect.ga4",
    methodVersion: "ga4.organic_landing_daily.v1",
  },
  dataforseo: {
    operation: "keyword_gap_import",
    queue: "collect.dataforseo",
    methodVersion: "dataforseo.ranked_keywords.v1",
  },
} as const satisfies Record<
  CreateCollectionRunRequest["provider"],
  { operation: string; queue: QueueName; methodVersion: string }
>;

interface DataForSeoConnectionConfig {
  readonly target: string;
  readonly marketCode: string;
  readonly locationName: string;
  readonly languageCode: string;
  readonly maxKeywords: number;
}

export function dataForSeoCollectionScopeForSite(site: {
  readonly host: string;
  readonly market_codes: readonly string[];
  readonly language_codes: readonly string[];
}): DataForSeoCollectionScope {
  const env = getEnv();
  const marketCode = site.market_codes[0]?.trim().toUpperCase();
  if (!marketCode) {
    throw new ProblemError(
      "CONTEXT_INCOMPLETE",
      "DataForSEO collection requires an explicit primary market on the primary Site.",
      {
        current: {
          missingField: "primaryMarket",
          recovery: "Set the primary Site market, then retry collection.",
        },
      },
    );
  }
  const languageTag = site.language_codes[0]?.trim();
  if (!languageTag) {
    throw new ProblemError(
      "CONTEXT_INCOMPLETE",
      "DataForSEO collection requires an explicit site language on the primary Site.",
      {
        current: {
          missingField: "siteLanguage",
          recovery: "Set the primary Site language, then retry collection.",
        },
      },
    );
  }
  const locationName =
    new Intl.DisplayNames(["en"], { type: "region" }).of(marketCode);
  if (!locationName) {
    throw new ProblemError(
      "CONTEXT_INCOMPLETE",
      "DataForSEO collection cannot resolve the primary Site market to a provider location.",
      {
        current: {
          missingField: "providerLocation",
          recovery: "Choose a supported primary market, then retry collection.",
        },
      },
    );
  }
  try {
    return createDataForSeoCollectionScope({
      target: site.host,
      marketCode,
      locationName,
      languageTag,
      limit: env.DATAFORSEO_MAX_KEYWORDS,
    });
  } catch (error) {
    if (!(error instanceof SourceError)) throw error;
    throw new ProblemError(
      "CONTEXT_INCOMPLETE",
      "The primary Site market or language is invalid for DataForSEO collection.",
      {
        current: {
          missingField: "collectionScope",
          recovery: "Correct the primary Site market and language, then retry collection.",
        },
      },
    );
  }
}

function dataForSeoConnectionConfig(
  scope: DataForSeoCollectionScope,
): DataForSeoConnectionConfig {
  if (scope.location.kind !== "name") {
    throw new ProblemError(
      "CONTEXT_INCOMPLETE",
      "DataForSEO collection requires a named provider location.",
    );
  }
  return {
    target: scope.target,
    marketCode: scope.marketCode,
    locationName: scope.location.name,
    languageCode: scope.providerLanguageCode,
    maxKeywords: scope.limit,
  };
}

function dataForSeoLimitation(config: DataForSeoConnectionConfig): string {
  return `DataForSEO ranked keywords for ${config.target}; market ${config.marketCode} (${config.locationName}), language ${config.languageCode}, capped at ${config.maxKeywords} keywords per collection. This is the target domain's ranking-keyword dataset, not a complete competitor-gap analysis.`;
}

export interface CollectionAcceptedResult {
  readonly status: 202;
  readonly run: AsyncRunDto;
  readonly statusUrl: string;
  readonly resourceRef: { type: "collection_run"; id: string };
  readonly location: string;
  readonly replayed: boolean;
}

function activeConflict(runId: string, projectId: string): ProblemError {
  const statusUrl = runStatusUrl(projectId, runId);
  return new ProblemError("RUN_ALREADY_ACTIVE", "A collection run is already active.", {
    headers: { Location: statusUrl },
    current: { runId, statusUrl },
  });
}

function replayCollection(
  row: {
    request_hash: string;
    status: string;
    resource_id: string | null;
    response_body: unknown;
  },
  requestHash: string,
): CollectionAcceptedResult | null {
  if (row.request_hash !== requestHash) {
    throw new ProblemError(
      "IDEMPOTENCY_KEY_REUSED",
      "Idempotency-Key was already used with a different request body.",
    );
  }
  if (row.status === "completed" && row.resource_id) {
    const body = row.response_body as
      | { run: AsyncRunDto; statusUrl: string; resourceRef: { type: "collection_run"; id: string } }
      | null;
    if (body?.run) {
      return {
        status: 202,
        run: body.run,
        statusUrl: body.statusUrl,
        resourceRef: body.resourceRef,
        location: body.statusUrl,
        replayed: true,
      };
    }
  }
  return null;
}

/**
 * Queue one provider collection (spec §7.5, §13.2). Validates the provider/
 * operation combination, resolves the source connection, and atomically inserts
 * the run + collection placeholder and enqueues the job in ONE transaction. A
 * second active run for the same `collect:{provider}:{operation}` key returns 409
 * RUN_ALREADY_ACTIVE (AC-019). CSV uses the import endpoint. DataForSEO is
 * feature-gated and lazily creates a project-scoped, secret-free connection for
 * legacy projects when the server integration is enabled.
 */
export async function createCollectionRun(
  scope: WorkspaceScope,
  projectId: string,
  actorId: string,
  idempotencyKey: string,
  body: CreateCollectionRunRequest,
): Promise<CollectionAcceptedResult> {
  const projectScope = { workspaceId: scope.workspaceId, projectId };
  if (
    body.provider === "dataforseo" &&
    getEnv().DATAFORSEO_ENABLED !== "true"
  ) {
    throw new ProblemError(
      "FEATURE_DISABLED",
      "DataForSEO collection is not enabled for this deployment.",
    );
  }

  const { db } = getDb();
  // Hash the validated wire shape before deriving defaults. Optional members
  // only participate when JSON could have carried them; explicit null remains.
  const requestHash = contentHash({
    projectId,
    provider: body.provider,
    ...(Object.hasOwn(body, "operation") && body.operation !== undefined
      ? { operation: body.operation }
      : {}),
    ...(Object.hasOwn(body, "sourceConnectionId") &&
        body.sourceConnectionId !== undefined
      ? { sourceConnectionId: body.sourceConnectionId }
      : {}),
  });

  // Completed commands replay independently of mutable project/source state.
  // Including projectId in the stable command hash prevents a workspace-level
  // key from replaying a response into another project.
  const idem = new IdempotencyRepository(db);
  const existingKey = await idem.find(scope.workspaceId, IDEMPOTENCY_SCOPE, idempotencyKey);
  if (existingKey) {
    const replay = replayCollection(existingKey, requestHash);
    if (replay) return replay;
  }

  const config = PROVIDER_CONFIG[body.provider];
  const operation = body.operation ?? config.operation;
  if (operation !== config.operation) {
    throw new ProblemError(
      "INVALID_COLLECTION_OPERATION",
      `Provider ${body.provider} only supports operation ${config.operation}.`,
    );
  }
  const activeKey = `collect:${body.provider}:${operation}`;

  const project = await new ProjectsRepository(db).findById(scope, projectId);
  if (!project) throw new ProblemError("NOT_FOUND", "Project not found.");
  if (project.archived_at) {
    throw new ProblemError("PROJECT_ARCHIVED", "Project is archived and read-only.");
  }

  const site = await new SitesRepository(db).findPrimary(projectScope);
  if (!site) throw new ProblemError("NOT_FOUND", "Project has no primary site.");

  // Resolve the source connection: explicit id, else the connected default.
  const sources = new SourceConnectionsRepository(db);
  const connection = body.sourceConnectionId
    ? await sources.findById(projectScope, body.sourceConnectionId)
    : await sources.findConnectedByProvider(projectScope, body.provider);
  const canProvisionDataForSeo =
    body.provider === "dataforseo" && body.sourceConnectionId == null;
  if (
    (!connection && !canProvisionDataForSeo) ||
    (connection !== null && connection.provider !== body.provider)
  ) {
    throw new ProblemError(
      "SOURCE_NOT_CONNECTED",
      `No connected ${body.provider} source for this project.`,
    );
  }

  const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString();

  const active = await new AsyncRunsRepository(db).findActive(projectScope, activeKey);
  if (active) {
    const now = await idem.find(scope.workspaceId, IDEMPOTENCY_SCOPE, idempotencyKey);
    const replay = now ? replayCollection(now, requestHash) : null;
    if (replay) return replay;
    throw activeConflict(active.id, projectId);
  }

  const boss = await getBoss();
  try {
    return await db.transaction(async (tx) => {
      const txIdem = new IdempotencyRepository(tx);
      const txProjects = new ProjectsRepository(tx);
      const txSites = new SitesRepository(tx);
      const txSources = new SourceConnectionsRepository(tx);
      const reserved = await txIdem.begin({
        workspaceId: scope.workspaceId,
        scope: IDEMPOTENCY_SCOPE,
        key: idempotencyKey,
        requestHash,
        expiresAt,
      });
      if (!reserved) {
        const now = await txIdem.find(scope.workspaceId, IDEMPOTENCY_SCOPE, idempotencyKey);
        const replay = now ? replayCollection(now, requestHash) : null;
        if (replay) return replay;
        throw new ProblemError("IDEMPOTENCY_KEY_REUSED", "Idempotency key is being processed.");
      }

      const currentProject = await txProjects.findByIdForUpdate(scope, projectId);
      if (!currentProject) {
        throw new ProblemError("NOT_FOUND", "Project not found.");
      }
      if (currentProject.archived_at) {
        throw new ProblemError(
          "PROJECT_ARCHIVED",
          "Project is archived and read-only.",
        );
      }

      const currentSite = await txSites.findPrimary(projectScope);
      if (!currentSite) {
        throw new ProblemError("NOT_FOUND", "Project has no primary site.");
      }

      let crawlSeedSitePageId: string | null = null;
      let crawlSeedUrl: string | null = null;
      if (body.provider === "crawl" && currentProject.current_icp_profile_id) {
        const currentProfile = await new IcpProfilesRepository(tx).findById(
          projectScope,
          currentProject.current_icp_profile_id,
        );
        if (!currentProfile) {
          throw new ProblemError(
            "CONTEXT_INCOMPLETE",
            "The current Product Profile cannot be resolved for this Crawl.",
          );
        }

        const parsedProfile = ProductProfileDraft.safeParse(
          currentProfile.profile,
        );
        if (!parsedProfile.success) {
          const schemaVersion = currentProfile.profile["profileSchemaVersion"];
          if (
            typeof schemaVersion === "string" &&
            schemaVersion.startsWith("product-profile.")
          ) {
            throw new ProblemError(
              "CONTEXT_INCOMPLETE",
              "The current Product Profile is invalid and cannot seed a Crawl.",
            );
          }
          // Historical ICP payloads predate the URL-first Product Profile
          // contract. They remain valid and intentionally carry no deep seed.
        } else {
          if (parsedProfile.data.sourceSiteId !== currentSite.id) {
            throw new ProblemError(
              "CONTEXT_INCOMPLETE",
              "The Product Profile source Site does not match the current project Site.",
            );
          }
          const sourcePage = await new SitePagesRepository(
            tx,
          ).findExactNormalizedUrl(
            projectScope,
            currentSite.id,
            parsedProfile.data.sourcePageUrl,
          );
          if (!sourcePage) {
            throw new ProblemError(
              "CONTEXT_INCOMPLETE",
              "The Product Profile source page is missing from the project's durable URL inventory.",
            );
          }
          crawlSeedSitePageId = sourcePage.id;
          crawlSeedUrl = sourcePage.normalized_url;
        }
      }

      let currentConnection = body.sourceConnectionId
        ? await txSources.findConnectedByIdForUpdate(
            projectScope,
            body.sourceConnectionId,
          )
        : await txSources.findConnectedByProviderForUpdate(
            projectScope,
            body.provider,
          );
      const dataForSeoCollectionScope =
        body.provider === "dataforseo"
          ? dataForSeoCollectionScopeForSite(currentSite)
          : null;
      if (!currentConnection && canProvisionDataForSeo) {
        const connectionConfig = dataForSeoConnectionConfig(
          dataForSeoCollectionScope as DataForSeoCollectionScope,
        );
        currentConnection = await txSources.insertConnection({
          workspaceId: scope.workspaceId,
          projectId,
          siteId: currentSite.id,
          provider: "dataforseo",
          connectionType: "api_key_stub",
          state: "connected",
          externalRef: connectionConfig.target,
          config: { ...connectionConfig },
          limitation: dataForSeoLimitation(connectionConfig),
          connectedAt: true,
          createdBy: actorId,
        });
      }
      if (!currentConnection || currentConnection.provider !== body.provider) {
        throw new ProblemError(
          "SOURCE_NOT_CONNECTED",
          `No connected ${body.provider} source for this project.`,
        );
      }

      const parametersHash =
        body.provider === "dataforseo"
          ? contentHash({
              provider: body.provider,
              operation,
              siteId: currentSite.id,
              collectionScope: dataForSeoCollectionScope,
            })
          : collectionRunParametersHash({
              provider: body.provider,
              operation,
              siteId: currentSite.id,
              crawlSeedSitePageId,
              crawlSeedUrl,
            });

      const run = await new AsyncRunsRepository(tx).insertQueued({
        workspaceId: scope.workspaceId,
        projectId,
        kind: "collection",
        activeKey,
        initiatedBy: actorId,
        contractVersion: CONTRACT_VERSION,
        requestPayload: {
          provider: body.provider,
          operation,
          sourceConnectionId: currentConnection.id,
          ...(dataForSeoCollectionScope
            ? { collectionScope: dataForSeoCollectionScope }
            : {}),
        },
      });
      await new CollectionRunsRepository(tx).insertPlaceholder({
        runId: run.id,
        workspaceId: scope.workspaceId,
        projectId,
        siteId: currentSite.id,
        sourceConnectionId: currentConnection.id,
        provider: body.provider,
        operation,
        methodVersion: config.methodVersion,
        parametersHash,
        crawlSeedSitePageId,
        crawlSeedUrl,
      });
      await enqueueRunInTx(boss, tx, config.queue, {
        runId: run.id,
        workspaceId: scope.workspaceId,
        projectId,
        contractVersion: CONTRACT_VERSION,
      });
      await new ProjectsRepository(tx).setStage(
        scope,
        projectId,
        "collecting",
      );

      const dto = toAsyncRunDto(run);
      const statusUrl = runStatusUrl(projectId, run.id);
      const responseBody = {
        run: dto,
        statusUrl,
        resourceRef: { type: "collection_run" as const, id: run.id },
      };
      await txIdem.complete(reserved.id, {
        responseStatus: 202,
        responseBody,
        resourceType: "collection_run",
        resourceId: run.id,
      });

      return {
        status: 202,
        run: dto,
        statusUrl,
        resourceRef: { type: "collection_run", id: run.id },
        location: statusUrl,
        replayed: false,
      };
    });
  } catch (error) {
    // Lost the active-key race: the partial unique index aborted the insert.
    if (
      isPostgresUniqueViolation(error, "async_runs_one_active_key_idx")
    ) {
      const winnerKey = await idem.find(scope.workspaceId, IDEMPOTENCY_SCOPE, idempotencyKey);
      const replay = winnerKey ? replayCollection(winnerKey, requestHash) : null;
      if (replay) return replay;
      const existing = await new AsyncRunsRepository(db).findActive(projectScope, activeKey);
      if (existing) throw activeConflict(existing.id, projectId);
      throw new ProblemError("RUN_ALREADY_ACTIVE", "A collection run is already active.");
    }
    throw error;
  }
}
