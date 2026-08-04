import {
  METRIC_CRAWL_PAGE,
  METRIC_CRAWL_ROBOTS,
  METRIC_CSV_KEYWORD_GAP,
  METRIC_GA4_LANDING,
  METRIC_GSC_PAGE,
  type CrawlPageProjection,
  type CrawlRobotsProjection,
  type CsvKeywordProjection,
  type Ga4LandingProjection,
  type GscPageProjection,
  type GscTopQuery,
} from "@sf/sources";
import { describe, expect, it } from "vitest";
import {
  DiagnosticContext,
  type CoverageInput,
  type ObservationView,
} from "../context.ts";
import { parseIcp } from "../icp.ts";
import type { RuleId, RuleResult } from "../rule.ts";
import { testObservationLineage } from "../test-observation-lineage.ts";
import { ALL_RULES } from "./index.ts";

/**
 * AC-021 behavior snapshots. These fixtures execute every real rule; registry
 * metadata alone cannot satisfy this suite. Inputs use a fixed capture time and
 * output normalization removes only instrumentation fields, not rule evidence.
 */

const OBSERVED_AT = "2026-07-18T00:00:00.000Z";
const SITE = "https://example.com";
const PRICING = `${SITE}/pricing`;
const PRODUCT = `${SITE}/product`;
const DEMO = `${SITE}/demo`;

type Scenario = "pass" | "candidate" | "missing" | "edge";

interface RuleFixtures {
  readonly pass: DiagnosticContext;
  readonly candidate: DiagnosticContext;
  readonly missing: DiagnosticContext;
  readonly edge: DiagnosticContext;
}

function context(input: {
  readonly observations?: readonly ObservationView[];
  readonly coverage?: Partial<CoverageInput>;
  readonly icp?: Readonly<Record<string, unknown>>;
}): DiagnosticContext {
  return DiagnosticContext.build({
    icp: parseIcp({
      productName: "Acme",
      oneLineDescription: "A collaboration workspace",
      siteLanguageCodes: ["en"],
      offers: [],
      useCases: [],
      priorityUrls: [],
      ...input.icp,
    }),
    deliveryLocale: "en",
    observations: input.observations ?? [],
    coverage: {
      crawl: "unavailable",
      gsc: "unavailable",
      ga4: "unavailable",
      csv: "unavailable",
      ...input.coverage,
    },
    capturedAt: {
      crawl: OBSERVED_AT,
      gsc: OBSERVED_AT,
      ga4: OBSERVED_AT,
      csv: OBSERVED_AT,
    },
  });
}

function observation(
  metricKey: string,
  provider: string,
  subjectType: string,
  subjectRef: string,
  valueJson: unknown,
): ObservationView {
  const crawlFetchUrl =
    metricKey === METRIC_CRAWL_PAGE
      ? (valueJson as CrawlPageProjection).fetchUrl
      : null;
  const analyticsUrl =
    metricKey === METRIC_GSC_PAGE || metricKey === METRIC_GA4_LANDING
      ? subjectRef
      : null;
  const sitePageUrl = crawlFetchUrl ?? analyticsUrl;
  return {
    ...testObservationLineage(
      `${provider}:${subjectRef}:${JSON.stringify(valueJson)}`,
      {
        sitePageUrl,
        pageSnapshot: crawlFetchUrl !== null,
      },
    ),
    metricKey,
    subjectType,
    subjectRef,
    provider,
    availability: "available",
    valueJson,
    observedAt: OBSERVED_AT,
  };
}

function crawlPage(
  fetchUrl: string,
  overrides: Partial<CrawlPageProjection> = {},
): CrawlPageProjection {
  return {
    fetchUrl,
    status: 200,
    finalStatus: 200,
    redirectChain: [],
    canonicalTarget: null,
    robotsIndexable: true,
    robotsDirectives: [],
    title: "Page",
    metaDescription: null,
    h1: ["Page"],
    headings: [],
    wordCount: 100,
    internalOutlinks: [],
    jsonLd: { types: [], errorCount: 0 },
    sitemapMember: false,
    bodyExcerpt: null,
    paragraphs: [],
    responseMs: 100,
    contentType: "text/html",
    ...overrides,
  };
}

function crawlObs(
  subjectUrl: string,
  overrides: Partial<CrawlPageProjection> = {},
): ObservationView {
  return observation(
    METRIC_CRAWL_PAGE,
    "crawl",
    "url",
    subjectUrl,
    crawlPage(subjectUrl, overrides),
  );
}

function link(targetSubjectUrl: string) {
  return { targetSubjectUrl, rel: null, anchorText: null } as const;
}

