import { describe, expect, it, vi } from "vitest";
import { createGeoEnrichmentPageReader, createGeoEnrichmentQueryReader, createGeoKnowledgeResourceReader, DEFAULT_GEO_KB_ENRICHMENT_DEPENDENCIES } from "./kb-enrichment-deps.ts";

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

  it("reads knowledge resources through the crawl gate with hard byte, time, and redirect bounds", async () => {
    const release = vi.fn();
    const fetchResource = vi.fn(async () => ({ kind: "ok" as const, requestedUrl: "https://example.com/", finalUrl: "https://example.com/about", firstStatus: 301, finalStatus: 200,
      contentType: "text/html; charset=utf-8", xRobotsTag: null, body: "<h1>About</h1>", bytes: 14, bodyComplete: true, redirectChain: ["https://example.com/about"] }));
    const reader = createGeoKnowledgeResourceReader("owner-1", { openGate: async () => ({ ok: true, kind: "crawl", release }), fetchResource,
      now: () => new Date("2026-09-04T07:11:15.461Z") });

    await expect(reader({ url: "https://example.com/", expected: "html", timeoutMs: 60_000 })).resolves.toEqual({
      kind: "ok", url: "https://example.com/about", contentType: "text/html; charset=utf-8", body: "<h1>About</h1>", observedAt: "2026-09-04T07:11:15.461Z",
    });
    expect(fetchResource).toHaveBeenCalledWith("https://example.com/", expect.objectContaining({ timeoutMs: 8_000, maxBodyBytes: 512 * 1024, maxRedirects: 2, allowRedirect: expect.any(Function) }));
    const options = (fetchResource.mock.calls[0] as unknown as [string, { readonly allowRedirect?: (from: string, to: string) => boolean }])[1];
    expect(options).not.toHaveProperty("credentials");
    expect(options.allowRedirect?.("https://example.com/", "https://example.com/about")).toBe(true);
    expect(options.allowRedirect?.("https://example.com/", "http://example.com/about")).toBe(false);
    expect(options.allowRedirect?.("https://example.com/", "https://www.example.com/about")).toBe(false);
    expect(release).toHaveBeenCalledOnce();
  });

  it("rejects malformed and unsafe redirect callback inputs without dispatching another hop", async () => {
    const fetchResource = vi.fn(async () => ({ kind: "error" as const, code: "network" as const }));
    const reader = createGeoKnowledgeResourceReader("owner-1", { openGate: async () => ({ ok: true, kind: "crawl", release: vi.fn() }), fetchResource });
    await reader({ url: "https://example.com/" });
    const options = (fetchResource.mock.calls[0] as unknown as [string, { readonly allowRedirect?: (from: string, to: string) => boolean }])[1];
    const allowRedirect = options.allowRedirect;
    expect(allowRedirect).toBeTypeOf("function");
    expect(allowRedirect?.("not a URL", "https://example.com/about")).toBe(false);
    expect(allowRedirect?.("https://example.com/", "not a URL")).toBe(false);
    expect(allowRedirect?.("https://example.com/", "https://other.example/about")).toBe(false);
    expect(allowRedirect?.("https://example.com/", "http://example.com/about")).toBe(false);
    expect(allowRedirect?.("https://example.com/", "https://example.com/about")).toBe(true);
  });

  it("blocks a malformed request URL before gate admission or public transport", async () => {
    const openGate = vi.fn(), fetchResource = vi.fn();
    const reader = createGeoKnowledgeResourceReader("owner-1", { openGate, fetchResource });
    await expect(reader({ url: "not a URL", expected: "html" })).resolves.toEqual({ kind: "unavailable", url: "not a URL", reason: "blocked" });
    expect(openGate).not.toHaveBeenCalled();
    expect(fetchResource).not.toHaveBeenCalled();
  });

  it("fails closed when crawl admission throws and remembers that same-host denial", async () => {
    const openGate = vi.fn(async () => { throw new Error("offline quota detail"); }), fetchResource = vi.fn();
    const reader = createGeoKnowledgeResourceReader("owner-1", { openGate, fetchResource });
    await expect(reader({ url: "https://example.com/" })).resolves.toEqual({ kind: "unavailable", url: "https://example.com/", reason: "fetch_failed" });
    await expect(reader({ url: "https://example.com/about" })).resolves.toEqual({ kind: "unavailable", url: "https://example.com/about", reason: "fetch_failed" });
    expect(openGate).toHaveBeenCalledOnce();
    expect(fetchResource).not.toHaveBeenCalled();
  });

  it.each([[400, "blocked"], [409, "rate_limited"], [429, "rate_limited"], [500, "fetch_failed"]] as const)("maps crawl admission HTTP %s to %s without fetching", async (status, reason) => {
    const fetchResource = vi.fn();
    const reader = createGeoKnowledgeResourceReader("owner-1", { openGate: async () => ({ ok: false, response: new Response(null, { status }) }), fetchResource });
    await expect(reader({ url: "https://example.com/" })).resolves.toEqual({ kind: "unavailable", url: "https://example.com/", reason });
    expect(fetchResource).not.toHaveBeenCalled();
  });

  it("rejects an admitted non-crawl cache and reuses that denial for the same host", async () => {
    const release = vi.fn(), fetchResource = vi.fn();
    const openGate = vi.fn(async () => ({ ok: true as const, kind: "cached" as const, payload: { body: "untrusted cache shape" }, capturedAt: "2026-09-04T07:11:15.461Z", release }));
    const reader = createGeoKnowledgeResourceReader("owner-1", { openGate, fetchResource });
    await expect(reader({ url: "https://example.com/" })).resolves.toEqual({ kind: "unavailable", url: "https://example.com/", reason: "fetch_failed" });
    await expect(reader({ url: "https://example.com/about" })).resolves.toEqual({ kind: "unavailable", url: "https://example.com/about", reason: "fetch_failed" });
    expect(openGate).toHaveBeenCalledOnce();
    expect(fetchResource).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });

  it("consumes crawl admission once per host for one bounded evidence collection", async () => {
    const releases: Array<ReturnType<typeof vi.fn>> = [];
    const openGate = vi.fn(async (_clientKey: string, _url: string) => {
      const release = vi.fn(); releases.push(release);
      return { ok: true as const, kind: "crawl" as const, release };
    });
    const fetchResource = vi.fn(async (url: string) => ({ kind: "ok" as const, requestedUrl: url, finalUrl: url, firstStatus: 200, finalStatus: 200,
      contentType: "text/plain", xRobotsTag: null, body: "bounded", bytes: 7, bodyComplete: true, redirectChain: [] }));
    const reader = createGeoKnowledgeResourceReader("owner-1", { openGate, fetchResource });

    await reader({ url: "https://example.com/" });
    await reader({ url: "https://example.com/robots.txt" });
    await reader({ url: "https://rival.example/" });

    expect(openGate.mock.calls.map(([, url]) => url)).toEqual(["https://example.com/", "https://rival.example/"]);
    expect(fetchResource).toHaveBeenCalledTimes(3);
    expect(releases).toHaveLength(2);
    for (const release of releases) expect(release).toHaveBeenCalledOnce();
  });

  it("consumes one admission for an apex host and its www sibling", async () => {
    // `openCrawlGate` budgets both against the same target key, so admitting
    // them separately spends a site's hourly allowance twice for one origin
    // family -- and `planGeoEvidenceReuse` promises one opening per gate key,
    // which is only true if the reader agrees about what a gate key is.
    const openGate = vi.fn(async (_clientKey: string, _url: string) => ({ ok: true as const, kind: "crawl" as const, release: vi.fn() }));
    const fetchResource = vi.fn(async (url: string) => ({ kind: "ok" as const, requestedUrl: url, finalUrl: url, firstStatus: 200, finalStatus: 200,
      contentType: "text/plain", xRobotsTag: null, body: "bounded", bytes: 7, bodyComplete: true, redirectChain: [] }));
    const reader = createGeoKnowledgeResourceReader("owner-1", { openGate, fetchResource });

    await reader({ url: "https://www.example.com/" });
    await reader({ url: "https://example.com/pricing" });

    expect(openGate.mock.calls.map(([, url]) => url)).toEqual(["https://www.example.com/"]);
    expect(fetchResource).toHaveBeenCalledTimes(2);
  });

  it.each([
    [{ kind: "error", code: "timeout" } as const, "timeout"],
    [{ kind: "error", code: "blocked" } as const, "blocked"],
    [{ kind: "error", code: "cross_origin" } as const, "blocked"],
    [{ kind: "error", code: "invalid_redirect" } as const, "blocked"],
    [{ kind: "error", code: "network" } as const, "fetch_failed"],
    [{ kind: "error", code: "redirect_limit" } as const, "fetch_failed"],
  ])("maps public transport outcome %j to %s", async (transport, reason) => {
    const release = vi.fn();
    const reader = createGeoKnowledgeResourceReader("owner-1", { openGate: async () => ({ ok: true, kind: "crawl", release }), fetchResource: async () => transport });
    await expect(reader({ url: "https://example.com/", expected: "html", timeoutMs: 500 })).resolves.toEqual({ kind: "unavailable", url: "https://example.com/", reason });
    expect(release).toHaveBeenCalledOnce();
  });

  it.each([
    [206, "partial_body"], [404, "not_found"], [410, "not_found"], [408, "timeout"], [504, "timeout"], [401, "blocked"], [403, "blocked"], [429, "rate_limited"], [500, "fetch_failed"],
  ] as const)("maps HTTP %s to %s", async (status, reason) => {
    const reader = createGeoKnowledgeResourceReader("owner-1", { openGate: async () => ({ ok: true, kind: "crawl", release: vi.fn() }), fetchResource: async () => ({
      kind: "ok", requestedUrl: "https://example.com/", finalUrl: "https://example.com/", firstStatus: status, finalStatus: status, contentType: "text/html", xRobotsTag: null,
      body: "error", bytes: 5, bodyComplete: true, redirectChain: [],
    }) });
    await expect(reader({ url: "https://example.com/", expected: "html" })).resolves.toEqual({ kind: "unavailable", url: "https://example.com/", reason });
  });

  it("fails closed on admission refusal, incomplete bodies, missing content type, and thrown transports", async () => {
    const fetchResource = vi.fn();
    const denied = createGeoKnowledgeResourceReader("owner-1", { openGate: async () => ({ ok: false, response: new Response(null, { status: 429 }) }), fetchResource });
    await expect(denied({ url: "https://example.com/" })).resolves.toEqual({ kind: "unavailable", url: "https://example.com/", reason: "rate_limited" });
    expect(fetchResource).not.toHaveBeenCalled();

    for (const [bodyComplete, contentType, reason] of [[false, "text/html", "partial_body"], [true, null, "invalid_response"]] as const) {
      const release = vi.fn();
      const reader = createGeoKnowledgeResourceReader("owner-1", { openGate: async () => ({ ok: true, kind: "crawl", release }), fetchResource: async () => ({
        kind: "ok", requestedUrl: "https://example.com/", finalUrl: "https://example.com/", firstStatus: 200, finalStatus: 200, contentType, xRobotsTag: null,
        body: "<h1>bounded prefix</h1>", bytes: 23, bodyComplete, redirectChain: [],
      }) });
      await expect(reader({ url: "https://example.com/" })).resolves.toEqual({ kind: "unavailable", url: "https://example.com/", reason });
      expect(release).toHaveBeenCalledOnce();
    }

    const release = vi.fn();
    const thrown = createGeoKnowledgeResourceReader("owner-1", { openGate: async () => ({ ok: true, kind: "crawl", release }), fetchResource: async () => { throw new Error("secret transport detail"); } });
    await expect(thrown({ url: "https://example.com/" })).resolves.toEqual({ kind: "unavailable", url: "https://example.com/", reason: "fetch_failed" });
    expect(release).toHaveBeenCalledOnce();
  });
});
