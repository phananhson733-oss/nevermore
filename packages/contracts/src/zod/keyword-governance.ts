import { z } from "zod";
import { IsoDateTime, Uuid } from "./common.ts";
import {
  GrowthMapCompetitorRelationship,
  GrowthMapCompetitorReviewStatus,
  GrowthMapKeywordQueryKind,
  GrowthMapKeywordStatus,
} from "./growth-map.ts";
import { ProductProfileCompetitorAnalysisScope } from "./product-profile.ts";

/** PostgreSQL `integer` upper bound used by persisted governance revisions. */
export const MAX_POSTGRES_INTEGER_REVISION = 2_147_483_647;
/**
 * Largest compare-and-swap value that can be advanced by exactly one without
 * overflowing the persisted PostgreSQL `integer` column.
 */
export const MAX_INCREMENTABLE_KEYWORD_GOVERNANCE_REVISION =
  MAX_POSTGRES_INTEGER_REVISION - 1;
const NonNegativeRevision = z
  .number()
  .int()
  .nonnegative()
  .max(MAX_POSTGRES_INTEGER_REVISION);
const PositiveRevision = z
  .number()
  .int()
  .positive()
  .max(MAX_POSTGRES_INTEGER_REVISION);
const IncrementableKeywordGovernanceRevision = NonNegativeRevision.max(
  MAX_INCREMENTABLE_KEYWORD_GOVERNANCE_REVISION,
);
const IncrementableDatabaseRevision = NonNegativeRevision.max(
  MAX_POSTGRES_INTEGER_REVISION - 1,
);
const TopicLabel = z.string().trim().min(1).max(200);
const TopicDescription = z.string().trim().min(1).max(2000).nullable();
const ClassificationLabel = z.string().trim().min(1).max(100);
// The append-only Topic/Keyword decision ledgers enforce a minimum of three
// trimmed characters. Keep the HTTP contract at least as strict so a request
// cannot pass validation and then fail only at the persistence boundary.
const DecisionReason = z.string().trim().min(3).max(2000);
const LegacyClusterKey = z.string().trim().min(1).max(200);
const Sha256Hex = z
  .string()
  .regex(/^[0-9a-f]{64}$/u, "Must be a lowercase SHA-256 hex digest");

function isUnique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

const IntentEnvelope = z
  .array(ClassificationLabel)
  .max(20)
  .refine(isUnique, "Intent envelope values must be unique");

export const TopicModelState = z.enum(["draft", "confirmed"]);
export type TopicModelState = z.infer<typeof TopicModelState>;

/**
 * Stable identity is intentionally smaller than a revision. Labels, parents,
 * lifecycle, timestamps, and provenance can change or accrue without changing
 * the durable Topic Node UUID.
 */
export const TopicNodeIdentity = z
  .object({
    projectId: Uuid,
    topicNodeId: Uuid,
  })
  .strict();
export type TopicNodeIdentity = z.infer<typeof TopicNodeIdentity>;

export const TopicNodeLifecycleState = z.enum(["active", "superseded"]);
export type TopicNodeLifecycleState = z.infer<
  typeof TopicNodeLifecycleState
>;

export const TopicNodeRevision = z
  .object({
    projectId: Uuid,
    topicNodeId: Uuid,
    topicModelRevision: PositiveRevision,
    parentTopicNodeId: Uuid.nullable(),
    label: TopicLabel,
    description: TopicDescription,
    intentEnvelope: IntentEnvelope,
    lifecycleState: TopicNodeLifecycleState,
  })
  .strict()
  .superRefine((node, ctx) => {
    if (node.parentTopicNodeId === node.topicNodeId) {
      ctx.addIssue({
        code: "custom",
        path: ["parentTopicNodeId"],
        message: "A Topic Node cannot be its own parent",
      });
    }
  });
export type TopicNodeRevision = z.infer<typeof TopicNodeRevision>;

/**
 * Historical labels remain read-only aliases. New mutation contracts below do
 * not accept clusterKey, so this compatibility projection cannot become a
 * second write authority.
 */
