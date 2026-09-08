// @input -- only a named loopback disposable Marketing database and synthetic values
// @output -- proof that a real v3 draft can gain knowledge and then be published
// @pos -- real SQL tests, never a provider or production invocation

/**
 * The chain BREAK 3 said could not complete.
 *
 * `assembleGeoKnowledgeBodyV3` and `mergeGeoDraftV3` had no runtime call site,
 * so nothing wrote `payload.knowledge`; every stored v3 draft carried null, and
 * `handleGeoKbV3Publish` refused with `nothing_to_publish` (422) on every single
 * attempt. `kb-v3-draft-create.integration.test.ts` had to write knowledge by
 * hand to get past it, and recorded that as the missing piece.
 *
 * This file drives the real thing end to end against the real functions:
 *
 *   1. a v3 draft with `knowledge: null` -- what the creator actually produces,
 *   2. publishing it, which must still refuse, so the fix is measured against
 *      the failure rather than asserted about it,
 *   3. a knowledge generation claimed, dispatched and finished through the real
 *      `marketing_geo_*_generation` functions, carrying a
 *      `marketing-geo-knowledge-generation-result.v2` -- the shape a v3 run
 *      produces, and the one the generation store used to throw away,
 *   4. the assemble route, which writes the knowledge body back into the draft,
 *   5. publishing again, which now succeeds and mints a readable version.
 *
 * The draft is inserted as owner-admin setup rather than created through the
 * v3/draft route, for one reason: the assembler binds the narrative to the
 * identity it was generated against, so the identity has to be the one the
 * shared assembly fixtures' evidence and narrative describe. Creating it
 * through the route would derive a different official name and alias list from
 * a Profile and prove something about `kb-profile-ref-v3.ts` instead. The
 * inserted draft is byte-for-byte the shape `createGeoKbDraftPayloadV3` emits:
 * knowledge null, empty review, four null runRef ids.
 */
import { randomUUID } from "node:crypto";

import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connectFreshMarketingSchema } from "../credits/sql-test-harness.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { geoGenerationInputHash } from "./kb-generation.ts";
import { createGeoKbGenerationStore, type GeoKbRpcTransport } from "./kb-generation-store.ts";
import type { GeoKbStoreDependencies } from "./kb-store.ts";
import {
  assemblyEvidence,
  ASSEMBLY_IDENTITY,
} from "./kb-knowledge-assemble.test-fixtures.ts";
import {
  geoV2NarrativeFixture,
  geoV2ProfileRefFixture,
} from "./kb-knowledge-synthesis-v2-fixtures.ts";
import {
  buildGeoKnowledgeGenerationResultV2,
  buildGeoKnowledgeSynthesisInputV2,
} from "./kb-knowledge-synthesis-v2-contract.ts";
import { readVersionedGeoKnowledgeBase } from "./kb-versioned-read.ts";
import { publishGeoKbV3, readGeoKbGenerationSummaryV3, saveGeoKbDraftV3 } from "./kb-v3-store.ts";
import { handleGeoKbV3Publish, type GeoKbV3PublishDependencies } from "./kb-v3-publish-handler.ts";
import {
  handleGeoKbV3Assemble,
  type GeoKbV3AssembleDependencies,
} from "./kb-v3-assemble-handler.ts";
import {
  geoV3ItemKeys,
  geoV3Items,
  parseGeoKbPayloadV3,
  type GeoKbPayloadV3,
} from "./kb-v3-contract.ts";
import { geoV3ItemContentHashes } from "./kb-v3-item-content.ts";
import { applyGeoV3ReviewAction, geoV3DecisionStates, materializeGeoV3Review } from "./kb-v3-review.ts";
import { parseGeoKnowledgePackV2 } from "./kb-knowledge-pack-v2-contract.ts";

let db: Client;
beforeAll(async () => {
  db = await connectFreshMarketingSchema();
});
afterAll(async () => {
  await db?.end();
});

const ORIGIN = "https://product.example";
const SITE_KEY = "product.example";
const PROFILE_HASH = "b".repeat(64);
const EVIDENCE_HASH = "e".repeat(64);
const GENERATED_AT = "2026-09-05T00:00:00.000Z";
const NOW = new Date("2026-09-06T00:00:00.000Z");
/** The moment the owner excluded an item; a revival must never re-date it. */
const DECIDED_AT = "2026-09-05T02:00:00.000Z";
type Narrative = ReturnType<typeof geoV2NarrativeFixture>;
const ATTEMPT = {
  attemptedCalls: 1 as const,
  delivery: "response_received" as const,
  modelRequested: "offline-model",
  inputTokens: 12,
  outputTokens: 30,
  requestCount: 1,
};

