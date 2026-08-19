// @input  -- a stubbed PageSpeed Insights endpoint
// @output -- proof of what is asked for, and that every failure is "no data"
// @pos    -- unit coverage for the only place the audit calls PageSpeed

import { describe, expect, it, vi } from "vitest";

import { createPagePerformanceReader } from "./page-performance-reader.ts";

const TARGET = "https://acme.test/p";

function reader(
  respond: (url: string) => Response,
  apiKey = "test-key",
) {
  const fetchImpl = vi.fn(async (input: string, _init?: RequestInit) =>
    respond(String(input)),
  );
  return {
    fetchImpl,
    read: createPagePerformanceReader({
      apiKey,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }),
  };
}

function fieldBody(overrides: Record<string, unknown> = {}) {
  return Response.json({
    loadingExperience: {
      metrics: {
        LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2_100 },
        INTERACTION_TO_NEXT_PAINT: { percentile: 150 },
        CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 5 },
        EXPERIMENTAL_TIME_TO_FIRST_BYTE: { percentile: 600 },
      },
    },
    ...overrides,
  });
}

describe("createPagePerformanceReader", () => {
  it("asks for the mobile field data of exactly the URL it was given", async () => {
    const { fetchImpl, read } = reader(() => fieldBody());
    const result = await read({ url: TARGET });

    const requested = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(result.status).toBe("ok");
    expect(requested.searchParams.get("url")).toBe(TARGET);
    // Mobile, because that is the experience Google reports a site's Core Web
    // Vitals from — a desktop reading would pass sites that fail the
    // assessment that actually matters.
    expect(requested.searchParams.get("strategy")).toBe("mobile");
    expect(result.status === "ok" && result.field.formFactor).toBe("mobile");
  });

  it("rescales the CLS percentile CrUX reports times one hundred", async () => {
    const { read } = reader(() => fieldBody());
    const result = await read({ url: TARGET });

    expect(result.status === "ok" && result.field.cls).toBeCloseTo(0.05, 5);
    expect(result.status === "ok" && result.field.lcp).toBe(2_100);
  });

  it("falls back to origin data and says that is what it did", async () => {
    const { read } = reader(() =>
      Response.json({
        loadingExperience: { metrics: {} },
        originLoadingExperience: {
          metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 3_000 } },
        },
      }),
    );
    const result = await read({ url: TARGET });

    expect(result.status === "ok" && result.field.sourceLevel).toBe("origin");
    expect(result.status === "ok" && result.field.lcp).toBe(3_000);
  });

  it.each([
    // Only the last of these is a fact about the audited page. A live call on
    // 2026-08-19 proved the configured key was invalid, and the first version
    // of this reader answered that with the same null it uses for "CrUX has no
    // data" — so the product told visitors something about their site's
    // traffic that it had never observed.
    [
      "a rejected key",
      () => new Response("", { status: 400 }),
      "provider_rejected_credentials",
    ],
    [
      "a forbidden key",
      () => new Response("", { status: 403 }),
      "provider_rejected_credentials",
    ],
    [
      "a spent quota",
      () => new Response("", { status: 429 }),
      "provider_quota_exhausted",
    ],
    ["a 5xx", () => new Response("", { status: 503 }), "provider_unavailable"],
    [
      "a body it cannot read",
      () => new Response("not json", { status: 200 }),
      "provider_unavailable",
    ],
    ["CrUX publishing nothing", () => Response.json({}), "no_field_data"],
  ])("tells %s apart from the others", async (_label, respond, reason) => {
    const { read } = reader(respond);
    const result = await read({ url: TARGET });

    expect(result.status).toBe("unavailable");
    expect(result.status === "unavailable" && result.reason).toBe(reason);
  });

  it("keeps the key out of anything but the query it must ride in", async () => {
    const { fetchImpl, read } = reader(() => fieldBody(), "secret-key");
    await read({ url: TARGET });

    const [, init] = fetchImpl.mock.calls[0] ?? [];
    // PageSpeed only accepts the key as a query parameter, so it cannot be
    // moved to a header; what it must not do is also appear in one.
    expect(JSON.stringify(init ?? {})).not.toContain("secret-key");
  });
});
