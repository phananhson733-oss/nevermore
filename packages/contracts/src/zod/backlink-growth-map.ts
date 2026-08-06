import { z } from "zod";
import { IsoDateTime, Uuid } from "./common.ts";

const Count = z.number().int().nonnegative().max(9_007_199_254_740_991);
const CanonicalUrl = z.string().trim().url().max(2048);
const Domain = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u,
  );
const BoundedText = z.string().trim().min(1).max(2000);
const Checksum = z.string().regex(/^[a-f0-9]{64}$/u);
const CustomerSafeSourceRef = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(
    /^[^/\\?&#=]+$/u,
    "Backlink sourceRef must be a customer-safe label, not a URL, object key, or credential-bearing query",
  )
  .refine(
    (value) =>
      [...value].every((character) => {
        const codePoint = character.codePointAt(0);
        return codePoint !== undefined && codePoint >= 32 && codePoint !== 127;
      }),
    "Backlink sourceRef must not contain control characters",
  );

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

export const BacklinkSourceKind = z.enum([
  "provider_import",
  "manual_csv",
  "search_derived",
]);
export type BacklinkSourceKind = z.infer<typeof BacklinkSourceKind>;

export const BacklinkProvider = z.enum([
  "ahrefs",
  "moz",
  "dataforseo",
  "manual_csv",
  "search_derived",
]);
export type BacklinkProvider = z.infer<typeof BacklinkProvider>;

export const BacklinkSubjectKind = z.enum([
  "primary_site",
  "approved_competitor",
]);
export type BacklinkSubjectKind = z.infer<typeof BacklinkSubjectKind>;

export const BacklinkMetricSemantics = z.enum([
  "provider_index_total",
  "observed_fact_count",
  "unavailable",
]);
export type BacklinkMetricSemantics = z.infer<
  typeof BacklinkMetricSemantics
>;

export const BacklinkCoverage = z
  .object({
    availability: z.enum(["available", "partial", "unavailable"]),
    indexScope: z.enum([
      "provider_index",
      "observed_subset",
      "unavailable",
    ]),
    limitations: z
      .array(BoundedText)
      .max(50)
      .refine(unique, "Backlink limitations must be unique"),
  })
  .strict()
  .superRefine((coverage, ctx) => {
    if (
      coverage.availability === "available" &&
      coverage.indexScope !== "provider_index"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["indexScope"],
        message: "Only a provider index can be fully available",
      });
    }
    if (
      coverage.availability === "partial" &&
      coverage.indexScope !== "observed_subset"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["indexScope"],
        message: "Partial backlink coverage must be an observed subset",
      });
    }
    if (
      coverage.availability === "unavailable" &&
      coverage.indexScope !== "unavailable"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["indexScope"],
        message: "Unavailable backlink coverage cannot claim an index scope",
      });
    }
    if (
      (coverage.availability === "available") !==
      (coverage.limitations.length === 0)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["limitations"],
        message: "Only fully available provider coverage may omit limitations",
      });
    }
  });
export type BacklinkCoverage = z.infer<typeof BacklinkCoverage>;

export const BacklinkAuthorityMetric = z
  .object({
    kind: z.enum([
      "domain_rating",
      "domain_authority",
      "dataforseo_rank",
    ]),
    value: z.number().finite().min(0).max(100),
  })
  .strict();
export type BacklinkAuthorityMetric = z.infer<
  typeof BacklinkAuthorityMetric
>;

export const BacklinkMetric = z
  .object({
    semantics: BacklinkMetricSemantics,
    value: Count.nullable(),
  })
  .strict()
  .superRefine((metric, ctx) => {
    if ((metric.semantics === "unavailable") !== (metric.value === null)) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message:
          "Unavailable backlink metrics must be null and observed metrics must have a value",
      });
    }
  });
export type BacklinkMetric = z.infer<typeof BacklinkMetric>;

