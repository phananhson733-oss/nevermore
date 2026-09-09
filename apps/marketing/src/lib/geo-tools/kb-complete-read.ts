// @input -- authenticated owner and one exact GEO snapshot selector
// @output -- self-contained frozen knowledge or explicit legacy/integrity state
// @pos -- GEO-owned read boundary; never resolves mutable Website Profile data
import type { GeoKbStoreResult } from "./kb-store.ts";
import { isGeoKbPayloadV3Value, parseAnyVersionedGeoKbPayload, readVersionedFrozenGeoKb, type VersionedGeoKbFrozenSnapshot } from "./kb-versioned-read.ts";
import { readVersionedGeoSnapshotContext } from "./asset-context-store.ts";
import { parseAnyGeoSnapshotContext, type AnyGeoSnapshotContext } from "./snapshot-context-v2.ts";
import { GEO_ABSENT_QUESTION_SET_HASH, GEO_SNAPSHOT_CONTEXT_SCHEMA_V3, isGeoSnapshotContextV3, parseGeoSnapshotContextV3, type GeoSnapshotContextV3 } from "./snapshot-context-v3.ts";
import type { GeoKbValue } from "./kb-contract.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { geoKbDigest } from "./kb-digest.ts";
import { geoQuestionSetDigest } from "./kb-questions.ts";
import { canonicalGeoEnrichmentText } from "./kb-enrichment.ts";
import { inheritedProfileFromCopy } from "./kb-profile-copy-server.ts";
import { normalizeGeoHost } from "../agents/geo-url.ts";
import { parseAnyGeoPreparedCandidate } from "./kb-prepared-contract.ts";
import { isGeoPreparedCandidateV3, parseGeoPreparedCandidateV3 } from "./kb-prepared-v3-contract.ts";
import type { AnyVersionedGeoPreparedCandidate } from "./kb-prepared-store.ts";
import type { GeoKnowledgePackV1 } from "./kb-knowledge-pack-contract.ts";
import type { GeoKnowledgePackV2 } from "./kb-knowledge-pack-v2-contract.ts";
import { canonicalGeoV2Text } from "./kb-v2-json.ts";

/** Every frozen context version a consumer may be handed, v3 included. */
export type AnyVersionedGeoSnapshotContext = AnyGeoSnapshotContext | GeoSnapshotContextV3;
/** v1 packs stay readable for the versions that froze them; v3 publishes v2. */
export type AnyGeoKnowledgePack = GeoKnowledgePackV1 | GeoKnowledgePackV2;

export interface CompleteGeoKnowledgeBase {
  readonly snapshot: VersionedGeoKbFrozenSnapshot;
  readonly context: AnyVersionedGeoSnapshotContext | null;
  readonly completeness: "complete" | "legacy_partial";
  readonly knowledgePack: AnyGeoKnowledgePack | null;
}
export interface CompleteGeoKbDependencies {
  readonly readFrozen: typeof readVersionedFrozenGeoKb;
  readonly readContext: typeof readVersionedGeoSnapshotContext;
  readonly readPrepared: (input: { readonly userId: string; readonly kbId: string; readonly candidateId: string }) => Promise<GeoKbStoreResult<AnyVersionedGeoPreparedCandidate | null>>;
}
export type CompleteGeoKbSelector = { readonly userId: string; readonly kbId: string } & (
  | { readonly snapshotId: string; readonly revision?: never }
  | { readonly revision: number; readonly snapshotId?: never }
);
const DEFAULT: CompleteGeoKbDependencies = { readFrozen: readVersionedFrozenGeoKb, readContext: readVersionedGeoSnapshotContext, readPrepared: async input => (await import("./kb-prepared-store.ts")).DEFAULT_GEO_KB_PREPARED_STORE.read(input) };
const unavailable = (): GeoKbStoreResult<never> => ({ kind: "unavailable", reason: "Complete GEO knowledge unavailable" });

function parseAnyVersionedGeoSnapshotContext(value: unknown): AnyVersionedGeoSnapshotContext {
  return isGeoSnapshotContextV3(value) ? parseGeoSnapshotContextV3(value) : parseAnyGeoSnapshotContext(value);
}

