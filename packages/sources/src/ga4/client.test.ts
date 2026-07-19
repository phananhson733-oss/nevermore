import { describe, expect, it } from "vitest";
import { SourceError } from "../adapter.ts";
import {
  GA4_PAGINATION_CAP_STOP_REASON,
  GA4_ROW_CAP_STOP_REASON,
  HttpGa4Client,
  type Ga4RunReportRequest,
} from "./client.ts";

const REQ: Ga4RunReportRequest = {
  dateRanges: [{ startDate: "2026-01-01", endDate: "2026-01-02" }],
  dimensions: [{ name: "date" }],
  metrics: [{ name: "sessions" }],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function trackedStreamResponse(input: {
  readonly body: string;
  readonly status?: number;
  readonly contentLength?: number;
}): { readonly response: Response; wasCancelled(): boolean } {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(input.body));
    },
    cancel() {
      cancelled = true;
    },
  });
  const headers = new Headers({ "content-type": "application/json" });
  if (input.contentLength !== undefined) {
    headers.set("content-length", String(input.contentLength));
  }
  return {
    response: new Response(stream, { status: input.status ?? 200, headers }),
    wasCancelled: () => cancelled,
  };
}

function hungFetch(): typeof fetch {
  return async (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) {
        reject(new Error("missing request signal"));
        return;
      }
      const rejectFromSignal = (): void =>
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      if (signal.aborted) rejectFromSignal();
      else signal.addEventListener("abort", rejectFromSignal, { once: true });
    });
}

function delayedBodyFailureResponse(secret: string): Response {
  let safetyTimer: ReturnType<typeof setTimeout> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      safetyTimer = setTimeout(() => controller.error(new Error(secret)), 50);
    },
    cancel() {
      if (safetyTimer) clearTimeout(safetyTimer);
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/json" },
  });
}

function row(
  dimension: string,
  metric = "1",
): { dimensionValues: { value: string }[]; metricValues: { value: string }[] } {
  return {
    dimensionValues: [{ value: dimension }],
    metricValues: [{ value: metric }],
  };
}

function bodyOf(init: RequestInit | undefined): {
  offset: string;
  limit: string;
} {
  return JSON.parse(String(init?.body)) as { offset: string; limit: string };
}

