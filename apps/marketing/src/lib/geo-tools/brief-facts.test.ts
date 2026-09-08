import { describe, expect, it } from "vitest";
import { geoBriefFactsForSnapshot } from "./brief-facts.ts";
import { buildGeoKnowledgePackV3 } from "./kb-knowledge-pack-v3.ts";
import { buildGeoKnowledgePackV2, GEO_KNOWLEDGE_PACK_V2_SCHEMA, type GeoKnowledgePackV2 } from "./kb-knowledge-pack-v2-contract.ts";
import { buildGeoSnapshotContextV3 } from "./snapshot-context-v3.ts";
import { buildGeoSnapshotContextV2 } from "./snapshot-context-v2.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import type { GeoKbPayloadV3 } from "./kb-v3-contract.ts";
import type { VersionedGeoKbFrozenSnapshot } from "./kb-versioned-read.ts";
import { parseGeoKbPayloadV3 } from "./kb-v3-contract.ts";
import { completePayloadV3, conflictingPayloadV3, HASH_A, OBSERVED_AT, V3_KB_ID } from "./kb-v3.test-fixtures.ts";
import { completePayloadV2, questionSetV2, V2_CANDIDATE_ID, V2_KB_ID } from "./kb-v2.test-fixtures.ts";

const SNAPSHOT_ID = "22222222-2222-8222-8222-222222222221";
const FROZEN_AT = "2026-09-03T00:00:00.000Z";
const PRICING_URL = "https://example.com/pricing";

function machineSource(id: string, kind: string, path: string, excerpt: string) {
  return { id, kind, label: id, url: `https://example.com/${path}`, competitor: null, availability: "available",
    reason: null, observedAt: OBSERVED_AT, bodyHash: HASH_A, excerpts: [excerpt], independence: null };
}

/**
 * The shared v3 draft with its machine observations pointed at sources of the
 * kind a published pack requires -- a draft may cite robots.txt for every
 * machine signal, a pack may not. Nothing about the facts changes.
 */
function publishable(payload: GeoKbPayloadV3): GeoKbPayloadV3 {
  const value = structuredClone(payload) as unknown as {
    knowledge: { sourceCatalogue: { id: string }[]; machine: { value: { llms: { sourceRefs: string[] }; sitemap: { sourceRefs: string[] } } } };
  };
  // Idempotent: the shared fixture may already carry these sources.
  if (value.knowledge.sourceCatalogue.some((source) => source.id === "machine:llms")) return payload;
  value.knowledge.sourceCatalogue.push(
    machineSource("machine:llms", "llms", "llms.txt", "Acme product index."),
    machineSource("machine:sitemap", "sitemap", "sitemap.xml", "The sitemap lists the product pages."),
  );
  value.knowledge.machine.value.llms.sourceRefs = ["machine:llms"];
  value.knowledge.machine.value.sitemap.sourceRefs = ["machine:sitemap"];
  return parseGeoKbPayloadV3(value);
}

function v3Fixture(payload: GeoKbPayloadV3 = publishable(completePayloadV3()), withQuestions = true) {
  const questionSet = withQuestions ? questionSetV2() : null;
  const context = buildGeoSnapshotContextV3({ kbId: V3_KB_ID, payload, questionSet, evidenceRefs: [] });
  const pack = buildGeoKnowledgePackV3({ generatedAt: FROZEN_AT, payload, questionSet, bulkAcceptedAt: FROZEN_AT });
  const frozen: VersionedGeoKbFrozenSnapshot = {
    kbId: V3_KB_ID, snapshotId: SNAPSHOT_ID, revision: 1, contentHash: geoV2Digest(payload),
    questionSetHash: questionSet === null ? null : geoV2Digest(questionSet),
    questionCount: questionSet === null ? null : questionSet.questions.length,
    frozenAt: FROZEN_AT, payload, questionSet,
  };
  return { payload, questionSet, context, pack, frozen };
}

type PackFacts = Extract<GeoKnowledgePackV2["facts"], { status: "available" }>;
type PackFact = PackFacts["value"][number];

