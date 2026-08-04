import { z } from "zod";
import { IsoDateTime, MarketCode, Uuid } from "./common.ts";
import { CustomerModel } from "./icp.ts";
import {
  ProductProfileBusinessHint,
  ProductProfileGrowthObjective,
  ProductProfileProductName,
  ProductProfileProductUrl,
} from "./projects.ts";

export const PRODUCT_PROFILE_SCHEMA_VERSION = "product-profile.0.3.0" as const;
export const ProductProfileSchemaVersion = z.literal(
  PRODUCT_PROFILE_SCHEMA_VERSION,
);
export type ProductProfileSchemaVersion = z.infer<
  typeof ProductProfileSchemaVersion
>;

const unique = <T>(items: readonly T[]): boolean =>
  new Set(items).size === items.length;

const JsonPointerPattern = /^(?:\/(?:[^~/]|~0|~1)*)+$/;
export const ProductProfileJsonPointer = z
  .string()
  .max(1000)
  .regex(JsonPointerPattern, "Must be a non-empty RFC 6901 JSON Pointer");
export type ProductProfileJsonPointer = z.infer<
  typeof ProductProfileJsonPointer
>;

const ShortText = z.string().trim().min(1).max(500);
const LongText = z.string().trim().min(1).max(2000);
const UniqueShortTextList = z
  .array(ShortText)
  .max(100)
  .refine(unique, "Values must be unique");
const ProductProfileGrowthObjectives = z
  .array(ProductProfileGrowthObjective)
  .max(ProductProfileGrowthObjective.options.length)
  .refine(unique, "growthObjectives must be unique");

export const ProductProfileConfidence = z.enum([
  "high",
  "medium",
  "low",
  "unknown",
]);
export type ProductProfileConfidence = z.infer<
  typeof ProductProfileConfidence
>;

export const ProductProfileMarketPriority = z.enum(["primary", "secondary"]);
export type ProductProfileMarketPriority = z.infer<
  typeof ProductProfileMarketPriority
>;

export const ProductProfileTargetMarket = z
  .object({
    marketCode: MarketCode,
    priority: ProductProfileMarketPriority,
  })
  .strict();
export type ProductProfileTargetMarket = z.infer<
  typeof ProductProfileTargetMarket
>;

export const ProductProfileAudienceReviewStatus = z.enum([
  "primary",
  "secondary",
  "excluded",
  "candidate",
]);
export type ProductProfileAudienceReviewStatus = z.infer<
  typeof ProductProfileAudienceReviewStatus
>;

export const ProductProfileTargetAudience = z
  .object({
    candidateId: Uuid,
    reviewStatus: ProductProfileAudienceReviewStatus,
    targetCompanyOrAudience: LongText.nullable(),
    buyerRoles: UniqueShortTextList,
    userRoles: UniqueShortTextList,
    useCases: UniqueShortTextList,
    triggers: UniqueShortTextList,
    pains: UniqueShortTextList,
    jtbd: UniqueShortTextList,
    outcomes: UniqueShortTextList,
    barriers: UniqueShortTextList,
    qualificationSignals: UniqueShortTextList,
    disqualifiers: UniqueShortTextList,
  })
  .strict();
export type ProductProfileTargetAudience = z.infer<
  typeof ProductProfileTargetAudience
>;

export const ProductProfileCompetitorRelationship = z.enum([
  "direct",
  "indirect",
]);
export type ProductProfileCompetitorRelationship = z.infer<
  typeof ProductProfileCompetitorRelationship
>;

export const ProductProfileCompetitorAnalysisScope = z.enum([
  "positioning",
  "product_capability",
  "keyword_gap",
  "content",
  "serp_visibility",
]);
export type ProductProfileCompetitorAnalysisScope = z.infer<
  typeof ProductProfileCompetitorAnalysisScope
>;

export const ProductProfileCompetitorReviewStatus = z.enum([
  "candidate",
  "approved",
  "excluded",
]);
export type ProductProfileCompetitorReviewStatus = z.infer<
  typeof ProductProfileCompetitorReviewStatus
>;

const NormalizedDomainPattern =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export const ProductProfileCompetitorDomain = z
  .string()
  .min(1)
  .max(253)
  .regex(
    NormalizedDomainPattern,
    "Must be a normalized lowercase hostname without a scheme, port, or path",
  );
