import { describe, expect, it, vi } from "vitest";

import {
  buildDailyBriefing,
  createPublicToolError,
  type DailyBriefingEnvelope,
} from "@sf/public-tools";
import {
  MAX_BRAND_TERM_LENGTH,
  MAX_BRAND_TERMS,
  handleDailyBriefingRequest,
  type DailyBriefingHandlerDependencies,
} from "./daily-briefing-handler.ts";
import { REQUEST_BUDGET_MS } from "./daily-briefing-reader.ts";

const PROPERTY = "sc-domain:example.com";
const ACCESS_TOKEN = "test-access-token";

function completeDateRows() {
  const previous = [
    "2026-08-08",
    "2026-08-09",
    "2026-08-10",
    "2026-08-11",
    "2026-08-12",
    "2026-08-13",
    "2026-08-14",
  ];
  const current = [
    "2026-08-15",
    "2026-08-16",
    "2026-08-17",
    "2026-08-18",
    "2026-08-19",
    "2026-08-20",
    "2026-08-21",
  ];
  return [
    ...previous.map((date) => ({
      date,
      clicks: 10,
      impressions: 200,
      position: 8,
    })),
    ...current.map((date) => ({
      date,
      clicks: 12,
      impressions: 220,
      position: 7,
    })),
  ];
}

const ENVELOPE: DailyBriefingEnvelope = buildDailyBriefing({
  now: new Date("2026-08-24T20:00:00.000Z"),
  dateRows: completeDateRows(),
  currentQueryEvidence: null,
  previousQueryEvidence: null,
  brandTerms: [],
  brandTermsConfirmed: false,
});