function gscPage(input: {
  readonly currentClicks: number;
  readonly currentImpressions: number;
  readonly position: number | null;
  readonly previousClicks?: number;
  readonly topQueries?: readonly GscTopQuery[];
}): GscPageProjection {
  return {
    current28d: {
      clicks: input.currentClicks,
      impressions: input.currentImpressions,
      position: input.position,
    },
    previous28d: {
      clicks: input.previousClicks ?? 0,
      impressions: input.currentImpressions,
      position: input.position,
    },
    topQueries: input.topQueries ?? [],
  };
}

function gscObs(subjectUrl: string, page: GscPageProjection): ObservationView {
  return observation(METRIC_GSC_PAGE, "gsc", "url", subjectUrl, page);
}

function ga4Landing(
  sessions: number,
  keyEvents: number | null,
): Ga4LandingProjection {
  return {
    sessions,
    engagedSessions: null,
    engagementRate: null,
    keyEvents,
    keyEventUnavailableReason: keyEvents === null ? "unmapped" : null,
  };
}

function ga4Obs(
  subjectUrl: string,
  sessions: number,
  keyEvents: number | null,
): ObservationView {
  return observation(
    METRIC_GA4_LANDING,
    "ga4",
    "url",
    subjectUrl,
    ga4Landing(sessions, keyEvents),
  );
}

function robotsObs(
  groups: CrawlRobotsProjection["groups"],
  fetched = true,
): ObservationView {
  return observation(
    METRIC_CRAWL_ROBOTS,
    "crawl",
    "site",
    SITE,
    { fetched, groups, sitemaps: [] } satisfies CrawlRobotsProjection,
  );
}

function csvKeyword(
  clusterKey: string,
  keyword: string,
  searchVolume: number | null,
): CsvKeywordProjection {
  return {
    keyword,
    clusterKey,
    searchVolume,
    currentUrl: null,
    currentRank: null,
    competitorDomain: null,
    competitorRank: null,
    marketCode: "us",
    languageCode: "en",
  };
}

function csvClusterObs(
  clusterKey: string,
  keywords: readonly (readonly [string, number | null])[],
): readonly ObservationView[] {
  return keywords.map(([keyword, volume]) =>
    observation(
      METRIC_CSV_KEYWORD_GAP,
      "csv",
      "keyword_cluster",
      clusterKey,
      csvKeyword(clusterKey, keyword, volume),
    ),
  );
}

const QUALIFYING_CLUSTER = [
  ["project management software", 500],
  ["project management tool", 100],
  ["project management app", 100],
  ["project tracking", 100],
  ["task management", 100],
  ["team planning", 100],
  ["gantt chart tool", 100],
  ["kanban board", 100],
  ["sprint planning", 100],
  ["work management", 100],
] as const;

const EXACT_THRESHOLD_CLUSTER = [
  ["edge demand topic one", 50],
  ["edge demand topic two", 50],
  ["edge demand topic three", 50],
  ["edge demand topic four", 50],
  ["edge demand topic five", 50],
  ["edge demand topic six", 50],
  ["edge demand topic seven", 50],
  ["edge demand topic eight", 50],
  ["edge demand topic nine", 50],
  ["edge demand topic ten", 50],
] as const;

const PROOF = "Acme Corp reduced onboarding time by 40% within 90 days.";
const NO_PROOF = "We help teams move faster every single day.";