export type ProductProfileCompetitorDomain = z.infer<
  typeof ProductProfileCompetitorDomain
>;

export const ProductProfileCompetitorCandidate = z
  .object({
    candidateId: Uuid,
    name: z.string().trim().min(1).max(160),
    domain: ProductProfileCompetitorDomain,
    relationship: ProductProfileCompetitorRelationship.nullable(),
    analysisScope: z
      .array(ProductProfileCompetitorAnalysisScope)
      .max(5)
      .refine(unique, "analysisScope must be unique"),
    similarity: z.number().min(0).max(1).nullable(),
    reason: LongText,
    reviewStatus: ProductProfileCompetitorReviewStatus,
    confidence: ProductProfileConfidence,
  })
  .strict();
export type ProductProfileCompetitorCandidate = z.infer<
  typeof ProductProfileCompetitorCandidate
>;

/**
 * Product Profile discovery is opt-out: a traceable generated competitor with
 * a complete direct/indirect classification is part of the working comparison
 * set unless the customer excludes it. The `candidate` branch keeps historical
 * 0.3.0 profiles useful without rewriting their immutable JSON; new synthesis
 * writes the same classified rows as `approved` directly.
 */
export function isProductProfileCompetitorIncludedByDefault(
  competitor: Pick<
    ProductProfileCompetitorCandidate,
    "reviewStatus" | "relationship" | "analysisScope"
  >,
): boolean {
  return (
    competitor.reviewStatus !== "excluded" &&
    competitor.relationship !== null &&
    competitor.analysisScope.length > 0
  );
}

export const ProductProfileProvenanceDerivation = z.enum([
  "declared",
  "observed",
  "computed",
  "inferred",
  "missing",
  "contradicted",
]);
export type ProductProfileProvenanceDerivation = z.infer<
  typeof ProductProfileProvenanceDerivation
>;

const EvidenceRefId = { evidenceRefId: Uuid } as const;
const SnapshotEvidenceRef = z
  .object({
    ...EvidenceRefId,
    kind: z.literal("snapshot"),
    snapshotId: Uuid,
  })
  .strict();
const PageSnapshotEvidenceRef = z
  .object({
    ...EvidenceRefId,
    kind: z.literal("pageSnapshot"),
    pageSnapshotId: Uuid,
  })
  .strict();
const ObservationEvidenceRef = z
  .object({
    ...EvidenceRefId,
    kind: z.literal("observation"),
    observationId: Uuid,
  })
  .strict();
const AnalysisInvocationEvidenceRef = z
  .object({
    ...EvidenceRefId,
    kind: z.literal("analysisInvocation"),
    analysisInvocationId: Uuid,
  })
  .strict();
const DeclaredHintEvidenceRef = z
  .object({
    ...EvidenceRefId,
    kind: z.literal("declaredHint"),
  })
  .strict();
const UserEditEvidenceRef = z
  .object({
    ...EvidenceRefId,
    kind: z.literal("userEdit"),
  })
  .strict();

export const ProductProfileEvidenceRef = z.discriminatedUnion("kind", [
  SnapshotEvidenceRef,
  PageSnapshotEvidenceRef,
  ObservationEvidenceRef,
  AnalysisInvocationEvidenceRef,
  DeclaredHintEvidenceRef,
  UserEditEvidenceRef,
]);
export type ProductProfileEvidenceRef = z.infer<
  typeof ProductProfileEvidenceRef
>;

