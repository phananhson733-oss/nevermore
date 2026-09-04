import { describe, expect, it, vi } from "vitest";
import { emptyGeoKbPayload, type GeoKbValue } from "./kb-contract.ts";
import { handleGeoKbSources, type GeoKbSourceDependencies } from "./kb-source-handler.ts";
import { verifyGeoKbSourceReportV2 } from "./kb-sources.ts";
import { emptyMarketingWebsiteProfile } from "../account-websites/contracts.ts";
import { createGeoProfileCopy } from "./kb-profile-copy.ts";
import { parseGeoKbPayloadV2 } from "./kb-v2-contract.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { geoKbDigest } from "./kb-digest.ts";

const KB = "c80c5f1d-5a0e-4d14-a6a5-e75bc66ca4a6";
const AT = "2026-08-31T12:00:00.000Z";
const ASSET = { kbId: KB, targetHost: "example.com", draftVersion: 4, profileReference: null,
  payload: { ...emptyGeoKbPayload("https://example.com"), competitors: [{ domain: "rival.example", brandName: "", confirmed: false }] },
};
function dependencies(overrides: Partial<GeoKbSourceDependencies> = {}): GeoKbSourceDependencies {
  return {
    authenticate: vi.fn(async () => ({ status: "authenticated" as const, userId: "account-a", email: null, avatarUrl: null, googleSubject: "google-a" })),
    readIdentity: vi.fn(async () => ({ sub: "google-a" })),
    readAsset: vi.fn(async () => ({ kind: "ok" as const, value: ASSET })),
    readGscSession: vi.fn(async () => ({ properties: ["sc-domain:example.com"] })),
    openGscGate: vi.fn(async () => ({ ok: true as const, release: vi.fn() })),
    resolveGrant: vi.fn(async () => ({ kind: "grant" as const, accessToken: "offline-token", properties: ["sc-domain:example.com"], propertyTotal: 1 })),
    readQueries: vi.fn(async () => ({ queries: ["only once", "different singleton"], truncated: false })),
    fetchPage: vi.fn(async (url) => ({ kind: "ok" as const, url, body: '<meta property="og:site_name" content="Actual Rival"><title>Actual Rival — Home</title>', observedAt: AT })),
    persistReceipt: vi.fn(async () => ({ kind: "ok" as const })),
    now: () => new Date(AT), newId: () => "b920cd2e-c645-4df6-a80e-4f434dd09266", clientIp: () => "192.0.2.1", ...overrides,
  };
}
function request(body: unknown = { kbId: KB }, origin = "https://gengrowth.ai") {
  return new Request("https://gengrowth.ai/api/tools/geo-knowledge-base/sources", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });
}
function noSourceCalls(deps: GeoKbSourceDependencies) {
  for (const call of [deps.openGscGate, deps.resolveGrant, deps.readQueries, deps.fetchPage]) expect(call).not.toHaveBeenCalled();
}
describe("V2 source handler admission", () => {
  it("rejects missing or unavailable identity without private/source work", async () => {
    for (const status of ["unauthenticated", "unavailable"] as const) {
      const deps = dependencies({ authenticate: async () => ({ status }) });
      expect((await handleGeoKbSources(request(), deps)).status).toBe(status === "unauthenticated" ? 401 : 503);
      expect(deps.readAsset).not.toHaveBeenCalled(); noSourceCalls(deps);
    }
  });
  it("rejects Google-subject mismatch before owner reads or source quotas", async () => {
    const deps = dependencies({ readIdentity: async () => ({ sub: "different-google-subject" }) });
    expect((await handleGeoKbSources(request(), deps)).status).toBe(401);
    expect(deps.readAsset).not.toHaveBeenCalled(); noSourceCalls(deps);
  });
  it("rejects client-chosen URLs/properties, cross-origin requests and absent persistence", async () => {
    const deps = dependencies();
    expect((await handleGeoKbSources(request({ kbId: KB, property: "sc-domain:other.example" }), deps)).status).toBe(400);
    expect((await handleGeoKbSources(request(undefined, "https://other.example"), deps)).status).toBe(403);
    expect((await handleGeoKbSources(request(), { ...deps, persistReceipt: null })).status).toBe(503);
    expect(deps.readAsset).not.toHaveBeenCalled(); noSourceCalls(deps);
  });
  it.each(["missing", "unavailable", "no_draft"] as const)("refuses %s owned data before source work", async (kind) => {
    const deps = dependencies({ readAsset: async () => ({ kind }) });
    expect((await handleGeoKbSources(request(), deps)).status).toBe(kind === "missing" ? 404 : kind === "no_draft" ? 409 : 503);
    noSourceCalls(deps);
  });
  it("rejects malformed source metadata rather than collecting and then failing persistence", async () => {
    for (const asset of [{ ...ASSET, kbId: "11111111-1111-4111-8111-111111111111" }, { ...ASSET, targetHost: "foreign.example" }, { ...ASSET, draftVersion: -1 }, { ...ASSET, draftVersion: 0 }, { ...ASSET, payload: { ...ASSET.payload, competitors: Array.from({ length: 6 }, () => ASSET.payload.competitors[0]!) } }]) {
      const deps = dependencies({ readAsset: async () => ({ kind: "ok", value: asset }) });
      expect((await handleGeoKbSources(request(), deps)).status).toBe(503); noSourceCalls(deps);
    }
  });
  it("rejects a source reference that differs from the saved complete Profile copy before collecting", async () => {
    const copy = createGeoProfileCopy({ schemaVersion: "website-profile-reference.v1", websiteId: "11111111-1111-4111-8111-111111111111", snapshotId: "22222222-2222-4222-8222-222222222222", snapshotRevision: 1, profileSchemaVersion: "marketing-website-profile.v1", profileHash: "a".repeat(64) }, emptyMarketingWebsiteProfile());
    const deps = dependencies({ readAsset: async () => ({ kind: "ok", value: { ...ASSET, payload: { ...ASSET.payload, profileCopy: copy }, profileReference: null } }) });
    expect((await handleGeoKbSources(request(), deps)).status).toBe(503); noSourceCalls(deps);
  });
});
describe("V2 actual source collection", () => {
  it("accepts a saved V2 draft through the same source seam with its exact V2 digest", async () => {
    const reference = { schemaVersion: "website-profile-reference.v1" as const, websiteId: "11111111-1111-4111-8111-111111111111", snapshotId: "22222222-2222-4222-8222-222222222222", snapshotRevision: 1, profileSchemaVersion: "marketing-website-profile.v1" as const, profileHash: "a".repeat(64) };
    const profileCopy = createGeoProfileCopy(reference, { ...emptyMarketingWebsiteProfile(), productName: "Acme", country: "US", locale: "en" });
    const payload = parseGeoKbPayloadV2({ ...ASSET.payload, schemaVersion: "marketing-geo-kb.v2", officialName: "Acme", aliases: ["Acme"], categoryTerms: ["analytics"], profileCopy, roles: [], facts: [] });
    const deps = dependencies({ readAsset: async () => ({ kind: "ok", value: { ...ASSET, payload, profileReference: reference } }) });
    const response = await handleGeoKbSources(request(), deps); expect(response.status).toBe(200);
    expect((await response.json()).data.draftHash).toBe(geoV2Digest(payload));
    expect(geoV2Digest(ASSET.payload)).toBe(geoKbDigest(ASSET.payload as unknown as GeoKbValue));
  });
  it("retains all singleton queries and persists the exact 90-day source receipt before returning", async () => {
    const release = vi.fn(), deps = dependencies({ openGscGate: async () => ({ ok: true, release }) });
    const response = await handleGeoKbSources(request(), deps);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    const { data } = await response.json(); const report = verifyGeoKbSourceReportV2(data);
    expect(report.gsc).toMatchObject({ status: "available", queryCount: 2, truncated: false, window: { startDate: "2026-05-31", endDate: "2026-08-28" } });
    expect(report.gsc.queries.map((query) => query.text)).toEqual(["different singleton", "only once"]);
    expect(report.gsc).not.toHaveProperty("roles");
    expect(report.competitors[0]).toMatchObject({ status: "available", brandName: "Actual Rival", confirmed: false });
    expect(deps.persistReceipt).toHaveBeenCalledWith({ userId: "account-a", report });
    expect(deps.readQueries).toHaveBeenCalledWith(expect.objectContaining({ property: "sc-domain:example.com", window: report.gsc.window }));
    expect(release).toHaveBeenCalledTimes(1);
  });
  it("keeps missing GSC optional, without inventing roles or zero queries", async () => {
    const deps = dependencies({ readIdentity: async () => null });
    const response = await handleGeoKbSources(request(), deps); expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.gsc).toMatchObject({ status: "unavailable", reason: "not_connected", queryCount: null, queries: [] });
    expect(deps.readQueries).not.toHaveBeenCalled(); expect(deps.resolveGrant).not.toHaveBeenCalled(); expect(deps.openGscGate).not.toHaveBeenCalled();
    // The competitor's page, and the site's own -- the second is the only page
    // in this refresh that can say what the site states about itself.
    expect(vi.mocked(deps.fetchPage).mock.calls.map(call => call[0])).toEqual(["https://rival.example/", ASSET.payload.targetUrl]);
  });
  it("respects GSC quota and rechecks that the refreshed grant covers the property", async () => {
    const limited = dependencies({ openGscGate: async () => ({ ok: false, response: new Response(null, { status: 429 }) }) });
    const limitedResult = await handleGeoKbSources(request(), limited);
    expect(limitedResult.status).toBe(200);
    expect((await limitedResult.json()).data.gsc.reason).toBe("rate_limited"); expect(limited.resolveGrant).not.toHaveBeenCalled(); expect(limited.readQueries).not.toHaveBeenCalled();
    const release = vi.fn(), foreign = dependencies({ openGscGate: async () => ({ ok: true, release }), resolveGrant: async () => ({ kind: "grant", accessToken: "offline-token", properties: ["sc-domain:other.example"], propertyTotal: 1 }) });
    const foreignResult = await handleGeoKbSources(request(), foreign);
    expect(foreignResult.status).toBe(200);
    expect((await foreignResult.json()).data.gsc.reason).toBe("property_not_granted"); expect(foreign.readQueries).not.toHaveBeenCalled(); expect(release).toHaveBeenCalledTimes(1);
  });
  it("reports invalid GSC output as unavailable without silently trimming its inventory", async () => {
    const deps = dependencies({ readQueries: async () => ({ queries: Array.from({ length: 1001 }, (_, index) => String(index)), truncated: false }) });
    const response = await handleGeoKbSources(request(), deps);
    expect(response.status).toBe(200); expect((await response.json()).data.gsc).toMatchObject({ status: "unavailable", reason: "invalid_response", queryCount: null, queries: [] });
  });
  it("reuses a bounded page read for competitor and fact evidence but does not confirm the fact", async () => {
    const asset = { ...ASSET, payload: { ...ASSET.payload, facts: [{ key: "Price", value: "$20", reason: "" as const, sourceUrl: "https://rival.example/", observedAt: "" }] } };
    const deps = dependencies({ readAsset: async () => ({ kind: "ok", value: asset }), fetchPage: vi.fn(async (url: string) => ({ kind: "ok" as const, url, body: '<title>Rival</title><p>Price: $20.</p>', observedAt: AT })) });
    const response = await handleGeoKbSources(request(), deps);
    expect(response.status).toBe(200); expect((await response.json()).data.facts[0]).toMatchObject({ status: "available", value: "$20", confirmed: false });
    // One read for the competitor and the declared fact, which share a URL, and
    // one for the site's own page. A third would be the same bytes again.
    expect(vi.mocked(deps.fetchPage).mock.calls.map(call => call[0])).toEqual(["https://rival.example/", ASSET.payload.targetUrl]);
  });
  it("never returns a successful unpersisted receipt or private exception details", async () => {
    const deps = dependencies({ persistReceipt: async () => { throw new Error("private-store-detail"); } });
    const response = await handleGeoKbSources(request(), deps);
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("private-store-detail");
  });
});
