import { describe, expect, it } from "vitest";

import {
  KEYWORD_OPPORTUNITY_MIN_ROWS,
  buildKeywordOpportunityPayload,
  buildKeywordOpportunityResult,
} from "./report.ts";
import type {
  KeywordOpportunityObservation,
  KeywordOpportunityReportInput,
} from "./report.ts";
import { KEYWORD_OPPORTUNITY_SCHEMA_VERSION } from "./types.ts";
import { KEYWORD_OPPORTUNITY_UNSAMPLED } from "./winnability.ts";
import type {
  KeywordOpportunityContext,
  KeywordOpportunitySerpEvidence,
  KeywordOpportunityValidation,
} from "./types.ts";

const MEASURED: KeywordOpportunityValidation = {
  availability: "available",
  volume: 320,
  difficulty: 14,
  intent: "informational",
  serpFeatures: ["people_also_ask"],
};

const EXPLICIT_ZERO: KeywordOpportunityValidation = {
  availability: "explicit_zero",
  volume: null,
  difficulty: null,
  intent: null,
  serpFeatures: [],
};

const NO_PROVIDER_DATA: KeywordOpportunityValidation = {
  availability: "provider_no_data",
  volume: null,
  difficulty: null,
  intent: null,
  serpFeatures: [],
};

const WINNABLE: KeywordOpportunitySerpEvidence = {
  verdict: "winnable_evidence",
  weakestTopTenDomainRank: 41,
  topTenDomains: ["small.test", "big.test"],
  isEstimate: false,
};

const CONTESTED: KeywordOpportunitySerpEvidence = {
  verdict: "contested_evidence",
  weakestTopTenDomainRank: 780,
  topTenDomains: ["big.test", "bigger.test"],
  isEstimate: false,
};

/**
 * Six keywords with disjoint content tokens, so clustering never merges two of
 * them and a "five rows" fixture really produces five rows.
 */
const KEYWORDS = [
  "invoice software",
  "payroll api",
  "tax deadline",
  "expense tracker",
  "vendor onboarding",
  "budget forecast",
] as const;

function seo(
  keyword: string,
  overrides: Partial<KeywordOpportunityObservation> = {},
): KeywordOpportunityObservation {
  return {
    keyword,
    lane: "seo",
    discoveryBasis: "traditional_expansion",
    questionForm: false,
    propositionIndex: null,
    validation: MEASURED,
    serp: WINNABLE,
    coverage: "not_observed_in_gsc_query_sample",
    supportingPageUrl: null,
    ...overrides,
  };
}

function geo(
  keyword: string,
  overrides: Partial<KeywordOpportunityObservation> = {},
): KeywordOpportunityObservation {
  return {
    keyword,
    lane: "geo",
    discoveryBasis: "site_proposition",
    questionForm: true,
    propositionIndex: 0,
    validation: NO_PROVIDER_DATA,
    serp: KEYWORD_OPPORTUNITY_UNSAMPLED,
    coverage: "not_observed_in_gsc_query_sample",
    supportingPageUrl: "https://acme.test/guides/how-billing-works",
    ...overrides,
  };
}

const COMPLETED_AT = "2026-08-10T09:00:00.000Z";

const CONTEXT: KeywordOpportunityContext = {
  siteUrl: "https://acme.test/",
  pagesFetched: 24,
  productPagesFetched: 6,
  propositions: [
    { statement: "Invoicing for freelancers", sourceUrl: "https://acme.test/" },
  ],
  contextSufficient: true,
  stopReason: "budget_reached",
};

function input(
  overrides: Partial<KeywordOpportunityReportInput> = {},
): KeywordOpportunityReportInput {
  return {
    marketCode: "us",
    languageCode: "en",
    context: CONTEXT,
    generated: 210,
    observations: [],
    unavailableStages: [],
    completedAt: COMPLETED_AT,
    ...overrides,
  };
}

/** `n` distinct SEO candidates that all pass the shown gate. */
function shownSeoRows(n: number): KeywordOpportunityObservation[] {
  return KEYWORDS.slice(0, n).map((keyword) => seo(keyword));
}

