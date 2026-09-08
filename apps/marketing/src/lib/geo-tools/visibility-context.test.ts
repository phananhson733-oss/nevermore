import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { canonicalProfileJson, emptyMarketingWebsiteProfile, type WebsiteDetails } from "../account-websites/contracts.ts";
import { emptyGeoKbPayload } from "./kb-contract.ts";
import { createGeoProfileCopy } from "./kb-profile-copy.ts";
import { parseVisibilityContext, type VisibilityWebsiteContext } from "./visibility-context.ts";
import { handleVisibilityContext, type VisibilityContextDependencies } from "./visibility-context-handler.ts";
import { completePayloadV2, questionSetV2 } from "./kb-v2.test-fixtures.ts";
import { completePayloadV3 } from "./kb-v3.test-fixtures.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";

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
/** The readable half, refused loudly rather than optional-chained away. */
function readable(row: VisibilityWebsiteContext | undefined) {
  const frozen = row?.frozen ?? null;
  if (frozen === null || frozen.kind !== "readable") throw new Error(`Expected a readable frozen version, got ${frozen === null ? "null" : `${frozen.kind}/${frozen.reason}`}`);
  return frozen;
}

describe("Visibility website and immutable input context", () => {
  it("lists every account website with its full Profile, preparation state and exact frozen questions", async () => {
    const response = await handleVisibilityContext(request(), deps());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = parseVisibilityContext(await response.json());
    expect(body.websites).toHaveLength(2);
    expect(body.websites[0]?.currentProfile?.profile.coreFeatures).toHaveLength(32);
    expect(readable(body.websites[0]).payload.profileCopy?.profile.directCompetitors).toHaveLength(6);
    expect(body.websites[0]?.preparation).toMatchObject({ status: "ready", profileSync: "current" });
    expect(body.websites[1]?.preparation.status).toBe("profile_required");
    expect(body.websites[1]?.frozen).toBeNull();
  });
  it("projects an exact V2 frozen payload and question set without leaking question provenance", async () => {
    const d = deps(), questionSet = questionSetV2();
    const baseV2 = completePayloadV2();
    const v2Payload = { ...baseV2, targetUrl: site.origin, profileCopy: createGeoProfileCopy(reference, profile),
      roles: baseV2.roles.map(role => ({ ...role, label: "财务经理", questionLabel: "finance managers" })) };
    const v2Snapshot = { ...snapshot, contentHash: geoV2Digest(v2Payload), questionSetHash: geoV2Digest(questionSet), payload: v2Payload, questionSet };
    d.readFrozen = vi.fn(async () => ({ kind: "ok" as const, value: v2Snapshot as never }));

    const response = await handleVisibilityContext(request(), d);
    expect(response.status).toBe(200);
    const body = parseVisibilityContext(await response.json());
    expect(readable(body.websites[0]).payload.schemaVersion).toBe("marketing-geo-kb.v2");
    expect(readable(body.websites[0]).questions).toHaveLength(questionSet.questions.length);
    expect(readable(body.websites[0]).questions[0]).not.toHaveProperty("provenance");
    expect(body.websites[0]?.preparation.languageWarnings).toEqual([]);
  });
  it("marks legacy frozen inputs partial without filling them from the live profile", async () => {
    const d = deps();
    const { profileCopy: _, ...legacy } = payload;
    d.readFrozen = vi.fn(async () => ({ kind: "ok" as const, value: { ...snapshot, payload: legacy } }));
    const body = parseVisibilityContext(await (await handleVisibilityContext(request(), d)).json());
    expect(readable(body.websites[0]).profileReference).toBeNull();
    expect(readable(body.websites[0]).payload).not.toHaveProperty("profileCopy");
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
    expect(readable(body.websites[0]).questions[0]?.text).toBe(mixed);
  });
  it("does not block a proper-name category that remains English", async () => {
    const d = deps();
    d.readFrozen = vi.fn(async () => ({ kind: "ok" as const, value: {
      ...snapshot,
      payload: { ...payload, officialName: "小米", categoryTerms: ["小米 analytics"] },
    } }));
    const body = parseVisibilityContext(await (await handleVisibilityContext(request(), d)).json());
    expect(body.websites[0]?.preparation.languageWarnings).toEqual([]);
  });
});


