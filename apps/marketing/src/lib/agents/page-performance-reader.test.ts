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
    expect(requested.searchParams.get("url")).toBe(TARGET);
    // Mobile, because that is the experience Google reports a site's Core Web
    // Vitals from — a desktop reading would pass sites that fail the
    // assessment that actually matters.
    expect(requested.searchParams.get("strategy")).toBe("mobile");
    expect(result?.formFactor).toBe("mobile");
  });

  it("rescales the CLS percentile CrUX reports times one hundred", async () => {
    const { read } = reader(() => fieldBody());
    const result = await read({ url: TARGET });

    expect(result?.cls).toBeCloseTo(0.05, 5);
    expect(result?.lcp).toBe(2_100);
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

    expect(result?.sourceLevel).toBe("origin");
    expect(result?.lcp).toBe(3_000);
  });

  it.each([
    ["a shared-quota 429", () => new Response("", { status: 429 })],
    ["a 5xx", () => new Response("", { status: 503 })],
    ["a body it cannot read", () => new Response("not json", { status: 200 })],
    ["no field data at all", () => Response.json({})],
  ])("answers %s with no data rather than a number", async (_label, respond) => {
    const { read } = reader(respond);

    // None of these is a fact about the audited page. A 429 is our shared
    // quota, and reporting it as the site's performance would attribute our
    // budget to them — the thing the crawl-waste checks already refuse to do.
    await expect(read({ url: TARGET })).resolves.toBeNull();
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