/**
 * `pg` returns timestamps as `Date` while PostgREST returns ISO strings, and
 * every store parser requires the string. A transport that skipped this would
 * report a save that had already written its row as unavailable.
 */
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
    callRpc: async (name, params) => {
      const result = await transport.callRpc(name, params);
      return result.error === null ? { kind: "ok", data: result.data } : { kind: "error", code: null };
    },
  };
}

/**
 * The locked half of a v3 draft, over this test's own confirmed Profile
 * snapshot and over the identity the shared assembly fixtures describe.
 */
function generationInput(websiteId: string, snapshotId: string) {
  return {
    identity: ASSEMBLY_IDENTITY,
    profileRef: { ...geoV2ProfileRefFixture(), websiteId, snapshotId, snapshotRevision: "3", profileHash: PROFILE_HASH },
    competitors: [{ domain: "rival.example", brandName: "Rival", confirmed: true }],
    roles: [],
    evidenceContentHash: EVIDENCE_HASH,
  };
}

function emptyDraft(websiteId: string, snapshotId: string): GeoKbPayloadV3 {
  const input = generationInput(websiteId, snapshotId);
  return parseGeoKbPayloadV3({
    schemaVersion: "marketing-geo-kb.v3",
    generationInput: input,
    knowledge: null,
    review: { decisions: [], suppressions: [] },
    runRef: {
      runId: null,
      generationInputHash: geoV2Digest(input),
      rolesGenerationId: null,
      knowledgeGenerationId: null,
      questionsGenerationId: null,
    },
  });
}

interface Fixture {
  readonly userId: string;
  readonly kbId: string;
  readonly websiteId: string;
  readonly snapshotId: string;
  readonly payload: GeoKbPayloadV3;
  readonly draftHash: string;
  readonly assemble: GeoKbV3AssembleDependencies;
  readonly publish: GeoKbV3PublishDependencies;
  readonly store: ReturnType<typeof createGeoKbGenerationStore>;
}

async function fixture(): Promise<Fixture> {
  const userId = randomUUID();
  const websiteId = randomUUID();
  const snapshotId = randomUUID();
  const upserted = await db.query(
    "select * from public.marketing_geo_upsert_kb($1,$2,$3,$3)",
    [userId, ORIGIN, SITE_KEY],
  );
  const kbId = upserted.rows[0]!.kb_id as string;
  await db.query(
    "insert into public.marketing_websites(id,user_id,canonical_site_key,origin,submitted_url,host) values($1,$2,$3,$4,$4,$3)",
    [websiteId, userId, SITE_KEY, ORIGIN],
  );
  await db.query(
    "insert into public.marketing_website_profile_snapshots(id,website_id,user_id,revision,schema_version,profile,content_hash,source_draft_version) values($1,$2,$3,3,'marketing-website-profile.v1',$4,$5,1)",
    [snapshotId, websiteId, userId, JSON.stringify({ productName: "Pine Cloud" }), PROFILE_HASH],
  );
  await db.query("update public.marketing_websites set current_confirmed_snapshot_id=$1 where id=$2", [snapshotId, websiteId]);

  const payload = emptyDraft(websiteId, snapshotId);
  const draftHash = geoV2Digest(payload);
  await db.query(
    "insert into public.marketing_geo_kb_drafts(kb_id,user_id,schema_version,draft_version,payload,content_hash) values($1,$2,'marketing-geo-kb.v3',1,$3,$4)",
    [kbId, userId, payload, draftHash],
  );

  const transport = rpcTransport();
  const store = createGeoKbGenerationStore(transport);
  const deps = storeDependencies();
  const authenticate = (async () => ({ status: "authenticated", userId })) as GeoKbV3AssembleDependencies["authenticate"];
  const readDetails: GeoKbV3AssembleDependencies["readDetails"] = (input) => readVersionedGeoKnowledgeBase(input, deps);
  const saveDraft: GeoKbV3AssembleDependencies["saveDraft"] = (input) => saveGeoKbDraftV3(input, transport);
  const generationRunning = async (owner: string, kb: string): Promise<boolean | "unavailable"> => {
    let unavailable = false;
    for (const kind of ["roles", "questions", "knowledge_pack"] as const) {
      const read = await store.readLatest({ userId: owner, kbId: kb, kind });
      if (read.kind !== "ok") { unavailable = true; continue; }
      if (read.generation !== null && read.generation.state === "dispatched") return true;
    }
    return unavailable ? "unavailable" : false;
  };
  return {
    userId, kbId, websiteId, snapshotId, payload, draftHash, store,
    assemble: {
      authenticate,
      readDetails,
      saveDraft,
      readLatestGeneration: (input) => store.readLatest(input),
      generationRunning,
    },
    publish: {
      authenticate,
      readDetails,
      saveDraft,
      readGeneration: (input) => readGeoKbGenerationSummaryV3(input, transport),
      publish: (input) => publishGeoKbV3(input, transport),
      generationRunning,
      newCandidateId: () => randomUUID(),
      now: () => NOW,
    },
  };
}

