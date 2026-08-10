import { describe, expect, it, vi } from "vitest";

import type { QuickWinsEnvelope } from "@sf/public-tools";
import {
  MAX_BRAND_TERMS,
  MAX_BRAND_TERM_LENGTH,
  handleQuickWinsRequest,
  type QuickWinsHandlerDependencies,
} from "./quick-wins-handler.ts";
import { REQUEST_BUDGET_MS } from "./quick-wins-reader.ts";
import { createPublicToolError } from "@sf/public-tools";

const PROPERTY = "sc-domain:astrologywiki.com";

/**
 * A real envelope, not a cast.
 *
 * The previous fixture ended in `as unknown as QuickWinsEnvelope`, which meant
 * adding a required field to the result — `window` — type-checked here even
 * though the handler would now be returning a shape the client cannot render.
 * The fixture is the construction point that should fail when the contract
 * grows, so it has to satisfy the type honestly.
 */
const ENVELOPE: QuickWinsEnvelope = {
  run: {
    tool: "seo_quick_wins",
    schemaVersion: "seo_quick_wins.evidence.v2",
    scope: "property",
    mode: "public_preview",
    persistence: "none",
    completedAt: "2026-08-03T09:00:00.000Z",
  },
  result: {
    window: { startDate: "2026-07-06", endDate: "2026-08-02" },
    rows: [],
    actions: [],
    curve: {
      buckets: [],
      rowsUsed: 0,
      brandRowsExcluded: 0,
      rowsBeyondBands: 0,
    },
    lowCtrBands: [],
    excluded: {
      below_impression_floor: 0,
      position_outside_bands: 0,
      bucket_not_usable: 0,
      no_leave_one_out_baseline: 0,
    },
    anonymization: null,
    limitations: ["serp_cause_unobserved"],
    drafts: [],
    draftsSkipped: {},
  },
};

