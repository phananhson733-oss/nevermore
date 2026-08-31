import { describe, expect, it, vi } from "vitest";
import { emptyGeoKbPayload } from "./kb-contract.ts";
import { handleGeoKbEnrichment, type GeoKbEnrichmentDependencies } from "./kb-enrichment-handler.ts";

const KB = "c80c5f1d-5a0e-4d14-a6a5-e75bc66ca4a6";
const AT = "2026-08-31T12:00:00.000Z";
const ASSET = { kbId: KB, targetHost: "example.com", draftVersion: 4, profileReference: null,
  payload: { ...emptyGeoKbPayload("https://example.com"), competitors: [{ domain: "rival.example", brandName: "", confirmed: false }] },
};
function dependencies(overrides: Partial<GeoKbEnrichmentDependencies> = {}): GeoKbEnrichmentDependencies {
  return {
    authenticate: vi.fn(async () => ({ status: "authenticated" as const, userId: "account-a", email: null, avatarUrl: null, googleSubject: "google-a" })),
    readIdentity: vi.fn(async () => ({ sub: "google-a" })),
    readAsset: vi.fn(async () => ({ kind: "ok" as const, value: ASSET })),
    readGscSession: vi.fn(async () => ({ properties: ["sc-domain:example.com"] })),
    openGscGate: vi.fn(async () => ({ ok: true as const, release: vi.fn() })),
    resolveGrant: vi.fn(async () => ({ kind: "grant" as const, accessToken: "test-provider-token", properties: ["sc-domain:example.com"], propertyTotal: 1 })),
    readQueries: vi.fn(async () => ({ queries: ["analytics price", "analytics comparison"], truncated: false })),
    fetchPage: vi.fn(async (url) => ({ kind: "ok" as const, url, body: '<meta property="og:site_name" content="Actual Rival">', observedAt: AT })),
    persistReceipt: vi.fn(async () => ({ kind: "ok" as const })),
    now: () => new Date(AT), newId: () => "b920cd2e-c645-4df6-a80e-4f434dd09266",
    clientIp: () => "192.0.2.1", ...overrides,
  };
}
function request(body: unknown = { kbId: KB }, origin = "https://gengrowth.ai"): Request {
  return new Request("https://gengrowth.ai/api/tools/geo-knowledge-base/enrich", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });
}

