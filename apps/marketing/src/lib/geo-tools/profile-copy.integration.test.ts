// @input -- explicit loopback disposable Marketing database
// @output -- full Profile-copy integrity, atomic source locking and legacy compatibility
// @pos -- real SQL proof for the additive complete GEO knowledge-base migration
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyMarketingWebsiteProfile, profileSha256, type MarketingWebsiteProfileV1 } from "../account-websites/contracts.ts";
import { connectFreshMarketingSchema, openConcurrentClient } from "../credits/sql-test-harness.ts";
import type { GeoInheritedProfile } from "./asset-context.ts";
import { parseGeoKbPayload, type GeoKbValue } from "./kb-contract.ts";
import { geoKbDigest } from "./kb-digest.ts";
import { buildGeoQuestionSet, geoQuestionSetDigest } from "./kb-questions.ts";
import { buildGeoSnapshotContext, geoSnapshotContextHash } from "./snapshot-context.ts";
import { contextPayload } from "./snapshot-context.test-fixtures.ts";

const migration = readFileSync(new URL("../../../supabase/migrations/20260831100603_geo_kb_profile_copy.sql", import.meta.url), "utf8");
let db: Client;
beforeAll(async () => { db = await connectFreshMarketingSchema(); });
afterAll(async () => { await db?.end(); });
const digest = (value: unknown) => geoKbDigest(value as GeoKbValue);

