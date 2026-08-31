// @input -- only the dedicated disposable loopback PostgreSQL database
// @output -- real SQL persistence → owned gap → shared Brief → Draft authority proof
// @pos -- no provider/network/auth bypass; injected transports execute actual scoped SQL
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectFreshMarketingSchema } from "../credits/sql-test-harness.ts";
import { emptyGeoKbPayload, type GeoKbValue } from "./kb-contract.ts";
import { geoKbDigest } from "./kb-digest.ts";
import { buildGeoQuestionSet, geoQuestionSetDigest } from "./kb-questions.ts";
import { readFrozenGeoKb, type GeoKbStoreDependencies } from "./kb-store.ts";
import { readGeoSnapshotContext, type GeoContextStoreDependencies } from "./asset-context-store.ts";
import { buildVisibilityPlan, createVisibilityReportV2 } from "./visibility-v2.ts";
import { observeVisibilityV2 } from "./visibility-sampling-v2.ts";
import { enrichVisibilityReportV2 } from "./visibility-enrich.ts";
import { readVisibilityRunV2, recordVisibilityRunV2, type VisibilityStoreV2Dependencies } from "./visibility-store-v2.ts";
import { resolveOwnedVisibilityGap } from "./owned-gap.ts";
import { resolveSharedBriefRunEvidence } from "./brief-shared-deps.ts";
import { assembleSharedGeoBrief, sharedGeoBriefBasis, sharedGeoModelSources } from "./brief-shared.ts";
import { verifyOwnedGeoBrief, type GeoBriefReferenceDependencies } from "./brief-reference.ts";
import { geoFingerprint } from "@sf/public-tools/content-brief/parse-geo-brief";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const DATABASE = "signalframe_codex_geo_chain_20260831";
const FACT = "Three team seats are included.";
let db: Client;

beforeAll(async () => {
  const url = new URL(process.env["MARKETING_TEST_DATABASE_URL"] ?? "http://invalid");
  if (url.hostname !== "127.0.0.1" || url.pathname !== `/${DATABASE}`) throw new Error("This suite only resets its dedicated loopback geo-chain test database");
  db = await connectFreshMarketingSchema();
});
afterAll(async () => { await db?.end(); });

/** to_jsonb keeps PostgreSQL dates as strings, as PostgREST returns them. */
const runStore: VisibilityStoreV2Dependencies = {
  callRpc: async (name, params) => {
    if (name !== "marketing_geo_record_visibility_run_v2") throw new Error("Unexpected write RPC");
    const rows = await db.query("select to_jsonb(r) as value from public.marketing_geo_record_visibility_run_v2($1,$2,$3,$4,$5,$6) as r", [params.p_run_id, params.p_user_id, params.p_kb_id, params.p_snapshot_id, params.p_question_set_hash, params.p_report]);
    return { kind: "ok", data: rows.rows.map((row) => row.value) };
  },
  readRun: async ({ userId, runId }) => {
    const rows = await db.query("select to_jsonb(r) as value from public.marketing_geo_visibility_runs_v2 r where r.user_id=$1 and r.id=$2", [userId, runId]);
    return { kind: "ok", data: rows.rows[0]?.value ?? null };
  },
  readLatest: async ({ userId, kbId, questionSetHash, excludeRunId, before }) => {
    const rows = await db.query("select to_jsonb(r) as value from public.marketing_geo_visibility_runs_v2 r where r.user_id=$1 and r.kb_id=$2 and r.question_set_hash=$3 and r.id<>$4 and r.created_at<$5 order by r.created_at desc,r.id desc limit 1", [userId, kbId, questionSetHash, excludeRunId, before]);
    return { kind: "ok", data: rows.rows[0]?.value ?? null };
  },
};

