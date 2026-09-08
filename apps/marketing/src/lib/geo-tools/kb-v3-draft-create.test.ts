import { describe, expect, it, vi } from "vitest";

import {
  emptyMarketingWebsiteProfile,
  type MarketingWebsiteProfileV1,
  type WebsiteProfileReferenceV1,
} from "../account-websites/contracts.ts";
import { GEO_KB_LIMITS } from "./kb-contract.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { geoV3ItemKeys, parseGeoKbPayloadV3, type GeoKbPayloadV3 } from "./kb-v3-contract.ts";
import { geoV3ItemContentHashes } from "./kb-v3-item-content.ts";
import { applyGeoV3ReviewAction, geoV3DecisionStates, materializeGeoV3Review } from "./kb-v3-review.ts";
import { completePayloadV3, V3_SNAPSHOT_ID, V3_WEBSITE_ID } from "./kb-v3.test-fixtures.ts";
import { geoGenerationInputHashV3 } from "./kb-prepared-v3-contract.ts";
import { GEO_ABSENT_QUESTION_SET_HASH } from "./snapshot-context-v3.ts";
import {
  buildGeoKbV3Identity,
  createGeoKbDraftPayloadV3,
  GEO_ABSENT_EVIDENCE_CONTENT_HASH,
  GEO_KB_V3_RELEASED_REFS,
  geoProfileRefNamesConfirmed,
  handleGeoKbV3DraftCreate,
  lockGeoKbV3GenerationInput,
  relockGeoKbV3Payload,
  type GeoKbV3DraftCreateDependencies,
} from "./kb-v3-draft-create.ts";
import type { GeoKbV3SaveOutcome } from "./kb-v3-store.ts";
import type { VersionedGeoKbDetails } from "./kb-versioned-read.ts";

const USER_ID = "11111111-1111-8111-8111-111111111111";
const KB_ID = "11111111-1111-8111-8111-111111111113";
/** Stands for a digest a real collection would produce; never the sentinel. */
const EVIDENCE_HASH = "e".repeat(64);
const NOW = "2026-09-07T12:00:00.000Z";
const REFERENCE: WebsiteProfileReferenceV1 = {
  schemaVersion: "website-profile-reference.v1",
  websiteId: "11111111-1111-8111-8111-111111111114",
  snapshotId: "11111111-1111-8111-8111-111111111115",
  snapshotRevision: 3,
  profileSchemaVersion: "marketing-website-profile.v1",
  profileHash: "a".repeat(64),
};

function profile(overrides: Partial<MarketingWebsiteProfileV1> = {}): MarketingWebsiteProfileV1 {
  return {
    ...emptyMarketingWebsiteProfile(),
    productName: "AstrologyWiki",
    oneLinePositioning: "Charts for astrologers.",
    coreFeatures: ["birth charts"],
    categories: ["astrology software", "birth chart tools"],
    directCompetitors: ["astro.example", "Cafe Astrology"],
    country: "US",
    locale: "en",
    ...overrides,
  };
}

function identity(overrides: Partial<MarketingWebsiteProfileV1> = {}) {
  const build = buildGeoKbV3Identity({
    targetUrl: "https://example.com/",
    reference: REFERENCE,
    profile: profile(overrides),
  });
  if (build.kind !== "ok") throw new Error(`expected a usable Profile, got ${build.fields.join(",")}`);
  return build;
}

/* ------------------------------------------------------------------ */
/* The pure half                                                        */
/* ------------------------------------------------------------------ */

describe("buildGeoKbV3Identity", () => {
  it("derives the measurement identity from the confirmed Profile", () => {
    const build = identity();

    expect(build.identity.targetUrl).toBe("https://example.com/");
    expect(build.identity.officialName).toBe("AstrologyWiki");
    expect(build.identity.market).toEqual({ country: "US", language: "en" });
    expect(build.identity.categoryTerms).toEqual(["astrology software", "birth chart tools"]);
    // Derived, not copied: the alias list is the match table every later
    // mention judgement reads, and an empty one makes the knowledge base unable
    // to recognise its own name.
    expect(build.identity.aliases).toContain("AstrologyWiki");
    expect(build.identity.aliases).toContain("example.com");
    expect(build.blockers).toEqual([]);
  });

  it("names the Profile's competitors without confirming any of them", () => {
    const build = identity();

    expect(build.competitors).toEqual([
      { domain: "astro.example", brandName: "", confirmed: false },
      { domain: "", brandName: "Cafe Astrology", confirmed: false },
    ]);
    // Only a confirmed competitor is ever fetched or compared against, and
    // nobody has looked at these yet.
    expect(build.competitors.every((row) => !row.confirmed)).toBe(true);
  });

  it("drops the competitors past the number the locked input admits", () => {
    // Twelve distinct domains, because nothing upstream trims this list:
    // `buildGeoProfileSuggestions` maps `directCompetitors` one row per entry
    // and caps nothing. The slice in `competitorsFromProfile` is the only thing
    // that bounds it, so a build that kept what it was given would answer 12.
    const supplied = Array.from({ length: 12 }, (_value, index) => `rival${index}.example`);
    const build = identity({ directCompetitors: supplied });

    expect(supplied.length).toBeGreaterThan(GEO_KB_LIMITS.competitors);
    // Spelled out rather than sliced from the constant. An expectation written
    // as `supplied.slice(0, GEO_KB_LIMITS.competitors)` moves whenever the
    // constant moves, which is the one change this file exists to notice.
    expect(build.competitors.map((row) => row.domain)).toEqual([
      "rival0.example",
      "rival1.example",
      "rival2.example",
      "rival3.example",
      "rival4.example",
    ]);
    for (const dropped of ["rival5.example", "rival11.example"]) {
      expect(build.competitors.map((row) => row.domain)).not.toContain(dropped);
    }
  });

  it("keeps no more competitors than the locked generation input admits", () => {
    // The alignment guard, and the twin of "admits as many category terms as
    // the shared limit allows" below -- with a worse failure mode.
    // `competitorsFromProfile` slices at `GEO_KB_LIMITS.competitors` while
    // `geoGenerationInputSchema` bounds the same list by
    // `GEO_KNOWLEDGE_LIMITS.competitorIdentities`, and nothing couples them.
    // Competitors are never parsed inside `buildGeoKbV3Identity`, so a slice
    // wider than the contract cannot answer `unusable` with the failing field
    // named the way an over-long category list does: it throws out of
    // `lockGeoKbV3GenerationInput`, which the create route reports as
    // `draft_invalid` 422 over a Profile that is fine. Over-supplying is what
    // makes the slice, rather than the input, decide the length.
    const supplied = Array.from(
      { length: GEO_KB_LIMITS.competitors + 4 },
      (_value, index) => `rival${index}.example`,
    );
    const build = identity({ directCompetitors: supplied });

    expect(build.competitors).toHaveLength(GEO_KB_LIMITS.competitors);
    const locked = lockGeoKbV3GenerationInput(build, EVIDENCE_HASH);
    expect(locked.competitors).toHaveLength(GEO_KB_LIMITS.competitors);
  });

  it("deduplicates the category terms the Profile supplies", () => {
    const build = identity({
      categories: ["Astrology software", "astrology  software", "  ", "birth chart tools"],
    });

    expect(build.identity.categoryTerms).toEqual(["Astrology software", "birth chart tools"]);
  });

  it("caps the category terms below the number the Profile supplied", () => {
    // Twelve distinct terms, so the assertion is about the cap rather than
    // about the input: a build that kept what it was given would answer 12,
    // and one that kept more than the contract admits would not build at all.
    const supplied = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"];
    const build = identity({ categories: supplied });

    expect(supplied.length).toBeGreaterThan(8);
    expect(build.identity.categoryTerms).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
    for (const dropped of ["i", "j", "k", "l"]) expect(build.identity.categoryTerms).not.toContain(dropped);
  });

  it("admits as many category terms as the shared limit allows", () => {
    // The alignment guard. `cleanTerms` trims to `GEO_KB_LIMITS.categoryTerms`
    // and `geoGenerationInputSchema` writes its own maximum as a literal, so
    // raising the constant alone turns every Profile with that many categories
    // into a hard `profile_unusable` refusal. Deriving the input from the
    // constant is what makes that show up here rather than in production.
    const supplied = Array.from({ length: GEO_KB_LIMITS.categoryTerms }, (_value, index) => `term ${index}`);
    const build = buildGeoKbV3Identity({
      targetUrl: "https://example.com/",
      reference: REFERENCE,
      profile: profile({ categories: supplied }),
    });

    expect(build.kind).toBe("ok");
    if (build.kind !== "ok") return;
    expect(build.identity.categoryTerms).toEqual(supplied);
  });

  it("reports a language the question step cannot serve as a blocker, not a refusal", () => {
    const build = identity({ locale: "de" });

    expect(build.kind).toBe("ok");
    expect(build.blockers).toContain("unsupported_language");
  });

  it("reports a Profile with no usable category term as a blocker", () => {
    const build = identity({ categories: [] });

    expect(build.blockers).toContain("category_terms_missing");
  });

  it("refuses a Profile with no product name or no country/language pair, naming the fields", () => {
    const nameless = buildGeoKbV3Identity({ targetUrl: "https://example.com/", reference: REFERENCE, profile: profile({ productName: "  " }) });
    const marketless = buildGeoKbV3Identity({ targetUrl: "https://example.com/", reference: REFERENCE, profile: profile({ country: "", locale: "" }) });

    expect(nameless.kind).toBe("unusable");
    if (nameless.kind === "unusable") expect(nameless.fields).toEqual(["/subset/productName"]);
    expect(marketless.kind).toBe("unusable");
    if (marketless.kind === "unusable") expect(marketless.fields).toEqual(["/subset/country", "/subset/locale"]);
  });

  it("refuses a Profile the reference itself cannot hold", () => {
    const build = buildGeoKbV3Identity({
      targetUrl: "https://example.com/",
      reference: REFERENCE,
      profile: profile({ productName: "x".repeat(161) }),
    });

    expect(build.kind).toBe("unusable");
    if (build.kind === "unusable") expect(build.fields).toContain("/subset/productName");
  });
});

