// @input  -- reports whose questions observed different kinds of gap
// @output -- proof the suggestions follow the observations and stop when they do
// @pos    -- focused tests for the deterministic GEO action mapping

import { describe, expect, it } from "vitest";

import type { GeoConfirmedAliasV1 } from "./geo-context.ts";
import type { GeoProviderCitationAnnotation } from "./geo-provider.ts";
import type { GeoQuerySlot, GeoQueryUnitV1 } from "./geo-query-contract.ts";
import type {
  GeoQuestionObservationV3,
  GeoReportDataV3,
} from "./geo-report-contract.ts";
import { deriveGeoRunCoverage } from "./geo-report-derive.ts";
import {
  assembleQuestion,
  observeToSample,
  type GeoSamplingContext,
} from "./geo-sampling.ts";
import {
  deriveGeoActionPlan,
  GEO_MAX_ACTION_CANDIDATES,
} from "./geo-action-mapping.ts";

const ALIASES: readonly GeoConfirmedAliasV1[] = [
  { alias: "Acme Analytics", source: "profile_product_name" },
];

const CONTEXT: GeoSamplingContext = {
  targetHost: "acme.test",
  brandAliases: ALIASES,
  aliasScope: "supported",
};

function query(slot: GeoQuerySlot): GeoQueryUnitV1 {
  return {
    queryId: `core-${slot}`,
    slot,
    text: "What are the top seo tools right now?",
    cohort: "core",
    mode: "retrieval_probe",
    brandStance: "unbranded",
    buyerStage: "awareness",
    marketCode: "US",
    queryLanguageTag: "en",
    timeSensitive: true,
    asOf: "2026-08-18T09:00:00.000Z",
    expectedAssetTypes: ["blog_guide"],
    source: "profile",
    userConfirmed: true,
    templateId: "geo.retrieval.category_top",
    templateVersion: "1",
    retrievalTriggerClause: null,
    samplesPlanned: 3,
  };
}

function citation(url: string): GeoProviderCitationAnnotation {
  return {
    url,
    title: "Source",
    annotationText: null,
    providerOutputItemIndex: 1,
    sectionIndex: 0,
    annotationOrdinal: 0,
    startIndex: null,
    endIndex: null,
    spanBasis: "provider_message_section_text",
  };
}

/**
 * Build one question whose three samples cited the given hosts.
 *
 * `null` in the list means that sample answered but cited nobody; `"none"`
 * means the call never produced an answer.
 */
function question(
  slot: GeoQuerySlot,
  samples: readonly (readonly string[] | "unanswered" | "unsearched")[],
): GeoQuestionObservationV3 {
  const unit = query(slot);
  const built = samples.map((entry, index) => {
    const slotRef = {
      queryIndex: 0,
      sampleIndex: index + 1,
      sampleId: `${unit.queryId}-s${index + 1}`,
    };
    if (entry === "unanswered") {
      return observeToSample(
        slotRef,
        unit,
        {
          observedAt: "2026-08-17T09:21:39.000Z",
          webSearchPerformed: true,
          answerText: "An answer.",
          citations: [],
          citationsComplete: false,
          costUsd: 0.04,
          model: "gpt-5-2025-08-07",
        },
        CONTEXT,
      );
    }
    return observeToSample(
      slotRef,
      unit,
      {
        observedAt: "2026-08-17T09:21:39.000Z",
        webSearchPerformed: entry !== "unsearched",
        answerText: "An answer.",
        citations: entry === "unsearched" ? [] : entry.map((url) => citation(url)),
        citationsComplete: true,
        costUsd: 0.04,
        model: "gpt-5-2025-08-07",
      },
      CONTEXT,
    );
  });
  return assembleQuestion(unit, built);
}

function report(
  questions: readonly GeoQuestionObservationV3[],
): GeoReportDataV3 {
  return {
    run: {
      agent: "geo",
      mode: "authenticated_agent",
      persistence: "report_contents_not_persisted",
      schemaVersion: "agent_geo_report.v3",
      runId: "run-01",
      sampledAt: "2026-08-18T09:05:00.000Z",
      targetHost: "acme.test",
      contextHash: `sha256:${"a".repeat(64)}`,
      querySetContentHash: `sha256:${"b".repeat(64)}`,
      provenance: {
        collector: "dataforseo",
        upstream: "openai",
        surface: "dataforseo_chat_gpt_llm_responses_api",
        searchModeRequested: "web_search_permitted",
        modelRequested: "gpt-5-2025-08-07",
        modelObserved: ["gpt-5-2025-08-07"],
        maxOutputTokensRequested: 4_096,
        webSearchCountryIsoCodeRequested: "US",
        calibrationMarket: "US",
        triggerCalibrationScope: "calibrated_market",
        queryLanguageTag: "en",
        retrievalSamplesPerProbe: 3,
        naturalDemandSamplesPerQuery: 1,
        knownCostUsdMicros: 1,
        costComplete: true,
        unknownCostSamples: 0,
      },
      reportContentHash: `sha256:${"c".repeat(64)}`,
    },
    coverage: deriveGeoRunCoverage(questions),
    questions,
    limitations: [],
  };
}