export const TopicClusterAlias = z
  .object({
    aliasId: Uuid,
    projectId: Uuid,
    topicNodeId: Uuid,
    clusterKey: LegacyClusterKey,
    validFromTopicModelRevision: PositiveRevision,
    validThroughTopicModelRevision: PositiveRevision.nullable(),
    isCurrent: z.boolean(),
  })
  .strict()
  .superRefine((alias, ctx) => {
    const hasOpenEndedValidity =
      alias.validThroughTopicModelRevision === null;
    if (alias.isCurrent !== hasOpenEndedValidity) {
      ctx.addIssue({
        code: "custom",
        path: ["validThroughTopicModelRevision"],
        message:
          "A current alias must be open-ended and a historical alias must be closed",
      });
    }
    if (
      alias.validThroughTopicModelRevision !== null &&
      alias.validThroughTopicModelRevision <
        alias.validFromTopicModelRevision
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["validThroughTopicModelRevision"],
        message: "Alias validity cannot end before it begins",
      });
    }
  });
export type TopicClusterAlias = z.infer<typeof TopicClusterAlias>;

export const TopicNodeSuccessorKind = z.enum([
  "split_into",
  "merged_into",
]);
export type TopicNodeSuccessorKind = z.infer<
  typeof TopicNodeSuccessorKind
>;

export const TopicNodeSuccessorRelationship = z
  .object({
    kind: TopicNodeSuccessorKind,
    sourceTopicNodeId: Uuid,
    successorTopicNodeId: Uuid,
    topicModelRevision: PositiveRevision,
  })
  .strict()
  .superRefine((relationship, ctx) => {
    if (
      relationship.sourceTopicNodeId ===
      relationship.successorTopicNodeId
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["successorTopicNodeId"],
        message: "A successor must have a new stable Topic Node identity",
      });
    }
  });
export type TopicNodeSuccessorRelationship = z.infer<
  typeof TopicNodeSuccessorRelationship
>;

const TopicModelRevisionCommonShape = {
  projectId: Uuid,
  topicModelRevision: PositiveRevision,
  editRevision: NonNegativeRevision,
  rootTopicNodeId: Uuid.nullable(),
  nodes: z.array(TopicNodeRevision).max(500),
  aliases: z.array(TopicClusterAlias).max(1000),
  successorRelationships: z
    .array(TopicNodeSuccessorRelationship)
    .max(1000),
  createdAt: IsoDateTime,
  createdBy: Uuid,
} as const;

const DraftTopicModelRevision = z
  .object({
    ...TopicModelRevisionCommonShape,
    state: z.literal("draft"),
    updatedAt: IsoDateTime,
  })
  .strict();

const ConfirmedTopicModelRevision = z
  .object({
    ...TopicModelRevisionCommonShape,
    state: z.literal("confirmed"),
    confirmedAt: IsoDateTime,
    confirmedBy: Uuid,
    contentHash: Sha256Hex,
  })
  .strict();

type TopicModelRevisionValue =
  | z.infer<typeof DraftTopicModelRevision>
  | z.infer<typeof ConfirmedTopicModelRevision>;

