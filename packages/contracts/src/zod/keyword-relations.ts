import { z } from "zod";
import {
  Cursor,
  IsoDateTime,
  MarketCode,
  Uuid,
} from "./common.ts";
import {
  GrowthMapCoverage,
  GrowthMapLibraryLanguageTag,
} from "./growth-map.ts";
import { MAX_POSTGRES_INTEGER_REVISION } from "./keyword-governance.ts";

const IncrementableRevision = z
  .number()
  .int()
  .nonnegative()
  .max(MAX_POSTGRES_INTEGER_REVISION - 1);
const PositiveRevision = z
  .number()
  .int()
  .positive()
  .max(MAX_POSTGRES_INTEGER_REVISION);
const BoundedLabel = z.string().trim().min(1).max(500);
const ClassificationLabel = z.string().trim().min(1).max(100);
const DecisionReason = z.string().trim().min(3).max(2000);
const Sha256Hex = z
  .string()
  .regex(/^[0-9a-f]{64}$/u, "Must be a lowercase SHA-256 hex digest");

function normalizedSemanticValue(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

/**
 * The initial duplicate rule is deliberately narrow. Topic membership and
 * lexical overlap are supporting evidence; same reviewed page + Intent +
 * market + language are the eligibility boundary.
 */
export const KEYWORD_RELATION_RULE_VERSION =
  "keyword-relation.1.0.0" as const;

export const KeywordRelationParticipantSnapshot = z
  .object({
    keywordId: Uuid,
    displayKeyword: BoundedLabel,
    normalizedKeyword: BoundedLabel,
    governanceRevision: z
      .number()
      .int()
      .nonnegative()
      .max(MAX_POSTGRES_INTEGER_REVISION),
    marketCode: MarketCode,
    languageTag: GrowthMapLibraryLanguageTag,
    intent: ClassificationLabel,
    topicNodeId: Uuid.nullable(),
    topicModelRevision: PositiveRevision.nullable(),
    mappedSitePageId: Uuid,
  })
  .strict()
  .superRefine((participant, ctx) => {
    if (
      participant.normalizedKeyword !==
      normalizedSemanticValue(participant.displayKeyword)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["normalizedKeyword"],
        message:
          "normalizedKeyword must be the NFKC, lowercase, single-space display keyword",
      });
    }
    if (
      (participant.topicNodeId === null) !==
      (participant.topicModelRevision === null)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["topicModelRevision"],
        message:
          "Topic identity and confirmed model revision must be present together",
      });
    }
  });
export type KeywordRelationParticipantSnapshot = z.infer<
  typeof KeywordRelationParticipantSnapshot
>;

export const KeywordRelationCandidateSignals = z
  .object({
    sameConfirmedMappedPage: z.literal(true),
    sameReviewedIntent: z.literal(true),
    sameMarket: z.literal(true),
    sameLanguage: z.literal(true),
    sameConfirmedTopic: z.boolean(),
    lexicalTokenOverlap: z.number().min(0).max(1),
    serpOverlap: z
      .object({
        availability: z.enum(["available", "unavailable"]),
        value: z.number().min(0).max(1).nullable(),
        limitation: z.string().trim().min(1).max(2000).nullable(),
      })
      .strict()
      .superRefine((signal, ctx) => {
        if (
          signal.availability === "available" &&
          (signal.value === null || signal.limitation !== null)
        ) {
          ctx.addIssue({
            code: "custom",
            path: ["value"],
            message:
              "Available SERP overlap requires a value and no limitation",
          });
        }
        if (
          signal.availability === "unavailable" &&
          (signal.value !== null || signal.limitation === null)
        ) {
          ctx.addIssue({
            code: "custom",
            path: ["limitation"],
            message:
              "Unavailable SERP overlap requires a limitation and no value",
          });
        }
      }),
  })
  .strict();
export type KeywordRelationCandidateSignals = z.infer<
  typeof KeywordRelationCandidateSignals
>;

