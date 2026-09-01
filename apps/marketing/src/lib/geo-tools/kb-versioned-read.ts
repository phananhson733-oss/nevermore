// @input -- one exact owner-scoped immutable snapshot selector
// @output -- exact v1/v2 stored content, retaining version-specific digest inputs
// @pos -- additive read compatibility; never coerces new content into a legacy shape
import { z } from "zod";
import { readFrozenGeoKb, readGeoKnowledgeBase, listGeoKnowledgeBases, parseStoredGeoQuestionSetV1, DEFAULT_GEO_KB_STORE_DEPENDENCIES, type GeoKbStoreDependencies, type GeoKbStoreResult, type GeoKbFrozenSnapshot, type GeoKbDetails, type GeoKbSummary } from "./kb-store.ts";
import { parseAnyGeoKbPayload, parseGeoKbPayloadV2, type AnyGeoKbPayload } from "./kb-v2-contract.ts";
import { parseGeoQuestionSetV2, type AnyGeoQuestionSet } from "./kb-question-set-v2.ts";
import type { CompleteGeoKbSelector } from "./kb-complete-read.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { assertGeoProfileCopyIntegrity } from "./kb-profile-copy-server.ts";

export interface VersionedGeoKbFrozenSnapshot extends Omit<GeoKbFrozenSnapshot, "payload" | "questionSet"> { readonly payload: AnyGeoKbPayload; readonly questionSet: AnyGeoQuestionSet }
export interface VersionedGeoKbDetails extends Omit<GeoKbDetails, "draft"> { readonly draft: (Omit<NonNullable<GeoKbDetails["draft"]>, "payload"> & { readonly payload: AnyGeoKbPayload }) | null }
/** One existing transport bundle: do not fetch every draft to list identities. */
export async function listVersionedGeoKnowledgeBases(input: { readonly userId: string }, dependencies: GeoKbStoreDependencies = DEFAULT_GEO_KB_STORE_DEPENDENCIES): Promise<GeoKbStoreResult<readonly GeoKbSummary[]>> {
  try {
    const userId = z.string().uuid().parse(input.userId).toLowerCase();
    const read = await dependencies.readList(userId);
    if (read.kind !== "ok") return unavailable();
    const record = z.record(z.string(), z.unknown());
    const bundle = z.object({ knowledgeBases: z.array(record), drafts: z.array(record), snapshots: z.array(record) }).parse(read.data);
    if (![...bundle.drafts, ...bundle.snapshots].some(row => row.schema_version === "marketing-geo-kb.v2")) return listGeoKnowledgeBases({ userId }, { ...dependencies, readList: async () => read });
    const uuid = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/u), version = z.number().int().positive().refine(Number.isSafeInteger);
    const date = z.string().refine(value => Number.isFinite(Date.parse(value))).transform(value => new Date(value).toISOString());
    const schema = z.enum(["marketing-geo-kb.v1", "marketing-geo-kb.v2"]);
    const heads = bundle.knowledgeBases.map(row => z.object({ id: uuid, user_id: uuid, origin: z.string().min(1), host: z.string().min(1), canonical_site_key: z.string().min(1), current_frozen_snapshot_id: uuid.nullable(), created_at: date, updated_at: date }).parse(row));
    const drafts = bundle.drafts.map(row => z.object({ kb_id: uuid, user_id: uuid, schema_version: schema, draft_version: version, content_hash: hash, updated_at: date }).parse(row));
    const snapshots = bundle.snapshots.map(row => z.object({ id: uuid, kb_id: uuid, user_id: uuid, schema_version: schema, revision: version, content_hash: hash, question_set_hash: hash, frozen_at: date }).parse(row));
    const headIds = new Set(heads.map(row => row.id.toLowerCase())), draftMap = new Map(drafts.map(row => [row.kb_id.toLowerCase(), row])), snapshotMap = new Map(snapshots.map(row => [row.id.toLowerCase(), row]));
    if (headIds.size !== heads.length || draftMap.size !== drafts.length || snapshotMap.size !== snapshots.length
      || [...heads, ...drafts, ...snapshots].some(row => row.user_id.toLowerCase() !== userId)
      || [...drafts, ...snapshots].some(row => !headIds.has(row.kb_id.toLowerCase()))) return unavailable();
    const usedSnapshots = new Set<string>();
    const result = heads.map((head): GeoKbSummary => {
      const draft = draftMap.get(head.id.toLowerCase());
      const frozen = head.current_frozen_snapshot_id === null ? undefined : snapshotMap.get(head.current_frozen_snapshot_id.toLowerCase());
      if (head.current_frozen_snapshot_id !== null && (frozen === undefined || frozen.kb_id.toLowerCase() !== head.id.toLowerCase())) throw new Error("Invalid frozen pointer");
      if (frozen !== undefined) usedSnapshots.add(frozen.id.toLowerCase());
      return { kbId: head.id, origin: head.origin, host: head.host, canonicalSiteKey: head.canonical_site_key, createdAt: head.created_at, updatedAt: head.updated_at,
        draft: draft === undefined ? null : { draftVersion: draft.draft_version, contentHash: draft.content_hash, updatedAt: draft.updated_at },
        frozen: frozen === undefined ? null : { snapshotId: frozen.id, revision: frozen.revision, contentHash: frozen.content_hash, questionSetHash: frozen.question_set_hash, frozenAt: frozen.frozen_at } };
    });
    return usedSnapshots.size === snapshots.length ? { kind: "ok", value: result } : unavailable();
  } catch { return unavailable(); }
}
export function parseStoredGeoQuestionSet(value: unknown, expectedHash: string): AnyGeoQuestionSet {
  if (value !== null && typeof value === "object" && "schemaVersion" in value && value.schemaVersion === "marketing-geo-question-set.v2") {
    const parsed = parseGeoQuestionSetV2(value);
    if (geoV2Digest(parsed) !== expectedHash) throw new Error("Question-set hash mismatch");
    return parsed;
  }
  return parseStoredGeoQuestionSetV1(value, expectedHash);
}
const headerSchema = z.object({ id: z.string().uuid(), kb_id: z.string().uuid(), user_id: z.string().uuid(), revision: z.number().int().positive().refine(Number.isSafeInteger), schema_version: z.literal("marketing-geo-kb.v2"), content_hash: z.string().regex(/^[a-f0-9]{64}$/u), question_set_hash: z.string().regex(/^[a-f0-9]{64}$/u), frozen_at: z.string().refine(value => Number.isFinite(Date.parse(value))), payload: z.unknown(), question_set: z.unknown() });
const unavailable = (): GeoKbStoreResult<never> => ({ kind: "unavailable", reason: "versioned_snapshot_unavailable" });
export async function readVersionedFrozenGeoKb(input: CompleteGeoKbSelector, dependencies: GeoKbStoreDependencies = DEFAULT_GEO_KB_STORE_DEPENDENCIES): Promise<GeoKbStoreResult<VersionedGeoKbFrozenSnapshot>> {
  try {
    const userId = z.string().uuid().parse(input.userId).toLowerCase(), kbId = z.string().uuid().parse(input.kbId).toLowerCase();
    if ((input.snapshotId === undefined) === (input.revision === undefined)) return { kind: "invalid", code: "invalid_revision" };
    const selector = input.snapshotId !== undefined ? { by: "snapshotId" as const, snapshotId: z.string().uuid().parse(input.snapshotId).toLowerCase() } : { by: "revision" as const, revision: z.number().int().positive().refine(Number.isSafeInteger).parse(input.revision) };
    const read = await dependencies.readSnapshot(userId, kbId, selector);
    if (read.kind !== "ok") return unavailable();
    if (read.data === null || read.data === undefined) return { kind: "missing" };
    if (typeof read.data !== "object" || Array.isArray(read.data)) return unavailable();
    if ("schema_version" in read.data && read.data.schema_version === "marketing-geo-kb.v1") return readFrozenGeoKb(input, { ...dependencies, readSnapshot: async () => read });
    const row = headerSchema.parse(read.data), payload = parseGeoKbPayloadV2(row.payload), questionSet = parseStoredGeoQuestionSet(row.question_set, row.question_set_hash);
    if (row.user_id.toLowerCase() !== userId || row.kb_id.toLowerCase() !== kbId || (selector.by === "snapshotId" ? row.id.toLowerCase() !== selector.snapshotId : row.revision !== selector.revision)) return unavailable();
    assertGeoProfileCopyIntegrity(payload.profileCopy);
    if (geoV2Digest(payload) !== row.content_hash || questionSet.schemaVersion !== "marketing-geo-question-set.v2" || questionSet.country !== payload.market.country || questionSet.language !== payload.market.language) return unavailable();
    return { kind: "ok", value: { kbId: row.kb_id, snapshotId: row.id, revision: row.revision, frozenAt: new Date(row.frozen_at).toISOString(), contentHash: row.content_hash, questionSetHash: row.question_set_hash, questionCount: questionSet.questions.length, payload, questionSet } };
  } catch { return unavailable(); }
}

