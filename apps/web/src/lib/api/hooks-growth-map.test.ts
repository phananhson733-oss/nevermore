import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildGrowthMapKeywordDetailQueryOptions,
  buildGrowthMapKeywordsQueryOptions,
  buildGrowthMapUrlDetailQueryOptions,
  buildGrowthMapUrlsQueryOptions,
  getGrowthMapKeywordDetail,
  getGrowthMapKeywords,
  getGrowthMapUrlDetail,
  getGrowthMapUrls,
  growthMapKeywordDetailQueryKey,
  growthMapKeywordsQueryKey,
  growthMapUrlDetailQueryKey,
  growthMapUrlsQueryKey,
  refreshGrowthMapAfterFindingReview,
} from "./hooks-growth-map";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";
const SITE_PAGE_A = "00000000-0000-4000-8000-000000000002";
const SITE_PAGE_B = "00000000-0000-4000-8000-000000000003";
const SITE_ID = "00000000-0000-4000-8000-000000000004";
const DIAGNOSTIC_RUN_ID = "00000000-0000-4000-8000-000000000005";
const CRAWL_SNAPSHOT_ID = "00000000-0000-4000-8000-000000000006";
const GSC_SNAPSHOT_ID = "00000000-0000-4000-8000-000000000007";
const OBSERVATION_A = "00000000-0000-4000-8000-000000000008";
const OBSERVATION_B = "00000000-0000-4000-8000-000000000009";
const KEYWORD_A = "00000000-0000-4000-8000-000000000010";
const KEYWORD_B = "00000000-0000-4000-8000-000000000011";
const KEYWORD_OCCURRENCE = "00000000-0000-4000-8000-000000000012";
const KEYWORD_SNAPSHOT = "00000000-0000-4000-8000-000000000013";
const KEYWORD_OBSERVATION = "00000000-0000-4000-8000-000000000014";
const IMPORT_PREVIEW = "00000000-0000-4000-8000-000000000015";
const OBSERVED_AT = "2026-07-21T00:00:00.000Z";
const UI_LOCALE = "en" as const;

