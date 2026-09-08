// @input -- one succeeded V3 question generation: the run it belongs to and the set it produced
// @output -- a hashed, self-validating question-generation result the publish path can read back
// @pos -- succeeded-result persistence contract; it mints no candidate and reads no draft

/**
 * `marketing-geo-question-generation-result.v1` is what a V3 question run
 * writes and what publishing later reads back.
 *
 * V1 and V2 question runs finished by minting a prepared candidate, so their
 * result *was* the candidate and the candidate contracts validated it. A V3 run
 * produces only the question set -- the candidate is assembled later, out of the
 * reviewed draft, by the publish action -- so this shape had no parser at all
 * and lived as a bare string literal in the publish handler and in SQL. This
 * file is that parser, and the builder that produces the shape it accepts.
 *
 * What it deliberately does NOT decide is whether the set may be published.
 * Two bindings decide that, and neither belongs here:
 *
 *   generationInputHash vs the draft's `runRef`. A set generated against other
 *     inputs is not this version's, and the publish path answers that with
 *     `input_changed` -- an actionable refusal -- rather than with "the store
 *     is broken". Folding the comparison in here would collapse the two.
 *   baseDraftVersion / baseDraftHash. These name the draft as it stood when the
 *     run was dispatched. Reviewing moves the draft on, and publishing moves it
 *     on again by sweeping the undecided items, so publish must NOT require
 *     either to match the draft it is publishing. They are recorded because
 *     `marketing_geo_finish_generation` pins them to the generation input at
 *     write time; re-checking them against a later draft would refuse every
 *     reviewed publish.
 *
 * Where this file and the database disagree, and why:
 *
 *   Only SQL can check the external bindings -- that `generationId` is the row
 *     being finished, that `kbId` is the row's knowledge base, and that
 *     `baseDraftVersion` / `baseDraftHash` / `generationInputHash` /
 *     `sourceReceiptRefs` are exactly what the generation *input* recorded.
 *     Nothing in a stored result can prove that about itself, so
 *     `assertGeoQuestionGenerationResultBinding` re-checks the two a reader
 *     already holds (kb and generation id) and the rest stays SQL's.
 *   Only this file can check the question set. SQL looks at
 *     `questionSet.schemaVersion` and stops; `parseGeoQuestionSetV2` checks the
 *     whole grammar -- calibration authority, evidence and entity references,
 *     duplicate identities, and its own 256KiB ceiling.
 *   This file is stricter about unknown keys. The result CHECK constraint pins
 *     named keys and a byte ceiling but does not count them, so SQL would store
 *     a result carrying an extra field (the hash covers it, so it stays
 *     self-consistent). `.strict()` here refuses it instead, because the only
 *     writer of this shape is `buildGeoQuestionGenerationResultV1` and a key it
 *     did not write is drift, not data.
 *   This file is stricter about receipt references: canonical lowercase ids,
 *     no duplicates, sorted by code point, at most 32. SQL only requires the
 *     result's array to equal the input's, so whatever builds the matching
 *     `marketing-geo-question-generation-input.v3` has to hold the same order.
 *   Nowhere is this file *looser* than SQL, and one place used to be. `kbId`
 *     and `generationId` were matched case-insensitively while SQL compares
 *     them against `p_kb_id::text` / `p_generation_id::text`, which PostgreSQL
 *     renders lowercase always. The builder therefore minted results the
 *     database refuses: self-consistent, correctly hashed, and answered with
 *     `invalid_result` -- discarding the model call. Both are lowercase-only
 *     now, as the receipt ids beside them already were.
 *
 * What a producer must supply. Nothing calls the builder yet -- the assembly
 * bridge and the preparer's `questions` branch are being written separately --
 * so this is the whole of its obligation:
 *
 *   `generationId` and `kbId`: canonical lowercase, and respectively the
 *     generation row being finished and the knowledge base it belongs to. SQL
 *     compares both against the uuid parameters `finish` was called with.
 *   `baseDraftVersion`, `baseDraftHash`, `generationInputHash` and
 *     `sourceReceiptRefs`: copied verbatim out of the
 *     `marketing-geo-question-generation-input.v3` the run locked, receipts in
 *     that array's order. SQL compares the arrays with jsonb equality, which is
 *     order-sensitive, and compares the other three as text.
 *   `questionSet`: a set `parseGeoQuestionSetV2` accepts. SQL checks only that
 *     it is an object naming `marketing-geo-question-set.v2`.
 *   And then the object the builder *returned* has to be what is stored, key
 *     for key and value for value. `contentHash` is the digest of that body and
 *     SQL recomputes it as `marketing_geo_json_hash(result - 'contentHash')`,
 *     so anything added, dropped or altered after the builder returned makes
 *     the stored hash wrong and throws the model call away.
 *
 *     Re-serialising the same content is NOT one of those hazards, and an
 *     earlier version of this paragraph claimed it was -- "the digest is over
 *     the parsed body, which `parseGeoQuestionSetV2` may normalise". It does
 *     not normalise: every object in the chain is `.strict()`, and there is no
 *     `.transform()`, `.default()`, `.catch()` or coercion anywhere in it, so a
 *     parsed set is the set that was handed in. `canonicalGeoV2Text` sorts keys
 *     as well, so member order cannot move the digest either. Hashing the
 *     parsed body instead of the raw one is therefore an equivalent mutant
 *     today, and no test could have caught it -- claiming otherwise invented a
 *     safety margin that was never there. What holds the claim up now is the
 *     test "returns a body whose digest is the hash it verified": introduce a
 *     normalisation and that fails first, and this paragraph has to change with
 *     it.
 */