const FIXTURES = {
  "TECH-HTTP-001": {
    pass: context({
      coverage: { crawl: "available" },
      observations: [crawlObs(`${SITE}/healthy`, { finalStatus: 200 })],
    }),
    candidate: context({
      coverage: { crawl: "available" },
      observations: [
        crawlObs(PRICING, { status: 404, finalStatus: 404 }),
        crawlObs(`${SITE}/about`, { status: 500, finalStatus: 500 }),
      ],
    }),
    missing: context({ coverage: { crawl: "unavailable" } }),
    edge: context({
      coverage: { crawl: "available" },
      observations: [
        crawlObs(`${SITE}/zero`, { status: 0, finalStatus: 0 }),
        crawlObs(`${SITE}/unknown`, { status: null, finalStatus: null }),
      ],
    }),
  },
  "TECH-CANONICAL-002": {
    pass: context({
      coverage: { crawl: "available" },
      observations: [crawlObs(`${SITE}/self`, { canonicalTarget: `${SITE}/self` })],
    }),
    candidate: context({
      coverage: { crawl: "available" },
      observations: [
        crawlObs(`${SITE}/a`, { canonicalTarget: `${SITE}/b` }),
        crawlObs(`${SITE}/b`, { canonicalTarget: `${SITE}/a` }),
      ],
    }),
    missing: context({ coverage: { crawl: "unavailable" } }),
    edge: context({
      coverage: { crawl: "available" },
      observations: [
        crawlObs(`${SITE}/external`, {
          canonicalTarget: "https://canonical.example.net/resource",
        }),
      ],
    }),
  },
  "TECH-LINKGRAPH-005": {
    pass: context({
      coverage: { crawl: "available" },
      observations: [],
    }),
    candidate: context({
      coverage: { crawl: "available" },
      icp: { priorityUrls: [PRICING] },
      observations: [
        crawlObs(`${SITE}/home`, { internalOutlinks: [link(PRICING)] }),
        crawlObs(PRICING),
      ],
    }),
    missing: context({ coverage: { crawl: "unavailable" } }),
    edge: context({
      coverage: { crawl: "partial" },
      observations: [crawlObs(PRICING)],
    }),
  },
  "SEARCH-CTR-004": {
    pass: context({
      coverage: { gsc: "available" },
      observations: [
        gscObs(
          `${SITE}/healthy`,
          gscPage({ currentClicks: 400, currentImpressions: 2_000, position: 3 }),
        ),
      ],
    }),
    candidate: context({
      coverage: { gsc: "available" },
      icp: { priorityUrls: [PRODUCT] },
      observations: [
        gscObs(
          PRODUCT,
          gscPage({
            currentClicks: 20,
            currentImpressions: 2_000,
            position: 3,
            topQueries: [
              { query: "beta", clicks: 5, impressions: 400, position: 3 },
              { query: "alpha", clicks: 10, impressions: 900, position: 2 },
            ],
          }),
        ),
      ],
    }),
    missing: context({ coverage: { gsc: "unavailable" } }),
    edge: context({
      coverage: { gsc: "available" },
      observations: [
        gscObs(
          `${SITE}/threshold`,
          gscPage({ currentClicks: 50, currentImpressions: 1_000, position: 3 }),
        ),
      ],
    }),
  },
  "SEARCH-DECAY-002": {
    pass: context({
      coverage: { gsc: "available" },
      observations: [
        gscObs(
          `${SITE}/stable`,
          gscPage({
            currentClicks: 190,
            currentImpressions: 5_000,
            previousClicks: 200,
            position: 4,
          }),
        ),
      ],
    }),
    candidate: context({
      coverage: { gsc: "available" },
      icp: { priorityUrls: [PRODUCT] },
      observations: [
        gscObs(
          PRODUCT,
          gscPage({
            currentClicks: 100,
            currentImpressions: 5_000,
            previousClicks: 200,
            position: 4,
          }),
        ),
      ],
    }),
    missing: context({ coverage: { gsc: "unavailable" } }),
    edge: context({
      coverage: { gsc: "available" },
      observations: [
        gscObs(
          `${SITE}/threshold`,
          gscPage({
            currentClicks: 80,
            currentImpressions: 5_000,
            previousClicks: 100,
            position: 4,
          }),
        ),
      ],
    }),
  },
  "CONTENT-COVERAGE-001": {
    pass: context({
      coverage: { crawl: "available" },
      icp: { offers: ["team collaboration"] },
      observations: [
        crawlObs(`${SITE}/collaboration`, {
          title: "Team Collaboration Software",
          h1: ["Team Collaboration"],
        }),
      ],
    }),
    candidate: context({
      coverage: { crawl: "available" },
      icp: {
        offers: ["team collaboration"],
        useCases: ["remote onboarding"],
      },
      observations: [
        crawlObs(PRICING, { title: "Pricing Plans", h1: ["Pricing"] }),
      ],
    }),
    missing: context({
      coverage: { crawl: "unavailable" },
      icp: { offers: ["team collaboration"] },
    }),
    edge: context({
      coverage: { crawl: "available" },
      icp: { offers: ["team collaboration"] },
      observations: [crawlObs(PRICING, { title: null, h1: [] })],
    }),
  },
  "CONTENT-GAP-011": {
    pass: context({
      coverage: { crawl: "available", csv: "available" },
      observations: [
        ...csvClusterObs("project-management", QUALIFYING_CLUSTER),
        crawlObs(`${SITE}/project-management-software`, {
          title: "Project Management Software",
          h1: ["Project Management Software"],
        }),
      ],
    }),
    candidate: context({
      coverage: { crawl: "available", csv: "available" },
      observations: [
        ...csvClusterObs("project-management", QUALIFYING_CLUSTER),
        crawlObs(PRICING, { title: "Pricing", h1: ["Pricing"] }),
      ],
    }),
    missing: context({
      coverage: { crawl: "available", csv: "unavailable" },
      observations: [crawlObs(PRICING)],
    }),
    edge: context({
      coverage: { crawl: "available", csv: "available" },
      observations: [
        ...csvClusterObs("exact-threshold", EXACT_THRESHOLD_CLUSTER),
        crawlObs(PRICING, { title: "Pricing", h1: ["Pricing"] }),
      ],
    }),
  },
  "CRO-PATH-001": {
    pass: context({
      coverage: { crawl: "available" },
      icp: {
        primaryConversion: { label: "Demo", type: "demo", targetUrl: DEMO },
        priorityUrls: [PRODUCT],
      },
      observations: [
        crawlObs(DEMO),
        crawlObs(PRICING, { internalOutlinks: [link(DEMO)] }),
        crawlObs(PRODUCT, { internalOutlinks: [link(DEMO)] }),
      ],
    }),
    candidate: context({
      coverage: { crawl: "available" },
      icp: {
        primaryConversion: { label: "Demo", type: "demo", targetUrl: DEMO },
        priorityUrls: [PRODUCT],
      },
      observations: [crawlObs(DEMO), crawlObs(PRODUCT)],
    }),
    missing: context({
      coverage: { crawl: "unavailable" },
      icp: {
        primaryConversion: { label: "Demo", type: "demo", targetUrl: DEMO },
      },
    }),
    edge: context({
      coverage: { crawl: "available" },
      icp: {
        primaryConversion: { label: "Other", type: "other", targetUrl: null },
      },
      observations: [crawlObs(PRICING)],
    }),
  },
  "CRO-LANDING-003": {
    pass: context({
      coverage: { ga4: "available" },
      observations: [
        ga4Obs(`${SITE}/good-a`, 1_000, 100),
        ga4Obs(`${SITE}/good-b`, 1_000, 90),
      ],
    }),
    candidate: context({
      coverage: { ga4: "available" },
      observations: [
        ga4Obs(`${SITE}/good-a`, 1_000, 100),
        ga4Obs(`${SITE}/good-b`, 1_000, 100),
        ga4Obs(PRICING, 1_000, 40),
        ga4Obs(`${SITE}/small`, 300, 0),
        ga4Obs(`${SITE}/unmapped`, 2_000, null),
      ],
    }),
    missing: context({ coverage: { ga4: "unavailable" } }),
    edge: context({
      coverage: { ga4: "available" },
      observations: [
        ga4Obs(`${SITE}/unmapped-a`, 1_000, null),
        ga4Obs(`${SITE}/unmapped-b`, 2_000, null),
      ],
    }),
  },
  "GEO-ENTITY-001": {
    pass: context({
      coverage: { crawl: "available" },
      observations: [
        crawlObs(PRICING, {
          jsonLd: { types: ["Product"], errorCount: 0 },
          paragraphs: [PROOF],
        }),
        crawlObs(PRODUCT, {
          jsonLd: { types: ["Organization"], errorCount: 0 },
          paragraphs: [PROOF],
        }),
      ],
    }),
    candidate: context({
      coverage: { crawl: "available" },
      icp: { priorityUrls: [PRICING] },
      observations: [
        crawlObs(PRICING, { paragraphs: [NO_PROOF] }),
        crawlObs(PRODUCT, { paragraphs: [NO_PROOF] }),
      ],
    }),
    missing: context({ coverage: { crawl: "unavailable" } }),
    edge: context({
      coverage: { crawl: "available" },
      icp: { siteLanguageCodes: ["de"] },
      observations: [crawlObs(PRICING, { paragraphs: [NO_PROOF] })],
    }),
  },
  "GEO-CRAWLER-002": {
    pass: context({
      coverage: { crawl: "available" },
      observations: [
        robotsObs([{ userAgent: "*", disallow: ["/admin"], allow: [] }]),
      ],
    }),
    candidate: context({
      coverage: { crawl: "available" },
      observations: [
        robotsObs([{ userAgent: "*", disallow: ["/"], allow: [] }]),
      ],
    }),
    missing: context({ coverage: { crawl: "unavailable" } }),
    edge: context({
      coverage: { crawl: "available" },
      observations: [
        robotsObs([
          { userAgent: "*", disallow: ["/"], allow: [] },
          { userAgent: "ClaudeBot", disallow: [], allow: [] },
        ]),
      ],
    }),
  },
} satisfies Record<RuleId, RuleFixtures>;

