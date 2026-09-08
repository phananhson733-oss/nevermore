import { describe, expect, it } from "vitest";
import {
  assertGeoV3Budgets, GEO_KB_V3_LIMITS, geoEntityCorrectionIssue, geoEntityCorrectionRule, geoOverrideSchema,
  geoReviewSchemaV3, geoV3ItemKeys, geoV3Items, parseGeoKbPayloadV3, type GeoKbPayloadV3,
} from "./kb-v3-contract.ts";
import { assertGeoItemKeyIntegrity } from "./kb-item-key.ts";
import {
  GEO_ENTITY_CORRECTABLE_PATHS, geoComparisonRowContentShape, geoEntityValueShape, geoFactContentShape,
  geoQaContentShape, geoStatementContentShape,
} from "./kb-knowledge-shape.ts";
import {
  completePayloadV3, conflictingPayloadV3, ENTITY_NAME_KEY, FACT_KEY_PRO, FACT_KEY_TEAM,
  HASH_A, OBSERVED_AT, PLANS_SOURCE, QA_KEY, SCOPE_KEY,
} from "./kb-v3.test-fixtures.ts";

const raw = (payload: unknown) => JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;

type GeoDecisionV3 = GeoKbPayloadV3["review"]["decisions"][number];

/** No digits: an override is not literal-checked, and this keeps it that way. */
const CORRECTED_TEXT = "The Pro plan price as the owner corrected it. ".repeat(16).slice(0, 700);

const decisionAt = (index: number): GeoDecisionV3 => ({
  // Distinct, and deliberately not any item key the fixture body carries: what
  // this decision is *about* is the next check's business, not the budget's.
  itemKey: index.toString(16).padStart(64, "0"),
  decision: "accepted",
  override: { module: "facts", statement: CORRECTED_TEXT, label: "Pro plan monthly price", value: "9", reason: "" },
  baseContentHash: HASH_A,
  decidedAt: OBSERVED_AT,
  baseDraftVersion: "1",
});

/**
 * Enough decisions to put the review at roughly `fraction` of its own byte
 * budget. Counted from the constant rather than written down, so moving the
 * limit moves both sides of the boundary with it, and asserted against the row
 * cap so a future limit change cannot turn either case into a length failure
 * wearing a budget failure's name.
 */
const decisionsFilling = (fraction: number): GeoDecisionV3[] => {
  const perRecord = JSON.stringify(decisionAt(0)).length + 1;
  const count = Math.ceil((GEO_KB_V3_LIMITS.reviewBytes * fraction) / perRecord);
  expect(count).toBeLessThanOrEqual(GEO_KB_V3_LIMITS.decisions);
  return Array.from({ length: count }, (_value, index) => decisionAt(index));
};

type GeoSuppressionV3 = GeoKbPayloadV3["review"]["suppressions"][number];

/**
 * `count` distinct suppressions. A suppression is small (~123 bytes against
 * ~1 050 for a decision) and capped at 512 rows, so the whole row cap is only
 * ~49% of `reviewBytes`: there is no suppression list a schema-valid draft can
 * hold that exhausts the review budget on its own. What it can do -- and what
 * the case below pins -- is finish off a decisions list that fits.
 */
const suppressionsAt = (count: number): GeoSuppressionV3[] => Array.from({ length: count }, (_value, index) => ({
  // Distinct, and no item the fixture body carries: a suppression outlives its
  // item on purpose, so naming one would be testing a different rule.
  itemKey: (index + 0x10000).toString(16).padStart(64, "0"),
  suppressedAt: OBSERVED_AT,
}));

