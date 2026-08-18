import { describe, expect, it } from "vitest";
import { evaluateAgentAuditScope } from "../agent-audit/evaluate.ts";
import {
  buildSearchPerformanceRecords,
  type SearchPerformanceRaw,
  type SearchPerformanceRow,
} from "./search-performance.ts";
import type { SeoAuditPage, SeoAuditRecord } from "./types.ts";

function page(url: string): SeoAuditPage {
  return {
    url,
    subjectUrl: url,
    finalUrl: url,
    depth: 1,
    initialStatus: 200,
    finalStatus: 200,
    redirectHops: 0,
    contentType: "text/html",
    robotsDirectiveState: "noindex_not_observed",
    canonicalTarget: url,
    title: "Title",
    metaDescription: "Description",
    h1Count: 1,
    headingsCount: 2,
    wordCount: 300,
    inboundLinks: 1,
    outboundLinks: 1,
    sitemapMember: true,
    jsonLdTypes: ["WebPage"],
    jsonLdErrorCount: 0,
  };
}

function row(
  key: string,
  impressions: number,
  position: number,
): SearchPerformanceRow {
  return { key, clicks: 0, impressions, position };
}

function raw(overrides: Partial<SearchPerformanceRaw> = {}): SearchPerformanceRaw {
  return {
    property: "sc-domain:acme.test",
    startDate: "2026-07-19",
    endDate: "2026-08-15",
    pages: [],
    queries: [],
    pagesTruncated: false,
    queriesTruncated: false,
    ...overrides,
  };
}

function byId(records: readonly SeoAuditRecord[], id: string) {
  return records.find((record) => record.id === id);
}

describe("search performance records", () => {
  it("emits nothing at all when no grant covered the run", () => {
    expect(buildSearchPerformanceRecords(null, [page("https://acme.test/")]))
      .toEqual([]);
    expect(buildSearchPerformanceRecords(undefined, [])).toEqual([]);
  });

  it("does not read a zero-impression row as coverage", () => {
    const pages = [page("https://acme.test/a"), page("https://acme.test/b")];
    const records = buildSearchPerformanceRecords(
      raw({
        pages: [
          row("https://acme.test/a", 40, 5),
          // Search Console returns rows at zero impressions. Counting a row's
          // presence as coverage would report a page nobody ever saw as one
          // that performs.
          row("https://acme.test/b", 0, 0),
        ],
      }),
      pages,
    );
    const coverage = byId(records, "page_without_search_impressions");

    expect(coverage?.observations.map((entry) => entry.url)).toEqual([
      "https://acme.test/b",
    ]);
    expect(coverage?.tested).toBe(2);
  });

  it("weights the position bands by impressions, not by row count", () => {
    const records = buildSearchPerformanceRecords(
      raw({
        queries: [
          // One query carries nearly all the impressions from the top band.
          row("brand", 900, 2),
          row("long tail a", 50, 8),
          row("long tail b", 50, 9),
        ],
      }),
      [],
    );
    const share = (id: string, label: string) =>
      byId(records, id)?.observations[0]?.values.find(
        (entry) => entry.label === label,
      )?.value;

    // Two of three rows sit in 7-10, but they are a tenth of the impressions.
    expect(share("impression_share_top_positions", "top_position_impression_share")).toBe(0.9);
    expect(
      share("impression_share_low_click_positions", "low_click_position_impression_share"),
    ).toBe(0.1);
  });

  it("rounds an average position to the band it was shown in most", () => {
    const topShare = (position: number) => {
      const records = buildSearchPerformanceRecords(
        raw({ queries: [row("q", 100, position)] }),
        [],
      );
      return byId(records, "impression_share_top_positions")?.observations[0]
        ?.values.find((entry) => entry.label === "top_position_impression_share")
        ?.value;
    };

    // 6.4 was shown at position 6 more often than at 7.
    expect(topShare(6.4)).toBe(1);
    expect(topShare(6.6)).toBe(0);
  });

  it("publishes no share from a capped query list", () => {
    const rows = [
      row("top", 900, 2),
      row("low", 50, 8),
      row("rest", 50, 30),
    ];
    const share = (queriesTruncated: boolean) =>
      byId(
        buildSearchPerformanceRecords(
          raw({ queries: rows, queriesTruncated }),
          [],
        ),
        "impression_share_top_positions",
      );

    expect(share(false)?.observations).toHaveLength(1);
    // The cap drops the long tail — many impressions, few clicks, ranked past
    // the tenth result — so the total is short and every band share comes out
    // flattering. Reporting nothing beats reporting a site as better than it is.
    expect(share(true)?.observations).toEqual([]);
    expect(share(true)?.state).toBe("unverified");
    expect(share(true)?.limitation).toContain("row cap".replace(" ", "_"));
  });

  it("does not call a page uncovered when the page list was capped", () => {
    const pages = [page("https://acme.test/a"), page("https://acme.test/b")];
    const capped = buildSearchPerformanceRecords(
      raw({
        pages: [row("https://acme.test/a", 40, 5)],
        pagesTruncated: true,
      }),
      pages,
    );
    const record = byId(capped, "page_without_search_impressions");

    // Page b may well have impressions on a row the cap dropped. Listing it as
    // never shown would invent a defect out of our own budget.
    expect(record?.observations).toEqual([]);
    expect(record?.tested).toBe(0);
    expect(record?.state).toBe("unverified");

    // And the check has to land on excluded, not on a ratio computed against a
    // zero population: `affected-ratio-at-most` divides by `tested`, so a
    // capped list that still reached the rule would decide from 0/0.
    const decided = evaluateAgentAuditScope("site", {
      availability: "available",
      records: capped,
    }).checks.find((entry) => entry.check.id === "E1");
    expect(decided?.result).toBe("excluded");
    expect(decided?.truth).toBe("source-gated");
  });

  it("reports no impressions as nothing to divide by, never as a zero share", () => {
    const records = buildSearchPerformanceRecords(
      raw({ queries: [row("q", 0, 0)] }),
      [],
    );
    const band = byId(records, "impression_share_top_positions");

    expect(band?.observations).toEqual([]);
    expect(band?.state).toBe("unverified");
  });
});

