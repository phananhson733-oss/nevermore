// @input  -- Google's own index verdicts over the URLs a sitemap declares
// @output -- proof A1 decides on its published bands and refuses a partial census
// @pos    -- coverage for the check the URL Inspection API unlocked

import { describe, expect, it } from "vitest";

import {
  buildIndexCoverageRecords,
  type IndexCoverageEntry,
} from "../seo-audit/index-coverage.ts";
import { isSearchPerformanceRecord } from "../seo-audit/contract.ts";
import { evaluateAgentAuditScope } from "./evaluate.ts";

function a1(entries: readonly IndexCoverageEntry[] | null, gap?: never) {
  return evaluateAgentAuditScope("site", {
    availability: "available",
    records: buildIndexCoverageRecords(entries, gap),
  }).checks.find((entry) => entry.check.id === "A1");
}

/** `indexed` of `total`, the rest excluded. */
const census = (indexed: number, total: number): IndexCoverageEntry[] =>
  Array.from({ length: total }, (_, i) => ({
    url: `https://acme.test/p${i}`,
    verdict: i < indexed ? "PASS" : "NEUTRAL",
  }));

describe("A1 — index coverage over the declared population", () => {
  it("keeps one aggregate summary before each URL outside the index", () => {
    const record = buildIndexCoverageRecords([
      { url: "https://acme.test/indexed", verdict: "PASS" },
      { url: "https://acme.test/missing", verdict: "NEUTRAL" },
    ])[0];

    expect(record?.state).toBe("observed");
    expect(record?.affected).toBe(1);
    expect(record?.observations).toHaveLength(2);
    expect(record?.observations[0]?.url).toBeNull();
    expect(isSearchPerformanceRecord(record)).toBe(true);
  });

  it("accepts an all-indexed record with its aggregate summary only", () => {
    const record = buildIndexCoverageRecords([
      { url: "https://acme.test/a", verdict: "PASS" },
      { url: "https://acme.test/b", verdict: "PASS" },
    ])[0];

    expect(record?.state).toBe("observed");
    expect(record?.affected).toBe(0);
    expect(record?.observations).toHaveLength(1);
    expect(record?.observations[0]?.url).toBeNull();
    expect(isSearchPerformanceRecord(record)).toBe(true);
  });

  it("rejects index coverage when the aggregate row is malformed", () => {
    const record = structuredClone(
      buildIndexCoverageRecords([
        { url: "https://acme.test/a", verdict: "PASS" },
        { url: "https://acme.test/missing", verdict: "NEUTRAL" },
      ])[0],
    ) as unknown as {
      observations: Array<{ url: string | null; values: Array<{ label: string; value: unknown }> }>;
    } | undefined;

    if (!record) throw new Error("missing index coverage record");
    record.observations[0] = {
      url: null,
      values: [
        { label: "index_coverage_rate", value: 1.5 },
        { label: "sitemap_urls_inspected", value: 2 },
      ],
    };

    expect(isSearchPerformanceRecord(record)).toBe(false);
  });

  it("passes a site at or above the published 90%", () => {
    expect(a1(census(90, 100))?.result).toBe("pass");
  });

  it("warns between 70% and 90%", () => {
    expect(a1(census(80, 100))?.result).toBe("warning");
  });

  it("reaches Blocker below 70%", () => {
    expect(a1(census(60, 100))?.result).toBe("blocker");
  });

  it("counts only PASS as indexed", () => {
    // NEUTRAL is Search Console's "Excluded" and VERDICT_UNSPECIFIED is Google
    // declining to say. Neither is evidence the page is in the index, and
    // reading either as indexed inflates every rate on this check.
    const mixed: IndexCoverageEntry[] = [
      { url: "https://acme.test/a", verdict: "PASS" },
      { url: "https://acme.test/b", verdict: "NEUTRAL" },
      { url: "https://acme.test/c", verdict: "VERDICT_UNSPECIFIED" },
      { url: "https://acme.test/d", verdict: "FAIL" },
    ];
    const record = buildIndexCoverageRecords(mixed)[0];

    expect(record?.tested).toBe(4);
    expect(record?.affected).toBe(3);
  });

  it("does not judge a run with no census at all", () => {
    expect(a1(null)?.result).toBe("excluded");
    expect(a1([])?.result).toBe("excluded");
  });

  it("names each URL Google is not showing", () => {
    const record = buildIndexCoverageRecords([
      { url: "https://acme.test/a", verdict: "PASS" },
      { url: "https://acme.test/missing", verdict: "NEUTRAL" },
    ])[0];

    // The rate alone is not a fix instruction — the reader has to know which
    // pages to open in Search Console.
    expect(
      record?.observations.some(
        (observation) => observation.url === "https://acme.test/missing",
      ),
    ).toBe(true);
  });

  it("separates the reasons there is no census", () => {
    // "We never asked" and "your sitemap is bigger than one run can census"
    // and "your quota was already spent" are three different sentences, and
    // none of them is "your pages are not indexed".
    const reason = (gap: Parameters<typeof buildIndexCoverageRecords>[1]) =>
      buildIndexCoverageRecords(null, gap)[0]?.limitation;

    expect(new Set([
      reason("source_not_configured"),
      reason("sitemap_population_incomplete"),
      reason("no_sitemap_urls_declared"),
      reason("quota_exhausted"),
      reason("not_authorized"),
      reason("provider_unavailable"),
    ]).size).toBe(6);
  });
});
