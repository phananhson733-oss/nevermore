// @input -- server-verified subject and an immutable V2 run id/report
// @output -- owner-scoped exact run evidence, or a typed unavailable outcome
// @pos -- private V2 report persistence; old summary-only v1 rows are untouched
import { createAdminSupabaseClient } from "../supabase/admin.ts";
import { parseVisibilityReportV2 } from "./visibility-export.ts";
import { decodeVisibilityWire, encodeVisibilityWire } from "./visibility-wire.ts";
import type { VisibilityReportV2 } from "./visibility-v2-contract.ts";
import type { VisibilityStoreResult, VisibilityTransportOutcome } from "./visibility-store.ts";

type RunSelector = { readonly userId: string; readonly runId: string };
type PreviousSelector = { readonly userId: string; readonly kbId: string; readonly questionSetHash: string; readonly excludeRunId: string; readonly before: string };
export interface VisibilityStoreV2Dependencies {
  readonly callRpc: (name: string, params: Readonly<Record<string, unknown>>) => Promise<VisibilityTransportOutcome>;
  readonly readRun: (input: RunSelector) => Promise<VisibilityTransportOutcome>;
  readonly readLatest: (input: PreviousSelector) => Promise<VisibilityTransportOutcome>;
}
export interface StoredVisibilityRunV2 {
  readonly runId: string;
  readonly report: VisibilityReportV2;
  readonly createdAt: string;
  readonly provenance: "server_owned";
}
const COLUMNS = "id,user_id,kb_id,snapshot_id,question_set_hash,report,created_at";
function result(data: unknown, error: { readonly code?: string } | null): VisibilityTransportOutcome { return error === null ? { kind: "ok", data } : { kind: "error", code: error.code ?? null }; }
export const DEFAULT_VISIBILITY_V2_STORE: VisibilityStoreV2Dependencies = {
  callRpc: async (name, params) => { const response = await createAdminSupabaseClient().rpc(name, params); return result(response.data, response.error); },
  readRun: async ({ userId, runId }) => { const response = await createAdminSupabaseClient().from("marketing_geo_visibility_runs_v2").select(COLUMNS).eq("user_id", userId).eq("id", runId).maybeSingle(); return result(response.data, response.error); },
  readLatest: async ({ userId, kbId, questionSetHash, excludeRunId, before }) => { const response = await createAdminSupabaseClient().from("marketing_geo_visibility_runs_v2").select(COLUMNS).eq("user_id", userId).eq("kb_id", kbId).eq("question_set_hash", questionSetHash).neq("id", excludeRunId).lt("created_at", before).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle(); return result(response.data, response.error); },
};
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const object = (value: unknown): Record<string, unknown> | null => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
const unavailable = (): VisibilityStoreResult<never> => ({ kind: "unavailable", reason: "store_unavailable" });
function stored(value: unknown, userId: string): StoredVisibilityRunV2 | null {
  const row = object(value);
  if (row === null || row.user_id !== userId || !uuid(row.id) || typeof row.created_at !== "string" || !Number.isFinite(Date.parse(row.created_at))) return null;
  const report = decodeVisibilityWire(row.report) ?? parseVisibilityReportV2(row.report);
  if (report === null || report.manifest.runId !== row.id || report.manifest.kbId !== row.kb_id || report.manifest.snapshotId !== row.snapshot_id || report.manifest.questionSetHash !== row.question_set_hash) return null;
  return { runId: row.id, report, createdAt: new Date(row.created_at).toISOString(), provenance: "server_owned" };
}
export async function recordVisibilityRunV2(input: { readonly userId: string; readonly report: VisibilityReportV2 }, dependencies: VisibilityStoreV2Dependencies = DEFAULT_VISIBILITY_V2_STORE): Promise<VisibilityStoreResult<{ readonly runId: string; readonly createdAt: string }>> {
  if (!uuid(input.userId) || parseVisibilityReportV2(input.report) === null) return { kind: "invalid", code: "invalid_manifest" };
  try {
    const manifest = input.report.manifest;
    const outcome = await dependencies.callRpc("marketing_geo_record_visibility_run_v2", { p_run_id: manifest.runId, p_user_id: input.userId, p_kb_id: manifest.kbId, p_snapshot_id: manifest.snapshotId, p_question_set_hash: manifest.questionSetHash, p_report: encodeVisibilityWire(input.report) });
    if (outcome.kind !== "ok") return unavailable();
    const row = object(Array.isArray(outcome.data) && outcome.data.length === 1 ? outcome.data[0] : outcome.data);
    if (row?.outcome === "not_found") return { kind: "missing" };
    if (row?.outcome === "question_set_mismatch") return { kind: "invalid", code: "question_set_mismatch" };
    if (row?.outcome === "run_conflict") return { kind: "invalid", code: "invalid_run_id" };
    if (row?.outcome !== "recorded" || row.run_id !== manifest.runId || typeof row.recorded_at !== "string" || !Number.isFinite(Date.parse(row.recorded_at))) return unavailable();
    return { kind: "ok", value: { runId: row.run_id, createdAt: new Date(row.recorded_at).toISOString() } };
  } catch { return unavailable(); }
}
export async function readVisibilityRunV2(input: RunSelector, dependencies: VisibilityStoreV2Dependencies = DEFAULT_VISIBILITY_V2_STORE): Promise<VisibilityStoreResult<StoredVisibilityRunV2>> {
  if (!uuid(input.userId) || !uuid(input.runId)) return { kind: "invalid", code: "invalid_run_id" };
  try {
    const outcome = await dependencies.readRun(input);
    if (outcome.kind !== "ok") return unavailable();
    if (outcome.data === null) return { kind: "missing" };
    const value = stored(outcome.data, input.userId);
    return value !== null && value.runId === input.runId ? { kind: "ok", value } : unavailable();
  } catch { return unavailable(); }
}
export async function readPreviousVisibilityRunV2(input: PreviousSelector, dependencies: VisibilityStoreV2Dependencies = DEFAULT_VISIBILITY_V2_STORE): Promise<VisibilityStoreResult<StoredVisibilityRunV2>> {
  if (!uuid(input.userId) || !uuid(input.kbId) || !uuid(input.excludeRunId) || !/^[a-f0-9]{64}$/.test(input.questionSetHash) || !Number.isFinite(Date.parse(input.before))) return { kind: "invalid", code: "invalid_manifest" };
  try {
    const outcome = await dependencies.readLatest(input);
    if (outcome.kind !== "ok") return unavailable();
    if (outcome.data === null) return { kind: "missing" };
    const value = stored(outcome.data, input.userId);
    return value !== null && value.report.manifest.kbId === input.kbId && value.report.manifest.questionSetHash === input.questionSetHash && value.runId !== input.excludeRunId && Date.parse(value.createdAt) < Date.parse(input.before) ? { kind: "ok", value } : unavailable();
  } catch { return unavailable(); }
}
