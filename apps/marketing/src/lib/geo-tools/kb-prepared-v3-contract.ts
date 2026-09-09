// @input -- one published v3 candidate: reviewed payload, optional question set, optional knowledge pack
// @output -- strict v3 candidate parsing with every cross-part identity checked fail-closed
// @pos -- server-side publish-time validation; v1/v2 candidates keep their own parsers and hashes

/**
 * A v3 candidate is what "publish" writes, and publish makes no model call: it
 * assembles a version out of parts that already exist and binds them together
 * by hash. Everything this file checks is therefore a binding, not a judgement.
 *
 * Two of the parts may be missing, and the difference matters:
 *
 *   questionSet    may be `unavailable`. The question step is optional in v3,
 *                  so a run whose roles never materialised still publishes.
 *   knowledgePack  may be `null`, when the knowledge step itself failed.
 *
 * What may not happen is both at once. A version with neither knowledge nor
 * questions has nothing a consumer could read, so publishing one would produce
 * a version whose only content is the claim that a version exists.
 */
import { z } from "zod";

import { geoV2Digest } from "./kb-v2-digest.ts";
import { canonicalGeoV2Text, geoV2JsonbBytes } from "./kb-v2-json.ts";
import { parseGeoQuestionSetV2, type GeoQuestionSetV2 } from "./kb-question-set-v2.ts";
import { parseGeoKnowledgePackV2, type GeoKnowledgePackV2 } from "./kb-knowledge-pack-v2-contract.ts";
import { geoV3ItemKeys, parseGeoKbPayloadV3, type GeoKbPayloadV3 } from "./kb-v3-contract.ts";
import {
  GEO_ABSENT_QUESTION_SET_HASH,
  buildGeoSnapshotContextV3,
  parseGeoSnapshotContextV3,
  type GeoSnapshotContextV3,
} from "./snapshot-context-v3.ts";

export const GEO_PREPARED_CANDIDATE_V3_SCHEMA = "marketing-geo-prepared-candidate.v3" as const;

/** Same ceiling as v2: a bounded payload plus one <=512KiB knowledge pack and one question set. */
export const GEO_PREPARED_CANDIDATE_V3_MAX_BYTES = 2_359_296;
export const GEO_PREPARED_CANDIDATE_V3_MAX_RECEIPTS = 32;

const hash = z.string().regex(/^[a-f0-9]{64}$/u);

// Deliberately not `z.uuid()` and not a `[1-5]` version nibble: the identities
// in this product are UUIDv8, and a version-pinning validator rejects all of
// them. That is also why the v2 receipt-ref schema is re-declared below instead
// of imported -- its `z.string().uuid()` pins a version this product does not
// always mint.
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu);

export const geoSourceReceiptRefV3Schema = z.object({ receiptId: uuid, contentHash: hash }).strict();
export type GeoSourceReceiptRefV3 = z.infer<typeof geoSourceReceiptRefV3Schema>;

/**
 * Why a version has no question set. Each value names a distinct outcome, and
 * `outcome_unknown` is deliberately separate from `generation_unavailable`: a
 * call that may have been billed must never be recorded as one that failed.
 */
export const geoQuestionSetUnavailableReasonSchema = z.enum([
  "roles_missing",
  "generation_unavailable",
  "outcome_unknown",
  "unsupported_language",
  "not_attempted",
]);
export type GeoQuestionSetUnavailableReason = z.infer<typeof geoQuestionSetUnavailableReasonSchema>;

const questionSetSlotSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("available"),
    value: z.unknown().transform((value) => parseGeoQuestionSetV2(value)),
  }).strict(),
  z.object({
    status: z.literal("unavailable"),
    reason: geoQuestionSetUnavailableReasonSchema,
    /**
     * The generation record that failed, when there was one. `not_attempted`
     * and `roles_missing` have no record to point at, and inventing one would
     * claim a paid call that never happened.
     */
    failedGenerationId: uuid.nullable(),
  }).strict(),
]);

