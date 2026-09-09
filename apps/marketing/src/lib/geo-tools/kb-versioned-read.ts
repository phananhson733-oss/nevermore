// @input -- one exact owner-scoped immutable snapshot selector
// @output -- exact v1/v2/v3 stored content, retaining version-specific digest inputs
// @pos -- additive read compatibility; never coerces new content into a legacy shape
import { z } from "zod";
import { readFrozenGeoKb, readGeoKnowledgeBase, listGeoKnowledgeBases, parseStoredGeoQuestionSetV1, DEFAULT_GEO_KB_STORE_DEPENDENCIES, type GeoKbStoreDependencies, type GeoKbStoreResult, type GeoKbFrozenSnapshot, type GeoKbFrozenRef, type GeoKbFrozenSummary, type GeoKbDetails, type GeoKbSummary } from "./kb-store.ts";
import { parseAnyGeoKbPayload, parseGeoKbPayloadV2, type AnyGeoKbPayload } from "./kb-v2-contract.ts";
import { GEO_KB_SCHEMA_VERSION_V3, parseGeoKbPayloadV3, type GeoKbPayloadV3 } from "./kb-v3-contract.ts";
import type { GeoKbCompetitor, GeoKbRole } from "./kb-contract.ts";
import { parseGeoQuestionSetV2, type AnyGeoQuestionSet, type GeoQuestionSetV2 } from "./kb-question-set-v2.ts";
import type { CompleteGeoKbSelector } from "./kb-complete-read.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { assertGeoProfileCopyIntegrity } from "./kb-profile-copy-server.ts";

/** Every payload version a stored draft or snapshot may hold, v3 included. */
export type AnyVersionedGeoKbPayload = AnyGeoKbPayload | GeoKbPayloadV3;
export function isGeoKbPayloadV3Value(payload: AnyVersionedGeoKbPayload): payload is GeoKbPayloadV3 {
  return payload.schemaVersion === GEO_KB_SCHEMA_VERSION_V3;
}
/**
 * The measurement identity every payload version carries, wherever it keeps it.
 *
 * v1 and v2 hold it at the top level; v3 moved it inside `generationInput`,
 * because that half of a v3 draft is locked while the review beside it stays
 * editable. Consumers that only need "who is this knowledge base about" read it
 * through here rather than each learning the difference, and the projection is
 * total, so no consumer can quietly skip v3 by falling through a version check.
 */
export interface GeoVersionedPayloadIdentity {
  readonly targetUrl: string; readonly officialName: string; readonly aliases: readonly string[];
  readonly categoryTerms: readonly string[]; readonly market: { readonly country: string; readonly language: string };
  readonly competitors: readonly GeoKbCompetitor[]; readonly roles: readonly GeoKbRole[];
}
export function geoVersionedPayloadIdentity(payload: AnyVersionedGeoKbPayload): GeoVersionedPayloadIdentity {
  if (!isGeoKbPayloadV3Value(payload)) {
    return { targetUrl: payload.targetUrl, officialName: payload.officialName, aliases: payload.aliases,
      categoryTerms: payload.categoryTerms, market: payload.market, competitors: payload.competitors, roles: payload.roles };
  }
  const { identity, competitors, roles } = payload.generationInput;
  return { targetUrl: identity.targetUrl, officialName: identity.officialName, aliases: identity.aliases,
    categoryTerms: identity.categoryTerms, market: identity.market, competitors, roles };
}
export function parseAnyVersionedGeoKbPayload(value: unknown): AnyVersionedGeoKbPayload {
  return value !== null && typeof value === "object" && "schemaVersion" in value && value.schemaVersion === GEO_KB_SCHEMA_VERSION_V3
    ? parseGeoKbPayloadV3(value) : parseAnyGeoKbPayload(value);
}

/**
 * A frozen version, with the three fields a v3 version may legitimately lack.
 *
 * The question set is optional content in v3: the question step can fail, or
 * the site's language may not be supported, and the knowledge is still
 * publishable. So `questionSet`, `questionSetHash` and `questionCount` are null
 * rather than an empty set, a hash of nothing and a count of zero -- a version
 * that asks no questions must not read like one that asks none *yet*, and a
 * count of 0 is a measured quantity this version does not have.
 */
