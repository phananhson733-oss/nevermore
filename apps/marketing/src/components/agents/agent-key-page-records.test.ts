// @input  -- ledgers whose target-page flags would mislead about another page
// @output -- proof a non-target key page can report a hit but never a borrowed pass
// @pos    -- unit guard for the fail-closed half of multi-page evaluation

import { describe, expect, it } from "vitest";
import type { SeoAuditRecord } from "@sf/public-tools";
import { evaluateAgentAuditScope } from "@sf/public-tools/agent-audit";

import {
  recordsForKeyPage,
  TARGET_ONLY_RECORD_IDS,
} from "./agent-key-page-records.ts";
import {
  buildKeywordEvidenceRecords,
  buildPageShapeRecords,
} from "@sf/public-tools/seo-audit/keyword-evidence/records";
import {
  buildImageWeightRecords,
  buildPagePerformanceRecords,
  buildPageWeightRecords,
} from "@sf/public-tools/seo-audit/page-performance";
import { buildSerpShapeRecords } from "@sf/public-tools/seo-audit/serp-shape";

const OTHER = "https://example.com/pricing";
const TARGET_PAGE = "https://example.com/";

function record(overrides: Partial<SeoAuditRecord>): SeoAuditRecord {
  return {
    id: "title_length_outside_range",
    category: "metadata",
    state: "not_observed",
    unit: "pages",
    population: "conditional_subset",
    targetTested: true,
    tested: 4,
    affected: 0,
    observations: [],
    limitation: null,
    ...overrides,
  } as unknown as SeoAuditRecord;
}

function resultFor(
  records: readonly SeoAuditRecord[],
  url: string,
  checkId: string,
) {
  return evaluateAgentAuditScope("page", {
    records,
    availability: "available",
    targetUrl: url,
    targetInspected: true,
    inspectedTargetUrl: url,
  }).checks.find((entry) => entry.check.id === checkId);
}

