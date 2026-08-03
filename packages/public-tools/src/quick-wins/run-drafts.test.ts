import { describe, expect, it, vi } from "vitest";

import type { GscQueryRequest, GscQueryResponse } from "../gsc-analytics/types.ts";
import { MIN_BUCKET_QUERIES } from "../site-baseline/ctr-curve.ts";
import { runQuickWins } from "./run.ts";

const NOW = new Date("2026-08-03T20:00:00Z");

const SUBJECT = "https://x.test/weak";
const COMPARABLE = "https://x.test/strong";
const TARGET_QUERY = "target query";

/**
 * A property where exactly one query has a real shortfall and a real
 * comparable page, so a draft is genuinely producible. Everything else exists
 * to make the band usable.
 */
function client(): (r: GscQueryRequest) => Promise<GscQueryResponse> {
  return async (request) => {
    const dims = request.dimensions.join(",");

    if (dims === "") {
      return {
        rows: [{ keys: [], impressions: 40_000, clicks: 900, position: 9 }],
        responseAggregationType: "byProperty",
      };
    }

    if (dims === "query") {
      return {
        rows: [
          // The row we expect a draft for: big shortfall.
          { keys: [TARGET_QUERY], impressions: 4000, clicks: 4, position: 9 },
          ...Array.from({ length: MIN_BUCKET_QUERIES + 1 }, (_, i) => ({
            keys: [`peer${i}`],
            impressions: 1000,
            clicks: 50,
            position: 9,
          })),
        ],
        responseAggregationType: "byProperty",
      };
    }

    if (dims === "page") {
      return {
        rows: [
          { keys: [SUBJECT], impressions: 4000, clicks: 4, position: 9 },
          { keys: [COMPARABLE], impressions: 3000, clicks: 300, position: 9 },
        ],
        responseAggregationType: "byPage",
      };
    }

    // query,page — the split. Must cover the query, or no draft is possible.
    return {
      rows: [
        { keys: [TARGET_QUERY, SUBJECT], impressions: 3900, clicks: 4, position: 9 },
      ],
      responseAggregationType: "byPage",
    };
  };
}

const DRAFT_REPLY = JSON.stringify({
  title: "A Clearer Title For The Same Page",
  metaDescription: "A description written on the pattern of the stronger page.",
});

describe("runQuickWins with draft dependencies", () => {
  it("produces a draft carrying the page it was modelled on", async () => {
    const { result } = await runQuickWins({
      client: client(),
      now: NOW,
      brandTerms: [],
      draftDependencies: {
        fetchPageMeta: async (url) => ({
          title: url === COMPARABLE ? "Strong Page: What You Get" : "Weak Page",
          metaDescription: "something",
        }),
        complete: async () => DRAFT_REPLY,
      },
    });

    // The regression this file exists for: an earlier version measured
    // coverage against a stand-in denominator of 1, so every split looked
    // like it over-covered, every row fell out as low_dimension_coverage,
    // and drafts could never be produced at all — with every other test
    // still green.
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]?.query).toBe(TARGET_QUERY);
    expect(result.drafts[0]?.comparablePage).toBe(COMPARABLE);
    expect(result.drafts[0]?.title).toContain("Clearer Title");
  });

  it("returns the evidence table with no drafts when no seams are given", async () => {
    const { result } = await runQuickWins({
      client: client(),
      now: NOW,
      brandTerms: [],
    });

    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.drafts).toEqual([]);
    expect(result.draftsSkipped).toEqual({});
  });

  it("does not read the page dimension at all when drafts are off", async () => {
    // Drafts cost two extra Search Console reads. A deployment without a
    // model must not pay for them.
    const spy = vi.fn(client());

    await runQuickWins({ client: spy, now: NOW, brandTerms: [] });

    const dims = spy.mock.calls.map(([r]) => r.dimensions.join(","));
    expect(dims).not.toContain("page");
    expect(dims).not.toContain("query,page");
  });

  it("keeps the evidence table when the model is unavailable", async () => {
    const { result } = await runQuickWins({
      client: client(),
      now: NOW,
      brandTerms: [],
      draftDependencies: {
        fetchPageMeta: async () => ({ title: "t", metaDescription: "d" }),
        complete: async () => {
          throw new Error("no api key");
        },
      },
    });

    // The table is the product; drafts are an attachment to a row.
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.drafts).toEqual([]);
    expect(result.draftsSkipped[TARGET_QUERY]).toBe("model_unavailable");
  });

  it("records a reason for every row that got no draft", async () => {
    const { result } = await runQuickWins({
      client: client(),
      now: NOW,
      brandTerms: [],
      draftDependencies: {
        fetchPageMeta: async () => null,
        complete: async () => DRAFT_REPLY,
      },
    });

    expect(result.draftsSkipped[TARGET_QUERY]).toBe("page_unreadable");
  });
});
