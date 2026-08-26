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

beforeEach(() => {
  captures.clientOptions.length = 0;
  captures.fallbackFetchImpl = undefined;
});

describe("createDailyBriefingReader", () => {
  it("keeps the whole handler budget at 45 seconds inside the 60-second route", () => {
    expect(REQUEST_BUDGET_MS).toBe(45_000);
  });

  it("uses one request-scoped token for the fixed 14-day final-data read plan", async () => {
    const requests: Array<{
      readonly url: string;
      readonly body: Record<string, unknown>;
      readonly authorization: string | null;
    }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({
        url,
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return jsonResponse();
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
    expect(requests).toHaveLength(9);
    expect(requests[0]?.body).toEqual({
      dimensions: ["date"],
      startDate: "2026-08-08",
      endDate: "2026-08-21",
      rowLimit: 25_000,
      startRow: 0,
      dataState: "final",
    });
    expect(requests.every(({ body }) => body["dataState"] === "final")).toBe(
      true,
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
      };
      if (body.dimensions[0] === "date") {
        return Promise.resolve(jsonResponse());
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

    // The six attachments share one request scope but not one fate.
    // Aborting the siblings of a failed page read deletes the query rows
    // that would have carried this run's only signals.
    expect(optionalCalls).toBe(8);
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