const frozenStore: GeoKbStoreDependencies = {
  readList: async () => { throw new Error("This chain must use exact snapshot reads, not latest/list state"); },
  readDetails: async () => { throw new Error("This chain must not substitute mutable draft details"); },
  callRpc: async () => { throw new Error("Read-only snapshot adapter"); },
  readSnapshot: async (userId, kbId, selector) => {
    if (selector.by !== "snapshotId") throw new Error("Expected immutable snapshot ID selector");
    const rows = await db.query("select to_jsonb(s) as value from public.marketing_geo_kb_snapshots s where s.user_id=$1 and s.kb_id=$2 and s.id=$3", [userId, kbId, selector.snapshotId]);
    return { kind: "ok", data: rows.rows[0]?.value ?? null };
  },
};

const contextStore: GeoContextStoreDependencies = {
  readSnapshot: async (userId, kbId, snapshotId) => {
    const rows = await db.query("select to_jsonb(s) as value from public.marketing_geo_kb_snapshots s where s.user_id=$1 and s.kb_id=$2 and s.id=$3", [userId, kbId, snapshotId]);
    return { data: rows.rows[0]?.value ?? null, error: null };
  },
  readContext: async (userId, kbId, snapshotId) => {
    const rows = await db.query("select to_jsonb(c) as value from public.marketing_geo_snapshot_contexts c where c.user_id=$1 and c.kb_id=$2 and c.snapshot_id=$3", [userId, kbId, snapshotId]);
    return { data: rows.rows[0]?.value ?? null, error: null };
  },
  readReceipt: async () => { throw new Error("The legacy fixture has no enrichment receipt"); },
  callRpc: async () => { throw new Error("Read-only context adapter"); },
};

const readRun: typeof readVisibilityRunV2 = (input) => readVisibilityRunV2(input, runStore);
const readFrozen: typeof readFrozenGeoKb = (input) => readFrozenGeoKb(input, frozenStore);
const readContext: typeof readGeoSnapshotContext = (input) => readGeoSnapshotContext(input, contextStore);
const resolveGap: typeof resolveOwnedVisibilityGap = (input) => resolveOwnedVisibilityGap(input, { readRun });
const readRunEvidence: typeof resolveSharedBriefRunEvidence = (input) => resolveSharedBriefRunEvidence(input, { resolveGap });
const referenceDependencies: GeoBriefReferenceDependencies = { readRun, readFrozen, readContext, readRunEvidence };

