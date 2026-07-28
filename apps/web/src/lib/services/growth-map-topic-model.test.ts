import {
  ProjectsRepository,
  TopicModelConflictError,
  TopicModelIntegrityError,
  TopicModelsRepository,
  type Executor,
} from "@sf/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginProjectAuditTopicModelDraft,
  confirmProjectAuditTopicModelDraft,
  getProjectAuditTopicModelWorkspace,
  patchProjectAuditTopicModelDraft,
} from "./growth-map-topic-model.ts";

const ids = {
  workspace: "10000000-0000-4000-8000-000000000001",
  project: "10000000-0000-4000-8000-000000000002",
  actor: "10000000-0000-4000-8000-000000000003",
  node: "10000000-0000-4000-8000-000000000004",
} as const;

const readScope = { workspaceId: ids.workspace };
const mutationScope = {
  workspaceId: ids.workspace,
  actorId: ids.actor,
};
const exec = {} as Executor;

function activeProject(
  overrides: Readonly<Record<string, unknown>> = {},
): void {
  vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue({
    id: ids.project,
    workspace_id: ids.workspace,
    archived_at: null,
    ...overrides,
  } as never);
}

const confirmedV1 = {
  state: "confirmed" as const,
  projectId: ids.project,
  topicModelRevision: 1,
  editRevision: 1,
  rootTopicNodeId: ids.node,
  nodes: [
    {
      projectId: ids.project,
      topicNodeId: ids.node,
      topicModelRevision: 1,
      parentTopicNodeId: null,
      label: "Customer onboarding",
      description: "The customer onboarding product and content pillar.",
      intentEnvelope: ["commercial"],
      lifecycleState: "active" as const,
    },
  ],
  aliases: [],
  successorRelationships: [],
  createdAt: "2026-07-22T08:00:00.000Z",
  createdBy: ids.actor,
  confirmedAt: "2026-07-22T09:00:00.000Z",
  confirmedBy: ids.actor,
  contentHash: "a".repeat(64),
};

const draftV2 = {
  state: "draft" as const,
  projectId: ids.project,
  topicModelRevision: 2,
  editRevision: 0,
  rootTopicNodeId: ids.node,
  nodes: [
    {
      projectId: ids.project,
      topicNodeId: ids.node,
      topicModelRevision: 2,
      parentTopicNodeId: null,
      label: "Customer onboarding",
      description: "The customer onboarding product and content pillar.",
      intentEnvelope: ["commercial"],
      lifecycleState: "active" as const,
    },
  ],
  aliases: [],
  successorRelationships: [],
  createdAt: "2026-07-22T10:00:00.000Z",
  createdBy: ids.actor,
  updatedAt: "2026-07-22T10:00:00.000Z",
};

const confirmedV2 = {
  ...confirmedV1,
  topicModelRevision: 2,
  editRevision: 1,
  nodes: confirmedV1.nodes.map((node) => ({
    ...node,
    topicModelRevision: 2,
  })),
  createdAt: "2026-07-22T10:00:00.000Z",
  confirmedAt: "2026-07-22T11:00:00.000Z",
  contentHash: "b".repeat(64),
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Growth Map Topic Model workspace", () => {
  it("returns the confirmed authority and unique editable successor together", async () => {
    activeProject();
    const readOrder: string[] = [];
    vi.spyOn(
      TopicModelsRepository.prototype,
      "getLatestConfirmed",
    ).mockImplementation(async () => {
      readOrder.push("confirmed");
      return confirmedV1;
    });
    vi.spyOn(
      TopicModelsRepository.prototype,
      "getDraft",
    ).mockImplementation(async () => {
      readOrder.push("draft");
      return draftV2;
    });

    const result = await getProjectAuditTopicModelWorkspace(
      readScope,
      ids.project,
      exec,
    );

    expect(readOrder).toEqual(["confirmed", "draft"]);
    expect(result).toMatchObject({
      projectId: ids.project,
      latestConfirmed: { state: "confirmed", topicModelRevision: 1 },
      draft: { state: "draft", topicModelRevision: 2 },
    });
    expect(Date.parse(result.generatedAt)).toBeGreaterThanOrEqual(
      Date.parse(draftV2.updatedAt),
    );
  });

  it("hides missing, foreign, and archived projects before reading Topic state", async () => {
    activeProject({ workspace_id: "20000000-0000-4000-8000-000000000001" });
    const readConfirmed = vi.spyOn(
      TopicModelsRepository.prototype,
      "getLatestConfirmed",
    );

    await expect(
      getProjectAuditTopicModelWorkspace(readScope, ids.project, exec),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(readConfirmed).not.toHaveBeenCalled();
  });

  it("fails closed when persisted Topic state cannot pass integrity checks", async () => {
    activeProject();
    vi.spyOn(
      TopicModelsRepository.prototype,
      "getLatestConfirmed",
    ).mockRejectedValue(
      new TopicModelIntegrityError("PROJECTION_INVALID"),
    );

    await expect(
      getProjectAuditTopicModelWorkspace(readScope, ids.project, exec),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      status: 503,
    });
  });
});

