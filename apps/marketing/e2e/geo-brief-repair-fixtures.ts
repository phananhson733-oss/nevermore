// TEST ONLY: immutable synthetic snapshots and a bounded owner/CAS store.
// The HTTP handlers, context/question builders and Brief assembler remain real.
import { geoKbDigest } from "../src/lib/geo-tools/kb-digest.ts";
import type { GeoKbPayload, GeoKbValue } from "../src/lib/geo-tools/kb-contract.ts";
import type { GeoKbHandlerDependencies, GeoKbFrozenSummary, GeoKbView } from "../src/lib/geo-tools/kb-handler.ts";
import type { GeoKbFrozenSnapshot } from "../src/lib/geo-tools/kb-store.ts";
import { buildGeoSnapshotContext, type GeoSnapshotContext } from "../src/lib/geo-tools/snapshot-context.ts";
import type { SharedBriefHandlerDependencies } from "../src/lib/geo-tools/brief-shared-handler.ts";
import type { GeoBriefReferenceDependencies } from "../src/lib/geo-tools/brief-reference.ts";
import { createGeoBriefQualityFixture } from "./geo-brief-quality-fixtures.ts";
import { GEO_CHAIN_NOW, GEO_CHAIN_ORIGIN, GEO_CHAIN_USER, type GeoChainFixture } from "./geo-chain-fixtures.ts";

export const REPAIRED_SNAPSHOT = "11111111-1111-4111-8111-111111111118";
export const REPAIR_FACT = {
  key: "Natal chart calculator",
  value: "AstrologyWiki provides a free natal chart calculator for beginners.",
  reason: "" as const,
  sourceUrl: `${GEO_CHAIN_ORIGIN}/natal-chart`,
  observedAt: "2026-08-31T03:00:00.000Z",
};