describe("the v3 draft contract", () => {
  it("accepts a complete draft", () => {
    const payload = completePayloadV3();
    expect(payload.schemaVersion).toBe("marketing-geo-kb.v3");
    expect(geoV3ItemKeys(payload.knowledge)).toContain(FACT_KEY_PRO);
  });

  it("gives two plans of the same attribute different keys", () => {
    // The whole point of qualifiers: a correction to the Pro price must never
    // reach the Team price.
    expect(FACT_KEY_PRO).not.toBe(FACT_KEY_TEAM);
  });

  it("rejects a decision about an item that does not exist", () => {
    const payload = raw(completePayloadV3());
    (payload.review as { decisions: unknown[] }).decisions = [{
      itemKey: "f".repeat(64), decision: "accepted", override: null,
      baseContentHash: HASH_A, decidedAt: OBSERVED_AT, baseDraftVersion: "1",
    }];
    expect(() => parseGeoKbPayloadV3(payload)).toThrow(/unknown item/iu);
  });

  it("treats a correction as an acceptance, never as a pending item", () => {
    const payload = raw(completePayloadV3());
    (payload.review as { decisions: unknown[] }).decisions = [{
      itemKey: FACT_KEY_PRO, decision: "pending",
      override: { module: "facts", statement: "The Pro plan costs 12 per month.", label: "Pro plan monthly price", value: "12", reason: "" },
      baseContentHash: HASH_A, decidedAt: OBSERVED_AT, baseDraftVersion: "1",
    }];
    expect(() => parseGeoKbPayloadV3(payload)).toThrow();
  });

  it("refuses an owner declaration inside the generated body", () => {
    // An owner correction is a review override. Letting the draft carry
    // origin "declared_owner" directly would let generated text claim to be
    // the owner's own statement.
    const payload = raw(completePayloadV3());
    const facts = (payload.knowledge as { facts: { value: Record<string, unknown>[] } }).facts.value;
    facts[0]!.origin = "declared_owner";
    expect(() => parseGeoKbPayloadV3(payload)).toThrow();
  });

  it("refuses an owner-declared evidence check inside the generated body", () => {
    const payload = raw(completePayloadV3());
    const facts = (payload.knowledge as { facts: { value: Record<string, unknown>[] } }).facts.value;
    facts[0]!.evidenceChecks = "owner_declared";
    expect(() => parseGeoKbPayloadV3(payload)).toThrow();
  });

  it("refuses a citation that names a source the catalogue does not have", () => {
    const payload = raw(completePayloadV3());
    const facts = (payload.knowledge as { facts: { value: Record<string, unknown>[] } }).facts.value;
    facts[0]!.sourceRefs = ["own:invented"];
    expect(() => parseGeoKbPayloadV3(payload)).toThrow(/Unknown source reference/iu);
  });

  it("requires a generated item to cite something", () => {
    const payload = raw(completePayloadV3());
    const facts = (payload.knowledge as { facts: { value: Record<string, unknown>[] } }).facts.value;
    facts[0]!.sourceRefs = [];
    expect(() => parseGeoKbPayloadV3(payload)).toThrow();
  });

  it("requires an unavailable fact to say why, and forbids a reason on an available one", () => {
    const missing = raw(completePayloadV3());
    const missingFacts = (missing.knowledge as { facts: { value: Record<string, unknown>[] } }).facts.value;
    missingFacts[0]!.value = null;
    missingFacts[0]!.reason = "";
    expect(() => parseGeoKbPayloadV3(missing)).toThrow();

    const contradictory = raw(completePayloadV3());
    const facts = (contradictory.knowledge as { facts: { value: Record<string, unknown>[] } }).facts.value;
    facts[0]!.reason = "conflicting";
    expect(() => parseGeoKbPayloadV3(contradictory)).toThrow();
  });

  it("rejects a JSON number anywhere in the payload", () => {
    // The persisted hash domain forbids number types; a number that survived
    // here would hash differently on the way back out.
    const payload = raw(completePayloadV3());
    (payload.runRef as Record<string, unknown>).runId = 5;
    expect(() => parseGeoKbPayloadV3(payload)).toThrow();
  });

  it("accepts a review that fills most of its own budget", () => {
    const payload = { ...completePayloadV3(), review: { decisions: decisionsFilling(0.8), suppressions: [] } };
    expect(() => assertGeoV3Budgets(payload)).not.toThrow();
  });

  it("measures the review budget separately from the knowledge budget", () => {
    const payload = { ...completePayloadV3(), review: { decisions: decisionsFilling(1.3), suppressions: [] } };
    expect(() => assertGeoV3Budgets(payload)).toThrow(/review exceeds byte limit/iu);
    // The same draft with the review emptied is accepted, so nothing else in it
    // is over any limit: only a review budget measured on its own can refuse
    // this, and the payload as a whole is still far inside the table's total.
    expect(() => assertGeoV3Budgets({ ...payload, review: { decisions: [], suppressions: [] } })).not.toThrow();
    expect(GEO_KB_V3_LIMITS.reviewBytes).toBeLessThan(GEO_KB_V3_LIMITS.knowledgeBytes);
  });

  it("counts the suppressions against the review budget, not the decisions alone", () => {
    // The review is `decisions` *and* `suppressions`, and the column CHECK the
    // budget stands in for measures `payload->'review'` -- the whole object.
    // Suppressions outlive their item by design, so an owner accumulates them
    // over months while the decisions fill up beside them. A budget measured
    // over the decisions alone accepts a review the database then refuses, at
    // the moment a decision is recorded: the failure this function's comment
    // says the per-part budget exists to keep away from the owner.
    const decisions = decisionsFilling(0.8);
    const suppressions = suppressionsAt(GEO_KB_V3_LIMITS.suppressions);
    const payload = { ...completePayloadV3(), review: { decisions, suppressions } };
    // The decisions are inside the budget on their own, so the suppressions are
    // the only thing that can push this over.
    expect(() => assertGeoV3Budgets({ ...payload, review: { decisions, suppressions: [] } })).not.toThrow();
    expect(() => assertGeoV3Budgets(payload)).toThrow(/review exceeds byte limit/iu);
    // And it is a review the shape itself accepts -- both lists are inside
    // their row caps and carry no duplicate key -- so this is a state an owner
    // reaches by using the feature as designed, not one invented here.
    expect(() => geoReviewSchemaV3.parse(payload.review)).not.toThrow();
  });

  it("reaches the review budget before it reaches the decisions' targets", () => {
    // The keys are distinct and name no item in the body. A review built the
    // obvious way -- N decisions carrying one item key -- never reaches a
    // budget at all: the duplicate-key refinement inside the schema refuses it
    // first, and the test then passes whatever `assertGeoV3Budgets` does.
    const payload = raw(completePayloadV3());
    (payload.review as { decisions: unknown[] }).decisions = decisionsFilling(1.3);
    expect(() => parseGeoKbPayloadV3(payload)).toThrow(/review exceeds byte limit/iu);
  });

  it("keeps a suppression for an item that no longer exists", () => {
    // Exclusions have to outlive the item, or the next update resurrects it.
    const payload = raw(completePayloadV3());
    (payload.review as { suppressions: unknown[] }).suppressions = [{ itemKey: "e".repeat(64), suppressedAt: OBSERVED_AT }];
    expect(() => parseGeoKbPayloadV3(payload)).not.toThrow();
  });

  it("allows a draft with no knowledge body at all", () => {
    // The model step can fail. The draft still exists, and the card still has
    // something to say about it.
    const payload = raw(completePayloadV3());
    payload.knowledge = null;
    (payload.review as { decisions: unknown[] }).decisions = [];
    expect(() => parseGeoKbPayloadV3(payload)).not.toThrow();
  });
});

