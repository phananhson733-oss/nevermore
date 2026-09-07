// @input -- only a named loopback disposable Marketing database and synthetic values
// @output -- durable generation CAS, exact candidate freezing and immutable replay proof
// @pos -- real SQL tests, never a provider or production invocation
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectFreshMarketingSchema, openConcurrentClient } from "../credits/sql-test-harness.ts";
import { completePayloadV2, questionSetV2 } from "./kb-v2.test-fixtures.ts";
import { createGeoPreparedCandidate, createGeoPreparedCandidateV2, geoKnowledgeGenerationInputHash, GEO_PREPARED_CANDIDATE_V2_MAX_BYTES } from "./kb-prepared-contract.ts";
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
import { buildGeoKnowledgeEvidenceV1 } from "./kb-knowledge-evidence.ts";
import { buildGeoKnowledgeSynthesisInputV1 } from "./kb-knowledge-synthesis-contract.ts";
import { buildGeoKnowledgeGenerationInputManifest } from "./kb-prepared-contract.ts";
import { buildGeoKnowledgeGenerationResultV1, geoKnowledgeGenerationResultHash } from "./kb-knowledge-generation-contract.ts";
import { buildGeoKnowledgePack } from "./kb-knowledge-pack.ts";

let db: Client;
beforeAll(async () => { db = await connectFreshMarketingSchema(); });
afterAll(async () => { await db?.end(); });
const ATTEMPT = { attemptedCalls: 1, delivery: "response_received", modelRequested: "offline-model", inputTokens: 12, outputTokens: 30, requestCount: 1 };
async function fixture(targetUrl?: string) {
  const userId = randomUUID(), websiteId = randomUUID(), snapshotId = randomUUID();
  const base = completePayloadV2();
  const payload = { ...base, targetUrl: targetUrl ?? base.targetUrl, profileCopy: { ...base.profileCopy, websiteId, snapshotId } };
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
async function claim(f: Fixture, key = "request_key_1", kind: "roles" | "questions" | "knowledge_pack" = "questions", input = f.input, client = db) {
  return (await client.query("select * from public.marketing_geo_claim_generation($1,$2,$3,$4,$5,$6)", [f.userId, f.kbId, kind, key, geoGenerationInputHash(kind, input), input])).rows[0];
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
function knowledgeFixture(f: Fixture, generationId: string, sourceReceiptRefs: readonly { readonly receiptId: string; readonly contentHash: string }[] = []) {
  const at = "2026-08-31T00:00:00.000Z", targetUrl = new URL(f.payload.targetUrl).toString();
  const confirmedCompetitors = f.payload.competitors.filter(competitor => competitor.confirmed).map(competitor => ({ key: competitor.domain, name: competitor.brandName, confirmed: true as const }));
  const evidence = buildGeoKnowledgeEvidenceV1({ schemaVersion: "marketing-geo-knowledge-evidence.v1", collectedAt: at, targetUrl, confirmedCompetitors,
    availability: "available", limitation: null, pages: [], machine: {
      jsonLd: { status: "absent", types: [], sourceRefs: ["source:home"] }, hreflang: { status: "absent", locales: [], sourceRefs: ["source:home"] },
      robots: { status: "present", sourceRefs: ["source:robots"] }, llms: { status: "present", sourceRefs: ["source:llms"] },
      sitemap: { status: "present", sourceRefs: ["source:sitemap"], urlCount: 0, knowledgePagesListed: false, locations: [], truncated: false },
    }, sourceCatalogue: [
      { id: "source:accepted-seats", kind: "accepted_fact", label: "Seats", url: null, competitor: null, availability: "available", reason: null, observedAt: null, bodyHash: null, excerpts: ["3"] },
      { id: "source:home", kind: "own_page", label: "Home", url: targetUrl, competitor: null, availability: "available", reason: null, observedAt: at, bodyHash: "a".repeat(64), excerpts: ["Acme is analytics software for finance teams."] },
      { id: "source:robots", kind: "robots", label: "robots", url: new URL("/robots.txt", targetUrl).toString(), competitor: null, availability: "available", reason: null, observedAt: at, bodyHash: "b".repeat(64), excerpts: ["User-agent: *"] },
      { id: "source:sitemap", kind: "sitemap", label: "sitemap", url: new URL("/sitemap.xml", targetUrl).toString(), competitor: null, availability: "available", reason: null, observedAt: at, bodyHash: "c".repeat(64), excerpts: [targetUrl] },
      { id: "source:llms", kind: "llms", label: "llms", url: new URL("/llms.txt", targetUrl).toString(), competitor: null, availability: "available", reason: null, observedAt: at, bodyHash: "d".repeat(64), excerpts: ["Acme analytics software"] },
    ] });
  const synthesisInput = buildGeoKnowledgeSynthesisInputV1({ officialName: f.payload.officialName, aliases: f.payload.aliases, categoryTerms: f.payload.categoryTerms,
    market: f.payload.market.country, language: f.payload.market.language }, evidence);
  const narrative = { schemaVersion: "marketing-geo-knowledge-narrative.v1" as const,
    entity: { definitions: { w25: "Acme is analytics software.", w55: "Acme is analytics software for finance teams.", w120: "Acme is analytics software that helps finance teams research reporting workflows." },
      audience: { who: "Finance teams researching analytics", notFor: null }, founded: { year: null, team: null, location: null }, disambiguation: null, sourceRefs: ["source:home"] },
    facts: [], qa: [], comparisons: [], scope: { does: [{ id: "scope:analytics", text: "Supports analytics research workflows.", sourceRefs: ["source:home"] }], doesNot: [], needsHuman: [], misconceptions: [] } };
  const manifest = buildGeoKnowledgeGenerationInputManifest({ kbId: f.kbId, baseDraftVersion: f.input.baseDraftVersion, baseDraftHash: f.input.baseDraftHash,
    profileCopyHash: f.input.profileCopyHash, sourceReceiptRefs, knowledgeSynthesisInput: synthesisInput });
  const result = buildGeoKnowledgeGenerationResultV1({ schemaVersion: "marketing-geo-knowledge-generation-result.v1", generationId, kbId: f.kbId,
    manifest, evidence, synthesisInput, narrative, generatedAt: "2026-08-31T01:00:00.000Z" });
  return { evidence, synthesisInput, narrative, manifest, result };
}
function candidateV2(f: Fixture, candidateId: string, knowledge: ReturnType<typeof knowledgeFixture>, knowledgeInputHash: string) {
  const v1 = candidate(f, candidateId, knowledge.result.manifest.sourceReceiptRefs);
  const knowledgePack = buildGeoKnowledgePack({ generatedAt: knowledge.result.generatedAt, payload: v1.payload, context: v1.context, questionSet: v1.questionSet,
    evidence: knowledge.evidence, synthesisInput: knowledge.synthesisInput, narrative: knowledge.narrative, narrativeFailureReason: null });
  const { candidateHash: _candidateHash, schemaVersion: _schemaVersion, ...base } = v1;
  const prepared = { ...base, schemaVersion: "marketing-geo-prepared-candidate.v2" as const, knowledgePack, knowledgeSynthesisInput: knowledge.synthesisInput };
  return createGeoPreparedCandidateV2({ ...prepared, knowledgeGeneration: { generationId: knowledge.result.generationId,
    inputHash: knowledgeInputHash, synthesisInputHash: knowledge.synthesisInput.contentHash, evidenceContentHash: knowledge.synthesisInput.evidenceContentHash,
    payloadHash: v1.baseDraftHash, questionSetHash: v1.context.questionSetHash, packHash: knowledgePack.contentHash,
    sourceCatalogueHash: geoV2Digest(knowledgePack.sourceCatalogue), promptVersion: "geo-kb-knowledge-pack.v1" } });
}
async function freeze(f: Fixture, id: string, hash: string, client = db) { return (await client.query("select * from public.marketing_geo_freeze_prepared_kb($1,$2,$3,$4)", [f.userId, f.kbId, id, hash])).rows[0]; }
const transport = { callRpc: async (name: string, params: Record<string, unknown>) => {
  if (!/^marketing_geo_[a-z_]+$/u.test(name)) throw new Error("Unexpected test RPC");
  const values = Object.values(params);
  const result = await db.query(`select to_jsonb(r) as value from (select * from public.${name}(${values.map((_, i) => `$${i + 1}`).join(",")})) r`, values);
  return { data: result.rows.map(row => row.value), error: null };
} };
async function persistedKnowledge(f: Fixture, key: string, sourceReceiptRefs: readonly { readonly receiptId: string; readonly contentHash: string }[] = []) {
  const generationStore = createGeoKbGenerationStore(transport);
  const seed = knowledgeFixture(f, randomUUID(), sourceReceiptRefs);
  expect(geoGenerationInputHash("knowledge_pack", seed.manifest as never)).toBe(geoKnowledgeGenerationInputHash(seed.manifest));
  const claimed = await generationStore.claim({ userId: f.userId, kbId: f.kbId, kind: "knowledge_pack", idempotencyKey: key,
    input: seed.manifest as never, inputHash: geoGenerationInputHash("knowledge_pack", seed.manifest as never) });
  expect(claimed.kind).toBe("claimed");
  if (claimed.kind !== "claimed") throw new Error("Missing knowledge generation claim");
  const scope = { userId: f.userId, kbId: f.kbId, generationId: claimed.generation.generationId, claimToken: claimed.claimToken };
  expect((await generationStore.markDispatched(scope)).kind).toBe("dispatched");
  const knowledge = knowledgeFixture(f, scope.generationId, sourceReceiptRefs);
  const finished = await generationStore.finish(scope, { state: "succeeded", result: knowledge.result as never, errorReason: null,
    attempt: { ...ATTEMPT, attemptedCalls: 1, delivery: "response_received" } });
  expect(finished).toMatchObject({ kind: "ok", generation: { kind: "knowledge_pack", state: "succeeded", result: knowledge.result } });
  return { generationStore, scope, knowledge, inputHash: claimed.generation.inputHash };
}

describe("durable prepared GEO SQL", () => {
  it("claims, dispatches, finishes and reads one strict knowledge-pack result without creating a candidate", async () => {
    const f = await fixture(), run = await persistedKnowledge(f, "knowledge_sql_1");
    expect(await run.generationStore.read({ userId: f.userId, kbId: f.kbId, generationId: run.scope.generationId })).toMatchObject({
      kind: "ok", generation: { kind: "knowledge_pack", inputHash: run.inputHash, state: "succeeded", result: run.knowledge.result },
    });
    expect(await run.generationStore.readByKey({ userId: f.userId, kbId: f.kbId, kind: "knowledge_pack", idempotencyKey: "knowledge_sql_1" })).toMatchObject({
      kind: "ok", generation: { generationId: run.scope.generationId, state: "succeeded" },
    });
    expect((await db.query("select count(*)::int as n from public.marketing_geo_kb_prepared_candidates where generation_id=$1", [run.scope.generationId])).rows[0].n).toBe(0);
  });

  it.each(["schema", "synthesis_hash", "extra", "missing_receipts", "receipt_type", "duplicate_receipts", "unsorted_receipts"] as const)("rejects malformed knowledge manifest %s at claim without durable rows", async issue => {
    const f = await fixture(), seed = knowledgeFixture(f, randomUUID());
    const input: any = structuredClone(seed.manifest);
    if (issue === "schema") input.schemaVersion = "wrong";
    if (issue === "synthesis_hash") input.knowledgeSynthesisInput.contentHash = "f".repeat(64);
    if (issue === "extra") input.debug = true;
    if (issue === "missing_receipts") delete input.sourceReceiptRefs;
    if (issue === "receipt_type") input.sourceReceiptRefs = {};
    if (issue === "duplicate_receipts") input.sourceReceiptRefs = [
      { receiptId: "33333333-3333-4333-8333-333333333333", contentHash: "a".repeat(64) },
      { receiptId: "33333333-3333-4333-8333-333333333333", contentHash: "a".repeat(64) },
    ];
    if (issue === "unsorted_receipts") input.sourceReceiptRefs = [
      { receiptId: "44444444-4444-4444-8444-444444444444", contentHash: "b".repeat(64) },
      { receiptId: "33333333-3333-4333-8333-333333333333", contentHash: "a".repeat(64) },
    ];
    const before = (await db.query("select count(*)::int as generations from public.marketing_geo_kb_generations where kb_id=$1", [f.kbId])).rows[0].generations;
    expect((await claim(f, `invalid_manifest_${issue}`, "knowledge_pack", input)).outcome).toBe("conflict");
    expect((await db.query("select count(*)::int as generations from public.marketing_geo_kb_generations where kb_id=$1", [f.kbId])).rows[0].generations).toBe(before);
    expect((await db.query("select count(*)::int as keys from public.marketing_geo_kb_generation_keys where kb_id=$1 and idempotency_key=$2", [f.kbId, `invalid_manifest_${issue}`])).rows[0].keys).toBe(0);
  });

  it.each(["schema", "hash", "manifest", "foreign"] as const)("rejects a knowledge result with wrong %s and leaves the dispatch open", async issue => {
    const f = await fixture(), seed = knowledgeFixture(f, randomUUID());
    const generation = await claim(f, `bad_knowledge_${issue}`, "knowledge_pack", seed.manifest), id = generation.generation.generationId;
    expect(generation.outcome).toBe("claimed"); await dispatch(f, id, generation.claim_token);
    const valid = knowledgeFixture(f, id).result;
    let result: any = valid;
    if (issue === "schema") { const { contentHash: _hash, ...body } = valid; result = { ...body, schemaVersion: "wrong", contentHash: geoKnowledgeGenerationResultHash({ ...body, schemaVersion: "wrong" }) }; }
    if (issue === "hash") result = { ...valid, contentHash: "f".repeat(64) };
    if (issue === "manifest") { const { contentHash: _hash, ...body } = valid; result = buildGeoKnowledgeGenerationResultV1({ ...body, manifest: { ...body.manifest, profileCopyHash: "e".repeat(64) } }); }
    if (issue === "foreign") { const foreignKb = randomUUID(), { contentHash: _hash, ...body } = valid; result = buildGeoKnowledgeGenerationResultV1({ ...body, kbId: foreignKb, manifest: { ...body.manifest, kbId: foreignKb } }); }
    expect((await finish(f, id, generation.claim_token, "succeeded", result)).outcome).toBe("invalid_result");
    expect((await db.query("select state,result from public.marketing_geo_kb_generations where id=$1", [id])).rows[0]).toEqual({ state: "dispatched", result: null });
    expect((await db.query("select count(*)::int as n from public.marketing_geo_kb_prepared_candidates where generation_id=$1", [id])).rows[0].n).toBe(0);
  });

  it("marks a paid knowledge result input_stale when its exact draft changes after dispatch", async () => {
    const f = await fixture(), seed = knowledgeFixture(f, randomUUID());
    const generation = await claim(f, "stale_knowledge_1", "knowledge_pack", seed.manifest), id = generation.generation.generationId;
    await dispatch(f, id, generation.claim_token);
    await db.query("update public.marketing_geo_kb_drafts set draft_version=2 where kb_id=$1", [f.kbId]);
    const finished = await finish(f, id, generation.claim_token, "succeeded", knowledgeFixture(f, id).result);
    expect(finished.generation).toMatchObject({ kind: "knowledge_pack", state: "failed", errorReason: "input_stale", result: null, attempt: ATTEMPT });
  });

  it.each(["https://example.com", "https://EXAMPLE.com", "https://example.com:443", "https://example.com/a/../"])("persists and freezes a V2 candidate for canonical-equivalent target %s", async targetUrl => {
    const f = await fixture(targetUrl);
    const report = finalizeGeoKbSourceReportV2({ schemaVersion: "marketing-geo-kb-enrichment.v2", receiptId: randomUUID(), kbId: f.kbId,
      targetHost: "example.com", draftVersion: 1, draftHash: f.input.baseDraftHash, profileReference: profileCopyReference(f.payload.profileCopy),
      createdAt: "2026-08-31T00:00:00.000Z", competitors: [], facts: [], gsc: { status: "unavailable", reason: "not_connected",
        property: null, window: { startDate: "2026-06-01", endDate: "2026-08-29" }, queryCount: null, truncated: null, observedAt: null, queries: [] } });
    expect(await persistGeoSourceReceiptV2({ userId: f.userId, report }, transport)).toEqual({ kind: "ok" });
    const sourceReceiptRefs = [{ receiptId: report.receiptId, contentHash: report.contentHash }];
    const run = await persistedKnowledge(f, "knowledge_for_v2_1", sourceReceiptRefs);
    const questionInput = { ...f.input, sourceReceiptRefs, knowledgeGeneration: { generationId: run.scope.generationId, inputHash: run.inputHash, resultHash: run.knowledge.result.contentHash } };
    const generationStore = createGeoKbGenerationStore(transport);
    const claimed = await generationStore.claim({ userId: f.userId, kbId: f.kbId, kind: "questions", idempotencyKey: "question_v2_1", input: questionInput as never,
      inputHash: geoGenerationInputHash("questions", questionInput) });
    expect(claimed.kind).toBe("claimed"); if (claimed.kind !== "claimed") throw new Error("Missing V2 question claim");
    const scope = { userId: f.userId, kbId: f.kbId, generationId: claimed.generation.generationId, claimToken: claimed.claimToken };
    expect((await generationStore.markDispatched(scope)).kind).toBe("dispatched");
    const id = scope.generationId;
    const prepared = candidateV2(f, id, run.knowledge, run.inputHash);
    const { contentHash: _synthesisHash, ...synthesisBody } = prepared.knowledgeSynthesisInput;
    const changedSynthesis = { ...synthesisBody, targetUrl: "https://other.example/" };
    const forgedSynthesis = { ...changedSynthesis, contentHash: geoV2Digest(changedSynthesis) };
    const { candidateHash: _preparedHash, ...preparedBody } = prepared;
    const forgedBody = { ...preparedBody, knowledgeSynthesisInput: forgedSynthesis, knowledgeGeneration: {
      ...prepared.knowledgeGeneration, synthesisInputHash: forgedSynthesis.contentHash,
      inputHash: geoKnowledgeGenerationInputHash({ ...run.knowledge.manifest, knowledgeSynthesisInput: forgedSynthesis }),
    } };
    expect((await finish(f, id, scope.claimToken, "succeeded", { ...forgedBody, candidateHash: geoV2Digest(forgedBody) })).outcome).toBe("invalid_result");
    expect(await generationStore.finish(scope, { state: "succeeded", result: prepared as never, errorReason: null,
      attempt: { ...ATTEMPT, attemptedCalls: 1, delivery: "response_received" } })).toMatchObject({ kind: "ok", generation: { kind: "questions", state: "succeeded", result: prepared } });
    const preparedStore = createGeoKbPreparedStore({ ...transport, readCandidate: async scope => ({ data: (await db.query("select id,user_id,kb_id,candidate_hash,candidate from public.marketing_geo_kb_prepared_candidates where user_id=$1 and kb_id=$2 and id=$3", [scope.userId, scope.kbId, scope.candidateId])).rows[0] ?? null, error: null }) });
    expect(await preparedStore.read({ userId: f.userId, kbId: f.kbId, candidateId: id })).toMatchObject({ kind: "ok", value: { schemaVersion: "marketing-geo-prepared-candidate.v2", knowledgePack: prepared.knowledgePack } });
    const frozen = await preparedStore.freeze({ userId: f.userId, kbId: f.kbId, candidateId: id, candidateHash: prepared.candidateHash });
    expect(frozen).toMatchObject({ kind: "ok", value: { contentHash: prepared.baseDraftHash, questionSetHash: prepared.context.questionSetHash } });
    const snapshot = (await db.query("select s.prepared_id,s.payload,s.question_set,p.candidate->'knowledgePack' as knowledge_pack from public.marketing_geo_kb_snapshots s join public.marketing_geo_kb_prepared_candidates p on p.id=s.prepared_id where s.id=$1", [frozen.kind === "ok" ? frozen.value.snapshotId : randomUUID()])).rows[0];
    expect(snapshot).toEqual({ prepared_id: id, payload: prepared.payload, question_set: prepared.questionSet, knowledge_pack: prepared.knowledgePack });
  });
  it("rejects a V2 candidate that attaches receipt-bound knowledge to another question context", async () => {
    const f = await fixture();
    const knowledgeRefs = [{ receiptId: "33333333-3333-4333-8333-333333333333", contentHash: "a".repeat(64) }];
    const run = await persistedKnowledge(f, "knowledge_receipt_scope_1", knowledgeRefs);
    const questionInput = { ...f.input, sourceReceiptRefs: [], knowledgeGeneration: {
      generationId: run.scope.generationId, inputHash: run.inputHash, resultHash: run.knowledge.result.contentHash,
    } };
    const claimed = await claim(f, "question_receipt_scope_1", "questions", questionInput);
    expect(claimed.outcome).toBe("claimed");
    await dispatch(f, claimed.generation.generationId, claimed.claim_token);

    const v1 = candidate(f, claimed.generation.generationId);
    const knowledgePack = buildGeoKnowledgePack({ generatedAt: run.knowledge.result.generatedAt, payload: v1.payload, context: v1.context,
      questionSet: v1.questionSet, evidence: run.knowledge.evidence, synthesisInput: run.knowledge.synthesisInput,
      narrative: run.knowledge.narrative, narrativeFailureReason: null });
    const { candidateHash: _candidateHash, schemaVersion: _schemaVersion, ...base } = v1;
    const body = { ...base, schemaVersion: "marketing-geo-prepared-candidate.v2", knowledgePack, knowledgeSynthesisInput: run.knowledge.synthesisInput,
      knowledgeGeneration: { generationId: run.scope.generationId, inputHash: run.inputHash, synthesisInputHash: run.knowledge.synthesisInput.contentHash,
        evidenceContentHash: run.knowledge.synthesisInput.evidenceContentHash, payloadHash: v1.baseDraftHash, questionSetHash: v1.context.questionSetHash,
        packHash: knowledgePack.contentHash, sourceCatalogueHash: geoV2Digest(knowledgePack.sourceCatalogue), promptVersion: "geo-kb-knowledge-pack.v1" } };
    const forged = { ...body, candidateHash: geoV2Digest(body) };

    expect((await finish(f, claimed.generation.generationId, claimed.claim_token, "succeeded", forged)).outcome).toBe("invalid_result");
    expect((await db.query("select state,result from public.marketing_geo_kb_generations where id=$1", [claimed.generation.generationId])).rows[0]).toEqual({ state: "dispatched", result: null });
  });
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
  it("installs exact kind and V2 prepared-candidate cap constraints", async () => {
    const definitions = Object.fromEntries((await db.query(`select conname,pg_get_constraintdef(oid) as definition from pg_constraint
      where conrelid in ('public.marketing_geo_kb_generations'::regclass,'public.marketing_geo_kb_generation_keys'::regclass,'public.marketing_geo_kb_prepared_candidates'::regclass)`)).rows
      .map(row => [row.conname, row.definition]));
    expect(definitions.marketing_geo_kb_generations_kind_check).toContain("knowledge_pack");
    expect(definitions.marketing_geo_kb_generation_keys_kind_check).toContain("knowledge_pack");
    expect(definitions.marketing_geo_kb_generations_result_check).toContain("2359296");
    expect(definitions.marketing_geo_kb_generations_result_check).toContain("2097152");
    expect(definitions.marketing_geo_kb_prepared_candidates_candidate_check).toContain(String(GEO_PREPARED_CANDIDATE_V2_MAX_BYTES));
    expect(definitions.marketing_geo_kb_prepared_candidates_candidate_check).toContain("jsonb_typeof");
  });
  it("rejects result and candidate objects with no schema discriminator at the table boundary", async () => {
    const f = await fixture(), claimed = await claim(f);
    const rejectsCheck = async (operation: () => Promise<unknown>) => {
      await db.query("begin");
      try { await expect(operation()).rejects.toThrow(/check constraint/iu); }
      finally { await db.query("rollback"); }
    };
    await rejectsCheck(() => db.query(`insert into public.marketing_geo_kb_generations
        (id,user_id,kb_id,kind,input_hash,input,state,lease_expires_at,result,attempt)
        values($1,$2,$3,'roles',$4,'{}'::jsonb,'succeeded',now(),'{}'::jsonb,$5::jsonb)`,
      [randomUUID(), f.userId, f.kbId, "f".repeat(64), JSON.stringify(ATTEMPT)]));
    await rejectsCheck(() => db.query(`insert into public.marketing_geo_kb_prepared_candidates
        (id,user_id,kb_id,generation_id,candidate_hash,candidate)
        values($1,$2,$3,$4,$5,'{}'::jsonb)`,
      [randomUUID(), f.userId, f.kbId, claimed.generation.generationId, "e".repeat(64)]));
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
    for (const signature of ["marketing_geo_knowledge_input_valid(uuid,text,jsonb)", "marketing_geo_knowledge_result_valid(uuid,uuid,text,jsonb,jsonb)", "marketing_geo_candidate_valid(uuid,uuid,jsonb)"]) {
      expect((await db.query("select has_function_privilege('anon',$1,'execute') as anon,has_function_privilege('authenticated',$1,'execute') as browser,has_function_privilege('service_role',$1,'execute') as service", [`public.${signature}`])).rows[0]).toEqual({ anon: false, browser: false, service: false });
      const config = (await db.query("select proconfig from pg_proc where oid=$1::regprocedure", [`public.${signature}`])).rows[0];
      expect(config.proconfig).toEqual(expect.arrayContaining(['search_path=""', 'TimeZone=UTC']));
    }
    const protectedTables = ["marketing_geo_kb_generations", "marketing_geo_kb_generation_keys", "marketing_geo_kb_prepared_candidates", "marketing_geo_kb_snapshots"];
    const security = (await db.query(`select c.relname,c.relrowsecurity,count(p.policyname)::int as policies
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      left join pg_policies p on p.schemaname=n.nspname and p.tablename=c.relname
      where n.nspname='public' and c.relname=any($1::text[])
      group by c.relname,c.relrowsecurity order by c.relname`, [protectedTables])).rows;
    expect(security).toHaveLength(protectedTables.length);
    expect(security.every(row => row.relrowsecurity === true && row.policies === 0)).toBe(true);

    const asRole = async (role: "anon" | "authenticated" | "service_role", operation: () => Promise<unknown>) => {
      await db.query("begin");
      try { await db.query(`set local role ${role}`); await operation(); }
      finally { await db.query("rollback"); }
    };
    for (const role of ["anon", "authenticated"] as const) {
      await asRole(role, async () => expect(db.query("select count(*) from public.marketing_geo_kb_generations")).rejects.toThrow(/permission denied/iu));
      await asRole(role, async () => expect(db.query("select * from public.marketing_geo_read_generation($1,$2,$3,null)", [f.userId, f.kbId, id])).rejects.toThrow(/permission denied/iu));
    }
    await asRole("service_role", async () => expect(db.query("select count(*) from public.marketing_geo_kb_generations")).resolves.toMatchObject({ rowCount: 1 }));
    await asRole("service_role", async () => expect(db.query("insert into public.marketing_geo_kb_generations(id,user_id,kb_id,kind,input_hash,state) values($1,$2,$3,'roles',$4,'claimed')", [randomUUID(), f.userId, f.kbId, "a".repeat(64)])).rejects.toThrow(/permission denied/iu));
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
  it("replays the knowledge companion migration twice and rolls it back without mutating durable rows", async () => {
    const migration = readFileSync(new URL("../../../supabase/migrations/20260905155607_geo_knowledge_pack_companion.sql", import.meta.url), "utf8");
    const beforeGenerations = (await db.query("select to_jsonb(g) as row from public.marketing_geo_kb_generations g order by id")).rows;
    const beforeCandidates = (await db.query("select to_jsonb(c) as row from public.marketing_geo_kb_prepared_candidates c order by id")).rows;
    await db.query("begin"); await db.query(migration); await db.query("rollback");
    expect((await db.query("select to_jsonb(g) as row from public.marketing_geo_kb_generations g order by id")).rows).toEqual(beforeGenerations);
    expect((await db.query("select to_jsonb(c) as row from public.marketing_geo_kb_prepared_candidates c order by id")).rows).toEqual(beforeCandidates);
    await db.query(migration); await db.query(migration);
    expect((await db.query("select to_jsonb(g) as row from public.marketing_geo_kb_generations g order by id")).rows).toEqual(beforeGenerations);
    expect((await db.query("select to_jsonb(c) as row from public.marketing_geo_kb_prepared_candidates c order by id")).rows).toEqual(beforeCandidates);
  });
});
