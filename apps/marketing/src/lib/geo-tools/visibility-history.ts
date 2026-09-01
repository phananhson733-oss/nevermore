// @input -- a server-verified account and bounded persisted visibility rows
// @output -- latest owned history and exact historical evidence, without starting a run
// @pos -- read-only bridge across summary-only V1 and complete V2 persistence
import { z } from "zod";
import { createAdminSupabaseClient } from "../supabase/admin.ts";
import { normalizeGeoHost } from "../agents/geo-url.ts";
import { DEFAULT_VISIBILITY_STORE_DEPENDENCIES, readPreviousVisibilityRun, type VisibilityStoreResult, type VisibilityTransportOutcome } from "./visibility-store.ts";
import { DEFAULT_VISIBILITY_V2_STORE, readVisibilityRunV2 } from "./visibility-store-v2.ts";
import { encodeVisibilityWire } from "./visibility-wire.ts";
import { VISIBILITY_HISTORY_LIMIT, type VisibilityHistoryEntry, type VisibilityHistoryList, type VisibilityHistoryRead } from "./visibility-history-contract.ts";
import type { VisibilityEngine } from "./visibility-v2-contract.ts";

export { VISIBILITY_HISTORY_LIMIT } from "./visibility-history-contract.ts";
type Version = "v1" | "v2";
interface ListSelector { readonly userId: string; readonly version: Version; readonly limit: number }
interface ReadSelector { readonly userId: string; readonly version: Version; readonly runId: string }
export interface VisibilityHistoryDependencies {
  readonly listRuns: (input: ListSelector) => Promise<VisibilityTransportOutcome>;
  readonly readRun: (input: ReadSelector) => Promise<VisibilityTransportOutcome>;
}
const TABLES = { v1: "marketing_geo_visibility_runs", v2: "marketing_geo_visibility_runs_v2" } as const;
const ID_COLUMNS = "id,user_id,kb_id,snapshot_id,question_set_hash,created_at";
const LIST_COLUMNS = { v1: `${ID_COLUMNS},manifest`, v2: `${ID_COLUMNS},manifest:report->manifest,context:report->context` } as const;
const READ_COLUMNS = { v1: `${ID_COLUMNS},samples_per_question,manifest,metrics,per_question,cited_domains`, v2: `${ID_COLUMNS},report` } as const;
function transport(data: unknown, error: { readonly code?: string } | null): VisibilityTransportOutcome {
  return error === null ? { kind: "ok", data } : { kind: "error", code: error.code ?? null };
}
export const DEFAULT_VISIBILITY_HISTORY_DEPENDENCIES: VisibilityHistoryDependencies = {
  listRuns: async ({ userId, version, limit }) => {
    const result = await createAdminSupabaseClient().from(TABLES[version]).select(LIST_COLUMNS[version]).eq("user_id", userId)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit);
    return transport(result.data, result.error);
  },
  readRun: async ({ userId, version, runId }) => {
    const result = await createAdminSupabaseClient().from(TABLES[version]).select(READ_COLUMNS[version]).eq("user_id", userId).eq("id", runId).maybeSingle();
    return transport(result.data, result.error);
  },
};
const uuid = z.string().uuid();
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const instant = z.string().max(40).refine((value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)));
const manifestSchema = z.object({
  schemaVersion: z.enum(["marketing-geo-visibility.v1", "marketing-geo-visibility.v2"]),
  kbId: uuid, snapshotId: uuid, snapshotRevision: count, questionSetHash: z.string().regex(/^[a-f0-9]{64}$/),
  questionCount: count, samplesPerQuestion: count.positive(), finishedAt: instant,
  status: z.enum(["ok", "partial", "insufficient"]), costUsd: z.number().finite().nonnegative().nullable(),
  runId: uuid.optional(), engines: z.array(z.object({ engine: z.enum(["chatgpt", "perplexity"]) })).min(1).max(2).optional(),
  surface: z.string().max(200).optional(),
});
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const unavailable = (): VisibilityStoreResult<never> => ({ kind: "unavailable", reason: "store_unavailable" });
const owns = (row: Record<string, unknown>, userId: string) => typeof row.user_id === "string" && row.user_id.toLowerCase() === userId;
function orderTimestamp(value: string): string {
  // Date normalizes the timezone, but its milliseconds must not drop the
  // database's microseconds when merging the two independently sorted tables.
  return `${new Date(value).toISOString().slice(0, 19)}.${(/\.(\d{1,6})/.exec(value)?.[1] ?? "").padEnd(6, "0")}`;
}