const facts = (payload: Record<string, unknown>) =>
  (payload.knowledge as { facts: { value: Record<string, unknown>[] } }).facts.value;
const decision = (over: Record<string, unknown>) => ({
  itemKey: FACT_KEY_PRO, decision: "accepted", override: null,
  baseContentHash: HASH_A, decidedAt: OBSERVED_AT, baseDraftVersion: "1", ...over,
});

describe("what a v3 draft may claim about its evidence", () => {
  it("refuses a checked claim whose number occurs in no cited excerpt", () => {
    // `cited_and_literals_match` is the only evidence wording the card shows an
    // owner. Trusting the generator's own label makes it worth nothing.
    const payload = raw(completePayloadV3());
    facts(payload)[0]!.value = "999";
    facts(payload)[0]!.statement = "The Pro plan costs 999 per month.";
    expect(() => parseGeoKbPayloadV3(payload)).toThrow(/occurs in no cited excerpt/iu);
  });

  it("refuses a checked claim whose only source was never read", () => {
    const payload = raw(completePayloadV3());
    const catalogue = (payload.knowledge as { sourceCatalogue: Record<string, unknown>[] }).sourceCatalogue;
    const pricing = catalogue.find((source) => source.id === "own:pricing")!;
    Object.assign(pricing, { availability: "unavailable", reason: "fetch_failed", observedAt: null, bodyHash: null, excerpts: [] });
    expect(() => parseGeoKbPayloadV3(payload)).toThrow(/source with observed text/iu);
  });

  it("refuses two sources answering to the same id", () => {
    // A duplicate id makes every citation of it ambiguous: which of the two a
    // consumer resolves then depends on lookup order.
    const payload = raw(completePayloadV3());
    const catalogue = (payload.knowledge as { sourceCatalogue: Record<string, unknown>[] }).sourceCatalogue;
    catalogue.push({ ...catalogue[1]!, excerpts: ["The Pro plan costs 999 per month."] });
    expect(() => parseGeoKbPayloadV3(payload)).toThrow(/Duplicate source id/iu);
  });
});

