// @input  -- ledgers whose target-page flags would mislead about another page
// @output -- proof a non-target key page can report a hit but never a borrowed pass
// @pos    -- unit guard for the fail-closed half of multi-page evaluation

import { describe, expect, it } from "vitest";
import type { SeoAuditRecord } from "@sf/public-tools";
import { evaluateAgentAuditScope } from "@sf/public-tools/agent-audit";

import { recordsForKeyPage } from "./agent-key-page-records.ts";

const OTHER = "https://example.com/pricing";

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