describe("buildKeywordOpportunityResult SEO lane gate", () => {
  it("shows an SEO term only when demand was measured AND page one already let a weak site in", () => {
    const result = buildKeywordOpportunityResult(
      input({
        observations: [
          seo("invoice software"),
          seo("payroll api", { validation: EXPLICIT_ZERO }),
          seo("tax deadline", { validation: NO_PROVIDER_DATA }),
          seo("expense tracker", { serp: CONTESTED }),
          seo("vendor onboarding", { serp: KEYWORD_OPPORTUNITY_UNSAMPLED }),
        ],
      }),
    );

    expect(result.rows.map((row) => row.keyword)).toEqual(["invoice software"]);
  });

  it("withholds a term Search Console already shows the site serving, however good the rest of its evidence is", () => {
    // Both observed_exact states mean the site is measurably already serving
    // the query. Recommending a new page for it is work with no upside, so the
    // coverage check runs before every other gate.
    const result = buildKeywordOpportunityResult(
      input({
        observations: [
          seo("invoice software", { coverage: "observed_exact_strong" }),
          seo("payroll api", { coverage: "observed_exact_weak" }),
        ],
      }),
    );

    expect(result.rows).toEqual([]);
    expect(result.withheld).toEqual([
      {
        keyword: "invoice software",
        discoveryBasis: "traditional_expansion",
        reason: "already_covered",
      },
      {
        keyword: "payroll api",
        discoveryBasis: "traditional_expansion",
        reason: "already_covered",
      },
    ]);
  });

  it("withholds a GEO row too once Search Console shows the site serving it", () => {
    // The GEO lane skips the volume and SERP gates, but not this one: a page
    // that already answers the question and already ranks is not an opening.
    const result = buildKeywordOpportunityResult(
      input({
        observations: [
          geo("invoice software", { coverage: "observed_exact_weak" }),
        ],
      }),
    );

    expect(result.rows).toEqual([]);
    expect(result.withheld[0]?.reason).toBe("already_covered");
  });

  it("keeps a lexical-only coverage guess visible instead of hiding the row", () => {
    // related_coverage_unverified is a guess from words on a page, not measured
    // serving. Hard-filtering on it would lose real openings, so the row ships
    // and carries the overlap check instead.
    const result = buildKeywordOpportunityResult(
      input({
        observations: [
          seo("invoice software", { coverage: "related_coverage_unverified" }),
        ],
      }),
    );

    expect(result.rows.map((row) => row.keyword)).toEqual(["invoice software"]);
    expect(result.rows[0]?.nextChecks).toContain("check_existing_page_overlap");
  });
});

describe("buildKeywordOpportunityResult GEO lane gate", () => {
  it("shows a GEO row on its supporting page alone, with no volume and no SERP sample", () => {
    // This is the point of the two lanes: question-form terms clear the volume
    // check ~13% of the time, so gating them on demand would delete the very
    // output the GEO positioning exists to produce.
    const result = buildKeywordOpportunityResult(
      input({ observations: [geo("invoice software")] }),
    );

    expect(result.rows.map((row) => row.keyword)).toEqual(["invoice software"]);
    expect(result.rows[0]?.validation.availability).toBe("provider_no_data");
    expect(result.rows[0]?.serp.verdict).toBe("no_serp_evidence");
  });

  it("shows a GEO row whose page one is contested, because the SEO gate does not apply to it", () => {
    const result = buildKeywordOpportunityResult(
      input({
        observations: [geo("invoice software", { serp: CONTESTED })],
      }),
    );

    expect(result.rows).toHaveLength(1);
  });

  it("withholds a GEO row that no crawled page answers, since the supporting page is its only evidence", () => {
    const result = buildKeywordOpportunityResult(
      input({
        observations: [
          geo("invoice software", { supportingPageUrl: null }),
          // Measured demand and a winnable page one do not rescue it either:
          // the GEO lane is judged on the supporting page and nothing else.
          geo("payroll api", {
            supportingPageUrl: null,
            validation: MEASURED,
            serp: WINNABLE,
          }),
        ],
      }),
    );

    expect(result.rows).toEqual([]);
    expect(result.withheld.map((entry) => entry.keyword)).toEqual([
      "invoice software",
      "payroll api",
    ]);
  });
});

