import { z } from "zod";
import {
  Bcp47Locale,
  Cursor,
  IsoDateTime,
  MarketCode,
  Uuid,
} from "./common.ts";
import { PriorityBand } from "./diagnostics.ts";
import { SourceFreshness } from "./audit.ts";
import { ExecutionPreview } from "./execution-preview.ts";
import {
  ProductProfileCompetitorAnalysisScope,
  ProductProfileCompetitorDomain,
  ProductProfileEvidenceRef,
  ProductProfileJsonPointer,
} from "./product-profile.ts";

const BoundedText = z.string().trim().min(1).max(2000);
const BoundedLabel = z.string().trim().min(1).max(500);
const KeywordEvidenceLabel = z.string().trim().min(1).max(200);
const KeywordEvidenceRecordHash = z
  .string()
  .regex(/^[0-9a-f]{64}$/u, "Must be a lowercase SHA-256 hex digest");
const KeywordEvidenceHttpsUrl = z
  .string()
  .trim()
  .url()
  .max(2048)
  .refine((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, {
    message: "Keyword evidence URL must use HTTPS",
  });
const NullableBoundedLabel = BoundedLabel.nullable();
const NullableLimitation = BoundedText.nullable();
const JsonPointer = z
  .string()
  .min(1)
  .max(500)
  .regex(/^\/(?:[^/~]|~0|~1)*(?:\/(?:[^/~]|~0|~1)*)*$/, "Invalid JSON Pointer");

function isUnique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function uniqueUuidArray(maximum: number) {
  return z
    .array(Uuid)
    .max(maximum)
    .refine(isUnique, "Canonical IDs must be unique");
}

const UniqueFindingIds = uniqueUuidArray(200);
const NonEmptyUniqueFindingIds = uniqueUuidArray(200).min(1);
const UniqueLimitations = z
  .array(BoundedText)
  .max(100)
  .refine(isUnique, "Limitations must be unique");

export const GrowthMapCoverageAvailability = z.enum([
  "available",
  "partial",
  "stale",
  "unavailable",
]);
export type GrowthMapCoverageAvailability = z.infer<
  typeof GrowthMapCoverageAvailability
>;

/**
 * Coverage is explicit at both the portfolio page and URL row. A degraded or
 * unavailable projection must explain the gap; it is never represented by a
 * synthetic score or project-wide total.
 */
export const GrowthMapCoverage = z
  .object({
    availability: GrowthMapCoverageAvailability,
    limitations: UniqueLimitations,
  })
  .strict()
  .superRefine((coverage, ctx) => {
    if (
      coverage.availability !== "available" &&
      coverage.limitations.length === 0
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["limitations"],
        message: `${coverage.availability} coverage requires a limitation`,
      });
    }
  });
export type GrowthMapCoverage = z.infer<typeof GrowthMapCoverage>;

export const GrowthMapMetricValueSource = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("value_numeric") }).strict(),
  z
    .object({
      kind: z.literal("value_json"),
      pointer: JsonPointer,
    })
    .strict(),
]);
export type GrowthMapMetricValueSource = z.infer<
  typeof GrowthMapMetricValueSource
>;

export const GrowthMapUrlMetricProvider = z.enum(["crawl", "gsc", "ga4"]);
export type GrowthMapUrlMetricProvider = z.infer<
  typeof GrowthMapUrlMetricProvider
>;

const GrowthMapUrlMetricObservationShape = {
  subjectRef: z.string().trim().url().max(2048),
  valueSource: GrowthMapMetricValueSource,
  value: z.number().finite().nullable(),
  unit: z.string().trim().min(1).max(50).nullable(),
  availability: z.enum(["available", "partial", "unavailable"]),
  snapshotId: Uuid,
  observationId: Uuid,
  sitePageId: Uuid,
  observedAt: IsoDateTime,
  freshness: SourceFreshness,
  limitation: NullableLimitation,
} as const;

/**
 * A URL metric is a scalar projection of one persisted Observation. This shape
 * deliberately does not invent a PageSnapshot relation for GSC/GA4 data. Its
 * URL membership is proven by a matching `url_observation` identity source,
 * which carries the Observation's durable SitePage lineage. Missing metric data
 * is null + unavailable, never an invented zero.
 */
export const GrowthMapUrlMetricObservation = z
  .discriminatedUnion("provider", [
    z
      .object({
        ...GrowthMapUrlMetricObservationShape,
        provider: z.literal("crawl"),
        metricKey: z.literal("crawl.page.v1"),
      })
      .strict(),
    z
      .object({
        ...GrowthMapUrlMetricObservationShape,
        provider: z.literal("gsc"),
        metricKey: z.literal("gsc.page.v1"),
      })
      .strict(),
    z
      .object({
        ...GrowthMapUrlMetricObservationShape,
        provider: z.literal("ga4"),
        metricKey: z.literal("ga4.landing.v1"),
      })
      .strict(),
  ])
  .superRefine((observation, ctx) => {
    if (observation.availability !== "available") {
      if (observation.value !== null) {
        ctx.addIssue({
          code: "custom",
          path: ["value"],
          message:
            "A partial or unavailable metric Observation must have a null value",
        });
      }
      if (observation.limitation === null) {
        ctx.addIssue({
          code: "custom",
          path: ["limitation"],
          message:
            "A partial or unavailable metric Observation requires a limitation",
        });
      }
      return;
    }

    if (observation.value === null) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: "An observed metric requires a numeric value",
      });
    }
    if (
      observation.freshness !== "current" &&
      observation.limitation === null
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["limitation"],
        message: "Partial, stale, or unknown metric data requires a limitation",
      });
    }
  });
export type GrowthMapUrlMetricObservation = z.infer<
  typeof GrowthMapUrlMetricObservation
>;

const PageSnapshotIdentitySource = z
  .object({
    kind: z.literal("page_snapshot"),
    provider: z.literal("crawl"),
    snapshotId: Uuid,
    pageSnapshotId: Uuid,
    observedAt: IsoDateTime,
  })
  .strict();

const UrlObservationIdentitySource = z
  .object({
    kind: z.literal("url_observation"),
    provider: GrowthMapUrlMetricProvider,
    snapshotId: Uuid,
    observationId: Uuid,
    sitePageId: Uuid,
    subjectRef: z.string().trim().url().max(2048),
    observedAt: IsoDateTime,
  })
  .strict();

/** Every portfolio URL names at least one immutable source that created it. */
export const GrowthMapUrlIdentitySource = z.discriminatedUnion("kind", [
  PageSnapshotIdentitySource,
  UrlObservationIdentitySource,
]);
export type GrowthMapUrlIdentitySource = z.infer<
  typeof GrowthMapUrlIdentitySource
>;

export const GrowthMapComparisonAnchor = z
  .object({
    projectId: Uuid,
    siteId: Uuid,
    diagnosticRunId: Uuid,
    crawlSnapshotId: Uuid,
    sitePageId: Uuid,
    pageSnapshotId: Uuid,
  })
  .strict();
export type GrowthMapComparisonAnchor = z.infer<
  typeof GrowthMapComparisonAnchor
>;

/** Immutable before/current provenance used only for a recheck delta. */
export const GrowthMapFindingComparisonBasis = z
  .object({
    findingIds: NonEmptyUniqueFindingIds,
    before: GrowthMapComparisonAnchor,
    current: GrowthMapComparisonAnchor,
  })
  .strict()
  .superRefine((basis, ctx) => {
    if (basis.before.projectId !== basis.current.projectId) {
      ctx.addIssue({
        code: "custom",
        path: ["before", "projectId"],
        message: "A comparison cannot cross projects",
      });
    }
    if (basis.before.siteId !== basis.current.siteId) {
      ctx.addIssue({
        code: "custom",
        path: ["before", "siteId"],
        message: "A comparison cannot cross Sites",
      });
    }
    if (basis.before.sitePageId !== basis.current.sitePageId) {
      ctx.addIssue({
        code: "custom",
        path: ["before", "sitePageId"],
        message: "A comparison cannot cross canonical Site Pages",
      });
    }
    for (const key of [
      "diagnosticRunId",
      "crawlSnapshotId",
      "pageSnapshotId",
    ] as const) {
      if (basis.before[key] === basis.current[key]) {
        ctx.addIssue({
          code: "custom",
          path: ["before", key],
          message: `Before and current ${key} values must be distinct`,
        });
      }
    }
  });
export type GrowthMapFindingComparisonBasis = z.infer<
  typeof GrowthMapFindingComparisonBasis
>;

/**
 * Deterministic URL priority derivations.
 *
 * `max_finding_severity.v1` mapped the highest current-run Finding severity
 * straight onto the band. `url_opportunity_rank.v1` additionally weighs the
 * cross-page blast radius of those Findings and how many reviewable Findings
 * stack on the URL.
 *
 * Priority is derived at read time by the current product version, so this
 * literal names the derivation that produced this response rather than one
 * frozen with the generation. Re-reading an already published generation after
 * a derivation change can therefore report a different literal and a different
 * band than the same generation reported before. The superseded literal stays
 * readable so payloads captured under it still validate.
 */
export const GrowthMapPriorityDerivationVersion = z.enum([
  "max_finding_severity.v1",
  "url_opportunity_rank.v1",
]);
export type GrowthMapPriorityDerivationVersion = z.infer<
  typeof GrowthMapPriorityDerivationVersion
>;

/** Priority is a deterministic current-run Finding projection, not a recheck. */
export const GrowthMapFindingPriorityBasis = z
  .object({
    derivationVersion: GrowthMapPriorityDerivationVersion,
    projectId: Uuid,
    siteId: Uuid,
    diagnosticRunId: Uuid,
    sitePageId: Uuid,
    findingIds: NonEmptyUniqueFindingIds,
  })
  .strict();
export type GrowthMapFindingPriorityBasis = z.infer<
  typeof GrowthMapFindingPriorityBasis
>;

const UnavailablePriority = z
  .object({
    availability: z.literal("unavailable"),
    value: z.null(),
    limitation: BoundedText,
  })
  .strict();

const AvailablePriority = z
  .object({
    availability: z.literal("available"),
    value: PriorityBand,
    basis: GrowthMapFindingPriorityBasis,
    limitation: NullableLimitation,
  })
  .strict();

