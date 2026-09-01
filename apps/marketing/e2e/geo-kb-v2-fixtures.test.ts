import { describe, expect, it } from "vitest";
import { createGeoKbV2Fixture, GEO_V2_USER, hydrateSafeOfflineVisibilityHtml, renderOfflineVisibilityInitial, runOfflineV2Visibility } from "./geo-kb-v2-fixtures.ts";
import { parseVisibilityImport, exportVisibilityJson } from "../src/lib/geo-tools/visibility-export.ts";
import { countGeoCitationQuestions } from "../src/lib/geo-tools/kb-consumer-projection.ts";
import { parseGeoKbEditorViewV2, parseGeoKbGenerationWire } from "../src/components/tools/geo-kb-v2-wire.ts";
import { parseGeoPreparedCandidate } from "../src/lib/geo-tools/kb-prepared-contract.ts";

describe("isolated V2 browser fixture uses real handler/store seams", () => {
  it.each(["en", "zh"] as const)("keeps the real %s Visibility SSR initial markup consistent with the test-only authenticated Flight prop", locale => {
    const markup = { authenticated: renderOfflineVisibilityInitial(locale, "authenticated"), unauthenticated: renderOfflineVisibilityInitial(locale, "unauthenticated"), unavailable: renderOfflineVisibilityInitial(locale, "unavailable") };
    for (const state of ["unauthenticated", "unavailable"] as const) {
      const initial = renderOfflineVisibilityInitial(locale, state);
      const authenticated = renderOfflineVisibilityInitial(locale, "authenticated");
      const html = `<html><body><header>Unchanged shell</header>${initial}<footer>Unchanged footer</footer></body></html>`;
      expect(hydrateSafeOfflineVisibilityHtml(html, markup)).toBe(html.replace(initial, authenticated));
      expect(() => hydrateSafeOfflineVisibilityHtml(`<main>${initial}${initial}</main>`, markup)).toThrow();
      expect(() => hydrateSafeOfflineVisibilityHtml("<main>Unknown server shape</main>", markup)).toThrow();
    }
  });
  it("starts from a declared Profile so real editor provenance preserves the exact A-B-A snapshot", () => {
    const f = createGeoKbV2Fixture(), original = f.website.draft!.profile;
    const initial = f.website.currentConfirmedSnapshot!;
    const fieldProvenance = [...original.fieldProvenance.filter(entry => entry.path !== "/oneLinePositioning"), {
      path: "/oneLinePositioning" as const, derivation: "declared" as const, confidence: "high" as const,
      source: "user_edit" as const, limitation: null, observedAt: null, evidenceUrls: [],
    }];
    f.saveProfile({ ...original, oneLinePositioning: "Changed Profile B", fieldProvenance });
    expect(f.confirmProfile().confirmedSnapshotRevision).toBe(2);
    f.saveProfile({ ...original, fieldProvenance });
    expect(f.confirmProfile().currentConfirmedSnapshot).toEqual(initial);
  });
  it("loads a real V2 DTO, persists a complete candidate, and recovers it without dispatch", async () => {
    const f = createGeoKbV2Fixture();
    expect(parseGeoKbEditorViewV2(await f.load())).not.toBeNull();
    expect(f.stats.modelCalls).toEqual({ roles: 0, questions: 0 });
    await f.prepareComplete();
    const candidate = parseGeoPreparedCandidate(f.currentCandidate);
    expect(candidate.payload.roles[0]?.source.kind).toBe("model");
    expect(candidate.context.sourceSummary.gsc?.queryCount).toBe(3);
    expect(candidate.questionSet.questions.length).toBeGreaterThan(5);
    expect(candidate.payload.roles[0]?.painPoints).toContain("manual reminders for invoices");
    expect(candidate.questionSet.questions.find(question => question.id.endsWith("problem-finance-managers"))?.text).toBe("How can finance managers reduce manual reminders of invoices?");
    expect((await f.load()).prepared?.candidateHash).toBe(candidate.candidateHash);
    expect((await f.load()).prepared?.candidateHash).toBe(candidate.candidateHash);
    expect(f.stats.modelCalls).toEqual({ roles: 1, questions: 1 });
    expect(f.stats.dispatches).toEqual({ roles: 1, questions: 1 });
    expect(f.stats.structuredOutputRequests.map(request => ({ kind: request.kind, type: request.responseFormat.type,
      name: request.responseFormat.json_schema.name, strict: request.responseFormat.json_schema.strict }))).toEqual([
      { kind: "roles", type: "json_schema", name: "geo_kb_roles_v1", strict: true },
      { kind: "questions", type: "json_schema", name: "geo_kb_questions_v2", strict: true },
    ]);
    for (const request of f.stats.structuredOutputRequests) expect(request.responseFormat.json_schema.schema).toMatchObject({ type: "object" });
  });
  it("freezes the exact failed competitor capture without admitting it or replacing it with a newer receipt", async () => {
    const f = createGeoKbV2Fixture(); await f.prepareComplete();
    const candidate = parseGeoPreparedCandidate(f.currentCandidate), receipt = (await f.load()).sourceReceipt!;
    const failed = receipt.competitors.find(item => item.domain === "missing-rival.example");
    expect(failed).toEqual({ evidenceId: "C2", domain: "missing-rival.example", confirmed: false, sourceUrl: "https://missing-rival.example/",
      source: null, observedAt: null, bodyHash: null, signals: [], signalsTruncated: false, brandName: null, aliases: [], method: null, status: "unavailable", reason: "fetch_failed" });
    const capture = candidate.context.competitorEvidence.find(item => item.capture.domain === "missing-rival.example");
    expect(capture).toEqual({ receiptId: receipt.receiptId, contentHash: receipt.contentHash, receiptCreatedAt: receipt.createdAt, capture: failed });
    expect(candidate.questionSet.entityCatalog.filter(item => item.kind === "competitor").map(item => item.text)).toEqual(["Rival"]);
    expect(candidate.context.evidenceCatalog.some(item => item.id === `S:${receipt.receiptId}:C2`)).toBe(false);
    await f.post("freeze", { kbId: f.kbId, candidateId: candidate.candidateId, candidateHash: candidate.candidateHash });
    const frozen = structuredClone(f.currentFrozen!);
    expect((await f.post("sources", { kbId: f.kbId })).status).toBe(200);
    const reloaded = await f.load();
    expect(reloaded.sourceReceipt?.receiptId).not.toBe(receipt.receiptId);
    expect(reloaded.frozen).toEqual(frozen);
    expect(f.currentCandidate?.candidateHash).toBe(candidate.candidateHash);
    expect(await f.readSource({ userId: GEO_V2_USER, kbId: f.kbId, receiptId: receipt.receiptId })).toEqual({ kind: "ok", value: receipt });
    const sourceReads = f.stats.sourceReads.length;
    const complete = await f.readComplete({ userId: GEO_V2_USER, kbId: f.kbId, snapshotId: frozen.snapshotId });
    expect(f.stats.sourceReads).toHaveLength(sourceReads);
    expect(complete.kind).toBe("ok");
    if (complete.kind !== "ok" || complete.value.context?.schemaVersion !== "marketing-geo-snapshot-context.v2") throw new Error("Missing frozen V2 context");
    expect(complete.value.context.competitorEvidence.find(item => item.capture.domain === "missing-rival.example")).toEqual(capture);
    expect(f.stats.modelCalls).toEqual({ roles: 1, questions: 1 });
  });
  it("freezes only persisted IDs/hash and preserves frozen content when draft/Profile changes", async () => {
    const f = createGeoKbV2Fixture(); await f.prepareComplete();
    const candidate = parseGeoPreparedCandidate(f.currentCandidate);
    expect((await f.post("freeze", { kbId: f.kbId, candidateId: candidate.candidateId, candidateHash: candidate.candidateHash, payload: {} })).status).toBe(400);
    expect((await f.post("freeze", { kbId: f.kbId, candidateId: candidate.candidateId, candidateHash: candidate.candidateHash })).status).toBe(200);
    const frozen = structuredClone(f.currentFrozen);
    expect((await f.save({ ...f.payload, aliases: [...f.payload.aliases, "Later alias"] })).status).toBe(200);
    f.saveProfile({ ...f.website.draft!.profile, productName: "Later Profile" }); f.confirmProfile();
    expect((await f.load()).frozen).toEqual(frozen);
    expect(f.stats.modelCalls).toEqual({ roles: 1, questions: 1 });
  });
  it("keeps ambiguous dispatch uncertain, recoverable by the original key, and never retries it", async () => {
    const f = createGeoKbV2Fixture({ connected: false });
    f.failNextModel("roles");
    const response = await f.generate("roles", "uncertain_original_key");
    expect(response.status).toBe(200);
    const body = await response.json(); expect(parseGeoKbGenerationWire(body.data.generation)?.state).toBe("uncertain");
    const recovered = await f.post("generation", { kbId: f.kbId, kind: "roles", idempotencyKey: "uncertain_original_key" });
    expect((await recovered.json()).data.generation.generationId).toBe(body.data.generation.generationId);
    expect((await f.generate("roles", "uncertain_original_key")).status).toBe(200);
    expect(f.stats.dispatches.roles).toBe(1); expect(f.stats.modelCalls.roles).toBe(1);
  });
  it("arbitrates duplicate requests through real execute/store adapters before the offline provider", async () => {
    const f = createGeoKbV2Fixture();
    const responses = await Promise.all([f.generate("roles", "same_input_key_1"), f.generate("roles", "same_input_key_1")]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(f.stats.dispatches.roles).toBe(1); expect(f.stats.modelCalls.roles).toBe(1);
    expect(f.stats.quota).toBe(2);
  });
  it("uses the complete frozen V2 in actual visibility builders without mixing cost and calibrated denominators", async () => {
    const f = createGeoKbV2Fixture(); await f.prepareComplete(); const candidate = parseGeoPreparedCandidate(f.currentCandidate);
    await f.post("freeze", { kbId: f.kbId, candidateId: candidate.candidateId, candidateHash: candidate.candidateHash });
    const report = await runOfflineV2Visibility(f, ["chatgpt", "perplexity"], 3);
    expect(report.manifest.calls).toBe(candidate.questionSet.questions.length * 6);
    expect(report.metrics.citation.trials).toBe(countGeoCitationQuestions(candidate.questionSet) * 6);
    expect(report.gaps.some(gap => gap.kind === "A")).toBe(true);
    expect(parseVisibilityImport(exportVisibilityJson(report)).ok).toBe(true);
  });
});
