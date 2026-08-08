import { z } from "zod";
import { ArtifactType } from "./artifacts.ts";
import { IsoDateTime, Uuid } from "./common.ts";
import { ActionStatus, PriorityBand } from "./diagnostics.ts";
import { ExecutionPreview } from "./execution-preview.ts";
import {
  AuditModuleId,
  FrontstageLensId,
  GenerativeQueryEvidence,
  SearchQueryEvidence,
  SourceFreshness,
} from "./audit.ts";

export const WorkShape = z.enum(["fix", "improve", "create"]);
export type WorkShape = z.infer<typeof WorkShape>;

export const PrimaryOpportunityTarget = z.enum([
  "site",
  "template",
  "url",
  "topic",
  "new_asset",
]);
export type PrimaryOpportunityTarget = z.infer<
  typeof PrimaryOpportunityTarget
>;

export const OPPORTUNITY_RULE_IDS = [
  "TECH-HTTP-001",
  "TECH-CANONICAL-002",
  "TECH-INDEXABILITY-006",
  "TECH-LINKGRAPH-005",
  "SEARCH-CTR-004",
  "SEARCH-DECAY-002",
  "CONTENT-COVERAGE-001",
  "CONTENT-GAP-011",
  "CRO-PATH-001",
  "CRO-LANDING-003",
  "GEO-ENTITY-001",
  "GEO-CRAWLER-002",
] as const;
export const OpportunityRuleId = z.enum(OPPORTUNITY_RULE_IDS);
export type OpportunityRuleId = z.infer<typeof OpportunityRuleId>;

const OPPORTUNITY_RULE_VERSIONS = {
  "TECH-HTTP-001": 2,
  "TECH-CANONICAL-002": 2,
  "TECH-INDEXABILITY-006": 1,
  "TECH-LINKGRAPH-005": 3,
  "SEARCH-CTR-004": 1,
  "SEARCH-DECAY-002": 1,
  "CONTENT-COVERAGE-001": 1,
  "CONTENT-GAP-011": 2,
  "CRO-PATH-001": 1,
  "CRO-LANDING-003": 1,
  "GEO-ENTITY-001": 1,
  "GEO-CRAWLER-002": 1,
} as const satisfies Readonly<Record<OpportunityRuleId, 1 | 2 | 3>>;

export const OpportunityRuleReference = z
  .object({
    ruleId: OpportunityRuleId,
    ruleVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  })
  .strict()
  .superRefine((reference, ctx) => {
    const expectedVersion = OPPORTUNITY_RULE_VERSIONS[reference.ruleId];
    if (reference.ruleVersion !== expectedVersion) {
      ctx.addIssue({
        code: "custom",
        path: ["ruleVersion"],
        message: `${reference.ruleId} requires rule version ${expectedVersion}`,
      });
    }
  });
export type OpportunityRuleReference = z.infer<
  typeof OpportunityRuleReference
>;

const OpportunityTraceBase = {
  sourceProvider: z.string().trim().min(1).max(200),
  availability: z.enum(["available", "partial"]),
  support: z.enum(["supports", "contradicts", "context"]),
  observedAt: IsoDateTime,
  freshness: SourceFreshness,
  claim: z.string().trim().min(1).max(4000),
  limitation: z.string().trim().min(1).max(2000),
} as const;

const CanonicalEvidenceTrace = z
  .object({
    traceKind: z.literal("evidence"),
    evidenceId: Uuid,
    diagnosticRunId: Uuid,
    snapshotId: Uuid.nullable(),
    collectionRunId: Uuid.nullable(),
    analysisInvocationId: Uuid.nullable().default(null),
    ...OpportunityTraceBase,
  })
  .strict()
  .superRefine((trace, ctx) => {
    const hasSnapshot = trace.snapshotId !== null;
    const hasCollectionRun = trace.collectionRunId !== null;
    const hasAnalysisInvocation = trace.analysisInvocationId !== null;

    if (trace.sourceProvider === "system") {
      if (hasSnapshot || hasCollectionRun || hasAnalysisInvocation) {
        ctx.addIssue({
          code: "custom",
          path: ["sourceProvider"],
          message: "system Evidence must be lineage-free",
        });
      }
      return;
    }

    if (trace.sourceProvider === "llm") {
      if (!hasAnalysisInvocation || hasSnapshot || hasCollectionRun) {
        ctx.addIssue({
          code: "custom",
          path: ["analysisInvocationId"],
          message:
            "LLM Evidence must trace only to an Analysis Invocation",
        });
      }
      return;
    }

    if (!hasSnapshot || !hasCollectionRun || hasAnalysisInvocation) {
      ctx.addIssue({
        code: "custom",
        path: !hasSnapshot ? ["snapshotId"] : ["collectionRunId"],
        message:
          "source-backed Evidence must trace to one Snapshot and Collection Run only",
      });
    }
  });

