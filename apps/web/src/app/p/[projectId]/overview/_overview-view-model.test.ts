import type {
  ConfirmedProductProfileRowDto,
  GrowthMapUrlDetail,
  GrowthMapUrlPortfolioItem,
  GrowthMapUrlPortfolioResponse,
} from "@sf/contracts";
import { describe, expect, it } from "vitest";
import type { OverviewAction } from "@/lib/api";
import type { SourceConnection } from "@/lib/api/hooks-sources";
import {
  buildConfirmedProfileSummary,
  buildOverviewSourceCards,
  buildPortfolioSummary,
  buildVerifiedResultSummary,
  overviewGrowthMapHref,
  selectTopOpportunityFinding,
  selectTopPortfolioItem,
  selectProjectWorkItemsForFrozenRun,
  shouldRefreshFrozenRunPair,
} from "./_overview-view-model";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";
const SITE_ID = "00000000-0000-4000-8000-000000000002";
const RUN_ID = "00000000-0000-4000-8000-000000000003";
const SNAPSHOT_ID = "00000000-0000-4000-8000-000000000004";

function portfolioItem(
  sitePageId: string,
  priority: "critical" | "high" | "medium" | "low" | null,
  reviewableCount: number,
): GrowthMapUrlPortfolioItem {
  const findingIds = Array.from(
    { length: reviewableCount > 0 ? reviewableCount : priority === null ? 0 : 1 },
    (_, index) => `${sitePageId.slice(0, -1)}${index + 1}`,
  );
  return {
    projectId: PROJECT_ID,
    siteId: SITE_ID,
    diagnosticRunId: RUN_ID,
    crawlSnapshotId: SNAPSHOT_ID,
    sitePageId,
    pageSnapshotId: null,
    pageSnapshotCapturedAt: null,
    identitySources: [
      {
        kind: "url_observation",
        provider: "gsc",
        snapshotId: SNAPSHOT_ID,
        observationId: "00000000-0000-4000-8000-000000000099",
        sitePageId,
        subjectRef: `https://example.test/${sitePageId.at(-1)}`,
        observedAt: "2026-07-21T00:00:00.000Z",
      },
    ],
    normalizedUrl: `https://example.test/${sitePageId.at(-1)}`,
    title: `Page ${sitePageId.at(-1)}`,
    pageType: "product",
    templateKey: "product",
    clusterKey: null,
    ownerId: null,
    coverage: { availability: "available", limitations: [] },
    metricObservations: [],
    findingIds,
    reviewableFindingIds: findingIds.slice(0, reviewableCount),
    priority:
      priority === null
        ? {
            availability: "unavailable",
            value: null,
            limitation: "No current-run Finding targets this URL.",
          }
        : {
            availability: "available",
            value: priority,
            basis: {
              derivationVersion: "max_finding_severity.v1",
              projectId: PROJECT_ID,
              siteId: SITE_ID,
              diagnosticRunId: RUN_ID,
              sitePageId,
              findingIds,
            },
            limitation: null,
          },
    delta: {
      availability: "unavailable",
      value: null,
      limitation: "No recheck window.",
    },
  } as GrowthMapUrlPortfolioItem;
}

function detail(): GrowthMapUrlDetail {
  const base = portfolioItem(
    "00000000-0000-4000-8000-000000000010",
    "critical",
    3,
  );
  const findings = [
    {
      findingId: "00000000-0000-4000-8000-000000000011",
      title: "已确认但优先级较低的机会",
      severity: "medium",
      reviewState: "confirmed",
      executionRef: {
        actionId: "00000000-0000-4000-8000-000000000031",
        artifactIds: [],
      },
    },
    {
      findingId: "00000000-0000-4000-8000-000000000012",
      title: "需要客户决定的关键机会",
      severity: "critical",
      reviewState: "unreviewed",
      executionRef: null,
    },
    {
      findingId: "00000000-0000-4000-8000-000000000013",
      title: "需要补充数据",
      severity: "high",
      reviewState: "needs_more_data",
      executionRef: null,
    },
    {
      findingId: "00000000-0000-4000-8000-000000000014",
      title: "已忽略事项",
      severity: "critical",
      reviewState: "ignored",
      executionRef: null,
    },
    {
      findingId: "00000000-0000-4000-8000-000000000015",
      title: "第四项不应进入最多三项的列表",
      severity: "low",
      reviewState: "unreviewed",
      executionRef: null,
    },
  ].map((finding) => ({
    projectId: PROJECT_ID,
    siteId: SITE_ID,
    diagnosticRunId: RUN_ID,
    ruleId: "TECH-HTTP-001",
    ruleVersion: 1,
    reviewRevision: 0,
    active: true,
    regressed: false,
    evidenceIds: ["00000000-0000-4000-8000-000000000021"],
    targetRelation: {
      relation: "affected_by_template" as const,
      targetKind: "template" as const,
      targetRef: "product",
    },
    ...finding,
  }));
  return { ...base, findings } as GrowthMapUrlDetail;
}

