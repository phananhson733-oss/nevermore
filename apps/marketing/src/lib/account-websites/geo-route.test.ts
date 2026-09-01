import { describe, expect, it, vi } from "vitest";

import { emptyGeoKbPayload } from "../geo-tools/kb-contract.ts";
import { handleWebsiteGeoLoad, type WebsiteGeoDependencies } from "./geo-route.ts";
import type { WebsiteDetails } from "./contracts.ts";
import { completePayloadV2, V2_KB_ID } from "../geo-tools/kb-v2.test-fixtures.ts";

const WEBSITE_ID = "c80c5f1d-5a0e-4d14-a6a5-e75bc66ca4a6";
const WEBSITE: WebsiteDetails = {
  websiteId: WEBSITE_ID, origin: "https://www.example.com", host: "www.example.com",
  canonicalSiteKey: "example.com", submittedUrl: "https://www.example.com/product",
  displayName: "Example", isPrimary: true, profileState: "not_generated",
  confirmedSnapshotId: null, confirmedSnapshotRevision: null, confirmedAt: null,
  createdAt: "2026-08-31T00:00:00Z", updatedAt: "2026-08-31T00:00:00Z",
  draft: null, currentConfirmedSnapshot: null,
};
const VIEW = {
  kbId: "kb-existing", origin: "https://example.com", host: "example.com",
  draftVersion: 4, payload: emptyGeoKbPayload("https://example.com"),
  frozen: null, importAvailable: false, profile: null,
};

function dependencies(): { -readonly [Key in keyof WebsiteGeoDependencies]: WebsiteGeoDependencies[Key] } {
  return {
    authenticate: vi.fn(async () => ({ ok: true as const, userId: "user-owned" })),
    readWebsite: vi.fn(async () => ({ kind: "ok" as const, value: WEBSITE })),
    loadKnowledgeBase: vi.fn(async () => ({ kind: "ok" as const, value: VIEW })),
  };
}
function request(body = "{}", origin = "https://gengrowth.ai"): Request {
  return new Request(`https://gengrowth.ai/api/account/websites/${WEBSITE_ID}/geo`, {
    method: "POST", headers: { "content-type": "application/json", origin }, body,
  });
}