const CanonicalObservationTrace = z
  .object({
    traceKind: z.literal("observation"),
    observationId: Uuid,
    snapshotId: Uuid,
    ...OpportunityTraceBase,
  })
  .strict();

export const OpportunityEvidenceTrace = z.discriminatedUnion("traceKind", [
  CanonicalEvidenceTrace,
  CanonicalObservationTrace,
]);
export type OpportunityEvidenceTrace = z.infer<
  typeof OpportunityEvidenceTrace
>;

const OpportunityEvidenceSummary = z
  .array(OpportunityEvidenceTrace)
  .min(1)
  .max(200)
  .superRefine((traces, ctx) => {
    const keys = traces.map((trace) =>
      trace.traceKind === "evidence"
        ? `evidence:${trace.evidenceId}`
        : `observation:${trace.observationId}`,
    );
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({
        code: "custom",
        message: "Opportunity evidence traces must be unique",
      });
    }
    if (!traces.some((trace) => trace.support === "supports")) {
      ctx.addIssue({
        code: "custom",
        message: "Opportunity requires at least one supporting provenance trace",
      });
    }
  });

export const OpportunityOwnedAsset = z
  .object({
    sitePageId: Uuid,
    snapshotId: Uuid,
    url: z.string().trim().url().max(2048),
    suitableForIntent: z.boolean(),
  })
  .strict();
export type OpportunityOwnedAsset = z.infer<typeof OpportunityOwnedAsset>;

export const OpportunityActionSummary = z
  .object({
    actionId: Uuid,
    findingId: Uuid,
    status: ActionStatus,
    /** A canonical Action template fixes one and only one Artifact type. */
    artifactType: ArtifactType,
  })
  .strict();
export type OpportunityActionSummary = z.infer<
  typeof OpportunityActionSummary
>;

const OpportunityBase = z
  .object({
    opportunityKey: z.string().trim().min(1).max(1000),
    title: z.string().trim().min(1).max(500),
    workShape: WorkShape,
    primaryTarget: PrimaryOpportunityTarget,
    targetRef: z.string().trim().min(1).max(2048),
    evidenceSummary: OpportunityEvidenceSummary,
    searchQueries: z.array(SearchQueryEvidence).max(500),
    generativeQueries: z.array(GenerativeQueryEvidence).max(500),
    competitorRefs: z
      .array(z.string().trim().min(1).max(500))
      .max(100)
      .refine((refs) => new Set(refs).size === refs.length, {
        message: "competitorRefs must be unique",
      }),
    currentOwnedAsset: OpportunityOwnedAsset.nullable(),
    supportingFindingIds: z
      .array(Uuid)
      .max(100)
      .default([])
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "supportingFindingIds must be unique",
      }),
    lenses: z
      .array(FrontstageLensId)
      .min(1)
      .max(FrontstageLensId.options.length)
      .refine((lenses) => new Set(lenses).size === lenses.length, {
        message: "lenses must be unique",
      }),
    coverageAndLimitations: z
      .array(z.string().trim().min(1).max(2000))
      .max(200),
  })
  .strict();

/** Observation-backed candidate: inspectable, but has no Confirm control. */
export const CandidateOpportunity = OpportunityBase.extend({
  readiness: z.literal("candidate"),
  primaryFindingId: z.undefined().optional(),
  primaryRule: z.undefined().optional(),
  actionId: z.undefined().optional(),
  action: z.undefined().optional(),
}).strict();
export type CandidateOpportunity = z.infer<typeof CandidateOpportunity>;

/** Exactly one primary Finding is the sole review/confirmation boundary. */
const ReviewableOpportunityObject = OpportunityBase.extend({
  readiness: z.literal("reviewable"),
  primaryFindingId: Uuid,
  primaryRule: OpportunityRuleReference,
  primaryFindingSeverity: PriorityBand,
  primaryFindingReviewRevision: z.number().int().min(0),
  executionPreview: ExecutionPreview.nullable(),
  actionId: z.undefined().optional(),
  action: z.undefined().optional(),
}).strict();
type ReviewableOpportunityValue = z.infer<typeof ReviewableOpportunityObject>;

