// @input  -- item-type lists as the provider returns them, including absent
// @output -- proof 9.1 and 9.4 decide, and that a missing list is not "clean"
// @pos    -- unit coverage for the region Batch 6 added

import { describe, expect, it } from "vitest";

import { evaluateAgentAuditScope } from "../agent-audit/evaluate.ts";
import { isSerpShapeRecord } from "./contract.ts";
import {
  buildSerpShapeRecords,
  SERP_SHAPE_RECORD_IDS,
  type SerpShapeRaw,
} from "./serp-shape.ts";

function raw(overrides: Partial<SerpShapeRaw> = {}): SerpShapeRaw {
  return {
    keyword: "natal chart",
    itemTypes: ["organic", "people_also_ask"],
    unresolvedItemCount: 0,
    organicCount: 10,
    domainTraffic: null,
    marketCode: "US",
    languageCode: "en",
    ...overrides,
  };
}

function decide(input: SerpShapeRaw | null, id: string) {
  return evaluateAgentAuditScope("page", {
    availability: "available",
    records: buildSerpShapeRecords(input),
    targetUrl: "https://acme.test/p",
    targetInspected: true,
    inspectedTargetUrl: "https://acme.test/p",
  }).checks.find((entry) => entry.check.id === id);
}

describe("serp shape records", () => {
  it("emits both records whatever the provider returned", () => {
    for (const input of [null, raw(), raw({ itemTypes: null })]) {
      expect(buildSerpShapeRecords(input).map((r) => r.id)).toEqual(
        SERP_SHAPE_RECORD_IDS,
      );
    }
  });

  it("9.1 fires on an AI answer block and passes without one", () => {
    expect(
      decide(raw({ itemTypes: ["organic", "ai_overview"] }), "9.1")?.result,
    ).toBe("warning");
    expect(decide(raw(), "9.1")?.result).toBe("pass");
  });

  it("knows the provider's second name for the same surface", () => {
    // The provider has renamed this block once already. A list that only knows
    // the old name reports "no AI answer" on every page that has the new one.
    expect(
      decide(raw({ itemTypes: ["ai_overview_reference"] }), "9.1")?.result,
    ).toBe("warning");
  });

  it("9.4 fires when nothing on the page is somebody's reader", () => {
    expect(decide(raw({ itemTypes: ["organic"] }), "9.4")?.result).toBe("tip");
    expect(
      decide(raw({ itemTypes: ["organic", "discussions_and_forums"] }), "9.4")
        ?.result,
    ).toBe("pass");
    expect(decide(raw({ itemTypes: ["organic", "video"] }), "9.4")?.result).toBe(
      "pass",
    );
  });

  it("reads a missing item-type list as unmeasured, not as an empty page", () => {
    // The provider omits the block rather than sending an empty list. Reading
    // null as absence would report every unlisted page as having no AI answer
    // — a pass on something never observed — and would fire 9.4 on all of them.
    for (const id of ["9.1", "9.4"]) {
      expect(decide(raw({ itemTypes: null }), id)?.result).toBe("excluded");
    }
  });

  it("spends nothing and says so when no query was confirmed", () => {
    expect(buildSerpShapeRecords(null)[0]?.limitation).toBe(
      "no_target_query_was_confirmed_so_no_results_page_was_sampled",
    );
    expect(decide(null, "9.1")?.result).toBe("excluded");
  });

  it("says when the sample lost items rather than averaging around it", () => {
    const record = buildSerpShapeRecords(
      raw({ itemTypes: ["organic"], unresolvedItemCount: 4, organicCount: 6 }),
    ).find((entry) => entry.id === "no_community_result_present");

    expect(record?.limitation).toBe(
      "some_organic_items_were_unusable_so_this_is_a_thinner_sample_than_page_one",
    );
    expect(
      record?.observations[0]?.values.find(
        (entry) => entry.label === "unresolved_serp_items",
      )?.value,
    ).toBe(4);
  });

  it("publishes the whole block list, not only the matched ones", () => {
    const record = buildSerpShapeRecords(
      raw({ itemTypes: ["organic", "ai_overview", "shopping"] }),
    )[0];

    expect(
      record?.observations[0]?.values.find(
        (entry) => entry.label === "serp_item_types",
      )?.value,
    ).toBe("organic ai_overview shopping");
  });

  it("reports the negative low-traffic condition as not observed when a small site exists", () => {
    const record = buildSerpShapeRecords(
      raw({
        domainTraffic: [{ domain: "small.test", organicEtv: 999 }],
      }),
    ).find((entry) => entry.id === "page_one_without_a_low_traffic_site");

    expect(record).toMatchObject({
      state: "not_observed",
      tested: 1,
      affected: 0,
      observations: [],
    });
    expect(record === undefined ? false : isSerpShapeRecord(record)).toBe(true);
  });

  it("observes the low-traffic gap when every sized page-one site is large", () => {
    const record = buildSerpShapeRecords(
      raw({
        domainTraffic: [
          { domain: "large-a.test", organicEtv: 10_000 },
          { domain: "large-b.test", organicEtv: 20_000 },
        ],
      }),
    ).find((entry) => entry.id === "page_one_without_a_low_traffic_site");

    expect(record).toMatchObject({
      state: "observed",
      tested: 1,
      affected: 1,
    });
    expect(record?.observations).toHaveLength(1);
    expect(record === undefined ? false : isSerpShapeRecord(record)).toBe(true);
  });
});
