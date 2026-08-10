import { describe, expect, it } from "vitest";

import {
  hasMeasuredKeywordDemand,
  keywordValidationFor,
  keywordVolumeKey,
  resolveKeywordValidations,
  type KeywordOpportunityProviderRow,
} from "./validation.ts";
import {
  KEYWORD_OPPORTUNITY_VOLUME_STATES,
  type KeywordOpportunityValidation,
} from "./types.ts";

function providerRow(
  overrides: Partial<KeywordOpportunityProviderRow> = {},
): KeywordOpportunityProviderRow {
  return {
    keyword: "invoice software",
    volume: 1300,
    difficulty: 24,
    intent: "commercial",
    serpFeatures: ["people_also_ask"],
    ...overrides,
  };
}

function validation(
  overrides: Partial<KeywordOpportunityValidation> = {},
): KeywordOpportunityValidation {
  return {
    availability: "provider_no_data",
    volume: null,
    difficulty: null,
    intent: null,
    serpFeatures: [],
    ...overrides,
  };
}

describe("keywordVolumeKey", () => {
  it("collapses the casing and spacing a provider is free to change", () => {
    // The provider echoes terms back in its own house style. Any difference
    // that survives normalisation turns a returned row into a missing one,
    // which in this pipeline reads as "the provider said nothing".
    expect(keywordVolumeKey("  Invoice   Software ")).toBe("invoice software");
    expect(keywordVolumeKey("INVOICE\tSOFTWARE")).toBe("invoice software");
    expect(keywordVolumeKey("invoice\nsoftware")).toBe("invoice software");
  });

  it("leaves an already-normal term untouched so the key is stable", () => {
    expect(keywordVolumeKey("invoice software")).toBe("invoice software");
  });
});

describe("resolveKeywordValidations", () => {
  it("calls a keyword the provider never answered provider_no_data, not zero", () => {
    // This set difference is the whole reason the module exists: the provider
    // drops terms it has no data for rather than returning them as 0, so a
    // pipeline that infers no-data from a missing volume later would have to
    // guess. 74.9% of Tranche 2 candidates landed here.
    const resolved = resolveKeywordValidations(
      ["invoice software", "silent term"],
      [providerRow()],
    );

    expect(resolved.get("silent term")).toEqual(
      validation({ availability: "provider_no_data" }),
    );
    expect(resolved.get("invoice software")?.availability).toBe("available");
  });

  it("reads a returned row with a null volume as silence rather than as a zero", () => {
    // A row can come back carrying no number. That is still the provider
    // declining to measure the term; only a literal 0 means measured-and-none.
    const resolved = resolveKeywordValidations(
      ["invoice software"],
      [providerRow({ volume: null })],
    );

    expect(resolved.get("invoice software")).toEqual({
      availability: "provider_no_data",
      volume: null,
      difficulty: 24,
      intent: "commercial",
      serpFeatures: ["people_also_ask"],
    });
  });

  it("keeps an explicit zero distinct from silence and never stores the 0", () => {
    // explicit_zero is a measurement; provider_no_data is its absence. The
    // volume field stays null so no surface can print "0 searches/mo" as
    // though it were interchangeable with an unmeasured term.
    const resolved = resolveKeywordValidations(
      ["invoice software"],
      [providerRow({ volume: 0 })],
    );
    const entry = resolved.get("invoice software");

    expect(entry?.availability).toBe("explicit_zero");
    expect(entry?.volume).toBeNull();
    expect(entry?.difficulty).toBe(24);
  });

  it("marks a positive volume available and carries the number through", () => {
    const resolved = resolveKeywordValidations(
      ["invoice software"],
      [providerRow({ volume: 1 })],
    );

    expect(resolved.get("invoice software")).toEqual({
      availability: "available",
      volume: 1,
      difficulty: 24,
      intent: "commercial",
      serpFeatures: ["people_also_ask"],
    });
  });

  it("treats a negative volume as measured-no-demand rather than as demand", () => {
    // A provider glitch must not become a positive volume on a row the SEO
    // lane is allowed to stand on; the conservative reading is the safe one.
    const resolved = resolveKeywordValidations(
      ["invoice software"],
      [providerRow({ volume: -5 })],
    );
    const entry = resolved.get("invoice software");

    expect(entry?.availability).toBe("explicit_zero");
    expect(entry?.volume).toBeNull();
  });

  it("matches a returned row whose casing and spacing differ from the request", () => {
    // Without normalisation on both sides this row would be invisible and the
    // term would be reported as unmeasured while its data sat in the response.
    const resolved = resolveKeywordValidations(
      ["  Invoice   Software  "],
      [providerRow({ keyword: "INVOICE software" })],
    );

    expect(resolved.get("invoice software")?.availability).toBe("available");
    expect(resolved.size).toBe(1);
  });

  it("returns an empty map when nothing was requested, whatever came back", () => {
    // The requested list drives the output; a provider that volunteers extra
    // rows must not silently add candidates to the funnel.
    expect(resolveKeywordValidations([], [providerRow()]).size).toBe(0);
  });

  it("gives every requested keyword a verdict when the provider returned nothing at all", () => {
    // A total provider outage has to look like three no-data facts, not like
    // three missing keys the caller has to interpret.
    const resolved = resolveKeywordValidations(["a", "b", "c"], []);

    expect(resolved.size).toBe(3);
    expect([...resolved.values()].map((v) => v.availability)).toEqual([
      "provider_no_data",
      "provider_no_data",
      "provider_no_data",
    ]);
  });

  it("ignores rows for terms nobody asked about", () => {
    const resolved = resolveKeywordValidations(
      ["invoice software"],
      [providerRow(), providerRow({ keyword: "unrequested term" })],
    );

    expect([...resolved.keys()]).toEqual(["invoice software"]);
  });

  it("collapses duplicate requests to one verdict keyed by the normalised term", () => {
    const resolved = resolveKeywordValidations(
      ["Invoice Software", "invoice software"],
      [providerRow()],
    );

    expect([...resolved.keys()]).toEqual(["invoice software"]);
  });

  it("lets the last row win when the provider repeats a term", () => {
    // Providers do echo a term twice. Picking one deterministically beats
    // leaving the verdict dependent on iteration order elsewhere.
    const resolved = resolveKeywordValidations(
      ["invoice software"],
      [providerRow({ volume: 900 }), providerRow({ volume: 40 })],
    );

    expect(resolved.get("invoice software")?.volume).toBe(40);
  });

  it("preserves nulls the provider sent for difficulty and intent instead of inventing values", () => {
    const resolved = resolveKeywordValidations(
      ["invoice software"],
      [providerRow({ difficulty: null, intent: null, serpFeatures: [] })],
    );

    expect(resolved.get("invoice software")).toEqual({
      availability: "available",
      volume: 1300,
      difficulty: null,
      intent: null,
      serpFeatures: [],
    });
  });
});