function validateFindingRoles(
  value: Pick<
    ReviewableOpportunityValue,
    "primaryFindingId" | "supportingFindingIds"
  >,
  ctx: z.RefinementCtx,
): void {
  if (value.supportingFindingIds.includes(value.primaryFindingId)) {
    ctx.addIssue({
      code: "custom",
      path: ["supportingFindingIds"],
      message: "The primary Finding cannot also be a supporting Finding",
    });
  }
}

function validateRuleProjection(
  value: Pick<
    ReviewableOpportunityValue,
    | "primaryRule"
    | "workShape"
    | "lenses"
    | "currentOwnedAsset"
    | "executionPreview"
  > & { readonly actionArtifactType?: z.infer<typeof ArtifactType> },
  ctx: z.RefinementCtx,
): void {
  const projection: RuleOpportunityProjection =
    RULE_OPPORTUNITY_PROJECTION[value.primaryRule.ruleId];
  if (!value.lenses.includes(projection.lens)) {
    ctx.addIssue({
      code: "custom",
      path: ["lenses"],
      message: `Opportunity must include the ${projection.lens} Rule lens`,
    });
  }
  const expectedWorkShape =
    projection.workShapePolicy === "fixed"
      ? projection.workShape
      : value.currentOwnedAsset?.suitableForIntent === true
        ? projection.suitableOwnedAssetWorkShape
        : projection.noSuitableOwnedAssetWorkShape;
  if (value.workShape !== expectedWorkShape) {
    ctx.addIssue({
      code: "custom",
      path: ["workShape"],
      message: `Rule ${value.primaryRule.ruleId} requires ${expectedWorkShape}`,
    });
  }
  if (
    value.executionPreview !== null &&
    value.executionPreview.artifactType !== projection.artifactType
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["executionPreview", "artifactType"],
      message: `Rule ${value.primaryRule.ruleId} fixes Artifact type ${projection.artifactType}`,
    });
  }
  if (
    value.actionArtifactType !== undefined &&
    value.actionArtifactType !== projection.artifactType
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["action", "artifactType"],
      message: `Rule ${value.primaryRule.ruleId} fixes Artifact type ${projection.artifactType}`,
    });
  }
}

export const ReviewableOpportunity =
  ReviewableOpportunityObject.superRefine((value, ctx) => {
    validateFindingRoles(value, ctx);
    validateRuleProjection(value, ctx);
  });
export type ReviewableOpportunity = z.infer<typeof ReviewableOpportunity>;

/** Confirmed is still a projection over the Finding-owned canonical Action. */
const ConfirmedOpportunityObject = OpportunityBase.extend({
  readiness: z.literal("confirmed"),
  primaryFindingId: Uuid,
  primaryRule: OpportunityRuleReference,
  primaryFindingSeverity: PriorityBand,
  executionPreview: ExecutionPreview.nullable(),
  actionId: Uuid,
  action: OpportunityActionSummary,
}).strict();

type ConfirmedOpportunityValue = z.infer<typeof ConfirmedOpportunityObject>;

function validateConfirmedAction(
  value: ConfirmedOpportunityValue,
  ctx: z.RefinementCtx,
): void {
  validateFindingRoles(value, ctx);
  validateRuleProjection(
    { ...value, actionArtifactType: value.action.artifactType },
    ctx,
  );
  if (value.action.findingId !== value.primaryFindingId) {
    ctx.addIssue({
      code: "custom",
      path: ["action", "findingId"],
      message: "Action must belong to the primary Finding",
    });
  }
  if (value.action.actionId !== value.actionId) {
    ctx.addIssue({
      code: "custom",
      path: ["action", "actionId"],
      message: "Action summary must reference the projected Action",
    });
  }
}

export const ConfirmedOpportunity =
  ConfirmedOpportunityObject.superRefine(validateConfirmedAction);
export type ConfirmedOpportunity = z.infer<typeof ConfirmedOpportunity>;

export const GrowthOpportunity = z
  .discriminatedUnion("readiness", [
    CandidateOpportunity,
    ReviewableOpportunityObject,
    ConfirmedOpportunityObject,
  ])
  .superRefine((value, ctx) => {
    if (value.readiness === "reviewable") {
      validateFindingRoles(value, ctx);
      validateRuleProjection(value, ctx);
    }
    if (value.readiness === "confirmed") {
      validateConfirmedAction(value, ctx);
    }
  });
export type GrowthOpportunity = z.infer<typeof GrowthOpportunity>;

