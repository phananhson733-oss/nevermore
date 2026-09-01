import { describe, expect, it } from "vitest";
import { enrichVisibilityReportV2 } from "./visibility-enrich.ts";
import { visibilityReportFixtureV2 } from "./visibility-v2.test-fixtures.ts";
import { exportVisibilityJson, parseVisibilityImport, parseVisibilityReportV2 } from "./visibility-export.ts";
import { decodeVisibilityWire, encodeVisibilityWire } from "./visibility-wire.ts";
import type { GeoSiteEvidenceDependencies } from "./site-index.ts";
import { emptyMarketingWebsiteProfile, parseMarketingWebsiteProfile } from "../account-websites/contracts.ts";
import { readVisibilityRunV2, recordVisibilityRunV2, type VisibilityStoreV2Dependencies } from "./visibility-store-v2.ts";
function report() { const base = visibilityReportFixtureV2(); return visibilityReportFixtureV2({ samplesPerQuestion: 3, questions: [{ ...base.questions[0]!.definition, text: "How do teams automate invoice reminders?", requiredEntities: ["invoice reminders"] }], samples: Array.from({ length: 3 }, (_, i) => ({ ...base.questions[0]!.samples[0]!, sampleIndex: i + 1, slotId: `chatgpt:q1:${i + 1}`, providerTaskId: `task-${i}` })) }); }
function deps(large = false): GeoSiteEvidenceDependencies {
  const urls = Array.from({ length: large ? 24 : 1 }, (_, i) => i === 0 ? "https://acme.test/" : `https://acme.test/page-${i}`);
  return { now: () => new Date("2026-08-31T00:02:00.000Z"), renderPage: async () => { throw new Error("no scripts, no relevant page"); }, fetchResource: async (url) => {
    const xml = url.endsWith(".xml"), robots = url.endsWith("robots.txt");
    const body = robots ? "User-agent: *\nAllow: /" : xml ? `<urlset>${urls.map((item) => `<url><loc>${item}</loc></url>`).join("")}</urlset>` : `<html><title>Company home</title><body>${large ? Array.from({ length: 20 }, () => `<h2>${"章".repeat(160)}</h2>`).join("") : "Company home"}</body></html>`;
    return { kind: "ok", requestedUrl: url, finalUrl: url, firstStatus: 200, finalStatus: 200, redirectChain: [], contentType: robots ? "text/plain" : xml ? "application/xml" : "text/html", xRobotsTag: null, body, bytes: new TextEncoder().encode(body).byteLength, bodyComplete: true };
  } };
}
describe("actual Visibility→site evidence→gap pipeline", () => {
  it.each([31, 32])("retains all %i confirmed Profile features through evidence collection and report round trips", async (featureCount) => {
    const profile = parseMarketingWebsiteProfile({ ...emptyMarketingWebsiteProfile(), coreFeatures: Array.from({ length: featureCount }, (_, i) => `Feature ${i}`) });
    const input = report();
    const enriched = await enrichVisibilityReportV2(input, deps(), { snapshotId: input.manifest.snapshotId, contextHash: "b".repeat(64), coreFeatures: profile.coreFeatures });
    expect(enriched.siteEvidence?.index.status).toBe("complete");
    expect(enriched.siteEvidence?.index.priority).toMatchObject({ method: "frozen_profile_core_features.v1", featureCount });
    expect(enriched.gaps[0]).toMatchObject({ kind: "A", action: "brief" });
    expect(enriched.limits).not.toContain("siteEvidenceUnavailable");

    const wire: unknown = JSON.parse(JSON.stringify(encodeVisibilityWire(enriched)));
    expect(decodeVisibilityWire(wire)).toEqual(enriched);
    expect(parseVisibilityImport(exportVisibilityJson(enriched))).toEqual({ ok: true, report: enriched, provenance: "imported_untrusted" });

    const userId = "11111111-1111-4111-8111-111111111111";
    let storedReport: unknown = null;
    const store: VisibilityStoreV2Dependencies = {
      callRpc: async (name, params) => {
        expect(name).toBe("marketing_geo_record_visibility_run_v2");
        storedReport = JSON.parse(JSON.stringify(params.p_report));
        return { kind: "ok", data: [{ outcome: "recorded", run_id: enriched.manifest.runId, recorded_at: enriched.manifest.finishedAt }] };
      },
      readRun: async () => ({ kind: "ok", data: { id: enriched.manifest.runId, user_id: userId, kb_id: enriched.manifest.kbId, snapshot_id: enriched.manifest.snapshotId, question_set_hash: enriched.manifest.questionSetHash, report: storedReport, created_at: enriched.manifest.finishedAt } }),
      readLatest: async () => { throw new Error("No baseline query in an exact report round trip"); },
    };
    expect((await recordVisibilityRunV2({ userId, report: enriched }, store)).kind).toBe("ok");
    expect(await readVisibilityRunV2({ userId, runId: enriched.manifest.runId }, store)).toMatchObject({ kind: "ok", value: { report: enriched, provenance: "server_owned" } });
  });
  it("attaches a real complete scoped inventory and A action before durable storage", async () => {
    const input = report(), enriched = await enrichVisibilityReportV2(input, deps());
    expect(enriched.siteEvidence?.index.status).toBe("complete");
    expect(enriched.gaps[0]).toMatchObject({ kind: "A", action: "brief", evidenceIds: ["site-index"] });
    expect(enriched.manifest.finishedAt).toBe("2026-08-31T00:02:00.000Z");
    expect(parseVisibilityReportV2(enriched)).not.toBeNull();
  });
  it("downgrades omitted site evidence instead of inventing absence or losing sample metrics", async () => {
    const input = report(), enriched = await enrichVisibilityReportV2(input, deps(true));
    expect(enriched.limits).toContain("siteEvidenceBudget");
    expect(enriched.siteEvidence?.index.status).toBe("partial");
    expect(enriched.gaps.every((gap) => gap.kind === "unattributed")).toBe(true);
    expect(enriched.metrics).toEqual(input.metrics);
    expect(enriched.manifest.calls).toBe(3);
    expect(new TextEncoder().encode(JSON.stringify(encodeVisibilityWire(enriched))).byteLength).toBeLessThan(4 * 1024 * 1024);
    expect(parseVisibilityReportV2(enriched)).not.toBeNull();
  });
});
