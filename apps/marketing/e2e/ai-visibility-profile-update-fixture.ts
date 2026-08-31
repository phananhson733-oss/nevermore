// Mutable offline account/KB store for the explicit source-update browser flow.
// Real copy integrity, context, HTTP and measurement builders remain in use.
import { createHash } from "node:crypto";
import { canonicalProfileJson, type WebsiteDetails } from "../src/lib/account-websites/contracts.ts";
import type { GeoKbPayload } from "../src/lib/geo-tools/kb-contract.ts";
import type { GeoKbHandlerDependencies, GeoKbView } from "../src/lib/geo-tools/kb-handler.ts";
import { inheritedProfileFromCopy, assertGeoProfileCopyIntegrity } from "../src/lib/geo-tools/kb-profile-copy-server.ts";
import { buildGeoSnapshotContext } from "../src/lib/geo-tools/snapshot-context.ts";
import { buildVisibilityPlan, createVisibilityReportV2 } from "../src/lib/geo-tools/visibility-v2.ts";
import { observeVisibilityV2 } from "../src/lib/geo-tools/visibility-sampling-v2.ts";
import type { VisibilityEngine, VisibilityReportV2 } from "../src/lib/geo-tools/visibility-v2-contract.ts";
import { createGeoChainFixture, GEO_CHAIN_NOW, GEO_CHAIN_RUN, GEO_CHAIN_USER, type GeoChainFixture } from "./geo-chain-fixtures.ts";

