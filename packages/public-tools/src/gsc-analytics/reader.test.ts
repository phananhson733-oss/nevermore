import { describe, expect, it, vi } from "vitest";

import {
  GSC_MAX_PAGES,
  GSC_ROW_LIMIT,
  readPropertyTotals,
  readQueryRows,
} from "./reader.ts";
import type { GscQueryRequest, GscQueryResponse, GscRawRow } from "./types.ts";

const WINDOW = { startDate: "2026-07-06", endDate: "2026-08-02" };

function rawRow(query: string, impressions = 100, clicks = 5): GscRawRow {
  return { keys: [query], impressions, clicks, position: 9 };
}

function clientReturning(
  pages: readonly (readonly GscRawRow[])[],
  aggregation: string | null = "byPage",
) {
  const calls: GscQueryRequest[] = [];
  const client = async (request: GscQueryRequest): Promise<GscQueryResponse> => {
    calls.push(request);
    const index = request.startRow / GSC_ROW_LIMIT;
    return {
      rows: pages[index] ?? [],
      responseAggregationType: aggregation,
    };
  };
  return { client, calls };
}

function fullPage(prefix: string): GscRawRow[] {
  return Array.from({ length: GSC_ROW_LIMIT }, (_, i) =>
    rawRow(`${prefix}-${i}`),
  );
}

describe("readQueryRows", () => {
  it("maps raw rows onto the query shape the engine reads", async () => {
    const { client } = clientReturning([[rawRow("messi zodiac sign", 960, 0)]]);

    const result = await readQueryRows(client, WINDOW);

    expect(result.rows).toEqual([
      { query: "messi zodiac sign", impressions: 960, clicks: 0, position: 9 },
    ]);
  });

  it("asks only for the query dimension over the given window", async () => {
    const { client, calls } = clientReturning([[rawRow("a")]]);

    await readQueryRows(client, WINDOW);

    expect(calls[0]).toEqual({
      dimensions: ["query"],
      startDate: "2026-07-06",
      endDate: "2026-08-02",
      rowLimit: GSC_ROW_LIMIT,
      startRow: 0,
    });
  });

  it("forwards an explicit aggregation type for query rows", async () => {
    const { client, calls } = clientReturning([[rawRow("a")]], "byPage");

    await readQueryRows(client, WINDOW, undefined, 1, "byPage");

    expect(calls[0]?.aggregationType).toBe("byPage");
  });

  it("stops paging as soon as a short page comes back", async () => {
    const { client, calls } = clientReturning([fullPage("p0"), [rawRow("last")]]);

    const result = await readQueryRows(client, WINDOW);

    expect(calls).toHaveLength(2);
    expect(calls[1]?.startRow).toBe(GSC_ROW_LIMIT);
    expect(result.paging.pagesFetched).toBe(2);
    expect(result.paging.truncated).toBe(false);
    expect(result.rows).toHaveLength(GSC_ROW_LIMIT + 1);
  });

  it("reports truncation when it hits the page cap on a full page", async () => {
    const pages = Array.from({ length: GSC_MAX_PAGES }, (_, i) =>
      fullPage(`p${i}`),
    );
    const { client, calls } = clientReturning(pages);

    const result = await readQueryRows(client, WINDOW);

    expect(calls).toHaveLength(GSC_MAX_PAGES);
    expect(result.paging.truncated).toBe(true);
  });

  it("stops paging when the request budget is gone, and says it truncated", async () => {
    // Four sequential pages, each with its own timeout and retry, runs past
    // any platform function limit. Dropping the later pages is a stated
    // truncation; blowing the limit is a bare 504 with a latched slot.
    const { client, calls } = clientReturning([
      fullPage("p0"),
      fullPage("p1"),
      fullPage("p2"),
      fullPage("p3"),
    ]);
    let expired = false;

    const result = await readQueryRows(client, WINDOW, {
      isExpired: () => {
        const was = expired;
        expired = true;
        return was;
      },
    });

    // Page 0 is unconditional, page 1 sees isExpired() false, page 2 sees true.
    expect(calls).toHaveLength(2);
    expect(result.paging.truncated).toBe(true);
  });

  it("always fetches the first page even on an already-expired budget", async () => {
    // An empty table is not a cheaper answer, it is a different one.
    const { client, calls } = clientReturning([[rawRow("only")]]);

    const result = await readQueryRows(client, WINDOW, {
      isExpired: () => true,
    });

    expect(calls).toHaveLength(1);
    expect(result.rows).toHaveLength(1);
  });

  it("echoes the aggregation type Search Console actually used", async () => {
    const { client } = clientReturning([[rawRow("a")]], "byProperty");

    const result = await readQueryRows(client, WINDOW);

    expect(result.responseAggregationType).toBe("byProperty");
  });

  it("carries a null aggregation type through rather than inventing one", async () => {
    const { client } = clientReturning([[rawRow("a")]], null);

    expect((await readQueryRows(client, WINDOW)).responseAggregationType).toBeNull();
  });

  it("returns an empty result for a property with no rows", async () => {
    const { client } = clientReturning([[]]);

    const result = await readQueryRows(client, WINDOW);

    expect(result.rows).toEqual([]);
    expect(result.paging.truncated).toBe(false);
  });

  it("propagates a mid-paging failure instead of returning a partial set", async () => {
    // A truncated series that reads as complete is worse than an error: the
    // engine would compute a curve from a prefix and present it as the site.
    const client = vi
      .fn<(r: GscQueryRequest) => Promise<GscQueryResponse>>()
      .mockResolvedValueOnce({
        rows: fullPage("p0"),
        responseAggregationType: "byPage",
      })
      .mockRejectedValueOnce(new Error("429"));

    await expect(readQueryRows(client, WINDOW)).rejects.toThrow("429");
  });

  it("drops rows with no dimension key rather than keying them on undefined", async () => {
    const { client } = clientReturning([
      [{ keys: [], impressions: 10, clicks: 1, position: 3 }, rawRow("ok")],
    ]);

    const result = await readQueryRows(client, WINDOW);

    expect(result.rows.map((r) => r.query)).toEqual(["ok"]);
  });
});