function summary(value: unknown, userId: string, version: Version): VisibilityHistoryEntry | null {
  const row = object(value);
  // Inspect ownership before any potentially private manifest/context content.
  if (row === null || !owns(row, userId) || !uuid.safeParse(row.id).success || !instant.safeParse(row.created_at).success) return null;
  if (new TextEncoder().encode(JSON.stringify(row.manifest)).length > 8192) return null;
  const parsed = manifestSchema.safeParse(row.manifest);
  if (!parsed.success) return null;
  const manifest = parsed.data;
  if (manifest.schemaVersion !== `marketing-geo-visibility.${version}` || manifest.kbId !== row.kb_id || manifest.snapshotId !== row.snapshot_id || manifest.questionSetHash !== row.question_set_hash) return null;
  let host: string | null = null;
  let engines: readonly VisibilityEngine[] = [];
  if (version === "v2") {
    if (manifest.runId !== row.id || manifest.engines === undefined) return null;
    engines = manifest.engines.map((engine) => engine.engine);
    if (new Set(engines).size !== engines.length) return null;
    const context = object(row.context);
    if (typeof context?.targetHost !== "string" || context.targetHost.length > 253 || normalizeGeoHost(context.targetHost) !== context.targetHost) return null;
    host = context.targetHost;
  } else if (manifest.surface === "dataforseo_chat_gpt_llm_responses_api") engines = ["chatgpt"];
  return { runId: row.id as string, schemaVersion: manifest.schemaVersion, kbId: manifest.kbId, snapshotId: manifest.snapshotId, snapshotRevision: manifest.snapshotRevision,
    host, finishedAt: manifest.finishedAt, createdAt: row.created_at as string, status: manifest.status, questionCount: manifest.questionCount,
    samplesPerQuestion: manifest.samplesPerQuestion, engines, costUsd: manifest.costUsd, evidenceAvailability: version === "v1" ? "summary_only" : "recorded" };
}

export async function listVisibilityHistory(input: { readonly userId: string }, dependencies: VisibilityHistoryDependencies = DEFAULT_VISIBILITY_HISTORY_DEPENDENCIES): Promise<VisibilityStoreResult<VisibilityHistoryList>> {
  if (!uuid.safeParse(input.userId).success) return { kind: "invalid", code: "invalid_run_id" };
  const userId = input.userId.toLowerCase();
  try {
    const versions = ["v1", "v2"] as const;
    const pages = await Promise.all(versions.map((version) => dependencies.listRuns({ userId, version, limit: VISIBILITY_HISTORY_LIMIT + 1 })));
    const runs: VisibilityHistoryEntry[] = [];
    const seen = new Set<string>();
    for (const [index, page] of pages.entries()) {
      if (page.kind !== "ok" || !Array.isArray(page.data) || page.data.length > VISIBILITY_HISTORY_LIMIT + 1) return unavailable();
      for (const row of page.data) {
        const entry = summary(row, userId, versions[index]!);
        if (entry === null || seen.has(entry.runId)) return unavailable();
        seen.add(entry.runId); runs.push(entry);
      }
    }
    runs.sort((a, b) => orderTimestamp(b.createdAt).localeCompare(orderTimestamp(a.createdAt)) || b.runId.localeCompare(a.runId));
    return { kind: "ok", value: { runs: runs.slice(0, VISIBILITY_HISTORY_LIMIT), hasMore: runs.length > VISIBILITY_HISTORY_LIMIT } };
  } catch { return unavailable(); }
}

export async function readVisibilityHistory(input: { readonly userId: string; readonly runId: string }, dependencies: VisibilityHistoryDependencies = DEFAULT_VISIBILITY_HISTORY_DEPENDENCIES): Promise<VisibilityStoreResult<VisibilityHistoryRead>> {
  if (!uuid.safeParse(input.userId).success || !uuid.safeParse(input.runId).success) return { kind: "invalid", code: "invalid_run_id" };
  const userId = input.userId.toLowerCase(), runId = input.runId.toLowerCase();
  try {
    for (const version of ["v2", "v1"] as const) {
      const result = await dependencies.readRun({ userId, runId, version });
      if (result.kind !== "ok") return unavailable();
      if (result.data === null) continue;
      const row = object(result.data);
      if (row === null) return unavailable();
      if (!owns(row, userId)) return { kind: "missing" };
      if (row.id !== runId) return unavailable();
      if (version === "v2") {
        const read = await readVisibilityRunV2({ userId, runId }, { ...DEFAULT_VISIBILITY_V2_STORE, readRun: async () => result });
        return read.kind === "ok" ? { kind: "ok", value: { status: "completed", evidenceAvailability: "recorded", report: encodeVisibilityWire(read.value.report) } } : unavailable();
      }
      if (typeof row.kb_id !== "string" || typeof row.question_set_hash !== "string") return unavailable();
      // Reuse the current V1 validator against exactly this owned row. No
      // baseline query, recomputation or inference of missing sample evidence.
      const read = await readPreviousVisibilityRun({ userId, kbId: row.kb_id, questionSetHash: row.question_set_hash }, { ...DEFAULT_VISIBILITY_STORE_DEPENDENCIES, readLatestRun: async () => result });
      return read.kind === "ok" ? { kind: "ok", value: { status: "completed", evidenceAvailability: "summary_only", summary: read.value } } : unavailable();
    }
    return { kind: "missing" };
  } catch { return unavailable(); }
}