/** Rebuild a pack around edited facts so every integrity rule still runs. */
function repack(pack: GeoKnowledgePackV2, edit: (facts: readonly PackFact[]) => readonly PackFact[], sources: GeoKnowledgePackV2["sourceCatalogue"] = pack.sourceCatalogue): GeoKnowledgePackV2 {
  const { contentHash: _contentHash, ...body } = pack;
  if (body.facts.status !== "available") throw new Error("Fixture needs published facts");
  const facts = edit(body.facts.value);
  const decisions = [
    ...facts.map((fact) => fact.decision),
    ...(body.entity.status === "available" ? body.entity.value.fields.map((field) => field.decision) : []),
    ...(body.qa.status === "available" ? body.qa.value.map((item) => item.decision) : []),
    ...(body.scope.status === "available" ? [...body.scope.value.does, ...body.scope.value.doesNot, ...body.scope.value.needsHuman, ...body.scope.value.misconceptions].map((item) => item.decision) : []),
    ...(body.comparisons.status === "available" ? body.comparisons.value.flatMap((comparison) => comparison.rows.map((row) => row.decision)) : []),
  ];
  const accepted = decisions.filter((decision) => decision === "accepted").length;
  return buildGeoKnowledgePackV2({
    ...body,
    facts: { ...body.facts, value: facts },
    sourceCatalogue: sources,
    meta: { ...body.meta, counts: { ...body.meta.counts, facts: facts.length, accepted, acceptedInBulk: decisions.length - accepted } },
  });
}

