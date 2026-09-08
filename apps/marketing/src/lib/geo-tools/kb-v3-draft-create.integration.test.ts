// @input -- only a named loopback disposable Marketing database and synthetic values
// @output -- proof that a v3 draft can be created, claimed against, reviewed and published
// @pos -- real SQL tests, never a provider or production invocation

/**
 * The reachability proof for the v3 chain.
 *
 * A unit test cannot make this claim. `saveGeoKbDraftV3` had no caller that did
 * not already require a v3 draft, so the whole feature was unreachable, and a
 * green unit suite over fakes is exactly what that state looked like. This file
 * therefore drives the real route handlers through the real stores against the
 * real functions:
 *
 *   1. create the draft through the v3/draft handler,
 *   2. show `marketing_geo_generation_input_current` now answers *true* for it,
 *      which is what makes the roles step -- the first paid step -- claimable
 *      at all, and false for the two things it exists to refuse,
 *   3. review the draft through the review handler,
 *   4. publish it through the publish handler and read the version back.
 *
 * Step 3 needs knowledge, and nothing writes v3 knowledge yet (the assembly
 * step is a separate, concurrent piece of work). It is written here through the
 * same `saveGeoKbDraftV3` that step will use, over the generation input this
 * file's own creator locked -- so what the chain is shown to survive is a real
 * created draft, not a fixture.
 */
import { createHash, randomUUID } from "node:crypto";

import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { connectFreshMarketingSchema } from "../credits/sql-test-harness.ts";
import {
  canonicalProfileJson,
  emptyMarketingWebsiteProfile,
  profileSha256,
  type MarketingWebsiteProfileV1,
} from "../account-websites/contracts.ts";
import type { GeoKbRpcTransport } from "./kb-generation-store.ts";
import { createGeoKbGenerationStore } from "./kb-generation-store.ts";
import type { GeoKbStoreDependencies } from "./kb-store.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { GEO_ABSENT_EVIDENCE_CONTENT_HASH, handleGeoKbV3DraftCreate } from "./kb-v3-draft-create.ts";
import { handleGeoKbV3Publish } from "./kb-v3-publish-handler.ts";
import { handleGeoKbV3Review } from "./kb-v3-review-handler.ts";
import { createGeoKbV3Runtime } from "./kb-v3-runtime.ts";
import { publishGeoKbV3, readGeoKbGenerationSummaryV3, saveGeoKbDraftV3 } from "./kb-v3-store.ts";
import { parseGeoKbPayloadV3, type GeoKbPayloadV3 } from "./kb-v3-contract.ts";
import { emptyGeoKbPayload, type GeoKbValue } from "./kb-contract.ts";
import { geoKbDigest } from "./kb-digest.ts";
import { buildGeoQuestionSet, geoQuestionSetDigest } from "./kb-questions.ts";
import { readVersionedGeoKnowledgeBase } from "./kb-versioned-read.ts";
import { completePayloadV3, FACT_KEY_PRO } from "./kb-v3.test-fixtures.ts";

let db: Client;
beforeAll(async () => {
  db = await connectFreshMarketingSchema();
});
afterAll(async () => {
  await db?.end();
});

const ORIGIN = "https://example.com";
const TARGET_URL = "https://example.com/";
/** A digest a real collection could produce, for the re-lock below. */
const COLLECTED_EVIDENCE_HASH = "e".repeat(64);
const NOW = new Date("2026-09-07T00:00:00.000Z");

function profile(overrides: Partial<MarketingWebsiteProfileV1> = {}): MarketingWebsiteProfileV1 {
  return {
    ...emptyMarketingWebsiteProfile(),
    productName: "Acme",
    oneLinePositioning: "Charts for astrologers.",
    coreFeatures: ["birth charts"],
    categories: ["astrology software"],
    directCompetitors: ["astro.example"],
    country: "US",
    locale: "en",
    ...overrides,
  };
}