describe("recordsForKeyPage", () => {
  it("hands the submitted page everything, unchanged", () => {
    const records = [record({}), record({ id: "target_query_ranking_band" })];

    expect(
      recordsForKeyPage({ records, isSubmittedTarget: true }),
    ).toBe(records);
  });

  it("never lets another page inherit the target's clean bill of health", () => {
    // The trap. `targetTested` was computed once, for the crawl's target, and
    // cached. On a site whose submitted page HAS a title, carrying that flag
    // onto a titleless key page reports the titleless page as passing.
    const ledger = [record({ targetTested: true })];

    expect(resultFor(ledger, OTHER, "2.1")?.result).toBe("pass");

    const scoped = recordsForKeyPage({
      records: ledger,
      isSubmittedTarget: false,
    });

    expect(resultFor(scoped, OTHER, "2.1")?.result).toBe("excluded");
  });

  it("still reports a hit the observations actually name", () => {
    // Fail-closed is about absence, not about hiding evidence: a record that
    // observed THIS page still reaches a verdict on it.
    const ledger = [
      record({
        id: "title_length_outside_range",
        state: "observed",
        affected: 1,
        observations: [{ url: OTHER, values: [] }],
      } as Partial<SeoAuditRecord>),
    ];

    const scoped = recordsForKeyPage({
      records: ledger,
      isSubmittedTarget: false,
    });

    expect(resultFor(scoped, OTHER, "2.1")?.result).not.toBe("pass");
    expect(resultFor(scoped, OTHER, "2.1")?.result).not.toBe("excluded");
  });

  it("leaves a whole-population record able to pass", () => {
    // `every_collected_page` means every page was tested, so absence really is
    // a clean result for any of them. Only the conditional subsets are unsafe.
    const ledger = [
      record({
        id: "content_to_code_ratio",
        population: "every_collected_page",
        targetTested: null,
      }),
    ];

    const scoped = recordsForKeyPage({
      records: ledger,
      isSubmittedTarget: false,
    });

    expect(scoped[0]?.population).toBe("every_collected_page");
    expect(resultFor(scoped, OTHER, "4.4")?.result).not.toBe("excluded");
  });

  it("drops the ranking band, which population alone would have kept", () => {
    // Published as a `conditional_subset`, so a population-based filter leaves
    // it in and it ends up excluded under the crawl's precondition wording --
    // a different sentence from the rest of its own region.
    const ledger = [
      record({ id: "target_query_ranking_band", targetTested: null }),
      record({ id: "core_web_vital_lcp", targetTested: null }),
      record({ id: "title_without_target_query", targetTested: null }),
      record({ id: "ai_answer_block_present", targetTested: null }),
    ];

    const scoped = recordsForKeyPage({
      records: ledger,
      isSubmittedTarget: false,
    });

    expect(scoped).toEqual([]);
  });

  it("drops the page-shape records, which describe the submitted page alone", () => {
    // These four were split out of the keyword region after this filter was
    // written, and the filter was not told. They are `target_page`, so
    // `projectRecordToTarget` returns them untouched -- the submitted page's
    // H2 count, schema fit and section substance would be republished as every
    // other key page's, hits and URLs included.
    const shape = { population: "target_page", targetTested: null } as const;
    const ledger = [
      record({ id: "h2_count_outside_reviewed_range", ...shape }),
      record({ id: "h3_count_outside_reviewed_range", ...shape }),
      record({ id: "schema_type_unmatched_to_page_type", ...shape }),
      record({ id: "thin_section_under_h3", ...shape }),
    ] as SeoAuditRecord[];

    expect(
      recordsForKeyPage({ records: ledger, isSubmittedTarget: false }),
    ).toEqual([]);
    // The submitted page still reads every one of them.
    expect(
      recordsForKeyPage({ records: ledger, isSubmittedTarget: true }),
    ).toHaveLength(4);
  });

  it("never republishes a target-page verdict as another page's", () => {
    // The symptom the filter exists to prevent, asserted end to end: a Tip the
    // submitted page earned must not become a Tip on a page nobody measured.
    const ledger = [
      record({
        id: "h2_count_outside_reviewed_range",
        population: "target_page",
        state: "observed",
        targetTested: null,
        tested: 1,
        affected: 1,
        observations: [{ url: TARGET_PAGE, values: [] }],
      } as Partial<SeoAuditRecord>),
    ];

    const scoped = recordsForKeyPage({
      records: ledger,
      isSubmittedTarget: false,
    });

    expect(resultFor(scoped, OTHER, "3.4")?.result).toBe("excluded");
    // Asserted for existence first: `?.` on a check that was never found makes
    // `not.toBe("excluded")` pass on undefined, which is half an assertion.
    const onTarget = resultFor(ledger, TARGET_PAGE, "3.4");
    expect(onTarget).toBeDefined();
    expect(onTarget?.result).not.toBe("excluded");
  });

  it("keeps the crawl ledger the other key pages are judged from", () => {
    const ledger = [
      record({ id: "title_length_outside_range" }),
      record({ id: "meta_description_length_outside_range" }),
      record({ id: "target_query_density" }),
    ];

    expect(
      recordsForKeyPage({ records: ledger, isSubmittedTarget: false }).map(
        (entry) => entry.id,
      ),
    ).toEqual([
      "title_length_outside_range",
      "meta_description_length_outside_range",
    ]);
  });
});

describe("the target-only list against the records that actually exist", () => {
  /**
   * The defect this guards is the one that shipped: a set of ids was split in
   * two, and this hand-written list was not told. Enumerating the list again in
   * a test would repeat the same mistake, so the producers are run for real and
   * every `target_page` record they emit has to be covered.
   */
  it("covers every target_page record the producers emit", () => {
    const emitted = [
      ...buildKeywordEvidenceRecords("https://example.com/", null),
      ...buildPageShapeRecords("https://example.com/", null, null),
      ...buildPagePerformanceRecords(null),
      ...buildPageWeightRecords(null),
      ...buildImageWeightRecords(null, undefined, true),
      ...buildSerpShapeRecords(null, undefined),
    ];
    const targetOnly = emitted
      .filter((record) => record.population === "target_page")
      .map((record) => record.id);

    expect(targetOnly.length).toBeGreaterThan(0);
    expect(
      targetOnly.filter((id) => !TARGET_ONLY_RECORD_IDS.has(id)),
    ).toEqual([]);
  });
});
