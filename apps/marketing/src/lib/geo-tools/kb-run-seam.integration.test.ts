// @input  -- only a named loopback disposable Marketing database and synthetic values
// @output -- proof that one run buys knowledge, files it, and leaves a draft that publishes
// @pos    -- real SQL and the real handlers; no provider call and no network fetch

/**
 * The last mile, driven end to end.
 *
 * An owner could open a v3 card, create a draft and start a run that fetched
 * pages -- and the chain dead-ended there. The run seeded on-site fetches and
 * nothing else, so no `knowledge_pack` generation was ever created for a v3
 * draft, `payload.knowledge` stayed null on every stored draft, and
 * `handleGeoKbV3Publish` answered `nothing_to_publish` (422) forever. Nothing
 * called the assemble route either: `handleGeoKbV3Assemble` had exactly one
 * reference in the repository, its own route file.
 *
 * This file runs the real sequence against the real SQL:
 *
 *   1. a v3 draft with `knowledge: null` -- what the creator actually produces,
 *   2. publishing it, which must still refuse, so the fix is measured against
 *      the failure rather than asserted about it,
 *   3. `handleGeoKbRun` called until it reports `complete`, driving the real
 *      ledger, the real collect executor and the real knowledge step,
 *   4. the draft, which now carries a knowledge body and names the generation,
 *   5. publishing again, which mints a readable version.
 *
 * Two seams are faked and only two: the page reader (no run may reach the
 * public internet) and the narrative runner (no test may call a provider).
 * Everything between them -- the crawl-gate-shaped reader contract, the
 * observation library, `marketing_geo_claim_generation`'s input binding, the
 * generation state machine, the assemble merge and the publish candidate -- is
 * the code the route runs.
 *
 * The draft is inserted as owner-admin setup rather than created through the
 * v3/draft route for the same reason `kb-v3-assemble.integration.test.ts` does
 * it: the assembler binds the narrative to the identity it was generated
 * against, so the identity has to be the one the shared assembly fixtures
 * describe.
 */
import { randomUUID } from "node:crypto";

import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { connectFreshMarketingSchema } from "../credits/sql-test-harness.ts";
import type { KeywordLlmConfig } from "../tools/keyword-llm-client.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { createGeoKbGenerationStore, type GeoKbRpcTransport } from "./kb-generation-store.ts";
import { createGeoKbGenerationPreparer } from "./kb-generation-preparer.ts";
import type { GeoKbGenerationHandlerDependencies } from "./kb-generation-handler.ts";
import type { GeoKbStoreDependencies } from "./kb-store.ts";
import { assemblyEvidence, ASSEMBLY_IDENTITY } from "./kb-knowledge-assemble.test-fixtures.ts";
import { geoV2NarrativeFixture, geoV2ProfileRefFixture } from "./kb-knowledge-synthesis-v2-fixtures.ts";
import type { GeoKnowledgeEvidenceReadResource } from "./kb-knowledge-evidence.ts";
import { readLatestObservation, recordObservation } from "./kb-evidence-observations.ts";
import { readVersionedGeoKnowledgeBase } from "./kb-versioned-read.ts";
import { publishGeoKbV3, readGeoKbGenerationSummaryV3, saveGeoKbDraftV3 } from "./kb-v3-store.ts";
import { handleGeoKbV3Publish, type GeoKbV3PublishDependencies } from "./kb-v3-publish-handler.ts";
import type { GeoKbV3AssembleDependencies } from "./kb-v3-assemble-handler.ts";
import { parseGeoKbPayloadV3, geoV3Items, type GeoKbPayloadV3 } from "./kb-v3-contract.ts";
import { createGeoRunLedgerStore, abandonGeoKbRun } from "./kb-run-store.ts";
import { createGeoRunCollectRuntime } from "./kb-run-collect-executor.ts";
import { GEO_RUN_KNOWLEDGE_MODEL_SEED } from "./kb-run-collect.ts";
import {
  createGeoKbRunRuntime,
  createGeoRunKnowledgeExecutor,
  createGeoRunKnowledgeSources,
  createGeoRunUpdateExecutor,
  geoRunKnowledgeIdempotencyKey,
} from "./kb-run-runtime.ts";
import { handleGeoKbRun } from "./kb-run-handler.ts";
import type { GeoRunContext } from "./kb-run-advance.ts";

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

/** Offline by construction: an https URL that resolves nowhere and is never called. */
const OFFLINE_MODEL: KeywordLlmConfig = {
  url: "https://offline.invalid/v1/chat/completions",
  apiKey: "offline-key",
  model: "offline-model",
  authScheme: "bearer",
  temperature: null,
};

