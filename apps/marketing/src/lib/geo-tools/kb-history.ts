// @input -- authenticated account; paged immutable snapshots and owned KB identities
// @output -- exact historical versions, or an explicit unreadable/oversized history
// @pos -- shared Visibility/Brief version selector; never substitutes an empty state for a failed read
import { createAdminSupabaseClient } from "../supabase/admin.ts";
import { DEFAULT_GEO_KB_STORE_DEPENDENCIES, type GeoKbStoreResult, type GeoKbTransportOutcome } from "./kb-store.ts";
import { listVersionedGeoKnowledgeBases, readVersionedFrozenGeoKb, type VersionedGeoKbFrozenSnapshot } from "./kb-versioned-read.ts";

export const GEO_FROZEN_HISTORY_LIMIT = 200;
const PAGE_SIZE = 25;
const COLUMNS = "id,user_id,kb_id,revision,schema_version,payload,content_hash,question_set,question_set_hash,frozen_at";
export interface GeoKbHistoryDependencies {
  readonly listKnowledgeBases: typeof listVersionedGeoKnowledgeBases;
  readonly readPage: (userId: string, offset: number, limit: number) => Promise<GeoKbTransportOutcome>;
}
export interface GeoKbHistoricalVersion { readonly host: string; readonly snapshot: VersionedGeoKbFrozenSnapshot }
const DEFAULT: GeoKbHistoryDependencies = {
  listKnowledgeBases: listVersionedGeoKnowledgeBases,
  readPage: async (userId, offset, limit) => {
    const result = await createAdminSupabaseClient().from("marketing_geo_kb_snapshots").select(COLUMNS)
      .eq("user_id", userId).order("frozen_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + limit - 1);
    return result.error ? { kind: "error", code: result.error.code ?? null } : { kind: "ok", data: result.data };
  },
};
const unavailable = (reason = "frozen_history_unavailable"): GeoKbStoreResult<never> => ({ kind: "unavailable", reason });

export async function listFrozenGeoKbVersions(input: { readonly userId: string }, dependencies: GeoKbHistoryDependencies = DEFAULT): Promise<GeoKbStoreResult<readonly GeoKbHistoricalVersion[]>> {
  try {
    const userId = input.userId.toLowerCase();
    const list = await dependencies.listKnowledgeBases({ userId });
    if (list.kind !== "ok") return unavailable();
    const knowledgeBases = new Map(list.value.map((kb) => [kb.kbId.toLowerCase(), kb]));
    const versions: GeoKbHistoricalVersion[] = [];
    const seen = new Set<string>();
    for (let offset = 0; offset <= GEO_FROZEN_HISTORY_LIMIT; offset += PAGE_SIZE) {
      const page = await dependencies.readPage(userId, offset, PAGE_SIZE);
      if (page.kind !== "ok" || !Array.isArray(page.data) || page.data.length > PAGE_SIZE) return unavailable();
      if (versions.length + page.data.length > GEO_FROZEN_HISTORY_LIMIT) return unavailable("frozen_history_limit");
      for (const value of page.data) {
        if (value === null || typeof value !== "object" || Array.isArray(value)) return unavailable();
        const row = value as Record<string, unknown>;
        if (typeof row.kb_id !== "string" || typeof row.id !== "string" || seen.has(row.id)) return unavailable();
        const kb = knowledgeBases.get(row.kb_id.toLowerCase());
        if (!kb) return unavailable();
        // Reuse the exact frozen reader's ownership/digest/registry validation
        // against the already fetched row; this introduces no N+1 network read.
        const read = await readVersionedFrozenGeoKb({ userId, kbId: kb.kbId, snapshotId: row.id }, {
          ...DEFAULT_GEO_KB_STORE_DEPENDENCIES,
          readSnapshot: async () => ({ kind: "ok", data: row }),
        });
        if (read.kind !== "ok") return unavailable();
        seen.add(read.value.snapshotId);
        versions.push({ host: kb.host, snapshot: read.value });
      }
      if (page.data.length < PAGE_SIZE) break;
    }
    if (list.value.some((kb) => kb.frozen !== null && !seen.has(kb.frozen.snapshotId))) return unavailable();
    return { kind: "ok", value: versions };
  } catch { return unavailable(); }
}
