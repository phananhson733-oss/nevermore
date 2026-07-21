import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActionsRepository,
  contentHash,
  ExecutionArtifactsRepository,
  ProjectsRepository,
  type ActionRow,
  type ArtifactRevisionRow,
  type ArtifactRow,
  type ProjectRow,
} from "@sf/db";
import {
  MAX_ARTIFACT_CONTENT_CHARS,
  type UpdateArtifactRequest,
} from "@sf/contracts";
import type { ArtifactDto } from "../artifact-mappers";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  transaction: vi.fn(),
  getProjectArtifact: vi.fn(),
  validateArtifact: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("../artifacts", () => ({
  getProjectArtifact: mocks.getProjectArtifact,
}));
vi.mock("@sf/artifacts", async () => {
  const actual = await vi.importActual<typeof import("@sf/artifacts")>(
    "@sf/artifacts",
  );
  return { ...actual, validateArtifact: mocks.validateArtifact };
});

const { updateProjectArtifact } = await import("../artifact-update.ts");

const scope = { workspaceId: "workspace-1" };
const projectId = "project-1";
const artifactId = "artifact-1";
const actorId = "operator-1";

const project = {
  id: projectId,
  workspace_id: scope.workspaceId,
  client_name: "Client",
  project_name: "Project",
  stage: "executing",
  default_delivery_locale: "en",
  current_icp_profile_id: null,
  confirmed_icp_profile_id: null,
  archived_at: null,
  created_by: actorId,
  created_at: "2026-07-20T00:00:00.000Z",
  updated_at: "2026-07-20T00:00:00.000Z",
} as ProjectRow;

function artifactRow(overrides: Partial<ArtifactRow> = {}): ArtifactRow {
  return {
    id: artifactId,
    workspace_id: scope.workspaceId,
    project_id: projectId,
    action_id: "action-1",
    artifact_type: "content_brief",
    status: "draft",
    generation_mode: "template",
    output_locale: "en",
    current_revision: 3,
    validation_state: "valid",
    content_hash: "previous-hash",
    latest_generation_run_id: null,
    created_by: actorId,
    created_at: "2026-07-20T00:00:00.000Z",
    updated_at: "2026-07-20T00:00:00.000Z",
    ...overrides,
  };
}

function revisionRow(
  overrides: Partial<ArtifactRevisionRow> = {},
): ArtifactRevisionRow {
  return {
    id: "revision-3",
    workspace_id: scope.workspaceId,
    project_id: projectId,
    artifact_id: artifactId,
    revision: 3,
    output_locale: "en",
    content_format: "markdown",
    content_text: "# Existing",
    content_json: null,
    content_hash: "previous-hash",
    generated_by: "operator",
    editor_id: actorId,
    analysis_invocation_id: null,
    note: null,
    validation_errors: [],
    created_at: "2026-07-20T00:00:00.000Z",
    ...overrides,
  };
}

const resultDto = { id: artifactId } as ArtifactDto;
const tx = { kind: "transaction" };
const db = { transaction: mocks.transaction };

type ContentUpdateBody = {
  baseRevision: number;
  contentFormat: "markdown" | "json" | "csv";
  content: string | Record<string, unknown>;
  editorNote?: string | null;
};

type StatusUpdateBody = {
  baseRevision: number;
  status: "draft" | "ready" | "archived";
};

function contentUpdate(
  overrides: Partial<ContentUpdateBody> = {},
): ContentUpdateBody {
  return {
    baseRevision: 3,
    contentFormat: "markdown",
    content: "# Updated content",
    ...overrides,
  };
}

function statusUpdate(
  overrides: Partial<StatusUpdateBody> = {},
): StatusUpdateBody {
  return { baseRevision: 3, status: "ready", ...overrides };
}

function update(body: UpdateArtifactRequest): Promise<ArtifactDto> {
  return updateProjectArtifact(scope, projectId, artifactId, actorId, body);
}