export async function readVersionedGeoKnowledgeBase(input: { readonly userId: string; readonly kbId: string }, dependencies: GeoKbStoreDependencies = DEFAULT_GEO_KB_STORE_DEPENDENCIES): Promise<GeoKbStoreResult<VersionedGeoKbDetails>> {
  try {
    const userId = z.string().uuid().parse(input.userId).toLowerCase(), kbId = z.string().uuid().parse(input.kbId).toLowerCase();
    const read = await dependencies.readDetails(userId, kbId);
    if (read.kind !== "ok") return unavailable();
    const record = z.record(z.string(), z.unknown());
    const bundle = z.object({ knowledgeBases: z.array(record).max(1), drafts: z.array(record).max(1), snapshots: z.array(record).max(1) }).parse(read.data);
    if (![...bundle.drafts, ...bundle.snapshots].some(row => row.schema_version === "marketing-geo-kb.v2")) return readGeoKnowledgeBase(input, { ...dependencies, readDetails: async () => read });
    if (bundle.knowledgeBases.length !== 1) return unavailable();
    const date = z.string().refine(value => Number.isFinite(Date.parse(value))).transform(value => new Date(value).toISOString());
    const uuid = z.string().uuid();
    const head = z.object({ id: uuid, user_id: uuid, origin: z.string().min(1), host: z.string().min(1), canonical_site_key: z.string().min(1), current_frozen_snapshot_id: uuid.nullable(), created_at: date, updated_at: date }).parse(bundle.knowledgeBases[0]);
    if (head.id.toLowerCase() !== kbId || head.user_id.toLowerCase() !== userId) return unavailable();
    let draft: VersionedGeoKbDetails["draft"] = null;
    const raw = bundle.drafts[0];
    if (raw !== undefined) {
      const row = z.object({ kb_id: uuid, user_id: uuid, schema_version: z.enum(["marketing-geo-kb.v1", "marketing-geo-kb.v2"]), draft_version: z.number().int().positive().refine(Number.isSafeInteger), content_hash: z.string().regex(/^[a-f0-9]{64}$/u), updated_at: date, payload: z.unknown() }).parse(raw);
      const payload = parseAnyGeoKbPayload(row.payload);
      if (row.kb_id.toLowerCase() !== kbId || row.user_id.toLowerCase() !== userId || row.schema_version !== payload.schemaVersion || geoV2Digest(payload) !== row.content_hash) return unavailable();
      if (payload.profileCopy) assertGeoProfileCopyIntegrity(payload.profileCopy);
      draft = { draftVersion: row.draft_version, payload, contentHash: row.content_hash, updatedAt: row.updated_at };
    }
    let frozen: GeoKbDetails["frozen"] = null;
    if (head.current_frozen_snapshot_id !== null) {
      if (bundle.snapshots.length !== 1) return unavailable();
      const result = await readVersionedFrozenGeoKb({ userId, kbId, snapshotId: head.current_frozen_snapshot_id }, { ...dependencies, readSnapshot: async () => ({ kind: "ok", data: bundle.snapshots[0] }) });
      if (result.kind !== "ok") return unavailable();
      const { payload: _payload, questionSet: _questions, kbId: _kb, ...summary } = result.value;
      frozen = summary;
    } else if (bundle.snapshots.length > 0) return unavailable();
    return { kind: "ok", value: { kbId: head.id, origin: head.origin, host: head.host, canonicalSiteKey: head.canonical_site_key, createdAt: head.created_at, updatedAt: head.updated_at, draft, frozen } };
  } catch { return unavailable(); }
}
