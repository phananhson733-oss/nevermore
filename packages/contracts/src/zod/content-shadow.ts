import { z } from "zod";
import { Bcp47Locale, IsoDateTime, Uuid } from "./common.ts";

/**
 * SEO/GEO Content Shadow contracts (Slice 2).
 *
 * A Content Shadow run is a SHADOW-mode capability: it consumes an already
 * confirmed content brief revision and produces an internal English draft plus
 * a QA verdict. It never confirms anything a second time (no approval,
 * checkpoint or opportunity object), never recasts the brief, and never
 * performs an external CMS/publish write.
 */

export const CONTENT_SHADOW_CAPABILITY_CONTRACT_VERSION =
  "content-shadow.0.3.0" as const;

/** Server-fixed pinned Flow adapter version (decision R3). */
export const CONTENT_SHADOW_ADAPTER_CONTRACT_VERSION =
  "content-shadow-adapter.0.3.0" as const;

const MAX_COMPETITORS = 50;
const MAX_SEARCH_KEYWORDS = 500;
const MAX_GENERATIVE_QUERIES = 500;

const uniqueUuids = (max: number, min = 0) =>
  z
    .array(Uuid)
    .min(min)
    .max(max)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "Entity ids must be unique",
    });

/**
 * The frozen SearchQuery cluster. Its keyword identities stay in their own
 * field: search demand and generative answer observation are never collapsed
 * into one set or one shared volume (invariant 8).
 */
export const ContentShadowSearchCluster = z
  .object({
    clusterKey: z.string().trim().min(1).max(200),
    keywordEntityIds: uniqueUuids(MAX_SEARCH_KEYWORDS, 1),
  })
  .strict();
export type ContentShadowSearchCluster = z.infer<
  typeof ContentShadowSearchCluster
>;

/**
 * Immutable input for one Content Shadow run. There is no confirmation field:
 * the Finding was already confirmed through the canonical Finding Review
 * transaction, and this command refuses to run unless that is still true.
 */
export const CreateContentShadowRunRequest = z
  .object({
    actionId: Uuid,
    /** Defaults to the brief's current revision when omitted. */
    contentBriefRevision: z.number().int().min(1).optional(),
    /** Accepted only as an explicit echo of the server-pinned adapter (R3). */
    flowAdapterVersion: z
      .literal(CONTENT_SHADOW_ADAPTER_CONTRACT_VERSION)
      .optional(),
    competitorEntityIds: uniqueUuids(MAX_COMPETITORS).default([]),
    searchCluster: ContentShadowSearchCluster,
    generativeQueryEntityIds: uniqueUuids(MAX_GENERATIVE_QUERIES).default([]),
    outputLocale: Bcp47Locale,
    capabilityContractVersion: z.literal(
      CONTENT_SHADOW_CAPABILITY_CONTRACT_VERSION,
    ),
  })
  .strict()
  .superRefine((body, ctx) => {
    const search = new Set(body.searchCluster.keywordEntityIds);
    const collapsed = body.generativeQueryEntityIds.filter((id) =>
      search.has(id),
    );
    if (collapsed.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["generativeQueryEntityIds"],
        message:
          "Search and generative observation must stay separate: an entity cannot be both",
      });
    }
  });
export type CreateContentShadowRunRequest = z.infer<
  typeof CreateContentShadowRunRequest
>;

/** Phase is DERIVED from which append-only child rows exist (decision R1). */
export const ContentShadowPhase = z.enum([
  "queued",
  "research",
  "draft",
  "qa",
  "complete",
  "failed",
]);
export type ContentShadowPhase = z.infer<typeof ContentShadowPhase>;

export const ContentShadowQaVerdict = z.enum([
  "passed",
  "needs_review",
  "blocked",
]);
export type ContentShadowQaVerdict = z.infer<typeof ContentShadowQaVerdict>;

