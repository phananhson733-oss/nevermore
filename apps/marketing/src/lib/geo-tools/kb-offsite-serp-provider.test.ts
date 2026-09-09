import { describe, expect, it, vi } from "vitest";

import { createGeoOffsiteSerpFetch } from "./kb-offsite-serp-provider.ts";

const ROW = {
  rankGroup: 3,
  domain: "g2.com",
  sitelinkCount: 2,
  title: "Acme Reviews",
  url: "https://www.g2.com/products/acme/reviews",
};
const RESPONSE = {
  keyword: "acme reviews",
  rows: [ROW],
  itemTypes: ["organic", "ai_overview"],
  aiOverview: { text: "Acme is a chart tool." },
  communityItems: null,
  unresolvedItemCount: 4,
  costUsd: 0.0031,
  providerStatusCode: 20_000,
  taskStatusCode: 20_000,
};

describe("GEO off-site SERP provider", () => {
  it("passes the request through unchanged and hands back rank, domain, title, url and price", async () => {
    const serpOrganic = vi.fn(async (_request: unknown, _signal?: unknown) => RESPONSE);
    const fetch = createGeoOffsiteSerpFetch({ client: { serpOrganic } as never });

    const result = await fetch({ keyword: "acme reviews", locationCode: 2_840, languageCode: "en", depth: 7 });

    expect(serpOrganic).toHaveBeenCalledTimes(1);
    // Exactly the four fields the request carries. A depth this adapter chose
    // for itself would buy a different page than the reader budgeted for.
    expect(serpOrganic.mock.calls[0]![0]).toEqual({
      keyword: "acme reviews",
      locationCode: 2_840,
      languageCode: "en",
      depth: 7,
    });
    expect(result).toEqual({
      rows: [{ rankGroup: 3, domain: "g2.com", title: "Acme Reviews", url: "https://www.g2.com/products/acme/reviews" }],
      costUsd: 0.0031,
    });
  });

  it("carries nothing the off-site judgement does not read", async () => {
    const fetch = createGeoOffsiteSerpFetch({ client: { serpOrganic: async () => RESPONSE } as never });

    const result = await fetch({ keyword: "acme", locationCode: 2_840, languageCode: "en", depth: 7 });

    // `sitelinkCount`, `itemTypes`, `aiOverview` and `unresolvedItemCount` are
    // all present on the provider response and all dropped: independence is
    // decided from rank, domain, title and URL, and a field nothing reads is a
    // field that gets read wrongly later.
    const row = result.rows[0]! as unknown as Record<string, unknown>;
    expect(Object.keys(row).sort()).toEqual(["domain", "rankGroup", "title", "url"]);
    expect(Object.keys(result).sort()).toEqual(["costUsd", "rows"]);
  });

  it("lets a provider failure reach the reader, which turns it into an unavailable query", async () => {
    const fetch = createGeoOffsiteSerpFetch({
      client: { serpOrganic: async () => { throw new Error("provider down"); } } as never,
    });

    // Deliberately not caught here. `readGeoOffsiteSerp` answers a rejection
    // with `status: "unavailable"` and a reason; an adapter that swallowed it
    // and returned `rows: []` would report "we searched and found nothing".
    await expect(fetch({ keyword: "acme", locationCode: 2_840, languageCode: "en", depth: 7 }))
      .rejects.toThrow("provider down");
  });

  it("passes the caller's abort signal down to the provider", async () => {
    const serpOrganic = vi.fn(async (_request: unknown, _signal?: unknown) => RESPONSE);
    const controller = new AbortController();
    const fetch = createGeoOffsiteSerpFetch({ client: { serpOrganic } as never, signal: controller.signal });

    await fetch({ keyword: "acme", locationCode: 2_840, languageCode: "en", depth: 7 });

    expect(serpOrganic.mock.calls[0]![1]).toBe(controller.signal);
  });
});