function post(body: unknown, contentType = "application/json"): Request {
  return new Request("https://gengrowth.ai/api/tools/quick-wins", {
    method: "POST",
    headers: { "content-type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const ACCESS_TOKEN = "test-access-token";

function deps(
  overrides: Partial<QuickWinsHandlerDependencies> = {},
): QuickWinsHandlerDependencies {
  return {
    readSession: async () => ({
      properties: [PROPERTY],
      propertyTotal: 1,
      connectEnabled: true,
      consentNotice: "none",
    }),
    resolveGrant: async () => ({
      kind: "grant",
      accessToken: ACCESS_TOKEN,
      properties: [PROPERTY],
      propertyTotal: 1,
    }),
    runReport: async () => ENVELOPE,
    now: () => new Date("2026-08-03T09:00:00.000Z"),
    extractClientIp: () => "203.0.113.9",
    openGate: async () => ({ ok: true, release: () => {} }),
    ...overrides,
  };
}

describe("handleQuickWinsRequest", () => {
  it("returns the envelope for a granted property", async () => {
    const response = await handleQuickWinsRequest(
      post({ property: PROPERTY }),
      deps(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: ENVELOPE });
  });

  it("never caches a report about someone's own property", async () => {
    const response = await handleQuickWinsRequest(
      post({ property: PROPERTY }),
      deps(),
    );

    expect(response.headers.get("Cache-Control")).toBe("no-store, private");
  });

  it("rejects a request with no property", async () => {
    const response = await handleQuickWinsRequest(post({}), deps());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "invalid_request" },
    });
  });

  it("returns 401 when no Google grant is in place", async () => {
    const response = await handleQuickWinsRequest(
      post({ property: PROPERTY }),
      deps({
        readSession: async () => ({
          properties: null,
          propertyTotal: 0,
          connectEnabled: true,
          consentNotice: "none",
        }),
      }),
    );

    expect(response.status).toBe(401);
  });

  it("returns 404, not 403, for a property the grant does not cover", async () => {
    // 403 would confirm that someone else's property exists.
    const response = await handleQuickWinsRequest(
      post({ property: "sc-domain:not-yours.com" }),
      deps(),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "gsc_unavailable" },
    });
  });

  it("makes no Google call at all when the gate refuses", async () => {
    // Resolving the grant can cost two outbound calls — the token endpoint and
    // the Search Console site list — and both are made with the shared OAuth
    // client against a per-PROJECT quota. Doing that before admission control
    // means one legitimate grant is enough to drive unlimited traffic through
    // this route with nothing in front of it.
    const resolveGrant = vi.fn(async () => ({ kind: "none" }) as const);
    const response = await handleQuickWinsRequest(
      post({ property: PROPERTY }),
      deps({
        resolveGrant,
        openGate: async () => ({
          ok: false,
          response: Response.json(createPublicToolError("rate_limited"), {
            status: 429,
          }),
        }),
      }),
    );

    expect(response.status).toBe(429);
    expect(resolveGrant).not.toHaveBeenCalled();
  });

  it("resolves the grant only after the gate has opened", async () => {
    const order: string[] = [];
    await handleQuickWinsRequest(
      post({ property: PROPERTY }),
      deps({
        openGate: async () => {
          order.push("gate");
          return { ok: true, release: () => order.push("release") };
        },
        resolveGrant: async () => {
          order.push("resolve");
          return {
            kind: "grant",
            accessToken: ACCESS_TOKEN,
            properties: [PROPERTY],
            propertyTotal: 1,
          };
        },
      }),
    );

    expect(order).toEqual(["gate", "resolve", "release"]);
  });

  it("hands the freshly resolved token to the report", async () => {
    // The token is resolved per request and never stored, so the report has to
    // receive the one this resolution produced rather than one captured when
    // the route module was built.
    const runReport = vi.fn(async () => ENVELOPE);
    await handleQuickWinsRequest(
      post({ property: PROPERTY }),
      deps({
        runReport,
        resolveGrant: async () => ({
          kind: "grant",
          accessToken: "test-access-token-refreshed",
          properties: [PROPERTY],
          propertyTotal: 1,
        }),
      }),
    );

    expect(runReport).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "test-access-token-refreshed" }),
    );
  });

  it("tells a revoked visitor to reconnect rather than that Google is down", async () => {
    const response = await handleQuickWinsRequest(
      post({ property: PROPERTY }),
      deps({ resolveGrant: async () => ({ kind: "revoked" }) }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "gsc_revoked" },
    });
  });

  it("answers a momentary Google failure as temporary, with a retry hint", async () => {
    // A refresh that Google could not answer says nothing about the grant. A
    // 401 there sends a still-authorized visitor to the consent screen for a
    // blip, and the copy would tell them their connection is broken.
    const response = await handleQuickWinsRequest(
      post({ property: PROPERTY }),
      deps({ resolveGrant: async () => ({ kind: "unavailable" }) }),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("30");
    await expect(response.json()).resolves.toEqual({
      error: { code: "gsc_temporarily_unavailable" },
    });
  });

  it("releases the slot when the grant resolves to nothing usable", async () => {
    const release = vi.fn();
    await handleQuickWinsRequest(
      post({ property: PROPERTY }),
      deps({
        openGate: async () => ({ ok: true, release }),
        resolveGrant: async () => ({ kind: "revoked" }),
      }),
    );

    expect(release).toHaveBeenCalledTimes(1);
  });

  it("refuses a property the RESOLVED grant no longer covers", async () => {
    // The pre-gate check reads the page-scoped property cookie; the resolution
    // re-lists from Google. When they disagree the newer answer is the one we
    // are allowed to read with.
    const runReport = vi.fn(async () => ENVELOPE);
    const response = await handleQuickWinsRequest(
      post({ property: PROPERTY }),
      deps({
        runReport,
        resolveGrant: async () => ({
          kind: "grant",
          accessToken: ACCESS_TOKEN,
          properties: ["sc-domain:something-else.com"],
          propertyTotal: 1,
        }),
      }),
    );

    expect(response.status).toBe(404);
    expect(runReport).not.toHaveBeenCalled();
  });

  it("holds one Search Console read per client at a time", async () => {
    // Search Console quota is counted per GCP project, not per visitor: an
    // unbounded caller spends every other visitor's budget.
    const response = await handleQuickWinsRequest(
      post({ property: PROPERTY }),
      deps({
        openGate: async () => ({
          ok: false,
          response: Response.json(createPublicToolError("scan_in_progress"), {
            status: 409,
            headers: {
              "Retry-After": "5",
              "Cache-Control": "no-store, private",
            },
          }),
        }),
      }),
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("Retry-After")).toBe("5");
    await expect(response.json()).resolves.toEqual({
      error: { code: "scan_in_progress" },
    });
  });

  it("returns the gate's refusal without reading Search Console", async () => {
    // The gate fails closed when the durable quota store cannot answer: an
    // endpoint spending a shared upstream budget with no working limiter is
    // worse than one that is briefly unavailable.
    const runReport = vi.fn(async () => ENVELOPE);
    const response = await handleQuickWinsRequest(
      post({ property: PROPERTY }),
      deps({
        runReport,
        openGate: async () => ({
          ok: false,
          response: Response.json(createPublicToolError("quota_unavailable"), {
            status: 503,
          }),
        }),
      }),
    );

    expect(response.status).toBe(503);
    expect(runReport).not.toHaveBeenCalled();
  });

  it("returns 429 when the per-IP volume budget is spent", async () => {
    const response = await handleQuickWinsRequest(
      post({ property: PROPERTY }),
      deps({
        openGate: async () => ({
          ok: false,
          response: Response.json(createPublicToolError("rate_limited"), {
            status: 429,
            headers: { "Retry-After": "600" },
          }),
        }),
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("600");
  });

  it("releases the slot even when the report throws", async () => {
    const release = vi.fn();
    const response = await handleQuickWinsRequest(
      post({ property: PROPERTY }),
      deps({
        openGate: async () => ({ ok: true, release }),
        runReport: async () => {
          throw new Error("429");
        },
      }),
    );

    expect(response.status).toBe(502);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("never substitutes an estimate for data it could not read", async () => {
    const response = await handleQuickWinsRequest(
      post({ property: PROPERTY }),
      deps({
        runReport: async () => {
          throw new Error("upstream down");
        },
      }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: { code: "gsc_unavailable" },
    });
  });

  it("passes brand terms through to the report", async () => {
    const runReport = vi.fn(async () => ENVELOPE);
    await handleQuickWinsRequest(
      post({ property: PROPERTY, brandTerms: ["Acme", " acme corp "] }),
      deps({ runReport }),
    );

    expect(runReport).toHaveBeenCalledWith({
      property: PROPERTY,
      brandTerms: ["Acme", "acme corp"],
      accessToken: ACCESS_TOKEN,
      // The route's own clock, so the report cannot spend a budget the grant
      // resolution already ate into.
      remainingMs: expect.any(Function),
    });
  });

  it("drops blank brand terms rather than matching every query", async () => {
    const runReport = vi.fn(async () => ENVELOPE);
    await handleQuickWinsRequest(
      post({ property: PROPERTY, brandTerms: ["", "   ", "acme"] }),
      deps({ runReport }),
    );

    expect(runReport).toHaveBeenCalledWith({
      property: PROPERTY,
      brandTerms: ["acme"],
      accessToken: ACCESS_TOKEN,
      remainingMs: expect.any(Function),
    });
  });

  it("starts the request clock before the grant is resolved", async () => {
    // The budget used to start inside the report. Resolving a grant can
    // refresh an OAuth token and re-list properties — two provider round
    // trips — so a clock started after it hands a full budget to a request
    // that has already spent a third of the platform's limit, and the report
    // then overruns maxDuration. Overrunning costs the finished envelope, not
    // just the slow part of it.
    let clock = new Date("2026-08-03T09:00:00.000Z").getTime();
    let seen = Number.NaN;

    await handleQuickWinsRequest(
      post({ property: PROPERTY }),
      deps({
        now: () => new Date(clock),
        resolveGrant: async () => {
          clock += 20_000;
          return {
            kind: "grant",
            accessToken: ACCESS_TOKEN,
            properties: [PROPERTY],
            propertyTotal: 1,
          };
        },
        runReport: async ({ remainingMs }) => {
          seen = remainingMs();
          return ENVELOPE;
        },
      }),
    );

    // Whatever the budget is, the 20 seconds the grant took came out of it.
    expect(seen).toBeLessThanOrEqual(REQUEST_BUDGET_MS - 20_000);
  });

  it("rejects more brand terms than the cap", async () => {
    const response = await handleQuickWinsRequest(
      post({
        property: PROPERTY,
        brandTerms: Array.from(
          { length: MAX_BRAND_TERMS + 1 },
          (_, i) => `t${i}`,
        ),
      }),
      deps(),
    );

    expect(response.status).toBe(400);
  });

  it("rejects an over-long brand term", async () => {
    const response = await handleQuickWinsRequest(
      post({
        property: PROPERTY,
        brandTerms: ["x".repeat(MAX_BRAND_TERM_LENGTH + 1)],
      }),
      deps(),
    );

    expect(response.status).toBe(400);
  });

  it("rejects a non-array brandTerms", async () => {
    const response = await handleQuickWinsRequest(
      post({ property: PROPERTY, brandTerms: "acme" }),
      deps(),
    );

    expect(response.status).toBe(400);
  });

  it("rejects a non-JSON content type", async () => {
    const response = await handleQuickWinsRequest(
      post({ property: PROPERTY }, "text/plain"),
      deps(),
    );

    expect(response.status).toBe(415);
  });

  it("does not read Search Console before the grant check passes", async () => {
    // An ungranted caller must not be able to make us spend project quota.
    const runReport = vi.fn(async () => ENVELOPE);
    await handleQuickWinsRequest(
      post({ property: "sc-domain:not-yours.com" }),
      deps({ runReport }),
    );

    expect(runReport).not.toHaveBeenCalled();
  });
});