function addTopicModelTopologyIssues(
  model: TopicModelRevisionValue,
  ctx: z.RefinementCtx,
): void {
  if (model.state === "confirmed" && model.nodes.length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["nodes"],
      message: "A confirmed Topic Model must contain at least one node",
    });
  }
  if (model.state === "confirmed" && model.rootTopicNodeId === null) {
    ctx.addIssue({
      code: "custom",
      path: ["rootTopicNodeId"],
      message: "A confirmed Topic Model must declare one root Topic Node",
    });
  }

  const createdAt = Date.parse(model.createdAt);
  const terminalAt = Date.parse(
    model.state === "confirmed" ? model.confirmedAt : model.updatedAt,
  );
  if (terminalAt < createdAt) {
    ctx.addIssue({
      code: "custom",
      path: [
        model.state === "confirmed" ? "confirmedAt" : "updatedAt",
      ],
      message: "A Topic Model revision cannot finish before it was created",
    });
  }

  const nodeById = new Map<string, TopicNodeRevision>();
  model.nodes.forEach((node, index) => {
    if (node.projectId !== model.projectId) {
      ctx.addIssue({
        code: "custom",
        path: ["nodes", index, "projectId"],
        message: "Topic Node project scope must match the Topic Model",
      });
    }
    if (node.topicModelRevision !== model.topicModelRevision) {
      ctx.addIssue({
        code: "custom",
        path: ["nodes", index, "topicModelRevision"],
        message: "Topic Node revision must match its Topic Model revision",
      });
    }
    if (nodeById.has(node.topicNodeId)) {
      ctx.addIssue({
        code: "custom",
        path: ["nodes", index, "topicNodeId"],
        message: "Topic Node identities must be unique within a revision",
      });
    }
    nodeById.set(node.topicNodeId, node);
  });

  if (model.rootTopicNodeId !== null) {
    const root = nodeById.get(model.rootTopicNodeId);
    if (!root) {
      ctx.addIssue({
        code: "custom",
        path: ["rootTopicNodeId"],
        message: "The Topic root must exist in the same model revision",
      });
    } else if (root.parentTopicNodeId !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["rootTopicNodeId"],
        message: "The Topic root cannot have a parent",
      });
    } else if (root.lifecycleState !== "active") {
      ctx.addIssue({
        code: "custom",
        path: ["rootTopicNodeId"],
        message: "The Topic root must remain active",
      });
    } else {
      model.nodes.forEach((node, index) => {
        const visited = new Set<string>();
        let current: TopicNodeRevision | undefined = node;
        while (
          current !== undefined &&
          current.topicNodeId !== model.rootTopicNodeId
        ) {
          if (visited.has(current.topicNodeId)) break;
          visited.add(current.topicNodeId);
          current =
            current.parentTopicNodeId === null
              ? undefined
              : nodeById.get(current.parentTopicNodeId);
        }
        if (current?.topicNodeId !== model.rootTopicNodeId) {
          ctx.addIssue({
            code: "custom",
            path: ["nodes", index, "parentTopicNodeId"],
            message:
              "Every Topic Node must be reachable from the declared root",
          });
        }
      });
    }
  }

  model.nodes.forEach((node, index) => {
    if (
      node.parentTopicNodeId !== null &&
      !nodeById.has(node.parentTopicNodeId)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["nodes", index, "parentTopicNodeId"],
        message: "A Topic parent must exist in the same model revision",
      });
    }

    const seen = new Set<string>();
    let current: TopicNodeRevision | undefined = node;
    while (current !== undefined) {
      if (seen.has(current.topicNodeId)) {
        ctx.addIssue({
          code: "custom",
          path: ["nodes", index, "parentTopicNodeId"],
          message: "Topic Node parent relationships cannot form a cycle",
        });
        break;
      }
      seen.add(current.topicNodeId);
      current =
        current.parentTopicNodeId === null
          ? undefined
          : nodeById.get(current.parentTopicNodeId);
    }
  });

  const aliasIdentities = new Set<string>();
  const currentAliasKeys = new Set<string>();
  model.aliases.forEach((alias, index) => {
    if (alias.projectId !== model.projectId) {
      ctx.addIssue({
        code: "custom",
        path: ["aliases", index, "projectId"],
        message: "Topic alias project scope must match the Topic Model",
      });
    }
    if (!nodeById.has(alias.topicNodeId)) {
      ctx.addIssue({
        code: "custom",
        path: ["aliases", index, "topicNodeId"],
        message: "Topic alias must reference an identity in this model revision",
      });
    }
    if (
      alias.validFromTopicModelRevision > model.topicModelRevision
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["aliases", index, "validFromTopicModelRevision"],
        message: "Topic alias cannot begin after the projected model revision",
      });
    }
    const identity = `${alias.clusterKey}:${alias.validFromTopicModelRevision}`;
    if (aliasIdentities.has(identity)) {
      ctx.addIssue({
        code: "custom",
        path: ["aliases", index],
        message: "Topic aliases must be unique at a validity boundary",
      });
    }
    aliasIdentities.add(identity);
    if (alias.isCurrent) {
      if (currentAliasKeys.has(alias.clusterKey)) {
        ctx.addIssue({
          code: "custom",
          path: ["aliases", index, "clusterKey"],
          message:
            "A legacy cluster key can have only one current Topic alias",
        });
      }
      currentAliasKeys.add(alias.clusterKey);
    }
  });

  const successorIdentities = new Set<string>();
  const successorsBySource = new Map<string, string[]>();
  model.successorRelationships.forEach((relationship, index) => {
    if (
      relationship.topicModelRevision !== model.topicModelRevision
    ) {
      ctx.addIssue({
        code: "custom",
        path: [
          "successorRelationships",
          index,
          "topicModelRevision",
        ],
        message: "Successor relationship revision must match the Topic Model",
      });
    }
    for (const field of [
      "sourceTopicNodeId",
      "successorTopicNodeId",
    ] as const) {
      if (!nodeById.has(relationship[field])) {
        ctx.addIssue({
          code: "custom",
          path: ["successorRelationships", index, field],
          message:
            "Successor relationship identities must exist in the model revision",
        });
      }
    }
    const identity = `${relationship.kind}:${relationship.sourceTopicNodeId}:${relationship.successorTopicNodeId}`;
    if (successorIdentities.has(identity)) {
      ctx.addIssue({
        code: "custom",
        path: ["successorRelationships", index],
        message: "Successor relationships must be unique",
      });
    }
    successorIdentities.add(identity);
    const successors =
      successorsBySource.get(relationship.sourceTopicNodeId) ?? [];
    successors.push(relationship.successorTopicNodeId);
    successorsBySource.set(relationship.sourceTopicNodeId, successors);
  });

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const hasSuccessorCycle = (topicNodeId: string): boolean => {
    if (visiting.has(topicNodeId)) return true;
    if (visited.has(topicNodeId)) return false;
    visiting.add(topicNodeId);
    for (const successor of successorsBySource.get(topicNodeId) ?? []) {
      if (hasSuccessorCycle(successor)) return true;
    }
    visiting.delete(topicNodeId);
    visited.add(topicNodeId);
    return false;
  };
  if ([...successorsBySource.keys()].some(hasSuccessorCycle)) {
    ctx.addIssue({
      code: "custom",
      path: ["successorRelationships"],
      message: "Topic successor relationships cannot form a cycle",
    });
  }
}

