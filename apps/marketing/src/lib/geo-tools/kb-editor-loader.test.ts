import { describe, expect, it, vi } from "vitest";
import { emptyMarketingWebsiteProfile, canonicalProfileJson } from "../account-websites/contracts.ts";
import { createHash } from "node:crypto";
import { emptyGeoKbPayload } from "./kb-contract.ts";
import { createGeoProfileCopy } from "./kb-profile-copy.ts";
import { createGeoKbEditorLoader, createGeoKbEditorLoaderAny, createGeoKbV3EditorLoader,
  GEO_KB_V3_DRAFT_REASON, type GeoKbEditorLoaderDependencies, type GeoKbV3EditorLoaderDependencies } from "./kb-editor-loader.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { upgradeGeoKbDraftToV2 } from "./kb-upgrade.ts";
import type { GeoPreparedCandidateV2 } from "./kb-prepared-contract.ts";
import { parseGeoKbPayloadV3, type GeoKbPayloadV3 } from "./kb-v3-contract.ts";
import type { AnyVersionedGeoKbPayload, VersionedGeoKbDetails } from "./kb-versioned-read.ts";
import { completePayloadV3, FACT_KEY_PRO, FACT_KEY_TEAM, HASH_A, OBSERVED_AT, QA_KEY, SCOPE_KEY } from "./kb-v3.test-fixtures.ts";

