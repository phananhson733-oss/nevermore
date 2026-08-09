import { describe, expect, it } from "vitest";
import {
  BeginTopicModelDraftRequest,
  ConfirmTopicModelRequest,
  KeywordGovernanceCurrentProjection,
  KeywordGovernanceRevisionConflict,
  KeywordMappingDecision,
  KeywordMappingReviewState,
  KeywordReviewDecision,
  KeywordStatus,
  MAX_INCREMENTABLE_KEYWORD_GOVERNANCE_REVISION,
  MAX_POSTGRES_INTEGER_REVISION,
  PatchTopicModelDraftRequest,
  ReviewCompetitorRequest,
  ReviewKeywordRequest,
  TopicClusterAlias,
  TopicModelRevision,
  TopicModelState,
  TopicModelWorkspaceProjection,
  TopicNodeIdentity,
  TopicNodeRevision,
  TopicReference,
} from "./keyword-governance.ts";

const ids = {
  project: "70000000-0000-4000-8000-000000000001",
  node: "70000000-0000-4000-8000-000000000002",
  parentNode: "70000000-0000-4000-8000-000000000003",
  splitNodeA: "70000000-0000-4000-8000-000000000004",
  splitNodeB: "70000000-0000-4000-8000-000000000005",
  alias: "70000000-0000-4000-8000-000000000006",
  keyword: "70000000-0000-4000-8000-000000000007",
  decision: "70000000-0000-4000-8000-000000000008",
  actor: "70000000-0000-4000-8000-000000000009",
  page: "70000000-0000-4000-8000-000000000010",
  competitor: "70000000-0000-4000-8000-000000000011",
} as const;

const nodeRevision = {
  projectId: ids.project,
  topicNodeId: ids.node,
  topicModelRevision: 2,
  parentTopicNodeId: null,
  label: "Customer onboarding",
  description: "Questions and workflows for adopting the product.",
  intentEnvelope: ["commercial", "comparison"],
  lifecycleState: "active",
} as const;

const currentAlias = {
  aliasId: ids.alias,
  projectId: ids.project,
  topicNodeId: ids.node,
  clusterKey: "customer-onboarding",
  validFromTopicModelRevision: 1,
  validThroughTopicModelRevision: null,
  isCurrent: true,
} as const;

const confirmedModel = {
  projectId: ids.project,
  topicModelRevision: 2,
  editRevision: 4,
  rootTopicNodeId: ids.node,
  state: "confirmed",
  nodes: [nodeRevision],
  aliases: [currentAlias],
  successorRelationships: [],
  createdAt: "2026-07-27T08:00:00Z",
  createdBy: ids.actor,
  confirmedAt: "2026-07-27T08:30:00Z",
  confirmedBy: ids.actor,
  confirmationMode: "user",
  contentHash: "a".repeat(64),
  generationSummary: null,
} as const;

const draftModel = {
  projectId: ids.project,
  topicModelRevision: 3,
  editRevision: 0,
  rootTopicNodeId: ids.node,
  state: "draft",
  nodes: [{ ...nodeRevision, topicModelRevision: 3 }],
  aliases: [currentAlias],
  successorRelationships: [],
  createdAt: "2026-07-27T10:00:00Z",
  createdBy: ids.actor,
  updatedAt: "2026-07-27T10:30:00Z",
} as const;

const confirmedKeywordDecision = {
  decisionId: ids.decision,
  projectId: ids.project,
  keywordId: ids.keyword,
  governanceRevision: 3,
  status: "approved",
  intent: "commercial",
  buyerStage: "consideration",
  topicNodeId: ids.node,
  topicModelRevision: 2,
  mappingDecision: "existing_page",
  mappedSitePageId: ids.page,
  mappingReviewState: "confirmed",
  assignmentInvalidatedBy: null,
  reason: "Reviewed against the confirmed topic model and owned page.",
  decisionOrigin: "user",
  decidedBy: ids.actor,
  decidedAt: "2026-07-27T09:00:00Z",
} as const;