describe("createGeoKbDraftPayloadV3", () => {
  it("locks the generation input and leaves every generated half empty", () => {
    const generationInput = lockGeoKbV3GenerationInput(identity(), EVIDENCE_HASH);
    const payload = createGeoKbDraftPayloadV3(generationInput);

    expect(payload.knowledge).toBeNull();
    expect(payload.review).toEqual({ decisions: [], suppressions: [] });
    expect(generationInput.evidenceContentHash).toBe(EVIDENCE_HASH);
    // The roles step has not run. A seeded role would have to claim an
    // acceptance nobody made, because a locked input admits accepted roles only.
    expect(generationInput.roles).toEqual([]);
  });

  it("stores the digest of its own generation input, under both definitions of it", () => {
    const generationInput = lockGeoKbV3GenerationInput(identity(), EVIDENCE_HASH);
    const payload = createGeoKbDraftPayloadV3(generationInput);

    expect(payload.runRef.generationInputHash).toBe(geoV2Digest(generationInput));
    expect(payload.runRef.generationInputHash).toBe(geoGenerationInputHashV3(payload));
  });

  it("names no run and no generation", () => {
    const payload = createGeoKbDraftPayloadV3(lockGeoKbV3GenerationInput(identity(), EVIDENCE_HASH));

    // Writing a runId here would name a run that does not exist and would lock
    // the generation input against the very next save that has to re-lock it.
    expect(payload.runRef.runId).toBeNull();
    expect(payload.runRef.rolesGenerationId).toBeNull();
    expect(payload.runRef.knowledgeGenerationId).toBeNull();
    expect(payload.runRef.questionsGenerationId).toBeNull();
  });

  it("moves the locked hash when the evidence it was assembled from moves", () => {
    const first = createGeoKbDraftPayloadV3(lockGeoKbV3GenerationInput(identity(), EVIDENCE_HASH));
    const second = createGeoKbDraftPayloadV3(lockGeoKbV3GenerationInput(identity(), "f".repeat(64)));

    expect(second.runRef.generationInputHash).not.toBe(first.runRef.generationInputHash);
  });
});