const USER = "11111111-1111-4111-8111-111111111111", KB = "22222222-2222-4222-8222-222222222222", WEBSITE = "33333333-3333-4333-8333-333333333333";
const SNAP = "44444444-4444-4444-8444-444444444444";
const AT = "2026-08-31T00:00:00.000Z";
const profile = { ...emptyMarketingWebsiteProfile(), productName: "Original product", primaryIcp: "Finance teams", categories: ["invoice reminders"], country: "US", locale: "en" };
const ref = { schemaVersion: "website-profile-reference.v1" as const, websiteId: WEBSITE, snapshotId: SNAP, snapshotRevision: 1, profileSchemaVersion: "marketing-website-profile.v1" as const, profileHash: createHash("sha256").update(canonicalProfileJson(profile)).digest("hex") };
const copy = createGeoProfileCopy(ref, profile);
const legacy = { ...emptyGeoKbPayload("https://example.com"), officialName: "Original product", categoryTerms: ["invoice reminders"], profileCopy: copy };
function fixture() {
  const calls: string[] = [];
  const details = { kbId: KB, origin: "https://example.com", host: "example.com", canonicalSiteKey: "example.com", createdAt: AT, updatedAt: AT,
    draft: { draftVersion: 2, contentHash: geoV2Digest(legacy), updatedAt: AT, payload: legacy }, frozen: null };
  const deps: GeoKbEditorLoaderDependencies = {
    ensure: async () => ({ kind: "ok", value: { kbId: KB, created: false } }),
    readDetails: async () => ({ kind: "ok", value: details }),
    readProfile: async () => ({ kind: "ok", value: { reference: ref, profile } }),
    readFrozen: async () => { throw new Error("no snapshot"); },
    readSource: async () => { calls.push("source"); return { kind: "ok", value: null }; },
    readPrepared: async () => { calls.push("prepared"); return { kind: "ok", value: null }; },
    readGeneration: async () => ({ kind: "ok", generation: null }),
  };
  return { deps, details, calls };
}
describe("complete V2 editor load", () => {
  it("accepts a V2 knowledge candidate from the versioned prepared reader contract", async () => {
    const candidate = { schemaVersion: "marketing-geo-prepared-candidate.v2" } as GeoPreparedCandidateV2;
    const readPrepared: GeoKbEditorLoaderDependencies["readPrepared"] = async () => ({ kind: "ok", value: candidate });
    await expect(readPrepared({ userId: USER, kbId: KB })).resolves.toEqual({ kind: "ok", value: candidate });
  });
  it("loads the latest knowledge generation so recovery survives lost browser storage", async () => {
    const { deps } = fixture();
    const kinds: string[] = [];
    const knowledge = { generationId: "55555555-5555-4555-8555-555555555555", userId: USER, kbId: KB,
      kind: "knowledge_pack" as const, inputHash: "a".repeat(64), state: "dispatched" as const,
      result: null, errorReason: null, attempt: null };
    const result = await createGeoKbEditorLoader({ ...deps, readGeneration: async input => {
      kinds.push(input.kind);
      return { kind: "ok", generation: input.kind === "knowledge_pack" ? knowledge : null };
    } })({ userId: USER, url: "https://example.com" });

    expect(kinds).toEqual(["roles", "knowledge_pack", "questions"]);
    expect(result).toMatchObject({ kind: "ok", value: { generations: { roles: null, knowledge_pack: {
      generationId: knowledge.generationId, kind: "knowledge_pack", state: "dispatched",
    }, questions: null } } });
  });
  it("fails closed when the latest knowledge generation is outside the owner scope", async () => {
    const { deps } = fixture();
    const foreign = { generationId: "55555555-5555-4555-8555-555555555555", userId: WEBSITE, kbId: KB,
      kind: "knowledge_pack" as const, inputHash: "a".repeat(64), state: "dispatched" as const,
      result: null, errorReason: null, attempt: null };
    const result = await createGeoKbEditorLoader({ ...deps, readGeneration: async input => ({
      kind: "ok", generation: input.kind === "knowledge_pack" ? foreign : null,
    }) })({ userId: USER, url: "https://example.com" });

    expect(result).toMatchObject({ kind: "unavailable" });
  });
  it("previews a V1 upgrade without saving or replacing its stored hash", async () => {
    const { deps, details } = fixture();
    const result = await createGeoKbEditorLoader(deps)({ userId: USER, url: "https://www.example.com" });
    expect(result).toMatchObject({ kind: "ok", value: { schemaVersion: "marketing-geo-kb-editor.v2", requiresSave: true, draftHash: details.draft.contentHash,
      payload: { schemaVersion: "marketing-geo-kb.v2", profileCopy: copy }, prepared: null, generations: { roles: null, questions: null } } });
    expect(details.draft.payload.schemaVersion).toBe("marketing-geo-kb.v1");
  });
  it("keeps an existing V2 copy even when a newer confirmed Profile is available", async () => {
    const { deps, details } = fixture();
    const payload = upgradeGeoKbDraftToV2(legacy);
    const newer = { ...profile, productName: "New source proposal" };
    const result = await createGeoKbEditorLoader({ ...deps,
      readDetails: async () => ({ kind: "ok", value: { ...details, draft: { ...details.draft, payload, contentHash: geoV2Digest(payload) } } }),
      readProfile: async () => ({ kind: "ok", value: { reference: { ...ref, snapshotRevision: 2, profileHash: createHash("sha256").update(canonicalProfileJson(newer)).digest("hex") }, profile: newer } }),
    })({ userId: USER, url: "https://example.com" });
    expect(result).toMatchObject({ kind: "ok", value: { requiresSave: false, payload: { profileCopy: copy }, profile: { productName: "New source proposal" } } });
  });
  it("does not call unavailable candidate/source reads an empty knowledge base", async () => {
    const { deps } = fixture();
    for (const overrides of [{ readPrepared: async () => ({ kind: "unavailable" as const, reason: "offline" }) }, { readSource: async () => ({ kind: "unavailable" as const, reason: "offline" }) }]) {
      expect(await createGeoKbEditorLoader({ ...deps, ...overrides })({ userId: USER, url: "https://example.com" })).toMatchObject({ kind: "unavailable" });
    }
  });
  it("starts with a full Profile copy but no invented accepted roles or facts", async () => {
    const { deps, details } = fixture();
    const result = await createGeoKbEditorLoader({ ...deps, readDetails: async () => ({ kind: "ok", value: { ...details, draft: null } }) })({ userId: USER, url: "https://example.com" });
    expect(result).toMatchObject({ kind: "ok", value: { draftVersion: 0, draftHash: null, requiresSave: true, payload: { profileCopy: copy, roles: [], facts: [] } } });
  });
  it("lets a first-time user fill missing GEO categories without fabricating a category to load the editor", async () => {
    const { deps, details } = fixture();
    const incomplete = { ...profile, categories: [] };
    const result = await createGeoKbEditorLoader({ ...deps,
      readDetails: async () => ({ kind: "ok", value: { ...details, draft: null } }),
      readProfile: async () => ({ kind: "ok", value: { profile: incomplete, reference: { ...ref, profileHash: createHash("sha256").update(canonicalProfileJson(incomplete)).digest("hex") } } }),
    })({ userId: USER, url: "https://example.com" });
    expect(result).toMatchObject({ kind: "ok", value: { requiresSave: true, payload: { categoryTerms: [] } } });
  });
  it("preserves an unsupported Profile language and an unspecified market for explicit user selection", async () => {
    const { deps, details } = fixture();
    const unsupported = { ...profile, locale: "fil", country: "" };
    const result = await createGeoKbEditorLoader({ ...deps,
      readDetails: async () => ({ kind: "ok", value: { ...details, draft: null } }),
      readProfile: async () => ({ kind: "ok", value: { profile: unsupported, reference: { ...ref, profileHash: createHash("sha256").update(canonicalProfileJson(unsupported)).digest("hex") } } }),
    })({ userId: USER, url: "https://example.com" });
    expect(result).toMatchObject({ kind: "ok", value: { requiresSave: true, payload: { market: { country: "", language: "fil" } } } });
  });
  it("refuses a foreign returned KB and a frozen read failure", async () => {
    const { deps, details } = fixture();
    expect(await createGeoKbEditorLoader({ ...deps, readDetails: async () => ({ kind: "ok", value: { ...details, kbId: WEBSITE } }) })({ userId: USER, url: "https://example.com" })).toMatchObject({ kind: "unavailable" });
    expect(await createGeoKbEditorLoader({ ...deps, readDetails: async () => ({ kind: "ok", value: { ...details, frozen: { snapshotId: SNAP, revision: 1, contentHash: "a".repeat(64), questionSetHash: "b".repeat(64), frozenAt: AT, questionCount: 3 } } }) })({ userId: USER, url: "https://example.com" })).toMatchObject({ kind: "unavailable" });
  });
});

