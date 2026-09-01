// @input -- exact owner/candidate identifiers and validated complete v2 writes
// @output -- immutable candidate reads/freezes plus versioned source receipt persistence
// @pos -- service transport only; no latest-source generation during freeze
import { z } from "zod";
import { createAdminSupabaseClient } from "../supabase/admin.ts";
import { normalizeAccountWebsiteUrl } from "../account-websites/contracts.ts";
import { parseGeoPreparedCandidate, type GeoPreparedCandidateV1 } from "./kb-prepared-contract.ts";
import { DEFAULT_GEO_KB_RPC_TRANSPORT, type GeoKbRpcTransport } from "./kb-generation-store.ts";
import { parseGeoKbPayloadV2 } from "./kb-v2-contract.ts";
import { assertGeoProfileCopyIntegrity } from "./kb-profile-copy-server.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { readVersionedGeoKnowledgeBase } from "./kb-versioned-read.ts";
import type { GeoKbDraftSummary, GeoKbFreezeOutcome, GeoKbStoreResult } from "./kb-store.ts";
import { verifyGeoKbSourceReportV2 } from "./kb-sources.ts";
import type { GeoKbSourceReportV2 } from "./kb-source-contract.ts";

export interface GeoKbPreparedTransport extends GeoKbRpcTransport {
  readonly readCandidate: (input: { readonly userId: string; readonly kbId: string; readonly candidateId?: string }) => Promise<{ readonly data: unknown; readonly error: unknown }>;
}
const DEFAULT: GeoKbPreparedTransport = {
  ...DEFAULT_GEO_KB_RPC_TRANSPORT,
  readCandidate: async input => {
    const query = createAdminSupabaseClient().from("marketing_geo_kb_prepared_candidates").select("id,user_id,kb_id,candidate_hash,candidate")
      .eq("user_id", input.userId).eq("kb_id", input.kbId);
    return await (input.candidateId === undefined ? query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1) : query.eq("id", input.candidateId)).maybeSingle();
  },
};
const uuid = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const unavailable = (): GeoKbStoreResult<never> => ({ kind: "unavailable", reason: "prepared_store_unavailable" });
const rpcRow = (value: unknown): Record<string, unknown> => {
  if (!Array.isArray(value) || value.length !== 1 || value[0] === null || typeof value[0] !== "object") throw new Error("Invalid prepared RPC response");
  return value[0] as Record<string, unknown>;
};
export function createGeoKbPreparedStore(transport: GeoKbPreparedTransport = DEFAULT) {
  const read = async (input: { readonly userId: string; readonly kbId: string; readonly candidateId?: string }): Promise<GeoKbStoreResult<GeoPreparedCandidateV1 | null>> => {
    try {
      uuid.parse(input.userId); uuid.parse(input.kbId); if (input.candidateId !== undefined) uuid.parse(input.candidateId);
      const result = await transport.readCandidate(input);
      if (result.error) return unavailable();
      if (result.data === null) return { kind: "ok", value: null };
      const row = z.object({ id: uuid, user_id: uuid, kb_id: uuid, candidate_hash: hash, candidate: z.unknown() }).parse(result.data);
      if (row.user_id !== input.userId || row.kb_id !== input.kbId || (input.candidateId !== undefined && row.id !== input.candidateId)) return unavailable();
      const candidate = parseGeoPreparedCandidate(row.candidate);
      if (candidate.candidateId !== row.id || candidate.kbId !== row.kb_id || candidate.candidateHash !== row.candidate_hash) return unavailable();
      return { kind: "ok", value: candidate };
    } catch { return unavailable(); }
  };
  return {
    read: async (input: { readonly userId: string; readonly kbId: string; readonly candidateId: string }) => input.candidateId === undefined ? unavailable() : read(input),
    readLatest: (input: { readonly userId: string; readonly kbId: string }) => read({ userId: input.userId, kbId: input.kbId }),
    freeze: async (input: { readonly userId: string; readonly kbId: string; readonly candidateId: string; readonly candidateHash: string }): Promise<GeoKbStoreResult<GeoKbFreezeOutcome>> => {
      try {
        const loaded = await read(input);
        if (loaded.kind !== "ok") return loaded;
        if (loaded.value === null) return { kind: "missing" };
        const candidate = loaded.value;
        if (candidate.candidateHash !== hash.parse(input.candidateHash)) return { kind: "invalid", code: "context_stale" };
        const result = await transport.callRpc("marketing_geo_freeze_prepared_kb", { p_user_id: input.userId, p_kb_id: input.kbId, p_candidate_id: input.candidateId, p_candidate_hash: input.candidateHash });
        if (result.error) return unavailable();
        const row = rpcRow(result.data);
        if (row.outcome === "not_found") return { kind: "missing" };
        if (row.outcome === "input_stale" || row.outcome === "candidate_mismatch") return { kind: "invalid", code: "context_stale" };
        if (row.outcome !== "frozen" || row.content_hash !== candidate.baseDraftHash) return unavailable();
        const response = z.object({ snapshot_id: uuid, revision: z.number().int().positive().refine(Number.isSafeInteger), frozen_at: z.string().refine(value => Number.isFinite(Date.parse(value))), reused_existing: z.boolean() }).parse(row);
        return { kind: "ok", value: { snapshotId: response.snapshot_id, revision: response.revision, frozenAt: new Date(response.frozen_at).toISOString(), reusedExisting: response.reused_existing, contentHash: candidate.baseDraftHash, questionSetHash: candidate.context.questionSetHash, questionCount: candidate.questionSet.questions.length } };
      } catch { return unavailable(); }
    },
  };
}
export const DEFAULT_GEO_KB_PREPARED_STORE = createGeoKbPreparedStore();
export const readLatestGeoKbPreparation = DEFAULT_GEO_KB_PREPARED_STORE.readLatest;