type FixedWorkShapeProjection = {
  readonly auditModule: AuditModuleId;
  readonly lens: z.infer<typeof FrontstageLensId>;
  readonly workShapePolicy: "fixed";
  readonly workShape: WorkShape;
  readonly artifactType: z.infer<typeof ArtifactType>;
};

type ExistingPageFirstProjection = {
  readonly auditModule: AuditModuleId;
  readonly lens: z.infer<typeof FrontstageLensId>;
  readonly workShapePolicy: "existing_page_first";
  readonly suitableOwnedAssetWorkShape: "improve";
  readonly noSuitableOwnedAssetWorkShape: "create";
  readonly artifactType: z.infer<typeof ArtifactType>;
};

type RuleOpportunityProjection =
  | FixedWorkShapeProjection
  | ExistingPageFirstProjection;

/**
 * Frozen Slice 1 mapping from the executable 12-rule registry. This is a
 * deterministic read-model policy, not another Rule or Action registry.
 */
export const RULE_OPPORTUNITY_PROJECTION = {
  "TECH-HTTP-001": {
    auditModule: "technical_search",
    lens: "site_health",
    workShapePolicy: "fixed",
    workShape: "fix",
    artifactType: "technical_ticket",
  },
  "TECH-CANONICAL-002": {
    auditModule: "technical_search",
    lens: "site_health",
    workShapePolicy: "fixed",
    workShape: "fix",
    artifactType: "technical_ticket",
  },
  "TECH-INDEXABILITY-006": {
    auditModule: "technical_search",
    lens: "site_health",
    workShapePolicy: "fixed",
    workShape: "fix",
    artifactType: "technical_ticket",
  },
  "TECH-LINKGRAPH-005": {
    auditModule: "links_architecture",
    lens: "site_health",
    workShapePolicy: "fixed",
    workShape: "fix",
    artifactType: "technical_ticket",
  },
  "SEARCH-CTR-004": {
    auditModule: "technical_search",
    lens: "search_ai_visibility",
    workShapePolicy: "fixed",
    workShape: "improve",
    artifactType: "metadata_rewrite",
  },
  "SEARCH-DECAY-002": {
    auditModule: "content_intent",
    lens: "search_ai_visibility",
    workShapePolicy: "fixed",
    workShape: "improve",
    artifactType: "content_brief",
  },
  "CONTENT-COVERAGE-001": {
    auditModule: "content_intent",
    lens: "demand_competition",
    workShapePolicy: "existing_page_first",
    suitableOwnedAssetWorkShape: "improve",
    noSuitableOwnedAssetWorkShape: "create",
    artifactType: "content_brief",
  },
  "CONTENT-GAP-011": {
    auditModule: "content_intent",
    lens: "demand_competition",
    workShapePolicy: "existing_page_first",
    suitableOwnedAssetWorkShape: "improve",
    noSuitableOwnedAssetWorkShape: "create",
    artifactType: "content_brief",
  },
  "CRO-PATH-001": {
    auditModule: "links_architecture",
    lens: "site_health",
    workShapePolicy: "fixed",
    workShape: "fix",
    artifactType: "technical_ticket",
  },
  "CRO-LANDING-003": {
    auditModule: "content_intent",
    lens: "demand_competition",
    workShapePolicy: "fixed",
    workShape: "improve",
    artifactType: "content_brief",
  },
  "GEO-ENTITY-001": {
    auditModule: "ai_geo",
    lens: "search_ai_visibility",
    workShapePolicy: "fixed",
    workShape: "improve",
    artifactType: "technical_ticket",
  },
  "GEO-CRAWLER-002": {
    auditModule: "ai_geo",
    lens: "search_ai_visibility",
    workShapePolicy: "fixed",
    workShape: "fix",
    artifactType: "technical_ticket",
  },
} as const satisfies Record<OpportunityRuleId, RuleOpportunityProjection>;

export type RuleOpportunityProjectionId =
  keyof typeof RULE_OPPORTUNITY_PROJECTION;

export function resolveRuleOpportunityWorkShape(
  ruleId: RuleOpportunityProjectionId,
  context: { readonly hasSuitableOwnedAsset: boolean },
): WorkShape {
  const projection: RuleOpportunityProjection =
    RULE_OPPORTUNITY_PROJECTION[ruleId];
  if (projection.workShapePolicy === "fixed") return projection.workShape;
  return context.hasSuitableOwnedAsset
    ? projection.suitableOwnedAssetWorkShape
    : projection.noSuitableOwnedAssetWorkShape;
}
