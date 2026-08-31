// @input -- a dedicated disposable loopback PostgreSQL and maximum admitted offline run
// @output -- proof the final app-admitted wire satisfies the actual jsonb text check and RPC
// @pos -- regression for compact JSON 4,182,120 bytes expanding to 4,243,081 PostgreSQL bytes
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectFreshMarketingSchema } from "../credits/sql-test-harness.ts";
import { visibilityReportFixtureV2 } from "./visibility-v2.test-fixtures.ts";
import { buildVisibilityPlan, createVisibilityReportV2 } from "./visibility-v2.ts";
import { VISIBILITY_ENGINE_CONFIG } from "./visibility-engines.ts";
import { enrichVisibilityReportV2 } from "./visibility-enrich.ts";
import { encodeVisibilityWire, postgresJsonbTextBytes } from "./visibility-wire.ts";
import { parseVisibilityReportV2 } from "./visibility-export.ts";
import { emptyGeoKbPayload, type GeoKbValue } from "./kb-contract.ts";
import { geoKbDigest } from "./kb-digest.ts";
import { geoQuestionSetDigest, type GeoQuestionSet } from "./kb-questions.ts";
import type { VisibilityReportV2 } from "./visibility-v2-contract.ts";
import { recordVisibilityRunV2, type VisibilityStoreV2Dependencies } from "./visibility-store-v2.ts";

const USER = "11111111-1111-4111-8111-111111111111";
const CAP = 4 * 1024 * 1024;
let db: Client;
beforeAll(async () => { db = await connectFreshMarketingSchema(); });
afterAll(async () => { await db?.end(); });

async function largeRun(): Promise<VisibilityReportV2> {
  const seed = visibilityReportFixtureV2();
  const questions = Array.from({ length: 50 }, (_, i) => ({ ...seed.questions[0]!.definition, id: `q${i}`, text: `Which analytics tools solve problem ${i}?` }));
  const set: GeoQuestionSet = { schemaVersion: "marketing-geo-question-set.v1", registryVersion: "offline-budget-fixture", language: "en", country: "US", questions };
  const hash = geoQuestionSetDigest(set);
  const payload = { ...emptyGeoKbPayload("https://acme.test/"), officialName: "Acme", aliases: ["Acme App"], categoryTerms: ["analytics"], competitors: [{ domain: "rival.test", brandName: "Rival", confirmed: true }] };
  const { rows: [kb] } = await db.query("select * from public.marketing_geo_upsert_kb($1,$2,$3,$3)", [USER, "https://acme.test", "acme.test"]);
  await db.query("select * from public.marketing_geo_save_kb_draft($1,$2,$3,$4,$5,0)", [USER, kb.kb_id, payload.schemaVersion, payload, geoKbDigest(payload as unknown as GeoKbValue)]);
  const { rows: [frozen] } = await db.query("select * from public.marketing_geo_freeze_kb($1,$2,$3,1,$4,$5)", [USER, kb.kb_id, payload.schemaVersion, set, hash]);
  expect(frozen.outcome).toBe("frozen");
  const engines = ["chatgpt", "perplexity"] as const;
  const hosts = Array.from({ length: 39 }, (_, i) => `${String(i).padStart(2, "0")}${"x".repeat(45)}.test`);
  const ownUrl = `https://acme.test/${"x".repeat(2030)}`;
  const urls = [ownUrl, ...hosts.slice(0, 9).map((host) => `https://${host}/${"x".repeat(1900)}`)];
  const topics = Array.from({ length: 50 }, (_, i) => `${i} ${"界".repeat(118)}`.slice(0, 120));
  const samples = buildVisibilityPlan(questions, engines, 10).map((slot) => ({ ...seed.questions[0]!.samples[0]!, engine: slot.engine, questionId: slot.question.id, sampleIndex: slot.sampleIndex, slotId: slot.slotId,
    modelRequested: VISIBILITY_ENGINE_CONFIG[slot.engine].modelRequested, providerTaskId: `task-${slot.slotId}`, mentioned: true, cited: true,
    citedDomains: ["acme.test", ...hosts], citedUrls: urls, excerpt: "界".repeat(240), answerExcerpt: "界".repeat(300), answerExcerptTruncated: true, subtopics: topics, subtopicsOmitted: 0,
  }));
  const report = createVisibilityReportV2({ ...seed.manifest, runId: randomUUID(), kbId: kb.kb_id, snapshotId: frozen.snapshot_id, snapshotRevision: frozen.revision, questionSetHash: hash, context: { ...seed.context, officialName: payload.officialName, aliases: payload.aliases, competitors: payload.competitors }, questions, engines, samplesPerQuestion: 10, samples });
  const pages = Array.from({ length: 9 }, (_, i) => `https://acme.test/${i ? `p${i}` : ""}`);
  return enrichVisibilityReportV2(report, {
    now: () => new Date("2026-08-31T01:00:00.000Z"), renderPage: async () => { throw new Error("Static fixture has no relevant page requiring render"); },
    fetchResource: async (url) => {
      const robots = url.endsWith("robots.txt"), sitemap = url.endsWith("sitemap.xml"), ok = robots || sitemap || pages.includes(url);
      const body = robots ? "User-agent: *\nAllow: /" : sitemap ? `<urlset>${pages.map((url) => `<url><loc>${url}</loc></url>`).join("")}</urlset>` : ok ? `<html><title>Information</title><body>${Array.from({ length: 20 }, () => `<h2>${"章".repeat(160)}</h2>`).join("")}</body></html>` : "";
      return { kind: "ok", requestedUrl: url, finalUrl: url, firstStatus: ok ? 200 : 404, finalStatus: ok ? 200 : 404, redirectChain: [], contentType: robots ? "text/plain" : sitemap ? "application/xml" : "text/html", xRobotsTag: null, body, bodyComplete: true, bytes: Buffer.byteLength(body) };
    },
  });
}