export const ProductProfileFieldProvenance = z
  .object({
    path: ProductProfileJsonPointer,
    derivation: ProductProfileProvenanceDerivation,
    confidence: ProductProfileConfidence,
    evidenceRefs: z.array(ProductProfileEvidenceRef).max(50),
    limitation: LongText.nullable(),
    observedAt: IsoDateTime.nullable(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    const declaredKinds = new Set(["declaredHint", "userEdit"]);
    const canonicalKinds = new Set([
      "snapshot",
      "pageSnapshot",
      "observation",
      "analysisInvocation",
    ]);
    const hasDeclared = entry.evidenceRefs.some((ref) =>
      declaredKinds.has(ref.kind),
    );
    const hasCanonical = entry.evidenceRefs.some((ref) =>
      canonicalKinds.has(ref.kind),
    );

    if (
      entry.derivation === "declared" &&
      (!hasDeclared ||
        entry.evidenceRefs.some((ref) => !declaredKinds.has(ref.kind)))
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["evidenceRefs"],
        message: "declared fields must cite only a declared hint or user edit",
      });
    }
    if (
      ["observed", "computed", "inferred"].includes(entry.derivation) &&
      !hasCanonical
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["evidenceRefs"],
        message: `${entry.derivation} fields must cite a canonical evidence anchor`,
      });
    }
    if (
      ["observed", "computed", "inferred", "contradicted"].includes(
        entry.derivation,
      ) &&
      entry.observedAt === null
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["observedAt"],
        message: `${entry.derivation} fields must record observedAt`,
      });
    }
    if (entry.derivation === "contradicted" && entry.evidenceRefs.length < 2) {
      ctx.addIssue({
        code: "custom",
        path: ["evidenceRefs"],
        message: "contradicted fields must cite at least two evidence references",
      });
    }
    if (
      entry.derivation === "missing" &&
      (entry.evidenceRefs.length > 0 ||
        entry.confidence !== "unknown" ||
        entry.observedAt !== null)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["evidenceRefs"],
        message:
          "missing fields cannot cite evidence, claim confidence, or record observedAt",
      });
    }
  });
export type ProductProfileFieldProvenance = z.infer<
  typeof ProductProfileFieldProvenance
>;

const ProductProfileShape = {
  profileSchemaVersion: ProductProfileSchemaVersion,
  sourceSiteId: Uuid,
  sourcePageUrl: ProductProfileProductUrl,
  sourceSnapshotId: Uuid.nullable(),
  analysisInvocationId: Uuid.nullable(),
  generatedAt: IsoDateTime.nullable(),
  businessHint: ProductProfileBusinessHint.nullable(),
  productName: ProductProfileProductName.nullable(),
  customerModel: CustomerModel.optional(),
  growthObjectives: ProductProfileGrowthObjectives.optional(),
  oneLiner: z.string().trim().min(1).max(1000).nullable(),
  category: z.string().trim().min(1).max(160).nullable(),
  productType: z.string().trim().min(1).max(160).nullable(),
  businessModels: z
    .array(z.string().trim().min(1).max(160))
    .max(20)
    .refine(unique, "businessModels must be unique"),
  valueProposition: LongText.nullable(),
  coreFeatures: UniqueShortTextList,
  targetMarkets: z.array(ProductProfileTargetMarket).max(20),
  targetAudiences: z.array(ProductProfileTargetAudience).max(100),
  competitorCandidates: z.array(ProductProfileCompetitorCandidate).max(100),
  fieldProvenance: z.array(ProductProfileFieldProvenance).max(2000),
  missingFields: z
    .array(ProductProfileJsonPointer)
    .max(500)
    .refine(unique, "missingFields must be unique"),
  conflictingFields: z
    .array(ProductProfileJsonPointer)
    .max(500)
    .refine(unique, "conflictingFields must be unique"),
} as const;

function addProfileIdentityIssues(
  profile: z.infer<z.ZodObject<typeof ProductProfileShape>>,
  ctx: z.RefinementCtx,
): void {
  const checkUnique = (
    values: readonly string[],
    path: string,
    message: string,
  ) => {
    if (!unique(values)) ctx.addIssue({ code: "custom", path: [path], message });
  };

  checkUnique(
    profile.targetMarkets.map((market) => market.marketCode),
    "targetMarkets",
    "target market codes must be unique",
  );
  checkUnique(
    [
      ...profile.targetAudiences.map((audience) => audience.candidateId),
      ...profile.competitorCandidates.map((competitor) => competitor.candidateId),
    ],
    "targetAudiences",
    "candidateId values must be unique across the product profile",
  );
  checkUnique(
    profile.fieldProvenance.map((entry) => entry.path),
    "fieldProvenance",
    "field provenance paths must be unique",
  );
  checkUnique(
    profile.fieldProvenance.flatMap((entry) =>
      entry.evidenceRefs.map((ref) => ref.evidenceRefId),
    ),
    "fieldProvenance",
    "evidenceRefId values must be unique within a profile",
  );

  const conflicting = new Set(profile.conflictingFields);
  if (profile.missingFields.some((path) => conflicting.has(path))) {
    ctx.addIssue({
      code: "custom",
      path: ["conflictingFields"],
      message: "a field cannot be both missing and conflicting",
    });
  }
}