function ok(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function portfolioResponse() {
  return {
    projectId: PROJECT_ID,
    siteId: SITE_ID,
    diagnosticRunId: DIAGNOSTIC_RUN_ID,
    crawlSnapshotId: CRAWL_SNAPSHOT_ID,
    data: [],
    meta: {
      limit: 50,
      nextCursor: null,
      hasNext: false,
      coverage: { availability: "available", limitations: [] },
    },
  } as const;
}

function detailResponse(sitePageId: string) {
  const observationId =
    sitePageId === SITE_PAGE_A ? OBSERVATION_A : OBSERVATION_B;
  const normalizedUrl =
    sitePageId === SITE_PAGE_A
      ? "https://example.test/customer-onboarding/"
      : "https://example.test/pricing/";
  return {
    projectId: PROJECT_ID,
    siteId: SITE_ID,
    diagnosticRunId: DIAGNOSTIC_RUN_ID,
    crawlSnapshotId: CRAWL_SNAPSHOT_ID,
    data: {
      projectId: PROJECT_ID,
      siteId: SITE_ID,
      diagnosticRunId: DIAGNOSTIC_RUN_ID,
      crawlSnapshotId: CRAWL_SNAPSHOT_ID,
      sitePageId,
      pageSnapshotId: null,
      pageSnapshotCapturedAt: null,
      identitySources: [
        {
          kind: "url_observation",
          provider: "gsc",
          snapshotId: GSC_SNAPSHOT_ID,
          observationId,
          sitePageId,
          subjectRef: normalizedUrl,
          observedAt: OBSERVED_AT,
        },
      ],
      normalizedUrl,
      title: null,
      pageType: null,
      templateKey: null,
      clusterKey: null,
      ownerId: null,
      coverage: {
        availability: "unavailable",
        limitations: ["No immutable Crawl Page Snapshot is available."],
      },
      metricObservations: [],
      findingIds: [],
      reviewableFindingIds: [],
      priority: {
        availability: "unavailable",
        value: null,
        limitation: "No current-run URL Finding is available.",
      },
      delta: {
        availability: "unavailable",
        value: null,
        limitation: "Two immutable recheck anchors are not available.",
      },
      findings: [],
    },
  } as const;
}

function keywordItem(keywordId = KEYWORD_A) {
  const displayKeyword =
    keywordId === KEYWORD_A
      ? "customer onboarding software"
      : "customer onboarding platform";
  return {
    projectId: PROJECT_ID,
    keywordId,
    displayKeyword,
    normalizedKeyword: displayKeyword,
    marketCode: "US",
    languageTag: "en-US",
    queryKind: "search_query",
    status: "candidate",
    revision: 0,
    intent: null,
    buyerStage: null,
    cluster: null,
    classificationLimitations: {
      intent: "Intent has not been classified from a canonical source.",
      buyerStage: "Buyer stage has not been classified from a canonical source.",
      cluster: "No reviewed Keyword cluster is available.",
    },
    mappedTarget: {
      kind: "unassigned",
      reviewState: "unreviewed",
      revision: 0,
      reason: null,
    },
    sourceOccurrences: [
      {
        occurrenceId: KEYWORD_OCCURRENCE,
        collectedAt: "2026-07-21T02:00:00.000Z",
        providerDataAsOf: OBSERVED_AT,
        freshness: "current",
        limitation: null,
        scopeBasis: "user_provided",
        scopeLimitation: "Coverage is limited to the uploaded CSV rows.",
        marketCode: "US",
        languageTag: "en-US",
        sourceKind: "csv_import",
        snapshotId: KEYWORD_SNAPSHOT,
        sourceObservationId: KEYWORD_OBSERVATION,
        sourcePointer: "/valueJson/keyword",
        importPreviewId: IMPORT_PREVIEW,
      },
    ],
    metrics: {
      volume: {
        snapshotId: KEYWORD_SNAPSHOT,
        observationId: KEYWORD_OBSERVATION,
        valuePointer: "/valueJson/searchVolume",
        observedAt: OBSERVED_AT,
        freshness: "current",
        limitation: null,
        value: 0,
      },
      kd: null,
      currentRank: null,
      currentUrl: null,
      competitorDomain: null,
      competitorRank: null,
      limitations: {
        volume: null,
        kd: "No canonical Keyword Difficulty observation is available.",
        currentRank: "No canonical current-rank observation is available.",
        currentUrl: "No canonical current-URL observation is available.",
        competitorDomain: "No competitor-domain observation is available.",
        competitorRank: "No competitor-rank observation is available.",
      },
    },
    coverage: {
      availability: "partial",
      limitations: ["Classification and several canonical metrics are unavailable."],
    },
  } as const;
}

function keywordLibraryResponse() {
  return {
    projectId: PROJECT_ID,
    data: [keywordItem()],
    meta: {
      limit: 50,
      nextCursor: null,
      hasNext: false,
      coverage: {
        availability: "partial",
        limitations: ["Only source-verified Keyword occurrences are returned."],
      },
    },
  } as const;
}

function keywordDetailResponse(keywordId = KEYWORD_A) {
  return {
    projectId: PROJECT_ID,
    data: keywordItem(keywordId),
  } as const;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Growth Map browser API boundary", () => {
  it("normalizes list params into one stable key and safely encoded URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(portfolioResponse()));
    vi.stubGlobal("fetch", fetchMock);

    const params = {
      search: "  onboarding / setup  ",
      cursor: "next+/=",
      limit: 25,
    } as const;
    const options = buildGrowthMapUrlsQueryOptions(PROJECT_ID, UI_LOCALE, params);
    await getGrowthMapUrls(PROJECT_ID, params);

    expect(options.queryKey).toEqual([
      "growth-map",
      PROJECT_ID,
      UI_LOCALE,
      "urls",
      { search: "onboarding / setup", cursor: "next+/=", limit: 25 },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/mvp/projects/${PROJECT_ID}/audit/urls?limit=25&cursor=next%2B%2F%3D&search=onboarding+%2F+setup`,
      expect.any(Object),
    );
  });

  it("uses explicit defaults and omits empty optional list params", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(portfolioResponse()));
    vi.stubGlobal("fetch", fetchMock);

    const options = buildGrowthMapUrlsQueryOptions(PROJECT_ID, UI_LOCALE, {
      search: "   ",
    });
    await getGrowthMapUrls(PROJECT_ID, { search: "   " });

    expect(options.queryKey).toEqual([
      "growth-map",
      PROJECT_ID,
      UI_LOCALE,
      "urls",
      { search: null, cursor: null, limit: 50 },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/mvp/projects/${PROJECT_ID}/audit/urls?limit=50`,
      expect.any(Object),
    );
  });

  it("keys detail by SitePage id and disables incomplete identities", () => {
    expect(
      growthMapUrlDetailQueryKey(PROJECT_ID, UI_LOCALE, SITE_PAGE_A),
    ).not.toEqual(
      growthMapUrlDetailQueryKey(PROJECT_ID, UI_LOCALE, SITE_PAGE_B),
    );
    expect(
      buildGrowthMapUrlDetailQueryOptions(PROJECT_ID, UI_LOCALE, null).enabled,
    ).toBe(false);
    expect(
      buildGrowthMapUrlDetailQueryOptions("", UI_LOCALE, SITE_PAGE_A).enabled,
    ).toBe(false);
    expect(
      buildGrowthMapUrlDetailQueryOptions(
        PROJECT_ID,
        UI_LOCALE,
        SITE_PAGE_A,
      ).enabled,
    ).toBe(true);
  });

  it("isolates portfolio and exact-detail caches by active UI locale", () => {
    expect(growthMapUrlsQueryKey(PROJECT_ID, "en", { limit: 25 })).not.toEqual(
      growthMapUrlsQueryKey(PROJECT_ID, "zh-CN", { limit: 25 }),
    );
    expect(
      growthMapUrlDetailQueryKey(PROJECT_ID, "en", SITE_PAGE_A),
    ).not.toEqual(
      growthMapUrlDetailQueryKey(PROJECT_ID, "zh-CN", SITE_PAGE_A),
    );
  });

  it("switching SitePage id performs a distinct detail request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(detailResponse(SITE_PAGE_A)))
      .mockResolvedValueOnce(ok(detailResponse(SITE_PAGE_B)));
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const observer = new QueryObserver(
      client,
      buildGrowthMapUrlDetailQueryOptions(PROJECT_ID, UI_LOCALE, SITE_PAGE_A),
    );

    const unsubscribe = observer.subscribe(() => undefined);
    await observer.refetch();
    observer.setOptions(
      buildGrowthMapUrlDetailQueryOptions(PROJECT_ID, UI_LOCALE, SITE_PAGE_B),
    );
    await observer.refetch();
    unsubscribe();

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      `/api/mvp/projects/${PROJECT_ID}/audit/urls/${SITE_PAGE_A}`,
      `/api/mvp/projects/${PROJECT_ID}/audit/urls/${SITE_PAGE_B}`,
    ]);
  });

  it("does not construct a fetch for an empty selected id", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getGrowthMapUrlDetail(PROJECT_ID, null)).rejects.toThrow(
      "sitePageId",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exports deterministic query-key helpers for list identity", () => {
    expect(growthMapUrlsQueryKey(PROJECT_ID, UI_LOCALE, { limit: 25 })).toEqual(
      growthMapUrlsQueryKey(PROJECT_ID, UI_LOCALE, {
        limit: 25,
        search: "",
        cursor: null,
      }),
    );
  });

  it("invalidates the URL portfolio and the exact selected detail after one Finding review", async () => {
    const client = new QueryClient();
    const invalidate = vi
      .spyOn(client, "invalidateQueries")
      .mockResolvedValue(undefined);

    await refreshGrowthMapAfterFindingReview(
      client,
      PROJECT_ID,
      UI_LOCALE,
      SITE_PAGE_A,
    );

    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenNthCalledWith(1, {
      queryKey: ["growth-map", PROJECT_ID, UI_LOCALE, "urls"],
      refetchType: "active",
    });
    expect(invalidate).toHaveBeenNthCalledWith(2, {
      queryKey: growthMapUrlDetailQueryKey(
        PROJECT_ID,
        UI_LOCALE,
        SITE_PAGE_A,
      ),
      refetchType: "active",
    });
  });

  it("rejects an over-budget search before any browser request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getGrowthMapUrls(PROJECT_ID, { search: "x".repeat(257) }),
    ).rejects.toThrow("256");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed on an untraceable server projection instead of fabricating rows", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      ok({
        projectId: PROJECT_ID,
        data: [{ normalizedUrl: "https://example.test/invented/" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getGrowthMapUrls(PROJECT_ID)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("normalizes Keyword cursor params into one stable key and safely encoded URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(keywordLibraryResponse()));
    vi.stubGlobal("fetch", fetchMock);

    const params = { cursor: "next+/=", limit: 25 } as const;
    const options = buildGrowthMapKeywordsQueryOptions(
      PROJECT_ID,
      UI_LOCALE,
      params,
    );
    await getGrowthMapKeywords(PROJECT_ID, params);

    expect(options.queryKey).toEqual([
      "growth-map",
      PROJECT_ID,
      UI_LOCALE,
      "keywords",
      { cursor: "next+/=", limit: 25 },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/mvp/projects/${PROJECT_ID}/audit/keywords?limit=25&cursor=next%2B%2F%3D`,
      expect.any(Object),
    );
  });

  it("uses the documented Keyword page default and omits an empty cursor", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(keywordLibraryResponse()));
    vi.stubGlobal("fetch", fetchMock);

    const options = buildGrowthMapKeywordsQueryOptions(
      PROJECT_ID,
      UI_LOCALE,
      { cursor: "" },
    );
    await getGrowthMapKeywords(PROJECT_ID, { cursor: "" });

    expect(options.queryKey).toEqual([
      "growth-map",
      PROJECT_ID,
      UI_LOCALE,
      "keywords",
      { cursor: null, limit: 50 },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/mvp/projects/${PROJECT_ID}/audit/keywords?limit=50`,
      expect.any(Object),
    );
  });

  it("keys Keyword detail by exact id and active UI locale", () => {
    expect(
      growthMapKeywordDetailQueryKey(PROJECT_ID, UI_LOCALE, KEYWORD_A),
    ).not.toEqual(
      growthMapKeywordDetailQueryKey(PROJECT_ID, UI_LOCALE, KEYWORD_B),
    );
    expect(
      growthMapKeywordsQueryKey(PROJECT_ID, "en", { limit: 25 }),
    ).not.toEqual(
      growthMapKeywordsQueryKey(PROJECT_ID, "zh-CN", { limit: 25 }),
    );
    expect(
      buildGrowthMapKeywordDetailQueryOptions(
        PROJECT_ID,
        UI_LOCALE,
        null,
      ).enabled,
    ).toBe(false);
    expect(
      buildGrowthMapKeywordDetailQueryOptions(
        PROJECT_ID,
        UI_LOCALE,
        KEYWORD_A,
      ).enabled,
    ).toBe(true);
  });

  it("switching Keyword id performs a distinct detail request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(keywordDetailResponse(KEYWORD_A)))
      .mockResolvedValueOnce(ok(keywordDetailResponse(KEYWORD_B)));
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const observer = new QueryObserver(
      client,
      buildGrowthMapKeywordDetailQueryOptions(
        PROJECT_ID,
        UI_LOCALE,
        KEYWORD_A,
      ),
    );

    const unsubscribe = observer.subscribe(() => undefined);
    await observer.refetch();
    observer.setOptions(
      buildGrowthMapKeywordDetailQueryOptions(
        PROJECT_ID,
        UI_LOCALE,
        KEYWORD_B,
      ),
    );
    await observer.refetch();
    unsubscribe();

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      `/api/mvp/projects/${PROJECT_ID}/audit/keywords/${KEYWORD_A}`,
      `/api/mvp/projects/${PROJECT_ID}/audit/keywords/${KEYWORD_B}`,
    ]);
  });

  it("does not construct a Keyword detail request without an exact id", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getGrowthMapKeywordDetail(PROJECT_ID, null)).rejects.toThrow(
      "keywordId",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed on an invalid Keyword Library projection", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      ok({
        projectId: PROJECT_ID,
        data: [{ keywordId: KEYWORD_A, displayKeyword: "invented score" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getGrowthMapKeywords(PROJECT_ID)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
