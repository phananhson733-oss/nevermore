import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { canonicalProfileJson, emptyMarketingWebsiteProfile, type WebsiteDetails } from "../account-websites/contracts.ts";
import { emptyGeoKbPayload } from "./kb-contract.ts";
import { createGeoProfileCopy } from "./kb-profile-copy.ts";
import { parseVisibilityContext } from "./visibility-context.ts";
import { handleVisibilityContext, type VisibilityContextDependencies } from "./visibility-context-handler.ts";

const id = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const time = "2026-08-31T00:00:00.000Z";
const profile = { ...emptyMarketingWebsiteProfile(), productName: "Acme", country: "US", locale: "en", coreFeatures: Array.from({ length: 32 }, (_, i) => `Feature ${i}`), directCompetitors: ["one.com", "two.com", "three.com", "four.com", "five.com", "six.com"] };
const reference = { schemaVersion: "website-profile-reference.v1", websiteId: id(1), snapshotId: id(2), snapshotRevision: 3, profileSchemaVersion: "marketing-website-profile.v1", profileHash: createHash("sha256").update(canonicalProfileJson(profile)).digest("hex") } as const;
const site: WebsiteDetails = { websiteId: id(1), origin: "https://example.com", host: "example.com", canonicalSiteKey: "example.com", displayName: "Acme", isPrimary: true, profileState: "confirmed", confirmedSnapshotId: id(2), confirmedSnapshotRevision: 3, confirmedAt: time, createdAt: time, updatedAt: time, submittedUrl: "https://example.com", draft: null, currentConfirmedSnapshot: { ...reference, confirmedAt: time, profile } };
const other: WebsiteDetails = { ...site, websiteId: id(3), origin: "https://second.com", host: "second.com", canonicalSiteKey: "second.com", isPrimary: false, profileState: "not_generated", confirmedSnapshotId: null, confirmedSnapshotRevision: null, confirmedAt: null, currentConfirmedSnapshot: null };
const payload = { ...emptyGeoKbPayload(site.origin), officialName: "Acme", categoryTerms: ["analytics"], profileCopy: createGeoProfileCopy(reference, profile) };
const snapshot = { kbId: id(4), snapshotId: id(5), revision: 2, frozenAt: time, contentHash: "b".repeat(64), questionSetHash: "c".repeat(64), questionCount: 1, payload, questionSet: { schemaVersion: "marketing-geo-question-set.v1", registryVersion: "v1", language: "en", country: "US", questions: [{ id: "q1", text: "What are the best analytics tools?", mode: "retrieval", layer: "discovery", calibrated: true, roleId: null, templateId: "t1", requiredEntities: ["analytics"] }] } } as const;
function deps(): VisibilityContextDependencies {
  return {
    authenticate: vi.fn(async () => ({ ok: true as const, userId: id(99) })),
    listWebsites: vi.fn(async () => ({ kind: "ok" as const, value: [site, other] })),
    readWebsite: vi.fn(async (_userId, websiteId) => ({ kind: "ok" as const, value: websiteId === site.websiteId ? site : other })),
    listKnowledgeBases: vi.fn(async () => ({ kind: "ok" as const, value: [{ kbId: id(4), origin: site.origin, host: site.host, canonicalSiteKey: site.canonicalSiteKey, createdAt: time, updatedAt: time, draft: { draftVersion: 4, contentHash: "d".repeat(64), updatedAt: time }, frozen: snapshot }] })),
    readFrozen: vi.fn(async () => ({ kind: "ok" as const, value: snapshot })),
    readContext: vi.fn(async () => ({ kind: "ok" as const, value: null })),
  };
}
const request = (query = "") => new Request(`https://gengrowth.ai/api/tools/ai-visibility-check/context${query}`);