export type GeoCandidateQuestionSetV3 =
  | { readonly status: "available"; readonly value: GeoQuestionSetV2 }
  | { readonly status: "unavailable"; readonly reason: GeoQuestionSetUnavailableReason; readonly failedGenerationId: string | null };

const candidateSchema = z.object({
  schemaVersion: z.literal(GEO_PREPARED_CANDIDATE_V3_SCHEMA),
  /**
   * Minted by publish, not inherited from a generation. The same locked run can
   * be published more than once -- correct an item, publish again -- so a
   * candidate identity tied to the question generation would collide on the
   * second publish.
   */
  candidateId: uuid,
  kbId: uuid,
  baseDraftVersion: z.string().regex(/^[1-9][0-9]{0,15}$/u).refine((value) => Number.isSafeInteger(Number(value))),
  baseDraftHash: hash,
  payload: z.unknown().transform((value) => parseGeoKbPayloadV3(value)),
  questionSet: questionSetSlotSchema,
  context: z.unknown().transform((value) => parseGeoSnapshotContextV3(value)),
  /** Null when the knowledge step failed; the question set then has to carry the version. */
  knowledgePack: z.unknown().transform((value) => {
    if (value === null) return null;
    if (value === undefined) throw new Error("Knowledge pack must be present or explicitly null");
    return parseGeoKnowledgePackV2(value);
  }),
  generationInputHash: hash,
  reviewHash: hash,
  sourceReceiptRefs: z.array(geoSourceReceiptRefV3Schema).max(GEO_PREPARED_CANDIDATE_V3_MAX_RECEIPTS),
  candidateHash: hash,
}).strict();

export type GeoPreparedCandidateV3 = Omit<z.infer<typeof candidateSchema>, "questionSet" | "knowledgePack"> & {
  readonly questionSet: GeoCandidateQuestionSetV3;
  readonly knowledgePack: GeoKnowledgePackV2 | null;
};
export type GeoPreparedCandidateBodyV3 = Omit<GeoPreparedCandidateV3, "candidateHash">;

/** The hash the run locks after the roles step and every reused generation record carries. */
export function geoGenerationInputHashV3(payload: GeoKbPayloadV3): string {
  return geoV2Digest(payload.generationInput);
}

/** The review is hashed separately so an owner decision never changes generation identity. */
export function geoReviewHashV3(payload: GeoKbPayloadV3): string {
  return geoV2Digest(payload.review);
}

function moduleValue<T>(module: { readonly status: string; readonly value?: T }): T | null {
  return "value" in module ? module.value ?? null : null;
}

/** Every item key the published pack carries, in a stable walk order. */
export function geoKnowledgePackV2ItemKeys(pack: GeoKnowledgePackV2): readonly string[] {
  const keys: string[] = [];
  const entity = moduleValue(pack.entity);
  if (entity) for (const field of entity.fields) keys.push(field.itemKey);
  for (const fact of moduleValue(pack.facts) ?? []) keys.push(fact.itemKey);
  for (const item of moduleValue(pack.qa) ?? []) keys.push(item.itemKey);
  for (const comparison of moduleValue(pack.comparisons) ?? []) for (const row of comparison.rows) keys.push(row.itemKey);
  const scope = moduleValue(pack.scope);
  if (scope) for (const items of Object.values(scope)) for (const item of items) keys.push(item.itemKey);
  return keys;
}

function assertCanonicalReceiptRefs(refs: readonly GeoSourceReceiptRefV3[]): void {
  if (refs.some((ref) => ref.receiptId !== ref.receiptId.toLowerCase())) throw new Error("Source receipt reference must be canonical");
  if (new Set(refs.map((ref) => ref.receiptId)).size !== refs.length) throw new Error("Duplicate source receipt reference");
  // Code point order, not locale order: a locale-aware sort makes the stored
  // order, and therefore the candidate hash, depend on where the writer ran.
  for (let index = 1; index < refs.length; index += 1) {
    if (!(refs[index - 1]!.receiptId < refs[index]!.receiptId)) throw new Error("Source receipt references must be sorted by receipt id");
  }
}

