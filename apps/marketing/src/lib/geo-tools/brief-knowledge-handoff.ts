// @input -- explicit navigation between Brief and its existing owned knowledge
// @output -- bounded, single-use selectors; ownership and sources stay server-side
// @pos -- no private data in URLs, no auto-generation or carry-over of old runs
import type { GeoGapHandoffStorage } from "./gap-handoff.ts";
export const GEO_KNOWLEDGE_REPAIR_KEY = "gengrowth.geo-knowledge-repair.v1";
export const GEO_BRIEF_RETURN_KEY = "gengrowth.geo-brief-return.v1";
const TTL = 60 * 60_000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
interface Selection { readonly kbId: string; readonly snapshotId: string; readonly questionId: string | null; readonly manualQuestion?: string | null }
export interface GeoBriefReturn extends Selection { readonly manualQuestion: string | null }
export interface GeoKnowledgeRepair extends GeoBriefReturn { readonly reason: "question" | "facts" | "profile" }
type Kind = "repair" | "return";
const keyFor = (kind: Kind) => kind === "repair" ? GEO_KNOWLEDGE_REPAIR_KEY : GEO_BRIEF_RETURN_KEY;

function decode(value: unknown, kind: Kind, now: number): GeoKnowledgeRepair | GeoBriefReturn {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_handoff");
  const row = value as Record<string, unknown>;
  const keys = ["schemaVersion", "createdAt", "expiresAt", "kbId", "snapshotId", "questionId", "manualQuestion", ...(kind === "repair" ? ["reason"] : [])];
  if (Object.keys(row).length !== keys.length || !keys.every(key => Object.hasOwn(row, key))
    || row.schemaVersion !== keyFor(kind) || !Number.isSafeInteger(row.createdAt) || !Number.isSafeInteger(row.expiresAt)
    || Number(row.createdAt) > now || row.expiresAt !== Number(row.createdAt) + TTL || Number(row.expiresAt) <= now
    || ![row.kbId, row.snapshotId].every(id => typeof id === "string" && UUID.test(id))
    || (row.questionId !== null && (typeof row.questionId !== "string" || !/^[A-Za-z0-9_.-]{1,120}$/.test(row.questionId)))
    || (row.manualQuestion !== null && (typeof row.manualQuestion !== "string" || !row.manualQuestion.trim() || row.manualQuestion.length > 300 || /[\p{Cc}]/u.test(row.manualQuestion)))
    || (row.questionId !== null && row.manualQuestion !== null)
    || (kind === "repair" && !["question", "facts", "profile"].includes(String(row.reason)))) throw new Error("invalid_handoff");
  const selection: GeoBriefReturn = { kbId: row.kbId as string, snapshotId: row.snapshotId as string,
    questionId: row.questionId as string | null, manualQuestion: row.manualQuestion as string | null };
  return kind === "repair" ? { ...selection, reason: row.reason as GeoKnowledgeRepair["reason"] } : selection;
}
function write(storage: GeoGapHandoffStorage, selection: Selection, kind: Kind, now: number, reason?: GeoKnowledgeRepair["reason"]): boolean {
  const value = { schemaVersion: keyFor(kind), createdAt: now, expiresAt: now + TTL, kbId: selection.kbId,
    snapshotId: selection.snapshotId, questionId: selection.questionId, manualQuestion: selection.manualQuestion ?? null,
    ...(kind === "repair" ? { reason } : {}) };
  try { decode(value, kind, now); storage.setItem(keyFor(kind), JSON.stringify(value)); return true; } catch { return false; }
}
function consume(storage: GeoGapHandoffStorage, kind: Kind, now: number): GeoKnowledgeRepair | GeoBriefReturn | null {
  const raw = storage.getItem(keyFor(kind));
  if (raw === null) return null;
  storage.removeItem(keyFor(kind));
  if (raw.length > 2048) throw new Error("invalid_handoff");
  return decode(JSON.parse(raw), kind, now);
}
export function writeGeoKnowledgeRepair(storage: GeoGapHandoffStorage, payload: Selection & Pick<GeoKnowledgeRepair, "reason">, now = Date.now()): boolean {
  return write(storage, payload, "repair", now, payload.reason);
}
export function writeGeoBriefReturn(storage: GeoGapHandoffStorage, payload: Selection, now = Date.now()): boolean {
  return write(storage, payload, "return", now);
}
export function consumeGeoKnowledgeRepair(storage: GeoGapHandoffStorage, now = Date.now()): GeoKnowledgeRepair | null {
  return consume(storage, "repair", now) as GeoKnowledgeRepair | null;
}
export function consumeGeoBriefReturn(storage: GeoGapHandoffStorage, now = Date.now()): GeoBriefReturn | null {
  return consume(storage, "return", now) as GeoBriefReturn | null;
}