/**
 * Confirmed variants carry a server-authored content hash and confirmation
 * facts, and deliberately have no mutable `updatedAt` field. Any later edit is
 * represented by a new draft revision.
 */
export const TopicModelRevision = z
  .discriminatedUnion("state", [
    DraftTopicModelRevision,
    ConfirmedTopicModelRevision,
  ])
  .superRefine(addTopicModelTopologyIssues);
export type TopicModelRevision = z.infer<typeof TopicModelRevision>;

/**
 * Starts one customer-editable draft from the exact latest confirmed
 * revision. Zero is the honest first-model sentinel. Generation provenance,
 * evidence, actor identity, timestamps, node identities and aliases are
 * resolved by the server and therefore are not accepted here.
 */
export const BeginTopicModelDraftRequest = z
  .object({
    expectedLatestConfirmedRevision: IncrementableDatabaseRevision,
    reason: DecisionReason,
  })
  .strict();
export type BeginTopicModelDraftRequest = z.infer<
  typeof BeginTopicModelDraftRequest
>;

/**
 * One exact Growth Map Topic workspace. A draft is always the immediate
 * successor of the latest confirmed model and never replaces it in the read
 * projection before confirmation.
 */
export const TopicModelWorkspaceProjection = z
  .object({
    projectId: Uuid,
    latestConfirmed: ConfirmedTopicModelRevision.nullable(),
    draft: DraftTopicModelRevision.nullable(),
    generatedAt: IsoDateTime,
  })
  .strict()
  .superRefine((workspace, ctx) => {
    if (
      workspace.latestConfirmed !== null &&
      workspace.latestConfirmed.projectId !== workspace.projectId
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["latestConfirmed", "projectId"],
        message: "The confirmed Topic Model must share the workspace project",
      });
    }
    if (
      workspace.draft !== null &&
      workspace.draft.projectId !== workspace.projectId
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["draft", "projectId"],
        message: "The Topic Model draft must share the workspace project",
      });
    }
    if (
      workspace.draft !== null &&
      workspace.draft.topicModelRevision !==
        (workspace.latestConfirmed?.topicModelRevision ?? 0) + 1
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["draft", "topicModelRevision"],
        message:
          "The Topic Model draft must immediately follow the latest confirmed revision",
      });
    }

    const generatedAt = Date.parse(workspace.generatedAt);
    const latestModelAt =
      workspace.draft?.updatedAt ??
      workspace.latestConfirmed?.confirmedAt ??
      null;
    if (
      latestModelAt !== null &&
      generatedAt < Date.parse(latestModelAt)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["generatedAt"],
        message:
          "The Topic workspace cannot be generated before its latest model state",
      });
    }
  });