describe("HttpGa4Client", () => {
  it("paginates by offset and merges rows across pages", async () => {
    const calls: Array<{ url: string; offset: string; limit: string }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const body = bodyOf(init);
      calls.push({
        url: String(input),
        offset: body.offset,
        limit: body.limit,
      });
      return body.offset === "0"
        ? jsonResponse({ rows: [row("a"), row("b")], rowCount: 3 })
        : jsonResponse({ rows: [row("c")], rowCount: 3 });
    };
    const client = new HttpGa4Client({
      propertyId: "properties/123",
      accessToken: "t",
      fetch: fetchImpl,
    });

    const response = await client.runReport({ ...REQ, limit: 2 });

    expect(response.rows).toHaveLength(3);
    expect(response.rows.map((r) => r.dimensionValues[0]?.value)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(calls.map((c) => c.offset)).toEqual(["0", "2"]);
    expect(calls[0]!.limit).toBe("2");
    expect(calls[0]!.url).toContain("properties/123:runReport");
    expect(response).toMatchObject({
      rowCount: 3,
      truncated: false,
      stopReason: null,
      limitation: "",
    });
  });

  it("returns explicit partial metadata instead of silently truncating at the page cap", async () => {
    let calls = 0;
    const client = new HttpGa4Client({
      propertyId: "properties/1",
      accessToken: "t",
      pageSize: 1,
      maxPages: 2,
      maxRows: 10,
      fetch: async () => {
        calls += 1;
        return jsonResponse({ rows: [row(`page-${calls}`)], rowCount: 3 });
      },
    });

    const response = await client.runReport(REQ);

    expect(response).toMatchObject({
      rowCount: 3,
      truncated: true,
      stopReason: GA4_PAGINATION_CAP_STOP_REASON,
      limitation: expect.stringMatching(/pagination/i),
    });
    expect(response.rows.map((value) => value.dimensionValues[0]?.value)).toEqual([
      "page-1",
      "page-2",
    ]);
    expect(calls).toBe(2);
  });

  it("collects up to the hard row cap and marks a larger provider report partial", async () => {
    let calls = 0;
    const client = new HttpGa4Client({
      propertyId: "properties/1",
      accessToken: "t",
      pageSize: 1,
      maxPages: 10,
      maxRows: 2,
      fetch: async (_input, init) => {
        calls += 1;
        return jsonResponse({
          rows: [row(`row-${bodyOf(init).offset}`)],
          rowCount: 3,
        });
      },
    });

    const response = await client.runReport(REQ);

    expect(response).toMatchObject({
      rowCount: 3,
      truncated: true,
      stopReason: GA4_ROW_CAP_STOP_REASON,
      limitation: expect.stringContaining("200,000"),
    });
    expect(response.rows).toHaveLength(2);
    expect(calls).toBe(2);
  });

  it("treats a provider report exactly equal to the row cap as complete", async () => {
    const requestedLimits: string[] = [];
    const client = new HttpGa4Client({
      propertyId: "properties/1",
      accessToken: "t",
      pageSize: 1,
      maxRows: 2,
      fetch: async (_input, init) => {
        const body = bodyOf(init);
        requestedLimits.push(body.limit);
        return jsonResponse({ rows: [row(`row-${body.offset}`)], rowCount: 2 });
      },
    });

    const response = await client.runReport(REQ);

    expect(response).toMatchObject({
      rowCount: 2,
      truncated: false,
      stopReason: null,
      limitation: "",
    });
    expect(response.rows).toHaveLength(2);
    expect(requestedLimits).toEqual(["1", "1"]);
  });

  it("applies an overall report deadline across multiple page requests", async () => {
    let calls = 0;
    const client = new HttpGa4Client({
      propertyId: "properties/1",
      accessToken: "t",
      pageSize: 1,
      maxPages: 3,
      maxRows: 3,
      requestTimeoutMs: 1_000,
      reportTimeoutMs: 5,
      fetch: async () => {
        calls += 1;
        return calls === 1
          ? jsonResponse({ rows: [row("first")], rowCount: 2 })
          : delayedBodyFailureResponse("GA4 report deadline secret");
      },
    });

    await expect(client.runReport(REQ)).rejects.toMatchObject({
      code: "TIMEOUT",
    });
    expect(calls).toBe(2);
  });

  it("stops after one page when GA4 returns fewer rows than the page limit", async () => {
    let pages = 0;
    const fetchImpl: typeof fetch = async () => {
      pages += 1;
      return jsonResponse({ rows: [row("only")], rowCount: 1 });
    };
    const client = new HttpGa4Client({
      propertyId: "properties/1",
      accessToken: "t",
      fetch: fetchImpl,
    });
    const response = await client.runReport({ ...REQ, limit: 100 });
    expect(pages).toBe(1);
    expect(response.rowCount).toBe(1);
    expect(response.truncated).toBe(false);
  });

  it("attaches the Bearer access token", async () => {
    let authorization = "";
    const fetchImpl: typeof fetch = async (_input, init) => {
      authorization =
        (init?.headers as Record<string, string>).authorization ?? "";
      return jsonResponse({ rows: [], rowCount: 0 });
    };
    const client = new HttpGa4Client({
      propertyId: "properties/1",
      accessToken: "secret-token",
      fetch: fetchImpl,
    });
    await client.runReport(REQ);
    expect(authorization).toBe("Bearer secret-token");
  });

  it("maps 403 to PERMISSION_DENIED", async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({ error: "denied" }, 403);
    const client = new HttpGa4Client({
      propertyId: "properties/1",
      accessToken: "t",
      fetch: fetchImpl,
    });
    await expect(client.runReport(REQ)).rejects.toBeInstanceOf(SourceError);
    await expect(client.runReport(REQ)).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
  });

  it("maps 401 / 429 / 5xx and network failures to stable codes", async () => {
    const withStatus = (status: number): HttpGa4Client =>
      new HttpGa4Client({
        propertyId: "properties/1",
        accessToken: "t",
        fetch: async () => jsonResponse({}, status),
      });

    await expect(withStatus(401).runReport(REQ)).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
    await expect(withStatus(429).runReport(REQ)).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    await expect(withStatus(500).runReport(REQ)).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });

    const throwing = new HttpGa4Client({
      propertyId: "properties/1",
      accessToken: "t",
      fetch: async () => {
        throw new Error("boom");
      },
    });
    await expect(throwing.runReport(REQ)).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
  });

  it("bounds each provider request with an internal timeout", async () => {
    const client = new HttpGa4Client({
      propertyId: "properties/1",
      accessToken: "t",
      fetch: hungFetch(),
      requestTimeoutMs: 5,
    });

    await expect(client.runReport(REQ)).rejects.toMatchObject({
      code: "TIMEOUT",
    });
  });

  it("times out after headers when an injected response body never completes", async () => {
    const leakedStreamError = "GA4 body stream secret";
    const client = new HttpGa4Client({
      propertyId: "properties/1",
      accessToken: "t",
      fetch: async () => delayedBodyFailureResponse(leakedStreamError),
      requestTimeoutMs: 5,
    });

    const error = await client.runReport(REQ).catch((value: unknown) => value);

    expect(error).toMatchObject({ code: "TIMEOUT" });
    expect((error as Error).message).not.toContain(leakedStreamError);
  });

  it("combines a call abort signal with the internal timeout", async () => {
    const controller = new AbortController();
    const client = new HttpGa4Client({
      propertyId: "properties/1",
      accessToken: "t",
      fetch: hungFetch(),
      requestTimeoutMs: 30_000,
    });

    const pending = client.runReport(REQ, controller.signal);
    controller.abort(new DOMException("caller stopped", "AbortError"));

    await expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("rejects an oversized streamed body even when Content-Length under-reports it", async () => {
    const tracked = trackedStreamResponse({
      body: JSON.stringify({ rows: [], padding: "x".repeat(128) }),
      contentLength: 1,
    });
    const client = new HttpGa4Client({
      propertyId: "properties/1",
      accessToken: "t",
      fetch: async () => tracked.response,
      maxResponseBytes: 64,
    });

    await expect(client.runReport(REQ)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    expect(tracked.wasCancelled()).toBe(true);
  });

  it("cancels a non-success response body before mapping the status", async () => {
    const tracked = trackedStreamResponse({ body: "provider prose", status: 429 });
    const client = new HttpGa4Client({
      propertyId: "properties/1",
      accessToken: "t",
      fetch: async () => tracked.response,
    });

    await expect(client.runReport(REQ)).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    expect(tracked.wasCancelled()).toBe(true);
  });

  it("checkCompatibility flags an incompatible metric", async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({
        dimensionCompatibilities: [
          {
            dimensionMetadata: { apiName: "eventName" },
            compatibility: "COMPATIBLE",
          },
        ],
        metricCompatibilities: [
          {
            metricMetadata: { apiName: "keyEvents" },
            compatibility: "INCOMPATIBLE",
          },
        ],
      });
    const client = new HttpGa4Client({
      propertyId: "properties/1",
      accessToken: "t",
      fetch: fetchImpl,
    });

    const result = await client.checkCompatibility({
      dimensions: [{ name: "eventName" }],
      metrics: [{ name: "keyEvents" }],
    });
    expect(result.compatible).toBe(false);
    expect(result.incompatibleFields).toContain("keyEvents");
  });

  it("checkCompatibility returns compatible when all fields are COMPATIBLE", async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({
        dimensionCompatibilities: [
          {
            dimensionMetadata: { apiName: "eventName" },
            compatibility: "COMPATIBLE",
          },
        ],
        metricCompatibilities: [
          {
            metricMetadata: { apiName: "keyEvents" },
            compatibility: "COMPATIBLE",
          },
        ],
      });
    const client = new HttpGa4Client({
      propertyId: "properties/1",
      accessToken: "t",
      fetch: fetchImpl,
    });
    const result = await client.checkCompatibility({
      dimensions: [],
      metrics: [{ name: "keyEvents" }],
    });
    expect(result.compatible).toBe(true);
    expect(result.incompatibleFields).toHaveLength(0);
  });
});