/* ------------------------------------------------------------------ */
/* The v3 draft the view above has no shape for                         */
/* ------------------------------------------------------------------ */

const V3_FROZEN = "66666666-6666-4666-8666-666666666666";
const FROZEN_AT = "2026-09-03T00:00:00.000Z";

function v3Draft(payload: GeoKbPayloadV3, overrides: Partial<VersionedGeoKbDetails> = {}): VersionedGeoKbDetails {
  return { kbId: KB, origin: "https://example.com", host: "example.com", canonicalSiteKey: "example.com", createdAt: AT, updatedAt: AT,
    draft: { draftVersion: 5, contentHash: geoV2Digest(payload), updatedAt: AT, payload }, frozen: null, ...overrides };
}
function v3Fixture(details: VersionedGeoKbDetails, frozenPayload?: AnyVersionedGeoKbPayload) {
  const dependencies: GeoKbV3EditorLoaderDependencies = {
    ensure: async () => ({ kind: "ok", value: { kbId: KB, created: false } }),
    readDetails: async () => ({ kind: "ok", value: details }),
    readFrozenPayload: async () => frozenPayload === undefined
      ? { kind: "unavailable", reason: "no snapshot" }
      : { kind: "ok", value: frozenPayload },
  };
  return dependencies;
}
const frozenRef = { snapshotId: V3_FROZEN, revision: 4, contentHash: "d".repeat(64), questionSetHash: null, questionCount: null, frozenAt: FROZEN_AT };