/**
 * One account, two websites, one of them holding a version this panel cannot
 * read. The v3 version sits on the *second* website on purpose: the refusal it
 * used to return came from inside the loop, so the first website's complete,
 * readable row was thrown away with it.
 */
const v3Base = completePayloadV3();
const v3Payload = { ...v3Base, generationInput: { ...v3Base.generationInput, identity: { ...v3Base.generationInput.identity, targetUrl: other.origin } } };
const v3Ref = { snapshotId: id(9), revision: 4, contentHash: "e".repeat(64), questionSetHash: null, frozenAt: time };
const v3Snapshot = { kbId: id(8), snapshotId: id(9), revision: 4, frozenAt: time, contentHash: "e".repeat(64), questionSetHash: null, questionCount: null, payload: v3Payload, questionSet: null };
function mixedDeps(overrides: { questionSet?: unknown; questionSetHash?: string | null; questionCount?: number | null } = {}): VisibilityContextDependencies {
  const d = deps();
  const secondKb = { kbId: id(8), origin: other.origin, host: other.host, canonicalSiteKey: other.canonicalSiteKey, createdAt: time, updatedAt: time, draft: null, frozen: v3Ref };
  d.listKnowledgeBases = vi.fn(async () => ({ kind: "ok" as const, value: [
    { kbId: id(4), origin: site.origin, host: site.host, canonicalSiteKey: site.canonicalSiteKey, createdAt: time, updatedAt: time, draft: { draftVersion: 4, contentHash: "d".repeat(64), updatedAt: time }, frozen: snapshot },
    secondKb,
  ] }));
  d.readFrozen = vi.fn(async input => ({ kind: "ok" as const, value: (input.kbId === id(8) ? { ...v3Snapshot, ...overrides } : snapshot) as never }));
  return d;
}

describe("A published version this panel cannot read", () => {
  it("returns every other website in the account instead of refusing the whole response", async () => {
    const d = mixedDeps();
    const response = await handleVisibilityContext(request(), d);
    expect(response.status).toBe(200);
    const body = parseVisibilityContext(await response.json());
    expect(body.websites).toHaveLength(2);
    // The control row survives whole: this is the row that used to disappear.
    expect(readable(body.websites[0]).questions).toHaveLength(1);
    expect(body.websites[0]?.preparation.status).toBe("ready");
    expect(body.websites[1]?.website.host).toBe("second.com");
  });
  it("names the version it cannot read, with the identity the store gave it and nothing else", async () => {
    const body = parseVisibilityContext(await (await handleVisibilityContext(request(), mixedDeps())).json());
    const frozen = body.websites[1]?.frozen;
    expect(frozen).toEqual({ kind: "unreadable", snapshotId: id(9), revision: 4, frozenAt: time, contentHash: "e".repeat(64), questionSetHash: null, reason: "no_question_set" });
    // Not the empty state, and not a version with zero questions.
    expect(frozen).not.toBeNull();
    expect(frozen).not.toHaveProperty("questionCount");
    expect(frozen).not.toHaveProperty("questions");
    expect(frozen).not.toHaveProperty("payload");
  });
  it("reports the version as the blocking state even when the website has no confirmed Profile", async () => {
    // `other` has never confirmed a Profile. Confirming one would not make this
    // version measurable, so "profile_required" would send the visitor away to
    // do something that cannot help; the unreadable version is read first.
    expect(other.currentConfirmedSnapshot).toBeNull();
    const body = parseVisibilityContext(await (await handleVisibilityContext(request(), mixedDeps())).json());
    expect(body.websites[1]?.preparation.status).toBe("frozen_unreadable");
    expect(body.websites[1]?.preparation.profileSync).toBe("unknown");
    expect(body.websites[1]?.preparation.languageWarnings).toEqual([]);
  });
  it("does not read a snapshot context for a version it will not project", async () => {
    const d = mixedDeps();
    await handleVisibilityContext(request(), d);
    expect(d.readContext).toHaveBeenCalledTimes(1);
    expect(d.readContext).toHaveBeenCalledWith({ userId: id(99), kbId: id(4), snapshotId: id(5) });
  });
  it("separates a v3 version that carries questions from one published without any", async () => {
    const set = questionSetV2();
    const body = parseVisibilityContext(await (await handleVisibilityContext(request(), mixedDeps({ questionSet: set, questionSetHash: "f".repeat(64), questionCount: set.questions.length }))).json());
    expect(body.websites[1]?.frozen).toMatchObject({ kind: "unreadable", reason: "unsupported_payload_version", questionSetHash: "f".repeat(64) });
  });
  it("answers an exact selected-snapshot read with the same state rather than a refusal", async () => {
    const response = await handleVisibilityContext(request(`?websiteId=${id(3)}&snapshotId=${id(9)}`), mixedDeps());
    expect(response.status).toBe(200);
    const body = parseVisibilityContext(await response.json());
    expect(body.websites[1]?.frozen).toMatchObject({ snapshotId: id(9), kind: "unreadable" });
  });
  it("still refuses the whole response when the store itself cannot be read", async () => {
    const d = mixedDeps();
    d.readFrozen = vi.fn(async () => ({ kind: "unavailable" as const, reason: "versioned_snapshot_unavailable" }));
    expect((await handleVisibilityContext(request(), d)).status).toBe(503);
  });
});

