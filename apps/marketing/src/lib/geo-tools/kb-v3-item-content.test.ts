import { describe, expect, it } from "vitest";

import { geoV3ItemContentHashes, geoV3RestatedItemKeys } from "./kb-v3-item-content.ts";
import { geoV3ItemKeys, parseGeoKbPayloadV3, type GeoKbPayloadV3 } from "./kb-v3-contract.ts";
import { applyGeoV3ReviewAction, geoV3DecisionStates, materializeGeoV3Review } from "./kb-v3-review.ts";
import { completePayloadV3 } from "./kb-v3.test-fixtures.ts";

const AT = "2026-09-08T09:00:00.000Z";

/** The owner's decision on `itemKey`, stamped against the text as it stands now. */
function decided(payload: GeoKbPayloadV3, itemKey: string): GeoKbPayloadV3 {
  const itemKeys = geoV3ItemKeys(payload.knowledge);
  const states = applyGeoV3ReviewAction(geoV3DecisionStates(payload.review, itemKeys), { kind: "accept", itemKey });
  return parseGeoKbPayloadV3({ ...payload, review: materializeGeoV3Review(payload.review, states, {
    contentHash: geoV3ItemContentHashes(payload.knowledge), decidedAt: AT, baseDraftVersion: "4",
  }) });
}

/**
 * The same page saying the same thing differently -- section 4.4's third rule.
 * Rewriting the statement is what changes the item's content hash; the item key
 * is built from identity, so it survives and the decision stays filed under it.
 */
function restatedFirstFact(payload: GeoKbPayloadV3, statement: string): GeoKbPayloadV3 {
  const knowledge = JSON.parse(JSON.stringify(payload.knowledge)) as { facts: { value: Record<string, unknown>[] } };
  knowledge.facts.value[0] = { ...knowledge.facts.value[0], statement };
  return parseGeoKbPayloadV3({ ...payload, knowledge });
}

describe("geoV3RestatedItemKeys", () => {
  it("names the decided item whose text has been rewritten since the decision", () => {
    const base = completePayloadV3();
    const factKey = geoV3ItemKeys(base.knowledge)[1];
    const payload = restatedFirstFact(decided(base, factKey), "The Pro plan is 9 dollars every month.");

    expect(geoV3RestatedItemKeys(payload.knowledge, payload.review)).toEqual([factKey]);
  });

  it("names nothing while the decided text still stands", () => {
    const base = completePayloadV3();
    const payload = decided(base, geoV3ItemKeys(base.knowledge)[1]);

    expect(geoV3RestatedItemKeys(payload.knowledge, payload.review)).toEqual([]);
  });

  it("stops naming the item once the owner decides again against the new text", () => {
    const base = completePayloadV3();
    const factKey = geoV3ItemKeys(base.knowledge)[1];
    const restated = restatedFirstFact(decided(base, factKey), "The Pro plan is 9 dollars every month.");
    expect(geoV3RestatedItemKeys(restated.knowledge, restated.review)).toEqual([factKey]);

    // The gesture the owner makes on the row: it re-stamps the decision against
    // what is on screen, which is exactly what has to make the chip go away.
    const again = decided(parseGeoKbPayloadV3({ ...restated, review: { decisions: [], suppressions: [] } }), factKey);
    expect(geoV3RestatedItemKeys(again.knowledge, again.review)).toEqual([]);
  });

  it("names nothing for an undecided item, however far its text has moved", () => {
    const base = completePayloadV3();
    const payload = restatedFirstFact(base, "The Pro plan is 9 dollars every month.");

    expect(payload.review.decisions).toEqual([]);
    expect(geoV3RestatedItemKeys(payload.knowledge, payload.review)).toEqual([]);
  });

  it("names nothing for a decision whose item the update dropped", () => {
    const base = completePayloadV3();
    const factKey = geoV3ItemKeys(base.knowledge)[1];
    const payload = decided(base, factKey);
    // An exclusion outlives its item on purpose, so this shape reaches the
    // function in production. It is gone, not restated, and saying "has a new
    // observation" about a row nobody can see would be the wrong word.
    const gone = { ...payload, knowledge: null };

    expect(geoV3ItemContentHashes(gone.knowledge).has(factKey)).toBe(false);
    expect(geoV3RestatedItemKeys(gone.knowledge, gone.review)).toEqual([]);
  });
});