export interface VersionedGeoKbFrozenSnapshot extends Omit<GeoKbFrozenSnapshot, "payload" | "questionSet" | "questionSetHash" | "questionCount"> {
  readonly payload: AnyVersionedGeoKbPayload; readonly questionSet: AnyGeoQuestionSet | null;
  readonly questionSetHash: string | null; readonly questionCount: number | null; readonly preparedId?: string | null;
}
export interface VersionedGeoKbFrozenRef extends Omit<GeoKbFrozenRef, "questionSetHash"> { readonly questionSetHash: string | null }
export interface VersionedGeoKbFrozenSummary extends Omit<GeoKbFrozenSummary, "questionSetHash" | "questionCount"> { readonly questionSetHash: string | null; readonly questionCount: number | null }
export interface VersionedGeoKbSummary extends Omit<GeoKbSummary, "frozen"> { readonly frozen: VersionedGeoKbFrozenRef | null }
export interface VersionedGeoKbDetails extends Omit<GeoKbDetails, "draft" | "frozen"> {
  readonly draft: (Omit<NonNullable<GeoKbDetails["draft"]>, "payload"> & { readonly payload: AnyVersionedGeoKbPayload }) | null;
  readonly frozen: VersionedGeoKbFrozenSummary | null;
}
/** One existing transport bundle: do not fetch every draft to list identities. */
export async function listVersionedGeoKnowledgeBases(input: { readonly userId: string }, dependencies: GeoKbStoreDependencies = DEFAULT_GEO_KB_STORE_DEPENDENCIES): Promise<GeoKbStoreResult<readonly VersionedGeoKbSummary[]>> {
  try {
    const userId = z.string().uuid().parse(input.userId).toLowerCase();
    const read = await dependencies.readList(userId);
    if (read.kind !== "ok") return unavailable();
    const record = z.record(z.string(), z.unknown());
    const bundle = z.object({ knowledgeBases: z.array(record), drafts: z.array(record), snapshots: z.array(record) }).parse(read.data);
    if (![...bundle.drafts, ...bundle.snapshots].some(row => row.schema_version === "marketing-geo-kb.v2" || row.schema_version === GEO_KB_SCHEMA_VERSION_V3)) return listGeoKnowledgeBases({ userId }, { ...dependencies, readList: async () => read });
    const uuid = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/u), version = z.number().int().positive().refine(Number.isSafeInteger);
    const date = z.string().refine(value => Number.isFinite(Date.parse(value))).transform(value => new Date(value).toISOString());
    const schema = z.enum(["marketing-geo-kb.v1", "marketing-geo-kb.v2", GEO_KB_SCHEMA_VERSION_V3]);
    const heads = bundle.knowledgeBases.map(row => z.object({ id: uuid, user_id: uuid, origin: z.string().min(1), host: z.string().min(1), canonical_site_key: z.string().min(1), current_frozen_snapshot_id: uuid.nullable(), created_at: date, updated_at: date }).parse(row));
    const drafts = bundle.drafts.map(row => z.object({ kb_id: uuid, user_id: uuid, schema_version: schema, draft_version: version, content_hash: hash, updated_at: date }).parse(row));
    // Nullable only for v3: a v1/v2 version without a question-set hash is a
    // malformed row, and admitting one would hide it behind a null.
    const snapshots = bundle.snapshots.map(row => z.object({ id: uuid, kb_id: uuid, user_id: uuid, schema_version: schema, revision: version, content_hash: hash, question_set_hash: hash.nullable(), frozen_at: date }).parse(row));
    const headIds = new Set(heads.map(row => row.id.toLowerCase())), draftMap = new Map(drafts.map(row => [row.kb_id.toLowerCase(), row])), snapshotMap = new Map(snapshots.map(row => [row.id.toLowerCase(), row]));
    if (headIds.size !== heads.length || draftMap.size !== drafts.length || snapshotMap.size !== snapshots.length
      || snapshots.some(row => row.question_set_hash === null && row.schema_version !== GEO_KB_SCHEMA_VERSION_V3)
      || [...heads, ...drafts, ...snapshots].some(row => row.user_id.toLowerCase() !== userId)
      || [...drafts, ...snapshots].some(row => !headIds.has(row.kb_id.toLowerCase()))) return unavailable();
    const usedSnapshots = new Set<string>();
    const result = heads.map((head): VersionedGeoKbSummary => {
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
const headerSchema = z.object({ id: z.string().uuid(), kb_id: z.string().uuid(), user_id: z.string().uuid(), revision: z.number().int().positive().refine(Number.isSafeInteger), schema_version: z.enum(["marketing-geo-kb.v2", GEO_KB_SCHEMA_VERSION_V3]), content_hash: z.string().regex(/^[a-f0-9]{64}$/u), question_set_hash: z.string().regex(/^[a-f0-9]{64}$/u).nullable(), prepared_id: z.string().uuid(), frozen_at: z.string().refine(value => Number.isFinite(Date.parse(value))), payload: z.unknown(), question_set: z.unknown() });
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
    if ("schema_version" in read.data && read.data.schema_version === "marketing-geo-kb.v1") {
      const legacy = await readFrozenGeoKb(input, { ...dependencies, readSnapshot: async () => read });
      return legacy.kind === "ok" ? { kind: "ok", value: { ...legacy.value, preparedId: null } } : legacy;
    }
    const row = headerSchema.parse(read.data);
    if (row.user_id.toLowerCase() !== userId || row.kb_id.toLowerCase() !== kbId || (selector.by === "snapshotId" ? row.id.toLowerCase() !== selector.snapshotId : row.revision !== selector.revision)) return unavailable();
    const identity = { kbId: row.kb_id, snapshotId: row.id, revision: row.revision, frozenAt: new Date(row.frozen_at).toISOString(), contentHash: row.content_hash, preparedId: row.prepared_id };
    if (row.schema_version === GEO_KB_SCHEMA_VERSION_V3) {
      const payload = parseGeoKbPayloadV3(row.payload);
      if (geoV2Digest(payload) !== row.content_hash) return unavailable();
      // A v3 version has both halves of its question set or neither. One
      // without the other is a row no reader can describe truthfully, so it is
      // refused rather than reported as a version with no questions.
      const stored = row.question_set;
      if (stored === undefined || (stored === null) !== (row.question_set_hash === null)) return unavailable();
      let questionSet: GeoQuestionSetV2 | null = null;
      if (stored !== null) {
        questionSet = parseGeoQuestionSetV2(stored);
        const market = payload.generationInput.identity.market;
        if (geoV2Digest(questionSet) !== row.question_set_hash || questionSet.country !== market.country || questionSet.language !== market.language) return unavailable();
      }
      return { kind: "ok", value: { ...identity, questionSetHash: row.question_set_hash,
        questionCount: questionSet === null ? null : questionSet.questions.length, payload, questionSet } };
    }
    if (row.question_set_hash === null) return unavailable();
    const payload = parseGeoKbPayloadV2(row.payload), questionSet = parseStoredGeoQuestionSet(row.question_set, row.question_set_hash);
    assertGeoProfileCopyIntegrity(payload.profileCopy);
    if (geoV2Digest(payload) !== row.content_hash || questionSet.schemaVersion !== "marketing-geo-question-set.v2" || questionSet.country !== payload.market.country || questionSet.language !== payload.market.language) return unavailable();
    return { kind: "ok", value: { ...identity, questionSetHash: row.question_set_hash, questionCount: questionSet.questions.length, payload, questionSet } };
  } catch { return unavailable(); }
}

export async function readVersionedGeoKnowledgeBase(input: { readonly userId: string; readonly kbId: string }, dependencies: GeoKbStoreDependencies = DEFAULT_GEO_KB_STORE_DEPENDENCIES): Promise<GeoKbStoreResult<VersionedGeoKbDetails>> {
  try {
    const userId = z.string().uuid().parse(input.userId).toLowerCase(), kbId = z.string().uuid().parse(input.kbId).toLowerCase();
    const read = await dependencies.readDetails(userId, kbId);
    if (read.kind !== "ok") return unavailable();
    const record = z.record(z.string(), z.unknown());
    const bundle = z.object({ knowledgeBases: z.array(record).max(1), drafts: z.array(record).max(1), snapshots: z.array(record).max(1) }).parse(read.data);
    if (![...bundle.drafts, ...bundle.snapshots].some(row => row.schema_version === "marketing-geo-kb.v2" || row.schema_version === GEO_KB_SCHEMA_VERSION_V3)) return readGeoKnowledgeBase(input, { ...dependencies, readDetails: async () => read });
    if (bundle.knowledgeBases.length !== 1) return unavailable();
    const date = z.string().refine(value => Number.isFinite(Date.parse(value))).transform(value => new Date(value).toISOString());
    const uuid = z.string().uuid();
    const head = z.object({ id: uuid, user_id: uuid, origin: z.string().min(1), host: z.string().min(1), canonical_site_key: z.string().min(1), current_frozen_snapshot_id: uuid.nullable(), created_at: date, updated_at: date }).parse(bundle.knowledgeBases[0]);
    if (head.id.toLowerCase() !== kbId || head.user_id.toLowerCase() !== userId) return unavailable();
    let draft: VersionedGeoKbDetails["draft"] = null;
    const raw = bundle.drafts[0];
    if (raw !== undefined) {
      const row = z.object({ kb_id: uuid, user_id: uuid, schema_version: z.enum(["marketing-geo-kb.v1", "marketing-geo-kb.v2", GEO_KB_SCHEMA_VERSION_V3]), draft_version: z.number().int().positive().refine(Number.isSafeInteger), content_hash: z.string().regex(/^[a-f0-9]{64}$/u), updated_at: date, payload: z.unknown() }).parse(raw);
      const payload = parseAnyVersionedGeoKbPayload(row.payload);
      if (row.kb_id.toLowerCase() !== kbId || row.user_id.toLowerCase() !== userId || row.schema_version !== payload.schemaVersion || geoV2Digest(payload) !== row.content_hash) return unavailable();
      // v3 carries a profile reference plus a 13-field subset instead of a full
      // copy, so the copy integrity check has nothing to check there.
      if (!isGeoKbPayloadV3Value(payload) && payload.profileCopy) assertGeoProfileCopyIntegrity(payload.profileCopy);
      draft = { draftVersion: row.draft_version, payload, contentHash: row.content_hash, updatedAt: row.updated_at };
    }
    let frozen: VersionedGeoKbDetails["frozen"] = null;
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