const qa = (payload: Record<string, unknown>) =>
  (payload.knowledge as { qa: { value: Record<string, unknown>[] } }).qa.value;

describe("what the evidence check has to reach", () => {
  // Every case below sets one field to text asserting 500, a number no excerpt
  // in the fixture carries, on an item still labelled
  // `cited_and_literals_match`. Before these fields entered the claim list each
  // one parsed clean, so the badge was a promise about a narrower set of text
  // than the pack goes on to publish.
  it("refuses a checked Q&A whose question asserts an unsourced number", () => {
    const payload = raw(completePayloadV3());
    qa(payload)[0]!.question = "How much does Acme cost for 500 users?";
    expect(() => parseGeoKbPayloadV3(payload)).toThrow(/occurs in no cited excerpt/iu);
  });

  it("refuses a checked Q&A whose canonical phrasing asserts an unsourced number", () => {
    const payload = raw(completePayloadV3());
    qa(payload)[0]!.canonicalQuestion = "how much does it cost for 500 users";
    expect(() => parseGeoKbPayloadV3(payload)).toThrow(/occurs in no cited excerpt/iu);
  });

  it("refuses a checked Q&A whose variants assert an unsourced number", () => {
    const payload = raw(completePayloadV3());
    qa(payload)[0]!.variants = ["Is Acme 500 a month?"];
    expect(() => parseGeoKbPayloadV3(payload)).toThrow(/occurs in no cited excerpt/iu);
  });

  it("refuses a checked fact whose label asserts an unsourced number", () => {
    const payload = raw(completePayloadV3());
    facts(payload)[0]!.label = "Pro plan monthly price for 500 seats";
    expect(() => parseGeoKbPayloadV3(payload)).toThrow(/occurs in no cited excerpt/iu);
  });

  it("refuses a checked fact whose identity triple asserts an unsourced number", () => {
    for (const mutate of [
      (fact: Record<string, unknown>) => { fact.subject = "Pro plan for 500 seats"; },
      (fact: Record<string, unknown>) => { fact.attribute = "monthly price for 500 seats"; },
      (fact: Record<string, unknown>) => { fact.qualifiers = ["usd", "500-seats"]; },
    ]) {
      const payload = raw(completePayloadV3());
      mutate(facts(payload)[0]!);
      expect(() => parseGeoKbPayloadV3(payload)).toThrow(/occurs in no cited excerpt/iu);
    }
  });

  it("still accepts the same fields when the cited page does carry the number", () => {
    // The counterpart: the check refuses an unsupported number, not the field.
    const payload = raw(completePayloadV3());
    qa(payload)[0]!.question = "How much does Acme cost, 9 or 29?";
    qa(payload)[0]!.variants = ["Is Acme 9 a month?"];
    facts(payload)[0]!.label = "Pro plan price at 9";
    expect(() => parseGeoKbPayloadV3(payload)).not.toThrow();
  });
});

