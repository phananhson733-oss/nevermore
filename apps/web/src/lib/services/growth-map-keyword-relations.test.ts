import {
  KeywordRelationConflictError,
  KeywordRelationIntegrityError,
  KeywordRelationsRepository,
  ProjectsRepository,
  type Executor,
} from "@sf/db";
import type { GrowthMapKeywordRelation } from "@sf/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));

const {
  decideProjectAuditKeywordRelation,
  getProjectAuditKeywordRelation,
  listProjectAuditKeywordRelations,
  refreshProjectAuditKeywordRelations,
} = await import("./growth-map-keyword-relations");

const ids = {
  workspace: "93000000-0000-4000-8000-000000000001",
  foreignWorkspace: "93000000-0000-4000-8000-000000000002",
  project: "93000000-0000-4000-8000-000000000003",
  relation: "93000000-0000-4000-8000-000000000004",
  candidate: "93000000-0000-4000-8000-000000000005",
  replacementCandidate: "93000000-0000-4000-8000-000000000006",
  keywordA: "93000000-0000-4000-8000-000000000007",
  keywordB: "93000000-0000-4000-8000-000000000008",
  page: "93000000-0000-4000-8000-000000000009",
  topic: "93000000-0000-4000-8000-000000000010",
  decision: "93000000-0000-4000-8000-000000000011",
  actor: "93000000-0000-4000-8000-000000000012",
} as const;

