// @input -- a user-clicked selector for one GAP action and tab-local storage
// @output -- exact one-time TTL-bound selectors; no client observation authority
// @pos -- Visibility→Brief/T2 navigation without exposing private IDs in URLs
import { isNormalizedGeoCitationUrl } from "../agents/geo-url.ts";
export const GEO_GAP_HANDOFF_KEY = "gengrowth.geo-gap-handoff.v1";
export const GEO_GAP_HANDOFF_TTL_MS = 20 * 60_000;
export interface GeoGapHandoffStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export interface GeoGapHandoffPayload {
  readonly destination: "geo-brief" | "page-citability-check";
  readonly runId: string;
  readonly kbId: string;
  readonly snapshotId: string;
  readonly questionId: string;
  readonly gapId: string;
  readonly pageUrl: string | null;
  readonly questionText: string | null;
}
export interface GeoGapHandoff extends GeoGapHandoffPayload { readonly schemaVersion: "marketing-geo-gap-handoff.v1"; readonly createdAt: number; readonly expiresAt: number }
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function valid(value: unknown, now: number): value is GeoGapHandoff {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const keys = ["schemaVersion", "createdAt", "expiresAt", "destination", "runId", "kbId", "snapshotId", "questionId", "gapId", "pageUrl", "questionText"];
  if (Object.keys(row).length !== keys.length || !keys.every((key) => Object.hasOwn(row, key))) return false;
  if (row.schemaVersion !== "marketing-geo-gap-handoff.v1" || typeof row.createdAt !== "number" || typeof row.expiresAt !== "number" || !Number.isSafeInteger(row.createdAt) || row.expiresAt !== row.createdAt + GEO_GAP_HANDOFF_TTL_MS || row.createdAt > now || row.expiresAt <= now) return false;
  if (![row.runId, row.kbId, row.snapshotId].every((id) => typeof id === "string" && UUID.test(id)) || typeof row.questionId !== "string" || !/^[A-Za-z0-9:._/-]{1,128}$/.test(row.questionId) || row.gapId !== `gap-${row.questionId}`) return false;
  if (row.destination === "geo-brief") return row.pageUrl === null && row.questionText === null;
  return row.destination === "page-citability-check" && typeof row.pageUrl === "string" && row.pageUrl.length <= 2048 && isNormalizedGeoCitationUrl(row.pageUrl) && typeof row.questionText === "string" && row.questionText.length > 0 && row.questionText.length <= 500;
}
export function writeGeoGapHandoff(storage: GeoGapHandoffStorage, payload: GeoGapHandoffPayload, now = Date.now()): boolean {
  const value: GeoGapHandoff = { ...payload, schemaVersion: "marketing-geo-gap-handoff.v1", createdAt: now, expiresAt: now + GEO_GAP_HANDOFF_TTL_MS };
  if (!valid(value, now)) return false;
  try { storage.setItem(GEO_GAP_HANDOFF_KEY, JSON.stringify(value)); return true; } catch { return false; }
}
export function consumeGeoGapHandoff(storage: GeoGapHandoffStorage, now = Date.now(), destination: GeoGapHandoffPayload["destination"] = "geo-brief"): GeoGapHandoff | null {
  try {
    const text = storage.getItem(GEO_GAP_HANDOFF_KEY);
    if (text === null) return null;
    if (text.length > 4096) { storage.removeItem(GEO_GAP_HANDOFF_KEY); return null; }
    let value: unknown;
    try { value = JSON.parse(text); } catch { storage.removeItem(GEO_GAP_HANDOFF_KEY); return null; }
    if (!valid(value, now)) { storage.removeItem(GEO_GAP_HANDOFF_KEY); return null; }
    if (value.destination !== destination) return null;
    storage.removeItem(GEO_GAP_HANDOFF_KEY);
    return value;
  } catch { return null; }
}