async function fixture() {
  const host = `${randomUUID()}.example.com`;
  const { rows: [created] } = await db.query("select * from public.marketing_geo_upsert_kb($1,$2,$3,$3)", [USER, `https://${host}`, host]);
  expect(created.kb_id).toBeTypeOf("string");
  const payload = {
    ...emptyGeoKbPayload(`https://${host}`), officialName: "Acme", aliases: ["Acme App"], categoryTerms: ["invoice automation"],
    roles: [{ id: "buyer", label: "Finance lead", segment: "small teams", painPoints: ["invoice reminders"], decisionCriteria: ["setup effort"], vocabulary: ["invoices"] }],
    competitors: [{ domain: "rival.example.com", brandName: "RivalFlow", confirmed: true }],
    facts: [{ key: "Seats", value: FACT, reason: "" as const, sourceUrl: `https://${host}/pricing`, observedAt: new Date().toISOString() }],
  };
  const payloadHash = geoKbDigest(payload as unknown as GeoKbValue);
  const saved = await db.query("select * from public.marketing_geo_save_kb_draft($1,$2,$3,$4,$5,0)", [USER, created.kb_id, payload.schemaVersion, payload, payloadHash]);
  expect(saved.rows[0].outcome).toBe("saved");
  const questions = buildGeoQuestionSet(payload), questionSetHash = geoQuestionSetDigest(questions);
  const frozenRow = await db.query("select * from public.marketing_geo_freeze_kb($1,$2,$3,1,$4,$5)", [USER, created.kb_id, payload.schemaVersion, questions, questionSetHash]);
  expect(frozenRow.rows[0].outcome).toBe("frozen");
  const selector = { userId: USER, kbId: created.kb_id as string, snapshotId: frozenRow.rows[0].snapshot_id as string };
  const frozenRead = await readFrozen(selector);
  if (frozenRead.kind !== "ok") throw new Error(`Real frozen adapter rejected SQL fixture: ${frozenRead.kind}`);
  const frozen = frozenRead.value;
  expect(frozen.contentHash).toBe(payloadHash);
  expect(frozen.questionSetHash).toBe(questionSetHash);
  expect(await readContext(selector)).toEqual({ kind: "ok", value: null });

  const context = { officialName: payload.officialName, aliases: payload.aliases, competitors: payload.competitors, targetHost: host, marketCode: "US", language: "en" };
  const startedAt = new Date().toISOString();
  const plan = buildVisibilityPlan(frozen.questionSet.questions, ["chatgpt"], 3);
  let providerCalls = 0;
  const samples = [];
  for (const item of plan) samples.push(await observeVisibilityV2(context, item, { provider: { observe: async () => ({
    answerText: "## Invoice reminders\nDocument the reminder workflow before choosing a tool.\n## Team approvals\nRecord who reviews invoice changes.",
    observedAt: new Date().toISOString(), webSearchPerformed: true, citations: [], citationsComplete: true, costUsd: 0.01,
    model: "offline-observed-model", modelObserved: "offline-observed-model", modelRequested: "gpt-5-2025-08-07", providerTaskId: `offline-${++providerCalls}`,
  }) } }));
  expect(providerCalls).toBe(plan.length);
  const sampled = createVisibilityReportV2({ runId: randomUUID(), kbId: frozen.kbId, snapshotId: frozen.snapshotId, snapshotRevision: frozen.revision, questionSetHash, startedAt, finishedAt: new Date().toISOString(), context, questions: frozen.questionSet.questions, samples, engines: ["chatgpt"], samplesPerQuestion: 3 });
  const fetched: string[] = [];
  const report = await enrichVisibilityReportV2(sampled, {
    now: () => new Date(),
    renderPage: async () => { throw new Error("Static no-match fixture must not require a renderer"); },
    fetchResource: async (url) => {
      fetched.push(url);
      const robots = url === `https://${host}/robots.txt`, sitemap = url === `https://${host}/sitemap.xml`;
      if (!robots && !sitemap && url !== `https://${host}/`) throw new Error("Unexpected public URL in offline fixture");
      const body = robots ? "User-agent: *\nAllow: /" : sitemap ? `<urlset><url><loc>https://${host}/</loc></url></urlset>` : "<html><title>Acme company</title><body>Acme company information.</body></html>";
      return { kind: "ok", requestedUrl: url, finalUrl: url, firstStatus: 200, finalStatus: 200, redirectChain: [], contentType: robots ? "text/plain" : sitemap ? "application/xml" : "text/html", xRobotsTag: null, body, bodyComplete: true, bytes: Buffer.byteLength(body) };
    },
  });
  expect(fetched).toEqual([`https://${host}/robots.txt`, `https://${host}/sitemap.xml`, `https://${host}/`]);
  expect(report.siteEvidence?.index.status).toBe("complete");
  const gap = report.gaps.find((gap) => gap.kind === "A");
  if (gap === undefined) throw new Error("Actual complete inventory/classifier produced no A fixture");
  return { report, gap, frozen, selector, payloadHash, questionSetHash };
}

