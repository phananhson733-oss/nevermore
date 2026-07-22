import { describe, expect, it } from "vitest";
import {
  GrowthMapUrlDetailResponse,
  GrowthMapUrlMetricObservation,
  GrowthMapUrlPortfolioResponse,
} from "./growth-map.ts";

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
    },
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
      active: true,
      regressed: false,
      evidenceIds: [ids.templateEvidence],
      targetRelation: {
        relation: "affected_by_template",
        targetKind: "template",
        targetRef: "product-detail",
      },
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
      meta: { ...response.meta, nextCursor: null, hasNext: false },
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
        meta: {
          ...portfolioResponse().meta,
          nextCursor: null,
          hasNext: false,
        },
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
        meta: {
          ...portfolioResponse().meta,
          nextCursor: null,
          hasNext: false,
        },
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
                active: true,
                regressed: false,
                evidenceIds: [ids.aggregateEvidence],
                targetRelation,
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
          meta: { ...response.meta, nextCursor: null, hasNext: false },
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
        meta: { ...response.meta, nextCursor: null, hasNext: false },
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
        meta: { ...response.meta, nextCursor: null, hasNext: false },
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
        meta: { ...portfolioResponse().meta, nextCursor: null, hasNext: false },
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
        meta: { ...portfolioResponse().meta, nextCursor: null, hasNext: false },
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
