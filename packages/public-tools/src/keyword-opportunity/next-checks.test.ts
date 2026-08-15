import { describe, expect, it } from "vitest";

import {
  KEYWORD_OPPORTUNITY_CHECKS,
  keywordNextChecks,
  type KeywordOpportunityCheckInput,
} from "./next-checks.ts";
import {
  KEYWORD_OPPORTUNITY_COVERAGE_STATES,
  KEYWORD_OPPORTUNITY_LANES,
  KEYWORD_OPPORTUNITY_VOLUME_STATES,
  KEYWORD_OPPORTUNITY_WINNABILITY_STATES,
  type KeywordOpportunityCheck,
  type KeywordOpportunityCoverage,
  type KeywordOpportunityLane,
  type KeywordOpportunityVolumeAvailability,
  type KeywordOpportunityWinnability,
} from "./types.ts";

interface RowOverrides {
  readonly lane?: KeywordOpportunityLane;
  readonly availability?: KeywordOpportunityVolumeAvailability;
  readonly verdict?: KeywordOpportunityWinnability;
  readonly coverage?: KeywordOpportunityCoverage;
}

function row(overrides: RowOverrides = {}): KeywordOpportunityCheckInput {
  const availability = overrides.availability ?? "available";
  const verdict = overrides.verdict ?? "contested_evidence";
  return {
    lane: overrides.lane ?? "seo",
    validation: {
      availability,
      volume: availability === "available" ? 720 : null,
      difficulty: availability === "available" ? 21 : null,
      intent: availability === "available" ? "commercial" : null,
      serpFeatures: [],
    },
    serp: {
      verdict,
      weakestTopTenDomainRank: verdict === "no_serp_evidence" ? null : 14,
      weakestTopTenDomain:
        verdict === "no_serp_evidence" ? null : "example.com",
      weakestTopTenPosition: verdict === "no_serp_evidence" ? null : 5,
      topTenDomains: verdict === "no_serp_evidence" ? [] : ["example.com"],
      topTenDomainRanks: verdict === "no_serp_evidence" ? [] : [14],
      pageOneItemTypes: null,
      isEstimate: false,
    },
    coverage: overrides.coverage ?? "not_observed_in_gsc_query_sample",
  };
}

/**
 * Every input the four unions can produce, lanes x volume x winnability x
 * coverage.
 *
 * The expected size is computed from the same value lists rather than written
 * as a literal, so growing a union grows this test's coverage instead of
 * merely breaking its count. A union member that never reaches a value list is
 * caught by the `as const satisfies` on the list itself.
 */
const EXPECTED_COMBINATIONS =
  KEYWORD_OPPORTUNITY_LANES.length *
  KEYWORD_OPPORTUNITY_VOLUME_STATES.length *
  KEYWORD_OPPORTUNITY_WINNABILITY_STATES.length *
  KEYWORD_OPPORTUNITY_COVERAGE_STATES.length;

const EVERY_COMBINATION: readonly KeywordOpportunityCheckInput[] =
  KEYWORD_OPPORTUNITY_LANES.flatMap((lane) =>
    KEYWORD_OPPORTUNITY_VOLUME_STATES.flatMap((availability) =>
      KEYWORD_OPPORTUNITY_WINNABILITY_STATES.flatMap((verdict) =>
        KEYWORD_OPPORTUNITY_COVERAGE_STATES.map((coverage) =>
          row({ lane, availability, verdict, coverage }),
        ),
      ),
    ),
  );

function describeRow(input: KeywordOpportunityCheckInput): string {
  return [
    input.lane,
    input.validation.availability,
    input.serp.verdict,
    input.coverage,
  ].join(" / ");
}

