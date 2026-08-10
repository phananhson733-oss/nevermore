import { describe, expect, it } from "vitest";

import {
  COVERAGE_WINDOW_DAYS,
  createKeywordCoverageReader,
} from "./keyword-coverage-reader.ts";

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
    const start = new Date(`${String(captured[0]?.body["startDate"])}T00:00:00Z`);
    const end = new Date(`${String(captured[0]?.body["endDate"])}T00:00:00Z`);
    const days = (end.getTime() - start.getTime()) / 86_400_000 + 1;
    expect(days).toBe(COVERAGE_WINDOW_DAYS);
  });

  it("hands back the rows the coverage check reads", async () => {
    const read = createKeywordCoverageReader({
      now: () => NOW,
      fetchImpl: recordingFetch(
        [],
        [{ keys: ["dental billing"], impressions: 40, position: 6.5 }],
      ),
    });

    expect(
      await read({ property: "sc-domain:acme.com", accessToken: "ya29.test" }),
    ).toEqual([{ query: "dental billing", impressions: 40, position: 6.5 }]);
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
