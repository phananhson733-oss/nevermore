import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActionsRepository,
  AsyncRunsRepository,
  contentHash,
  ExecutionArtifactsRepository,
  IdempotencyRepository,
  ProjectsRepository,
  type ActionRow,
  type ArtifactRevisionRow,
  type ArtifactRow,
  type AsyncRunRow,
  type IdempotencyRow,
  type ProjectRow,
} from "@sf/db";
import { ProblemError } from "@sf/observability";
import { toArtifactDto, type ArtifactDto } from "../artifact-mappers";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  enqueueRunInTx: vi.fn(),
  getBoss: vi.fn(),
}));

function makeQueryChain(result: unknown[] = []): {
  from: (...args: unknown[]) => unknown;
  where: (...args: unknown[]) => unknown;
  limit: (...args: unknown[]) => unknown;
  orderBy: (...args: unknown[]) => unknown;
  values: (...args: unknown[]) => unknown;
  set: (...args: unknown[]) => unknown;
  returning: (...args: unknown[]) => unknown;
  for: (...args: unknown[]) => unknown;
  onConflictDoNothing: (...args: unknown[]) => unknown;
  onConflictDoUpdate: (...args: unknown[]) => unknown;
  then: <TResult1 = unknown, TResult2 = never>(
    onFulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) => Promise<TResult1 | TResult2>;
} {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => chain,
    orderBy: () => chain,
    values: () => chain,
    set: () => chain,
    returning: () => chain,
    for: () => chain,
    onConflictDoNothing: () => chain,
    onConflictDoUpdate: () => chain,
    then: <TResult1 = unknown, TResult2 = never>(
      onFulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
      onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return chain;
}

const dbMock = {
  transaction: mocks.transaction,
  select: () => makeQueryChain(),
  insert: () => makeQueryChain(),
  update: () => makeQueryChain(),
  delete: () => makeQueryChain(),
  execute: () => Promise.resolve([]),
};

vi.mock("@sf/db", async () => {
  const actual = await vi.importActual<typeof import("@sf/db")>("@sf/db");
  return { ...actual, enqueueRunInTx: mocks.enqueueRunInTx };
});
vi.mock("@/lib/db", () => ({
  getDb: () => ({ db: dbMock }),
}));
vi.mock("@/lib/boss", () => ({ getBoss: mocks.getBoss }));

const {
  createActionArtifact,
  getProjectArtifact,
  listProjectArtifacts,
} = await import("../artifacts.ts");

const scope = { workspaceId: "workspace-1" };
const projectId = "project-1";
const actionId = "action-1";
const actorId = "user-1";
const idempotencyKey = "idem-1";
const ARTIFACTS_MAX_DTO_BYTES = 16 * 1024 * 1024;
const body = {
  artifactType: "technical_ticket" as const,
  generationMode: "template" as const,
  outputLocale: "en" as const,
};
const requestHash = contentHash({
  projectId,
  actionId,
  artifactType: body.artifactType,
  generationMode: body.generationMode,
  outputLocale: body.outputLocale,
  operatorInstructions: null,
});

const project = {
  id: projectId,
  workspace_id: scope.workspaceId,
  archived_at: null,
} as ProjectRow;
const action = {
  id: actionId,
  template_id: "fix_http_status.v1",
  status: "accepted",
} as ActionRow;
const run = {
  id: "run-1",
  workspace_id: scope.workspaceId,
  project_id: projectId,
  kind: "artifact_generation",
  status: "queued",
  progress: {},
  last_error_code: null,
  last_error_summary: null,
  result_type: null,
  result_id: null,
  queued_at: "2026-07-18T12:00:00.000Z",
  started_at: null,
  completed_at: null,
} as AsyncRunRow;
const artifact = {
  id: "artifact-1",
  workspace_id: scope.workspaceId,
  project_id: projectId,
  action_id: actionId,
  artifact_type: "technical_ticket",
  status: "draft",
  generation_mode: "template",
  output_locale: "en",
  current_revision: 1,
  validation_state: "valid",
  latest_generation_run_id: run.id,
  created_at: "2026-07-18T12:00:00.000Z",
  updated_at: "2026-07-18T12:01:00.000Z",
} as ArtifactRow;
const revision = {
  id: "revision-1",
  workspace_id: scope.workspaceId,
  project_id: projectId,
  artifact_id: artifact.id,
  revision: 1,
  output_locale: "en",
  content_format: "markdown",
  content_text: "# Fix HTTP status",
  content_json: null,
  content_hash: "hash-1",
  generated_by: "template",
  editor_id: null,
  analysis_invocation_id: null,
  validation_errors: [],
  note: null,
  created_at: "2026-07-18T12:01:00.000Z",
} as ArtifactRevisionRow;

function utf8JsonBytes(value: ArtifactDto): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function revisionForExactDtoBytes(
  artifactRow: ArtifactRow,
  revisionRow: ArtifactRevisionRow,
  targetBytes: number,
): ArtifactRevisionRow {
  const emptyRevision = { ...revisionRow, content_text: "" };
  const fixedBytes = utf8JsonBytes(
    toArtifactDto(artifactRow, emptyRevision, null),
  );
  const contentBytes = targetBytes - fixedBytes;
  if (contentBytes < 0) {
    throw new Error("Target DTO byte budget is smaller than the fixed DTO fields.");
  }
  return { ...revisionRow, content_text: "x".repeat(contentBytes) };
}
const reserved = {
  id: "idem-row-1",
  request_hash: requestHash,
  status: "in_progress",
  resource_id: null,
  response_body: null,
} as IdempotencyRow;

function completedKey(overrides: Partial<IdempotencyRow> = {}): IdempotencyRow {
  return {
    ...reserved,
    status: "completed",
    resource_id: artifact.id,
    response_body: {
      run: {
        id: run.id,
        projectId,
        kind: run.kind,
        status: run.status,
        progress: {
          phase: "queued",
          current: 0,
          total: null,
          messageKey: "run.queued",
        },
        lastError: null,
        resultRef: null,
        queuedAt: run.queued_at,
        startedAt: null,
        completedAt: null,
      },
      statusUrl: `/api/mvp/projects/${projectId}/runs/${run.id}`,
      resourceRef: { id: artifact.id },
    },
    ...overrides,
  } as IdempotencyRow;
}

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.transaction.mockReset();
  mocks.enqueueRunInTx.mockReset().mockResolvedValue("job-1");
  mocks.getBoss.mockReset().mockResolvedValue({});
  mocks.transaction.mockImplementation(
    async (callback: (tx: object) => Promise<unknown>) => callback({}),
  );
  vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValue(null);
  vi.spyOn(IdempotencyRepository.prototype, "begin").mockResolvedValue(reserved);
  vi.spyOn(IdempotencyRepository.prototype, "complete").mockResolvedValue();
  vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue(project);
  vi.spyOn(ProjectsRepository.prototype, "findByIdForUpdate").mockResolvedValue(
    project,
  );
  vi.spyOn(ProjectsRepository.prototype, "setStage").mockResolvedValue(true);
  vi.spyOn(ActionsRepository.prototype, "findById").mockResolvedValue(action);
  vi.spyOn(ActionsRepository.prototype, "findByIdForUpdate").mockResolvedValue(
    action,
  );
  vi.spyOn(
    ExecutionArtifactsRepository.prototype,
    "findLiveByActionType",
  ).mockResolvedValue(null);
  vi.spyOn(ExecutionArtifactsRepository.prototype, "insert").mockResolvedValue(
    artifact,
  );
  vi.spyOn(
    ExecutionArtifactsRepository.prototype,
    "startRegenerationIfLive",
  ).mockResolvedValue(true);
  vi.spyOn(AsyncRunsRepository.prototype, "findActive").mockResolvedValue(null);
  vi.spyOn(AsyncRunsRepository.prototype, "insertQueued").mockResolvedValue(run);
});