describe("search performance checks", () => {
  const evaluate = (records: readonly SeoAuditRecord[]) =>
    evaluateAgentAuditScope("site", { availability: "available", records });

  it("passes E1 at exactly the published coverage mark", () => {
    const pages = Array.from({ length: 10 }, (_, index) =>
      page(`https://acme.test/${index}`),
    );
    const covered = (count: number) =>
      buildSearchPerformanceRecords(
        raw({
          pages: pages
            .slice(0, count)
            .map((entry) => row(entry.url, 10, 5)),
        }),
        pages,
      );

    // Published as "at least 60% of pages have impressions". Six of ten is
    // exactly the mark and must pass.
    expect(
      evaluate(covered(6)).checks.find((entry) => entry.check.id === "E1")
        ?.result,
    ).toBe("pass");
    expect(
      evaluate(covered(5)).checks.find((entry) => entry.check.id === "E1")
        ?.result,
    ).toBe("tip");
    // Below 30% coverage is the Warning the threshold names.
    expect(
      evaluate(covered(2)).checks.find((entry) => entry.check.id === "E1")
        ?.result,
    ).toBe("warning");
  });

  it("keeps the search checks excluded when no grant covered the run", () => {
    const result = evaluate(buildSearchPerformanceRecords(null, []));

    for (const id of ["E1", "E2", "E3"]) {
      const check = result.checks.find((entry) => entry.check.id === id);
      expect(check?.result).toBe("excluded");
      // The reason has to be the missing authorization, not a missing detector:
      // the visitor can act on the first and cannot act on the second.
      expect(check?.engine).toBe("access-required");
      expect(check?.truth).toBe("source-gated");
    }
  });

  it("decides the band checks against their published shares", () => {
    const withShare = (topImpressions: number, lowImpressions: number) =>
      evaluate(
        buildSearchPerformanceRecords(
          raw({
            queries: [
              row("top", topImpressions, 3),
              row("low", lowImpressions, 8),
              row("rest", 1_000 - topImpressions - lowImpressions, 30),
            ],
          }),
          [],
        ),
      );
    const resultOf = (
      outcome: ReturnType<typeof withShare>,
      id: string,
    ) => outcome.checks.find((entry) => entry.check.id === id)?.result;

    // E2 publishes "at least 20%", so exactly 20% passes.
    expect(resultOf(withShare(200, 100), "E2")).toBe("pass");
    expect(resultOf(withShare(150, 100), "E2")).toBe("tip");
    expect(resultOf(withShare(50, 100), "E2")).toBe("warning");

    // E3 publishes "40% or less", above 60% is a Warning.
    expect(resultOf(withShare(200, 400), "E3")).toBe("pass");
    expect(resultOf(withShare(200, 500), "E3")).toBe("tip");
    expect(resultOf(withShare(200, 700), "E3")).toBe("warning");
  });
});