/**
 * The drift guard for the checks above. Each shape is partitioned by hand into
 * the fields that must arrive as claims and the fields that carry no free text
 * at all; the partition has to equal the shape's own key set, so a field added
 * to `kb-knowledge-shape.ts` cannot reach the published pack without someone
 * deciding, here, which side it is on.
 */
const FACT_CLAIM_FIELDS = ["statement", "value", "label", "subject", "attribute", "qualifiers"] as const;
const FACT_UNCLAIMED_FIELDS = ["id", "type", "reason", "observedAt", "nextReviewAt"] as const;
const QA_CLAIM_FIELDS = ["question", "canonicalQuestion", "variants", "directAnswer", "expansion"] as const;
const QA_UNCLAIMED_FIELDS = ["id", "intent"] as const;
const COMPARISON_CLAIM_FIELDS = ["product", "competitor"] as const;
/**
 * `dimension` is the one published text field of a reviewable item that is
 * still outside the check, and it is left out on purpose rather than missed.
 * A comparison row whose product and competitor are both null has no claims at
 * all today, so appending the dimension would make it `claims[0]`, and
 * `kb-knowledge-merge.ts:243` reads `claims[0].text` as the human-readable
 * summary it writes into `alternateObservations` on a conflict -- a dimension
 * label would arrive there as if it were an observation. The published pack
 * does check `dimension`, so a row that fails it is still refused, just at
 * publish time rather than at save time.
 */
const COMPARISON_UNCHECKED_FIELDS = ["dimension"] as const;
const COMPARISON_UNCLAIMED_FIELDS = ["id", "availability"] as const;
const SCOPE_CLAIM_FIELDS = ["text"] as const;
const SCOPE_UNCLAIMED_FIELDS = ["id"] as const;

describe("everything a reviewable item publishes is inside the claim list", () => {
  it("partitions every content shape, so a new field cannot arrive unchecked", () => {
    const keys = (shape: Record<string, unknown>) => Object.keys(shape).sort();
    expect([...FACT_CLAIM_FIELDS, ...FACT_UNCLAIMED_FIELDS].sort()).toEqual(keys(geoFactContentShape));
    expect([...QA_CLAIM_FIELDS, ...QA_UNCLAIMED_FIELDS].sort()).toEqual(keys(geoQaContentShape));
    expect([
      ...COMPARISON_CLAIM_FIELDS, ...COMPARISON_UNCHECKED_FIELDS, ...COMPARISON_UNCLAIMED_FIELDS,
    ].sort()).toEqual(keys(geoComparisonRowContentShape));
    expect([...SCOPE_CLAIM_FIELDS, ...SCOPE_UNCLAIMED_FIELDS].sort()).toEqual(keys(geoStatementContentShape));
  });

  it("carries the text of every claim field of the fact and Q&A it walks", () => {
    const source = raw(completePayloadV3());
    qa(source)[0]!.variants = ["What does Acme cost?"];
    const parsed = parseGeoKbPayloadV3(source);
    const items = geoV3Items(parsed.knowledge);
    const claimed = (itemKey: string) => items.find((item) => item.itemKey === itemKey)!.claims.map((claim) => claim.text);

    const fact = facts(source)[0]! as unknown as Record<string, string | string[]>;
    for (const field of FACT_CLAIM_FIELDS) {
      const value = fact[field];
      for (const text of Array.isArray(value) ? value : [value!]) expect(claimed(FACT_KEY_PRO)).toContain(text);
    }
    const item = qa(source)[0]! as unknown as Record<string, string | string[]>;
    for (const field of QA_CLAIM_FIELDS) {
      const value = item[field];
      if (value === null) continue;
      for (const text of Array.isArray(value) ? value : [value!]) expect(claimed(QA_KEY)).toContain(text);
    }
    expect(claimed(SCOPE_KEY)).toContain("Acme does not run on Android.");
  });

  it("keeps the item's own summary first, where the merge reads it", () => {
    // `kb-knowledge-merge.ts:243` takes `claims[0].text` as the sentence it
    // writes into a conflict's alternate observations. Widening the list is
    // only safe while it stays an append.
    const items = geoV3Items(completePayloadV3().knowledge);
    expect(items.find((entry) => entry.itemKey === FACT_KEY_PRO)!.claims[0]!.text).toBe("The Pro plan costs 9 per month.");
    expect(items.find((entry) => entry.itemKey === QA_KEY)!.claims[0]!.text).toBe("Plans start at 9 per month.");
  });
});