const ProductProfileObject = z.object(ProductProfileShape).strict();

const ProductProfileSemanticFields = [
  { key: "businessHint", path: "/businessHint", optional: true },
  { key: "productName", path: "/productName", optional: false },
  { key: "customerModel", path: "/customerModel", optional: true },
  { key: "growthObjectives", path: "/growthObjectives", optional: true },
  { key: "oneLiner", path: "/oneLiner", optional: false },
  { key: "category", path: "/category", optional: false },
  { key: "productType", path: "/productType", optional: false },
  { key: "businessModels", path: "/businessModels", optional: false },
  { key: "valueProposition", path: "/valueProposition", optional: false },
  { key: "coreFeatures", path: "/coreFeatures", optional: false },
  { key: "targetMarkets", path: "/targetMarkets", optional: false },
  { key: "targetAudiences", path: "/targetAudiences", optional: false },
  {
    key: "competitorCandidates",
    path: "/competitorCandidates",
    optional: false,
  },
] as const satisfies readonly {
  readonly key: keyof z.infer<typeof ProductProfileObject>;
  readonly path: string;
  readonly optional: boolean;
}[];

const FactSupportingDerivations = new Set<
  ProductProfileProvenanceDerivation
>(["declared", "observed", "computed", "inferred", "contradicted"]);

function pathIsWithin(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function semanticValueIsEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (Array.isArray(value) && value.length === 0)
  );
}

function hasFactProvenance(
  profile: z.infer<typeof ProductProfileObject>,
  root: string,
): boolean {
  return profile.fieldProvenance.some(
    (entry) =>
      pathIsWithin(entry.path, root) &&
      FactSupportingDerivations.has(entry.derivation),
  );
}

function addProfileLineageIssues(
  profile: z.infer<typeof ProductProfileObject>,
  ctx: z.RefinementCtx,
): void {
  const lineageValues = [
    profile.sourceSnapshotId,
    profile.analysisInvocationId,
    profile.generatedAt,
  ];
  const presentLineageValues = lineageValues.filter(
    (value) => value !== null,
  ).length;
  if (presentLineageValues !== 0 && presentLineageValues !== lineageValues.length) {
    ctx.addIssue({
      code: "custom",
      path: ["sourceSnapshotId"],
      message:
        "sourceSnapshotId, analysisInvocationId, and generatedAt must be all null or all present",
    });
  }

  const hasCanonicalEvidence = profile.fieldProvenance.some((entry) =>
    entry.evidenceRefs.some((ref) =>
      [
        "snapshot",
        "pageSnapshot",
        "observation",
        "analysisInvocation",
      ].includes(ref.kind),
    ),
  );
  if (hasCanonicalEvidence && presentLineageValues !== lineageValues.length) {
    ctx.addIssue({
      code: "custom",
      path: ["fieldProvenance"],
      message:
        "canonical evidence requires a complete frozen synthesis lineage",
    });
  }

  profile.fieldProvenance.forEach((entry, entryIndex) => {
    entry.evidenceRefs.forEach((ref, refIndex) => {
      if (
        ref.kind === "snapshot" &&
        ref.snapshotId !== profile.sourceSnapshotId
      ) {
        ctx.addIssue({
          code: "custom",
          path: [
            "fieldProvenance",
            entryIndex,
            "evidenceRefs",
            refIndex,
            "snapshotId",
          ],
          message: "snapshot evidence must match sourceSnapshotId",
        });
      }
      if (
        ref.kind === "analysisInvocation" &&
        ref.analysisInvocationId !== profile.analysisInvocationId
      ) {
        ctx.addIssue({
          code: "custom",
          path: [
            "fieldProvenance",
            entryIndex,
            "evidenceRefs",
            refIndex,
            "analysisInvocationId",
          ],
          message:
            "analysis invocation evidence must match analysisInvocationId",
        });
      }
    });
  });
}

