import { describe, expect, it } from "vitest";
import {
  hasCrawlSnapshot,
  mergeFindingPages,
  selectLatestSnapshotIds,
  type DataSnapshot,
  type Finding,
  type FindingListEnvelope,
} from "./hooks-diagnosis";

const CURRENT_CRAWL_METHOD_VERSION = "crawl.site_graph.v2";

function finding(id: string, summary: string): Finding {
  return {
    id,
    ruleId: "rule.v1",
    ruleVersion: 1,
    domain: "technical_seo",
    titleKey: "finding.tech.http_status",
    titleArgs: {},
    summary,
    summaryLocale: "en",
    severity: "high",
    confidence: "high",
    reviewState: "unreviewed",
    reviewRevision: 1,
    active: true,
    regressed: false,
    subjectRefs: [],
    evidence: [],
    firstSeenAt: "2026-07-20T00:00:00.000Z",
    lastSeenAt: "2026-07-20T00:00:00.000Z",
    resolvedAt: null,
  };
}

function page(
  data: readonly Finding[],
  nextCursor: string | null,
  limitation: string,
): FindingListEnvelope {
  return {
    data,
    meta: {
      nextCursor,
      hasNext: nextCursor !== null,
      limit: 100,
      latestRun: null,
      coverage: {
        overall: "partial",
        domains: {},
        limitations: [limitation],
      },
      ruleResults: [],
    },
  };
}

function snapshot(
  id: string,
  provider: DataSnapshot["provider"],
  capturedAt: string,
  overrides: Partial<
    Pick<DataSnapshot, "availability" | "methodVersion" | "siteId">
  > = {},
): DataSnapshot {
  return {
    id,
    provider,
    siteId: "site-a",
    datasetKey: `${provider}.dataset.v1`,
    methodVersion:
      provider === "crawl"
        ? CURRENT_CRAWL_METHOD_VERSION
        : `${provider}.method.v1`,
    capturedAt,
    availability: "available",
    limitation: "",
    rowCount: 1,
    ...overrides,
  };
}

function keywordGapSnapshot(
  id: string,
  provider: "csv" | "dataforseo",
  capturedAt: string,
  availability: DataSnapshot["availability"] = "available",
  siteId = "site-a",
): DataSnapshot {
  return snapshot(id, provider, capturedAt, { availability, siteId });
}

