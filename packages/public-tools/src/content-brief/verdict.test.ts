// @input  -- hand-built Search Console rows around the self-competition thresholds
// @output -- proof of every verdict branch, including the ones that must refuse to decide
// @pos    -- the verdict rule's unit tests
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { describe, expect, it } from "vitest";

import {
  SELF_COMPETE_MAX_POSITION,
  SELF_COMPETE_MIN_IMPRESSIONS,
} from "./constants.ts";
import {
  aggregateByPage,
  computeVerdict,
  deriveVerdictFromLedger,
  normalizePosition,
  type VerdictInput,
} from "./verdict.ts";

const MIN_COVERAGE = 0.8;

function input(overrides: Partial<VerdictInput> = {}): VerdictInput {
  return {
    primary: "brew coffee",
    queryRows: [{ query: "brew coffee", impressions: 80, position: 12 }],
    queryPageRows: [
      { query: "brew coffee", page: "https://site.example/coffee", clicks: 4, impressions: 80, position: 12 },
    ],
    queryPagingTruncated: false,
    queryUnreadableRows: 0,
    coverageOf: () => 1,
    minDimensionCoverage: MIN_COVERAGE,
    ...overrides,
  };
}

describe("normalizePosition", () => {
  it("treats the reader's zero sentinel and anything non-positive as unknown", () => {
    expect(normalizePosition(0)).toBeNull();
    expect(normalizePosition(-1)).toBeNull();
    expect(normalizePosition(Number.NaN)).toBeNull();
    expect(normalizePosition(12)).toBe(12);
  });
});

describe("computeVerdict", () => {
  it("says update when the best page has enough impressions and ranks inside the cap", () => {
    const result = computeVerdict(input());
    expect(result.verdict).toEqual({
      action: "update",
      reason: "self_compete",
      target_url: "https://site.example/coffee",
      observed: { page: "https://site.example/coffee", impressions: 80, rows: 1, rows_with_position: 1, avg_position: 12 },
      provenance: { method: "heuristic", origin: "gsc" },
    });
    expect(result.primaryCoverage).toEqual({ ratio: 1 });
    expect(result.matchedQueries).toBe(1);
    expect(result.ledgerRows).toHaveLength(1);
  });

  it("says create/not_observed only when the sample is complete", () => {
    const absent = input({ queryRows: [{ query: "other", impressions: 5, position: 3 }], queryPageRows: [] });
    expect(computeVerdict(absent).verdict).toMatchObject({ action: "create", reason: "not_observed", existing: null });
    expect(computeVerdict(absent).primaryCoverage).toEqual({ ratio: null, reason: "query_not_in_sample" });
    expect(computeVerdict({ ...absent, queryPagingTruncated: true }).verdict).toMatchObject({ action: "undecidable", reason: "gsc_partial" });
    expect(computeVerdict({ ...absent, queryUnreadableRows: 1 }).verdict).toMatchObject({ action: "undecidable", reason: "gsc_partial" });
  });

  it("refuses to decide on a position it does not have", () => {
    const zero = input({
      queryPageRows: [{ query: "brew coffee", page: "https://site.example/coffee", clicks: 0, impressions: 80, position: 0 }],
    });
    expect(computeVerdict(zero).verdict).toMatchObject({ action: "undecidable", reason: "position_unavailable" });
  });

  it("does not let a supporting-looking query pick the page", () => {
    const supportingOnly = input({
      queryRows: [{ query: "pour over coffee", impressions: 500, position: 2 }],
      queryPageRows: [{ query: "pour over coffee", page: "https://site.example/pour", clicks: 9, impressions: 500, position: 2 }],
    });
    expect(computeVerdict(supportingOnly).verdict).toMatchObject({ action: "create", reason: "not_observed" });
    expect(computeVerdict(supportingOnly).ledgerRows).toEqual([]);
  });

  it("splits the three create reasons", () => {
    const floor = input({
      queryRows: [{ query: "brew coffee", impressions: SELF_COMPETE_MIN_IMPRESSIONS - 1, position: 5 }],
      queryPageRows: [{ query: "brew coffee", page: "https://site.example/coffee", clicks: 1, impressions: SELF_COMPETE_MIN_IMPRESSIONS - 1, position: 5 }],
    });
    expect(computeVerdict(floor).verdict).toMatchObject({ action: "create", reason: "below_impression_floor", existing: { impressions: SELF_COMPETE_MIN_IMPRESSIONS - 1 } });

    const beyond = input({
      queryPageRows: [{ query: "brew coffee", page: "https://site.example/coffee", clicks: 1, impressions: 80, position: SELF_COMPETE_MAX_POSITION + 15 }],
    });
    expect(computeVerdict(beyond).verdict).toMatchObject({ action: "create", reason: "beyond_position_cap", existing: { avg_position: SELF_COMPETE_MAX_POSITION + 15 } });

    const zeroImpressions = input({
      queryRows: [{ query: "brew coffee", impressions: 0, position: 0 }],
      queryPageRows: [],
      coverageOf: () => null,
    });
    const result = computeVerdict(zeroImpressions);
    expect(result.verdict).toMatchObject({ action: "create", reason: "below_impression_floor", existing: null });
    expect(result.primaryCoverage).toEqual({ ratio: null, reason: "no_query_impressions" });
  });

  it("calls a split that exceeds the total inconsistent, not partial", () => {
    const result = computeVerdict(input({ coverageOf: () => null }));
    expect(result.verdict).toMatchObject({ action: "undecidable", reason: "gsc_inconsistent" });
    expect(result.primaryCoverage).toEqual({ ratio: null, reason: "split_exceeds_total" });
  });

  it("calls low coverage partial", () => {
    const result = computeVerdict(input({ coverageOf: () => MIN_COVERAGE - 0.1 }));
    expect(result.verdict).toMatchObject({ action: "undecidable", reason: "gsc_partial" });
  });

  it("merges spelling variants onto one page and weights the position by impressions", () => {
    const variants = input({
      queryRows: [
        { query: "brew coffee", impressions: 60, position: 10 },
        { query: "Brew  Coffee", impressions: 40, position: 20 },
      ],
      queryPageRows: [
        { query: "brew coffee", page: "https://site.example/coffee", clicks: 3, impressions: 60, position: 10 },
        { query: "Brew  Coffee", page: "https://site.example/coffee", clicks: 2, impressions: 40, position: 0 },
      ],
    });
    const result = computeVerdict(variants);
    expect(result.matchedQueries).toBe(2);
    expect(result.verdict).toMatchObject({
      action: "update",
      observed: { impressions: 100, rows: 2, rows_with_position: 1, avg_position: 10 },
    });
    expect(result.ledgerRows[1]?.position).toBeNull();
  });
});