describe("two pages that disagree", () => {
  it("keeps both observations under one identity and withholds the value", () => {
    const payload = conflictingPayloadV3();
    const conflicting = geoV3Items(payload.knowledge).find((item) => item.itemKey === FACT_KEY_PRO);
    expect(conflicting?.sourceRefs).toContain(PLANS_SOURCE);
    const fact = (payload.knowledge as never as { facts: { value: { value: string | null; reason: string }[] } }).facts.value[0]!;
    expect(fact.value).toBeNull();
    expect(fact.reason).toBe("conflicting");
  });

  it("refuses to name one page the winner while the conflict stands", () => {
    const payload = raw(conflictingPayloadV3());
    facts(payload)[0]!.value = "9";
    facts(payload)[0]!.reason = "";
    expect(() => parseGeoKbPayloadV3(payload)).toThrow(/withholds its value/iu);
  });

  it("refuses to call a fact conflicting with nothing to conflict", () => {
    const payload = raw(completePayloadV3());
    facts(payload)[0]!.value = null;
    facts(payload)[0]!.reason = "conflicting";
    expect(() => parseGeoKbPayloadV3(payload)).toThrow(/must carry the competing observations/iu);
  });
});

describe("what a correction may address", () => {
  it("refuses a correction filed against a different kind of item", () => {
    const payload = raw(completePayloadV3());
    (payload.review as { decisions: unknown[] }).decisions = [decision({ override: { module: "scope", text: "Replacement boundary" } })];
    expect(() => parseGeoKbPayloadV3(payload)).toThrow(/does not match the item/iu);
  });

  it("refuses a correction naming a different entity field", () => {
    const payload = raw(completePayloadV3());
    (payload.review as { decisions: unknown[] }).decisions = [decision({
      itemKey: ENTITY_NAME_KEY, override: { module: "entity", field: "founded.year", value: "2020" },
    })];
    expect(() => parseGeoKbPayloadV3(payload)).toThrow(/different entity field/iu);
  });

  it("does not offer a reason the schema beside it always refuses", () => {
    // `conflicting` withholds a value because two pages disagree, and the
    // competing observations are what makes that honest. An override carries
    // none, so it could never legitimately be conflicting -- and the refusal it
    // used to get named `alternateObservations`, a field a correction does not
    // have. The value is gone from the enum, so the refusal is now "this is not
    // one of the reasons" rather than advice about a field that does not exist.
    const payload = raw(completePayloadV3());
    (payload.review as { decisions: unknown[] }).decisions = [decision({
      override: { module: "facts", statement: "Two pages disagree.", label: "Pro plan monthly price", value: null, reason: "conflicting" },
    })];
    let thrown: unknown = null;
    try { parseGeoKbPayloadV3(payload); } catch (error) { thrown = error; }
    expect(thrown).not.toBeNull();
    expect(String((thrown as Error).message)).not.toMatch(/competing observations/iu);
  });

  it("still accepts every reason an override may legitimately carry", () => {
    // The counterpart to the case above: narrowing the enum must remove the one
    // dead value and nothing else.
    for (const reason of ["notPublished", "fetchFailed", "lowConfidence"]) {
      const payload = raw(completePayloadV3());
      (payload.review as { decisions: unknown[] }).decisions = [decision({
        override: { module: "facts", statement: "The Pro price is not published.", label: "Pro plan monthly price", value: null, reason },
      })];
      expect(() => parseGeoKbPayloadV3(payload)).not.toThrow();
    }
    const available = raw(completePayloadV3());
    (available.review as { decisions: unknown[] }).decisions = [decision({
      override: { module: "facts", statement: "The Pro plan costs 9 per month.", label: "Pro plan monthly price", value: "9", reason: "" },
    })];
    expect(() => parseGeoKbPayloadV3(available)).not.toThrow();
  });

  it("holds a correction to the same value/reason rule as generated text", () => {
    const payload = raw(completePayloadV3());
    (payload.review as { decisions: unknown[] }).decisions = [decision({
      override: { module: "facts", statement: "Price unknown", label: "Price", value: null, reason: "" },
    })];
    expect(() => parseGeoKbPayloadV3(payload)).toThrow();
  });
});