describe("buildKeywordOpportunityResult availability", () => {
  it("reports insufficient_evidence for a thin table even when every stage succeeded", () => {
    // A short list is not a small opportunity set that happens to be complete;
    // it is a run that did not learn enough to publish one.
    const result = buildKeywordOpportunityResult(
      input({
        observations: shownSeoRows(KEYWORD_OPPORTUNITY_MIN_ROWS - 1),
        unavailableStages: [],
      }),
    );

    expect(result.rows).toHaveLength(KEYWORD_OPPORTUNITY_MIN_ROWS - 1);
    expect(result.availability).toBe("insufficient_evidence");
  });

  it("reports partial, never available, when a stage was missing but the table is full", () => {
    // The seo-audit history in this repo has a fully disallowed crawl reported
    // as "checked, nothing found". A missing stage has to reach the reader even
    // when the run produced plenty of rows.
    const result = buildKeywordOpportunityResult(
      input({
        observations: shownSeoRows(KEYWORD_OPPORTUNITY_MIN_ROWS),
        unavailableStages: ["serp_sample"],
      }),
    );

    expect(result.rows).toHaveLength(KEYWORD_OPPORTUNITY_MIN_ROWS);
    expect(result.availability).toBe("partial");
  });

  it("reports available only at the row floor with no stage missing", () => {
    const atFloor = buildKeywordOpportunityResult(
      input({ observations: shownSeoRows(KEYWORD_OPPORTUNITY_MIN_ROWS) }),
    );
    expect(atFloor.availability).toBe("available");

    const overFloor = buildKeywordOpportunityResult(
      input({ observations: shownSeoRows(KEYWORD_OPPORTUNITY_MIN_ROWS + 1) }),
    );
    expect(overFloor.availability).toBe("available");
  });

  it("lets a thin table outrank a missing stage, so the reader is never told a short list is merely partial", () => {
    const result = buildKeywordOpportunityResult(
      input({
        observations: shownSeoRows(1),
        unavailableStages: ["gsc_coverage"],
      }),
    );

    expect(result.availability).toBe("insufficient_evidence");
  });

  it("reports insufficient_evidence for a run with no observations at all", () => {
    const result = buildKeywordOpportunityResult(input({ observations: [] }));

    expect(result.availability).toBe("insufficient_evidence");
    expect(result.rows).toEqual([]);
    expect(result.withheld).toEqual([]);
    expect(result.clusters).toEqual([]);
  });

  it("counts only shown rows toward the floor, not candidates that were withheld", () => {
    // Twenty candidates and one row is still one row. Counting withheld
    // candidates would let a run that found nothing claim it was available.
    const observations = [
      ...shownSeoRows(1),
      ...KEYWORDS.slice(1).map((keyword) => seo(keyword, { serp: CONTESTED })),
    ];
    const result = buildKeywordOpportunityResult(input({ observations }));

    expect(result.funnel.deduplicated).toBe(6);
    expect(result.rows).toHaveLength(1);
    expect(result.availability).toBe("insufficient_evidence");
  });
});