export type TopicModelWorkspaceProjection = z.infer<
  typeof TopicModelWorkspaceProjection
>;

/**
 * Historical references are replayable without silently re-attributing old
 * evidence. Version 1 accepts only the legacy label; every version 2 reference
 * freezes stable identity, exact model revision, and the label observed then.
 */
export const TopicReference = z.discriminatedUnion("version", [
  z
    .object({
      version: z.literal(1),
      clusterKey: LegacyClusterKey,
    })
    .strict(),
  z
    .object({
      version: z.literal(2),
      topicNodeId: Uuid,
      topicModelRevision: PositiveRevision,
      clusterKeyAtObservation: LegacyClusterKey,
    })
    .strict(),
]);
export type TopicReference = z.infer<typeof TopicReference>;

const TopicNodeDraftShape = {
  parentTopicNodeId: Uuid.nullable(),
  label: TopicLabel,
  description: TopicDescription,
  intentEnvelope: IntentEnvelope,
} as const;

const CreateTopicNodeIntent = z
  .object({
    kind: z.literal("create"),
    ...TopicNodeDraftShape,
  })
  .strict();

const UpdateTopicNodeIntent = z
  .object({
    kind: z.literal("update"),
    topicNodeId: Uuid,
    parentTopicNodeId: Uuid.nullable().optional(),
    description: TopicDescription.optional(),
    intentEnvelope: IntentEnvelope.optional(),
  })
  .strict();

const RenameTopicNodeIntent = z
  .object({
    kind: z.literal("rename"),
    topicNodeId: Uuid,
    label: TopicLabel,
  })
  .strict();

/**
 * Customer-facing "delete" is a historical retirement. The stable identity
 * and every confirmed revision remain replayable; only the draft lifecycle
 * changes and affected Keyword assignments return to review.
 */
const RetireTopicNodeIntent = z
  .object({
    kind: z.literal("retire"),
    topicNodeId: Uuid,
    affectedKeywordReviewState: z.literal("unreviewed"),
  })
  .strict();

const SplitTopicNodeIntent = z
  .object({
    kind: z.literal("split"),
    sourceTopicNodeId: Uuid,
    successors: z
      .array(z.object(TopicNodeDraftShape).strict())
      .min(2)
      .max(20),
    affectedKeywordReviewState: z.literal("unreviewed"),
  })
  .strict();

const MergeTopicNodeIntent = z
  .object({
    kind: z.literal("merge"),
    sourceTopicNodeIds: z
      .array(Uuid)
      .min(2)
      .max(20)
      .refine(isUnique, "Merged Topic Node identities must be unique"),
    successor: z.object(TopicNodeDraftShape).strict(),
    affectedKeywordReviewState: z.literal("unreviewed"),
  })
  .strict();