/** Priority is unavailable unless one deterministic current-run Finding basis exists. */
export const GrowthMapUrlPriority = z.discriminatedUnion("availability", [
  UnavailablePriority,
  AvailablePriority,
]);
export type GrowthMapUrlPriority = z.infer<typeof GrowthMapUrlPriority>;

const UnavailableDelta = z
  .object({
    availability: z.literal("unavailable"),
    value: z.null(),
    limitation: BoundedText,
  })
  .strict();

const AvailableDelta = z
  .object({
    availability: z.literal("available"),
    value: z.enum(["improved", "unchanged", "regressed"]),
    basis: GrowthMapFindingComparisonBasis,
    summary: BoundedText,
    limitation: NullableLimitation,
  })
  .strict();

/** Delta is nullable unless two immutable run/snapshot anchors back it. */
export const GrowthMapUrlDelta = z.discriminatedUnion("availability", [
  UnavailableDelta,
  AvailableDelta,
]);
export type GrowthMapUrlDelta = z.infer<typeof GrowthMapUrlDelta>;

const DirectUrlFindingRelation = z
  .object({
    relation: z.literal("direct_url"),
    targetKind: z.literal("url"),
    targetRef: z.string().trim().url().max(2048),
    sitePageId: Uuid,
    pageSnapshotId: Uuid.nullable(),
  })
  .strict();

const TemplateFindingRelation = z
  .object({
    relation: z.literal("affected_by_template"),
    targetKind: z.literal("template"),
    targetRef: BoundedLabel,
  })
  .strict();

const SiteFindingRelation = z
  .object({
    relation: z.literal("affected_by_site"),
    targetKind: z.literal("site"),
    targetRef: BoundedLabel,
  })
  .strict();

const PageSetFindingRelation = z
  .object({
    relation: z.literal("affected_by_page_set"),
    targetKind: z.literal("page_set"),
    targetRef: BoundedLabel,
  })
  .strict();

const HttpStatusFindingRelation = z
  .object({
    relation: z.literal("affected_by_http_status"),
    targetKind: z.literal("http_status"),
    targetRef: z.string().regex(/^[1-5][0-9]{2}$/),
  })
  .strict();

const CanonicalIssueFindingRelation = z
  .object({
    relation: z.literal("affected_by_canonical_issue"),
    targetKind: z.literal("canonical_issue"),
    targetRef: BoundedLabel,
  })
  .strict();

const KeywordClusterFindingRelation = z
  .object({
    relation: z.literal("affected_by_keyword_cluster"),
    targetKind: z.literal("keyword_cluster"),
    targetRef: BoundedLabel,
  })
  .strict();

const UserAgentFindingRelation = z
  .object({
    relation: z.literal("affected_by_user_agent"),
    targetKind: z.literal("user_agent"),
    targetRef: BoundedLabel,
  })
  .strict();

/**
 * Canonical Finding target vocabulary. A direct URL carries canonical page
 * anchors; aggregate targets stay independent of any one selected URL so the
 * same Finding can be related to every affected page. New target kinds require
 * a new explicit discriminated-union branch.
 */
export const GrowthMapFindingTargetRelation = z.discriminatedUnion(
  "relation",
  [
    DirectUrlFindingRelation,
    TemplateFindingRelation,
    SiteFindingRelation,
    PageSetFindingRelation,
    HttpStatusFindingRelation,
    CanonicalIssueFindingRelation,
    KeywordClusterFindingRelation,
    UserAgentFindingRelation,
  ],
);
export type GrowthMapFindingTargetRelation = z.infer<
  typeof GrowthMapFindingTargetRelation
>;

/**
 * Growth Map links into Execution by canonical IDs only. Action/Artifact titles,
 * statuses, or mutable payloads belong to their authoritative read models.
 */
export const GrowthMapExecutionRef = z
  .object({
    actionId: Uuid,
    artifactIds: uniqueUuidArray(100),
  })
  .strict();
export type GrowthMapExecutionRef = z.infer<typeof GrowthMapExecutionRef>;

export const GrowthMapUrlFinding = z
  .object({
    projectId: Uuid,
    siteId: Uuid,
    findingId: Uuid,
    diagnosticRunId: Uuid,
    ruleId: z
      .string()
      .trim()
      .regex(/^(TECH|SEARCH|CONTENT|CRO|GEO)-[A-Z]+-[0-9]{3}$/),
    ruleVersion: z.number().int().positive(),
    title: z.string().trim().min(1).max(500),
    severity: PriorityBand,
    reviewState: z.enum([
      "unreviewed",
      "confirmed",
      "ignored",
      "needs_more_data",
    ]),
    /** Exact optimistic-concurrency token required by canonical Finding review. */
    reviewRevision: z.number().int().nonnegative(),
    active: z.boolean(),
    regressed: z.boolean(),
    evidenceIds: uniqueUuidArray(200).min(1),
    targetRelation: GrowthMapFindingTargetRelation,
    executionPreview: ExecutionPreview.nullable(),
    executionRef: GrowthMapExecutionRef.nullable(),
  })
  .strict();
export type GrowthMapUrlFinding = z.infer<typeof GrowthMapUrlFinding>;

const GrowthMapUrlProjectionShape = {
  projectId: Uuid,
  siteId: Uuid,
  diagnosticRunId: Uuid,
  crawlSnapshotId: Uuid,
  sitePageId: Uuid,
  pageSnapshotId: Uuid.nullable(),
  pageSnapshotCapturedAt: IsoDateTime.nullable(),
  identitySources: z.array(GrowthMapUrlIdentitySource).min(1).max(100),
  normalizedUrl: z.string().trim().url().max(2048),
  title: NullableBoundedLabel,
  /**
   * Stable `page_type.v1` slug derived at read time from the frozen Crawl
   * page extract and the canonical path. It is null when no rule matched,
   * which means unclassified and never "not collected".
   */
  pageType: NullableBoundedLabel,
  templateKey: NullableBoundedLabel,
  clusterKey: NullableBoundedLabel,
  ownerId: Uuid.nullable(),
  coverage: GrowthMapCoverage,
  metricObservations: z.array(GrowthMapUrlMetricObservation).max(200),
  findingIds: UniqueFindingIds,
  reviewableFindingIds: UniqueFindingIds,
  priority: GrowthMapUrlPriority,
  delta: GrowthMapUrlDelta,
} as const;

const GrowthMapUrlPortfolioItemObject = z
  .object(GrowthMapUrlProjectionShape)
  .strict();
type GrowthMapUrlPortfolioItemValue = z.infer<
  typeof GrowthMapUrlPortfolioItemObject
>;

function addPriorityBasisIssues(
  item: GrowthMapUrlPortfolioItemValue,
  ctx: z.RefinementCtx,
): void {
  const projection = item.priority;
  if (projection.availability === "unavailable") return;
  const expected = {
    projectId: item.projectId,
    siteId: item.siteId,
    diagnosticRunId: item.diagnosticRunId,
    sitePageId: item.sitePageId,
  } as const;
  for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
    if (projection.basis[key] !== expected[key]) {
      ctx.addIssue({
        code: "custom",
        path: ["priority", "basis", key],
        message: `priority ${key} must match the selected URL`,
      });
    }
  }
  for (const findingId of projection.basis.findingIds) {
    if (!item.findingIds.includes(findingId)) {
      ctx.addIssue({
        code: "custom",
        path: ["priority", "basis", "findingIds"],
        message: "priority must be backed by a projected canonical Finding",
      });
    }
  }
}

function addDeltaBasisIssues(
  item: GrowthMapUrlPortfolioItemValue,
  ctx: z.RefinementCtx,
): void {
  const projection = item.delta;
  if (projection.availability === "unavailable") return;

  const current = projection.basis.current;
  const expected = {
    projectId: item.projectId,
    siteId: item.siteId,
    diagnosticRunId: item.diagnosticRunId,
    crawlSnapshotId: item.crawlSnapshotId,
    sitePageId: item.sitePageId,
    pageSnapshotId: item.pageSnapshotId,
  } as const;
  for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
    if (current[key] !== expected[key]) {
      ctx.addIssue({
        code: "custom",
        path: ["delta", "basis", "current", key],
        message: `delta current ${key} must match the selected URL`,
      });
    }
  }

  for (const findingId of projection.basis.findingIds) {
    if (!item.findingIds.includes(findingId)) {
      ctx.addIssue({
        code: "custom",
        path: ["delta", "basis", "findingIds"],
        message: "delta must be backed by a projected canonical Finding",
      });
    }
  }
}