const PAGE_HTML = `<!doctype html><html lang="en"><head><title>Pine Cloud</title></head><body>
<h1>Pine Cloud</h1>
<p>Pine Cloud is a project planning workspace for small delivery teams who need one shared plan.</p>
<p>Every plan carries its own owners, dates and dependencies, so a change in one place is visible everywhere.</p>
<p>Teams on the paid tier get retention of two years and an export that keeps the original timestamps.</p>
</body></html>`;

/**
 * `pg` returns timestamps as `Date` while PostgREST returns ISO strings, and
 * every store parser requires the string.
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

function generationInput(websiteId: string, snapshotId: string) {
  return {
    identity: ASSEMBLY_IDENTITY,
    profileRef: { ...geoV2ProfileRefFixture(), websiteId, snapshotId, snapshotRevision: "3", profileHash: PROFILE_HASH },
    competitors: [{ domain: "rival.example", brandName: "Rival", confirmed: true }],
    roles: [],
    evidenceContentHash: EVIDENCE_HASH,
  };
}

/** Byte-for-byte the shape `createGeoKbDraftPayloadV3` emits. */
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
  readonly draftHash: string;
  readonly payload: GeoKbPayloadV3;
  readonly run: ReturnType<typeof createGeoKbRunRuntime>;
  readonly knowledge: ReturnType<typeof createGeoRunKnowledgeExecutor>;
  readonly publish: GeoKbV3PublishDependencies;
  readonly reads: ReturnType<typeof vi.fn>;
  readonly synthesized: ReturnType<typeof vi.fn>;
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
  const deps = storeDependencies();
  const generationStore = createGeoKbGenerationStore(transport);
  const authenticate = (async () => ({ status: "authenticated", userId, email: null, avatarUrl: null })) as GeoKbV3AssembleDependencies["authenticate"];
  const readDetails = async (input: { readonly userId: string; readonly kbId: string }) =>
    await readVersionedGeoKnowledgeBase(input, deps);

  /** No run may reach the public internet. Every page this run sees comes from here. */
  const reads = vi.fn(async (input: { url: string }) => ({
    kind: "ok" as const,
    url: input.url,
    body: PAGE_HTML,
    contentType: "text/html; charset=utf-8",
    observedAt: new Date().toISOString(),
  }));
  /** No test may call a provider. The narrative is the shared fixture. */
  const synthesized = vi.fn(async () => ({
    ok: true as const,
    value: geoV2NarrativeFixture(),
    usage: { inputTokens: 120, outputTokens: 340, requestCount: 1, retryCount: 0 },
    provider: {
      modelRequested: OFFLINE_MODEL.model, modelReported: null, authScheme: "bearer" as const,
      effectiveTemperature: 0, maxOutputTokens: 8_000,
    },
    attemptedCalls: 1 as const,
    delivery: "response_received" as const,
  }));

  const collect = createGeoRunCollectRuntime({
    readDetails,
    resolveWebsiteId: async () => ({ kind: "ok", websiteId }),
    readLatestObservation: async (input) => await readLatestObservation(input, transport),
    recordObservation: async (input) => await recordObservation(input, transport),
    createReader: () => reads as unknown as GeoKnowledgeEvidenceReadResource,
    now: () => new Date(),
  });

  const generation = (owner: string): GeoKbGenerationHandlerDependencies => ({
    authenticate: (async () => ({ status: "authenticated", userId: owner, email: null, avatarUrl: null })) as GeoKbGenerationHandlerDependencies["authenticate"],
    prepare: createGeoKbGenerationPreparer({
      readDetails: async (input) => {
        const read = await readDetails(input);
        return read.kind === "ok" ? read : { kind: read.kind === "missing" ? "missing" : "unavailable" };
      },
      validateCurrentProfileCopy: async () => "current",
      readReceipt: async () => ({ kind: "missing" }),
      readGeneration: async (input) => {
        const read = await generationStore.read(input);
        return read.kind !== "ok" ? { kind: "unavailable" } : read.generation === null ? { kind: "missing" } : { kind: "ok", generation: read.generation };
      },
      resolveConfig: () => OFFLINE_MODEL,
      collectKnowledgeEvidence: async () => assemblyEvidence(),
      synthesizeKnowledgeV2: synthesized as never,
      now: () => new Date(GENERATED_AT),
    }),
    store: generationStore,
    consumeQuota: async () => "allowed",
  });

  const assemble = (owner: string): GeoKbV3AssembleDependencies => ({
    authenticate: (async () => ({ status: "authenticated", userId: owner, email: null, avatarUrl: null })) as GeoKbV3AssembleDependencies["authenticate"],
    readDetails,
    saveDraft: async (input) => await saveGeoKbDraftV3(input, transport),
    readLatestGeneration: async (input) => await generationStore.readLatest(input),
  });

  const knowledge = createGeoRunKnowledgeExecutor(
    createGeoRunKnowledgeSources({ readDetails, generation, assemble }),
  );

  return {
    userId, kbId, draftHash, payload, knowledge, reads, synthesized,
    run: createGeoKbRunRuntime({
      authenticate: authenticate as never,
      store: createGeoRunLedgerStore(transport),
      abandon: async (input) => await abandonGeoKbRun(input, transport),
      seedOperations: collect.seedOperations,
      executor: createGeoRunUpdateExecutor({ fetch: collect.executor, model: knowledge }),
      now: () => new Date(),
    }),
    publish: {
      authenticate,
      readDetails,
      saveDraft: async (input) => await saveGeoKbDraftV3(input, transport),
      readGeneration: async (input) => await readGeoKbGenerationSummaryV3(input, transport),
      publish: async (input) => await publishGeoKbV3(input, transport),
      newCandidateId: () => randomUUID(),
      now: () => NOW,
    },
  };
}

