// @input -- only a named loopback disposable Marketing database and synthetic values
// @output -- proof that a knowledge base whose Profile moved can be updated again
// @pos -- real SQL tests, never a provider or production invocation

/**
 * The failure this file measures, and then measures the end of.
 *
 * `generationInput` had exactly one writer -- the create route -- and that route
 * refuses whenever a draft already exists. The v3 branch of
 * `marketing_geo_generation_input_current` requires the draft's `profileRef` to
 * still name the website's *current* confirmed Profile snapshot, so the moment
 * the owner confirmed a new revision every paid claim was refused and nothing in
 * TypeScript could move the reference. The knowledge base could never be updated
 * again.
 *
 * The database always had the release: `marketing_geo_save_kb_draft` permits a
 * changed `generationInputHash` when the same save clears all four `runRef` ids.
 * Nothing performed it. This file drives the real thing:
 *
 *   1. create a draft through the real v3/draft route,
 *   2. buy a knowledge generation through the real generation state machine and
 *      assemble it through the real v3/assemble route, so the draft holds a paid
 *      body and names the record that produced it,
 *   3. confirm a new Profile revision, and show the database now refuses the
 *      claim -- through `marketing_geo_generation_input_current` AND through a
 *      real `marketing_geo_claim_generation`, because a predicate returning
 *      false is not by itself proof that an update is blocked,
 *   4. re-lock through the real v3/draft route,
 *   5. show a real claim succeeds again, and that the paid body did not quietly
 *      survive the release.
 *
 * Nothing here stubs the save, the claim or the currency predicate: those three
 * are the seam the defect lived behind. What is not exercised is
 * `findAccountWebsiteByUrl` -- the runtime's Profile reader is replaced by a
 * direct query over the same two tables it reads, because its transport is
 * PostgREST-shaped. It is covered by its own tests, and the create route already
 * depended on it before this change.
 */
import { createHash, randomUUID } from "node:crypto";

import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connectFreshMarketingSchema } from "../credits/sql-test-harness.ts";
import {
  canonicalProfileJson,
  emptyMarketingWebsiteProfile,
  type MarketingWebsiteProfileV1,
} from "../account-websites/contracts.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { geoGenerationInputHash } from "./kb-generation.ts";
import { createGeoKbGenerationStore, type GeoKbRpcTransport } from "./kb-generation-store.ts";
import type { GeoKbStoreDependencies } from "./kb-store.ts";
import { assemblyEvidence } from "./kb-knowledge-assemble.test-fixtures.ts";
import { geoV2NarrativeFixture } from "./kb-knowledge-synthesis-v2-fixtures.ts";
import {
  buildGeoKnowledgeGenerationResultV2,
  buildGeoKnowledgeSynthesisInputV2,
} from "./kb-knowledge-synthesis-v2-contract.ts";
import { readVersionedGeoKnowledgeBase } from "./kb-versioned-read.ts";
import { saveGeoKbDraftV3 } from "./kb-v3-store.ts";
import {
  handleGeoKbV3DraftCreate,
  type GeoKbV3DraftCreateDependencies,
  type GeoKbV3ProfileRead,
} from "./kb-v3-draft-create.ts";
import {
  handleGeoKbV3Assemble,
  type GeoKbV3AssembleDependencies,
} from "./kb-v3-assemble-handler.ts";
import { parseGeoKbPayloadV3, type GeoKbPayloadV3 } from "./kb-v3-contract.ts";

let db: Client;
beforeAll(async () => {
  db = await connectFreshMarketingSchema();
});
afterAll(async () => {
  await db?.end();
});

/** The shared assembly fixtures describe this site, and the assembler binds to it. */
const ORIGIN = "https://product.example";
const SITE_KEY = "product.example";
const GENERATED_AT = "2026-09-05T00:00:00.000Z";
const ATTEMPT = {
  attemptedCalls: 1 as const,
  delivery: "response_received" as const,
  modelRequested: "offline-model",
  inputTokens: 12,
  outputTokens: 30,
  requestCount: 1,
};

function profile(overrides: Partial<MarketingWebsiteProfileV1> = {}): MarketingWebsiteProfileV1 {
  return {
    ...emptyMarketingWebsiteProfile(),
    productName: "Pine Cloud",
    oneLinePositioning: "Project software for very small teams.",
    coreFeatures: ["Approval workflow"],
    categories: ["Project software"],
    directCompetitors: ["rival.example"],
    country: "US",
    locale: "en",
    ...overrides,
  };
}