function post(body: unknown, contentType = "application/json"): Request {
  return new Request("https://gengrowth.ai/api/tools/daily-search-briefing", {
    method: "POST",
    headers: { "content-type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function deps(
  overrides: Partial<DailyBriefingHandlerDependencies> = {},
): DailyBriefingHandlerDependencies {
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
    now: () => new Date("2026-08-24T20:00:00.000Z"),
    extractClientIp: () => "203.0.113.9",
    openGate: async () => ({
      ok: true,
      release: () => {},
      remaining: 8,
      limit: 10,
    }),
    ...overrides,
  };
}

describe("handleDailyBriefingRequest", () => {
  it("returns the envelope plus the shared remaining-run facts", async () => {
    const response = await handleDailyBriefingRequest(
      post({ property: PROPERTY }),
      deps(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: ENVELOPE,
      meta: { rateLimit: { remaining: 8, limit: 10 } },
    });
  });

  it("reports unknown remaining quota as null for a legacy injected gate shape", async () => {
    const response = await handleDailyBriefingRequest(
      post({ property: PROPERTY }),
      deps({
        openGate: async () => ({ ok: true, release: () => {} }),
      }),
    );

    await expect(response.json()).resolves.toEqual({
      data: ENVELOPE,
      meta: { rateLimit: { remaining: null, limit: 10 } },
    });
  });

  it("never caches a report about someone's own property", async () => {
    const response = await handleDailyBriefingRequest(
      post({ property: PROPERTY }),
      deps(),
    );

    expect(response.headers.get("Cache-Control")).toBe("no-store, private");
  });

  it("rejects a request with no property", async () => {
    const response = await handleDailyBriefingRequest(post({}), deps());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "invalid_request" },
    });
  });

  it("rejects a non-boolean brand confirmation flag", async () => {
    const response = await handleDailyBriefingRequest(
      post({ property: PROPERTY, brandTermsConfirmed: "yes" }),
      deps(),
    );

    expect(response.status).toBe(400);
  });

  it("drops blank brand terms and preserves explicit boolean confirmation", async () => {
    const runReport = vi.fn(async () => ENVELOPE);

    await handleDailyBriefingRequest(
      post({
        property: PROPERTY,
        brandTerms: ["  ", "Acme"],
        brandTermsConfirmed: true,
      }),
      deps({ runReport }),
    );

    expect(runReport).toHaveBeenCalledWith(
      expect.objectContaining({
        brandTerms: ["Acme"],
        brandTermsConfirmed: true,
      }),
    );

    await handleDailyBriefingRequest(
      post({
        property: PROPERTY,
        brandTerms: [],
        brandTermsConfirmed: true,
      }),
      deps({ runReport }),
    );

    expect(runReport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        brandTerms: [],
        brandTermsConfirmed: true,
      }),
    );
  });

  it("defaults brand-term confirmation to false", async () => {
    const runReport = vi.fn(async () => ENVELOPE);

    await handleDailyBriefingRequest(
      post({ property: PROPERTY, brandTerms: ["Acme"] }),
      deps({ runReport }),
    );

    expect(runReport).toHaveBeenCalledWith(
      expect.objectContaining({ brandTermsConfirmed: false }),
    );
  });

  it("rejects a body that exceeds the brand limits", async () => {
    const tooMany = Array.from({ length: MAX_BRAND_TERMS + 1 }, (_, index) =>
      `term ${index}`,
    );
    const tooLong = "x".repeat(MAX_BRAND_TERM_LENGTH + 1);

    await expect(
      handleDailyBriefingRequest(
        post({ property: PROPERTY, brandTerms: tooMany }),
        deps(),
      ),
    ).resolves.toMatchObject({ status: 400 });

    await expect(
      handleDailyBriefingRequest(
        post({ property: PROPERTY, brandTerms: [tooLong] }),
        deps(),
      ),
    ).resolves.toMatchObject({ status: 400 });
  });

  it("rejects unsupported media types, malformed JSON, and payloads over 4KB", async () => {
    const unsupported = await handleDailyBriefingRequest(
      post({ property: PROPERTY }, "text/plain"),
      deps(),
    );
    const malformed = await handleDailyBriefingRequest(post("{not json"), deps());
    const oversized = await handleDailyBriefingRequest(
      post(`{"property":"${PROPERTY}","padding":"${"x".repeat(4_096)}"}`),
      deps(),
    );

    expect(unsupported.status).toBe(415);
    await expect(unsupported.json()).resolves.toEqual({
      error: { code: "unsupported_media_type" },
    });
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toEqual({
      error: { code: "invalid_request" },
    });
    expect(oversized.status).toBe(413);
    await expect(oversized.json()).resolves.toEqual({
      error: { code: "payload_too_large" },
    });
  });

  it("rejects invalid property and brand-term field types", async () => {
    for (const body of [
      null,
      [],
      { property: 123 },
      { property: "   " },
      { property: PROPERTY, brandTerms: "Acme" },
      { property: PROPERTY, brandTerms: [123] },
      { property: PROPERTY, brandTermsConfirmed: 1 },
    ]) {
      const response = await handleDailyBriefingRequest(post(body), deps());
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: { code: "invalid_request" },
      });
    }
  });

  it("accepts unrelated fields without expanding the request contract", async () => {
    const runReport = vi.fn(async () => ENVELOPE);

    const response = await handleDailyBriefingRequest(
      post({ property: PROPERTY, ignored: "not forwarded" }),
      deps({ runReport }),
    );

    expect(response.status).toBe(200);
    expect(runReport).toHaveBeenCalledWith(
      expect.not.objectContaining({ ignored: expect.anything() }),
    );
  });

  it("returns 401 when no Google grant is in place", async () => {
    const openGate = vi.fn();
    const resolveGrant = vi.fn();
    const response = await handleDailyBriefingRequest(
      post({ property: PROPERTY }),
      deps({
        openGate: openGate as never,
        resolveGrant: resolveGrant as never,
        readSession: async () => ({
          properties: null,
          propertyTotal: 0,
          connectEnabled: true,
          consentNotice: "none",
        }),
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "gsc_unavailable" },
    });
    expect(openGate).not.toHaveBeenCalled();
    expect(resolveGrant).not.toHaveBeenCalled();
  });

  it("returns 404, not 403, for a property the grant does not cover", async () => {
    const openGate = vi.fn();
    const response = await handleDailyBriefingRequest(
      post({ property: "sc-domain:not-yours.com" }),
      deps({ openGate: openGate as never }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "gsc_unavailable" },
    });
    expect(openGate).not.toHaveBeenCalled();
  });

  it("makes no Google call at all when the gate refuses", async () => {
    const resolveGrant = vi.fn(async () => ({ kind: "none" }) as const);
    const response = await handleDailyBriefingRequest(
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

  it.each([409, 429, 503])(
    "forwards an admitted-gate refusal response with status %i unchanged",
    async (status) => {
      const refusal = Response.json(
        createPublicToolError(
          status === 409
            ? "scan_in_progress"
            : status === 429
              ? "rate_limited"
              : "quota_unavailable",
        ),
        {
          status,
          headers: {
            "Cache-Control": "no-store, private",
            "Retry-After": status === 409 ? "5" : "60",
          },
        },
      );

      const response = await handleDailyBriefingRequest(
        post({ property: PROPERTY }),
        deps({
          openGate: async () => ({ ok: false, response: refusal }),
        }),
      );

      expect(response).toBe(refusal);
    },
  );

  it("resolves the grant only after the gate has opened", async () => {
    const order: string[] = [];
    const resolveGrant = vi.fn(async () => {
      order.push("resolve");
      return {
        kind: "grant" as const,
        accessToken: ACCESS_TOKEN,
        properties: [PROPERTY],
        propertyTotal: 1,
      };
    });
    await handleDailyBriefingRequest(
      post({ property: PROPERTY }),
      deps({
        readSession: async () => {
          order.push("session");
          return {
            properties: [PROPERTY],
            propertyTotal: 1,
            connectEnabled: true,
            consentNotice: "none",
          };
        },
        openGate: async () => {
          order.push("gate");
          return {
            ok: true,
            release: () => order.push("release"),
            remaining: 7,
            limit: 10,
          };
        },
        resolveGrant,
        runReport: async () => {
          order.push("run");
          return ENVELOPE;
        },
      }),
    );

    expect(order).toEqual(["session", "gate", "resolve", "run", "release"]);
    expect(resolveGrant).toHaveBeenCalledTimes(1);
  });

  it("hands the freshly resolved token to the report", async () => {
    const runReport = vi.fn(async () => ENVELOPE);
    await handleDailyBriefingRequest(
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

  it("passes only normalized request data, the fresh token, and one live budget", async () => {
    const runReport = vi.fn(async () => ENVELOPE);

    await handleDailyBriefingRequest(
      post({
        property: `  ${PROPERTY}  `,
        brandTerms: ["  Acme  ", "   "],
        brandTermsConfirmed: true,
      }),
      deps({ runReport }),
    );

    expect(runReport).toHaveBeenCalledWith({
      property: PROPERTY,
      brandTerms: ["Acme"],
      brandTermsConfirmed: true,
      accessToken: ACCESS_TOKEN,
      remainingMs: expect.any(Function),
    });
  });

  it("starts the 45-second request clock before grant resolution", async () => {
    let clock = new Date("2026-08-24T20:00:00.000Z").getTime();
    let seen = Number.NaN;

    await handleDailyBriefingRequest(
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

    expect(seen).toBe(REQUEST_BUDGET_MS - 20_000);
  });

  it("charges gate latency to the same handler-level request clock", async () => {
    let clock = new Date("2026-08-24T20:00:00.000Z").getTime();
    let seen = Number.NaN;

    await handleDailyBriefingRequest(
      post({ property: PROPERTY }),
      deps({
        now: () => new Date(clock),
        openGate: async () => {
          clock += 15_000;
          return {
            ok: true,
            release: () => {},
            remaining: 8,
            limit: 10,
          };
        },
        resolveGrant: async () => {
          clock += 5_000;
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

    expect(seen).toBe(REQUEST_BUDGET_MS - 20_000);
  });

  it("starts the request clock before reading the bounded JSON body", async () => {
    let clock = new Date("2026-08-24T20:00:00.000Z").getTime();
    let sent = false;
    let seen = Number.NaN;
    const bytes = new TextEncoder().encode(JSON.stringify({ property: PROPERTY }));
    const request = {
      headers: new Headers({ "content-type": "application/json" }),
      body: {
        getReader: () => ({
          read: async () => {
            if (sent) return { done: true, value: undefined } as const;
            sent = true;
            clock += 5_000;
            return { done: false, value: bytes } as const;
          },
          cancel: async () => {},
          releaseLock: () => {},
        }),
      },
    } as unknown as Request;

    await handleDailyBriefingRequest(
      request,
      deps({
        now: () => new Date(clock),
        runReport: async ({ remainingMs }) => {
          seen = remainingMs();
          return ENVELOPE;
        },
      }),
    );

    expect(seen).toBe(REQUEST_BUDGET_MS - 5_000);
  });

  it("tells a revoked visitor to reconnect rather than that Google is down", async () => {
    const response = await handleDailyBriefingRequest(
      post({ property: PROPERTY }),
      deps({ resolveGrant: async () => ({ kind: "revoked" }) }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "gsc_revoked" },
    });
  });

  it("tells a visitor with no resolved grant to reconnect", async () => {
    const response = await handleDailyBriefingRequest(
      post({ property: PROPERTY }),
      deps({ resolveGrant: async () => ({ kind: "none" }) }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "gsc_revoked" },
    });
  });

  it("answers a momentary Google failure as temporary, with a retry hint", async () => {
    const response = await handleDailyBriefingRequest(
      post({ property: PROPERTY }),
      deps({ resolveGrant: async () => ({ kind: "unavailable" }) }),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("30");
    await expect(response.json()).resolves.toEqual({
      error: { code: "gsc_temporarily_unavailable" },
    });
  });

  it.each(["none", "revoked", "unavailable"] as const)(
    "releases the slot when the grant resolves as %s",
    async (kind) => {
      const release = vi.fn();
      await handleDailyBriefingRequest(
        post({ property: PROPERTY }),
        deps({
          openGate: async () => ({
            ok: true,
            release,
            remaining: 8,
            limit: 10,
          }),
          resolveGrant: async () => ({ kind }),
        }),
      );

      expect(release).toHaveBeenCalledTimes(1);
    },
  );

  it("refuses a property the resolved grant no longer covers", async () => {
    const release = vi.fn();
    const runReport = vi.fn(async () => ENVELOPE);
    const response = await handleDailyBriefingRequest(
      post({ property: PROPERTY }),
      deps({
        openGate: async () => ({
          ok: true,
          release,
          remaining: 8,
          limit: 10,
        }),
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
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("turns internal failures into a stable 502 without leaking secrets", async () => {
    const release = vi.fn();
    const response = await handleDailyBriefingRequest(
      post({ property: PROPERTY }),
      deps({
        openGate: async () => ({
          ok: true,
          release,
          remaining: 8,
          limit: 10,
        }),
        runReport: async () => {
          throw new Error(`upstream leaked ${ACCESS_TOKEN} private query`);
        },
      }),
    );

    expect(response.status).toBe(502);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      error: { code: "gsc_unavailable" },
    });
    expect(text).not.toContain(ACCESS_TOKEN);
    expect(text).not.toContain("private query");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("releases the admitted slot exactly once on a successful report", async () => {
    const release = vi.fn();

    const response = await handleDailyBriefingRequest(
      post({ property: PROPERTY }),
      deps({
        openGate: async () => ({
          ok: true,
          release,
          remaining: 8,
          limit: 10,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("releases the admitted slot when grant resolution itself throws", async () => {
    const release = vi.fn();

    const response = await handleDailyBriefingRequest(
      post({ property: PROPERTY }),
      deps({
        openGate: async () => ({
          ok: true,
          release,
          remaining: 8,
          limit: 10,
        }),
        resolveGrant: async () => {
          throw new Error(`refresh failed with ${ACCESS_TOKEN}`);
        },
      }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: { code: "gsc_unavailable" },
    });
    expect(release).toHaveBeenCalledTimes(1);
  });
});