describe("readPropertyTotals", () => {
  it("asks for no dimensions and returns the single total row", async () => {
    const calls: GscQueryRequest[] = [];
    const client = async (request: GscQueryRequest): Promise<GscQueryResponse> => {
      calls.push(request);
      return {
        rows: [{ keys: [], impressions: 60_156, clicks: 943, position: 12.4 }],
        responseAggregationType: "byProperty",
      };
    };

    const totals = await readPropertyTotals(client, WINDOW);

    expect(calls[0]?.dimensions).toEqual([]);
    expect(calls[0]?.rowLimit).toBe(1);
    expect(totals).toEqual({
      impressions: 60_156,
      clicks: 943,
      // Carried so the caller can refuse to divide this by a row sum measured
      // on a different basis.
      responseAggregationType: "byProperty",
    });
  });

  it("returns null when the property reported nothing at all", async () => {
    // Zero rows means Search Console had nothing for this window. Reporting
    // {0, 0} would make the anonymization gap compute to a confident 0%.
    const client = async (): Promise<GscQueryResponse> => ({
      rows: [],
      responseAggregationType: "byProperty",
    });

    expect(await readPropertyTotals(client, WINDOW)).toBeNull();
  });

  it("forwards an explicit aggregation type for property totals", async () => {
    const calls: GscQueryRequest[] = [];
    const client = async (request: GscQueryRequest): Promise<GscQueryResponse> => {
      calls.push(request);
      return {
        rows: [{ keys: [], impressions: 100, clicks: 10, position: 5 }],
        responseAggregationType: "byPage",
      };
    };

    await readPropertyTotals(client, WINDOW, "byPage");

    expect(calls[0]?.aggregationType).toBe("byPage");
  });
});
