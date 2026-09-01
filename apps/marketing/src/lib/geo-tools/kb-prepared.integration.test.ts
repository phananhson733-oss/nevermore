// @input -- only a named loopback disposable Marketing database and synthetic values
// @output -- durable generation CAS, exact candidate freezing and immutable replay proof
// @pos -- real SQL tests, never a provider or production invocation
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectFreshMarketingSchema, openConcurrentClient } from "../credits/sql-test-harness.ts";
import { completePayloadV2, questionSetV2 } from "./kb-v2.test-fixtures.ts";
import { createGeoPreparedCandidate } from "./kb-prepared-contract.ts";
import { buildGeoSnapshotContextV2 } from "./snapshot-context-v2.ts";
import { geoGenerationInputHash } from "./kb-generation.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { buildGeoSnapshotContext } from "./snapshot-context.ts";
import { inheritedProfileFromCopy } from "./kb-profile-copy-server.ts";
import { buildGeoQuestionSet, geoQuestionSetDigest } from "./kb-questions.ts";
import { createGeoKbGenerationStore } from "./kb-generation-store.ts";
import { createGeoKbPreparedStore, persistGeoSourceReceiptV2, readGeoSourceReceiptV2 } from "./kb-prepared-store.ts";
import { collectGeoQueryEvidenceV2, extractGeoCompetitorSourceV2, finalizeGeoKbSourceReportV2 } from "./kb-sources.ts";
import { selectGeoCompetitorEvidence } from "./kb-competitor-evidence.ts";
import type { GeoCompetitorEvidenceV2 } from "./snapshot-context-v2.ts";
import { createGeoRoleProposal } from "./kb-role-proposal.ts";
import { ROLE_SYNTHESIS_INPUT, ROLE_SYNTHESIS_OUTPUT } from "./kb-synthesis-fixtures.ts";
import { profileCopyReference } from "./kb-profile-copy.ts";

