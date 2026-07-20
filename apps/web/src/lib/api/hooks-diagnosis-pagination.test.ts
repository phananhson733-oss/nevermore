import { describe, expect, it } from "vitest";
import {
  mergeFindingPages,
  selectLatestSnapshotIds,
  type DataSnapshot,
  type Finding,
  type FindingListEnvelope,
} from "./hooks-diagnosis";

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
    const snapshot = (
      id: string,
      provider: DataSnapshot["provider"],
      capturedAt: string,
    ): DataSnapshot => ({
      id,
      provider,
      datasetKey: `${provider}.v1`,
      capturedAt,
      availability: "available",
      limitation: "",
      rowCount: 1,
    });

    expect(
      selectLatestSnapshotIds([
        snapshot("crawl-old", "crawl", "2026-07-18T00:00:00.000Z"),
        snapshot("ga4-latest", "ga4", "2026-07-19T00:00:00.000Z"),
        snapshot("crawl-latest", "crawl", "2026-07-20T00:00:00.000Z"),
      ]),
    ).toEqual(["crawl-latest", "ga4-latest"]);
  });

  it("freezes only one usable snapshot for the shared keyword-gap slot", () => {
    const snapshot = (
      id: string,
      provider: "csv" | "dataforseo",
      capturedAt: string,
      availability: DataSnapshot["availability"] = "available",
    ): DataSnapshot => ({
      id,
      provider,
      datasetKey: "csv.keyword_gap.v1",
      capturedAt,
      availability,
      limitation: "",
      rowCount: 1,
    });

    expect(
      selectLatestSnapshotIds([
        snapshot("csv-old", "csv", "2026-07-18T00:00:00.000Z"),
        snapshot("dfs-new", "dataforseo", "2026-07-20T00:00:00.000Z"),
      ]),
    ).toEqual(["dfs-new"]);
    expect(
      selectLatestSnapshotIds([
        snapshot("csv-usable", "csv", "2026-07-18T00:00:00.000Z"),
        snapshot(
          "dfs-unavailable",
          "dataforseo",
          "2026-07-20T00:00:00.000Z",
          "unavailable",
        ),
      ]),
    ).toEqual(["csv-usable"]);
    expect(
      selectLatestSnapshotIds([
        snapshot("csv-tie", "csv", "2026-07-20T00:00:00.000Z"),
        snapshot("dfs-tie", "dataforseo", "2026-07-20T00:00:00.000Z"),
      ]),
    ).toEqual(["dfs-tie"]);
  });
});
