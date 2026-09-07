// @input -- authenticated owner and one exact GEO snapshot selector
// @output -- self-contained frozen knowledge or explicit legacy/integrity state
// @pos -- GEO-owned read boundary; never resolves mutable Website Profile data
import type { GeoKbStoreResult } from "./kb-store.ts";
import { readVersionedFrozenGeoKb, type VersionedGeoKbFrozenSnapshot } from "./kb-versioned-read.ts";
import { readVersionedGeoSnapshotContext } from "./asset-context-store.ts";
import { parseAnyGeoSnapshotContext, type AnyGeoSnapshotContext } from "./snapshot-context-v2.ts";
import type { GeoKbValue } from "./kb-contract.ts";
import { parseAnyGeoKbPayload } from "./kb-v2-contract.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { geoKbDigest } from "./kb-digest.ts";
import { geoQuestionSetDigest } from "./kb-questions.ts";
import { canonicalGeoEnrichmentText } from "./kb-enrichment.ts";
import { inheritedProfileFromCopy } from "./kb-profile-copy-server.ts";
import { normalizeGeoHost } from "../agents/geo-url.ts";
import { parseAnyGeoPreparedCandidate, type AnyGeoPreparedCandidate } from "./kb-prepared-contract.ts";
import type { GeoKnowledgePackV1 } from "./kb-knowledge-pack-contract.ts";
import { canonicalGeoV2Text } from "./kb-v2-json.ts";

export interface CompleteGeoKnowledgeBase {
  readonly snapshot: VersionedGeoKbFrozenSnapshot;
  readonly context: AnyGeoSnapshotContext | null;
  readonly completeness: "complete" | "legacy_partial";
  readonly knowledgePack: GeoKnowledgePackV1 | null;
}
export interface CompleteGeoKbDependencies {
  readonly readFrozen: typeof readVersionedFrozenGeoKb;
  readonly readContext: typeof readVersionedGeoSnapshotContext;
  readonly readPrepared: (input: { readonly userId: string; readonly kbId: string; readonly candidateId: string }) => Promise<GeoKbStoreResult<AnyGeoPreparedCandidate | null>>;
}
export type CompleteGeoKbSelector = { readonly userId: string; readonly kbId: string } & (
  | { readonly snapshotId: string; readonly revision?: never }
  | { readonly revision: number; readonly snapshotId?: never }
);
const DEFAULT: CompleteGeoKbDependencies = { readFrozen: readVersionedFrozenGeoKb, readContext: readVersionedGeoSnapshotContext, readPrepared: async input => (await import("./kb-prepared-store.ts")).DEFAULT_GEO_KB_PREPARED_STORE.read(input) };
const unavailable = (): GeoKbStoreResult<never> => ({ kind: "unavailable", reason: "Complete GEO knowledge unavailable" });

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
    const parsed = parseAnyGeoKbPayload(snapshot.payload);
    const v2 = parsed.schemaVersion === "marketing-geo-kb.v2";
    if (v2 !== (snapshot.questionSet.schemaVersion === "marketing-geo-question-set.v2")) return unavailable();
    const payloadHash = v2 ? geoV2Digest(parsed) : geoKbDigest(parsed as unknown as GeoKbValue);
    const questionHash = snapshot.questionSet.schemaVersion === "marketing-geo-question-set.v2" ? geoV2Digest(snapshot.questionSet) : geoQuestionSetDigest(snapshot.questionSet);
    if (payloadHash !== snapshot.contentHash || questionHash !== snapshot.questionSetHash
      || snapshot.questionCount !== snapshot.questionSet.questions.length) return unavailable();
    const copy = parsed.profileCopy;
    const profile = copy === undefined ? null : inheritedProfileFromCopy(copy);
    const source = await dependencies.readContext({ userId: input.userId, kbId: snapshot.kbId, snapshotId: snapshot.snapshotId });
    if (source.kind !== "ok") return unavailable();
    const context = source.value === null ? null : parseAnyGeoSnapshotContext(source.value);
    if (v2 !== (context?.schemaVersion === "marketing-geo-snapshot-context.v2")) return unavailable();
    if (context !== null && (context.kbId !== snapshot.kbId
      || context.payloadHash !== snapshot.contentHash
      || context.questionSetHash !== snapshot.questionSetHash
      || context.targetHost !== normalizeGeoHost(snapshot.payload.targetUrl))) return unavailable();
    // A copied Profile must agree with its frozen context. Missing context is
    // corrupt complete data, not permission to fall back to today's Profile.
    if (profile !== null && (context === null
      || canonicalGeoEnrichmentText(context.profile) !== canonicalGeoEnrichmentText(profile))) return unavailable();
    let knowledgePack: GeoKnowledgePackV1 | null = null;
    if (v2) {
      if (snapshot.preparedId === undefined || snapshot.preparedId === null) return unavailable();
      const prepared = await dependencies.readPrepared({ userId: input.userId, kbId: snapshot.kbId, candidateId: snapshot.preparedId });
      if (prepared.kind !== "ok" || prepared.value === null) return unavailable();
      const candidate = parseAnyGeoPreparedCandidate(prepared.value);
      if (context === null || candidate.candidateId !== snapshot.preparedId || candidate.kbId !== snapshot.kbId || canonicalGeoEnrichmentText(candidate.payload) !== canonicalGeoEnrichmentText(snapshot.payload) || candidate.baseDraftHash !== snapshot.contentHash || canonicalGeoEnrichmentText(candidate.questionSet) !== canonicalGeoEnrichmentText(snapshot.questionSet) || candidate.context.contentHash !== context.contentHash || canonicalGeoV2Text(candidate.context) !== canonicalGeoV2Text(context)) return unavailable();
      knowledgePack = candidate.schemaVersion === "marketing-geo-prepared-candidate.v2" ? candidate.knowledgePack : null;
    }
    return { kind: "ok", value: { snapshot, context, completeness: copy === undefined ? "legacy_partial" : "complete", knowledgePack } };
  } catch { return unavailable(); }
}
