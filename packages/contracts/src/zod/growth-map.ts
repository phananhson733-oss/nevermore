import { z } from "zod";
import { Cursor, IsoDateTime, Uuid } from "./common.ts";
import { PriorityBand } from "./diagnostics.ts";
import { SourceFreshness } from "./audit.ts";

const BoundedText = z.string().trim().min(1).max(2000);
const BoundedLabel = z.string().trim().min(1).max(500);
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

/** Priority is a deterministic current-run Finding projection, not a recheck. */
export const GrowthMapFindingPriorityBasis = z
  .object({
    derivationVersion: z.literal("max_finding_severity.v1"),
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
    active: z.boolean(),
    regressed: z.boolean(),
    evidenceIds: uniqueUuidArray(200).min(1),
    targetRelation: GrowthMapFindingTargetRelation,
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

export const GrowthMapUrlPortfolioMeta = z
  .object({
    limit: z.number().int().min(1).max(100),
    nextCursor: Cursor.nullable(),
    hasNext: z.boolean(),
    coverage: GrowthMapCoverage,
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

/** A bounded project-scoped cursor page; deliberately has no project total. */
export const GrowthMapUrlPortfolioResponse =
  GrowthMapUrlPortfolioResponseObject.superRefine((response, ctx) => {
    if (response.data.length > response.meta.limit) {
      ctx.addIssue({
        code: "custom",
        path: ["data"],
        message: "A portfolio page cannot exceed its declared limit",
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
