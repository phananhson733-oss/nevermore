// @input  -- authenticated requests and controlled buffered crawler responses
// @output -- auth-order, projection, passthrough, and fail-closed API assertions
// @pos    -- focused tests for the shared SEO and Tech Agent request wrapper

import { describe, expect, it, vi } from "vitest";
import type { SeoAuditPayload, SeoAuditRecord } from "@sf/public-tools";
import {
  handleAgentAuditRequest,
  type AgentAuditHandlerDependencies,
} from "./audit-handler.ts";

function record(
  category: SeoAuditRecord["category"],
  state: SeoAuditRecord["state"],
): SeoAuditRecord {
  return {
    id: `${category}_check`,
    category,
    state,
    unit: "pages",
    tested: 2,
    affected: state === "observed" ? 1 : 0,
    observations:
      state === "observed"
        ? [
            {
              url: "https://acme.test/",
              values: [{ label: "sample", value: null }],
            },
          ]
        : [],
    limitation: state === "unverified" ? "Evidence was unavailable." : null,
  };
}

const upstreamPayload = {
  run: {
    tool: "seo_audit",
    schemaVersion: "seo_audit.sitewide.v3",
    mode: "public_preview",
    scope: "discoverable_same_origin_static_html_audit",
    persistence: "none",
    completedAt: "2026-08-12T09:00:00.000Z",
  },
  result: {
    targetUrl: "https://acme.test/",
    siteOrigin: "https://acme.test",
    scannedAt: "2026-08-12T09:00:00.000Z",
    coverage: {
      availability: "partial",
      pagesInspected: 2,
      linksObserved: 3,
      sitemapUrlsObserved: 1,
      urlsSkipped: 1,
      urlsBlocked: 0,
      urlsDisallowed: 0,
      urlsErrored: 1,
      stopReason: "page_budget",
    },
    siteResources: {
      robotsFetched: true,
      robotsGroupsObserved: 1,
      sitemapReferencesObserved: 1,
      sitemapFetched: false,
    },
    records: [
      record("crawl", "observed"),
      record("indexability", "not_observed"),
      record("metadata", "unverified"),
      record("structure", "observed"),
      record("links", "unverified"),
      record("structured_data", "not_observed"),
    ],
    pages: [],
  },
} satisfies SeoAuditPayload;

function request(accept = "application/json"): Request {
  return new Request("https://gengrowth.ai/api/agents/seo/audit", {
    method: "POST",
    headers: {
      accept,
      "content-type": "application/json",
      "x-real-ip": "203.0.113.9",
    },
    body: JSON.stringify({ url: "acme.test" }),
  });
}

function success(
  headers: Readonly<Record<string, string>> = {},
): Response {
  return Response.json(
    { data: upstreamPayload },
    { status: 200, headers },
  );
}

function dependencies(
  overrides: Partial<AgentAuditHandlerDependencies> = {},
): AgentAuditHandlerDependencies {
  return {
    authenticate: vi.fn(async () => "authenticated" as const),
    delegate: vi.fn(async () => success()),
    ...overrides,
  };
}