describe("aggregateByPage", () => {
  it("orders pages by impressions and keeps rows without a position out of the weighting", () => {
    const pages = aggregateByPage([
      { query: "q", page: "https://a.example/", clicks: 0, impressions: 10, position: 30 },
      { query: "q", page: "https://b.example/", clicks: 0, impressions: 50, position: null },
      { query: "q", page: "https://b.example/", clicks: 0, impressions: 50, position: 4 },
    ]);
    expect(pages.map((page) => page.page)).toEqual(["https://b.example/", "https://a.example/"]);
    expect(pages[0]).toMatchObject({ impressions: 100, rows: 2, rows_with_position: 1, avg_position: 4 });
  });
});

describe("deriveVerdictFromLedger", () => {
  it("derives the same verdict the producer computed, from the ledger and reads alone", () => {
    const produced = computeVerdict(input());
    const derived = deriveVerdictFromLedger({
      reads: {
        status: "complete",
        property: "sc-domain:site.example",
        window: { start: "2026-07-29", end: "2026-08-25", lookback_days: 28 },
        matched_queries: produced.matchedQueries,
        primary_coverage: produced.primaryCoverage,
        truncated: [],
        rows: { query: 1, query_page: 1, page: 2 },
        unreadable_rows: { query: 0, query_page: 0, page: 0 },
      },
      rows: produced.ledgerRows,
      minDimensionCoverage: MIN_COVERAGE,
    });
    expect(derived).toEqual(produced.verdict);
  });

  it("maps an unavailable read to the matching undecidable reason", () => {
    expect(
      deriveVerdictFromLedger({ reads: { status: "unavailable", reason: "not_requested", attempted: null }, rows: [], minDimensionCoverage: MIN_COVERAGE }),
    ).toEqual({ action: "undecidable", reason: "no_gsc_property", provenance: null });
    expect(
      deriveVerdictFromLedger({ reads: { status: "unavailable", reason: "timeout", attempted: 1 }, rows: [], minDimensionCoverage: MIN_COVERAGE }),
    ).toMatchObject({ action: "undecidable", reason: "gsc_unavailable" });
  });

  it("does not let a forged coverage or a forged reason survive re-derivation", () => {
    const produced = computeVerdict(input());
    const reads = {
      status: "complete" as const,
      property: "sc-domain:site.example",
      window: { start: "2026-07-29", end: "2026-08-25", lookback_days: 28 },
      matched_queries: produced.matchedQueries,
      primary_coverage: { ratio: MIN_COVERAGE - 0.5 },
      truncated: [] as ("query" | "query_page" | "page")[],
      rows: { query: 1, query_page: 1, page: 2 },
      unreadable_rows: { query: 0, query_page: 0, page: 0 },
    };
    expect(deriveVerdictFromLedger({ reads, rows: produced.ledgerRows, minDimensionCoverage: MIN_COVERAGE })).toMatchObject({
      action: "undecidable",
      reason: "gsc_partial",
    });
  });
});
