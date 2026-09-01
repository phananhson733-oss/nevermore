// Synthetic historical records for the screenshot defects, never account data.
// Each record has its own recomputed payload/question hashes and a deliberately
// absent legacy context. No current profile is attached to the historical row.
import { geoKbDigest } from "../src/lib/geo-tools/kb-digest.ts";
import type { GeoKbValue } from "../src/lib/geo-tools/kb-contract.ts";
import type { GeoKbFrozenSnapshot } from "../src/lib/geo-tools/kb-store.ts";
import type { SharedBriefHandlerDependencies } from "../src/lib/geo-tools/brief-shared-handler.ts";
import { sharedGeoModelSources } from "../src/lib/geo-tools/brief-shared.ts";
import { createGeoChainFixture, GEO_CHAIN_USER, type GeoChainFixture } from "./geo-chain-fixtures.ts";

export const MIXED_QUESTION = "What are the top 占星工具 tools right now?";
export const CLEAN_QUESTION = "What are the top astrology tools right now?";

export function createGeoBriefQualityFixture(mode: "mixed_legacy" | "no_facts" | "context_outage"): GeoChainFixture {
  const base = createGeoChainFixture("A");
  const categoryTerms = mode === "mixed_legacy"
    ? ["占星工具", "心理占星", "自我探索", "CBT 日记", "知识库", "合盘分析"] : ["astrology"];
  const payload = { ...base.payload, officialName: "AstrologyWiki", aliases: ["AstrologyWiki"], categoryTerms,
    roles: [], competitors: [], facts: mode === "context_outage" ? base.payload.facts : [], importedFrom: null };
  const question = { ...base.question, text: mode === "mixed_legacy" ? MIXED_QUESTION : CLEAN_QUESTION,
    roleId: null, requiredEntities: categoryTerms };
  const questionSet = { ...base.frozen.questionSet, registryVersion: "2026-08-17/13", questions: [question] };
  const frozen: GeoKbFrozenSnapshot = { ...base.frozen, frozenAt: "2026-08-17T00:00:00.000Z", payload, questionSet,
    questionCount: 1, contentHash: geoKbDigest(payload as unknown as GeoKbValue),
    questionSetHash: geoKbDigest(questionSet as unknown as GeoKbValue) };
  const owns = (input: { userId: string; kbId: string; snapshotId?: string }) =>
    input.userId === GEO_CHAIN_USER && input.kbId === frozen.kbId && input.snapshotId === frozen.snapshotId;
  let assemblyCalls = 0;
  const shared: SharedBriefHandlerDependencies = {
    readFrozen: async input => owns(input) ? { kind: "ok", value: frozen } : { kind: "not_found" },
    readContext: async input => !owns(input) ? { kind: "not_found" } : mode === "context_outage"
      ? { kind: "unavailable", reason: "offline_context_read_failure" } : { kind: "ok", value: null },
    readRunEvidence: async () => ({ kind: "not_found" }),
    configured: () => true,
    assemble: async brief => {
      assemblyCalls += 1;
      return { ok: true, outline: [{ id: "O1", h2: "Answer scope and evidence needed", h3: [],
        answers: brief.must_answer.items.map(item => item.id) as [string, ...string[]],
        provenance: { method: "model", derived_from: sharedGeoModelSources(brief) } }] };
    },
    runId: () => "offline-historical-brief",
  };
  return { ...base, payload, frozen, question, shared,
    view: () => ({ ...base.view(), payload, profile: null, context: null,
      frozen: { snapshotId: frozen.snapshotId, revision: frozen.revision, frozenAt: frozen.frozenAt,
        contentHash: frozen.contentHash, questionCount: 1, retrievalCount: 1, questionSetHash: frozen.questionSetHash,
        registryVersion: questionSet.registryVersion, questions: questionSet.questions, skippedLayers: [] } }),
    referenceDependencies: {
      readFrozen: async input => owns(input) ? { kind: "ok", value: frozen } : { kind: "missing" },
      readContext: async input => owns(input) ? { kind: "ok", value: null } : { kind: "missing" },
      readRun: async () => ({ kind: "missing" }), readRunEvidence: shared.readRunEvidence,
    },
    get providerCalls() { return 0; }, get assemblyCalls() { return assemblyCalls; },
  };
}