describe("Visibility website and immutable input context", () => {
  it("lists every account website with its full Profile, preparation state and exact frozen questions", async () => {
    const response = await handleVisibilityContext(request(), deps());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = parseVisibilityContext(await response.json());
    expect(body.websites).toHaveLength(2);
    expect(body.websites[0]?.currentProfile?.profile.coreFeatures).toHaveLength(32);
    expect(body.websites[0]?.frozen?.payload.profileCopy?.profile.directCompetitors).toHaveLength(6);
    expect(body.websites[0]?.preparation).toMatchObject({ status: "ready", profileSync: "current" });
    expect(body.websites[1]?.preparation.status).toBe("profile_required");
    expect(body.websites[1]?.frozen).toBeNull();
  });
  it("marks legacy frozen inputs partial without filling them from the live profile", async () => {
    const d = deps();
    const { profileCopy: _, ...legacy } = payload;
    d.readFrozen = vi.fn(async () => ({ kind: "ok" as const, value: { ...snapshot, payload: legacy } }));
    const body = parseVisibilityContext(await (await handleVisibilityContext(request(), d)).json());
    expect(body.websites[0]?.frozen?.profileReference).toBeNull();
    expect(body.websites[0]?.frozen?.payload).not.toHaveProperty("profileCopy");
    expect(body.websites[0]?.preparation).toMatchObject({ status: "profile_update_available", profileSync: "legacy_partial" });
  });
  it("reads the explicitly selected owned historical snapshot instead of previewing latest", async () => {
    const d = deps();
    const old = { ...snapshot, snapshotId: id(6), revision: 1, payload: { ...payload, profileCopy: createGeoProfileCopy({ ...reference, snapshotId: id(7), snapshotRevision: 1 }, profile) } };
    d.readFrozen = vi.fn(async () => ({ kind: "ok" as const, value: old }));
    const body = parseVisibilityContext(await (await handleVisibilityContext(request(`?websiteId=${id(1)}&snapshotId=${id(6)}`), d)).json());
    expect(d.readFrozen).toHaveBeenCalledWith({ userId: id(99), kbId: id(4), snapshotId: id(6) });
    expect(body.websites[0]?.frozen?.snapshotId).toBe(id(6));
    expect(body.websites[0]?.preparation.profileSync).toBe("outdated");
  });
  it("fails closed when declared frozen data cannot be read", async () => {
    const d = deps(); d.readFrozen = vi.fn(async () => ({ kind: "missing" as const }));
    const response = await handleVisibilityContext(request(), d);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "store_unavailable" } });
  });
  it("rejects a foreign website selector before reading its details", async () => {
    const d = deps();
    expect((await handleVisibilityContext(request(`?websiteId=${id(88)}&snapshotId=${id(6)}`), d)).status).toBe(404);
    expect(d.readWebsite).not.toHaveBeenCalled();
  });
  it("authenticates before reading private websites", async () => {
    const d = deps(); d.authenticate = vi.fn(async () => ({ ok: false as const, response: new Response(null, { status: 401 }) }));
    expect((await handleVisibilityContext(request(), d)).status).toBe(401);
    expect(d.listWebsites).not.toHaveBeenCalled();
  });
  it("rejects malformed question arrays instead of casting the response", async () => {
    const body = await (await handleVisibilityContext(request(), deps())).json();
    body.websites[0].frozen.questions[0].mode = "invented";
    expect(() => parseVisibilityContext(body)).toThrow();
  });
  it("refuses detail identity drift and a mismatched exact snapshot read", async () => {
    const wrongDetail = deps(); wrongDetail.readWebsite = vi.fn(async () => ({ kind: "ok" as const, value: other }));
    expect((await handleVisibilityContext(request(), wrongDetail)).status).toBe(503);
    for (const change of [{ snapshotId: id(77) }, { kbId: id(77) }, { payload: { ...payload, targetUrl: "https://foreign.com" } }]) {
      const d = deps(); d.readFrozen = vi.fn(async () => ({ kind: "ok" as const, value: { ...snapshot, ...change } }));
      expect((await handleVisibilityContext(request(), d)).status).toBe(503);
    }
  });
  it("rejects current Profile references inconsistent with the website summary", async () => {
    const body = await (await handleVisibilityContext(request(), deps())).json();
    body.websites[0].currentProfile.reference.snapshotRevision = 99;
    expect(() => parseVisibilityContext(body)).toThrow();
  });
  it("rejects duplicate question identities and duplicate selectors", async () => {
    const body = await (await handleVisibilityContext(request(), deps())).json();
    const frozen = body.websites[0].frozen; frozen.questions.push({ ...frozen.questions[0] }); frozen.questionCount = 2; frozen.retrievalCount = 2;
    expect(() => parseVisibilityContext(body)).toThrow();
    expect((await handleVisibilityContext(request(`?websiteId=${id(1)}&websiteId=${id(3)}&snapshotId=${id(5)}`), deps())).status).toBe(400);
  });
  it("reports actual English question quality without editing frozen text", async () => {
    const d = deps(); const mixed = "What are the top 占星工具 tools right now?";
    d.readFrozen = vi.fn(async () => ({ kind: "ok" as const, value: { ...snapshot, payload: { ...payload, categoryTerms: ["占星工具"] }, questionSet: { ...snapshot.questionSet, questions: [{ ...snapshot.questionSet.questions[0], text: mixed }] } } }));
    const body = parseVisibilityContext(await (await handleVisibilityContext(request(), d)).json());
    expect(body.websites[0]?.preparation.languageWarnings).toEqual(["category_terms_not_english"]);
    expect(body.websites[0]?.frozen?.questions[0]?.text).toBe(mixed);
  });
});
