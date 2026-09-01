// @input -- server-derived context plus the current owned draft and selected questions
// @output -- one atomic snapshot/context result, or a conflict with no partial write
// @pos -- new freeze path, separate from historical v1 payload-only freeze behavior
import { normalizeAccountWebsiteUrl } from "../account-websites/contracts.ts";
import { DEFAULT_GEO_CONTEXT_STORE_DEPENDENCIES } from "./asset-context-store.ts";
import { geoKbBlockers, GEO_KB_SCHEMA_VERSION, type GeoKbPayload } from "./kb-contract.ts";
import { geoQuestionSetDigest, type GeoQuestionSet } from "./kb-questions.ts";
import { readGeoKnowledgeBase, type GeoKbStoreResult, type GeoKbFreezeOutcome } from "./kb-store.ts";
import { parseGeoSnapshotContext, type GeoSnapshotContext } from "./snapshot-context.ts";
import { inheritedProfileFromCopy } from "./kb-profile-copy-server.ts";
import { canonicalGeoEnrichmentText } from "./kb-enrichment.ts";

interface DraftForFreeze { readonly payload: GeoKbPayload; readonly draftVersion: number; readonly contentHash: string; readonly targetHost: string }
interface Dependencies {
  readonly readDraft: (userId: string, kbId: string) => Promise<GeoKbStoreResult<DraftForFreeze>>;
  readonly callRpc: typeof DEFAULT_GEO_CONTEXT_STORE_DEPENDENCIES.callRpc;
}
const DEFAULT: Dependencies = {
  readDraft: async (userId, kbId) => {
    const details = await readGeoKnowledgeBase({ userId, kbId });
    if (details.kind !== "ok") return details;
    if (!details.value.draft) return { kind: "invalid", code: "no_draft" };
    const targetHost = normalizeAccountWebsiteUrl(details.value.origin)?.host;
    return targetHost ? { kind: "ok", value: { ...details.value.draft, targetHost } } : { kind: "invalid", code: "invalid_site" };
  },
  callRpc: DEFAULT_GEO_CONTEXT_STORE_DEPENDENCIES.callRpc,
};
const unavailable = (): GeoKbStoreResult<never> => ({ kind: "unavailable", reason: "GEO snapshot context unavailable" });

export async function freezeGeoKbWithContext(input: {
  readonly userId: string; readonly kbId: string; readonly baseVersion: number;
  readonly context: GeoSnapshotContext; readonly questionSet: GeoQuestionSet;
}, dependencies: Dependencies = DEFAULT): Promise<GeoKbStoreResult<GeoKbFreezeOutcome>> {
  try {
    input = { ...input, userId: input.userId.toLowerCase(), kbId: input.kbId.toLowerCase() };
    const context = parseGeoSnapshotContext(input.context);
    const draft = await dependencies.readDraft(input.userId, input.kbId);
    if (draft.kind !== "ok") return draft;
    if (draft.value.draftVersion !== input.baseVersion) return { kind: "conflict", currentDraftVersion: draft.value.draftVersion };
    if (context.kbId !== input.kbId || context.targetHost !== draft.value.targetHost || context.payloadHash !== draft.value.contentHash) return unavailable();
    if (draft.value.payload.profileCopy && canonicalGeoEnrichmentText(context.profile) !== canonicalGeoEnrichmentText(inheritedProfileFromCopy(draft.value.payload.profileCopy))) return { kind: "invalid", code: "context_stale" };
    const blockers = geoKbBlockers(draft.value.payload, { roleLayersSkipped: context.skippedLayers.length === 2 });
    if (blockers.length) return { kind: "invalid", code: "not_freezable", blockers };
    if (geoQuestionSetDigest(input.questionSet) !== context.questionSetHash) return { kind: "invalid", code: "question_set_stale" };
    const result = await dependencies.callRpc("marketing_geo_freeze_kb_with_context", {
      p_user_id: input.userId, p_kb_id: input.kbId, p_schema_version: GEO_KB_SCHEMA_VERSION, p_base_version: input.baseVersion,
      p_question_set: input.questionSet, p_question_set_hash: context.questionSetHash, p_context: context,
    });
    if (result.error || !Array.isArray(result.data) || result.data.length !== 1) return unavailable();
    const r = result.data[0] as Record<string, unknown>;
    if (r.outcome === "not_found") return { kind: "missing" };
    if (r.outcome === "no_draft") return { kind: "invalid", code: "no_draft" };
    if (r.outcome === "profile_stale" || r.outcome === "profile_copy_mismatch") return { kind: "invalid", code: "context_stale" };
    if (r.outcome === "website_required") return { kind: "invalid", code: "website_required" };
    if (r.outcome === "conflict") return { kind: "conflict", currentDraftVersion: typeof r.revision === "number" ? r.revision : null };
    if (r.outcome !== "frozen" || typeof r.snapshot_id !== "string" || !/^[a-f0-9-]{36}$/iu.test(r.snapshot_id) || typeof r.revision !== "number" || !Number.isSafeInteger(r.revision) || r.revision < 1 || r.content_hash !== context.payloadHash || typeof r.frozen_at !== "string" || !Number.isFinite(Date.parse(r.frozen_at)) || typeof r.reused_existing !== "boolean") return unavailable();
    return { kind: "ok", value: { snapshotId: r.snapshot_id, revision: r.revision, contentHash: r.content_hash, questionSetHash: context.questionSetHash, frozenAt: new Date(r.frozen_at).toISOString(), questionCount: input.questionSet.questions.length, reusedExisting: r.reused_existing } };
  } catch { return unavailable(); }
}