function addUrlProjectionIssues(
  item: GrowthMapUrlPortfolioItemValue,
  ctx: z.RefinementCtx,
): void {
  if ((item.pageSnapshotId === null) !== (item.pageSnapshotCapturedAt === null)) {
    ctx.addIssue({
      code: "custom",
      path: ["pageSnapshotId"],
      message: "Page Snapshot identity and capture time must be present together",
    });
  }

  const identityKeys = new Set<string>();
  let matchingPageSnapshotSource = false;
  let urlObservationSourceCount = 0;
  item.identitySources.forEach((source, index) => {
    const key =
      source.kind === "page_snapshot"
        ? `${source.kind}:${source.pageSnapshotId}`
        : `${source.kind}:${source.observationId}`;
    if (identityKeys.has(key)) {
      ctx.addIssue({
        code: "custom",
        path: ["identitySources", index],
        message: "URL identity sources must be unique",
      });
    }
    identityKeys.add(key);

    if (source.kind === "page_snapshot") {
      if (
        source.pageSnapshotId === item.pageSnapshotId &&
        source.snapshotId === item.crawlSnapshotId &&
        source.observedAt === item.pageSnapshotCapturedAt
      ) {
        matchingPageSnapshotSource = true;
      }
    } else {
      urlObservationSourceCount += 1;
      if (source.sitePageId !== item.sitePageId) {
        ctx.addIssue({
          code: "custom",
          path: ["identitySources", index, "sitePageId"],
          message:
            "A URL Observation identity source must carry the selected SitePage lineage",
        });
      }
    }
  });

  if (item.pageSnapshotId === null) {
    if (urlObservationSourceCount === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["identitySources"],
        message: "A URL without a Crawl Page Snapshot requires URL Observation provenance",
      });
    }
    if (item.identitySources.some((source) => source.kind === "page_snapshot")) {
      ctx.addIssue({
        code: "custom",
        path: ["identitySources"],
        message: "A URL cannot cite a Page Snapshot while pageSnapshotId is unavailable",
      });
    }
  } else if (!matchingPageSnapshotSource) {
    ctx.addIssue({
      code: "custom",
      path: ["identitySources"],
      message: "The selected Crawl Page Snapshot must appear in URL identity provenance",
    });
  }

  for (const findingId of item.reviewableFindingIds) {
    if (!item.findingIds.includes(findingId)) {
      ctx.addIssue({
        code: "custom",
        path: ["reviewableFindingIds"],
        message: "A reviewable Finding must exist in findingIds",
      });
    }
  }

  const metricProjectionKeys = new Set<string>();
  item.metricObservations.forEach((observation, index) => {
    const projectionKey = `${observation.observationId}:${
      observation.valueSource.kind === "value_numeric"
        ? "value_numeric"
        : observation.valueSource.pointer
    }`;
    if (metricProjectionKeys.has(projectionKey)) {
      ctx.addIssue({
        code: "custom",
        path: ["metricObservations", index, "valueSource"],
        message: "A scalar metric projection must be unique within one URL",
      });
    }
    metricProjectionKeys.add(projectionKey);

    const hasCanonicalUrlRelation = item.identitySources.some(
      (source) =>
        source.kind === "url_observation" &&
        source.provider === observation.provider &&
        source.snapshotId === observation.snapshotId &&
        source.observationId === observation.observationId &&
        source.sitePageId === observation.sitePageId &&
        source.subjectRef === observation.subjectRef &&
        source.observedAt === observation.observedAt,
    );
    if (!hasCanonicalUrlRelation) {
      ctx.addIssue({
        code: "custom",
        path: ["metricObservations", index, "observationId"],
        message:
          "A metric Observation must have a matching canonical URL identity relation",
      });
    }
  });

  addPriorityBasisIssues(item, ctx);
  addDeltaBasisIssues(item, ctx);
}

export const GrowthMapUrlPortfolioItem =
  GrowthMapUrlPortfolioItemObject.superRefine(addUrlProjectionIssues);
export type GrowthMapUrlPortfolioItem = z.infer<
  typeof GrowthMapUrlPortfolioItem
>;

const PortfolioCount = z.number().int().min(0).max(2_000_000);

/**
 * Deterministic counts for the exact frozen generation this page was read from.
 *
 * These are not a synthesized project-wide total across generations: every
 * number is counted inside one immutable DiagnosticRun inventory under one
 * stated filter, the same way `totalRecommendationCount` and `totalEdgeCount`
 * already report bounded per-projection totals. Keeping them server-side is
 * what stops a client from re-deriving a page-local number (for example,
 * summing `findingIds` across the loaded rows) and presenting it as the
 * generation total.
 */