describe("keyword governance canonical values", () => {
  it("uses only the canonical topic, keyword, and mapping values", () => {
    expect(TopicModelState.options).toEqual(["draft", "confirmed"]);
    expect(KeywordStatus.options).toEqual([
      "candidate",
      "approved",
      "excluded",
      "parked",
    ]);
    expect(KeywordMappingDecision.options).toEqual([
      "unassigned",
      "existing_page",
      "new_asset",
    ]);
    expect(KeywordMappingReviewState.options).toEqual([
      "unreviewed",
      "confirmed",
    ]);

    expect(TopicModelState.safeParse("superseded").success).toBe(false);
    expect(KeywordMappingReviewState.safeParse("approved").success).toBe(false);
  });
});

describe("stable and versioned Topic contracts", () => {
  it("keeps stable Topic identity separate from a versioned node revision", () => {
    expect(
      TopicNodeIdentity.parse({
        projectId: ids.project,
        topicNodeId: ids.node,
      }),
    ).toEqual({
      projectId: ids.project,
      topicNodeId: ids.node,
    });
    expect(TopicNodeRevision.parse(nodeRevision)).toEqual(nodeRevision);

    expect(
      TopicNodeIdentity.safeParse({
        projectId: ids.project,
        topicNodeId: "not-a-uuid",
      }).success,
    ).toBe(false);
    expect(
      TopicNodeIdentity.safeParse({
        projectId: ids.project,
        topicNodeId: ids.node,
        label: "Identity must not absorb a revision label",
      }).success,
    ).toBe(false);
    expect(
      TopicNodeRevision.safeParse({
        ...nodeRevision,
        topicModelRevision: 0,
      }).success,
    ).toBe(false);
    expect(
      TopicNodeRevision.safeParse({
        ...nodeRevision,
        intentEnvelope: ["commercial", "commercial"],
      }).success,
    ).toBe(false);
  });

  it("preserves bounded legacy aliases without making them a write input", () => {
    expect(TopicClusterAlias.parse(currentAlias)).toEqual(currentAlias);
    expect(
      TopicClusterAlias.safeParse({
        ...currentAlias,
        validThroughTopicModelRevision: 2,
      }).success,
    ).toBe(false);
    expect(
      TopicClusterAlias.safeParse({
        ...currentAlias,
        isCurrent: false,
        validThroughTopicModelRevision: null,
      }).success,
    ).toBe(false);
    expect(
      TopicClusterAlias.safeParse({
        ...currentAlias,
        isCurrent: false,
        validThroughTopicModelRevision: 0,
      }).success,
    ).toBe(false);
  });

  it("represents a confirmed model as a frozen, server-authored revision", () => {
    expect(TopicModelRevision.parse(confirmedModel)).toEqual(confirmedModel);

    expect(
      TopicModelRevision.safeParse({
        ...confirmedModel,
        contentHash: undefined,
      }).success,
    ).toBe(false);
    expect(
      TopicModelRevision.safeParse({
        ...confirmedModel,
        updatedAt: "2026-07-27T09:00:00Z",
      }).success,
    ).toBe(false);
    expect(
      TopicModelRevision.safeParse({
        ...confirmedModel,
        confirmedAt: "2026-07-27T07:59:59Z",
      }).success,
    ).toBe(false);
    expect(
      TopicModelRevision.safeParse({
        ...confirmedModel,
        nodes: [],
      }).success,
    ).toBe(false);
  });

  it("keeps draft metadata mutable without accepting confirmed-only fields", () => {
    const draft = {
      projectId: ids.project,
      topicModelRevision: 3,
      editRevision: 0,
      rootTopicNodeId: ids.node,
      state: "draft",
      nodes: [nodeRevision, {
        ...nodeRevision,
        topicModelRevision: 3,
      }],
      aliases: [],
      successorRelationships: [],
      createdAt: "2026-07-27T10:00:00Z",
      createdBy: ids.actor,
      updatedAt: "2026-07-27T10:30:00Z",
    };

    expect(
      TopicModelRevision.safeParse({
        ...draft,
        nodes: [{ ...nodeRevision, topicModelRevision: 3 }],
      }).success,
    ).toBe(true);
    expect(
      TopicModelRevision.safeParse({
        ...draft,
        confirmedAt: "2026-07-27T10:30:00Z",
      }).success,
    ).toBe(false);
  });

  it("rejects cross-scope, duplicate, dangling, and cyclic node topology", () => {
    expect(
      TopicModelRevision.safeParse({
        ...confirmedModel,
        nodes: [{ ...nodeRevision, projectId: ids.keyword }],
      }).success,
    ).toBe(false);
    expect(
      TopicModelRevision.safeParse({
        ...confirmedModel,
        nodes: [nodeRevision, nodeRevision],
      }).success,
    ).toBe(false);
    expect(
      TopicModelRevision.safeParse({
        ...confirmedModel,
        nodes: [{ ...nodeRevision, parentTopicNodeId: ids.parentNode }],
      }).success,
    ).toBe(false);

    const cycle = [
      {
        ...nodeRevision,
        topicNodeId: ids.node,
        parentTopicNodeId: ids.parentNode,
      },
      {
        ...nodeRevision,
        topicNodeId: ids.parentNode,
        parentTopicNodeId: ids.node,
      },
    ];
    expect(
      TopicModelRevision.safeParse({
        ...confirmedModel,
        nodes: cycle,
      }).success,
    ).toBe(false);
  });

  it("requires one declared root and makes every confirmed node reachable from it", () => {
    const child = {
      ...nodeRevision,
      topicNodeId: ids.parentNode,
      parentTopicNodeId: ids.node,
    };
    expect(
      TopicModelRevision.safeParse({
        ...confirmedModel,
        nodes: [nodeRevision, child],
      }).success,
    ).toBe(true);
    expect(
      TopicModelRevision.safeParse({
        ...confirmedModel,
        rootTopicNodeId: null,
      }).success,
    ).toBe(false);
    expect(
      TopicModelRevision.safeParse({
        ...confirmedModel,
        rootTopicNodeId: ids.parentNode,
        nodes: [nodeRevision, child],
      }).success,
    ).toBe(false);
    expect(
      TopicModelRevision.safeParse({
        ...confirmedModel,
        nodes: [
          { ...nodeRevision, lifecycleState: "superseded" },
          child,
        ],
      }).success,
    ).toBe(false);
    expect(
      TopicModelRevision.safeParse({
        ...confirmedModel,
        nodes: [
          nodeRevision,
          { ...child, parentTopicNodeId: null },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate current aliases and cyclic successor history", () => {
    expect(
      TopicModelRevision.safeParse({
        ...confirmedModel,
        aliases: [
          currentAlias,
          {
            ...currentAlias,
            aliasId: ids.splitNodeA,
            topicNodeId: ids.parentNode,
            validFromTopicModelRevision: 2,
          },
        ],
        nodes: [
          nodeRevision,
          {
            ...nodeRevision,
            topicNodeId: ids.parentNode,
          },
        ],
      }).success,
    ).toBe(false);

    const successorNodes = [
      nodeRevision,
      {
        ...nodeRevision,
        topicNodeId: ids.parentNode,
      },
    ];
    expect(
      TopicModelRevision.safeParse({
        ...confirmedModel,
        nodes: successorNodes,
        successorRelationships: [
          {
            kind: "split_into",
            sourceTopicNodeId: ids.node,
            successorTopicNodeId: ids.parentNode,
            topicModelRevision: 2,
          },
          {
            kind: "merged_into",
            sourceTopicNodeId: ids.parentNode,
            successorTopicNodeId: ids.node,
            topicModelRevision: 2,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("uses a strict discriminated version for historical Topic references", () => {
    expect(
      TopicReference.parse({
        version: 1,
        clusterKey: "customer-onboarding",
      }),
    ).toEqual({
      version: 1,
      clusterKey: "customer-onboarding",
    });
    expect(
      TopicReference.parse({
        version: 2,
        topicNodeId: ids.node,
        topicModelRevision: 2,
        clusterKeyAtObservation: "customer-onboarding",
      }),
    ).toEqual({
      version: 2,
      topicNodeId: ids.node,
      topicModelRevision: 2,
      clusterKeyAtObservation: "customer-onboarding",
    });

    expect(
      TopicReference.safeParse({
        version: 2,
        clusterKey: "free-text-is-not-a-v2-write",
      }).success,
    ).toBe(false);
    expect(
      TopicReference.safeParse({
        version: 1,
        clusterKey: "customer-onboarding",
        topicNodeId: ids.node,
      }).success,
    ).toBe(false);
  });
});

describe("Topic Model mutation requests", () => {
  it("starts only from an exact confirmed revision and accepts no server-authored facts", () => {
    const request = {
      expectedLatestConfirmedRevision: 2,
      reason: "Open a reviewed Topic Model draft for the next planning cycle.",
    };

    expect(BeginTopicModelDraftRequest.parse(request)).toEqual(request);
    expect(
      BeginTopicModelDraftRequest.safeParse({
        ...request,
        actorId: ids.actor,
      }).success,
    ).toBe(false);
    expect(
      BeginTopicModelDraftRequest.safeParse({
        ...request,
        generationBasis: { origin: "browser" },
      }).success,
    ).toBe(false);
    expect(
      BeginTopicModelDraftRequest.safeParse({
        ...request,
        clusterKey: "browser-authored-alias",
      }).success,
    ).toBe(false);
  });

  it("keeps the latest confirmed model visible while one immediate successor draft is edited", () => {
    const projection = {
      projectId: ids.project,
      latestConfirmed: confirmedModel,
      draft: draftModel,
      generatedAt: "2026-07-27T10:31:00Z",
    };

    expect(TopicModelWorkspaceProjection.parse(projection)).toEqual(
      projection,
    );
    expect(
      TopicModelWorkspaceProjection.safeParse({
        ...projection,
        draft: { ...draftModel, topicModelRevision: 4 },
      }).success,
    ).toBe(false);
    expect(
      TopicModelWorkspaceProjection.safeParse({
        ...projection,
        generatedAt: "2026-07-27T10:29:59Z",
      }).success,
    ).toBe(false);
    expect(
      TopicModelWorkspaceProjection.safeParse({
        projectId: ids.project,
        latestConfirmed: null,
        draft: { ...draftModel, topicModelRevision: 1 },
        generatedAt: "2026-07-27T10:31:00Z",
      }).success,
    ).toBe(true);
  });

  it("accepts bounded create, update, rename, retire, split, and merge intents", () => {
    const request = {
      topicModelRevision: 3,
      expectedEditRevision: 2,
      reason: "Refine the confirmed topic structure without rewriting history.",
      intents: [
        {
          kind: "create",
          parentTopicNodeId: null,
          label: "Implementation",
          description: null,
          intentEnvelope: ["informational"],
        },
        {
          kind: "update",
          topicNodeId: ids.node,
          description: "Updated description",
        },
        {
          kind: "rename",
          topicNodeId: ids.parentNode,
          label: "Adoption strategy",
        },
        {
          kind: "retire",
          topicNodeId: ids.node,
          affectedKeywordReviewState: "unreviewed",
        },
        {
          kind: "split",
          sourceTopicNodeId: ids.node,
          successors: [
            {
              parentTopicNodeId: null,
              label: "Onboarding platforms",
              description: null,
              intentEnvelope: ["commercial"],
            },
            {
              parentTopicNodeId: null,
              label: "Onboarding workflows",
              description: null,
              intentEnvelope: ["informational"],
            },
          ],
          affectedKeywordReviewState: "unreviewed",
        },
        {
          kind: "merge",
          sourceTopicNodeIds: [ids.splitNodeA, ids.splitNodeB],
          successor: {
            parentTopicNodeId: null,
            label: "Customer adoption",
            description: "Merged topic.",
            intentEnvelope: ["commercial", "informational"],
          },
          affectedKeywordReviewState: "unreviewed",
        },
      ],
    } as const;

    expect(PatchTopicModelDraftRequest.parse(request)).toEqual(request);
  });

  it("rejects empty updates, unsafe retirement/split/merge, and free-text cluster writes", () => {
    expect(
      PatchTopicModelDraftRequest.safeParse({
        topicModelRevision: 3,
        expectedEditRevision: 2,
        reason: "Empty update.",
        intents: [{ kind: "update", topicNodeId: ids.node }],
      }).success,
    ).toBe(false);
    expect(
      PatchTopicModelDraftRequest.safeParse({
        topicModelRevision: 3,
        expectedEditRevision: 2,
        reason: "Unsafe retirement.",
        intents: [
          {
            kind: "retire",
            topicNodeId: ids.node,
            affectedKeywordReviewState: "confirmed",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      PatchTopicModelDraftRequest.safeParse({
        topicModelRevision: 3,
        expectedEditRevision: 2,
        reason: "Unsafe split.",
        intents: [
          {
            kind: "split",
            sourceTopicNodeId: ids.node,
            successors: [
              {
                parentTopicNodeId: null,
                label: "Only successor",
                description: null,
                intentEnvelope: [],
              },
            ],
            affectedKeywordReviewState: "confirmed",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      PatchTopicModelDraftRequest.safeParse({
        topicModelRevision: 3,
        expectedEditRevision: 2,
        reason: "Unsafe merge.",
        intents: [
          {
            kind: "merge",
            sourceTopicNodeIds: [ids.node, ids.node],
            successor: {
              parentTopicNodeId: null,
              label: "Merged",
              description: null,
              intentEnvelope: [],
            },
            affectedKeywordReviewState: "unreviewed",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      PatchTopicModelDraftRequest.safeParse({
        topicModelRevision: 3,
        expectedEditRevision: 2,
        reason: "No legacy labels in new writes.",
        intents: [
          {
            kind: "rename",
            topicNodeId: ids.node,
            label: "New label",
            clusterKey: "new-free-text-key",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("keeps confirm commands strict and server metadata out of client input", () => {
    expect(
      ConfirmTopicModelRequest.parse({
        topicModelRevision: 3,
        expectedEditRevision: 4,
        reason: "The reviewed draft is ready to become immutable.",
      }),
    ).toEqual({
      topicModelRevision: 3,
      expectedEditRevision: 4,
      reason: "The reviewed draft is ready to become immutable.",
    });

    for (const forbidden of [
      { actorId: ids.actor },
      { confirmedAt: "2026-07-27T11:00:00Z" },
      { contentHash: "a".repeat(64) },
      { provenance: [{ source: "client" }] },
    ]) {
      expect(
        ConfirmTopicModelRequest.safeParse({
          topicModelRevision: 3,
          expectedEditRevision: 4,
          reason: "Server metadata is not client-authored.",
          ...forbidden,
        }).success,
      ).toBe(false);
    }
  });
});

describe("Keyword Review decisions and current projection", () => {
  it("accepts a complete append-only user decision", () => {
    expect(KeywordReviewDecision.parse(confirmedKeywordDecision)).toEqual(
      confirmedKeywordDecision,
    );
  });

  it("requires coherent topic, page, actor, and invalidation state", () => {
    expect(
      KeywordReviewDecision.safeParse({
        ...confirmedKeywordDecision,
        topicModelRevision: null,
      }).success,
    ).toBe(false);
    expect(
      KeywordReviewDecision.safeParse({
        ...confirmedKeywordDecision,
        mappingDecision: "new_asset",
      }).success,
    ).toBe(false);
    expect(
      KeywordReviewDecision.safeParse({
        ...confirmedKeywordDecision,
        decidedBy: null,
      }).success,
    ).toBe(false);
    expect(
      KeywordReviewDecision.safeParse({
        ...confirmedKeywordDecision,
        assignmentInvalidatedBy: "topic_split",
      }).success,
    ).toBe(false);
    expect(
      KeywordReviewDecision.safeParse({
        ...confirmedKeywordDecision,
        mappingReviewState: "unreviewed",
      }).success,
    ).toBe(false);
    expect(
      KeywordReviewDecision.safeParse({
        ...confirmedKeywordDecision,
        mappingReviewState: "unreviewed",
        assignmentInvalidatedBy: "topic_split",
        decisionOrigin: "migration_baseline",
        decidedBy: null,
      }).success,
    ).toBe(false);

    expect(
      KeywordReviewDecision.safeParse({
        ...confirmedKeywordDecision,
        governanceRevision: 4,
        mappingReviewState: "unreviewed",
        assignmentInvalidatedBy: "topic_merge",
        decisionOrigin: "system_suggestion",
        decidedBy: null,
        reason: "The assigned Topic was merged; the keyword must be reviewed.",
      }).success,
    ).toBe(true);
    expect(
      KeywordReviewDecision.safeParse({
        ...confirmedKeywordDecision,
        governanceRevision: 4,
        mappingReviewState: "unreviewed",
        assignmentInvalidatedBy: "topic_retire",
        decisionOrigin: "system_suggestion",
        decidedBy: null,
        reason: "The assigned Topic was retired; the keyword must be reviewed.",
      }).success,
    ).toBe(true);
  });

  it("permits an honest migration baseline without fabricating a Topic", () => {
    expect(
      KeywordReviewDecision.safeParse({
        ...confirmedKeywordDecision,
        governanceRevision: 0,
        status: "candidate",
        topicNodeId: null,
        topicModelRevision: null,
        mappingDecision: "unassigned",
        mappedSitePageId: null,
        mappingReviewState: "unreviewed",
        decisionOrigin: "migration_baseline",
        decidedBy: null,
        reason: "Earlier review history is unavailable.",
      }).success,
    ).toBe(true);
  });

  it("lets a user exclude a candidate without first assigning a Topic", () => {
    expect(
      KeywordReviewDecision.safeParse({
        ...confirmedKeywordDecision,
        status: "excluded",
        topicNodeId: null,
        topicModelRevision: null,
        mappingDecision: "unassigned",
        mappedSitePageId: null,
        reason: "The query is outside the product's relevant demand.",
      }).success,
    ).toBe(true);
    expect(
      KeywordReviewDecision.safeParse({
        ...confirmedKeywordDecision,
        status: "excluded",
        mappingDecision: "unassigned",
        mappedSitePageId: null,
      }).success,
    ).toBe(false);
  });

  it("requires execution readiness to have a confirmed stable assignment", () => {
    const projection = {
      currentDecisionId: ids.decision,
      projectId: ids.project,
      keywordId: ids.keyword,
      governanceRevision: 3,
      mappingRevision: 3,
      status: "approved",
      intent: "commercial",
      buyerStage: "consideration",
      topicNodeId: ids.node,
      topicModelRevision: 2,
      mappingDecision: "existing_page",
      mappedSitePageId: ids.page,
      mappingReviewState: "confirmed",
      assignmentInvalidatedBy: null,
      executionState: "ready",
      reason: "Reviewed against the confirmed model.",
      updatedAt: "2026-07-27T09:00:00Z",
    } as const;

    expect(KeywordGovernanceCurrentProjection.parse(projection)).toEqual(
      projection,
    );
    expect(
      KeywordGovernanceCurrentProjection.safeParse({
        ...projection,
        topicNodeId: null,
        topicModelRevision: null,
      }).success,
    ).toBe(false);
    expect(
      KeywordGovernanceCurrentProjection.safeParse({
        ...projection,
        mappingReviewState: "unreviewed",
        assignmentInvalidatedBy: "topic_split",
      }).success,
    ).toBe(false);
    expect(
      KeywordGovernanceCurrentProjection.safeParse({
        ...projection,
        governanceRevision: 4,
      }).success,
    ).toBe(false);
    expect(
      KeywordGovernanceCurrentProjection.safeParse({
        ...projection,
        executionState: "blocked",
        mappingReviewState: "unreviewed",
        assignmentInvalidatedBy: "topic_merge",
      }).success,
    ).toBe(true);
  });

  it("requires exact stable Topic and mapping fields in a new review write", () => {
    const request = {
      expectedGovernanceRevision: 3,
      status: "approved",
      intent: "commercial",
      buyerStage: "consideration",
      topicNodeId: ids.node,
      topicModelRevision: 2,
      mappingDecision: "existing_page",
      mappedSitePageId: ids.page,
      reason: "Confirmed against the exact immutable Topic Model revision.",
    } as const;

    expect(ReviewKeywordRequest.parse(request)).toEqual(request);
    expect(
      ReviewKeywordRequest.safeParse({
        ...request,
        expectedGovernanceRevision:
          MAX_INCREMENTABLE_KEYWORD_GOVERNANCE_REVISION,
      }).success,
    ).toBe(true);
    expect(
      ReviewKeywordRequest.safeParse({
        ...request,
        expectedGovernanceRevision:
          MAX_INCREMENTABLE_KEYWORD_GOVERNANCE_REVISION + 1,
      }).success,
    ).toBe(false);
    expect(
      ReviewKeywordRequest.safeParse({
        ...request,
        reason: "no",
      }).success,
    ).toBe(false);
    expect(
      ReviewKeywordRequest.safeParse({
        ...request,
        reason: "yes",
      }).success,
    ).toBe(true);
    expect(
      ReviewKeywordRequest.safeParse({
        ...request,
        topicModelRevision: undefined,
      }).success,
    ).toBe(false);
    expect(
      ReviewKeywordRequest.safeParse({
        ...request,
        mappingDecision: "new_asset",
      }).success,
    ).toBe(false);
    expect(
      ReviewKeywordRequest.safeParse({
        ...request,
        clusterKey: "client-authored-cluster",
      }).success,
    ).toBe(false);

    for (const forbidden of [
      { actorId: ids.actor },
      { decidedAt: "2026-07-27T11:00:00Z" },
      { decisionHash: "a".repeat(64) },
      { provenance: [{ source: "client" }] },
    ]) {
      expect(
        ReviewKeywordRequest.safeParse({
          ...request,
          ...forbidden,
        }).success,
      ).toBe(false);
    }
  });

  it("keeps exclude/park review simple without weakening execution readiness", () => {
    expect(
      ReviewKeywordRequest.safeParse({
        expectedGovernanceRevision: 3,
        status: "excluded",
        intent: null,
        buyerStage: null,
        topicNodeId: null,
        topicModelRevision: null,
        mappingDecision: "unassigned",
        mappedSitePageId: null,
        reason: "The keyword is unrelated to the product.",
      }).success,
    ).toBe(true);
    expect(
      ReviewKeywordRequest.safeParse({
        expectedGovernanceRevision: 3,
        status: "excluded",
        intent: null,
        buyerStage: null,
        topicNodeId: ids.node,
        topicModelRevision: 2,
        mappingDecision: "unassigned",
        mappedSitePageId: null,
        reason: "Excluded writes cannot retain an assignment.",
      }).success,
    ).toBe(false);
    expect(
      ReviewKeywordRequest.safeParse({
        expectedGovernanceRevision: 3,
        status: "parked",
        intent: "commercial",
        buyerStage: null,
        topicNodeId: ids.node,
        topicModelRevision: 2,
        mappingDecision: "unassigned",
        mappedSitePageId: null,
        reason: "Keep the suggested Topic while parking execution.",
      }).success,
    ).toBe(true);
  });
});

describe("revision conflicts", () => {
  it("returns a structured, bounded conflict rather than an opaque string", () => {
    const conflict = {
      kind: "revision_conflict",
      resource: "keyword_review",
      projectId: ids.project,
      resourceId: ids.keyword,
      expectedRevision: 2,
      currentRevision: 3,
    } as const;

    expect(KeywordGovernanceRevisionConflict.parse(conflict)).toEqual(conflict);
    expect(
      KeywordGovernanceRevisionConflict.safeParse({
        ...conflict,
        currentRevision: 2,
      }).success,
    ).toBe(false);
    expect(
      KeywordGovernanceRevisionConflict.safeParse({
        ...conflict,
        currentRevision: MAX_POSTGRES_INTEGER_REVISION,
      }).success,
    ).toBe(true);
    expect(
      KeywordGovernanceRevisionConflict.safeParse({
        ...conflict,
        currentRevision: MAX_POSTGRES_INTEGER_REVISION + 1,
      }).success,
    ).toBe(false);
  });
});

describe("competitor governance write contract", () => {
  it("accepts only a fully classified approved competitor", () => {
    const request = {
      expectedRevision: 2,
      name: "Acme",
      reviewStatus: "approved",
      relationship: "direct",
      analysisScope: ["positioning", "keyword_gap"],
    } as const;

    expect(ReviewCompetitorRequest.parse(request)).toEqual(request);
    expect(
      ReviewCompetitorRequest.safeParse({
        ...request,
        expectedRevision:
          MAX_INCREMENTABLE_KEYWORD_GOVERNANCE_REVISION,
      }).success,
    ).toBe(true);
    expect(
      ReviewCompetitorRequest.safeParse({
        ...request,
        expectedRevision:
          MAX_INCREMENTABLE_KEYWORD_GOVERNANCE_REVISION + 1,
      }).success,
    ).toBe(false);
    expect(
      ReviewCompetitorRequest.safeParse({
        ...request,
        relationship: null,
      }).success,
    ).toBe(false);
    expect(
      ReviewCompetitorRequest.safeParse({
        ...request,
        analysisScope: [],
      }).success,
    ).toBe(false);
    expect(
      ReviewCompetitorRequest.safeParse({
        ...request,
        analysisScope: ["positioning", "positioning"],
      }).success,
    ).toBe(false);
  });

  it("keeps candidate and excluded governance unclassified", () => {
    for (const reviewStatus of ["candidate", "excluded"] as const) {
      expect(
        ReviewCompetitorRequest.safeParse({
          expectedRevision: 0,
          name: null,
          reviewStatus,
          relationship: null,
          analysisScope: [],
        }).success,
      ).toBe(true);
      expect(
        ReviewCompetitorRequest.safeParse({
          expectedRevision: 0,
          name: null,
          reviewStatus,
          relationship: "benchmark",
          analysisScope: [],
        }).success,
      ).toBe(false);
      expect(
        ReviewCompetitorRequest.safeParse({
          expectedRevision: 0,
          name: null,
          reviewStatus,
          relationship: null,
          analysisScope: ["serp_visibility"],
        }).success,
      ).toBe(false);
    }
  });

  it("rejects unbounded text, unknown scope, and client-authored origin facts", () => {
    const base = {
      expectedRevision: 0,
      name: null,
      reviewStatus: "candidate",
      relationship: null,
      analysisScope: [],
    } as const;

    expect(
      ReviewCompetitorRequest.safeParse({
        ...base,
        name: "x".repeat(161),
      }).success,
    ).toBe(false);
    expect(
      ReviewCompetitorRequest.safeParse({
        ...base,
        analysisScope: ["traffic"],
      }).success,
    ).toBe(false);

    for (const forbidden of [
      { actorId: ids.actor },
      { provenance: [] },
      { originOccurrences: [] },
      { observedAt: "2026-07-27T11:00:00Z" },
    ]) {
      expect(
        ReviewCompetitorRequest.safeParse({
          ...base,
          ...forbidden,
        }).success,
      ).toBe(false);
    }
  });
});
