import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  assertGeoQuestionGenerationResultBinding,
  buildGeoQuestionGenerationResultV1,
  geoQuestionGenerationResultHash,
  parseGeoQuestionGenerationResultV1,
  GEO_QUESTION_GENERATION_RESULT_MAX_BYTES,
  GEO_QUESTION_GENERATION_RESULT_MAX_RECEIPTS,
  GEO_QUESTION_GENERATION_RESULT_SCHEMA,
} from "./kb-question-generation-contract.ts";
import { questionSetV2 } from "./kb-v2.test-fixtures.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { geoV2JsonbBytes } from "./kb-v2-json.ts";

// A hex letter in EVERY one of the five uuid groups, not merely somewhere in
// the id. `toUpperCase()` on a whole id is refused by whichever group is still
// lowercase-only, so a fixture whose middle groups are all digits makes a
// casing claim about those groups true by accident -- which is exactly how a
// per-group `[0-9a-fA-F]` survives an otherwise convincing test. The per-group
// cases below assert that each edit really did change the string, so an id
// edited back to all-digit groups fails loudly instead of going quiet.
const KB_ID = "a1b2c3d4-e5f6-8a7b-9c8d-1111111111ff";
const GENERATION_ID = "33cc33cc-dd33-8e33-9f33-3333333333ee";
const RECEIPT_A = "4a4a4a4a-4444-8444-8444-4444444444aa";
const RECEIPT_B = "5b5b5b5b-5555-8555-8555-5555555555bb";
// Two more receipts, so an offending member can sit at a middle index with a
// well-formed neighbour on each side -- and so an offending PAIR can sit at
// neither end. A, B, C and D ascend by their first character, which is a digit
// in all four, so uppercasing any group of B leaves the array sorted: the
// casing cases below therefore cannot be rescued by the sort check.
const RECEIPT_C = "6c6c6c6c-6666-8666-8666-6666666666cc";
const RECEIPT_D = "7d7d7d7d-7777-8777-8777-7777777777dd";
const HASH_DRAFT = "a".repeat(64);
const HASH_INPUT = "b".repeat(64);

const UUID_GROUPS = 5;
const ID_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ["kbId", KB_ID],
  ["generationId", GENERATION_ID],
];

/** Rewrites one hyphen-separated group of a uuid, leaving the other four alone. */
function editUuidGroup(id: string, index: number, edit: (group: string) => string): string {
  const groups = id.split("-");
  if (groups.length !== UUID_GROUPS) throw new Error(`Not a uuid: ${id}`);
  return groups.map((group, at) => (at === index ? edit(group) : group)).join("-");
}

const migrationPath = fileURLToPath(
  new URL("../../../supabase/migrations/20260907143000_geo_kb_v3.sql", import.meta.url),
);

/** Exactly the keys `marketing_geo_finish_generation` pins for a V3 run. */
function body(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: GEO_QUESTION_GENERATION_RESULT_SCHEMA,
    generationId: GENERATION_ID,
    kbId: KB_ID,
    baseDraftVersion: "1",
    baseDraftHash: HASH_DRAFT,
    generationInputHash: HASH_INPUT,
    sourceReceiptRefs: [],
    questionSet: questionSetV2(),
    ...overrides,
  };
}

const built = () => buildGeoQuestionGenerationResultV1(body());

/**
 * Every issue one refusal raised. A refusal that is not the schema's -- the
 * byte ceiling, the hash comparison, the receipt sweep -- is re-thrown rather
 * than reported as an empty issue list, so a case cannot count as proof while
 * passing for an unrelated reason.
 */
function refusalIssues(
  run: () => unknown,
): ReadonlyArray<{ readonly path: string; readonly code: string }> {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  if (thrown === undefined) throw new Error("Expected the contract to refuse this");
  const issues = (thrown as {
    readonly issues?: ReadonlyArray<{ readonly path: readonly PropertyKey[]; readonly code: string }>;
  }).issues;
  if (issues === undefined) throw thrown as Error;
  return issues.map((issue) => ({ path: issue.path.join("."), code: issue.code }));
}

