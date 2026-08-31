import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SearchAnalyticsClientOptions } from "@sf/sources";

const captures = vi.hoisted(() => ({
  clientOptions: [] as SearchAnalyticsClientOptions[],
  fallbackFetchImpl: undefined as SearchAnalyticsClientOptions["fetchImpl"],
}));

vi.mock("@sf/sources", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sf/sources")>();
  return {
    ...actual,
    createSearchAnalyticsClient: (options: SearchAnalyticsClientOptions) => {
      captures.clientOptions.push(options);
      const fetchImpl = options.fetchImpl ?? captures.fallbackFetchImpl;
      return actual.createSearchAnalyticsClient({
        ...options,
        ...(fetchImpl === undefined ? {} : { fetchImpl }),
      });
    },
  };
});

const { createDailyBriefingReader, REQUEST_BUDGET_MS } = await import(
  "./daily-briefing-reader.ts"
);

const NOW = new Date("2026-08-24T20:00:00.000Z");
const PROPERTY = "sc-domain:example.com";
const TOKEN = "request-scoped-access-token";

function input(remainingMs: () => number) {
  return {
    property: PROPERTY,
    brandTerms: ["Acme"],
    brandTermsConfirmed: true,
    remainingMs,
  } as const;
}

function jsonResponse(body: unknown = { rows: [] }): Response {
  return Response.json(body);
}

function datedResponse(endDate: string): Response {
  return jsonResponse({
    responseAggregationType: "byProperty",
    rows: endDate < "2026-08-08" ? [] : Array.from({ length: 14 }, (_, index) => ({
      keys: [`2026-08-${String(index + 8).padStart(2, "0")}`],
      clicks: 10, impressions: 100, position: 4,
    })),
  });
}

beforeEach(() => {
  captures.clientOptions.length = 0;
  captures.fallbackFetchImpl = undefined;
});

describe("createDailyBriefingReader", () => {
  it("keeps the whole handler budget at 45 seconds inside the 60-second route", () => {
    expect(REQUEST_BUDGET_MS).toBe(45_000);
  });

  it("uses one request-scoped token for the latest-data read plan", async () => {
    const requests: Array<{
      readonly url: string;
      readonly body: Record<string, unknown>;
      readonly authorization: string | null;
    }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push({
        url,
        body,
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return (body["dimensions"] as readonly string[])[0] === "date" ? datedResponse(String(body["endDate"])) : jsonResponse();
    });
    const remainingMs = vi.fn(() => REQUEST_BUDGET_MS);
    captures.fallbackFetchImpl = fetchImpl;
    const reader = createDailyBriefingReader({
      accessToken: TOKEN,
      now: () => NOW,
      fetchImpl,
    });

    await reader(input(remainingMs));

    expect(captures.clientOptions).toHaveLength(1);
    expect(captures.clientOptions[0]).toMatchObject({
      siteUrl: PROPERTY,
      accessToken: TOKEN,
      requestTimeoutMs: 15_000,
      remainingMs,
      fetchImpl,
      signal: expect.any(AbortSignal),
    });
    expect(requests).toHaveLength(13);
    expect(requests[0]?.body).toEqual({
      dimensions: ["date"],
      startDate: "2026-05-27",
      endDate: "2026-08-24",
      rowLimit: 25_000,
      startRow: 0,
      dataState: "all",
      aggregationType: "byProperty",
    });
    // The date response freezes the analysis window; every attachment uses
    // the same latest-data policy, while the hourly read remains independent.
    const dataStates = requests.map(({ body }) => body["dataState"]);
    expect(dataStates.filter((state) => state === "final")).toHaveLength(0);
    expect(dataStates.filter((state) => state === "all")).toHaveLength(12);
    expect(dataStates.filter((state) => state === "hourly_all")).toHaveLength(
      1,
    );
    expect(
      requests.every(({ authorization }) => authorization === `Bearer ${TOKEN}`),
    ).toBe(true);
    expect(requests.every(({ url }) => !url.includes(TOKEN))).toBe(true);
    expect(captures.clientOptions[0]?.signal?.aborted).toBe(true);
  });

  it("forwards the live remaining budget and does not start the required read once spent", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse());
    captures.fallbackFetchImpl = fetchImpl;
    const remainingMs = vi.fn(() => 0);
    const reader = createDailyBriefingReader({
      accessToken: TOKEN,
      fetchImpl,
    });

    await expect(reader(input(remainingMs))).rejects.toThrow();

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(captures.clientOptions[0]?.remainingMs).toBe(remainingMs);
    expect(captures.clientOptions[0]?.signal?.aborted).toBe(true);
  });

  it("leaves a sibling transport in flight when one attachment fails", async () => {
    let optionalCalls = 0;
    let siblingAborts = 0;
    const fetchImpl = vi.fn((_: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        readonly dimensions: readonly string[];
        readonly endDate: string;
      };
      if (body.dimensions[0] === "date") {
        return Promise.resolve(datedResponse(body.endDate));
      }

      optionalCalls += 1;
      // Fail only the query/page attachment, which is the read whose loss
      // must not take the query rows with it.
      if (body.dimensions.length === 2) {
        return Promise.reject(new Error("optional attachment unavailable"));
      }

      return new Promise<Response>((resolve, reject) => {
        const signal = init?.signal;
        const fallback = setTimeout(() => resolve(jsonResponse()), 10);
        const abort = () => {
          clearTimeout(fallback);
          siblingAborts += 1;
          reject(signal?.reason ?? new DOMException("aborted", "AbortError"));
        };
        if (signal?.aborted) {
          abort();
          return;
        }
        signal?.addEventListener("abort", abort, { once: true });
      });
    });
    captures.fallbackFetchImpl = fetchImpl;
    const reader = createDailyBriefingReader({
      accessToken: TOKEN,
      now: () => NOW,
      fetchImpl,
    });

    await reader(input(() => REQUEST_BUDGET_MS));

    // The attachments share one request scope but not one fate. Aborting the
    // siblings of a failed page read deletes the query rows that would have
    // carried this run's only signals.
    //
    // Ten analysis attachments plus the independent hourly read.
    expect(optionalCalls).toBe(11);
    expect(siblingAborts).toBe(0);
    // The scope is still closed once the report has finished.
    expect(captures.clientOptions[0]?.signal?.aborted).toBe(true);
  });

  it("still throws a required-read failure and aborts its request scope", async () => {
    const fetchImpl = async () => {
      throw new Error("required date read failed with private detail");
    };
    captures.fallbackFetchImpl = fetchImpl;
    const reader = createDailyBriefingReader({
      accessToken: TOKEN,
      fetchImpl,
    });

    await expect(reader(input(() => REQUEST_BUDGET_MS))).rejects.toThrow(
      "required date read failed",
    );
    expect(captures.clientOptions[0]?.signal?.aborted).toBe(true);
  });
});
