import { describe, expect, it } from "vitest";

import { geoV3ItemContentHashes, geoV3RestatedItemKeys } from "./kb-v3-item-content.ts";
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

/** A digit-free unique suffix, so a padding fact makes no numeric claim. */
function letters(index: number): string {
  return `${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + (index % 26))}`;
}

/**
 * The same run padded to a chosen number of facts, so the 64-row ceiling can be
 * reached on purpose. Fillers carry no digits: a number in one would have to be
 * supported by an excerpt like every other claim.
 */
function filled(count: number, options: { readonly dropTeam?: boolean } = {}): AssemblyFixtureOptions["narrative"] {
  return (narrative: Narrative) => {
    const kept = options.dropTeam === true
      ? narrative.facts.filter((fact) => fact.id !== "fact:team-price")
      : narrative.facts;
    return {
      ...narrative,
      facts: [
        ...kept,
        ...Array.from({ length: count - kept.length }, (_unused, index) => ({
          ...narrative.facts[0]!, id: `fact:filler-${letters(index)}`, type: "price" as const,
          statement: `Filler ${letters(index)} pricing stays unpublished.`,
          label: `Filler ${letters(index)}`, value: null as string | null, reason: "notPublished",
          attribute: `Filler attribute ${letters(index)}`, qualifiers: [] as string[],
        })),
      ],
    };
  };
}