describe("handleAgentAuditRequest", () => {
  it("returns auth_required before reading the body or invoking the audit", async () => {
    const incoming = request();
    const delegate = vi.fn(async () => success());
    const response = await handleAgentAuditRequest(incoming, "seo", {
      authenticate: vi.fn(async () => "unauthenticated" as const),
      delegate,
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "auth_required" },
    });
    expect(incoming.bodyUsed).toBe(false);
    expect(delegate).not.toHaveBeenCalled();
  });

  it("reports unavailable authentication without claiming the visitor is signed out", async () => {
    const incoming = request();
    const delegate = vi.fn(async () => success());
    const response = await handleAgentAuditRequest(incoming, "tech", {
      authenticate: async () => {
        throw new Error("Supabase unavailable");
      },
      delegate,
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: { code: "auth_unavailable" },
    });
    expect(incoming.bodyUsed).toBe(false);
    expect(delegate).not.toHaveBeenCalled();
  });

  it("authenticates before delegating the original request instance", async () => {
    const order: string[] = [];
    const incoming = request("application/x-ndjson");
    const response = await handleAgentAuditRequest(
      incoming,
      "seo",
      {
        authenticate: async () => {
          order.push("auth");
          return "authenticated";
        },
        delegate: async (forwarded) => {
          order.push("delegate");
          expect(forwarded).toBe(incoming);
          expect(forwarded.headers.get("accept")).toBe(
            "application/x-ndjson",
          );
          expect(await forwarded.json()).toEqual({ url: "acme.test" });
          return success();
        },
      },
    );

    expect(response.status).toBe(200);
    expect(order).toEqual(["auth", "delegate"]);
  });

  it("projects the SEO categories and preserves evidence semantics", async () => {
    const response = await handleAgentAuditRequest(
      request(),
      "seo",
      dependencies(),
    );
    const body = await response.json();

    expect(body).toEqual({
      data: {
        run: {
          agent: "seo",
          mode: "authenticated_agent",
          persistence: "none",
          source: {
            tool: "seo_audit",
            schemaVersion: "seo_audit.sitewide.v3",
            completedAt: "2026-08-12T09:00:00.000Z",
            cache: { status: "miss", capturedAt: null },
          },
        },
        result: {
          targetUrl: upstreamPayload.result.targetUrl,
          siteOrigin: upstreamPayload.result.siteOrigin,
          scannedAt: upstreamPayload.result.scannedAt,
          coverage: upstreamPayload.result.coverage,
          siteResources: upstreamPayload.result.siteResources,
          records: [
            upstreamPayload.result.records[2],
            upstreamPayload.result.records[3],
            upstreamPayload.result.records[5],
          ],
        },
      },
    });
    expect("pages" in body.data.result).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(
      /"(?:score|priority|impact|opportunities)"/,
    );
  });

  it("rebuilds nested evidence objects from only public contract fields", async () => {
    const observedRecord = upstreamPayload.result.records[3];
    const upstream = Response.json({
      data: {
        ...upstreamPayload,
        result: {
          ...upstreamPayload.result,
          coverage: {
            ...upstreamPayload.result.coverage,
            debug: { requestId: "private-coverage-id" },
          },
          siteResources: {
            ...upstreamPayload.result.siteResources,
            internal: { robotsBody: "private robots body" },
          },
          records: [
            {
              ...observedRecord,
              pages: [{ html: "private page source" }],
              observations: observedRecord.observations.map((observation) => ({
                ...observation,
                secret: "private observation metadata",
                values: observation.values.map((entry) => ({
                  ...entry,
                  raw: "private raw measurement",
                })),
              })),
            },
          ],
        },
      },
    });

    const response = await handleAgentAuditRequest(
      request(),
      "seo",
      dependencies({ delegate: async () => upstream }),
    );
    const body = await response.json();

    expect(body.data.result).toEqual({
      targetUrl: upstreamPayload.result.targetUrl,
      siteOrigin: upstreamPayload.result.siteOrigin,
      scannedAt: upstreamPayload.result.scannedAt,
      coverage: upstreamPayload.result.coverage,
      siteResources: upstreamPayload.result.siteResources,
      records: [observedRecord],
    });
    expect(JSON.stringify(body)).not.toContain("private");
  });

  it("isolates the Tech categories", async () => {
    const response = await handleAgentAuditRequest(
      request(),
      "tech",
      dependencies(),
    );
    const body = await response.json();

    expect(
      body.data.result.records.map((entry: SeoAuditRecord) => entry.category),
    ).toEqual(["crawl", "indexability", "links"]);
    expect(body.data.result.records.map((entry: SeoAuditRecord) => entry.state)).toEqual([
      "observed",
      "not_observed",
      "unverified",
    ]);
  });

  it("rebuilds a known upstream error and copies only safe retry headers", async () => {
    const upstream = Response.json(
      { error: { code: "robots_disallowed" } },
      {
        status: 422,
        headers: {
          "retry-after": "5",
          "x-ratelimit-limit": "12",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "1786525200",
          "set-cookie": "private_session=secret",
          "x-debug-id": "private-request-id",
          "x-upstream-marker": "private-marker",
          "content-length": "999999",
        },
      },
    );
    const response = await handleAgentAuditRequest(
      request(),
      "seo",
      dependencies({ delegate: async () => upstream }),
    );

    expect(response).not.toBe(upstream);
    expect(response.status).toBe(422);
    expect(response.headers.get("retry-after")).toBe("5");
    expect(response.headers.get("x-ratelimit-limit")).toBe("12");
    expect(response.headers.get("x-ratelimit-remaining")).toBe("0");
    expect(response.headers.get("x-ratelimit-reset")).toBe("1786525200");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-debug-id")).toBeNull();
    expect(response.headers.get("x-upstream-marker")).toBeNull();
    expect(response.headers.get("content-length")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    await expect(response.json()).resolves.toEqual({
      error: { code: "robots_disallowed" },
    });
  });

  it.each([
    [
      "non-JSON transport",
      new Response(JSON.stringify({ error: { code: "robots_disallowed" } }), {
        status: 422,
        headers: { "content-type": "text/plain", "retry-after": "5" },
      }),
    ],
    [
      "unknown code",
      Response.json({ error: { code: "private_backend_failure" } }, { status: 502 }),
    ],
    [
      "extra private fields",
      Response.json(
        {
          error: {
            code: "robots_disallowed",
            debug: "private stack trace",
          },
        },
        { status: 422 },
      ),
    ],
    [
      "code/status mismatch",
      Response.json({ error: { code: "robots_disallowed" } }, { status: 500 }),
    ],
    [
      "oversized JSON",
      new Response(
        `${JSON.stringify({ error: { code: "robots_disallowed" } })}${" ".repeat(5_000)}`,
        {
          status: 422,
          headers: { "content-type": "application/json" },
        },
      ),
    ],
  ])("fails closed for a malformed upstream error: %s", async (_label, upstream) => {
    const response = await handleAgentAuditRequest(
      request(),
      "seo",
      dependencies({ delegate: async () => upstream }),
    );

    expect(response.status).toBe(502);
    expect(response.headers.get("retry-after")).toBeNull();
    await expect(response.json()).resolves.toEqual({
      error: { code: "audit_response_invalid" },
    });
  });

  it("preserves cache headers and records their provenance", async () => {
    const response = await handleAgentAuditRequest(
      request(),
      "seo",
      dependencies({
        delegate: async () =>
          success({
            "X-Crawl-Cache": "hit",
            "X-Crawl-Captured-At": "2026-08-12T08:30:00.000Z",
          }),
      }),
    );
    const body = await response.json();

    expect(response.headers.get("x-crawl-cache")).toBe("hit");
    expect(response.headers.get("x-crawl-captured-at")).toBe(
      "2026-08-12T08:30:00.000Z",
    );
    expect(body.data.run.source.cache).toEqual({
      status: "hit",
      capturedAt: "2026-08-12T08:30:00.000Z",
    });
  });

  it("forces an explicit cache miss to carry null capture provenance", async () => {
    const response = await handleAgentAuditRequest(
      request(),
      "seo",
      dependencies({
        delegate: async () => success({ "X-Crawl-Cache": "miss" }),
      }),
    );
    const body = await response.json();

    expect(body.data.run.source.cache).toEqual({
      status: "miss",
      capturedAt: null,
    });
    expect(response.headers.get("x-crawl-cache")).toBe("miss");
    expect(response.headers.get("x-crawl-captured-at")).toBeNull();
  });

  it.each([
    [
      "cache hit without capturedAt",
      success({ "X-Crawl-Cache": "hit" }),
    ],
    [
      "cache hit with an invalid capturedAt",
      success({
        "X-Crawl-Cache": "hit",
        "X-Crawl-Captured-At": "yesterday",
      }),
    ],
    [
      "cache miss with capturedAt",
      success({
        "X-Crawl-Cache": "miss",
        "X-Crawl-Captured-At": "2026-08-12T08:30:00.000Z",
      }),
    ],
    [
      "implicit cache miss with capturedAt",
      success({ "X-Crawl-Captured-At": "2026-08-12T08:30:00.000Z" }),
    ],
    [
      "unknown cache status",
      success({ "X-Crawl-Cache": "stale" }),
    ],
  ])("fails closed for invalid cache provenance: %s", async (_label, upstream) => {
    const response = await handleAgentAuditRequest(
      request(),
      "tech",
      dependencies({ delegate: async () => upstream }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: { code: "audit_response_invalid" },
    });
  });

  it.each([
    ["completedAt", "not-a-timestamp"],
    ["completedAt", "2026-08-12T09:00:00Z"],
    ["scannedAt", "2026-02-30T09:00:00.000Z"],
    ["scannedAt", "2026-08-12T09:00:00.000+00:00"],
  ] as const)(
    "fails closed for a non-canonical %s provenance timestamp",
    async (field, invalidTimestamp) => {
      const payload = structuredClone(upstreamPayload);
      if (field === "completedAt") payload.run.completedAt = invalidTimestamp;
      else payload.result.scannedAt = invalidTimestamp;
      const upstream = Response.json({ data: payload });

      const response = await handleAgentAuditRequest(
        request(),
        "seo",
        dependencies({ delegate: async () => upstream }),
      );

      expect(response.status).toBe(502);
      await expect(response.json()).resolves.toEqual({
        error: { code: "audit_response_invalid" },
      });
    },
  );

  it("does not reuse the upstream body's content length", async () => {
    const response = await handleAgentAuditRequest(
      request(),
      "seo",
      dependencies({
        delegate: async () => success({ "Content-Length": "999999" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBeNull();
  });

  it("does not copy private upstream headers on a successful projection", async () => {
    const response = await handleAgentAuditRequest(
      request(),
      "seo",
      dependencies({
        delegate: async () =>
          success({
            "set-cookie": "private_session=secret",
            "x-debug-id": "private-request-id",
          }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-debug-id")).toBeNull();
  });

  it.each([
    ["invalid JSON", new Response("not json", { status: 200 })],
    ["invalid shape", Response.json({ data: { nope: true } })],
    [
      "wrong crawl schema",
      Response.json({
        data: {
          ...upstreamPayload,
          run: {
            ...upstreamPayload.run,
            schemaVersion: "seo_audit.sitewide.v4",
          },
        },
      }),
    ],
    [
      "wrong crawl scope",
      Response.json({
        data: {
          ...upstreamPayload,
          run: { ...upstreamPayload.run, scope: "unbounded_web_crawl" },
        },
      }),
    ],
    [
      "NDJSON transport",
      new Response(`${JSON.stringify({ data: upstreamPayload })}\n`, {
        status: 200,
        headers: { "content-type": "application/x-ndjson" },
      }),
    ],
  ])("fails closed for a malformed 200 response: %s", async (_label, upstream) => {
    const response = await handleAgentAuditRequest(
      request(),
      "tech",
      dependencies({ delegate: async () => upstream }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: { code: "audit_response_invalid" },
    });
  });
});