import { z } from "zod";

import { parseGeoQuestionSetV2, type GeoQuestionSetV2 } from "./kb-question-set-v2.ts";
import { geoSourceReceiptRefV3Schema, type GeoSourceReceiptRefV3 } from "./kb-prepared-v3-contract.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { geoV2JsonbBytes } from "./kb-v2-json.ts";

export const GEO_QUESTION_GENERATION_RESULT_SCHEMA =
  "marketing-geo-question-generation-result.v1" as const;

/**
 * `octet_length(result::text)` in `marketing_geo_kb_generations_result_check`,
 * for this schema's clause. Read back out of the migration by this file's test
 * rather than copied by hand: a ceiling that drifts above SQL's admits results
 * the database then refuses to store.
 */
export const GEO_QUESTION_GENERATION_RESULT_MAX_BYTES = 393_216;
/**
 * This file's own ceiling, not SQL's -- see the divergence note above. Nothing
 * in the database counts the array, so only the test below holds this number.
 */
export const GEO_QUESTION_GENERATION_RESULT_MAX_RECEIPTS = 32;

export interface GeoQuestionGenerationResultBodyV1 {
  readonly schemaVersion: typeof GEO_QUESTION_GENERATION_RESULT_SCHEMA;
  readonly generationId: string;
  readonly kbId: string;
  readonly baseDraftVersion: string;
  readonly baseDraftHash: string;
  readonly generationInputHash: string;
  readonly sourceReceiptRefs: readonly GeoSourceReceiptRefV3[];
  readonly questionSet: GeoQuestionSetV2;
}

export interface GeoQuestionGenerationResultV1 extends GeoQuestionGenerationResultBodyV1 {
  readonly contentHash: string;
}

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
// Not `z.uuid()`: the identities in this product are UUIDv8 and a
// version-pinning validator rejects every one of them. Lowercase only, and
// deliberately NOT case-insensitive: `marketing_geo_finish_generation` compares
// `p_result->>'kbId'` with `p_kb_id::text` and `p_result->>'generationId'` with
// `p_generation_id::text`, and PostgreSQL renders a uuid in lowercase always.
// An uppercase id builds a perfectly self-consistent, correctly hashed result
// that `finish` then answers `invalid_result` to -- throwing away the model call
// that produced it, with no diagnosable reason recorded. Minting one is the
// single most expensive thing this file could do, so it refuses instead.
//
// All five groups, and each of them separately. A fully uppercased id is
// refused by whichever group is still strict, so `[0-9a-fA-F]` on a single
// group -- the first repair someone reaches for -- passes a test that only ever
// feeds `toUpperCase()`. The group widths have the same shape: `{8}` widened on
// the first group is invisible to a case that lengthens the last. The tests are
// written per group for both reasons.
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);

const bodySchema = z.object({
  schemaVersion: z.literal(GEO_QUESTION_GENERATION_RESULT_SCHEMA),
  generationId: uuid,
  kbId: uuid,
  baseDraftVersion: z.string().regex(/^[1-9][0-9]{0,15}$/u)
    .refine((value) => Number.isSafeInteger(Number(value))),
  baseDraftHash: hash,
  generationInputHash: hash,
  sourceReceiptRefs: z.array(geoSourceReceiptRefV3Schema)
    .max(GEO_QUESTION_GENERATION_RESULT_MAX_RECEIPTS),
  questionSet: z.unknown().transform((value) => parseGeoQuestionSetV2(value)),
}).strict();

// `.extend()` carries `bodySchema`'s unknown-key policy, so strictness is
// declared once, above. Repeating it here would leave a guard that no single
// revert can turn a test red.
const resultSchema = bodySchema.extend({ contentHash: hash });

