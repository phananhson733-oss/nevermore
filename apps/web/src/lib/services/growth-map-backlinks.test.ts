import {
  BacklinkGrowthMapRepository,
  ProjectsRepository,
} from "@sf/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getProjectAuditBacklinks } = await import(
  "./growth-map-backlinks.ts"
);

const ids = {
  workspace: "b1000000-0000-4000-8000-000000000001",
  project: "b1000000-0000-4000-8000-000000000002",
  site: "b1000000-0000-4000-8000-000000000003",
  competitor: "b1000000-0000-4000-8000-000000000004",
  primarySnapshot: "b1000000-0000-4000-8000-000000000005",
  competitorSnapshot: "b1000000-0000-4000-8000-000000000006",
  page: "b1000000-0000-4000-8000-000000000007",
  fact: "b1000000-0000-4000-8000-000000000008",
} as const;
const scope = { workspaceId: ids.workspace, uiLocale: "zh-CN" as const };
const englishScope = { workspaceId: ids.workspace, uiLocale: "en" as const };
const now = new Date("2026-07-28T12:00:00.000Z");

function snapshot(
  subject: "primary_site" | "approved_competitor",
  overrides: Record<string, unknown> = {},
) {
  const primary = subject === "primary_site";
  return {
    id: primary ? ids.primarySnapshot : ids.competitorSnapshot,
    workspace_id: ids.workspace,
    project_id: ids.project,
    site_id: ids.site,
    competitor_id: primary ? null : ids.competitor,
    subject_kind: subject,
    subject_name: primary ? "RelayOps" : "Userpilot",
    domain: primary ? "relayops.example" : "userpilot.example",
    source_kind: "provider_import",
    provider: "ahrefs",
    captured_at: "2026-07-28T00:00:00.000Z",
    availability: "available",
    index_scope: "provider_index",
    total_backlinks: primary ? 120 : 900,
    total_referring_domains: primary ? 40 : 160,
    observed_backlinks: null,
    observed_referring_domains: null,
    authority_metric_kind: "domain_rating",
    authority_metric_value: primary ? 42 : 67,
    source_ref: primary
      ? "ahrefs:relayops:2026-07"
      : "ahrefs:userpilot:2026-07",
    checksum: "a".repeat(64),
    row_count: primary ? 120 : 900,
    import_preview_id: null,
    limitation: null,
    ...overrides,
  } as never;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue({
    id: ids.project,
    workspace_id: ids.workspace,
    archived_at: null,
  } as never);
});

