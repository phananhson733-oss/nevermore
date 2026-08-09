import { describe, expect, it } from "vitest";
import {
  GrowthMapCompetitorDetailResponse,
  GrowthMapCompetitorLibraryResponse,
  GrowthMapKeywordDetailResponse,
  GrowthMapKeywordLibraryResponse,
  GrowthMapKeywordSourceCounts,
  GrowthMapKeywordSourceKind,
  GrowthMapKeywordSearchIntent,
  GrowthMapUrlDetailResponse,
  GrowthMapUrlFinding,
  GrowthMapUrlMetricObservation,
  GrowthMapUrlPortfolioResponse,
} from "./growth-map.ts";
import { ExecutionPreview } from "./execution-preview.ts";

const ids = {
  project: "10000000-0000-4000-8000-000000000001",
  site: "10000000-0000-4000-8000-000000000022",
  currentRun: "10000000-0000-4000-8000-000000000002",
  beforeRun: "10000000-0000-4000-8000-000000000003",
  currentCrawl: "10000000-0000-4000-8000-000000000004",
  beforeCrawl: "10000000-0000-4000-8000-000000000005",
  sitePage: "10000000-0000-4000-8000-000000000006",
  currentPageSnapshot: "10000000-0000-4000-8000-000000000007",
  beforePageSnapshot: "10000000-0000-4000-8000-000000000008",
  metricSnapshot: "10000000-0000-4000-8000-000000000009",
  metricObservation: "10000000-0000-4000-8000-000000000010",
  finding: "10000000-0000-4000-8000-000000000011",
  templateFinding: "10000000-0000-4000-8000-000000000012",
  evidence: "10000000-0000-4000-8000-000000000013",
  templateEvidence: "10000000-0000-4000-8000-000000000014",
  action: "10000000-0000-4000-8000-000000000015",
  artifact: "10000000-0000-4000-8000-000000000016",
  secondSitePage: "10000000-0000-4000-8000-000000000017",
  secondPageSnapshot: "10000000-0000-4000-8000-000000000018",
  gscOnlySitePage: "10000000-0000-4000-8000-000000000019",
  gscOnlySnapshot: "10000000-0000-4000-8000-000000000020",
  gscOnlyObservation: "10000000-0000-4000-8000-000000000021",
  siteFinding: "10000000-0000-4000-8000-000000000023",
  aggregateFinding: "10000000-0000-4000-8000-000000000024",
  aggregateEvidence: "10000000-0000-4000-8000-000000000025",
  keyword: "10000000-0000-4000-8000-000000000026",
  keyword2: "10000000-0000-4000-8000-000000000027",
  keywordOccurrence: "10000000-0000-4000-8000-000000000028",
  keywordManualOccurrence: "10000000-0000-4000-8000-000000000029",
  keywordManualEntry: "10000000-0000-4000-8000-000000000030",
  cluster: "10000000-0000-4000-8000-000000000031",
  competitor: "10000000-0000-4000-8000-000000000032",
  competitor2: "10000000-0000-4000-8000-000000000033",
  competitorOccurrence: "10000000-0000-4000-8000-000000000034",
  competitorOccurrence2: "10000000-0000-4000-8000-000000000035",
  productProfile: "10000000-0000-4000-8000-000000000036",
  competitorCandidate: "10000000-0000-4000-8000-000000000037",
  import: "10000000-0000-4000-8000-000000000038",
  manualEntry: "10000000-0000-4000-8000-000000000039",
  serpSnapshot: "10000000-0000-4000-8000-000000000040",
  serpObservation: "10000000-0000-4000-8000-000000000041",
  aiSnapshot: "10000000-0000-4000-8000-000000000042",
  aiObservation: "10000000-0000-4000-8000-000000000043",
  analysisInvocation: "10000000-0000-4000-8000-000000000044",
} as const;

function comparisonBasis() {
  return {
    findingIds: [ids.finding],
    before: {
      projectId: ids.project,
      siteId: ids.site,
      diagnosticRunId: ids.beforeRun,
      crawlSnapshotId: ids.beforeCrawl,
      sitePageId: ids.sitePage,
      pageSnapshotId: ids.beforePageSnapshot,
    },
    current: {
      projectId: ids.project,
      siteId: ids.site,
      diagnosticRunId: ids.currentRun,
      crawlSnapshotId: ids.currentCrawl,
      sitePageId: ids.sitePage,
      pageSnapshotId: ids.currentPageSnapshot,
    },
  };
}

function priorityBasis() {
  return {
    derivationVersion: "max_finding_severity.v1",
    projectId: ids.project,
    siteId: ids.site,
    diagnosticRunId: ids.currentRun,
    sitePageId: ids.sitePage,
    findingIds: [ids.finding],
  };
}

function metricObservation() {
  return {
    metricKey: "gsc.page.v1",
    valueSource: {
      kind: "value_json",
      pointer: "/current28d/clicks",
    },
    subjectRef: "https://example.com/customer-onboarding/",
    value: 2450,
    unit: null,
    availability: "available",
    provider: "gsc",
    snapshotId: ids.metricSnapshot,
    observationId: ids.metricObservation,
    sitePageId: ids.sitePage,
    observedAt: "2026-07-21T08:00:00Z",
    freshness: "current",
    limitation: null,
  };
}

function unavailablePriority() {
  return {
    availability: "unavailable",
    value: null,
    limitation: "No canonical Finding comparison is available.",
  };
}

function unavailableDelta() {
  return {
    availability: "unavailable",
    value: null,
    limitation: "No immutable previous page snapshot is available.",
  };
}

function portfolioItem() {
  return {
    projectId: ids.project,
    siteId: ids.site,
    diagnosticRunId: ids.currentRun,
    crawlSnapshotId: ids.currentCrawl,
    sitePageId: ids.sitePage,
    pageSnapshotId: ids.currentPageSnapshot,
    pageSnapshotCapturedAt: "2026-07-21T07:55:00Z",
    identitySources: [
      {
        kind: "page_snapshot",
        provider: "crawl",
        snapshotId: ids.currentCrawl,
        pageSnapshotId: ids.currentPageSnapshot,
        observedAt: "2026-07-21T07:55:00Z",
      },
      {
        kind: "url_observation",
        provider: "gsc",
        snapshotId: ids.metricSnapshot,
        observationId: ids.metricObservation,
        sitePageId: ids.sitePage,
        subjectRef: "https://example.com/customer-onboarding/",
        observedAt: "2026-07-21T08:00:00Z",
      },
    ],
    normalizedUrl: "https://example.com/customer-onboarding/",
    title: "Customer onboarding",
    pageType: "product",
    templateKey: "product-detail",
    clusterKey: null,
    ownerId: null,
    coverage: {
      availability: "partial",
      limitations: ["Field data is not connected for this URL."],
    },
    metricObservations: [metricObservation()],
    findingIds: [ids.finding, ids.templateFinding],
    reviewableFindingIds: [ids.finding],
    priority: {
      availability: "available",
      value: "high",
      basis: priorityBasis(),
      limitation: null,
    },
    delta: {
      availability: "available",
      value: "improved",
      basis: comparisonBasis(),
      summary: "The immutable recheck resolved one canonical URL issue.",
      limitation: null,
    },
  };
}

function secondPortfolioItem() {
  return {
    projectId: ids.project,
    siteId: ids.site,
    diagnosticRunId: ids.currentRun,
    crawlSnapshotId: ids.currentCrawl,
    sitePageId: ids.secondSitePage,
    pageSnapshotId: ids.secondPageSnapshot,
    pageSnapshotCapturedAt: "2026-07-21T07:55:00Z",
    identitySources: [
      {
        kind: "page_snapshot",
        provider: "crawl",
        snapshotId: ids.currentCrawl,
        pageSnapshotId: ids.secondPageSnapshot,
        observedAt: "2026-07-21T07:55:00Z",
      },
    ],
    normalizedUrl: "https://example.com/docs/",
    title: null,
    pageType: null,
    templateKey: null,
    clusterKey: null,
    ownerId: null,
    coverage: {
      availability: "unavailable",
      limitations: ["The URL was discovered but its page body was unavailable."],
    },
    metricObservations: [],
    findingIds: [],
    reviewableFindingIds: [],
    priority: unavailablePriority(),
    delta: unavailableDelta(),
  };
}

function gscOnlyPortfolioItem() {
  return {
    ...secondPortfolioItem(),
    sitePageId: ids.gscOnlySitePage,
    pageSnapshotId: null,
    pageSnapshotCapturedAt: null,
    normalizedUrl: "https://example.com/gsc-only-landing",
    identitySources: [
      {
        kind: "url_observation",
        provider: "gsc",
        snapshotId: ids.gscOnlySnapshot,
        observationId: ids.gscOnlyObservation,
        sitePageId: ids.gscOnlySitePage,
        subjectRef: "https://example.com/gsc-only-landing",
        observedAt: "2026-07-21T08:00:00Z",
      },
    ],
  };
}

function portfolioSummary() {
  return {
    urlCount: 12,
    opportunityUrlCount: 5,
    listedUrlCount: 5,
    signalCount: 3,
    priorityCounts: { critical: 1, high: 1, medium: 2, low: 1 },
    precedingUrlCount: 0,
  };
}

function portfolioResponse() {
  return {
    projectId: ids.project,
    siteId: ids.site,
    diagnosticRunId: ids.currentRun,
    crawlSnapshotId: ids.currentCrawl,
    data: [portfolioItem(), secondPortfolioItem()],
    meta: {
      limit: 50,
      nextCursor: "bmV4dC1wYWdl",
      hasNext: true,
      coverage: {
        availability: "partial",
        limitations: ["One discovered URL could not be collected."],
      },
      summary: portfolioSummary(),
    },
  };
}

/** A terminal page must account for exactly the filtered rows it reports. */
function lastPageMeta(dataLength: number) {
  const meta = portfolioResponse().meta;
  return {
    ...meta,
    nextCursor: null,
    hasNext: false,
    summary: { ...meta.summary, listedUrlCount: dataLength },
  };
}

function findings() {
  return [
    {
      projectId: ids.project,
      siteId: ids.site,
      findingId: ids.finding,
      diagnosticRunId: ids.currentRun,
      ruleId: "TECH-CANONICAL-002",
      ruleVersion: 2,
      title: "Canonical points to another URL",
      severity: "high",
      reviewState: "unreviewed",
      reviewRevision: 0,
      active: true,
      regressed: false,
      evidenceIds: [ids.evidence],
      targetRelation: {
        relation: "direct_url",
        targetKind: "url",
        targetRef: "https://example.com/customer-onboarding/",
        sitePageId: ids.sitePage,
        pageSnapshotId: ids.currentPageSnapshot,
      },
      executionPreview: {
        templateId: "normalize_canonical.v1",
        templateVersion: 1,
        artifactType: "technical_ticket",
        effort: "medium",
        risk: "high",
        contentLocale: "en",
        title: "Normalize conflicting canonical tags",
        description: "Resolve conflicting canonical signals.",
        expectedOutcome: "Validate that each page has one canonical URL.",
      },
      executionRef: {
        actionId: ids.action,
        artifactIds: [ids.artifact],
      },
    },
    {
      projectId: ids.project,
      siteId: ids.site,
      findingId: ids.templateFinding,
      diagnosticRunId: ids.currentRun,
      ruleId: "TECH-LINKGRAPH-005",
      ruleVersion: 2,
      title: "Product pages are weakly linked",
      severity: "medium",
      reviewState: "confirmed",
      reviewRevision: 1,
      active: true,
      regressed: false,
      evidenceIds: [ids.templateEvidence],
      targetRelation: {
        relation: "affected_by_template",
        targetKind: "template",
        targetRef: "product-detail",
      },
      executionPreview: null,
      executionRef: null,
    },
  ];
}

