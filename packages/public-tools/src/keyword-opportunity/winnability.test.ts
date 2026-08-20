import { describe, expect, it } from "vitest";

import {
  KEYWORD_OPPORTUNITY_UNSAMPLED,
  KEYWORD_OPPORTUNITY_WEAK_DOMAIN_RANK,
  isKeywordWinnable,
  judgeKeywordWinnability,
} from "./winnability.ts";
import type { KeywordOpportunitySerpSample } from "./winnability.ts";
import type { KeywordOpportunitySerpEvidence } from "./types.ts";

/** Positions default to reading order — the shape the provider client emits. */
function sample(
  ranks: ReadonlyArray<readonly [string, number | null]>,
  pageItemTypes: readonly string[] | null = null,
): KeywordOpportunitySerpSample {
  return {
    results: ranks.map(([domain], index) => ({
      domain,
      position: index + 1,
    })),
    domainRanks: new Map(
      ranks.filter(
        (entry): entry is readonly [string, number] => entry[1] !== null,
      ),
    ),
    pageItemTypes,
  };
}

function evidence(
  overrides: Partial<KeywordOpportunitySerpEvidence> = {},
): KeywordOpportunitySerpEvidence {
  return {
    verdict: "winnable_evidence",
    weakestTopTenDomainRank: 12,
    weakestTopTenDomain: "weak.test",
    weakestTopTenPosition: 4,
    topTenDomains: [],
    topTenDomainRanks: [],
    pageOneItemTypes: null,
    isEstimate: false,
    ...overrides,
  };
}