export function parseGeoPreparedCandidateV3(value: unknown): GeoPreparedCandidateV3 {
  if (geoV2JsonbBytes(value) > GEO_PREPARED_CANDIDATE_V3_MAX_BYTES) throw new Error("Prepared candidate v3 exceeds byte limit");
  const parsed = candidateSchema.parse(value) as GeoPreparedCandidateV3;
  const { payload, context, questionSet, knowledgePack } = parsed;

  // A version nobody can read is not a version.
  if (questionSet.status === "unavailable" && knowledgePack === null) {
    throw new Error("A candidate needs a question set or a knowledge pack");
  }

  assertCanonicalReceiptRefs(parsed.sourceReceiptRefs);

  const payloadHash = geoV2Digest(payload);
  if (payloadHash !== parsed.baseDraftHash) throw new Error("Prepared candidate payload hash mismatch");
  if (context.kbId !== parsed.kbId || context.payloadHash !== payloadHash) throw new Error("Prepared candidate scope mismatch");

  const expectedQuestionSetHash = questionSet.status === "available"
    ? geoV2Digest(questionSet.value)
    : GEO_ABSENT_QUESTION_SET_HASH;
  if (context.questionSetHash !== expectedQuestionSetHash) throw new Error("Prepared candidate question set hash mismatch");

  if (parsed.generationInputHash !== geoGenerationInputHashV3(payload)
    || payload.runRef.generationInputHash !== parsed.generationInputHash) {
    throw new Error("Prepared candidate generation input hash mismatch");
  }
  if (parsed.reviewHash !== geoReviewHashV3(payload)) throw new Error("Prepared candidate review hash mismatch");

  if (knowledgePack !== null) {
    const market = payload.generationInput.identity.market;
    if (knowledgePack.meta.market !== market.country || knowledgePack.meta.language !== market.language) {
      throw new Error("Prepared knowledge pack scope mismatch");
    }
    // Publishing may drop items and may relabel a decision. It may not mint an
    // item: everything in the pack has to be something the reviewed draft
    // actually contains.
    const draftKeys = new Set(geoV3ItemKeys(payload.knowledge));
    const excluded = new Set(payload.review.decisions.filter((decision) => decision.decision === "excluded").map((decision) => decision.itemKey));
    for (const key of geoKnowledgePackV2ItemKeys(knowledgePack)) {
      if (!draftKeys.has(key)) throw new Error("Published item is not in the reviewed draft");
      if (excluded.has(key)) throw new Error("Published item was excluded by the owner");
    }
  }

  /**
   * The context is re-derived rather than trusted. Everything but the evidence
   * refs comes from the payload, the question set and the kb id, so this
   * compares two independently produced objects instead of comparing the
   * context with itself. The evidence refs are the one part the payload does
   * not carry -- they name observations, not claims -- so they are taken from
   * the context and checked only for shape and order.
   */
  const expectedContext = buildGeoSnapshotContextV3({
    kbId: parsed.kbId,
    payload,
    questionSet: questionSet.status === "available" ? questionSet.value : null,
    evidenceRefs: context.evidenceRefs,
  });
  if (canonicalGeoV2Text(expectedContext) !== canonicalGeoV2Text(context satisfies GeoSnapshotContextV3)) {
    throw new Error("Prepared context differs from its exact content/policy");
  }

  const { candidateHash, ...body } = parsed;
  if (geoV2Digest(body) !== candidateHash) throw new Error("Prepared candidate hash mismatch");
  return parsed;
}

export function createGeoPreparedCandidateV3(body: GeoPreparedCandidateBodyV3): GeoPreparedCandidateV3 {
  return parseGeoPreparedCandidateV3({ ...body, candidateHash: geoV2Digest(body) });
}

export function isGeoPreparedCandidateV3(value: unknown): boolean {
  return value !== null && typeof value === "object" && "schemaVersion" in value
    && (value as { schemaVersion?: unknown }).schemaVersion === GEO_PREPARED_CANDIDATE_V3_SCHEMA;
}