function addProfileSemanticIssues(
  profile: z.infer<typeof ProductProfileObject>,
  ctx: z.RefinementCtx,
): void {
  const missing = new Set(profile.missingFields);
  const conflicting = new Set(profile.conflictingFields);

  for (const field of ProductProfileSemanticFields) {
    const value = profile[field.key];
    if (semanticValueIsEmpty(value)) {
      if (!field.optional && !missing.has(field.path) && !conflicting.has(field.path)) {
        ctx.addIssue({
          code: "custom",
          path: [field.key],
          message: `${field.path} must be marked missing or conflicting while empty`,
        });
      }
      continue;
    }

    if (missing.has(field.path)) {
      ctx.addIssue({
        code: "custom",
        path: ["missingFields"],
        message: `${field.path} cannot be marked missing while populated`,
      });
    }
    if (!hasFactProvenance(profile, field.path)) {
      ctx.addIssue({
        code: "custom",
        path: [field.key],
        message: `${field.path} requires traceable field provenance`,
      });
    }

    if (!Array.isArray(value) || value.length === 0) continue;
    const rootCoverage = profile.fieldProvenance.some(
      (entry) =>
        entry.path === field.path &&
        FactSupportingDerivations.has(entry.derivation),
    );
    if (rootCoverage) continue;
    value.forEach((_item, index) => {
      const itemRoot = `${field.path}/${index}`;
      if (!hasFactProvenance(profile, itemRoot)) {
        ctx.addIssue({
          code: "custom",
          path: [field.key, index],
          message: `${itemRoot} requires traceable field provenance`,
        });
      }
    });
  }
}

export const ProductProfileDraft = ProductProfileObject.superRefine(
  (profile, ctx) => {
    addProfileIdentityIssues(profile, ctx);
    addProfileLineageIssues(profile, ctx);
    addProfileSemanticIssues(profile, ctx);
  },
);
export type ProductProfileDraft = z.infer<typeof ProductProfileDraft>;

/**
 * Customer-editable projection of a Product Profile draft. Source identity,
 * model invocation metadata, provenance, missing/conflicting markers, and the
 * competitor pool are server-owned and therefore deliberately absent.
 */
export const ProductProfileEditablePatch = z
  .object({
    businessHint: ProductProfileBusinessHint.nullable(),
    productName: ProductProfileProductName.nullable(),
    customerModel: CustomerModel,
    growthObjectives: ProductProfileGrowthObjectives,
    oneLiner: z.string().trim().min(1).max(1000).nullable(),
    category: z.string().trim().min(1).max(160).nullable(),
    productType: z.string().trim().min(1).max(160).nullable(),
    businessModels: z
      .array(z.string().trim().min(1).max(160))
      .max(20)
      .refine(unique, "businessModels must be unique"),
    valueProposition: LongText.nullable(),
    coreFeatures: UniqueShortTextList,
    targetMarkets: z
      .array(ProductProfileTargetMarket)
      .max(20)
      .refine(
        (markets) => unique(markets.map((market) => market.marketCode)),
        "target market codes must be unique",
      ),
    targetAudiences: z
      .array(ProductProfileTargetAudience)
      .max(100)
      .refine(
        (audiences) =>
          unique(audiences.map((audience) => audience.candidateId)),
        "target audience candidateId values must be unique",
      ),
  })
  .strict()
  .partial()
  .refine(
    (patch) => Object.keys(patch).length > 0,
    "At least one editable Product Profile field must be provided",
  );
export type ProductProfileEditablePatch = z.infer<
  typeof ProductProfileEditablePatch
>;

export const ProductProfileBaseVersion = z.number().int().min(1);
export type ProductProfileBaseVersion = z.infer<
  typeof ProductProfileBaseVersion
>;

export const CreateProductProfileSynthesisRunRequest = z
  .object({
    baseVersion: ProductProfileBaseVersion,
  })
  .strict();
export type CreateProductProfileSynthesisRunRequest = z.infer<
  typeof CreateProductProfileSynthesisRunRequest
>;

export const UpdateProductProfileDraftRequest = z
  .object({
    baseVersion: ProductProfileBaseVersion,
    patch: ProductProfileEditablePatch,
  })
  .strict();
export type UpdateProductProfileDraftRequest = z.infer<
  typeof UpdateProductProfileDraftRequest
