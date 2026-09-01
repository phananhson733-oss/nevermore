// @input -- verified account ids and owner-scoped immutable GEO records
// @output -- validated exact contexts/receipts; unavailable never masquerades as absent
// @pos -- service-role transport boundary for additive GEO source provenance
import { createAdminSupabaseClient } from "../supabase/admin.ts";
import { verifyGeoEnrichmentReport } from "./kb-enrichment.ts";
import type { GeoKbEnrichmentReport } from "./kb-enrichment-contract.ts";
import type { GeoSnapshotContext } from "./snapshot-context.ts";
import { parseAnyGeoSnapshotContext, type AnyGeoSnapshotContext } from "./snapshot-context-v2.ts";

interface ReadOutcome { readonly data: unknown; readonly error: unknown }
export interface GeoContextStoreDependencies {
  readonly readSnapshot: (userId: string, kbId: string, snapshotId: string) => Promise<ReadOutcome>;
  readonly readContext: (userId: string, kbId: string, snapshotId: string) => Promise<ReadOutcome>;
  readonly readReceipt: (userId: string, kbId: string, receiptId?: string) => Promise<ReadOutcome>;
  readonly callRpc: (name: string, params: Record<string, unknown>) => Promise<ReadOutcome>;
}
export type GeoContextRead<T> = { readonly kind: "ok"; readonly value: T } | { readonly kind: "missing" } | { readonly kind: "unavailable" };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
const row = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const owned = (value: Record<string, unknown>, userId: string, kbId: string) => value.user_id === userId && value.kb_id === kbId;

export const DEFAULT_GEO_CONTEXT_STORE_DEPENDENCIES: GeoContextStoreDependencies = {
  readSnapshot: async (userId, kbId, snapshotId) => await createAdminSupabaseClient().from("marketing_geo_kb_snapshots")
    .select("id,user_id,kb_id,content_hash,question_set_hash,context_hash").eq("user_id", userId).eq("kb_id", kbId).eq("id", snapshotId).maybeSingle(),
  readContext: async (userId, kbId, snapshotId) => await createAdminSupabaseClient().from("marketing_geo_snapshot_contexts")
    .select("snapshot_id,user_id,kb_id,content_hash,context").eq("user_id", userId).eq("kb_id", kbId).eq("snapshot_id", snapshotId).maybeSingle(),
  readReceipt: async (userId, kbId, receiptId) => {
    const query = createAdminSupabaseClient().from("marketing_geo_enrichment_receipts")
      .select("id,user_id,kb_id,content_hash,report").eq("user_id", userId).eq("kb_id", kbId);
    return await (receiptId === undefined ? query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1) : query.eq("id", receiptId)).maybeSingle();
  },
  callRpc: async (name, params) => await createAdminSupabaseClient().rpc(name, params),
};

export async function readVersionedGeoSnapshotContext(input: { readonly userId: string; readonly kbId: string; readonly snapshotId: string }, dependencies = DEFAULT_GEO_CONTEXT_STORE_DEPENDENCIES): Promise<GeoContextRead<AnyGeoSnapshotContext | null>> {
  if (![input.userId, input.kbId, input.snapshotId].every((id) => uuid.test(id))) return { kind: "missing" };
  input = { userId: input.userId.toLowerCase(), kbId: input.kbId.toLowerCase(), snapshotId: input.snapshotId.toLowerCase() };
  try {
    const scopeRead = await dependencies.readSnapshot(input.userId, input.kbId, input.snapshotId);
    if (scopeRead.error) return { kind: "unavailable" };
    if (scopeRead.data === null) return { kind: "missing" };
    const scope = row(scopeRead.data);
    if (!scope || !owned(scope, input.userId, input.kbId) || scope.id !== input.snapshotId) return { kind: "unavailable" };
    if (scope.context_hash === null) return { kind: "ok", value: null };
    if (typeof scope.context_hash !== "string") return { kind: "unavailable" };
    const result = await dependencies.readContext(input.userId, input.kbId, input.snapshotId);
    const stored = row(result.data);
    if (result.error || !stored || !owned(stored, input.userId, input.kbId) || stored.snapshot_id !== input.snapshotId) return { kind: "unavailable" };
    const context = parseAnyGeoSnapshotContext(stored.context);
    if (context.kbId !== input.kbId || context.contentHash !== scope.context_hash || context.contentHash !== stored.content_hash || context.payloadHash !== scope.content_hash || context.questionSetHash !== scope.question_set_hash) return { kind: "unavailable" };
    return { kind: "ok", value: context };
  } catch { return { kind: "unavailable" }; }
}

/** The original entrypoint remains explicitly V1 for legacy editor callers. */
export async function readGeoSnapshotContext(input: { readonly userId: string; readonly kbId: string; readonly snapshotId: string }, dependencies = DEFAULT_GEO_CONTEXT_STORE_DEPENDENCIES): Promise<GeoContextRead<GeoSnapshotContext | null>> {
  const result = await readVersionedGeoSnapshotContext(input, dependencies);
  if (result.kind !== "ok") return result;
  return result.value?.schemaVersion === "marketing-geo-snapshot-context.v2" ? { kind: "unavailable" } : { kind: "ok", value: result.value };
}

export async function readLatestGeoEnrichmentReceipt(input: { readonly userId: string; readonly kbId: string; readonly receiptId?: string }, dependencies = DEFAULT_GEO_CONTEXT_STORE_DEPENDENCIES): Promise<GeoContextRead<GeoKbEnrichmentReport | null>> {
  if (![input.userId, input.kbId, ...(input.receiptId !== undefined ? [input.receiptId] : [])].every((id) => uuid.test(id))) return { kind: "missing" };
  input = { userId: input.userId.toLowerCase(), kbId: input.kbId.toLowerCase(), ...(input.receiptId === undefined ? {} : { receiptId: input.receiptId.toLowerCase() }) };
  try {
    const result = await dependencies.readReceipt(input.userId, input.kbId, input.receiptId);
    if (result.error) return { kind: "unavailable" };
    if (result.data === null) return { kind: "ok", value: null };
    const stored = row(result.data);
    if (!stored || !owned(stored, input.userId, input.kbId)) return { kind: "unavailable" };
    const report = verifyGeoEnrichmentReport(stored.report);
    if (report.kbId !== input.kbId || report.receiptId !== stored.id || report.contentHash !== stored.content_hash || (input.receiptId !== undefined && report.receiptId !== input.receiptId)) return { kind: "unavailable" };
    return { kind: "ok", value: report };
  } catch { return { kind: "unavailable" }; }
}

export async function persistGeoEnrichmentReceipt(input: { readonly userId: string; readonly report: GeoKbEnrichmentReport }, dependencies = DEFAULT_GEO_CONTEXT_STORE_DEPENDENCIES): Promise<{ readonly kind: "ok" } | { readonly kind: "unavailable" }> {
  try {
    if (!uuid.test(input.userId)) return { kind: "unavailable" };
    input = { ...input, userId: input.userId.toLowerCase() };
    const report = verifyGeoEnrichmentReport(input.report);
    const result = await dependencies.callRpc("marketing_geo_record_enrichment", { p_user_id: input.userId, p_kb_id: report.kbId, p_receipt_id: report.receiptId, p_report: report });
    const saved = Array.isArray(result.data) && result.data.length === 1 ? row(result.data[0]) : null;
    return !result.error && saved?.outcome === "recorded" ? { kind: "ok" } : { kind: "unavailable" };
  } catch { return { kind: "unavailable" }; }
}