describe("real persisted Visibility → shared Brief authority", () => {
  it("requires an actual SQL-owned run and verifies the positive chain through the real resolvers", async () => {
    const value = await fixture();
    expect((await readRun({ userId: USER, runId: value.report.manifest.runId })).kind).toBe("missing");
    expect((await resolveGap({ userId: USER, runId: value.report.manifest.runId, gapId: value.gap.id, questionId: value.gap.questionId, snapshotId: value.frozen.snapshotId })).kind).toBe("missing");
    const recorded = await recordVisibilityRunV2({ userId: USER, report: value.report }, runStore);
    expect(recorded.kind).toBe("ok");
    expect(await recordVisibilityRunV2({ userId: USER, report: value.report }, runStore)).toEqual(recorded);
    const stored = await db.query("select report->>'wireSchema' as wire_schema, jsonb_array_length(report->'samples') as sample_count, report ? 'byEngine' as duplicate_projection from public.marketing_geo_visibility_runs_v2 where id=$1 and user_id=$2", [value.report.manifest.runId, USER]);
    expect(stored.rows).toEqual([{ wire_schema: "marketing-geo-visibility-file.v2", sample_count: value.report.manifest.calls, duplicate_projection: false }]);
    const read = await readRun({ userId: USER, runId: value.report.manifest.runId });
    expect(read.kind).toBe("ok");
    if (read.kind !== "ok") throw new Error("Missing persisted run");
    expect(read.value.report).toEqual(value.report);
    const owned = await resolveGap({ userId: USER, runId: value.report.manifest.runId, gapId: value.gap.id, questionId: value.gap.questionId, snapshotId: value.frozen.snapshotId });
    expect(owned.kind).toBe("ok");
    const resolved = await readRunEvidence({ userId: USER, runId: value.report.manifest.runId, gapId: value.gap.id, questionId: value.gap.questionId, frozen: value.frozen });
    if (resolved.kind !== "ok") throw new Error(`Actual shared resolver rejected persisted run: ${resolved.kind}`);
    expect(resolved.value.samples).toHaveLength(3);
    expect(resolved.value.samples.every((sample) => sample.status === "answered" && sample.topics.includes("Invoice reminders"))).toBe(true);
    const basis = sharedGeoBriefBasis({ frozen: value.frozen, context: null, questionId: value.gap.questionId, questionText: "", runEvidence: resolved.value, runId: randomUUID(), now: new Date().toISOString() });
    const brief = await assembleSharedGeoBrief(basis, { ok: true, outline: [{ id: "O1", h2: "Answer the frozen question", h3: [], answers: basis.must_answer.items.map((item) => item.id), provenance: { method: "model", derived_from: sharedGeoModelSources(basis) } }] });
    expect(brief.geo_origin.gap).toBe("A");
    expect(brief.geo_origin.run_ref).toEqual({ id: value.report.manifest.runId, fingerprint: resolved.value.fingerprint });
    expect(resolved.value.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(brief.geo_origin.question).toEqual({ id: value.gap.questionId, text: value.frozen.questionSet.questions.find((question) => question.id === value.gap.questionId)!.text });
    expect(brief.geo_origin.kb_ref.content_hash).toBe(value.payloadHash);
    expect(brief.geo_origin.promptset_ref.hash).toBe(value.questionSetHash);
    expect(brief.geo_origin.sample_refs).toEqual(resolved.value.samples.map((sample) => sample.id));
    expect(brief.evidence.facts).toContainEqual(expect.objectContaining({ id: "K1", source: "kb", text: FACT }));
    expect(brief.must_answer.items[0]).toMatchObject({ id: "Q1", source: "kb" });
    expect(brief.must_answer.items.some((item) => item.source === "ai_sample" && item.covered_by === 3 && item.sample_total === 3)).toBe(true);
    expect(await verifyOwnedGeoBrief(brief, USER, referenceDependencies)).toBe(true);
    expect(await verifyOwnedGeoBrief(brief, OTHER, referenceDependencies)).toBe(false);
    expect((await readRun({ userId: OTHER, runId: value.report.manifest.runId })).kind).toBe("missing");
    expect((await recordVisibilityRunV2({ userId: OTHER, report: value.report }, runStore)).kind).toBe("missing");
    const forged = structuredClone(brief);
    forged.fact_table[0]!.value = "Nine hundred seats are included.";
    forged.evidence.facts[0]!.text = "Nine hundred seats are included.";
    forged.run.fingerprint = await geoFingerprint(forged);
    expect(await verifyOwnedGeoBrief(forged, USER, referenceDependencies)).toBe(false);
  });
});
