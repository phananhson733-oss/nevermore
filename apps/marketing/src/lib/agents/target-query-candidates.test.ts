import { describe, expect, it } from "vitest";
import {
  createTargetQueryCandidateReader,
  TARGET_QUERY_CANDIDATE_LIMIT,
  targetQueryWindow,
} from "./target-query-candidates.ts";

const NOW = new Date("2026-09-04T10:00:00.000Z");
const PROPERTIES = ["sc-domain:example.com"] as const;

function rows(...entries: readonly (readonly [string, number])[]) {
  return {
    rows: entries.map(([query, impressions]) => ({
      keys: [query],
      clicks: 0,
      impressions,
      position: 12.5,
    })),
  };
}

function reader(
  handler: (body: Record<string, unknown>) => unknown,
  options: { readonly capture?: (body: Record<string, unknown>) => void } = {},
) {
  const fetchImpl = (async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<
      string,
      unknown
    >;
    options.capture?.(body);
    return new Response(JSON.stringify(handler(body)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

  return createTargetQueryCandidateReader({ now: () => NOW, fetchImpl });
}

describe("target query candidates", () => {
  it("ends the window short of today so a partial day is not read as a loss", () => {
    // Search Console finalises a day's rows after it ends. A query measured up
    // to this morning has only the hours already counted, and the drop that
    // shows is the counting, not the query.
    const window = targetQueryWindow(NOW);

    expect(window.endDate).toBe("2026-09-01");
    expect(window.startDate).toBe("2026-08-04");
  });

  it("asks for this page's queries, not the property's", () => {
    let sent: Record<string, unknown> = {};
    const read = reader(() => rows(["natal chart", 400]), {
      capture: (body) => {
        sent = body;
      },
    });

    return read({
      inspectedUrl: "https://example.com/birth-chart",
      accessToken: "token",
      properties: PROPERTIES,
    }).then(() => {
      expect(sent.dimensions).toEqual(["query"]);
      expect(sent.dimensionFilterGroups).toEqual([
        {
          groupType: "and",
          filters: [
            {
              dimension: "page",
              operator: "equals",
              expression: "https://example.com/birth-chart",
            },
          ],
        },
      ]);
    });
  });

  it("orders candidates by impressions and caps the shortlist", async () => {
    const many = Array.from(
      { length: TARGET_QUERY_CANDIDATE_LIMIT + 4 },
      (_value, index) => [`query ${index}`, index + 1] as const,
    );
    const read = reader(() => rows(...many));

    const result = await read({
      inspectedUrl: "https://example.com/birth-chart",
      accessToken: "token",
      properties: PROPERTIES,
    });

    expect(result.kind).toBe("candidates");
    if (result.kind !== "candidates") return;
    expect(result.candidates).toHaveLength(TARGET_QUERY_CANDIDATE_LIMIT);
    expect(result.candidates[0]?.impressions).toBe(many.length);
    expect(
      result.candidates.map((candidate) => candidate.impressions),
    ).toEqual([...result.candidates.map((c) => c.impressions)].sort((a, b) => b - a));
  });

  it("separates a page nobody has found from a read that failed", async () => {
    /*
      The distinction this whole read exists to keep. An empty list is a real
      answer -- nobody has searched their way here yet. Returning it for a
      network error would tell an owner their page earns no impressions when
      the truth is that we could not ask, and the two call for opposite work.
    */
    const empty = await reader(() => rows())({
      inspectedUrl: "https://example.com/birth-chart",
      accessToken: "token",
      properties: PROPERTIES,
    });

    expect(empty.kind).toBe("no_rows");

    const broken = createTargetQueryCandidateReader({
      now: () => NOW,
      fetchImpl: (() =>
        Promise.reject(new Error("network"))) as unknown as typeof fetch,
    });

    expect(
      (
        await broken({
          inspectedUrl: "https://example.com/birth-chart",
          accessToken: "token",
          properties: PROPERTIES,
        })
      ).kind,
    ).toBe("unavailable");
  });

  it("refuses a page no verified property covers instead of guessing one", async () => {
    // Asking Search Console about a host the grant does not cover returns an
    // error, and reporting that as "no impressions" would blame the page.
    const read = reader(() => rows(["anything", 100]));

    expect(
      (
        await read({
          inspectedUrl: "https://other.test/page",
          accessToken: "token",
          properties: PROPERTIES,
        })
      ).kind,
    ).toBe("no_property");
  });

  it("drops a zero-impression row rather than offering it as a candidate", async () => {
    // Search Console returns rows at zero impressions. One of those is not a
    // query anyone typed to find this page.
    const read = reader(() => rows(["real query", 30], ["zero query", 0]));

    const result = await read({
      inspectedUrl: "https://example.com/birth-chart",
      accessToken: "token",
      properties: PROPERTIES,
    });

    expect(result.kind).toBe("candidates");
    if (result.kind !== "candidates") return;
    expect(result.candidates.map((candidate) => candidate.query)).toEqual([
      "real query",
    ]);
  });
});