export const BacklinkSnapshotSource = z
  .object({
    snapshotId: Uuid,
    subjectKind: BacklinkSubjectKind,
    subjectId: Uuid,
    subjectName: z.string().trim().min(1).max(160),
    domain: Domain,
    sourceKind: BacklinkSourceKind,
    provider: BacklinkProvider,
    capturedAt: IsoDateTime,
    coverage: BacklinkCoverage,
    backlinks: BacklinkMetric,
    referringDomains: BacklinkMetric,
    authorityMetric: BacklinkAuthorityMetric.nullable(),
    trace: z
      .object({
        sourceRef: CustomerSafeSourceRef,
        checksum: Checksum,
        rowCount: Count,
        importPreviewId: Uuid.nullable(),
      })
      .strict(),
  })
  .strict()
  .superRefine((source, ctx) => {
    const providerImport = source.sourceKind === "provider_import";
    const providerMatchesSource =
      source.sourceKind === "provider_import"
        ? source.provider === "ahrefs" ||
          source.provider === "moz" ||
          source.provider === "dataforseo"
        : source.sourceKind === "manual_csv"
          ? source.provider === "manual_csv"
          : source.provider === "search_derived";
    if (!providerMatchesSource) {
      ctx.addIssue({
        code: "custom",
        path: ["provider"],
        message: "Backlink provider and source kind must agree",
      });
    }
    const unavailable = source.coverage.availability === "unavailable";
    if (
      unavailable &&
      (source.backlinks.semantics !== "unavailable" ||
        source.referringDomains.semantics !== "unavailable" ||
        source.authorityMetric !== null)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["backlinks"],
        message: "Unavailable backlink sources cannot expose numeric metrics",
      });
    }
    if (
      !unavailable &&
      providerImport !==
        (source.backlinks.semantics === "provider_index_total" &&
          source.referringDomains.semantics === "provider_index_total")
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["backlinks"],
        message:
          "Only provider imports may expose index totals; observed subsets expose observed counts",
      });
    }
    if (
      !unavailable &&
      !providerImport &&
      (source.backlinks.semantics !== "observed_fact_count" ||
        source.referringDomains.semantics !== "observed_fact_count")
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["backlinks"],
        message:
          "Manual CSV and search-derived sources must expose observed fact counts",
      });
    }
    if (!unavailable && !providerImport && source.authorityMetric !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["authorityMetric"],
        message:
          "Authority metrics require a real provider import and cannot come from CSV or search-derived facts",
      });
    }
    if (
      !providerImport &&
      (source.coverage.availability !== "partial" ||
        source.coverage.indexScope !== "observed_subset")
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["coverage"],
        message:
          "Manual CSV and search-derived evidence must remain a partial observed subset",
      });
    }
    if (providerImport && source.coverage.availability === "available") {
      if (
        (source.provider === "ahrefs" &&
          source.authorityMetric?.kind !== "domain_rating") ||
        (source.provider === "moz" &&
          source.authorityMetric?.kind !== "domain_authority")
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["authorityMetric"],
          message:
            "Available Ahrefs and Moz snapshots require their matching DR or DA authority metric",
        });
      }
      if (
        source.provider === "dataforseo" &&
        source.authorityMetric?.kind !== "dataforseo_rank"
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["authorityMetric"],
          message:
            "DataForSEO snapshots require the dataforseo_rank authority metric and cannot be presented as DR or DA",
        });
      }
    }
    if (
      (source.sourceKind === "manual_csv") !==
      (source.trace.importPreviewId !== null)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["trace", "importPreviewId"],
        message: "Only manual CSV snapshots require an import preview identity",
      });
    }
    if (providerImport && source.coverage.availability === "partial") {
      ctx.addIssue({
        code: "custom",
        path: ["coverage", "availability"],
        message:
          "A partial provider result cannot be presented with provider-index total semantics",
      });
    }
  });
export type BacklinkSnapshotSource = z.infer<
  typeof BacklinkSnapshotSource
>;

export const BacklinkReferringDomain = z
  .object({
    domain: Domain,
    observedBacklinks: Count,
    authorityMetric: BacklinkAuthorityMetric.nullable(),
    topTargetUrl: CanonicalUrl,
    snapshotId: Uuid,
    factIds: z
      .array(Uuid)
      .min(1)
      .max(100)
      .refine(unique, "Backlink fact IDs must be unique"),
  })
  .strict();
export type BacklinkReferringDomain = z.infer<
  typeof BacklinkReferringDomain
>;

export const BacklinkPageItem = z
  .object({
    sitePageId: Uuid,
    canonicalUrl: CanonicalUrl,
    title: z.string().trim().min(1).max(500).nullable(),
    backlinks: BacklinkMetric,
    referringDomains: BacklinkMetric,
    snapshotId: Uuid.nullable(),
  })
  .strict()
  .superRefine((page, ctx) => {
    if (
      (page.snapshotId === null) !==
      (page.backlinks.semantics === "unavailable" &&
        page.referringDomains.semantics === "unavailable")
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["snapshotId"],
        message:
          "A page snapshot identity is required whenever backlink metrics are observed",
      });
    }
  });