describe("GEO enrichment admission and evidence receipt", () => {
  it("rejects Google-subject mismatch before private reads, quota, grant, or network", async () => {
    const deps = dependencies({ readIdentity: async () => ({ sub: "google-b" }) });
    const response = await handleGeoKbEnrichment(request(), deps);
    expect(response.status).toBe(401);
    for (const call of [deps.readAsset, deps.openGscGate, deps.resolveGrant, deps.fetchPage, deps.readQueries]) expect(call).not.toHaveBeenCalled();
  });
  it("refuses anonymous, foreign KB, client property/URL, and cross-origin requests", async () => {
    const anonymous = dependencies({ authenticate: async () => ({ status: "unauthenticated" }) });
    expect((await handleGeoKbEnrichment(request(), anonymous)).status).toBe(401);
    expect(anonymous.readAsset).not.toHaveBeenCalled();
    const foreign = dependencies({ readAsset: async () => ({ kind: "missing" }) });
    expect((await handleGeoKbEnrichment(request(), foreign)).status).toBe(404);
    expect(foreign.readQueries).not.toHaveBeenCalled();
    const deps = dependencies();
    expect((await handleGeoKbEnrichment(request({ kbId: KB, property: "sc-domain:private.test" }), deps)).status).toBe(400);
    expect((await handleGeoKbEnrichment(request({ kbId: KB }, "https://attacker.test"), deps)).status).toBe(403);
    expect(deps.readAsset).not.toHaveBeenCalled();
  });
  it("stays closed before work if immutable receipt persistence is not wired", async () => {
    const deps = dependencies({ persistReceipt: null });
    expect((await handleGeoKbEnrichment(request(), deps)).status).toBe(503);
    expect(deps.readAsset).not.toHaveBeenCalled();
    expect(deps.fetchPage).not.toHaveBeenCalled();
  });
  it("uses exactly 90 finalized Pacific days and persists the actual report before returning it", async () => {
    const release = vi.fn();
    const deps = dependencies({ openGscGate: async () => ({ ok: true, release }) });
    const response = await handleGeoKbEnrichment(request(), deps);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(deps.readAsset).toHaveBeenCalledWith({ userId: "account-a", kbId: KB });
    expect(deps.readQueries).toHaveBeenCalledWith(expect.objectContaining({ property: "sc-domain:example.com", window: { startDate: "2026-05-31", endDate: "2026-08-28" } }));
    const { data } = await response.json();
    expect(data).toMatchObject({ kbId: KB, draftVersion: 4, targetHost: "example.com", gsc: { queryCount: 2, status: "available" }, skippedLayers: [] });
    expect(data.competitors[0]).toMatchObject({ brandName: "Actual Rival", confirmed: false });
    expect(deps.persistReceipt).toHaveBeenCalledWith({ userId: "account-a", report: data });
    expect(release).toHaveBeenCalledOnce();
    expect(JSON.stringify(data)).not.toContain("test-provider-token");
  });
  it("keeps no-GSC roles and layer skips explicit while still returning actual crawl evidence", async () => {
    const deps = dependencies({ readIdentity: async () => null });
    const response = await handleGeoKbEnrichment(request(), deps);
    const { data } = await response.json();
    expect(data.gsc).toMatchObject({ status: "unavailable", reason: "not_connected", queryCount: null, roles: [] });
    expect(data.skippedLayers).toEqual(["problem", "evaluation"]);
    expect(data.competitors[0].source).toBe("crawl");
    expect(deps.readGscSession).not.toHaveBeenCalled();
    expect(deps.openGscGate).not.toHaveBeenCalled();
    expect(deps.resolveGrant).not.toHaveBeenCalled();
  });
  it("does not use a property removed by refreshed grant and always releases the GSC gate", async () => {
    const release = vi.fn();
    const deps = dependencies({ openGscGate: async () => ({ ok: true, release }), resolveGrant: async () => ({ kind: "grant", accessToken: "test-only", properties: ["sc-domain:other.test"], propertyTotal: 1 }) });
    const { data } = await (await handleGeoKbEnrichment(request(), deps)).json();
    expect(data.gsc).toMatchObject({ status: "unavailable", reason: "property_not_granted", queryCount: null });
    expect(deps.readQueries).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });
  it("records a failed read as unavailable, not zero, and releases its slot", async () => {
    const release = vi.fn();
    const deps = dependencies({ openGscGate: async () => ({ ok: true, release }), readQueries: async () => { throw new Error("private provider detail"); } });
    const response = await handleGeoKbEnrichment(request(), deps);
    const body = await response.text();
    expect(JSON.parse(body).data.gsc).toMatchObject({ status: "unavailable", reason: "fetch_failed", queryCount: null });
    expect(body).not.toContain("private provider detail");
    expect(release).toHaveBeenCalledOnce();
  });
  it("does not return ephemeral evidence as durable when receipt persistence fails", async () => {
    const deps = dependencies({ persistReceipt: async () => ({ kind: "unavailable" }) });
    const response = await handleGeoKbEnrichment(request(), deps);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("Actual Rival");
  });
  it("reports every saved fact up to the KB cap rather than silently omitting the second half", async () => {
    const facts = Array.from({ length: 24 }, (_, index) => ({ key: `Fact ${index}`, value: "value", reason: "" as const, sourceUrl: "https://example.com/facts", observedAt: "" }));
    const deps = dependencies({ readAsset: async () => ({ kind: "ok", value: { ...ASSET, payload: { ...ASSET.payload, facts } } }) });
    const response = await handleGeoKbEnrichment(request(), deps);
    const { data } = await response.json();
    expect(data.facts).toHaveLength(24);
    expect(data.facts[23]).toMatchObject({ key: "Fact 23", status: "unavailable", value: null });
    expect(deps.fetchPage).toHaveBeenCalledTimes(2);
  });
  it("returns a private unavailable response when an owned store read throws", async () => {
    const deps = dependencies({ readAsset: async () => { throw new Error("private db detail"); } });
    const response = await handleGeoKbEnrichment(request(), deps);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private db detail");
    expect(deps.fetchPage).not.toHaveBeenCalled();
  });
});