export async function readCompleteGeoKnowledgeBase(
  input: CompleteGeoKbSelector,
  dependencies: CompleteGeoKbDependencies = DEFAULT,
): Promise<GeoKbStoreResult<CompleteGeoKnowledgeBase>> {
  try {
    if ((input.revision === undefined) === (input.snapshotId === undefined)) return { kind: "invalid", code: "invalid_revision" };
    const read = await dependencies.readFrozen(input);
    if (read.kind !== "ok") return read;
    const snapshot = read.value;
    const sameId = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
    if (!sameId(snapshot.kbId, input.kbId)
      || (input.snapshotId !== undefined && !sameId(snapshot.snapshotId, input.snapshotId))
      || (input.revision !== undefined && snapshot.revision !== input.revision)) return { kind: "missing" };
    const parsed = parseAnyVersionedGeoKbPayload(snapshot.payload);
    if (isGeoKbPayloadV3Value(parsed)) return await readCompleteGeoV3(input, snapshot, parsed, dependencies);
    const v2 = parsed.schemaVersion === "marketing-geo-kb.v2";
    if (snapshot.questionSet === null || snapshot.questionSetHash === null || snapshot.questionCount === null) return unavailable();
    if (v2 !== (snapshot.questionSet.schemaVersion === "marketing-geo-question-set.v2")) return unavailable();
    const payloadHash = v2 ? geoV2Digest(parsed) : geoKbDigest(parsed as unknown as GeoKbValue);
    const questionHash = snapshot.questionSet.schemaVersion === "marketing-geo-question-set.v2" ? geoV2Digest(snapshot.questionSet) : geoQuestionSetDigest(snapshot.questionSet);
    if (payloadHash !== snapshot.contentHash || questionHash !== snapshot.questionSetHash
      || snapshot.questionCount !== snapshot.questionSet.questions.length) return unavailable();
    const copy = parsed.profileCopy;
    const profile = copy === undefined ? null : inheritedProfileFromCopy(copy);
    const source = await dependencies.readContext({ userId: input.userId, kbId: snapshot.kbId, snapshotId: snapshot.snapshotId });
    if (source.kind !== "ok") return unavailable();
    const context = source.value === null ? null : parseAnyVersionedGeoSnapshotContext(source.value);
    // A v3 context cannot describe a v1/v2 version: it carries no facts and no
    // profile projection, so the checks below would silently pass over nothing.
    if (context?.schemaVersion === GEO_SNAPSHOT_CONTEXT_SCHEMA_V3) return unavailable();
    if (v2 !== (context?.schemaVersion === "marketing-geo-snapshot-context.v2")) return unavailable();
    if (context !== null && (context.kbId !== snapshot.kbId
      || context.payloadHash !== snapshot.contentHash
      || context.questionSetHash !== snapshot.questionSetHash
      || context.targetHost !== normalizeGeoHost(parsed.targetUrl))) return unavailable();
    // A copied Profile must agree with its frozen context. Missing context is
    // corrupt complete data, not permission to fall back to today's Profile.
    if (profile !== null && (context === null
      || canonicalGeoEnrichmentText(context.profile) !== canonicalGeoEnrichmentText(profile))) return unavailable();
    let knowledgePack: GeoKnowledgePackV1 | null = null;
    if (v2) {
      if (snapshot.preparedId === undefined || snapshot.preparedId === null) return unavailable();
      const prepared = await dependencies.readPrepared({ userId: input.userId, kbId: snapshot.kbId, candidateId: snapshot.preparedId });
      if (prepared.kind !== "ok" || prepared.value === null) return unavailable();
      if (isGeoPreparedCandidateV3(prepared.value)) return unavailable();
      const candidate = parseAnyGeoPreparedCandidate(prepared.value);
      if (context === null || candidate.candidateId !== snapshot.preparedId || candidate.kbId !== snapshot.kbId || canonicalGeoEnrichmentText(candidate.payload) !== canonicalGeoEnrichmentText(snapshot.payload) || candidate.baseDraftHash !== snapshot.contentHash || canonicalGeoEnrichmentText(candidate.questionSet) !== canonicalGeoEnrichmentText(snapshot.questionSet) || candidate.context.contentHash !== context.contentHash || canonicalGeoV2Text(candidate.context) !== canonicalGeoV2Text(context)) return unavailable();
      knowledgePack = candidate.schemaVersion === "marketing-geo-prepared-candidate.v2" ? candidate.knowledgePack : null;
    }
    return { kind: "ok", value: { snapshot, context, completeness: copy === undefined ? "legacy_partial" : "complete", knowledgePack } };
  } catch { return unavailable(); }
}

