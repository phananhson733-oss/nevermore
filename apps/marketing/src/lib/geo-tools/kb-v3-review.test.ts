import { describe, expect, it } from "vitest";

import {
  applyGeoV3ReviewAction,
  applyGeoV3ReviewActions,
  geoV3ChangedKeys,
  geoV3DecisionStates,
  geoV3PendingKeys,
  geoV3ReviewCounts,
  materializeGeoV3Review,
  type GeoV3ReviewAction,
} from "./kb-v3-review.ts";
import {
  geoV3ItemKeys,
  parseGeoKbPayloadV3,
  type GeoReviewV3,
} from "./kb-v3-contract.ts";
import { geoV3ItemContentHashes } from "./kb-v3-item-content.ts";
import {
  completePayloadV3,
  ENTITY_NAME_KEY,
  FACT_KEY_PRO,
  FACT_KEY_TEAM,
  QA_KEY,
  SCOPE_KEY,
} from "./kb-v3.test-fixtures.ts";

const EMPTY: GeoReviewV3 = { decisions: [], suppressions: [] };
const DECIDED_AT = "2026-09-07T12:00:00.000Z";
const payload = completePayloadV3();
const ITEM_KEYS = geoV3ItemKeys(payload.knowledge);
const stamp = {
  contentHash: geoV3ItemContentHashes(payload.knowledge),
  decidedAt: DECIDED_AT,
  baseDraftVersion: "4",
};

const states = (review: GeoReviewV3 = EMPTY) =>
  geoV3DecisionStates(review, ITEM_KEYS);
const decisionOf = (review: GeoReviewV3, itemKey: string) =>
  review.decisions.find((record) => record.itemKey === itemKey);

/** Apply gestures and store them, the way the route does. */
function save(
  review: GeoReviewV3,
  actions: readonly GeoV3ReviewAction[],
): GeoReviewV3 {
  return materializeGeoV3Review(
    review,
    applyGeoV3ReviewActions(states(review), actions),
    stamp,
  );
}

describe("geoV3DecisionStates", () => {
  it("reads an item with no record as undecided", () => {
    expect(states().get(FACT_KEY_PRO)).toEqual({
      decision: "pending",
      override: null,
    });
    expect(states().size).toBe(ITEM_KEYS.length);
  });

  it("keeps an item excluded when only its suppression survived", () => {
    // A suppression outlives the decision record it was made with. Reading the
    // record list alone would resurrect the item as pending and publish it.
    const review: GeoReviewV3 = {
      decisions: [],
      suppressions: [{ itemKey: SCOPE_KEY, suppressedAt: DECIDED_AT }],
    };
    expect(states(review).get(SCOPE_KEY)).toEqual({
      decision: "excluded",
      override: null,
    });
  });
});

describe("the four owner gestures", () => {
  it("accepts one item at a time and toggles back to pending", () => {
    const accepted = save(EMPTY, [{ kind: "accept", itemKey: FACT_KEY_PRO }]);
    expect(decisionOf(accepted, FACT_KEY_PRO)).toMatchObject({
      decision: "accepted",
      override: null,
      baseDraftVersion: "4",
      decidedAt: DECIDED_AT,
    });
    expect(decisionOf(accepted, FACT_KEY_TEAM)).toBeUndefined();
    const undone = save(accepted, [{ kind: "accept", itemKey: FACT_KEY_PRO }]);
    expect(undone.decisions).toEqual([]);
  });

  it("records a correction as an acceptance of the corrected text", () => {
    const corrected = save(EMPTY, [
      {
        kind: "correct",
        itemKey: FACT_KEY_PRO,
        override: {
          module: "facts",
          statement: "The Pro plan costs 12 per month.",
          label: "Pro plan monthly price",
          value: "12",
          reason: "",
        },
      },
    ]);
    // The contract refuses an override on any decision but `accepted`, so this
    // is the pairing the payload parser is about to check.
    expect(decisionOf(corrected, FACT_KEY_PRO)).toMatchObject({
      decision: "accepted",
    });
    expect(decisionOf(corrected, FACT_KEY_PRO)?.override).toMatchObject({
      module: "facts",
      value: "12",
    });
    expect(() =>
      parseGeoKbPayloadV3({ ...payload, review: corrected }),
    ).not.toThrow();
  });

  it("sends an undone correction back to pending rather than to accepted", () => {
    const corrected = save(EMPTY, [
      {
        kind: "correct",
        itemKey: SCOPE_KEY,
        override: {
          module: "scope",
          text: "Acme does not run on Android or iOS.",
        },
      },
    ]);
    const reverted = save(corrected, [{ kind: "revert", itemKey: SCOPE_KEY }]);
    // Nobody said yes to the generated text; undoing a correction must not
    // silently accept what the correction replaced.
    expect(reverted.decisions).toEqual([]);
  });

  it("excludes an item, suppresses its key, and releases both on a second press", () => {
    const excluded = save(EMPTY, [{ kind: "exclude", itemKey: QA_KEY }]);
    expect(decisionOf(excluded, QA_KEY)).toMatchObject({
      decision: "excluded",
      override: null,
    });
    expect(excluded.suppressions).toEqual([
      { itemKey: QA_KEY, suppressedAt: DECIDED_AT },
    ]);
    const released = save(excluded, [{ kind: "exclude", itemKey: QA_KEY }]);
    expect(released.decisions).toEqual([]);
    expect(released.suppressions).toEqual([]);
  });

  it("leaves a corrected item alone when accept or exclude is aimed at it", () => {
    const before = applyGeoV3ReviewAction(states(), {
      kind: "correct",
      itemKey: SCOPE_KEY,
      override: { module: "scope", text: "Acme runs on the web only." },
    });
    // Returned by reference: the gesture reached nothing, which is what the
    // editor keys its "do not queue a write" check on.
    expect(
      applyGeoV3ReviewAction(before, { kind: "accept", itemKey: SCOPE_KEY }),
    ).toBe(before);
    expect(
      applyGeoV3ReviewAction(before, { kind: "exclude", itemKey: SCOPE_KEY }),
    ).toBe(before);
  });

  it("drops a gesture aimed at an item the knowledge does not contain", () => {
    const before = states();
    expect(
      applyGeoV3ReviewAction(before, {
        kind: "accept",
        itemKey: "f".repeat(64),
      }),
    ).toBe(before);
  });
});

