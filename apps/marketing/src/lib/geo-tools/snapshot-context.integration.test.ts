import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectFreshMarketingSchema, openConcurrentClient } from "../credits/sql-test-harness.ts";
import { geoKbDigest } from "./kb-digest.ts";
import type { GeoKbValue } from "./kb-contract.ts";
import { contextPayload, contextReceipt } from "./snapshot-context.test-fixtures.ts";
import { finalizeGeoEnrichmentReport } from "./kb-enrichment.ts";
import { buildGeoSnapshotContext, geoSnapshotContextHash } from "./snapshot-context.ts";
import { buildGeoQuestionSet, geoQuestionSetDigest } from "./kb-questions.ts";
import { emptyMarketingWebsiteProfile, profileSha256 } from "../account-websites/contracts.ts";
import type { GeoInheritedProfile } from "./asset-context.ts";

const migration = readFileSync(new URL("../../../supabase/migrations/20260831035712_geo_snapshot_context.sql", import.meta.url), "utf8");
let db: Client;
beforeAll(async () => { db = await connectFreshMarketingSchema(); });
afterAll(async () => { await db?.end(); });

async function fixture(withWebsite = true) {
  const userId = randomUUID();
  const payload = contextPayload();
  const { rows: [kb] } = await db.query("select * from public.marketing_geo_upsert_kb($1,'https://example.com','example.com','example.com')", [userId]);
  if (withWebsite) await db.query("insert into public.marketing_websites(user_id,canonical_site_key,origin,submitted_url,host) values($1,'example.com','https://example.com','https://example.com','example.com')", [userId]);
  await db.query("select * from public.marketing_geo_save_kb_draft($1,$2,$3,$4,$5,0)", [userId, kb.kb_id, payload.schemaVersion, payload, geoKbDigest(payload as unknown as GeoKbValue)]);
  const { contentHash: _hash, ...body } = contextReceipt(kb.kb_id);
  const receipt = finalizeGeoEnrichmentReport({ ...body, receiptId: randomUUID(), profileReference: null });
  const generated = buildGeoSnapshotContext({ kbId: kb.kb_id, targetHost: "example.com", payload, profile: null, receipt: null });
  return { userId, kbId: kb.kb_id as string, payload, receipt, ...generated };
}
async function saveReceipt(f: Awaited<ReturnType<typeof fixture>>, userId = f.userId, report = f.receipt) {
  const { rows: [row] } = await db.query("select * from public.marketing_geo_record_enrichment($1,$2,$3,$4)", [userId, f.kbId, report.receiptId, report]);
  return row;
}
async function freeze(f: Awaited<ReturnType<typeof fixture>>, client = db, baseVersion = 1) {
  const { rows: [row] } = await client.query("select * from public.marketing_geo_freeze_kb_with_context($1,$2,$3,$4,$5,$6,$7)", [f.userId, f.kbId, f.payload.schemaVersion, baseVersion, f.questionSet, f.context.questionSetHash, f.context]);
  return row;
}

async function confirmedProfile(userId: string, name: string, priorWebsiteId?: string, revision = 1): Promise<GeoInheritedProfile> {
  const existing = await db.query("select id from public.marketing_websites where user_id=$1 and canonical_site_key='example.com'", [userId]);
  const websiteId = priorWebsiteId ?? existing.rows[0]?.id ?? randomUUID();
  if (!existing.rows.length) await db.query("insert into public.marketing_websites(id,user_id,canonical_site_key,origin,submitted_url,host) values($1,$2,'example.com','https://example.com','https://example.com','example.com')", [websiteId, userId]);
  const profile = { ...emptyMarketingWebsiteProfile(), productName: name, oneLinePositioning: "Analytics for teams", coreFeatures: ["Reporting"], country: "US", locale: "en" };
  const profileHash = await profileSha256(profile);
  const snapshotId = randomUUID();
  await db.query("insert into public.marketing_website_profile_snapshots(id,website_id,user_id,revision,schema_version,profile,content_hash,source_draft_version) values($1,$2,$3,$4,$5,$6,$7,1)", [snapshotId, websiteId, userId, revision, profile.schemaVersion, profile, profileHash]);
  await db.query("update public.marketing_websites set current_confirmed_snapshot_id=$1 where id=$2", [snapshotId, websiteId]);
  return { reference: { schemaVersion: "website-profile-reference.v1", websiteId, snapshotId, snapshotRevision: revision, profileSchemaVersion: profile.schemaVersion, profileHash }, productName: name, oneLinePositioning: profile.oneLinePositioning, coreFeatures: profile.coreFeatures, market: { country: "US", language: "en" }, fieldProvenance: [] };
}