/** The digest the Profile store computes for a confirmed revision. */
function profileHash(value: MarketingWebsiteProfileV1): string {
  return createHash("sha256").update(canonicalProfileJson(value), "utf8").digest("hex");
}

/** `pg` hands back `Date`; every store parser requires the ISO string PostgREST sends. */
function jsonRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]),
  );
}

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
      return {
        kind: "ok",
        data: { knowledgeBases: bases.rows.map(jsonRow), drafts: drafts.rows.map(jsonRow), snapshots: [] },
      };
    },
    readSnapshot: async () => ({ kind: "ok", data: null }),
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
  readonly draft: GeoKbV3DraftCreateDependencies;
  readonly assemble: GeoKbV3AssembleDependencies;
  readonly store: ReturnType<typeof createGeoKbGenerationStore>;
}

async function fixture(): Promise<Fixture> {
  const userId = randomUUID();
  const websiteId = randomUUID();
  const snapshotId = randomUUID();
  const upserted = await db.query("select * from public.marketing_geo_upsert_kb($1,$2,$3,$3)", [userId, ORIGIN, SITE_KEY]);
  const kbId = upserted.rows[0]!.kb_id as string;
  await db.query(
    "insert into public.marketing_websites(id,user_id,canonical_site_key,origin,submitted_url,host) values($1,$2,$3,$4,$4,$3)",
    [websiteId, userId, SITE_KEY, ORIGIN],
  );
  const first = profile();
  await db.query(
    "insert into public.marketing_website_profile_snapshots(id,website_id,user_id,revision,schema_version,profile,content_hash,source_draft_version) values($1,$2,$3,3,'marketing-website-profile.v1',$4,$5,1)",
    [snapshotId, websiteId, userId, JSON.stringify(first), profileHash(first)],
  );
  await db.query("update public.marketing_websites set current_confirmed_snapshot_id=$1 where id=$2", [snapshotId, websiteId]);

  const transport = rpcTransport();
  const store = createGeoKbGenerationStore(transport);
  const deps = storeDependencies();
  const authenticate = (async () => ({ status: "authenticated", userId })) as GeoKbV3DraftCreateDependencies["authenticate"];
  const readDetails = (input: { readonly userId: string; readonly kbId: string }) =>
    readVersionedGeoKnowledgeBase(input, deps);
  const saveDraft: GeoKbV3DraftCreateDependencies["saveDraft"] = (input) => saveGeoKbDraftV3(input, transport);
  /**
   * The website's confirmed Profile, read live rather than captured. A reader
   * that answered with the revision this fixture created would make the re-lock
   * a no-op and every assertion below a fact about the harness.
   */
  const readProfile = async (): Promise<GeoKbV3ProfileRead> => {
    const website = await db.query(
      "select id,canonical_site_key,current_confirmed_snapshot_id from public.marketing_websites where id=$1",
      [websiteId],
    );
    const confirmed = website.rows[0]?.current_confirmed_snapshot_id as string | null | undefined;
    if (confirmed === undefined) return { kind: "missing" };
    if (confirmed === null) return { kind: "unconfirmed" };
    const snapshot = await db.query(
      "select id,website_id,revision,schema_version,profile,content_hash from public.marketing_website_profile_snapshots where id=$1",
      [confirmed],
    );
    const row = snapshot.rows[0];
    if (row === undefined) return { kind: "unavailable" };
    return {
      kind: "ok",
      canonicalSiteKey: website.rows[0]!.canonical_site_key as string,
      reference: {
        schemaVersion: "website-profile-reference.v1",
        websiteId,
        snapshotId: row.id as string,
        snapshotRevision: row.revision as number,
        profileSchemaVersion: "marketing-website-profile.v1",
        profileHash: row.content_hash as string,
      },
      profile: row.profile as MarketingWebsiteProfileV1,
    };
  };
  const generationRunning = async (owner: string, kb: string): Promise<boolean | "unavailable"> => {
    for (const kind of ["roles", "questions", "knowledge_pack"] as const) {
      const read = await store.readLatest({ userId: owner, kbId: kb, kind });
      if (read.kind === "ok" && read.generation !== null && read.generation.state === "dispatched") return true;
    }
    return false;
  };
  return {
    userId, kbId, websiteId, snapshotId, store,
    draft: { authenticate, readDetails, readProfile, saveDraft, generationRunning },
    assemble: {
      authenticate,
      readDetails,
      saveDraft,
      readLatestGeneration: (input) => store.readLatest(input),
      generationRunning,
    },
  };
}