export const ContentShadowQaClaim = z
  .object({
    claimId: z.string().trim().min(1).max(200),
    kind: z.enum(["red_line", "structure", "citability", "coverage"]),
    /** `unevaluated` is honest missing judgement, never an implicit pass. */
    status: z.enum(["passed", "failed", "unevaluated"]),
    detail: z.string().trim().min(1).max(2000),
  })
  .strict();
export type ContentShadowQaClaim = z.infer<typeof ContentShadowQaClaim>;

export const ContentShadowAuthoritySource = z
  .object({
    kind: z.enum([
      "content_brief",
      "search_query",
      "generative_query",
      "competitor",
    ]),
    ref: z.string().trim().min(1).max(500),
    authorityTier: z.enum(["A", "B", "C", "D"]),
    limitation: z.string().trim().min(1).max(2000).nullable(),
  })
  .strict();
export type ContentShadowAuthoritySource = z.infer<
  typeof ContentShadowAuthoritySource
>;

export const ContentShadowFrozenInputs = z
  .object({
    primaryFindingId: Uuid,
    sourceDiagnosticRunId: Uuid,
    competitorEntityIds: z.array(Uuid).max(MAX_COMPETITORS),
    searchCluster: z
      .object({
        clusterKey: z.string().trim().min(1).max(200),
        keywordEntityIds: z.array(Uuid).max(MAX_SEARCH_KEYWORDS),
      })
      .strict(),
    generativeQueryEntityIds: z.array(Uuid).max(MAX_GENERATIVE_QUERIES),
  })
  .strict();
export type ContentShadowFrozenInputs = z.infer<
  typeof ContentShadowFrozenInputs
>;

export const ContentShadowResearch = z
  .object({
    packId: Uuid,
    sources: z.array(ContentShadowAuthoritySource).max(1000),
    limitations: z.array(z.string().trim().min(1).max(2000)).max(100),
    generatedAt: IsoDateTime,
  })
  .strict();
export type ContentShadowResearch = z.infer<typeof ContentShadowResearch>;

export const ContentShadowDraft = z
  .object({
    artifactId: Uuid,
    /**
     * The shadow draft's own lifecycle never reaches a published state: this is
     * an internal artifact and Slice 2 performs zero external writes.
     */
    status: z.enum(["generating", "draft", "ready", "failed", "archived"]),
    currentRevision: z.number().int().min(0),
    contentText: z.string().nullable(),
  })
  .strict();
export type ContentShadowDraft = z.infer<typeof ContentShadowDraft>;

export const ContentShadowQaGate = z
  .object({
    gateId: Uuid,
    verdict: ContentShadowQaVerdict,
    evaluatedArtifactId: Uuid,
    evaluatedRevision: z.number().int().min(1),
    claims: z.array(ContentShadowQaClaim).max(500),
    evaluatedAt: IsoDateTime,
  })
  .strict();
export type ContentShadowQaGate = z.infer<typeof ContentShadowQaGate>;

/**
 * Read-only Content Shadow projection. Run status comes from the canonical
 * async run; the shadow rows own no second lifecycle.
 */
export const ContentShadowRunResponse = z
  .object({
    flowShadowRunId: Uuid,
    projectId: Uuid,
    siteId: Uuid,
    asyncRunId: Uuid,
    status: z.enum([
      "queued",
      "running",
      "completed",
      "partial",
      "failed",
      "cancelled",
    ]),
    phase: ContentShadowPhase,
    contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
    projectionVersion: z.string().trim().min(1).max(200),
    flowAdapterVersion: z.string().trim().min(1).max(200),
    outputLocale: Bcp47Locale,
    createdAt: IsoDateTime,
    source: z
      .object({
        findingId: Uuid,
        actionId: Uuid,
        contentBriefArtifactId: Uuid,
        contentBriefRevision: z.number().int().min(1),
      })
      .strict(),
    frozenInputs: ContentShadowFrozenInputs,
    research: ContentShadowResearch.nullable(),
    draft: ContentShadowDraft.nullable(),
    qa: ContentShadowQaGate.nullable(),
  })
  .strict();
export type ContentShadowRunResponse = z.infer<
  typeof ContentShadowRunResponse
>;
