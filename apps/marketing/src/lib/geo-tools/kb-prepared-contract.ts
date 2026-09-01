// @input -- one persisted candidate assembled from a saved draft and exact source selections
// @output -- fully bound, independently readable candidate, never a live regeneration
// @pos -- server-side prepared-candidate validation before persistence/freeze
import { z } from "zod";
import { parseGeoKbPayloadV2, type GeoKbPayloadV2 } from "./kb-v2-contract.ts";
import { parseGeoQuestionSetV2, type GeoQuestionSetV2 } from "./kb-question-set-v2.ts";
import { parseGeoSnapshotContextV2, buildGeoSnapshotContextV2, geoSourceReceiptRefSchema, type GeoSnapshotContextV2, type GeoSourceReceiptRef } from "./snapshot-context-v2.ts";
import { assertGeoProfileCopyIntegrity } from "./kb-profile-copy-server.ts";
import { canonicalGeoV2Text, geoV2JsonbBytes } from "./kb-v2-json.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";

export const GEO_PREPARED_CANDIDATE_SCHEMA = "marketing-geo-prepared-candidate.v1" as const;
export const GEO_PREPARED_CANDIDATE_MAX_BYTES = 1_572_864;
export interface GeoPreparedCandidateV1 {
  readonly schemaVersion: typeof GEO_PREPARED_CANDIDATE_SCHEMA;
  readonly candidateId: string; readonly kbId: string;
  readonly baseDraftVersion: string; readonly baseDraftHash: string;
  readonly profileCopyHash: string;
  readonly sourceReceiptRefs: readonly GeoSourceReceiptRef[];
  readonly generatorVersion: string;
  readonly payload: GeoKbPayloadV2;
  readonly questionSet: GeoQuestionSetV2;
  readonly context: GeoSnapshotContextV2;
  readonly candidateHash: string;
}
export type GeoPreparedCandidateBody = Omit<GeoPreparedCandidateV1, "candidateHash">;
export interface GeoFreezePreparedInput { readonly candidateId: string; readonly candidateHash: string }
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const schema = z.object({ schemaVersion: z.literal(GEO_PREPARED_CANDIDATE_SCHEMA), candidateId: z.string().uuid(), kbId: z.string().uuid(), baseDraftVersion: z.string().regex(/^[1-9][0-9]{0,15}$/u).refine(value => Number.isSafeInteger(Number(value))), baseDraftHash: hash, profileCopyHash: hash, sourceReceiptRefs: z.array(geoSourceReceiptRefSchema).max(32), generatorVersion: z.string().min(1).max(128), payload: z.unknown().transform(parseGeoKbPayloadV2), questionSet: z.unknown().transform(parseGeoQuestionSetV2), context: z.unknown().transform(parseGeoSnapshotContextV2), candidateHash: hash }).strict();
export function parseGeoPreparedCandidate(value: unknown): GeoPreparedCandidateV1 {
  if (geoV2JsonbBytes(value) > GEO_PREPARED_CANDIDATE_MAX_BYTES) throw new Error("Prepared candidate exceeds byte limit");
  const parsed = schema.parse(value), { candidateHash, ...body } = parsed;
  assertGeoProfileCopyIntegrity(parsed.payload.profileCopy);
  if (geoV2Digest(body) !== candidateHash || geoV2Digest(parsed.payload) !== parsed.baseDraftHash || geoV2Digest(parsed.payload.profileCopy) !== parsed.profileCopyHash) throw new Error("Prepared input/hash mismatch");
  if (parsed.context.kbId !== parsed.kbId || parsed.context.candidateId !== parsed.candidateId || parsed.generatorVersion !== parsed.questionSet.methodVersion || canonicalGeoV2Text(parsed.sourceReceiptRefs) !== canonicalGeoV2Text(parsed.context.sourceReceiptRefs)) throw new Error("Prepared scope/source mismatch");
  const expected = buildGeoSnapshotContextV2({
    candidateId: parsed.candidateId, kbId: parsed.kbId, payload: parsed.payload, questionSet: parsed.questionSet,
    sourceReceiptRefs: parsed.sourceReceiptRefs, evidenceCatalog: parsed.context.evidenceCatalog, sourceSummary: parsed.context.sourceSummary,
    competitorEvidence: parsed.context.competitorEvidence,
    modelRoleEdits: Object.fromEntries(parsed.context.roles.map(role => [role.roleId, role.userEdited])),
    // This verifies the sealed projection against its payload. The writer must
    // separately resolve the exact owned receipt before granting crawl support.
    verifiedFactSupport: parsed.context.facts.flatMap(fact => fact.source === "crawl" && fact.supportRef && fact.value !== null && fact.sourceUrl !== null && fact.observedAt !== null ? [{ ...fact.supportRef, key: fact.key, value: fact.value, sourceUrl: fact.sourceUrl, observedAt: fact.observedAt }] : []),
  });
  if (canonicalGeoV2Text(expected) !== canonicalGeoV2Text(parsed.context)) throw new Error("Prepared context differs from its exact content/policy");
  return parsed;
}
export function createGeoPreparedCandidate(body: GeoPreparedCandidateBody): GeoPreparedCandidateV1 { return parseGeoPreparedCandidate({ ...body, candidateHash: geoV2Digest(body) }); }
