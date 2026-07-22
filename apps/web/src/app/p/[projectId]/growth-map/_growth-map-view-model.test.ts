import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type {
  GrowthMapKeywordNumericMetric,
  GrowthMapUrlFinding,
  GrowthMapUrlMetricObservation,
} from "@sf/contracts";
import { ApiError } from "@/lib/api";
import {
  GROWTH_MAP_OBJECT_MODES,
  GROWTH_MAP_DETAIL_STATES,
  buildGrowthMapReviewCommand,
  findMetricObservation,
  growthMapLocationHref,
  growthMapDetailAllowsFindingReview,
  competitorDetailReadState,
  competitorLibraryReadState,
  growthMapPlatformLimitationKey,
  rememberGrowthMapCursorPredecessor,
  resolveGrowthMapCursorPredecessor,
  keywordMetricPresentation,
  keywordDetailReadState,
  keywordLibraryReadState,
  metricValueLabelKey,
  metricPresentation,
  normalizeGrowthMapObjectMode,
  presentGrowthMapReviewProblem,
  resolveVisibleSitePageSelection,
  resolveVisibleSitePageSelectionForFinding,
  resolveVisibleCompetitorSelection,
  resolveVisibleKeywordSelection,
  safeExternalPageUrl,
  shouldShowGrowthMapReviewError,
  uniqueMetricSources,
} from "./_growth-map-view-model.ts";

const IDS = {
  action: "66666666-6666-4666-8666-666666666666",
  artifact: "77777777-7777-4777-8777-777777777777",
  evidence: "00000000-0000-4000-8000-000000000000",
  finding: "44444444-4444-4444-8444-444444444444",
  supportingFinding: "55555555-5555-4555-8555-555555555555",
  observation: "11111111-1111-4111-8111-111111111111",
  snapshot: "22222222-2222-4222-8222-222222222222",
  sitePage: "33333333-3333-4333-8333-333333333333",
} as const;

function apiError(
  code: string,
  overrides: {
    readonly title?: string;
    readonly detail?: string;
    readonly current?: Readonly<Record<string, unknown>> | null;
  } = {},
): ApiError {
  return new ApiError({
    type: "about:blank",
    title: overrides.title ?? "Canonical problem title",
    status: 409,
    code,
    detail: overrides.detail ?? "Canonical problem detail.",
    requestId: "request-1",
    ...(overrides.current === undefined ? {} : { current: overrides.current }),
  });
}

function reviewFinding(
  overrides: Partial<GrowthMapUrlFinding> = {},
): GrowthMapUrlFinding {
  return {
    findingId: IDS.finding,
    reviewRevision: 0,
    ...overrides,
  } as GrowthMapUrlFinding;
}

function metric(
  overrides: Partial<GrowthMapUrlMetricObservation> = {},
): GrowthMapUrlMetricObservation {
  return {
    provider: "gsc",
    metricKey: "gsc.page.v1",
    valueSource: {
      kind: "value_json",
      pointer: "/current28d/clicks",
    },
    subjectRef: "https://example.com/customer-onboarding/",
    value: 2450,
    unit: null,
    availability: "available",
    snapshotId: IDS.snapshot,
    observationId: IDS.observation,
    sitePageId: IDS.sitePage,
    observedAt: "2026-07-21T08:00:00Z",
    freshness: "current",
    limitation: null,
    ...overrides,
  } as GrowthMapUrlMetricObservation;
}

