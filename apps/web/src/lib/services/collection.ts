import {
  AsyncRunsRepository,
  CollectionRunsRepository,
  contentHash,
  enqueueRunInTx,
  IdempotencyRepository,
  ProjectsRepository,
  SitesRepository,
  SourceConnectionsRepository,
  type QueueName,
  type WorkspaceScope,
} from "@sf/db";
import type { CreateCollectionRunRequest } from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import { getDb } from "@/lib/db";
import { getBoss } from "@/lib/boss";
import { toAsyncRunDto, runStatusUrl, type AsyncRunDto } from "./runs";

const CONTRACT_VERSION = "2026-07-18";
const IDEMPOTENCY_SCOPE = "createCollectionRun";
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** Fixed provider → operation/queue/method wiring (spec §7.5). */
const PROVIDER_CONFIG = {
  crawl: { operation: "site_graph", queue: "collect.crawl", methodVersion: "crawl.site_graph.v1" },
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
} as const satisfies Record<
  CreateCollectionRunRequest["provider"],
  { operation: string; queue: QueueName; methodVersion: string }
>;

export interface CollectionAcceptedResult {
  readonly status: 202;
  readonly run: AsyncRunDto;
  readonly statusUrl: string;
  readonly resourceRef: { type: "collection_run"; id: string };
  readonly location: string;
  readonly replayed: boolean;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

function activeConflict(runId: string, projectId: string): ProblemError {
  return new ProblemError("RUN_ALREADY_ACTIVE", "A collection run is already active.", {
    headers: { Location: runStatusUrl(projectId, runId) },
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
 * RUN_ALREADY_ACTIVE (AC-019). CSV uses the import endpoint; DataForSEO is
 * disabled — so only crawl/gsc/ga4 reach here.
 */
export async function createCollectionRun(
  scope: WorkspaceScope,
  projectId: string,
  actorId: string,
  idempotencyKey: string,
  body: CreateCollectionRunRequest,
): Promise<CollectionAcceptedResult> {
  const config = PROVIDER_CONFIG[body.provider];
  if (body.operation && body.operation !== config.operation) {
    throw new ProblemError(
      "INVALID_COLLECTION_OPERATION",
      `Provider ${body.provider} only supports operation ${config.operation}.`,
    );
  }
  const operation = config.operation;
  const activeKey = `collect:${body.provider}:${operation}`;
  const projectScope = { workspaceId: scope.workspaceId, projectId };

  const { db } = getDb();
  const boss = await getBoss();

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
  if (!connection || connection.provider !== body.provider) {
    throw new ProblemError(
      "SOURCE_NOT_CONNECTED",
      `No connected ${body.provider} source for this project.`,
    );
  }

  const requestHash = contentHash({
    provider: body.provider,
    operation,
    sourceConnectionId: connection.id,
  });
  const parametersHash = contentHash({ provider: body.provider, operation, siteId: site.id });
  const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString();

  // Fast-path idempotency replay / active-run conflict.
  const idem = new IdempotencyRepository(db);
  const existingKey = await idem.find(scope.workspaceId, IDEMPOTENCY_SCOPE, idempotencyKey);
  if (existingKey) {
    const replay = replayCollection(existingKey, requestHash);
    if (replay) return replay;
  }
  const active = await new AsyncRunsRepository(db).findActive(projectScope, activeKey);
  if (active) throw activeConflict(active.id, projectId);

  try {
    return await db.transaction(async (tx) => {
      const txIdem = new IdempotencyRepository(tx);
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
          sourceConnectionId: connection.id,
        },
      });
      await new CollectionRunsRepository(tx).insertPlaceholder({
        runId: run.id,
        workspaceId: scope.workspaceId,
        projectId,
        siteId: site.id,
        sourceConnectionId: connection.id,
        provider: body.provider,
        operation,
        methodVersion: config.methodVersion,
        parametersHash,
      });
      await enqueueRunInTx(boss, tx, config.queue, {
        runId: run.id,
        workspaceId: scope.workspaceId,
        projectId,
        contractVersion: CONTRACT_VERSION,
      });

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
    if (isUniqueViolation(error)) {
      const existing = await new AsyncRunsRepository(db).findActive(projectScope, activeKey);
      if (existing) throw activeConflict(existing.id, projectId);
      throw new ProblemError("RUN_ALREADY_ACTIVE", "A collection run is already active.");
    }
    throw error;
  }
}
