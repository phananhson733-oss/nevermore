import { describe, expect, it } from "vitest";
import { createGeoChainFixture, GEO_CHAIN_USER } from "./geo-chain-fixtures.ts";
import { runSharedBrief } from "../src/lib/geo-tools/brief-shared-handler.ts";
import { exportVisibilityJson, parseVisibilityImport } from "../src/lib/geo-tools/visibility-export.ts";
import { geoFingerprint, parseGeoContentBrief } from "@sf/public-tools/content-brief/parse-geo-brief";
import { normalizeSeoAuditUrl } from "@sf/public-tools";
import type { GeoContentBrief } from "@sf/public-tools/content-brief/geo-contract";
import { verifyOwnedGeoBrief } from "../src/lib/geo-tools/brief-reference.ts";
import { handleContentDraftRunRequest, type ContentDraftHandlerDependencies } from "../src/lib/tools/content-draft-handler.ts";

describe("offline browser-chain evidence fixtures", () => {
  it("keeps immutable fixture reads owner- and snapshot-scoped", async () => {
    const fixture = createGeoChainFixture("A");
    await fixture.kbDependencies.freeze({ userId: GEO_CHAIN_USER, kbId: fixture.frozen.kbId, baseVersion: 1,
      questionSet: fixture.frozen.questionSet, context: fixture.context });
    const selection = { userId: GEO_CHAIN_USER, kbId: fixture.frozen.kbId, snapshotId: fixture.frozen.snapshotId };
    expect((await fixture.shared.readFrozen(selection)).kind).toBe("ok");
    expect((await fixture.shared.readContext(selection)).kind).toBe("ok");
    expect(await fixture.shared.readFrozen({ ...selection, userId: "another-owner" })).toEqual({ kind: "not_found" });
    expect(await fixture.shared.readFrozen({ ...selection, kbId: "another-kb" })).toEqual({ kind: "not_found" });
    expect(await fixture.shared.readContext({ ...selection, snapshotId: "another-snapshot" })).toEqual({ kind: "not_found" });
  });
  it.each(["A", "B", "C", "D"] as const)("derives %s from real builders and refuses a fabricated content path", async kind => {
    const fixture = createGeoChainFixture(kind);
    expect(normalizeSeoAuditUrl(fixture.website.origin).ok).toBe(true);
    expect(fixture.providerCalls).toBe(0);
    await fixture.kbDependencies.freeze({ userId: GEO_CHAIN_USER, kbId: fixture.frozen.kbId, baseVersion: 1,
      questionSet: fixture.frozen.questionSet, context: fixture.context });
    const report = await fixture.run(["chatgpt", "perplexity"], 3);
    expect(report.gaps.find(gap => gap.questionId === fixture.question.id)?.kind).toBe(kind);
    expect(report.manifest.calls).toBe(fixture.frozen.questionCount * 6);
    expect(fixture.providerCalls).toBe(report.manifest.calls);
    const imported = parseVisibilityImport(exportVisibilityJson(report));
    expect(imported.ok).toBe(true);
    let charged = 0;
    const response = await runSharedBrief(GEO_CHAIN_USER, { schema: "gengrowth.content_brief/v1.1", kbId: fixture.frozen.kbId,
      snapshotId: fixture.frozen.snapshotId, questionId: fixture.question.id, manualQuestion: null,
      runId: report.manifest.runId, gapId: `gap-${fixture.question.id}` }, fixture.shared, async () => { charged += 1; return true; }, Date.now);
    if (kind === "A" || kind === "D") {
      expect(response.status).toBe(200);
      const body = await response.json() as { data: { brief: unknown } };
      expect((await parseGeoContentBrief(body.data.brief)).ok).toBe(true);
      expect(charged).toBe(1);
      expect(fixture.assemblyCalls).toBe(1);
    } else {
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ error: { code: "gap_not_eligible" } });
      expect(charged).toBe(0);
      expect(fixture.assemblyCalls).toBe(0);
    }
  });
  it.each(["wrong_owner", "rehash_forged_fact"] as const)("rejects %s through the real Draft verifier before quota", async problem => {
    const fixture = createGeoChainFixture("A");
    await fixture.kbDependencies.freeze({ userId: GEO_CHAIN_USER, kbId: fixture.frozen.kbId, baseVersion: 1,
      questionSet: fixture.frozen.questionSet, context: fixture.context });
    const report = await fixture.run(["chatgpt", "perplexity"], 3);
    const response = await runSharedBrief(GEO_CHAIN_USER, { schema: "gengrowth.content_brief/v1.1", kbId: fixture.frozen.kbId,
      snapshotId: fixture.frozen.snapshotId, questionId: fixture.question.id, manualQuestion: null,
      runId: report.manifest.runId, gapId: `gap-${fixture.question.id}` }, fixture.shared, async () => true, Date.now);
    expect(response.status).toBe(200);
    const { data: { brief: produced } } = await response.json() as { data: { brief: GeoContentBrief } };
    expect(await verifyOwnedGeoBrief(produced, GEO_CHAIN_USER, fixture.referenceDependencies)).toBe(true);
    expect((await fixture.referenceDependencies.readRun({ userId: GEO_CHAIN_USER, runId: "another-run" })).kind).toBe("missing");
    const brief = structuredClone(produced);
    if (problem === "rehash_forged_fact") {
      const fact = brief.evidence.facts[0]!;
      fact.text = "The Acme analytics tool supports nine hundred seats.";
      for (const row of brief.fact_table) if (row.evidence_refs.includes(fact.id)) row.value = fact.text;
      brief.run.fingerprint = await geoFingerprint(brief);
      // This is a structurally valid, correctly rehashed forgery, not a bad JSON test.
      expect((await parseGeoContentBrief(brief)).ok).toBe(true);
    }
    const userId = problem === "wrong_owner" ? "another-owner" : GEO_CHAIN_USER;
    let quota = 0, slots = 0, released = 0, generations = 0;
    const dependencies: ContentDraftHandlerDependencies = {
      getServerAuthenticatedUser: async () => ({ status: "authenticated", userId, email: null, avatarUrl: null }),
      readJson: async request => ({ ok: true, value: await request.json() }), extractClientIp: () => "203.0.113.9",
      verifyGeoBrief: (candidate, owner) => verifyOwnedGeoBrief(candidate, owner, fixture.referenceDependencies),
      acquireSlot: () => { slots += 1; return { acquired: true, release: () => { released += 1; } }; },
      consumeQuota: async () => { quota += 1; return { kind: "allowed", hits: 1 }; },
      generateSection: async () => { generations += 1; throw new Error("Refused source reached model fixture"); },
      runCoverage: async () => { throw new Error("Refused source reached coverage fixture"); },
      now: Date.now, runId: () => "denied-fixture", emit: () => undefined,
    };
    const denied = await handleContentDraftRunRequest(new Request("https://geo-chain.test/api/tools/content-draft/run", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ brief,
        settings: { tone: "explanatory", person: "second", product_mention: "gap_only" }, section_ids: brief.draft_readiness.writable }),
    }), dependencies);
    expect(denied.status).toBe(422);
    expect(await denied.json()).toMatchObject({ error: { code: "brief_reference_invalid" } });
    // The non-billable account slot bounds the owned source read and is always
    // released; only quota/provider work must remain untouched on refusal.
    expect({ quota, slots, released, generations }).toEqual({ quota: 0, slots: 1, released: 1, generations: 0 });
  });
});