export async function saveGeoKbDraftV2(input: { readonly userId: string; readonly kbId: string; readonly payload: unknown; readonly baseVersion: number }, dependencies = { readKnowledgeBase: readVersionedGeoKnowledgeBase, callRpc: DEFAULT_GEO_KB_RPC_TRANSPORT.callRpc }): Promise<GeoKbStoreResult<GeoKbDraftSummary>> {
  let payload: ReturnType<typeof parseGeoKbPayloadV2>;
  try {
    uuid.parse(input.userId); uuid.parse(input.kbId);
    z.number().int().nonnegative().refine(Number.isSafeInteger).parse(input.baseVersion);
    payload = parseGeoKbPayloadV2(input.payload);
    assertGeoProfileCopyIntegrity(payload.profileCopy);
  } catch { return { kind: "invalid", code: "invalid_payload" }; }
  try {
    const owned = await dependencies.readKnowledgeBase({ userId: input.userId, kbId: input.kbId });
    if (owned.kind !== "ok") return owned;
    if (normalizeAccountWebsiteUrl(payload.targetUrl)?.canonicalSiteKey !== owned.value.canonicalSiteKey) return { kind: "invalid", code: "invalid_site" };
    const contentHash = geoV2Digest(payload);
    const result = await dependencies.callRpc("marketing_geo_save_kb_draft", { p_user_id: input.userId, p_kb_id: input.kbId, p_schema_version: payload.schemaVersion, p_payload: payload, p_content_hash: contentHash, p_base_version: input.baseVersion });
    if (result.error) return unavailable();
    const row = rpcRow(result.data);
    if (row.outcome === "not_found") return { kind: "missing" };
    if (row.outcome === "profile_stale" || row.outcome === "profile_copy_mismatch") return { kind: "invalid", code: "context_stale" };
    if (row.outcome === "conflict") return { kind: "conflict", currentDraftVersion: typeof row.draft_version === "number" && Number.isSafeInteger(row.draft_version) ? row.draft_version : null };
    if (row.outcome !== "saved" || row.content_hash !== contentHash) return unavailable();
    const saved = z.object({ draft_version: z.number().int().positive().refine(Number.isSafeInteger), updated_at: z.string().refine(value => Number.isFinite(Date.parse(value))) }).parse(row);
    return { kind: "ok", value: { draftVersion: saved.draft_version, contentHash, updatedAt: new Date(saved.updated_at).toISOString() } };
  } catch { return unavailable(); }
}

export async function persistGeoSourceReceiptV2(input: { readonly userId: string; readonly report: GeoKbSourceReportV2 }, transport = DEFAULT_GEO_KB_RPC_TRANSPORT): Promise<{ readonly kind: "ok" | "unavailable" }> {
  try {
    uuid.parse(input.userId);
    const report = verifyGeoKbSourceReportV2(input.report);
    const result = await transport.callRpc("marketing_geo_record_enrichment", { p_user_id: input.userId, p_kb_id: report.kbId, p_receipt_id: report.receiptId, p_report: report });
    return !result.error && rpcRow(result.data).outcome === "recorded" ? { kind: "ok" } : { kind: "unavailable" };
  } catch { return { kind: "unavailable" }; }
}
export async function readGeoSourceReceiptV2(input: { readonly userId: string; readonly kbId: string; readonly receiptId?: string }, readRow: (scope: { readonly userId: string; readonly kbId: string; readonly receiptId?: string }) => Promise<{ readonly data: unknown; readonly error: unknown }> = async (scope) => {
  const query = createAdminSupabaseClient().from("marketing_geo_enrichment_receipts").select("id,user_id,kb_id,content_hash,report")
    .eq("user_id", scope.userId).eq("kb_id", scope.kbId).eq("report->>schemaVersion", "marketing-geo-kb-enrichment.v2");
  return await (scope.receiptId === undefined ? query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1) : query.eq("id", scope.receiptId)).maybeSingle();
}): Promise<GeoKbStoreResult<GeoKbSourceReportV2 | null>> {
  try {
    uuid.parse(input.userId); uuid.parse(input.kbId); if (input.receiptId !== undefined) uuid.parse(input.receiptId);
    const result = await readRow(input);
    if (result.error) return unavailable();
    if (result.data === null) return { kind: "ok", value: null };
    const row = z.object({ id: uuid, user_id: uuid, kb_id: uuid, content_hash: hash, report: z.unknown() }).parse(result.data);
    if (row.user_id !== input.userId || row.kb_id !== input.kbId || (input.receiptId !== undefined && row.id !== input.receiptId)) return unavailable();
    const report = verifyGeoKbSourceReportV2(row.report);
    if (report.receiptId !== row.id || report.kbId !== row.kb_id || report.contentHash !== row.content_hash) return unavailable();
    return { kind: "ok", value: report };
  } catch { return unavailable(); }
}