const CITED = [
  ["https://acme.test/a"],
  ["https://acme.test/a"],
  ["https://acme.test/a"],
] as const;
const NOT_CITED = [
  ["https://rival.test/a"],
  ["https://rival.test/a"],
  ["https://rival.test/a"],
] as const;
const NO_CITATIONS = [[], [], []] as const;

describe("deriveGeoActionPlan", () => {
  it("returns zero actions with a reason when nothing was evaluable", () => {
    const plan = deriveGeoActionPlan(
      report([question("category_discovery", ["unanswered", "unanswered", "unanswered"])]),
    );

    expect(plan.candidates).toEqual([]);
    expect(plan.zeroActionReason).toBe("needs_more_evidence");
  });

  it("returns zero actions when every evaluable question already cited the site", () => {
    // A real result, and the honest response to it is no work rather than
    // invented work.
    const plan = deriveGeoActionPlan(
      report([question("category_discovery", [...CITED])]),
    );

    expect(plan.candidates).toEqual([]);
    expect(plan.zeroActionReason).toBe("existing_page_fit_confirmed");
  });

  it("always puts the existing-page check first", () => {
    // In P0 the entered URL is the only page identity known with certainty, so
    // a new page recommended without looking at the existing ones is a guess.
    const plan = deriveGeoActionPlan(
      report([question("pain_how_to", [...NO_CITATIONS])]),
      "https://acme.test/pricing",
    );

    expect(plan.candidates[0]).toMatchObject({
      assetType: "existing_page_enhancement",
      reason: "needs_page_inventory",
      // The page the visitor confirmed, not a fabricated site root: pointing
      // the existing-page check at "/" would be checking a different page.
      targetUrl: "https://acme.test/pricing",
      unknowns: ["page_inventory_not_collected"],
      requiresHumanReview: true,
    });
  });

  it("names no page at all when the confirmed URL was not supplied", () => {
    const plan = deriveGeoActionPlan(
      report([question("pain_how_to", [...NO_CITATIONS])]),
    );

    expect(plan.candidates[0]!.targetUrl).toBeNull();
  });

  it("does not call it a confirmed fit when a question could not be evaluated", () => {
    // One natural-demand answer citing the site must not report "no work
    // needed" while another question produced nothing evaluable at all.
    const plan = deriveGeoActionPlan(
      report([
        question("category_discovery", [...CITED]),
        question("due_diligence", ["unanswered", "unanswered", "unanswered"]),
      ]),
    );

    expect(plan.candidates).toEqual([]);
    expect(plan.zeroActionReason).toBe("needs_more_evidence");
  });

  it("keeps retrieval and natural-demand counts out of one merged ratio", () => {
    // Both map to the same asset. Merging them would produce a single
    // observed/evaluable ratio spanning a three-sample probe and a one-sample
    // natural question — the shared denominator the report exists to avoid.
    const naturalQuestion = {
      ...question("constraint_fit", [[]]),
      mode: "natural_demand" as const,
      samplesPlanned: 1,
    };
    const plan = deriveGeoActionPlan(
      report([question("negative_fit_objection", [...NO_CITATIONS]), naturalQuestion]),
    );
    const pricing = plan.candidates.filter(
      (candidate) => candidate.assetType === "pricing_page",
    );

    expect(pricing).toHaveLength(2);
    for (const candidate of pricing) {
      expect(candidate.reasonCounts!.evaluable).toBeLessThanOrEqual(3);
    }
  });

  it.each([
    ["pain_how_to", "blog_guide"],
    ["jtbd_outcome", "use_case_landing"],
    ["constraint_fit", "pricing_page"],
    ["alternative_status_quo", "comparison_page"],
    ["brand_comparison", "comparison_page"],
    ["negative_fit_objection", "pricing_page"],
  ] as const)("maps a %s gap to %s", (slot, assetType) => {
    const plan = deriveGeoActionPlan(report([question(slot, [...NO_CITATIONS])]));

    expect(plan.candidates.map((candidate) => candidate.assetType)).toContain(
      assetType,
    );
  });

  it("reads a pattern of other hosts being cited as an off-site problem", () => {
    // Nobody's page can make a model cite a page it never reaches for. This is
    // a human, off-site plan, never a fake review or community post.
    const plan = deriveGeoActionPlan(
      report([question("due_diligence", [...NOT_CITED])]),
    );
    const offsite = plan.candidates.find(
      (candidate) => candidate.assetType === "offsite_authority_plan",
    );

    expect(offsite?.reason).toBe("citation_source_pattern_observed");
  });

  it("distinguishes an intermittent citation from an absent one", () => {
    const plan = deriveGeoActionPlan(
      report([
        question("category_discovery", [
          ["https://acme.test/a"],
          ["https://rival.test/a"],
          ["https://rival.test/a"],
        ]),
      ]),
    );

    expect(
      plan.candidates.map((candidate) => candidate.reason),
    ).toContain("target_observed_in_minority_of_samples");
  });

  it("carries the raw counts behind every ratio-bearing reason", () => {
    const plan = deriveGeoActionPlan(
      report([question("category_discovery", [...NO_CITATIONS])]),
    );
    const gap = plan.candidates.find(
      (candidate) => candidate.reason === "target_not_observed_in_samples",
    );

    // "observed in 0 of 3", never "not present".
    expect(gap?.reasonCounts).toEqual({ observed: 0, evaluable: 3 });
  });

  it("references the samples every candidate rests on", () => {
    const plan = deriveGeoActionPlan(
      report([question("category_discovery", [...NO_CITATIONS])]),
    );

    for (const candidate of plan.candidates) {
      const hasReferences =
        candidate.queryIds.length > 0 || candidate.reason === "needs_more_evidence";
      expect(hasReferences).toBe(true);
    }
  });

  it("merges two questions that would produce the same asset", () => {
    const plan = deriveGeoActionPlan(
      report([
        question("alternative_status_quo", [...NO_CITATIONS]),
        question("brand_comparison", [...NO_CITATIONS]),
      ]),
    );
    const comparison = plan.candidates.filter(
      (candidate) => candidate.assetType === "comparison_page",
    );

    expect(comparison).toHaveLength(1);
    expect(comparison[0]!.queryIds).toHaveLength(2);
  });

  it("never proposes more than five candidates", () => {
    const slots: readonly GeoQuerySlot[] = [
      "category_discovery",
      "jtbd_outcome",
      "pain_how_to",
      "constraint_fit",
      "alternative_status_quo",
      "brand_comparison",
      "due_diligence",
      "negative_fit_objection",
    ];
    const plan = deriveGeoActionPlan(
      report(slots.map((slot) => question(slot, [...NOT_CITED]))),
    );

    expect(plan.candidates.length).toBeLessThanOrEqual(
      GEO_MAX_ACTION_CANDIDATES,
    );
  });

  it("does not invent a tool build or a research dataset from a citation gap", () => {
    // §2.5 lists both, but neither has a signal in the core_8 cohort: nothing
    // here observes a repeatable calculation or a missing dataset. Proposing
    // one would be a finding the run did not make.
    const slots: readonly GeoQuerySlot[] = [
      "category_discovery",
      "jtbd_outcome",
      "pain_how_to",
      "constraint_fit",
    ];
    const plan = deriveGeoActionPlan(
      report(slots.map((slot) => question(slot, [...NO_CITATIONS]))),
    );
    const assets = plan.candidates.map((candidate) => candidate.assetType);

    expect(assets).not.toContain("public_tool");
    expect(assets).not.toContain("research_dataset");
  });

  it("is deterministic for the same report", () => {
    const fixture = report([
      question("category_discovery", [...NO_CITATIONS]),
      question("due_diligence", [...NOT_CITED]),
    ]);

    expect(deriveGeoActionPlan(fixture)).toEqual(deriveGeoActionPlan(fixture));
  });

  it("marks every candidate as requiring human review", () => {
    const plan = deriveGeoActionPlan(
      report([question("category_discovery", [...NO_CITATIONS])]),
    );

    expect(
      plan.candidates.every((candidate) => candidate.requiresHumanReview),
    ).toBe(true);
  });
});
