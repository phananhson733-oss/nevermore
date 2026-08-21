import { describe, expect, it } from "vitest";

import {
  COVERAGE_WINDOW_DAYS,
  createKeywordCoverageReader,
} from "./keyword-coverage-reader.ts";
import { GSC_ROW_LIMIT } from "@sf/public-tools";

const NOW = new Date("2026-08-10T12:00:00.000Z");

interface Captured {
  readonly url: string;
  readonly body: Record<string, unknown>;
}

/** A Search Console stand-in that records the request and answers with rows. */
function recordingFetch(
  captured: Captured[],
  rows: readonly {
    readonly keys: readonly string[];
    readonly impressions: number;
    readonly position: number;
  }[] = [],
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    captured.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return new Response(JSON.stringify({ rows }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

function dimensionFetch(
  captured: Captured[],
  rowsFor: (
    dimensions: readonly string[],
    startRow: number,
  ) => readonly Record<string, unknown>[],
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<
      string,
      unknown
    >;
    captured.push({ url: String(input), body });
    const dimensions = Array.isArray(body["dimensions"])
      ? body["dimensions"].map(String)
      : [];
    const startRow =
      typeof body["startRow"] === "number" ? body["startRow"] : 0;
    return new Response(
      JSON.stringify({
        rows: rowsFor(dimensions, startRow),
        responseAggregationType: "byPage",
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }) as typeof fetch;
}

describe("createKeywordCoverageReader", () => {
  it("addresses the property identifier it was given, URL-encoded", async () => {
    // The bug this file exists for: the orchestration handed over the site URL
    // the visitor typed, Search Console refused it, and the coverage stage was
    // unavailable on every production run. The colon in `sc-domain:` has to
    // survive into the path as an escape, not as a path separator.
    const captured: Captured[] = [];
    const read = createKeywordCoverageReader({
      now: () => NOW,
      fetchImpl: recordingFetch(captured),
    });

    await read({ property: "sc-domain:acme.com", accessToken: "ya29.test" });

    expect(captured[0]?.url).toContain(
      `/sites/${encodeURIComponent("sc-domain:acme.com")}/searchAnalytics/query`,
    );
    expect(captured[0]?.url).not.toContain("https://acme.com");
  });

  it("rejects instead of paging when the run deadline has already passed", async () => {
    // Coverage was the last stage in this route that could not see the
    // request's clock: two lanes of up to four serial 15-second pages is
    // roughly two minutes on a large property, enough to carry a slow run
    // into the platform kill — where no envelope survives. A rejected read is
    // already the stage's degradation contract, so out-of-budget uses it.
    const captured: Captured[] = [];
    const read = createKeywordCoverageReader({
      now: () => NOW,
      fetchImpl: recordingFetch(captured),
      deadlineAt: NOW.getTime() - 1_000,
    });

    await expect(
      read({ property: "sc-domain:acme.com", accessToken: "ya29.test" }),
    ).rejects.toThrow();
  });

  it("stops a paging read at the run deadline instead of finishing the pages", async () => {
    const captured: Captured[] = [];
    // Every page fills to the row limit, so the pager would keep going; the
    // fetch stand-in honours the abort signal the way the real transport does.
    const fullPage = Array.from(
      { length: GSC_ROW_LIMIT },
      (_unused, index) => ({
        keys: [`query ${String(index)}`],
        impressions: 10,
        position: 5,
      }),
    );
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.push({
        url: String(input),
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 40);
        init?.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(new Error("aborted"));
          },
          { once: true },
        );
      });
      return new Response(JSON.stringify({ rows: fullPage }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const read = createKeywordCoverageReader({
      now: () => NOW,
      fetchImpl,
      deadlineAt: NOW.getTime() + 60,
    });

    await expect(
      read({ property: "sc-domain:acme.com", accessToken: "ya29.test" }),
    ).rejects.toThrow();
    // The deadline landed mid-paging: the first page(s) were asked, the full
    // four-page march was not.
    expect(captured.length).toBeGreaterThan(0);
    expect(captured.length).toBeLessThan(8);
  });

  it("asks for the finalised window the other connected tools use", async () => {
    // Three days of lag, 28 days wide. A window that runs to today would read
    // partial days as a drop in serving and mark terms uncovered.
    const captured: Captured[] = [];
    const read = createKeywordCoverageReader({
      now: () => NOW,
      fetchImpl: recordingFetch(captured),
    });

    await read({ property: "sc-domain:acme.com", accessToken: "ya29.test" });

    expect(captured[0]?.body["endDate"]).toBe("2026-08-07");
    expect(captured[0]?.body["startDate"]).toBe("2026-07-11");
    const start = new Date(
      `${String(captured[0]?.body["startDate"])}T00:00:00Z`,
    );
    const end = new Date(`${String(captured[0]?.body["endDate"])}T00:00:00Z`);
    const days = (end.getTime() - start.getTime()) / 86_400_000 + 1;
    expect(days).toBe(COVERAGE_WINDOW_DAYS);
  });

  it("hands back the rows the coverage check reads", async () => {
    const captured: Captured[] = [];
    const read = createKeywordCoverageReader({
      now: () => NOW,
      fetchImpl: dimensionFetch(captured, (dimensions) =>
        dimensions.length === 1
          ? [
              {
                keys: ["dental billing"],
                clicks: 4,
                impressions: 40,
                position: 6.5,
              },
            ]
          : [
              {
                keys: ["dental billing", "https://acme.com/dental-billing"],
                clicks: 3,
                impressions: 32,
                position: 5,
              },
            ],
      ),
    });

    expect(
      await read({ property: "sc-domain:acme.com", accessToken: "ya29.test" }),
    ).toEqual({
      queryRows: [{ query: "dental billing", impressions: 40, position: 6.5 }],
      queryPageRows: [
        {
          query: "dental billing",
          page: "https://acme.com/dental-billing",
          impressions: 32,
          position: 5,
        },
      ],
      queryPaging: { pagesFetched: 1, truncated: false },
      queryPagePaging: { pagesFetched: 1, truncated: false },
    });
    expect(captured.map(({ body }) => body["dimensions"])).toEqual([
      ["query"],
      ["query", "page"],
    ]);
    expect(
      new Set(
        captured.map(
          ({ body }) =>
            `${String(body["startDate"])}:${String(body["endDate"])}`,
        ),
      ),
    ).toEqual(new Set(["2026-07-11:2026-08-07"]));
  });

  it("reports query paging truncation without discarding the prefix", async () => {
    const fullQueryRows = Array.from({ length: GSC_ROW_LIMIT }, () => ({
      keys: ["dental billing"],
      clicks: 1,
      impressions: 1,
      position: 8,
    }));
    const read = createKeywordCoverageReader({
      now: () => NOW,
      fetchImpl: dimensionFetch([], (dimensions) =>
        dimensions.length === 1
          ? fullQueryRows
          : [
              {
                keys: ["dental billing", "https://acme.com/dental-billing"],
                clicks: 1,
                impressions: 1,
                position: 8,
              },
            ],
      ),
    });

    const result = await read({
      property: "sc-domain:acme.com",
      accessToken: "ya29.test",
    });

    expect(result.queryRows).toHaveLength(GSC_ROW_LIMIT * 4);
    expect(result.queryPaging).toEqual({ pagesFetched: 4, truncated: true });
    expect(result.queryPagePaging.truncated).toBe(false);
  });

  it("reports query-page paging truncation without discarding positive rows", async () => {
    const fullQueryPage = Array.from({ length: GSC_ROW_LIMIT }, () => ({
      keys: ["dental billing", "https://acme.com/dental-billing"],
      clicks: 1,
      impressions: 1,
      position: 8,
    }));
    const read = createKeywordCoverageReader({
      now: () => NOW,
      fetchImpl: dimensionFetch([], (dimensions) =>
        dimensions.length === 1
          ? [
              {
                keys: ["dental billing"],
                clicks: 1,
                impressions: 1,
                position: 8,
              },
            ]
          : fullQueryPage,
      ),
    });

    const result = await read({
      property: "sc-domain:acme.com",
      accessToken: "ya29.test",
    });

    expect(result.queryPageRows).toHaveLength(GSC_ROW_LIMIT * 4);
    expect(result.queryPagePaging).toEqual({
      pagesFetched: 4,
      truncated: true,
    });
    expect(result.queryPaging.truncated).toBe(false);
  });

  it("keeps two empty successful reads distinct from a read failure", async () => {
    const read = createKeywordCoverageReader({
      now: () => NOW,
      fetchImpl: dimensionFetch([], () => []),
    });

    await expect(
      read({ property: "sc-domain:acme.com", accessToken: "ya29.test" }),
    ).resolves.toEqual({
      queryRows: [],
      queryPageRows: [],
      queryPaging: { pagesFetched: 1, truncated: false },
      queryPagePaging: { pagesFetched: 1, truncated: false },
    });
  });

  it.each([
    { label: "query", failedDimensions: ["query"] },
    { label: "query-page", failedDimensions: ["query", "page"] },
  ] as const)(
    "rejects when the $label read fails",
    async ({ failedDimensions }) => {
      const read = createKeywordCoverageReader({
        now: () => NOW,
        fetchImpl: (async (_input: RequestInfo | URL, init?: RequestInit) => {
          const body = JSON.parse(String(init?.body ?? "{}")) as Record<
            string,
            unknown
          >;
          const dimensions = Array.isArray(body["dimensions"])
            ? body["dimensions"].map(String)
            : [];
          const failed =
            dimensions.length === failedDimensions.length &&
            dimensions.every(
              (dimension, index) => dimension === failedDimensions[index],
            );
          return new Response(
            failed
              ? JSON.stringify({ error: { message: "forbidden" } })
              : JSON.stringify({ rows: [] }),
            { status: failed ? 403 : 200 },
          );
        }) as typeof fetch,
      });

      await expect(
        read({ property: "sc-domain:acme.com", accessToken: "ya29.test" }),
      ).rejects.toThrow();
    },
  );

  it("aborts the sibling lane when one read fails before it can keep paging", async () => {
    let siblingCalls = 0;
    let siblingObservedAbort = false;
    let releaseSibling = (): void => {};
    const read = createKeywordCoverageReader({
      now: () => NOW,
      fetchImpl: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<
          string,
          unknown
        >;
        const dimensions = Array.isArray(body["dimensions"])
          ? body["dimensions"].map(String)
          : [];
        if (dimensions.length === 1) {
          return new Response(
            JSON.stringify({ error: { message: "forbidden" } }),
            { status: 403 },
          );
        }

        siblingCalls += 1;
        return new Promise<Response>((_resolve, reject) => {
          let settled = false;
          const rejectOnce = (error: unknown): void => {
            if (settled) return;
            settled = true;
            reject(error);
          };
          init?.signal?.addEventListener(
            "abort",
            () => {
              siblingObservedAbort = true;
              rejectOnce(init.signal?.reason);
            },
            { once: true },
          );
          releaseSibling = () =>
            rejectOnce(new DOMException("test cleanup", "AbortError"));
        });
      }) as typeof fetch,
    });

    try {
      await expect(
        read({ property: "sc-domain:acme.com", accessToken: "ya29.test" }),
      ).rejects.toThrow();
      expect(siblingObservedAbort).toBe(true);
      expect(siblingCalls).toBe(1);
    } finally {
      releaseSibling();
    }
  });

  it("rejects on a refused read rather than answering with no rows", async () => {
    // An empty list is a real answer — a property that served nothing. Handing
    // it back for a 403 would turn every candidate into "not observed in the
    // query sample", which is the false negative this stage exists to prevent.
    const read = createKeywordCoverageReader({
      now: () => NOW,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ error: { message: "forbidden" } }), {
          status: 403,
        })) as typeof fetch,
    });

    await expect(
      read({ property: "sc-domain:acme.com", accessToken: "ya29.test" }),
    ).rejects.toThrow();
  });
});