function useArtifact(row: ArtifactRow): void {
  vi.mocked(ExecutionArtifactsRepository.prototype.findById).mockResolvedValue(
    row,
  );
  vi.mocked(
    ExecutionArtifactsRepository.prototype.findByIdForUpdate,
  ).mockResolvedValue(row);
}

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.getDb.mockReset().mockReturnValue({ db });
  mocks.transaction.mockReset().mockImplementation(
    async (callback: (transaction: object) => Promise<unknown>) => callback(tx),
  );
  mocks.getProjectArtifact.mockReset().mockResolvedValue(resultDto);
  mocks.validateArtifact.mockReset().mockReturnValue({
    valid: true,
    errors: [],
  });

  vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue(project);
  vi.spyOn(ProjectsRepository.prototype, "findByIdForUpdate").mockResolvedValue(
    project,
  );
  vi.spyOn(ActionsRepository.prototype, "findById").mockResolvedValue(null);
  vi.spyOn(ExecutionArtifactsRepository.prototype, "findById").mockResolvedValue(
    artifactRow(),
  );
  vi.spyOn(
    ExecutionArtifactsRepository.prototype,
    "findByIdForUpdate",
  ).mockResolvedValue(artifactRow());
  vi.spyOn(
    ExecutionArtifactsRepository.prototype,
    "findRevision",
  ).mockResolvedValue(revisionRow());
  vi.spyOn(
    ExecutionArtifactsRepository.prototype,
    "setGeneratedIfRevision",
  ).mockResolvedValue(true);
  vi.spyOn(
    ExecutionArtifactsRepository.prototype,
    "insertRevision",
  ).mockResolvedValue(revisionRow({ revision: 4 }));
  vi.spyOn(
    ExecutionArtifactsRepository.prototype,
    "setStatusIfRevision",
  ).mockResolvedValue(true);
});