describe("Growth Map view model", () => {
  it("keeps Audit Evidence and Opportunity Review as selected-object detail states", () => {
    expect(GROWTH_MAP_DETAIL_STATES).toEqual([
      "audit_evidence",
      "opportunity_review",
    ]);
    expect(growthMapDetailAllowsFindingReview("audit_evidence")).toBe(false);
    expect(growthMapDetailAllowsFindingReview("opportunity_review")).toBe(true);
  });

  it("has exactly three second-level object modes and defaults to pages", () => {
    expect(GROWTH_MAP_OBJECT_MODES).toEqual([
      "pages",
      "keywords",
      "competitors",
    ]);
    expect(normalizeGrowthMapObjectMode(null)).toBe("pages");
    expect(normalizeGrowthMapObjectMode("unknown")).toBe("pages");
    expect(normalizeGrowthMapObjectMode("competitors")).toBe("competitors");
  });

  it("replaces selectedSitePageId on every URL selection while preserving current state", () => {
    const first = growthMapLocationHref(
      "/p/project/growth-map",
      "object=pages&q=onboarding&selectedSitePageId=old",
      { selectedSitePageId: "page-a" },
    );
    const second = growthMapLocationHref(
      "/p/project/growth-map",
      first.split("?")[1] ?? "",
      { selectedSitePageId: "page-b" },
    );

    expect(first).toBe(
      "/p/project/growth-map?object=pages&q=onboarding&selectedSitePageId=page-a",
    );
    expect(second).toBe(
      "/p/project/growth-map?object=pages&q=onboarding&selectedSitePageId=page-b",
    );
  });

  it("replaces selectedKeywordId on every Keyword selection while preserving its cursor", () => {
    const first = growthMapLocationHref(
      "/p/project/growth-map",
      "object=keywords&cursor=opaque&selectedKeywordId=old",
      { selectedKeywordId: "keyword-a" },
    );
    const second = growthMapLocationHref(
      "/p/project/growth-map",
      first.split("?")[1] ?? "",
      { selectedKeywordId: "keyword-b" },
    );

    expect(first).toBe(
      "/p/project/growth-map?object=keywords&cursor=opaque&selectedKeywordId=keyword-a",
    );
    expect(second).toBe(
      "/p/project/growth-map?object=keywords&cursor=opaque&selectedKeywordId=keyword-b",
    );
  });

  it("replaces selectedCompetitorId on every Competitor selection while preserving its cursor", () => {
    const first = growthMapLocationHref(
      "/p/project/growth-map",
      "object=competitors&cursor=opaque&selectedCompetitorId=old",
      { selectedCompetitorId: "competitor-a" },
    );
    const second = growthMapLocationHref(
      "/p/project/growth-map",
      first.split("?")[1] ?? "",
      { selectedCompetitorId: "competitor-b" },
    );

    expect(first).toBe(
      "/p/project/growth-map?object=competitors&cursor=opaque&selectedCompetitorId=competitor-a",
    );
    expect(second).toBe(
      "/p/project/growth-map?object=competitors&cursor=opaque&selectedCompetitorId=competitor-b",
    );
  });

  it("keeps Competitor detail constrained to the visible cursor page", () => {
    expect(
      resolveVisibleCompetitorSelection("competitor-b", [
        "competitor-a",
        "competitor-b",
      ]),
    ).toBe("competitor-b");
    expect(
      resolveVisibleCompetitorSelection("filtered-out", [
        "competitor-a",
        "competitor-b",
      ]),
    ).toBe("competitor-a");
    expect(resolveVisibleCompetitorSelection("stale", [])).toBeNull();
  });

  it("keeps Keyword detail constrained to the visible cursor page", () => {
    expect(
      resolveVisibleKeywordSelection("keyword-b", ["keyword-a", "keyword-b"]),
    ).toBe("keyword-b");
    expect(
      resolveVisibleKeywordSelection("filtered-out", [
        "keyword-a",
        "keyword-b",
      ]),
    ).toBe("keyword-a");
    expect(resolveVisibleKeywordSelection("stale", [])).toBeNull();
  });

  it("keeps Keyword Library loading, error, empty, and real rows distinct", () => {
    expect(
      keywordLibraryReadState({ isPending: true, isError: false, itemCount: 0 }),
    ).toBe("loading");
    expect(
      keywordLibraryReadState({ isPending: false, isError: true, itemCount: 0 }),
    ).toBe("error");
    expect(
      keywordLibraryReadState({
        isPending: false,
        isError: false,
        itemCount: 0,
        cursor: null,
      }),
    ).toBe("empty");
    expect(
      keywordLibraryReadState({
        isPending: false,
        isError: false,
        itemCount: 0,
        cursor: "next-page",
      }),
    ).toBe("cursor_empty");
    expect(
      keywordLibraryReadState({ isPending: false, isError: false, itemCount: 2 }),
    ).toBe("ready");
  });

  it("does not represent unselected, loading, or failed Keyword detail as data", () => {
    expect(
      keywordDetailReadState({
        selectedKeywordId: null,
        isPending: false,
        isError: false,
      }),
    ).toBe("unselected");
    expect(
      keywordDetailReadState({
        selectedKeywordId: "keyword-a",
        isPending: true,
        isError: false,
      }),
    ).toBe("loading");
    expect(
      keywordDetailReadState({
        selectedKeywordId: "keyword-a",
        isPending: false,
        isError: true,
      }),
    ).toBe("error");
    expect(
      keywordDetailReadState({
        selectedKeywordId: "keyword-a",
        isPending: false,
        isError: false,
      }),
    ).toBe("ready");
  });

  it("keeps Competitor Library loading, error, empty, and real rows distinct", () => {
    expect(
      competitorLibraryReadState({
        isPending: true,
        isError: false,
        itemCount: 0,
      }),
    ).toBe("loading");
    expect(
      competitorLibraryReadState({
        isPending: false,
        isError: true,
        itemCount: 0,
      }),
    ).toBe("error");
    expect(
      competitorLibraryReadState({
        isPending: false,
        isError: false,
        itemCount: 0,
        cursor: null,
      }),
    ).toBe("empty");
    expect(
      competitorLibraryReadState({
        isPending: false,
        isError: false,
        itemCount: 0,
        cursor: "next-page",
      }),
    ).toBe("cursor_empty");
    expect(
      competitorLibraryReadState({
        isPending: false,
        isError: false,
        itemCount: 2,
      }),
    ).toBe("ready");
  });

  it("does not represent unselected, loading, or failed Competitor detail as data", () => {
    expect(
      competitorDetailReadState({
        selectedCompetitorId: null,
        isPending: false,
        isError: false,
      }),
    ).toBe("unselected");
    expect(
      competitorDetailReadState({
        selectedCompetitorId: "competitor-a",
        isPending: true,
        isError: false,
      }),
    ).toBe("loading");
    expect(
      competitorDetailReadState({
        selectedCompetitorId: "competitor-a",
        isPending: false,
        isError: true,
      }),
    ).toBe("error");
    expect(
      competitorDetailReadState({
        selectedCompetitorId: "competitor-a",
        isPending: false,
        isError: false,
      }),
    ).toBe("ready");
  });

  it("recognizes only stable platform limitations for localized chrome", () => {
    const cases = [
      [
        "No canonical Keyword Library entries are available on this cursor page.",
        "keywordNoEntries",
      ],
      [
        "No canonical Competitor Library entries are available on this cursor page.",
        "competitorNoEntries",
      ],
      [
        "Only the most recent 100 immutable origin occurrences are included; older canonical origin history remains available in storage.",
        "competitorOriginHistoryLimited",
      ],
      [
        "SERP overlap is unavailable because Competitor Library v1 has no canonical SERP-overlap writer.",
        "competitorSerpWriterUnavailable",
      ],
      [
        "AI citation insight is unavailable because Competitor Library v1 has no canonical AI-citation writer.",
        "competitorAiCitationWriterUnavailable",
      ],
      [
        "This Competitor is still a candidate and has not been approved for analysis.",
        "competitorCandidate",
      ],
      [
        "This Competitor has been excluded from the approved analysis scope.",
        "competitorExcluded",
      ],
      [
        "A Product Profile source is approved, but this stable Competitor Library entity is still awaiting its own review.",
        "competitorSourceApprovedReviewPending",
      ],
    ] as const;

    for (const [limitation, key] of cases) {
      expect(growthMapPlatformLimitationKey(limitation)).toBe(key);
    }
    expect(
      growthMapPlatformLimitationKey("Customer-authored limitation text."),
    ).toBeNull();
  });

  it("repairs only an explicit stale Keyword deep link after the cursor page loads", () => {
    const source = readFileSync(
      new URL("./_growth-map.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toMatch(
      /!listQuery\.isSuccess \|\|\s+requestedKeywordId === null \|\|\s+requestedKeywordId === selectedKeywordId/,
    );
    expect(source).toMatch(
      /growthMapLocationHref\(pathname, locationSearch, \{ selectedKeywordId \}\)/,
    );
  });

  it("repairs only an explicit stale Competitor deep link after the cursor page loads", () => {
    const source = readFileSync(
      new URL("./_growth-map.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toMatch(
      /!listQuery\.isSuccess \|\|\s+requestedCompetitorId === null \|\|\s+requestedCompetitorId === selectedCompetitorId/,
    );
    expect(source).toMatch(
      /growthMapLocationHref\(pathname, locationSearch, \{ selectedCompetitorId \}\)/,
    );
  });

  it("keys cursor predecessors by the current URL cursor so browser history cannot use a stale stack", () => {
    let predecessors: ReadonlyMap<string, string | null> = new Map();
    predecessors = rememberGrowthMapCursorPredecessor(
      predecessors,
      null,
      "page-2",
    );
    predecessors = rememberGrowthMapCursorPredecessor(
      predecessors,
      "page-2",
      "page-3",
    );

    expect(resolveGrowthMapCursorPredecessor(predecessors, "page-3")).toBe(
      "page-2",
    );
    expect(resolveGrowthMapCursorPredecessor(predecessors, "page-2")).toBeNull();
    expect(
      resolveGrowthMapCursorPredecessor(predecessors, "external-page"),
    ).toBeUndefined();
    expect(resolveGrowthMapCursorPredecessor(predecessors, null)).toBeUndefined();
  });

  it("routes Competitor Library source management to the canonical project Sources page", () => {
    const source = readFileSync(
      new URL("./_growth-map.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('href={`/p/${projectId}/sources`}');
    expect(source).not.toContain("function UnavailableLibrary");
  });

  it("keeps customer-facing source summaries visible and raw library lineage in native disclosures", () => {
    const source = readFileSync(
      new URL("./_growth-map.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('<details className={styles.traceDisclosure}>');
    expect(source).toContain('<summary>{t("viewSourceDetails")}</summary>');
    expect(source).toContain('<summary>{t("viewOriginDetails")}</summary>');
    expect(source).toContain('<summary>{t("viewRecordDetails")}</summary>');
    expect(source).not.toContain("<details open");
    expect(source).not.toContain("truncateId(occurrence.occurrenceId)");
    expect(source).not.toContain("truncateId(evidence.evidenceRefId)");
  });

  it("selects the visible URL that owns an exact Finding deep link", () => {
    expect(
      resolveVisibleSitePageSelectionForFinding(
        null,
        "finding-b",
        [
          { sitePageId: "page-a", findingIds: ["finding-a"] },
          { sitePageId: "page-b", findingIds: ["finding-b"] },
        ],
      ),
    ).toBe("page-b");

    expect(
      resolveVisibleSitePageSelectionForFinding(
        "page-a",
        "finding-b",
        [
          { sitePageId: "page-a", findingIds: ["finding-a"] },
          { sitePageId: "page-b", findingIds: ["finding-b"] },
        ],
      ),
    ).toBe("page-a");
  });

  it("never lets a stale URL selection drive detail outside the visible page", () => {
    expect(
      resolveVisibleSitePageSelection("page-b", ["page-a", "page-b"]),
    ).toBe("page-b");
    expect(
      resolveVisibleSitePageSelection("filtered-out", ["page-a", "page-b"]),
    ).toBe("page-a");
    expect(resolveVisibleSitePageSelection("stale", [])).toBeNull();
  });

  it("clears URL-specific state when leaving the page portfolio", () => {
    expect(
      growthMapLocationHref(
        "/p/project/growth-map",
        "q=pricing&cursor=opaque&selectedSitePageId=page-a",
        { mode: "keywords" },
      ),
    ).toBe("/p/project/growth-map?object=keywords");
  });

  it("clears Keyword-only state and its opaque cursor when switching objects", () => {
    expect(
      growthMapLocationHref(
        "/p/project/growth-map",
        "object=keywords&cursor=keyword-page&selectedKeywordId=keyword-a",
        { mode: "pages" },
      ),
    ).toBe("/p/project/growth-map?object=pages");
    expect(
      growthMapLocationHref(
        "/p/project/growth-map",
        "object=keywords&cursor=keyword-page&selectedKeywordId=keyword-a",
        { mode: "competitors" },
      ),
    ).toBe("/p/project/growth-map?object=competitors");
  });

  it("keeps active Competitor state but clears it when switching objects", () => {
    expect(
      growthMapLocationHref(
        "/p/project/growth-map",
        "object=competitors&cursor=competitor-page&selectedCompetitorId=competitor-a",
        { mode: "competitors" },
      ),
    ).toBe(
      "/p/project/growth-map?object=competitors&cursor=competitor-page&selectedCompetitorId=competitor-a",
    );
    expect(
      growthMapLocationHref(
        "/p/project/growth-map",
        "object=competitors&cursor=competitor-page&selectedCompetitorId=competitor-a",
        { mode: "keywords" },
      ),
    ).toBe("/p/project/growth-map?object=keywords");
    expect(
      growthMapLocationHref(
        "/p/project/growth-map",
        "object=competitors&cursor=competitor-page&selectedCompetitorId=competitor-a",
        { mode: "pages" },
      ),
    ).toBe("/p/project/growth-map?object=pages");
  });

  it("selects a metric only by persisted provider and JSON pointer", () => {
    const clicks = metric();
    const position = metric({
      valueSource: {
        kind: "value_json",
        pointer: "/current28d/position",
      },
      value: 12.8,
    });
    expect(
      findMetricObservation([position, clicks], {
        provider: "gsc",
        pointer: "/current28d/clicks",
      }),
    ).toBe(clicks);
    expect(
      findMetricObservation([clicks], {
        provider: "ga4",
        pointer: "/sessions",
      }),
    ).toBeNull();
  });

  it("keeps missing observations missing and preserves a genuinely observed zero", () => {
    expect(metricPresentation(null)).toEqual({ state: "missing" });
    expect(
      metricPresentation(
        metric({
          availability: "unavailable",
          value: null,
          limitation: "GSC did not return page-level metrics.",
        }),
      ),
    ).toEqual({
      state: "unavailable",
      limitation: "GSC did not return page-level metrics.",
    });
    expect(
      metricPresentation(
        metric({
          availability: "partial",
          value: null,
          limitation: "Only a subset of the requested window was returned.",
        }),
      ),
    ).toEqual({
      state: "partial",
      limitation: "Only a subset of the requested window was returned.",
    });
    expect(metricPresentation(metric({ value: 0 }))).toEqual({
      state: "observed",
      value: 0,
      unit: null,
    });
  });

  it("presents only canonical Keyword metric values and preserves their limitations", () => {
    const observedZero = {
      snapshotId: IDS.snapshot,
      observationId: IDS.observation,
      valuePointer: "/valueJson/searchVolume",
      observedAt: "2026-07-21T08:00:00Z",
      freshness: "current",
      limitation: null,
      value: 0,
    } as GrowthMapKeywordNumericMetric;

    expect(keywordMetricPresentation(observedZero, null)).toEqual({
      state: "observed",
      value: 0,
      observedAt: "2026-07-21T08:00:00Z",
      freshness: "current",
      limitation: null,
    });
    expect(
      keywordMetricPresentation(
        null,
        "No canonical Keyword Difficulty observation is available.",
      ),
    ).toEqual({
      state: "unavailable",
      limitation: "No canonical Keyword Difficulty observation is available.",
    });
    expect(
      keywordMetricPresentation(
        { ...observedZero, value: null, freshness: "unknown", limitation: "The source returned no value." },
        null,
      ),
    ).toEqual({
      state: "unavailable",
      limitation: "The source returned no value.",
    });
  });

  it("labels missing and unavailable observations as No data without hiding partial, stale, or zero", () => {
    expect(metricValueLabelKey(metricPresentation(null))).toBe("noData");
    expect(
      metricValueLabelKey(
        metricPresentation(
          metric({
            availability: "unavailable",
            value: null,
            limitation: "GSC did not return page-level metrics.",
          }),
        ),
      ),
    ).toBe("noData");
    expect(
      metricValueLabelKey(
        metricPresentation(
          metric({
            availability: "partial",
            value: null,
            limitation: "Only part of the requested window was returned.",
          }),
        ),
      ),
    ).toBe("coverage.partial");
    expect(
      metricValueLabelKey(
        metricPresentation(metric({ value: 0, freshness: "current" })),
      ),
    ).toBeNull();
    expect(
      metricValueLabelKey(
        metricPresentation(
          metric({
            value: 0,
            freshness: "stale",
            limitation: "The latest connected source is outside the current window.",
          }),
        ),
      ),
    ).toBeNull();
  });

  it("builds exactly one canonical Finding review command without batching supporting IDs", () => {
    const command = buildGrowthMapReviewCommand({
      target: { kind: "finding", finding: reviewFinding() },
      reviewableFindingIds: [IDS.finding, IDS.supportingFinding],
      intent: { reviewState: "confirmed" },
    });

    expect(command).toEqual({
      findingId: IDS.finding,
      body: { reviewState: "confirmed", baseRevision: 0 },
    });
    expect(command).not.toHaveProperty("findingIds");
    expect(command).not.toHaveProperty("primaryFindingId");
    expect(JSON.stringify(command)).not.toContain(IDS.supportingFinding);
  });

  it("never creates a review command for observed Evidence or a non-reviewable Finding", () => {
    expect(
      buildGrowthMapReviewCommand({
        target: { kind: "observed_evidence", evidenceId: IDS.evidence },
        reviewableFindingIds: [IDS.finding],
        intent: { reviewState: "confirmed" },
      }),
    ).toBeNull();
    expect(
      buildGrowthMapReviewCommand({
        target: { kind: "finding", finding: reviewFinding() },
        reviewableFindingIds: [],
        intent: { reviewState: "confirmed" },
      }),
    ).toBeNull();
  });

  it("maps Dismiss and Needs Data to the canonical single-Finding request bodies", () => {
    const target = { kind: "finding", finding: reviewFinding() } as const;
    const reviewableFindingIds = [IDS.finding] as const;

    expect(
      buildGrowthMapReviewCommand({
        target,
        reviewableFindingIds,
        intent: { reviewState: "ignored", reason: "Not applicable here" },
      }),
    ).toEqual({
      findingId: IDS.finding,
      body: {
        reviewState: "ignored",
        baseRevision: 0,
        reason: "Not applicable here",
      },
    });
    expect(
      buildGrowthMapReviewCommand({
        target,
        reviewableFindingIds,
        intent: {
          reviewState: "needs_more_data",
          note: "Connect the missing source",
        },
      }),
    ).toEqual({
      findingId: IDS.finding,
      body: {
        reviewState: "needs_more_data",
        baseRevision: 0,
        note: "Connect the missing source",
      },
    });
  });

  it("preserves canonical conflict code, title, and detail with refresh recovery", () => {
    expect(
      presentGrowthMapReviewProblem(
        apiError("VERSION_CONFLICT", {
          title: "Version conflict",
          detail: "Finding was modified; refetch and retry.",
        }),
        null,
      ),
    ).toEqual({
      kind: "canonical",
      code: "VERSION_CONFLICT",
      title: "Version conflict",
      detail: "Finding was modified; refetch and retry.",
      recovery: "refresh",
      executionRef: null,
    });
  });

  it("uses a validated response executionRef for FINDING_ACTION_ACTIVE recovery", () => {
    expect(
      presentGrowthMapReviewProblem(
        apiError("FINDING_ACTION_ACTIVE", {
          title: "Finding action active",
          detail:
            "Dismiss the linked action in the plan before changing this finding.",
          current: {
            executionRef: {
              actionId: IDS.action,
              artifactIds: [IDS.artifact],
            },
          },
        }),
        null,
      ),
    ).toEqual({
      kind: "canonical",
      code: "FINDING_ACTION_ACTIVE",
      title: "Finding action active",
      detail:
        "Dismiss the linked action in the plan before changing this finding.",
      recovery: "resolve_active_action",
      executionRef: {
        actionId: IDS.action,
        artifactIds: [IDS.artifact],
      },
    });
  });

  it("builds an Action-only recovery link when current exposes a canonical actionId", () => {
    expect(
      presentGrowthMapReviewProblem(
        apiError("FINDING_ACTION_ACTIVE", {
          current: { actionId: IDS.action },
        }),
        null,
      ),
    ).toMatchObject({
      recovery: "resolve_active_action",
      executionRef: {
        actionId: IDS.action,
        artifactIds: [],
      },
    });
  });

  it("falls back to the Finding executionRef when active-action metadata is absent or malformed", () => {
    const fallback = {
      actionId: IDS.action,
      artifactIds: [IDS.artifact],
    };

    expect(
      presentGrowthMapReviewProblem(
        apiError("FINDING_ACTION_ACTIVE", {
          current: {
            executionRef: {
              actionId: "javascript:alert(1)",
              artifactIds: ["not-an-id"],
            },
          },
        }),
        fallback,
      ),
    ).toMatchObject({
      recovery: "resolve_active_action",
      executionRef: fallback,
    });
  });

  it("does not expose raw unknown exceptions or unregistered problem details", () => {
    const rawError = new Error("database-password=do-not-render");
    rawError.stack = "sensitive stack trace";
    expect(presentGrowthMapReviewProblem(rawError, null)).toEqual({
      kind: "fallback",
      recovery: "retry",
      executionRef: null,
    });

    expect(
      presentGrowthMapReviewProblem(
        apiError("UNREGISTERED_REVIEW_FAILURE", {
          title: "raw upstream title",
          detail: "provider-secret-detail",
        }),
        null,
      ),
    ).toEqual({
      kind: "fallback",
      recovery: "retry",
      executionRef: null,
    });
  });

  it("keeps a mutation error visible in every open review form mode", () => {
    const problem = presentGrowthMapReviewProblem(
      apiError("FINDING_ACTION_ACTIVE"),
      null,
    );
    expect(shouldShowGrowthMapReviewError("idle", problem)).toBe(true);
    expect(shouldShowGrowthMapReviewError("dismiss", problem)).toBe(true);
    expect(shouldShowGrowthMapReviewError("needs_more_data", problem)).toBe(
      true,
    );
    expect(shouldShowGrowthMapReviewError("dismiss", null)).toBe(false);
  });

  it("renders mutation feedback outside the idle-only branch and clears it after a successful refresh", () => {
    const source = readFileSync(new URL("./_growth-map.tsx", import.meta.url), "utf8");

    expect(source).not.toContain('mode === "idle" && error !== null');
    expect(source).toContain("shouldShowGrowthMapReviewError(mode, problemError)");
    expect(source).toMatch(
      /await refreshGrowthMap\(\);\s+setError\(null\);\s+setProblemError\(null\);\s+setSaved\(true\);/,
    );
  });

  it("deduplicates source facts by canonical Observation id", () => {
    const clicks = metric();
    const position = metric({
      valueSource: {
        kind: "value_json",
        pointer: "/current28d/position",
      },
      value: 12.8,
    });
    const other = metric({
      observationId: "44444444-4444-4444-8444-444444444444",
      snapshotId: "55555555-5555-4555-8555-555555555555",
      value: 91,
    });

    expect(uniqueMetricSources([clicks, position, other])).toEqual([
      clicks,
      other,
    ]);
  });

  it("only exposes http(s) page URLs as external links", () => {
    expect(safeExternalPageUrl("https://example.com/page")).toBe(
      "https://example.com/page",
    );
    expect(safeExternalPageUrl("http://example.com/page")).toBe(
      "http://example.com/page",
    );
    expect(safeExternalPageUrl("javascript:alert(1)")).toBeNull();
  });
});