describe("PostgreSQL JSONB visibility budget", () => {
  it("persists the complete post-site-evidence maximum-slot report admitted by the application", async () => {
    const report = await largeRun(), wire = encodeVisibilityWire(report);
    expect(parseVisibilityReportV2(report)).not.toBeNull();
    expect(report.manifest.calls).toBe(1000);
    expect(report.questions.flatMap((q) => q.samples)).toHaveLength(1000);
    expect(report.siteEvidence?.index.pages).toHaveLength(9);
    const { rows: [size] } = await db.query("select octet_length($1::jsonb::text) as bytes", [wire]);
    expect(Buffer.byteLength(JSON.stringify(wire))).toBeLessThanOrEqual(CAP);
    expect(size.bytes).toBeLessThanOrEqual(CAP);
    expect(postgresJsonbTextBytes(wire)).toBeGreaterThanOrEqual(size.bytes);
    const store: VisibilityStoreV2Dependencies = {
      readRun: async () => { throw new Error("unused"); }, readLatest: async () => { throw new Error("unused"); },
      callRpc: async (name, params) => {
        expect(name).toBe("marketing_geo_record_visibility_run_v2");
        const result = await db.query("select to_jsonb(r) as value from public.marketing_geo_record_visibility_run_v2($1,$2,$3,$4,$5,$6) r", [params.p_run_id, params.p_user_id, params.p_kb_id, params.p_snapshot_id, params.p_question_set_hash, params.p_report]);
        return { kind: "ok", data: result.rows.map((row) => row.value) };
      },
    };
    expect((await recordVisibilityRunV2({ userId: USER, report }, store)).kind).toBe("ok");
    const { rows: [saved] } = await db.query("select octet_length(report::text) as bytes from public.marketing_geo_visibility_runs_v2 where id=$1 and user_id=$2", [report.manifest.runId, USER]);
    expect(saved.bytes).toBe(size.bytes);

    // The final parser must independently reject an oversized final report,
    // even if compact JSON is still below the cap. Restore only optional topic
    // evidence; all observed scalar counts and site sample pointers stay fixed.
    const restoredTopics = Array.from({ length: 50 }, (_, i) => `${i} ${"界".repeat(118)}`.slice(0, 120));
    const restoredSamples = [...report.questions.flatMap((question) => question.samples)];
    let unsafe = report;
    for (let index = 0; index < restoredSamples.length && postgresJsonbTextBytes(encodeVisibilityWire(unsafe)) <= CAP; index++) {
      const sample = restoredSamples[index]!;
      if (sample.subtopicsOmitted === 0) continue;
      restoredSamples[index] = { ...sample, subtopics: restoredTopics, subtopicsOmitted: 0 };
      const rebuilt = createVisibilityReportV2({ ...report.manifest, context: report.context, questions: report.questions.map((question) => question.definition), engines: report.manifest.engines.map((engine) => engine.engine), samples: restoredSamples });
      unsafe = { ...rebuilt, limits: report.limits, siteEvidence: report.siteEvidence, gaps: report.gaps };
    }
    expect(Buffer.byteLength(JSON.stringify(encodeVisibilityWire(unsafe)))).toBeLessThanOrEqual(CAP);
    expect(postgresJsonbTextBytes(encodeVisibilityWire(unsafe))).toBeGreaterThan(CAP);
    expect(parseVisibilityReportV2(unsafe)).toBeNull();
  });
  it("upper-bounds PostgreSQL exponent expansion and nested separator text", async () => {
    for (const value of [Number.MAX_VALUE, Number.MIN_VALUE, -Number.MIN_VALUE, 1e-7, 1.23e-7, 1e21, { text: "中文\nquote\"", values: [1e-7, Number.MAX_VALUE, true, null] }]) {
      const { rows: [row] } = await db.query("select octet_length($1::jsonb::text) as bytes", [JSON.stringify(value)]);
      expect(postgresJsonbTextBytes(value)).toBe(row.bytes);
    }
  });
});