function assertCanonicalReceiptRefs(refs: readonly GeoSourceReceiptRefV3[]): void {
  if (refs.some((ref) => ref.receiptId !== ref.receiptId.toLowerCase())) {
    throw new Error("Source receipt reference must be canonical");
  }
  if (new Set(refs.map((ref) => ref.receiptId)).size !== refs.length) {
    throw new Error("Duplicate source receipt reference");
  }
  // Code point order, not locale order: a locale-aware sort makes the stored
  // order, and therefore the result hash, depend on where the writer ran.
  for (let index = 1; index < refs.length; index += 1) {
    if (!(refs[index - 1]!.receiptId < refs[index]!.receiptId)) {
      throw new Error("Source receipt references must be sorted by receipt id");
    }
  }
}

/**
 * The digest the database recomputes as
 * `marketing_geo_json_hash(result - 'contentHash')`, over the body alone.
 */
export function geoQuestionGenerationResultHash(body: unknown): string {
  return geoV2Digest(body);
}

export function parseGeoQuestionGenerationResultV1(value: unknown): GeoQuestionGenerationResultV1 {
  if (geoV2JsonbBytes(value) > GEO_QUESTION_GENERATION_RESULT_MAX_BYTES) {
    throw new Error("Question generation result exceeds byte limit");
  }
  const { contentHash, ...body } = resultSchema.parse(value);
  assertCanonicalReceiptRefs(body.sourceReceiptRefs);
  // Hashed over the value as it was stored rather than over the reparsed body.
  // Be honest about what that buys today: nothing observable. Nothing in the
  // chain normalises -- see the producer note above -- so the two digests are
  // provably equal and swapping them is an equivalent mutant. It is still the
  // right side to hash, because the database hashes `result - 'contentHash'`
  // and agreeing with it exactly is the only reason this hash exists; if a
  // normalisation is ever introduced this stays correct while the other choice
  // would start returning bodies whose own digest is not their `contentHash`.
  const { contentHash: _stored, ...rawBody } = value as Record<string, unknown>;
  if (geoQuestionGenerationResultHash(rawBody) !== contentHash) {
    throw new Error("Question generation result hash mismatch");
  }
  return { ...body, contentHash };
}

export function buildGeoQuestionGenerationResultV1(value: unknown): GeoQuestionGenerationResultV1 {
  // Not re-checked here: `parseGeoQuestionGenerationResultV1` below is the one
  // place the body is judged, so a guard cannot be removed from one path and
  // stay alive in the other.
  const body = bodySchema.parse(value);
  return parseGeoQuestionGenerationResultV1({
    ...body,
    contentHash: geoQuestionGenerationResultHash(body),
  });
}

/**
 * The two bindings a reader already holds. Whoever reads a result read it *by*
 * generation id, for one knowledge base, so a record naming a different one is
 * a store inconsistency -- never a version without questions.
 */
export function assertGeoQuestionGenerationResultBinding(
  result: GeoQuestionGenerationResultV1,
  binding: { readonly kbId: string; readonly generationId: string },
): void {
  // Asymmetric on purpose. The stored ids are canonical already -- the parser
  // refuses any other casing -- and lowercasing that side too would re-open the
  // hole the `uuid` validator closes.
  //
  // The reader's side is normalised, and the two halves do not earn it equally.
  // An earlier note said both "arrive from a request"; at the only caller,
  // `kb-v3-publish-handler.ts`, neither quite does:
  //
  //   `generationId` comes out of the stored draft
  //     (`runRef.questionsGenerationId`), and `kb-v3-contract.ts` admits that
  //     payload with a case-insensitive uuid -- so a draft recording an
  //     uppercase generation id is a legal draft that this call is what keeps
  //     from reading as a store inconsistency and answering 503. Only the
  //     contract says so today: nothing in the repository writes that field
  //     non-null yet (the branch that will is being written separately), so the
  //     shape is admissible rather than observed.
  //   `kbId` does arrive from a request, but that handler has already refused
  //     the request unless the caller's kbId is byte-identical to the row's own
  //     id, so it is canonical before it gets here. This half cannot be
  //     required at this caller at all. It is kept because it costs nothing and
  //     because a future reader without that check would otherwise get 503 --
  //     named as defence, not counted as a live path.
  if (result.kbId !== binding.kbId.toLowerCase()) {
    throw new Error("Question generation result kb scope mismatch");
  }
  if (result.generationId !== binding.generationId.toLowerCase()) {
    throw new Error("Question generation result generation mismatch");
  }
}