function detailResponse() {
  return {
    projectId: ids.project,
    siteId: ids.site,
    diagnosticRunId: ids.currentRun,
    crawlSnapshotId: ids.currentCrawl,
    data: {
      ...portfolioItem(),
      findings: findings(),
    },
  };
}

describe("Growth Map URL contracts", () => {
  it("projects a persisted GSC Observation through its durable SitePage lineage without fabricating a PageSnapshot", () => {
    const metric = {
      metricKey: "gsc.page.v1",
      valueSource: {
        kind: "value_json",
        pointer: "/current28d/clicks",
      },
      subjectRef: "https://example.com/customer-onboarding/",
      value: 2450,
      unit: null,
      availability: "available",
      provider: "gsc",
      snapshotId: ids.metricSnapshot,
      observationId: ids.metricObservation,
      sitePageId: ids.sitePage,
      observedAt: "2026-07-21T08:00:00Z",
      freshness: "current",
      limitation: null,
    };
    const response = portfolioResponse();

    const projection = {
      ...response,
      data: [
        {
          ...portfolioItem(),
          metricObservations: [metric],
        },
      ],
      meta: lastPageMeta(1),
    };

    expect(GrowthMapUrlPortfolioResponse.safeParse(projection).success).toBe(
      true,
    );
    expect(
      GrowthMapUrlMetricObservation.safeParse({
        ...metric,
        pageSnapshotId: ids.currentPageSnapshot,
      }).success,
    ).toBe(false);
    expect(
      GrowthMapUrlPortfolioResponse.safeParse({
        ...projection,
        data: [
          {
            ...projection.data[0],
            metricObservations: [
              { ...metric, sitePageId: ids.secondSitePage },
            ],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      GrowthMapUrlPortfolioResponse.safeParse({
        ...projection,
        data: [
          {
            ...projection.data[0],
            identitySources: portfolioItem().identitySources.filter(
              (source) => source.kind !== "url_observation",
            ),
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      GrowthMapUrlPortfolioResponse.safeParse({
        ...projection,
        data: [
          {
            ...projection.data[0],
            metricObservations: [
              {
                ...metric,
                subjectRef: "https://example.com/a-different-url/",
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("uses persisted SitePage lineage when canonical Observation subject and exact URL differ by a trailing slash", () => {
    const item = portfolioItem();
    const canonicalSubject = "https://example.com/customer-onboarding";
    const identitySources = item.identitySources.map((source) =>
      source.kind === "url_observation"
        ? { ...source, subjectRef: canonicalSubject }
        : source,
    );
    const metricObservations = item.metricObservations.map((observation) => ({
      ...observation,
      subjectRef: canonicalSubject,
    }));

    expect(
      GrowthMapUrlPortfolioResponse.safeParse({
        ...portfolioResponse(),
        data: [{ ...item, identitySources, metricObservations }],
        meta: lastPageMeta(1),
      }).success,
    ).toBe(true);

    expect(
      GrowthMapUrlPortfolioResponse.safeParse({
        ...portfolioResponse(),
        data: [
          {
            ...item,
            identitySources: identitySources.map((source) =>
              source.kind === "url_observation"
                ? { ...source, sitePageId: ids.secondSitePage }
                : source,
            ),
            metricObservations,
          },
        ],
        meta: lastPageMeta(1),
      }).success,
    ).toBe(false);
  });

  it("allows one template or Site Finding to be related to multiple selected URLs", () => {
    const sharedTemplateFinding = {
      ...findings()[1],
      targetRelation: {
        relation: "affected_by_template",
        targetKind: "template",
        targetRef: "product-detail",
      },
    };
    const sharedSiteFinding = {
      ...findings()[1],
      findingId: ids.siteFinding,
      ruleId: "TECH-LINKGRAPH-006",
      targetRelation: {
        relation: "affected_by_site",
        targetKind: "site",
        targetRef: "example.com",
      },
    };
    const sharedFindings = [sharedTemplateFinding, sharedSiteFinding];

    for (const item of [
      {
        ...portfolioItem(),
        metricObservations: [],
        findingIds: [ids.templateFinding, ids.siteFinding],
        reviewableFindingIds: [],
        priority: unavailablePriority(),
        delta: unavailableDelta(),
      },
      {
        ...secondPortfolioItem(),
        templateKey: "product-detail",
        findingIds: [ids.templateFinding, ids.siteFinding],
        reviewableFindingIds: [],
      },
    ]) {
      expect(
        GrowthMapUrlDetailResponse.safeParse({
          projectId: ids.project,
          siteId: ids.site,
          diagnosticRunId: ids.currentRun,
          crawlSnapshotId: ids.currentCrawl,
          data: { ...item, findings: sharedFindings },
        }).success,
      ).toBe(true);
    }

    const portfolio = portfolioResponse();
    expect(
      GrowthMapUrlPortfolioResponse.safeParse({
        ...portfolio,
        data: [
          {
            ...portfolioItem(),
            findingIds: [ids.templateFinding, ids.siteFinding],
            reviewableFindingIds: [],
            priority: unavailablePriority(),
            delta: unavailableDelta(),
          },
          {
            ...secondPortfolioItem(),
            templateKey: "product-detail",
            findingIds: [ids.templateFinding, ids.siteFinding],
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("accepts every current canonical aggregate Finding target through explicit union branches", () => {
    const targetRelations = [
      {
        relation: "affected_by_page_set",
        targetKind: "page_set",
        targetRef: "low_internal_inlinks",
      },
      {
        relation: "affected_by_http_status",
        targetKind: "http_status",
        targetRef: "404",
      },
      {
        relation: "affected_by_canonical_issue",
        targetKind: "canonical_issue",
        targetRef: "reciprocal",
      },
      {
        relation: "affected_by_keyword_cluster",
        targetKind: "keyword_cluster",
        targetRef: "customer-onboarding",
      },
      {
        relation: "affected_by_user_agent",
        targetKind: "user_agent",
        targetRef: "ClaudeBot",
      },
    ] as const;

    for (const targetRelation of targetRelations) {
      const item = {
        ...portfolioItem(),
        metricObservations: [],
        findingIds: [ids.aggregateFinding],
        reviewableFindingIds: [],
        priority: unavailablePriority(),
        delta: unavailableDelta(),
      };
      expect(
        GrowthMapUrlDetailResponse.safeParse({
          projectId: ids.project,
          siteId: ids.site,
          diagnosticRunId: ids.currentRun,
          crawlSnapshotId: ids.currentCrawl,
          data: {
            ...item,
            findings: [
              {
                projectId: ids.project,
                siteId: ids.site,
                findingId: ids.aggregateFinding,
                diagnosticRunId: ids.currentRun,
                ruleId: "TECH-LINKGRAPH-007",
                ruleVersion: 2,
                title: "A canonical aggregate target affects this URL",
                severity: "medium",
                reviewState: "unreviewed",
                reviewRevision: 0,
                active: true,
                regressed: false,
                evidenceIds: [ids.aggregateEvidence],
                targetRelation,
                executionPreview: null,
                executionRef: null,
              },
            ],
          },
        }).success,
      ).toBe(true);
    }

    const base = detailResponse();
    expect(
      GrowthMapUrlDetailResponse.safeParse({
        ...base,
        data: {
          ...base.data,
          findings: [
            findings()[0],
            {
              ...findings()[1],
              targetRelation: {
                relation: "affected_by_future_magic",
                targetKind: "future_magic",
                targetRef: "unbounded",
              },
            },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it("accepts only real provider and URL metric-key combinations", () => {
    for (const metric of [
      { ...metricObservation(), provider: "gsc", metricKey: "gsc.page.v1" },
      {
        ...metricObservation(),
        provider: "ga4",
        metricKey: "ga4.landing.v1",
      },
      {
        ...metricObservation(),
        provider: "crawl",
        metricKey: "crawl.page.v1",
      },
    ]) {
      expect(GrowthMapUrlMetricObservation.safeParse(metric).success).toBe(true);
    }

    for (const metric of [
      { ...metricObservation(), provider: "pagespeed" },
      { ...metricObservation(), provider: "ga4", metricKey: "gsc.page.v1" },
      { ...metricObservation(), provider: "gsc", metricKey: "ga4.landing.v1" },
      {
        ...metricObservation(),
        provider: "crawl",
        metricKey: "crawl.robots.v1",
      },
    ]) {
      expect(GrowthMapUrlMetricObservation.safeParse(metric).success).toBe(false);
    }
  });

  it("accepts a bounded project portfolio with multiple canonically identified URLs", () => {
    const parsed = GrowthMapUrlPortfolioResponse.parse(portfolioResponse());

    expect(parsed.data).toHaveLength(2);
    expect(parsed.data.map((item) => item.sitePageId)).toEqual([
      ids.sitePage,
      ids.secondSitePage,
    ]);
    expect(parsed.meta).toEqual(
      expect.objectContaining({ limit: 50, hasNext: true }),
    );
    expect(parsed).not.toHaveProperty("total");
  });

  it("accepts a canonically identified GSC landing page without a Crawl PageSnapshot", () => {
    const response = portfolioResponse();
    const parsed = GrowthMapUrlPortfolioResponse.parse({
      ...response,
      data: [portfolioItem(), gscOnlyPortfolioItem()],
    });

    expect(parsed.data[1]).toMatchObject({
      sitePageId: ids.gscOnlySitePage,
      pageSnapshotId: null,
      pageSnapshotCapturedAt: null,
      identitySources: [
        expect.objectContaining({
          kind: "url_observation",
          observationId: ids.gscOnlyObservation,
        }),
      ],
    });
  });

  it("rejects a URL row whose SitePage identity has no matching immutable source", () => {
    const response = portfolioResponse();
    for (const item of [
      { ...gscOnlyPortfolioItem(), identitySources: [] },
      {
        ...gscOnlyPortfolioItem(),
        identitySources: portfolioItem().identitySources,
      },
      {
        ...gscOnlyPortfolioItem(),
        identitySources: [
          {
            ...gscOnlyPortfolioItem().identitySources[0],
            sitePageId: ids.secondSitePage,
          },
        ],
      },
      {
        ...portfolioItem(),
        identitySources: secondPortfolioItem().identitySources,
      },
    ]) {
      expect(
        GrowthMapUrlPortfolioResponse.safeParse({
          ...response,
          data: [item],
          meta: lastPageMeta(1),
        }).success,
      ).toBe(false);
    }
  });

  it("accepts selected URL detail with direct and template Finding relations", () => {
    const parsed = GrowthMapUrlDetailResponse.parse(detailResponse());

    expect(parsed.data.findings.map((finding) => finding.findingId)).toEqual([
      ids.finding,
      ids.templateFinding,
    ]);
    expect(parsed.data.findings[0]?.executionRef).toEqual({
      actionId: ids.action,
      artifactIds: [ids.artifact],
    });
  });

  it("uses the shared nullable ExecutionPreview without changing canonical execution state", () => {
    const preview = findings()[0]!.executionPreview;
    expect(ExecutionPreview.parse(preview)).toEqual(preview);

    const unconfirmed = GrowthMapUrlFinding.parse({
      ...findings()[0],
      reviewState: "unreviewed",
      executionRef: null,
    });
    expect(unconfirmed.executionPreview).toEqual(preview);
    expect(unconfirmed.reviewState).toBe("unreviewed");
    expect(unconfirmed.executionRef).toBeNull();

    expect(
      GrowthMapUrlFinding.safeParse({
        ...findings()[0],
        executionPreview: { ...preview, actionId: ids.action },
      }).success,
    ).toBe(false);
    expect(
      GrowthMapUrlFinding.safeParse({
        ...findings()[0],
        executionPreview: undefined,
      }).success,
    ).toBe(false);
  });

  it("requires strict bounded cursor metadata without copied project totals", () => {
    for (const invalidMeta of [
      { ...portfolioResponse().meta, limit: 0 },
      { ...portfolioResponse().meta, limit: 101 },
      { ...portfolioResponse().meta, nextCursor: null, hasNext: true },
      { ...portfolioResponse().meta, nextCursor: "next page" },
    ]) {
      expect(
        GrowthMapUrlPortfolioResponse.safeParse({
          ...portfolioResponse(),
          meta: invalidMeta,
        }).success,
      ).toBe(false);
    }

    expect(
      GrowthMapUrlPortfolioResponse.safeParse({
        ...portfolioResponse(),
        meta: { ...portfolioResponse().meta, total: 8 },
      }).success,
    ).toBe(false);
    expect(
      GrowthMapUrlPortfolioResponse.safeParse({
        ...portfolioResponse(),
        meta: { ...portfolioResponse().meta, limit: 1 },
      }).success,
    ).toBe(false);
  });

  it("requires a frozen-generation summary alongside the cursor page", () => {
    const response = portfolioResponse();
    const withoutSummary = { ...response.meta } as Record<string, unknown>;
    delete withoutSummary["summary"];

    expect(
      GrowthMapUrlPortfolioResponse.safeParse({
        ...response,
        meta: withoutSummary,
      }).success,
    ).toBe(false);

    expect(GrowthMapUrlPortfolioResponse.safeParse(response).success).toBe(true);
    expect(
      GrowthMapUrlPortfolioResponse.parse(response).meta.summary,
    ).toEqual(portfolioSummary());
  });

  it("rejects a summary that contradicts its own frozen generation counts", () => {
    const response = portfolioResponse();
    for (const summary of [
      // Opportunity URLs can never exceed the admitted inventory.
      { ...portfolioSummary(), opportunityUrlCount: 13 },
      // Neither can the filtered list.
      { ...portfolioSummary(), listedUrlCount: 13 },
      // Preceding rows are part of the same filtered list.
      { ...portfolioSummary(), precedingUrlCount: 6 },
      // Every opportunity URL lands in exactly one band.
      {
        ...portfolioSummary(),
        priorityCounts: { critical: 0, high: 1, medium: 2, low: 1 },
      },
      {
        ...portfolioSummary(),
        priorityCounts: { critical: 2, high: 1, medium: 2, low: 1 },
      },
      // Counts are non-negative integers, never a signed placeholder.
      { ...portfolioSummary(), signalCount: -1 },
      { ...portfolioSummary(), urlCount: 1.5 },
    ]) {
      expect(
        GrowthMapUrlPortfolioResponse.safeParse({
          ...response,
          meta: { ...response.meta, summary },
        }).success,
      ).toBe(false);
    }
  });

  it("keeps the page, its offset and the filtered total mutually consistent", () => {
    const response = portfolioResponse();

    // Rows read through this page cannot exceed the filtered list.
    expect(
      GrowthMapUrlPortfolioResponse.safeParse({
        ...response,
        meta: {
          ...response.meta,
          summary: {
            ...portfolioSummary(),
            precedingUrlCount: 4,
            listedUrlCount: 5,
          },
        },
      }).success,
    ).toBe(false);

    // A terminal page must complete the filtered list it reports.
    expect(
      GrowthMapUrlPortfolioResponse.safeParse({
        ...response,
        meta: {
          ...response.meta,
          nextCursor: null,
          hasNext: false,
          summary: { ...portfolioSummary(), precedingUrlCount: 0 },
        },
      }).success,
    ).toBe(false);

    expect(
      GrowthMapUrlPortfolioResponse.safeParse({
        ...response,
        meta: {
          ...response.meta,
          nextCursor: null,
          hasNext: false,
          summary: {
            ...portfolioSummary(),
            precedingUrlCount: 3,
            listedUrlCount: 5,
          },
        },
      }).success,
    ).toBe(true);
  });

  it("reads both published priority derivations without rewriting history", () => {
    const response = portfolioResponse();
    const withDerivation = (derivationVersion: string) => ({
      ...response,
      data: [
        {
          ...portfolioItem(),
          priority: {
            ...portfolioItem().priority,
            basis: { ...priorityBasis(), derivationVersion },
          },
        },
      ],
      meta: lastPageMeta(1),
    });

    for (const derivationVersion of [
      "max_finding_severity.v1",
      "url_opportunity_rank.v1",
    ]) {
      expect(
        GrowthMapUrlPortfolioResponse.safeParse(withDerivation(derivationVersion))
          .success,
      ).toBe(true);
    }
    for (const derivationVersion of [
      "url_opportunity_rank.v2",
      "max_finding_severity",
      "",
    ]) {
      expect(
        GrowthMapUrlPortfolioResponse.safeParse(withDerivation(derivationVersion))
          .success,
      ).toBe(false);
    }
  });

  it("requires an explicit limitation whenever URL coverage is not available", () => {
    for (const availability of ["partial", "stale", "unavailable"] as const) {
      expect(
        GrowthMapUrlPortfolioResponse.safeParse({
          ...portfolioResponse(),
          meta: {
            ...portfolioResponse().meta,
            coverage: { availability, limitations: [] },
          },
        }).success,
      ).toBe(false);
    }
  });

  it("rejects URL metrics that omit canonical observation identity", () => {
    for (const field of [
      "provider",
      "metricKey",
      "subjectRef",
      "snapshotId",
      "observationId",
      "sitePageId",
      "observedAt",
      "freshness",
    ] as const) {
      const metric = { ...metricObservation() };
      delete metric[field];
      expect(GrowthMapUrlMetricObservation.safeParse(metric).success).toBe(
        false,
      );
    }

    expect(
      GrowthMapUrlPortfolioResponse.safeParse({
        ...portfolioResponse(),
        data: [{ ...portfolioItem(), performanceScore: 0 }],
      }).success,
    ).toBe(false);
  });

  it("uses null with unavailable instead of zero for missing metric data", () => {
    expect(
      GrowthMapUrlMetricObservation.safeParse({
        ...metricObservation(),
        availability: "unavailable",
        value: null,
        freshness: "unknown",
        limitation: "The provider returned no URL-level observation.",
      }).success,
    ).toBe(true);
    expect(
      GrowthMapUrlMetricObservation.safeParse({
        ...metricObservation(),
        availability: "unavailable",
        value: 0,
        freshness: "unknown",
        limitation: "The provider returned no URL-level observation.",
      }).success,
    ).toBe(false);

    // An actually observed zero remains valid because it has canonical identity.
    expect(
      GrowthMapUrlMetricObservation.safeParse({
        ...metricObservation(),
        value: 0,
      }).success,
    ).toBe(true);
  });

  it("mirrors persisted partial Observation null semantics without inventing a value", () => {
    expect(
      GrowthMapUrlMetricObservation.safeParse({
        ...metricObservation(),
        availability: "partial",
        value: null,
        limitation: "The provider returned incomplete URL-level data.",
      }).success,
    ).toBe(true);
    expect(
      GrowthMapUrlMetricObservation.safeParse({
        ...metricObservation(),
        availability: "partial",
        value: 0,
        limitation: "The provider returned incomplete URL-level data.",
      }).success,
    ).toBe(false);
  });

  it("projects multiple scalar fields from one real JSON Observation without inventing Observation IDs", () => {
    const clicks = metricObservation();
    const position = {
      ...metricObservation(),
      valueSource: {
        kind: "value_json",
        pointer: "/current28d/position",
      },
      value: 12.8,
    };
    const response = portfolioResponse();

    expect(
      GrowthMapUrlPortfolioResponse.safeParse({
        ...response,
        data: [
          {
            ...portfolioItem(),
            metricObservations: [clicks, position],
          },
        ],
        meta: lastPageMeta(1),
      }).success,
    ).toBe(true);

    expect(
      GrowthMapUrlPortfolioResponse.safeParse({
        ...response,
        data: [
          {
            ...portfolioItem(),
            metricObservations: [clicks, clicks],
          },
        ],
        meta: lastPageMeta(1),
      }).success,
    ).toBe(false);
  });

  it("requires canonical current-run priority and immutable before/current delta bases", () => {
    expect(
      GrowthMapUrlPortfolioResponse.safeParse({
        ...portfolioResponse(),
        data: [
          {
            ...portfolioItem(),
            priority: unavailablePriority(),
            delta: unavailableDelta(),
          },
        ],
        meta: lastPageMeta(1),
      }).success,
    ).toBe(true);

    // A current-run Finding can establish priority before any historical
    // recheck exists; only delta requires immutable before/current snapshots.
    expect(
      GrowthMapUrlPortfolioResponse.safeParse({
        ...portfolioResponse(),
        data: [
          {
            ...portfolioItem(),
            delta: unavailableDelta(),
          },
        ],
        meta: lastPageMeta(1),
      }).success,
    ).toBe(true);

    for (const invalidPriority of [
      { availability: "available", value: "high", limitation: null },
      {
        availability: "unavailable",
        value: "high",
        limitation: "No basis.",
      },
      {
        availability: "available",
        value: "high",
        basis: { ...priorityBasis(), findingIds: [] },
        limitation: null,
      },
      {
        availability: "available",
        value: "high",
        basis: {
          ...priorityBasis(),
          findingIds: ["20000000-0000-4000-8000-000000000001"],
        },
        limitation: null,
      },
    ]) {
      expect(
        GrowthMapUrlPortfolioResponse.safeParse({
          ...portfolioResponse(),
          data: [{ ...portfolioItem(), priority: invalidPriority }],
        }).success,
      ).toBe(false);
    }

    expect(
      GrowthMapUrlPortfolioResponse.safeParse({
        ...portfolioResponse(),
        data: [
          {
            ...portfolioItem(),
            delta: {
              availability: "available",
              value: "improved",
              summary: "A synthetic comparison.",
              limitation: null,
            },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects selected detail whose response and URL anchors disagree", () => {
    const foreign = "20000000-0000-4000-8000-000000000001";
    for (const field of [
      "projectId",
      "siteId",
      "diagnosticRunId",
      "crawlSnapshotId",
    ] as const) {
      expect(
        GrowthMapUrlDetailResponse.safeParse({
          ...detailResponse(),
          [field]: foreign,
        }).success,
      ).toBe(false);
    }
  });

  it("rejects scope drift across repeated project, run, crawl, and page anchors", () => {
    const foreign = "20000000-0000-4000-8000-000000000001";
    const cases = [
      { ...portfolioItem(), projectId: foreign },
      { ...portfolioItem(), siteId: foreign },
      { ...portfolioItem(), diagnosticRunId: foreign },
      { ...portfolioItem(), crawlSnapshotId: foreign },
      {
        ...portfolioItem(),
        metricObservations: [
          { ...metricObservation(), observationId: foreign },
        ],
      },
      {
        ...portfolioItem(),
        priority: {
          ...portfolioItem().priority,
          basis: {
            ...priorityBasis(),
            diagnosticRunId: foreign,
          },
        },
      },
      {
        ...portfolioItem(),
        delta: {
          ...portfolioItem().delta,
          basis: {
            ...comparisonBasis(),
            current: {
              ...comparisonBasis().current,
              pageSnapshotId: foreign,
            },
          },
        },
      },
    ];

    for (const item of cases) {
      expect(
        GrowthMapUrlPortfolioResponse.safeParse({
          ...portfolioResponse(),
          data: [item],
        }).success,
      ).toBe(false);
    }
  });

  it("rejects a before/current comparison that reuses mutable identities", () => {
    const sameComparison = {
      ...comparisonBasis(),
      before: {
        ...comparisonBasis().before,
        diagnosticRunId: ids.currentRun,
        crawlSnapshotId: ids.currentCrawl,
        pageSnapshotId: ids.currentPageSnapshot,
      },
    };

    expect(
      GrowthMapUrlPortfolioResponse.safeParse({
        ...portfolioResponse(),
        data: [
          {
            ...portfolioItem(),
            delta: {
              ...portfolioItem().delta,
              basis: sameComparison,
            },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("requires each Finding to match the selected run and canonical page relation", () => {
    const foreign = "20000000-0000-4000-8000-000000000001";
    const base = detailResponse();

    for (const invalidFinding of [
      { ...findings()[0], diagnosticRunId: foreign },
      { ...findings()[0], reviewRevision: -1 },
      (({ reviewRevision: _omitted, ...finding }) => finding)(findings()[0]!),
      { ...findings()[0], evidenceIds: [] },
      {
        ...findings()[0],
        targetRelation: {
          ...findings()[0]!.targetRelation,
          sitePageId: foreign,
        },
      },
      {
        ...findings()[0],
        targetRelation: {
          ...findings()[0]!.targetRelation,
          targetRef: "https://example.com/a-different-url/",
        },
      },
    ]) {
      expect(
        GrowthMapUrlDetailResponse.safeParse({
          ...base,
          data: { ...base.data, findings: [invalidFinding, findings()[1]] },
        }).success,
      ).toBe(false);
    }

    expect(
      GrowthMapUrlDetailResponse.safeParse({
        ...base,
        data: {
          ...base.data,
          findings: [
            {
              ...findings()[0],
              targetRelation: {
                targetKind: "url",
                targetRef: "https://example.com/customer-onboarding/",
              },
            },
            findings()[1],
          ],
        },
      }).success,
    ).toBe(false);
  });

  it("exposes Action and Artifact references only as canonical IDs", () => {
    const base = detailResponse();
    expect(
      GrowthMapUrlDetailResponse.safeParse({
        ...base,
        data: {
          ...base.data,
          findings: [
            {
              ...findings()[0],
              executionRef: {
                ...findings()[0]!.executionRef,
                status: "done",
              },
            },
            findings()[1],
          ],
        },
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate URL, observation, Finding, Evidence, Action, and Artifact identities", () => {
    for (const duplicateIdentity of [
      { sitePageId: ids.sitePage },
      { pageSnapshotId: ids.currentPageSnapshot },
      { normalizedUrl: portfolioItem().normalizedUrl },
    ]) {
      expect(
        GrowthMapUrlPortfolioResponse.safeParse({
          ...portfolioResponse(),
          data: [
            portfolioItem(),
            { ...secondPortfolioItem(), ...duplicateIdentity },
          ],
        }).success,
      ).toBe(false);
    }

    expect(
      GrowthMapUrlPortfolioResponse.safeParse({
        ...portfolioResponse(),
        data: [
          {
            ...portfolioItem(),
            metricObservations: [metricObservation(), metricObservation()],
          },
        ],
      }).success,
    ).toBe(false);

    expect(
      GrowthMapUrlPortfolioResponse.safeParse({
        ...portfolioResponse(),
        data: [
          {
            ...portfolioItem(),
            reviewableFindingIds: [ids.finding, ids.finding],
          },
        ],
      }).success,
    ).toBe(false);

    const base = detailResponse();
    for (const invalidFindings of [
      [findings()[0], findings()[0]],
      [
        {
          ...findings()[0],
          evidenceIds: [ids.evidence, ids.evidence],
        },
        findings()[1],
      ],
      [
        findings()[0],
        {
          ...findings()[1],
          executionRef: { actionId: ids.action, artifactIds: [] },
        },
      ],
      [
        findings()[0],
        {
          ...findings()[1],
          executionRef: {
            actionId: "20000000-0000-4000-8000-000000000002",
            artifactIds: [ids.artifact],
          },
        },
      ],
    ]) {
      expect(
        GrowthMapUrlDetailResponse.safeParse({
          ...base,
          data: { ...base.data, findings: invalidFindings },
        }).success,
      ).toBe(false);
    }
  });
});

function keywordSourceOccurrence() {
  return {
    occurrenceId: ids.keywordOccurrence,
    sourceKind: "dataforseo_ranked",
    snapshotId: ids.metricSnapshot,
    sourceObservationId: ids.metricObservation,
    sourcePointer: "/valueJson/keyword",
    collectedAt: "2026-07-21T08:00:00Z",
    providerDataAsOf: null,
    freshness: "unknown",
    limitation:
      "The provider response does not declare a separate data-as-of timestamp.",
    scopeBasis: "provider_collection_scope",
    scopeLimitation: null,
    marketCode: "US",
    languageTag: "en-US",
  };
}

function productProfileKeywordSourceOccurrence() {
  return {
    occurrenceId: "10000000-0000-4000-8000-000000000070",
    sourceKind: "product_profile",
    productProfileId: ids.productProfile,
    snapshotId: null,
    sourceObservationId: null,
    sourcePointer: null,
    collectedAt: "2026-07-21T08:04:00Z",
    providerDataAsOf: null,
    freshness: "unknown",
    limitation:
      "Product Profile-derived GenerativeQuery has no provider data-as-of timestamp.",
    scopeBasis: "project_context",
    scopeLimitation:
      "Product Profile scope reflects the confirmed profile and the primary Site market/language, not provider collection scope.",
    marketCode: "US",
    languageTag: "en-US",
  } as const;
}

function keywordMetric(
  valuePointer: string,
  value: number | string | null,
  limitation: string | null = null,
) {
  return {
    snapshotId: ids.metricSnapshot,
    observationId: ids.metricObservation,
    valuePointer,
    value,
    observedAt: "2026-07-21T08:00:00Z",
    freshness: "unknown",
    limitation:
      limitation ??
      "Provider freshness is unknown because no data-as-of timestamp was supplied.",
  };
}

function keywordItem() {
  return {
    projectId: ids.project,
    keywordId: ids.keyword,
    displayKeyword: "Customer Onboarding Software",
    normalizedKeyword: "customer onboarding software",
    marketCode: "US",
    languageTag: "en-US",
    queryKind: "search_query",
    status: "candidate",
    reviewOrigin: null,
    revision: 1,
    intent: null,
    searchIntent: {
      value: "commercial",
      authority: "provider_observed",
      snapshotId: ids.metricSnapshot,
      observationId: ids.metricObservation,
      analysisInvocationId: null,
      observedAt: "2026-07-21T08:00:00Z",
      limitation: null,
    },
    buyerStage: "consideration",
    cluster: {
      clusterId: ids.cluster,
      topicModelRevision: 3,
      name: "customer onboarding",
    },
    classificationLimitations: {
      intent: "Search intent has not been reviewed.",
      buyerStage: null,
      cluster: null,
    },
    mappedTarget: {
      kind: "existing_page",
      sitePageId: ids.sitePage,
      normalizedUrl: "https://example.com/customer-onboarding/",
      reviewState: "approved",
      revision: 2,
      reason: "The existing product page already owns this commercial intent.",
    },
    sourceOccurrences: [keywordSourceOccurrence()],
    metrics: {
      volume: keywordMetric("/valueJson/searchVolume", 0),
      kd: null,
      currentRank: keywordMetric("/valueJson/currentRank", 12),
      currentUrl: keywordMetric(
        "/valueJson/currentUrl",
        "https://example.com/customer-onboarding/",
      ),
      competitorDomain: null,
      competitorRank: null,
      limitations: {
        volume: null,
        kd: "No canonical keyword-difficulty Observation is available.",
        currentRank: null,
        currentUrl: null,
        competitorDomain: "This occurrence is for the project's own domain.",
        competitorRank: "This occurrence is for the project's own domain.",
      },
    },
    recollection: null,
    coverage: {
      availability: "partial",
      limitations: [
        "Intent is awaiting review.",
        "Keyword difficulty is unavailable from canonical Observations.",
      ],
    },
  };
}

function keywordLibraryResponse() {
  return {
    projectId: ids.project,
    diagnosticRunId: ids.currentRun,
    data: [keywordItem()],
    meta: {
      limit: 50,
      nextCursor: null,
      hasNext: false,
      coverage: {
        availability: "partial",
        limitations: ["Keyword difficulty is not connected."],
      },
      sourceCounts: {
        all: 1,
        product_profile: 0,
        csv_import: 1,
        dataforseo_ranked: 0,
        gsc_top_query: 0,
        interview_summary: 0,
        user_review: 0,
        manual: 0,
      },
    },
  };
}

describe("Growth Map Keyword Library contracts", () => {
  it("exposes Product Profile as a strict source kind with a required whole-library count", () => {
    expect(GrowthMapKeywordSourceKind.parse("product_profile")).toBe(
      "product_profile",
    );
    const counts = {
      all: 2,
      product_profile: 1,
      csv_import: 1,
      dataforseo_ranked: 0,
      gsc_top_query: 0,
      interview_summary: 0,
      user_review: 0,
      manual: 0,
    };
    expect(GrowthMapKeywordSourceCounts.parse(counts)).toEqual(counts);
    const { product_profile: _productProfile, ...missingProfileCount } = counts;
    expect(GrowthMapKeywordSourceCounts.safeParse(missingProfileCount).success).toBe(
      false,
    );
    expect(
      GrowthMapKeywordSourceCounts.safeParse({ ...counts, inferred: 0 }).success,
    ).toBe(false);
  });

  it("keeps Product Profile occurrence identity strict and provider-lineage-free", () => {
    const base = keywordItem();
    const occurrence = productProfileKeywordSourceOccurrence();
    const productProfileItem = {
      ...base,
      queryKind: "generative_query",
      searchIntent: {
        value: null,
        authority: "unavailable",
        snapshotId: null,
        observationId: null,
        analysisInvocationId: null,
        observedAt: null,
        limitation:
          "No provider, governed, or generated search intent is available.",
      },
      sourceOccurrences: [occurrence],
      metrics: {
        volume: null,
        kd: null,
        currentRank: null,
        currentUrl: null,
        competitorDomain: null,
        competitorRank: null,
        limitations: {
          volume: "No provider volume Observation is available.",
          kd: "No provider difficulty Observation is available.",
          currentRank: "No provider rank Observation is available.",
          currentUrl: "No provider URL Observation is available.",
          competitorDomain: "No provider competitor Observation is available.",
          competitorRank: "No provider competitor rank is available.",
        },
      },
    } as const;
    expect(
      GrowthMapKeywordLibraryResponse.safeParse({
        ...keywordLibraryResponse(),
        data: [productProfileItem],
      }).success,
    ).toBe(true);

    for (const invalidOccurrence of [
      { ...occurrence, productProfileId: null },
      { ...occurrence, snapshotId: ids.metricSnapshot },
      { ...occurrence, sourceObservationId: ids.metricObservation },
      { ...occurrence, sourcePointer: "/valueJson/keyword" },
      {
        ...occurrence,
        providerDataAsOf: "2026-07-21T08:00:00Z",
        freshness: "current",
      },
      { ...occurrence, manualEntryId: ids.keywordManualEntry },
    ]) {
      expect(
        GrowthMapKeywordLibraryResponse.safeParse({
          ...keywordLibraryResponse(),
          data: [
            {
              ...productProfileItem,
              sourceOccurrences: [invalidOccurrence],
            },
          ],
        }).success,
      ).toBe(false);
    }
  });

  it("requires every canonical cluster reference to carry its exact Topic Model revision", () => {
    const base = keywordItem();
    const {
      topicModelRevision: _omitted,
      ...clusterWithoutRevision
    } = base.cluster!;
    expect(
      GrowthMapKeywordDetailResponse.safeParse({
        projectId: ids.project,
        data: {
          ...base,
          cluster: { ...base.cluster!, topicModelRevision: 2 },
        },
      }).success,
    ).toBe(true);
    expect(
      GrowthMapKeywordDetailResponse.safeParse({
        projectId: ids.project,
        data: { ...base, cluster: clusterWithoutRevision },
      }).success,
    ).toBe(false);
  });

  it("bounds historical DataForSEO recollection fields and requires a provider occurrence", () => {
    const base = keywordItem();
    const recollection = {
      reason: "historical_dataforseo_observation_missing_fields" as const,
      fields: [
        "keyword_difficulty",
        "provider_search_intent",
      ] as const,
    };
    expect(
      GrowthMapKeywordDetailResponse.safeParse({
        projectId: ids.project,
        data: { ...base, recollection },
      }).success,
    ).toBe(true);
    expect(
      GrowthMapKeywordDetailResponse.safeParse({
        projectId: ids.project,
        data: {
          ...base,
          recollection: {
            ...recollection,
            fields: ["keyword_difficulty", "keyword_difficulty"],
          },
        },
      }).success,
    ).toBe(false);

    const providerOccurrence = base.sourceOccurrences[0]!;
    expect(
      GrowthMapKeywordDetailResponse.safeParse({
        projectId: ids.project,
        data: {
          ...base,
          searchIntent: {
            value: null,
            authority: "unavailable",
            snapshotId: null,
            observationId: null,
            analysisInvocationId: null,
            observedAt: null,
            limitation: "No provider search intent is available.",
          },
          sourceOccurrences: [
            {
              ...providerOccurrence,
              sourceKind: "csv_import",
              scopeBasis: "user_provided",
              importPreviewId: ids.action,
            },
          ],
          recollection,
        },
      }).success,
    ).toBe(false);
  });

  it("accepts a strict, traceable Keyword projection and preserves observed zero", () => {
    const parsed = GrowthMapKeywordLibraryResponse.parse(
      keywordLibraryResponse(),
    );

    expect(parsed.data[0]?.metrics.volume?.value).toBe(0);
    expect(parsed.data[0]?.metrics.kd).toBeNull();
    expect(
      GrowthMapKeywordDetailResponse.safeParse({
        projectId: ids.project,
        data: keywordItem(),
      }).success,
    ).toBe(true);
    expect(
      GrowthMapKeywordLibraryResponse.safeParse({
        ...keywordLibraryResponse(),
        confirmActionId: ids.action,
      }).success,
    ).toBe(false);
  });

  it("requires the exact published diagnostic run identity while keeping live pages explicit", () => {
    const { diagnosticRunId: _omitted, ...withoutRunIdentity } =
      keywordLibraryResponse();
    expect(
      GrowthMapKeywordLibraryResponse.safeParse(withoutRunIdentity).success,
    ).toBe(false);
    expect(
      GrowthMapKeywordLibraryResponse.safeParse({
        ...keywordLibraryResponse(),
        diagnosticRunId: ids.currentRun,
      }).success,
    ).toBe(true);
    expect(
      GrowthMapKeywordLibraryResponse.safeParse({
        ...keywordLibraryResponse(),
        diagnosticRunId: null,
      }).success,
    ).toBe(true);
    expect(
      GrowthMapKeywordLibraryResponse.safeParse({
        ...keywordLibraryResponse(),
        diagnosticRunId: "not-a-run-id",
      }).success,
    ).toBe(false);
  });

  it("keeps the deciding authority readable and refuses to omit it", () => {
    // Automated governance writes the same approved + confirmed pair a human
    // review writes, so status alone can present an unreviewed keyword as
    // confirmed. The origin is therefore required, not optional.
    for (const reviewOrigin of [
      "user",
      "system_suggestion",
      "migration_baseline",
      null,
    ] as const) {
      expect(
        GrowthMapKeywordDetailResponse.safeParse({
          projectId: ids.project,
          data: { ...keywordItem(), status: "approved", reviewOrigin },
        }).success,
      ).toBe(true);
    }

    const { reviewOrigin: _omitted, ...withoutOrigin } = keywordItem();
    expect(
      GrowthMapKeywordDetailResponse.safeParse({
        projectId: ids.project,
        data: withoutOrigin,
      }).success,
    ).toBe(false);
    expect(
      GrowthMapKeywordDetailResponse.safeParse({
        projectId: ids.project,
        data: { ...keywordItem(), reviewOrigin: "auto_pilot" },
      }).success,
    ).toBe(false);
  });

  it("requires a closed search-intent projection with authority-specific lineage", () => {
    const base = keywordItem();
    const validSearchIntents = [
      {
        value: "commercial investigation",
        authority: "user_confirmed",
        snapshotId: null,
        observationId: null,
        analysisInvocationId: null,
        observedAt: null,
        limitation: null,
      },
      {
        value: "legacy evaluation intent",
        authority: "governed_legacy",
        snapshotId: null,
        observationId: null,
        analysisInvocationId: null,
        observedAt: null,
        limitation: "Field-level provenance predates this contract.",
      },
      base.searchIntent,
      {
        value: "transactional",
        authority: "llm_generated",
        snapshotId: null,
        observationId: null,
        analysisInvocationId: ids.analysisInvocation,
        observedAt: null,
        limitation: null,
      },
      {
        value: null,
        authority: "unavailable",
        snapshotId: null,
        observationId: null,
        analysisInvocationId: null,
        observedAt: null,
        limitation: "No governed, provider-observed, or generated intent exists.",
      },
    ] as const;

    for (const searchIntent of validSearchIntents) {
      const governance =
        searchIntent.authority === "user_confirmed"
          ? { intent: searchIntent.value, reviewOrigin: "user" }
          : searchIntent.authority === "governed_legacy"
            ? {
                intent: searchIntent.value,
                reviewOrigin: "migration_baseline",
              }
            : {};
      expect(
        GrowthMapKeywordDetailResponse.safeParse({
          projectId: ids.project,
          data: { ...base, ...governance, searchIntent },
        }).success,
      ).toBe(true);
    }

    const { searchIntent: _omitted, ...withoutSearchIntent } = base;
    expect(
      GrowthMapKeywordDetailResponse.safeParse({
        projectId: ids.project,
        data: withoutSearchIntent,
      }).success,
    ).toBe(false);

    for (const searchIntent of [
      { ...base.searchIntent, value: null },
      { ...base.searchIntent, snapshotId: null },
      { ...base.searchIntent, observationId: null },
      { ...base.searchIntent, observedAt: null },
      { ...base.searchIntent, analysisInvocationId: ids.analysisInvocation },
      {
        ...validSearchIntents[3],
        analysisInvocationId: null,
      },
      { ...validSearchIntents[3], snapshotId: ids.metricSnapshot },
      { ...validSearchIntents[3], observationId: ids.metricObservation },
      { ...validSearchIntents[3], observedAt: "2026-07-21T08:00:00Z" },
      { ...validSearchIntents[3], value: null },
      { ...validSearchIntents[4], value: "commercial" },
      { ...validSearchIntents[4], limitation: null },
      { ...validSearchIntents[4], snapshotId: ids.metricSnapshot },
      { ...validSearchIntents[4], observedAt: "2026-07-21T08:00:00Z" },
      { ...validSearchIntents[0], value: null },
      { ...validSearchIntents[0], snapshotId: ids.metricSnapshot },
      { ...validSearchIntents[0], observedAt: "2026-07-21T08:00:00Z" },
      { ...validSearchIntents[1], observationId: ids.metricObservation },
      { ...validSearchIntents[1], analysisInvocationId: ids.analysisInvocation },
      { ...validSearchIntents[0], value: "   " },
      { ...validSearchIntents[0], value: "x".repeat(501) },
      { ...base.searchIntent, value: "commercial investigation" },
      { ...validSearchIntents[3], value: "commercial investigation" },
      { ...base.searchIntent, value: " commercial " },
      { ...validSearchIntents[3], value: " transactional " },
      { ...base.searchIntent, authority: "model_guess" },
      { ...base.searchIntent, confidence: 0.9 },
    ]) {
      expect(
        GrowthMapKeywordDetailResponse.safeParse({
          projectId: ids.project,
          data: { ...base, searchIntent },
        }).success,
      ).toBe(false);
    }
  });

  it("ties provider-observed intent to one exact DataForSEO occurrence", () => {
    const base = keywordItem();
    const gscOccurrence = {
      occurrenceId: ids.keywordManualOccurrence,
      sourceKind: "gsc_top_query",
      snapshotId: ids.gscOnlySnapshot,
      sourceObservationId: ids.gscOnlyObservation,
      sourcePointer: "/valueJson/topQueries/0/query",
      collectedAt: "2026-07-21T08:05:00Z",
      providerDataAsOf: "2026-07-20T00:00:00Z",
      freshness: "current",
      limitation: null,
      scopeBasis: "project_context",
      scopeLimitation:
        "GSC query scope comes from the confirmed project market and language.",
      marketCode: "US",
      languageTag: "en-US",
    };
    const sourceOccurrences = [...base.sourceOccurrences, gscOccurrence];

    expect(
      GrowthMapKeywordDetailResponse.safeParse({
        projectId: ids.project,
        data: { ...base, sourceOccurrences },
      }).success,
    ).toBe(true);

    for (const searchIntent of [
      { ...base.searchIntent, snapshotId: ids.gscOnlySnapshot },
      { ...base.searchIntent, observationId: ids.gscOnlyObservation },
      {
        ...base.searchIntent,
        snapshotId: ids.gscOnlySnapshot,
        observationId: ids.gscOnlyObservation,
      },
    ]) {
      expect(
        GrowthMapKeywordDetailResponse.safeParse({
          projectId: ids.project,
          data: { ...base, sourceOccurrences, searchIntent },
        }).success,
      ).toBe(false);
    }
  });

  it("keeps governed search-intent authority coherent with the item decision", () => {
    const base = keywordItem();
    const userConfirmed = {
      value: "commercial investigation",
      authority: "user_confirmed",
      snapshotId: null,
      observationId: null,
      analysisInvocationId: null,
      observedAt: null,
      limitation: null,
    };
    const governedLegacy = {
      ...userConfirmed,
      value: "legacy evaluation intent",
      authority: "governed_legacy",
    };
    const unavailable = {
      ...userConfirmed,
      value: null,
      authority: "unavailable",
      limitation: "No resolved search intent is available.",
    };

    expect(
      GrowthMapKeywordDetailResponse.safeParse({
        projectId: ids.project,
        data: {
          ...base,
          intent: governedLegacy.value,
          reviewOrigin: null,
          searchIntent: governedLegacy,
        },
      }).success,
    ).toBe(true);

    for (const invalid of [
      {
        ...base,
        intent: "commercial",
        reviewOrigin: "user",
        searchIntent: base.searchIntent,
      },
      {
        ...base,
        intent: "transactional",
        reviewOrigin: "user",
        searchIntent: {
          value: "transactional",
          authority: "llm_generated",
          snapshotId: null,
          observationId: null,
          analysisInvocationId: ids.analysisInvocation,
          observedAt: null,
          limitation: null,
        },
      },
      { ...base, intent: userConfirmed.value, searchIntent: userConfirmed },
      {
        ...base,
        intent: "different intent",
        reviewOrigin: "user",
        searchIntent: userConfirmed,
      },
      {
        ...base,
        intent: "different intent",
        reviewOrigin: "migration_baseline",
        searchIntent: governedLegacy,
      },
      {
        ...base,
        intent: governedLegacy.value,
        reviewOrigin: "user",
        searchIntent: governedLegacy,
      },
      { ...base, intent: "commercial", searchIntent: unavailable },
    ]) {
      expect(
        GrowthMapKeywordDetailResponse.safeParse({
          projectId: ids.project,
          data: invalid,
        }).success,
      ).toBe(false);
    }
  });

  it("rejects search-intent boundary whitespace instead of trimming authority facts", () => {
    const base = keywordItem();
    const invalidCases = [
      {
        item: {
          ...base,
          intent: "commercial investigation",
          reviewOrigin: "user",
        },
        searchIntent: {
          value: " commercial investigation",
          authority: "user_confirmed",
          snapshotId: null,
          observationId: null,
          analysisInvocationId: null,
          observedAt: null,
          limitation: null,
        },
      },
      {
        item: {
          ...base,
          intent: "legacy evaluation intent",
          reviewOrigin: null,
        },
        searchIntent: {
          value: "legacy evaluation intent ",
          authority: "governed_legacy",
          snapshotId: null,
          observationId: null,
          analysisInvocationId: null,
          observedAt: null,
          limitation: "Field-level provenance predates this contract.",
        },
      },
      {
        item: base,
        searchIntent: {
          value: null,
          authority: "unavailable",
          snapshotId: null,
          observationId: null,
          analysisInvocationId: null,
          observedAt: null,
          limitation: " No resolved search intent is available. ",
        },
      },
    ] as const;

    for (const { item, searchIntent } of invalidCases) {
      expect(GrowthMapKeywordSearchIntent.safeParse(searchIntent).success).toBe(
        false,
      );
      expect(
        GrowthMapKeywordDetailResponse.safeParse({
          projectId: ids.project,
          data: { ...item, searchIntent },
        }).success,
      ).toBe(false);
    }
  });

  it("requires a stable normalized identity and accepts canonical BCP-47 without a region", () => {
    expect(
      GrowthMapKeywordLibraryResponse.safeParse({
        ...keywordLibraryResponse(),
        data: [
          {
            ...keywordItem(),
            languageTag: "en",
            sourceOccurrences: keywordItem().sourceOccurrences.map(
              (occurrence) => ({ ...occurrence, languageTag: "en" }),
            ),
          },
        ],
      }).success,
    ).toBe(true);

    for (const invalid of [
      { normalizedKeyword: "Customer Onboarding Software" },
      { normalizedKeyword: "customer  onboarding software" },
      { languageTag: "EN-us" },
      { languageTag: "en_US" },
      { marketCode: "us" },
      { queryKind: "query" },
      { revision: -1 },
    ]) {
      expect(
        GrowthMapKeywordLibraryResponse.safeParse({
          ...keywordLibraryResponse(),
          data: [{ ...keywordItem(), ...invalid }],
        }).success,
      ).toBe(false);
    }

    expect(
      GrowthMapKeywordLibraryResponse.safeParse({
        ...keywordLibraryResponse(),
        data: [
          keywordItem(),
          {
            ...keywordItem(),
            keywordId: ids.keyword2,
            displayKeyword: "customer onboarding software",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("keeps intent, buyer stage, cluster, and missing metrics explicitly unknown", () => {
    const base = keywordItem();
    for (const invalid of [
      {
        ...base,
        classificationLimitations: {
          ...base.classificationLimitations,
          intent: null,
        },
      },
      {
        ...base,
        buyerStage: null,
        classificationLimitations: {
          ...base.classificationLimitations,
          buyerStage: null,
        },
      },
      {
        ...base,
        cluster: null,
        classificationLimitations: {
          ...base.classificationLimitations,
          cluster: null,
        },
      },
      {
        ...base,
        metrics: {
          ...base.metrics,
          limitations: { ...base.metrics.limitations, kd: null },
        },
      },
      {
        ...base,
        metrics: {
          ...base.metrics,
          volume: { ...base.metrics.volume, observationId: ids.gscOnlyObservation },
        },
      },
      {
        ...base,
        metrics: {
          ...base.metrics,
          volume: { ...base.metrics.volume, value: null, limitation: null },
        },
      },
      {
        ...base,
        metrics: {
          ...base.metrics,
          volume: {
            ...base.metrics.volume,
            valuePointer: "/items/0/keyword_info/search_volume",
          },
        },
      },
      {
        ...base,
        metrics: {
          ...base.metrics,
          currentRank: {
            ...base.metrics.currentRank,
            valuePointer: "/valueJson/searchVolume",
          },
        },
      },
    ]) {
      expect(
        GrowthMapKeywordLibraryResponse.safeParse({
          ...keywordLibraryResponse(),
          data: [invalid],
        }).success,
      ).toBe(false);
    }
  });

  it("makes existing-page, new-asset, and unassigned mapping identities disjoint", () => {
    const base = keywordItem();
    for (const mappedTarget of [
      {
        kind: "existing_page",
        normalizedUrl: "https://example.com/customer-onboarding/",
        reviewState: "approved",
        revision: 1,
        reason: null,
      },
      {
        kind: "new_asset",
        sitePageId: ids.sitePage,
        normalizedUrl: "https://example.com/future-page/",
        reviewState: "unreviewed",
        revision: 0,
        reason: null,
      },
      {
        kind: "unassigned",
        sitePageId: ids.sitePage,
        reviewState: "unreviewed",
        revision: 0,
        reason: null,
      },
    ]) {
      expect(
        GrowthMapKeywordLibraryResponse.safeParse({
          ...keywordLibraryResponse(),
          data: [{ ...base, mappedTarget }],
        }).success,
      ).toBe(false);
    }

    for (const mappedTarget of [
      {
        kind: "new_asset",
        reviewState: "unreviewed",
        revision: 0,
        reason: "No current page can satisfy the distinct decision intent.",
      },
      {
        kind: "unassigned",
        reviewState: "unreviewed",
        revision: 0,
        reason: "Mapping has not been reviewed.",
      },
    ]) {
      expect(
        GrowthMapKeywordLibraryResponse.safeParse({
          ...keywordLibraryResponse(),
          data: [{ ...base, mappedTarget }],
        }).success,
      ).toBe(true);
    }
  });

  it("requires exact bounded source occurrence provenance without raw provider data", () => {
    const base = keywordItem();
    const profileOccurrence = productProfileKeywordSourceOccurrence();
    const manualOccurrence = {
      occurrenceId: ids.keywordManualOccurrence,
      sourceKind: "manual",
      snapshotId: null,
      sourceObservationId: null,
      sourcePointer: null,
      collectedAt: "2026-07-21T08:10:00Z",
      providerDataAsOf: null,
      freshness: "unknown",
      limitation: "Manual input has no independent provider data-as-of time.",
      scopeBasis: "manual",
      scopeLimitation: null,
      marketCode: "US",
      languageTag: "en-US",
    };
    const csvOccurrence = {
      occurrenceId: ids.keywordManualEntry,
      sourceKind: "csv_import",
      snapshotId: ids.metricSnapshot,
      sourceObservationId: ids.metricObservation,
      sourcePointer: "/valueJson/keyword",
      importPreviewId: ids.import,
      collectedAt: "2026-07-21T08:05:00Z",
      providerDataAsOf: "2026-07-21T08:00:00Z",
      freshness: "current",
      limitation: null,
      scopeBasis: "user_provided",
      scopeLimitation: null,
      marketCode: "US",
      languageTag: "en-US",
    };
    const interviewSummaryOccurrence = {
      occurrenceId: "10000000-0000-4000-8000-000000000071",
      sourceKind: "interview_summary",
      collectionRunId: "10000000-0000-4000-8000-000000000073",
      snapshotId: ids.gscOnlySnapshot,
      sourceObservationId: ids.gscOnlyObservation,
      sourcePointer: "/valueJson/keyword",
      collectedAt: "2026-07-21T08:08:00Z",
      providerDataAsOf: "2026-07-18T00:00:00Z",
      freshness: "current",
      limitation: null,
      scopeBasis: "user_provided",
      scopeLimitation:
        "The Keyword comes from a customer-approved, de-identified interview summary rather than a verbatim transcript.",
      marketCode: "US",
      languageTag: "en-US",
      evidenceLabel: "Q2 customer onboarding interviews",
      sourceRecordHash: "a".repeat(64),
    };
    const userReviewOccurrence = {
      occurrenceId: "10000000-0000-4000-8000-000000000072",
      sourceKind: "user_review",
      collectionRunId: "10000000-0000-4000-8000-000000000074",
      snapshotId: ids.metricSnapshot,
      sourceObservationId: ids.metricObservation,
      sourcePointer: "/valueJson/keyword",
      collectedAt: "2026-07-21T08:09:00Z",
      providerDataAsOf: "2026-07-19T00:00:00Z",
      freshness: "current",
      limitation: null,
      scopeBasis: "provider_collection_scope",
      scopeLimitation:
        "The Keyword comes from a bounded public G2 review collection and does not represent every review on the platform.",
      marketCode: "US",
      languageTag: "en-US",
      evidenceLabel: "RelayOps public review corpus",
      sourceRecordHash: "b".repeat(64),
      reviewPlatform: "g2",
      sourceUrl: "https://www.g2.com/products/relayops/reviews",
    };

    expect(
      GrowthMapKeywordLibraryResponse.safeParse({
        ...keywordLibraryResponse(),
        data: [
          {
            ...base,
            sourceOccurrences: [
              keywordSourceOccurrence(),
              profileOccurrence,
              manualOccurrence,
              csvOccurrence,
              interviewSummaryOccurrence,
              userReviewOccurrence,
            ],
          },
        ],
      }).success,
    ).toBe(true);

    const unavailableMetrics = {
      volume: null,
      kd: null,
      currentRank: null,
      currentUrl: null,
      competitorDomain: null,
      competitorRank: null,
      limitations: {
        volume: "This occurrence only projects the exact GSC query text.",
        kd: "No canonical keyword-difficulty Observation is available.",
        currentRank: "GSC does not provide an exact absolute SERP rank.",
        currentUrl: "The parent page Observation owns the landing-page URL.",
        competitorDomain: "GSC contains no competitor domain.",
        competitorRank: "GSC contains no competitor rank.",
      },
    };
    const gscOccurrence = {
      occurrenceId: ids.keywordOccurrence,
      sourceKind: "gsc_top_query",
      snapshotId: ids.gscOnlySnapshot,
      sourceObservationId: ids.gscOnlyObservation,
      sourcePointer: "/valueJson/topQueries/0/query",
      collectedAt: "2026-07-21T08:00:00Z",
      providerDataAsOf: "2026-07-20T00:00:00Z",
      freshness: "current",
      limitation: null,
      scopeBasis: "project_context",
      scopeLimitation:
        "GSC Search Analytics was not filtered by market or language; this classification comes from confirmed project context.",
      marketCode: "US",
      languageTag: "en-US",
    };
    const unavailableSearchIntent = {
      value: null,
      authority: "unavailable",
      snapshotId: null,
      observationId: null,
      analysisInvocationId: null,
      observedAt: null,
      limitation: "The GSC occurrence does not classify search intent.",
    };
    expect(
      GrowthMapKeywordLibraryResponse.safeParse({
        ...keywordLibraryResponse(),
        data: [
          {
            ...base,
            searchIntent: unavailableSearchIntent,
            sourceOccurrences: [gscOccurrence],
            metrics: unavailableMetrics,
          },
          {
            ...base,
            keywordId: ids.keyword2,
            displayKeyword: "Customer Onboarding Automation",
            normalizedKeyword: "customer onboarding automation",
            searchIntent: unavailableSearchIntent,
            sourceOccurrences: [
              {
                ...gscOccurrence,
                occurrenceId: ids.keywordManualOccurrence,
                sourcePointer: "/valueJson/topQueries/1/query",
              },
            ],
            metrics: unavailableMetrics,
          },
        ],
      }).success,
    ).toBe(true);

    for (const sourceOccurrences of [
      [keywordSourceOccurrence(), keywordSourceOccurrence()],
      [
        keywordSourceOccurrence(),
        { ...keywordSourceOccurrence(), occurrenceId: ids.keywordManualOccurrence },
      ],
      [{ ...manualOccurrence, manualEntryId: ids.keywordManualEntry }],
      [{ ...keywordSourceOccurrence(), snapshotId: null }],
      [{ ...keywordSourceOccurrence(), sourceObservationId: null }],
      [{ ...keywordSourceOccurrence(), providerTaskId: "private-task-id" }],
      [{ ...csvOccurrence, rowNumber: 4 }],
      [{ ...csvOccurrence, importId: ids.import }],
      [
        {
          ...keywordSourceOccurrence(),
          sourcePointer: "/items/0/keyword_data/keyword",
        },
      ],
      [{ ...keywordSourceOccurrence(), scopeBasis: "project_context" }],
      [
        {
          ...gscOccurrence,
          scopeBasis: "provider_collection_scope",
        },
      ],
      [{ ...gscOccurrence, scopeLimitation: null }],
      [
        {
          ...interviewSummaryOccurrence,
          participantName: "Must never reach a Keyword row",
        },
      ],
      [{ ...interviewSummaryOccurrence, sourceRecordHash: "not-a-hash" }],
      [
        {
          ...userReviewOccurrence,
          reviewBody: "The complete public review must not be projected.",
        },
      ],
      [{ ...userReviewOccurrence, sourceUrl: "http://example.com/review" }],
      [{ ...userReviewOccurrence, reviewPlatform: "unknown_platform" }],
      [
        {
          ...keywordSourceOccurrence(),
          providerDataAsOf: "2026-07-20T00:00:00Z",
          freshness: "current",
          limitation: null,
        },
      ],
      [{ ...keywordSourceOccurrence(), capturedAt: "2026-07-21T08:00:00Z" }],
      [{ ...keywordSourceOccurrence(), rawRequest: { password: "secret" } }],
    ]) {
      expect(
        GrowthMapKeywordLibraryResponse.safeParse({
          ...keywordLibraryResponse(),
          data: [{ ...base, sourceOccurrences }],
        }).success,
      ).toBe(false);
    }
  });

  it("enforces bounded cursor pages, unique IDs, and project-scoped detail", () => {
    const base = keywordLibraryResponse();
    expect(
      GrowthMapKeywordLibraryResponse.safeParse({
        ...base,
        meta: { ...base.meta, limit: 0 },
      }).success,
    ).toBe(false);
    expect(
      GrowthMapKeywordLibraryResponse.safeParse({
        ...base,
        meta: { ...base.meta, nextCursor: "bmV4dA", hasNext: false },
      }).success,
    ).toBe(false);
    expect(
      GrowthMapKeywordLibraryResponse.safeParse({
        ...base,
        data: [keywordItem(), keywordItem()],
      }).success,
    ).toBe(false);
    expect(
      GrowthMapKeywordLibraryResponse.safeParse({
        ...base,
        data: [
          keywordItem(),
          {
            ...keywordItem(),
            keywordId: ids.keyword2,
            displayKeyword: "Customer Onboarding Automation",
            normalizedKeyword: "customer onboarding automation",
            sourceOccurrences: [
              {
                ...keywordSourceOccurrence(),
                occurrenceId: ids.keywordManualOccurrence,
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      GrowthMapKeywordDetailResponse.safeParse({
        projectId: ids.site,
        data: keywordItem(),
      }).success,
    ).toBe(false);
  });
});

function unavailableCompetitorInsight(limitation: string) {
  return {
    availability: "unavailable",
    value: null,
    limitation,
  };
}

function productProfileSnapshotEvidenceRef() {
  return {
    evidenceRefId: ids.evidence,
    kind: "snapshot",
    snapshotId: ids.currentCrawl,
  };
}

function appEvidenceRef(evidenceId: string) {
  return {
    kind: "evidence",
    evidenceId,
  };
}

function productProfileOriginOccurrence() {
  return {
    occurrenceId: ids.competitorOccurrence,
    originKind: "product_profile",
    productProfileId: ids.productProfile,
    profileVersion: 3,
    candidateId: ids.competitorCandidate,
    fieldProvenancePath: "/competitorCandidates/0",
    observedAt: null,
    evidenceRefs: [productProfileSnapshotEvidenceRef()],
  };
}

function competitorCsvOriginOccurrence() {
  return {
    occurrenceId: ids.competitorOccurrence,
    originKind: "csv_keyword_gap",
    snapshotId: ids.metricSnapshot,
    observationId: ids.metricObservation,
    sourcePointer: "/valueJson/competitorDomain",
    importPreviewId: ids.import,
    observedAt: "2026-07-21T08:00:00Z",
    evidenceRefs: [],
  };
}

function competitorItem() {
  return {
    projectId: ids.project,
    competitorId: ids.competitor,
    domain: "example-competitor.com",
    name: "Example Competitor",
    reviewStatus: "candidate",
    relationship: null,
    analysisScope: [],
    revision: 1,
    originOccurrences: [productProfileOriginOccurrence()],
    lastObservedAt: null,
    serpOverlap: unavailableCompetitorInsight(
      "No canonical recurring SERP-overlap Observation is available.",
    ),
    aiCitationInsight: unavailableCompetitorInsight(
      "No canonical AI-citation Observation is available.",
    ),
    sharedKeywordInsight: unavailableCompetitorInsight(
      "No canonical DataForSEO competitor-domain Observation is available.",
    ),
    coverage: {
      availability: "partial",
      limitations: ["The candidate has not been approved for analysis."],
    },
  };
}

function approvedCompetitorItem() {
  return {
    ...competitorItem(),
    competitorId: ids.competitor2,
    domain: "approved-competitor.com",
    name: null,
    reviewStatus: "approved",
    relationship: "direct",
    analysisScope: ["positioning", "keyword_gap"],
    originOccurrences: [
      {
        ...productProfileOriginOccurrence(),
        occurrenceId: ids.competitorOccurrence2,
        candidateId: ids.keyword2,
        fieldProvenancePath: "/competitorCandidates/1",
      },
    ],
  };
}

function competitorLibraryResponse() {
  return {
    projectId: ids.project,
    data: [competitorItem(), approvedCompetitorItem()],
    meta: {
      limit: 50,
      nextCursor: null,
      hasNext: false,
      coverage: {
        availability: "partial",
        limitations: ["SERP-overlap and AI-citation sources are unavailable."],
      },
    },
  };
}

describe("Growth Map Competitor Library contracts", () => {
  it("accepts only exact canonical organic-overlap operands and fixed-cohort AI citation counts", () => {
    const serpOrigin = {
      occurrenceId: ids.competitorOccurrence,
      originKind: "serp_overlap",
      snapshotId: ids.serpSnapshot,
      observationId: ids.serpObservation,
      observedAt: "2026-07-21T09:00:00Z",
      evidenceRefs: [],
    };
    const aiOrigin = {
      occurrenceId: ids.competitorOccurrence2,
      originKind: "ai_citation",
      snapshotId: ids.aiSnapshot,
      observationId: ids.aiObservation,
      observedAt: "2026-07-21T09:05:00Z",
      evidenceRefs: [],
    };
    const item = {
      ...approvedCompetitorItem(),
      originOccurrences: [serpOrigin, aiOrigin],
      lastObservedAt: "2026-07-21T09:05:00Z",
      serpOverlap: {
        availability: "available",
        value: 0.17,
        snapshotId: ids.serpSnapshot,
        observationId: ids.serpObservation,
        valuePointer: "/valueJson/serpOverlap",
        observedAt: "2026-07-21T09:00:00Z",
        limitation:
          "Organic positions 1-100 in one exact US/en provider snapshot.",
      },
      aiCitationInsight: {
        availability: "available",
        value: 8,
        attemptedQueries: 20,
        observedQueries: 17,
        unavailableQueries: 3,
        cohortCoverage: "partial",
        querySetHash: "a".repeat(64),
        platform: "chat_gpt",
        model: "gpt-5",
        marketCode: "US",
        languageTag: "en-US",
        snapshotId: ids.aiSnapshot,
        observationId: ids.aiObservation,
        valuePointer: "/valueJson/citedQueries",
        observedAt: "2026-07-21T09:05:00Z",
        limitation:
          "17 of 20 fixed prompts were observed; 3 were unavailable.",
      },
    };
    const parse = (candidate: unknown) =>
      GrowthMapCompetitorLibraryResponse.safeParse({
        ...competitorLibraryResponse(),
        data: [candidate],
      }).success;

    expect(parse(item)).toBe(true);
    expect(
      parse({
        ...item,
        serpOverlap: { ...item.serpOverlap, value: 0.18 },
      }),
    ).toBe(true);
    expect(
      parse({
        ...item,
        aiCitationInsight: {
          ...item.aiCitationInsight,
          unavailableQueries: 2,
        },
      }),
    ).toBe(false);
    expect(
      parse({
        ...item,
        aiCitationInsight: {
          ...item.aiCitationInsight,
          value: 18,
        },
      }),
    ).toBe(false);
    expect(
      parse({
        ...item,
        aiCitationInsight: {
          ...item.aiCitationInsight,
          observedQueries: 20,
          unavailableQueries: 0,
          cohortCoverage: "complete",
          limitation: null,
        },
      }),
    ).toBe(true);
  });

  it("accepts strict candidate and approved competitor projections without Action state", () => {
    const parsed = GrowthMapCompetitorLibraryResponse.parse(
      competitorLibraryResponse(),
    );
    const productProfileOrigin = parsed.data[0]?.originOccurrences[0];
    expect(productProfileOrigin?.originKind).toBe("product_profile");
    if (productProfileOrigin?.originKind === "product_profile") {
      expect(productProfileOrigin.fieldProvenancePath).toBe(
        "/competitorCandidates/0",
      );
      expect(productProfileOrigin.evidenceRefs[0]).toEqual(
        productProfileSnapshotEvidenceRef(),
      );
      expect("evidenceId" in productProfileOrigin.evidenceRefs[0]!).toBe(false);
    }
    expect(
      GrowthMapCompetitorDetailResponse.safeParse({
        projectId: ids.project,
        data: competitorItem(),
      }).success,
    ).toBe(true);
    expect(
      GrowthMapCompetitorLibraryResponse.safeParse({
        ...competitorLibraryResponse(),
        actionId: ids.action,
      }).success,
    ).toBe(false);
  });

  it("requires approved competitors to have one relationship and non-empty unique scope", () => {
    for (const invalid of [
      { ...approvedCompetitorItem(), relationship: null },
      { ...approvedCompetitorItem(), analysisScope: [] },
      {
        ...approvedCompetitorItem(),
        analysisScope: ["keyword_gap", "keyword_gap"],
      },
      { ...competitorItem(), relationship: "direct" },
      { ...competitorItem(), analysisScope: ["keyword_gap"] },
      {
        ...competitorItem(),
        reviewStatus: "excluded",
        relationship: "benchmark",
      },
      { ...approvedCompetitorItem(), relationship: "serp_competitor" },
    ]) {
      expect(
        GrowthMapCompetitorLibraryResponse.safeParse({
          ...competitorLibraryResponse(),
          data: [invalid],
        }).success,
      ).toBe(false);
    }

    for (const relationship of [
      "direct",
      "indirect",
      "status_quo",
      "benchmark",
      "publisher",
    ]) {
      expect(
        GrowthMapCompetitorLibraryResponse.safeParse({
          ...competitorLibraryResponse(),
          data: [{ ...approvedCompetitorItem(), relationship }],
        }).success,
      ).toBe(true);
    }
  });

  it("requires normalized domains and exact, unique origin provenance", () => {
    const base = competitorItem();
    for (const invalid of [
      { ...base, domain: "Example-Competitor.com" },
      { ...base, domain: "https://example-competitor.com" },
      {
        ...base,
        originOccurrences: [
          {
            ...productProfileOriginOccurrence(),
            profileVersion: undefined,
          },
        ],
      },
      {
        ...base,
        originOccurrences: [
          { ...competitorCsvOriginOccurrence(), rowNumber: 4 },
        ],
      },
      {
        ...base,
        originOccurrences: [
          { ...competitorCsvOriginOccurrence(), importId: ids.import },
        ],
      },
      {
        ...base,
        originOccurrences: [
          {
            ...productProfileOriginOccurrence(),
            evidenceRefs: [
              productProfileSnapshotEvidenceRef(),
              {
                ...productProfileSnapshotEvidenceRef(),
                evidenceRefId: ids.templateEvidence,
              },
            ],
          },
        ],
      },
      {
        ...base,
        originOccurrences: [
          {
            ...productProfileOriginOccurrence(),
            fieldProvenancePath: undefined,
          },
        ],
      },
      {
        ...base,
        originOccurrences: [
          {
            ...productProfileOriginOccurrence(),
            fieldProvenancePath: "/targetMarkets/0",
          },
        ],
      },
      {
        ...base,
        originOccurrences: [
          productProfileOriginOccurrence(),
          productProfileOriginOccurrence(),
        ],
      },
      {
        ...base,
        originOccurrences: [
          productProfileOriginOccurrence(),
          {
            ...productProfileOriginOccurrence(),
            occurrenceId: ids.competitorOccurrence2,
          },
        ],
      },
      {
        ...base,
        originOccurrences: [
          {
            ...productProfileOriginOccurrence(),
            evidenceRefs: [
              productProfileSnapshotEvidenceRef(),
              productProfileSnapshotEvidenceRef(),
            ],
          },
        ],
      },
      {
        ...base,
        originOccurrences: [
          {
            ...productProfileOriginOccurrence(),
            evidenceRefs: [ids.evidence],
          },
        ],
      },
      {
        ...base,
        originOccurrences: [
          {
            ...productProfileOriginOccurrence(),
            evidenceRefs: [appEvidenceRef(ids.evidence)],
          },
        ],
      },
      {
        ...base,
        originOccurrences: [
          { ...productProfileOriginOccurrence(), credentials: "secret" },
        ],
      },
    ]) {
      expect(
        GrowthMapCompetitorLibraryResponse.safeParse({
          ...competitorLibraryResponse(),
          data: [invalid],
        }).success,
      ).toBe(false);
    }
  });

  it("allows SERP and AI insights only when exact canonical origin refs exist", () => {
    const serpOrigin = {
      occurrenceId: ids.competitorOccurrence2,
      originKind: "serp_overlap",
      snapshotId: ids.serpSnapshot,
      observationId: ids.serpObservation,
      observedAt: "2026-07-21T09:00:00Z",
      evidenceRefs: [appEvidenceRef(ids.aggregateEvidence)],
    };
    const availableSerpOverlap = {
      availability: "available",
      value: 0.17,
      snapshotId: ids.serpSnapshot,
      observationId: ids.serpObservation,
      valuePointer: "/valueJson/serpOverlap",
      observedAt: "2026-07-21T09:00:00Z",
      limitation: null,
    };
    const withSerp = {
      ...approvedCompetitorItem(),
      originOccurrences: [productProfileOriginOccurrence(), serpOrigin],
      lastObservedAt: "2026-07-21T09:00:00Z",
      serpOverlap: availableSerpOverlap,
    };

    expect(
      GrowthMapCompetitorLibraryResponse.safeParse({
        ...competitorLibraryResponse(),
        data: [withSerp],
      }).success,
    ).toBe(true);
    for (const evidenceRefs of [
      [productProfileSnapshotEvidenceRef()],
      [
        appEvidenceRef(ids.aggregateEvidence),
        appEvidenceRef(ids.aggregateEvidence),
      ],
    ]) {
      expect(
        GrowthMapCompetitorLibraryResponse.safeParse({
          ...competitorLibraryResponse(),
          data: [
            {
              ...withSerp,
              originOccurrences: withSerp.originOccurrences.map((origin) =>
                origin.originKind === "serp_overlap"
                  ? { ...origin, evidenceRefs }
                  : origin,
              ),
            },
          ],
        }).success,
      ).toBe(false);
    }
    expect(
      GrowthMapCompetitorLibraryResponse.safeParse({
        ...competitorLibraryResponse(),
        data: [
          {
            ...withSerp,
            originOccurrences: [productProfileOriginOccurrence()],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      GrowthMapCompetitorLibraryResponse.safeParse({
        ...competitorLibraryResponse(),
        data: [
          {
            ...withSerp,
            serpOverlap: {
              ...availableSerpOverlap,
              valuePointer: "/items/0/serp/overlap",
            },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      GrowthMapCompetitorLibraryResponse.safeParse({
        ...competitorLibraryResponse(),
        data: [
          {
            ...competitorItem(),
            serpOverlap: {
              ...unavailableCompetitorInsight("No canonical source."),
              snapshotId: ids.serpSnapshot,
            },
          },
        ],
      }).success,
    ).toBe(false);

    const aiOrigin = {
      occurrenceId: ids.competitorOccurrence2,
      originKind: "ai_citation",
      snapshotId: ids.aiSnapshot,
      observationId: ids.aiObservation,
      observedAt: "2026-07-21T09:05:00Z",
      evidenceRefs: [],
    };
    expect(
      GrowthMapCompetitorLibraryResponse.safeParse({
        ...competitorLibraryResponse(),
        data: [
          {
            ...approvedCompetitorItem(),
            originOccurrences: [productProfileOriginOccurrence(), aiOrigin],
            lastObservedAt: "2026-07-21T09:05:00Z",
            aiCitationInsight: {
              availability: "available",
              value: 8,
              attemptedQueries: 20,
              observedQueries: 20,
              unavailableQueries: 0,
              cohortCoverage: "complete",
              querySetHash: "b".repeat(64),
              platform: "chat_gpt",
              model: "gpt-5",
              marketCode: "US",
              languageTag: "en-US",
              snapshotId: ids.aiSnapshot,
              observationId: ids.aiObservation,
              valuePointer: "/valueJson/citedQueries",
              observedAt: "2026-07-21T09:05:00Z",
              limitation: null,
            },
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("allows a shared-keyword count only when one exact serp_overlap Observation backs it", () => {
    const serpOrigin = {
      occurrenceId: ids.competitorOccurrence2,
      originKind: "serp_overlap",
      snapshotId: ids.serpSnapshot,
      observationId: ids.serpObservation,
      observedAt: "2026-07-21T09:00:00Z",
      evidenceRefs: [],
    };
    const availableSharedKeywordInsight = {
      availability: "available",
      value: 17,
      snapshotId: ids.serpSnapshot,
      observationId: ids.serpObservation,
      valuePointer: "/valueJson/intersections",
      observedAt: "2026-07-21T09:00:00Z",
      limitation:
        "This counts shared ranking keywords inside one ranking window, not a share.",
    };
    const withSharedKeywords = {
      ...approvedCompetitorItem(),
      originOccurrences: [productProfileOriginOccurrence(), serpOrigin],
      lastObservedAt: "2026-07-21T09:00:00Z",
      sharedKeywordInsight: availableSharedKeywordInsight,
    };
    const parseWith = (item: unknown) =>
      GrowthMapCompetitorLibraryResponse.safeParse({
        ...competitorLibraryResponse(),
        data: [item],
      }).success;

    expect(parseWith(withSharedKeywords)).toBe(true);

    // The lineage must name the shared-keyword pointer; borrowing a sibling
    // insight's pointer would let one metric impersonate another.
    expect(
      parseWith({
        ...withSharedKeywords,
        sharedKeywordInsight: {
          ...availableSharedKeywordInsight,
          valuePointer: "/valueJson/serpOverlap",
        },
      }),
    ).toBe(false);
    // No canonical origin at all.
    expect(
      parseWith({
        ...withSharedKeywords,
        originOccurrences: [productProfileOriginOccurrence()],
      }),
    ).toBe(false);
    // Lineage that points at a different Observation or Snapshot than the one
    // the origin recorded.
    for (const drift of [
      { observationId: ids.aiObservation },
      { snapshotId: ids.aiSnapshot },
      { observedAt: "2026-07-21T09:05:00Z" },
    ]) {
      expect(
        parseWith({
          ...withSharedKeywords,
          sharedKeywordInsight: {
            ...availableSharedKeywordInsight,
            ...drift,
          },
        }),
      ).toBe(false);
    }
    // The source only ever records domains that already share a keyword, so a
    // zero, a negative, or a fractional intersection count is never canonical.
    for (const value of [0, -1, 1.5]) {
      expect(
        parseWith({
          ...withSharedKeywords,
          sharedKeywordInsight: { ...availableSharedKeywordInsight, value },
        }),
      ).toBe(false);
    }
    // An unavailable insight may not smuggle lineage in beside its limitation.
    expect(
      parseWith({
        ...competitorItem(),
        sharedKeywordInsight: {
          ...unavailableCompetitorInsight("No canonical source."),
          snapshotId: ids.serpSnapshot,
        },
      }),
    ).toBe(false);
  });

  it("supports every exact origin branch without treating future sources as connected", () => {
    const origins = [
      productProfileOriginOccurrence(),
      competitorCsvOriginOccurrence(),
      {
        occurrenceId: ids.competitorOccurrence,
        originKind: "manual",
        manualEntryId: ids.manualEntry,
        observedAt: null,
        evidenceRefs: [],
      },
      {
        occurrenceId: ids.competitorOccurrence,
        originKind: "serp_overlap",
        snapshotId: ids.serpSnapshot,
        observationId: ids.serpObservation,
        observedAt: "2026-07-21T09:00:00Z",
        evidenceRefs: [],
      },
      {
        occurrenceId: ids.competitorOccurrence,
        originKind: "ai_citation",
        snapshotId: ids.aiSnapshot,
        observationId: ids.aiObservation,
        observedAt: "2026-07-21T09:05:00Z",
        evidenceRefs: [],
      },
    ];

    for (const origin of origins) {
      expect(
        GrowthMapCompetitorLibraryResponse.safeParse({
          ...competitorLibraryResponse(),
          data: [
            {
              ...competitorItem(),
              originOccurrences: [origin],
              lastObservedAt: origin.observedAt,
            },
          ],
        }).success,
      ).toBe(true);
    }
  });

  it("enforces bounded cursor pages, unique library identities, and scoped detail", () => {
    const base = competitorLibraryResponse();
    expect(
      GrowthMapCompetitorLibraryResponse.safeParse({
        ...base,
        data: [competitorItem(), competitorItem()],
      }).success,
    ).toBe(false);
    expect(
      GrowthMapCompetitorLibraryResponse.safeParse({
        ...base,
        data: [
          competitorItem(),
          {
            ...approvedCompetitorItem(),
            originOccurrences: [
              {
                ...productProfileOriginOccurrence(),
                occurrenceId: ids.competitorOccurrence2,
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      GrowthMapCompetitorLibraryResponse.safeParse({
        ...base,
        data: [
          competitorItem(),
          { ...approvedCompetitorItem(), domain: competitorItem().domain },
        ],
      }).success,
    ).toBe(false);
    expect(
      GrowthMapCompetitorLibraryResponse.safeParse({
        ...base,
        meta: { ...base.meta, limit: 101 },
      }).success,
    ).toBe(false);
    expect(
      GrowthMapCompetitorDetailResponse.safeParse({
        projectId: ids.site,
        data: competitorItem(),
      }).success,
    ).toBe(false);
  });
});