function source(
  provider: SourceConnection["provider"],
  state: SourceConnection["state"],
): SourceConnection {
  return {
    id: `source-${provider}`,
    projectId: PROJECT_ID,
    provider,
    connectionType: provider === "gsc" || provider === "ga4" ? "oauth" : "public",
    state,
    externalRef: null,
    scopes: [],
    connectedAt: "2026-07-20T00:00:00.000Z",
    latestSnapshot:
      provider === "gsc"
        ? {
            id: SNAPSHOT_ID,
            siteId: SITE_ID,
            provider: "gsc",
            datasetKey: "gsc_pages",
            schemaVersion: "1",
            methodVersion: "1",
            capturedAt: "2026-07-21T00:00:00.000Z",
            sourceWindow: { start: null, end: null },
            availability: "available",
            limitation: "Snapshot supplied an English limitation.",
            rowCount: 8,
            checksum: "sha256:test",
          }
        : null,
    activeRun: null,
    limitation: "Provider supplied an English limitation.",
    featureEnabled: true,
    updatedAt: "2026-07-21T00:00:00.000Z",
  };
}

describe("Overview customer projection", () => {
  it("selects the highest current-run URL deterministically", () => {
    const low = portfolioItem(
      "00000000-0000-4000-8000-000000000041",
      "low",
      3,
    );
    const criticalOne = portfolioItem(
      "00000000-0000-4000-8000-000000000042",
      "critical",
      1,
    );
    const criticalThree = portfolioItem(
      "00000000-0000-4000-8000-000000000043",
      "critical",
      3,
    );

    expect(selectTopPortfolioItem([low, criticalOne, criticalThree])).toBe(
      criticalThree,
    );
    expect(selectTopPortfolioItem([])).toBeNull();
  });

  it("uses one highest-priority active Finding from the selected frozen run as the top Opportunity", () => {
    const current = detail();
    const top = selectTopOpportunityFinding(current);

    expect(top?.findingId).toBe(
      "00000000-0000-4000-8000-000000000012",
    );
    expect(top?.diagnosticRunId).toBe(RUN_ID);
    expect(
      selectTopOpportunityFinding(
        current,
        "00000000-0000-4000-8000-000000000099",
      ),
    ).toBeNull();
  });

  it("keeps severity as the top Opportunity boundary before review-state convenience", () => {
    const current = detail();
    const mediumConfirmed = current.findings[0];
    const criticalUnreviewed = current.findings[1];
    if (!mediumConfirmed || !criticalUnreviewed) {
      throw new Error("expected Finding fixtures");
    }
    const isolated = {
      ...current,
      findings: [
        {
          ...mediumConfirmed,
          findingId: "00000000-0000-4000-8000-000000000091",
          severity: "critical",
          reviewState: "confirmed",
        },
        {
          ...criticalUnreviewed,
          findingId: "00000000-0000-4000-8000-000000000092",
          severity: "high",
          reviewState: "unreviewed",
        },
      ],
    } as GrowthMapUrlDetail;

    expect(selectTopOpportunityFinding(isolated)?.findingId).toBe(
      "00000000-0000-4000-8000-000000000091",
    );
  });

  it("does not resurrect an ignored Finding as the current Opportunity", () => {
    const current = detail();
    const ignored = current.findings.find(
      (finding) => finding.reviewState === "ignored",
    );
    if (!ignored) throw new Error("expected ignored Finding fixture");

    expect(
      selectTopOpportunityFinding({
        ...current,
        findings: [ignored],
      }),
    ).toBeNull();
  });

  it("shows only GSC, GA4, and an explicitly reserved unavailable GitHub slot", () => {
    const cards = buildOverviewSourceCards([
      source("crawl", "available"),
      source("gsc", "available"),
      source("ga4", "connected"),
      source("csv", "available"),
      source("dataforseo", "available"),
    ]);

    expect(cards.map((card) => card.provider)).toEqual(["gsc", "ga4", "github"]);
    expect(cards[0]).toMatchObject({
      state: "available",
      capturedAt: "2026-07-21T00:00:00.000Z",
      rawLimitation: "Snapshot supplied an English limitation.",
      reserved: false,
    });
    expect(cards[1]?.rawLimitation).toBeNull();
    expect(cards[2]).toMatchObject({
      state: "unavailable",
      capturedAt: null,
      rawLimitation: null,
      reserved: true,
    });
  });

  it("projects exact confirmed profile version and provenance, never a draft fallback", () => {
    const confirmed = {
      id: "00000000-0000-4000-8000-000000000051",
      projectId: PROJECT_ID,
      version: 7,
      status: "complete",
      contentHash: "a".repeat(64),
      createdAt: "2026-07-21T01:00:00.000Z",
      isCurrent: true,
      isConfirmed: true,
      profile: {
        sourceSiteId: SITE_ID,
        sourceSnapshotId: SNAPSHOT_ID,
        generatedAt: "2026-07-21T00:30:00.000Z",
        productName: "RelayOps",
        oneLiner: "Customer onboarding automation.",
        category: "Customer operations",
        productType: "B2B SaaS",
        businessModels: ["subscription"],
        valueProposition: "Standardize onboarding handoffs.",
        coreFeatures: ["Workflow automation"],
        targetMarkets: [{ marketCode: "US", priority: "primary" }],
        targetAudiences: [
          {
            candidateId: "00000000-0000-4000-8000-000000000052",
            reviewStatus: "primary",
            targetCompanyOrAudience: "B2B SaaS companies",
            buyerRoles: ["Customer Operations Lead"],
            userRoles: ["CSM"],
            useCases: ["Onboarding handoff"],
            triggers: ["Scaling customer volume"],
            pains: ["Inconsistent handoffs"],
            jtbd: ["Standardize onboarding"],
          },
        ],
        competitorCandidates: [
          { relationship: "direct", reviewStatus: "approved" },
          { relationship: "indirect", reviewStatus: "approved" },
          { relationship: "direct", reviewStatus: "excluded" },
        ],
      },
    } as unknown as ConfirmedProductProfileRowDto;

    expect(buildConfirmedProfileSummary(confirmed)).toMatchObject({
      profileId: confirmed.id,
      version: 7,
      contentHash: "a".repeat(64),
      productName: "RelayOps",
      primaryMarket: "US",
      primaryAudience: "B2B SaaS companies",
      buyerRoles: ["Customer Operations Lead"],
      jtbd: ["Standardize onboarding"],
      approvedDirectCompetitors: 1,
      approvedIndirectCompetitors: 1,
      sourceSiteId: SITE_ID,
      sourceSnapshotId: SNAPSHOT_ID,
    });
    expect(buildConfirmedProfileSummary(null)).toBeNull();
  });

  it("labels URL figures as one bounded frozen-audit page instead of inventing a project total", () => {
    const first = portfolioItem(
      "00000000-0000-4000-8000-000000000061",
      "high",
      2,
    );
    const second = portfolioItem(
      "00000000-0000-4000-8000-000000000062",
      null,
      0,
    );
    const response = {
      projectId: PROJECT_ID,
      siteId: SITE_ID,
      diagnosticRunId: RUN_ID,
      crawlSnapshotId: SNAPSHOT_ID,
      data: [first, second],
      meta: {
        limit: 100,
        nextCursor: "opaque-cursor",
        hasNext: true,
        coverage: { availability: "partial", limitations: ["GSC missing"] },
      },
    } as GrowthMapUrlPortfolioResponse;

    expect(buildPortfolioSummary(response)).toEqual({
      loadedUrlCount: 2,
      hasMore: true,
      findingCount: 2,
      reviewableFindingCount: 2,
      opportunityUrlCount: 1,
      diagnosticRunId: RUN_ID,
      coverage: response.meta.coverage,
    });
  });

  it("never mixes project work from a different frozen audit and still caps a matched run at three", () => {
    const actions = Array.from({ length: 4 }, (_, index) => ({
      id: `00000000-0000-4000-8000-0000000001${index}`,
      findingId: `00000000-0000-4000-8000-0000000002${index}`,
      title: `Action ${index}`,
    })) as unknown as readonly OverviewAction[];

    expect(
      selectProjectWorkItemsForFrozenRun(
        actions,
        "00000000-0000-4000-8000-000000000301",
        "00000000-0000-4000-8000-000000000302",
      ),
    ).toEqual([]);
    expect(
      selectProjectWorkItemsForFrozenRun(actions, RUN_ID, RUN_ID).map(
        (action) => action.title,
      ),
    ).toEqual(["Action 0", "Action 1", "Action 2"]);
    expect(selectProjectWorkItemsForFrozenRun(actions, null, RUN_ID)).toEqual(
      [],
    );
    expect(
      shouldRefreshFrozenRunPair({
        workspaceRunId: "00000000-0000-4000-8000-000000000301",
        portfolioRunId: "00000000-0000-4000-8000-000000000302",
        workspaceFetching: false,
        attemptedPortfolioRunId: null,
      }),
    ).toBe(true);
    expect(
      shouldRefreshFrozenRunPair({
        workspaceRunId: "00000000-0000-4000-8000-000000000301",
        portfolioRunId: "00000000-0000-4000-8000-000000000302",
        workspaceFetching: false,
        attemptedPortfolioRunId: "00000000-0000-4000-8000-000000000302",
      }),
    ).toBe(false);
  });

  it("shows a recent Result only when immutable before/current recheck anchors exist", () => {
    const current = portfolioItem(
      "00000000-0000-4000-8000-000000000081",
      "high",
      1,
    );
    expect(buildVerifiedResultSummary(current)).toBeNull();

    const verified = {
      ...current,
      delta: {
        availability: "available",
        value: "improved",
        summary: "The recheck resolved the current URL Finding.",
        limitation: null,
        basis: {
          findingIds: ["00000000-0000-4000-8000-000000000082"],
          before: {
            projectId: PROJECT_ID,
            siteId: SITE_ID,
            diagnosticRunId: "00000000-0000-4000-8000-000000000083",
            crawlSnapshotId: "00000000-0000-4000-8000-000000000084",
            sitePageId: current.sitePageId,
            pageSnapshotId: "00000000-0000-4000-8000-000000000085",
          },
          current: {
            projectId: PROJECT_ID,
            siteId: SITE_ID,
            diagnosticRunId: RUN_ID,
            crawlSnapshotId: SNAPSHOT_ID,
            sitePageId: current.sitePageId,
            pageSnapshotId: "00000000-0000-4000-8000-000000000086",
          },
        },
      },
    } as GrowthMapUrlPortfolioItem;

    expect(buildVerifiedResultSummary(verified)).toEqual({
      value: "improved",
      summary: "The recheck resolved the current URL Finding.",
      beforeDiagnosticRunId: "00000000-0000-4000-8000-000000000083",
      currentDiagnosticRunId: RUN_ID,
      beforePageSnapshotId: "00000000-0000-4000-8000-000000000085",
      currentPageSnapshotId: "00000000-0000-4000-8000-000000000086",
    });
  });

  it("builds only canonical Growth Map and Execution links", () => {
    expect(overviewGrowthMapHref(PROJECT_ID, null)).toBe(
      `/p/${PROJECT_ID}/growth-map?object=pages`,
    );
    expect(
      overviewGrowthMapHref(
        PROJECT_ID,
        "00000000-0000-4000-8000-000000000071",
      ),
    ).toBe(
      `/p/${PROJECT_ID}/growth-map?object=pages&selectedSitePageId=00000000-0000-4000-8000-000000000071`,
    );
  });
});
