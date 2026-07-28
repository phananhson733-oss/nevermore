import { describe, expect, it } from "vitest";
import { GrowthMapBacklinkReadModel } from "./backlink-growth-map.ts";

const PRIMARY_SITE_ID = "11111111-1111-4111-8111-111111111111";
const COMPETITOR_ID = "22222222-2222-4222-8222-222222222222";
const PRIMARY_SNAPSHOT_ID = "33333333-3333-4333-8333-333333333333";
const COMPETITOR_SNAPSHOT_ID = "44444444-4444-4444-8444-444444444444";
const SITE_PAGE_ID = "55555555-5555-4555-8555-555555555555";
const FACT_ID = "66666666-6666-4666-8666-666666666666";

function providerSource(
  subject: "primary_site" | "approved_competitor",
) {
  const primary = subject === "primary_site";
  return {
    snapshotId: primary ? PRIMARY_SNAPSHOT_ID : COMPETITOR_SNAPSHOT_ID,
    subjectKind: subject,
    subjectId: primary ? PRIMARY_SITE_ID : COMPETITOR_ID,
    subjectName: primary ? "RelayOps" : "Userpilot",
    domain: primary ? "relayops.example" : "userpilot.example",
    sourceKind: "provider_import" as const,
    provider: "ahrefs" as const,
    capturedAt: "2026-07-28T00:00:00.000Z",
    coverage: {
      availability: "available" as const,
      indexScope: "provider_index" as const,
      limitations: [],
    },
    backlinks: { semantics: "provider_index_total" as const, value: 120 },
    referringDomains: {
      semantics: "provider_index_total" as const,
      value: primary ? 40 : 140,
    },
    authorityMetric: { kind: "domain_rating" as const, value: 42 },
    trace: {
      sourceRef: primary ? "ahrefs:relayops:2026-07" : "ahrefs:userpilot:2026-07",
      checksum: "a".repeat(64),
      rowCount: 120,
      importPreviewId: null,
    },
  };
}

function validModel() {
  const primary = providerSource("primary_site");
  const competitor = providerSource("approved_competitor");
  return {
    projectId: "77777777-7777-4777-8777-777777777777",
    generatedAt: "2026-07-28T01:00:00.000Z",
    coverage: primary.coverage,
    sources: [primary, competitor],
    primarySite: primary,
    approvedCompetitors: [competitor],
    comparison: {
      state: "comparable" as const,
      provider: "ahrefs" as const,
      primarySiteSnapshotId: PRIMARY_SNAPSHOT_ID,
      competitorSnapshotIds: [COMPETITOR_SNAPSHOT_ID],
      limitation: null,
    },
    pages: [
      {
        sitePageId: SITE_PAGE_ID,
        canonicalUrl: "https://relayops.example/customer-onboarding/",
        title: "Customer onboarding",
        backlinks: { semantics: "provider_index_total" as const, value: 0 },
        referringDomains: {
          semantics: "provider_index_total" as const,
          value: 0,
        },
        snapshotId: PRIMARY_SNAPSHOT_ID,
      },
    ],
    referringDomains: [
      {
        domain: "example.org",
        observedBacklinks: 2,
        authorityMetric: {
          kind: "domain_rating" as const,
          value: 61,
        },
        topTargetUrl: "https://relayops.example/",
        snapshotId: PRIMARY_SNAPSHOT_ID,
        factIds: [FACT_ID],
      },
    ],
    opportunities: [
      {
        opportunityKey: `backlink:page:${SITE_PAGE_ID}:${PRIMARY_SNAPSHOT_ID}`,
        kind: "page_without_provider_backlinks" as const,
        severity: "medium" as const,
        title: "核心页面尚无 Provider 观测到的外链",
        summary: "Ahrefs 当前索引中该页面的外链与引用域均为 0。",
        sitePageId: SITE_PAGE_ID,
        evidenceSnapshotIds: [PRIMARY_SNAPSHOT_ID],
        executionRef: null,
      },
    ],
  };
}

