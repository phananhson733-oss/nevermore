import {
  AsyncRunsRepository,
  DataSnapshotsRepository,
  OAuthIntentsRepository,
  ProjectsRepository,
  SourceConnectionsRepository,
  SourceCredentialsRepository,
  type AsyncRunRow,
  type SourceConnectionRow,
  type WorkspaceScope,
} from "@sf/db";
import { ProblemError } from "@sf/observability";
import { getEnv } from "@/env";
import { getDb } from "@/lib/db";
import { toSourceConnectionDto, type SourceConnectionDto } from "./source-mappers";

/**
 * Sources read model + disconnect (spec §7, §11.2). `listProjectSources` always
 * returns EXACTLY the five provider slots (crawl, gsc, ga4, csv, dataforseo) —
 * connected or not — so the UI can render every provider card and distinguish
 * "not connected" from "connected but no snapshot" (spec §5.2). DataForSEO's
 * slot is enabled only by the validated server feature flag; an enabled legacy
 * project still remains honestly disconnected until its first collection
 * atomically provisions the project-scoped connection.
 */

const PROVIDER_ORDER = ["crawl", "gsc", "ga4", "csv", "dataforseo"] as const;

function activeRunForProvider(
  runs: readonly AsyncRunRow[],
  provider: string,
): AsyncRunRow | null {
  return (
    runs.find((r) => typeof r.active_key === "string" && r.active_key.startsWith(`collect:${provider}:`)) ??
    null
  );
}

export async function listProjectSources(
  scope: WorkspaceScope,
  projectId: string,
): Promise<SourceConnectionDto[]> {
  const projectScope = { workspaceId: scope.workspaceId, projectId };
  const { db } = getDb();
  const dataForSeoEnabled = getEnv().DATAFORSEO_ENABLED === "true";

  const project = await new ProjectsRepository(db).findById(scope, projectId);
  if (!project) throw new ProblemError("NOT_FOUND", "Project not found.");

  const connectionsRepo = new SourceConnectionsRepository(db);
  const snapshotsRepo = new DataSnapshotsRepository(db);
  const connections = await connectionsRepo.listByProject(projectScope);
  const activeRuns = await new AsyncRunsRepository(db).listActiveByProject(projectScope);
  const now = Date.now();

  const byProvider = new Map<string, SourceConnectionRow>();
  for (const c of connections) {
    // Keep the newest connection per provider (listByProject is created_at DESC).
    if (!byProvider.has(c.provider)) byProvider.set(c.provider, c);
  }

  const slots: SourceConnectionDto[] = [];
  for (const provider of PROVIDER_ORDER) {
    const connection = byProvider.get(provider) ?? null;
    const latestSnapshot = connection
      ? await snapshotsRepo.findLatestByConnection(projectScope, connection.id)
      : null;
    slots.push(
      toSourceConnectionDto({
        projectId,
        provider,
        connection,
        latestSnapshot,
        activeRun: activeRunForProvider(activeRuns, provider),
        featureEnabled:
          provider !== "dataforseo" || dataForSeoEnabled,
        now,
      }),
    );
  }
  return slots;
}

/**
 * Disconnect a source (spec §7, §12.3): mark it disconnected and erase its
 * credential ciphertext immediately; historical snapshots are retained. The
 * default Crawl source cannot be disconnected (it is the project's base source).
 */
export async function disconnectProjectSource(
  scope: WorkspaceScope,
  projectId: string,
  sourceConnectionId: string,
): Promise<void> {
  const projectScope = { workspaceId: scope.workspaceId, projectId };
  const { db } = getDb();

  await db.transaction(async (tx) => {
    // All project mutations lock in project → child order. A disconnect waiting
    // behind archival therefore re-reads the committed archived projection and
    // performs no source/credential/OAuth writes.
    const project = await new ProjectsRepository(tx).findByIdForUpdate(
      scope,
      projectId,
    );
    if (!project) throw new ProblemError("NOT_FOUND", "Project not found.");
    if (project.archived_at) {
      throw new ProblemError(
        "PROJECT_ARCHIVED",
        "Project is archived and read-only.",
      );
    }

    const connections = new SourceConnectionsRepository(tx);
    const connection = await connections.findActiveByIdForUpdate(
      projectScope,
      sourceConnectionId,
    );
    if (!connection) {
      throw new ProblemError("NOT_FOUND", "Source connection not found.");
    }
    if (connection.provider === "crawl") {
      throw new ProblemError(
        "VALIDATION_ERROR",
        "The default crawl source cannot be disconnected.",
      );
    }

    // Collection persistence takes the same source row lock and cannot commit
    // a snapshot after this winner marks the connection disconnected.
    await connections.disconnect(projectScope, sourceConnectionId);
    await new SourceCredentialsRepository(tx).deleteByConnection(sourceConnectionId);
    if (connection.provider === "gsc" || connection.provider === "ga4") {
      await new OAuthIntentsRepository(tx).scrubProjectProvider(
        projectScope,
        connection.provider,
      );
    }
  });
}
