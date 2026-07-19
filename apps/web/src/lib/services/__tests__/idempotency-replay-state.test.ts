import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActionsRepository,
  contentHash,
  IdempotencyRepository,
  ProjectsRepository,
  type IdempotencyRow,
} from "@sf/db";

vi.mock("@/lib/db", () => ({ getDb: () => ({ db: {} }) }));

const { createActionArtifact } = await import("@/lib/services/artifacts");
const { createProjectExport } = await import("@/lib/services/export-service");

const workspaceId = "00000000-0000-4000-8000-000000000001";
const projectId = "00000000-0000-4000-8000-000000000002";
const actionId = "00000000-0000-4000-8000-000000000003";
const actorId = "00000000-0000-4000-8000-000000000004";
const runId = "00000000-0000-4000-8000-000000000005";
const resourceId = "00000000-0000-4000-8000-000000000006";

const run = {
  id: runId,
  projectId,
  kind: "artifact_generation",
  status: "queued",
  progress: {
    phase: "queued",
    current: 0,
    total: null,
    messageKey: "run.queued",
  },
  lastError: null,
  resultRef: null,
  queuedAt: "2026-07-18T12:00:00.000Z",
  startedAt: null,
  completedAt: null,
};

function completedKey(
  scope: string,
  key: string,
  requestHash: string,
  resourceType: "artifact" | "export",
): IdempotencyRow {
  const statusUrl = `/api/mvp/projects/${projectId}/runs/${runId}`;
  return {
    id: "00000000-0000-4000-8000-000000000007",
    workspace_id: workspaceId,
    scope,
    idempotency_key: key,
    request_hash: requestHash,
    status: "completed",
    response_status: 202,
    response_body: {
      run,
      statusUrl,
      resourceRef: { type: resourceType, id: resourceId },
    },
    resource_type: resourceType,
    resource_id: resourceId,
    expires_at: "2026-07-19T12:00:00.000Z",
  };
}

describe("completed create-request replays", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("replays an artifact after the action becomes dismissed", async () => {
    const idempotencyKey = "artifact-replay-key";
    const body = {
      artifactType: "technical_ticket" as const,
      generationMode: "template" as const,
      outputLocale: "en",
      operatorInstructions: null,
    };
    const requestHash = contentHash({
      projectId,
      actionId,
      artifactType: body.artifactType,
      generationMode: body.generationMode,
      outputLocale: body.outputLocale,
      operatorInstructions: null,
    });
    vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValue(
      completedKey(
        "createActionArtifact",
        idempotencyKey,
        requestHash,
        "artifact",
      ),
    );
    const projectLookup = vi
      .spyOn(ProjectsRepository.prototype, "findById")
      .mockResolvedValue({ archived_at: null } as never);
    const actionLookup = vi
      .spyOn(ActionsRepository.prototype, "findById")
      .mockResolvedValue({ status: "dismissed" } as never);

    await expect(
      createActionArtifact(
        { workspaceId },
        projectId,
        actionId,
        actorId,
        idempotencyKey,
        body,
      ),
    ).resolves.toMatchObject({
      status: 202,
      run: { id: runId },
      resourceRef: { type: "artifact", id: resourceId },
    });
    expect(projectLookup).not.toHaveBeenCalled();
    expect(actionLookup).not.toHaveBeenCalled();
  });

  it("replays an export after the project becomes archived", async () => {
    const idempotencyKey = "export-replay-key";
    const body = { kind: "service_bundle" as const, outputLocale: "en" };
    const requestHash = contentHash({
      projectId,
      kind: body.kind,
      outputLocale: body.outputLocale,
    });
    vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValue(
      completedKey(
        "createProjectExport",
        idempotencyKey,
        requestHash,
        "export",
      ),
    );
    const projectLookup = vi
      .spyOn(ProjectsRepository.prototype, "findById")
      .mockResolvedValue({ archived_at: "2026-07-18T12:30:00.000Z" } as never);

    await expect(
      createProjectExport(
        { workspaceId },
        projectId,
        actorId,
        idempotencyKey,
        body,
      ),
    ).resolves.toMatchObject({
      status: 202,
      run: { id: runId },
      resourceRef: { type: "export", id: resourceId },
    });
    expect(projectLookup).not.toHaveBeenCalled();
  });
});