describe("v3 draft editor load", () => {
  it("loads a stored v3 draft as the review view, with the transport fields the website route needs", async () => {
    const payload = completePayloadV3();
    const result = await createGeoKbV3EditorLoader(v3Fixture(v3Draft(payload)))({ userId: USER, url: "https://www.example.com" });
    expect(result).toEqual({ kind: "ok", value: {
      schemaVersion: "marketing-geo-kb-editor.v3", kbId: KB, origin: "https://example.com", host: "example.com",
      draftVersion: 5, draftHash: geoV2Digest(payload), payload, published: null,
    } });
    // Never `false`: this loader does not read the run table, and the card asks
    // the run route itself. Saying "no run is in progress" would be a claim.
    expect(result).toMatchObject({ kind: "ok" });
    expect(Object.hasOwn((result as { value: object }).value, "runInProgress")).toBe(false);
  });

  it("hands a v1/v2 draft and a knowledge base with no draft back to the v2 loader", async () => {
    const v2Details = { kbId: KB, origin: "https://example.com", host: "example.com", canonicalSiteKey: "example.com", createdAt: AT, updatedAt: AT,
      draft: { draftVersion: 2, contentHash: geoV2Digest(legacy), updatedAt: AT, payload: legacy }, frozen: null } as VersionedGeoKbDetails;
    expect(await createGeoKbV3EditorLoader(v3Fixture(v2Details))({ userId: USER, url: "https://example.com" })).toEqual({ kind: "not_v3" });
    expect(await createGeoKbV3EditorLoader(v3Fixture({ ...v2Details, draft: null }))({ userId: USER, url: "https://example.com" })).toEqual({ kind: "not_v3" });
  });

  it("refuses a v3 draft whose locked identity names another site", async () => {
    const base = completePayloadV3();
    const payload = parseGeoKbPayloadV3({ ...base, generationInput: { ...base.generationInput,
      identity: { ...base.generationInput.identity, targetUrl: "https://elsewhere.test/" } } });
    expect(await createGeoKbV3EditorLoader(v3Fixture(v3Draft(payload)))({ userId: USER, url: "https://example.com" }))
      .toMatchObject({ kind: "unavailable" });
  });

  it("reports the published version's own decisions, suppressions included, as the change baseline", async () => {
    const draft = completePayloadV3();
    // The published version excluded one scope statement through a suppression
    // that carries no decision record, and accepted one fact in bulk. A
    // baseline read off `review.decisions` alone would call the suppressed item
    // `pending` and report it as a change nobody made.
    const publishedPayload = parseGeoKbPayloadV3({ ...draft, review: {
      decisions: [{ itemKey: FACT_KEY_PRO, decision: "accepted_in_bulk", override: null,
        baseContentHash: HASH_A, decidedAt: OBSERVED_AT, baseDraftVersion: "4" }],
      suppressions: [{ itemKey: SCOPE_KEY, suppressedAt: OBSERVED_AT }],
    } });
    const result = await createGeoKbV3EditorLoader(v3Fixture(v3Draft(draft, { frozen: frozenRef }), publishedPayload))({ userId: USER, url: "https://example.com" });

    expect(result).toMatchObject({ kind: "ok", value: { published: {
      revision: 4, frozenAt: FROZEN_AT, contentHash: "d".repeat(64),
    } } });
    const decisions = (result as { value: { published: { decisions: Record<string, string> } } }).value.published.decisions;
    expect(decisions[FACT_KEY_PRO]).toBe("accepted_in_bulk");
    expect(decisions[SCOPE_KEY]).toBe("excluded");
    expect(decisions[QA_KEY]).toBe("pending");
  });

  it("keys the baseline to the published version's own items, not to the draft's", async () => {
    // Both fixtures above build the published payload as the draft payload with
    // only `review` swapped, so `geoV3ItemKeys(frozen.knowledge)` and
    // `geoV3ItemKeys(payload.knowledge)` return the same array and the argument
    // at the call site is unverifiable. Here the two generations genuinely
    // differ, which is the whole point of a published version.
    const base = completePayloadV3();
    const clone = () => JSON.parse(JSON.stringify(base.knowledge)) as Record<string, unknown> & {
      facts: { value: { itemKey: string }[] };
    };
    // The draft: the Team fact is gone (this generation did not find it) and
    // the scope statement is back.
    const draftKnowledge = clone();
    draftKnowledge.facts.value = draftKnowledge.facts.value.filter((fact) => fact.itemKey !== FACT_KEY_TEAM);
    const draft = parseGeoKbPayloadV3({ ...base, knowledge: draftKnowledge });
    // The published version: it held the Team fact and accepted it, and its own
    // knowledge no longer held the scope statement -- but the exclusion the
    // owner made of that statement outlived it, because `assertOverrideTargets`
    // cross-checks decisions against items and deliberately does not
    // cross-check suppressions.
    const publishedKnowledge = clone();
    publishedKnowledge.scope = { status: "unavailable", reason: "not_applicable" };
    const published = parseGeoKbPayloadV3({ ...base, knowledge: publishedKnowledge, review: {
      decisions: [{ itemKey: FACT_KEY_TEAM, decision: "accepted_in_bulk", override: null,
        baseContentHash: HASH_A, decidedAt: OBSERVED_AT, baseDraftVersion: "4" }],
      suppressions: [{ itemKey: SCOPE_KEY, suppressedAt: OBSERVED_AT }],
    } });

    const result = await createGeoKbV3EditorLoader(v3Fixture(v3Draft(draft, { frozen: frozenRef }), published))({ userId: USER, url: "https://example.com" });

    const decisions = (result as { value: { published: { decisions: Record<string, string> } } }).value.published.decisions;
    // Reading the draft's keys loses this: the published version accepted the
    // Team fact, and the publish box would have nothing to compare against.
    expect(decisions[FACT_KEY_TEAM]).toBe("accepted_in_bulk");
    // And it invents this: the published version's knowledge never held the
    // scope statement, so its baseline cannot say anything was decided about
    // it. Reading the draft's keys resurrects the suppression as `excluded`,
    // the draft reads `pending`, and the box reports a change nobody made.
    expect(Object.hasOwn(decisions, SCOPE_KEY)).toBe(false);
    expect(decisions[FACT_KEY_PRO]).toBe("pending");
  });

  it("refuses rather than inventing a decision baseline for a non-v3 published version", async () => {
    const result = await createGeoKbV3EditorLoader(v3Fixture(v3Draft(completePayloadV3(), { frozen: frozenRef }), upgradeGeoKbDraftToV2(legacy)))({ userId: USER, url: "https://example.com" });
    // The reason is pinned, not just the kind. Deleting the version check would
    // still produce `unavailable` -- reading a v2 payload's absent `review`
    // throws into the catch -- so a test that only asserted "not ok" would pass
    // over a loader that had stopped checking anything at all.
    expect(result).toEqual({ kind: "unavailable", reason: "v3_predecessor_unsupported" });
  });
});