describe("GrowthMapBacklinkReadModel", () => {
  it("accepts provider-index totals with approved competitor comparison", () => {
    expect(GrowthMapBacklinkReadModel.parse(validModel())).toBeTruthy();
  });

  it("rejects DR on search-derived observations", () => {
    const model = validModel();
    const searchSource = {
      ...model.primarySite,
      sourceKind: "search_derived",
      provider: "search_derived",
      coverage: {
        availability: "partial",
        indexScope: "observed_subset",
        limitations: ["仅代表检索发现，不是完整外链索引。"],
      },
      backlinks: { semantics: "observed_fact_count", value: 4 },
      referringDomains: { semantics: "observed_fact_count", value: 3 },
      authorityMetric: { kind: "domain_rating", value: 20 },
    };
    expect(() =>
      GrowthMapBacklinkReadModel.parse({
        ...model,
        coverage: searchSource.coverage,
        sources: [searchSource],
        primarySite: searchSource,
        approvedCompetitors: [],
        comparison: {
          state: "insufficient",
          provider: null,
          primarySiteSnapshotId: null,
          competitorSnapshotIds: [],
          limitation: "没有同一 Provider 的已批准竞品快照。",
        },
      }),
    ).toThrow(/Authority metrics require a real provider import/u);
  });

  it("rejects complete totals from manual CSV", () => {
    const model = validModel();
    const csvSource = {
      ...model.primarySite,
      sourceKind: "manual_csv",
      provider: "manual_csv",
      coverage: {
        availability: "partial",
        indexScope: "observed_subset",
        limitations: ["仅统计本次 CSV 已导入记录。"],
      },
      trace: {
        ...model.primarySite.trace,
        importPreviewId: "88888888-8888-4888-8888-888888888888",
      },
      authorityMetric: null,
    };
    expect(() =>
      GrowthMapBacklinkReadModel.parse({
        ...model,
        coverage: csvSource.coverage,
        sources: [csvSource],
        primarySite: csvSource,
        approvedCompetitors: [],
        comparison: {
          state: "insufficient",
          provider: null,
          primarySiteSnapshotId: null,
          competitorSnapshotIds: [],
          limitation: "没有同一 Provider 的已批准竞品快照。",
        },
      }),
    ).toThrow(/Only provider imports may expose index totals/u);
  });

  it("rejects a partial provider export presented with provider-index totals", () => {
    const model = validModel();
    const partialProvider = {
      ...model.primarySite,
      coverage: {
        availability: "partial",
        indexScope: "observed_subset",
        limitations: ["本次 Provider 导出不完整。"],
      },
    };
    expect(() =>
      GrowthMapBacklinkReadModel.parse({
        ...model,
        coverage: partialProvider.coverage,
        sources: [partialProvider],
        primarySite: partialProvider,
        approvedCompetitors: [],
        comparison: {
          state: "insufficient",
          provider: null,
          primarySiteSnapshotId: null,
          competitorSnapshotIds: [],
          limitation: "没有同一 Provider 的已批准竞品快照。",
        },
      }),
    ).toThrow(/partial provider result/u);
  });

  it("rejects a provider source using a built-in observed-subset label", () => {
    const model = validModel();
    const invalidProvider = {
      ...model.primarySite,
      provider: "manual_csv",
    };
    expect(() =>
      GrowthMapBacklinkReadModel.parse({
        ...model,
        sources: [invalidProvider, model.approvedCompetitors[0]],
        primarySite: invalidProvider,
      }),
    ).toThrow(/provider and source kind must agree/u);
  });

  it("requires an available Provider snapshot to use matching DR or DA semantics", () => {
    const model = validModel();
    const invalidAuthority = {
      ...model.primarySite,
      authorityMetric: {
        kind: "domain_authority",
        value: 42,
      },
    };
    expect(() =>
      GrowthMapBacklinkReadModel.parse({
        ...model,
        sources: [invalidAuthority, model.approvedCompetitors[0]],
        primarySite: invalidAuthority,
      }),
    ).toThrow(/matching DR or DA/u);
  });

  it("rejects a candidate competitor presented as approved authority", () => {
    const model = validModel();
    expect(() =>
      GrowthMapBacklinkReadModel.parse({
        ...model,
        approvedCompetitors: [
          {
            ...model.primarySite,
            subjectKind: "primary_site",
          },
        ],
      }),
    ).toThrow(/must be approved/u);
  });

  it("rejects internal object keys and credential-bearing URLs as customer-visible source references", () => {
    const model = validModel();
    const unsafePrimary = {
      ...model.primarySite,
      trace: {
        ...model.primarySite.trace,
        sourceRef:
          "s3://private-bucket/workspaces/secret/backlinks.csv?token=secret",
      },
    };
    expect(() =>
      GrowthMapBacklinkReadModel.parse({
        ...model,
        sources: [unsafePrimary, model.approvedCompetitors[0]],
        primarySite: unsafePrimary,
      }),
    ).toThrow(/customer-safe label/u);
  });

  it("keeps unavailable coverage free of zero-like projections", () => {
    const model = validModel();
    expect(() =>
      GrowthMapBacklinkReadModel.parse({
        ...model,
        coverage: {
          availability: "unavailable",
          indexScope: "unavailable",
          limitations: ["尚无可读取的外链快照。"],
        },
        sources: [],
        primarySite: null,
        approvedCompetitors: [],
        pages: model.pages,
        referringDomains: [],
        opportunities: [],
        comparison: {
          state: "unavailable",
          provider: null,
          primarySiteSnapshotId: null,
          competitorSnapshotIds: [],
          limitation: "尚无可读取的外链快照。",
        },
      }),
    ).toThrow(/cannot contain fabricated projections/u);
  });
});