describe("Brief facts from a published v3 knowledge pack", () => {
  it("projects one row per published pack fact, labelled and valued from the pack", () => {
    const { frozen, context, pack } = v3Fixture();
    if (pack.facts.status !== "available") throw new Error("Expected published facts");

    const result = geoBriefFactsForSnapshot(frozen, context, pack);

    // One row per published fact: the Brief neither drops nor invents any.
    expect(result.factTable).toHaveLength(pack.facts.value.length);
    expect(result.factTable).toEqual([
      { id: "F1", label: "Pro plan monthly price", value: "9", reason: null, evidence_refs: ["C1"] },
      { id: "F2", label: "Team plan monthly price", value: "29", reason: null, evidence_refs: ["C2"] },
    ]);
    expect(result.receipts).toEqual([
      { id: "C1", source: "crawl", text: "9", observed_at: OBSERVED_AT, url: PRICING_URL },
      { id: "C2", source: "crawl", text: "29", observed_at: OBSERVED_AT, url: PRICING_URL },
    ]);
    // The row label is the fact's own label, never the opaque item key.
    expect(result.factTable.map((row) => row.label)).not.toContain(pack.facts.value[0]!.itemKey);
  });

  it("publishes a version with no question set and still projects its facts", () => {
    const { frozen, context, pack } = v3Fixture(publishable(completePayloadV3()), false);
    expect(frozen.questionSet).toBeNull();
    expect(frozen.questionCount).toBeNull();

    expect(geoBriefFactsForSnapshot(frozen, context, pack).factTable).toHaveLength(2);
  });

  it("renders a conflicting fact as unresolved rather than as one page's number", () => {
    const { frozen, context, pack } = v3Fixture(publishable(conflictingPayloadV3()));
    if (pack.facts.status !== "available") throw new Error("Expected published facts");
    expect(pack.facts.value[0]!.reason).toBe("conflicting");

    const result = geoBriefFactsForSnapshot(frozen, context, pack);

    const row = result.factTable[0]!;
    expect(row).toEqual({ id: "F1", label: "Pro plan monthly price", value: null, reason: "conflicting", evidence_refs: [] });
    // Never zero and never an empty string.
    expect(row.value).not.toBe(0);
    expect(row.value).not.toBe("");
    // No receipt is minted for a value nobody can state.
    expect(result.receipts.map((receipt) => receipt.id)).toEqual(["C2"]);
  });

  it("re-checks the withholding rule rather than trusting the pack that carries it", () => {
    const { frozen, context, pack } = v3Fixture(publishable(conflictingPayloadV3()));
    // Deliberately built around the pack contract, which forbids this shape: the
    // point is that the Brief does not state a competing number even if one
    // reaches it, so trusting the upstream rule here would prove nothing.
    const forged = structuredClone(pack) as { facts: { status: string; value: { value: string | null; reason: string }[] } };
    if (forged.facts.status !== "available") throw new Error("Expected published facts");
    forged.facts.value[0]!.value = "9";
    expect(forged.facts.value[0]!.reason).toBe("conflicting");

    const result = geoBriefFactsForSnapshot(frozen, context, forged as unknown as GeoKnowledgePackV2);

    expect(result.factTable[0]).toMatchObject({ value: null, reason: "conflicting", evidence_refs: [] });
    expect(result.receipts.map((receipt) => receipt.text)).not.toContain("9");
  });

  it("keeps an unavailable fact's own reason instead of a plausible substitute", () => {
    const { frozen, context, pack } = v3Fixture();
    const edited = repack(pack, (facts) => [{ ...facts[0]!, value: null, reason: "notPublished" as const }, facts[1]!]);

    const result = geoBriefFactsForSnapshot(frozen, context, edited);

    expect(result.factTable[0]).toEqual({ id: "F1", label: "Pro plan monthly price", value: null, reason: "notPublished", evidence_refs: [] });
    expect(result.receipts.map((receipt) => receipt.id)).toEqual(["C2"]);
  });

  it("treats an owner declaration as its own authority, with no crawled URL", () => {
    const { frozen, context, pack } = v3Fixture();
    const edited = repack(pack, (facts) => [{
      ...facts[0]!, origin: "declared_owner" as const, decision: "accepted" as const,
      sourceRefs: [], priorSourceRefs: [...facts[0]!.sourceRefs],
      ownerDeclaredAt: FROZEN_AT, evidenceChecks: "owner_declared" as const, observedAt: null,
    }, facts[1]!]);

    const result = geoBriefFactsForSnapshot(frozen, context, edited);

    expect(result.receipts[0]).toEqual({ id: "K1", source: "kb", text: "9", observed_at: FROZEN_AT, url: null });
    expect(result.factTable[0]).toMatchObject({ value: "9", evidence_refs: ["K1"] });
  });

  it("refuses an observed claim whose only citation has no page to check", () => {
    const { frozen, context, pack } = v3Fixture();
    const reused = { ...pack.sourceCatalogue[1]!, id: "reused:pricing", kind: "accepted_fact" as const, url: null, bodyHash: null };
    const edited = repack(pack, (facts) => [{ ...facts[0]!, sourceRefs: [reused.id] }, facts[1]!], [...pack.sourceCatalogue, reused]);

    expect(() => geoBriefFactsForSnapshot(frozen, context, edited)).toThrow("crawl_receipt_missing");
  });

  it("refuses a v3 version whose context is not the v3 context", () => {
    const { frozen, pack } = v3Fixture();
    expect(() => geoBriefFactsForSnapshot(frozen, null, pack)).toThrow("complete_v3_context_required");
  });

  it("refuses a context that describes another version", () => {
    const { frozen, pack } = v3Fixture();
    const foreign = buildGeoSnapshotContextV3({ kbId: V2_KB_ID, payload: publishable(completePayloadV3()), questionSet: questionSetV2(), evidenceRefs: [] });
    expect(() => geoBriefFactsForSnapshot(frozen, foreign, pack)).toThrow("snapshot_context_mismatch");
  });

  it("refuses a v2 pack beside a v2 payload, which keeps its own fact rows", () => {
    const payload = completePayloadV2();
    const questionSet = questionSetV2();
    const context = buildGeoSnapshotContextV2({ candidateId: V2_CANDIDATE_ID, kbId: V2_KB_ID, payload, questionSet, sourceReceiptRefs: [],
      evidenceCatalog: [{ id: "manual:r1", kind: "manual", text: "Finance teams struggle with late invoices" }],
      sourceSummary: { gsc: null, selectedEvidenceCounts: { profile: 0, gsc: 0, crawl: 0, manual: 1 }, availableEvidenceCounts: { profile: 0, gsc: 0, crawl: 0, manual: 1 } } });
    const frozen: VersionedGeoKbFrozenSnapshot = { kbId: V2_KB_ID, snapshotId: SNAPSHOT_ID, revision: 1, contentHash: geoV2Digest(payload),
      questionSetHash: geoV2Digest(questionSet), questionCount: questionSet.questions.length, frozenAt: FROZEN_AT, payload, questionSet };
    const { pack } = v3Fixture();
    expect(pack.schemaVersion).toBe(GEO_KNOWLEDGE_PACK_V2_SCHEMA);

    expect(() => geoBriefFactsForSnapshot(frozen, context, pack)).toThrow("knowledge_pack_version_mismatch");
    const v3Context = buildGeoSnapshotContextV3({ kbId: V2_KB_ID, payload: publishable(completePayloadV3()), questionSet, evidenceRefs: [] });
    expect(() => geoBriefFactsForSnapshot(frozen, v3Context, null)).toThrow("snapshot_context_version_mismatch");
  });
});