/**
 * The schema the published entity holds one field to, found by walking the
 * shared shape rather than restated here: a correction that this refuses is a
 * correction the publish step would refuse, which is the whole property under
 * test.
 */
function publishedEntityField(path: string) {
  const [head, tail] = path.split(".");
  const top = (geoEntityValueShape as unknown as Record<string, { safeParse: (value: unknown) => { success: boolean }; shape?: Record<string, { safeParse: (value: unknown) => { success: boolean } }> }>)[head!]!;
  return tail === undefined ? top : top.shape![tail]!;
}

const entityOverride = (field: string, value: string) =>
  geoOverrideSchema.safeParse({ module: "entity", field, value }).success;

describe("what an entity correction may be", () => {
  it("refuses a year the published entity could never hold", () => {
    // The defect this pins: a free-text correction to `founded.year` used to be
    // accepted and saved, and only the publish step -- after the paid work,
    // behind the least recoverable button -- discovered that the entity holds
    // that field to four digits. The refusal belongs where the owner is typing.
    expect(entityOverride("founded.year", "twenty nineteen")).toBe(false);
    expect(entityOverride("founded.year", "2019")).toBe(true);
    expect(entityOverride("founded.year", "19")).toBe(false);
    expect(entityOverride("founded.year", "2019 or so")).toBe(false);
  });

  it("names the field and the rule when the whole payload is parsed", () => {
    // Proves the refusal is the value rule and not the target rule: an override
    // naming a field the item does not have is refused too, by a later check
    // with a different message.
    const payload = raw(completePayloadV3());
    (payload.review as { decisions: unknown[] }).decisions = [decision({
      itemKey: ENTITY_NAME_KEY, override: { module: "entity", field: "founded.year", value: "twenty nineteen" },
    })];
    let thrown: unknown = null;
    try { parseGeoKbPayloadV3(payload); } catch (error) { thrown = error; }
    expect(String((thrown as Error).message)).toMatch(/founded\.year/u);
    expect(String((thrown as Error).message)).toMatch(/four-digit year/iu);
  });

  it("is exactly as wide as the field it replaces, for every correctable path", () => {
    // Both directions matter. Wider is the bug above: a correction nothing can
    // publish. Narrower is the same failure wearing the opposite sign -- an
    // owner rewriting a 120-word definition used to be cut off at 200 code
    // points and given the same opaque refusal.
    for (const path of GEO_ENTITY_CORRECTABLE_PATHS) {
      const published = publishedEntityField(path);
      for (const value of ["2019", "twenty nineteen", "x", "x".repeat(200), "x".repeat(201), "x".repeat(800), "x".repeat(801)]) {
        expect([path, value.length, entityOverride(path, value)]).toEqual([path, value.length, published.safeParse(value).success]);
      }
    }
  });

  it("states the rule it enforces, so the review card can say it before the save", () => {
    // The card has no zod error to render and must not offer a gesture the
    // contract refuses; this is what it asks.
    expect(geoEntityCorrectionRule("founded.year")).toEqual({ kind: "fourDigitYear" });
    expect(geoEntityCorrectionIssue("founded.year", "twenty nineteen")).toEqual({ kind: "fourDigitYear" });
    expect(geoEntityCorrectionIssue("founded.year", "2019")).toBeNull();
    expect(geoEntityCorrectionRule("definitions.w120")).toEqual({ kind: "text", max: 800 });
    expect(geoEntityCorrectionIssue("definitions.w120", "x".repeat(801))).toEqual({ kind: "text", max: 800 });
    expect(geoEntityCorrectionIssue("name", "x".repeat(201))).toEqual({ kind: "text", max: 200 });
  });

  it("advertises a bound the schema actually enforces", () => {
    // A stated maximum that the schema does not hold to would put a number in
    // front of the owner that nothing keeps true.
    for (const path of GEO_ENTITY_CORRECTABLE_PATHS) {
      const rule = geoEntityCorrectionRule(path);
      if (rule.kind !== "text") continue;
      expect([path, entityOverride(path, "x".repeat(rule.max))]).toEqual([path, true]);
      expect([path, entityOverride(path, "x".repeat(rule.max + 1))]).toEqual([path, false]);
    }
    expect(GEO_ENTITY_CORRECTABLE_PATHS.every((path) => geoEntityCorrectionIssue(path, "x") === null || path === "founded.year")).toBe(true);
  });

  it("lets a Q&A correction carry an expansion as long as the one it replaces", () => {
    // Same defect, other module: the expansion a correction may write was
    // bounded at 800 while the published field holds 2 400, so correcting the
    // answer of any Q&A with a long expansion was impossible.
    const over = (expansion: string) =>
      geoOverrideSchema.safeParse({ module: "qa", directAnswer: "Plans start at 9 per month.", expansion }).success;
    for (const length of [800, 2_400, 2_401]) {
      expect([length, over("x".repeat(length))]).toEqual([length, geoQaContentShape.expansion.safeParse("x".repeat(length)).success]);
    }
  });
});