describe("updateProjectArtifact request and resource guards", () => {
  it("fails an oversized internal content request before any database access", async () => {
    const body: UpdateArtifactRequest = {
      baseRevision: 1,
      contentFormat: "markdown",
      content: "x".repeat(MAX_ARTIFACT_CONTENT_CHARS + 1),
    };

    await expect(update(body)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
    });
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(ProjectsRepository.prototype.findById).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND when the scoped project does not exist", async () => {
    vi.mocked(ProjectsRepository.prototype.findById).mockResolvedValueOnce(null);

    await expect(update(statusUpdate())).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
    expect(ExecutionArtifactsRepository.prototype.findById).not.toHaveBeenCalled();
  });

  it("rejects an archived project before looking up its artifact", async () => {
    vi.mocked(ProjectsRepository.prototype.findById).mockResolvedValueOnce({
      ...project,
      archived_at: "2026-07-20T01:00:00.000Z",
    });

    await expect(update(statusUpdate())).rejects.toMatchObject({
      code: "PROJECT_ARCHIVED",
      status: 422,
    });
    expect(ExecutionArtifactsRepository.prototype.findById).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND when the artifact is outside the project scope", async () => {
    vi.mocked(
      ExecutionArtifactsRepository.prototype.findById,
    ).mockResolvedValueOnce(null);

    await expect(update(statusUpdate())).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

describe("updateProjectArtifact content revisions", () => {
  it("rejects a stale base revision before starting a transaction", async () => {
    await expect(
      update(contentUpdate({ baseRevision: 2 })),
    ).rejects.toMatchObject({ code: "STALE_REVISION", status: 409 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects content edits while the artifact is not operator-editable", async () => {
    useArtifact(artifactRow({ status: "generating" }));

    await expect(update(contentUpdate())).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
      status: 409,
    });
    expect(mocks.validateArtifact).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("appends a valid immutable text revision and returns the refreshed DTO", async () => {
    const body = contentUpdate({ editorNote: "operator correction" });
    const expectedHash = contentHash({ text: body.content as string });

    await expect(update(body)).resolves.toBe(resultDto);

    expect(mocks.validateArtifact).toHaveBeenCalledWith(
      "content_brief",
      { contentFormat: "markdown", content: body.content },
      { requiresValidationRollback: false },
    );
    expect(
      ExecutionArtifactsRepository.prototype.setGeneratedIfRevision,
    ).toHaveBeenCalledWith(
      { workspaceId: scope.workspaceId, projectId },
      artifactId,
      {
        status: "draft",
        currentRevision: 4,
        expectedRevision: 3,
        expectedStatus: "draft",
        validationState: "valid",
        contentHash: expectedHash,
      },
    );
    expect(
      ExecutionArtifactsRepository.prototype.insertRevision,
    ).toHaveBeenCalledWith({
      workspaceId: scope.workspaceId,
      projectId,
      artifactId,
      revision: 4,
      outputLocale: "en",
      contentFormat: "markdown",
      contentText: body.content,
      contentJson: null,
      contentHash: expectedHash,
      generatedBy: "operator",
      editorId: actorId,
      analysisInvocationId: null,
      note: "operator correction",
      validationErrors: [],
    });
    expect(mocks.getProjectArtifact).toHaveBeenCalledWith(
      scope,
      projectId,
      artifactId,
    );
  });

  it("stores invalid JSON as a draft revision with validation errors", async () => {
    const row = artifactRow({ artifact_type: "metadata_rewrite" });
    const content = { pages: [{ path: "/", title: "" }] };
    const body = contentUpdate({ contentFormat: "json", content });
    useArtifact(row);
    mocks.validateArtifact.mockReturnValueOnce({
      valid: false,
      errors: ["title is required"],
    });

    await expect(update(body)).resolves.toBe(resultDto);

    expect(
      ExecutionArtifactsRepository.prototype.setGeneratedIfRevision,
    ).toHaveBeenCalledWith(
      expect.anything(),
      artifactId,
      expect.objectContaining({ validationState: "invalid" }),
    );
    expect(
      ExecutionArtifactsRepository.prototype.insertRevision,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        contentText: null,
        contentJson: content,
        note: null,
        validationErrors: ["title is required"],
      }),
    );
  });

  it.each([
    { risk: "high", expected: true },
    { risk: null, expected: false },
  ])(
    "derives technical-ticket rollback validation from action risk $risk",
    async ({ risk, expected }) => {
      const row = artifactRow({ artifact_type: "technical_ticket" });
      useArtifact(row);
      vi.mocked(ActionsRepository.prototype.findById).mockResolvedValueOnce(
        risk === null ? null : ({ id: row.action_id, risk } as ActionRow),
      );

      await expect(update(contentUpdate())).resolves.toBe(resultDto);

      expect(ActionsRepository.prototype.findById).toHaveBeenCalledWith(
        { workspaceId: scope.workspaceId, projectId },
        row.action_id,
      );
      expect(mocks.validateArtifact).toHaveBeenCalledWith(
        "technical_ticket",
        expect.anything(),
        { requiresValidationRollback: expected },
      );
      expect(mocks.getDb).toHaveBeenCalledTimes(2);
    },
  );

  it("treats identical bytes in the identical format as an idempotent no-op", async () => {
    const body = contentUpdate({ content: "same bytes" });
    const hash = contentHash({ text: body.content as string });
    const row = artifactRow({ content_hash: hash });
    useArtifact(row);
    vi.mocked(
      ExecutionArtifactsRepository.prototype.findRevision,
    ).mockResolvedValueOnce(
      revisionRow({ content_hash: hash, content_text: body.content as string }),
    );

    await expect(update(body)).resolves.toBe(resultDto);

    expect(
      ExecutionArtifactsRepository.prototype.setGeneratedIfRevision,
    ).not.toHaveBeenCalled();
    expect(
      ExecutionArtifactsRepository.prototype.insertRevision,
    ).not.toHaveBeenCalled();
  });

  it("does not collapse equal bytes when the content format changes", async () => {
    const body = contentUpdate({ contentFormat: "csv", content: "same bytes" });
    const hash = contentHash({ text: body.content as string });
    const row = artifactRow({ content_hash: hash });
    useArtifact(row);
    vi.mocked(
      ExecutionArtifactsRepository.prototype.findRevision,
    ).mockResolvedValueOnce(
      revisionRow({ content_hash: hash, content_text: body.content as string }),
    );

    await expect(update(body)).resolves.toBe(resultDto);

    expect(
      ExecutionArtifactsRepository.prototype.setGeneratedIfRevision,
    ).toHaveBeenCalled();
    expect(
      ExecutionArtifactsRepository.prototype.insertRevision,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ contentFormat: "csv", revision: 4 }),
    );
  });

  it("fails loudly when the current revision referenced by the artifact is missing", async () => {
    const body = contentUpdate({ content: "same bytes" });
    const row = artifactRow({
      content_hash: contentHash({ text: body.content as string }),
    });
    useArtifact(row);
    vi.mocked(
      ExecutionArtifactsRepository.prototype.findRevision,
    ).mockResolvedValueOnce(null);

    await expect(update(body)).rejects.toThrow(
      "artifact current revision is unavailable",
    );
    expect(
      ExecutionArtifactsRepository.prototype.setGeneratedIfRevision,
    ).not.toHaveBeenCalled();
  });

  it("maps a failed revision CAS to STALE_REVISION", async () => {
    vi.mocked(
      ExecutionArtifactsRepository.prototype.setGeneratedIfRevision,
    ).mockResolvedValueOnce(false);

    await expect(update(contentUpdate())).rejects.toMatchObject({
      code: "STALE_REVISION",
      status: 409,
    });
    expect(
      ExecutionArtifactsRepository.prototype.insertRevision,
    ).not.toHaveBeenCalled();
  });

  it("rechecks project existence and archival state inside the transaction", async () => {
    vi.mocked(ProjectsRepository.prototype.findByIdForUpdate)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...project,
        archived_at: "2026-07-20T01:00:00.000Z",
      });

    await expect(update(contentUpdate())).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(update(contentUpdate())).rejects.toMatchObject({
      code: "PROJECT_ARCHIVED",
    });
    expect(
      ExecutionArtifactsRepository.prototype.findByIdForUpdate,
    ).not.toHaveBeenCalled();
  });

  it("rejects a concurrent artifact deletion", async () => {
    vi.mocked(
      ExecutionArtifactsRepository.prototype.findByIdForUpdate,
    ).mockResolvedValueOnce(null);

    await expect(update(contentUpdate())).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });

  it("rejects concurrent revision and status changes under the row lock", async () => {
    vi.mocked(ExecutionArtifactsRepository.prototype.findByIdForUpdate)
      .mockResolvedValueOnce(artifactRow({ current_revision: 4 }))
      .mockResolvedValueOnce(artifactRow({ status: "ready" }));

    await expect(update(contentUpdate())).rejects.toMatchObject({
      code: "STALE_REVISION",
    });
    await expect(update(contentUpdate())).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
    });
  });
});