export const KeywordRelationCandidate = z
  .object({
    candidateId: Uuid,
    relationId: Uuid,
    projectId: Uuid,
    candidateRevision: PositiveRevision,
    ruleVersion: z.literal(KEYWORD_RELATION_RULE_VERSION),
    keywordA: KeywordRelationParticipantSnapshot,
    keywordB: KeywordRelationParticipantSnapshot,
    signals: KeywordRelationCandidateSignals,
    evidenceHash: Sha256Hex,
    generatedAt: IsoDateTime,
  })
  .strict()
  .superRefine((candidate, ctx) => {
    if (candidate.keywordA.keywordId >= candidate.keywordB.keywordId) {
      ctx.addIssue({
        code: "custom",
        path: ["keywordB", "keywordId"],
        message:
          "Keyword relation pairs must use the canonical ascending UUID order",
      });
    }
    for (const field of [
      "mappedSitePageId",
      "marketCode",
      "languageTag",
    ] as const) {
      if (candidate.keywordA[field] !== candidate.keywordB[field]) {
        ctx.addIssue({
          code: "custom",
          path: ["keywordB", field],
          message: `Duplicate candidates must share ${field}`,
        });
      }
    }
    if (
      normalizedSemanticValue(candidate.keywordA.intent) !==
      normalizedSemanticValue(candidate.keywordB.intent)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["keywordB", "intent"],
        message: "Duplicate candidates must share one reviewed Intent",
      });
    }
    if (
      candidate.signals.sameConfirmedTopic !==
      (candidate.keywordA.topicNodeId !== null &&
        candidate.keywordA.topicNodeId ===
          candidate.keywordB.topicNodeId)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["signals", "sameConfirmedTopic"],
        message:
          "Topic evidence must match the frozen participant snapshots",
      });
    }
  });
export type KeywordRelationCandidate = z.infer<
  typeof KeywordRelationCandidate
>;

export const KeywordRelationDecisionKind = z.enum([
  "primary_supporting",
  "keep_separate",
  "park_secondary",
  "needs_research",
]);
export type KeywordRelationDecisionKind = z.infer<
  typeof KeywordRelationDecisionKind
>;

const KeywordRelationDecisionShape = {
  decisionId: Uuid,
  relationId: Uuid,
  candidateId: Uuid,
  projectId: Uuid,
  relationRevision: PositiveRevision,
  decisionKind: KeywordRelationDecisionKind,
  primaryKeywordId: Uuid.nullable(),
  supportingKeywordId: Uuid.nullable(),
  reason: DecisionReason,
  decidedBy: Uuid,
  decidedAt: IsoDateTime,
} as const;

export const KeywordRelationDecision = z
  .object(KeywordRelationDecisionShape)
  .strict()
  .superRefine((decision, ctx) => {
    const isFold = decision.decisionKind === "primary_supporting";
    if (
      isFold !==
      (decision.primaryKeywordId !== null &&
        decision.supportingKeywordId !== null)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["primaryKeywordId"],
        message:
          "Only primary_supporting decisions identify a primary and supporting Keyword",
      });
    }
    if (
      decision.primaryKeywordId !== null &&
      decision.primaryKeywordId === decision.supportingKeywordId
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["supportingKeywordId"],
        message: "A Keyword cannot fold into itself",
      });
    }
  });
export type KeywordRelationDecision = z.infer<
  typeof KeywordRelationDecision
>;

export const KeywordRelationStaleReason = z.enum([
  "candidate_superseded",
  "keyword_unavailable",
  "governance_revision_changed",
  "mapping_changed",
  "intent_changed",
  "market_changed",
  "language_changed",
]);
export type KeywordRelationStaleReason = z.infer<
  typeof KeywordRelationStaleReason
>;

export const KeywordRelationCandidateState = z.enum([
  "current",
  "stale",
]);
export type KeywordRelationCandidateState = z.infer<
  typeof KeywordRelationCandidateState
>;

export const KeywordRelationDecisionState = z.enum([
  "none",
  "active",
  "stale",
]);
export type KeywordRelationDecisionState = z.infer<
  typeof KeywordRelationDecisionState
>;

export const KeywordRelationDisplayState = z.enum([
  "possible_duplicate",
  "folded",
  "kept_separate",
  "parked_secondary",
  "needs_research",
  "stale",
]);
export type KeywordRelationDisplayState = z.infer<
  typeof KeywordRelationDisplayState