describe("Diagnosis pagination", () => {
  it("de-duplicates findings but preserves the first page sidecar", () => {
    const first = finding("finding-a", "first projection");
    const duplicate = finding("finding-a", "later duplicate");
    const second = finding("finding-b", "second page");
    const merged = mergeFindingPages({
      pages: [
        page([first], "cursor-2", "canonical coverage"),
        page([duplicate, second], null, "non-canonical later coverage"),
      ],
      pageParams: [null, "cursor-2"],
    });

    expect(merged?.data).toEqual([first, second]);
    expect(merged?.meta.coverage?.limitations).toEqual(["canonical coverage"]);
    expect(merged?.meta.nextCursor).toBeNull();
  });

  it("selects the latest snapshot independently for each provider", () => {
    expect(
      selectLatestSnapshotIds([
        snapshot("crawl-old", "crawl", "2026-07-18T00:00:00.000Z"),
        snapshot("ga4-old", "ga4", "2026-07-18T00:00:00.000Z"),
        snapshot("ga4-latest", "ga4", "2026-07-20T00:00:00.000Z"),
        snapshot("crawl-latest", "crawl", "2026-07-19T00:00:00.000Z"),
      ]),
    ).toEqual(["crawl-latest", "ga4-latest"]);
  });

  it("anchors the selection to the latest usable current crawl and never mixes sites", () => {
    expect(
      selectLatestSnapshotIds([
        snapshot("site-a-gsc-newest", "gsc", "2026-07-22T00:00:00.000Z"),
        snapshot("site-a-crawl", "crawl", "2026-07-19T00:00:00.000Z"),
        snapshot("site-b-crawl", "crawl", "2026-07-21T00:00:00.000Z", {
          siteId: "site-b",
        }),
        snapshot("site-b-gsc", "gsc", "2026-07-20T00:00:00.000Z", {
          siteId: "site-b",
        }),
        keywordGapSnapshot(
          "site-b-csv",
          "csv",
          "2026-07-20T12:00:00.000Z",
          "available",
          "site-b",
        ),
      ]),
    ).toEqual(["site-b-crawl", "site-b-gsc", "site-b-csv"]);
  });

  it("uses a stable snapshot id tie-break when captured timestamps are equal", () => {
    const snapshots = [
      snapshot("crawl-z", "crawl", "2026-07-22T00:00:00.000Z", {
        siteId: "site-z",
      }),
      snapshot("crawl-a", "crawl", "2026-07-22T00:00:00.000Z", {
        siteId: "site-a",
      }),
      snapshot("gsc-z", "gsc", "2026-07-22T01:00:00.000Z", {
        siteId: "site-a",
      }),
      snapshot("gsc-a", "gsc", "2026-07-22T01:00:00.000Z", {
        siteId: "site-a",
      }),
    ];

    const expected = ["crawl-a", "gsc-a"];
    expect(selectLatestSnapshotIds(snapshots)).toEqual(expected);
    expect(selectLatestSnapshotIds([...snapshots].reverse())).toEqual(expected);
  });

  it("ignores a newer unavailable current crawl when choosing the diagnostic site", () => {
    expect(
      selectLatestSnapshotIds([
        snapshot("site-a-crawl", "crawl", "2026-07-20T00:00:00.000Z"),
        snapshot("site-a-ga4", "ga4", "2026-07-20T01:00:00.000Z"),
        snapshot("site-b-crawl-unavailable", "crawl", "2026-07-21T00:00:00.000Z", {
          availability: "unavailable",
          siteId: "site-b",
        }),
        snapshot("site-b-ga4", "ga4", "2026-07-21T01:00:00.000Z", {
          siteId: "site-b",
        }),
      ]),
    ).toEqual(["site-a-crawl", "site-a-ga4"]);
  });

  it("returns no diagnostic selection when only legacy crawl snapshots exist", () => {
    const snapshots = [
      snapshot("legacy-crawl", "crawl", "2026-07-21T00:00:00.000Z", {
        methodVersion: "crawl.site_graph.v1",
      }),
      snapshot("gsc-without-current-crawl", "gsc", "2026-07-22T00:00:00.000Z"),
    ];

    expect(selectLatestSnapshotIds(snapshots)).toEqual([]);
    expect(hasCrawlSnapshot(snapshots)).toBe(false);
  });

  it("returns no diagnostic selection when every current crawl is unavailable", () => {
    const snapshots = [
      snapshot("current-crawl-unavailable", "crawl", "2026-07-22T00:00:00.000Z", {
        availability: "unavailable",
      }),
      snapshot("ga4", "ga4", "2026-07-22T01:00:00.000Z"),
    ];

    expect(selectLatestSnapshotIds(snapshots)).toEqual([]);
    expect(hasCrawlSnapshot(snapshots)).toBe(false);
  });

  it("treats a partial current crawl as a usable diagnosis anchor", () => {
    const snapshots = [
      snapshot("partial-current-crawl", "crawl", "2026-07-22T00:00:00.000Z", {
        availability: "partial",
      }),
    ];

    expect(hasCrawlSnapshot(snapshots)).toBe(true);
    expect(selectLatestSnapshotIds(snapshots)).toEqual([
      "partial-current-crawl",
    ]);
  });

  it("freezes the latest usable CSV and DataForSEO snapshots together", () => {
    expect(
      selectLatestSnapshotIds([
        snapshot("crawl", "crawl", "2026-07-17T00:00:00.000Z"),
        keywordGapSnapshot("csv-old", "csv", "2026-07-18T00:00:00.000Z"),
        keywordGapSnapshot(
          "csv-newer-unavailable",
          "csv",
          "2026-07-20T00:00:00.000Z",
          "unavailable",
        ),
        keywordGapSnapshot(
          "dfs-old",
          "dataforseo",
          "2026-07-19T00:00:00.000Z",
        ),
        keywordGapSnapshot(
          "dfs-new",
          "dataforseo",
          "2026-07-20T00:00:00.000Z",
        ),
      ]),
    ).toEqual(["crawl", "csv-old", "dfs-new"]);
  });

  it("keeps the latest unavailable keyword-gap snapshot when its provider has no usable one", () => {
    expect(
      selectLatestSnapshotIds([
        snapshot("crawl", "crawl", "2026-07-17T00:00:00.000Z"),
        keywordGapSnapshot(
          "csv-usable",
          "csv",
          "2026-07-18T00:00:00.000Z",
        ),
        keywordGapSnapshot(
          "dfs-unavailable",
          "dataforseo",
          "2026-07-20T00:00:00.000Z",
          "unavailable",
        ),
      ]),
    ).toEqual(["crawl", "csv-usable", "dfs-unavailable"]);
  });

  it("selects at most one keyword-gap snapshot per provider", () => {
    expect(
      selectLatestSnapshotIds([
        snapshot("crawl", "crawl", "2026-07-17T00:00:00.000Z"),
        keywordGapSnapshot("csv-old", "csv", "2026-07-18T00:00:00.000Z"),
        keywordGapSnapshot(
          "dfs-usable",
          "dataforseo",
          "2026-07-19T00:00:00.000Z",
          "partial",
        ),
        keywordGapSnapshot(
          "dfs-newer-unavailable",
          "dataforseo",
          "2026-07-20T00:00:00.000Z",
          "unavailable",
        ),
      ]),
    ).toEqual(["crawl", "csv-old", "dfs-usable"]);
  });
});