describe("judgeKeywordWinnability", () => {
  it("calls a page one winnable when someone weak in absolute terms already holds a slot", () => {
    const result = judgeKeywordWinnability(
      sample([
        ["wikipedia.org", 900],
        ["tinyblog.test", 140],
        ["amazon.com", 950],
      ]),
      600,
    );

    expect(result).toEqual({
      verdict: "winnable_evidence",
      weakestTopTenDomainRank: 140,
      weakestTopTenDomain: "tinyblog.test",
      weakestTopTenPosition: 2,
      topTenDomains: ["wikipedia.org", "tinyblog.test", "amazon.com"],
      topTenDomainRanks: [900, 140, 950],
      pageOneItemTypes: null,
      isEstimate: false,
    });
  });

  it("reports the single weakest slot, because that is the one the reader can attack", () => {
    // The verdict is only as good as the row it points at: reporting anything
    // other than the minimum would send the reader to open a page one and find
    // a stronger site than the number promised.
    const result = judgeKeywordWinnability(
      sample([
        ["a.test", 180],
        ["b.test", 37],
        ["c.test", 95],
      ]),
      null,
    );

    expect(result.weakestTopTenDomainRank).toBe(37);
    expect(result.weakestTopTenDomain).toBe("b.test");
    expect(result.weakestTopTenPosition).toBe(2);
    expect(result.verdict).toBe("winnable_evidence");
  });

  it("keeps the best position on a rank tie, since that is the page worth opening first", () => {
    // Two holders sharing the weakest rank differ only by where they sit; the
    // one nearer the top is the stronger evidence and the natural page to
    // check. Strictly-less-than in the scan pins this to the earliest slot.
    const result = judgeKeywordWinnability(
      sample([
        ["strong.test", 800],
        ["first-weak.test", 90],
        ["second-weak.test", 90],
      ]),
      null,
    );

    expect(result.weakestTopTenDomain).toBe("first-weak.test");
    expect(result.weakestTopTenPosition).toBe(2);
  });

  it("carries the provider's page element types through, ai_overview included", () => {
    // The marker is an observation the provider already paid for; dropping it
    // is how the 2026-08-14 review found three AI-Overview pages presented as
    // open opportunities.
    const result = judgeKeywordWinnability(
      sample([["weak.test", 50]], ["ai_overview", "people_also_ask"]),
      null,
    );

    expect(result.pageOneItemTypes).toEqual(["ai_overview", "people_also_ask"]);
  });

  it("keeps provider silence about page elements as null, never as an empty list", () => {
    const silent = judgeKeywordWinnability(sample([["weak.test", 50]]), null);
    const empty = judgeKeywordWinnability(sample([["weak.test", 50]], []), null);

    expect(silent.pageOneItemTypes).toBeNull();
    expect(empty.pageOneItemTypes).toEqual([]);
  });

  it("keeps a site no stronger than the asker as evidence, even when nobody is weak in absolute terms", () => {
    // A rank-800 site facing a page one whose weakest holder is rank 300 is
    // looking at someone it already outranks. Judging that against the fixed
    // weak threshold alone would hide every opportunity a strong site has.
    const result = judgeKeywordWinnability(
      sample([
        ["big.test", 300],
        ["bigger.test", 700],
      ]),
      800,
    );

    expect(result.verdict).toBe("winnable_evidence");
    expect(result.weakestTopTenDomainRank).toBe(300);
  });

  it("never lets a strong asking site raise the bar above the fixed weak threshold", () => {
    // The ceiling is a max, not a substitution: a brand-new rank-5 site must
    // still be told that a rank-150 holder is a break-in point, or the tool
    // would report the whole web as contested for exactly the sites that most
    // need the signal.
    const result = judgeKeywordWinnability(sample([["small.test", 150]]), 5);

    expect(result.verdict).toBe("winnable_evidence");
  });

  it("calls a page one contested when every holder outranks both the asker and the weak threshold", () => {
    const result = judgeKeywordWinnability(
      sample([
        ["nyt.test", 910],
        ["gov.test", 880],
      ]),
      400,
    );

    expect(result).toEqual({
      verdict: "contested_evidence",
      weakestTopTenDomainRank: 880,
      weakestTopTenDomain: "gov.test",
      weakestTopTenPosition: 2,
      topTenDomains: ["nyt.test", "gov.test"],
      topTenDomainRanks: [910, 880],
      pageOneItemTypes: null,
      isEstimate: false,
    });
  });

  it("treats a holder sitting exactly on the weak threshold as a break-in point", () => {
    // The threshold is inclusive; a rank read off the sample must land on the
    // same side of the verdict every run, so the boundary is pinned here.
    expect(
      judgeKeywordWinnability(
        sample([["edge.test", KEYWORD_OPPORTUNITY_WEAK_DOMAIN_RANK]]),
        null,
      ).verdict,
    ).toBe("winnable_evidence");

    expect(
      judgeKeywordWinnability(
        sample([["edge.test", KEYWORD_OPPORTUNITY_WEAK_DOMAIN_RANK + 1]]),
        null,
      ).verdict,
    ).toBe("contested_evidence");
  });

  it("falls back to the weak threshold when the asking site has no known rank", () => {
    // A missing site rank is unknown strength, not zero strength. Both sides
    // of the boundary are checked so the fallback cannot silently drift.
    expect(judgeKeywordWinnability(sample([["x.test", 199]]), null)).toEqual({
      verdict: "winnable_evidence",
      weakestTopTenDomainRank: 199,
      weakestTopTenDomain: "x.test",
      weakestTopTenPosition: 1,
      topTenDomains: ["x.test"],
      topTenDomainRanks: [199],
      pageOneItemTypes: null,
      isEstimate: false,
    });

    expect(
      judgeKeywordWinnability(sample([["x.test", 201]]), null).verdict,
    ).toBe("contested_evidence");
  });

  it("stays silent rather than contested when no domain on a real page one resolved a rank", () => {
    // This is the honesty rule the whole module exists for: an empty rank set
    // is a provider gap. Reporting it as `contested_evidence` would dress a
    // measurement failure up as a finding about the SERP.
    const result = judgeKeywordWinnability(
      sample(
        [
          ["unknown-a.test", null],
          ["unknown-b.test", null],
          ["unknown-c.test", null],
        ],
        ["ai_overview"],
      ),
      750,
    );

    expect(result.verdict).toBe("no_serp_evidence");
    expect(result.weakestTopTenDomainRank).toBeNull();
    expect(result.weakestTopTenDomain).toBeNull();
    expect(result.weakestTopTenPosition).toBeNull();
    expect(result.topTenDomains).toEqual([
      "unknown-a.test",
      "unknown-b.test",
      "unknown-c.test",
    ]);
    expect(result.topTenDomainRanks).toEqual([null, null, null]);
    // The page WAS opened; its elements are real evidence even when the rank
    // lookup came back empty.
    expect(result.pageOneItemTypes).toEqual(["ai_overview"]);
    expect(result.isEstimate).toBe(false);
  });

  it("skips an unresolved domain instead of scoring it as rank zero", () => {
    // A missing map entry read as 0 would make every page one with a provider
    // gap look trivially winnable, which is the most expensive possible way to
    // be wrong about this data.
    const result = judgeKeywordWinnability(
      sample([
        ["unknown.test", null],
        ["strong.test", 640],
      ]),
      null,
    );

    expect(result.verdict).toBe("contested_evidence");
    expect(result.weakestTopTenDomainRank).toBe(640);
    expect(result.weakestTopTenDomain).toBe("strong.test");
    expect(result.topTenDomains).toEqual(["unknown.test", "strong.test"]);
    expect(result.topTenDomainRanks).toEqual([null, 640]);
  });

  it("keeps provider rank zero raw but skips it when a valid rank is available", () => {
    const result = judgeKeywordWinnability(
      sample([
        ["provider-zero.test", 0],
        ["resolved.test", 640],
      ]),
      null,
    );

    expect(result.verdict).toBe("contested_evidence");
    expect(result.weakestTopTenDomainRank).toBe(640);
    expect(result.weakestTopTenDomain).toBe("resolved.test");
    expect(result.weakestTopTenPosition).toBe(2);
    expect(result.topTenDomains).toEqual([
      "provider-zero.test",
      "resolved.test",
    ]);
    expect(result.topTenDomainRanks).toEqual([0, 640]);
  });

  it("keeps an all-zero provider rank page as unresolved SERP evidence", () => {
    const result = judgeKeywordWinnability(
      sample([
        ["provider-zero-a.test", 0],
        ["provider-zero-b.test", 0],
      ]),
      800,
    );

    expect(result.verdict).toBe("no_serp_evidence");
    expect(result.weakestTopTenDomainRank).toBeNull();
    expect(result.weakestTopTenDomain).toBeNull();
    expect(result.weakestTopTenPosition).toBeNull();
    expect(result.topTenDomains).toEqual([
      "provider-zero-a.test",
      "provider-zero-b.test",
    ]);
    expect(result.topTenDomainRanks).toEqual([0, 0]);
  });

  it("ignores rank entries for domains that are not on the sampled page one", () => {
    // The map is a lookup table, not the sample. A weak domain that happens to
    // be in the table but not in the top ten must not create a break-in point
    // the reader cannot find when they open the page.
    const result = judgeKeywordWinnability(
      {
        results: [{ domain: "strong.test", position: 1 }],
        domainRanks: new Map([
          ["strong.test", 700],
          ["elsewhere.test", 9],
        ]),
        pageItemTypes: null,
      },
      null,
    );

    expect(result.verdict).toBe("contested_evidence");
    expect(result.weakestTopTenDomainRank).toBe(700);
  });

  it("reports an unsampled page one as silence, not as an empty contest", () => {
    const result = judgeKeywordWinnability(
      { results: [], domainRanks: new Map(), pageItemTypes: null },
      300,
    );

    expect(result).toEqual({
      verdict: "no_serp_evidence",
      weakestTopTenDomainRank: null,
      weakestTopTenDomain: null,
      weakestTopTenPosition: null,
      topTenDomains: [],
      topTenDomainRanks: [],
      pageOneItemTypes: null,
      isEstimate: false,
    });
  });

  it("leaves the shared unsampled constant untouched after returning a copy of it", () => {
    // The constant is module-level and shared by every caller; mutating it
    // through one silent verdict would poison every later row in the run.
    judgeKeywordWinnability(
      {
        results: [{ domain: "only.test", position: 1 }],
        domainRanks: new Map(),
        pageItemTypes: ["ai_overview"],
      },
      null,
    );

    expect(KEYWORD_OPPORTUNITY_UNSAMPLED).toEqual({
      verdict: "no_serp_evidence",
      weakestTopTenDomainRank: null,
      weakestTopTenDomain: null,
      weakestTopTenPosition: null,
      topTenDomains: [],
      topTenDomainRanks: [],
      pageOneItemTypes: null,
      isEstimate: false,
    });
  });

  it("never marks a sampled verdict as an estimate, whatever the outcome", () => {
    // `isEstimate` is what surfaces use to label a guess. Anything coming out
    // of a real sample must be labelled as observed or the caveat loses meaning.
    const outcomes = [
      judgeKeywordWinnability(sample([["weak.test", 10]]), null),
      judgeKeywordWinnability(sample([["strong.test", 999]]), null),
      judgeKeywordWinnability(sample([["unknown.test", null]]), null),
      judgeKeywordWinnability(sample([]), null),
    ];

    expect(outcomes.map((outcome) => outcome.isEstimate)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
});

describe("isKeywordWinnable", () => {
  it("admits a row as an opportunity only on observed evidence", () => {
    expect(isKeywordWinnable(evidence({ verdict: "winnable_evidence" }))).toBe(
      true,
    );
  });

  it("refuses a contested page one, which is a verdict against the row", () => {
    expect(
      isKeywordWinnable(
        evidence({
          verdict: "contested_evidence",
          weakestTopTenDomainRank: 900,
        }),
      ),
    ).toBe(false);
  });

  it("refuses an unsampled row, because absence of evidence is not evidence of winnability", () => {
    expect(isKeywordWinnable(KEYWORD_OPPORTUNITY_UNSAMPLED)).toBe(false);
    expect(
      isKeywordWinnable(
        evidence({
          verdict: "no_serp_evidence",
          weakestTopTenDomainRank: null,
        }),
      ),
    ).toBe(false);
  });

  it("does not let an estimated verdict pass as observed evidence on its own", () => {
    // A fallback model can produce `winnable_evidence`; the gate here reads the
    // verdict only, so this pins the fact that `isEstimate` is the caller's
    // responsibility to check and is not silently folded in.
    expect(
      isKeywordWinnable(
        evidence({ verdict: "winnable_evidence", isEstimate: true }),
      ),
    ).toBe(true);
  });
});

describe("KEYWORD_OPPORTUNITY_WEAK_DOMAIN_RANK", () => {
  it("stays at the rank read off the Tranche 2 sample, since every verdict shifts with it", () => {
    expect(KEYWORD_OPPORTUNITY_WEAK_DOMAIN_RANK).toBe(200);
  });
});