let db: Client;
beforeAll(async () => { db = await connectFreshMarketingSchema(); });
afterAll(async () => { await db?.end(); });
const ATTEMPT = { attemptedCalls: 1, delivery: "response_received", modelRequested: "offline-model", inputTokens: 12, outputTokens: 30, requestCount: 1 };
async function fixture() {
  const userId = randomUUID(), websiteId = randomUUID(), snapshotId = randomUUID();
  const base = completePayloadV2();
  const payload = { ...base, profileCopy: { ...base.profileCopy, websiteId, snapshotId } };
  const result = await db.query("select * from public.marketing_geo_upsert_kb($1,'https://example.com','example.com','example.com')", [userId]);
  const kbId = result.rows[0].kb_id as string;
  await db.query("insert into public.marketing_websites(id,user_id,canonical_site_key,origin,submitted_url,host) values($1,$2,'example.com','https://example.com','https://example.com','example.com')", [websiteId, userId]);
  await db.query("insert into public.marketing_website_profile_snapshots(id,website_id,user_id,revision,schema_version,profile,content_hash,source_draft_version) values($1,$2,$3,1,'marketing-website-profile.v1',$4,$5,1)", [snapshotId, websiteId, userId, payload.profileCopy.profile, payload.profileCopy.profileHash]);
  await db.query("update public.marketing_websites set current_confirmed_snapshot_id=$1 where id=$2", [snapshotId, websiteId]);
  // Direct fixture insert is owner-admin setup, not the application's writer.
  await db.query("insert into public.marketing_geo_kb_drafts(kb_id,user_id,schema_version,draft_version,payload,content_hash) values($1,$2,'marketing-geo-kb.v2',1,$3,$4)", [kbId, userId, payload, geoV2Digest(payload)]);
  const input = { kbId, baseDraftVersion: "1", baseDraftHash: geoV2Digest(payload), profileCopyHash: geoV2Digest(payload.profileCopy) };
  return { userId, kbId, payload, input, websiteId };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function claim(f: Fixture, key = "request_key_1", kind = "questions", input = f.input, client = db) {
  return (await client.query("select * from public.marketing_geo_claim_generation($1,$2,$3,$4,$5,$6)", [f.userId, f.kbId, kind, key, geoGenerationInputHash(kind as "questions", input), input])).rows[0];
}
async function dispatch(f: Fixture, generationId: string, token: string, client = db) {
  return (await client.query("select * from public.marketing_geo_dispatch_generation($1,$2,$3,$4)", [f.userId, f.kbId, generationId, token])).rows[0];
}
async function finish(f: Fixture, generationId: string, token: string, state: string, result: unknown, reason: string | null = null, attempt: unknown = ATTEMPT) {
  return (await db.query("select * from public.marketing_geo_finish_generation($1,$2,$3,$4,$5,$6,$7,$8)", [f.userId, f.kbId, generationId, token, state, result, reason, attempt])).rows[0];
}
function candidate(f: Fixture, candidateId: string, sourceReceiptRefs: readonly { readonly receiptId: string; readonly contentHash: string }[] = [], competitorEvidence: readonly GeoCompetitorEvidenceV2[] = []) {
  const questionSet = questionSetV2();
  const context = buildGeoSnapshotContextV2({ candidateId, kbId: f.kbId, payload: f.payload, questionSet, sourceReceiptRefs, competitorEvidence, evidenceCatalog: [{ id: "manual:r1", kind: "manual", text: "Finance teams struggle with late invoices" }], sourceSummary: { gsc: null, selectedEvidenceCounts: { manual: 1, profile: 0, gsc: 0, crawl: 0 }, availableEvidenceCounts: { manual: 1, profile: 0, gsc: 0, crawl: 0 } } });
  return createGeoPreparedCandidate({ schemaVersion: "marketing-geo-prepared-candidate.v1", candidateId, kbId: f.kbId, baseDraftVersion: f.input.baseDraftVersion, baseDraftHash: f.input.baseDraftHash, profileCopyHash: f.input.profileCopyHash, sourceReceiptRefs, generatorVersion: questionSet.methodVersion, payload: f.payload, questionSet, context });
}
async function freeze(f: Fixture, id: string, hash: string, client = db) { return (await client.query("select * from public.marketing_geo_freeze_prepared_kb($1,$2,$3,$4)", [f.userId, f.kbId, id, hash])).rows[0]; }
const transport = { callRpc: async (name: string, params: Record<string, unknown>) => {
  if (!/^marketing_geo_[a-z_]+$/u.test(name)) throw new Error("Unexpected test RPC");
  const values = Object.values(params);
  const result = await db.query(`select to_jsonb(r) as value from (select * from public.${name}(${values.map((_, i) => `$${i + 1}`).join(",")})) r`, values);
  return { data: result.rows.map(row => row.value), error: null };
} };

describe("durable prepared GEO SQL", () => {
  it.each(["capture", "time", "hash", "foreign_receipt", "missing", "duplicate"])("refuses self-rehashed competitor evidence with forged %s", async kind => {
    const f = await fixture();
    const report = finalizeGeoKbSourceReportV2({ schemaVersion: "marketing-geo-kb-enrichment.v2", receiptId: randomUUID(), kbId: f.kbId, targetHost: "example.com", draftVersion: 1, draftHash: f.input.baseDraftHash, profileReference: profileCopyReference(f.payload.profileCopy), createdAt: "2026-08-31T00:00:00.000Z",
      competitors: [extractGeoCompetitorSourceV2("rival.example", { kind: "ok", url: "https://rival.example/", observedAt: "2026-08-31T00:00:00.000Z", body: '<meta property="og:site_name" content="Observed rival">' }, "C1")], facts: [], gsc: { status: "unavailable", reason: "not_connected", property: null, window: { startDate: "2026-06-01", endDate: "2026-08-29" }, queryCount: null, truncated: null, observedAt: null, queries: [] } });
    expect(await persistGeoSourceReceiptV2({ userId: f.userId, report }, transport)).toEqual({ kind: "ok" });
    const sourceReceiptRefs = [{ receiptId: report.receiptId, contentHash: report.contentHash }];
    const claimedInput = { ...f.input, sourceReceiptRefs };
    const generation = await claim(f, "competitor_capture_1", "questions", claimedInput), id = generation.generation.generationId;
    await dispatch(f, id, generation.claim_token);
    const evidence = selectGeoCompetitorEvidence({ kbId: f.kbId, targetHost: "example.com", competitors: f.payload.competitors, sourceReceiptRefs, receipts: [report] });
    const prepared = candidate(f, id, sourceReceiptRefs, evidence), { contentHash: _contextHash, ...context } = structuredClone(prepared.context);
    if (kind === "capture") context.competitorEvidence[0]!.capture.aliases.push("Fabricated alias");
    if (kind === "time") Object.assign(context.competitorEvidence[0]!, { receiptCreatedAt: "2026-08-31T01:00:00.000Z" });
    if (kind === "hash") Object.assign(context.competitorEvidence[0]!, { contentHash: "b".repeat(64) });
    if (kind === "foreign_receipt") Object.assign(context.competitorEvidence[0]!, { receiptId: randomUUID() });
    if (kind === "missing") context.competitorEvidence = [];
    if (kind === "duplicate") context.competitorEvidence = [...context.competitorEvidence, ...context.competitorEvidence];
    const { candidateHash: _candidateHash, ...body } = prepared;
    const changed = { ...body, context: { ...context, contentHash: geoV2Digest(context) } };
    const forged = { ...changed, candidateHash: geoV2Digest(changed) };
    expect((await finish(f, id, generation.claim_token, "succeeded", forged)).outcome).toBe("invalid_result");
    expect((await db.query("select count(*)::int as n from public.marketing_geo_kb_prepared_candidates where generation_id=$1", [id])).rows[0].n).toBe(0);
    expect((await finish(f, id, generation.claim_token, "succeeded", prepared)).generation.result).toEqual(prepared);
    const frozen = await freeze(f, id, prepared.candidateHash);
    expect((await db.query("select context from public.marketing_geo_snapshot_contexts where snapshot_id=$1", [frozen.snapshot_id])).rows[0].context.competitorEvidence).toEqual(evidence);
  });
  it("freezes the exact latest selected competitor failure, ignoring later unselected captures", async () => {
    const f = await fixture(), [firstId, lastId] = [randomUUID(), randomUUID()].sort(), at = "2026-08-31T00:00:00.000Z";
    const report = (receiptId: string, failed: boolean, createdAt = at) => finalizeGeoKbSourceReportV2({ schemaVersion: "marketing-geo-kb-enrichment.v2", receiptId, kbId: f.kbId, targetHost: "example.com", draftVersion: 1, draftHash: f.input.baseDraftHash, profileReference: profileCopyReference(f.payload.profileCopy), createdAt,
      competitors: [extractGeoCompetitorSourceV2("rival.example", failed ? { kind: "unavailable", url: "https://rival.example/", reason: "fetch_failed" } : { kind: "ok", url: "https://rival.example/", observedAt: at, body: '<meta property="og:site_name" content="Observed rival">' }, "C1")], facts: [], gsc: { status: "unavailable", reason: "not_connected", property: null, window: { startDate: "2026-06-01", endDate: "2026-08-29" }, queryCount: null, truncated: null, observedAt: null, queries: [] } });
    const receipts = [report(firstId!, false), report(lastId!, true)];
    for (const receipt of receipts) expect(await persistGeoSourceReceiptV2({ userId: f.userId, report: receipt }, transport)).toEqual({ kind: "ok" });
    const sourceReceiptRefs = receipts.map(({ receiptId, contentHash }) => ({ receiptId, contentHash })), claimedInput = { ...f.input, sourceReceiptRefs };
    const generation = await claim(f, "competitor_latest_1", "questions", claimedInput), id = generation.generation.generationId;
    await dispatch(f, id, generation.claim_token);
    const evidence = selectGeoCompetitorEvidence({ kbId: f.kbId, targetHost: "example.com", competitors: f.payload.competitors, sourceReceiptRefs, receipts });
    expect(evidence[0]).toMatchObject({ receiptId: lastId, capture: { status: "unavailable", reason: "fetch_failed", observedAt: null, source: null } });
    const prepared = candidate(f, id, sourceReceiptRefs, evidence);
    expect((await finish(f, id, generation.claim_token, "succeeded", prepared)).generation.result).toEqual(prepared);
    expect(await persistGeoSourceReceiptV2({ userId: f.userId, report: report(randomUUID(), false, "2026-08-31T01:00:00.000Z") }, transport)).toEqual({ kind: "ok" });
    const frozen = await freeze(f, id, prepared.candidateHash);
    expect(frozen.outcome).toBe("frozen");
    expect((await db.query("select context from public.marketing_geo_snapshot_contexts where snapshot_id=$1", [frozen.snapshot_id])).rows[0].context.competitorEvidence).toEqual(evidence);
  });
  it.each(["roles", "questions"] as const)("refuses %s output that drops the exact source set claimed before dispatch", async kind => {
    const f = await fixture();
    const report = finalizeGeoKbSourceReportV2({ schemaVersion: "marketing-geo-kb-enrichment.v2", receiptId: randomUUID(), kbId: f.kbId, targetHost: "example.com", draftVersion: 1, draftHash: f.input.baseDraftHash, profileReference: profileCopyReference(f.payload.profileCopy), createdAt: "2026-08-31T00:00:00.000Z", competitors: [], facts: [], gsc: { status: "unavailable", reason: "not_connected", property: null, window: { startDate: "2026-06-01", endDate: "2026-08-29" }, queryCount: null, truncated: null, observedAt: null, queries: [] } });
    expect(await persistGeoSourceReceiptV2({ userId: f.userId, report }, transport)).toEqual({ kind: "ok" });
    const claimedInput = { ...f.input, sourceReceiptRefs: [{ receiptId: report.receiptId, contentHash: report.contentHash }] };
    const generation = await claim(f, "source_binding_1", kind, claimedInput), id = generation.generation.generationId;
    await dispatch(f, id, generation.claim_token);
    const roleInput = { generationId: id, kbId: f.kbId, baseDraftVersion: "1", baseDraftHash: f.input.baseDraftHash, profileCopyHash: f.input.profileCopyHash, input: ROLE_SYNTHESIS_INPUT, output: ROLE_SYNTHESIS_OUTPUT, sourceReceiptRefs: [], selectedEvidenceCounts: { profile: 1, gsc: 1, crawl: 0, manual: 0 }, availableEvidenceCounts: { profile: 1, gsc: 1, crawl: 0, manual: 0 } };
    const output = kind === "questions" ? candidate(f, id) : createGeoRoleProposal(roleInput);
    expect((await finish(f, id, generation.claim_token, "succeeded", output)).outcome).toBe("invalid_result");
    expect((await db.query("select state,result from public.marketing_geo_kb_generations where id=$1", [id])).rows[0]).toEqual({ state: "dispatched", result: null });
    expect((await db.query("select count(*)::int as n from public.marketing_geo_kb_prepared_candidates where generation_id=$1", [id])).rows[0].n).toBe(0);
    const corrected = kind === "questions" ? candidate(f, id, claimedInput.sourceReceiptRefs) : createGeoRoleProposal({ ...roleInput, sourceReceiptRefs: claimedInput.sourceReceiptRefs });
    expect((await finish(f, id, generation.claim_token, "succeeded", corrected)).generation).toMatchObject({ state: "succeeded", result: corrected });
  });
  it("recovers a lost response by its exact idempotency alias without a new claim", async () => {
    const f = await fixture(), original = await claim(f);
    await claim(f, "second_alias_key");
    const before = (await db.query("select count(*)::int as n from public.marketing_geo_kb_generations where kb_id=$1", [f.kbId])).rows[0].n;
    const result = (await db.query("select * from public.marketing_geo_read_generation_by_key($1,$2,'questions','second_alias_key')", [f.userId, f.kbId])).rows[0];
    expect(result).toMatchObject({ outcome: "found", generation: { generationId: original.generation.generationId, state: "claimed" } });
    expect((await db.query("select * from public.marketing_geo_read_generation_by_key($1,$2,'roles','second_alias_key')", [f.userId, f.kbId])).rows[0].outcome).toBe("not_found");
    expect((await db.query("select count(*)::int as n from public.marketing_geo_kb_generations where kb_id=$1", [f.kbId])).rows[0].n).toBe(before);
    expect(result.generation).not.toHaveProperty("claimToken");
  });
  it("passes the real SQL round trip through the production generation/prepared adapters", async () => {
    const f = await fixture();
    const generationStore = createGeoKbGenerationStore(transport);
    const preparedStore = createGeoKbPreparedStore({ ...transport, readCandidate: async scope => ({ data: (await db.query("select id,user_id,kb_id,candidate_hash,candidate from public.marketing_geo_kb_prepared_candidates where user_id=$1 and kb_id=$2 and id=$3", [scope.userId, scope.kbId, scope.candidateId])).rows[0] ?? null, error: null }) });
    const claimed = await generationStore.claim({ userId: f.userId, kbId: f.kbId, kind: "questions", input: f.input, inputHash: geoGenerationInputHash("questions", f.input), idempotencyKey: "adapter_roundtrip_1" });
    expect(claimed.kind).toBe("claimed");
    if (claimed.kind !== "claimed") throw new Error("Missing generation claim");
    const scope = { userId: f.userId, kbId: f.kbId, generationId: claimed.generation.generationId, claimToken: claimed.claimToken };
    expect((await generationStore.markDispatched(scope)).kind).toBe("dispatched");
    const prepared = candidate(f, scope.generationId);
    const finished = await generationStore.finish(scope, { state: "succeeded", result: prepared as never, errorReason: null, attempt: { ...ATTEMPT, attemptedCalls: 1, delivery: "response_received" } });
    expect(finished).toMatchObject({ kind: "ok", generation: { state: "succeeded", result: prepared } });
    expect(await generationStore.read({ userId: f.userId, kbId: f.kbId, generationId: scope.generationId })).toMatchObject({ kind: "ok", generation: { generationId: scope.generationId, state: "succeeded" } });
    expect(await preparedStore.freeze({ userId: f.userId, kbId: f.kbId, candidateId: prepared.candidateId, candidateHash: prepared.candidateHash })).toMatchObject({ kind: "ok", value: { contentHash: prepared.baseDraftHash, questionSetHash: prepared.context.questionSetHash, reusedExisting: false } });
  });
  it("persists real typed role proposals with their generation input identity", async () => {
    const f = await fixture(), generation = await claim(f, "role_proposal_1", "roles"), id = generation.generation.generationId;
    await dispatch(f, id, generation.claim_token);
    const proposal = createGeoRoleProposal({ generationId: id, kbId: f.kbId, baseDraftVersion: "1", baseDraftHash: f.input.baseDraftHash, profileCopyHash: f.input.profileCopyHash, input: ROLE_SYNTHESIS_INPUT, output: ROLE_SYNTHESIS_OUTPUT, sourceReceiptRefs: [], selectedEvidenceCounts: { profile: 1, gsc: 1, crawl: 0, manual: 0 }, availableEvidenceCounts: { profile: 1, gsc: 1, crawl: 0, manual: 0 } });
    expect((await finish(f, id, generation.claim_token, "succeeded", proposal)).generation.result).toEqual(proposal);
    const store = createGeoKbGenerationStore(transport);
    expect(await store.readLatest({ userId: f.userId, kbId: f.kbId, kind: "roles" })).toMatchObject({ kind: "ok", generation: { result: proposal } });
  });
  it("persists source V2 above the old cap and reads its exact full query catalog", async () => {
    const f = await fixture(), receiptId = randomUUID();
    const report = finalizeGeoKbSourceReportV2({ schemaVersion: "marketing-geo-kb-enrichment.v2", receiptId, kbId: f.kbId, targetHost: "example.com", draftVersion: 1, draftHash: f.input.baseDraftHash, profileReference: null, createdAt: "2026-08-31T00:00:00.000Z", competitors: [], facts: [], gsc: { status: "available", reason: null, property: "sc-domain:example.com", window: { startDate: "2026-06-01", endDate: "2026-08-29" }, queryCount: 1000, truncated: true, observedAt: "2026-08-31T00:00:00.000Z", queries: [...collectGeoQueryEvidenceV2(Array.from({ length: 1000 }, (_, i) => `${String(i).padStart(4, "0")}${"界".repeat(508)}`))] } });
    expect(Buffer.byteLength(JSON.stringify(report))).toBeGreaterThan(524288);
    expect(await transport.callRpc("marketing_geo_record_enrichment", { p_user_id: f.userId, p_kb_id: f.kbId, p_receipt_id: receiptId, p_report: report })).toMatchObject({ data: [{ outcome: "recorded" }] });
    expect(await persistGeoSourceReceiptV2({ userId: f.userId, report }, transport)).toEqual({ kind: "ok" });
    const stored = await readGeoSourceReceiptV2({ userId: f.userId, kbId: f.kbId, receiptId }, async () => ({ data: (await db.query("select id,user_id,kb_id,content_hash,report from public.marketing_geo_enrichment_receipts where id=$1", [receiptId])).rows[0], error: null }));
    expect(stored).toEqual({ kind: "ok", value: report });
  });
  it("claims one provider capability for duplicate requests and pins every idempotency alias", async () => {
    const f = await fixture(), peer = await openConcurrentClient();
    try {
      const results = await Promise.all([claim(f), claim(f, "request_key_1", "questions", f.input, peer)]);
      expect(results.map(row => row.outcome).sort()).toEqual(["claimed", "existing"]);
      expect(new Set(results.map(row => row.generation.generationId)).size).toBe(1);
      expect((await claim(f, "another_key_2")).outcome).toBe("existing");
      expect((await claim(f, "another_key_2", "roles")).outcome).toBe("conflict");
    } finally { await peer.end(); }
  });
  it("only dispatches the live lease once and never retries an ambiguous dispatched attempt", async () => {
    const f = await fixture(), first = await claim(f), id = first.generation.generationId;
    expect((await dispatch(f, id, randomUUID())).outcome).toBe("existing");
    expect((await dispatch(f, id, first.claim_token)).outcome).toBe("dispatched");
    expect((await dispatch(f, id, first.claim_token)).outcome).toBe("existing");
    await db.query("update public.marketing_geo_kb_generations set lease_expires_at=now()-interval '1 second' where id=$1", [id]);
    const retry = await claim(f);
    expect(retry).toMatchObject({ outcome: "existing", generation: { state: "uncertain", errorReason: "outcome_unknown", attempt: { attemptedCalls: 1, delivery: "outcome_unknown", inputTokens: null } } });
  });
  it("reclaims only expired pre-dispatch leases and fences the previous winner", async () => {
    const f = await fixture(), old = await claim(f), id = old.generation.generationId;
    await db.query("update public.marketing_geo_kb_generations set lease_expires_at=now()-interval '1 second' where id=$1", [id]);
    const fresh = await claim(f);
    expect(fresh.outcome).toBe("claimed");
    expect(fresh.claim_token).not.toBe(old.claim_token);
    expect((await dispatch(f, id, old.claim_token)).outcome).toBe("existing");
    expect((await dispatch(f, id, fresh.claim_token)).outcome).toBe("dispatched");
  });
  it("persists the complete successful candidate atomically then freezes its exact bytes", async () => {
    const f = await fixture(), generation = await claim(f), id = generation.generation.generationId;
    await dispatch(f, id, generation.claim_token);
    const prepared = candidate(f, id);
    expect((await finish(f, id, generation.claim_token, "succeeded", prepared)).generation).toMatchObject({ state: "succeeded", result: prepared, attempt: ATTEMPT });
    expect((await db.query("select candidate from public.marketing_geo_kb_prepared_candidates where id=$1", [id])).rows[0].candidate).toEqual(prepared);
    const frozen = await freeze(f, id, prepared.candidateHash);
    expect(frozen.outcome).toBe("frozen");
    const stored = (await db.query("select payload,question_set,context_hash,prepared_id from public.marketing_geo_kb_snapshots where id=$1", [frozen.snapshot_id])).rows[0];
    expect(stored).toEqual({ payload: prepared.payload, question_set: prepared.questionSet, context_hash: prepared.context.contentHash, prepared_id: id });
  });
  it("records input_stale and preserves paid attempt metadata if the draft changed in flight", async () => {
    const f = await fixture(), generation = await claim(f), id = generation.generation.generationId;
    await dispatch(f, id, generation.claim_token);
    const prepared = candidate(f, id);
    await db.query("update public.marketing_geo_kb_drafts set draft_version=2 where kb_id=$1", [f.kbId]);
    const finished = await finish(f, id, generation.claim_token, "succeeded", prepared);
    expect(finished.generation).toMatchObject({ state: "failed", errorReason: "input_stale", result: null, attempt: ATTEMPT });
    expect((await db.query("select count(*)::int as n from public.marketing_geo_kb_prepared_candidates where id=$1", [id])).rows[0].n).toBe(0);
  });
  it("rechecks the current Profile before dispatch and after the model returns", async () => {
    for (const phase of ["dispatch", "finish"] as const) {
      const f = await fixture(), generation = await claim(f), id = generation.generation.generationId;
      if (phase === "finish") await dispatch(f, id, generation.claim_token);
      const prepared = candidate(f, id);
      await db.query("update public.marketing_websites set current_confirmed_snapshot_id=null where id=$1", [f.websiteId]);
      const result = phase === "dispatch" ? await dispatch(f, id, generation.claim_token) : await finish(f, id, generation.claim_token, "succeeded", prepared);
      expect(result.generation).toMatchObject({ state: "failed", errorReason: "input_stale", result: null, attempt: phase === "dispatch" ? null : ATTEMPT });
    }
  });
  it("reclaims expired quota-only failures but never terminal provider attempts", async () => {
    for (const mayRetry of [true, false]) {
      const f = await fixture(), id = randomUUID(), oldToken = randomUUID();
      // Seed the exact persisted state after time has passed, without sleeps
      // or disabling the transition guard being tested.
      await db.query("insert into public.marketing_geo_kb_generations(id,user_id,kb_id,kind,input_hash,input,state,claim_token,lease_expires_at,error_reason,attempt) values($1,$2,$3,'questions',$4,$5,'failed',$6,now()-interval '1 second',$7,$8)", [id, f.userId, f.kbId, geoGenerationInputHash("questions", f.input), f.input, oldToken, mayRetry ? "quota_unavailable" : "provider_rejected", mayRetry ? null : ATTEMPT]);
      const retried = await claim(f);
      expect(retried.outcome).toBe(mayRetry ? "claimed" : "existing");
      expect(retried.generation.generationId).toBe(id);
      if (mayRetry) expect(retried.claim_token).not.toBe(oldToken);
      else expect(retried.generation).toMatchObject({ state: "failed", errorReason: "provider_rejected", attempt: ATTEMPT });
    }
  });
  it("uses the Website row lock to reject concurrent Profile pointer changes during freeze", async () => {
    const f = await fixture(), generation = await claim(f), id = generation.generation.generationId;
    await dispatch(f, id, generation.claim_token);
    const prepared = candidate(f, id);
    await finish(f, id, generation.claim_token, "succeeded", prepared);
    const peer = await openConcurrentClient();
    await db.query("begin");
    try {
      await db.query("select id from public.marketing_websites where id=$1 for update", [f.websiteId]);
      const pending = freeze(f, id, prepared.candidateHash, peer);
      expect(await Promise.race([pending.then(() => "finished"), new Promise(resolve => setTimeout(() => resolve("waiting"), 50))])).toBe("waiting");
      await db.query("update public.marketing_websites set current_confirmed_snapshot_id=null where id=$1", [f.websiteId]);
      await db.query("commit");
      expect((await pending).outcome).toBe("input_stale");
    } finally { await db.query("rollback"); await peer.end(); }
  });
  it("never lets an old freeze RPC bypass prepared V2 snapshot identity", async () => {
    const f = await fixture();
    const legacy = { ...f.payload, schemaVersion: "marketing-geo-kb.v1" as const };
    const questionSet = buildGeoQuestionSet(legacy);
    expect((await db.query("select * from public.marketing_geo_freeze_kb($1,$2,'marketing-geo-kb.v2',1,$3,$4)", [f.userId, f.kbId, questionSet, geoQuestionSetDigest(questionSet)])).rows[0].outcome).not.toBe("frozen");
    const prepared = buildGeoSnapshotContext({ kbId: f.kbId, targetHost: "example.com", payload: legacy, profile: inheritedProfileFromCopy(f.payload.profileCopy), receipt: null });
    // Hash it over the V2 draft to exercise the otherwise valid old context RPC.
    const { contentHash: _hash, ...contextBody } = prepared.context;
    const body = { ...contextBody, payloadHash: geoV2Digest(f.payload) };
    const context = { ...body, contentHash: geoV2Digest(body) };
    await expect(db.query("select * from public.marketing_geo_freeze_kb_with_context($1,$2,'marketing-geo-kb.v2',1,$3,$4,$5)", [f.userId, f.kbId, prepared.questionSet, context.questionSetHash, context])).rejects.toThrow(/prepared/u);
    expect((await db.query("select count(*)::int as n from public.marketing_geo_kb_snapshots where kb_id=$1", [f.kbId])).rows[0].n).toBe(0);
  });
  it("rejects stale/foreign/hash-forged freeze and leaves no snapshot", async () => {
    const f = await fixture(), generation = await claim(f), id = generation.generation.generationId;
    await dispatch(f, id, generation.claim_token);
    const prepared = candidate(f, id);
    await finish(f, id, generation.claim_token, "succeeded", prepared);
    expect((await freeze(f, id, "a".repeat(64))).outcome).toBe("candidate_mismatch");
    expect((await freeze({ ...f, userId: randomUUID() }, id, prepared.candidateHash)).outcome).toBe("not_found");
    await db.query("update public.marketing_geo_kb_drafts set draft_version=2 where kb_id=$1", [f.kbId]);
    expect((await freeze(f, id, prepared.candidateHash)).outcome).toBe("input_stale");
    expect((await db.query("select count(*)::int as n from public.marketing_geo_kb_snapshots where kb_id=$1", [f.kbId])).rows[0].n).toBe(0);
  });
  it("replays a previous freeze without rolling back a newer current pointer", async () => {
    const f = await fixture(), generation = await claim(f), id = generation.generation.generationId;
    await dispatch(f, id, generation.claim_token);
    const prepared = candidate(f, id);
    await finish(f, id, generation.claim_token, "succeeded", prepared);
    const first = await freeze(f, id, prepared.candidateHash);
    await db.query("update public.marketing_geo_kb_drafts set draft_version=2 where kb_id=$1", [f.kbId]);
    const next = { ...f, input: { ...f.input, baseDraftVersion: "2" } };
    const nextGeneration = await claim(next, "next_candidate_2"), nextId = nextGeneration.generation.generationId;
    await dispatch(next, nextId, nextGeneration.claim_token);
    const nextCandidate = candidate(next, nextId);
    await finish(next, nextId, nextGeneration.claim_token, "succeeded", nextCandidate);
    const latest = await freeze(next, nextId, nextCandidate.candidateHash);
    expect(latest.revision).toBe(2);
    const replay = await freeze(f, id, prepared.candidateHash);
    expect(replay.snapshot_id).toBe(first.snapshot_id);
    expect(replay.reused_existing).toBe(true);
    expect((await db.query("select current_frozen_snapshot_id from public.marketing_geo_knowledge_bases where id=$1", [f.kbId])).rows[0].current_frozen_snapshot_id).toBe(latest.snapshot_id);
  });
  it("denies browser RPC/direct table writes and keeps candidates/terminal generations immutable", async () => {
    const f = await fixture(), generation = await claim(f), id = generation.generation.generationId;
    await dispatch(f, id, generation.claim_token);
    await finish(f, id, generation.claim_token, "succeeded", candidate(f, id));
    await expect(db.query("update public.marketing_geo_kb_prepared_candidates set candidate=candidate where id=$1", [id])).rejects.toThrow();
    await expect(db.query("update public.marketing_geo_kb_generations set result='{}'::jsonb where id=$1", [id])).rejects.toThrow();
    for (const table of ["marketing_geo_kb_generations", "marketing_geo_kb_generation_keys", "marketing_geo_kb_prepared_candidates"]) {
      expect((await db.query("select has_table_privilege('service_role',$1,'insert,update,delete,truncate') as writes,has_table_privilege('anon',$1,'select') as browser", [`public.${table}`])).rows[0]).toEqual({ writes: false, browser: false });
    }
    for (const signature of ["marketing_geo_claim_generation(uuid,uuid,text,text,text,jsonb)", "marketing_geo_dispatch_generation(uuid,uuid,uuid,uuid)", "marketing_geo_finish_generation(uuid,uuid,uuid,uuid,text,jsonb,text,jsonb)", "marketing_geo_freeze_prepared_kb(uuid,uuid,uuid,text)", "marketing_geo_read_generation(uuid,uuid,uuid,text)", "marketing_geo_read_generation_by_key(uuid,uuid,text,text)"]) {
      expect((await db.query("select has_function_privilege('anon',$1,'execute') as anon,has_function_privilege('authenticated',$1,'execute') as browser,has_function_privilege('service_role',$1,'execute') as service", [`public.${signature}`])).rows[0]).toEqual({ anon: false, browser: false, service: true });
      const config = (await db.query("select prosecdef,proconfig from pg_proc where oid=$1::regprocedure", [`public.${signature}`])).rows[0];
      expect(config.prosecdef).toBe(true);
      expect(config.proconfig).toEqual(expect.arrayContaining(['search_path=""', 'TimeZone=UTC']));
    }
  });
  it("replays the forward migration without changing terminal records/candidates or legacy functions", async () => {
    const before = (await db.query("select to_jsonb(g) as row from public.marketing_geo_kb_generations g order by id")).rows;
    const migration = readFileSync(new URL("../../../supabase/migrations/20260831122810_geo_kb_prepared_generations.sql", import.meta.url), "utf8");
    await db.query("create schema if not exists app; create table if not exists app.geo_prepared_schema_sentinel(value text primary key); insert into app.geo_prepared_schema_sentinel values('untouched') on conflict do nothing");
    await db.query("begin"); await db.query(migration); await db.query("rollback");
    await db.query(migration); await db.query(migration);
    expect((await db.query("select to_jsonb(g) as row from public.marketing_geo_kb_generations g order by id")).rows).toEqual(before);
    expect((await db.query("select value from app.geo_prepared_schema_sentinel")).rows).toEqual([{ value: "untouched" }]);
  });
});
