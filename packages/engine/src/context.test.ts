import { METRIC_CRAWL_PAGE, METRIC_CSV_KEYWORD_GAP } from "@sf/sources";
import type {
  CrawlPageProjection,
  CsvKeywordProjection,
} from "@sf/sources";
import { describe, expect, it } from "vitest";

import { DiagnosticContext } from "./context.ts";
import type { ObservationView } from "./context.ts";
import { parseIcp } from "./icp.ts";
import { testObservationLineage } from "./test-observation-lineage.ts";

const OBSERVED_AT = "2026-07-22T00:00:00Z";
const SUBJECT_URL = "https://example.com/pricing";

function makePage(fetchUrl: string, title: string): CrawlPageProjection {
  return {
    fetchUrl,
    status: 200,
    finalStatus: 200,
    redirectChain: [],
    canonicalTarget: null,
    robotsIndexable: true,
    robotsDirectives: [],
    title,
    metaDescription: null,
    h1: [],
    headings: [],
    wordCount: null,
    internalOutlinks: [],
    jsonLd: { types: [], errorCount: 0 },
    sitemapMember: false,
    bodyExcerpt: null,
    paragraphs: [],
    responseMs: null,
    contentType: "text/html",
  };
}

function pageObservation(
  page: CrawlPageProjection,
  subjectRef = SUBJECT_URL,
): ObservationView {
  return {
    ...testObservationLineage(`crawl:${page.fetchUrl}`, {
      sitePageUrl: page.fetchUrl,
      pageSnapshot: true,
    }),
    metricKey: METRIC_CRAWL_PAGE,
    subjectType: "url",
    subjectRef,
    provider: "crawl",
    availability: "available",
    valueJson: page,
    observedAt: OBSERVED_AT,
  };
}

function keywordObservation(
  provider: "csv" | "dataforseo",
  projection: CsvKeywordProjection,
): ObservationView {
  return {
    ...testObservationLineage(
      `${provider}:${projection.clusterKey}:${projection.keyword}`,
    ),
    metricKey: METRIC_CSV_KEYWORD_GAP,
    subjectType: "keyword_cluster",
    subjectRef: projection.clusterKey,
    provider,
    availability: "available",
    valueJson: projection,
    observedAt: OBSERVED_AT,
  };
}

function buildContext(observations: readonly ObservationView[]): DiagnosticContext {
  return DiagnosticContext.build({
    icp: parseIcp({ productName: "Acme" }),
    deliveryLocale: "en",
    observations,
    coverage: {
      crawl: "available",
      gsc: "unavailable",
      ga4: "unavailable",
      csv: "unavailable",
    },
    capturedAt: { crawl: OBSERVED_AT },
  });
}

describe("DiagnosticContext crawl page aggregation", () => {
  it("chooses a stable representative and retains every exact fetch variant", () => {
    const noSlash = makePage(SUBJECT_URL, "No slash");
    const trailingSlash = makePage(`${SUBJECT_URL}/`, "Trailing slash");
    const observations = [
      pageObservation(trailingSlash),
      pageObservation(noSlash),
    ];

    const forward = buildContext(observations);
    const reversed = buildContext([...observations].reverse());

    expect(forward.pages.get(SUBJECT_URL)).toEqual(
      reversed.pages.get(SUBJECT_URL),
    );
    expect(forward.pages.get(SUBJECT_URL)).toBe(noSlash);
    expect(forward.pageVariants.get(SUBJECT_URL)).toEqual([
      noSlash,
      trailingSlash,
    ]);
    expect(reversed.pageVariants.get(SUBJECT_URL)).toEqual([
      noSlash,
      trailingSlash,
    ]);
  });

  it("retains every stable eligible exact variant per subject regardless of observation order", () => {
    const redirect = {
      ...makePage(SUBJECT_URL, "Redirect"),
      status: 301,
      finalStatus: 200,
      redirectChain: [`${SUBJECT_URL}/`],
    };
    const noIndex = {
      ...makePage(`${SUBJECT_URL}/`, "No index"),
      robotsIndexable: false,
    };
    const eligible = makePage(
      `${SUBJECT_URL}/?source=eligible`,
      "Eligible",
    );
    const laterEligible = makePage(
      `${SUBJECT_URL}/?source=later`,
      "Later eligible",
    );
    const observations = [
      pageObservation(laterEligible),
      pageObservation(noIndex),
      pageObservation(eligible),
      pageObservation(redirect),
    ];

    const forward = buildContext(observations);
    const reversed = buildContext([...observations].reverse());

    expect(forward.pages.get(SUBJECT_URL)).toBe(redirect);
    expect(forward.indexablePages()).toEqual([
      [SUBJECT_URL, [eligible, laterEligible]],
    ]);
    expect(reversed.indexablePages()).toEqual(forward.indexablePages());
  });

  it("unions every exact source variant while counting one aggregation source per target", () => {
    const source = "https://example.com/source";
    const otherSource = "https://example.com/other-source";
    const targetA = "https://example.com/target-a";
    const targetB = "https://example.com/target-b";
    const noSlash = {
      ...makePage(source, "Source"),
      internalOutlinks: [
        { targetSubjectUrl: targetA, rel: null, anchorText: null },
        { targetSubjectUrl: targetA, rel: null, anchorText: null },
      ],
    };
    const trailingSlash = {
      ...makePage(`${source}/`, "Source slash"),
      internalOutlinks: [
        { targetSubjectUrl: targetA, rel: null, anchorText: null },
        { targetSubjectUrl: targetB, rel: null, anchorText: null },
      ],
    };
    const observations = [
      pageObservation(trailingSlash, source),
      pageObservation(noSlash, source),
      pageObservation(
        {
          ...makePage(otherSource, "Other source"),
          internalOutlinks: [
            { targetSubjectUrl: targetA, rel: null, anchorText: null },
          ],
        },
        otherSource,
      ),
    ];

    const forward = buildContext(observations);
    const reversed = buildContext([...observations].reverse());

    expect(Object.fromEntries(forward.internalInlinks)).toEqual({
      [targetA]: 2,
      [targetB]: 1,
    });
    expect(Object.fromEntries(reversed.internalInlinks)).toEqual(
      Object.fromEntries(forward.internalInlinks),
    );
  });
});