async function fixture(profile: MarketingWebsiteProfileV1 = {
  ...emptyMarketingWebsiteProfile(), productName: "Acme", oneLinePositioning: "Analytics for teams",
  coreFeatures: ["Reporting"], country: "US", locale: "en",
  fieldProvenance: [{ path: "/productName", derivation: "declared", confidence: "high", source: "user_edit", limitation: null, observedAt: null, evidenceUrls: [] }],
}) {
  const userId = randomUUID();
  const websiteId = randomUUID();
  const snapshotId = randomUUID();
  const profileHash = await profileSha256(profile);
  const { rows: [kb] } = await db.query("select * from public.marketing_geo_upsert_kb($1,'https://example.com','example.com','example.com')", [userId]);
  await db.query("insert into public.marketing_websites(id,user_id,canonical_site_key,origin,submitted_url,host) values($1,$2,'example.com','https://example.com','https://example.com','example.com')", [websiteId, userId]);
  await db.query("insert into public.marketing_website_profile_snapshots(id,website_id,user_id,revision,schema_version,profile,content_hash,source_draft_version) values($1,$2,$3,1,$4,$5,$6,1)", [snapshotId, websiteId, userId, profile.schemaVersion, profile, profileHash]);
  await db.query("update public.marketing_websites set current_confirmed_snapshot_id=$1 where id=$2", [snapshotId, websiteId]);
  const profileCopy = { schemaVersion: "marketing-geo-profile-copy.v1" as const, websiteId, snapshotId, snapshotRevision: "1", profileHash, profile };
  const inherited: GeoInheritedProfile = { reference: { schemaVersion: "website-profile-reference.v1", websiteId, snapshotId, snapshotRevision: 1, profileSchemaVersion: profile.schemaVersion, profileHash }, productName: profile.productName, oneLinePositioning: profile.oneLinePositioning, coreFeatures: profile.coreFeatures, market: { country: profile.country, language: profile.locale }, fieldProvenance: profile.fieldProvenance.filter((entry) => ["/productName", "/oneLinePositioning", "/coreFeatures"].includes(entry.path)) };
  const payload = { ...contextPayload(), profileCopy };
  return { userId, kbId: kb.kb_id as string, websiteId, snapshotId, payload, inherited };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function save(f: Fixture, payload: unknown = f.payload, client = db, baseVersion = 0) {
  const { rows: [row] } = await client.query("select * from public.marketing_geo_save_kb_draft($1,$2,$3,$4,$5,$6)", [f.userId, f.kbId, f.payload.schemaVersion, payload, digest(payload), baseVersion]);
  return row;
}
function generated(f: Fixture) {
  // Start with the real builder, then retain the exact Profile projection even
  // when this SQL boundary fixture exercises larger supported Profile values.
  const base = buildGeoSnapshotContext({ kbId: f.kbId, targetHost: "example.com", payload: f.payload, profile: null, receipt: null });
  const { contentHash: _hash, ...body } = { ...base.context, profile: f.inherited };
  return { ...base, context: { ...body, contentHash: geoSnapshotContextHash(body) } };
}
async function freeze(f: Fixture, data = generated(f), client = db) {
  const { rows: [row] } = await client.query("select * from public.marketing_geo_freeze_kb_with_context($1,$2,$3,1,$4,$5,$6)", [f.userId, f.kbId, f.payload.schemaVersion, data.questionSet, data.context.questionSetHash, data.context]);
  return row;
}
async function advanceProfile(f: Fixture, client = db) {
  const snapshotId = randomUUID();
  const profile = { ...f.payload.profileCopy.profile, productName: "Acme Updated" };
  await client.query("insert into public.marketing_website_profile_snapshots(id,website_id,user_id,revision,schema_version,profile,content_hash,source_draft_version) values($1,$2,$3,2,$4,$5,$6,1)", [snapshotId, f.websiteId, f.userId, profile.schemaVersion, profile, await profileSha256(profile)]);
  await client.query("update public.marketing_websites set current_confirmed_snapshot_id=$1 where id=$2", [snapshotId, f.websiteId]);
}
async function snapshotCount(f: Fixture) {
  return (await db.query("select count(*)::int as n from public.marketing_geo_kb_snapshots where kb_id=$1", [f.kbId])).rows[0].n;
}

describe("complete GEO Profile-copy SQL boundary", () => {
  it("stores and freezes the exact full copy including null provenance without mutating source fields", async () => {
    const f = await fixture();
    expect((await save(f)).outcome).toBe("saved");
    const frozen = await freeze(f);
    expect(frozen.outcome).toBe("frozen");
    const row = (await db.query("select payload,content_hash from public.marketing_geo_kb_snapshots where id=$1", [frozen.snapshot_id])).rows[0];
    expect(row).toEqual({ payload: f.payload, content_hash: digest(f.payload) });
  });
  it("preserves whitespace and JSON-escaped control characters in exact Profile content", async () => {
    const profile = { ...emptyMarketingWebsiteProfile(), productName: "Acme", oneLinePositioning: " leading\tline\nnext\b\f\r\u0001 trailing ", coreFeatures: ["A\\B", "quote\""], country: "US", locale: "en" };
    const f = await fixture(profile);
    expect((await save(f)).outcome).toBe("saved");
    const frozen = await freeze(f);
    expect(frozen.outcome).toBe("frozen");
    expect((await db.query("select payload#>'{profileCopy,profile}' as profile from public.marketing_geo_kb_snapshots where id=$1", [frozen.snapshot_id])).rows[0].profile).toEqual(profile);
  });
  it.each([
    ["content", (f: Fixture) => ({ ...f.payload.profileCopy, profile: { ...f.payload.profileCopy.profile, buyer: "forged buyer" } })],
    ["hash", (f: Fixture) => ({ ...f.payload.profileCopy, profileHash: "f".repeat(64) })],
    ["revision", (f: Fixture) => ({ ...f.payload.profileCopy, snapshotRevision: "2" })],
    ["numeric revision", (f: Fixture) => ({ ...f.payload.profileCopy, snapshotRevision: 1 })],
    ["schema", (f: Fixture) => ({ ...f.payload.profileCopy, schemaVersion: "other.v1" })],
    ["website", (f: Fixture) => ({ ...f.payload.profileCopy, websiteId: randomUUID() })],
    ["malformed", () => null],
  ])("rejects a forged copy %s before creating a draft", async (_label, forge) => {
    const f = await fixture();
    expect((await save(f, { ...f.payload, profileCopy: forge(f) })).outcome).toBe("profile_copy_mismatch");
    expect((await db.query("select count(*)::int as n from public.marketing_geo_kb_drafts where kb_id=$1", [f.kbId])).rows[0].n).toBe(0);
  });
  it("rejects an exact foreign-owned snapshot", async () => {
    const f = await fixture();
    const foreign = await fixture();
    expect((await save(f, { ...f.payload, profileCopy: foreign.payload.profileCopy })).outcome).toBe("profile_copy_mismatch");
  });
  it("cannot downgrade an already complete draft by omitting its Profile copy", async () => {
    const f = await fixture();
    expect((await save(f)).outcome).toBe("saved");
    const before = (await db.query("select draft_version,content_hash,payload from public.marketing_geo_kb_drafts where kb_id=$1", [f.kbId])).rows[0];
    const { profileCopy: _copy, ...partial } = f.payload;
    expect((await save(f, partial, db, 1)).outcome).toBe("profile_copy_mismatch");
    expect((await db.query("select draft_version,content_hash,payload from public.marketing_geo_kb_drafts where kb_id=$1", [f.kbId])).rows[0]).toEqual(before);
  });
  it("rejects a stale source at save and at freeze without creating a snapshot", async () => {
    const f = await fixture();
    expect((await save(f)).outcome).toBe("saved");
    await advanceProfile(f);
    expect((await save(f, f.payload, db, 1)).outcome).toBe("profile_stale");
    expect((await freeze(f)).outcome).toBe("profile_stale");
    expect(await snapshotCount(f)).toBe(0);
  });
  it("cannot use a fresh context to launder a draft bound to an older Profile", async () => {
    const f = await fixture();
    expect((await save(f)).outcome).toBe("saved");
    await advanceProfile(f);
    const current = (await db.query("select s.* from public.marketing_website_profile_snapshots s join public.marketing_websites w on w.current_confirmed_snapshot_id=s.id where w.id=$1", [f.websiteId])).rows[0];
    const inherited = { ...f.inherited, productName: current.profile.productName, reference: { ...f.inherited.reference, snapshotId: current.id, snapshotRevision: 2, profileHash: current.content_hash } };
    expect((await freeze(f, generated({ ...f, inherited }))).outcome).toBe("profile_stale");
    expect(await snapshotCount(f)).toBe(0);
  });
  it("rejects a context reference or projection that differs from its saved copy", async () => {
    const f = await fixture();
    expect((await save(f)).outcome).toBe("saved");
    const data = generated({ ...f, inherited: { ...f.inherited, productName: "forged" } });
    expect((await freeze(f, data)).outcome).toBe("context_mismatch");
    expect(await snapshotCount(f)).toBe(0);
  });
  it("requires the exact context source-reference shape for a complete copy", async () => {
    const f = await fixture();
    expect((await save(f)).outcome).toBe("saved");
    const data = generated(f);
    // Deliberately bypass the typed caller to exercise the privileged SQL gate.
    // This assertion does not parse, normalize or remove the forged JSON key.
    const malformed = { ...data.context, profile: { ...f.inherited, reference: { ...f.inherited.reference, extra: "not part of the saved source" } } } as unknown as ReturnType<typeof generated>["context"];
    const { contentHash: _hash, ...body } = malformed;
    expect((await freeze(f, { ...data, context: { ...body, contentHash: geoSnapshotContextHash(body) } })).outcome).toBe("context_mismatch");
    expect(await snapshotCount(f)).toBe(0);
  });
  it.each(["missing_provenance", "extra_profile_key"])("rejects the reader-incompatible complete Profile projection: %s", async (kind) => {
    const f = await fixture();
    expect((await save(f)).outcome).toBe("saved");
    const data = generated(f);
    const { fieldProvenance: _provenance, ...withoutProvenance } = f.inherited;
    const profile = kind === "missing_provenance" ? withoutProvenance : { ...f.inherited, extra: "not in the context contract" };
    const malformed = { ...data.context, profile } as unknown as ReturnType<typeof generated>["context"];
    const { contentHash: _hash, ...body } = malformed;
    expect((await freeze(f, { ...data, context: { ...body, contentHash: geoSnapshotContextHash(body) } })).outcome).toBe("context_mismatch");
    expect(await snapshotCount(f)).toBe(0);
    expect((await db.query("select count(*)::int as n from public.marketing_geo_snapshot_contexts where kb_id=$1", [f.kbId])).rows[0].n).toBe(0);
  });
  it("requires the context freeze RPC for a complete copy but keeps legacy payloads usable", async () => {
    const f = await fixture();
    expect((await save(f)).outcome).toBe("saved");
    const questions = buildGeoQuestionSet(f.payload);
    const frozen = await db.query("select * from public.marketing_geo_freeze_kb($1,$2,$3,1,$4,$5)", [f.userId, f.kbId, f.payload.schemaVersion, questions, geoQuestionSetDigest(questions)]);
    expect(frozen.rows[0].outcome).toBe("context_required");
    expect(await snapshotCount(f)).toBe(0);
    const legacy = await fixture();
    const { profileCopy: _copy, ...payload } = legacy.payload;
    expect((await save(legacy, payload)).outcome).toBe("saved");
    const old = await db.query("select * from public.marketing_geo_freeze_kb($1,$2,$3,1,$4,$5)", [legacy.userId, legacy.kbId, payload.schemaVersion, questions, geoQuestionSetDigest(questions)]);
    expect(old.rows[0].outcome).toBe("frozen");
  });
  it("coordinates save and freeze with a concurrent Profile confirmation lock", async () => {
    for (const operation of ["save", "freeze"] as const) {
      const f = await fixture();
      if (operation === "freeze") expect((await save(f)).outcome).toBe("saved");
      const client = await openConcurrentClient();
      await db.query("begin");
      try {
        await db.query("select id from public.marketing_websites where id=$1 for update", [f.websiteId]);
        const pending = operation === "save" ? save(f, f.payload, client) : freeze(f, generated(f), client);
        expect(await Promise.race([pending.then(() => "completed"), new Promise((resolve) => setTimeout(() => resolve("waiting"), 50))])).toBe("waiting");
        await advanceProfile(f);
        await db.query("commit");
        expect((await pending).outcome).toBe("profile_stale");
        expect(await snapshotCount(f)).toBe(0);
      } finally { await db.query("rollback"); await client.end(); }
    }
  });
  it("fits a complete long Profile plus 24 facts, retaining the Profile's own 128KiB limit", async () => {
    const list = Array.from({ length: 32 }, (_, i) => `${i}${"f".repeat(490)}`);
    const f = await fixture({ ...emptyMarketingWebsiteProfile(), productName: "Acme", oneLinePositioning: "p".repeat(2000), coreFeatures: list, useCases: list, outcomes: list, barriers: list, qualificationSignals: list, trustSignals: list, country: "US", locale: "en" });
    const payload = { ...f.payload, facts: Array.from({ length: 24 }, (_, i) => ({ key: `fact${i}`, value: "v".repeat(200), reason: "" as const, sourceUrl: `https://example.com/${"p".repeat(1800)}`, observedAt: "" })) };
    expect(parseGeoKbPayload(payload).ok).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeGreaterThan(131072);
    expect((await save(f, payload)).outcome).toBe("saved");
    expect((await freeze({ ...f, payload })).outcome).toBe("frozen");
    const cap = await db.query("select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='public.marketing_website_profile_snapshots'::regclass and conname like '%profile_check'");
    expect(cap.rows[0].definition).toContain("131072");
  });
  it("replays the additive migration without rewriting legacy or complete snapshot identities", async () => {
    const f = await fixture();
    expect((await save(f)).outcome).toBe("saved");
    const frozen = await freeze(f);
    const before = (await db.query("select to_jsonb(s) as row from public.marketing_geo_kb_snapshots s order by id")).rows;
    await db.query(migration);
    await db.query(migration);
    expect((await db.query("select to_jsonb(s) as row from public.marketing_geo_kb_snapshots s order by id")).rows).toEqual(before);
    expect(await freeze(f)).toMatchObject({ snapshot_id: frozen.snapshot_id, reused_existing: true });
  });
  it("keeps browser execution and direct service writes denied", async () => {
    for (const signature of ["marketing_geo_save_kb_draft(uuid,uuid,text,jsonb,text,integer)", "marketing_geo_freeze_kb(uuid,uuid,text,integer,jsonb,text)", "marketing_geo_freeze_kb_with_context(uuid,uuid,text,integer,jsonb,text,jsonb)", "marketing_geo_validate_profile_copy(uuid,text,jsonb)"]) {
      const row = (await db.query("select has_function_privilege('anon',$1,'execute') as anon,has_function_privilege('authenticated',$1,'execute') as browser,has_function_privilege('service_role',$1,'execute') as service", [`public.${signature}`])).rows[0];
      expect(row).toEqual({ anon: false, browser: false, service: true });
      const definition = (await db.query("select prosecdef,proconfig from pg_proc where oid=$1::regprocedure", [`public.${signature}`])).rows[0];
      expect(definition.prosecdef).toBe(true);
      expect(definition.proconfig).toEqual(expect.arrayContaining(['search_path=""', "TimeZone=UTC"]));
    }
    for (const table of ["marketing_geo_kb_drafts", "marketing_geo_kb_snapshots"]) {
      expect((await db.query("select has_table_privilege('service_role',$1,'insert,update,delete,truncate') as direct", [`public.${table}`])).rows[0].direct).toBe(false);
    }
  });
});
