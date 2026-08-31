import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectFreshMarketingSchema, openConcurrentClient } from "../credits/sql-test-harness.ts";
import { emptyGeoKbPayload, type GeoKbValue } from "./kb-contract.ts";
import { geoKbDigest } from "./kb-digest.ts";
import { buildGeoQuestionSet, geoQuestionSetDigest } from "./kb-questions.ts";
import { visibilityReportFixtureV2 } from "./visibility-v2.test-fixtures.ts";
import type { VisibilityReportV2 } from "./visibility-v2-contract.ts";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const migration = readFileSync(new URL("../../../supabase/migrations/20260831034706_geo_visibility_v2.sql", import.meta.url), "utf8");
let db: Client;
beforeAll(async () => { db = await connectFreshMarketingSchema(); });
afterAll(async () => { await db?.end(); });

async function reportFixture() {
  const host = `${randomUUID()}.example.com`;
  const { rows: [kb] } = await db.query("select * from public.marketing_geo_upsert_kb($1,$2,$3,$3)", [USER, `https://${host}`, host]);
  const payload = { ...emptyGeoKbPayload(`https://${host}`), officialName: "Acme", aliases: ["Acme"], categoryTerms: ["analytics"], roles: [{ id: "buyer", label: "Buyer", segment: "teams", painPoints: ["reporting"], decisionCriteria: ["price"], vocabulary: ["analytics"] }], competitors: [{ domain: "other.example.com", brandName: "Other", confirmed: true }] };
  await db.query("select * from public.marketing_geo_save_kb_draft($1,$2,$3,$4,$5,0)", [USER, kb.kb_id, payload.schemaVersion, payload, geoKbDigest(payload as unknown as GeoKbValue)]);
  const set = buildGeoQuestionSet(payload);
  const hash = geoQuestionSetDigest(set);
  const { rows: [frozen] } = await db.query("select * from public.marketing_geo_freeze_kb($1,$2,$3,1,$4,$5)", [USER, kb.kb_id, payload.schemaVersion, set, hash]);
  expect(frozen.outcome).toBe("frozen");
  return visibilityReportFixtureV2({ runId: randomUUID(), kbId: kb.kb_id, snapshotId: frozen.snapshot_id, snapshotRevision: frozen.revision, questionSetHash: hash, questions: set.questions, samplesPerQuestion: 3, samples: [], context: { officialName: "Acme", aliases: ["Acme"], competitors: payload.competitors, targetHost: host, marketCode: "US", language: "en" } });
}

async function record(client: Client, report: VisibilityReportV2, userId = USER) {
  const m = report.manifest;
  const { rows: [row] } = await client.query("select * from public.marketing_geo_record_visibility_run_v2($1,$2,$3,$4,$5,$6)", [m.runId, userId, m.kbId, m.snapshotId, m.questionSetHash, report]);
  return row;
}

describe("durable owner-scoped Visibility V2", () => {
  it("installs idempotently and replays identical report bytes without another row", async () => {
    const report = await reportFixture();
    const first = await record(db, report);
    expect(first.outcome).toBe("recorded");
    await db.query(migration);
    expect(await record(db, report)).toEqual(first);
    const count = await db.query("select count(*)::int as n from public.marketing_geo_visibility_runs_v2 where id=$1", [report.manifest.runId]);
    expect(count.rows[0].n).toBe(1);
  });

  it("refuses an account that does not own the exact snapshot", async () => {
    expect((await record(db, await reportFixture(), OTHER)).outcome).toBe("not_found");
  });

  it("refuses question hashes not carried by that frozen snapshot", async () => {
    const report = await reportFixture();
    expect((await record(db, { ...report, manifest: { ...report.manifest, questionSetHash: "b".repeat(64) } })).outcome).toBe("question_set_mismatch");
  });

  it("refuses a different report on the same stable run id", async () => {
    const report = await reportFixture();
    await record(db, report);
    const changed = { ...report, limits: [...report.limits, "changed"] };
    expect((await record(db, changed)).outcome).toBe("run_conflict");
    expect((await record(db, report)).outcome).toBe("recorded");
  });

  it("deduplicates concurrent durable-step replays", async () => {
    const report = await reportFixture();
    const second = await openConcurrentClient();
    try {
      const [a, b] = await Promise.all([record(db, report), record(second, report)]);
      expect(a.outcome).toBe("recorded");
      expect(b).toEqual(a);
    } finally { await second.end(); }
  });

  it("checks the report identities in addition to its outer RPC scope", async () => {
    const report = await reportFixture();
    const m = report.manifest;
    const forged = { ...report, manifest: { ...m, snapshotId: randomUUID() } };
    const r = await db.query("select * from public.marketing_geo_record_visibility_run_v2($1,$2,$3,$4,$5,$6)", [m.runId, USER, m.kbId, m.snapshotId, m.questionSetHash, forged]);
    expect(r.rows[0].outcome).toBe("report_mismatch");
  });

  it("blocks browser reads/writes and service-role writes outside the RPC", async () => {
    const permissions = await db.query(`select
      has_table_privilege('anon','public.marketing_geo_visibility_runs_v2','select') as anon_read,
      has_table_privilege('authenticated','public.marketing_geo_visibility_runs_v2','insert') as browser_write,
      has_table_privilege('service_role','public.marketing_geo_visibility_runs_v2','insert') as service_write,
      has_table_privilege('service_role','public.marketing_geo_visibility_runs_v2','select') as service_read,
      has_function_privilege('authenticated','public.marketing_geo_record_visibility_run_v2(uuid,uuid,uuid,uuid,text,jsonb)','execute') as browser_rpc`);
    expect(permissions.rows[0]).toEqual({ anon_read: false, browser_write: false, service_write: false, service_read: true, browser_rpc: false });
  });

  it("is append-only even for table-owner update, delete and truncate", async () => {
    const report = await reportFixture();
    await record(db, report);
    for (const sql of ["update public.marketing_geo_visibility_runs_v2 set report=report where id=$1", "delete from public.marketing_geo_visibility_runs_v2 where id=$1"]) {
      await expect(db.query(sql, [report.manifest.runId])).rejects.toThrow(/append-only/u);
    }
    await expect(db.query("truncate public.marketing_geo_visibility_runs_v2")).rejects.toThrow(/append-only/u);
  });

  it("rejects oversized reports before insert", async () => {
    const report = await reportFixture();
    const oversized = { ...report, limits: ["x".repeat(4 * 1024 * 1024)] };
    expect((await record(db, oversized)).outcome).toBe("report_mismatch");
  });
});