describe("updateProjectArtifact status transitions", () => {
  it("rejects a stale status command before starting a transaction", async () => {
    await expect(
      update(statusUpdate({ baseRevision: 2 })),
    ).rejects.toMatchObject({ code: "STALE_REVISION", status: 409 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("moves a valid draft to ready without changing its content revision", async () => {
    await expect(update(statusUpdate())).resolves.toBe(resultDto);

    expect(
      ExecutionArtifactsRepository.prototype.setStatusIfRevision,
    ).toHaveBeenCalledWith(
      { workspaceId: scope.workspaceId, projectId },
      artifactId,
      "ready",
      3,
      "draft",
    );
    expect(
      ExecutionArtifactsRepository.prototype.insertRevision,
    ).not.toHaveBeenCalled();
    expect(mocks.getProjectArtifact).toHaveBeenCalledWith(
      scope,
      projectId,
      artifactId,
    );
  });

  it("treats a same-status draft command as a true no-op", async () => {
    await expect(update(statusUpdate({ status: "draft" }))).resolves.toBe(
      resultDto,
    );
    expect(
      ExecutionArtifactsRepository.prototype.setStatusIfRevision,
    ).not.toHaveBeenCalled();
  });

  it("still rejects an invalid ready artifact on a same-status retry", async () => {
    useArtifact(artifactRow({ status: "ready", validation_state: "invalid" }));

    await expect(update(statusUpdate())).rejects.toMatchObject({
      code: "ARTIFACT_VALIDATION_FAILED",
      status: 422,
    });
    expect(
      ExecutionArtifactsRepository.prototype.setStatusIfRevision,
    ).not.toHaveBeenCalled();
  });

  it("rejects a forbidden manual transition", async () => {
    useArtifact(artifactRow({ status: "ready" }));

    await expect(
      update(statusUpdate({ status: "draft" })),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT", status: 409 });
  });

  it("requires valid content before transitioning a draft to ready", async () => {
    useArtifact(artifactRow({ validation_state: "invalid" }));

    await expect(update(statusUpdate())).rejects.toMatchObject({
      code: "ARTIFACT_VALIDATION_FAILED",
      status: 422,
    });
  });

  it("maps a failed status CAS to VERSION_CONFLICT", async () => {
    vi.mocked(
      ExecutionArtifactsRepository.prototype.setStatusIfRevision,
    ).mockResolvedValueOnce(false);

    await expect(update(statusUpdate())).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
      status: 409,
    });
  });

  it("rechecks project and artifact state under the status transaction lock", async () => {
    vi.mocked(ProjectsRepository.prototype.findByIdForUpdate)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...project,
        archived_at: "2026-07-20T01:00:00.000Z",
      })
      .mockResolvedValue(project);
    vi.mocked(ExecutionArtifactsRepository.prototype.findByIdForUpdate)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(artifactRow({ current_revision: 4 }))
      .mockResolvedValueOnce(artifactRow({ status: "ready" }));

    await expect(update(statusUpdate())).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(update(statusUpdate())).rejects.toMatchObject({
      code: "PROJECT_ARCHIVED",
    });
    await expect(update(statusUpdate())).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(update(statusUpdate())).rejects.toMatchObject({
      code: "STALE_REVISION",
    });
    await expect(update(statusUpdate())).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
    });
  });
});
