import { describe, expect, it, vi } from "vitest";

import { SourceError } from "../adapter.ts";
import {
  HttpGscDailySeriesReader,
  type FetchLike,
} from "./daily-series.ts";

const RANGE = { startDate: "2026-05-01", endDate: "2026-07-29" } as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function row(date: string, clicks: number, impressions: number) {
  return { keys: [date], clicks, impressions };
}

function reader(fetchImpl: FetchLike, overrides = {}) {
  return new HttpGscDailySeriesReader({
    siteUrl: "sc-domain:example.com",
    accessToken: "test-token",
    fetchImpl,
    sleep: () => Promise.resolve(),
    random: () => 0.5,
    ...overrides,
  });
}

describe("HttpGscDailySeriesReader", () => {
  it("reads a daily series over the [date] dimension", async () => {
    const fetchImpl = vi.fn<FetchLike>(() =>
      Promise.resolve(
        jsonResponse({
          rows: [row("2026-05-01", 4, 120), row("2026-05-02", 7, 180)],
        }),
      ),
    );

    const series = await reader(fetchImpl).readDailySeries(RANGE);

    expect(series).toEqual([
      { date: "2026-05-01", clicks: 4, impressions: 120 },
      { date: "2026-05-02", clicks: 7, impressions: 180 },
    ]);
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as {
      dimensions: string[];
      dataState: string;
    };
    expect(body.dimensions).toEqual(["date"]);
    // `all`, not `final`: the newest days are what a drop diagnosis is about.
    expect(body.dataState).toBe("all");
  });

  it("leaves days Search Console did not return absent, never as zeroes", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          rows: [row("2026-05-01", 4, 120), row("2026-05-04", 9, 200)],
        }),
      ),
    );

    const series = await reader(fetchImpl).readDailySeries(RANGE);

    expect(series.map((day) => day.date)).toEqual(["2026-05-01", "2026-05-04"]);
    expect(series.some((day) => day.impressions === 0)).toBe(false);
  });

  it("returns an empty series when the property has no rows at all", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse({})));

    await expect(reader(fetchImpl).readDailySeries(RANGE)).resolves.toEqual([]);
  });

  it("pages until a short page arrives", async () => {
    const first = Array.from({ length: 2 }, (_unused, index) =>
      row(`2026-05-0${index + 1}`, index, index * 10),
    );
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ rows: first }))
      .mockResolvedValueOnce(jsonResponse({ rows: [row("2026-05-03", 5, 60)] }));

    const series = await reader(fetchImpl, { rowLimit: 2 }).readDailySeries(RANGE);

    expect(series).toHaveLength(3);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body)) as {
      startRow: number;
    };
    expect(secondBody.startRow).toBe(2);
  });

  it("retries a 429 with backoff and succeeds", async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ error: "slow down" }, 429))
      .mockResolvedValueOnce(jsonResponse({ rows: [row("2026-05-01", 4, 120)] }));

    const series = await reader(fetchImpl, { sleep }).readDailySeries(RANGE);

    expect(series).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // 500ms base with the jitter source pinned to 0.5 -> 375ms.
    expect(sleep).toHaveBeenCalledWith(375);
  });

  it("retries 5xx and grows the delay between attempts", async () => {
    const sleep = vi.fn((_ms: number) => Promise.resolve());
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({ rows: [row("2026-05-01", 1, 10)] }));

    await reader(fetchImpl, { sleep }).readDailySeries(RANGE);

    expect(sleep.mock.calls.map((call) => call[0])).toEqual([375, 750]);
  });

  it("throws instead of returning a truncated series when retries run out", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse({}, 429)));

    const attempt = reader(fetchImpl, { maxAttempts: 3 }).readDailySeries(RANGE);

    // A partial series presented as complete reads as a traffic collapse that
    // never happened, so exhaustion is an error, not a degraded success.
    await expect(attempt).rejects.toBeInstanceOf(SourceError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does not retry an auth failure", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse({}, 401)));

    await expect(
      reader(fetchImpl).readDailySeries(RANGE),
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("gives up when the next retry would exceed the time budget", async () => {
    let clock = 0;
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse({}, 429)));

    const attempt = reader(fetchImpl, {
      now: () => clock,
      maxWallClockMs: 100,
      sleep: (ms: number) => {
        clock += ms;
        return Promise.resolve();
      },
    }).readDailySeries(RANGE);

    await expect(attempt).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("rejects a response whose rows are not shaped like daily rows", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse({ rows: [{ keys: [], clicks: 1 }] })),
    );

    await expect(
      reader(fetchImpl).readDailySeries(RANGE),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("refuses to construct without a token", () => {
    expect(
      () =>
        new HttpGscDailySeriesReader({
          siteUrl: "sc-domain:example.com",
          accessToken: "  ",
        }),
    ).toThrow(SourceError);
  });
});