describe("buildKeywordOpportunityResult funnel", () => {
  const observations = [
    seo("invoice software"),
    seo("payroll api"),
    seo("tax deadline", { validation: EXPLICIT_ZERO }),
    seo("expense tracker", {
      validation: NO_PROVIDER_DATA,
      serp: KEYWORD_OPPORTUNITY_UNSAMPLED,
    }),
    seo("vendor onboarding", { coverage: "observed_exact_strong" }),
    seo("budget forecast", { serp: CONTESTED }),
    geo("how do i bill a client"),
  ];

  it("keeps explicit zero and provider silence in separate counts", () => {
    // provider_no_data was 74.9% of Tranche 2 candidates. Folding it into
    // explicit_zero would claim three quarters of the funnel was measured at
    // zero demand when the provider never answered at all.
    const result = buildKeywordOpportunityResult(input({ observations }));

    expect(result.funnel.explicitZero).toBe(1);
    expect(result.funnel.providerNoData).toBe(2);
  });

  it("counts providerReturned as the terms the provider answered about, excluding its silences", () => {
    const result = buildKeywordOpportunityResult(input({ observations }));

    expect(result.funnel.providerReturned).toBe(5);
    expect(result.funnel.volumePositive).toBe(4);
    expect(result.funnel.providerReturned).toBe(
      result.funnel.volumePositive + result.funnel.explicitZero,
    );
  });

  it("counts coverage, SERP sampling and winnability across every candidate, not just the shown ones", () => {
    // The funnel is the honesty mechanism: it has to show where the candidates
    // that never reached the table went.
    const result = buildKeywordOpportunityResult(input({ observations }));

    expect(result.funnel.alreadyCovered).toBe(1);
    expect(result.funnel.serpSampled).toBe(5);
    expect(result.funnel.winnableEvidence).toBe(4);
  });

  it("reports shown as exactly the number of rows it handed back", () => {
    // A funnel whose last number disagrees with the table underneath it is the
    // one number a reader cannot check, so it must be derived from the rows.
    const result = buildKeywordOpportunityResult(input({ observations }));

    expect(result.funnel.shown).toBe(3);
    expect(result.funnel.shown).toBe(result.rows.length);
  });

  it("passes the pre-dedup generated count through and derives deduplicated from the observations", () => {
    const result = buildKeywordOpportunityResult(
      input({ generated: 210, observations }),
    );

    expect(result.funnel.generated).toBe(210);
    expect(result.funnel.deduplicated).toBe(7);
  });

  it("reports a zeroed funnel rather than omitting counts when nothing survived dedup", () => {
    const result = buildKeywordOpportunityResult(
      input({ generated: 88, observations: [] }),
    );

    expect(result.funnel).toEqual({
      generated: 88,
      deduplicated: 0,
      providerReturned: 0,
      volumePositive: 0,
      explicitZero: 0,
      providerNoData: 0,
      alreadyCovered: 0,
      serpSampled: 0,
      winnableEvidence: 0,
      shown: 0,
    });
  });
});

describe("buildKeywordOpportunityResult rows", () => {
  it("gives every shown row at least one next check, so no row ships as a bare recommendation", () => {
    const result = buildKeywordOpportunityResult(
      input({
        observations: [
          seo("invoice software"),
          seo("payroll api", { coverage: "related_coverage_unverified" }),
          geo("tax deadline"),
        ],
      }),
    );

    expect(result.rows).toHaveLength(3);
    for (const row of result.rows) {
      expect(row.nextChecks.length, row.keyword).toBeGreaterThan(0);
    }
    expect(result.rows[2]?.nextChecks).toContain("decide_whether_to_bet_early");
  });

  it("carries each observation's own evidence onto its row unchanged", () => {
    const result = buildKeywordOpportunityResult(
      input({
        observations: [geo("how do i bill a client", { propositionIndex: 2 })],
      }),
    );

    expect(result.rows[0]).toMatchObject({
      keyword: "how do i bill a client",
      lane: "geo",
      discoveryBasis: "site_proposition",
      questionForm: true,
      propositionIndex: 2,
      validation: NO_PROVIDER_DATA,
      serp: KEYWORD_OPPORTUNITY_UNSAMPLED,
      coverage: "not_observed_in_gsc_query_sample",
      supportingPageUrl: "https://acme.test/guides/how-billing-works",
    });
  });

  it("clusters only shown keywords and gives every row the id of the group it landed in", () => {
    // A withheld term inside a cluster would make the group look bigger than
    // the table it describes.
    const result = buildKeywordOpportunityResult(
      input({
        observations: [
          seo("invoice software"),
          seo("invoice software pricing"),
          seo("payroll api"),
          seo("tax deadline", { serp: CONTESTED }),
        ],
      }),
    );

    const clustered = result.clusters.flatMap((cluster) => cluster.keywords);
    expect(clustered).not.toContain("tax deadline");
    for (const row of result.rows) {
      expect(row.clusterId, row.keyword).not.toBeNull();
      expect(
        result.clusters.some((cluster) => cluster.id === row.clusterId),
        row.keyword,
      ).toBe(true);
    }
    expect(result.clusters).toHaveLength(2);
  });

  it("preserves observation order in the rows it returns", () => {
    const result = buildKeywordOpportunityResult(
      input({
        observations: [
          seo("payroll api"),
          seo("tax deadline", { serp: CONTESTED }),
          seo("invoice software"),
        ],
      }),
    );

    expect(result.rows.map((row) => row.keyword)).toEqual([
      "payroll api",
      "invoice software",
    ]);
  });
});