>;

const OptionalUniqueCompetitorAnalysisScope = z
  .array(ProductProfileCompetitorAnalysisScope)
  .max(5)
  .refine(unique, "analysisScope must be unique");

export const ReviewProductProfileCompetitorRequest = z
  .object({
    baseVersion: ProductProfileBaseVersion,
    reviewStatus: ProductProfileCompetitorReviewStatus,
    relationship: ProductProfileCompetitorRelationship.nullable().optional(),
    analysisScope: OptionalUniqueCompetitorAnalysisScope.optional(),
    reason: LongText.optional(),
    similarity: z.number().min(0).max(1).nullable().optional(),
  })
  .strict();
export type ReviewProductProfileCompetitorRequest = z.infer<
  typeof ReviewProductProfileCompetitorRequest
>;

export const AddProductProfileCompetitorRequest = z
  .object({
    baseVersion: ProductProfileBaseVersion,
    name: z.string().trim().min(1).max(160),
    domain: ProductProfileCompetitorDomain,
    relationship: ProductProfileCompetitorRelationship,
    analysisScope: z
      .array(ProductProfileCompetitorAnalysisScope)
      .min(1)
      .max(5)
      .refine(unique, "analysisScope must be unique"),
    reason: LongText.optional(),
  })
  .strict();
export type AddProductProfileCompetitorRequest = z.infer<
  typeof AddProductProfileCompetitorRequest
>;

export const ConfirmProductProfileRequest = z
  .object({
    baseVersion: ProductProfileBaseVersion,
  })
  .strict();
export type ConfirmProductProfileRequest = z.infer<
  typeof ConfirmProductProfileRequest
>;

export const ProductProfileRowStatus = z.enum(["draft", "complete"]);
export type ProductProfileRowStatus = z.infer<
  typeof ProductProfileRowStatus
>;

const ProductProfileRowIdentityShape = {
  id: Uuid,
  projectId: Uuid,
  version: z.number().int().min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: IsoDateTime,
  isCurrent: z.boolean(),
} as const;

const ConfirmedProductProfileObject = ProductProfileObject.extend({
  productName: z.string().trim().min(1).max(160),
  oneLiner: z.string().trim().min(1).max(1000),
  category: z.string().trim().min(1).max(160),
  productType: z.string().trim().min(1).max(160),
  businessModels: z
    .array(z.string().trim().min(1).max(160))
    .min(1)
    .max(20)
    .refine(unique, "businessModels must be unique"),
  valueProposition: LongText,
  coreFeatures: z
    .array(ShortText)
    .min(1)
    .max(100)
    .refine(unique, "Values must be unique"),
  targetMarkets: z.array(ProductProfileTargetMarket).min(1).max(20),
  targetAudiences: z.array(ProductProfileTargetAudience).min(1).max(100),
});

const ConfirmedRequiredSemanticRoots = [
  "/productName",
  "/oneLiner",
  "/category",
  "/productType",
  "/businessModels",
  "/valueProposition",
  "/coreFeatures",
  "/targetMarkets",
  "/targetAudiences",
] as const;

export const ConfirmedProductProfile = ConfirmedProductProfileObject.superRefine(
  (profile, ctx) => {
    addProfileIdentityIssues(profile, ctx);
    addProfileLineageIssues(profile, ctx);
    addProfileSemanticIssues(profile, ctx);

    for (const root of ConfirmedRequiredSemanticRoots) {
      if (
        [...profile.missingFields, ...profile.conflictingFields].some((path) =>
          pathIsWithin(path, root),
        )
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["missingFields"],
          message: `confirmed Product Profile cannot retain an unresolved ${root} marker`,
        });
      }
    }

    if (
      profile.targetMarkets.filter((market) => market.priority === "primary")
        .length !== 1
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["targetMarkets"],
        message: "a confirmed product profile requires exactly one primary market",
      });
    }
    if (
      profile.targetAudiences.filter(
        (audience) => audience.reviewStatus === "primary",
      ).length !== 1
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["targetAudiences"],
        message:
          "a confirmed product profile requires exactly one primary target audience",
      });
    }

    const primaryAudienceIndex = profile.targetAudiences.findIndex(
      (audience) => audience.reviewStatus === "primary",
    );
    const primaryAudience = profile.targetAudiences[primaryAudienceIndex];
    if (primaryAudience) {
      if (primaryAudience.targetCompanyOrAudience === null) {
        ctx.addIssue({
          code: "custom",
          path: [
            "targetAudiences",
            primaryAudienceIndex,
            "targetCompanyOrAudience",
          ],
          message:
            "the primary target audience requires a target company or audience",
        });
      }
      for (const field of [
        "buyerRoles",
        "userRoles",
        "useCases",
        "triggers",
        "pains",
        "jtbd",
      ] as const) {
        if (primaryAudience[field].length === 0) {
          ctx.addIssue({
            code: "custom",
            path: ["targetAudiences", primaryAudienceIndex, field],
            message: `the primary target audience requires at least one ${field} value`,
          });
        }
      }
    }

    checkConfirmedCompetitors(profile, ctx);
  },
);
export type ConfirmedProductProfile = z.infer<
  typeof ConfirmedProductProfile