describe("createActionArtifact", () => {
  it.each(["fr-FR", "zh-TW", "zh-Hant"])(
    "rejects unsupported template locale %s before any persistence",
    async (outputLocale) => {
      const promise = createActionArtifact(
        scope,
        projectId,
        actionId,
        actorId,
        idempotencyKey,
        { ...body, outputLocale },
      );
      await expect(promise).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        fieldErrors: [
          expect.objectContaining({
            pointer: "/outputLocale",
            message: expect.stringContaining("structured_llm"),
          }),
        ],
      });
      expect(IdempotencyRepository.prototype.find).toHaveBeenCalledTimes(1);
      expect(AsyncRunsRepository.prototype.insertQueued).not.toHaveBeenCalled();
    },
  );

  it.each(["zh-TW", "ZH-cn", "EN"])(
    "replays a completed legacy template command with raw locale %s before applying the tightened locale rule",
    async (outputLocale) => {
      const legacyBody = { ...body, outputLocale };
      const legacyRequestHash = contentHash({
        projectId,
        actionId,
        artifactType: legacyBody.artifactType,
        generationMode: legacyBody.generationMode,
        outputLocale: legacyBody.outputLocale,
        operatorInstructions: null,
      });
      vi.mocked(IdempotencyRepository.prototype.find).mockResolvedValueOnce(
        completedKey({ request_hash: legacyRequestHash }),
      );

      await expect(
        createActionArtifact(
          scope,
          projectId,
          actionId,
          actorId,
          idempotencyKey,
          legacyBody,
        ),
      ).resolves.toMatchObject({ resourceRef: { id: artifact.id } });
      expect(ProjectsRepository.prototype.findById).not.toHaveBeenCalled();
      expect(AsyncRunsRepository.prototype.insertQueued).not.toHaveBeenCalled();
    },
  );

  it("canonicalizes a case-insensitive semantic template locale before persistence", async () => {
    await createActionArtifact(
      scope,
      projectId,
      actionId,
      actorId,
      idempotencyKey,
      { ...body, outputLocale: "ZH-cn" },
    );
    expect(AsyncRunsRepository.prototype.insertQueued).toHaveBeenCalledWith(
      expect.objectContaining({
        requestPayload: expect.objectContaining({ outputLocale: "zh-CN" }),
      }),
    );
    expect(ExecutionArtifactsRepository.prototype.insert).toHaveBeenCalledWith(
      expect.objectContaining({ outputLocale: "zh-CN" }),
    );
  });

  it("accepts arbitrary valid locale for structured_llm generation", async () => {
    await createActionArtifact(
      scope,
      projectId,
      actionId,
      actorId,
      idempotencyKey,
      { ...body, generationMode: "structured_llm", outputLocale: "fr-FR" },
    );
    expect(AsyncRunsRepository.prototype.insertQueued).toHaveBeenCalledWith(
      expect.objectContaining({
        requestPayload: expect.objectContaining({ outputLocale: "fr-FR" }),
      }),
    );
  });

  it("atomically accepts a new artifact and completes the idempotency record", async () => {
    const result = await createActionArtifact(
      scope,
      projectId,
      actionId,
      actorId,
      idempotencyKey,
      body,
    );
    expect(result).toMatchObject({
      status: 202,
      resourceRef: { type: "artifact" },
      location: `/api/mvp/projects/${projectId}/runs/${run.id}`,
    });
    expect(ExecutionArtifactsRepository.prototype.insert).toHaveBeenCalledWith(
      expect.objectContaining({ id: result.resourceRef.id, actionId }),
    );
    expect(mocks.enqueueRunInTx).toHaveBeenCalledWith(
      {},
      {},
      "artifact.generate",
      expect.objectContaining({ runId: run.id, projectId }),
    );
    expect(ProjectsRepository.prototype.setStage).toHaveBeenCalledWith(
      scope,
      projectId,
      "executing",
    );
    expect(IdempotencyRepository.prototype.complete).toHaveBeenCalledWith(
      reserved.id,
      expect.objectContaining({ resourceId: result.resourceRef.id }),
    );
  });

  it("regenerates a live artifact and preserves explicit operator instructions", async () => {
    vi.mocked(
      ExecutionArtifactsRepository.prototype.findLiveByActionType,
    )
      .mockResolvedValueOnce(artifact)
      .mockResolvedValueOnce(artifact);
    const result = await createActionArtifact(
      scope,
      projectId,
      actionId,
      actorId,
      idempotencyKey,
      { ...body, operatorInstructions: "Keep the rollback steps." },
    );
    expect(result.resourceRef.id).toBe(artifact.id);
    expect(
      ExecutionArtifactsRepository.prototype.startRegenerationIfLive,
    ).toHaveBeenCalledWith(
      { workspaceId: scope.workspaceId, projectId },
      artifact.id,
      run.id,
      {
        generationMode: "template",
        outputLocale: "en",
      },
    );
    expect(ExecutionArtifactsRepository.prototype.insert).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.insertQueued).toHaveBeenCalledWith(
      expect.objectContaining({
        requestPayload: expect.objectContaining({
          artifactId: artifact.id,
          operatorInstructions: "Keep the rollback steps.",
        }),
      }),
    );
  });

  it("creates a fresh artifact when the previously live row was archived before the tx re-read", async () => {
    vi.mocked(
      ExecutionArtifactsRepository.prototype.findLiveByActionType,
    )
      .mockResolvedValueOnce(artifact)
      .mockResolvedValueOnce(null);

    const result = await createActionArtifact(
      scope,
      projectId,
      actionId,
      actorId,
      idempotencyKey,
      body,
    );
    expect(result.status).toBe(202);
    expect(result.resourceRef.id).not.toBe(artifact.id);
    expect(
      ExecutionArtifactsRepository.prototype.startRegenerationIfLive,
    ).not.toHaveBeenCalled();
    expect(ExecutionArtifactsRepository.prototype.insert).toHaveBeenCalledWith(
      expect.objectContaining({ id: result.resourceRef.id, actionId }),
    );
  });

  it("replays a completed command before mutable project validation", async () => {
    vi.mocked(IdempotencyRepository.prototype.find).mockResolvedValueOnce(
      completedKey(),
    );
    vi.mocked(ProjectsRepository.prototype.findById).mockResolvedValueOnce(null);
    await expect(
      createActionArtifact(
        scope,
        projectId,
        actionId,
        actorId,
        idempotencyKey,
        body,
      ),
    ).resolves.toMatchObject({
      resourceRef: { type: "artifact", id: artifact.id },
    });
    expect(ProjectsRepository.prototype.findById).not.toHaveBeenCalled();
  });

  it("falls back to the committed resource id when the old response omitted it", async () => {
    const original = completedKey();
    const key = completedKey({
      response_body: {
        ...(original.response_body as object),
        resourceRef: {},
      },
    });
    vi.mocked(IdempotencyRepository.prototype.find).mockResolvedValueOnce(key);
    await expect(
      createActionArtifact(
        scope,
        projectId,
        actionId,
        actorId,
        idempotencyKey,
        body,
      ),
    ).resolves.toMatchObject({ resourceRef: { id: artifact.id } });
  });

  it("rejects a key reused for different content", async () => {
    vi.mocked(IdempotencyRepository.prototype.find).mockResolvedValueOnce(
      completedKey({ request_hash: "different" }),
    );
    await expect(
      createActionArtifact(
        scope,
        projectId,
        actionId,
        actorId,
        idempotencyKey,
        body,
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it.each([
    {
      name: "missing project",
      setup: () =>
        vi
          .mocked(ProjectsRepository.prototype.findById)
          .mockResolvedValueOnce(null),
      code: "NOT_FOUND",
    },
    {
      name: "archived project",
      setup: () =>
        vi
          .mocked(ProjectsRepository.prototype.findById)
          .mockResolvedValueOnce({ ...project, archived_at: "2026-07-18" }),
      code: "PROJECT_ARCHIVED",
    },
    {
      name: "missing action",
      setup: () =>
        vi
          .mocked(ActionsRepository.prototype.findById)
          .mockResolvedValueOnce(null),
      code: "NOT_FOUND",
    },
    {
      name: "dismissed action",
      setup: () =>
        vi
          .mocked(ActionsRepository.prototype.findById)
          .mockResolvedValueOnce({ ...action, status: "dismissed" }),
      code: "ACTION_NOT_EXECUTABLE",
    },
  ])("rejects $name", async ({ setup, code }) => {
    setup();
    await expect(
      createActionArtifact(
        scope,
        projectId,
        actionId,
        actorId,
        idempotencyKey,
        body,
      ),
    ).rejects.toMatchObject({ code });
  });

  it("rejects an artifact type that does not match its action template", async () => {
    await expect(
      createActionArtifact(
        scope,
        projectId,
        actionId,
        actorId,
        idempotencyKey,
        { ...body, artifactType: "content_brief" },
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fieldErrors: [expect.objectContaining({ pointer: "/artifactType" })],
    });
  });

  it("allows a legacy action template without a reverse-map entry", async () => {
    vi.mocked(ActionsRepository.prototype.findById).mockResolvedValueOnce({
      ...action,
      template_id: "legacy.template",
    });
    await expect(
      createActionArtifact(
        scope,
        projectId,
        actionId,
        actorId,
        idempotencyKey,
        body,
      ),
    ).resolves.toMatchObject({ status: 202 });
  });

  it("returns the winner's replay when an active run closes the read race", async () => {
    vi.mocked(AsyncRunsRepository.prototype.findActive).mockResolvedValueOnce(run);
    vi.mocked(IdempotencyRepository.prototype.find)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(completedKey());
    await expect(
      createActionArtifact(
        scope,
        projectId,
        actionId,
        actorId,
        idempotencyKey,
        body,
      ),
    ).resolves.toMatchObject({ resourceRef: { id: artifact.id } });
  });

  it("reports the active run location when no idempotent winner exists", async () => {
    vi.mocked(AsyncRunsRepository.prototype.findActive).mockResolvedValueOnce(run);
    const promise = createActionArtifact(
      scope,
      projectId,
      actionId,
      actorId,
      idempotencyKey,
      body,
    );
    await expect(promise).rejects.toBeInstanceOf(ProblemError);
    await expect(promise).rejects.toMatchObject({
      code: "RUN_ALREADY_ACTIVE",
      extraHeaders: {
        Location: `/api/mvp/projects/${projectId}/runs/${run.id}`,
      },
    });
  });

  it("replays the transaction winner when reservation loses", async () => {
    vi.mocked(IdempotencyRepository.prototype.begin).mockResolvedValueOnce(null);
    vi.mocked(IdempotencyRepository.prototype.find)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(completedKey());
    await expect(
      createActionArtifact(
        scope,
        projectId,
        actionId,
        actorId,
        idempotencyKey,
        body,
      ),
    ).resolves.toMatchObject({ resourceRef: { id: artifact.id } });
  });

  it("rejects a still-processing reservation winner", async () => {
    vi.mocked(IdempotencyRepository.prototype.begin).mockResolvedValueOnce(null);
    vi.mocked(IdempotencyRepository.prototype.find)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(reserved);
    await expect(
      createActionArtifact(
        scope,
        projectId,
        actionId,
        actorId,
        idempotencyKey,
        body,
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("rolls back when the scoped project disappears during enqueue", async () => {
    vi.mocked(ProjectsRepository.prototype.findByIdForUpdate).mockResolvedValueOnce(
      null,
    );
    await expect(
      createActionArtifact(
        scope,
        projectId,
        actionId,
        actorId,
        idempotencyKey,
        body,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rolls back when the action is dismissed before the locked tx re-read", async () => {
    vi.mocked(ActionsRepository.prototype.findByIdForUpdate).mockResolvedValueOnce({
      ...action,
      status: "dismissed",
    });

    await expect(
      createActionArtifact(
        scope,
        projectId,
        actionId,
        actorId,
        idempotencyKey,
        body,
      ),
    ).rejects.toMatchObject({ code: "ACTION_NOT_EXECUTABLE" });
    expect(AsyncRunsRepository.prototype.insertQueued).not.toHaveBeenCalled();
    expect(mocks.enqueueRunInTx).not.toHaveBeenCalled();
  });

  it("recovers a unique race through the completed idempotency record", async () => {
    mocks.transaction.mockRejectedValueOnce({
      cause: {
        cause: {
          code: "23505",
          constraint: "async_runs_one_active_key_idx",
        },
      },
    });
    vi.mocked(IdempotencyRepository.prototype.find)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(completedKey());
    await expect(
      createActionArtifact(
        scope,
        projectId,
        actionId,
        actorId,
        idempotencyKey,
        body,
      ),
    ).resolves.toMatchObject({ resourceRef: { id: artifact.id } });
  });

  it("maps a unique artifact race to its winning active run", async () => {
    mocks.transaction.mockRejectedValueOnce({
      code: "23505",
      constraint: "execution_artifacts_one_active_type_idx",
    });
    vi.mocked(IdempotencyRepository.prototype.find).mockResolvedValue(null);
    vi.mocked(
      ExecutionArtifactsRepository.prototype.findLiveByActionType,
    )
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(artifact);
    vi.mocked(AsyncRunsRepository.prototype.findActive)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(run);
    await expect(
      createActionArtifact(
        scope,
        projectId,
        actionId,
        actorId,
        idempotencyKey,
        body,
      ),
    ).rejects.toMatchObject({
      code: "RUN_ALREADY_ACTIVE",
      extraHeaders: { Location: expect.stringContaining(run.id) },
    });
  });

  it("uses the attempted active key when the unique winner has no artifact row", async () => {
    mocks.transaction.mockRejectedValueOnce({
      code: "23505",
      constraint: "async_runs_one_active_key_idx",
    });
    vi.mocked(IdempotencyRepository.prototype.find).mockResolvedValue(null);
    vi.mocked(AsyncRunsRepository.prototype.findActive)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    await expect(
      createActionArtifact(
        scope,
        projectId,
        actionId,
        actorId,
        idempotencyKey,
        body,
      ),
    ).rejects.toMatchObject({ code: "RUN_ALREADY_ACTIVE" });
  });

  it("preserves non-unique transaction errors", async () => {
    const failure = new Error("database unavailable");
    mocks.transaction.mockRejectedValueOnce(failure);
    await expect(
      createActionArtifact(
        scope,
        projectId,
        actionId,
        actorId,
        idempotencyKey,
        body,
      ),
    ).rejects.toBe(failure);
  });
});

describe("artifact reads", () => {
  it("lists current revisions and only exposes non-terminal active runs", async () => {
    vi.spyOn(ExecutionArtifactsRepository.prototype, "listByProject").mockResolvedValue({
      rows: [
        artifact,
        {
          ...artifact,
          id: "artifact-2",
          current_revision: 0,
          latest_generation_run_id: null,
        },
      ],
      nextCursor: "next",
    });
    vi.spyOn(
      ExecutionArtifactsRepository.prototype,
      "findRevision",
    ).mockResolvedValueOnce(revision);
    vi.spyOn(AsyncRunsRepository.prototype, "findById").mockResolvedValueOnce({
      ...run,
      status: "completed",
    });
    await expect(
      listProjectArtifacts(scope, projectId, {
        limit: 2,
        cursor: null,
        artifactType: "technical_ticket",
        status: "draft",
      }),
    ).resolves.toMatchObject({
      nextCursor: "next",
      limit: 2,
      data: [
        { current: { id: revision.id }, activeRun: null },
        { current: null, activeRun: null },
      ],
    });
    expect(
      ExecutionArtifactsRepository.prototype.listByProject,
    ).toHaveBeenCalledWith(
      { workspaceId: scope.workspaceId, projectId },
      {
        limit: 2,
        cursor: null,
        artifactType: "technical_ticket",
        status: "draft",
      },
    );
  });

  it("fails closed at the page byte budget without loading later revisions", async () => {
    vi.spyOn(
      ExecutionArtifactsRepository.prototype,
      "listByProject",
    ).mockResolvedValue({
      rows: [
        { ...artifact, latest_generation_run_id: null },
        {
          ...artifact,
          id: "artifact-2",
          latest_generation_run_id: null,
        },
        {
          ...artifact,
          id: "artifact-3",
          latest_generation_run_id: null,
        },
      ],
      nextCursor: null,
    });
    const findRevision = vi
      .spyOn(ExecutionArtifactsRepository.prototype, "findRevision")
      .mockResolvedValueOnce({
        ...revision,
        // Fewer than 16 MiB JavaScript characters, but more than 16 MiB once
        // serialized as UTF-8. This catches character-counting regressions.
        content_text: "界".repeat(Math.ceil((16 * 1024 * 1024) / 3)),
      })
      .mockResolvedValue(revision);
    const findRun = vi.spyOn(AsyncRunsRepository.prototype, "findById");

    await expect(
      listProjectArtifacts(scope, projectId, { limit: 100, cursor: null }),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      message: "Artifacts projection exceeded its safety budget.",
    });

    expect(findRevision).toHaveBeenCalledOnce();
    expect(findRevision).toHaveBeenCalledWith(
      { workspaceId: scope.workspaceId, projectId },
      artifact.id,
      artifact.current_revision,
    );
    expect(findRun).not.toHaveBeenCalled();
  });

  it("includes the active run in the final DTO byte budget", async () => {
    vi.spyOn(
      ExecutionArtifactsRepository.prototype,
      "listByProject",
    ).mockResolvedValue({
      rows: [{ ...artifact, current_revision: 0 }],
      nextCursor: null,
    });
    const findRevision = vi.spyOn(
      ExecutionArtifactsRepository.prototype,
      "findRevision",
    );
    const findRun = vi
      .spyOn(AsyncRunsRepository.prototype, "findById")
      .mockResolvedValue({
        ...run,
        progress: {
          phase: "queued",
          current: 0,
          total: null,
          messageKey: "界".repeat(Math.ceil((16 * 1024 * 1024) / 3)),
        },
      });

    await expect(
      listProjectArtifacts(scope, projectId, { limit: 1, cursor: null }),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      message: "Artifacts projection exceeded its safety budget.",
    });

    expect(findRevision).not.toHaveBeenCalled();
    expect(findRun).toHaveBeenCalledOnce();
  });

  it("rejects a missing project before listing artifacts", async () => {
    vi.mocked(ProjectsRepository.prototype.findById).mockResolvedValueOnce(null);
    await expect(
      listProjectArtifacts(scope, projectId, { limit: 20, cursor: null }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("gets an artifact with a running generation", async () => {
    vi.spyOn(ExecutionArtifactsRepository.prototype, "findById").mockResolvedValue(
      artifact,
    );
    vi.spyOn(
      ExecutionArtifactsRepository.prototype,
      "findRevision",
    ).mockResolvedValue(revision);
    vi.spyOn(AsyncRunsRepository.prototype, "findById").mockResolvedValue(run);
    await expect(
      getProjectArtifact(scope, projectId, artifact.id),
    ).resolves.toMatchObject({
      id: artifact.id,
      current: { id: revision.id },
      activeRun: { id: run.id },
    });
  });

  it("fails closed when the selected current revision alone exceeds the dto byte budget", async () => {
    vi.spyOn(ExecutionArtifactsRepository.prototype, "findById").mockResolvedValue(
      artifact,
    );
    vi.spyOn(
      ExecutionArtifactsRepository.prototype,
      "findRevision",
    ).mockResolvedValue({
      ...revision,
      content_text: "界".repeat(Math.ceil((16 * 1024 * 1024) / 3)),
    });
    const findRun = vi
      .spyOn(AsyncRunsRepository.prototype, "findById")
      .mockResolvedValue(null);

    await expect(
      getProjectArtifact(scope, projectId, artifact.id),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      message: "Artifacts projection exceeded its safety budget.",
    });
    expect(findRun).not.toHaveBeenCalled();
  });

  it("fails closed when the active run pushes the dto over the byte budget", async () => {
    vi.spyOn(ExecutionArtifactsRepository.prototype, "findById").mockResolvedValue({
      ...artifact,
      current_revision: 0,
    });
    const findRevision = vi.spyOn(
      ExecutionArtifactsRepository.prototype,
      "findRevision",
    );
    vi.spyOn(AsyncRunsRepository.prototype, "findById").mockResolvedValue({
      ...run,
      progress: {
        phase: "queued",
        current: 0,
        total: null,
        messageKey: "界".repeat(Math.ceil((16 * 1024 * 1024) / 3)),
      },
    });

    await expect(
      getProjectArtifact(scope, projectId, artifact.id),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      message: "Artifacts projection exceeded its safety budget.",
    });
    expect(findRevision).not.toHaveBeenCalled();
  });

  it("returns an under-budget dto unchanged", async () => {
    vi.spyOn(ExecutionArtifactsRepository.prototype, "findById").mockResolvedValue(
      artifact,
    );
    vi.spyOn(
      ExecutionArtifactsRepository.prototype,
      "findRevision",
    ).mockResolvedValue(revision);
    vi.spyOn(AsyncRunsRepository.prototype, "findById").mockResolvedValue(run);

    await expect(
      getProjectArtifact(scope, projectId, artifact.id),
    ).resolves.toMatchObject({
      id: artifact.id,
      current: { id: revision.id },
      activeRun: { id: run.id },
    });
  });

  it("fails closed when a multibyte current revision exceeds the single DTO byte budget", async () => {
    const artifactWithoutRun = {
      ...artifact,
      latest_generation_run_id: null,
    };
    vi.spyOn(ExecutionArtifactsRepository.prototype, "findById").mockResolvedValue(
      artifactWithoutRun,
    );
    vi.spyOn(
      ExecutionArtifactsRepository.prototype,
      "findRevision",
    ).mockResolvedValue({
      ...revision,
      // The character count is below 16 MiB while the serialized UTF-8 DTO is
      // above 16 MiB, so character-count based guards would incorrectly pass.
      content_text: "界".repeat(Math.ceil(ARTIFACTS_MAX_DTO_BYTES / 3)),
    });
    const findRun = vi.spyOn(AsyncRunsRepository.prototype, "findById");

    await expect(
      getProjectArtifact(scope, projectId, artifact.id),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      message: "Artifacts projection exceeded its safety budget.",
    });
    expect(findRun).not.toHaveBeenCalled();
  });

  it("includes a non-terminal active run in the single DTO byte budget", async () => {
    vi.spyOn(ExecutionArtifactsRepository.prototype, "findById").mockResolvedValue({
      ...artifact,
      current_revision: 0,
    });
    const findRevision = vi.spyOn(
      ExecutionArtifactsRepository.prototype,
      "findRevision",
    );
    const findRun = vi
      .spyOn(AsyncRunsRepository.prototype, "findById")
      .mockResolvedValue({
        ...run,
        progress: {
          phase: "queued",
          current: 0,
          total: null,
          messageKey: "界".repeat(Math.ceil(ARTIFACTS_MAX_DTO_BYTES / 3)),
        },
      });

    await expect(
      getProjectArtifact(scope, projectId, artifact.id),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      message: "Artifacts projection exceeded its safety budget.",
    });
    expect(findRevision).not.toHaveBeenCalled();
    expect(findRun).toHaveBeenCalledOnce();
  });

  it("allows a single DTO exactly at the byte budget and an ordinary DTO below it", async () => {
    const artifactWithoutRun = {
      ...artifact,
      latest_generation_run_id: null,
    };
    const exactRevision = revisionForExactDtoBytes(
      artifactWithoutRun,
      revision,
      ARTIFACTS_MAX_DTO_BYTES,
    );
    vi.spyOn(ExecutionArtifactsRepository.prototype, "findById").mockResolvedValue(
      artifactWithoutRun,
    );
    const findRevision = vi
      .spyOn(ExecutionArtifactsRepository.prototype, "findRevision")
      .mockResolvedValueOnce(exactRevision)
      .mockResolvedValueOnce({ ...revision, content_text: "small" });

    const exactResult = await getProjectArtifact(
      scope,
      projectId,
      artifact.id,
    );
    expect(utf8JsonBytes(exactResult)).toBe(ARTIFACTS_MAX_DTO_BYTES);

    const belowResult = await getProjectArtifact(
      scope,
      projectId,
      artifact.id,
    );
    expect(utf8JsonBytes(belowResult)).toBeLessThan(ARTIFACTS_MAX_DTO_BYTES);
    expect(findRevision).toHaveBeenCalledTimes(2);
  });

  it("loads an explicitly requested historical revision without changing currentRevision", async () => {
    const historical = {
      ...revision,
      revision: 7,
      id: "revision-7",
      output_locale: "en",
    };
    vi.spyOn(ExecutionArtifactsRepository.prototype, "findById").mockResolvedValue({
      ...artifact,
      current_revision: 9,
      output_locale: "zh-CN",
    });
    vi.spyOn(
      ExecutionArtifactsRepository.prototype,
      "findRevision",
    ).mockResolvedValue(historical);
    vi.spyOn(AsyncRunsRepository.prototype, "findById").mockResolvedValue(null);

    await expect(
      getProjectArtifact(scope, projectId, artifact.id, 7),
    ).resolves.toMatchObject({
      currentRevision: 9,
      outputLocale: "zh-CN",
      current: {
        id: historical.id,
        revision: 7,
        outputLocale: "en",
      },
    });
    expect(
      ExecutionArtifactsRepository.prototype.findRevision,
    ).toHaveBeenCalledWith(
      { workspaceId: scope.workspaceId, projectId },
      artifact.id,
      7,
    );
  });

  it("applies the single DTO byte budget to a requested historical revision before any optional active-run read", async () => {
    const historical = {
      ...revision,
      revision: 7,
      id: "revision-7",
      content_text: "界".repeat(Math.ceil(ARTIFACTS_MAX_DTO_BYTES / 3)),
    };
    vi.spyOn(ExecutionArtifactsRepository.prototype, "findById").mockResolvedValue({
      ...artifact,
      current_revision: 9,
    });
    vi.spyOn(
      ExecutionArtifactsRepository.prototype,
      "findRevision",
    ).mockResolvedValue(historical);
    const findRun = vi
      .spyOn(AsyncRunsRepository.prototype, "findById")
      .mockResolvedValue(run);

    await expect(
      getProjectArtifact(scope, projectId, artifact.id, 7),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      message: "Artifacts projection exceeded its safety budget.",
    });
    expect(
      ExecutionArtifactsRepository.prototype.findRevision,
    ).toHaveBeenCalledWith(
      { workspaceId: scope.workspaceId, projectId },
      artifact.id,
      7,
    );
    expect(findRun).not.toHaveBeenCalled();
  });

  it("returns the same non-enumerating 404 when a requested revision is absent", async () => {
    vi.spyOn(ExecutionArtifactsRepository.prototype, "findById").mockResolvedValue(
      artifact,
    );
    vi.spyOn(
      ExecutionArtifactsRepository.prototype,
      "findRevision",
    ).mockResolvedValue(null);
    const findRun = vi.spyOn(AsyncRunsRepository.prototype, "findById");

    await expect(
      getProjectArtifact(scope, projectId, artifact.id, 99),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(findRun).not.toHaveBeenCalled();
  });

  it("gets an ungenerated artifact without optional reads", async () => {
    vi.spyOn(ExecutionArtifactsRepository.prototype, "findById").mockResolvedValue({
      ...artifact,
      current_revision: 0,
      latest_generation_run_id: null,
    });
    const findRevision = vi.spyOn(
      ExecutionArtifactsRepository.prototype,
      "findRevision",
    );
    const findRun = vi.spyOn(AsyncRunsRepository.prototype, "findById");
    await expect(
      getProjectArtifact(scope, projectId, artifact.id),
    ).resolves.toMatchObject({ current: null, activeRun: null });
    expect(findRevision).not.toHaveBeenCalled();
    expect(findRun).not.toHaveBeenCalled();
  });

  it("returns a non-enumerating 404 for a missing artifact", async () => {
    vi.spyOn(ExecutionArtifactsRepository.prototype, "findById").mockResolvedValue(
      null,
    );
    await expect(
      getProjectArtifact(scope, projectId, "missing"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
