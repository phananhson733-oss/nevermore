import { describe, expect, it } from "vitest";
import { HttpGscClient } from "./client.ts";
import type { FetchLike } from "./client.ts";
import { SourceError } from "../adapter.ts";

interface ApiRow {
  readonly keys: readonly [string, string, string];
  readonly clicks: number;
  readonly impressions: number;
  readonly ctr: number;
  readonly position: number;
}

interface CapturedCall {
  readonly url: string;
  readonly authorization: string | undefined;
  readonly body: {
    readonly startDate: string;
    readonly endDate: string;
    readonly dimensions: readonly string[];
    readonly dataState: string;
    readonly rowLimit: number;
    readonly startRow: number;
  };
}

function apiRow(index: number): ApiRow {
  return {
    keys: [`2026-07-01`, `https://example.com/p${index}`, `q${index}`],
    clicks: index,
    impressions: index * 10,
    ctr: 0.1,
    position: index + 1,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
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

function hungFetch(): FetchLike {
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

/** A fetch fixture that serves `pages` in order (a missing page = empty rows). */
function servePages(pages: readonly (readonly ApiRow[])[]): {
  readonly fetchImpl: FetchLike;
  readonly calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  let call = 0;
  const fetchImpl: FetchLike = async (url, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      url,
      authorization: headers["Authorization"],
      body: JSON.parse(init?.body as string) as CapturedCall["body"],
    });
    const page = pages[call] ?? [];
    call += 1;
    return jsonResponse({ rows: page });
  };
  return { fetchImpl, calls };
}

const QUERY = { startDate: "2026-05-21", endDate: "2026-07-15" } as const;

describe("HttpGscClient.querySearchAnalytics", () => {
  it("sends the spec request shape and maps rows, dropping ctr", async () => {
    const { fetchImpl, calls } = servePages([[apiRow(1)]]);
    const client = new HttpGscClient({
      siteUrl: "https://example.com/",
      accessToken: "tok-123",
      fetchImpl,
      rowLimit: 2,
    });

    const rows = await client.querySearchAnalytics(QUERY);

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe(
      "https://www.googleapis.com/webmasters/v3/sites/https%3A%2F%2Fexample.com%2F/searchAnalytics/query",
    );
    expect(call.authorization).toBe("Bearer tok-123");
    expect(call.body.dimensions).toEqual(["date", "page", "query"]);
    expect(call.body.dataState).toBe("final");
    expect(call.body.rowLimit).toBe(2);
    expect(call.body.startRow).toBe(0);
    expect(call.body.startDate).toBe("2026-05-21");
    expect(call.body.endDate).toBe("2026-07-15");

    expect(rows).toEqual([
      { date: "2026-07-01", page: "https://example.com/p1", query: "q1", clicks: 1, impressions: 10, position: 2 },
    ]);
  });

  it("paginates by startRow and stops on the first empty page", async () => {
    const { fetchImpl, calls } = servePages([[apiRow(1), apiRow(2)], []]);
    const client = new HttpGscClient({
      siteUrl: "https://example.com/",
      accessToken: "tok",
      fetchImpl,
      rowLimit: 2,
    });

    const rows = await client.querySearchAnalytics(QUERY);

    expect(rows).toHaveLength(2);
    expect(calls.map((c) => c.body.startRow)).toEqual([0, 2]);
  });

  it("stops immediately when a page returns fewer than rowLimit rows", async () => {
    const { fetchImpl, calls } = servePages([[apiRow(1)]]);
    const client = new HttpGscClient({
      siteUrl: "https://example.com/",
      accessToken: "tok",
      fetchImpl,
      rowLimit: 2,
    });

    await client.querySearchAnalytics(QUERY);
    expect(calls).toHaveLength(1);
  });

  it("halts at the maxRows cap instead of paging forever", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return jsonResponse({ rows: [apiRow(1), apiRow(2)] }); // always a full page
    };
    const client = new HttpGscClient({
      siteUrl: "https://example.com/",
      accessToken: "tok",
      fetchImpl,
      rowLimit: 2,
      maxRows: 4,
    });

    const rows = await client.querySearchAnalytics(QUERY);
    expect(rows).toHaveLength(4);
    expect(calls).toBe(2);
  });

  it("maps HTTP status codes to stable SourceError codes", async () => {
    const cases: readonly [number, string][] = [
      [401, "AUTH_REQUIRED"],
      [403, "PERMISSION_DENIED"],
      [429, "RATE_LIMITED"],
      [500, "UNAVAILABLE"],
    ];
    for (const [status, code] of cases) {
      const fetchImpl: FetchLike = async () => jsonResponse({ error: "x" }, status);
      const client = new HttpGscClient({ siteUrl: "https://example.com/", accessToken: "tok", fetchImpl });
      const error = await client.querySearchAnalytics(QUERY).catch((e: unknown) => e);
      expect(error, `status ${status}`).toBeInstanceOf(SourceError);
      expect((error as SourceError).code, `status ${status}`).toBe(code);
    }
  });

  it("maps a fetch transport failure to NETWORK_ERROR", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error("connection reset");
    };
    const client = new HttpGscClient({ siteUrl: "https://example.com/", accessToken: "tok", fetchImpl });
    const error = await client.querySearchAnalytics(QUERY).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SourceError);
    expect((error as SourceError).code).toBe("NETWORK_ERROR");
  });

  it("bounds each provider request with an internal timeout", async () => {
    const client = new HttpGscClient({
      siteUrl: "https://example.com/",
      accessToken: "tok",
      fetchImpl: hungFetch(),
      requestTimeoutMs: 5,
    });

    await expect(client.querySearchAnalytics(QUERY)).rejects.toMatchObject({
      code: "TIMEOUT",
    });
  });

  it("times out after headers when an injected response body never completes", async () => {
    const leakedStreamError = "GSC body stream secret";
    const client = new HttpGscClient({
      siteUrl: "https://example.com/",
      accessToken: "tok",
      fetchImpl: async () => delayedBodyFailureResponse(leakedStreamError),
      requestTimeoutMs: 5,
    });

    const error = await client.querySearchAnalytics(QUERY).catch(
      (value: unknown) => value,
    );

    expect(error).toMatchObject({ code: "TIMEOUT" });
    expect((error as Error).message).not.toContain(leakedStreamError);
  });

  it("combines an external abort signal with the internal timeout", async () => {
    const controller = new AbortController();
    const client = new HttpGscClient({
      siteUrl: "https://example.com/",
      accessToken: "tok",
      fetchImpl: hungFetch(),
      requestTimeoutMs: 30_000,
      signal: controller.signal,
    });

    const pending = client.querySearchAnalytics(QUERY);
    controller.abort(new DOMException("caller stopped", "AbortError"));

    await expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("rejects an oversized declared body before reading and cancels it", async () => {
    const tracked = trackedStreamResponse({
      body: JSON.stringify({ rows: [] }),
      contentLength: 1_024,
    });
    const client = new HttpGscClient({
      siteUrl: "https://example.com/",
      accessToken: "tok",
      fetchImpl: async () => tracked.response,
      maxResponseBytes: 64,
    });

    await expect(client.querySearchAnalytics(QUERY)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    expect(tracked.wasCancelled()).toBe(true);
  });

  it("counts streamed bytes instead of trusting an under-reported Content-Length", async () => {
    const tracked = trackedStreamResponse({
      body: JSON.stringify({ rows: [], padding: "x".repeat(128) }),
      contentLength: 1,
    });
    const client = new HttpGscClient({
      siteUrl: "https://example.com/",
      accessToken: "tok",
      fetchImpl: async () => tracked.response,
      maxResponseBytes: 64,
    });

    await expect(client.querySearchAnalytics(QUERY)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    expect(tracked.wasCancelled()).toBe(true);
  });

  it("cancels a non-success response body before mapping the status", async () => {
    const tracked = trackedStreamResponse({ body: "provider prose", status: 403 });
    const client = new HttpGscClient({
      siteUrl: "https://example.com/",
      accessToken: "tok",
      fetchImpl: async () => tracked.response,
    });

    await expect(client.querySearchAnalytics(QUERY)).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    expect(tracked.wasCancelled()).toBe(true);
  });

  it("rejects a malformed response body as INVALID_RESPONSE", async () => {
    const fetchImpl: FetchLike = async () => jsonResponse({ rows: [{ keys: ["only-one"], clicks: 1, impressions: 1, position: 1 }] });
    const client = new HttpGscClient({ siteUrl: "https://example.com/", accessToken: "tok", fetchImpl });
    const error = await client.querySearchAnalytics(QUERY).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SourceError);
    expect((error as SourceError).code).toBe("INVALID_RESPONSE");
  });
});