describe("atomic GEO freeze context", () => {
  it("requires a canonical owned Website for new-context freezes", async () => {
    const f = await fixture(false);
    expect((await freeze(f)).outcome).toBe("website_required");
    const count = await db.query("select count(*)::int as n from public.marketing_geo_kb_snapshots where kb_id=$1", [f.kbId]);
    expect(count.rows[0].n).toBe(0);
  });
  it("binds the exact owned confirmed Profile fields and refuses a changed current pointer", async () => {
    const f = await fixture();
    const profile = await confirmedProfile(f.userId, "Acme");
    const generated = buildGeoSnapshotContext({ kbId: f.kbId, targetHost: "example.com", payload: f.payload, profile, receipt: null });
    expect((await freeze({ ...f, ...generated })).outcome).toBe("frozen");
    await confirmedProfile(f.userId, "Acme Updated", profile.reference.websiteId, 2);
    expect((await freeze({ ...f, ...generated })).outcome).toBe("profile_stale");
  });
  it("does not accept profile:null when this owned website has a confirmed Profile", async () => {
    const f = await fixture();
    await confirmedProfile(f.userId, "Acme");
    expect((await freeze(f)).outcome).toBe("profile_stale");
  });
  it("refuses inherited fields not present in the exact Profile even with a recomputed context hash", async () => {
    const f = await fixture();
    const profile = await confirmedProfile(f.userId, "Acme");
    const generated = buildGeoSnapshotContext({ kbId: f.kbId, targetHost: "example.com", payload: f.payload, profile: { ...profile, productName: "Forged" }, receipt: null });
    expect((await freeze({ ...f, ...generated })).outcome).toBe("context_mismatch");
  });
  it("holds the Website pointer stable through the atomic freeze", async () => {
    const f = await fixture();
    const profile = await confirmedProfile(f.userId, "Acme");
    const generated = buildGeoSnapshotContext({ kbId: f.kbId, targetHost: "example.com", payload: f.payload, profile, receipt: null });
    const client = await openConcurrentClient();
    await db.query("begin");
    try {
      await db.query("select id from public.marketing_websites where id=$1 for update", [profile.reference.websiteId]);
      const pending = freeze({ ...f, ...generated }, client);
      expect(await Promise.race([pending.then(() => "completed"), new Promise((resolve) => setTimeout(() => resolve("waiting"), 50))])).toBe("waiting");
      await db.query("commit");
      expect((await pending).outcome).toBe("frozen");
    } finally { await db.query("rollback"); await client.end(); }
  });
  it("reapplies safely, binds both hashes and reuses only the same context", async () => {
    const f = await fixture();
    const first = await freeze(f);
    expect(first.outcome).toBe("frozen");
    await db.query(migration);
    expect(await freeze(f)).toMatchObject({ snapshot_id: first.snapshot_id, reused_existing: true });
    const r = await db.query("select s.content_hash,s.context_hash,c.context from public.marketing_geo_kb_snapshots s join public.marketing_geo_snapshot_contexts c on c.snapshot_id=s.id where s.id=$1", [first.snapshot_id]);
    expect(r.rows[0]).toMatchObject({ content_hash: f.context.payloadHash, context_hash: f.context.contentHash, context: f.context });
  });
  it("stores a new source-conditioned snapshot without rewriting legacy payload identity", async () => {
    const f = await fixture();
    const legacySet = buildGeoQuestionSet(f.payload);
    const { rows: [legacy] } = await db.query("select * from public.marketing_geo_freeze_kb($1,$2,$3,1,$4,$5)", [f.userId, f.kbId, f.payload.schemaVersion, legacySet, geoQuestionSetDigest(legacySet)]);
    const fresh = await freeze(f);
    expect(fresh.outcome).toBe("frozen");
    expect(fresh.snapshot_id).not.toBe(legacy.snapshot_id);
    expect(fresh.content_hash).toBe(legacy.content_hash);
    const old = await db.query("select context_hash,question_set from public.marketing_geo_kb_snapshots where id=$1", [legacy.snapshot_id]);
    expect(old.rows[0]).toEqual({ context_hash: null, question_set: legacySet });
    const replay = await db.query("select * from public.marketing_geo_freeze_kb($1,$2,$3,1,$4,$5)", [f.userId, f.kbId, f.payload.schemaVersion, legacySet, geoQuestionSetDigest(legacySet)]);
    expect(replay.rows[0].snapshot_id).toBe(legacy.snapshot_id);
  });
  it("records immutable owner-scoped receipts with exact idempotence", async () => {
    const f = await fixture();
    expect((await saveReceipt(f, randomUUID())).outcome).toBe("not_found");
    expect((await saveReceipt(f)).outcome).toBe("recorded");
    expect((await saveReceipt(f)).outcome).toBe("recorded");
    const { contentHash: _hash, ...body } = f.receipt;
    expect((await saveReceipt(f, f.userId, finalizeGeoEnrichmentReport({ ...body, createdAt: "2026-09-01T00:00:00.000Z" }))).outcome).toBe("receipt_conflict");
  });
  it("refuses a made-up receipt and changes neither snapshot nor pointer", async () => {
    const f = await fixture();
    const generated = buildGeoSnapshotContext({ kbId: f.kbId, targetHost: "example.com", payload: f.payload, profile: null, receipt: f.receipt });
    expect((await freeze({ ...f, ...generated })).outcome).toBe("context_mismatch");
    const r = await db.query("select current_frozen_snapshot_id from public.marketing_geo_knowledge_bases where id=$1", [f.kbId]);
    expect(r.rows[0].current_frozen_snapshot_id).toBeNull();
    const count = await db.query("select count(*)::int as n from public.marketing_geo_kb_snapshots where kb_id=$1", [f.kbId]);
    expect(count.rows[0].n).toBe(0);
  });
  it("freezes accepted receipts atomically and preserves earlier source state", async () => {
    const f = await fixture();
    const old = await freeze(f);
    await saveReceipt(f);
    const generated = buildGeoSnapshotContext({ kbId: f.kbId, targetHost: "example.com", payload: f.payload, profile: null, receipt: f.receipt });
    const fresh = await freeze({ ...f, ...generated });
    expect(fresh.outcome).toBe("frozen");
    expect(fresh.snapshot_id).not.toBe(old.snapshot_id);
    const r = await db.query("select context from public.marketing_geo_snapshot_contexts where snapshot_id=$1", [old.snapshot_id]);
    expect(r.rows[0].context).toEqual(f.context);
  });
  it("refuses stale draft, tampered context/hash or a different account", async () => {
    const f = await fixture();
    expect((await freeze(f, db, 99)).outcome).toBe("conflict");
    expect((await freeze({ ...f, userId: randomUUID() })).outcome).toBe("not_found");
    expect((await freeze({ ...f, context: { ...f.context, targetHost: "other.example" } })).outcome).toBe("context_mismatch");
    const { contentHash: _hash, ...body } = f.context;
    const wrong = { ...body, questionSetHash: "b".repeat(64) };
    expect((await freeze({ ...f, context: { ...wrong, contentHash: geoSnapshotContextHash(wrong) } })).outcome).toBe("context_mismatch");
  });
  it("deduplicates a racing freeze under the knowledge-base lock", async () => {
    const f = await fixture();
    const client = await openConcurrentClient();
    try {
      const [a, b] = await Promise.all([freeze(f), freeze(f, client)]);
      expect(a.snapshot_id).toBe(b.snapshot_id);
      expect([a.reused_existing, b.reused_existing].sort()).toEqual([false, true]);
    } finally { await client.end(); }
  });
  it("denies browser access and service writes around the append-only functions", async () => {
    for (const table of ["marketing_geo_snapshot_contexts", "marketing_geo_enrichment_receipts"]) {
      const p = await db.query("select has_table_privilege('authenticated',$1,'select') as browser, has_table_privilege('service_role',$1,'insert') as direct_write", [`public.${table}`]);
      expect(p.rows[0]).toEqual({ browser: false, direct_write: false });
    }
    const f = await fixture();
    const frozen = await freeze(f);
    await expect(db.query("delete from public.marketing_geo_snapshot_contexts where snapshot_id=$1", [frozen.snapshot_id])).rejects.toThrow(/append-only/u);
  });
});
