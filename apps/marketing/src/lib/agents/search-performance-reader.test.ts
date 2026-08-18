// @input  -- a stubbed Search Console endpoint and a fixed clock
// @output -- proof of what this reader asks for, and what it refuses to ask for
// @pos    -- unit coverage for the only place the Agent audit spends GSC quota

import { describe, expect, it, vi } from "vitest";

import { createSearchPerformanceReader } from "./search-performance-reader.ts";

interface Sent {
  readonly dimensions: readonly string[];
  readonly startDate: string;
  readonly endDate: string;
  readonly rowLimit: number;
  readonly dataState: string;
  readonly dimensionFilterGroups?: readonly {
    readonly groupType: string;
    readonly filters: readonly {
      readonly dimension: string;
      readonly operator: string;
      readonly expression: string;
    }[];
  }[];
}

function stub(rowsFor: (sent: Sent) => readonly unknown[] = () => []) {
  const sent: Sent[] = [];
  const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Sent;
    sent.push(body);
    return new Response(
      JSON.stringify({
        rows: rowsFor(body),
        responseAggregationType: "byPage",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  return { sent, fetchImpl };
}

const AT = new Date("2026-08-18T04:00:00Z");

function read(
  overrides: {
    readonly targetPageUrl?: string | null;
    readonly targetQueries?: readonly string[];
  } = {},
  rowsFor?: (sent: Sent) => readonly unknown[],
) {
  const { sent, fetchImpl } = stub(rowsFor);
  const reader = createSearchPerformanceReader({
    now: () => AT,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  return {
    sent,
    result: reader({
      property: "sc-domain:acme.test",
      accessToken: "token",
      targetPageUrl: overrides.targetPageUrl ?? null,
      targetQueries: overrides.targetQueries ?? [],
    }),
  };
}

describe("createSearchPerformanceReader", () => {
  it("reads two site lists and nothing else when there is no query to look up", async () => {
    const { sent, result } = read();
    const raw = await result;

    expect(sent).toHaveLength(2);
    expect(sent.map((entry) => entry.dimensions)).toEqual([["page"], ["query"]]);
    // An audit that cannot use the third read must not spend the call finding
    // that out — Search Console quota is counted per project, so it would be
    // taken from every other visitor.
    expect(sent.every((entry) => entry.dimensionFilterGroups === undefined)).toBe(
      true,
    );
    expect(raw.targetPageQueries).toBeNull();
    expect(raw.targetPageUrl).toBeNull();
  });

  it.each([
    ["no confirmed query", { targetPageUrl: "https://acme.test/chart" }],
    ["no collected page", { targetQueries: ["natal chart"] }],
  ])("skips the third read with %s", async (_label, overrides) => {
    const { sent } = read(overrides);
    await Promise.resolve();

    expect(sent).toHaveLength(2);
  });

  it("narrows the third read to one URL, by equality", async () => {
    const { sent, result } = read({
      targetPageUrl: "https://acme.test/chart",
      targetQueries: ["natal chart"],
    });
    await result;

    const filtered = sent.find(
      (entry) => entry.dimensionFilterGroups !== undefined,
    );
    expect(filtered?.dimensions).toEqual(["query"]);
    // `equals`, never `contains`: a contains filter on this URL would also
    // match every child path, and the rows would still look like an answer
    // about one page.
    expect(filtered?.dimensionFilterGroups?.[0]?.filters).toEqual([
      {
        dimension: "page",
        operator: "equals",
        expression: "https://acme.test/chart",
      },
    ]);
  });

  it("ends the window short of today, in the property's own time zone", async () => {
    const { sent, result } = read();
    await result;

    // 2026-08-18T04:00Z is still 2026-08-17 in Los Angeles, where Search
    // Console closes its reporting days. Taking the UTC date would run the
    // window a day ahead of what the API considers final — the exact thing the
    // lag exists to avoid — and daylight saving would move the error twice a
    // year.
    expect(sent[0]?.endDate).toBe("2026-08-14");
    expect(sent[0]?.startDate).toBe("2026-07-18");
    expect(sent[0]?.dataState).toBe("final");
  });

  it("reports truncation per list rather than for the request as a whole", async () => {
    const row = (key: string) => ({
      keys: [key],
      clicks: 0,
      impressions: 1,
      position: 4,
    });
    const { result } = read(
      { targetPageUrl: "https://acme.test/chart", targetQueries: ["q"] },
      (sent) =>
        // Only the site query list comes back full.
        sent.dimensions[0] === "query" &&
        sent.dimensionFilterGroups === undefined
          ? Array.from({ length: sent.rowLimit }, (_, i) => row(`q${i}`))
          : [row("q")],
    );
    const raw = await result;

    expect(raw.queriesTruncated).toBe(true);
    expect(raw.pagesTruncated).toBe(false);
    // The band record is entitled to its measurement even when a sibling list
    // was cut short; folding them into one flag would take a good answer down
    // with an unrelated cap.
    expect(raw.targetPageQueriesTruncated).toBe(false);
    expect(raw.targetPageQueries).toHaveLength(1);
  });

  it("keeps the token out of the URL", async () => {
    const { fetchImpl } = stub();
    const reader = createSearchPerformanceReader({
      now: () => AT,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await reader({
      property: "sc-domain:acme.test",
      accessToken: "secret-token",
      targetPageUrl: null,
      targetQueries: [],
    });

    for (const call of fetchImpl.mock.calls) {
      expect(String(call[0])).not.toContain("secret-token");
    }
  });
});