const readScope = { workspaceId: ids.workspace };
const mutationScope = {
  workspaceId: ids.workspace,
  actorId: ids.actor,
};
const projectScope = {
  workspaceId: ids.workspace,
  projectId: ids.project,
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

function participant(keywordId: string, displayKeyword: string) {
  return {
    keywordId,
    displayKeyword,
    normalizedKeyword: displayKeyword.toLowerCase(),
    governanceRevision: 3,
    marketCode: "US",
    languageTag: "en-US",
    intent: "Commercial",
    topicNodeId: ids.topic,
    topicModelRevision: 2,
    mappedSitePageId: ids.page,
  };
}

const candidate = {
  candidateId: ids.candidate,
  relationId: ids.relation,
  projectId: ids.project,
  candidateRevision: 1,
  ruleVersion: "keyword-relation.1.0.0",
  keywordA: participant(ids.keywordA, "Customer Onboarding"),
  keywordB: participant(
    ids.keywordB,
    "Customer Onboarding Automation",
  ),
  signals: {
    sameConfirmedMappedPage: true,
    sameReviewedIntent: true,
    sameMarket: true,
    sameLanguage: true,
    sameConfirmedTopic: true,
    lexicalTokenOverlap: 0.67,
    serpOverlap: {
      availability: "unavailable",
      value: null,
      limitation:
        "Canonical SERP-overlap observations are not available yet.",
    },
  },
  evidenceHash: "a".repeat(64),
  generatedAt: "2026-07-27T10:00:00.000Z",
} as const;

const undecidedRelation: GrowthMapKeywordRelation = {
  projectId: ids.project,
  relationId: ids.relation,
  candidate,
  candidateState: "current",
  staleReasons: [],
  currentRelationRevision: 0,
  decision: null,
  decisionState: "none",
  displayState: "possible_duplicate",
  isEffectivelyFolded: false,
  primaryKeywordId: null,
  supportingKeywordId: null,
};

const foldDecision = {
  decisionId: ids.decision,
  relationId: ids.relation,
  candidateId: ids.candidate,
  projectId: ids.project,
  relationRevision: 1,
  decisionKind: "primary_supporting",
  primaryKeywordId: ids.keywordA,
  supportingKeywordId: ids.keywordB,
  reason: "Keep one primary Keyword and retain the supporting evidence.",
  decidedBy: ids.actor,
  decidedAt: "2026-07-27T10:05:00.000Z",
} as const;

const foldedRelation: GrowthMapKeywordRelation = {
  ...undecidedRelation,
  currentRelationRevision: 1,
  decision: foldDecision,
  decisionState: "active",
  displayState: "folded",
  isEffectivelyFolded: true,
  primaryKeywordId: ids.keywordA,
  supportingKeywordId: ids.keywordB,
};

const staleRelation: GrowthMapKeywordRelation = {
  ...undecidedRelation,
  candidateState: "stale",
  staleReasons: ["mapping_changed"],
  displayState: "stale",
};

const decisionBody = {
  expectedRelationRevision: 0,
  candidateId: ids.candidate,
  decisionKind: "primary_supporting",
  primaryKeywordId: ids.keywordA,
  supportingKeywordId: ids.keywordB,
  reason: "Use the first phrase as the primary Keyword.",
} as const;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Growth Map Keyword Relation reads", () => {
  it("lists one bounded current-page association batch with honest available coverage", async () => {
    activeProject();
    const list = vi
      .spyOn(KeywordRelationsRepository.prototype, "listByProject")
      .mockResolvedValue({
        rows: [undecidedRelation],
        nextCursor: "next_page",
      } as never);
    const refresh = vi.spyOn(
      KeywordRelationsRepository.prototype,
      "refreshCandidates",
    );
    const decide = vi.spyOn(
      KeywordRelationsRepository.prototype,
      "decide",
    );

    const result = await listProjectAuditKeywordRelations(
      readScope,
      ids.project,
      {
        limit: 20,
        cursor: null,
        keywordIds: [ids.keywordA, ids.keywordB],
      },
      exec,
    );

    expect(list).toHaveBeenCalledWith(projectScope, {
      limit: 20,
      cursor: null,
      keywordIds: [ids.keywordA, ids.keywordB],
    });
    expect(result).toMatchObject({
      projectId: ids.project,
      data: [undecidedRelation],
      meta: {
        limit: 20,
        hasNext: true,
        coverage: { availability: "available", limitations: [] },
      },
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
  });

  it("discloses unavailable and partial coverage without fabricating a count", async () => {
    activeProject();
    const list = vi.spyOn(
      KeywordRelationsRepository.prototype,
      "listByProject",
    );
    list.mockResolvedValueOnce({ rows: [], nextCursor: null });
    const empty = await listProjectAuditKeywordRelations(
      readScope,
      ids.project,
      { limit: 50, cursor: null },
      exec,
    );
    expect(empty.meta.coverage).toMatchObject({
      availability: "unavailable",
      limitations: [expect.stringMatching(/no current or historical/i)],
    });

    list.mockResolvedValueOnce({
      rows: [staleRelation],
      nextCursor: null,
    } as never);
    const stale = await listProjectAuditKeywordRelations(
      readScope,
      ids.project,
      { limit: 50, cursor: null },
      exec,
    );
    expect(stale.meta.coverage).toMatchObject({
      availability: "partial",
      limitations: [expect.stringMatching(/refresh candidates/i)],
    });
  });

  it("loads one relation detail without mutating candidate or decision authority", async () => {
    activeProject();
    const find = vi
      .spyOn(KeywordRelationsRepository.prototype, "findById")
      .mockResolvedValue(undecidedRelation);
    const refresh = vi.spyOn(
      KeywordRelationsRepository.prototype,
      "refreshCandidates",
    );
    const decide = vi.spyOn(
      KeywordRelationsRepository.prototype,
      "decide",
    );

    const result = await getProjectAuditKeywordRelation(
      readScope,
      ids.project,
      ids.relation,
      exec,
    );

    expect(find).toHaveBeenCalledWith(projectScope, ids.relation);
    expect(result).toEqual({
      projectId: ids.project,
      data: undecidedRelation,
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
  });

  it("treats a genuinely absent relation as 404 rather than an internal error", async () => {
    activeProject();
    vi.spyOn(
      KeywordRelationsRepository.prototype,
      "findById",
    ).mockResolvedValue(null);

    await expect(
      getProjectAuditKeywordRelation(
        readScope,
        ids.project,
        ids.relation,
        exec,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("rejects a malformed direct-call relation identity before database access", async () => {
    const projectRead = vi.spyOn(
      ProjectsRepository.prototype,
      "findById",
    );
    const find = vi.spyOn(
      KeywordRelationsRepository.prototype,
      "findById",
    );

    await expect(
      getProjectAuditKeywordRelation(
        readScope,
        ids.project,
        "customer-private-relation",
        exec,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(
      decideProjectAuditKeywordRelation(
        mutationScope,
        ids.project,
        "customer-private-relation",
        decisionBody,
        exec,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(projectRead).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
  });

  it("hides foreign or archived projects before relation access", async () => {
    activeProject({ workspace_id: ids.foreignWorkspace });
    const list = vi.spyOn(
      KeywordRelationsRepository.prototype,
      "listByProject",
    );

    await expect(
      listProjectAuditKeywordRelations(
        readScope,
        ids.project,
        { limit: 50, cursor: null },
        exec,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(list).not.toHaveBeenCalled();
  });

  it("rejects malformed cursor and injected or unbounded keyword lookups before database access", async () => {
    const projectRead = vi.spyOn(
      ProjectsRepository.prototype,
      "findById",
    );
    const list = vi.spyOn(
      KeywordRelationsRepository.prototype,
      "listByProject",
    );

    await expect(
      listProjectAuditKeywordRelations(
        readScope,
        ids.project,
        { limit: 50, cursor: "customer-private-cursor" },
        exec,
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fieldErrors: [{ pointer: "/cursor" }],
    });
    await expect(
      listProjectAuditKeywordRelations(
        readScope,
        ids.project,
        {
          limit: 50,
          cursor: null,
          keywordIds: [ids.keywordA, ids.keywordA],
        },
        exec,
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fieldErrors: [{ pointer: "/keywordId" }],
    });
    expect(projectRead).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });

  it("maps projection integrity failures to stable 503", async () => {
    activeProject();
    vi.spyOn(
      KeywordRelationsRepository.prototype,
      "listByProject",
    ).mockRejectedValue(
      new KeywordRelationIntegrityError(
        "RELATION_PROJECTION_INVALID",
      ),
    );

    await expect(
      listProjectAuditKeywordRelations(
        readScope,
        ids.project,
        { limit: 50, cursor: null },
        exec,
      ),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      status: 503,
    });
  });

  it("uses repeatable-read read-only transactions for both GET service paths", async () => {
    const sentinel = new Error("stop at transaction boundary");
    const transaction = vi.fn(
      async (
        callback: (tx: unknown) => Promise<unknown>,
        options: Record<string, unknown>,
      ) => {
        expect(callback).toEqual(expect.any(Function));
        expect(options).toEqual({
          isolationLevel: "repeatable read",
          accessMode: "read only",
        });
        throw sentinel;
      },
    );
    mocks.getDb.mockReturnValue({ db: { transaction } });

    await expect(
      listProjectAuditKeywordRelations(readScope, ids.project, {
        limit: 50,
        cursor: null,
      }),
    ).rejects.toBe(sentinel);
    await expect(
      getProjectAuditKeywordRelation(
        readScope,
        ids.project,
        ids.relation,
      ),
    ).rejects.toBe(sentinel);
    expect(transaction).toHaveBeenCalledTimes(2);
  });
});

describe("Growth Map Keyword Relation refresh and decisions", () => {
  it("refreshes immutable candidates inside the write path and returns a server timestamp", async () => {
    activeProject();
    const refresh = vi
      .spyOn(
        KeywordRelationsRepository.prototype,
        "refreshCandidates",
      )
      .mockResolvedValue({
        eligiblePairCount: 4,
        createdRelationCount: 1,
        createdCandidateCount: 2,
      });
    const now = new Date("2026-07-28T12:34:56.789Z");

    const result = await refreshProjectAuditKeywordRelations(
      readScope,
      ids.project,
      exec,
      now,
    );

    expect(refresh).toHaveBeenCalledWith(projectScope);
    expect(result).toEqual({
      projectId: ids.project,
      eligiblePairCount: 4,
      createdRelationCount: 1,
      createdCandidateCount: 2,
      generatedAt: now.toISOString(),
    });
  });

  it("passes only the server-resolved actor and preserves exact decision replay", async () => {
    activeProject();
    const decide = vi
      .spyOn(KeywordRelationsRepository.prototype, "decide")
      .mockResolvedValue({ data: foldedRelation, replayed: true });

    const result = await decideProjectAuditKeywordRelation(
      mutationScope,
      ids.project,
      ids.relation,
      decisionBody,
      exec,
    );

    expect(decide).toHaveBeenCalledWith(
      projectScope,
      ids.relation,
      ids.actor,
      decisionBody,
    );
    expect(result).toEqual({ data: foldedRelation, replayed: true });
  });

  it("rejects widened customer input before project or relation access", async () => {
    const projectRead = vi.spyOn(
      ProjectsRepository.prototype,
      "findById",
    );
    const decide = vi.spyOn(
      KeywordRelationsRepository.prototype,
      "decide",
    );

    await expect(
      decideProjectAuditKeywordRelation(
        mutationScope,
        ids.project,
        ids.relation,
        { ...decisionBody, decidedBy: ids.actor } as never,
        exec,
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
    });
    expect(projectRead).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
  });

  it("returns validated CAS facts on a stale revision", async () => {
    activeProject();
    vi.spyOn(KeywordRelationsRepository.prototype, "decide").mockRejectedValue(
      new KeywordRelationConflictError(
        "REVISION_CONFLICT",
        0,
        1,
        ids.candidate,
      ),
    );

    await expect(
      decideProjectAuditKeywordRelation(
        mutationScope,
        ids.project,
        ids.relation,
        decisionBody,
        exec,
      ),
    ).rejects.toMatchObject({
      code: "STALE_REVISION",
      status: 409,
      current: {
        kind: "revision_conflict",
        resource: "keyword_relation",
        projectId: ids.project,
        resourceId: ids.relation,
        expectedRevision: 0,
        currentRevision: 1,
        currentCandidateId: ids.candidate,
      },
    });
  });

  it("returns the current strict relation projection when candidate evidence is stale", async () => {
    activeProject();
    vi.spyOn(KeywordRelationsRepository.prototype, "decide").mockRejectedValue(
      new KeywordRelationConflictError(
        "CANDIDATE_STALE",
        0,
        0,
        ids.candidate,
      ),
    );
    vi.spyOn(
      KeywordRelationsRepository.prototype,
      "findById",
    ).mockResolvedValue(undecidedRelation);

    await expect(
      decideProjectAuditKeywordRelation(
        mutationScope,
        ids.project,
        ids.relation,
        {
          ...decisionBody,
          candidateId: ids.replacementCandidate,
        },
        exec,
      ),
    ).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
      status: 409,
      current: {
        kind: "candidate_stale",
        currentRevision: 0,
        currentCandidateId: ids.candidate,
        relation: undecidedRelation,
      },
    });
  });

  it("maps pair mismatch to 422 and fold graph conflict to 409 with current facts", async () => {
    activeProject();
    const decide = vi.spyOn(
      KeywordRelationsRepository.prototype,
      "decide",
    );
    decide.mockRejectedValueOnce(
      new KeywordRelationConflictError(
        "PAIR_MISMATCH",
        0,
        0,
        ids.candidate,
      ),
    );

    await expect(
      decideProjectAuditKeywordRelation(
        mutationScope,
        ids.project,
        ids.relation,
        decisionBody,
        exec,
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      fieldErrors: [
        { pointer: "/primaryKeywordId" },
        { pointer: "/supportingKeywordId" },
      ],
    });

    decide.mockRejectedValueOnce(
      new KeywordRelationConflictError(
        "FOLD_GRAPH_CONFLICT",
        0,
        0,
        ids.candidate,
      ),
    );
    vi.spyOn(
      KeywordRelationsRepository.prototype,
      "findById",
    ).mockResolvedValue(undecidedRelation);
    await expect(
      decideProjectAuditKeywordRelation(
        mutationScope,
        ids.project,
        ids.relation,
        decisionBody,
        exec,
      ),
    ).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
      status: 409,
      current: {
        kind: "fold_graph_conflict",
        relation: undecidedRelation,
      },
    });
  });

  it.each([
    new KeywordRelationConflictError(
      "REVISION_EXHAUSTED",
      0,
      2_147_483_647,
      ids.candidate,
    ),
    new KeywordRelationIntegrityError("DECISION_RESULT_DIVERGED"),
  ])("fails closed for exhausted or corrupt decision authority", async (error) => {
    activeProject();
    vi.spyOn(KeywordRelationsRepository.prototype, "decide").mockRejectedValue(
      error,
    );

    await expect(
      decideProjectAuditKeywordRelation(
        mutationScope,
        ids.project,
        ids.relation,
        decisionBody,
        exec,
      ),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      status: 503,
    });
  });

  it("maps repository relation absence to 404 and never fabricates 500", async () => {
    activeProject();
    vi.spyOn(KeywordRelationsRepository.prototype, "decide").mockRejectedValue(
      new KeywordRelationConflictError(
        "RELATION_NOT_FOUND",
        0,
      ),
    );

    await expect(
      decideProjectAuditKeywordRelation(
        mutationScope,
        ids.project,
        ids.relation,
        decisionBody,
        exec,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("opens ordinary write transactions for refresh and decision", async () => {
    const sentinel = new Error("stop at write transaction boundary");
    const transaction = vi.fn(
      async (
        callback: (tx: unknown) => Promise<unknown>,
        options?: Record<string, unknown>,
      ) => {
        expect(callback).toEqual(expect.any(Function));
        expect(options).toBeUndefined();
        throw sentinel;
      },
    );
    mocks.getDb.mockReturnValue({ db: { transaction } });

    await expect(
      refreshProjectAuditKeywordRelations(readScope, ids.project),
    ).rejects.toBe(sentinel);
    await expect(
      decideProjectAuditKeywordRelation(
        mutationScope,
        ids.project,
        ids.relation,
        decisionBody,
      ),
    ).rejects.toBe(sentinel);
    expect(transaction).toHaveBeenCalledTimes(2);
  });
});