export const TopicNodeDraftIntent = z
  .discriminatedUnion("kind", [
    CreateTopicNodeIntent,
    UpdateTopicNodeIntent,
    RenameTopicNodeIntent,
    RetireTopicNodeIntent,
    SplitTopicNodeIntent,
    MergeTopicNodeIntent,
  ])
  .superRefine((intent, ctx) => {
    if (
      intent.kind === "update" &&
      intent.parentTopicNodeId === undefined &&
      intent.description === undefined &&
      intent.intentEnvelope === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        message: "A Topic Node update must change at least one field",
      });
    }
  });
export type TopicNodeDraftIntent = z.infer<
  typeof TopicNodeDraftIntent
>;

export const PatchTopicModelDraftRequest = z
  .object({
    topicModelRevision: PositiveRevision,
    expectedEditRevision: IncrementableDatabaseRevision,
    reason: DecisionReason,
    intents: z.array(TopicNodeDraftIntent).min(1).max(100),
  })
  .strict();
export type PatchTopicModelDraftRequest = z.infer<
  typeof PatchTopicModelDraftRequest
>;

export const ConfirmTopicModelRequest = z
  .object({
    topicModelRevision: PositiveRevision,
    expectedEditRevision: NonNegativeRevision,
    reason: DecisionReason,
  })
  .strict();
export type ConfirmTopicModelRequest = z.infer<
  typeof ConfirmTopicModelRequest
>;

/** Re-export the existing canonical values rather than defining parallel enums. */
export const KeywordQueryKind = GrowthMapKeywordQueryKind;
export type KeywordQueryKind = z.infer<typeof KeywordQueryKind>;

export const KeywordStatus = GrowthMapKeywordStatus;
export type KeywordStatus = z.infer<typeof KeywordStatus>;

export const KeywordMappingDecision = z.enum([
  "unassigned",
  "existing_page",
  "new_asset",
]);
export type KeywordMappingDecision = z.infer<
  typeof KeywordMappingDecision
>;

/** This is the DB write authority, not the Growth Map display-state mapping. */
export const KeywordMappingReviewState = z.enum([
  "unreviewed",
  "confirmed",
]);
export type KeywordMappingReviewState = z.infer<
  typeof KeywordMappingReviewState
>;

export const KeywordReviewDecisionOrigin = z.enum([
  "migration_baseline",
  "user",
  "system_suggestion",
]);
export type KeywordReviewDecisionOrigin = z.infer<
  typeof KeywordReviewDecisionOrigin
>;

export const KeywordAssignmentInvalidation = z
  .enum(["topic_split", "topic_merge", "topic_retire"])
  .nullable();
export type KeywordAssignmentInvalidation = z.infer<
  typeof KeywordAssignmentInvalidation
>;

const KeywordGovernanceProjectionShape = {
  projectId: Uuid,
  keywordId: Uuid,
  governanceRevision: NonNegativeRevision,
  status: KeywordStatus,
  intent: ClassificationLabel.nullable(),
  buyerStage: ClassificationLabel.nullable(),
  topicNodeId: Uuid.nullable(),
  topicModelRevision: PositiveRevision.nullable(),
  mappingDecision: KeywordMappingDecision,
  mappedSitePageId: Uuid.nullable(),
  mappingReviewState: KeywordMappingReviewState,
  assignmentInvalidatedBy: KeywordAssignmentInvalidation,
} as const;

type KeywordGovernanceProjectionValue = {
  readonly topicNodeId: string | null;
  readonly topicModelRevision: number | null;
  readonly mappingDecision: z.infer<typeof KeywordMappingDecision>;
  readonly mappedSitePageId: string | null;
  readonly mappingReviewState: z.infer<
    typeof KeywordMappingReviewState
  >;
  readonly assignmentInvalidatedBy: z.infer<
    typeof KeywordAssignmentInvalidation
  >;
};