describe("one editor entry point per knowledge base", () => {
  function anyLoader(details: VersionedGeoKbDetails) {
    const { deps } = fixture();
    const readDetails: GeoKbEditorLoaderDependencies["readDetails"] = async () => ({ kind: "ok", value: details });
    // Wrapped so "never reaches the v3 loader" can be asserted rather than
    // described. Without a spy the name below promises a property no assertion
    // in its body checks.
    const loadV3 = vi.fn(createGeoKbV3EditorLoader({ ensure: deps.ensure, readDetails, readFrozenPayload: async () => ({ kind: "unavailable", reason: "no snapshot" }) }));
    return { load: createGeoKbEditorLoaderAny(createGeoKbEditorLoader({ ...deps, readDetails }), loadV3), loadV3 };
  }

  it("answers a v1/v2 knowledge base with the v2 editor view and never reaches the v3 loader", async () => {
    const { details } = fixture();
    const { load, loadV3 } = anyLoader(details);
    const result = await load({ userId: USER, url: "https://example.com" });
    expect(result).toMatchObject({ kind: "ok", value: { schemaVersion: "marketing-geo-kb-editor.v2" } });
    // The second half of the name. The v2-first ordering exists so the common
    // path pays for one store read rather than two, and the test below -- which
    // records a call through this same wrapper -- is what makes this absence a
    // fact about the dispatch instead of a fact about the spy.
    expect(loadV3).not.toHaveBeenCalled();
  });

  it("answers a v3 knowledge base with the v3 review view, which is what makes the card reachable", async () => {
    const payload = completePayloadV3();
    const { load, loadV3 } = anyLoader(v3Draft(payload));
    const result = await load({ userId: USER, url: "https://example.com" });
    expect(result).toMatchObject({ kind: "ok", value: { schemaVersion: "marketing-geo-kb-editor.v3", draftVersion: 5, payload } });
    expect(loadV3).toHaveBeenCalledTimes(1);
  });

  it("keeps the v2 loader's own answer when it stopped for any other reason", async () => {
    const { deps, details } = fixture();
    const loader = createGeoKbEditorLoaderAny(
      createGeoKbEditorLoader({ ...deps, readDetails: async () => ({ kind: "unavailable", reason: "store down" }) }),
      createGeoKbV3EditorLoader(v3Fixture(v3Draft(completePayloadV3()))),
    );
    // A store outage over a knowledge base that does hold a v3 draft must not
    // be answered with the draft: the v2 loader never saw it, and the fallback
    // is a dispatch on one exact reason rather than on "anything went wrong".
    expect(await loader({ userId: USER, url: "https://example.com" })).toEqual({ kind: "unavailable", reason: "complete_editor_unavailable" });
    expect(details.draft.payload.schemaVersion).toBe("marketing-geo-kb.v1");
  });

  it("names the v3 draft as the reason the v2 loader stopped", async () => {
    const { deps } = fixture();
    const result = await createGeoKbEditorLoader({ ...deps, readDetails: async () => ({ kind: "ok", value: v3Draft(completePayloadV3()) }) })({ userId: USER, url: "https://example.com" });
    expect(result).toEqual({ kind: "unavailable", reason: GEO_KB_V3_DRAFT_REASON });
  });

  it("still names the v3 draft when the Profile store is the thing that is down", async () => {
    const { deps } = fixture();
    const readDetails: GeoKbEditorLoaderDependencies["readDetails"] = async () => ({ kind: "ok", value: v3Draft(completePayloadV3()) });
    const readProfile: GeoKbEditorLoaderDependencies["readProfile"] = async () => ({ kind: "unavailable" });

    // The control, with this exact fixture: a readable Profile store and the
    // same v3 draft. Without it the assertion below is satisfied by any
    // arrangement that answers with the reason for some other reason.
    expect(await createGeoKbEditorLoader({ ...deps, readDetails })({ userId: USER, url: "https://example.com" }))
      .toEqual({ kind: "unavailable", reason: GEO_KB_V3_DRAFT_REASON });

    const result = await createGeoKbEditorLoader({ ...deps, readDetails, readProfile })({ userId: USER, url: "https://example.com" });

    // The v3 card reads no Profile at all -- its facts come from the locked
    // generation input -- so a Profile outage has nothing to say about whether
    // a v3 knowledge base can be shown. Answering the generic reason here made
    // the website route report 503, which reads to the owner as the whole
    // knowledge base being gone for as long as the outage lasts.
    expect(result).toEqual({ kind: "unavailable", reason: GEO_KB_V3_DRAFT_REASON });

    // And the ordering did not weaken the v1/v2 path it sits in front of: a
    // Profile outage over a v1/v2 draft is still an outage.
    expect(await createGeoKbEditorLoader({ ...deps, readProfile })({ userId: USER, url: "https://example.com" }))
      .toEqual({ kind: "unavailable", reason: "complete_editor_unavailable" });
  });

  it("answers the v3 review view through the entry point while the Profile store is down", async () => {
    const payload = completePayloadV3();
    const { deps } = fixture();
    const details = v3Draft(payload);
    const readDetails: GeoKbEditorLoaderDependencies["readDetails"] = async () => ({ kind: "ok", value: details });
    const load = createGeoKbEditorLoaderAny(
      createGeoKbEditorLoader({ ...deps, readDetails, readProfile: async () => ({ kind: "unavailable" }) }),
      createGeoKbV3EditorLoader(v3Fixture(details)),
    );

    expect(await load({ userId: USER, url: "https://example.com" }))
      .toMatchObject({ kind: "ok", value: { schemaVersion: "marketing-geo-kb-editor.v3", payload } });
  });
});
