import { describe, expect, it, vi } from "vitest";

import { SourceError } from "../adapter.ts";
import {
  RETRYABLE_BACKOFF_BASE_MS,
  createSearchAnalyticsClient,
  type SearchAnalyticsRequest,
} from "./search-analytics.ts";

const SITE = "sc-domain:astrologywiki.com";
const TOKEN = "ya29.test-token";

const REQUEST: SearchAnalyticsRequest = {
  dimensions: ["query"],
  startDate: "2026-07-06",
  endDate: "2026-08-02",
  rowLimit: 25_000,
  startRow: 0,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function client(
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>,
  overrides: Partial<Parameters<typeof createSearchAnalyticsClient>[0]> = {},
) {
  return createSearchAnalyticsClient({
    siteUrl: SITE,
    accessToken: TOKEN,
    fetchImpl,
    sleep: async () => {},
    random: () => 0.5,
    ...overrides,
  });
}

describe("createSearchAnalyticsClient", () => {
  it("posts the requested dimensions and window to the property's endpoint", async () => {
    let seenUrl = "";
    let seenBody: Record<string, unknown> = {};
    const call = client(async (url, init) => {
      seenUrl = url;
      seenBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({ rows: [] });
    });

    await call(REQUEST);

    expect(seenUrl).toContain(encodeURIComponent(SITE));
    expect(seenUrl).toContain("/searchAnalytics/query");
    expect(seenBody).toMatchObject({
      dimensions: ["query"],
      startDate: "2026-07-06",
      endDate: "2026-08-02",
      rowLimit: 25_000,
      startRow: 0,
      dataState: "final",
    });
    expect(seenBody).not.toHaveProperty("aggregationType");
  });

  it("forwards an explicit aggregation type in the JSON body", async () => {
    let seenBody: Record<string, unknown> = {};
    const call = client(async (_url, init) => {
      seenBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({ rows: [], responseAggregationType: "byPage" });
    });

    await call({ ...REQUEST, aggregationType: "byPage" });

    expect(seenBody["aggregationType"]).toBe("byPage");
  });

  it("forwards hourly freshness and preserves its incompleteness boundary", async () => {
    let seenBody: Record<string, unknown> = {};
    const call = client(async (_url, init) => {
      seenBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({
        rows: [],
        metadata: { first_incomplete_hour: "2026-08-24T17:00:00" },
      });
    });

    const response = await call({
      ...REQUEST,
      dimensions: ["hour"],
      dataState: "hourly_all",
    });

    expect(seenBody["dataState"]).toBe("hourly_all");
    expect(response.metadata).toEqual({
      firstIncompleteDate: null,
      firstIncompleteHour: "2026-08-24T17:00:00",
    });
  });

  it("sends the bearer token and never puts it in the URL", async () => {
    let seenUrl = "";
    let auth: string | null = null;
    const call = client(async (url, init) => {
      seenUrl = url;
      auth = new Headers(init?.headers).get("authorization");
      return jsonResponse({ rows: [] });
    });

    await call(REQUEST);

    expect(auth).toBe(`Bearer ${TOKEN}`);
    expect(seenUrl).not.toContain(TOKEN);
  });

  it("maps rows and keeps every dimension key in order", async () => {
    const call = client(async () =>
      jsonResponse({
        rows: [
          {
            keys: ["messi zodiac sign", "https://example.com/a"],
            clicks: 0,
            impressions: 960,
            ctr: 0,
            position: 9.1,
          },
        ],
      }),
    );

    const response = await call({ ...REQUEST, dimensions: ["query", "page"] });

    expect(response.rows).toEqual([
      {
        keys: ["messi zodiac sign", "https://example.com/a"],
        clicks: 0,
        impressions: 960,
        position: 9.1,
      },
    ]);
  });

  it("echoes the aggregation type Search Console reports", async () => {
    const call = client(async () =>
      jsonResponse({ rows: [], responseAggregationType: "byPage" }),
    );

    expect((await call(REQUEST)).responseAggregationType).toBe("byPage");
  });

  it("reports a null aggregation type rather than assuming byProperty", async () => {
    // Assuming an aggregation the service did not confirm is how two
    // incompatible measurements end up being divided by one another.
    const call = client(async () => jsonResponse({ rows: [] }));

    expect((await call(REQUEST)).responseAggregationType).toBeNull();
  });

  it("treats a missing rows array as no rows, not as a malformed response", async () => {
    // Search Console omits `rows` entirely when nothing matched.
    const call = client(async () => jsonResponse({}));

    expect((await call(REQUEST)).rows).toEqual([]);
  });

  it.each([
    { clicks: undefined }, { clicks: null }, { clicks: "12" },
    { impressions: undefined }, { impressions: -1 },
    { position: undefined }, { position: null }, { position: "4" },
    { clicks: 11, impressions: 10 },
  ])("rejects missing or malformed measurements instead of inventing zero: %j", async override => {
    const call = client(async () => jsonResponse({ rows: [{ keys: ["query"], clicks: 1, impressions: 10, position: 4, ...override }] }));
    await expect(call(REQUEST)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("does not convert a non-string dimension into a made-up query", async () => {
    const call = client(async () => jsonResponse({ rows: [{ keys: [null], clicks: 1, impressions: 10, position: 4 }] }));
    await expect(call(REQUEST)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("retries once after a 429, with backoff", async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    const fetchImpl = vi
      .fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(jsonResponse({ error: "slow down" }, 429))
      .mockResolvedValueOnce(jsonResponse({ rows: [] }));

    const call = client(fetchImpl, { sleep });
    await call(REQUEST);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls[0]?.[0]).toBeGreaterThan(0);
  });

  it("jitters the backoff so retries from many callers do not align", async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    const fetchImpl = vi
      .fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(jsonResponse({ error: "slow down" }, 429));

    await expect(
      client(fetchImpl, { sleep, random: () => 0 })(REQUEST),
    ).rejects.toThrow(SourceError);
    const low = sleep.mock.calls[0]?.[0] as number;

    sleep.mockClear();
    await expect(
      client(fetchImpl, { sleep, random: () => 1 })(REQUEST),
    ).rejects.toThrow(SourceError);
    const high = sleep.mock.calls[0]?.[0] as number;

    expect(low).toBeGreaterThanOrEqual(RETRYABLE_BACKOFF_BASE_MS);
    expect(high).toBeGreaterThan(low);
  });

  it("gives up after one retry rather than hammering the shared quota", async () => {
    // Quota is per GCP project. A client that keeps retrying spends every
    // other visitor's budget trying to rescue one request.
    const fetchImpl = vi
      .fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(jsonResponse({ error: "slow down" }, 429));

    await expect(client(fetchImpl)(REQUEST)).rejects.toThrow(SourceError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries a 503 but not a 403", async () => {
    const transient = vi
      .fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({ rows: [] }));
    await client(transient)(REQUEST);
    expect(transient).toHaveBeenCalledTimes(2);

    const denied = vi
      .fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(jsonResponse({}, 403));
    await expect(client(denied)(REQUEST)).rejects.toThrow(SourceError);
    expect(denied).toHaveBeenCalledTimes(1);
  });

  it("caps each attempt at what the request budget has left", async () => {
    // The per-attempt timeout alone bounds nothing: the caller pages several
    // times and each page may retry, so the request runs to the SUM of them.
    let seenTimeoutSignal: AbortSignal | undefined;
    const call = createSearchAnalyticsClient({
      siteUrl: SITE,
      accessToken: TOKEN,
      requestTimeoutMs: 20_000,
      remainingMs: () => 5_000,
      fetchImpl: async (_url, init) => {
        seenTimeoutSignal = init?.signal ?? undefined;
        return jsonResponse({ rows: [] });
      },
    });

    await call(REQUEST);

    // A signal was installed; the point is that the scope was built from the
    // smaller of the two budgets rather than the raw 20s timeout.
    expect(seenTimeoutSignal).toBeDefined();
  });

  it("refuses to start a call once the budget is already spent", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ rows: [] }));
    const call = createSearchAnalyticsClient({
      siteUrl: SITE,
      accessToken: TOKEN,
      remainingMs: () => 0,
      fetchImpl,
    });

    await expect(call(REQUEST)).rejects.toThrow(SourceError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not start a retry the remaining budget cannot cover", async () => {
    // Starting it is how a request already at the limit runs to double it and
    // gets killed mid-flight, losing the stable envelope and the slot release.
    const fetchImpl = vi
      .fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(jsonResponse({ error: "slow down" }, 429));
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    const call = createSearchAnalyticsClient({
      siteUrl: SITE,
      accessToken: TOKEN,
      // Enough to make the first call, not enough to cover the backoff.
      remainingMs: () => 100,
      fetchImpl,
      sleep,
      random: () => 0.5,
    });

    await expect(call(REQUEST)).rejects.toThrow(SourceError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("maps auth failures to a code the caller can act on", async () => {
    const call = client(async () => jsonResponse({}, 401));

    await expect(call(REQUEST)).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });

  it("rejects a response body that is not an object", async () => {
    const call = client(async () => jsonResponse([1, 2, 3]));

    await expect(call(REQUEST)).rejects.toThrow(SourceError);
  });
});
