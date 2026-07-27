import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { ProblemError } from "@sf/observability";
import {
  apiRouteTemplate,
  assertSameOriginMutation,
  route,
} from "@/lib/http/handler";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function mutationRequest(
  origin: string,
  overrides: Readonly<Record<string, string | null>> = {},
): NextRequest {
  const url = new URL(origin);
  const headers = new Headers({
    host: url.host,
    origin: url.origin,
    "sec-fetch-site": "same-origin",
  });
  for (const [name, value] of Object.entries(overrides)) {
    if (value === null) {
      headers.delete(name);
    } else {
      headers.set(name, value);
    }
  }
  return new NextRequest(`${url.origin}/api/mvp/projects/project-id/audit/urls`, {
    method: "PATCH",
    headers,
  });
}

describe("mutation origin enforcement", () => {
  it.each([
    ["development", "http://localhost:3112", "http://127.0.0.1:3112"],
    ["development", "http://localhost:3112", "http://[::1]:3112"],
    ["development", "http://127.0.0.1:3112", "http://localhost:3112"],
    ["test", "http://[::1]:3112", "http://127.0.0.1:3112"],
  ])(
    "in %s, treats %s and %s as the same loopback origin",
    (nodeEnv, configuredOrigin, requestOrigin) => {
      vi.stubEnv("NODE_ENV", nodeEnv);
      vi.stubEnv("APP_ORIGIN", configuredOrigin);

      expect(() =>
        assertSameOriginMutation(mutationRequest(requestOrigin)),
      ).not.toThrow();
    },
  );

  it("keeps exact APP_ORIGIN mutations valid in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ORIGIN", "https://app.example.test");

    expect(() =>
      assertSameOriginMutation(mutationRequest("https://app.example.test")),
    ).not.toThrow();
  });

  it.each([
    ["production", "a missing Origin", { origin: null }],
    [
      "production",
      "a missing Sec-Fetch-Site",
      { "sec-fetch-site": null },
    ],
    [
      "production",
      "both provenance headers missing",
      { origin: null, "sec-fetch-site": null },
    ],
    [
      "staging",
      "both provenance headers missing",
      { origin: null, "sec-fetch-site": null },
    ],
  ])("in %s, rejects %s", (nodeEnv, _label, headers) => {
    vi.stubEnv("NODE_ENV", nodeEnv);
    vi.stubEnv("APP_ORIGIN", "https://app.example.test");

    expect(() =>
      assertSameOriginMutation(
        mutationRequest("https://app.example.test", headers),
      ),
    ).toThrow("Cross-origin mutation is not allowed.");
  });

  it.each(["development", "test"])(
    "allows a headerless loopback CLI mutation in %s",
    (nodeEnv) => {
      vi.stubEnv("NODE_ENV", nodeEnv);
      vi.stubEnv("APP_ORIGIN", "http://localhost:3112");

      expect(() =>
        assertSameOriginMutation(
          mutationRequest("http://127.0.0.1:3112", {
            origin: null,
            "sec-fetch-site": null,
          }),
        ),
      ).not.toThrow();
    },
  );

  it("rejects a headerless CLI mutation for a non-loopback APP_ORIGIN in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_ORIGIN", "https://app.example.test");

    expect(() =>
      assertSameOriginMutation(
        mutationRequest("https://app.example.test", {
          origin: null,
          "sec-fetch-site": null,
        }),
      ),
    ).toThrow("Cross-origin mutation is not allowed.");
  });

  it.each(["production", "staging"])(
    "rejects loopback aliases when NODE_ENV is %s",
    (nodeEnv) => {
      vi.stubEnv("NODE_ENV", nodeEnv);
      vi.stubEnv("APP_ORIGIN", "http://localhost:3112");

      expect(() =>
        assertSameOriginMutation(
          mutationRequest("http://127.0.0.1:3112"),
        ),
      ).toThrow("Cross-origin mutation is not allowed.");
    },
  );

  it.each([
    ["a non-loopback request URL", "http://attacker.test:3112", {}],
    [
      "a forged Host header",
      "http://127.0.0.1:3112",
      { host: "localhost.attacker.test:3112" },
    ],
    [
      "a forged Origin header",
      "http://127.0.0.1:3112",
      { origin: "http://localhost.attacker.test:3112" },
    ],
    [
      "a userinfo-shaped Origin header",
      "http://127.0.0.1:3112",
      { origin: "http://localhost:3112@attacker.test" },
    ],
    [
      "a cross-site Fetch Metadata header",
      "http://127.0.0.1:3112",
      { "sec-fetch-site": "cross-site" },
    ],
  ])("rejects %s in development", (_label, requestOrigin, headers) => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_ORIGIN", "http://localhost:3112");

    expect(() =>
      assertSameOriginMutation(mutationRequest(requestOrigin, headers)),
    ).toThrow("Cross-origin mutation is not allowed.");
  });

  it.each([
    ["a different port", "http://127.0.0.1:3113"],
    ["a different scheme", "https://127.0.0.1:3112"],
  ])("rejects %s between loopback aliases", (_label, requestOrigin) => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("APP_ORIGIN", "http://localhost:3112");

    expect(() =>
      assertSameOriginMutation(mutationRequest(requestOrigin)),
    ).toThrow("Cross-origin mutation is not allowed.");
  });

  it("does not let a loopback request substitute for a non-loopback APP_ORIGIN", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_ORIGIN", "http://app.example.test:3112");

    expect(() =>
      assertSameOriginMutation(mutationRequest("http://127.0.0.1:3112")),
    ).toThrow("Cross-origin mutation is not allowed.");
  });
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

  it("recognizes every Product Profile route without logging customer ids", () => {
    const prefix =
      "https://example.test/api/mvp/projects/018f1552-d1f7-7000-8000-000000000001/product-profile";
    expect(apiRouteTemplate(prefix)).toBe(
      "/api/mvp/projects/:projectId/product-profile",
    );
    expect(apiRouteTemplate(`${prefix}/synthesis-runs`)).toBe(
      "/api/mvp/projects/:projectId/product-profile/synthesis-runs",
    );
    expect(apiRouteTemplate(`${prefix}/competitors`)).toBe(
      "/api/mvp/projects/:projectId/product-profile/competitors",
    );
    expect(apiRouteTemplate(`${prefix}/confirm`)).toBe(
      "/api/mvp/projects/:projectId/product-profile/confirm",
    );
    expect(
      apiRouteTemplate(`${prefix}/competitors/customer-secret-candidate`),
    ).toBe(
      "/api/mvp/projects/:projectId/product-profile/competitors/:candidateId",
    );
    expect(apiRouteTemplate(`${prefix}/customer-secret`)).toBe(
      "/api/mvp/:unknown",
    );
  });

  it("recognizes Growth Map URL reads without logging the selected SitePage id", () => {
    const prefix =
      "https://example.test/api/mvp/projects/customer-project/audit/urls";

    expect(apiRouteTemplate(prefix)).toBe(
      "/api/mvp/projects/:projectId/audit/urls",
    );
    expect(apiRouteTemplate(`${prefix}/customer-secret-site-page`)).toBe(
      "/api/mvp/projects/:projectId/audit/urls/:sitePageId",
    );
    expect(
      apiRouteTemplate(`${prefix}/customer-secret-site-page/evidence`),
    ).toBe("/api/mvp/:unknown");
  });

  it("recognizes Keyword Library reads without logging the selected Keyword id", () => {
    const prefix =
      "https://example.test/api/mvp/projects/customer-project/audit/keywords";

    expect(apiRouteTemplate(prefix)).toBe(
      "/api/mvp/projects/:projectId/audit/keywords",
    );
    expect(apiRouteTemplate(`${prefix}/customer-secret-keyword`)).toBe(
      "/api/mvp/projects/:projectId/audit/keywords/:keywordId",
    );
    expect(apiRouteTemplate(`${prefix}/customer-secret-keyword/history`)).toBe(
      "/api/mvp/:unknown",
    );
  });

  it("recognizes Competitor Library reads without logging the selected Competitor id", () => {
    const prefix =
      "https://example.test/api/mvp/projects/customer-project/audit/competitors";

    expect(apiRouteTemplate(prefix)).toBe(
      "/api/mvp/projects/:projectId/audit/competitors",
    );
    expect(apiRouteTemplate(`${prefix}/customer-secret-competitor`)).toBe(
      "/api/mvp/projects/:projectId/audit/competitors/:competitorId",
    );
    expect(
      apiRouteTemplate(`${prefix}/customer-secret-competitor/history`),
    ).toBe("/api/mvp/:unknown");
  });

  it("recognizes governed approval and delivery routes without logging customer ids", () => {
    const project =
      "https://example.test/api/mvp/projects/customer-secret-project";

    expect(
      apiRouteTemplate(
        `${project}/artifacts/customer-secret-artifact/approval`,
      ),
    ).toBe(
      "/api/mvp/projects/:projectId/artifacts/:artifactId/approval",
    );

    const connections = `${project}/delivery-connections`;
    expect(apiRouteTemplate(connections)).toBe(
      "/api/mvp/projects/:projectId/delivery-connections",
    );
    expect(apiRouteTemplate(`${connections}/readiness`)).toBe(
      "/api/mvp/projects/:projectId/delivery-connections/readiness",
    );
    expect(
      apiRouteTemplate(`${connections}/customer-secret-destination`),
    ).toBe(
      "/api/mvp/projects/:projectId/delivery-connections/:destinationRef",
    );
    expect(
      apiRouteTemplate(
        `${connections}/customer-secret-destination/revoke`,
      ),
    ).toBe(
      "/api/mvp/projects/:projectId/delivery-connections/:destinationRef/revoke",
    );
    expect(
      apiRouteTemplate(`${connections}/authorization-grants/github`),
    ).toBe(
      "/api/mvp/projects/:projectId/delivery-connections/authorization-grants/github",
    );
    expect(
      apiRouteTemplate(`${connections}/authorization-grants/wordpress`),
    ).toBe(
      "/api/mvp/projects/:projectId/delivery-connections/authorization-grants/wordpress",
    );
    expect(
      apiRouteTemplate(
        `${connections}/authorization-grants/customer-secret-grant/revoke`,
      ),
    ).toBe(
      "/api/mvp/projects/:projectId/delivery-connections/authorization-grants/:grantId/revoke",
    );

    expect(
      apiRouteTemplate(`${connections}/customer-secret/extra`),
    ).toBe("/api/mvp/:unknown");
    expect(
      apiRouteTemplate(
        `${connections}/authorization-grants/customer-secret-grant`,
      ),
    ).toBe("/api/mvp/:unknown");
  });
});