/**
 * The digest the Profile store itself computes for a confirmed revision.
 * Written the synchronous way and pinned against `profileSha256` below, so a
 * fixture cannot agree with itself while disagreeing with production.
 */
function profileHash(value: MarketingWebsiteProfileV1): string {
  return createHash("sha256").update(canonicalProfileJson(value), "utf8").digest("hex");
}

/**
 * PostgREST hands every value back as JSON, so a timestamp reaches the stores
 * as an ISO string. `pg` hands back a `Date`, and the store parsers require a
 * string -- so a transport that skipped this would make every real save look
 * unavailable *after* it had already written the row: the loudest possible way
 * to prove a passing test can be measuring the harness.
 */
function jsonRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]),
  );
}

/**
 * Supabase's `rpc(name, params)` over a plain pg client, so the store modules
 * under test are the real ones. Named argument notation, because the store
 * passes an object and the parameter order is the function's business.
 */
function rpcTransport(): GeoKbRpcTransport {
  return {
    callRpc: async (name, params) => {
      const keys = Object.keys(params);
      const call = keys.map((key, index) => `${key} => $${index + 1}`).join(",");
      try {
        const result = await db.query(
          `select * from public.${name}(${call})`,
          keys.map((key) => {
            const value = params[key];
            return value !== null && typeof value === "object" ? JSON.stringify(value) : value;
          }),
        );
        return { data: result.rows.map(jsonRow), error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
  };
}

/** The three-table bundle `readVersionedGeoKnowledgeBase` parses, read directly. */
function storeDependencies(): GeoKbStoreDependencies {
  const transport = rpcTransport();
  return {
    readList: async () => ({ kind: "ok", data: { knowledgeBases: [], drafts: [], snapshots: [] } }),
    readDetails: async (userId, kbId) => {
      const bases = await db.query(
        "select id,user_id,canonical_site_key,origin,host,current_frozen_snapshot_id,created_at,updated_at from public.marketing_geo_knowledge_bases where user_id=$1 and id=$2",
        [userId, kbId],
      );
      if (bases.rows.length === 0) return { kind: "ok", data: { knowledgeBases: [], drafts: [], snapshots: [] } };
      const drafts = await db.query(
        "select kb_id,user_id,schema_version,draft_version,content_hash,updated_at,payload from public.marketing_geo_kb_drafts where user_id=$1 and kb_id=$2",
        [userId, kbId],
      );
      const frozenId = bases.rows[0]!.current_frozen_snapshot_id as string | null;
      const snapshots = frozenId === null ? { rows: [] } : await db.query(
        "select id,kb_id,user_id,revision,schema_version,content_hash,question_set_hash,prepared_id,frozen_at,question_set,payload from public.marketing_geo_kb_snapshots where user_id=$1 and kb_id=$2 and id=$3",
        [userId, kbId, frozenId],
      );
      return {
        kind: "ok",
        data: {
          knowledgeBases: bases.rows.map(jsonRow),
          drafts: drafts.rows.map(jsonRow),
          snapshots: snapshots.rows.map(jsonRow),
        },
      };
    },
    readSnapshot: async () => ({ kind: "ok", data: null }),
    // The two transports do not share a result shape: this one says whether the
    // call worked, the rpc one hands back the driver's error object.
    callRpc: async (name, params) => {
      const result = await transport.callRpc(name, params);
      return result.error === null ? { kind: "ok", data: result.data } : { kind: "error", code: null };
    },
  };
}

interface Fixture {
  readonly userId: string;
  readonly kbId: string;
  readonly websiteId: string;
  readonly snapshotId: string;
  readonly profile: MarketingWebsiteProfileV1;
  readonly runtime: ReturnType<typeof createGeoKbV3Runtime>;
}

/** One owner with a website, a confirmed Profile revision and an empty knowledge base. */
async function fixture(value: MarketingWebsiteProfileV1 = profile()): Promise<Fixture> {
  const userId = randomUUID();
  const websiteId = randomUUID();
  const snapshotId = randomUUID();
  const upserted = await db.query(
    "select * from public.marketing_geo_upsert_kb($1,$2,'example.com','example.com')",
    [userId, ORIGIN],
  );
  const kbId = upserted.rows[0]!.kb_id as string;
  await db.query(
    "insert into public.marketing_websites(id,user_id,canonical_site_key,origin,submitted_url,host) values($1,$2,'example.com',$3,$3,'example.com')",
    [websiteId, userId, ORIGIN],
  );
  await db.query(
    "insert into public.marketing_website_profile_snapshots(id,website_id,user_id,revision,schema_version,profile,content_hash,source_draft_version) values($1,$2,$3,3,'marketing-website-profile.v1',$4,$5,1)",
    [snapshotId, websiteId, userId, JSON.stringify(value), profileHash(value)],
  );
  await db.query("update public.marketing_websites set current_confirmed_snapshot_id=$1 where id=$2", [snapshotId, websiteId]);

  const transport = rpcTransport();
  const store = storeDependencies();
  const runtime = createGeoKbV3Runtime({
    authenticate: async () => ({ status: "authenticated", userId }) as never,
    readDetails: (input) => readVersionedGeoKnowledgeBase(input, store),
    saveDraft: (input) => saveGeoKbDraftV3(input, transport),
    readGeneration: (input) => readGeoKbGenerationSummaryV3(input, transport),
    publish: (input) => publishGeoKbV3(input, transport),
    generationStore: createGeoKbGenerationStore(transport),
    quota: async () => ({ kind: "allowed", remaining: 1, resetAt: NOW.toISOString() }) as never,
    readProfile: async (_userId, _url) =>
      ({
        kind: "ok",
        value: {
          website: { websiteId, canonicalSiteKey: "example.com" },
          reference: {
            schemaVersion: "website-profile-reference.v1",
            websiteId,
            snapshotId,
            snapshotRevision: 3,
            profileSchemaVersion: "marketing-website-profile.v1",
            profileHash: profileHash(value),
          },
          profile: value,
        },
      }) as never,
    now: () => NOW,
  });
  return { userId, kbId, websiteId, snapshotId, profile: value, runtime };
}

function request(url: string, body: unknown): Request {
  return new Request(`https://gengrowth.ai/api/tools/geo-knowledge-base/v3/${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createDraft(f: Fixture) {
  const response = await handleGeoKbV3DraftCreate(request("draft", { kbId: f.kbId, baseVersion: 0 }), f.runtime.draft);
  return { response, body: await response.json() };
}

async function storedDraft(f: Fixture) {
  const row = (
    await db.query("select draft_version,content_hash,schema_version,payload from public.marketing_geo_kb_drafts where kb_id=$1", [f.kbId])
  ).rows[0];
  return row === undefined ? null : {
    draftVersion: row.draft_version as number,
    contentHash: row.content_hash as string,
    schemaVersion: row.schema_version as string,
    payload: parseGeoKbPayloadV3(row.payload),
  };
}

/** The predicate every paid generation claim has to pass before it may run. */
async function inputCurrent(f: Fixture, input: Record<string, unknown>): Promise<boolean> {
  const result = await db.query("select public.marketing_geo_generation_input_current($1,$2,$3) as current", [
    f.userId,
    f.kbId,
    JSON.stringify(input),
  ]);
  return result.rows[0]!.current as boolean;
}

describe("creating the first v3 draft", () => {
  it("stages a Profile revision the way the Profile store hashes one", async () => {
    // Otherwise the fixture could agree with itself and with the database while
    // disagreeing with what a confirmed Profile actually hashes to, and every
    // profileRef assertion below would be measuring the harness.
    expect(profileHash(profile())).toBe(await profileSha256(profile()));
  });

  it("writes a v3 draft the contract and the database both accept", async () => {
    const f = await fixture();

    const created = await createDraft(f);

    expect(created.response.status).toBe(200);
    const stored = await storedDraft(f);
    expect(stored).not.toBeNull();
    if (stored === null) return;
    expect(stored.schemaVersion).toBe("marketing-geo-kb.v3");
    expect(stored.draftVersion).toBe(1);
    expect(created.body.data).toEqual({
      kbId: f.kbId,
      draftVersion: 1,
      contentHash: stored.contentHash,
      updatedAt: expect.any(String),
      generationInputHash: stored.payload.runRef.generationInputHash,
      blockers: [],
    });
    // Nothing was observed, and the draft says which absence that is rather
    // than naming a collection nobody can retrieve.
    expect(stored.payload.generationInput.evidenceContentHash).toBe(GEO_ABSENT_EVIDENCE_CONTENT_HASH);
    // The locked half came from the confirmed Profile revision, by reference.
    expect(stored.payload.generationInput.profileRef.snapshotId).toBe(f.snapshotId);
    expect(stored.payload.generationInput.profileRef.snapshotRevision).toBe("3");
    expect(stored.payload.generationInput.profileRef.profileHash).toBe(profileHash(f.profile));
    expect(stored.payload.generationInput.identity.targetUrl).toBe(TARGET_URL);
    // Nothing generated has happened yet, and the draft says so.
    expect(stored.payload.knowledge).toBeNull();
    expect(stored.payload.runRef.runId).toBeNull();
  });

  it("makes the first paid step claimable, which is the whole ordering constraint", async () => {
    const f = await fixture();
    const before = await inputCurrent(f, {
      kbId: f.kbId,
      baseDraftVersion: "0",
      baseDraftHash: "0".repeat(64),
      generationInputHash: "0".repeat(64),
    });
    expect(before).toBe(false);

    await createDraft(f);
    const stored = await storedDraft(f);
    if (stored === null) throw new Error("expected a draft");
    const claim = {
      kbId: f.kbId,
      baseDraftVersion: String(stored.draftVersion),
      baseDraftHash: stored.contentHash,
      generationInputHash: stored.payload.runRef.generationInputHash,
    };

    // Before this route existed there was no draft to name, so this predicate
    // was false for every possible input and no v3 generation could be claimed.
    expect(await inputCurrent(f, claim)).toBe(true);
    // The two things it exists to refuse still refuse.
    expect(await inputCurrent(f, { ...claim, generationInputHash: "1".repeat(64) })).toBe(false);
    expect(await inputCurrent(f, { ...claim, baseDraftHash: "1".repeat(64) })).toBe(false);
  });

  it("stops being claimable when the Profile it references stops being the confirmed one", async () => {
    const f = await fixture();
    await createDraft(f);
    const stored = await storedDraft(f);
    if (stored === null) throw new Error("expected a draft");
    const claim = {
      kbId: f.kbId,
      baseDraftVersion: String(stored.draftVersion),
      baseDraftHash: stored.contentHash,
      generationInputHash: stored.payload.runRef.generationInputHash,
    };
    expect(await inputCurrent(f, claim)).toBe(true);

    const next = profile({ productName: "Acme Two" });
    const nextId = randomUUID();
    await db.query(
      "insert into public.marketing_website_profile_snapshots(id,website_id,user_id,revision,schema_version,profile,content_hash,source_draft_version) values($1,$2,$3,4,'marketing-website-profile.v1',$4,$5,2)",
      [nextId, f.websiteId, f.userId, JSON.stringify(next), profileHash(next)],
    );
    await db.query("update public.marketing_websites set current_confirmed_snapshot_id=$1 where id=$2", [nextId, f.websiteId]);

    // The reference is what makes this checkable at all: the draft still names
    // revision 3, and revision 3 is no longer what the owner confirmed.
    expect(await inputCurrent(f, claim)).toBe(false);
  });

  it("creates the draft without sending a single request", async () => {
    // Asserted against the real runtime rather than against a stubbed
    // dependency, because "this route spends no crawl allowance" is a property
    // of what `createGeoKbV3Runtime` wires, not of what a test injects. Wiring
    // a collection back into it fails here twice over: the fetch is refused,
    // and a collection that cannot fetch cannot produce a digest.
    const f = await fixture();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => {
        throw new Error("creating a knowledge base must reach no network");
      });

    try {
      const created = await createDraft(f);

      expect(created.response.status).toBe(200);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("leaves the generation input free for the first real collection to re-lock", async () => {
    // The contract the collect/assemble step is being built against. A created
    // draft names no evidence and no generation, and `marketing_geo_save_kb_draft`
    // lets `generationInputHash` move exactly while all four runRef ids are
    // empty -- so the step that first collects evidence re-locks the input the
    // ordinary way, with nothing to release and nothing paid for to forfeit.
    const f = await fixture();
    await createDraft(f);
    const created = await storedDraft(f);
    if (created === null) throw new Error("expected a draft");
    expect(created.payload.generationInput.evidenceContentHash).toBe(GEO_ABSENT_EVIDENCE_CONTENT_HASH);

    const collected = parseGeoKbPayloadV3({
      ...created.payload,
      generationInput: { ...created.payload.generationInput, evidenceContentHash: COLLECTED_EVIDENCE_HASH },
      runRef: {
        ...created.payload.runRef,
        generationInputHash: geoV2Digest({
          ...created.payload.generationInput,
          evidenceContentHash: COLLECTED_EVIDENCE_HASH,
        }),
      },
    });
    expect(collected.runRef.generationInputHash).not.toBe(created.payload.runRef.generationInputHash);

    const relocked = await saveGeoKbDraftV3(
      { userId: f.userId, kbId: f.kbId, payload: collected, baseVersion: created.draftVersion },
      rpcTransport(),
    );

    expect(relocked.kind).toBe("ok");
    const after = await storedDraft(f);
    expect(after?.payload.generationInput.evidenceContentHash).toBe(COLLECTED_EVIDENCE_HASH);
  });

  it("locks the generation input once a generation has been made against it", async () => {
    // The other half, so the test above is a fact about the *created* draft
    // rather than about the lock never engaging. Naming a roles generation is
    // what closes it: after that, moving the hash requires the same save to
    // clear all four ids, which forfeits everything the old input paid for.
    const f = await fixture();
    await createDraft(f);
    const created = await storedDraft(f);
    if (created === null) throw new Error("expected a draft");

    const withGeneration = parseGeoKbPayloadV3({
      ...created.payload,
      runRef: { ...created.payload.runRef, rolesGenerationId: randomUUID() },
    });
    const marked = await saveGeoKbDraftV3(
      { userId: f.userId, kbId: f.kbId, payload: withGeneration, baseVersion: created.draftVersion },
      rpcTransport(),
    );
    expect(marked.kind).toBe("ok");

    const moved = parseGeoKbPayloadV3({
      ...withGeneration,
      generationInput: { ...withGeneration.generationInput, evidenceContentHash: COLLECTED_EVIDENCE_HASH },
      runRef: {
        ...withGeneration.runRef,
        generationInputHash: geoV2Digest({
          ...withGeneration.generationInput,
          evidenceContentHash: COLLECTED_EVIDENCE_HASH,
        }),
      },
    });
    const refused = await saveGeoKbDraftV3(
      { userId: f.userId, kbId: f.kbId, payload: moved, baseVersion: marked.kind === "ok" ? marked.value.draftVersion : 0 },
      rpcTransport(),
    );

    expect(refused.kind).toBe("input_locked");
  });

  it("refuses a second create and leaves the first draft byte-identical", async () => {
    const f = await fixture();
    await createDraft(f);
    const first = await storedDraft(f);

    const again = await handleGeoKbV3DraftCreate(request("draft", { kbId: f.kbId, baseVersion: 0 }), f.runtime.draft);

    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: { code: "draft_exists" }, draftVersion: 1 });
    expect(await storedDraft(f)).toEqual(first);
  });
});

describe("the created draft through review and publish", () => {
  /**
   * The knowledge a paid run will write, over the generation input this file's
   * own creator locked. Written through the same store call the assembly step
   * will use, because that step does not exist yet -- see the file header.
   */
  async function withKnowledge(f: Fixture): Promise<GeoKbPayloadV3> {
    const stored = await storedDraft(f);
    if (stored === null) throw new Error("expected a draft");
    const payload = parseGeoKbPayloadV3({ ...stored.payload, knowledge: completePayloadV3().knowledge });
    const saved = await saveGeoKbDraftV3(
      { userId: f.userId, kbId: f.kbId, payload, baseVersion: stored.draftVersion },
      rpcTransport(),
    );
    expect(saved.kind).toBe("ok");
    return payload;
  }

  it("survives a review gesture and a publish, and the version reads back", async () => {
    const f = await fixture();
    await createDraft(f);
    const payload = await withKnowledge(f);
    const afterKnowledge = await storedDraft(f);
    if (afterKnowledge === null) throw new Error("expected a draft");

    const reviewed = await handleGeoKbV3Review(
      request("review", {
        kbId: f.kbId,
        baseVersion: afterKnowledge.draftVersion,
        expectedGenerationInputHash: payload.runRef.generationInputHash,
        actions: [{ kind: "accept", itemKey: FACT_KEY_PRO }],
      }),
      f.runtime.review,
    );
    expect(reviewed.status).toBe(200);
    const review = await reviewed.json();
    expect(review.data.counts.accepted).toBe(1);

    const published = await handleGeoKbV3Publish(
      request("publish", {
        kbId: f.kbId,
        baseVersion: review.data.draftVersion,
        draftHash: review.data.contentHash,
      }),
      f.runtime.publish,
    );

    expect(published.status).toBe(200);
    const body = await published.json();
    expect(body.data.revision).toBe(1);
    expect(body.data.reusedExisting).toBe(false);
    // Nothing generated a question set for this draft, and the version says so
    // rather than claiming an empty one.
    expect(body.data.questionSet).toEqual({ status: "unavailable", reason: "not_attempted" });

    const snapshot = (
      await db.query("select payload,content_hash,question_set,question_set_hash from public.marketing_geo_kb_snapshots where id=$1", [body.data.snapshotId])
    ).rows[0];
    const storedPayload = parseGeoKbPayloadV3(snapshot.payload);
    expect(storedPayload.generationInput.profileRef.snapshotId).toBe(f.snapshotId);
    expect(geoV2Digest(storedPayload)).toBe(snapshot.content_hash as string);
    expect(snapshot.question_set).toBeNull();
    expect(snapshot.question_set_hash).toBeNull();
  });

  it("refuses to publish a created draft that has no knowledge yet", async () => {
    const f = await fixture();
    const created = await createDraft(f);

    const published = await handleGeoKbV3Publish(
      request("publish", { kbId: f.kbId, baseVersion: 1, draftHash: created.body.data.contentHash }),
      f.runtime.publish,
    );

    // Honest: there is nothing a reader could open. A version whose only content
    // is the claim that a version exists is worse than no version.
    expect(published.status).toBe(422);
    expect((await published.json()).error.code).toBe("nothing_to_publish");
  });
});

/**
 * A knowledge base with a published version and no draft.
 *
 * The create route used to look only at the draft, so this shape walked
 * straight through it -- and a v3 draft standing over a v1/v2 published version
 * is what `kb-editor-loader.ts` answers `v3_predecessor_unsupported` to, a 503
 * for that knowledge base with no gesture that clears it.
 *
 * The published version here is written by `marketing_geo_freeze_kb`, the RPC
 * production freezes through, over a draft `marketing_geo_save_kb_draft`
 * accepted -- so what the guard is shown refusing is a real legacy version and
 * not a row invented to look like one. The draft is then deleted, which is the
 * one step that has no production caller: no code path in this deployment
 * removes a draft row, so this state is reached by data repair or by a schema
 * this app has not seen, and the guard exists because the cost of being wrong
 * about that is a knowledge base nobody can open again.
 */
async function publishLegacyVersionAndDropTheDraft(f: Fixture): Promise<string> {
  const payload = {
    ...emptyGeoKbPayload(ORIGIN),
    officialName: "Acme",
    aliases: ["Acme App"],
    categoryTerms: ["astrology software"],
    roles: [{ id: "buyer", label: "Astrologer", segment: "solo practitioners", painPoints: ["chart errors"],
      decisionCriteria: ["accuracy"], vocabulary: ["ephemeris"] }],
    competitors: [{ domain: "astro.example", brandName: "AstroRival", confirmed: true }],
    facts: [{ key: "Seats", value: "3", reason: "" as const, sourceUrl: `${ORIGIN}/pricing`, observedAt: NOW.toISOString() }],
  };
  const payloadHash = geoKbDigest(payload as unknown as GeoKbValue);
  const saved = await db.query("select * from public.marketing_geo_save_kb_draft($1,$2,$3,$4,$5,0)",
    [f.userId, f.kbId, payload.schemaVersion, payload, payloadHash]);
  expect(saved.rows[0]!.outcome).toBe("saved");
  const questions = buildGeoQuestionSet(payload);
  const frozen = await db.query("select * from public.marketing_geo_freeze_kb($1,$2,$3,1,$4,$5)",
    [f.userId, f.kbId, payload.schemaVersion, questions, geoQuestionSetDigest(questions)]);
  expect(frozen.rows[0]!.outcome).toBe("frozen");
  // The head now points at a published version...
  const head = await db.query("select current_frozen_snapshot_id from public.marketing_geo_knowledge_bases where id=$1", [f.kbId]);
  expect(head.rows[0]!.current_frozen_snapshot_id).toBe(frozen.rows[0]!.snapshot_id);
  // ...and the draft it was frozen from is gone, which is the shape under test.
  await db.query("delete from public.marketing_geo_kb_drafts where user_id=$1 and kb_id=$2", [f.userId, f.kbId]);
  expect(await storedDraft(f)).toBeNull();
  return frozen.rows[0]!.snapshot_id as string;
}

describe("creating a v3 draft over a published version", () => {
  it("refuses, and the same knowledge base without the published version does not", async () => {
    const f = await fixture();
    const snapshotId = await publishLegacyVersionAndDropTheDraft(f);

    const refused = await createDraft(f);

    expect(refused.response.status).toBe(409);
    // Its own code, and no `draftVersion`: there is no draft, and a number in
    // that field would read as one.
    expect(refused.body).toEqual({ error: { code: "published_version_exists" } });
    // The refusal wrote nothing. Without this the 409 could be reported over a
    // knowledge base that had already been given the draft that breaks it.
    expect(await storedDraft(f)).toBeNull();

    /*
     * The control, and the reason this test is not measuring an earlier gate.
     *
     * Everything else about this owner is what the passing create above uses: a
     * registered website, a confirmed Profile revision, a knowledge base whose
     * origin matches. Clearing the one pointer -- and only that pointer -- turns
     * the same request into a created draft, so the 409 above was the published
     * version and nothing else. The snapshot row itself stays exactly where it
     * was; only the head stops naming it.
     */
    await db.query("update public.marketing_geo_knowledge_bases set current_frozen_snapshot_id=null where id=$1", [f.kbId]);
    const created = await createDraft(f);

    expect(created.response.status).toBe(200);
    const stored = await storedDraft(f);
    expect(stored?.schemaVersion).toBe("marketing-geo-kb.v3");
    // The snapshot was never touched, so what changed was the pointer.
    expect((await db.query("select count(*)::int as n from public.marketing_geo_kb_snapshots where id=$1", [snapshotId])).rows[0]!.n).toBe(1);
  });
});