describe("全部接受 (accept all)", () => {
  it("writes accepted_in_bulk and never accepted", () => {
    const swept = save(EMPTY, [{ kind: "accept_all", itemKeys: ITEM_KEYS }]);
    expect(swept.decisions).toHaveLength(ITEM_KEYS.length);
    // The one assertion this whole surface exists to protect: pressing a
    // different button must not let the same model output claim the stronger
    // label. Mutating the branch to write "accepted" turns this red.
    expect(swept.decisions.map((record) => record.decision)).toEqual(
      ITEM_KEYS.map(() => "accepted_in_bulk"),
    );
    expect(
      swept.decisions.some((record) => record.decision === "accepted"),
    ).toBe(false);
  });

  it("cannot produce a bare accepted from any sequence without a one-by-one acceptance", () => {
    /**
     * A property, not an example. Two gestures may write `accepted`, and both
     * are per-item confirmations: pressing 接受 on one row, and 修正, which is
     * an acceptance of the text the owner just typed. Everything else -- every
     * batch gesture, in every order and at every prefix -- may not, so an
     * `accepted` record reached without 接受 must carry an override.
     */
    const withoutAccept: readonly GeoV3ReviewAction[] = [
      { kind: "accept_all", itemKeys: ITEM_KEYS },
      { kind: "exclude", itemKey: QA_KEY },
      { kind: "accept_all", itemKeys: ITEM_KEYS },
      {
        kind: "correct",
        itemKey: SCOPE_KEY,
        override: { module: "scope", text: "Acme runs on the web only." },
      },
      { kind: "revert", itemKey: SCOPE_KEY },
      { kind: "accept_all", itemKeys: ITEM_KEYS },
      { kind: "exclude", itemKey: QA_KEY },
    ];
    for (let length = 1; length <= withoutAccept.length; length += 1) {
      const review = save(EMPTY, withoutAccept.slice(0, length));
      const bare = review.decisions.filter(
        (record) => record.decision === "accepted" && record.override === null,
      );
      expect(bare.map((record) => record.itemKey)).toEqual([]);
    }
  });

  it("leaves every already-decided item exactly as it was", () => {
    const decided = save(EMPTY, [
      { kind: "accept", itemKey: FACT_KEY_PRO },
      { kind: "exclude", itemKey: QA_KEY },
      {
        kind: "correct",
        itemKey: SCOPE_KEY,
        override: { module: "scope", text: "Acme runs on the web only." },
      },
    ]);
    const swept = save(decided, [{ kind: "accept_all", itemKeys: ITEM_KEYS }]);
    expect(decisionOf(swept, FACT_KEY_PRO)?.decision).toBe("accepted");
    expect(decisionOf(swept, QA_KEY)?.decision).toBe("excluded");
    expect(decisionOf(swept, SCOPE_KEY)?.decision).toBe("accepted");
    expect(decisionOf(swept, SCOPE_KEY)?.override).not.toBeNull();
    expect(decisionOf(swept, FACT_KEY_TEAM)?.decision).toBe("accepted_in_bulk");
    expect(decisionOf(swept, ENTITY_NAME_KEY)?.decision).toBe(
      "accepted_in_bulk",
    );
  });

  it("reaches only the keys it names", () => {
    const swept = save(EMPTY, [
      { kind: "accept_all", itemKeys: [FACT_KEY_PRO] },
    ]);
    expect(swept.decisions.map((record) => record.itemKey)).toEqual([
      FACT_KEY_PRO,
    ]);
    expect(geoV3PendingKeys(states(swept))).toEqual(
      ITEM_KEYS.filter((key) => key !== FACT_KEY_PRO),
    );
  });

  it("is a no-op once nothing is pending", () => {
    const swept = applyGeoV3ReviewAction(states(), {
      kind: "accept_all",
      itemKeys: ITEM_KEYS,
    });
    expect(
      applyGeoV3ReviewAction(swept, {
        kind: "accept_all",
        itemKeys: ITEM_KEYS,
      }),
    ).toBe(swept);
  });
});

