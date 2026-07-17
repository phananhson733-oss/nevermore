import { AsyncRunsRepository, type AsyncRunRow, type WorkspaceScope } from "@sf/db";
import { ProblemError } from "@sf/observability";
import { getDb } from "@/lib/db";

/**
 * Unified async-run read model (spec §11.2 getProjectRun). Every collection,
 * diagnostic, artifact, and export job is polled through the same endpoint and
 * DTO. The `statusUrl` a 202 hands back points here.
 */

export interface RunProgressDto {
  phase: string;
  current: number;
  total: number | null;
  messageKey: string;
}

export interface AsyncRunDto {
  id: string;
  projectId: string;
  kind: string;
  status: string;
  progress: RunProgressDto;
  lastError: { code: string; summary: string } | null;
  resultRef: { type: string; id: string } | null;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

function toProgress(raw: Record<string, unknown>): RunProgressDto {
  const phase = typeof raw["phase"] === "string" ? raw["phase"] : "queued";
  const current = typeof raw["current"] === "number" ? raw["current"] : 0;
  const total = typeof raw["total"] === "number" ? raw["total"] : null;
  const messageKey = typeof raw["messageKey"] === "string" ? raw["messageKey"] : "run.queued";
  return { phase, current, total, messageKey };
}

export function toAsyncRunDto(row: AsyncRunRow): AsyncRunDto {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    status: row.status,
    progress: toProgress(row.progress),
    lastError: row.last_error_code
      ? { code: row.last_error_code, summary: row.last_error_summary ?? "" }
      : null,
    resultRef:
      row.result_type && row.result_id
        ? { type: row.result_type, id: row.result_id }
        : null,
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

/** The same-origin status URL a 202 returns and the client polls. */
export function runStatusUrl(projectId: string, runId: string): string {
  return `/api/mvp/projects/${projectId}/runs/${runId}`;
}

/** `GET /projects/{projectId}/runs/{runId}` — unified status (404 when foreign/absent). */
export async function getProjectRun(
  scope: WorkspaceScope,
  projectId: string,
  runId: string,
): Promise<AsyncRunDto> {
  const { db } = getDb();
  const run = await new AsyncRunsRepository(db).findById(
    { workspaceId: scope.workspaceId, projectId },
    runId,
  );
  if (!run) throw new ProblemError("NOT_FOUND", "Run not found.");
  return toAsyncRunDto(run);
}
