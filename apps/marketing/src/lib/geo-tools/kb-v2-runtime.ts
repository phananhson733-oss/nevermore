// @input -- verified Marketing auth and the existing owner-scoped GEO/Profile stores
// @output -- real v2 route dependencies and complete editor loading
// @pos -- runtime wiring only; no config reads or network work during import
import { getServerAuthenticatedUser } from "../auth/server-auth-user.ts";
import { findAccountWebsiteByUrl, readAccountWebsite } from "../account-websites/store.ts";
import { ensureGeoKnowledgeBase } from "./kb-store.ts";
import { readVersionedGeoKnowledgeBase } from "./kb-versioned-read.ts";
import { readCompleteGeoKnowledgeBase } from "./kb-complete-read.ts";
import { readGeoSourceReceiptV2, persistGeoSourceReceiptV2, saveGeoKbDraftV2, DEFAULT_GEO_KB_PREPARED_STORE } from "./kb-prepared-store.ts";
import { DEFAULT_GEO_KB_GENERATION_STORE, type GeoKbGenerationStore } from "./kb-generation-store.ts";
import { DEFAULT_GEO_KB_ENRICHMENT_DEPENDENCIES } from "./kb-enrichment-deps.ts";
import { resolveGeoBriefLlmConfig } from "./brief-llm.ts";
import { consumePublicToolQuota } from "../tools/shared-rate-limit.ts";
import type { GeoKbSourceDependencies } from "./kb-source-handler.ts";
import type { GeoKbGenerationHandlerDependencies } from "./kb-generation-handler.ts";
import type { GeoKbPreparedHandlerDependencies } from "./kb-prepared-handler.ts";
import type { GeoKbV2DraftDependencies, GeoKbV2LoadDependencies } from "./kb-v2-draft-handler.ts";
import { createGeoKbEditorLoader, type GeoKbEditorLoaderDependencies } from "./kb-editor-loader.ts";
import { createGeoKbGenerationPreparer, validateGeoKbDraftLineage, type GeoKbGenerationPreparerDependencies } from "./kb-generation-preparer.ts";
import { normalizeAccountWebsiteUrl } from "../account-websites/contracts.ts";
import { profileCopyReference } from "./kb-profile-copy.ts";
import { assertGeoProfileCopyIntegrity } from "./kb-profile-copy-server.ts";
import { canonicalGeoV2Text } from "./kb-v2-json.ts";
import { parseGeoKbFrozenV2Wire } from "../../components/tools/geo-kb-v2-wire.ts";
import { geoGenerationLanguage } from "@sf/public-tools/content-brief/geo-contract";

export interface GeoKbV2RuntimeDependencies {
  readonly authenticate: typeof getServerAuthenticatedUser;
  readonly ensure: typeof ensureGeoKnowledgeBase;
  readonly readDetails: typeof readVersionedGeoKnowledgeBase;
  readonly readProfile: typeof findAccountWebsiteByUrl;
  readonly readWebsite: typeof readAccountWebsite;
  readonly readComplete: typeof readCompleteGeoKnowledgeBase;
  readonly readSource: typeof readGeoSourceReceiptV2;
  readonly persistSource: typeof persistGeoSourceReceiptV2;
  readonly generationStore: GeoKbGenerationStore;
  readonly preparedStore: typeof DEFAULT_GEO_KB_PREPARED_STORE;
  readonly saveDraft: typeof saveGeoKbDraftV2;
  readonly sourceTransports: typeof DEFAULT_GEO_KB_ENRICHMENT_DEPENDENCIES;
  readonly resolveConfig: typeof resolveGeoBriefLlmConfig;
  readonly quota: typeof consumePublicToolQuota;
  readonly validateLineage?: GeoKbV2DraftDependencies["validateLineage"];
}
export interface GeoKbV2Runtime {
  readonly loadEditor: GeoKbV2LoadDependencies["loadEditor"];
  readonly load: GeoKbV2LoadDependencies;
  readonly draft: GeoKbV2DraftDependencies;
  readonly sources: GeoKbSourceDependencies;
  readonly generation: GeoKbGenerationHandlerDependencies;
  readonly prepared: GeoKbPreparedHandlerDependencies;
}
const DEFAULT: GeoKbV2RuntimeDependencies = {
  authenticate: getServerAuthenticatedUser, ensure: ensureGeoKnowledgeBase, readDetails: readVersionedGeoKnowledgeBase,
  readProfile: findAccountWebsiteByUrl, readWebsite: readAccountWebsite, readComplete: readCompleteGeoKnowledgeBase,
  readSource: readGeoSourceReceiptV2, persistSource: persistGeoSourceReceiptV2, generationStore: DEFAULT_GEO_KB_GENERATION_STORE,
  preparedStore: DEFAULT_GEO_KB_PREPARED_STORE, saveDraft: saveGeoKbDraftV2, sourceTransports: DEFAULT_GEO_KB_ENRICHMENT_DEPENDENCIES,
  resolveConfig: resolveGeoBriefLlmConfig, quota: consumePublicToolQuota,
};