describe("GEO_ABSENT_EVIDENCE_CONTENT_HASH", () => {
  it("is a fixed value, so a stored draft can be read years from now", () => {
    // Pinned to the literal rather than recomputed: recomputing it from the
    // same marker this module hashes would be the assertion agreeing with its
    // own input, and would say nothing if the marker changed. Every draft
    // created before such a change carries the old value, and something has to
    // notice that the meaning of a stored byte string moved.
    expect(GEO_ABSENT_EVIDENCE_CONTENT_HASH).toBe(
      "c23fbc5b9d4f51b37f38ca8d5beac13782a7ee73ed18ab020a06577c10a17e07",
    );
    expect(GEO_ABSENT_EVIDENCE_CONTENT_HASH).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("is a different absence from the one the question set uses", () => {
    // Both mean "this thing does not exist", and they are in different fields
    // of the same subsystem. Reusing `geoV2Digest(null)` for both would make a
    // row's two absences indistinguishable to anyone reading the table.
    expect(GEO_ABSENT_EVIDENCE_CONTENT_HASH).not.toBe(GEO_ABSENT_QUESTION_SET_HASH);
  });
});

/* ------------------------------------------------------------------ */
/* The HTTP boundary                                                    */
/* ------------------------------------------------------------------ */

function request(body: unknown): Request {
  return new Request("https://gengrowth.ai/api/tools/geo-knowledge-base/v3/draft", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

interface Harness {
  readonly dependencies: GeoKbV3DraftCreateDependencies;
  readonly saveDraft: ReturnType<typeof vi.fn>;
  /**
   * Spied on every harness, because reading the Profile is what this route does
   * *after* the guards that are supposed to stop it. "Was the owner's Profile
   * looked up" is how a test tells one 503 from another one.
   */
  readonly readProfile: ReturnType<typeof vi.fn>;
  readonly saved: { current: GeoKbPayloadV3 | null };
}

/** What the knowledge base row says about itself, before any of it is trusted. */
interface StoredKb {
  readonly kbId: string;
  readonly origin: string;
  readonly canonicalSiteKey: string;
  /**
   * The current published version, or the row's statement that there is none.
   *
   * Spelled out on every fixture rather than defaulted away by the handler: the
   * create guard treats anything that is not a definite `null` as a published
   * version, so a fake that simply omitted the field would be a fake the guard
   * refuses -- and, read the other way, a handler that stopped looking would
   * still pass a suite whose fixtures never mention it.
   */
  readonly frozen: VersionedGeoKbDetails["frozen"];
}

/** A published version, as the head row summarises one. Its schema is not in it. */
const PUBLISHED: NonNullable<VersionedGeoKbDetails["frozen"]> = {
  snapshotId: "0f2c8a41-7d63-4e58-b9a2-1c4d5e6f7081",
  revision: 2,
  contentHash: "c".repeat(64),
  questionSetHash: "d".repeat(64),
  questionCount: 12,
  frozenAt: "2026-09-06T10:00:00.000Z",
};

function harness(
  overrides: Partial<GeoKbV3DraftCreateDependencies> = {},
  draft: unknown = null,
  stored: Partial<StoredKb> = {},
): Harness {
  const saved: { current: GeoKbPayloadV3 | null } = { current: null };
  const saveDraft = vi.fn(
    async (input: { readonly payload: GeoKbPayloadV3; readonly baseVersion: number }): Promise<GeoKbV3SaveOutcome> => {
      saved.current = input.payload;
      return {
        kind: "ok",
        value: { draftVersion: input.baseVersion + 1, contentHash: geoV2Digest(input.payload), updatedAt: NOW },
      };
    },
  );
  const readProfile = vi.fn(
    overrides.readProfile ??
      (async () => ({
        kind: "ok" as const,
        canonicalSiteKey: "example.com",
        reference: REFERENCE,
        profile: profile(),
      })),
  );
  const dependencies: GeoKbV3DraftCreateDependencies = {
    authenticate: async () => ({ status: "authenticated", userId: USER_ID }) as never,
    readDetails: async () =>
      ({
        kind: "ok",
        value: {
          kbId: KB_ID,
          origin: "https://example.com",
          canonicalSiteKey: "example.com",
          frozen: null,
          ...stored,
          draft,
        },
      }) as never,
    saveDraft: saveDraft as never,
    ...overrides,
    readProfile: readProfile as never,
  };
  return { dependencies, saveDraft, readProfile, saved };
}

const body = (extra: Record<string, unknown> = {}) => ({ kbId: KB_ID, baseVersion: 0, ...extra });

describe("handleGeoKbV3DraftCreate", () => {
  it("creates the first v3 draft for a knowledge base that has none", async () => {
    const { dependencies, saved } = harness();

    const response = await handleGeoKbV3DraftCreate(request(body()), dependencies);

    expect(response.status).toBe(200);
    const payload = saved.current;
    expect(payload).not.toBeNull();
    if (payload === null) return;
    expect(payload.schemaVersion).toBe("marketing-geo-kb.v3");
    expect(payload.knowledge).toBeNull();
    expect(payload.generationInput.evidenceContentHash).toBe(GEO_ABSENT_EVIDENCE_CONTENT_HASH);
    // The whole reference, by value. `profileHash` is the field the database's
    // claimability check compares against the website's current confirmed
    // snapshot, so a draft that carried any other value would be claimable
    // against a Profile revision the owner never confirmed -- or, if it dropped
    // the field, claimable against none.
    expect(payload.generationInput.profileRef).toMatchObject({
      websiteId: REFERENCE.websiteId,
      snapshotId: REFERENCE.snapshotId,
      snapshotRevision: "3",
      profileHash: REFERENCE.profileHash,
    });
    const json = await response.json();
    expect(json.data).toEqual({
      kbId: KB_ID,
      draftVersion: 1,
      contentHash: geoV2Digest(payload),
      updatedAt: NOW,
      generationInputHash: payload.runRef.generationInputHash,
      blockers: [],
    });
  });

  it("reports the blockers the created draft carries", async () => {
    const { dependencies } = harness({
      readProfile: async () => ({ kind: "ok", canonicalSiteKey: "example.com", reference: REFERENCE, profile: profile({ locale: "de", categories: [] }) }),
    });

    const response = await handleGeoKbV3DraftCreate(request(body()), dependencies);

    expect(response.status).toBe(200);
    expect((await response.json()).data.blockers).toEqual(["unsupported_language", "category_terms_missing"]);
  });

  it("gives a client no field in which to author the locked half", async () => {
    const { dependencies, saveDraft } = harness();

    for (const extra of [
      { profileRef: { snapshotId: REFERENCE.snapshotId } },
      { evidenceContentHash: EVIDENCE_HASH },
      { generationInput: null },
      { roles: [] },
    ]) {
      const response = await handleGeoKbV3DraftCreate(request(body(extra)), dependencies);
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("invalid_request");
    }
    // And a whole payload never even reaches the parser: the body cap is one
    // kilobyte, which is more than a knowledge base id and a zero.
    const large = await handleGeoKbV3DraftCreate(request(body({ payload: completePayloadV3() })), dependencies);
    expect(large.status).toBe(413);
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("refuses a base version that is not zero, because a create replaces nothing", async () => {
    const { dependencies } = harness();

    const response = await handleGeoKbV3DraftCreate(request(body({ baseVersion: 4 })), dependencies);

    expect(response.status).toBe(400);
  });

  it("refuses to overwrite an existing v3 draft, and reads nothing else to find that out", async () => {
    const stored = completePayloadV3();
    const { dependencies, readProfile, saveDraft } = harness({}, {
      draftVersion: 4,
      payload: stored,
      contentHash: geoV2Digest(stored),
      updatedAt: NOW,
    });

    const response = await handleGeoKbV3DraftCreate(request(body()), dependencies);

    expect(response.status).toBe(409);
    // Naming it: this draft holds knowledge a run was paid for and the owner's
    // decisions, and replacing it is not a create.
    expect(await response.json()).toEqual({ error: { code: "draft_exists" }, draftVersion: 4 });
    expect(readProfile).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("refuses to overwrite a v1 or v2 draft with a different named reason", async () => {
    const legacy = { schemaVersion: "marketing-geo-kb.v2" };
    const { dependencies, saveDraft } = harness({}, { draftVersion: 2, payload: legacy, contentHash: "b".repeat(64), updatedAt: NOW });

    const response = await handleGeoKbV3DraftCreate(request(body()), dependencies);

    expect(response.status).toBe(409);
    // A v2 draft holds accepted facts and reviewed roles a v3 generation input
    // has no field for. That is an upgrade someone has to design, not a create.
    expect(await response.json()).toEqual({ error: { code: "legacy_draft" }, draftVersion: 2 });
    expect(saveDraft).not.toHaveBeenCalled();
  });

  /**
   * The refusal that used to live only in the browser.
   *
   * `geo-knowledge-base-v2.tsx` offers the start gesture on
   * `draftHash === null && frozen === null`. This route checked only the first
   * half, so a create carrying a published version and no draft was granted --
   * and if that version is v1/v2, `kb-editor-loader.ts` then answers
   * `v3_predecessor_unsupported` for that knowledge base forever, with no
   * gesture that undoes it.
   */
  it("refuses a create for a knowledge base that already has a published version", async () => {
    const { dependencies, readProfile, saveDraft } = harness({}, null, { frozen: PUBLISHED });

    const response = await handleGeoKbV3DraftCreate(request(body()), dependencies);

    expect(response.status).toBe(409);
    // Its own code: there is nothing here to load and nothing to convert, and
    // asking again will not change the answer. And no `draftVersion` -- there
    // is no draft, and a number in that field would read as one.
    expect(await response.json()).toEqual({ error: { code: "published_version_exists" } });
    // Refused before it looked at the owner's Profile and before it wrote
    // anything, so there is no half-made knowledge base behind this 409.
    expect(readProfile).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("still names the draft when a knowledge base has both a draft and a published version", async () => {
    // Order, stated as a test: the draft refusal is the more specific one and
    // the client already knows what to do with it. A guard that ran first would
    // replace `legacy_draft` -- "there is a v1/v2 draft here" -- with a sentence
    // about a published version, and the reload it asks for would find the
    // draft it was never told about.
    const legacy = { schemaVersion: "marketing-geo-kb.v2" };
    const { dependencies, saveDraft } = harness(
      {},
      { draftVersion: 2, payload: legacy, contentHash: "b".repeat(64), updatedAt: NOW },
      { frozen: PUBLISHED },
    );

    const response = await handleGeoKbV3DraftCreate(request(body()), dependencies);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: "legacy_draft" }, draftVersion: 2 });
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("leaves a create that lost a race to the store's compare-and-swap", async () => {
    // Nothing was there when the draft was read; something was there by the
    // time it was written. That is the one case that really is a conflict, and
    // it is the database that decides it.
    const { dependencies } = harness({ saveDraft: async () => ({ kind: "conflict", currentDraftVersion: 1 }) });

    const response = await handleGeoKbV3DraftCreate(request(body()), dependencies);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: "conflict" }, draftVersion: 1 });
  });

  it("refuses a Profile it cannot reference, naming the field, and writes nothing", async () => {
    const { dependencies, saveDraft } = harness({
      readProfile: async () => ({ kind: "ok", canonicalSiteKey: "example.com", reference: REFERENCE, profile: profile({ productName: "" }) }),
    });

    const response = await handleGeoKbV3DraftCreate(request(body()), dependencies);

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: { code: "profile_unusable" }, fields: ["/subset/productName"] });
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("distinguishes an unregistered site from one whose Profile nobody confirmed", async () => {
    const missing = await handleGeoKbV3DraftCreate(request(body()), harness({ readProfile: async () => ({ kind: "missing" }) }).dependencies);
    const unconfirmed = await handleGeoKbV3DraftCreate(request(body()), harness({ readProfile: async () => ({ kind: "unconfirmed" }) }).dependencies);

    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe("website_not_found");
    expect(unconfirmed.status).toBe(409);
    expect((await unconfirmed.json()).error.code).toBe("profile_not_confirmed");
  });

  it("refuses a Profile that belongs to another site", async () => {
    const { dependencies, readProfile, saveDraft } = harness({
      readProfile: async () => ({ kind: "ok", canonicalSiteKey: "other.example", reference: REFERENCE, profile: profile() }),
    });

    const response = await handleGeoKbV3DraftCreate(request(body()), dependencies);

    expect(response.status).toBe(503);
    // This is the Profile-side comparison, so the Profile has to have been read
    // for it to have happened at all -- which is what tells it apart from the
    // origin-side comparison two lines above it in the handler.
    expect(readProfile).toHaveBeenCalledTimes(1);
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("refuses a knowledge base row whose origin is not the site it is filed under", async () => {
    // The origin-side comparison. The Profile lookup takes the origin as its
    // argument, so a row whose origin and canonical key disagree would send the
    // lookup somewhere the knowledge base is not about -- and the Profile-side
    // check cannot catch it, because that Profile would agree with the row's
    // key. Asserting the Profile was never read is what pins *this* guard.
    const { dependencies, readProfile, saveDraft } = harness({}, null, { origin: "https://other.example" });

    const response = await handleGeoKbV3DraftCreate(request(body()), dependencies);

    expect(response.status).toBe(503);
    expect(readProfile).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("refuses a knowledge base row whose origin is not a usable address", async () => {
    const { dependencies, readProfile, saveDraft } = harness({}, null, { origin: "not a url" });

    const response = await handleGeoKbV3DraftCreate(request(body()), dependencies);

    expect(response.status).toBe(503);
    // Without the guard this reaches the Profile lookup and then throws on the
    // unparsed address, which the outer handler also answers 503 -- so the
    // status alone proves nothing and the call record is the assertion.
    expect(readProfile).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("refuses a store that answers with a different knowledge base than the one asked for", async () => {
    const { dependencies, readProfile, saveDraft } = harness({}, null, {
      kbId: "11111111-1111-8111-8111-111111111199",
    });

    const response = await handleGeoKbV3DraftCreate(request(body()), dependencies);

    // Nothing here is the owner's fault and nothing can be said about their
    // knowledge base, so the answer is that the store is unavailable -- and
    // the draft that would otherwise have been written under the *requested*
    // id, from another knowledge base's origin, is not written.
    expect(response.status).toBe(503);
    expect(readProfile).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("says no evidence has been observed, and leaves the input free to be re-locked", async () => {
    const { dependencies, saved } = harness();

    const response = await handleGeoKbV3DraftCreate(request(body()), dependencies);

    expect(response.status).toBe(200);
    const payload = saved.current;
    if (payload === null) throw new Error("expected a saved draft");
    expect(payload.generationInput.evidenceContentHash).toBe(GEO_ABSENT_EVIDENCE_CONTENT_HASH);
    // The two halves of the contract the collect/assemble step relies on. The
    // sentinel says the digest names nothing; the four null ids are the state
    // in which `marketing_geo_save_kb_draft` lets a later save move
    // `generationInputHash` to a real one. Either half alone is not the
    // promise: a draft with the sentinel and a generation id would be locked
    // to a hash that stands for nothing.
    expect(payload.runRef).toEqual({
      runId: null,
      generationInputHash: payload.runRef.generationInputHash,
      rolesGenerationId: null,
      knowledgeGenerationId: null,
      questionsGenerationId: null,
    });
  });

  it("refuses while a run is writing this draft", async () => {
    const { dependencies, readProfile, saveDraft } = harness({ generationRunning: async () => true });

    const response = await handleGeoKbV3DraftCreate(request(body()), dependencies);

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("generation_running");
    expect(readProfile).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("fails open when it cannot tell whether a run is writing", async () => {
    const { dependencies } = harness({ generationRunning: async () => "unavailable" });

    expect((await handleGeoKbV3DraftCreate(request(body()), dependencies)).status).toBe(200);
  });

  it("answers the store's own refusals in the store's own terms", async () => {
    const conflict = await handleGeoKbV3DraftCreate(request(body()), harness({ saveDraft: async () => ({ kind: "conflict", currentDraftVersion: 7 }) }).dependencies);
    const locked = await handleGeoKbV3DraftCreate(request(body()), harness({ saveDraft: async () => ({ kind: "input_locked" }) }).dependencies);
    const missing = await handleGeoKbV3DraftCreate(request(body()), harness({ saveDraft: async () => ({ kind: "missing" }) }).dependencies);
    const unavailable = await handleGeoKbV3DraftCreate(request(body()), harness({ saveDraft: async () => ({ kind: "unavailable", reason: "store_unavailable" }) }).dependencies);

    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: { code: "conflict" }, draftVersion: 7 });
    expect(locked.status).toBe(409);
    expect((await locked.json()).error.code).toBe("input_changed");
    expect(missing.status).toBe(404);
    expect(unavailable.status).toBe(503);
  });

  it("reports an unknown current version as null and never as a number", async () => {
    // The store answers `null` when the database did not hand back a usable
    // version. Turning that into -1 would put a value in a version field that
    // reads as a version, and every reader of this response would have to know
    // which numbers are not versions.
    const { dependencies } = harness({ saveDraft: async () => ({ kind: "conflict", currentDraftVersion: null }) });

    const response = await handleGeoKbV3DraftCreate(request(body()), dependencies);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: "conflict" }, draftVersion: null });
  });

  it("refuses a save whose stored digest is not the digest of what it sent", async () => {
    const { dependencies } = harness({
      saveDraft: async () => ({ kind: "ok", value: { draftVersion: 1, contentHash: "c".repeat(64), updatedAt: NOW } }),
    });

    expect((await handleGeoKbV3DraftCreate(request(body()), dependencies)).status).toBe(503);
  });

  it("refuses before reading anything when the caller is not the owner", async () => {
    const unauthenticated = await handleGeoKbV3DraftCreate(request(body()), harness({ authenticate: async () => ({ status: "unauthenticated" }) as never }).dependencies);
    const unavailable = await handleGeoKbV3DraftCreate(request(body()), harness({ authenticate: async () => ({ status: "unavailable" }) as never }).dependencies);

    expect(unauthenticated.status).toBe(401);
    expect(unavailable.status).toBe(503);
  });

  it("spends the quota before it reads anything", async () => {
    const { dependencies, readProfile, saveDraft } = harness({ consumeQuota: async () => "limited" });

    const response = await handleGeoKbV3DraftCreate(request(body()), dependencies);

    expect(response.status).toBe(429);
    expect(readProfile).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("reports a knowledge base that is not this owner's as absent", async () => {
    const { dependencies } = harness({ readDetails: async () => ({ kind: "missing" }) as never });

    expect((await handleGeoKbV3DraftCreate(request(body()), dependencies)).status).toBe(404);
  });

  it("saves a draft the v3 contract accepts", async () => {
    const { dependencies, saved } = harness();

    await handleGeoKbV3DraftCreate(request(body()), dependencies);

    expect(saved.current).not.toBeNull();
    expect(() => parseGeoKbPayloadV3(saved.current)).not.toThrow();
  });
});

/* ------------------------------------------------------------------ */
/* The re-lock                                                          */
/* ------------------------------------------------------------------ */

/** The revision the owner confirms while a knowledge base already exists. */
const NEXT_REFERENCE: WebsiteProfileReferenceV1 = {
  ...REFERENCE,
  snapshotId: "11111111-1111-8111-8111-111111111116",
  snapshotRevision: 4,
  profileHash: "b".repeat(64),
};
const ROLES_GENERATION_ID = "11111111-1111-8111-8111-111111111121";
const KNOWLEDGE_GENERATION_ID = "11111111-1111-8111-8111-111111111122";
const QUESTIONS_GENERATION_ID = "11111111-1111-8111-8111-111111111123";
const RUN_ID = "11111111-1111-8111-8111-111111111124";
const DECIDED_AT = "2026-09-06T00:00:00.000Z";
/** A suppression outlives the item it excluded, so its key names nothing. */
const SUPPRESSED_KEY = "f".repeat(64);

function nextIdentity(overrides: Partial<MarketingWebsiteProfileV1> = {}) {
  const build = buildGeoKbV3Identity({
    targetUrl: "https://example.com/",
    reference: NEXT_REFERENCE,
    profile: profile(overrides),
  });
  if (build.kind !== "ok") throw new Error(`expected a usable Profile, got ${build.fields.join(",")}`);
  return build;
}

/**
 * A knowledge base as it stands after a paid update: a knowledge body, a
 * decision on every item in it, a suppression that outlived an item, and the
 * generations that produced all of it named in `runRef`.
 *
 * Built through the shipped review helpers rather than hand-written, because a
 * hand-written decision could name a key the body does not contain and
 * `parseGeoKbPayloadV3` would refuse it -- which would make every assertion
 * below a fact about a fixture nobody could ever have stored.
 */
function reviewedPayloadV3(overrides: Partial<GeoKbPayloadV3> = {}): GeoKbPayloadV3 {
  const base = completePayloadV3();
  const itemKeys = geoV3ItemKeys(base.knowledge);
  const review = materializeGeoV3Review(
    base.review,
    applyGeoV3ReviewAction(geoV3DecisionStates(base.review, itemKeys), { kind: "accept_all", itemKeys }),
    { contentHash: geoV3ItemContentHashes(base.knowledge), decidedAt: DECIDED_AT, baseDraftVersion: "4" },
  );
  return parseGeoKbPayloadV3({
    ...base,
    review: { decisions: review.decisions, suppressions: [{ itemKey: SUPPRESSED_KEY, suppressedAt: DECIDED_AT }] },
    runRef: {
      ...base.runRef,
      runId: RUN_ID,
      rolesGenerationId: ROLES_GENERATION_ID,
      knowledgeGenerationId: KNOWLEDGE_GENERATION_ID,
      questionsGenerationId: QUESTIONS_GENERATION_ID,
    },
    ...overrides,
  });
}

/** The same draft over a patched generation input, with its recorded hash kept honest. */
function withGenerationInput(
  base: GeoKbPayloadV3,
  patch: Partial<GeoKbPayloadV3["generationInput"]>,
): GeoKbPayloadV3 {
  const generationInput = { ...base.generationInput, ...patch };
  return parseGeoKbPayloadV3({
    ...base,
    generationInput,
    runRef: { ...base.runRef, generationInputHash: geoV2Digest(generationInput) },
  });
}

function withCompetitors(
  base: GeoKbPayloadV3,
  competitors: GeoKbPayloadV3["generationInput"]["competitors"],
): GeoKbPayloadV3 {
  return withGenerationInput(base, { competitors });
}

describe("geoProfileRefNamesConfirmed", () => {
  it("agrees with the fixture about which revision the stored draft names", () => {
    // The rest of this block compares a stored `profileRef` against `REFERENCE`,
    // and every one of those assertions would be measuring nothing if the two
    // had drifted apart. Pinned here rather than assumed.
    const stored = completePayloadV3().generationInput.profileRef;
    expect(stored.websiteId).toBe(V3_WEBSITE_ID);
    expect(stored.snapshotId).toBe(V3_SNAPSHOT_ID);
    expect({ websiteId: REFERENCE.websiteId, snapshotId: REFERENCE.snapshotId, revision: REFERENCE.snapshotRevision, hash: REFERENCE.profileHash })
      .toEqual({ websiteId: V3_WEBSITE_ID, snapshotId: V3_SNAPSHOT_ID, revision: 3, hash: stored.profileHash });
  });

  it("answers true for the confirmed revision and false for each field on its own", () => {
    const stored = completePayloadV3().generationInput.profileRef;

    expect(geoProfileRefNamesConfirmed(stored, REFERENCE)).toBe(true);
    // One field at a time, because a predicate that dropped any single
    // comparison would still answer correctly for a reference that moved all
    // four -- and the database compares all four.
    expect(geoProfileRefNamesConfirmed({ ...stored, websiteId: "11111111-1111-8111-8111-1111111111ff" }, REFERENCE)).toBe(false);
    expect(geoProfileRefNamesConfirmed({ ...stored, snapshotId: NEXT_REFERENCE.snapshotId }, REFERENCE)).toBe(false);
    expect(geoProfileRefNamesConfirmed({ ...stored, snapshotRevision: "4" }, REFERENCE)).toBe(false);
    expect(geoProfileRefNamesConfirmed({ ...stored, profileHash: "b".repeat(64) }, REFERENCE)).toBe(false);
  });

  it("reads a reference that differs only in letter case as stale, because the database does", () => {
    // `marketing_geo_generation_input_current` compares `v_website.id::text`,
    // and PostgreSQL renders a uuid lower case, so an upper-case stored id is
    // refused by the database forever. Folding case here would report such a
    // draft as healthy while every paid claim it made was refused.
    const lower = "aaaaaaaa-1111-8111-8111-111111111114";
    const stored = completePayloadV3().generationInput.profileRef;

    expect(
      geoProfileRefNamesConfirmed({ ...stored, websiteId: lower.toUpperCase() }, { ...REFERENCE, websiteId: lower }),
    ).toBe(false);
    expect(geoProfileRefNamesConfirmed({ ...stored, websiteId: lower }, { ...REFERENCE, websiteId: lower })).toBe(true);
  });

  it("ignores the carried subset, which the database never reads", () => {
    // A change to `kb-profile-subset.ts` moves `subset`/`subsetHash` without
    // the owner confirming anything. Treating that as stale would forfeit a
    // paid knowledge body to fix a claim the database was never going to refuse.
    const stored = completePayloadV3().generationInput.profileRef;
    const moved = {
      ...stored,
      subsetHash: "c".repeat(64),
      subset: { ...stored.subset, oneLinePositioning: "Charts, but the projection changed." },
    };

    expect(geoProfileRefNamesConfirmed(moved, REFERENCE)).toBe(true);
  });
});

describe("relockGeoKbV3Payload", () => {
  it("clears every runRef id, which is the only release the database accepts", () => {
    const stored = reviewedPayloadV3();
    expect(Object.values(stored.runRef).filter((value) => value !== null && value !== stored.runRef.generationInputHash))
      .toHaveLength(4);

    const { payload, discarded } = relockGeoKbV3Payload(stored, nextIdentity());

    // Each named, not counted: `marketing_geo_save_kb_draft` permits the hash
    // to move only when all four are empty in the incoming payload, so a
    // release that left one behind would be refused as `generation_input_locked`.
    expect(payload.runRef.runId).toBeNull();
    expect(payload.runRef.rolesGenerationId).toBeNull();
    expect(payload.runRef.knowledgeGenerationId).toBeNull();
    expect(payload.runRef.questionsGenerationId).toBeNull();
    expect(payload.runRef.generationInputHash).not.toBe(stored.runRef.generationInputHash);
    expect(payload.runRef.generationInputHash).toBe(geoV2Digest(payload.generationInput));
    expect(discarded.released).toEqual([...GEO_KB_V3_RELEASED_REFS]);
  });

  it("discards the paid body and the review made over it, and says so", () => {
    const stored = reviewedPayloadV3();
    expect(stored.knowledge).not.toBeNull();
    expect(stored.review.decisions.length).toBeGreaterThan(0);

    const { payload, discarded } = relockGeoKbV3Payload(stored, nextIdentity());

    // Not a policy: `handleGeoKbV3Publish` checks a knowledge binding only when
    // `knowledgeGenerationId` is non-null, so a body kept across the release
    // would publish unchecked under an input it was never generated against.
    expect(payload.knowledge).toBeNull();
    expect(payload.review).toEqual({ decisions: [], suppressions: [] });
    expect(payload.generationInput.roles).toEqual([]);
    expect(discarded.knowledge).toBe(true);
    expect(discarded.decisions).toBe(stored.review.decisions.length);
    expect(discarded.suppressions).toBe(1);
    expect(discarded.roles).toBe(stored.generationInput.roles.length);
    expect(stored.generationInput.roles.length).toBeGreaterThan(0);
  });

  it("rebinds the locked half to the newly confirmed revision", () => {
    const stored = reviewedPayloadV3();

    const { payload } = relockGeoKbV3Payload(stored, nextIdentity({ productName: "Acme Two" }));

    expect(payload.generationInput.profileRef).toMatchObject({
      websiteId: NEXT_REFERENCE.websiteId,
      snapshotId: NEXT_REFERENCE.snapshotId,
      snapshotRevision: "4",
      profileHash: NEXT_REFERENCE.profileHash,
    });
    expect(payload.generationInput.identity.officialName).toBe("Acme Two");
    expect(geoProfileRefNamesConfirmed(payload.generationInput.profileRef, NEXT_REFERENCE)).toBe(true);
    expect(geoProfileRefNamesConfirmed(payload.generationInput.profileRef, REFERENCE)).toBe(false);
  });

  it("keeps the evidence the input was bound to rather than claiming none was ever seen", () => {
    // A Profile edit did not change the site's pages. Resetting this to the
    // absent sentinel would erase a true statement and oblige the next run to
    // spend a crawl admission re-learning it.
    const stored = withGenerationInput(reviewedPayloadV3(), { evidenceContentHash: EVIDENCE_HASH });
    expect(stored.generationInput.evidenceContentHash).toBe(EVIDENCE_HASH);

    const { payload } = relockGeoKbV3Payload(stored, nextIdentity());

    expect(payload.generationInput.evidenceContentHash).toBe(EVIDENCE_HASH);
    expect(payload.generationInput.evidenceContentHash).not.toBe(GEO_ABSENT_EVIDENCE_CONTENT_HASH);
  });

  it("carries the owner's competitor confirmation, the name it was made under, and its aliases", () => {
    // `confirmed` is not a Profile field; it is a judgement about a rival, and
    // only a confirmed competitor is ever fetched or compared against. Resetting
    // it would quietly shrink what the next update measures.
    const base = reviewedPayloadV3();
    const confirmed = [{ domain: "astro.example", brandName: "Astro", confirmed: true, aliases: ["Astro Charts"] }];
    const stored = withCompetitors(base, confirmed);
    // The partial case this has to be able to express, and the common one: the
    // Profile lists the rival as a bare domain, so the recomputed row carries no
    // name at all. A carry that moved only the flag would produce a payload
    // `competitorSchema` refuses -- a confirmed row must name what was confirmed.
    expect(nextIdentity().competitors).toContainEqual({ domain: "astro.example", brandName: "", confirmed: false });

    const { payload } = relockGeoKbV3Payload(stored, nextIdentity());

    expect(payload.generationInput.competitors).toContainEqual({
      domain: "astro.example", brandName: "Astro", confirmed: true, aliases: ["Astro Charts"],
    });
  });

  it("keeps the Profile's spelling where the Profile has one, and forgets a rival it dropped", () => {
    // The two shapes a Profile entry can take are the whole of this branch. A
    // bare host yields a row with no name (covered above); anything with a
    // space yields a named row, and there the Profile's spelling is the answer
    // -- the carried name only ever fills a gap.
    const stored = withCompetitors(reviewedPayloadV3(), [
      { domain: "", brandName: "cafe astrology", confirmed: true },
      { domain: "gone.example", brandName: "Gone", confirmed: true },
    ]);

    const { payload } = relockGeoKbV3Payload(stored, nextIdentity({ directCompetitors: ["Cafe Astrology"] }));

    expect(payload.generationInput.competitors).toEqual([
      { domain: "", brandName: "Cafe Astrology", confirmed: true },
    ]);
    // A rival the owner removed from the Profile is gone, confirmation
    // included: the Profile is where the set of rivals lives.
    expect(payload.generationInput.competitors.map((row) => row.domain)).not.toContain("gone.example");
  });

  it("produces exactly the payload the creator would produce, when there is nothing to carry", () => {
    // The property that keeps "a re-locked draft" and "a created draft" from
    // drifting into two shapes. It holds over a draft carrying no owner state:
    // unconfirmed competitors and no evidence yet -- which is every draft this
    // deployment can currently produce.
    const built = nextIdentity();
    const bare = createGeoKbDraftPayloadV3(lockGeoKbV3GenerationInput(built, GEO_ABSENT_EVIDENCE_CONTENT_HASH));
    // The competitors the rebuild will produce, so there is nothing to carry --
    // which is the condition of the property, not a way of satisfying it.
    const stored = withCompetitors(
      withGenerationInput(reviewedPayloadV3(), { evidenceContentHash: GEO_ABSENT_EVIDENCE_CONTENT_HASH }),
      [...built.competitors],
    );

    const { payload } = relockGeoKbV3Payload(stored, built);

    expect(geoV2Digest(payload)).toBe(geoV2Digest(bare));
    // ...and not because both sides are empty: the stored draft really did hold
    // the knowledge, review and generation ids that the re-lock dropped.
    expect(stored.knowledge).not.toBeNull();
    expect(stored.runRef.knowledgeGenerationId).toBe(KNOWLEDGE_GENERATION_ID);
  });
});

/**
 * A knowledge base holding a reviewed, paid v3 draft, and a Profile read that
 * answers with whichever confirmed revision the test is about.
 */
function relockHarness(options: {
  readonly payload?: GeoKbPayloadV3;
  readonly draftVersion?: number;
  readonly draft?: unknown;
  readonly reference?: WebsiteProfileReferenceV1;
  readonly profile?: MarketingWebsiteProfileV1;
  readonly overrides?: Partial<GeoKbV3DraftCreateDependencies>;
  /** What the head row says about a published version, when a test is about one. */
  readonly stored?: Partial<StoredKb>;
} = {}) {
  const payload = options.payload ?? reviewedPayloadV3();
  const draftVersion = options.draftVersion ?? 4;
  const contentHash = geoV2Digest(payload);
  const draft = options.draft === undefined ? { draftVersion, payload, contentHash, updatedAt: NOW } : options.draft;
  const built = harness(
    {
      readProfile: async () => ({
        kind: "ok",
        canonicalSiteKey: "example.com",
        reference: options.reference ?? NEXT_REFERENCE,
        profile: options.profile ?? profile(),
      }),
      ...options.overrides,
    },
    draft,
    options.stored ?? {},
  );
  return { ...built, payload, draftVersion, contentHash };
}

const relockBody = (extra: Record<string, unknown> = {}) => ({
  kbId: KB_ID,
  intent: "relock",
  baseVersion: 4,
  draftHash: geoV2Digest(reviewedPayloadV3()),
  ...extra,
});

describe("handleGeoKbV3DraftCreate: the re-lock", () => {
  it("rebinds the draft to the newly confirmed revision and releases what it forfeits", async () => {
    const h = relockHarness();

    const response = await handleGeoKbV3DraftCreate(request(relockBody()), h.dependencies);

    expect(response.status).toBe(200);
    const written = h.saved.current;
    expect(written).not.toBeNull();
    if (written === null) return;
    // The compare-and-swap the store performs is against the version this call
    // actually read, not against whatever the request happened to say.
    expect(h.saveDraft.mock.calls[0]![0]!.baseVersion).toBe(4);
    expect(geoProfileRefNamesConfirmed(written.generationInput.profileRef, NEXT_REFERENCE)).toBe(true);
    expect(written.runRef).toEqual({
      runId: null,
      generationInputHash: geoV2Digest(written.generationInput),
      rolesGenerationId: null,
      knowledgeGenerationId: null,
      questionsGenerationId: null,
    });
    expect(written.knowledge).toBeNull();
    expect(await response.json()).toEqual({
      data: {
        kbId: KB_ID,
        relocked: true,
        draftVersion: 5,
        contentHash: geoV2Digest(written),
        updatedAt: NOW,
        generationInputHash: written.runRef.generationInputHash,
        profileRef: { snapshotId: NEXT_REFERENCE.snapshotId, snapshotRevision: "4" },
        blockers: [],
        discarded: {
          knowledge: true,
          decisions: h.payload.review.decisions.length,
          suppressions: 1,
          roles: 1,
          released: ["runId", "rolesGenerationId", "knowledgeGenerationId", "questionsGenerationId"],
        },
      },
    });
    expect(h.payload.review.decisions.length).toBeGreaterThan(0);
  });

  it("re-locks a draft that stands over a published version, which the create guard does not cover", async () => {
    // The published-version guard is on the create path only, and deliberately.
    // A re-lock replaces a v3 draft that already exists; refusing it here would
    // take away the one writer that can move a locked input, without making the
    // published version any more readable than it was.
    const h = relockHarness({ stored: { frozen: PUBLISHED } });

    const response = await handleGeoKbV3DraftCreate(request(relockBody()), h.dependencies);

    expect(response.status).toBe(200);
    expect((await response.json()).data.relocked).toBe(true);
    expect(h.saveDraft).toHaveBeenCalledTimes(1);
  });

  it("writes nothing when the draft still names the confirmed revision", async () => {
    // The content-idempotent half. Without this branch a caller that asked
    // routinely would discard a paid knowledge body on every single call.
    const h = relockHarness({ reference: REFERENCE });

    const response = await handleGeoKbV3DraftCreate(request(relockBody()), h.dependencies);

    expect(response.status).toBe(200);
    expect(h.saveDraft).not.toHaveBeenCalled();
    expect(h.saved.current).toBeNull();
    // No `discarded`, and no `blockers`: nothing was destroyed and nothing was
    // built, and a zeroed `discarded` here would be indistinguishable from a
    // re-lock that happened to destroy nothing.
    expect(await response.json()).toEqual({
      data: {
        kbId: KB_ID,
        relocked: false,
        draftVersion: 4,
        contentHash: h.contentHash,
        updatedAt: NOW,
        generationInputHash: h.payload.runRef.generationInputHash,
        profileRef: { snapshotId: REFERENCE.snapshotId, snapshotRevision: "3" },
      },
    });
  });

  it("refuses a request that does not name the exact draft it is about to discard", async () => {
    const stale = await handleGeoKbV3DraftCreate(request(relockBody({ draftHash: "c".repeat(64) })), relockHarness().dependencies);
    const wrongVersion = await handleGeoKbV3DraftCreate(request(relockBody({ baseVersion: 3 })), relockHarness().dependencies);

    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: { code: "conflict" }, draftVersion: 4 });
    expect(wrongVersion.status).toBe(409);
    expect(await wrongVersion.json()).toEqual({ error: { code: "conflict" }, draftVersion: 4 });
    // The control, so neither refusal above is a request that was malformed for
    // some other reason: the same harness answers 200 for the honest request.
    expect((await handleGeoKbV3DraftCreate(request(relockBody()), relockHarness().dependencies)).status).toBe(200);
  });

  it("refuses to re-lock what it cannot re-lock, and reads no Profile to find out", async () => {
    const none = relockHarness({ draft: null });
    const legacy = relockHarness({
      draft: { draftVersion: 4, payload: { schemaVersion: "marketing-geo-kb.v2" }, contentHash: "d".repeat(64), updatedAt: NOW },
    });

    const missing = await handleGeoKbV3DraftCreate(request(relockBody()), none.dependencies);
    const v2 = await handleGeoKbV3DraftCreate(request(relockBody()), legacy.dependencies);

    // A re-lock replaces a draft; it never creates one, and it has no upgrade
    // path from v1/v2 -- two different next steps, so two different codes.
    expect(missing.status).toBe(404);
    expect(v2.status).toBe(409);
    expect(await v2.json()).toEqual({ error: { code: "legacy_draft" }, draftVersion: 4 });
    expect(none.readProfile).not.toHaveBeenCalled();
    expect(legacy.readProfile).not.toHaveBeenCalled();
    expect(none.saveDraft).not.toHaveBeenCalled();
    expect(legacy.saveDraft).not.toHaveBeenCalled();
  });

  it("refuses while a generation is dispatched, because the release would orphan it", async () => {
    const running = relockHarness({ overrides: { generationRunning: async () => true } });
    const settled = relockHarness({ overrides: { generationRunning: async () => false } });

    const refused = await handleGeoKbV3DraftCreate(request(relockBody()), running.dependencies);
    const allowed = await handleGeoKbV3DraftCreate(request(relockBody()), settled.dependencies);

    expect(refused.status).toBe(409);
    expect((await refused.json()).error.code).toBe("generation_running");
    expect(running.saveDraft).not.toHaveBeenCalled();
    // The control: the same request with nothing in flight re-locks, so the
    // refusal above is the running generation and not some earlier gate.
    expect(allowed.status).toBe(200);
    expect(settled.saveDraft).toHaveBeenCalledTimes(1);
  });

  it("reports the blockers the re-locked draft carries", async () => {
    const h = relockHarness({ profile: profile({ locale: "de", categories: [] }) });

    const response = await handleGeoKbV3DraftCreate(request(relockBody()), h.dependencies);

    expect(response.status).toBe(200);
    expect((await response.json()).data.blockers).toEqual(["unsupported_language", "category_terms_missing"]);
  });

  it("refuses an unusable Profile with its fields named, and writes nothing", async () => {
    const h = relockHarness({ profile: profile({ productName: "   " }) });

    const response = await handleGeoKbV3DraftCreate(request(relockBody()), h.dependencies);

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("profile_unusable");
    // The draft the owner has is worth more than a half-made replacement.
    expect(h.saveDraft).not.toHaveBeenCalled();
  });

  it("never reports a re-lock the database refused to perform", async () => {
    // Unreachable through `relockGeoKbV3Payload`, which clears all four ids --
    // and asserted anyway, because the one thing that must not happen if the
    // release ever stops satisfying the database is a success body.
    const locked = relockHarness({ overrides: { saveDraft: async () => ({ kind: "input_locked" }) } });
    const conflict = relockHarness({ overrides: { saveDraft: async () => ({ kind: "conflict", currentDraftVersion: null }) } });

    const refused = await handleGeoKbV3DraftCreate(request(relockBody()), locked.dependencies);
    const raced = await handleGeoKbV3DraftCreate(request(relockBody()), conflict.dependencies);

    expect(refused.status).toBe(409);
    expect((await refused.json()).error.code).toBe("input_changed");
    expect(raced.status).toBe(409);
    // Null, never -1: a version field holding -1 reads as a version and is not
    // one. The store answers null when the database gave it nothing usable.
    expect(await raced.json()).toEqual({ error: { code: "conflict" }, draftVersion: null });
  });

  it("takes no re-lock it was not asked for by name", async () => {
    const h = relockHarness();

    for (const extra of [{ intent: "reset" }, { intent: undefined }, { draftHash: undefined }, { baseVersion: 0 }]) {
      const body = { ...relockBody(), ...extra } as Record<string, unknown>;
      for (const [key, value] of Object.entries(extra)) if (value === undefined) delete body[key];
      const response = await handleGeoKbV3DraftCreate(request(body), h.dependencies);
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("invalid_request");
    }
    expect(h.saveDraft).not.toHaveBeenCalled();
  });
});