/**
 * The knowledge generation a v3 run produces, through the real state machine.
 *
 * `baseDraftVersion`/`baseDraftHash` are not decoration: the v3 branch of
 * `marketing_geo_generation_input_current` refuses a claim whose manifest does
 * not name the draft as it stands right now, so a caller must pass the current
 * pair. That is also what makes a second run a second row -- an identical
 * manifest hashes identically and `marketing_geo_claim_generation` reuses the
 * existing generation rather than creating one.
 *
 * `marketing_geo_read_generation` picks the newest by `created_at desc, id
 * desc`, and the id tie-break is a random uuid -- but `created_at` is immutable
 * by trigger (`marketing_geo_generation_guard`), so ordering cannot be stamped
 * into place. It does not need to be: each claim here is its own transaction
 * with an awaited assembly between, so the transaction timestamps are separated
 * by far more than the microsecond a tie would need.
 */
interface RunOptions {
  readonly key?: string;
  readonly narrative?: (value: Narrative) => unknown;
}
async function runKnowledgeGeneration(f: Fixture, draftVersion: number, draftHash: string, options: RunOptions = {}) {
  const evidence = assemblyEvidence();
  const generationInputHash = f.payload.runRef.generationInputHash;
  const synthesisInput = buildGeoKnowledgeSynthesisInputV2(
    {
      officialName: ASSEMBLY_IDENTITY.officialName,
      aliases: [...ASSEMBLY_IDENTITY.aliases],
      categoryTerms: [...ASSEMBLY_IDENTITY.categoryTerms],
      market: ASSEMBLY_IDENTITY.market.country,
      language: ASSEMBLY_IDENTITY.market.language,
      profileRef: f.payload.generationInput.profileRef,
      generationInputHash,
    },
    evidence,
  );
  const manifest = JSON.parse(JSON.stringify({
    schemaVersion: "marketing-geo-knowledge-generation-input.v2",
    kbId: f.kbId,
    baseDraftVersion: String(draftVersion),
    baseDraftHash: draftHash,
    generationInputHash,
    sourceReceiptRefs: [],
    knowledgeSynthesisInput: synthesisInput,
  })) as Record<string, never>;
  const claimed = await f.store.claim({
    userId: f.userId, kbId: f.kbId, kind: "knowledge_pack", idempotencyKey: options.key ?? "assemble_integration_1",
    input: manifest, inputHash: geoGenerationInputHash("knowledge_pack", manifest),
  });
  if (claimed.kind !== "claimed") throw new Error(`expected a claim, got ${claimed.kind}`);
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
    narrative: (options.narrative ?? ((value: Narrative) => value))(geoV2NarrativeFixture()),
    generatedAt: GENERATED_AT,
  });
  const finished = await f.store.finish(scope, { state: "succeeded", result: result as never, errorReason: null, attempt: ATTEMPT });
  return { generationId: scope.generationId, finished, result };
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
  ).rows[0]!;
  return {
    draftVersion: row.draft_version as number,
    contentHash: row.content_hash as string,
    payload: parseGeoKbPayloadV3(row.payload),
  };
}

