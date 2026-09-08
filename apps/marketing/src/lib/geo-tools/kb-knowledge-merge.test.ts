import { describe, expect, it } from "vitest";

import { geoV3ItemContentHashes } from "./kb-v3-item-content.ts";
import { geoItemKey } from "./kb-item-key.ts";
import {
  GEO_CONFLICTING_FACT_STATEMENT,
  mergeGeoDraftV3,
  type GeoMergeOutcome,
} from "./kb-knowledge-merge.ts";
import {
  assembledPayload,
  OWN_SOURCE,
  PLANS_SOURCE,
  type AssemblyFixtureOptions,
} from "./kb-knowledge-assemble.test-fixtures.ts";
import { geoV2NarrativeFixture } from "./kb-knowledge-synthesis-v2-fixtures.ts";
import {
  parseGeoKbPayloadV3,
  type GeoKbPayloadV3,
  type GeoOverrideV3,
  type GeoReviewV3,
} from "./kb-v3-contract.ts";

type Narrative = ReturnType<typeof geoV2NarrativeFixture>;
type Decision = GeoReviewV3["decisions"][number];

const DECIDED_AT = "2026-09-05T12:00:00.000Z";

const PRO_KEY = geoItemKey({
  module: "facts", type: "price", subject: "Pine Cloud", attribute: "Monthly price", qualifiers: ["Pro plan"],
});
const TEAM_KEY = geoItemKey({
  module: "facts", type: "price", subject: "Pine Cloud", attribute: "Monthly price", qualifiers: ["Team plan"],
});
const DRIFTED_PRO_KEY = geoItemKey({
  module: "facts", type: "price", subject: "Pine Cloud", attribute: "Monthly price", qualifiers: ["Pro plan tier"],
});

function contentHash(payload: GeoKbPayloadV3, itemKey: string): string {
  const hash = geoV3ItemContentHashes(payload.knowledge).get(itemKey);
  if (hash === undefined) throw new Error(`missing item ${itemKey}`);
  return hash;
}

function decision(itemKey: string, over: Partial<Decision> = {}): Decision {
  return {
    itemKey,
    decision: "accepted",
    override: null,
    baseContentHash: "0".repeat(64),
    decidedAt: DECIDED_AT,
    baseDraftVersion: "1",
    ...over,
  };
}

function withReview(payload: GeoKbPayloadV3, review: GeoReviewV3): GeoKbPayloadV3 {
  return parseGeoKbPayloadV3({ ...payload, review });
}

function merge(next: GeoKbPayloadV3, previous: GeoKbPayloadV3 | null) {
  return mergeGeoDraftV3({ next, previous, previousDraftVersion: "1" });
}

function outcome(outcomes: readonly GeoMergeOutcome[], itemKey: string): GeoMergeOutcome {
  const found = outcomes.find((entry) => entry.itemKey === itemKey);
  if (found === undefined) throw new Error(`no outcome for ${itemKey}`);
  return found;
}

function factRow(payload: GeoKbPayloadV3, itemKey: string) {
  const module = payload.knowledge?.facts;
  if (module === undefined || module.status === "unavailable") throw new Error("facts unavailable");
  return module.value.find((fact) => fact.itemKey === itemKey);
}

/** The same run with the Pro price restated, optionally from another page. */
function restatedPro(statement: string, value: string, sourceRefs: readonly string[]): AssemblyFixtureOptions["narrative"] {
  return (narrative: Narrative) => ({
    ...narrative,
    facts: narrative.facts.map((fact) => fact.id === "fact:pro-price"
      ? { ...fact, statement, value, sourceRefs: [...sourceRefs] }
      : fact),
  });
}