describe("DiagnosticContext keyword demand aggregation", () => {
  it("deduplicates provider overlap only within the same market and language", () => {
    const shared = {
      clusterKey: "project management",
      currentUrl: null,
      currentRank: null,
      competitorDomain: "competitor.example",
      competitorRank: 4,
    } as const;
    const csvUsEnglish: CsvKeywordProjection = {
      ...shared,
      keyword: " Project   Management Workflow ",
      searchVolume: 900,
      marketCode: "US",
      languageCode: "en",
    };
    const vendorUsEnglish: CsvKeywordProjection = {
      ...shared,
      keyword: "project-management workflow",
      searchVolume: 100,
      currentUrl: "https://example.com/workflow",
      currentRank: 8,
      competitorDomain: null,
      competitorRank: null,
      marketCode: "US",
      languageCode: "en",
    };
    const csvGbEnglish: CsvKeywordProjection = {
      ...csvUsEnglish,
      searchVolume: 300,
      marketCode: "GB",
    };
    const csvUsFrench: CsvKeywordProjection = {
      ...csvUsEnglish,
      searchVolume: 200,
      languageCode: "fr",
    };
    const observations = [
      keywordObservation("csv", csvUsEnglish),
      keywordObservation("csv", csvGbEnglish),
      keywordObservation("dataforseo", vendorUsEnglish),
      keywordObservation("csv", csvUsFrench),
    ];

    const forward = buildContext(observations);
    const reversed = buildContext([...observations].reverse());
    const rows = forward.csvClusters.get(shared.clusterKey);

    expect(rows).toHaveLength(3);
    expect(rows).toEqual(
      expect.arrayContaining([
        vendorUsEnglish,
        csvGbEnglish,
        csvUsFrench,
      ]),
    );
    expect(reversed.csvClusters.get(shared.clusterKey)).toEqual(rows);
    expect(forward.keywordGapProviders.get(shared.clusterKey)).toEqual(
      new Set(["csv", "dataforseo"]),
    );
    expect(reversed.keywordGapProviders.get(shared.clusterKey)).toEqual(
      new Set(["csv", "dataforseo"]),
    );
    expect(forward.keywordGapContributions(shared.clusterKey)).toEqual([
      { provider: "dataforseo", keywords: [vendorUsEnglish] },
      {
        provider: "csv",
        keywords: expect.arrayContaining([csvGbEnglish, csvUsFrench]),
      },
    ]);
    expect(reversed.keywordGapContributions(shared.clusterKey)).toEqual(
      forward.keywordGapContributions(shared.clusterKey),
    );
    expect(forward.keywordGapContributions("missing-cluster")).toEqual([]);
    expect(forward.providerAvailability("unknown-provider")).toBe(
      "unavailable",
    );
  });

  it("uses the epoch only when no provider or crawl capture time exists", () => {
    const ctx = DiagnosticContext.build({
      icp: parseIcp({ productName: "Acme" }),
      deliveryLocale: "en",
      observations: [],
      coverage: {
        crawl: "unavailable",
        gsc: "unavailable",
        ga4: "unavailable",
        csv: "unavailable",
      },
      capturedAt: {},
    });

    expect(ctx.observedAt("unknown-provider")).toBe(
      "1970-01-01T00:00:00.000Z",
    );
  });

  it("preserves the complete emitted language scope while case folding it", () => {
    const base: CsvKeywordProjection = {
      keyword: "project management workflow",
      clusterKey: "project management",
      searchVolume: 100,
      currentUrl: null,
      currentRank: null,
      competitorDomain: null,
      competitorRank: null,
      marketCode: "US",
      languageCode: "en",
    };
    const vendorUsEnglish = { ...base };
    const csvUsEnglishLocale = {
      ...base,
      searchVolume: 900,
      languageCode: "en-US",
    };
    const csvUsEnglishLocaleCaseVariant = {
      ...csvUsEnglishLocale,
      languageCode: "EN-us",
    };
    const csvGbUsEnglish = {
      ...base,
      searchVolume: 300,
      marketCode: "GB",
      languageCode: "en-US",
    };
    const vendorTaiwanChinese = {
      ...base,
      searchVolume: 200,
      marketCode: "TW",
      languageCode: "zh",
    };
    const csvTaiwanTraditionalChinese = {
      ...base,
      searchVolume: 400,
      marketCode: "TW",
      languageCode: "zh-Hant-TW",
    };
    const csvGrandfathered = {
      ...base,
      searchVolume: 500,
      marketCode: "GB",
      languageCode: "en-GB-oed",
    };
    const csvPrivateUse = {
      ...base,
      searchVolume: 600,
      languageCode: "x-private",
    };
    const observations = [
      keywordObservation("csv", csvUsEnglishLocale),
      keywordObservation("csv", csvUsEnglishLocaleCaseVariant),
      keywordObservation("csv", csvGbUsEnglish),
      keywordObservation("dataforseo", vendorUsEnglish),
      keywordObservation("csv", csvTaiwanTraditionalChinese),
      keywordObservation("dataforseo", vendorTaiwanChinese),
      keywordObservation("csv", csvGrandfathered),
      keywordObservation("csv", csvPrivateUse),
    ];

    const forward = buildContext(observations);
    const reversed = buildContext([...observations].reverse());
    const rows = forward.csvClusters.get(base.clusterKey);

    expect(rows).toHaveLength(7);
    expect(rows).toEqual(
      expect.arrayContaining([
        vendorUsEnglish,
        csvUsEnglishLocaleCaseVariant,
        csvGbUsEnglish,
        vendorTaiwanChinese,
        csvTaiwanTraditionalChinese,
        csvGrandfathered,
        csvPrivateUse,
      ]),
    );
    expect(reversed.csvClusters.get(base.clusterKey)).toEqual(rows);
  });

  it("chooses a deterministic whole projection for same-provider duplicates", () => {
    const sparse: CsvKeywordProjection = {
      keyword: " Project   Management Workflow ",
      clusterKey: "project management",
      searchVolume: null,
      currentUrl: null,
      currentRank: null,
      competitorDomain: null,
      competitorRank: null,
      marketCode: "US",
      languageCode: "en",
    };
    const richer: CsvKeywordProjection = {
      ...sparse,
      keyword: "project-management workflow",
      searchVolume: 275,
      competitorDomain: "competitor.example",
      competitorRank: 4,
    };
    const stableFallback: CsvKeywordProjection = {
      ...richer,
      keyword: "project management automation",
      searchVolume: 100,
    };
    const otherEqualRichness: CsvKeywordProjection = {
      ...stableFallback,
      searchVolume: 200,
    };
    const observations = [
      keywordObservation("csv", sparse),
      keywordObservation("csv", otherEqualRichness),
      keywordObservation("csv", richer),
      keywordObservation("csv", stableFallback),
    ];

    const forward = buildContext(observations);
    const reversed = buildContext([...observations].reverse());
    const rows = forward.csvClusters.get(sparse.clusterKey);

    expect(rows).toHaveLength(2);
    expect(rows).toEqual(expect.arrayContaining([richer, stableFallback]));
    expect(reversed.csvClusters.get(sparse.clusterKey)).toEqual(rows);
    expect(forward.keywordGapProviders.get(sparse.clusterKey)).toEqual(
      new Set(["csv"]),
    );
  });
});