describe("buildKeywordOpportunityResult withheld", () => {
  it("accounts for every candidate exactly once across rows and withheld", () => {
    // A candidate that appears in neither list has vanished, and a funnel that
    // cannot be reconciled against the two lists proves nothing.
    const observations = [
      seo("invoice software"),
      seo("payroll api", { validation: EXPLICIT_ZERO }),
      seo("tax deadline", { coverage: "observed_exact_strong" }),
      seo("expense tracker", { serp: CONTESTED }),
      geo("vendor onboarding", { supportingPageUrl: null }),
      geo("budget forecast"),
    ];
    const result = buildKeywordOpportunityResult(input({ observations }));

    const seen = [
      ...result.rows.map((row) => row.keyword),
      ...result.withheld.map((entry) => entry.keyword),
    ].sort();
    expect(seen).toEqual([...observations.map((o) => o.keyword)].sort());
    expect(result.rows.length + result.withheld.length).toBe(
      observations.length,
    );
  });

  it("keeps the discovery basis on withheld entries so the drop rate can be read per basis", () => {
    // site_proposition cleared the volume check 3.2% of the time against 37%
    // for traditional_expansion. A withheld list without the basis cannot show
    // that difference.
    const result = buildKeywordOpportunityResult(
      input({
        observations: [
          seo("invoice software", { validation: EXPLICIT_ZERO }),
          geo("payroll api", { supportingPageUrl: null }),
        ],
      }),
    );

    expect(result.withheld.map((entry) => entry.discoveryBasis)).toEqual([
      "traditional_expansion",
      "site_proposition",
    ]);
  });

  it("blames the missing demand measurement when the provider said zero or said nothing", () => {
    const result = buildKeywordOpportunityResult(
      input({
        observations: [
          seo("invoice software", { validation: EXPLICIT_ZERO }),
          seo("payroll api", { validation: NO_PROVIDER_DATA }),
        ],
      }),
    );

    expect(result.withheld.map((entry) => entry.reason)).toEqual([
      "no_measured_demand",
      "no_measured_demand",
    ]);
  });

  it("ranks already_covered above the demand reason, because coverage is the settled fact", () => {
    const result = buildKeywordOpportunityResult(
      input({
        observations: [
          seo("invoice software", {
            validation: NO_PROVIDER_DATA,
            coverage: "observed_exact_strong",
          }),
        ],
      }),
    );

    expect(result.withheld[0]?.reason).toBe("already_covered");
  });

  it("tells an unsampled page one apart from a contested one and from a GEO row", () => {
    // These three were withheld for three different reasons and only the first
    // is worth re-running: nobody looked. A contested page one WAS sampled and
    // came back held by strong sites, and a GEO row is never SERP-gated at all.
    // Collapsing them onto one label sends readers chasing a re-run that
    // cannot change anything.
    const result = buildKeywordOpportunityResult(
      input({
        observations: [
          seo("invoice software", { serp: KEYWORD_OPPORTUNITY_UNSAMPLED }),
          seo("payroll api", { serp: CONTESTED }),
          geo("tax deadline", {
            supportingPageUrl: null,
            validation: MEASURED,
          }),
        ],
      }),
    );

    expect(result.withheld.map((entry) => entry.reason)).toEqual([
      "serp_sample_budget_exhausted",
      "page_one_contested",
      "no_supporting_page",
    ]);
  });

  it("never blames missing demand data for a GEO row, which is not judged on demand", () => {
    // The GEO lane exists because question phrasings clear the volume check
    // only 13% of the time. Reporting "no measured demand" for one would send
    // the reader looking for a number the lane deliberately does not use.
    const result = buildKeywordOpportunityResult(
      input({
        observations: [
          geo("how do i file late", {
            supportingPageUrl: null,
            validation: NO_PROVIDER_DATA,
          }),
        ],
      }),
    );

    expect(result.withheld[0]?.reason).toBe("no_supporting_page");
  });
});