/** Every fact item key in a payload, in walk order. */
function factKeys(payload: GeoKbPayloadV3): readonly string[] {
  const module = payload.knowledge?.facts;
  if (module === undefined || module.status === "unavailable") return [];
  return module.value.map((fact) => fact.itemKey);
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
    expect(geoV3RestatedItemKeys(merged.payload.knowledge, merged.payload.review)).toEqual([]);
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
    // card knows to say the item has been re-observed. That last hop is a real
    // wire, not a comment: `geoV3RestatedItemKeys` is what the loader and the
    // save route ship, and `geo-kb-v3-review.tsx` turns it into the row's
    // "has a new observation" chip. Asserting only the hash mismatch here is
    // what let the chip go unwired while this test stayed green.
    expect(kept?.baseContentHash).not.toBe(contentHash(merged.payload, PRO_KEY));
    expect(geoV3RestatedItemKeys(merged.payload.knowledge, merged.payload.review)).toEqual([PRO_KEY]);
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

  /**
   * Section 4.4: "key 消失 → `declared_owner` 的修正条目保留（它本来就不依赖观察）".
   * There is no exception in that sentence for "unless this run observed nothing
   * at all", and that is exactly the run where the owner's own answer is the
   * only thing left. The module comes back as `partial` holding the correction,
   * because a section that holds the owner's declaration is not empty.
   */
  it("keeps a corrected fact when the update closed the whole facts module", () => {
    const previousDraft = assembledPayload();
    const override: GeoOverrideV3 = {
      module: "facts", statement: "The Team plan costs $25 per month.", label: "Monthly price", value: "$25", reason: "",
    };
    const previous = withReview(previousDraft, {
      decisions: [decision(TEAM_KEY, { override, baseContentHash: contentHash(previousDraft, TEAM_KEY) })],
      suppressions: [],
    });
    const next = assembledPayload({ narrative: (narrative: Narrative) => ({ ...narrative, facts: [] }) });
    expect(next.knowledge?.facts.status).toBe("unavailable");

    const merged = merge(next, previous);

    expect(outcome(merged.outcomes, TEAM_KEY).kind).toBe("carried_declared");
    expect(merged.payload.knowledge?.facts.status).toBe("partial");
    expect(factRow(merged.payload, TEAM_KEY)?.value).toBe("$19");
    expect(merged.payload.review.decisions.find((entry) => entry.itemKey === TEAM_KEY)?.override).toEqual(override);
    expect(merged.droppedCorrections).toEqual([]);
    // The reopened module says WHY it is partial as a clause key, not only as a
    // sentence: this is the one limitation an owner sees on a run that observed
    // nothing, and it has to reach them in their own language.
    const facts = merged.payload.knowledge?.facts;
    expect(facts?.status === "partial" ? facts.limitationKeys : undefined)
      .toEqual([{ key: "carried_owner_declared_only" }]);
  });

  it("evicts an undecided generated row rather than the owner's correction when the list is full", () => {
    const previousDraft = assembledPayload();
    const override: GeoOverrideV3 = {
      module: "facts", statement: "The Team plan costs $25 per month.", label: "Monthly price", value: "$25", reason: "",
    };
    const previous = withReview(previousDraft, {
      decisions: [decision(TEAM_KEY, { override, baseContentHash: contentHash(previousDraft, TEAM_KEY) })],
      suppressions: [],
    });
    // The Team fact is gone and the module is at its 64-row ceiling, so there is
    // no room for the carried row unless something makes way.
    const next = assembledPayload({ narrative: filled(64, { dropTeam: true }) });
    expect(next.knowledge?.facts.status === "unavailable" ? 0 : next.knowledge!.facts.value.length).toBe(64);

    const merged = merge(next, previous);

    expect(outcome(merged.outcomes, TEAM_KEY).kind).toBe("carried_declared");
    expect(factRow(merged.payload, TEAM_KEY)?.value).toBe("$19");
    expect(merged.droppedCorrections).toEqual([]);
  });

  it("never evicts one owner decision to carry another", () => {
    // Every surviving row is one the owner decided, so there is nothing this
    // merge is allowed to drop. The correction is then REPORTED rather than
    // deleted in silence, and rather than paid for out of another decision.
    const previousDraft = assembledPayload({ narrative: filled(64) });
    const override: GeoOverrideV3 = {
      module: "facts", statement: "The Team plan costs $25 per month.", label: "Monthly price", value: "$25", reason: "",
    };
    const next = assembledPayload({ narrative: filled(64, { dropTeam: true }) });
    const survivors = factKeys(next).filter((itemKey) => itemKey !== TEAM_KEY);
    // A decision has to name an item the draft it lives in carries, so the row
    // that only exists in the new body is spoken for by an exclusion instead --
    // exclusions outlive their items by design, and the merge treats one as
    // decided for exactly the reason under test.
    const carriedOver = new Set(factKeys(previousDraft));
    const previous = withReview(previousDraft, {
      decisions: [
        decision(TEAM_KEY, { override, baseContentHash: contentHash(previousDraft, TEAM_KEY) }),
        ...survivors.filter((itemKey) => carriedOver.has(itemKey)).map((itemKey) => decision(itemKey)),
      ],
      suppressions: survivors.filter((itemKey) => !carriedOver.has(itemKey))
        .map((itemKey) => ({ itemKey, suppressedAt: DECIDED_AT })),
    });

    const merged = merge(next, previous);

    expect(factKeys(next)).toHaveLength(64);
    expect(outcome(merged.outcomes, TEAM_KEY).kind).toBe("dropped_unmergeable");
    expect(merged.droppedCorrections).toEqual([{ itemKey: TEAM_KEY, override }]);
    // Nothing was traded away: every other decision is still here.
    expect(merged.payload.review.decisions.map((entry) => entry.itemKey).sort()).toEqual([...survivors].sort());
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

  /**
   * The comparisons module's scope key is per competitor, so "this competitor
   * did not come back" and "this section was never observed" look identical at
   * the point the carry is decided. They are not the same fact, and the second
   * one is a sentence the owner reads.
   *
   * The second competitor is grafted onto an assembled payload rather than run
   * through the narrative fixture: the narrative parser refuses a comparison
   * against a competitor the evidence does not confirm, and widening that
   * shared fixture would change every assembly test to prove one merge rule.
   */
  describe("carrying a competitor the new run did not compare", () => {
    function withSecondCompetitor(payload: GeoKbPayloadV3): GeoKbPayloadV3 {
      const comparisons = payload.knowledge?.comparisons;
      if (comparisons === undefined || comparisons.status === "unavailable") throw new Error("fixture has no comparisons");
      const first = comparisons.value[0]!;
      const key = "second.example";
      return parseGeoKbPayloadV3({
        ...payload,
        knowledge: {
          ...payload.knowledge,
          comparisons: {
            ...comparisons,
            value: [...comparisons.value, {
              ...structuredClone(first),
              id: "comparison:second",
              competitor: { key, name: "Second", confirmed: true },
              rows: first.rows.map((row) => ({
                ...structuredClone(row),
                id: `${row.id}-second`,
                itemKey: geoItemKey({ module: "comparisons", competitorKey: key, dimension: row.dimension }),
              })),
            }],
          },
        },
      });
    }

    function comparisonsOf(payload: GeoKbPayloadV3) {
      const module = payload.knowledge?.comparisons;
      if (module === undefined || module.status === "unavailable") throw new Error("comparisons unavailable");
      return module;
    }

    it("keeps the module's own status when other competitors did come back", () => {
      const previous = withSecondCompetitor(assembledPayload());
      const carried = comparisonsOf(previous).value.find((entry) => entry.competitor.key === "second.example");
      const row = carried?.rows[0];
      if (row === undefined) throw new Error("no second competitor row");
      // A decision is what makes the row outlive the observation.
      const decided = withReview(previous, {
        decisions: [decision(row.itemKey, {
          override: { module: "comparisons", product: "Teams of 2", competitor: "Teams of 9" },
        })],
        suppressions: [],
      });

      // This update compared only the first competitor.
      const merged = merge(assembledPayload(), decided);
      const module = comparisonsOf(merged.payload);
      // The run DID observe this section. Saying otherwise is the defect, and
      // `partial` also forces the review card out of its folded summary.
      expect(module.status).toBe(comparisonsOf(assembledPayload()).status);
      expect(JSON.stringify(module)).not.toContain("observed nothing for this section");
      // ...and the carried competitor is still there beside the observed one.
      expect(module.value.map((entry) => entry.competitor.key).toSorted())
        .toEqual(["rival.example", "second.example"]);
    });
  });
});
