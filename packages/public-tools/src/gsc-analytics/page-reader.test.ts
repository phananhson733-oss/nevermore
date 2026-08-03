import { describe, expect, it } from "vitest";

import {
  GSC_ROW_LIMIT,
  MIN_DIMENSION_COVERAGE,
  queryPageCoverage,
  readPageRows,
  readQueryPageRows,
} from "./page-reader.ts";
import type { GscQueryRequest, GscQueryResponse, GscRawRow } from "./types.ts";

const WINDOW = { startDate: "2026-07-06", endDate: "2026-08-02" };

function pageRow(page: string, impressions = 1000, clicks = 50): GscRawRow {
  return { keys: [page], impressions, clicks, position: 9 };
}

function qpRow(
  query: string,
  page: string,
  impressions = 500,
  clicks = 25,
): GscRawRow {
  return { keys: [query, page], impressions, clicks, position: 9 };
}

function clientReturning(pages: readonly (readonly GscRawRow[])[]) {
  const calls: GscQueryRequest[] = [];
  const client = async (request: GscQueryRequest): Promise<GscQueryResponse> => {
    calls.push(request);
    return {
      rows: pages[request.startRow / GSC_ROW_LIMIT] ?? [],
      responseAggregationType: "byPage",
    };
  };
  return { client, calls };
}

describe("readPageRows", () => {
  it("asks for the page dimension and maps rows onto the page key", async () => {
    const { client, calls } = clientReturning([
      [pageRow("https://example.com/a", 2000, 100)],
    ]);

    const result = await readPageRows(client, WINDOW);

    expect(calls[0]?.dimensions).toEqual(["page"]);
    expect(result.rows).toEqual([
      {
        page: "https://example.com/a",
        impressions: 2000,
        clicks: 100,
        position: 9,
      },
    ]);
  });

  it("drops rows with no page key rather than keying them on undefined", async () => {
    const { client } = clientReturning([
      [
        { keys: [], impressions: 10, clicks: 1, position: 3 },
        pageRow("https://example.com/ok"),
      ],
    ]);

    const result = await readPageRows(client, WINDOW);

    expect(result.rows.map((r) => r.page)).toEqual(["https://example.com/ok"]);
  });

  it("honours the request budget between pages", async () => {
    const full = Array.from({ length: GSC_ROW_LIMIT }, (_, i) =>
      pageRow(`https://example.com/${i}`),
    );
    const { client, calls } = clientReturning([full, full, full, full]);

    const result = await readPageRows(client, WINDOW, {
      isExpired: () => true,
    });

    expect(calls).toHaveLength(1);
    expect(result.paging.truncated).toBe(true);
  });
});

describe("readQueryPageRows", () => {
  it("asks for both dimensions in order and keeps both keys", async () => {
    const { client, calls } = clientReturning([
      [qpRow("messi zodiac sign", "https://example.com/messi", 960, 0)],
    ]);

    const result = await readQueryPageRows(client, WINDOW);

    expect(calls[0]?.dimensions).toEqual(["query", "page"]);
    expect(result.rows).toEqual([
      {
        query: "messi zodiac sign",
        page: "https://example.com/messi",
        impressions: 960,
        clicks: 0,
        position: 9,
      },
    ]);
  });

  it("drops a row missing either key", async () => {
    const { client } = clientReturning([
      [
        { keys: ["only-query"], impressions: 100, clicks: 1, position: 5 },
        qpRow("ok", "https://example.com/ok"),
      ],
    ]);

    const result = await readQueryPageRows(client, WINDOW);

    expect(result.rows.map((r) => r.query)).toEqual(["ok"]);
  });
});

describe("queryPageCoverage", () => {
  it("measures what fraction of a query's impressions the page split accounts for", () => {
    // Google drops rows when a query groups by page. The split is NOT an
    // additive expansion of the query total, and paging cannot recover the
    // dropped rows, so anything that treats the split as complete has to
    // check first.
    const coverage = queryPageCoverage(
      [{ query: "q", impressions: 1000, clicks: 50, position: 9 }],
      [
        {
          query: "q",
          page: "https://example.com/a",
          impressions: 600,
          clicks: 30,
          position: 9,
        },
        {
          query: "q",
          page: "https://example.com/b",
          impressions: 300,
          clicks: 15,
          position: 9,
        },
      ],
    );

    expect(coverage.get("q")).toBeCloseTo(0.9);
  });

  it("reports a query with no page rows as zero coverage, not as missing", () => {
    const coverage = queryPageCoverage(
      [{ query: "orphan", impressions: 500, clicks: 10, position: 9 }],
      [],
    );

    expect(coverage.get("orphan")).toBe(0);
  });

  it("reports null coverage when the query itself had no impressions", () => {
    // A fraction of nothing is unavailable, not 0.
    const coverage = queryPageCoverage(
      [{ query: "q", impressions: 0, clicks: 0, position: 9 }],
      [],
    );

    expect(coverage.get("q")).toBeNull();
  });

  it("clamps above 1 rather than reporting impossible coverage", () => {
    // The page split exceeding the query total means the two reads disagree.
    // Reporting 1.2 would present a contradiction as a measurement.
    const coverage = queryPageCoverage(
      [{ query: "q", impressions: 100, clicks: 5, position: 9 }],
      [
        {
          query: "q",
          page: "https://example.com/a",
          impressions: 300,
          clicks: 15,
          position: 9,
        },
      ],
    );

    expect(coverage.get("q")).toBeNull();
  });

  it("exposes a threshold callers can gate on", () => {
    expect(MIN_DIMENSION_COVERAGE).toBeGreaterThan(0);
    expect(MIN_DIMENSION_COVERAGE).toBeLessThanOrEqual(1);
  });
});