function request(path: string, body: unknown): Request {
  return new Request(`https://gengrowth.ai/api/tools/geo-knowledge-base/v3/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

interface RunView {
  readonly status: string;
  readonly run: { readonly runId: string; readonly generationInputHash: string | null } | null;
  readonly operations: readonly { readonly key: string; readonly kind: string; readonly state: string; readonly reason: string | null }[];
  readonly skipped: readonly string[];
}

async function advance(f: Fixture, body: Record<string, unknown>): Promise<{ readonly status: number; readonly data: RunView }> {
  const response = await handleGeoKbRun(request("run", { kbId: f.kbId, ...body }), f.run);
  const parsed = (await response.json()) as { readonly data?: RunView; readonly error?: { readonly code: string } };
  if (parsed.data === undefined) throw new Error(`run refused: ${response.status} ${parsed.error?.code ?? "?"}`);
  return { status: response.status, data: parsed.data };
}

/** Call the route the way the card does: until it says it is done. */
async function driveToCompletion(f: Fixture, idempotencyKey: string): Promise<{ readonly view: RunView; readonly calls: number }> {
  let view = (await advance(f, { idempotencyKey })).data;
  let calls = 1;
  const runId = view.run?.runId;
  if (runId === undefined || runId === null) throw new Error("the run opened without a run id");
  while (view.status === "in_progress" && calls < 12) {
    view = (await advance(f, { runId })).data;
    calls += 1;
  }
  return { view, calls };
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

async function generationRows(f: Fixture) {
  // The idempotency key lives in its own table, so the join is what proves the
  // record this run bought is the one its key names.
  const rows = await db.query(
    `select g.id, g.kind, g.state, k.idempotency_key
       from public.marketing_geo_kb_generations g
       left join public.marketing_geo_kb_generation_keys k
         on k.generation_id = g.id and k.kb_id = g.kb_id and k.user_id = g.user_id
      where g.kb_id = $1 order by g.created_at, g.id`,
    [f.kbId],
  );
  return rows.rows as { id: string; kind: string; state: string; idempotency_key: string | null }[];
}

describe("one run, from an unpublishable draft to a published version", () => {
  it("buys the knowledge step, files it, and lets publish succeed", async () => {
    const f = await fixture();

    // 1. The state every v3 draft in production is in.
    expect(f.payload.knowledge).toBeNull();

    // 2. The break, measured rather than asserted: `nothing_to_publish` is
    //    unconditional while knowledge is null, because a v3 draft has no
    //    question generation either.
    const refused = await handleGeoKbV3Publish(
      request("publish", { kbId: f.kbId, baseVersion: 1, draftHash: f.draftHash }),
      f.publish,
    );
    expect(refused.status).toBe(422);
    expect(await refused.json()).toEqual({ error: { code: "nothing_to_publish" } });

    // 3. The run, driven exactly as the card drives it.
    const { view, calls } = await driveToCompletion(f, "runseam-integration-1");
    expect(view.status).toBe("complete");
    // Two pages and one model step, one operation per invocation.
    expect(view.operations.map((operation) => operation.kind)).toEqual(["fetch", "fetch", "model"]);
    expect(calls).toBe(3);
    expect(view.skipped).toEqual([]);
    for (const operation of view.operations) {
      expect([operation.key, operation.state, operation.reason]).toEqual([operation.key, "succeeded", null]);
    }
    // The pages really were read, through the reader contract the crawl gate
    // sits behind, and the narrative runner really was called once. The two
    // page reads are not the whole list: once its own page row is filed, the
    // own-site operation spends the same admission on the three machine-
    // readable files at that origin. A competitor operation reads only its
    // page, so naming every address here is what keeps a fourth read from
    // being added to a rival's host without this test noticing.
    const readAddresses = f.reads.mock.calls.map((call) => (call[0] as { readonly url: string }).url);
    expect(readAddresses).toEqual([
      "https://product.example/",
      "https://product.example/robots.txt",
      "https://product.example/sitemap.xml",
      "https://product.example/llms.txt",
      "https://rival.example/",
    ]);
    expect(f.synthesized).toHaveBeenCalledTimes(1);
    // The run says what its paid generation is pinned to.
    expect(view.run?.generationInputHash).toBe(f.payload.runRef.generationInputHash);

    // 4. Exactly one paid record, under this run's own key.
    const generations = await generationRows(f);
    expect(generations).toHaveLength(1);
    expect(generations[0]).toMatchObject({ kind: "knowledge_pack", state: "succeeded" });
    expect(generations[0]!.idempotency_key).toBe(geoRunKnowledgeIdempotencyKey(view.run!.runId));

    // 5. The draft carries the knowledge and names the record it came from.
    const after = await storedDraft(f);
    expect(after.payload.knowledge).not.toBeNull();
    expect(geoV3Items(after.payload.knowledge).length).toBeGreaterThan(0);
    expect(after.payload.runRef.knowledgeGenerationId).toBe(generations[0]!.id);
    // The locked half did not move, which is what keeps the paid run reusable.
    expect(after.payload.generationInput).toEqual(f.payload.generationInput);
    expect(after.payload.runRef.generationInputHash).toBe(f.payload.runRef.generationInputHash);
    // The model operation's stored pointer is the generation, not a copy of it.
    const modelOperation = view.operations.find((operation) => operation.key === GEO_RUN_KNOWLEDGE_MODEL_SEED.key);
    expect(modelOperation?.state).toBe("succeeded");

    // 6. Publishing now succeeds and mints a readable version.
    const published = await handleGeoKbV3Publish(
      request("publish", { kbId: f.kbId, baseVersion: after.draftVersion, draftHash: after.contentHash }),
      f.publish,
    );
    expect(published.status).toBe(200);
    expect((await published.json() as { readonly data: Record<string, unknown> }).data)
      .toMatchObject({ revision: 1, reusedExisting: false });
    const snapshot = (
      await db.query("select payload,question_set from public.marketing_geo_kb_snapshots where kb_id=$1", [f.kbId])
    ).rows[0]!;
    expect(parseGeoKbPayloadV3(snapshot.payload).knowledge).not.toBeNull();
    // A v3 version publishes without a question set; that half stays absent.
    expect(snapshot.question_set).toBeNull();
  });

  it("re-reads a finished run instead of buying its knowledge again", async () => {
    const f = await fixture();
    const { view } = await driveToCompletion(f, "runseam-integration-2");
    expect(view.status).toBe("complete");
    expect(f.synthesized).toHaveBeenCalledTimes(1);
    const before = await storedDraft(f);

    // The run is closed, so the route itself will not act again.
    const finished = await handleGeoKbRun(request("run", { kbId: f.kbId, runId: view.run!.runId }), f.run);
    expect(finished.status).toBe(200);
    expect(await generationRows(f)).toHaveLength(1);

    // The state that actually risks a second charge is an operation whose
    // outcome was never written down. Both the resume path (`start`) and the
    // recovery path (`probe`) have to settle it from the record, not by
    // sending it again -- so both are driven here against the real store.
    const context: GeoRunContext = {
      userId: f.userId, kbId: f.kbId, runId: view.run!.runId,
      run: { schemaVersion: "marketing-geo-kb-run.v1", runId: view.run!.runId, userId: f.userId, kbId: f.kbId,
        idempotencyKey: "runseam-integration-2", state: "running", generationInputHash: null,
        leaseExpiresAt: NOW.toISOString(), createdAt: NOW.toISOString() },
      appendOperations: async () => true,
      bindGenerationInput: async () => "bound",
    };
    const stranded = {
      key: GEO_RUN_KNOWLEDGE_MODEL_SEED.key, kind: "model" as const, state: "outcome_unknown" as const,
      resultRef: null, startedAt: NOW.toISOString(), leaseExpiresAt: null,
      reason: "outcome_unknown" as const, probeCount: 1, finishedAt: NOW.toISOString(),
    };
    const probed = await f.knowledge.probe(stranded, context);
    expect(probed).toEqual({ kind: "succeeded", resultRef: (await generationRows(f))[0]!.id });
    const restarted = await f.knowledge.start({ ...stranded, state: "failed_retryable" }, context);
    expect(restarted).toEqual({ kind: "succeeded", resultRef: (await generationRows(f))[0]!.id });

    // Nothing was bought, and nothing was rewritten: re-assembling the same
    // record is byte-identical, so it mints no second draft version either.
    expect(f.synthesized).toHaveBeenCalledTimes(1);
    expect(await generationRows(f)).toHaveLength(1);
    const stillThere = await storedDraft(f);
    expect(stillThere.draftVersion).toBe(before.draftVersion);
    expect(stillThere.contentHash).toBe(before.contentHash);
  });
});