/**
 * A v3 version, whose facts live in the published pack rather than the context.
 *
 * Three things differ from v2 and each one is checked here rather than assumed:
 * the question set may legitimately be absent (and the context then carries the
 * documented sentinel hash instead of a set's digest), the profile arrives as a
 * reference plus a 13-field subset rather than a full copy, and the candidate
 * that carries the pack is a v3 candidate with its own internal bindings.
 */
async function readCompleteGeoV3(
  input: CompleteGeoKbSelector,
  snapshot: VersionedGeoKbFrozenSnapshot,
  payload: Extract<ReturnType<typeof parseAnyVersionedGeoKbPayload>, { schemaVersion: "marketing-geo-kb.v3" }>,
  dependencies: CompleteGeoKbDependencies,
): Promise<GeoKbStoreResult<CompleteGeoKnowledgeBase>> {
  if (geoV2Digest(payload) !== snapshot.contentHash) return unavailable();
  const hasQuestions = snapshot.questionSet !== null;
  if (hasQuestions !== (snapshot.questionSetHash !== null) || hasQuestions !== (snapshot.questionCount !== null)) return unavailable();
  if (snapshot.questionSet !== null && (snapshot.questionSet.schemaVersion !== "marketing-geo-question-set.v2"
    || geoV2Digest(snapshot.questionSet) !== snapshot.questionSetHash
    || snapshot.questionCount !== snapshot.questionSet.questions.length)) return unavailable();
  const source = await dependencies.readContext({ userId: input.userId, kbId: snapshot.kbId, snapshotId: snapshot.snapshotId });
  if (source.kind !== "ok" || source.value === null) return unavailable();
  const v3Context = parseAnyVersionedGeoSnapshotContext(source.value);
  if (v3Context.schemaVersion !== GEO_SNAPSHOT_CONTEXT_SCHEMA_V3) return unavailable();
  // The absent-question-set hash is a documented sentinel, not a hash of any
  // set, so a version with no questions cannot be confused with one whose
  // questions failed to load.
  if (v3Context.kbId !== snapshot.kbId || v3Context.payloadHash !== snapshot.contentHash
    || v3Context.questionSetHash !== (snapshot.questionSetHash ?? GEO_ABSENT_QUESTION_SET_HASH)
    || v3Context.targetHost !== normalizeGeoHost(payload.generationInput.identity.targetUrl)
    || canonicalGeoV2Text(v3Context.profileRef) !== canonicalGeoV2Text(payload.generationInput.profileRef)) return unavailable();
  if (snapshot.preparedId === undefined || snapshot.preparedId === null) return unavailable();
  const prepared = await dependencies.readPrepared({ userId: input.userId, kbId: snapshot.kbId, candidateId: snapshot.preparedId });
  if (prepared.kind !== "ok" || prepared.value === null || !isGeoPreparedCandidateV3(prepared.value)) return unavailable();
  const candidate = parseGeoPreparedCandidateV3(prepared.value);
  const candidateQuestionSet = candidate.questionSet.status === "available" ? candidate.questionSet.value : null;
  if (candidate.candidateId !== snapshot.preparedId || candidate.kbId !== snapshot.kbId
    || candidate.baseDraftHash !== snapshot.contentHash
    || canonicalGeoV2Text(candidate.payload) !== canonicalGeoV2Text(payload)
    || canonicalGeoV2Text(candidateQuestionSet) !== canonicalGeoV2Text(snapshot.questionSet)
    || canonicalGeoV2Text(candidate.context) !== canonicalGeoV2Text(v3Context)) return unavailable();
  // v3 always carries its own profile reference and subset, so there is no
  // legacy-partial state to report: the version is self-contained or refused.
  return { kind: "ok", value: { snapshot, context: v3Context, completeness: "complete", knowledgePack: candidate.knowledgePack } };
}
