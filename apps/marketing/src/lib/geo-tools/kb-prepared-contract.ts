// @input -- one persisted candidate assembled from a saved draft and exact source selections
// @output -- fully bound, independently readable candidate, never a live regeneration
// @pos -- server-side prepared-candidate validation before persistence/freeze
import { z } from "zod";
import { normalizeAccountWebsiteUrl } from "../account-websites/contracts.ts";
import { parseGeoKbPayloadV2, type GeoKbPayloadV2 } from "./kb-v2-contract.ts";
import { parseGeoQuestionSetV2, type GeoQuestionSetV2 } from "./kb-question-set-v2.ts";
import { parseGeoSnapshotContextV2, buildGeoSnapshotContextV2, geoSourceReceiptRefSchema, type GeoSnapshotContextV2, type GeoSourceReceiptRef } from "./snapshot-context-v2.ts";
import { assertGeoProfileCopyIntegrity } from "./kb-profile-copy-server.ts";
import { canonicalGeoV2Text, geoV2JsonbBytes } from "./kb-v2-json.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { parseGeoKnowledgePackV1, type GeoKnowledgePackV1 } from "./kb-knowledge-pack-contract.ts";
import { parseGeoKnowledgeSynthesisInputV1, type GeoKnowledgeSynthesisInputV1 } from "./kb-knowledge-synthesis-contract.ts";