>;

export const ProductProfileDraftRowDto = z
  .object({
    ...ProductProfileRowIdentityShape,
    status: z.literal("draft"),
    profile: ProductProfileDraft,
    isConfirmed: z.literal(false),
  })
  .strict();
export type ProductProfileDraftRowDto = z.infer<
  typeof ProductProfileDraftRowDto
>;

export const ConfirmedProductProfileRowDto = z
  .object({
    ...ProductProfileRowIdentityShape,
    status: z.literal("complete"),
    profile: ConfirmedProductProfile,
    isConfirmed: z.literal(true),
  })
  .strict();
export type ConfirmedProductProfileRowDto = z.infer<
  typeof ConfirmedProductProfileRowDto
>;

/**
 * Public append-only version row. Draft rows cannot claim confirmation, and a
 * complete row must carry the stronger confirmed profile rather than opaque
 * or merely draft-valid JSON.
 */
export const ProductProfileRowDto = z.discriminatedUnion("status", [
  ProductProfileDraftRowDto,
  ConfirmedProductProfileRowDto,
]);
export type ProductProfileRowDto = z.infer<typeof ProductProfileRowDto>;

function checkConfirmedCompetitors(
  profile: z.infer<typeof ProductProfileObject>,
  ctx: z.RefinementCtx,
): void {
  const domains = profile.competitorCandidates.map(
    (competitor) => competitor.domain,
  );
  if (!unique(domains)) {
    ctx.addIssue({
      code: "custom",
      path: ["competitorCandidates"],
      message: "competitor domains must be unique",
    });
  }
  profile.competitorCandidates.forEach((competitor, index) => {
    if (
      competitor.reviewStatus === "approved" &&
      (competitor.relationship === null || competitor.analysisScope.length === 0)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["competitorCandidates", index, "analysisScope"],
        message:
          "approved competitors require a direct/indirect relationship and analysis scope",
      });
    }
  });
}

export const INITIAL_PRODUCT_PROFILE_MISSING_FIELDS = [
  "/productName",
  "/oneLiner",
  "/category",
  "/productType",
  "/businessModels",
  "/valueProposition",
  "/coreFeatures",
  "/targetMarkets",
  "/targetAudiences",
  "/competitorCandidates",
] as const;

export interface InitialProductProfileDraftInput {
  readonly sourceSiteId: string;
  readonly sourcePageUrl: string;
  readonly businessHint?: string;
  readonly productName?: string;
  readonly customerModel?: z.input<typeof CustomerModel>;
  readonly primaryMarket?: z.input<typeof MarketCode>;
  readonly growthObjectives?: readonly z.input<
    typeof ProductProfileGrowthObjective
  >[];
}

const FNV1A_128_OFFSET_BASIS =
  0x6c62272e07bb014262b821756295c58dn;
const FNV1A_128_PRIME = 0x0000000001000000000000000000013bn;
const UINT128_MASK = (1n << 128n) - 1n;

/**
 * Produce a synchronous, runtime-portable UUIDv8 for replay-stable semantic
 * identity. FNV-1a 128 is an identity hash here, not a security primitive;
 * UUIDv8 marks the custom derivation rather than misrepresenting it as v5.
 */