describe("what the browser contract cannot prove", () => {
  it("accepts a key that does not belong to its content, so the server must check", () => {
    // The parser is browser-safe and has no sha256. Swapping the qualifiers
    // while keeping the key redirects that item's exclusions onto other content.
    const payload = raw(completePayloadV3());
    facts(payload)[0]!.qualifiers = ["usd", "yearly"];
    const parsed = parseGeoKbPayloadV3(payload);
    expect(() => assertGeoItemKeyIntegrity(geoV3Items(parsed.knowledge))).toThrow(/does not match its content/iu);
    expect(() => assertGeoItemKeyIntegrity(geoV3Items(completePayloadV3().knowledge))).not.toThrow();
  });
});

describe("what a locked generation input may carry", () => {
  it("refuses a role that was never accepted", () => {
    const payload = raw(completePayloadV3());
    const roles = (payload.generationInput as { roles: Record<string, unknown>[] }).roles;
    roles[0]!.review = "excluded";
    expect(() => parseGeoKbPayloadV3(payload)).toThrow();
  });

  it("refuses a string PostgreSQL JSONB has no representation for", () => {
    const payload = raw(completePayloadV3());
    (payload.generationInput as { profileRef: { subset: Record<string, unknown> } }).profileRef.subset.productName = "\ud800";
    expect(() => parseGeoKbPayloadV3(payload)).toThrow();
  });

  it("can represent a site that actually has a sitemap", () => {
    // Regression: a numeric urlCount made every such site unsaveable, because
    // the payload's canonical form has no JSON number type at all.
    const payload = raw(completePayloadV3());
    const machine = (payload.knowledge as { machine: { value: Record<string, Record<string, unknown>> } }).machine.value;
    machine.sitemap = { status: "present", urlCount: "42", knowledgePagesListed: true, sourceRefs: ["machine:sitemap"] };
    expect(() => parseGeoKbPayloadV3(payload)).not.toThrow();
  });

  it("refuses a machine observation that cites the wrong kind of source", () => {
    // A robots.txt fetch cannot evidence a sitemap's URL count. The published
    // pack already refuses this; refusing it here means the draft that cannot
    // be published is caught while the assembler can still fix it, instead of
    // at publish time after the paid work.
    const payload = raw(completePayloadV3());
    const machine = (payload.knowledge as { machine: { value: Record<string, Record<string, unknown>> } }).machine.value;
    machine.sitemap = { status: "present", urlCount: "42", knowledgePagesListed: true, sourceRefs: ["machine:robots"] };
    expect(() => parseGeoKbPayloadV3(payload)).toThrow(/cannot cite a robots source/iu);
  });
});