export const GEO_PREPARED_CANDIDATE_SCHEMA = "marketing-geo-prepared-candidate.v1" as const;
export const GEO_PREPARED_CANDIDATE_V2_SCHEMA = "marketing-geo-prepared-candidate.v2" as const;
export const GEO_KNOWLEDGE_GENERATION_INPUT_SCHEMA = "marketing-geo-knowledge-generation-input.v1" as const;
export const GEO_PREPARED_CANDIDATE_MAX_BYTES = 1_572_864;
// V2 admits the bounded v1 candidate plus one <=512KiB knowledge pack and receipts.
export const GEO_PREPARED_CANDIDATE_V2_MAX_BYTES = 2_359_296;
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
export interface GeoPreparedCandidateV2 extends Omit<GeoPreparedCandidateV1, "schemaVersion" | "candidateHash"> {
  readonly schemaVersion: typeof GEO_PREPARED_CANDIDATE_V2_SCHEMA;
  readonly knowledgePack: GeoKnowledgePackV1;
  readonly knowledgeSynthesisInput: GeoKnowledgeSynthesisInputV1;
  readonly knowledgeGeneration: {
    readonly generationId: string;
    readonly inputHash: string;
    readonly synthesisInputHash: string;
    readonly evidenceContentHash: string;
    readonly payloadHash: string;
    readonly questionSetHash: string;
    readonly packHash: string;
    readonly sourceCatalogueHash: string;
    readonly promptVersion: "geo-kb-knowledge-pack.v1";
  };
  readonly candidateHash: string;
}
export type GeoPreparedCandidateV2Body = Omit<GeoPreparedCandidateV2, "candidateHash">;
export type AnyGeoPreparedCandidate = GeoPreparedCandidateV1 | GeoPreparedCandidateV2;
export interface GeoKnowledgeGenerationInputManifest {
  readonly schemaVersion: typeof GEO_KNOWLEDGE_GENERATION_INPUT_SCHEMA;
  readonly kbId: string;
  readonly baseDraftVersion: string;
  readonly baseDraftHash: string;
  readonly profileCopyHash: string;
  readonly sourceReceiptRefs: readonly GeoSourceReceiptRef[];
  readonly knowledgeSynthesisInput: GeoKnowledgeSynthesisInputV1;
}
export interface GeoFreezePreparedInput { readonly candidateId: string; readonly candidateHash: string }
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const schema = z.object({ schemaVersion: z.literal(GEO_PREPARED_CANDIDATE_SCHEMA), candidateId: z.string().uuid(), kbId: z.string().uuid(), baseDraftVersion: z.string().regex(/^[1-9][0-9]{0,15}$/u).refine(value => Number.isSafeInteger(Number(value))), baseDraftHash: hash, profileCopyHash: hash, sourceReceiptRefs: z.array(geoSourceReceiptRefSchema).max(32), generatorVersion: z.string().min(1).max(128), payload: z.unknown().transform(parseGeoKbPayloadV2), questionSet: z.unknown().transform(parseGeoQuestionSetV2), context: z.unknown().transform(parseGeoSnapshotContextV2), candidateHash: hash }).strict();
const v2Schema = schema.omit({ schemaVersion: true, candidateHash: true }).extend({
  schemaVersion: z.literal(GEO_PREPARED_CANDIDATE_V2_SCHEMA),
  knowledgePack: z.unknown().transform(parseGeoKnowledgePackV1),
  knowledgeSynthesisInput: z.unknown().transform(parseGeoKnowledgeSynthesisInputV1),
  knowledgeGeneration: z.object({ generationId: z.string().uuid(), inputHash: hash, synthesisInputHash: hash, evidenceContentHash: hash, payloadHash: hash, questionSetHash: hash, packHash: hash, sourceCatalogueHash: hash, promptVersion: z.literal("geo-kb-knowledge-pack.v1") }).strict(),
  candidateHash: hash,
}).strict();
function canonicalReceiptRefs(value: readonly GeoSourceReceiptRef[]): GeoSourceReceiptRef[] {
  const refs = z.array(geoSourceReceiptRefSchema).max(32).parse(value).map(ref => ({ ...ref })).sort((left, right) => left.receiptId.localeCompare(right.receiptId));
  if (refs.some(ref => ref.receiptId !== ref.receiptId.toLocaleLowerCase("en"))) throw new Error("Source receipt reference must be canonical");
  if (new Set(refs.map(ref => ref.receiptId)).size !== refs.length) throw new Error("Duplicate source receipt reference");
  return refs;
}
export function buildGeoKnowledgeGenerationInputManifest(value: Pick<GeoPreparedCandidateV2, "kbId" | "baseDraftVersion" | "baseDraftHash" | "profileCopyHash" | "sourceReceiptRefs" | "knowledgeSynthesisInput">): GeoKnowledgeGenerationInputManifest {
  return { schemaVersion: GEO_KNOWLEDGE_GENERATION_INPUT_SCHEMA, kbId: value.kbId, baseDraftVersion: value.baseDraftVersion, baseDraftHash: value.baseDraftHash, profileCopyHash: value.profileCopyHash, sourceReceiptRefs: canonicalReceiptRefs(value.sourceReceiptRefs), knowledgeSynthesisInput: value.knowledgeSynthesisInput };
}
export function geoKnowledgeGenerationInputHash(value: Pick<GeoPreparedCandidateV2, "kbId" | "baseDraftVersion" | "baseDraftHash" | "profileCopyHash" | "sourceReceiptRefs" | "knowledgeSynthesisInput">): string { return geoV2Digest({ kind: "knowledge_pack", input: buildGeoKnowledgeGenerationInputManifest(value) }); }
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
export function parseGeoPreparedCandidateV2(value: unknown): GeoPreparedCandidateV2 {
  if (geoV2JsonbBytes(value) > GEO_PREPARED_CANDIDATE_V2_MAX_BYTES) throw new Error("Prepared candidate v2 exceeds byte limit");
  const parsed = v2Schema.parse(value), { candidateHash, knowledgePack, knowledgeGeneration, knowledgeSynthesisInput, ...v1Body } = parsed;
  parseGeoPreparedCandidate({ ...v1Body, schemaVersion: GEO_PREPARED_CANDIDATE_SCHEMA, candidateHash: geoV2Digest({ ...v1Body, schemaVersion: GEO_PREPARED_CANDIDATE_SCHEMA }) });
  const availableSources = knowledgePack.sourceCatalogue.filter(source => source.availability !== "unavailable");
  if (knowledgePack.meta.market !== parsed.payload.market.country || knowledgePack.meta.language !== parsed.payload.market.language || knowledgePack.sourceCatalogue.length === 0 || normalizeAccountWebsiteUrl(knowledgeSynthesisInput.targetUrl)?.submittedUrl !== normalizeAccountWebsiteUrl(parsed.payload.targetUrl)?.submittedUrl || knowledgeSynthesisInput.officialName !== parsed.payload.officialName || canonicalGeoV2Text(knowledgeSynthesisInput.aliases) !== canonicalGeoV2Text(parsed.payload.aliases) || canonicalGeoV2Text(knowledgeSynthesisInput.categoryTerms) !== canonicalGeoV2Text(parsed.payload.categoryTerms) || knowledgeSynthesisInput.market !== parsed.payload.market.country || knowledgeSynthesisInput.language !== parsed.payload.market.language || canonicalGeoV2Text(knowledgeSynthesisInput.confirmedCompetitors) !== canonicalGeoV2Text(parsed.payload.competitors.filter(competitor => competitor.confirmed).map(competitor => ({ key: competitor.domain, name: competitor.brandName, confirmed: true }))) || canonicalGeoV2Text(knowledgeSynthesisInput.sourceCatalogue) !== canonicalGeoV2Text(availableSources)) throw new Error("Prepared knowledge pack scope mismatch");
  if (knowledgeGeneration.synthesisInputHash !== knowledgeSynthesisInput.contentHash || knowledgeGeneration.evidenceContentHash !== knowledgeSynthesisInput.evidenceContentHash || knowledgeGeneration.payloadHash !== parsed.baseDraftHash || knowledgeGeneration.questionSetHash !== parsed.context.questionSetHash || knowledgeGeneration.packHash !== knowledgePack.contentHash || knowledgeGeneration.sourceCatalogueHash !== geoV2Digest(knowledgePack.sourceCatalogue)) throw new Error("Prepared knowledge generation identity mismatch");
  if (knowledgeGeneration.inputHash !== geoKnowledgeGenerationInputHash(parsed)) throw new Error("Prepared knowledge generation input hash mismatch");
  const targetHost = new URL(parsed.payload.targetUrl).host, competitors = new Map(parsed.payload.competitors.filter(competitor => competitor.confirmed).map(competitor => [competitor.domain, competitor.brandName]));
  for (const source of knowledgePack.sourceCatalogue) { if (["own_page", "robots", "sitemap", "llms"].includes(source.kind) && source.url !== null && new URL(source.url).host !== targetHost) throw new Error("Foreign knowledge source"); if (source.kind === "competitor_page" && (source.competitor === null || source.url === null || competitors.get(source.competitor.key) !== source.competitor.name || new URL(source.url).host !== source.competitor.key)) throw new Error("Foreign knowledge competitor source"); }
  if (knowledgePack.entity.status !== "unavailable" && (knowledgePack.entity.value.name !== parsed.payload.officialName || canonicalGeoV2Text(knowledgePack.entity.value.aliases) !== canonicalGeoV2Text(parsed.payload.aliases) || knowledgePack.entity.value.categories.primary !== parsed.payload.categoryTerms[0] || canonicalGeoV2Text(knowledgePack.entity.value.categories.secondary) !== canonicalGeoV2Text(parsed.payload.categoryTerms.slice(1)))) throw new Error("Knowledge entity differs from payload");
  const { candidateHash: _candidateHash, ...body } = parsed;
  if (geoV2Digest(body) !== candidateHash) throw new Error("Prepared knowledge candidate hash mismatch");
  return parsed;
}
export function parseAnyGeoPreparedCandidate(value: unknown): AnyGeoPreparedCandidate {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid prepared candidate");
  const schemaVersion = (value as { schemaVersion?: unknown }).schemaVersion;
  if (schemaVersion === GEO_PREPARED_CANDIDATE_SCHEMA) return parseGeoPreparedCandidate(value);
  if (schemaVersion === GEO_PREPARED_CANDIDATE_V2_SCHEMA) return parseGeoPreparedCandidateV2(value);
  throw new Error("Unknown prepared candidate schema");
}
export function createGeoPreparedCandidateV2(body: GeoPreparedCandidateV2Body): GeoPreparedCandidateV2 { return parseGeoPreparedCandidateV2({ ...body, candidateHash: geoV2Digest(body) }); }
