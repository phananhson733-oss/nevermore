import { z } from "zod";
import {
  Bcp47Locale,
  IsoDateTime,
  MarketCode,
  Uuid,
} from "./common.ts";

/**
 * Customer-readable audit taxonomy for Slice 1. Every Growth Audit response
 * carries each module, including modules whose honest state is `no_data`.
 */
export const AuditModuleId = z.enum([
  "performance",
  "accessibility",
  "best_practices_security",
  "technical_search",
  "content_intent",
  "ai_geo",
  "links_architecture",
  "compliance_measurement",
]);
export type AuditModuleId = z.infer<typeof AuditModuleId>;

export const FrontstageLensId = z.enum([
  "site_health",
  "search_ai_visibility",
  "demand_competition",
]);
export type FrontstageLensId = z.infer<typeof FrontstageLensId>;

/** `no_data` is missing coverage, never a zero score or an implicit pass. */
export const CoverageState = z.enum([
  "available",
  "partial",
  "stale",
  "no_data",
]);
export type CoverageState = z.infer<typeof CoverageState>;

export const SourceFreshness = z.enum(["current", "stale", "unknown"]);
export type SourceFreshness = z.infer<typeof SourceFreshness>;

const NonEmptyUniqueStrings = z
  .array(z.string().trim().min(1).max(500))
  .max(100)
  .refine((values) => new Set(values).size === values.length, {
    message: "Values must be unique",
  });

export const AuditModuleSummary = z
  .object({
    moduleId: AuditModuleId,
    coverageState: CoverageState,
    evidenceCount: z.number().int().nonnegative(),
    findingCount: z.number().int().nonnegative(),
    sourceProviders: NonEmptyUniqueStrings,
    latestObservedAt: IsoDateTime.nullable(),
    limitations: z.array(z.string().trim().min(1).max(2000)).max(100),
  })
  .strict()
  .superRefine((summary, ctx) => {
    const noData = summary.coverageState === "no_data";
    const require = (condition: boolean, path: string, message: string) => {
      if (!condition) ctx.addIssue({ code: "custom", path: [path], message });
    };
    if (noData) {
      require(
        summary.evidenceCount === 0,
        "evidenceCount",
        "no_data cannot report Evidence",
      );
      require(
        summary.findingCount === 0,
        "findingCount",
        "no_data cannot report Findings",
      );
      require(
        summary.sourceProviders.length === 0,
        "sourceProviders",
        "no_data cannot report observed source providers",
      );
      require(
        summary.latestObservedAt === null,
        "latestObservedAt",
        "no_data cannot report an observation time",
      );
      require(
        summary.limitations.length > 0,
        "limitations",
        "no_data must explain why coverage is unavailable",
      );
      return;
    }
    require(
      summary.evidenceCount > 0,
      "evidenceCount",
      "observed coverage must reference Evidence",
    );
    require(
      summary.sourceProviders.length > 0,
      "sourceProviders",
      "observed coverage must name at least one source provider",
    );
    require(
      summary.latestObservedAt !== null,
      "latestObservedAt",
      "observed coverage must expose its latest observation time",
    );
    if (summary.coverageState === "partial" || summary.coverageState === "stale") {
      require(
        summary.limitations.length > 0,
        "limitations",
        `${summary.coverageState} coverage must explain its limitation`,
      );
    }
  });
export type AuditModuleSummary = z.infer<typeof AuditModuleSummary>;

export const AuditLensSummary = z
  .object({
    lensId: FrontstageLensId,
    coverageState: CoverageState,
    evidenceCount: z.number().int().nonnegative(),
    findingCount: z.number().int().nonnegative(),
    limitations: z.array(z.string().trim().min(1).max(2000)).max(100),
  })
  .strict()
  .superRefine((summary, ctx) => {
    if (summary.coverageState === "no_data") {
      if (summary.evidenceCount !== 0) {
        ctx.addIssue({
          code: "custom",
          path: ["evidenceCount"],
          message: "no_data cannot report Evidence",
        });
      }
      if (summary.findingCount !== 0) {
        ctx.addIssue({
          code: "custom",
          path: ["findingCount"],
          message: "no_data cannot report Findings",
        });
      }
      if (summary.limitations.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["limitations"],
          message: "no_data must explain why coverage is unavailable",
        });
      }
      return;
    }
    if (summary.evidenceCount === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["evidenceCount"],
        message: "observed coverage must reference Evidence",
      });
    }
    if (
      (summary.coverageState === "partial" || summary.coverageState === "stale") &&
      summary.limitations.length === 0
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["limitations"],
        message: `${summary.coverageState} coverage must explain its limitation`,
      });
    }
  });