export function createGeoBriefRepairFixture(options: { failFirstRead?: boolean } = {}) {
  const base = createGeoBriefQualityFixture("mixed_legacy");
  // This existing asset has one confirmed competitor; only its category and
  // fact need repairing. No role/GSC or competitor setup is smuggled into UI.
  let payload: GeoKbPayload = { ...base.payload, competitors: [{ domain: "rival.test", brandName: "Rival", confirmed: true }] };
  const original: GeoKbFrozenSnapshot = { ...base.frozen, payload: structuredClone(payload),
    contentHash: geoKbDigest(payload as unknown as GeoKbValue) };
  let latest = original;
  let draftVersion = 1;
  const buildDraft = () => buildGeoSnapshotContext({ kbId: original.kbId, targetHost: base.website.host,
    payload, profile: null, receipt: null });
  let draft = buildDraft();
  const snapshots = new Map<string, { frozen: GeoKbFrozenSnapshot; context: GeoSnapshotContext | null }>([
    [original.snapshotId, { frozen: original, context: null }],
  ]);
  const operations = { existingReads: 0, urlLoads: 0, saves: 0, freezes: 0, imports: 0, runEvidenceReads: 0 };
  const owns = (input: { userId: string; kbId: string }) => input.userId === GEO_CHAIN_USER && input.kbId === original.kbId;
  const snapshot = (input: { userId: string; kbId: string; snapshotId?: string }) =>
    owns(input) && input.snapshotId ? snapshots.get(input.snapshotId) : undefined;
  const preview = () => ({ contentHash: draft.context.contentHash, questionSetHash: draft.context.questionSetHash,
    skippedLayers: draft.context.skippedLayers });
  const summary = (): GeoKbFrozenSummary => ({ snapshotId: latest.snapshotId, revision: latest.revision,
    frozenAt: latest.frozenAt, contentHash: latest.contentHash, questionCount: latest.questionCount,
    retrievalCount: latest.questionSet.questions.filter(question => question.mode === "retrieval").length,
    questionSetHash: latest.questionSetHash, registryVersion: latest.questionSet.registryVersion,
    questions: latest.questionSet.questions, skippedLayers: ["problem", "evaluation"] });
  const view = (): GeoKbView => ({ kbId: original.kbId, origin: GEO_CHAIN_ORIGIN, host: base.website.host,
    draftVersion, payload: structuredClone(payload), frozen: summary(), context: preview(), profile: null, importAvailable: false });

  const kbDependencies: GeoKbHandlerDependencies = {
    authenticate: base.auth,
    loadKnowledgeBase: async () => { operations.urlLoads += 1; throw new Error("Repair navigation must not register or create a site"); },
    loadExistingKnowledgeBase: async input => {
      if (!owns(input)) return { kind: "not_found" };
      operations.existingReads += 1;
      if (options.failFirstRead && operations.existingReads === 1) return { kind: "unavailable", reason: "offline_read_failure" };
      return { kind: "ok", value: view() };
    },
    saveDraft: async input => {
      if (!owns(input)) return { kind: "not_found" };
      if (input.baseVersion !== draftVersion) return { kind: "conflict", draftVersion };
      payload = structuredClone(input.payload);
      draft = buildDraft(); draftVersion += 1; operations.saves += 1;
      return { kind: "ok", value: { draftVersion, updatedAt: GEO_CHAIN_NOW, context: preview() } };
    },
    readDraftPayload: async input => owns(input)
      ? { kind: "ok", value: { payload: structuredClone(payload), draftVersion, ...draft } } : { kind: "not_found" },
    freeze: async input => {
      if (!owns(input)) return { kind: "not_found" };
      if (input.baseVersion !== draftVersion) return { kind: "conflict", draftVersion };
      if (input.context?.contentHash !== draft.context.contentHash || JSON.stringify(input.questionSet) !== JSON.stringify(draft.questionSet)) {
        throw new Error("Freeze must use the current server-derived context and questions");
      }
      if (snapshots.has(REPAIRED_SNAPSHOT)) throw new Error("Fixture allows exactly one explicit repaired freeze");
      latest = { kbId: original.kbId, snapshotId: REPAIRED_SNAPSHOT, revision: 2, frozenAt: GEO_CHAIN_NOW,
        payload: structuredClone(payload), questionSet: structuredClone(input.questionSet),
        contentHash: draft.context.payloadHash, questionSetHash: draft.context.questionSetHash,
        questionCount: input.questionSet.questions.length };
      snapshots.set(latest.snapshotId, { frozen: latest, context: structuredClone(draft.context) });
      operations.freezes += 1;
      return { kind: "ok", value: { ...summary(), reusedExisting: false, context: preview() } };
    },
    importFromProfile: async () => { operations.imports += 1; throw new Error("Repair must not import a profile"); },
  };
  const shared: SharedBriefHandlerDependencies = {
    ...base.shared,
    readFrozen: async input => { const found = snapshot(input); return found ? { kind: "ok", value: found.frozen } : { kind: "not_found" }; },
    readContext: async input => { const found = snapshot(input); return found ? { kind: "ok", value: found.context } : { kind: "not_found" }; },
    readRunEvidence: async () => { operations.runEvidenceReads += 1; return { kind: "not_found" }; },
  };
  const referenceDependencies: GeoBriefReferenceDependencies = {
    ...base.referenceDependencies,
    readFrozen: async input => { const found = snapshot(input); return found ? { kind: "ok", value: found.frozen } : { kind: "missing" }; },
    readContext: async input => { const found = snapshot(input); return found ? { kind: "ok", value: found.context } : { kind: "missing" }; },
    readRunEvidence: shared.readRunEvidence,
  };
  const fixture: GeoChainFixture = { ...base, kbDependencies, shared, referenceDependencies, view,
    get payload() { return payload; }, get frozen() { return latest; }, get context() { return draft.context; },
    get assemblyCalls() { return base.assemblyCalls; },
  };
  return { fixture, original, operations };
}