function addKeywordProjectionIssues(
  value: KeywordGovernanceProjectionValue,
  ctx: z.RefinementCtx,
): void {
  const hasTopicNode = value.topicNodeId !== null;
  const hasTopicRevision = value.topicModelRevision !== null;
  if (hasTopicNode !== hasTopicRevision) {
    ctx.addIssue({
      code: "custom",
      path: [hasTopicNode ? "topicModelRevision" : "topicNodeId"],
      message:
        "Topic assignment must carry both stable identity and exact model revision",
    });
  }

  if (
    value.mappingDecision === "existing_page" &&
    value.mappedSitePageId === null
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["mappedSitePageId"],
      message: "An Existing Page mapping requires a canonical Site Page",
    });
  }
  if (
    value.mappingDecision !== "existing_page" &&
    value.mappedSitePageId !== null
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["mappedSitePageId"],
      message:
        "A mapped Site Page is allowed only for an Existing Page decision",
    });
  }

  if (
    value.assignmentInvalidatedBy !== null &&
    value.mappingReviewState !== "unreviewed"
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["mappingReviewState"],
      message:
        "A Topic split, merge, or retirement must return the affected keyword to unreviewed",
    });
  }
}

function addNewKeywordWriteStatusIssues(
  value: KeywordGovernanceProjectionValue & {
    readonly status: z.infer<typeof KeywordStatus>;
  },
  ctx: z.RefinementCtx,
): void {
  if (
    value.mappingDecision !== "unassigned" &&
    (value.topicNodeId === null || value.topicModelRevision === null)
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["topicNodeId"],
      message:
        "A page assignment requires an exact confirmed Topic assignment",
    });
  }

  if (
    value.status === "excluded" &&
    (value.topicNodeId !== null ||
      value.topicModelRevision !== null ||
      value.mappingDecision !== "unassigned" ||
      value.mappedSitePageId !== null)
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["status"],
      message:
        "An excluded keyword must clear Topic and page assignment",
    });
  }
}

export const KeywordReviewDecision = z
  .object({
    decisionId: Uuid,
    ...KeywordGovernanceProjectionShape,
    reason: DecisionReason,
    decisionOrigin: KeywordReviewDecisionOrigin,
    decidedBy: Uuid.nullable(),
    decidedAt: IsoDateTime,
  })
  .strict()
  .superRefine((decision, ctx) => {
    addKeywordProjectionIssues(decision, ctx);
    if (decision.decisionOrigin === "user") {
      addNewKeywordWriteStatusIssues(decision, ctx);
      if (decision.decidedBy === null) {
        ctx.addIssue({
          code: "custom",
          path: ["decidedBy"],
          message: "A user decision requires its server-resolved actor",
        });
      }
      if (decision.mappingReviewState !== "confirmed") {
        ctx.addIssue({
          code: "custom",
          path: ["mappingReviewState"],
          message: "A completed user review must be confirmed",
        });
      }
    }
    if (
      decision.assignmentInvalidatedBy !== null &&
      decision.decisionOrigin !== "system_suggestion"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["decisionOrigin"],
        message:
          "Only a system Topic invalidation can return an assignment to unreviewed",
      });
    }
  });
export type KeywordReviewDecision = z.infer<
  typeof KeywordReviewDecision
>;

export const KeywordExecutionState = z.enum(["blocked", "ready"]);
export type KeywordExecutionState = z.infer<
  typeof KeywordExecutionState
>;

export const KeywordGovernanceCurrentProjection = z
  .object({
    currentDecisionId: Uuid,
    ...KeywordGovernanceProjectionShape,
    /** Compatibility alias; it must never drift from governanceRevision. */
    mappingRevision: NonNegativeRevision,
    executionState: KeywordExecutionState,
    reason: DecisionReason.nullable(),
    updatedAt: IsoDateTime,
  })
  .strict()
  .superRefine((projection, ctx) => {
    addKeywordProjectionIssues(projection, ctx);
    if (projection.mappingRevision !== projection.governanceRevision) {
      ctx.addIssue({
        code: "custom",
        path: ["mappingRevision"],
        message:
          "Legacy mappingRevision must equal the canonical governanceRevision",
      });
    }
    if (
      projection.executionState === "ready" &&
      (projection.status !== "approved" ||
        projection.mappingReviewState !== "confirmed" ||
        projection.assignmentInvalidatedBy !== null ||
        projection.topicNodeId === null ||
        projection.topicModelRevision === null ||
        projection.mappingDecision === "unassigned")
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["executionState"],
        message:
          "Execution requires an approved, confirmed, non-invalidated stable Topic and page assignment",
      });
    }
  });