export type AuditLensSummary = z.infer<typeof AuditLensSummary>;

const QueryEvidenceBase = {
  observationId: Uuid,
  snapshotId: Uuid,
  query: z.string().trim().min(1).max(2000),
  marketCode: MarketCode,
  languageCode: Bcp47Locale,
  sourceProvider: z.string().trim().min(1).max(200),
  observedAt: IsoDateTime,
  freshness: SourceFreshness,
  limitation: z.string().trim().min(1).max(2000),
} as const;

const SearchQueryMetrics = z
  .object({
    monthlyVolume: z.number().nonnegative().nullable(),
    keywordDifficulty: z.number().min(0).max(100).nullable(),
    organicRank: z.number().positive().nullable(),
    impressions: z.number().int().nonnegative().nullable(),
    clicks: z.number().int().nonnegative().nullable(),
  })
  .strict();

/** Search demand/rank metrics must never be projected onto AI answer samples. */
export const SearchQueryEvidence = z
  .object({
    queryKind: z.literal("search"),
    ...QueryEvidenceBase,
    metrics: SearchQueryMetrics,
  })
  .strict();
export type SearchQueryEvidence = z.infer<typeof SearchQueryEvidence>;

const GenerativeQueryMetrics = z
  .object({
    sampleSize: z.number().int().positive(),
    brandMentionCount: z.number().int().nonnegative(),
    brandCitationCount: z.number().int().nonnegative(),
    citedCompetitorCount: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const key of [
      "brandMentionCount",
      "brandCitationCount",
      "citedCompetitorCount",
    ] as const) {
      if (value[key] > value.sampleSize) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} cannot exceed sampleSize`,
        });
      }
    }
  });

/** Generative evidence records observed answer samples, not search volume/KD. */
export const GenerativeQueryEvidence = z
  .object({
    queryKind: z.literal("generative"),
    ...QueryEvidenceBase,
    metrics: GenerativeQueryMetrics,
  })
  .strict();
export type GenerativeQueryEvidence = z.infer<
  typeof GenerativeQueryEvidence
>;

export const QueryEvidence = z.discriminatedUnion("queryKind", [
  SearchQueryEvidence,
  GenerativeQueryEvidence,
]);
export type QueryEvidence = z.infer<typeof QueryEvidence>;

const CompleteAuditModuleSummaries = z
  .array(AuditModuleSummary)
  .length(AuditModuleId.options.length)
  .superRefine((modules, ctx) => {
    const actual = new Set(modules.map((module) => module.moduleId));
    for (const expected of AuditModuleId.options) {
      if (!actual.has(expected)) {
        ctx.addIssue({
          code: "custom",
          message: `Missing audit module summary: ${expected}`,
        });
      }
    }
    if (actual.size !== modules.length) {
      ctx.addIssue({
        code: "custom",
        message: "Audit module summaries must be unique",
      });
    }
  });

const CompleteAuditLensSummaries = z
  .array(AuditLensSummary)
  .length(FrontstageLensId.options.length)
  .superRefine((lenses, ctx) => {
    const actual = new Set(lenses.map((lens) => lens.lensId));
    for (const expected of FrontstageLensId.options) {
      if (!actual.has(expected)) {
        ctx.addIssue({
          code: "custom",
          message: `Missing audit lens summary: ${expected}`,
        });
      }
    }
    if (actual.size !== lenses.length) {
      ctx.addIssue({
        code: "custom",
        message: "Audit lens summaries must be unique",
      });
    }
  });

/**
 * Read-only audit projection. Status is projected from the canonical async run;
 * audit/module rows do not own another lifecycle.
 */
export const GrowthAuditResponse = z
  .object({
    auditRunId: Uuid,
    projectId: Uuid,
    siteId: Uuid,
    status: z.enum([
      "queued",
      "running",
      "completed",
      "partial",
      "failed",
      "cancelled",
    ]),
    outputLocale: Bcp47Locale,
    completedAt: IsoDateTime.nullable(),
    modules: CompleteAuditModuleSummaries,
    lenses: CompleteAuditLensSummaries,
    coverageAndLimitations: z
      .array(z.string().trim().min(1).max(2000))
      .max(200),
  })
  .strict()
  .superRefine((audit, ctx) => {
    const terminal = audit.status !== "queued" && audit.status !== "running";
    if (terminal && audit.completedAt === null) {
      ctx.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "terminal audit status requires completedAt",
      });
    }
    if (!terminal && audit.completedAt !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "non-terminal audit status cannot report completedAt",
      });
    }
  });
export type GrowthAuditResponse = z.infer<typeof GrowthAuditResponse>;