describe("The third state cannot collapse back into the other two", () => {
  const unreadableBody = async () => await (await handleVisibilityContext(request(), mixedDeps())).json();
  it("refuses a row that holds an unreadable version and calls itself anything else", async () => {
    for (const status of ["freeze_required", "ready", "profile_required", "profile_update_available"]) {
      const body = await unreadableBody();
      body.websites[1].preparation.status = status;
      expect(() => parseVisibilityContext(body)).toThrow(/Frozen readability status/u);
    }
  });
  it("refuses a row that claims the state without holding such a version", async () => {
    const body = await unreadableBody();
    body.websites[0].preparation.status = "frozen_unreadable";
    expect(() => parseVisibilityContext(body)).toThrow(/Frozen readability status/u);
    const dropped = await unreadableBody();
    dropped.websites[1].frozen = null;
    expect(() => parseVisibilityContext(dropped)).toThrow(/Frozen readability status/u);
  });
  it("refuses a Profile comparison nobody could have made", async () => {
    for (const sync of ["current", "outdated", "legacy_partial", "missing"]) {
      const body = await unreadableBody();
      body.websites[1].preparation.profileSync = sync;
      expect(() => parseVisibilityContext(body)).toThrow(/Frozen readability sync/u);
    }
    const readableRow = await unreadableBody();
    readableRow.websites[0].preparation.profileSync = "unknown";
    expect(() => parseVisibilityContext(readableRow)).toThrow(/Frozen readability sync/u);
  });
  it("refuses a finding about questions nothing read", async () => {
    const body = await unreadableBody();
    body.websites[1].preparation.languageWarnings.push("unsupported_language");
    expect(() => parseVisibilityContext(body)).toThrow(/language findings/u);
  });
  it("refuses \"no question set\" from a version that kept its question-set hash", async () => {
    const body = await unreadableBody();
    body.websites[1].frozen.reason = "unsupported_payload_version";
    expect(() => parseVisibilityContext(body)).toThrow(/unreadable reason/u);
    const withHash = await (await handleVisibilityContext(request(), mixedDeps({ questionSet: questionSetV2(), questionSetHash: "f".repeat(64), questionCount: 1 }))).json();
    withHash.websites[1].frozen.reason = "no_question_set";
    expect(() => parseVisibilityContext(withHash)).toThrow(/unreadable reason/u);
  });
  it("refuses a frozen version with no knowledge base behind it", async () => {
    const body = await unreadableBody();
    body.websites[1].knowledgeBase = null;
    expect(() => parseVisibilityContext(body)).toThrow(/without its knowledge base/u);
  });
});