describe("assembling a v3 draft against the real database", () => {
  it("turns a draft nothing could publish into a published version", async () => {
    const f = await fixture();

    // 1. The state every v3 draft in production is in: no knowledge at all.
    expect(f.payload.knowledge).toBeNull();

    // 2. Publishing refuses, and this is the break: `nothing_to_publish` is
    //    unconditional while knowledge is null, because a v3 draft has no
    //    question generation either.
    const refused = await handleGeoKbV3Publish(
      request("publish", { kbId: f.kbId, baseVersion: 1, draftHash: f.draftHash }),
      f.publish,
    );
    expect(refused.status).toBe(422);
    expect(await refused.json()).toEqual({ error: { code: "nothing_to_publish" } });

    // 3. One knowledge generation, claimed and finished through the real
    //    functions. The result is a v2 record: the store used to refuse it
    //    before the RPC was even called, which threw the paid narrative away.
    const generation = await runKnowledgeGeneration(f, 1, f.draftHash);
    expect(generation.finished.kind).toBe("ok");
    if (generation.finished.kind !== "ok") return;
    expect(generation.finished.generation.state).toBe("succeeded");

    // 4. Assemble. This is the step that had no code.
    const assembled = await handleGeoKbV3Assemble(
      request("assemble", { kbId: f.kbId, baseVersion: 1, draftHash: f.draftHash }),
      f.assemble,
    );
    const assembledBody = (await assembled.json()) as { readonly data: Record<string, never> };
    expect(assembled.status).toBe(200);
    expect(assembledBody.data).toMatchObject({
      kbId: f.kbId,
      draftVersion: 2,
      knowledgeGenerationId: generation.generationId,
      assembledAt: GENERATED_AT,
      changed: true,
    });

    const afterAssembly = await storedDraft(f);
    expect(afterAssembly.draftVersion).toBe(2);
    expect(afterAssembly.payload.knowledge).not.toBeNull();
    expect(geoV3ItemKeys(afterAssembly.payload.knowledge).length).toBeGreaterThan(0);
    expect(afterAssembly.payload.runRef.knowledgeGenerationId).toBe(generation.generationId);
    // The locked half did not move, which is what keeps the paid run reusable.
    expect(afterAssembly.payload.runRef.generationInputHash).toBe(f.payload.runRef.generationInputHash);
    expect(afterAssembly.payload.generationInput).toEqual(f.payload.generationInput);

    // 5. Publishing now succeeds and mints a readable version.
    const published = await handleGeoKbV3Publish(
      request("publish", { kbId: f.kbId, baseVersion: afterAssembly.draftVersion, draftHash: afterAssembly.contentHash }),
      f.publish,
    );
    const publishedBody = (await published.json()) as { readonly data: Record<string, never> };
    expect(published.status).toBe(200);
    expect(publishedBody.data).toMatchObject({ revision: 1, reusedExisting: false });

    const snapshot = (
      await db.query("select payload,question_set,content_hash from public.marketing_geo_kb_snapshots where kb_id=$1", [f.kbId])
    ).rows[0]!;
    const frozen = parseGeoKbPayloadV3(snapshot.payload);
    expect(frozen.knowledge).not.toBeNull();
    // A v3 version publishes without a question set; that half stays honestly absent.
    expect(snapshot.question_set).toBeNull();
    // The knowledge pack a consumer reads is derived from the same body, and it
    // is the candidate -- the immutable record of what was published -- that
    // carries it, not the snapshot context.
    const candidate = (await db.query(
      "select candidate from public.marketing_geo_kb_prepared_candidates where kb_id=$1", [f.kbId],
    )).rows[0]!.candidate as { readonly knowledgePack: unknown; readonly payload: { readonly runRef: { readonly knowledgeGenerationId: string } } };
    const pack = parseGeoKnowledgePackV2(candidate.knowledgePack);
    expect(pack.entity.status).not.toBe("unavailable");
    expect(pack.facts.status).not.toBe("unavailable");
    // The candidate names the paid run this version reused.
    expect(candidate.payload.runRef.knowledgeGenerationId).toBe(generation.generationId);
  });

  it("writes no second version when the same generation is assembled twice", async () => {
    const f = await fixture();
    await runKnowledgeGeneration(f, 1, f.draftHash);

    const first = await handleGeoKbV3Assemble(request("assemble", { kbId: f.kbId, baseVersion: 1, draftHash: f.draftHash }), f.assemble);
    expect(first.status).toBe(200);
    const after = await storedDraft(f);
    expect(after.draftVersion).toBe(2);

    const second = await handleGeoKbV3Assemble(
      request("assemble", { kbId: f.kbId, baseVersion: after.draftVersion, draftHash: after.contentHash }),
      f.assemble,
    );
    const body = (await second.json()) as { readonly data: Record<string, never> };
    expect(second.status).toBe(200);
    expect(body.data).toMatchObject({ draftVersion: 2, changed: false });
    const again = await storedDraft(f);
    expect(again.draftVersion).toBe(2);
    expect(again.contentHash).toBe(after.contentHash);
  });

  it("engages the generation-input lock, and leaves its documented release open", async () => {
    const f = await fixture();
    await runKnowledgeGeneration(f, 1, f.draftHash);
    await handleGeoKbV3Assemble(request("assemble", { kbId: f.kbId, baseVersion: 1, draftHash: f.draftHash }), f.assemble);
    const after = await storedDraft(f);
    expect(after.payload.runRef.knowledgeGenerationId).not.toBeNull();

    // Naming the generation is what arms `marketing_geo_save_kb_draft`'s v3
    // lock: from here the locked input is read-only, so a decision can never be
    // attributed to inputs it was not made against.
    const relockedInput = { ...after.payload.generationInput, evidenceContentHash: "c".repeat(64) };
    const refused = await saveGeoKbDraftV3(
      {
        userId: f.userId,
        kbId: f.kbId,
        payload: parseGeoKbPayloadV3({ ...after.payload, generationInput: relockedInput, runRef: { ...after.payload.runRef, generationInputHash: geoV2Digest(relockedInput) } }),
        baseVersion: after.draftVersion,
      },
      rpcTransport(),
    );
    expect(refused.kind).toBe("input_locked");

    // ...and the release the SQL documents still works: a save may re-lock a new
    // input by clearing all four ids in the same write, which forfeits reuse of
    // everything the old input paid for. Without this the lock would have no
    // exit and the second update of every knowledge base would be impossible.
    const released = await saveGeoKbDraftV3(
      {
        userId: f.userId,
        kbId: f.kbId,
        payload: parseGeoKbPayloadV3({
          ...after.payload,
          generationInput: relockedInput,
          runRef: { runId: null, generationInputHash: geoV2Digest(relockedInput), rolesGenerationId: null, knowledgeGenerationId: null, questionsGenerationId: null },
        }),
        baseVersion: after.draftVersion,
      },
      rpcTransport(),
    );
    expect(released.kind).toBe("ok");
  });

  it("refuses to assemble a generation bought against a different locked input", async () => {
    const f = await fixture();
    await runKnowledgeGeneration(f, 1, f.draftHash);
    // The owner re-locked the input, which the database allows only by clearing
    // every runRef id in the same save -- and that forfeits reuse of the run.
    const relocked = parseGeoKbPayloadV3({
      ...f.payload,
      generationInput: { ...f.payload.generationInput, evidenceContentHash: "c".repeat(64) },
      runRef: { ...f.payload.runRef, generationInputHash: geoV2Digest({ ...f.payload.generationInput, evidenceContentHash: "c".repeat(64) }) },
    });
    const saved = await saveGeoKbDraftV3(
      { userId: f.userId, kbId: f.kbId, payload: relocked, baseVersion: 1 },
      rpcTransport(),
    );
    expect(saved.kind).toBe("ok");
    if (saved.kind !== "ok") return;

    const response = await handleGeoKbV3Assemble(
      request("assemble", { kbId: f.kbId, baseVersion: saved.value.draftVersion, draftHash: saved.value.contentHash }),
      f.assemble,
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: "input_changed" } });
    expect((await storedDraft(f)).payload.knowledge).toBeNull();
  });
  /**
   * The one merge branch that reads a draft version, and the product guarantee
   * it exists for: an exclusion the owner made must not be quietly handed back
   * when a later run brings the item around again.
   *
   * `mergeGeoDraftV3` reaches `reviveSuppression` only when an item is absent
   * from the draft being replaced *and* still carries a suppression, so nothing
   * short of the full disappear/reappear sequence exercises it. Until this test
   * `previousDraftVersion` could be pinned to any constant and every other test
   * in this repository stayed green.
   *
   * It is also the only place a second and a third assembly run against an
   * armed `generation_input_locked`: the run B and run C saves both carry a
   * knowledgeGenerationId that is already non-empty, which is exactly the case
   * an earlier version of that lock refused outright.
   */
  it("hands a revived exclusion back excluded, stamped with the version it was revived against", async () => {
    const f = await fixture();
    const withItem = (value: Narrative) => ({
      ...value,
      scope: { ...value.scope, doesNot: [{ id: "scope:not", text: "Does not run offline.", sourceRefs: ["source:own"] }] },
    });

    // Run A says the thing; the draft goes 1 -> 2.
    await runKnowledgeGeneration(f, 1, f.draftHash, { key: "assemble_revive_a", narrative: withItem });
    const assembledA = await handleGeoKbV3Assemble(request("assemble", { kbId: f.kbId, baseVersion: 1, draftHash: f.draftHash }), f.assemble);
    expect(assembledA.status).toBe(200);
    const afterA = await storedDraft(f);
    const target = geoV3Items(afterA.payload.knowledge).find(
      (item) => item.module === "scope" && item.claims.some((claim) => claim.text.includes("Does not run offline")),
    );
    expect(target).toBeDefined();
    const itemKey = target!.itemKey;

    // The owner excludes it, through the same review machinery the editor drives.
    const states = geoV3DecisionStates(afterA.payload.review, geoV3ItemKeys(afterA.payload.knowledge));
    const review = materializeGeoV3Review(
      afterA.payload.review,
      applyGeoV3ReviewAction(states, { kind: "exclude", itemKey }),
      {
        contentHash: geoV3ItemContentHashes(afterA.payload.knowledge),
        decidedAt: DECIDED_AT,
        baseDraftVersion: String(afterA.draftVersion),
      },
    );
    const saved = await saveGeoKbDraftV3(
      { userId: f.userId, kbId: f.kbId, payload: parseGeoKbPayloadV3({ ...afterA.payload, review }), baseVersion: afterA.draftVersion },
      rpcTransport(),
    );
    // The lock is already armed here -- knowledgeGenerationId is set -- and this
    // save is allowed because it does not move the locked input.
    expect(saved.kind).toBe("ok");
    if (saved.kind !== "ok") return;

    // Run B stops saying it. The item leaves the body and the decision goes
    // with it; only the suppression remembers the owner ever threw it out.
    await runKnowledgeGeneration(f, saved.value.draftVersion, saved.value.contentHash, { key: "assemble_revive_b" });
    const assembledB = await handleGeoKbV3Assemble(
      request("assemble", { kbId: f.kbId, baseVersion: saved.value.draftVersion, draftHash: saved.value.contentHash }),
      f.assemble,
    );
    expect(assembledB.status).toBe(200);
    const afterB = await storedDraft(f);
    expect(geoV3ItemKeys(afterB.payload.knowledge)).not.toContain(itemKey);
    expect(afterB.payload.review.decisions.map((record) => record.itemKey)).not.toContain(itemKey);
    expect(afterB.payload.review.suppressions.map((record) => record.itemKey)).toContain(itemKey);

    // Run C says it again. This is the revival.
    await runKnowledgeGeneration(f, afterB.draftVersion, afterB.contentHash, { key: "assemble_revive_c", narrative: withItem });
    const assembledC = await handleGeoKbV3Assemble(
      request("assemble", { kbId: f.kbId, baseVersion: afterB.draftVersion, draftHash: afterB.contentHash }),
      f.assemble,
    );
    expect(assembledC.status).toBe(200);
    const afterC = await storedDraft(f);
    expect(geoV3ItemKeys(afterC.payload.knowledge)).toContain(itemKey);
    const revived = afterC.payload.review.decisions.find((record) => record.itemKey === itemKey);
    // Back in the body and still excluded, rather than silently returned.
    expect(revived?.decision).toBe("excluded");
    // Filed against the draft that was replaced -- run B's version. Not the
    // version this save produces, and not the version the owner first decided
    // on, which is what makes this assertion able to fail.
    expect(afterB.draftVersion).not.toBe(afterA.draftVersion);
    expect(revived?.baseDraftVersion).toBe(String(afterB.draftVersion));
    // The owner decided when they decided: a revival re-files a decision, it
    // never re-dates one.
    expect(revived?.decidedAt).toBe(DECIDED_AT);

    // The revival is stable: assembling the same run again writes nothing, so
    // a poller cannot churn the draft through this branch either.
    const again = await handleGeoKbV3Assemble(
      request("assemble", { kbId: f.kbId, baseVersion: afterC.draftVersion, draftHash: afterC.contentHash }),
      f.assemble,
    );
    expect(again.status).toBe(200);
    expect(((await again.json()) as { readonly data: { readonly changed: boolean } }).data.changed).toBe(false);
    expect((await storedDraft(f)).draftVersion).toBe(afterC.draftVersion);
  });
});