describe("mergeGeoDraftV3", () => {
  it("treats a first update as all new, with nothing decided", () => {
    const merged = merge(assembledPayload(), null);
    expect(merged.payload.review.decisions).toEqual([]);
    expect(merged.outcomes.every((entry) => entry.kind === "new")).toBe(true);
    expect(merged.outcomes.every((entry) => entry.similarTo === null)).toBe(true);
  });

  it("keeps a decision when the same key comes back with the same content", () => {
    const previousDraft = assembledPayload();
    const previous = withReview(previousDraft, {
      decisions: [decision(PRO_KEY, { baseContentHash: contentHash(previousDraft, PRO_KEY) })],
      suppressions: [],
    });
    const merged = merge(assembledPayload(), previous);
    expect(outcome(merged.outcomes, PRO_KEY).kind).toBe("unchanged");
    expect(merged.payload.review.decisions).toEqual(previous.review.decisions);
  });

  it("keeps the decision but leaves the new observation visible when the same page changed", () => {
    const previousDraft = assembledPayload();
    const previous = withReview(previousDraft, {
      decisions: [decision(PRO_KEY, { baseContentHash: contentHash(previousDraft, PRO_KEY) })],
      suppressions: [],
    });
    const next = assembledPayload({ narrative: restatedPro("Pro costs $9 per month.", "$9", [OWN_SOURCE]) });
    const merged = merge(next, previous);
    expect(outcome(merged.outcomes, PRO_KEY).kind).toBe("new_observation");
    const kept = merged.payload.review.decisions.find((entry) => entry.itemKey === PRO_KEY);
    expect(kept?.decision).toBe("accepted");
    // The decision still points at the text that was approved, which is how the
    // card knows to say the item has been re-observed.
    expect(kept?.baseContentHash).not.toBe(contentHash(merged.payload, PRO_KEY));
  });

  it("withholds a fact's value when a different page disagrees, instead of picking a winner", () => {
    const previous = assembledPayload();
    const next = assembledPayload({
      plansExcerpts: ["Pro is $19 per month on the plans page."],
      narrative: restatedPro("The Pro plan costs $19 per month.", "$19", [PLANS_SOURCE]),
    });
    const merged = merge(next, previous);
    expect(outcome(merged.outcomes, PRO_KEY).kind).toBe("conflicting");
    const fact = factRow(merged.payload, PRO_KEY);
    expect(fact?.value).toBeNull();
    expect(fact?.reason).toBe("conflicting");
    expect(fact?.statement).toBe(GEO_CONFLICTING_FACT_STATEMENT);
    expect(fact?.sourceRefs).toEqual([PLANS_SOURCE, OWN_SOURCE]);
    expect(fact?.alternateObservations.map((entry) => entry.summary)).toEqual([
      "The Pro plan costs $19 per month.",
      "The Pro plan costs $9 per month.",
    ]);
  });

  it("leaves the other plan alone: differing qualifiers are a different item", () => {
    const previousDraft = assembledPayload();
    const override: GeoOverrideV3 = {
      module: "facts", statement: "The Pro plan costs $12 per month.", label: "Monthly price", value: "$12", reason: "",
    };
    const previous = withReview(previousDraft, {
      decisions: [decision(PRO_KEY, { override, baseContentHash: contentHash(previousDraft, PRO_KEY) })],
      suppressions: [],
    });
    const merged = merge(assembledPayload(), previous);
    expect(merged.payload.review.decisions.map((entry) => entry.itemKey)).toEqual([PRO_KEY]);
    expect(outcome(merged.outcomes, TEAM_KEY).kind).toBe("unchanged");
    expect(factRow(merged.payload, TEAM_KEY)?.value).toBe("$19");
  });

  it("prompts about drifted wording and never inherits the decision behind it", () => {
    const previousDraft = assembledPayload();
    const previous = withReview(previousDraft, {
      decisions: [decision(PRO_KEY, { decision: "excluded", baseContentHash: contentHash(previousDraft, PRO_KEY) })],
      suppressions: [{ itemKey: PRO_KEY, suppressedAt: DECIDED_AT }],
    });
    const next = assembledPayload({
      narrative: (narrative: Narrative) => ({
        ...narrative,
        facts: narrative.facts.map((fact) => fact.id === "fact:pro-price"
          ? { ...fact, qualifiers: ["Pro plan tier"] }
          : fact),
      }),
    });
    const merged = merge(next, previous);
    const drifted = outcome(merged.outcomes, DRIFTED_PRO_KEY);
    expect(drifted.kind).toBe("new");
    expect(drifted.similarTo?.itemKey).toBe(PRO_KEY);
    expect(drifted.similarTo?.decision).toBe("excluded");
    expect(drifted.similarTo?.similarity).toBeGreaterThanOrEqual(0.75);
    // The prompt is the whole mechanism: nothing about the drifted item is
    // decided, and it is still in the body for the owner to look at.
    expect(merged.payload.review.decisions.some((entry) => entry.itemKey === DRIFTED_PRO_KEY)).toBe(false);
    expect(factRow(merged.payload, DRIFTED_PRO_KEY)).toBeDefined();
  });

  it("re-applies an exclusion when the excluded item comes back", () => {
    const previous = withReview(
      assembledPayload({
        narrative: (narrative: Narrative) => ({
          ...narrative,
          facts: narrative.facts.filter((fact) => fact.id !== "fact:pro-price"),
        }),
      }),
      { decisions: [], suppressions: [{ itemKey: PRO_KEY, suppressedAt: DECIDED_AT }] },
    );
    const merged = merge(assembledPayload(), previous);
    // The item is back in the body, but not back in front of the owner as
    // something they have not yet decided about.
    const revived = merged.payload.review.decisions.find((entry) => entry.itemKey === PRO_KEY);
    expect(revived?.decision).toBe("excluded");
    expect(outcome(merged.outcomes, PRO_KEY).kind).toBe("suppressed");
    // The owner excluded it then, not now.
    expect(revived?.decidedAt).toBe(DECIDED_AT);
    expect(merged.payload.review.suppressions.map((entry) => entry.itemKey)).toContain(PRO_KEY);
  });

  it("does not extend an exclusion to a merely similar item", () => {
    const previous = withReview(assembledPayload(), {
      decisions: [],
      suppressions: [{ itemKey: PRO_KEY, suppressedAt: DECIDED_AT }],
    });
    const next = assembledPayload({
      narrative: (narrative: Narrative) => ({
        ...narrative,
        facts: narrative.facts.map((fact) => fact.id === "fact:pro-price"
          ? { ...fact, qualifiers: ["Pro plan tier"] }
          : fact),
      }),
    });
    const merged = merge(next, previous);
    const revived = merged.payload.review.decisions.find((entry) => entry.itemKey === DRIFTED_PRO_KEY);
    expect(revived).toBeUndefined();
    expect(factRow(merged.payload, DRIFTED_PRO_KEY)).toBeDefined();
  });

  it("keeps a corrected item after the observation behind it disappears", () => {
    const previousDraft = assembledPayload();
    const override: GeoOverrideV3 = {
      module: "facts", statement: "The Team plan costs $25 per month.", label: "Monthly price", value: "$25", reason: "",
    };
    const previous = withReview(previousDraft, {
      decisions: [decision(TEAM_KEY, { override, baseContentHash: contentHash(previousDraft, TEAM_KEY) })],
      suppressions: [],
    });
    const next = assembledPayload({
      narrative: (narrative: Narrative) => ({
        ...narrative,
        facts: narrative.facts.filter((fact) => fact.id !== "fact:team-price"),
      }),
    });
    const merged = merge(next, previous);
    expect(outcome(merged.outcomes, TEAM_KEY).kind).toBe("carried_declared");
    expect(factRow(merged.payload, TEAM_KEY)?.value).toBe("$19");
    expect(merged.payload.review.decisions.find((entry) => entry.itemKey === TEAM_KEY)?.override).toEqual(override);
  });

  it("remembers an exclusion after the item it applied to disappears", () => {
    const previousDraft = assembledPayload();
    const previous = withReview(previousDraft, {
      decisions: [decision(TEAM_KEY, { decision: "excluded", baseContentHash: contentHash(previousDraft, TEAM_KEY) })],
      suppressions: [],
    });
    const next = assembledPayload({
      narrative: (narrative: Narrative) => ({
        ...narrative,
        facts: narrative.facts.filter((fact) => fact.id !== "fact:team-price"),
      }),
    });
    const merged = merge(next, previous);
    expect(outcome(merged.outcomes, TEAM_KEY).kind).toBe("dropped");
    expect(merged.payload.review.decisions.some((entry) => entry.itemKey === TEAM_KEY)).toBe(false);
    expect(merged.payload.review.suppressions.map((entry) => entry.itemKey)).toContain(TEAM_KEY);
    expect(merged.evictedSuppressions).toEqual([]);
  });

  it("returns a payload the v3 parser accepts, with every key still derived from content", () => {
    const previous = withReview(assembledPayload(), {
      decisions: [decision(PRO_KEY, { baseContentHash: contentHash(assembledPayload(), PRO_KEY) })],
      suppressions: [],
    });
    const next = assembledPayload({
      plansExcerpts: ["Pro is $19 per month on the plans page."],
      narrative: restatedPro("The Pro plan costs $19 per month.", "$19", [PLANS_SOURCE]),
    });
    expect(() => parseGeoKbPayloadV3(merge(next, previous).payload)).not.toThrow();
  });
});