>;

export const GrowthMapKeywordRelation = z
  .object({
    projectId: Uuid,
    relationId: Uuid,
    candidate: KeywordRelationCandidate,
    candidateState: KeywordRelationCandidateState,
    staleReasons: z
      .array(KeywordRelationStaleReason)
      .max(7)
      .refine(
        (values) => new Set(values).size === values.length,
        "Stale reasons must be unique",
      ),
    currentRelationRevision: z
      .number()
      .int()
      .nonnegative()
      .max(MAX_POSTGRES_INTEGER_REVISION),
    decision: KeywordRelationDecision.nullable(),
    decisionState: KeywordRelationDecisionState,
    displayState: KeywordRelationDisplayState,
    isEffectivelyFolded: z.boolean(),
    primaryKeywordId: Uuid.nullable(),
    supportingKeywordId: Uuid.nullable(),
  })
  .strict()
  .superRefine((relation, ctx) => {
    if (
      relation.projectId !== relation.candidate.projectId ||
      relation.relationId !== relation.candidate.relationId
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["candidate"],
        message:
          "Candidate project and relation identity must match the projection",
      });
    }
    if (
      (relation.candidateState === "current") !==
      (relation.staleReasons.length === 0)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["staleReasons"],
        message:
          "Only stale candidates may carry one or more stale reasons",
      });
    }
    if (
      (relation.decision === null) !==
      (relation.decisionState === "none")
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["decisionState"],
        message: "Decision state must disclose whether a decision exists",
      });
    }
    if (relation.decision !== null) {
      if (
        relation.decision.projectId !== relation.projectId ||
        relation.decision.relationId !== relation.relationId ||
        relation.decision.relationRevision !==
          relation.currentRelationRevision
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["decision"],
          message:
            "Current decision identity and revision must match the relation",
        });
      }
      const mustBeActive =
        relation.candidateState === "current" &&
        relation.decision.candidateId === relation.candidate.candidateId;
      if (
        mustBeActive !== (relation.decisionState === "active")
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["decisionState"],
          message:
            "A decision is active only for the exact current candidate evidence",
        });
      }
    }

    const activeFold =
      relation.decisionState === "active" &&
      relation.decision?.decisionKind === "primary_supporting";
    if (
      relation.isEffectivelyFolded !== activeFold ||
      activeFold !==
        (relation.primaryKeywordId !== null &&
          relation.supportingKeywordId !== null)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["isEffectivelyFolded"],
        message:
          "Only an active primary_supporting decision may fold a Keyword",
      });
    }
    if (
      activeFold &&
      (relation.primaryKeywordId !==
        relation.decision?.primaryKeywordId ||
        relation.supportingKeywordId !==
          relation.decision?.supportingKeywordId)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["primaryKeywordId"],
        message:
          "Effective fold identities must match the active decision",
      });
    }

    const expectedDisplayState =
      relation.candidateState === "stale" ||
      relation.decisionState === "stale"
        ? "stale"
        : relation.decision === null
          ? "possible_duplicate"
          : ({
              primary_supporting: "folded",
              keep_separate: "kept_separate",
              park_secondary: "parked_secondary",
              needs_research: "needs_research",
            } as const)[relation.decision.decisionKind];
    if (relation.displayState !== expectedDisplayState) {
      ctx.addIssue({
        code: "custom",
        path: ["displayState"],
        message:
          "Display state must be derived from current candidate and decision authority",
      });
    }
  });
export type GrowthMapKeywordRelation = z.infer<
  typeof GrowthMapKeywordRelation
>;