describe("keywordValidationFor", () => {
  it("answers no-data for an unknown keyword rather than throwing at the surface", () => {
    // Callers render this per row. A throw on a keyword that never reached the
    // provider would take down the whole report over one missing term.
    const resolved = resolveKeywordValidations(["invoice software"], []);

    expect(keywordValidationFor(resolved, "never requested")).toEqual(
      validation({ availability: "provider_no_data" }),
    );
  });

  it("finds a verdict through the same normalisation the map was keyed with", () => {
    // Callers hold the original keyword casing; lookups must not depend on it.
    const resolved = resolveKeywordValidations(
      ["invoice software"],
      [providerRow()],
    );

    expect(keywordValidationFor(resolved, "  Invoice  SOFTWARE ").volume).toBe(
      1300,
    );
  });

  it("answers no-data from an empty map", () => {
    expect(
      keywordValidationFor(new Map(), "invoice software").availability,
    ).toBe("provider_no_data");
  });
});

describe("hasMeasuredKeywordDemand", () => {
  it("is true only for a measured positive volume", () => {
    // The SEO lane stands on this predicate. If explicit_zero or silence ever
    // counted as demand, the lane would publish rows it has no evidence for.
    const truthByState = Object.fromEntries(
      KEYWORD_OPPORTUNITY_VOLUME_STATES.map((availability) => [
        availability,
        hasMeasuredKeywordDemand(validation({ availability })),
      ]),
    );

    expect(truthByState).toEqual({
      available: true,
      explicit_zero: false,
      provider_no_data: false,
    });
  });

  it("does not consult the volume field, only the stated availability", () => {
    // availability is the fact; volume is a display value that is null for
    // every non-available state. Reading volume here would re-derive the
    // three-state answer from a two-state field.
    expect(
      hasMeasuredKeywordDemand(
        validation({ availability: "available", volume: null }),
      ),
    ).toBe(true);
  });
});