function deterministicEvidenceRefId(seed: string): string {
  let hash = FNV1A_128_OFFSET_BASIS;
  for (const byte of new TextEncoder().encode(seed)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV1A_128_PRIME) & UINT128_MASK;
  }

  const raw = hash.toString(16).padStart(32, "0");
  const withVersion = `${raw.slice(0, 12)}8${raw.slice(13)}`;
  const variant = (
    (Number.parseInt(withVersion[16]!, 16) & 0b0011) |
    0b1000
  ).toString(16);
  const uuid = `${withVersion.slice(0, 16)}${variant}${withVersion.slice(17)}`;
  return `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20)}`;
}

/** Build a valid empty draft without inferring facts that have not been observed. */
export function createInitialProductProfileDraft(
  input: InitialProductProfileDraftInput,
): ProductProfileDraft {
  const sourceSiteId = Uuid.parse(input.sourceSiteId);
  const sourcePageUrl = ProductProfileProductUrl.parse(input.sourcePageUrl);
  const businessHint =
    input.businessHint === undefined
      ? null
      : ProductProfileBusinessHint.parse(input.businessHint);
  const productName =
    input.productName === undefined
      ? null
      : ProductProfileProductName.parse(input.productName);
  const customerModel =
    input.customerModel === undefined
      ? undefined
      : CustomerModel.parse(input.customerModel);
  const primaryMarket =
    input.primaryMarket === undefined
      ? undefined
      : MarketCode.parse(input.primaryMarket);
  const growthObjectives =
    input.growthObjectives === undefined
      ? undefined
      : ProductProfileGrowthObjectives.min(1).parse(input.growthObjectives);

  const declaredProvenance = (
    path: string,
    value: unknown,
    kind: "declaredHint" | "userEdit",
  ): ProductProfileFieldProvenance => ({
    path,
    derivation: "declared",
    confidence: "high",
    evidenceRefs: [
      {
        evidenceRefId: deterministicEvidenceRefId(
          JSON.stringify([
            PRODUCT_PROFILE_SCHEMA_VERSION,
            sourceSiteId,
            sourcePageUrl,
            path,
            value,
          ]),
        ),
        kind,
      },
    ],
    limitation: "Declared by the user; not independently observed.",
    observedAt: null,
  });

  const fieldProvenance: ProductProfileFieldProvenance[] = [
    ...(businessHint === null
      ? []
      : [declaredProvenance("/businessHint", businessHint, "declaredHint")]),
    ...(productName === null
      ? []
      : [declaredProvenance("/productName", productName, "userEdit")]),
    ...(customerModel === undefined
      ? []
      : [declaredProvenance("/customerModel", customerModel, "userEdit")]),
    ...(primaryMarket === undefined
      ? []
      : [
          declaredProvenance("/targetMarkets", [
            { marketCode: primaryMarket, priority: "primary" },
          ], "userEdit"),
        ]),
    ...(growthObjectives === undefined
      ? []
      : [
          declaredProvenance(
            "/growthObjectives",
            growthObjectives,
            "userEdit",
          ),
        ]),
  ];
  const missingFields = INITIAL_PRODUCT_PROFILE_MISSING_FIELDS.filter(
    (path) =>
      !(path === "/productName" && productName !== null) &&
      !(path === "/targetMarkets" && primaryMarket !== undefined),
  );

  return ProductProfileDraft.parse({
    profileSchemaVersion: PRODUCT_PROFILE_SCHEMA_VERSION,
    sourceSiteId,
    sourcePageUrl,
    sourceSnapshotId: null,
    analysisInvocationId: null,
    generatedAt: null,
    businessHint,
    productName,
    ...(customerModel === undefined ? {} : { customerModel }),
    ...(growthObjectives === undefined ? {} : { growthObjectives }),
    oneLiner: null,
    category: null,
    productType: null,
    businessModels: [],
    valueProposition: null,
    coreFeatures: [],
    targetMarkets:
      primaryMarket === undefined
        ? []
        : [{ marketCode: primaryMarket, priority: "primary" }],
    targetAudiences: [],
    competitorCandidates: [],
    fieldProvenance,
    missingFields,
    conflictingFields: [],
  });
}

/** Compatibility alias for callers that prefer builder terminology. */
export const buildInitialProductProfileDraft =
  createInitialProductProfileDraft;
