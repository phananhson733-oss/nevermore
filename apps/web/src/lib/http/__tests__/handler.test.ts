import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { ProblemError } from "@sf/observability";
import { apiRouteTemplate, route } from "@/lib/http/handler";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("route unexpected-error logging", () => {
  it("logs only stable failure metadata, never arbitrary error content", async () => {
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const wrapped = route(() => {
      throw new Error("customer-content-secret");
    });

    const response = await wrapped(
      new NextRequest("http://localhost/api/mvp/projects"),
    );

    expect(response.status).toBe(500);
    const logged = stderr.mock.calls.map(([line]) => String(line)).join("");
    expect(logged).not.toContain("customer-content-secret");
    expect(logged).toContain('"event":"unhandled_error"');
    expect(logged).toContain('"code":"INTERNAL_ERROR"');
    expect(logged).toContain('"type":"internal"');
    const completed = stdout.mock.calls.map(([line]) => String(line)).join("");
    expect(completed).toContain('"event":"http_request_completed"');
    expect(completed).toContain('"statusCode":500');
  });

  it("maps a hostile getPrototypeOf trap to a generic 500 without a secondary throw", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    let prototypeReads = 0;
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          prototypeReads += 1;
          throw new Error("hostile-handler-prototype-marker");
        },
      },
    );
    const wrapped = route(() => {
      throw hostile;
    });

    const response = await wrapped(
      new NextRequest("http://localhost/api/mvp/projects"),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      code: "INTERNAL_ERROR",
      detail: "An unexpected error occurred.",
    });
    expect(prototypeReads).toBe(1);
    const logged = stderr.mock.calls.map(([line]) => String(line)).join("");
    expect(logged).toContain('"type":"unknown"');
    expect(logged).not.toContain("hostile-handler-prototype-marker");
  });

  it("falls back to a generic 500 when a proxied ProblemError has hostile fields", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const hostile = new Proxy(
      new ProblemError("BAD_REQUEST", "safe-detail"),
      {
        get(target, property, receiver) {
          if (property === "message") {
            throw new Error("hostile-problem-field-marker");
          }
          return Reflect.get(target, property, receiver);
        },
      },
    );
    const wrapped = route(() => {
      throw hostile;
    });

    const response = await wrapped(
      new NextRequest("http://localhost/api/mvp/projects"),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      code: "INTERNAL_ERROR",
      detail: "An unexpected error occurred.",
    });
    const logged = stderr.mock.calls.map(([line]) => String(line)).join("");
    expect(logged).not.toContain("hostile-problem-field-marker");
  });
});

describe("HTTP request completion metrics", () => {
  it("records success status, a stable route template, method, request id, and raw latency", async () => {
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const wrapped = route((_request, ctx) =>
      NextResponse.json(
        { data: { ok: true } },
        { status: 201, headers: { "X-Request-Id": ctx.requestId } },
      ),
    );

    const response = await wrapped(
      new NextRequest(
        "http://localhost/api/mvp/projects/018f1552-d1f7-7a31-8f06-e6bd84bbd123/actions/018f1552-d1f7-7a31-8f06-e6bd84bbd124/artifacts?token=customer-secret",
        { method: "POST" },
      ),
    );

    expect(response.status).toBe(201);
    const lines = stdout.mock.calls.map(([line]) => String(line));
    expect(lines).toHaveLength(1);
    const metric = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(metric).toMatchObject({
      event: "http_request_completed",
      method: "POST",
      route:
        "/api/mvp/projects/:projectId/actions/:actionId/artifacts",
      statusCode: 201,
      service: "web",
    });
    expect(metric["requestId"]).toEqual(expect.any(String));
    expect(metric["durationMs"]).toEqual(expect.any(Number));
    expect(metric["durationMs"]).toBeGreaterThanOrEqual(0);
    expect(lines.join("")).not.toContain("customer-secret");
    expect(lines.join("")).not.toContain("018f1552-d1f7");
  });

  it("records a handled ProblemError exactly once", async () => {
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const wrapped = route(() => {
      throw new ProblemError("BAD_REQUEST", "safe detail");
    });

    const response = await wrapped(
      new NextRequest("http://localhost/api/mvp/projects"),
    );

    expect(response.status).toBe(400);
    const lines = stdout.mock.calls.map(([line]) => String(line));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      event: "http_request_completed",
      method: "GET",
      route: "/api/mvp/projects",
      statusCode: 400,
    });
  });

  it("never reflects malformed or unknown path segments into the route field", () => {
    expect(
      apiRouteTemplate(
        "https://example.test/app/api/mvp/projects/customer-secret/actions/another-secret",
      ),
    ).toBe("/api/mvp/projects/:projectId/actions/:actionId");
    expect(
      apiRouteTemplate(
        "https://example.test/api/mvp/not-a-route/customer-secret?token=hidden",
      ),
    ).toBe("/api/mvp/:unknown");
    expect(apiRouteTemplate("not a URL customer-secret")).toBe(
      "/api/mvp/:unknown",
    );
  });
});
