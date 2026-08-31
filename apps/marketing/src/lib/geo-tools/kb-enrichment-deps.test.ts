import { describe, expect, it, vi } from "vitest";
import { createGeoEnrichmentPageReader, createGeoEnrichmentQueryReader, DEFAULT_GEO_KB_ENRICHMENT_DEPENDENCIES } from "./kb-enrichment-deps.ts";

describe("actual enrichment runtime adapters", () => {
  it("wires the immutable receipt store instead of returning ephemeral evidence", () => {
    expect(DEFAULT_GEO_KB_ENRICHMENT_DEPENDENCIES.persistReceipt).toBeTypeOf("function");
  });
  it("requests only the bounded query dimension in the supplied 90-day window", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ rows: [{ keys: ["analytics query"], clicks: 1, impressions: 20, position: 4 }] }));
    const reader = createGeoEnrichmentQueryReader({ fetchImpl });
    const result = await reader({ property: "sc-domain:example.com", accessToken: "offline-token", window: { startDate: "2026-05-31", endDate: "2026-08-28" } });
    expect(result).toEqual({ queries: ["analytics query"], truncated: false });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("sc-domain%3Aexample.com/searchAnalytics/query");
    expect(JSON.parse(String(init.body))).toMatchObject({ dimensions: ["query"], startDate: "2026-05-31", endDate: "2026-08-28", rowLimit: 1000, startRow: 0, dataState: "final" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it("does not collapse malformed query rows into a complete empty query result", async () => {
    const reader = createGeoEnrichmentQueryReader({ fetchImpl: async () => Response.json({ rows: [{ keys: [] }] }) });
    await expect(reader({ property: "sc-domain:example.com", accessToken: "offline-token", window: { startDate: "2026-05-31", endDate: "2026-08-28" } })).rejects.toThrow();
  });
  it("gates public network, passes strict byte/time limits, and releases on failure", async () => {
    const release = vi.fn();
    const fetchResource = vi.fn(async () => { throw new Error("offline transport error"); });
    const reader = createGeoEnrichmentPageReader({ openGate: async () => ({ ok: true, kind: "crawl", release }), fetchResource, now: () => new Date("2026-08-31T00:00:00Z") });
    expect(await reader("https://example.com/", "192.0.2.1", 900)).toMatchObject({ kind: "unavailable", reason: "fetch_failed" });
    expect(fetchResource).toHaveBeenCalledWith("https://example.com/", expect.objectContaining({ timeoutMs: 900, maxBodyBytes: 524288, maxRedirects: 2, allowRedirect: expect.any(Function) }));
    expect(release).toHaveBeenCalledOnce();
  });
  it("never fetches if quota refuses and never extracts from a truncated body", async () => {
    const fetchResource = vi.fn();
    const refused = createGeoEnrichmentPageReader({ openGate: async () => ({ ok: false, response: new Response(null, { status: 429 }) }), fetchResource });
    expect(await refused("https://example.com/", "192.0.2.1", 1000)).toMatchObject({ kind: "unavailable", reason: "rate_limited" });
    expect(fetchResource).not.toHaveBeenCalled();
    const release = vi.fn();
    const partial = createGeoEnrichmentPageReader({ openGate: async () => ({ ok: true, kind: "crawl", release }), fetchResource: async () => ({ kind: "ok", requestedUrl: "https://example.com/", finalUrl: "https://example.com/", firstStatus: 200, finalStatus: 200, contentType: "text/html", body: "<h1>partial", bodyComplete: false, redirectChain: [], xRobotsTag: null, bytes: 11 }) });
    expect(await partial("https://example.com/", "192.0.2.1", 1000)).toMatchObject({ kind: "unavailable", reason: "partial_body" });
    expect(release).toHaveBeenCalledOnce();
  });
});