export const GrowthMapUrlPortfolioSummary = z
  .object({
    /** Canonical SitePages admitted by the frozen generation, filters ignored. */
    urlCount: PortfolioCount,
    /** Admitted SitePages carrying at least one active, non-ignored Finding. */
    opportunityUrlCount: PortfolioCount,
    /** Rows the current filtered list contains in total, across every page. */
    listedUrlCount: PortfolioCount,
    /** Distinct Findings reaching this generation's URL inventory, deduplicated. */
    signalCount: PortfolioCount,
    /** Opportunity URLs per derived priority band; sums to opportunityUrlCount. */
    priorityCounts: z
      .object({
        critical: PortfolioCount,
        high: PortfolioCount,
        medium: PortfolioCount,
        low: PortfolioCount,
      })
      .strict(),
    /** Listed rows before this page. Keyset paging has no offset to infer it. */
    precedingUrlCount: PortfolioCount,
  })
  .strict()
  .superRefine((summary, ctx) => {
    for (const key of ["opportunityUrlCount", "listedUrlCount"] as const) {
      if (summary[key] > summary.urlCount) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} cannot exceed the frozen generation URL count`,
        });
      }
    }
    if (summary.precedingUrlCount > summary.listedUrlCount) {
      ctx.addIssue({
        code: "custom",
        path: ["precedingUrlCount"],
        message: "precedingUrlCount cannot exceed the filtered list length",
      });
    }
    const banded =
      summary.priorityCounts.critical +
      summary.priorityCounts.high +
      summary.priorityCounts.medium +
      summary.priorityCounts.low;
    if (banded !== summary.opportunityUrlCount) {
      ctx.addIssue({
        code: "custom",
        path: ["priorityCounts"],
        message: "priorityCounts must band every opportunity URL exactly once",
      });
    }
  });
export type GrowthMapUrlPortfolioSummary = z.infer<
  typeof GrowthMapUrlPortfolioSummary
>;

export const GrowthMapUrlPortfolioMeta = z
  .object({
    limit: z.number().int().min(1).max(100),
    nextCursor: Cursor.nullable(),
    hasNext: z.boolean(),
    coverage: GrowthMapCoverage,
    summary: GrowthMapUrlPortfolioSummary,
  })
  .strict()
  .superRefine((meta, ctx) => {
    if (meta.hasNext !== (meta.nextCursor !== null)) {
      ctx.addIssue({
        code: "custom",
        path: ["hasNext"],
        message: "hasNext must match nextCursor availability",
      });
    }
  });
export type GrowthMapUrlPortfolioMeta = z.infer<
  typeof GrowthMapUrlPortfolioMeta
>;

const GrowthMapUrlPortfolioResponseObject = z
  .object({
    projectId: Uuid,
    siteId: Uuid,
    diagnosticRunId: Uuid,
    crawlSnapshotId: Uuid,
    data: z.array(GrowthMapUrlPortfolioItem).max(100),
    meta: GrowthMapUrlPortfolioMeta,
  })
  .strict();

/**
 * A bounded project-scoped cursor page. It carries no cross-generation total:
 * `meta.summary` counts only inside the one frozen generation named by
 * `diagnosticRunId`, so a page and its summary can never describe different
 * inventories.
 */
export const GrowthMapUrlPortfolioResponse =
  GrowthMapUrlPortfolioResponseObject.superRefine((response, ctx) => {
    if (response.data.length > response.meta.limit) {
      ctx.addIssue({
        code: "custom",
        path: ["data"],
        message: "A portfolio page cannot exceed its declared limit",
      });
    }

    const summary = response.meta.summary;
    const throughThisPage = summary.precedingUrlCount + response.data.length;
    if (throughThisPage > summary.listedUrlCount) {
      ctx.addIssue({
        code: "custom",
        path: ["meta", "summary", "precedingUrlCount"],
        message:
          "Rows read through this page cannot exceed the filtered list length",
      });
    }
    if (!response.meta.hasNext && throughThisPage !== summary.listedUrlCount) {
      ctx.addIssue({
        code: "custom",
        path: ["meta", "summary", "listedUrlCount"],
        message:
          "The last page must complete the filtered list it reports a total for",
      });
    }

    const sitePageIds = new Set<string>();
    const pageSnapshotIds = new Set<string>();
    const normalizedUrls = new Set<string>();
    response.data.forEach((item, index) => {
      for (const key of [
        "projectId",
        "siteId",
        "diagnosticRunId",
        "crawlSnapshotId",
      ] as const) {
        if (item[key] !== response[key]) {
          ctx.addIssue({
            code: "custom",
            path: ["data", index, key],
            message: `Portfolio item ${key} must match the response scope`,
          });
        }
      }

      const uniqueIdentities = [
        [sitePageIds, item.sitePageId, "sitePageId"],
        [normalizedUrls, item.normalizedUrl, "normalizedUrl"],
        ...(item.pageSnapshotId === null
          ? []
          : [[pageSnapshotIds, item.pageSnapshotId, "pageSnapshotId"] as const]),
      ] as const;
      for (const [set, value, key] of uniqueIdentities) {
        if (set.has(value)) {
          ctx.addIssue({
            code: "custom",
            path: ["data", index, key],
            message: `Portfolio ${key} values must be unique`,
          });
        }
        set.add(value);
      }
    });
  });
export type GrowthMapUrlPortfolioResponse = z.infer<
  typeof GrowthMapUrlPortfolioResponse
>;

const GrowthMapUrlDetailObject = z
  .object({
    ...GrowthMapUrlProjectionShape,
    findings: z.array(GrowthMapUrlFinding).max(200),
  })
  .strict();

export const GrowthMapUrlDetail = GrowthMapUrlDetailObject.superRefine(
  (detail, ctx) => {
    addUrlProjectionIssues(detail, ctx);

    const findingIds = new Set<string>();
    const actionIds = new Set<string>();
    const artifactIds = new Set<string>();
    detail.findings.forEach((finding, index) => {
      if (findingIds.has(finding.findingId)) {
        ctx.addIssue({
          code: "custom",
          path: ["findings", index, "findingId"],
          message: "Finding IDs must be unique in selected URL detail",
        });
      }
      findingIds.add(finding.findingId);

      for (const key of ["projectId", "siteId", "diagnosticRunId"] as const) {
        if (finding[key] !== detail[key]) {
          ctx.addIssue({
            code: "custom",
            path: ["findings", index, key],
            message: `Finding ${key} must match the selected URL`,
          });
        }
      }
      if (finding.targetRelation.relation === "direct_url") {
        for (const key of ["sitePageId", "pageSnapshotId"] as const) {
          if (finding.targetRelation[key] === detail[key]) continue;
          ctx.addIssue({
            code: "custom",
            path: ["findings", index, "targetRelation", key],
            message: `Finding target ${key} must match the selected URL`,
          });
        }
      }
      if (
        finding.targetRelation.relation === "direct_url" &&
        finding.targetRelation.targetRef !== detail.normalizedUrl
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["findings", index, "targetRelation", "targetRef"],
          message: "A direct URL Finding must target the normalized URL",
        });
      }
      if (
        finding.targetRelation.relation === "affected_by_template" &&
        (detail.templateKey === null ||
          finding.targetRelation.targetRef !== detail.templateKey)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["findings", index, "targetRelation", "targetRef"],
          message: "A template Finding must target the selected URL's canonical template",
        });
      }
      if (finding.executionRef !== null) {
        if (actionIds.has(finding.executionRef.actionId)) {
          ctx.addIssue({
            code: "custom",
            path: ["findings", index, "executionRef", "actionId"],
            message: "A canonical Action cannot belong to multiple Findings",
          });
        }
        actionIds.add(finding.executionRef.actionId);
        finding.executionRef.artifactIds.forEach((artifactId, artifactIndex) => {
          if (artifactIds.has(artifactId)) {
            ctx.addIssue({
              code: "custom",
              path: [
                "findings",
                index,
                "executionRef",
                "artifactIds",
                artifactIndex,
              ],
              message: "A canonical Artifact cannot belong to multiple Actions",
            });
          }
          artifactIds.add(artifactId);
        });
      }
    });

    if (
      findingIds.size !== detail.findingIds.length ||
      detail.findingIds.some((findingId) => !findingIds.has(findingId))
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["findingIds"],
        message: "findingIds must exactly match selected URL Finding detail",
      });
    }
  },
);
export type GrowthMapUrlDetail = z.infer<typeof GrowthMapUrlDetail>;

const GrowthMapUrlDetailResponseObject = z
  .object({
    projectId: Uuid,
    siteId: Uuid,
    diagnosticRunId: Uuid,
    crawlSnapshotId: Uuid,
    data: GrowthMapUrlDetail,
  })
  .strict();

export const GrowthMapUrlDetailResponse =
  GrowthMapUrlDetailResponseObject.superRefine((response, ctx) => {
    for (const key of [
      "projectId",
      "siteId",
      "diagnosticRunId",
      "crawlSnapshotId",
    ] as const) {
      if (response.data[key] !== response[key]) {
        ctx.addIssue({
          code: "custom",
          path: ["data", key],
          message: `Selected URL ${key} must match the response scope`,
        });
      }
    }
  });
export type GrowthMapUrlDetailResponse = z.infer<
  typeof GrowthMapUrlDetailResponse
>;

/**
 * Keyword and Competitor libraries are governed read models. They deliberately
 * expose source identity and honest absence, but never Finding confirmation or
 * Action state. A Library row can inform a canonical Finding; it is not itself
 * executable work.
 */

export const GrowthMapLibraryLanguageTag = Bcp47Locale.refine((value) => {
  try {
    const locale = new Intl.Locale(value);
    return locale.toString() === value;
  } catch {
    return false;
  }
}, "Must be a canonical BCP-47 language tag");
export type GrowthMapLibraryLanguageTag = z.infer<
  typeof GrowthMapLibraryLanguageTag
>;

/** Pointer into the normalized Observation payload, never a private provider response. */
export const GrowthMapCanonicalObservationValuePointer = JsonPointer.refine(
  (value) => value.startsWith("/valueJson/"),
  "Must point into the canonical normalized Observation valueJson payload",
);
export type GrowthMapCanonicalObservationValuePointer = z.infer<
  typeof GrowthMapCanonicalObservationValuePointer
>;

/**
 * Whole-library Keyword counts per intake source, computed in the same
 * read-only transaction as the page. A Keyword with occurrences from several
 * sources counts once per source, so per-source counts can sum past `all`.
 */
export const GrowthMapKeywordSourceCounts = z
  .object({
    all: z.number().int().min(0),
    csv_import: z.number().int().min(0),
    dataforseo_ranked: z.number().int().min(0),
    gsc_top_query: z.number().int().min(0),
    interview_summary: z.number().int().min(0),
    user_review: z.number().int().min(0),
    manual: z.number().int().min(0),
  })
  .strict();
export type GrowthMapKeywordSourceCounts = z.infer<
  typeof GrowthMapKeywordSourceCounts
>;

const GrowthMapLibraryPageMetaShape = {
  limit: z.number().int().min(1).max(100),
  nextCursor: Cursor.nullable(),
  hasNext: z.boolean(),
  coverage: GrowthMapCoverage,
} as const;

function assertCursorAvailabilityConsistency(
  meta: { readonly hasNext: boolean; readonly nextCursor: string | null },
  ctx: z.RefinementCtx,
): void {
  if (meta.hasNext !== (meta.nextCursor !== null)) {
    ctx.addIssue({
      code: "custom",
      path: ["hasNext"],
      message: "hasNext must match nextCursor availability",
    });
  }
}

export const GrowthMapLibraryPageMeta = z
  .object(GrowthMapLibraryPageMetaShape)
  .strict()
  .superRefine(assertCursorAvailabilityConsistency);
export type GrowthMapLibraryPageMeta = z.infer<
  typeof GrowthMapLibraryPageMeta
>;

/** Keyword Library meta: whole-library counts, null on pinned frozen reads. */
export const GrowthMapKeywordLibraryPageMeta = z
  .object({
    ...GrowthMapLibraryPageMetaShape,
    sourceCounts: GrowthMapKeywordSourceCounts.nullable(),
  })
  .strict()
  .superRefine(assertCursorAvailabilityConsistency);
export type GrowthMapKeywordLibraryPageMeta = z.infer<
  typeof GrowthMapKeywordLibraryPageMeta
>;

export const GrowthMapKeywordQueryKind = z.enum([
  "search_query",
  "generative_query",
]);
export type GrowthMapKeywordQueryKind = z.infer<
  typeof GrowthMapKeywordQueryKind
>;

export const GrowthMapKeywordStatus = z.enum([
  "candidate",
  "approved",
  "excluded",
  "parked",
]);
export type GrowthMapKeywordStatus = z.infer<typeof GrowthMapKeywordStatus>;

/**
 * WHICH authority produced the keyword's currently effective governance
 * decision, mirroring `keyword_review_decisions.decision_origin` exactly.
 *
 * This exists because `status` and `mappedTarget.reviewState` alone cannot
 * distinguish an operator's review from an automated approval: automated
 * keyword governance writes the very same `approved` + `confirmed` pair the
 * diagnostic freeze requires. Rendering both as "confirmed" would present a
 * keyword no human has read as human-reviewed, which the evidence-honesty
 * boundary forbids. A reader MUST label `system_suggestion` distinctly from
 * `user`.
 *
 * `null` does not mean "unknown": it means the append-only Decision ledger
 * holds no decision at the exact revision this projection reports.
 */
export const GrowthMapKeywordReviewOrigin = z.enum([
  "user",
  "system_suggestion",
  "migration_baseline",
]);
export type GrowthMapKeywordReviewOrigin = z.infer<
  typeof GrowthMapKeywordReviewOrigin
>;

export const GrowthMapKeywordMappingReviewState = z.enum([
  "unreviewed",
  "approved",
  "rejected",
]);
export type GrowthMapKeywordMappingReviewState = z.infer<
  typeof GrowthMapKeywordMappingReviewState
>;

const KeywordMappingGovernanceShape = {
  reviewState: GrowthMapKeywordMappingReviewState,
  revision: z.number().int().nonnegative(),
  reason: NullableLimitation,
} as const;

export const GrowthMapKeywordMappedTarget = z.discriminatedUnion("kind", [
  z
    .object({
      ...KeywordMappingGovernanceShape,
      kind: z.literal("unassigned"),
    })
    .strict(),
  z
    .object({
      ...KeywordMappingGovernanceShape,
      kind: z.literal("existing_page"),
      sitePageId: Uuid,
      normalizedUrl: z.string().trim().url().max(2048),
    })
    .strict(),
  z
    .object({
      ...KeywordMappingGovernanceShape,
      kind: z.literal("new_asset"),
    })
    .strict(),
]);
export type GrowthMapKeywordMappedTarget = z.infer<
  typeof GrowthMapKeywordMappedTarget
>;

export const GrowthMapKeywordScopeBasis = z.enum([
  "provider_collection_scope",
  "user_provided",
  "project_context",
  "manual",
]);
export type GrowthMapKeywordScopeBasis = z.infer<
  typeof GrowthMapKeywordScopeBasis
>;

const KeywordSourceOccurrenceCommonShape = {
  occurrenceId: Uuid,
  collectedAt: IsoDateTime,
  providerDataAsOf: IsoDateTime.nullable(),
  freshness: SourceFreshness,
  limitation: NullableLimitation,
  scopeBasis: GrowthMapKeywordScopeBasis,
  scopeLimitation: NullableLimitation,
  marketCode: MarketCode,
  languageTag: GrowthMapLibraryLanguageTag,
} as const;

export const GrowthMapKeywordSourceKind = z.enum([
  "csv_import",
  "dataforseo_ranked",
  "gsc_top_query",
  "interview_summary",
  "user_review",
  "manual",
]);
export type GrowthMapKeywordSourceKind = z.infer<
  typeof GrowthMapKeywordSourceKind
>;

const GrowthMapKeywordSourceOccurrenceObject = z.discriminatedUnion(
  "sourceKind",
  [
    z
      .object({
        ...KeywordSourceOccurrenceCommonShape,
        sourceKind: z.literal("csv_import"),
        snapshotId: Uuid,
        sourceObservationId: Uuid,
        sourcePointer: z.literal("/valueJson/keyword"),
        scopeBasis: z.literal("user_provided"),
        importPreviewId: Uuid,
      })
      .strict(),
    z
      .object({
        ...KeywordSourceOccurrenceCommonShape,
        sourceKind: z.literal("dataforseo_ranked"),
        snapshotId: Uuid,
        sourceObservationId: Uuid,
        sourcePointer: z.literal("/valueJson/keyword"),
        providerDataAsOf: z.null(),
        freshness: z.literal("unknown"),
        scopeBasis: z.literal("provider_collection_scope"),
      })
      .strict(),
    z
      .object({
        ...KeywordSourceOccurrenceCommonShape,
        sourceKind: z.literal("gsc_top_query"),
        snapshotId: Uuid,
        sourceObservationId: Uuid,
        sourcePointer: z
          .string()
          .regex(/^\/valueJson\/topQueries\/[0-9]+\/query$/),
        scopeBasis: z.literal("project_context"),
        scopeLimitation: BoundedText,
      })
      .strict(),
    z
      .object({
        ...KeywordSourceOccurrenceCommonShape,
        sourceKind: z.literal("interview_summary"),
        collectionRunId: Uuid,
        snapshotId: Uuid,
        sourceObservationId: Uuid,
        sourcePointer: z.literal("/valueJson/keyword"),
        scopeBasis: z.literal("user_provided"),
        scopeLimitation: BoundedText,
        evidenceLabel: KeywordEvidenceLabel,
        sourceRecordHash: KeywordEvidenceRecordHash,
      })
      .strict(),
    z
      .object({
        ...KeywordSourceOccurrenceCommonShape,
        sourceKind: z.literal("user_review"),
        collectionRunId: Uuid,
        snapshotId: Uuid,
        sourceObservationId: Uuid,
        sourcePointer: z.literal("/valueJson/keyword"),
        scopeBasis: z.literal("provider_collection_scope"),
        scopeLimitation: BoundedText,
        evidenceLabel: KeywordEvidenceLabel,
        sourceRecordHash: KeywordEvidenceRecordHash,
        reviewPlatform: z.enum([
          "app_store",
          "g2",
          "capterra",
          "other",
        ]),
        sourceUrl: KeywordEvidenceHttpsUrl.nullable(),
      })
      .strict(),
    z
      .object({
        ...KeywordSourceOccurrenceCommonShape,
        sourceKind: z.literal("manual"),
        snapshotId: z.null(),
        sourceObservationId: z.null(),
        sourcePointer: z.null(),
        providerDataAsOf: z.null(),
        freshness: z.literal("unknown"),
        scopeBasis: z.literal("manual"),
      })
      .strict(),
  ],
);

export const GrowthMapKeywordSourceOccurrence =
  GrowthMapKeywordSourceOccurrenceObject.superRefine((occurrence, ctx) => {
    if (
      occurrence.freshness !== "current" &&
      occurrence.limitation === null
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["limitation"],
        message: "Stale or unknown source freshness requires a limitation",
      });
    }
    if (occurrence.providerDataAsOf === null) {
      if (occurrence.freshness !== "unknown") {
        ctx.addIssue({
          code: "custom",
          path: ["freshness"],
          message:
            "A source without a provider data-as-of time has unknown freshness",
        });
      }
      if (occurrence.limitation === null) {
        ctx.addIssue({
          code: "custom",
          path: ["limitation"],
          message:
            "A missing provider data-as-of time requires an explicit limitation",
        });
      }
    }
    if (
      occurrence.providerDataAsOf !== null &&
      Date.parse(occurrence.providerDataAsOf) > Date.parse(occurrence.collectedAt)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["providerDataAsOf"],
        message: "Provider data-as-of time cannot be after collection time",
      });
    }
  });
export type GrowthMapKeywordSourceOccurrence = z.infer<
  typeof GrowthMapKeywordSourceOccurrence
>;

const KeywordMetricLineageShape = {
  snapshotId: Uuid,
  observationId: Uuid,
  valuePointer: GrowthMapCanonicalObservationValuePointer,
  observedAt: IsoDateTime,
  freshness: SourceFreshness,
  limitation: NullableLimitation,
} as const;

function addKeywordMetricAbsenceIssues(
  projection: {
    value: number | string | null;
    freshness: z.infer<typeof SourceFreshness>;
    limitation: string | null;
  },
  ctx: z.RefinementCtx,
): void {
  if (projection.value === null && projection.limitation === null) {
    ctx.addIssue({
      code: "custom",
      path: ["limitation"],
      message: "A null metric value requires an explicit limitation",
    });
  }
  if (projection.freshness !== "current" && projection.limitation === null) {
    ctx.addIssue({
      code: "custom",
      path: ["limitation"],
      message: "Stale or unknown metric freshness requires a limitation",
    });
  }
}

export const GrowthMapKeywordNumericMetric = z
  .object({
    ...KeywordMetricLineageShape,
    value: z.number().finite().nullable(),
  })
  .strict()
  .superRefine(addKeywordMetricAbsenceIssues);
export type GrowthMapKeywordNumericMetric = z.infer<
  typeof GrowthMapKeywordNumericMetric
>;

export const GrowthMapKeywordTextMetric = z
  .object({
    ...KeywordMetricLineageShape,
    value: BoundedLabel.nullable(),
  })
  .strict()
  .superRefine(addKeywordMetricAbsenceIssues);
export type GrowthMapKeywordTextMetric = z.infer<
  typeof GrowthMapKeywordTextMetric
>;

const KeywordMetricLimitations = z
  .object({
    volume: NullableLimitation,
    kd: NullableLimitation,
    currentRank: NullableLimitation,
    currentUrl: NullableLimitation,
    competitorDomain: NullableLimitation,
    competitorRank: NullableLimitation,
  })
  .strict();

const GrowthMapKeywordMetricsObject = z
  .object({
    volume: GrowthMapKeywordNumericMetric.nullable(),
    kd: GrowthMapKeywordNumericMetric.nullable(),
    currentRank: GrowthMapKeywordNumericMetric.nullable(),
    currentUrl: GrowthMapKeywordTextMetric.nullable(),
    competitorDomain: GrowthMapKeywordTextMetric.nullable(),
    competitorRank: GrowthMapKeywordNumericMetric.nullable(),
    limitations: KeywordMetricLimitations,
  })
  .strict();

export const GrowthMapKeywordMetrics =
  GrowthMapKeywordMetricsObject.superRefine((metrics, ctx) => {
    const fields = [
      "volume",
      "kd",
      "currentRank",
      "currentUrl",
      "competitorDomain",
      "competitorRank",
    ] as const;
    const projections = new Set<string>();
    const expectedPointers = {
      volume: "/valueJson/searchVolume",
      kd: "/valueJson/keywordDifficulty",
      currentRank: "/valueJson/currentRank",
      currentUrl: "/valueJson/currentUrl",
      competitorDomain: "/valueJson/competitorDomain",
      competitorRank: "/valueJson/competitorRank",
    } as const;
    for (const field of fields) {
      const projection = metrics[field];
      if (projection === null) {
        if (metrics.limitations[field] === null) {
          ctx.addIssue({
            code: "custom",
            path: ["limitations", field],
            message: `A missing ${field} projection requires a limitation`,
          });
        }
        continue;
      }
      if (projection.valuePointer !== expectedPointers[field]) {
        ctx.addIssue({
          code: "custom",
          path: [field, "valuePointer"],
          message: `${field} must use its canonical normalized Observation pointer`,
        });
      }
      const key = `${projection.observationId}:${projection.valuePointer}`;
      if (projections.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: [field, "valuePointer"],
          message: "Metric Observation value pointers must be unique",
        });
      }
      projections.add(key);
    }

    if (metrics.volume?.value !== null && metrics.volume?.value !== undefined) {
      if (metrics.volume.value < 0) {
        ctx.addIssue({
          code: "custom",
          path: ["volume", "value"],
          message: "Keyword volume cannot be negative",
        });
      }
    }
    if (metrics.kd?.value !== null && metrics.kd?.value !== undefined) {
      if (metrics.kd.value < 0 || metrics.kd.value > 100) {
        ctx.addIssue({
          code: "custom",
          path: ["kd", "value"],
          message: "Keyword difficulty must be between 0 and 100",
        });
      }
    }
    for (const field of ["currentRank", "competitorRank"] as const) {
      const value = metrics[field]?.value;
      if (value !== null && value !== undefined && value <= 0) {
        ctx.addIssue({
          code: "custom",
          path: [field, "value"],
          message: `${field} must be positive when observed`,
        });
      }
    }
    if (
      metrics.currentUrl?.value !== null &&
      metrics.currentUrl?.value !== undefined
    ) {
      const result = z.string().url().max(2048).safeParse(metrics.currentUrl.value);
      if (!result.success) {
        ctx.addIssue({
          code: "custom",
          path: ["currentUrl", "value"],
          message: "Current URL must be an absolute URL",
        });
      }
    }
    if (
      metrics.competitorDomain?.value !== null &&
      metrics.competitorDomain?.value !== undefined &&
      !ProductProfileCompetitorDomain.safeParse(metrics.competitorDomain.value)
        .success
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["competitorDomain", "value"],
        message: "Competitor domain must be a normalized lowercase hostname",
      });
    }
  });
export type GrowthMapKeywordMetrics = z.infer<
  typeof GrowthMapKeywordMetrics
>;

export const GrowthMapKeywordClusterRef = z
  .object({
    clusterId: Uuid,
    name: BoundedLabel,
  })
  .strict();
export type GrowthMapKeywordClusterRef = z.infer<
  typeof GrowthMapKeywordClusterRef
>;

const GrowthMapKeywordClassificationLimitations = z
  .object({
    intent: NullableLimitation,
    buyerStage: NullableLimitation,
    cluster: NullableLimitation,
  })
  .strict();

function normalizedKeywordValue(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function keywordSourceIdentity(
  occurrence: z.infer<typeof GrowthMapKeywordSourceOccurrenceObject>,
): string {
  switch (occurrence.sourceKind) {
    case "csv_import":
      return `${occurrence.sourceKind}:${occurrence.importPreviewId}:${occurrence.snapshotId}:${occurrence.sourceObservationId}:${occurrence.sourcePointer}`;
    case "dataforseo_ranked":
      return `${occurrence.sourceKind}:${occurrence.snapshotId}:${occurrence.sourceObservationId}:${occurrence.sourcePointer}`;
    case "gsc_top_query":
      return `${occurrence.sourceKind}:${occurrence.snapshotId}:${occurrence.sourceObservationId}:${occurrence.sourcePointer}`;
    case "interview_summary":
      return `${occurrence.sourceKind}:${occurrence.collectionRunId}:${occurrence.snapshotId}:${occurrence.sourceObservationId}:${occurrence.sourcePointer}:${occurrence.sourceRecordHash}`;
    case "user_review":
      return `${occurrence.sourceKind}:${occurrence.collectionRunId}:${occurrence.snapshotId}:${occurrence.sourceObservationId}:${occurrence.sourcePointer}:${occurrence.sourceRecordHash}`;
    case "manual":
      return `${occurrence.sourceKind}:${occurrence.occurrenceId}`;
  }
}

const GrowthMapKeywordLibraryItemObject = z
  .object({
    projectId: Uuid,
    keywordId: Uuid,
    displayKeyword: BoundedLabel,
    normalizedKeyword: BoundedLabel,
    marketCode: MarketCode,
    languageTag: GrowthMapLibraryLanguageTag,
    queryKind: GrowthMapKeywordQueryKind,
    status: GrowthMapKeywordStatus,
    reviewOrigin: GrowthMapKeywordReviewOrigin.nullable(),
    revision: z.number().int().nonnegative(),
    intent: BoundedLabel.nullable(),
    buyerStage: BoundedLabel.nullable(),
    cluster: GrowthMapKeywordClusterRef.nullable(),
    classificationLimitations: GrowthMapKeywordClassificationLimitations,
    mappedTarget: GrowthMapKeywordMappedTarget,
    sourceOccurrences: z
      .array(GrowthMapKeywordSourceOccurrence)
      .min(1)
      .max(100),
    metrics: GrowthMapKeywordMetrics,
    coverage: GrowthMapCoverage,
  })
  .strict();

export const GrowthMapKeywordLibraryItem =
  GrowthMapKeywordLibraryItemObject.superRefine((item, ctx) => {
    if (item.normalizedKeyword !== normalizedKeywordValue(item.displayKeyword)) {
      ctx.addIssue({
        code: "custom",
        path: ["normalizedKeyword"],
        message:
          "normalizedKeyword must be the NFKC, lowercase, single-space display keyword",
      });
    }

    for (const field of ["intent", "buyerStage", "cluster"] as const) {
      if (item[field] === null && item.classificationLimitations[field] === null) {
        ctx.addIssue({
          code: "custom",
          path: ["classificationLimitations", field],
          message: `Unknown ${field} requires an explicit limitation`,
        });
      }
    }

    const occurrenceIds = new Set<string>();
    const sourceIdentities = new Set<string>();
    item.sourceOccurrences.forEach((occurrence, index) => {
      if (occurrenceIds.has(occurrence.occurrenceId)) {
        ctx.addIssue({
          code: "custom",
          path: ["sourceOccurrences", index, "occurrenceId"],
          message: "Keyword source occurrence IDs must be unique",
        });
      }
      occurrenceIds.add(occurrence.occurrenceId);

      const sourceIdentity = keywordSourceIdentity(occurrence);
      if (sourceIdentities.has(sourceIdentity)) {
        ctx.addIssue({
          code: "custom",
          path: ["sourceOccurrences", index],
          message: "Exact Keyword source occurrences must be unique",
        });
      }
      sourceIdentities.add(sourceIdentity);

      if (occurrence.marketCode !== item.marketCode) {
        ctx.addIssue({
          code: "custom",
          path: ["sourceOccurrences", index, "marketCode"],
          message: "Keyword occurrence market must match the Library identity",
        });
      }
      if (occurrence.languageTag !== item.languageTag) {
        ctx.addIssue({
          code: "custom",
          path: ["sourceOccurrences", index, "languageTag"],
          message: "Keyword occurrence language must match the Library identity",
        });
      }
    });

    for (const field of [
      "volume",
      "kd",
      "currentRank",
      "currentUrl",
      "competitorDomain",
      "competitorRank",
    ] as const) {
      const metric = item.metrics[field];
      if (metric === null) continue;
      const hasCanonicalOccurrence = item.sourceOccurrences.some(
        (occurrence) =>
          occurrence.snapshotId === metric.snapshotId &&
          occurrence.sourceObservationId === metric.observationId,
      );
      if (!hasCanonicalOccurrence) {
        ctx.addIssue({
          code: "custom",
          path: ["metrics", field, "observationId"],
          message:
            "A Keyword metric must reference one exact source occurrence Observation",
        });
      }
    }
  });
export type GrowthMapKeywordLibraryItem = z.infer<
  typeof GrowthMapKeywordLibraryItem
>;

const GrowthMapKeywordLibraryResponseObject = z
  .object({
    projectId: Uuid,
    data: z.array(GrowthMapKeywordLibraryItem).max(100),
    meta: GrowthMapKeywordLibraryPageMeta,
  })
  .strict();

export const GrowthMapKeywordLibraryResponse =
  GrowthMapKeywordLibraryResponseObject.superRefine((response, ctx) => {
    if (response.data.length > response.meta.limit) {
      ctx.addIssue({
        code: "custom",
        path: ["data"],
        message: "A Keyword Library page cannot exceed its declared limit",
      });
    }
    const keywordIds = new Set<string>();
    const identities = new Set<string>();
    const occurrenceIds = new Set<string>();
    const sourceIdentities = new Set<string>();
    response.data.forEach((item, index) => {
      if (item.projectId !== response.projectId) {
        ctx.addIssue({
          code: "custom",
          path: ["data", index, "projectId"],
          message: "Keyword projectId must match the response scope",
        });
      }
      if (keywordIds.has(item.keywordId)) {
        ctx.addIssue({
          code: "custom",
          path: ["data", index, "keywordId"],
          message: "Keyword IDs must be unique within a cursor page",
        });
      }
      keywordIds.add(item.keywordId);

      const identity = `${item.normalizedKeyword}:${item.marketCode}:${item.languageTag}:${item.queryKind}`;
      if (identities.has(identity)) {
        ctx.addIssue({
          code: "custom",
          path: ["data", index, "normalizedKeyword"],
          message: "Stable Keyword identities must be unique within a project",
        });
      }
      identities.add(identity);

      item.sourceOccurrences.forEach((occurrence, occurrenceIndex) => {
        if (occurrenceIds.has(occurrence.occurrenceId)) {
          ctx.addIssue({
            code: "custom",
            path: [
              "data",
              index,
              "sourceOccurrences",
              occurrenceIndex,
              "occurrenceId",
            ],
            message: "A source occurrence cannot belong to multiple Keywords",
          });
        }
        occurrenceIds.add(occurrence.occurrenceId);
        const sourceIdentity = keywordSourceIdentity(occurrence);
        if (sourceIdentities.has(sourceIdentity)) {
          ctx.addIssue({
            code: "custom",
            path: ["data", index, "sourceOccurrences", occurrenceIndex],
            message:
              "An exact source occurrence cannot populate multiple Keywords",
          });
        }
        sourceIdentities.add(sourceIdentity);
      });
    });
  });
export type GrowthMapKeywordLibraryResponse = z.infer<
  typeof GrowthMapKeywordLibraryResponse
>;

const GrowthMapKeywordDetailResponseObject = z
  .object({
    projectId: Uuid,
    data: GrowthMapKeywordLibraryItem,
  })
  .strict();

export const GrowthMapKeywordDetailResponse =
  GrowthMapKeywordDetailResponseObject.superRefine((response, ctx) => {
    if (response.data.projectId !== response.projectId) {
      ctx.addIssue({
        code: "custom",
        path: ["data", "projectId"],
        message: "Keyword projectId must match the detail response scope",
      });
    }
  });
export type GrowthMapKeywordDetailResponse = z.infer<
  typeof GrowthMapKeywordDetailResponse
>;

export const GrowthMapKeywordRankMetric = z.enum([
  "absolute_rank",
  "gsc_28d_average_position",
]);
export type GrowthMapKeywordRankMetric = z.infer<
  typeof GrowthMapKeywordRankMetric
>;

export const GrowthMapKeywordRankProvider = z.enum([
  "dataforseo",
  "gsc",
]);
export type GrowthMapKeywordRankProvider = z.infer<
  typeof GrowthMapKeywordRankProvider
>;

export const GrowthMapKeywordRankPoint = z
  .object({
    occurrenceId: Uuid,
    snapshotId: Uuid,
    observationId: Uuid,
    provider: GrowthMapKeywordRankProvider,
    metric: GrowthMapKeywordRankMetric,
    value: z.number().finite().positive(),
    valuePointer: GrowthMapCanonicalObservationValuePointer,
    observedAt: IsoDateTime,
    providerDataAsOf: IsoDateTime.nullable(),
    grade: z.enum(["A", "B"]),
    limitation: BoundedText,
  })
  .strict()
  .superRefine((point, ctx) => {
    const expected =
      point.provider === "dataforseo"
        ? {
            metric: "absolute_rank",
            grade: "B",
            pointer: "/valueJson/currentRank",
          }
        : {
            metric: "gsc_28d_average_position",
            grade: "A",
            pointer: /^\/valueJson\/topQueries\/[0-9]+\/position$/u,
          };
    if (point.metric !== expected.metric) {
      ctx.addIssue({
        code: "custom",
        path: ["metric"],
        message: "Rank metric must match its canonical provider definition",
      });
    }
    if (point.grade !== expected.grade) {
      ctx.addIssue({
        code: "custom",
        path: ["grade"],
        message: "Rank evidence grade must match its canonical provider",
      });
    }
    const pointerMatches =
      typeof expected.pointer === "string"
        ? point.valuePointer === expected.pointer
        : expected.pointer.test(point.valuePointer);
    if (!pointerMatches) {
      ctx.addIssue({
        code: "custom",
        path: ["valuePointer"],
        message: "Rank point must use its canonical Observation value pointer",
      });
    }
    if (
      point.providerDataAsOf !== null &&
      Date.parse(point.providerDataAsOf) > Date.parse(point.observedAt)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["providerDataAsOf"],
        message: "Provider data-as-of time cannot follow observation time",
      });
    }
  });
export type GrowthMapKeywordRankPoint = z.infer<
  typeof GrowthMapKeywordRankPoint
>;

export const GrowthMapKeywordRankSeries = z
  .object({
    provider: GrowthMapKeywordRankProvider,
    metric: GrowthMapKeywordRankMetric,
    points: z.array(GrowthMapKeywordRankPoint).min(1).max(500),
    interpretation: BoundedText,
  })
  .strict()
  .superRefine((series, ctx) => {
    const identities = new Set<string>();
    let previous = Number.NEGATIVE_INFINITY;
    series.points.forEach((point, index) => {
      if (
        point.provider !== series.provider ||
        point.metric !== series.metric
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["points", index],
          message: "Every rank point must match its containing series",
        });
      }
      const observedAt = Date.parse(point.observedAt);
      if (observedAt < previous) {
        ctx.addIssue({
          code: "custom",
          path: ["points", index, "observedAt"],
          message: "Rank points must be ordered from oldest to newest",
        });
      }
      previous = observedAt;
      const identity = `${point.observationId}:${point.valuePointer}`;
      if (identities.has(identity)) {
        ctx.addIssue({
          code: "custom",
          path: ["points", index, "observationId"],
          message: "Rank Observation value pointers must be unique",
        });
      }
      identities.add(identity);
    });
  });
export type GrowthMapKeywordRankSeries = z.infer<
  typeof GrowthMapKeywordRankSeries
>;

export const GrowthMapKeywordContentChangeMarker = z
  .object({
    changeReceiptId: Uuid,
    publicationAttemptId: Uuid,
    attemptKind: z.enum(["publish", "rollback"]),
    artifactId: Uuid,
    artifactRevision: z.number().int().positive(),
    targetRef: z.string().trim().min(1).max(2048),
    liveCanonicalUrl: z.string().trim().url().max(2048),
    changedAt: IsoDateTime,
  })
  .strict();
export type GrowthMapKeywordContentChangeMarker = z.infer<
  typeof GrowthMapKeywordContentChangeMarker
>;

const GrowthMapKeywordRankWindow = z
  .object({
    startedAt: IsoDateTime,
    endedAt: IsoDateTime,
    days: z.literal(90),
  })
  .strict()
  .superRefine((window, ctx) => {
    const expectedStart = Date.parse(window.endedAt) - 90 * 24 * 60 * 60 * 1000;
    if (Date.parse(window.startedAt) !== expectedStart) {
      ctx.addIssue({
        code: "custom",
        path: ["startedAt"],
        message: "Rank history is one exact trailing 90-day UTC window",
      });
    }
  });

export const GrowthMapKeywordRankHistory = z
  .object({
    projectId: Uuid,
    keywordId: Uuid,
    mappedPage: z
      .object({
        sitePageId: Uuid,
        normalizedUrl: z.string().trim().url().max(2048),
      })
      .strict()
      .nullable(),
    window: GrowthMapKeywordRankWindow,
    series: z.array(GrowthMapKeywordRankSeries).max(2),
    changeMarkers: z
      .array(GrowthMapKeywordContentChangeMarker)
      .max(200),
    coverage: GrowthMapCoverage,
    generatedAt: IsoDateTime,
  })
  .strict()
  .superRefine((history, ctx) => {
    const windowStart = Date.parse(history.window.startedAt);
    const windowEnd = Date.parse(history.window.endedAt);
    const seriesIdentities = new Set<string>();
    history.series.forEach((series, seriesIndex) => {
      const identity = `${series.provider}:${series.metric}`;
      if (seriesIdentities.has(identity)) {
        ctx.addIssue({
          code: "custom",
          path: ["series", seriesIndex],
          message: "Rank series identities must be unique",
        });
      }
      seriesIdentities.add(identity);
      series.points.forEach((point, pointIndex) => {
        const observedAt = Date.parse(point.observedAt);
        if (observedAt < windowStart || observedAt > windowEnd) {
          ctx.addIssue({
            code: "custom",
            path: ["series", seriesIndex, "points", pointIndex, "observedAt"],
            message: "Rank points must remain inside the declared window",
          });
        }
      });
    });

    const receiptIds = new Set<string>();
    let previousMarker = Number.NEGATIVE_INFINITY;
    history.changeMarkers.forEach((marker, index) => {
      const changedAt = Date.parse(marker.changedAt);
      if (changedAt < windowStart || changedAt > windowEnd) {
        ctx.addIssue({
          code: "custom",
          path: ["changeMarkers", index, "changedAt"],
          message: "Content changes must remain inside the declared window",
        });
      }
      if (changedAt < previousMarker) {
        ctx.addIssue({
          code: "custom",
          path: ["changeMarkers", index, "changedAt"],
          message: "Content changes must be ordered from oldest to newest",
        });
      }
      previousMarker = changedAt;
      if (receiptIds.has(marker.changeReceiptId)) {
        ctx.addIssue({
          code: "custom",
          path: ["changeMarkers", index, "changeReceiptId"],
          message: "Change Receipt markers must be unique",
        });
      }
      receiptIds.add(marker.changeReceiptId);
    });
    if (history.mappedPage === null && history.changeMarkers.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["changeMarkers"],
        message: "Content change markers require one canonical mapped page",
      });
    }
    if (history.series.length === 0 && history.coverage.availability !== "unavailable") {
      ctx.addIssue({
        code: "custom",
        path: ["coverage", "availability"],
        message: "Missing rank series must be reported as unavailable",
      });
    }
    if (Date.parse(history.generatedAt) < windowEnd) {
      ctx.addIssue({
        code: "custom",
        path: ["generatedAt"],
        message: "Rank history cannot be generated before its window closes",
      });
    }
  });
export type GrowthMapKeywordRankHistory = z.infer<
  typeof GrowthMapKeywordRankHistory
>;

export const GrowthMapCompetitorReviewStatus = z.enum([
  "candidate",
  "approved",
  "excluded",
]);
export type GrowthMapCompetitorReviewStatus = z.infer<
  typeof GrowthMapCompetitorReviewStatus
>;

export const GrowthMapCompetitorRelationship = z.enum([
  "direct",
  "indirect",
  "status_quo",
  "benchmark",
  "publisher",
]);
export type GrowthMapCompetitorRelationship = z.infer<
  typeof GrowthMapCompetitorRelationship
>;

const CompetitorOriginCommonShape = {
  occurrenceId: Uuid,
  observedAt: IsoDateTime.nullable(),
} as const;

export const GrowthMapCompetitorEvidenceRef = z
  .object({
    kind: z.literal("evidence"),
    evidenceId: Uuid,
  })
  .strict();
export type GrowthMapCompetitorEvidenceRef = z.infer<
  typeof GrowthMapCompetitorEvidenceRef
>;

const UniqueCompetitorEvidenceRefs = z
  .array(GrowthMapCompetitorEvidenceRef)
  .max(100)
  .refine(
    (refs) => isUnique(refs.map((ref) => ref.evidenceId)),
    "Canonical app Evidence refs must be unique",
  );

export const GrowthMapCompetitorProfileFieldProvenancePath =
  ProductProfileJsonPointer.refine(
    (path) => /^\/competitorCandidates(?:\/[0-9]+)?$/.test(path),
    "Must point to the competitorCandidates root or one candidate index",
  );
export type GrowthMapCompetitorProfileFieldProvenancePath = z.infer<
  typeof GrowthMapCompetitorProfileFieldProvenancePath
>;

function productProfileEvidenceIdentity(
  ref: z.infer<typeof ProductProfileEvidenceRef>,
): string {
  switch (ref.kind) {
    case "snapshot":
      return `${ref.kind}:${ref.snapshotId}`;
    case "pageSnapshot":
      return `${ref.kind}:${ref.pageSnapshotId}`;
    case "observation":
      return `${ref.kind}:${ref.observationId}`;
    case "analysisInvocation":
      return `${ref.kind}:${ref.analysisInvocationId}`;
    case "declaredHint":
    case "userEdit":
      return `${ref.kind}:${ref.evidenceRefId}`;
  }
}

const UniqueProductProfileEvidenceRefs = z
  .array(ProductProfileEvidenceRef)
  .max(50)
  .superRefine((refs, ctx) => {
    const evidenceRefIds = new Set<string>();
    const sourceIdentities = new Set<string>();
    refs.forEach((ref, index) => {
      if (evidenceRefIds.has(ref.evidenceRefId)) {
        ctx.addIssue({
          code: "custom",
          path: [index, "evidenceRefId"],
          message: "Product Profile evidenceRefId values must be unique",
        });
      }
      evidenceRefIds.add(ref.evidenceRefId);

      const identity = productProfileEvidenceIdentity(ref);
      if (sourceIdentities.has(identity)) {
        ctx.addIssue({
          code: "custom",
          path: [index],
          message: "Typed Product Profile evidence sources must be unique",
        });
      }
      sourceIdentities.add(identity);
    });
  });

export const GrowthMapCompetitorOriginKind = z.enum([
  "product_profile",
  "csv_keyword_gap",
  "manual",
  "serp_overlap",
  "ai_citation",
]);
export type GrowthMapCompetitorOriginKind = z.infer<
  typeof GrowthMapCompetitorOriginKind
>;

export const GrowthMapCompetitorOriginOccurrence = z.discriminatedUnion(
  "originKind",
  [
    z
      .object({
        ...CompetitorOriginCommonShape,
        originKind: z.literal("product_profile"),
        productProfileId: Uuid,
        profileVersion: z.number().int().positive(),
        candidateId: Uuid,
        fieldProvenancePath: GrowthMapCompetitorProfileFieldProvenancePath,
        evidenceRefs: UniqueProductProfileEvidenceRefs,
      })
      .strict(),
    z
      .object({
        ...CompetitorOriginCommonShape,
        originKind: z.literal("csv_keyword_gap"),
        snapshotId: Uuid,
        observationId: Uuid,
        sourcePointer: z.literal("/valueJson/competitorDomain"),
        importPreviewId: Uuid,
        evidenceRefs: UniqueCompetitorEvidenceRefs,
      })
      .strict(),
    z
      .object({
        ...CompetitorOriginCommonShape,
        originKind: z.literal("manual"),
        manualEntryId: Uuid,
        evidenceRefs: UniqueCompetitorEvidenceRefs,
      })
      .strict(),
    z
      .object({
        ...CompetitorOriginCommonShape,
        originKind: z.literal("serp_overlap"),
        snapshotId: Uuid,
        observationId: Uuid,
        evidenceRefs: UniqueCompetitorEvidenceRefs,
      })
      .strict(),
    z
      .object({
        ...CompetitorOriginCommonShape,
        originKind: z.literal("ai_citation"),
        snapshotId: Uuid,
        observationId: Uuid,
        evidenceRefs: UniqueCompetitorEvidenceRefs,
      })
      .strict(),
  ],
);
export type GrowthMapCompetitorOriginOccurrence = z.infer<
  typeof GrowthMapCompetitorOriginOccurrence
>;

const UnavailableCompetitorInsight = z
  .object({
    availability: z.literal("unavailable"),
    value: z.null(),
    limitation: BoundedText,
  })
  .strict();

const CompetitorInsightLineageShape = {
  snapshotId: Uuid,
  observationId: Uuid,
  valuePointer: GrowthMapCanonicalObservationValuePointer,
  observedAt: IsoDateTime,
  limitation: NullableLimitation,
} as const;

const AvailableCompetitorSerpOverlap = z
  .object({
    ...CompetitorInsightLineageShape,
    availability: z.literal("available"),
    value: z.number().finite().nonnegative(),
  })
  .strict();

export const GrowthMapCompetitorSerpOverlap = z.discriminatedUnion(
  "availability",
  [UnavailableCompetitorInsight, AvailableCompetitorSerpOverlap],
);
export type GrowthMapCompetitorSerpOverlap = z.infer<
  typeof GrowthMapCompetitorSerpOverlap
>;

const AvailableCompetitorAiCitationInsight = z
  .object({
    ...CompetitorInsightLineageShape,
    availability: z.literal("available"),
    value: BoundedText,
  })
  .strict();

export const GrowthMapCompetitorAiCitationInsight = z.discriminatedUnion(
  "availability",
  [UnavailableCompetitorInsight, AvailableCompetitorAiCitationInsight],
);
export type GrowthMapCompetitorAiCitationInsight = z.infer<
  typeof GrowthMapCompetitorAiCitationInsight
>;

function competitorOriginIdentity(
  origin: z.infer<typeof GrowthMapCompetitorOriginOccurrence>,
): string {
  switch (origin.originKind) {
    case "product_profile":
      return `${origin.originKind}:${origin.productProfileId}:${origin.profileVersion}:${origin.candidateId}:${origin.fieldProvenancePath}`;
    case "csv_keyword_gap":
      return `${origin.originKind}:${origin.importPreviewId}:${origin.snapshotId}:${origin.observationId}:${origin.sourcePointer}`;
    case "manual":
      return `${origin.originKind}:${origin.manualEntryId}`;
    case "serp_overlap":
    case "ai_citation":
      return `${origin.originKind}:${origin.snapshotId}:${origin.observationId}`;
  }
}

const GrowthMapCompetitorLibraryItemObject = z
  .object({
    projectId: Uuid,
    competitorId: Uuid,
    domain: ProductProfileCompetitorDomain,
    name: z.string().trim().min(1).max(160).nullable(),
    reviewStatus: GrowthMapCompetitorReviewStatus,
    relationship: GrowthMapCompetitorRelationship.nullable(),
    analysisScope: z
      .array(ProductProfileCompetitorAnalysisScope)
      .max(5)
      .refine(isUnique, "analysisScope must be unique"),
    revision: z.number().int().nonnegative(),
    originOccurrences: z
      .array(GrowthMapCompetitorOriginOccurrence)
      .min(1)
      .max(100),
    lastObservedAt: IsoDateTime.nullable(),
    serpOverlap: GrowthMapCompetitorSerpOverlap,
    aiCitationInsight: GrowthMapCompetitorAiCitationInsight,
    coverage: GrowthMapCoverage,
  })
  .strict();

export const GrowthMapCompetitorLibraryItem =
  GrowthMapCompetitorLibraryItemObject.superRefine((item, ctx) => {
    if (item.reviewStatus === "approved") {
      if (item.relationship === null) {
        ctx.addIssue({
          code: "custom",
          path: ["relationship"],
          message: "An approved Competitor requires a reviewed relationship",
        });
      }
      if (item.analysisScope.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["analysisScope"],
          message: "An approved Competitor requires a non-empty analysis scope",
        });
      }
    } else {
      if (item.relationship !== null) {
        ctx.addIssue({
          code: "custom",
          path: ["relationship"],
          message:
            "Candidate or excluded Competitors cannot expose an approved relationship",
        });
      }
      if (item.analysisScope.length !== 0) {
        ctx.addIssue({
          code: "custom",
          path: ["analysisScope"],
          message:
            "Candidate or excluded Competitors cannot enter an approved analysis scope",
        });
      }
    }

    const occurrenceIds = new Set<string>();
    const originIdentities = new Set<string>();
    item.originOccurrences.forEach((origin, index) => {
      if (occurrenceIds.has(origin.occurrenceId)) {
        ctx.addIssue({
          code: "custom",
          path: ["originOccurrences", index, "occurrenceId"],
          message: "Competitor origin occurrence IDs must be unique",
        });
      }
      occurrenceIds.add(origin.occurrenceId);

      const identity = competitorOriginIdentity(origin);
      if (originIdentities.has(identity)) {
        ctx.addIssue({
          code: "custom",
          path: ["originOccurrences", index],
          message: "Exact Competitor origin occurrences must be unique",
        });
      }
      originIdentities.add(identity);
    });

    const observedTimes = item.originOccurrences
      .map((origin) => origin.observedAt)
      .filter((value): value is string => value !== null)
      .sort((left, right) => Date.parse(right) - Date.parse(left));
    const expectedLastObservedAt = observedTimes[0] ?? null;
    if (item.lastObservedAt !== expectedLastObservedAt) {
      ctx.addIssue({
        code: "custom",
        path: ["lastObservedAt"],
        message:
          "lastObservedAt must equal the latest traceable origin observation",
      });
    }

    if (item.serpOverlap.availability === "available") {
      const serpOverlap = item.serpOverlap;
      if (serpOverlap.valuePointer !== "/valueJson/serpOverlap") {
        ctx.addIssue({
          code: "custom",
          path: ["serpOverlap", "valuePointer"],
          message:
            "SERP overlap must use its canonical normalized Observation pointer",
        });
      }
      const source = item.originOccurrences.some(
        (origin) =>
          origin.originKind === "serp_overlap" &&
          origin.snapshotId === serpOverlap.snapshotId &&
          origin.observationId === serpOverlap.observationId &&
          origin.observedAt === serpOverlap.observedAt,
      );
      if (!source) {
        ctx.addIssue({
          code: "custom",
          path: ["serpOverlap", "observationId"],
          message:
            "Available SERP overlap requires one exact canonical origin Observation",
        });
      }
    }
    if (item.aiCitationInsight.availability === "available") {
      const aiCitationInsight = item.aiCitationInsight;
      if (
        aiCitationInsight.valuePointer !== "/valueJson/aiCitationInsight"
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["aiCitationInsight", "valuePointer"],
          message:
            "AI citation insight must use its canonical normalized Observation pointer",
        });
      }
      const source = item.originOccurrences.some(
        (origin) =>
          origin.originKind === "ai_citation" &&
          origin.snapshotId === aiCitationInsight.snapshotId &&
          origin.observationId === aiCitationInsight.observationId &&
          origin.observedAt === aiCitationInsight.observedAt,
      );
      if (!source) {
        ctx.addIssue({
          code: "custom",
          path: ["aiCitationInsight", "observationId"],
          message:
            "Available AI citation insight requires one exact canonical origin Observation",
        });
      }
    }
  });
export type GrowthMapCompetitorLibraryItem = z.infer<
  typeof GrowthMapCompetitorLibraryItem
>;

const GrowthMapCompetitorLibraryResponseObject = z
  .object({
    projectId: Uuid,
    data: z.array(GrowthMapCompetitorLibraryItem).max(100),
    meta: GrowthMapLibraryPageMeta,
  })
  .strict();

export const GrowthMapCompetitorLibraryResponse =
  GrowthMapCompetitorLibraryResponseObject.superRefine((response, ctx) => {
    if (response.data.length > response.meta.limit) {
      ctx.addIssue({
        code: "custom",
        path: ["data"],
        message: "A Competitor Library page cannot exceed its declared limit",
      });
    }
    const competitorIds = new Set<string>();
    const domains = new Set<string>();
    const occurrenceIds = new Set<string>();
    const originIdentities = new Set<string>();
    response.data.forEach((item, index) => {
      if (item.projectId !== response.projectId) {
        ctx.addIssue({
          code: "custom",
          path: ["data", index, "projectId"],
          message: "Competitor projectId must match the response scope",
        });
      }
      if (competitorIds.has(item.competitorId)) {
        ctx.addIssue({
          code: "custom",
          path: ["data", index, "competitorId"],
          message: "Competitor IDs must be unique within a cursor page",
        });
      }
      competitorIds.add(item.competitorId);
      if (domains.has(item.domain)) {
        ctx.addIssue({
          code: "custom",
          path: ["data", index, "domain"],
          message: "Competitor domains must be unique within a project",
        });
      }
      domains.add(item.domain);

      item.originOccurrences.forEach((origin, originIndex) => {
        if (occurrenceIds.has(origin.occurrenceId)) {
          ctx.addIssue({
            code: "custom",
            path: [
              "data",
              index,
              "originOccurrences",
              originIndex,
              "occurrenceId",
            ],
            message: "An origin occurrence cannot belong to multiple Competitors",
          });
        }
        occurrenceIds.add(origin.occurrenceId);
        const originIdentity = competitorOriginIdentity(origin);
        if (originIdentities.has(originIdentity)) {
          ctx.addIssue({
            code: "custom",
            path: ["data", index, "originOccurrences", originIndex],
            message:
              "An exact origin occurrence cannot populate multiple Competitors",
          });
        }
        originIdentities.add(originIdentity);
      });
    });
  });
export type GrowthMapCompetitorLibraryResponse = z.infer<
  typeof GrowthMapCompetitorLibraryResponse
>;

const GrowthMapCompetitorDetailResponseObject = z
  .object({
    projectId: Uuid,
    data: GrowthMapCompetitorLibraryItem,
  })
  .strict();

export const GrowthMapCompetitorDetailResponse =
  GrowthMapCompetitorDetailResponseObject.superRefine((response, ctx) => {
    if (response.data.projectId !== response.projectId) {
      ctx.addIssue({
        code: "custom",
        path: ["data", "projectId"],
        message: "Competitor projectId must match the detail response scope",
      });
    }
  });
export type GrowthMapCompetitorDetailResponse = z.infer<
  typeof GrowthMapCompetitorDetailResponse
>;