function request(path: string, body: unknown): Request {
  return new Request(`https://gengrowth.ai/api/tools/geo-knowledge-base/v3/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://gengrowth.ai" },
    body: JSON.stringify(body),
  });
}

async function storedDraft(f: Fixture) {
  const row = (
    await db.query("select draft_version,content_hash,payload from public.marketing_geo_kb_drafts where kb_id=$1", [f.kbId])
  ).rows[0];
  if (row === undefined) throw new Error("expected a draft");
  return {
    draftVersion: row.draft_version as number,
    contentHash: row.content_hash as string,
    payload: parseGeoKbPayloadV3(row.payload),
  };
}

/** The predicate every paid generation claim has to pass before it may run. */
async function inputCurrent(f: Fixture, input: Record<string, unknown>): Promise<boolean> {
  const result = await db.query("select public.marketing_geo_generation_input_current($1,$2,$3) as current", [
    f.userId, f.kbId, JSON.stringify(input),
  ]);
  return result.rows[0]!.current as boolean;
}

/**
 * One knowledge generation, bought and finished through the real state machine.
 *
 * The synthesis input is built from the draft's own locked identity rather than
 * from the shared fixture's, so what is proved is that THIS created draft can
 * carry a real narrative -- the assembler re-checks the narrative against the
 * identity it was generated for and would refuse a mismatch.
 */
async function knowledgeInputs(f: Fixture) {
  const stored = await storedDraft(f);
  const evidence = assemblyEvidence();
  const identity = stored.payload.generationInput.identity;
  const synthesisInput = buildGeoKnowledgeSynthesisInputV2(
    {
      officialName: identity.officialName,
      aliases: [...identity.aliases],
      categoryTerms: [...identity.categoryTerms],
      market: identity.market.country,
      language: identity.market.language,
      profileRef: stored.payload.generationInput.profileRef,
      generationInputHash: stored.payload.runRef.generationInputHash,
    },
    evidence,
  );
  const manifest = JSON.parse(JSON.stringify({
    schemaVersion: "marketing-geo-knowledge-generation-input.v2",
    kbId: f.kbId,
    baseDraftVersion: String(stored.draftVersion),
    baseDraftHash: stored.contentHash,
    generationInputHash: stored.payload.runRef.generationInputHash,
    sourceReceiptRefs: [],
    knowledgeSynthesisInput: synthesisInput,
  })) as Record<string, never>;
  return { manifest, synthesisInput, evidence, stored };
}

/**
 * The database's own word for why a claim was refused, read from the RPC rather
 * than inferred from the store's outcome: `kb-generation-store.ts` folds
 * `input_stale`, `conflict` and `not_found` into one `conflict`, so a test that
 * only saw the store's answer could not tell "the Profile moved" from "that
 * idempotency key is taken". A refused claim writes no row.
 */
async function rawClaimOutcome(f: Fixture, key: string): Promise<string> {
  const { manifest } = await knowledgeInputs(f);
  const rows = await db.query(
    "select outcome from public.marketing_geo_claim_generation($1,$2,'knowledge_pack',$3,$4,$5)",
    [f.userId, f.kbId, key, geoGenerationInputHash("knowledge_pack", manifest), JSON.stringify(manifest)],
  );
  return rows.rows[0]!.outcome as string;
}

async function buyKnowledge(f: Fixture, key: string) {
  const { manifest, synthesisInput, evidence } = await knowledgeInputs(f);
  const claimed = await f.store.claim({
    userId: f.userId, kbId: f.kbId, kind: "knowledge_pack", idempotencyKey: key,
    input: manifest, inputHash: geoGenerationInputHash("knowledge_pack", manifest),
  });
  if (claimed.kind !== "claimed") return { kind: claimed.kind } as const;
  const scope = { userId: f.userId, kbId: f.kbId, generationId: claimed.generation.generationId, claimToken: claimed.claimToken };
  const dispatched = await f.store.markDispatched(scope);
  if (dispatched.kind !== "dispatched") throw new Error(`expected a dispatch, got ${dispatched.kind}`);
  const result = buildGeoKnowledgeGenerationResultV2({
    schemaVersion: "marketing-geo-knowledge-generation-result.v2",
    generationId: scope.generationId,
    kbId: f.kbId,
    manifest,
    synthesisInput,
    evidence,
    narrative: geoV2NarrativeFixture(),
    generatedAt: GENERATED_AT,
  });
  const finished = await f.store.finish(scope, { state: "succeeded", result: result as never, errorReason: null, attempt: ATTEMPT });
  if (finished.kind !== "ok" || finished.generation.state !== "succeeded") {
    throw new Error(`expected a succeeded finish, got ${finished.kind}`);
  }
  return { kind: "claimed", generationId: scope.generationId } as const;
}

/** The owner confirms a new Profile revision for this website. */
async function confirmRevision(f: Fixture, value: MarketingWebsiteProfileV1, revision: number): Promise<string> {
  const id = randomUUID();
  await db.query(
    "insert into public.marketing_website_profile_snapshots(id,website_id,user_id,revision,schema_version,profile,content_hash,source_draft_version) values($1,$2,$3,$4,'marketing-website-profile.v1',$5,$6,$7)",
    [id, f.websiteId, f.userId, revision, JSON.stringify(value), profileHash(value), revision - 2],
  );
  await db.query("update public.marketing_websites set current_confirmed_snapshot_id=$1 where id=$2", [id, f.websiteId]);
  return id;
}

/** The claim shape the database checks, over the draft as it stands right now. */
function claimFor(stored: Awaited<ReturnType<typeof storedDraft>>, kbId: string) {
  return {
    kbId,
    baseDraftVersion: String(stored.draftVersion),
    baseDraftHash: stored.contentHash,
    generationInputHash: stored.payload.runRef.generationInputHash,
  };
}

describe("a knowledge base whose confirmed Profile moved", () => {
  it("stops being updatable, and the re-lock is what makes it updatable again", async () => {
    const f = await fixture();
    const created = await handleGeoKbV3DraftCreate(request("draft", { kbId: f.kbId, baseVersion: 0 }), f.draft);
    expect(created.status).toBe(200);

    // A paid knowledge run, assembled into the draft through the real route.
    const bought = await buyKnowledge(f, "relock_integration_1");
    expect(bought.kind).toBe("claimed");
    const beforeAssembly = await storedDraft(f);
    const assembled = await handleGeoKbV3Assemble(
      request("assemble", { kbId: f.kbId, baseVersion: beforeAssembly.draftVersion, draftHash: beforeAssembly.contentHash }),
      f.assemble,
    );
    expect(assembled.status).toBe(200);
    const paid = await storedDraft(f);
    expect(paid.payload.knowledge).not.toBeNull();
    expect(paid.payload.runRef.knowledgeGenerationId).toBe(bought.kind === "claimed" ? bought.generationId : null);
    expect(await inputCurrent(f, claimFor(paid, f.kbId))).toBe(true);

    // The owner confirms a new Profile revision.
    const nextSnapshotId = await confirmRevision(f, profile({ productName: "Pine Cloud Two" }), 4);

    // The failure, measured twice: the predicate, and a real claim through the
    // real RPC. A predicate answering false is not by itself proof that an
    // update is blocked, and the store folds three refusals into one word.
    expect(await inputCurrent(f, claimFor(paid, f.kbId))).toBe(false);
    expect(await rawClaimOutcome(f, "relock_integration_2")).toBe("input_stale");

    // The re-lock, through the real route.
    const relocked = await handleGeoKbV3DraftCreate(
      request("draft", { kbId: f.kbId, intent: "relock", baseVersion: paid.draftVersion, draftHash: paid.contentHash }),
      f.draft,
    );

    expect(relocked.status).toBe(200);
    const body = await relocked.json();
    expect(body.data.relocked).toBe(true);
    expect(body.data.profileRef).toEqual({ snapshotId: nextSnapshotId, snapshotRevision: "4" });
    expect(body.data.discarded).toEqual({
      knowledge: true, decisions: 0, suppressions: 0, roles: 0, released: ["knowledgeGenerationId"],
    });

    const after = await storedDraft(f);
    expect(after.payload.generationInput.profileRef.snapshotId).toBe(nextSnapshotId);
    expect(after.payload.generationInput.identity.officialName).toBe("Pine Cloud Two");
    // The paid body did not quietly survive a release that unbound it.
    expect(after.payload.knowledge).toBeNull();
    expect(after.payload.runRef.knowledgeGenerationId).toBeNull();
    expect(after.payload.runRef.generationInputHash).not.toBe(paid.payload.runRef.generationInputHash);

    // And the update works again -- both the predicate and a real claim.
    expect(await inputCurrent(f, claimFor(after, f.kbId))).toBe(true);
    const again = await buyKnowledge(f, "relock_integration_3");
    expect(again.kind).toBe("claimed");
    const rebuilt = await storedDraft(f);
    const reassembled = await handleGeoKbV3Assemble(
      request("assemble", { kbId: f.kbId, baseVersion: rebuilt.draftVersion, draftHash: rebuilt.contentHash }),
      f.assemble,
    );
    expect(reassembled.status).toBe(200);
    expect((await storedDraft(f)).payload.knowledge).not.toBeNull();
  });

  it("writes nothing when the Profile has not moved, however often it is asked", async () => {
    const f = await fixture();
    expect((await handleGeoKbV3DraftCreate(request("draft", { kbId: f.kbId, baseVersion: 0 }), f.draft)).status).toBe(200);
    const bought = await buyKnowledge(f, "relock_integration_noop");
    expect(bought.kind).toBe("claimed");
    const before = await storedDraft(f);
    expect((await handleGeoKbV3Assemble(
      request("assemble", { kbId: f.kbId, baseVersion: before.draftVersion, draftHash: before.contentHash }),
      f.assemble,
    )).status).toBe(200);
    const paid = await storedDraft(f);

    for (const _attempt of [1, 2]) {
      const response = await handleGeoKbV3DraftCreate(
        request("draft", { kbId: f.kbId, intent: "relock", baseVersion: paid.draftVersion, draftHash: paid.contentHash }),
        f.draft,
      );
      expect(response.status).toBe(200);
      expect((await response.json()).data.relocked).toBe(false);
    }

    // Not "the payload came out the same": nothing was written at all, so the
    // paid body and the record that produced it are still exactly where they were.
    const after = await storedDraft(f);
    expect(after.draftVersion).toBe(paid.draftVersion);
    expect(after.contentHash).toBe(paid.contentHash);
    expect(after.payload.knowledge).not.toBeNull();
  });

  it("refuses a release that keeps even one of the four ids", async () => {
    // The other half of the proof: the four-null clear in `relockGeoKbV3Payload`
    // is not decoration. The same new input, saved with one id kept, is refused
    // by the database -- so the re-lock above succeeded because of the release
    // and not because the lock never engages.
    const f = await fixture();
    expect((await handleGeoKbV3DraftCreate(request("draft", { kbId: f.kbId, baseVersion: 0 }), f.draft)).status).toBe(200);
    const bought = await buyKnowledge(f, "relock_integration_lock");
    expect(bought.kind).toBe("claimed");
    const before = await storedDraft(f);
    expect((await handleGeoKbV3Assemble(
      request("assemble", { kbId: f.kbId, baseVersion: before.draftVersion, draftHash: before.contentHash }),
      f.assemble,
    )).status).toBe(200);
    const paid = await storedDraft(f);
    await confirmRevision(f, profile({ productName: "Pine Cloud Three" }), 4);

    const moved: GeoKbPayloadV3 = parseGeoKbPayloadV3({
      ...paid.payload,
      knowledge: null,
      review: { decisions: [], suppressions: [] },
      generationInput: {
        ...paid.payload.generationInput,
        identity: { ...paid.payload.generationInput.identity, officialName: "Pine Cloud Three" },
      },
      runRef: {
        ...paid.payload.runRef,
        generationInputHash: geoV2Digest({
          ...paid.payload.generationInput,
          identity: { ...paid.payload.generationInput.identity, officialName: "Pine Cloud Three" },
        }),
      },
    });
    expect(moved.runRef.knowledgeGenerationId).not.toBeNull();

    const refused = await saveGeoKbDraftV3(
      { userId: f.userId, kbId: f.kbId, payload: moved, baseVersion: paid.draftVersion },
      rpcTransport(),
    );

    expect(refused.kind).toBe("input_locked");
    expect((await storedDraft(f)).contentHash).toBe(paid.contentHash);
  });
});