describe("website-owned GEO entry", () => {
  it("uses streaming JSON for the complete V2 response on the canonical entry", async () => {
    const deps = dependencies(), payload = completePayloadV2();
    deps.loadKnowledgeBase = vi.fn(async () => ({ kind: "ok" as const, value: {
      schemaVersion: "marketing-geo-kb-editor.v2" as const, kbId: V2_KB_ID, origin: "https://example.com", host: "example.com",
      draftVersion: 1, draftHash: "a".repeat(64), profileCopyHash: "b".repeat(64), payload: { ...payload, profileCopy: { ...payload.profileCopy, websiteId: WEBSITE_ID } }, requiresSave: false, profile: null,
      frozen: null, sourceReceipt: null, prepared: null, generations: { roles: null, questions: null },
    } }));
    const response = await handleWebsiteGeoLoad(request(), WEBSITE_ID, deps);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect((await response.json()).data.knowledgeBase.schemaVersion).toBe("marketing-geo-kb-editor.v2");
  });
  it("does not expose a complete V2 copy owned by a different website when current Profile is absent", async () => {
    const deps = dependencies();
    deps.loadKnowledgeBase = vi.fn(async () => ({ kind: "ok" as const, value: {
      schemaVersion: "marketing-geo-kb-editor.v2" as const, kbId: V2_KB_ID, origin: "https://example.com", host: "example.com",
      draftVersion: 1, draftHash: "a".repeat(64), profileCopyHash: "b".repeat(64), payload: completePayloadV2(), requiresSave: false, profile: null,
      frozen: null, sourceReceipt: null, prepared: null, generations: { roles: null, questions: null },
    } }));
    expect((await handleWebsiteGeoLoad(request(), WEBSITE_ID, deps)).status).toBe(503);
  });
  it("authenticates before reading an owned website or loading a KB", async () => {
    const deps = dependencies();
    deps.authenticate = vi.fn(async () => ({ ok: false as const, response: Response.json({ error: { code: "auth_required" } }, { status: 401 }) }));
    const response = await handleWebsiteGeoLoad(request(), WEBSITE_ID, deps);
    expect(response.status).toBe(401);
    expect(deps.readWebsite).not.toHaveBeenCalled();
    expect(deps.loadKnowledgeBase).not.toHaveBeenCalled();
  });
  it("treats invalid and foreign website ids as missing without loading a KB", async () => {
    const deps = dependencies();
    expect((await handleWebsiteGeoLoad(request(), "bad-id", deps)).status).toBe(404);
    expect(deps.readWebsite).not.toHaveBeenCalled();
    deps.readWebsite = vi.fn(async () => ({ kind: "missing" as const }));
    const response = await handleWebsiteGeoLoad(request(), WEBSITE_ID, deps);
    expect(response.status).toBe(404);
    expect(deps.readWebsite).toHaveBeenCalledWith("user-owned", WEBSITE_ID);
    expect(deps.loadKnowledgeBase).not.toHaveBeenCalled();
  });
  it("rejects a client URL, KB identity, and cross-origin mutation", async () => {
    const deps = dependencies();
    for (const body of ['{"url":"https://foreign.test"}', '{"kbId":"foreign"}', "null", "[]"]) {
      expect((await handleWebsiteGeoLoad(request(body), WEBSITE_ID, deps)).status).toBe(400);
    }
    expect((await handleWebsiteGeoLoad(request("{}", "https://foreign.test"), WEBSITE_ID, deps)).status).toBe(403);
    expect(deps.loadKnowledgeBase).not.toHaveBeenCalled();
  });
  it("derives the URL from the owned website and reuses the same KB without exposing Profile drafts", async () => {
    const deps = dependencies();
    const response = await handleWebsiteGeoLoad(request(), WEBSITE_ID, deps);
    expect(deps.loadKnowledgeBase).toHaveBeenCalledWith({ userId: "user-owned", url: WEBSITE.origin });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ data: {
      website: { websiteId: WEBSITE_ID, origin: WEBSITE.origin, host: WEBSITE.host, profileState: WEBSITE.profileState },
      knowledgeBase: VIEW,
    } });
  });
  it("fails closed without forwarding infrastructure reasons", async () => {
    const deps = dependencies();
    deps.readWebsite = vi.fn(async () => ({ kind: "unavailable" as const, reason: "private-store-location" }));
    const website = await handleWebsiteGeoLoad(request(), WEBSITE_ID, deps);
    expect(website.status).toBe(503);
    expect(await website.text()).not.toContain("private-store-location");
    expect(deps.loadKnowledgeBase).not.toHaveBeenCalled();
    deps.readWebsite = vi.fn(async () => ({ kind: "ok" as const, value: WEBSITE }));
    deps.loadKnowledgeBase = vi.fn(async () => ({ kind: "unavailable" as const, reason: "private-store-location" }));
    const kb = await handleWebsiteGeoLoad(request(), WEBSITE_ID, deps);
    expect(kb.status).toBe(503);
    expect(await kb.text()).not.toContain("private-store-location");
  });
  it("does not return another website's inherited Profile from a mismatched store response", async () => {
    const deps = dependencies();
    deps.loadKnowledgeBase = vi.fn(async () => ({ kind: "ok" as const, value: { ...VIEW, profile: {
      reference: { schemaVersion: "website-profile-reference.v1" as const, websiteId: "another-website", snapshotId: "snapshot", snapshotRevision: 1, profileSchemaVersion: "marketing-website-profile.v1" as const, profileHash: "a".repeat(64) },
      productName: "Private product", oneLinePositioning: "Private position", coreFeatures: [], market: { country: "US", language: "en" },
    } } }));
    const response = await handleWebsiteGeoLoad(request(), WEBSITE_ID, deps);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("Private product");
  });
});