describe("materializeGeoV3Review", () => {
  it("keeps an unchanged record verbatim so a repeated save changes no bytes", () => {
    const first = save(EMPTY, [{ kind: "accept", itemKey: FACT_KEY_PRO }]);
    const again = materializeGeoV3Review(first, states(first), {
      ...stamp,
      decidedAt: "2026-09-09T00:00:00.000Z",
      baseDraftVersion: "9",
    });
    // Re-stamping every record on every 900 ms autosave would change the
    // payload, and therefore the draft hash, when nobody decided anything.
    expect(again.decisions).toEqual(first.decisions);
  });

  it("records the content hash of the item the decision was made against", () => {
    const first = save(EMPTY, [{ kind: "accept", itemKey: FACT_KEY_PRO }]);
    expect(decisionOf(first, FACT_KEY_PRO)?.baseContentHash).toBe(
      stamp.contentHash.get(FACT_KEY_PRO),
    );
    expect(decisionOf(first, FACT_KEY_PRO)?.baseContentHash).not.toBe(
      stamp.contentHash.get(FACT_KEY_TEAM),
    );
  });

  it("keeps a suppression whose item is gone and drops the decision that named it", () => {
    const excluded = save(EMPTY, [
      { kind: "exclude", itemKey: FACT_KEY_TEAM },
      { kind: "accept", itemKey: FACT_KEY_PRO },
    ]);
    // The next update no longer produces the Team plan fact.
    const survivors = ITEM_KEYS.filter((key) => key !== FACT_KEY_TEAM);
    const next = materializeGeoV3Review(
      excluded,
      geoV3DecisionStates(excluded, survivors),
      stamp,
    );
    expect(next.suppressions.map((record) => record.itemKey)).toEqual([
      FACT_KEY_TEAM,
    ]);
    // A decision naming an absent item is refused by the payload parser, so it
    // cannot be kept even though the exclusion is.
    expect(next.decisions.map((record) => record.itemKey)).toEqual([
      FACT_KEY_PRO,
    ]);
  });

  it("produces a review the payload contract accepts", () => {
    const review = save(EMPTY, [
      { kind: "accept_all", itemKeys: ITEM_KEYS },
      { kind: "exclude", itemKey: QA_KEY },
      {
        kind: "correct",
        itemKey: FACT_KEY_PRO,
        override: {
          module: "facts",
          statement: "The Pro plan costs 12 per month.",
          label: "Pro plan monthly price",
          value: "12",
          reason: "",
        },
      },
    ]);
    expect(() => parseGeoKbPayloadV3({ ...payload, review })).not.toThrow();
  });
});

describe("counts and change reporting", () => {
  it("counts every decision class separately", () => {
    const review = save(EMPTY, [
      { kind: "accept", itemKey: FACT_KEY_PRO },
      { kind: "exclude", itemKey: QA_KEY },
      { kind: "accept_all", itemKeys: [FACT_KEY_TEAM] },
    ]);
    expect(geoV3ReviewCounts(states(review))).toEqual({
      total: ITEM_KEYS.length,
      accepted: 1,
      acceptedInBulk: 1,
      excluded: 1,
      pending: ITEM_KEYS.length - 3,
      corrected: 0,
    });
  });

  it("reports which items one batch of gestures changed", () => {
    const before = states();
    const after = applyGeoV3ReviewActions(before, [
      { kind: "accept", itemKey: FACT_KEY_PRO },
      { kind: "exclude", itemKey: QA_KEY },
    ]);
    expect([...geoV3ChangedKeys(before, after)].sort()).toEqual(
      [FACT_KEY_PRO, QA_KEY].sort(),
    );
  });
});