export const PROFILE_UPDATE_SNAPSHOT = "44444444-4444-4444-8444-444444444441";
export const PROFILE_UPDATE_FROZEN = "44444444-4444-4444-8444-444444444442";
export function createVisibilityProfileUpdateFixture() {
  const base = createGeoChainFixture("D");
  const sourceProfile = { ...base.website.currentConfirmedSnapshot!.profile, productName: "Acme Insight",
    oneLinePositioning: "Fresh confirmed website positioning", categories: ["business intelligence"],
    coreFeatures: ["Reporting", "Auditable exports"], buyer: "Analytics directors", user: "Business analysts" };
  const reference = { ...base.profile.reference, snapshotId: PROFILE_UPDATE_SNAPSHOT, snapshotRevision: 2,
    profileHash: createHash("sha256").update(canonicalProfileJson(sourceProfile)).digest("hex") };
  const website: WebsiteDetails = { ...base.website, confirmedSnapshotId: reference.snapshotId, confirmedAt: GEO_CHAIN_NOW,
    draft: { ...base.website.draft!, profile: sourceProfile, profileHash: reference.profileHash },
    confirmedSnapshotRevision: 2, currentConfirmedSnapshot: { ...reference, confirmedAt: GEO_CHAIN_NOW, profile: sourceProfile } };
  const profile = { reference, productName: sourceProfile.productName, oneLinePositioning: sourceProfile.oneLinePositioning,
    coreFeatures: sourceProfile.coreFeatures, market: { country: sourceProfile.country, language: sourceProfile.locale }, fullProfile: sourceProfile };
  const oldFrozen = structuredClone(base.frozen), oldContext = structuredClone(base.context);
  const oldBytes = JSON.stringify(oldFrozen);
  let payload: GeoKbPayload = structuredClone(base.payload);
  let draftVersion = 1, frozen = oldFrozen, frozenContext = oldContext;
  let report: VisibilityReportV2 | null = null, providerCalls = 0;
  const savedPayloads: GeoKbPayload[] = [], frozenVersions = [oldFrozen];
  const built = () => buildGeoSnapshotContext({ kbId: frozen.kbId, targetHost: website.host,
    payload, profile: inheritedProfileFromCopy(payload.profileCopy!), receipt: null });
  const preview = () => { const { context } = built(); return { contentHash: context.contentHash,
    questionSetHash: context.questionSetHash, skippedLayers: context.skippedLayers,
    activeRoleIds: context.roles.filter(role => role.source === "gsc").map(role => role.roleId) }; };
  const summary = () => ({ ...frozen, questions: frozen.questionSet.questions,
    retrievalCount: frozen.questionSet.questions.filter(question => question.mode === "retrieval").length,
    skippedLayers: frozenContext.skippedLayers });
  const view = (): GeoKbView => ({ kbId: frozen.kbId, origin: website.origin, host: website.host,
    draftVersion, payload: structuredClone(payload), profile, context: preview(), frozen: summary(), importAvailable: true });
  const owns = (input: { userId: string; kbId: string }) => input.userId === GEO_CHAIN_USER && input.kbId === frozen.kbId;
  const kbDependencies: GeoKbHandlerDependencies = { ...base.kbDependencies,
    loadKnowledgeBase: async input => input.userId === GEO_CHAIN_USER && new URL(input.url).origin === website.origin ? { kind: "ok", value: view() } : { kind: "not_found" },
    saveDraft: async input => {
      if (!owns(input)) return { kind: "not_found" };
      if (input.baseVersion !== draftVersion) return { kind: "conflict", draftVersion };
      if (input.expectedProfileReference?.profileHash !== reference.profileHash || input.payload.profileCopy?.profileHash !== reference.profileHash) return { kind: "context_stale" };
      assertGeoProfileCopyIntegrity(input.payload.profileCopy);
      payload = structuredClone(input.payload); draftVersion += 1; savedPayloads.push(structuredClone(payload));
      return { kind: "ok", value: { draftVersion, updatedAt: GEO_CHAIN_NOW, context: preview() } };
    },
    readDraftPayload: async input => owns(input) ? { kind: "ok", value: { payload, draftVersion, ...built() } } : { kind: "not_found" },
    freeze: async input => {
      if (!owns(input)) return { kind: "not_found" };
      if (input.baseVersion !== draftVersion) return { kind: "conflict", draftVersion };
      const next = built();
      if (input.context?.contentHash !== next.context.contentHash || input.questionSet !== next.questionSet && JSON.stringify(input.questionSet) !== JSON.stringify(next.questionSet)) throw new Error("Freeze used stale context/questions");
      if (payload.profileCopy?.snapshotId !== reference.snapshotId) return { kind: "context_stale" };
      frozenContext = next.context;
      frozen = { ...oldFrozen, snapshotId: PROFILE_UPDATE_FROZEN, revision: 2, frozenAt: GEO_CHAIN_NOW,
        contentHash: next.context.payloadHash, questionSetHash: next.context.questionSetHash,
        questionCount: next.questionSet.questions.length, questionSet: next.questionSet, payload: structuredClone(payload) };
      frozenVersions.push(frozen);
      return { kind: "ok", value: { ...summary(), reusedExisting: false, context: preview() } };
    },
  };
  async function run(engines: readonly VisibilityEngine[], samplesPerQuestion: number) {
    if (frozen.revision !== 2) throw new Error("Update acceptance must run the new frozen version");
    const context = { officialName: frozen.payload.officialName, aliases: frozen.payload.aliases,
      competitors: frozen.payload.competitors, targetHost: website.host,
      marketCode: frozen.payload.market.country, language: frozen.questionSet.language };
    const samples = await Promise.all(buildVisibilityPlan(frozen.questionSet.questions, engines, samplesPerQuestion).map(item => observeVisibilityV2(context, item, { provider: { observe: async () => {
      providerCalls += 1;
      return { answerText: "1. Acme Insight\n2. Rival\n\nAn offline answer about business intelligence.", webSearchPerformed: true,
        citationsComplete: true, citations: [], model: "offline-fixture", modelObserved: "offline-fixture",
        providerTaskId: `update-${item.slotId}`, costUsd: 0, observedAt: GEO_CHAIN_NOW };
    } } })));
    report = createVisibilityReportV2({ runId: GEO_CHAIN_RUN, kbId: frozen.kbId, snapshotId: frozen.snapshotId,
      snapshotRevision: frozen.revision, questionSetHash: frozen.questionSetHash, startedAt: GEO_CHAIN_NOW,
      finishedAt: GEO_CHAIN_NOW, engines, samplesPerQuestion, context, questions: frozen.questionSet.questions, samples });
    return report;
  }
  const fixture: GeoChainFixture = { ...base, website, profile, view, kbDependencies, run,
    get payload() { return payload as typeof base.payload; }, get frozen() { return frozen; },
    get context() { return frozenContext; }, get report() { return report; }, get providerCalls() { return providerCalls; } };
  return { fixture, oldFrozen, oldBytes, sourceProfile, reference, savedPayloads, frozenVersions };
}