export const DecideKeywordRelationRequest = z
  .object({
    expectedRelationRevision: IncrementableRevision,
    candidateId: Uuid,
    decisionKind: KeywordRelationDecisionKind,
    primaryKeywordId: Uuid.nullable(),
    supportingKeywordId: Uuid.nullable(),
    reason: DecisionReason,
  })
  .strict()
  .superRefine((request, ctx) => {
    const isFold = request.decisionKind === "primary_supporting";
    if (
      isFold !==
      (request.primaryKeywordId !== null &&
        request.supportingKeywordId !== null)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["primaryKeywordId"],
        message:
          "Only primary_supporting accepts primary/supporting Keyword identities",
      });
    }
    if (
      request.primaryKeywordId !== null &&
      request.primaryKeywordId === request.supportingKeywordId
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["supportingKeywordId"],
        message: "A Keyword cannot fold into itself",
      });
    }
  });
export type DecideKeywordRelationRequest = z.infer<
  typeof DecideKeywordRelationRequest
>;

/**
 * Stable compare-and-swap conflict facts for a customer decision.  The
 * candidate identity is included because a refreshed candidate may keep the
 * same stable relation while replacing its immutable evidence snapshot.
 */
export const KeywordRelationRevisionConflict = z
  .object({
    kind: z.literal("revision_conflict"),
    resource: z.literal("keyword_relation"),
    projectId: Uuid,
    resourceId: Uuid,
    expectedRevision: IncrementableRevision,
    currentRevision: z
      .number()
      .int()
      .nonnegative()
      .max(MAX_POSTGRES_INTEGER_REVISION),
    currentCandidateId: Uuid,
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
export type KeywordRelationRevisionConflict = z.infer<
  typeof KeywordRelationRevisionConflict
>;

export const KeywordRelationDecisionResult = z
  .object({
    data: GrowthMapKeywordRelation,
    replayed: z.boolean(),
  })
  .strict();
export type KeywordRelationDecisionResult = z.infer<
  typeof KeywordRelationDecisionResult
>;

export const KeywordRelationListResponse = z
  .object({
    projectId: Uuid,
    data: z.array(GrowthMapKeywordRelation).max(100),
    meta: z
      .object({
        limit: z.number().int().min(1).max(100),
        nextCursor: Cursor.nullable(),
        hasNext: z.boolean(),
        coverage: GrowthMapCoverage,
      })
      .strict(),
  })
  .strict()
  .superRefine((response, ctx) => {
    if (
      response.data.length > response.meta.limit ||
      response.meta.hasNext !== (response.meta.nextCursor !== null)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["meta"],
        message:
          "Keyword relation pagination metadata must match the returned page",
      });
    }
    const relationIds = new Set<string>();
    response.data.forEach((relation, index) => {
      if (relation.projectId !== response.projectId) {
        ctx.addIssue({
          code: "custom",
          path: ["data", index, "projectId"],
          message: "Relation projectId must match the response scope",
        });
      }
      if (relationIds.has(relation.relationId)) {
        ctx.addIssue({
          code: "custom",
          path: ["data", index, "relationId"],
          message: "Relation IDs must be unique within a page",
        });
      }
      relationIds.add(relation.relationId);
    });
  });
export type KeywordRelationListResponse = z.infer<
  typeof KeywordRelationListResponse
>;

export const KeywordRelationDetailResponse = z
  .object({
    projectId: Uuid,
    data: GrowthMapKeywordRelation,
  })
  .strict()
  .superRefine((response, ctx) => {
    if (response.data.projectId !== response.projectId) {
      ctx.addIssue({
        code: "custom",
        path: ["data", "projectId"],
        message: "Relation projectId must match the response scope",
      });
    }
  });
export type KeywordRelationDetailResponse = z.infer<
  typeof KeywordRelationDetailResponse
>;

export const KeywordRelationRefreshResponse = z
  .object({
    projectId: Uuid,
    eligiblePairCount: z.number().int().nonnegative(),
    createdRelationCount: z.number().int().nonnegative(),
    createdCandidateCount: z.number().int().nonnegative(),
    generatedAt: IsoDateTime,
  })
  .strict()
  .superRefine((response, ctx) => {
    if (
      response.createdRelationCount > response.eligiblePairCount ||
      response.createdCandidateCount > response.eligiblePairCount
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["eligiblePairCount"],
        message:
          "Created relation and candidate counts cannot exceed eligible pairs",
      });
    }
  });
export type KeywordRelationRefreshResponse = z.infer<
  typeof KeywordRelationRefreshResponse
>;