/** The fields one refusal named. */
function refusedFields(run: () => unknown): readonly string[] {
  return refusalIssues(run).map((issue) => issue.path);
}

/**
 * Which guards on one field fired, in order. zod runs a whole check chain even
 * after an early link fails, so this is what separates "the regex refused it"
 * from "the refine refused it" -- the only way to hold a boundary that both of
 * them could plausibly be holding.
 */
function refusedCodes(run: () => unknown, field: string): readonly string[] {
  return refusalIssues(run).filter((issue) => issue.path === field).map((issue) => issue.code);
}

/** A stored result whose body is `overrides`, hashed so only the body is wrong. */
function storedResult(overrides: Record<string, unknown> = {}) {
  const edited = body(overrides);
  return { ...edited, contentHash: geoQuestionGenerationResultHash(edited) };
}

describe("marketing-geo-question-generation-result.v1", () => {
  it("builds the shape the V3 finish branch pins, and reads it back unchanged", () => {
    const result = built();
    expect(Object.keys(result).sort()).toEqual([
      "baseDraftHash",
      "baseDraftVersion",
      "contentHash",
      "generationId",
      "generationInputHash",
      "kbId",
      "questionSet",
      "schemaVersion",
      "sourceReceiptRefs",
    ]);
    expect(result.questionSet.schemaVersion).toBe("marketing-geo-question-set.v2");
    // The same digest SQL recomputes as `marketing_geo_json_hash(result - 'contentHash')`.
    const { contentHash, ...rest } = result;
    expect(contentHash).toBe(geoV2Digest(rest));
    expect(parseGeoQuestionGenerationResultV1(result)).toEqual(result);
  });

  it("returns a body whose digest is the hash it verified", () => {
    // The invariant the file's `contentHash` note depends on: parsing rewrites
    // nothing, so the digest of what the parser RETURNS is the digest it just
    // checked against the stored bytes. Add any normalisation -- a
    // `.transform()`, a `.default()`, a sort "for tidiness" -- and the parser
    // starts handing back a body whose own digest is not its `contentHash`,
    // which is a silent lie no per-field case would notice unless it happened
    // to feed the affected shape.
    //
    // So the fixture is deliberately un-normalised where a normalisation would
    // be tempting: an `entityCatalog` that is NOT in id order. The one-entity
    // fixture every other case uses cannot tell a reordering from an identity.
    const set = questionSetV2();
    const questionSet = {
      ...set,
      entityCatalog: [
        { id: "E2", text: "unpaid bills", kind: "role_pain", roleId: "r1", evidenceRefs: ["manual:r1"] },
        ...set.entityCatalog,
      ],
    };
    const stored = storedResult({ questionSet });
    expect(stored.questionSet.entityCatalog.map((entity) => entity.id)).toEqual(["E2", "E1"]);

    const parsed = parseGeoQuestionGenerationResultV1(stored);
    expect(parsed.questionSet.entityCatalog.map((entity) => entity.id)).toEqual(["E2", "E1"]);
    const { contentHash, ...parsedBody } = parsed;
    expect(geoQuestionGenerationResultHash(parsedBody)).toBe(contentHash);
  });

  it("refuses a result whose body was edited after it was hashed", () => {
    const result = built();
    const { contentHash: _stale, ...edited } = { ...result, baseDraftVersion: "2" };
    expect(() => parseGeoQuestionGenerationResultV1({
      ...edited,
      contentHash: result.contentHash,
    })).toThrow(/hash mismatch/u);
    // Re-hashed it is self-consistent again, and this contract accepts it. The
    // hash proves integrity, never provenance: only the finish branch knows the
    // draft version the generation *input* recorded.
    expect(parseGeoQuestionGenerationResultV1({
      ...edited,
      contentHash: geoQuestionGenerationResultHash(edited),
    }).baseDraftVersion).toBe("2");
  });

  it("refuses an unknown key the database would have stored", () => {
    // The result CHECK constraint pins named keys and a byte ceiling; it does
    // not count them, so a re-hashed extra field is self-consistent to SQL.
    const extended = { ...body(), spentTokens: "412" };
    const stored = { ...extended, contentHash: geoQuestionGenerationResultHash(extended) };
    expect(() => parseGeoQuestionGenerationResultV1(stored)).toThrow();
  });

  it("refuses a result from another shape that landed on a questions row", () => {
    const foreign = { ...body(), schemaVersion: "marketing-geo-prepared-candidate.v2" };
    expect(() => parseGeoQuestionGenerationResultV1({
      ...foreign,
      contentHash: geoQuestionGenerationResultHash(foreign),
    })).toThrow();
  });

  it("refuses a question set SQL would have accepted on its schemaVersion alone", () => {
    // `jsonb_typeof(questionSet)='object' and questionSet.schemaVersion=...` is
    // the whole of the database's opinion about the set. This is that object.
    const bare = { ...body(), questionSet: { schemaVersion: "marketing-geo-question-set.v2" } };
    expect(() => parseGeoQuestionGenerationResultV1({
      ...bare,
      contentHash: geoQuestionGenerationResultHash(bare),
    })).toThrow();

    // And a set that is well-formed but claims calibration no registry granted.
    const set = questionSetV2();
    const uncalibrated = set.questions[0]!;
    const lying = {
      ...body(),
      questionSet: { ...set, questions: [{ ...uncalibrated, calibrated: true }] },
    };
    expect(() => parseGeoQuestionGenerationResultV1({
      ...lying,
      contentHash: geoQuestionGenerationResultHash(lying),
    })).toThrow();
  });

  it("caps the result at the byte ceiling the migration's CHECK constraint sets", () => {
    // Copied by hand once, and a copy is only as good as the thing that rereads
    // it: raised to 2MiB the parser would admit results `finish` cannot store,
    // and every test that builds its oversized input out of this constant would
    // stay green. So the number is read back out of the migration.
    const sql = readFileSync(migrationPath, "utf8");
    const clause = new RegExp(
      `'${GEO_QUESTION_GENERATION_RESULT_SCHEMA.replace(/\./gu, "\\.")}'\\s+and\\s+octet_length\\(result::text\\)<=(\\d+)`,
      "u",
    ).exec(sql);
    expect(clause, "marketing_geo_kb_generations_result_check has no clause for this schema").not.toBeNull();
    expect(Number(clause?.[1])).toBe(GEO_QUESTION_GENERATION_RESULT_MAX_BYTES);
  });

  it("refuses an oversized result before it looks at the grammar, at the exact byte", () => {
    // `geoV2JsonbBytes` models PostgreSQL's own jsonb rendering, the spaces
    // after `:` and `,` included, so the boundary can be named exactly rather
    // than approached. `{"schemaVersion": "xxx"}` costs the padding 21 bytes.
    //
    // These values are not results, and cannot be: `parseGeoQuestionSetV2` caps
    // the set at 256KiB and the wrapper around it is a few hundred bytes, so
    // nothing this contract ACCEPTS can reach a 384KiB ceiling. The guard is a
    // bound on parse cost, not on what may be stored -- it only ever fires on
    // input the grammar would refuse anyway, and that is the honest reading of
    // it.
    const sized = (bytes: number) => ({ schemaVersion: "x".repeat(bytes - 21) });
    expect(geoV2JsonbBytes(sized(GEO_QUESTION_GENERATION_RESULT_MAX_BYTES)))
      .toBe(GEO_QUESTION_GENERATION_RESULT_MAX_BYTES);
    expect(() => parseGeoQuestionGenerationResultV1(sized(GEO_QUESTION_GENERATION_RESULT_MAX_BYTES + 1)))
      .toThrow(/byte limit/u);
    // Exactly at the ceiling it goes on to fail the grammar instead, which is a
    // different sentence: SQL stores what is `<=` the ceiling.
    expect(() => parseGeoQuestionGenerationResultV1(sized(GEO_QUESTION_GENERATION_RESULT_MAX_BYTES)))
      .not.toThrow(/byte limit/u);
    expect(() => parseGeoQuestionGenerationResultV1(sized(GEO_QUESTION_GENERATION_RESULT_MAX_BYTES)))
      .toThrow();

    // The arithmetic above pins the boundary but says nothing about WHAT is
    // measured: measure `value.questionSet` instead of `value` and every
    // assertion so far still holds, because those values have no `questionSet`
    // at all. This one is over the ceiling as a whole while the one member big
    // enough to be mistaken for the subject is far under it.
    const oversizedOuter = {
      ...sized(GEO_QUESTION_GENERATION_RESULT_MAX_BYTES + 1),
      questionSet: questionSetV2(),
    };
    expect(geoV2JsonbBytes(oversizedOuter)).toBeGreaterThan(GEO_QUESTION_GENERATION_RESULT_MAX_BYTES);
    expect(geoV2JsonbBytes(questionSetV2())).toBeLessThan(GEO_QUESTION_GENERATION_RESULT_MAX_BYTES);
    expect(() => parseGeoQuestionGenerationResultV1(oversizedOuter)).toThrow(/byte limit/u);
  });

  it("refuses an uppercase hex digit in any single uuid group", () => {
    // `marketing_geo_finish_generation` compares `p_result->>'kbId'` with
    // `p_kb_id::text` and `p_result->>'generationId'` with
    // `p_generation_id::text`. A uuid renders lowercase there, always, so an
    // uppercase id is a result the database refuses -- after the model call has
    // been made and paid for, with `invalid_result` as the whole explanation.
    // Nothing downstream catches it either: the binding below reads it as equal.
    //
    // The claim has to be made group by group. A fully uppercased id is refused
    // by whichever group is still strict, so `[0-9a-fA-F]` on ONE group -- the
    // precise shape of the bug -- passes a test that only feeds `toUpperCase()`.
    for (const [field, id] of ID_FIELDS) {
      for (let group = 0; group < UUID_GROUPS; group += 1) {
        const value = editUuidGroup(id, group, (part) => part.toUpperCase());
        expect(value, `group ${group} of ${id} carries no hex letter to uppercase`).not.toBe(id);
        const where = `${field} group ${group} = ${value}`;
        expect(refusedFields(() => buildGeoQuestionGenerationResultV1(body({ [field]: value }))), where)
          .toEqual([field]);
        // And one already in the store, re-hashed, so this is the parser's
        // opinion and not the builder's.
        expect(refusedFields(() => parseGeoQuestionGenerationResultV1(storedResult({ [field]: value }))), where)
          .toEqual([field]);
      }
    }
  });

  it("pins the width of every uuid group, from both sides", () => {
    // Same gap as the casing one: `{8}` widened to `{8,20}` on the first group
    // is invisible to a case that only ever lengthens the last.
    for (const [field, id] of ID_FIELDS) {
      for (let group = 0; group < UUID_GROUPS; group += 1) {
        const cases: ReadonlyArray<readonly [string, string]> = [
          ["one hex digit too many", editUuidGroup(id, group, (part) => `${part}a`)],
          ["one hex digit too few", editUuidGroup(id, group, (part) => part.slice(0, -1))],
        ];
        for (const [label, value] of cases) {
          expect(value, `${field} group ${group} ${label} did not change the id`).not.toBe(id);
          expect(
            refusedFields(() => buildGeoQuestionGenerationResultV1(body({ [field]: value }))),
            `${field} group ${group}, ${label} = ${value}`,
          ).toEqual([field]);
        }
      }
    }
  });

  it("refuses a malformed id or hash, and names the field it refused", () => {
    // Without these the `uuid` and `hash` validators can both be replaced by a
    // bare `z.string()` with the suite still green: every other case supplies
    // well-formed values and exercises the comparisons, never the formats.
    const cases: ReadonlyArray<readonly [string, unknown]> = [
      ["generationId", "not-a-uuid"],
      ["generationId", GENERATION_ID.replace(/-/gu, "")],
      // The anchors. Unanchored, both of these read as an id with something
      // stuck to it, and `$` in JavaScript does not forgive a trailing newline
      // the way a multiline flag would.
      ["kbId", ` ${KB_ID}`],
      ["kbId", `${KB_ID}\n`],
      ["baseDraftHash", "g".repeat(64)],
      ["baseDraftHash", HASH_DRAFT.toUpperCase()],
      // Both ends of the length, not only the short one. Neither of these
      // hashes is ever recomputed locally -- they are copied out of the
      // generation input and compared as text by SQL -- so this regex is the
      // whole of what stops a value whose SQL equality can never hold. Bounded
      // below but not above, `[a-f0-9]{64,}` reads as a hash and is not one.
      ["baseDraftHash", `${HASH_DRAFT}a`],
      ["generationInputHash", HASH_INPUT.slice(0, 63)],
      ["generationInputHash", `${HASH_INPUT}00`],
      ["generationInputHash", ` ${HASH_INPUT}`],
      ["generationInputHash", `${HASH_INPUT}\n`],
    ];
    for (const [field, value] of cases) {
      expect(
        refusedFields(() => buildGeoQuestionGenerationResultV1(body({ [field]: value }))),
        `${field} = ${JSON.stringify(value)}`,
      ).toEqual([field]);
      // The builder computes `contentHash`, so only the parser can be shown a
      // stored record with one of these already in it.
      expect(
        refusedFields(() => parseGeoQuestionGenerationResultV1(storedResult({ [field]: value }))),
        `stored ${field} = ${JSON.stringify(value)}`,
      ).toEqual([field]);
    }
  });

  it("refuses a malformed contentHash before it compares hashes", () => {
    // `contentHash` reaches the schema only through the parser -- the builder
    // mints it -- so nothing else here can hold its format. Each of these is
    // refused by the schema and named as `contentHash`; a value that got past
    // the schema would be re-thrown as a bare hash-mismatch Error instead, and
    // `refusalIssues` fails loudly rather than counting that as proof.
    const stored = storedResult();
    for (const contentHash of [
      "g".repeat(64),
      HASH_DRAFT.slice(0, 63),
      `${HASH_DRAFT}a`,
      HASH_DRAFT.toUpperCase(),
      `${HASH_DRAFT}\n`,
    ]) {
      expect(
        refusedFields(() => parseGeoQuestionGenerationResultV1({ ...stored, contentHash })),
        `contentHash = ${JSON.stringify(contentHash)}`,
      ).toEqual(["contentHash"]);
    }
  });

  it("refuses receipt references that are not canonical, unique and sorted, and says which", () => {
    const ref = (receiptId: string) => ({ receiptId, contentHash: HASH_DRAFT });
    // `geoSourceReceiptRefV3Schema` matches uuids case-insensitively, so the
    // sweep in this file is the only thing refusing an uppercase receipt id --
    // and a sweep rewritten as a per-group regex could easily leave one group
    // tolerant, exactly as the `uuid` validator once did.
    const upperFirstGroup = editUuidGroup(RECEIPT_A, 0, (part) => part.toUpperCase());
    const upperLastGroup = editUuidGroup(RECEIPT_A, 4, (part) => part.toUpperCase());
    expect([upperFirstGroup, upperLastGroup], "receipt fixture has no letters to uppercase")
      .not.toContain(RECEIPT_A);
    // The same two edits on the SECOND fixture, for the cases that put the
    // offender somewhere other than index 0.
    const upperFirstGroupB = editUuidGroup(RECEIPT_B, 0, (part) => part.toUpperCase());
    const upperLastGroupB = editUuidGroup(RECEIPT_B, 4, (part) => part.toUpperCase());
    expect([upperFirstGroupB, upperLastGroupB], "second receipt fixture has no letters to uppercase")
      .not.toContain(RECEIPT_B);

    // Each case names the sentence it earned. Without that the duplicate guard
    // is unpinned: strict ascending order already implies uniqueness, so
    // deleting the `Set` check leaves `[A, A]` refused by the sort check
    // instead, with the suite green and the diagnosis quietly worse.
    //
    // And each of the three guards is shown to SWEEP. Every offender used to
    // sit at index 0 -- the only multi-element arrays anywhere in this file
    // were `[B, A]`, `[A, A]` and the sorted lowercase `refs(32)`/`refs(33)` --
    // so not one of the three was ever asked to look past the first element.
    // Measured: `refs.some(...)` narrowed to `refs[0]`, the sort loop bounded
    // at `Math.min(refs.length, 2)`, and the `Set` narrowed to
    // `refs.slice(0, 2)` each left this suite green. The multi-element cases
    // below are sorted, unique and canonical in every dimension except the one
    // they are named for, so a narrowed guard cannot be rescued by a
    // neighbouring check: it either stops refusing altogether or refuses with
    // the wrong sentence, and both are red here.
    const cases: ReadonlyArray<readonly [string, readonly unknown[], RegExp]> = [
      ["out of order", [ref(RECEIPT_B), ref(RECEIPT_A)], /must be sorted/u],
      // The offending pair is `(C, B)` -- neither the first pair nor the last.
      // Three elements would not have been enough: in `[A, C, B]` the bad pair
      // is also the last one, so a loop rewritten to compare only the ends
      // still refuses it. This array survives no sampling at all.
      ["out of order at a middle pair", [ref(RECEIPT_A), ref(RECEIPT_C), ref(RECEIPT_B), ref(RECEIPT_D)], /must be sorted/u],
      ["duplicated", [ref(RECEIPT_A), ref(RECEIPT_A)], /Duplicate source receipt reference/u],
      ["duplicated at a later index", [ref(RECEIPT_A), ref(RECEIPT_B), ref(RECEIPT_B)], /Duplicate source receipt reference/u],
      // Non-adjacent, so a `Set` rewritten as a neighbour comparison -- the
      // shape of the sort loop directly beneath it, and the obvious
      // "simplification" -- stops seeing it, and the sort check answers "must
      // be sorted" to a pair of duplicates instead.
      ["duplicated non-adjacently", [ref(RECEIPT_A), ref(RECEIPT_B), ref(RECEIPT_A)], /Duplicate source receipt reference/u],
      ["uppercased throughout", [ref(RECEIPT_A.toUpperCase())], /must be canonical/u],
      ["uppercase in the first group", [ref(upperFirstGroup)], /must be canonical/u],
      ["uppercase in the last group", [ref(upperLastGroup)], /must be canonical/u],
      // Index 1 of 2 (last) and index 1 of 3 (middle). Both arrays are sorted
      // and unique, so `assertCanonicalReceiptRefs` has no second reason to
      // refuse them -- a canonical check that only reads `refs[0]` accepts
      // both, and this case fails as "expected the contract to refuse this".
      ["uppercase in the last element", [ref(RECEIPT_A), ref(upperLastGroupB)], /must be canonical/u],
      ["uppercase in a middle element", [ref(RECEIPT_A), ref(upperFirstGroupB), ref(RECEIPT_C)], /must be canonical/u],
    ];
    for (const [label, refs, message] of cases) {
      expect(
        () => buildGeoQuestionGenerationResultV1(body({ sourceReceiptRefs: refs })),
        label,
      ).toThrow(message);
      expect(
        () => parseGeoQuestionGenerationResultV1(storedResult({ sourceReceiptRefs: refs })),
        `stored, ${label}`,
      ).toThrow(message);
    }
    expect(
      buildGeoQuestionGenerationResultV1(body({ sourceReceiptRefs: [ref(RECEIPT_A), ref(RECEIPT_B)] }))
        .sourceReceiptRefs,
    ).toHaveLength(2);
  });

  it("refuses a malformed receipt reference at any index, not only the first", () => {
    // The element schema itself was unheld. Every receipt fixture in this file
    // comes out of one `ref()` helper that always produces a well-formed
    // member, so `z.array(geoSourceReceiptRefV3Schema)` could be replaced with
    // `z.array(z.object({ receiptId: z.string(), contentHash: z.string() }))`
    // -- no uuid format, no hash format, no `.strict()` -- and the suite stayed
    // green. Measured, not assumed.
    //
    // Each offender sits at index 1, so these also pin that the array is swept
    // rather than sampled.
    const ref = (receiptId: string) => ({ receiptId, contentHash: HASH_DRAFT });
    const cases: ReadonlyArray<readonly [string, unknown, string]> = [
      ["receiptId is not a uuid", { receiptId: "not-a-uuid", contentHash: HASH_DRAFT }, "sourceReceiptRefs.1.receiptId"],
      ["contentHash is not a sha-256 digest", { receiptId: RECEIPT_B, contentHash: "g".repeat(64) }, "sourceReceiptRefs.1.contentHash"],
      ["an unknown key rides along", { ...ref(RECEIPT_B), spentTokens: "412" }, "sourceReceiptRefs.1"],
    ];
    for (const [label, member, path] of cases) {
      const refs = [ref(RECEIPT_A), member];
      expect(
        refusedFields(() => buildGeoQuestionGenerationResultV1(body({ sourceReceiptRefs: refs }))),
        label,
      ).toEqual([path]);
      expect(
        refusedFields(() => parseGeoQuestionGenerationResultV1(storedResult({ sourceReceiptRefs: refs }))),
        `stored, ${label}`,
      ).toEqual([path]);
    }
  });

  it("refuses more receipt references than a result may carry", () => {
    // The one divergence from SQL with a number in it. SQL only requires the
    // result's array to equal the input's, so nothing but this holds the
    // ceiling -- and nothing held it before: every other case supplies two refs
    // or none, and deleting the `.max(...)` left the suite green.
    expect(GEO_QUESTION_GENERATION_RESULT_MAX_RECEIPTS).toBe(32);
    // Sorted by code point and unique, so `assertCanonicalReceiptRefs` has no
    // other reason to refuse: zero-padded decimals ascend lexicographically.
    const refs = (count: number) => Array.from({ length: count }, (_unused, index) => ({
      receiptId: `4a4a4a4a-4444-8444-8444-4444${String(index).padStart(8, "0")}`,
      contentHash: HASH_DRAFT,
    }));
    expect(
      buildGeoQuestionGenerationResultV1(body({ sourceReceiptRefs: refs(32) })).sourceReceiptRefs,
    ).toHaveLength(32);
    expect(refusedFields(() => buildGeoQuestionGenerationResultV1(body({ sourceReceiptRefs: refs(33) }))))
      .toEqual(["sourceReceiptRefs"]);
  });

  it("refuses a draft version outside the positive decimal integers, at both guards", () => {
    // `^[1-9][0-9]{0,15}$` and the safe-integer refine are a pair, and every
    // shape below dies on the regex -- none of them reaches the refine. That is
    // why the refine had no test at all: deleting it left the suite green.
    for (const baseDraftVersion of ["0", "01", "1.0", "", "-1", " 1", "1\n", "1e3", "+1"]) {
      expect(
        refusedFields(() => buildGeoQuestionGenerationResultV1(body({ baseDraftVersion }))),
        JSON.stringify(baseDraftVersion),
      ).toEqual(["baseDraftVersion"]);
    }

    // The refine's own boundary, spelled out rather than derived from
    // `Number.MAX_SAFE_INTEGER`: a bound written with the constant it is meant
    // to pin agrees with that constant however the constant is misread.
    expect(buildGeoQuestionGenerationResultV1(body({ baseDraftVersion: "9007199254740991" })).baseDraftVersion)
      .toBe("9007199254740991");
    // One larger, still 16 digits, so the regex admits it and only the refine
    // can refuse it. zod reports the whole check chain, so the codes name the
    // guard that fired: `custom` alone is the refine, on its own.
    expect(
      refusedCodes(
        () => buildGeoQuestionGenerationResultV1(body({ baseDraftVersion: "9007199254740992" })),
        "baseDraftVersion",
      ),
    ).toEqual(["custom"]);
    // And 17 digits is the REGEX's boundary. Widened to `{0,30}` this value
    // would sail past the regex and be refused by the refine alone, reporting
    // only `custom` -- which is what makes the width observable at all, since
    // no 17-digit decimal is a safe integer for the refine to accept.
    expect(
      refusedCodes(
        () => buildGeoQuestionGenerationResultV1(body({ baseDraftVersion: "90071992547409911" })),
        "baseDraftVersion",
      ),
    ).toEqual(["invalid_format", "custom"]);
  });

  it("normalises only the reader's side of the binding, and only where a caller needs it", () => {
    const result = built();
    // The half a caller can actually need. `kb-v3-publish-handler.ts` hands
    // this function `runRef.questionsGenerationId` straight out of the stored
    // draft, and the payload contract that admitted that draft
    // (`kb-v3-contract.ts`) matches uuids case-insensitively -- so a runRef
    // recording an uppercase generation id is a legal draft, and without the
    // normalisation it would read as a store inconsistency and answer 503.
    // Admissible rather than observed: nothing writes that field non-null yet.
    expect(() => assertGeoQuestionGenerationResultBinding(result, {
      kbId: KB_ID,
      generationId: GENERATION_ID.toUpperCase(),
    })).not.toThrow();
    // The kbId half is defence, not a live path, and saying so is the point:
    // the same handler refuses the request outright unless the caller's kbId is
    // byte-identical to the row's own id, so by the time this runs it is
    // already canonical. Asserted so the tolerance stays deliberate -- not so
    // an unreachable shape can be counted as coverage.
    expect(() => assertGeoQuestionGenerationResultBinding(result, {
      kbId: KB_ID.toUpperCase(),
      generationId: GENERATION_ID,
    })).not.toThrow();

    // Normalising the reader's side must never become normalising the stored
    // side. A hand-built record is the only way to show it: the parser refuses
    // these ids, so no parsed result can carry one.
    for (const field of ["kbId", "generationId"] as const) {
      const stored = { ...result, [field]: result[field].toUpperCase() };
      expect(
        () => assertGeoQuestionGenerationResultBinding(stored, {
          kbId: KB_ID,
          generationId: GENERATION_ID,
        }),
        `stored ${field} uppercased`,
      ).toThrow(field === "kbId" ? /kb scope/u : /generation mismatch/u);
    }

    expect(() => assertGeoQuestionGenerationResultBinding(result, {
      kbId: RECEIPT_A,
      generationId: GENERATION_ID,
    })).toThrow(/kb scope/u);
    expect(() => assertGeoQuestionGenerationResultBinding(result, {
      kbId: KB_ID,
      generationId: RECEIPT_A,
    })).toThrow(/generation mismatch/u);
  });

  it("has no opinion about the draft the run was dispatched against", () => {
    // Reviewing moves the draft on and publishing moves it on again, so a
    // result naming an older draft is normal. Only `generationInputHash` binds
    // a set to a version, and that comparison belongs to the publish path.
    const older = buildGeoQuestionGenerationResultV1(body({
      baseDraftVersion: "1",
      baseDraftHash: "c".repeat(64),
    }));
    expect(older.baseDraftHash).toBe("c".repeat(64));
    expect(older.generationInputHash).toBe(HASH_INPUT);
  });
});