describe("keywordNextChecks", () => {
  it("attaches at least one check to every input the contract can produce", () => {
    // The product rule the whole advice layer exists for: a row shipped with an
    // empty check list reads as a recommendation the reader can act on blind,
    // which is exactly the mistake that misled the team's own term selection.
    expect(EVERY_COMBINATION).toHaveLength(EXPECTED_COMBINATIONS);
    for (const input of EVERY_COMBINATION) {
      expect(
        keywordNextChecks(input).length,
        `no checks for ${describeRow(input)}`,
      ).toBeGreaterThan(0);
    }
  });

  it("sends an unsampled term to both page one and its result page type", () => {
    // Nothing was observed, so the reader has to establish both who ranks and
    // what kind of page wins before any of the other advice means anything.
    const checks = keywordNextChecks(row({ verdict: "no_serp_evidence" }));
    expect(checks).toContain("read_page_one_intent");
    expect(checks).toContain("confirm_result_page_type");
  });

  it("asks for the page-type check only when nobody sampled page one", () => {
    // A sampled SERP already answers what kind of page ranks; repeating the
    // question there would spend the reader's attention on a settled fact.
    for (const verdict of [
      "winnable_evidence",
      "contested_evidence",
    ] as const) {
      expect(keywordNextChecks(row({ verdict }))).not.toContain(
        "confirm_result_page_type",
      );
    }
  });

  it("asks the reader to confirm a weak-site breakthrough the tool leaned on", () => {
    // `winnable_evidence` is the one verdict that talks the reader into
    // building something, and an abandoned post on a small domain may not be
    // defendable, so the claim gets checked precisely where it is load-bearing.
    expect(keywordNextChecks(row({ verdict: "winnable_evidence" }))).toContain(
      "verify_weak_site_breakthrough",
    );
  });

  it("withholds the breakthrough check when page one is contested", () => {
    // Contested means no weak site broke through, so there is no breakthrough
    // to verify and the check would send the reader looking for nothing.
    expect(
      keywordNextChecks(row({ verdict: "contested_evidence" })),
    ).not.toContain("verify_weak_site_breakthrough");
  });

  it("withholds the breakthrough check when there is no SERP evidence at all", () => {
    expect(
      keywordNextChecks(row({ verdict: "no_serp_evidence" })),
    ).not.toContain("verify_weak_site_breakthrough");
  });

  it("asks about overlap whenever Search Console saw the site on the query", () => {
    // Every coverage state except the not-observed one means the site may
    // already serve the term, including the unverified lexical case — building
    // a second page for it would split the site against itself.
    for (const coverage of [
      "observed_exact_strong",
      "observed_exact_weak",
      "related_coverage_unverified",
    ] as const) {
      expect(
        keywordNextChecks(row({ coverage })),
        `missing overlap check for ${coverage}`,
      ).toContain("check_existing_page_overlap");
    }
  });

  it("skips the overlap check when the query never appeared in the sample", () => {
    // Absence from an anonymised sample is not evidence of absence, but it is
    // also not a reason to send the reader hunting for a page.
    expect(
      keywordNextChecks(row({ coverage: "not_observed_in_gsc_query_sample" })),
    ).not.toContain("check_existing_page_overlap");
  });

  it("sends the reader to check overlap themselves when nobody read the sample", () => {
    // The opposite reason to the observed states, same conclusion: the tool
    // could not look, so the only remaining check is the reader's own. This
    // used to hold by accident — the rule was written as "not the one state
    // that skips it", which grants the check to every state added later
    // whether or not it should have one.
    expect(
      keywordNextChecks(row({ coverage: "gsc_query_sample_not_read" })),
    ).toContain("check_existing_page_overlap");
  });

  it("calls a GEO row an early bet even when demand data exists", () => {
    // The GEO lane is not gated on volume at all, so its rows have nothing to
    // size the bet with; saying so beats implying a confidence the tool lacks.
    expect(
      keywordNextChecks(row({ lane: "geo", availability: "available" })),
    ).toContain("decide_whether_to_bet_early");
  });

  it("calls an SEO row an early bet whenever demand was never measured", () => {
    // `explicit_zero` and `provider_no_data` are different facts but both leave
    // the reader without a number to justify the work.
    for (const availability of ["explicit_zero", "provider_no_data"] as const) {
      expect(
        keywordNextChecks(row({ lane: "seo", availability })),
        `missing early-bet check for ${availability}`,
      ).toContain("decide_whether_to_bet_early");
    }
  });

  it("leaves the early-bet check off an SEO row with measured demand", () => {
    // This is the only combination where the tool can point at a volume, so it
    // is the only one where the bet is not being taken on faith.
    expect(
      keywordNextChecks(row({ lane: "seo", availability: "available" })),
    ).not.toContain("decide_whether_to_bet_early");
  });

  it("leaves the commercial-fit call to the reader on every single row", () => {
    // Demand is not intent to buy, and the tool has no way to know a business's
    // margins, so this one is never inferred away no matter what was observed.
    for (const input of EVERY_COMBINATION) {
      expect(
        keywordNextChecks(input),
        `missing commercial fit for ${describeRow(input)}`,
      ).toContain("judge_commercial_fit");
    }
  });

  it("always opens with reading page one, whatever the SERP verdict was", () => {
    // The sample says who ranks, not whether they answer the same question, so
    // even a sampled row still needs a human to look at the intent.
    for (const input of EVERY_COMBINATION) {
      expect(keywordNextChecks(input)[0]).toBe("read_page_one_intent");
    }
  });

  it("never repeats a check, so a surface can render the list one-to-one", () => {
    for (const input of EVERY_COMBINATION) {
      const checks = keywordNextChecks(input);
      expect(
        new Set(checks).size,
        `duplicate check for ${describeRow(input)}`,
      ).toBe(checks.length);
    }
  });

  it("only ever returns checks that are declared in the exported constant", () => {
    // A surface renders one label per declared path; an undeclared value coming
    // back would break at runtime only for the visitors whose data produced it.
    const declared = new Set<string>(KEYWORD_OPPORTUNITY_CHECKS);
    for (const input of EVERY_COMBINATION) {
      for (const check of keywordNextChecks(input)) {
        expect(declared, `undeclared check ${check}`).toContain(check);
      }
    }
  });

  it("can produce every check the constant declares, so no label is dead copy", () => {
    // The constant is what a copy-completeness test iterates. A member no input
    // can reach would mean either dead copy or a lost branch in the router.
    const produced = new Set<KeywordOpportunityCheck>();
    for (const input of EVERY_COMBINATION) {
      for (const check of keywordNextChecks(input)) {
        produced.add(check);
      }
    }
    expect([...produced].sort()).toEqual(
      [...KEYWORD_OPPORTUNITY_CHECKS].sort(),
    );
  });

  it("declares the constant with no duplicates and no missing union member", () => {
    // `satisfies readonly Check[]` proves each entry is a member; it cannot
    // prove the list is complete or that nothing is listed twice.
    expect(new Set(KEYWORD_OPPORTUNITY_CHECKS).size).toBe(
      KEYWORD_OPPORTUNITY_CHECKS.length,
    );
    expect([...KEYWORD_OPPORTUNITY_CHECKS].sort()).toEqual([
      "check_existing_page_overlap",
      "confirm_result_page_type",
      "decide_whether_to_bet_early",
      "judge_commercial_fit",
      "read_page_one_intent",
      "verify_weak_site_breakthrough",
    ]);
  });

  it("returns the full set for the row that earns every path at once", () => {
    // GEO lane, no demand, unsampled SERP, and existing coverage is the maximal
    // ignorance case; anything the router drops here is a silent gap.
    const checks = keywordNextChecks(
      row({
        lane: "geo",
        availability: "provider_no_data",
        verdict: "no_serp_evidence",
        coverage: "related_coverage_unverified",
      }),
    );
    expect(checks).toEqual([
      "read_page_one_intent",
      "confirm_result_page_type",
      "check_existing_page_overlap",
      "decide_whether_to_bet_early",
      "judge_commercial_fit",
    ]);
  });

  it("returns the minimal pair for a fully evidenced, uncovered SEO row", () => {
    // Everything that could be observed was observed, so the only work left is
    // the judgement the tool refuses to make.
    expect(
      keywordNextChecks(
        row({
          lane: "seo",
          availability: "available",
          verdict: "contested_evidence",
          coverage: "not_observed_in_gsc_query_sample",
        }),
      ),
    ).toEqual(["read_page_one_intent", "judge_commercial_fit"]);
  });

  it("keeps the breakthrough check ahead of overlap and the commercial call", () => {
    // Order encodes what the reader is missing, not severity: confirm the SERP
    // claim before deciding whether an existing page already covers it.
    const checks = keywordNextChecks(
      row({
        lane: "seo",
        availability: "available",
        verdict: "winnable_evidence",
        coverage: "observed_exact_weak",
      }),
    );
    expect(checks).toEqual([
      "read_page_one_intent",
      "verify_weak_site_breakthrough",
      "check_existing_page_overlap",
      "judge_commercial_fit",
    ]);
  });

  it("returns a fresh array per call so a caller cannot poison the next row", () => {
    const first = keywordNextChecks(row()) as KeywordOpportunityCheck[];
    first.push("judge_commercial_fit");
    expect(keywordNextChecks(row())).toEqual([
      "read_page_one_intent",
      "judge_commercial_fit",
    ]);
  });
});
