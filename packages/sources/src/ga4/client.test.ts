import { describe, expect, it } from "vitest";
import { SourceError } from "../adapter.ts";
import { HttpGa4Client, type Ga4RunReportRequest } from "./client.ts";

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