export function createGeoKbV2Runtime(overrides: Partial<GeoKbV2RuntimeDependencies> = {}): GeoKbV2Runtime {
  const dependencies = { ...DEFAULT, ...overrides };
  const same = (a: unknown, b: unknown) => canonicalGeoV2Text(a) === canonicalGeoV2Text(b);
  const validateCurrentCopy: GeoKbV2DraftDependencies["validateCurrentCopy"] = async input => {
    try { assertGeoProfileCopyIntegrity(input.copy); } catch { return "stale"; }
    const reference = profileCopyReference(input.copy);
    if (input.expectedProfileReference !== undefined && !same(reference, input.expectedProfileReference)) return "stale";
    try {
      const read = await dependencies.readWebsite(input.userId, input.copy.websiteId);
      if (read.kind === "unavailable") return "unavailable";
      if (read.kind !== "ok" || read.value.websiteId !== input.copy.websiteId) return "stale";
      const website = read.value, snapshot = website.currentConfirmedSnapshot;
      if (input.origin !== undefined && normalizeAccountWebsiteUrl(input.origin)?.canonicalSiteKey !== website.canonicalSiteKey) return "stale";
      if (snapshot === null || snapshot.websiteId !== input.copy.websiteId || snapshot.snapshotId !== input.copy.snapshotId
        || String(snapshot.snapshotRevision) !== input.copy.snapshotRevision || snapshot.profileHash !== input.copy.profileHash
        || snapshot.profileSchemaVersion !== input.copy.profile.schemaVersion || !same(snapshot.profile, input.copy.profile)) return "stale";
      return "current";
    } catch { return "unavailable"; }
  };
  const readReceipt: GeoKbGenerationPreparerDependencies["readReceipt"] = async input => {
    const result = await dependencies.readSource(input);
    return result.kind !== "ok" ? { kind: "unavailable" } : result.value === null ? { kind: "missing" } : { kind: "ok", value: result.value };
  };
  const readGeneration: GeoKbGenerationHandlerDependencies["store"]["read"] = async input => {
    const result = await dependencies.generationStore.read(input);
    return result.kind !== "ok" ? { kind: "unavailable" } : result.generation === null ? { kind: "missing" } : { kind: "ok", generation: result.generation };
  };
  const readByKey: GeoKbGenerationHandlerDependencies["store"]["readByKey"] = async input => {
    const result = await dependencies.generationStore.readByKey(input);
    return result.kind !== "ok" ? { kind: "unavailable" } : result.generation === null ? { kind: "missing" } : { kind: "ok", generation: result.generation };
  };
  const readFrozen: GeoKbEditorLoaderDependencies["readFrozen"] = async input => {
    const result = await dependencies.readComplete(input);
    if (result.kind !== "ok") return { kind: "unavailable" };
    const { snapshot, context } = result.value;
    if (snapshot.payload.schemaVersion === "marketing-geo-kb.v2") {
      if (snapshot.questionSet.schemaVersion !== "marketing-geo-question-set.v2" || context?.schemaVersion !== "marketing-geo-snapshot-context.v2") return { kind: "unavailable" };
      const value = parseGeoKbFrozenV2Wire({ ...snapshot, context });
      return value === null ? { kind: "unavailable" } : { kind: "ok", value };
    }
    if (snapshot.questionSet.schemaVersion !== "marketing-geo-question-set.v1" || (context !== null && context.schemaVersion !== "marketing-geo-snapshot-context.v1")) return { kind: "unavailable" };
    return { kind: "ok", value: { snapshotId: snapshot.snapshotId, revision: snapshot.revision, frozenAt: snapshot.frozenAt,
      contentHash: snapshot.contentHash, questionSetHash: snapshot.questionSetHash, questionCount: snapshot.questionCount,
      retrievalCount: snapshot.questionSet.questions.filter(question => question.mode === "retrieval").length,
      payload: snapshot.payload, questions: snapshot.questionSet.questions, registryVersion: snapshot.questionSet.registryVersion,
      ...(context === null ? {} : { skippedLayers: context.skippedLayers }),
    } };
  };
  const loadEditor = createGeoKbEditorLoader({ ensure: dependencies.ensure, readDetails: dependencies.readDetails,
    readProfile: async (userId, url) => {
      const read = await dependencies.readProfile(userId, url);
      return read.kind === "ok" ? read : read.kind === "missing" || read.kind === "invalid" ? { kind: read.kind } : { kind: "unavailable" };
    },
    readFrozen, readSource: dependencies.readSource, readPrepared: dependencies.preparedStore.readLatest, readGeneration: dependencies.generationStore.readLatest,
  });
  const prepare = createGeoKbGenerationPreparer({
    readDetails: async input => {
      const read = await dependencies.readDetails(input);
      return read.kind === "ok" ? read : read.kind === "missing" ? { kind: "missing" } : { kind: "unavailable" };
    },
    validateCurrentProfileCopy: validateCurrentCopy, readReceipt, readGeneration, resolveConfig: dependencies.resolveConfig,
  });
  const consumeQuota: GeoKbGenerationHandlerDependencies["consumeQuota"] = async (userId, kbId, kind) => {
    for (const [bucket, limit] of [[`geo-kb-v2:${kind}:owner:${userId}`, 10], [`geo-kb-v2:${kind}:kb:${kbId}`, 4]] as const) {
      const result = await dependencies.quota(bucket, limit, 3600).catch(() => ({ kind: "unavailable" as const }));
      if (result.kind !== "allowed") return result.kind === "limited" ? "limited" : "unavailable";
    }
    return "allowed";
  };
  const sources: GeoKbSourceDependencies = { ...dependencies.sourceTransports, authenticate: dependencies.authenticate,
    readAsset: async input => {
      const read = await dependencies.readDetails(input);
      if (read.kind !== "ok") return { kind: read.kind === "missing" ? "missing" : "unavailable" };
      if (read.value.kbId !== input.kbId) return { kind: "unavailable" };
      const draft = read.value.draft;
      if (draft === null) return { kind: "no_draft" };
      const site = normalizeAccountWebsiteUrl(read.value.origin);
      if (site === null || normalizeAccountWebsiteUrl(draft.payload.targetUrl)?.host !== site.host) return { kind: "unavailable" };
      return { kind: "ok", value: { kbId: input.kbId, targetHost: site.host, draftVersion: draft.draftVersion, payload: draft.payload,
        profileReference: draft.payload.profileCopy === undefined ? null : profileCopyReference(draft.payload.profileCopy) } };
    }, persistReceipt: dependencies.persistSource,
  };
  const prepared: GeoKbPreparedHandlerDependencies = { authenticate: dependencies.authenticate,
    read: async input => {
      const read = input.candidateId === undefined ? await dependencies.preparedStore.readLatest({ userId: input.userId, kbId: input.kbId }) : await dependencies.preparedStore.read({ userId: input.userId, kbId: input.kbId, candidateId: input.candidateId });
      return read.kind !== "ok" ? { kind: "unavailable" } : read.value === null ? { kind: "missing" } : { kind: "ok", candidate: read.value };
    },
    freeze: async input => {
      const result = await dependencies.preparedStore.freeze(input);
      return result.kind === "ok" ? result : result.kind === "missing" ? { kind: "missing" } : result.kind === "invalid" && result.code === "context_stale" ? { kind: "stale" } : { kind: "unavailable" };
    },
  };
  return { loadEditor, load: { authenticate: dependencies.authenticate, loadEditor },
    draft: { authenticate: dependencies.authenticate, readDetails: dependencies.readDetails, validateCurrentCopy,
      validateLineage: dependencies.validateLineage ?? (input => validateGeoKbDraftLineage({ userId: input.userId, kbId: input.kbId, payload: input.payload, ...(input.previousPayload === null ? {} : { previousPayload: input.previousPayload }) }, { readReceipt, readGeneration })),
      saveDraft: dependencies.saveDraft,
      blockers: payload => [
        ...(geoGenerationLanguage(payload.market.language) === null ? ["unsupported_language"] : []),
        ...(payload.roles.some(role => role.review === "pending") ? ["roles_pending"] : []),
        ...(payload.facts.some(fact => fact.review === "pending") ? ["facts_pending"] : []),
      ],
    },
    sources, generation: { authenticate: dependencies.authenticate, prepare, consumeQuota, store: { ...dependencies.generationStore, read: readGeneration, readByKey } }, prepared,
  };
}
export const DEFAULT_GEO_KB_V2_RUNTIME = createGeoKbV2Runtime();
export const loadGeoKbEditorV2 = DEFAULT_GEO_KB_V2_RUNTIME.loadEditor;