export type BacklinkPageItem = z.infer<typeof BacklinkPageItem>;

export const BacklinkComparison = z
  .object({
    state: z.enum(["comparable", "insufficient", "unavailable"]),
    provider: z.enum(["ahrefs", "moz", "dataforseo"]).nullable(),
    primarySiteSnapshotId: Uuid.nullable(),
    competitorSnapshotIds: z
      .array(Uuid)
      .max(50)
      .refine(unique, "Competitor backlink snapshot IDs must be unique"),
    limitation: BoundedText.nullable(),
  })
  .strict()
  .superRefine((comparison, ctx) => {
    const comparable = comparison.state === "comparable";
    if (
      comparable !==
      (comparison.provider !== null &&
        comparison.primarySiteSnapshotId !== null &&
        comparison.competitorSnapshotIds.length > 0 &&
        comparison.limitation === null)
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "A comparable backlink scope requires one provider-aligned primary snapshot and approved competitor snapshots",
      });
    }
    if (!comparable && comparison.limitation === null) {
      ctx.addIssue({
        code: "custom",
        path: ["limitation"],
        message: "A non-comparable backlink scope must explain its limitation",
      });
    }
  });
export type BacklinkComparison = z.infer<typeof BacklinkComparison>;

export const BacklinkOpportunity = z
  .object({
    opportunityKey: z.string().trim().min(1).max(512),
    kind: z.enum([
      "site_referring_domain_gap",
      "page_without_provider_backlinks",
    ]),
    severity: z.enum(["high", "medium"]),
    title: z.string().trim().min(1).max(240),
    summary: z.string().trim().min(1).max(1000),
    sitePageId: Uuid.nullable(),
    evidenceSnapshotIds: z
      .array(Uuid)
      .min(1)
      .max(51)
      .refine(unique, "Opportunity evidence snapshot IDs must be unique"),
    executionRef: z
      .object({
        actionId: Uuid,
        artifactIds: z
          .array(Uuid)
          .max(20)
          .refine(unique, "Opportunity artifact IDs must be unique"),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((opportunity, ctx) => {
    if (
      (opportunity.kind === "page_without_provider_backlinks") !==
      (opportunity.sitePageId !== null)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["sitePageId"],
        message: "Only page-level backlink opportunities name a SitePage",
      });
    }
  });
export type BacklinkOpportunity = z.infer<typeof BacklinkOpportunity>;

export const GrowthMapBacklinkReadModel = z
  .object({
    projectId: Uuid,
    generatedAt: IsoDateTime,
    coverage: BacklinkCoverage,
    // One latest immutable row per subject/source/provider. A project may keep
    // all honest source scopes for the primary site and approved
    // competitors even though only one source is selected for comparison.
    sources: z.array(BacklinkSnapshotSource).max(204),
    primarySite: BacklinkSnapshotSource.nullable(),
    approvedCompetitors: z.array(BacklinkSnapshotSource).max(50),
    comparison: BacklinkComparison,
    pages: z.array(BacklinkPageItem).max(500),
    referringDomains: z.array(BacklinkReferringDomain).max(100),
    opportunities: z.array(BacklinkOpportunity).max(100),
  })
  .strict()
  .superRefine((model, ctx) => {
    const sourceIds = model.sources.map((source) => source.snapshotId);
    if (!unique(sourceIds)) {
      ctx.addIssue({
        code: "custom",
        path: ["sources"],
        message: "Backlink source snapshots must be unique",
      });
    }
    if (
      model.primarySite !== null &&
      (model.primarySite.subjectKind !== "primary_site" ||
        !sourceIds.includes(model.primarySite.snapshotId))
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["primarySite"],
        message: "Primary-site backlink authority must be present in sources",
      });
    }
    model.approvedCompetitors.forEach((source, index) => {
      if (
        source.subjectKind !== "approved_competitor" ||
        !sourceIds.includes(source.snapshotId)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["approvedCompetitors", index],
          message:
            "Competitor backlink authority must be approved and present in sources",
        });
      }
    });
    if (
      model.coverage.availability === "unavailable" &&
      (model.primarySite !== null ||
        model.pages.length > 0 ||
        model.referringDomains.length > 0 ||
        model.opportunities.length > 0)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["coverage"],
        message:
          "Unavailable backlink coverage cannot contain fabricated projections",
      });
    }
  });
export type GrowthMapBacklinkReadModel = z.infer<
  typeof GrowthMapBacklinkReadModel
>;