export type KeywordGovernanceCurrentProjection = z.infer<
  typeof KeywordGovernanceCurrentProjection
>;

/**
 * A human review references a stable Topic Node at one exact confirmed model
 * revision whenever it assigns the keyword to a page or new asset. A simple
 * exclude/park decision can remain unassigned. The service resolves any Topic
 * reference and the client cannot submit labels, actor facts, timestamps,
 * hashes, or provenance.
 */
export const ReviewKeywordRequest = z
  .object({
    expectedGovernanceRevision: IncrementableKeywordGovernanceRevision,
    status: KeywordStatus,
    intent: ClassificationLabel.nullable(),
    buyerStage: ClassificationLabel.nullable(),
    topicNodeId: Uuid.nullable(),
    topicModelRevision: PositiveRevision.nullable(),
    mappingDecision: KeywordMappingDecision,
    mappedSitePageId: Uuid.nullable(),
    reason: DecisionReason,
  })
  .strict()
  .superRefine((request, ctx) => {
    addKeywordProjectionIssues(
      {
        ...request,
        mappingReviewState: "confirmed",
        assignmentInvalidatedBy: null,
      },
      ctx,
    );
    addNewKeywordWriteStatusIssues(
      {
        ...request,
        mappingReviewState: "confirmed",
        assignmentInvalidatedBy: null,
      },
      ctx,
    );
  });
export type ReviewKeywordRequest = z.infer<typeof ReviewKeywordRequest>;

export const KeywordGovernanceRevisionConflict = z
  .object({
    kind: z.literal("revision_conflict"),
    resource: z.enum([
      "topic_model",
      "keyword_review",
      "competitor_review",
    ]),
    projectId: Uuid,
    resourceId: Uuid,
    expectedRevision: NonNegativeRevision,
    currentRevision: NonNegativeRevision,
  })
  .strict()
  .superRefine((conflict, ctx) => {
    if (conflict.expectedRevision === conflict.currentRevision) {
      ctx.addIssue({
        code: "custom",
        path: ["currentRevision"],
        message: "A revision conflict requires different revision values",
      });
    }
  });
export type KeywordGovernanceRevisionConflict = z.infer<
  typeof KeywordGovernanceRevisionConflict
>;

const CompetitorAnalysisScope = z
  .array(ProductProfileCompetitorAnalysisScope)
  .max(ProductProfileCompetitorAnalysisScope.options.length)
  .refine(isUnique, "Competitor analysisScope values must be unique");

/**
 * Competitor review changes governance only. Origin occurrences, actor facts,
 * timestamps, and provenance remain server-owned source history.
 */
export const ReviewCompetitorRequest = z
  .object({
    expectedRevision: IncrementableDatabaseRevision,
    name: z.string().trim().min(1).max(160).nullable(),
    reviewStatus: GrowthMapCompetitorReviewStatus,
    relationship: GrowthMapCompetitorRelationship.nullable(),
    analysisScope: CompetitorAnalysisScope,
  })
  .strict()
  .superRefine((request, ctx) => {
    if (request.reviewStatus === "approved") {
      if (request.relationship === null) {
        ctx.addIssue({
          code: "custom",
          path: ["relationship"],
          message: "An approved competitor requires a relationship",
        });
      }
      if (request.analysisScope.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["analysisScope"],
          message: "An approved competitor requires an analysis scope",
        });
      }
      return;
    }

    if (request.relationship !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["relationship"],
        message:
          "Candidate and excluded competitors must not retain a relationship",
      });
    }
    if (request.analysisScope.length !== 0) {
      ctx.addIssue({
        code: "custom",
        path: ["analysisScope"],
        message:
          "Candidate and excluded competitors must not retain analysis scope",
      });
    }
  });
export type ReviewCompetitorRequest = z.infer<
  typeof ReviewCompetitorRequest
>;