const SCENARIOS = ["pass", "candidate", "missing", "edge"] as const;
const VOLATILE_FIELDS = new Set(["duration", "durationMs", "elapsedMs"]);

function stableOutput(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableOutput);
  if (typeof value !== "object" || value === null) return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !VOLATILE_FIELDS.has(key))
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => [key, stableOutput(item)]),
  );
}

describe("AC-021 canonical outputs for all 11 deterministic rules", () => {
  it("defines a complete fixture matrix in frozen rule order", () => {
    expect(Object.keys(FIXTURES)).toEqual(ALL_RULES.map((rule) => rule.id));
    expect(ALL_RULES).toHaveLength(11);
  });

  for (const rule of ALL_RULES) {
    it(`${rule.id} snapshots actual pass/candidate/missing/edge RuleResult output`, async () => {
      const raw = {} as Record<Scenario, RuleResult>;
      for (const scenario of SCENARIOS) {
        raw[scenario] = await rule.evaluate(FIXTURES[rule.id][scenario]);
      }

      expect(raw.pass.status).toBe("pass");
      expect(raw.candidate.status).toBe("candidate");
      expect(raw.missing).toEqual({
        status: "skipped",
        reason: "missing_dataset",
      });

      const output = Object.fromEntries(
        SCENARIOS.map((scenario) => [scenario, stableOutput(raw[scenario])]),
      );
      expect(output).toMatchSnapshot();
    });
  }

  it("maps every candidate-producing rule to an explicit FindingTargetDraft v1", async () => {
    const actual = Object.fromEntries(
      await Promise.all(
        ALL_RULES.map(async (rule) => {
          const result = await rule.evaluate(FIXTURES[rule.id].candidate);
          if (result.status !== "candidate") return [rule.id, []] as const;
          return [
            rule.id,
            result.candidates.map((candidate) =>
              stableOutput(
                (candidate as unknown as { readonly target: unknown }).target,
              ),
            ),
          ] as const;
        }),
      ),
    );

    expect(actual).toMatchObject({
      "TECH-HTTP-001": [
        {
          version: 1,
          relation: "affected_by_http_status",
          targetKind: "http_status",
          targetRef: "404",
        },
        {
          version: 1,
          relation: "affected_by_http_status",
          targetKind: "http_status",
          targetRef: "500",
        },
      ],
      "TECH-CANONICAL-002": [
        {
          version: 1,
          relation: "affected_by_canonical_issue",
          targetKind: "canonical_issue",
          targetRef: "reciprocal",
        },
      ],
      "TECH-LINKGRAPH-005": [
        {
          version: 1,
          relation: "affected_by_page_set",
          targetKind: "page_set",
          targetRef: "low_internal_inlinks",
        },
      ],
      "SEARCH-CTR-004": [
        {
          version: 1,
          relation: "direct_url",
          targetKind: "url",
        },
      ],
      "SEARCH-DECAY-002": [
        {
          version: 1,
          relation: "direct_url",
          targetKind: "url",
        },
      ],
      "CONTENT-COVERAGE-001": [
        {
          version: 1,
          relation: "affected_by_page_set",
          targetKind: "page_set",
          targetRef: "offer:team-collaboration",
          members: [],
        },
        {
          version: 1,
          relation: "affected_by_page_set",
          targetKind: "page_set",
          targetRef: "use_case:remote-onboarding",
          members: [],
        },
      ],
      "CONTENT-GAP-011": [
        {
          version: 1,
          relation: "affected_by_keyword_cluster",
          targetKind: "keyword_cluster",
          targetRef: "project-management",
          members: [],
        },
      ],
      "CRO-PATH-001": [
        {
          version: 1,
          relation: "affected_by_page_set",
          targetKind: "page_set",
          targetRef: "missing_conversion_path",
        },
      ],
      "CRO-LANDING-003": [
        {
          version: 1,
          relation: "direct_url",
          targetKind: "url",
        },
      ],
      "GEO-ENTITY-001": [
        {
          version: 1,
          relation: "affected_by_page_set",
          targetKind: "page_set",
          targetRef: "priority_commercial",
        },
      ],
      "GEO-CRAWLER-002": [
        {
          version: 1,
          relation: "affected_by_user_agent",
          targetKind: "user_agent",
          targetRef: "OAI-SearchBot",
          members: [],
        },
        {
          version: 1,
          relation: "affected_by_user_agent",
          targetKind: "user_agent",
          targetRef: "ChatGPT-User",
          members: [],
        },
        {
          version: 1,
          relation: "affected_by_user_agent",
          targetKind: "user_agent",
          targetRef: "PerplexityBot",
          members: [],
        },
        {
          version: 1,
          relation: "affected_by_user_agent",
          targetKind: "user_agent",
          targetRef: "ClaudeBot",
          members: [],
        },
      ],
    });
  });
});