describe("buildKeywordOpportunityResult next step suggestions", () => {
  it("asks for a product description when the crawl learned too little to reason about positioning", () => {
    const result = buildKeywordOpportunityResult(
      input({
        context: { ...CONTEXT, contextSufficient: false },
        observations: shownSeoRows(KEYWORD_OPPORTUNITY_MIN_ROWS),
      }),
    );

    expect(result.nextStepSuggestions).toEqual(["supply_product_description"]);
  });

  it("asks for more seeds and another market when the table came back thin", () => {
    const result = buildKeywordOpportunityResult(
      input({ observations: shownSeoRows(KEYWORD_OPPORTUNITY_MIN_ROWS - 1) }),
    );

    expect(result.nextStepSuggestions).toEqual([
      "add_seed_keywords",
      "try_another_market",
    ]);
  });

  it("asks for a rerun when a stage was missing, even on a full table", () => {
    const result = buildKeywordOpportunityResult(
      input({
        observations: shownSeoRows(KEYWORD_OPPORTUNITY_MIN_ROWS),
        unavailableStages: ["serp_sample"],
      }),
    );

    expect(result.nextStepSuggestions).toEqual(["rerun_when_stage_recovers"]);
  });

  it("stacks every applicable suggestion for the worst-case run", () => {
    const result = buildKeywordOpportunityResult(
      input({
        context: { ...CONTEXT, contextSufficient: false },
        observations: [],
        unavailableStages: ["serp_sample", "gsc_coverage"],
      }),
    );

    expect(result.nextStepSuggestions).toEqual([
      "supply_product_description",
      "add_seed_keywords",
      "try_another_market",
      "rerun_when_stage_recovers",
    ]);
  });

  it("suggests nothing for a complete run, so a suggestion always means something is missing", () => {
    const result = buildKeywordOpportunityResult(
      input({ observations: shownSeoRows(KEYWORD_OPPORTUNITY_MIN_ROWS) }),
    );

    expect(result.nextStepSuggestions).toEqual([]);
  });
});

describe("buildKeywordOpportunityResult passthrough", () => {
  it("echoes the run's market, language, context and missing stages unchanged", () => {
    // The reader judges every number against the market it was measured in; a
    // result that dropped or rewrote them would be unfalsifiable.
    const stages = ["serp_sample"];
    const result = buildKeywordOpportunityResult(
      input({
        marketCode: "de",
        languageCode: "de",
        unavailableStages: stages,
        observations: shownSeoRows(KEYWORD_OPPORTUNITY_MIN_ROWS),
      }),
    );

    expect(result.marketCode).toBe("de");
    expect(result.languageCode).toBe("de");
    expect(result.context).toBe(CONTEXT);
    expect(result.unavailableStages).toEqual(["serp_sample"]);
  });

  it("mutates neither the observation list nor the observations themselves", () => {
    const observations = [
      seo("invoice software"),
      seo("payroll api", { serp: CONTESTED }),
    ];
    const snapshot = structuredClone(observations);

    buildKeywordOpportunityResult(input({ observations }));

    expect(observations).toEqual(snapshot);
    expect(observations).toHaveLength(2);
  });
});

describe("buildKeywordOpportunityPayload", () => {
  it("stamps the envelope as an unpersisted public preview, which is the true description of this run", () => {
    // Nothing this tool produces is written anywhere. The envelope has to say
    // so, and it has to say so from the shared helper rather than from a field
    // the caller could quietly set to something else.
    const envelope = buildKeywordOpportunityPayload(
      input({ observations: shownSeoRows(KEYWORD_OPPORTUNITY_MIN_ROWS) }),
    );

    expect(envelope.run).toEqual({
      tool: "keyword_opportunity_map",
      schemaVersion: KEYWORD_OPPORTUNITY_SCHEMA_VERSION,
      mode: "public_preview",
      scope: "site",
      persistence: "none",
      completedAt: COMPLETED_AT,
    });
  });

  it("takes completedAt from the caller so the same input always produces the same envelope", () => {
    // Reading the clock in here would make every test either nondeterministic
    // or forced to stub a global.
    const first = buildKeywordOpportunityPayload(
      input({ completedAt: "2026-01-01T00:00:00.000Z" }),
    );
    const second = buildKeywordOpportunityPayload(
      input({ completedAt: "2026-01-01T00:00:00.000Z" }),
    );

    expect(first).toEqual(second);
    expect(first.run.completedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("wraps the very result the caller would have built, with no second judgement applied", () => {
    const runInput = input({
      observations: [
        seo("invoice software"),
        seo("payroll api", { validation: EXPLICIT_ZERO }),
        geo("tax deadline"),
      ],
      unavailableStages: ["gsc_coverage"],
    });

    expect(buildKeywordOpportunityPayload(runInput).result).toEqual(
      buildKeywordOpportunityResult(runInput),
    );
  });
});