describe("Growth Map Topic Model draft lifecycle", () => {
  it("begins the exact next draft with only server-resolved actor scope", async () => {
    activeProject();
    const begin = vi
      .spyOn(
        TopicModelsRepository.prototype,
        "beginDraftFromLatestConfirmed",
      )
      .mockResolvedValue(draftV2);
    vi.spyOn(
      TopicModelsRepository.prototype,
      "getLatestConfirmed",
    ).mockResolvedValue(confirmedV1);
    vi.spyOn(TopicModelsRepository.prototype, "getDraft").mockResolvedValue(
      draftV2,
    );

    const body = {
      expectedLatestConfirmedRevision: 1,
      reason: "Refresh the customer-facing Topic Map.",
    };
    const result = await beginProjectAuditTopicModelDraft(
      mutationScope,
      ids.project,
      body,
      exec,
    );

    expect(begin).toHaveBeenCalledWith(
      { workspaceId: ids.workspace, projectId: ids.project },
      ids.actor,
      body,
    );
    expect(result.draft?.topicModelRevision).toBe(2);
    expect(result.latestConfirmed?.topicModelRevision).toBe(1);
  });

  it("rejects widened begin payloads before any repository mutation", async () => {
    const begin = vi.spyOn(
      TopicModelsRepository.prototype,
      "beginDraftFromLatestConfirmed",
    );

    await expect(
      beginProjectAuditTopicModelDraft(
        mutationScope,
        ids.project,
        {
          expectedLatestConfirmedRevision: 1,
          reason: "Refresh the Topic Map.",
          actorId: ids.actor,
        } as never,
        exec,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    expect(begin).not.toHaveBeenCalled();
  });

  it("returns a stable conflict when another editable draft already exists", async () => {
    activeProject();
    vi.spyOn(
      TopicModelsRepository.prototype,
      "beginDraftFromLatestConfirmed",
    ).mockRejectedValue(new TopicModelConflictError("DRAFT_EXISTS", 1, 2));

    await expect(
      beginProjectAuditTopicModelDraft(
        mutationScope,
        ids.project,
        {
          expectedLatestConfirmedRevision: 1,
          reason: "Refresh the Topic Map.",
        },
        exec,
      ),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT", status: 409 });
  });

  it("exposes only validated current revision facts on stale model writes", async () => {
    activeProject();
    vi.spyOn(
      TopicModelsRepository.prototype,
      "beginDraftFromLatestConfirmed",
    ).mockRejectedValue(
      new TopicModelConflictError("MODEL_REVISION_CONFLICT", 1, 2),
    );

    await expect(
      beginProjectAuditTopicModelDraft(
        mutationScope,
        ids.project,
        {
          expectedLatestConfirmedRevision: 1,
          reason: "Refresh the Topic Map.",
        },
        exec,
      ),
    ).rejects.toMatchObject({
      code: "STALE_REVISION",
      status: 409,
      current: {
        kind: "revision_conflict",
        resource: "topic_model",
        projectId: ids.project,
        resourceId: ids.project,
        expectedRevision: 1,
        currentRevision: 2,
      },
    });
  });

  it("fails closed instead of fabricating mismatched conflict metadata", async () => {
    activeProject();
    vi.spyOn(
      TopicModelsRepository.prototype,
      "beginDraftFromLatestConfirmed",
    ).mockRejectedValue(
      new TopicModelConflictError("MODEL_REVISION_CONFLICT", 99, 2),
    );

    await expect(
      beginProjectAuditTopicModelDraft(
        mutationScope,
        ids.project,
        {
          expectedLatestConfirmedRevision: 1,
          reason: "Refresh the Topic Map.",
        },
        exec,
      ),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      status: 503,
    });
  });

  it("maps invalid split or merge topology to field-addressed validation", async () => {
    activeProject();
    vi.spyOn(TopicModelsRepository.prototype, "patchDraft").mockRejectedValue(
      new TopicModelConflictError("TOPIC_NODE_INVALID"),
    );

    await expect(
      patchProjectAuditTopicModelDraft(
        mutationScope,
        ids.project,
        {
          topicModelRevision: 2,
          expectedEditRevision: 0,
          reason: "Rename the root for customer clarity.",
          intents: [
            {
              kind: "rename",
              topicNodeId: ids.node,
              label: "Customer onboarding automation",
            },
          ],
        },
        exec,
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      fieldErrors: [
        {
          pointer: "/intents",
          code: "invalid_topic_model_mutation",
        },
      ],
    });
  });

  it.each([
    [
      "TOPIC_ROOT_RETIRE_FORBIDDEN",
      "root_topic_cannot_be_retired",
      "根 Topic 不能删除",
    ],
    [
      "TOPIC_NODE_HAS_ACTIVE_CHILDREN",
      "topic_has_active_children",
      "该 Topic 仍有活跃子节点",
    ],
  ] as const)(
    "maps %s to an explicit customer-addressable retirement error",
    async (conflictCode, fieldCode, message) => {
      activeProject();
      vi.spyOn(
        TopicModelsRepository.prototype,
        "patchDraft",
      ).mockRejectedValue(new TopicModelConflictError(conflictCode));

      await expect(
        patchProjectAuditTopicModelDraft(
          mutationScope,
          ids.project,
          {
            topicModelRevision: 2,
            expectedEditRevision: 0,
            reason: "Delete an obsolete Topic from the customer map.",
            intents: [
              {
                kind: "retire",
                topicNodeId: ids.node,
                affectedKeywordReviewState: "unreviewed",
              },
            ],
          },
          exec,
        ),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        status: 422,
        message: expect.stringContaining(message),
        fieldErrors: [
          {
            pointer: "/intents",
            code: fieldCode,
            message: expect.stringContaining(message),
          },
        ],
      });
    },
  );

  it("uses edit-revision CAS metadata for concurrent draft edits", async () => {
    activeProject();
    vi.spyOn(TopicModelsRepository.prototype, "patchDraft").mockRejectedValue(
      new TopicModelConflictError("EDIT_REVISION_CONFLICT", 0, 1),
    );

    await expect(
      patchProjectAuditTopicModelDraft(
        mutationScope,
        ids.project,
        {
          topicModelRevision: 2,
          expectedEditRevision: 0,
          reason: "Rename the root for customer clarity.",
          intents: [
            {
              kind: "rename",
              topicNodeId: ids.node,
              label: "Customer onboarding automation",
            },
          ],
        },
        exec,
      ),
    ).rejects.toMatchObject({
      code: "STALE_REVISION",
      status: 409,
      current: {
        expectedRevision: 0,
        currentRevision: 1,
      },
    });
  });

  it("confirms the exact draft and re-reads the immutable winner", async () => {
    activeProject();
    const confirm = vi
      .spyOn(TopicModelsRepository.prototype, "confirmDraft")
      .mockResolvedValue(confirmedV2);
    vi.spyOn(
      TopicModelsRepository.prototype,
      "getLatestConfirmed",
    ).mockResolvedValue(confirmedV2);
    vi.spyOn(TopicModelsRepository.prototype, "getDraft").mockResolvedValue(
      null,
    );
    const body = {
      topicModelRevision: 2,
      expectedEditRevision: 1,
      reason: "Confirm the reviewed customer Topic Map.",
    };

    const result = await confirmProjectAuditTopicModelDraft(
      mutationScope,
      ids.project,
      body,
      exec,
    );

    expect(confirm).toHaveBeenCalledWith(
      { workspaceId: ids.workspace, projectId: ids.project },
      ids.actor,
      body,
    );
    expect(result).toMatchObject({
      latestConfirmed: {
        state: "confirmed",
        topicModelRevision: 2,
      },
      draft: null,
    });
  });

  it("fails closed if a mutation re-read does not form one coherent workspace", async () => {
    activeProject();
    vi.spyOn(
      TopicModelsRepository.prototype,
      "beginDraftFromLatestConfirmed",
    ).mockResolvedValue(draftV2);
    vi.spyOn(
      TopicModelsRepository.prototype,
      "getLatestConfirmed",
    ).mockResolvedValue(confirmedV1);
    vi.spyOn(TopicModelsRepository.prototype, "getDraft").mockResolvedValue({
      ...draftV2,
      topicModelRevision: 3,
      nodes: draftV2.nodes.map((node) => ({
        ...node,
        topicModelRevision: 3,
      })),
    });

    await expect(
      beginProjectAuditTopicModelDraft(
        mutationScope,
        ids.project,
        {
          expectedLatestConfirmedRevision: 1,
          reason: "Refresh the Topic Map.",
        },
        exec,
      ),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      status: 503,
    });
  });
});