describe("getProjectAuditBacklinks", () => {
  it("compares only provider-aligned approved competitors and creates traceable opportunities", async () => {
    vi.spyOn(
      BacklinkGrowthMapRepository.prototype,
      "listLatestAuthoritySnapshots",
    ).mockResolvedValue([
      snapshot("primary_site"),
      snapshot("approved_competitor"),
    ]);
    vi.spyOn(
      BacklinkGrowthMapRepository.prototype,
      "listPageMetrics",
    ).mockResolvedValue([
      {
        snapshot_id: ids.primarySnapshot,
        workspace_id: ids.workspace,
        project_id: ids.project,
        site_page_id: ids.page,
        normalized_url:
          "https://relayops.example/customer-onboarding/",
        title: "Customer onboarding",
        backlink_count: 0,
        referring_domain_count: 0,
        metric_semantics: "provider_index_total",
      },
    ]);
    vi.spyOn(
      BacklinkGrowthMapRepository.prototype,
      "listFacts",
    ).mockResolvedValue([
      {
        id: ids.fact,
        snapshot_id: ids.primarySnapshot,
        workspace_id: ids.workspace,
        project_id: ids.project,
        referring_domain: "example.org",
        source_url: "https://example.org/relayops-review",
        target_url: "https://relayops.example/",
        target_site_page_id: null,
        source_authority_metric_kind: "domain_rating",
        source_authority_metric_value: 63,
      },
    ]);

    const result = await getProjectAuditBacklinks(
      scope,
      ids.project,
      {} as never,
      now,
    );
    expect(result.comparison).toMatchObject({
      state: "comparable",
      provider: "ahrefs",
      primarySiteSnapshotId: ids.primarySnapshot,
      competitorSnapshotIds: [ids.competitorSnapshot],
    });
    expect(result.opportunities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "site_referring_domain_gap",
          evidenceSnapshotIds: [
            ids.primarySnapshot,
            ids.competitorSnapshot,
          ],
        }),
        expect.objectContaining({
          kind: "page_without_provider_backlinks",
          sitePageId: ids.page,
          evidenceSnapshotIds: [ids.primarySnapshot],
        }),
      ]),
    );
    expect(result.referringDomains[0]?.authorityMetric).toEqual({
      kind: "domain_rating",
      value: 63,
    });
  });

  it("labels search-derived rows as an observed subset without totals or DR", async () => {
    vi.spyOn(
      BacklinkGrowthMapRepository.prototype,
      "listLatestAuthoritySnapshots",
    ).mockResolvedValue([
      snapshot("primary_site", {
        source_kind: "search_derived",
        provider: "search_derived",
        availability: "partial",
        index_scope: "observed_subset",
        total_backlinks: null,
        total_referring_domains: null,
        observed_backlinks: 3,
        observed_referring_domains: 2,
        authority_metric_kind: null,
        authority_metric_value: null,
        limitation: "仅包含已验证的搜索发现。",
      }),
    ]);
    vi.spyOn(
      BacklinkGrowthMapRepository.prototype,
      "listPageMetrics",
    ).mockResolvedValue([]);
    vi.spyOn(
      BacklinkGrowthMapRepository.prototype,
      "listFacts",
    ).mockResolvedValue([]);

    const result = await getProjectAuditBacklinks(
      scope,
      ids.project,
      {} as never,
      now,
    );
    expect(result.primarySite).toMatchObject({
      sourceKind: "search_derived",
      backlinks: { semantics: "observed_fact_count", value: 3 },
      referringDomains: {
        semantics: "observed_fact_count",
        value: 2,
      },
      authorityMetric: null,
    });
    expect(result.coverage.limitations.join(" ")).toMatch(
      /不是完整外链索引/u,
    );
    expect(result.opportunities).toEqual([]);
  });

  it("keeps an available Provider authority selected when a newer search-derived subset also exists", async () => {
    vi.spyOn(
      BacklinkGrowthMapRepository.prototype,
      "listLatestAuthoritySnapshots",
    ).mockResolvedValue([
      snapshot("primary_site", {
        captured_at: "2026-07-20T00:00:00.000Z",
      }),
      snapshot("primary_site", {
        id: "b1000000-0000-4000-8000-000000000010",
        source_kind: "search_derived",
        provider: "search_derived",
        captured_at: "2026-07-28T08:00:00.000Z",
        availability: "partial",
        index_scope: "observed_subset",
        total_backlinks: null,
        total_referring_domains: null,
        observed_backlinks: 3,
        observed_referring_domains: 2,
        authority_metric_kind: null,
        authority_metric_value: null,
        source_ref: "search-derived:relayops:2026-07-28",
        limitation: "仅包含已验证的搜索发现。",
      }),
    ]);
    vi.spyOn(
      BacklinkGrowthMapRepository.prototype,
      "listPageMetrics",
    ).mockResolvedValue([]);
    vi.spyOn(
      BacklinkGrowthMapRepository.prototype,
      "listFacts",
    ).mockResolvedValue([]);

    const result = await getProjectAuditBacklinks(
      scope,
      ids.project,
      {} as never,
      now,
    );
    expect(result.sources).toHaveLength(2);
    expect(result.primarySite).toMatchObject({
      snapshotId: ids.primarySnapshot,
      sourceKind: "provider_import",
      backlinks: { semantics: "provider_index_total", value: 120 },
      authorityMetric: { kind: "domain_rating", value: 42 },
    });
  });

  it("keeps missing authority unavailable instead of filling counters with zero", async () => {
    vi.spyOn(
      BacklinkGrowthMapRepository.prototype,
      "listLatestAuthoritySnapshots",
    ).mockResolvedValue([]);
    const pageMetrics = vi.spyOn(
      BacklinkGrowthMapRepository.prototype,
      "listPageMetrics",
    );
    const facts = vi.spyOn(
      BacklinkGrowthMapRepository.prototype,
      "listFacts",
    );

    const result = await getProjectAuditBacklinks(
      scope,
      ids.project,
      {} as never,
      now,
    );
    expect(result).toMatchObject({
      coverage: {
        availability: "unavailable",
        indexScope: "unavailable",
      },
      primarySite: null,
      pages: [],
      referringDomains: [],
      opportunities: [],
    });
    expect(pageMetrics).not.toHaveBeenCalled();
    expect(facts).not.toHaveBeenCalled();
  });

  it("localizes system limitations for an English request without changing persisted evidence", async () => {
    vi.spyOn(
      BacklinkGrowthMapRepository.prototype,
      "listLatestAuthoritySnapshots",
    ).mockResolvedValue([]);

    const result = await getProjectAuditBacklinks(
      englishScope,
      ids.project,
      {} as never,
      now,
    );
    expect(result.coverage.limitations).toEqual([
      "No readable backlink snapshot is available yet.",
    ]);
    expect(result.comparison.limitation).toMatch(
      /No readable backlink snapshot/u,
    );
    expect(result.coverage.limitations.join(" ")).not.toMatch(
      /尚无|外链/u,
    );
  });

  it("localizes Provider-backed opportunities for an English request", async () => {
    vi.spyOn(
      BacklinkGrowthMapRepository.prototype,
      "listLatestAuthoritySnapshots",
    ).mockResolvedValue([
      snapshot("primary_site"),
      snapshot("approved_competitor"),
    ]);
    vi.spyOn(
      BacklinkGrowthMapRepository.prototype,
      "listPageMetrics",
    ).mockResolvedValue([
      {
        snapshot_id: ids.primarySnapshot,
        workspace_id: ids.workspace,
        project_id: ids.project,
        site_page_id: ids.page,
        normalized_url:
          "https://relayops.example/customer-onboarding/",
        title: "Customer onboarding",
        backlink_count: 0,
        referring_domain_count: 0,
        metric_semantics: "provider_index_total",
      },
    ]);
    vi.spyOn(
      BacklinkGrowthMapRepository.prototype,
      "listFacts",
    ).mockResolvedValue([]);

    const result = await getProjectAuditBacklinks(
      englishScope,
      ids.project,
      {} as never,
      now,
    );
    expect(result.opportunities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "site_referring_domain_gap",
          title:
            "Approved competitors have materially broader referring-domain coverage",
          summary:
            "Within the same Ahrefs scope, the current site has 40 referring domains and the comparable-competitor median is 160.",
        }),
        expect.objectContaining({
          kind: "page_without_provider_backlinks",
          title:
            "No backlinks are observed for this page by the Provider",
          summary:
            "Ahrefs currently reports zero backlinks and zero referring domains for this exact page.",
        }),
      ]),
    );
    expect(
      result.opportunities
        .flatMap((opportunity) => [
          opportunity.title,
          opportunity.summary,
        ])
        .join(" "),
    ).not.toMatch(/[\u3400-\u9fff]/u);
  });

  it("refuses a hidden Provider total on a search-derived observed subset", async () => {
    vi.spyOn(
      BacklinkGrowthMapRepository.prototype,
      "listLatestAuthoritySnapshots",
    ).mockResolvedValue([
      snapshot("primary_site", {
        source_kind: "search_derived",
        provider: "search_derived",
        availability: "partial",
        index_scope: "observed_subset",
        total_backlinks: 3,
        total_referring_domains: null,
        observed_backlinks: 3,
        observed_referring_domains: 2,
        authority_metric_kind: null,
        authority_metric_value: null,
        limitation: "仅包含已验证的搜索发现。",
      }),
    ]);

    await expect(
      getProjectAuditBacklinks(
        scope,
        ids.project,
        {} as never,
        now,
      ),
    ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
  });

  it("refuses DR projected from a manual CSV snapshot", async () => {
    vi.spyOn(
      BacklinkGrowthMapRepository.prototype,
      "listLatestAuthoritySnapshots",
    ).mockResolvedValue([
      snapshot("primary_site", {
        source_kind: "manual_csv",
        provider: "manual_csv",
        availability: "partial",
        index_scope: "observed_subset",
        total_backlinks: null,
        total_referring_domains: null,
        observed_backlinks: 3,
        observed_referring_domains: 2,
        authority_metric_kind: "domain_rating",
        authority_metric_value: 60,
        import_preview_id:
          "b1000000-0000-4000-8000-000000000009",
        limitation: "仅包含导入记录。",
      }),
    ]);

    await expect(
      getProjectAuditBacklinks(
        scope,
        ids.project,
        {} as never,
        now,
      ),
    ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
  });

  it("refuses provider-total page semantics on a search-derived snapshot", async () => {
    vi.spyOn(
      BacklinkGrowthMapRepository.prototype,
      "listLatestAuthoritySnapshots",
    ).mockResolvedValue([
      snapshot("primary_site", {
        source_kind: "search_derived",
        provider: "search_derived",
        availability: "partial",
        index_scope: "observed_subset",
        total_backlinks: null,
        total_referring_domains: null,
        observed_backlinks: 3,
        observed_referring_domains: 2,
        authority_metric_kind: null,
        authority_metric_value: null,
        limitation: "仅包含已验证的搜索发现。",
      }),
    ]);
    vi.spyOn(
      BacklinkGrowthMapRepository.prototype,
      "listPageMetrics",
    ).mockResolvedValue([
      {
        snapshot_id: ids.primarySnapshot,
        workspace_id: ids.workspace,
        project_id: ids.project,
        site_page_id: ids.page,
        normalized_url:
          "https://relayops.example/customer-onboarding/",
        title: "Customer onboarding",
        backlink_count: 0,
        referring_domain_count: 0,
        metric_semantics: "provider_index_total",
      },
    ]);
    vi.spyOn(
      BacklinkGrowthMapRepository.prototype,
      "listFacts",
    ).mockResolvedValue([]);

    await expect(
      getProjectAuditBacklinks(
        scope,
        ids.project,
        {} as never,
        now,
      ),
    ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
  });

  it("refuses an Ahrefs DR fact projected under a Moz snapshot", async () => {
    vi.spyOn(
      BacklinkGrowthMapRepository.prototype,
      "listLatestAuthoritySnapshots",
    ).mockResolvedValue([
      snapshot("primary_site", {
        provider: "moz",
        authority_metric_kind: "domain_authority",
      }),
    ]);
    vi.spyOn(
      BacklinkGrowthMapRepository.prototype,
      "listPageMetrics",
    ).mockResolvedValue([]);
    vi.spyOn(
      BacklinkGrowthMapRepository.prototype,
      "listFacts",
    ).mockResolvedValue([
      {
        id: ids.fact,
        snapshot_id: ids.primarySnapshot,
        workspace_id: ids.workspace,
        project_id: ids.project,
        referring_domain: "example.org",
        source_url: "https://example.org/relayops-review",
        target_url: "https://relayops.example/",
        target_site_page_id: null,
        source_authority_metric_kind: "domain_rating",
        source_authority_metric_value: 63,
      },
    ]);

    await expect(
      getProjectAuditBacklinks(
        scope,
        ids.project,
        {} as never,
        now,
      ),
    ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
  });
});
