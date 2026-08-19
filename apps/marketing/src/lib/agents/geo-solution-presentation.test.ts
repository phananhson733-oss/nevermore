// @input  -- plans derived from reports with a gap, a clean result, and a blind run
// @output -- proof the adapter renames nothing and decides nothing
// @pos    -- focused tests for the presentation layer between the plan and the cards

import { describe, expect, it } from "vitest";

import en from "../../i18n/messages/en.json" with { type: "json" };
import zh from "../../i18n/messages/zh.json" with { type: "json" };
import { GEO_ASSET_TYPES } from "./geo-asset-type.ts";
import { GEO_CORE_SLOTS } from "./geo-query-contract.ts";
import {
  deriveGeoActionPlan,
  GEO_ACTION_REASON_KIND,
  type GeoActionCandidateV1,
  type GeoActionPlanV1,
} from "./geo-action-mapping.ts";
import type { GeoConfirmedAliasV1 } from "./geo-context.ts";
import type { GeoProviderObservation } from "./geo-provider.ts";
import type { GeoQueryUnitV1 } from "./geo-query-contract.ts";
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
  deriveGeoSolutionPresentations,
  GEO_ACTION_REASONS,
  GEO_SOLUTION_BASES,
} from "./geo-solution-presentation.ts";

const CONTEXT: GeoSamplingContext = {
  targetHost: "acme.test",
  brandAliases: [
    { alias: "Acme Analytics", source: "profile_product_name" },
  ] as readonly GeoConfirmedAliasV1[],
  aliasScope: "supported",
};

function observation(
  urls: readonly string[],
  searched = true,
): GeoProviderObservation {
  return {
    observedAt: "2026-08-19T09:21:39.000Z",
    webSearchPerformed: searched,
    answerText: "Several tools cover this.",
    citations: urls.map((url, index) => ({
      url,
      title: null,
      annotationText: null,
      providerOutputItemIndex: 1,
      sectionIndex: 0,
      annotationOrdinal: index,
      startIndex: null,
      endIndex: null,
      spanBasis: "provider_message_section_text" as const,
    })),
    citationsComplete: true,
    costUsd: 0.0457,
    model: "gpt-5-2025-08-07",
  };
}

function probe(overrides: Partial<GeoQueryUnitV1> = {}): GeoQueryUnitV1 {
  return {
    queryId: "core-category_discovery",
    slot: "category_discovery",
    text: "What are the top seo tools right now?",
    cohort: "core",
    mode: "retrieval_probe",
    brandStance: "unbranded",
    buyerStage: "awareness",
    marketCode: "US",
    queryLanguageTag: "en",
    timeSensitive: true,
    asOf: "2026-08-19T09:00:00.000Z",
    expectedAssetTypes: ["blog_guide"],
    source: "profile",
    userConfirmed: true,
    templateId: "geo.retrieval.category_top",
    templateVersion: "1",
    retrievalTriggerClause: null,
    samplesPlanned: 3,
    ...overrides,
  };
}

function questionOf(
  unit: GeoQueryUnitV1,
  perSample: readonly GeoProviderObservation[],
): GeoQuestionObservationV3 {
  return assembleQuestion(
    unit,
    perSample.map((entry, index) =>
      observeToSample(
        {
          queryIndex: 0,
          sampleIndex: index + 1,
          sampleId: `${unit.queryId}-s${index + 1}`,
        },
        unit,
        entry,
        CONTEXT,
      ),
    ),
  );
}

function reportOf(
  questions: readonly GeoQuestionObservationV3[],
): GeoReportDataV3 {
  return {
    run: {
      agent: "geo",
      mode: "authenticated_agent",
      persistence: "report_contents_not_persisted",
      schemaVersion: "agent_geo_report.v3",
      runId: "run-01",
      sampledAt: "2026-08-19T09:05:00.000Z",
      targetHost: "acme.test",
      contextHash: `sha256:${"a".repeat(64)}`,
      querySetContentHash: `sha256:${"b".repeat(64)}`,
      reportContentHash: `sha256:${"c".repeat(64)}`,
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
        knownCostUsdMicros: 822_600,
        costComplete: true,
        unknownCostSamples: 0,
      },
    },
    coverage: deriveGeoRunCoverage(questions),
    questions,
    limitations: [],
  } as GeoReportDataV3;
}

/** A run where nobody cited the customer and two answers cited someone else. */
const GAP = reportOf([
  questionOf(probe(), [
    observation(["https://rival.test/a"]),
    observation(["https://rival.test/a"]),
    observation(["https://other.test/b"]),
  ]),
  questionOf(probe({ queryId: "core-jtbd_outcome", slot: "jtbd_outcome" }), [
    observation([]),
    observation([]),
    observation([]),
  ]),
]);

/** A run where the customer was cited every countable time. */
const CITED = reportOf([
  questionOf(probe({ samplesPlanned: 1 }), [
    observation(["https://acme.test/pricing"]),
  ]),
]);

/** A run whose only probe never searched, so nothing can be counted. */
const BLIND = reportOf([
  questionOf(probe({ samplesPlanned: 1 }), [observation([], false)]),
]);

function present(report: GeoReportDataV3, targetUrl?: string) {
  return deriveGeoSolutionPresentations(
    report,
    deriveGeoActionPlan(report, targetUrl),
  );
}

/** Every leaf path under `agents.geo` in one locale, as a set. */
function leafPaths(value: unknown, prefix = ""): readonly string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, child]) => leafPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("deriveGeoSolutionPresentations", () => {
  it("keeps the plan's own order, which ranks the cheapest item first", () => {
    const plan = deriveGeoActionPlan(GAP, "https://acme.test/pricing");
    const shown = present(GAP, "https://acme.test/pricing");

    expect(shown.map((entry) => entry.actionId)).toEqual(
      plan.candidates.map((candidate) => candidate.actionId),
    );
    expect(shown[0]?.reason).toBe("needs_page_inventory");
  });

  it("names the questions rather than the ids they were derived from", () => {
    const shown = present(GAP);
    const offsite = shown.find(
      (entry) => entry.reason === "citation_source_pattern_observed",
    );

    expect(offsite?.exactQuestions).toEqual([
      "What are the top seo tools right now?",
    ]);
    // Never the internal identifier, which means nothing outside this code.
    expect(offsite?.exactQuestions.join(" ")).not.toContain("core-");
  });

  it("carries the raw numerator and denominator, not a phrase", () => {
    const offsite = present(GAP).find(
      (entry) => entry.reason === "citation_source_pattern_observed",
    );

    expect(offsite?.reasonCounts).toEqual({ observed: 0, evaluable: 3 });
  });

  it("says explicitly when no ratio applies instead of inventing a zero", () => {
    const inventory = present(GAP).find(
      (entry) => entry.reason === "needs_page_inventory",
    );

    expect(inventory?.reasonCounts).toBeNull();
  });

  it("keys an avoid by its finding, never by an asset to build", () => {
    const avoid = present(GAP).find((entry) => entry.kind === "avoid");

    expect(avoid).toBeDefined();
    expect(avoid?.actionKey).toBe(
      "solutions.action.reason_avoid_new_page_as_first_step",
    );
    // The candidate does carry an asset type, and keying the sentence by it
    // would render "build an existing-page enhancement" for the one item whose
    // entire content is that a page is not the first step.
    expect(avoid?.assetType).toBe("existing_page_enhancement");
    expect(avoid?.actionKey).not.toContain("asset_");
  });

  it("names the confirmed page on the inventory item, not a fabricated root", () => {
    const withUrl = present(GAP, "https://acme.test/pricing").find(
      (entry) => entry.reason === "needs_page_inventory",
    );
    const without = present(GAP).find(
      (entry) => entry.reason === "needs_page_inventory",
    );

    expect(withUrl?.targetUrl).toBe("https://acme.test/pricing");
    expect(without?.targetUrl).toBeNull();
  });

  it("renders an explicit unavailable basis rather than a raw enum value", () => {
    // Reachable only through a cast, which is the point: a value outside the
    // closed enums must not reach a card as a translation path or as its own
    // identifier.
    const rogue = {
      actionId: "act-rogue",
      assetType: "not_an_asset",
      kind: "do",
      title: "target_not_observed_in_samples",
      reason: "invented_reason",
      reasonCounts: null,
      queryIds: [],
      sampleIds: [],
      evidenceIds: [],
      targetUrl: null,
      unknowns: [],
      limitations: [],
      requiresHumanReview: true,
    } as unknown as GeoActionCandidateV1;
    const plan: GeoActionPlanV1 = {
      candidates: [rogue],
      zeroActionReason: null,
    };

    const [shown] = deriveGeoSolutionPresentations(GAP, plan);
    expect(shown?.actionKey).toBe("solutions.action.unavailable");
    expect(shown?.issueKey).toBe("solutions.issue.unavailable");
    expect(shown?.whyKey).toBe("solutions.why.unavailable");
  });

  it("refuses an unknown reason even when the asset type is real", () => {
    // The case above is caught by the asset check alone, so it says nothing
    // about the reason check. A candidate whose asset type is perfectly valid
    // and whose reason is not would otherwise render a confident sentence about
    // building a guide, keyed off an enum value nothing in this codebase wrote.
    const rogue = {
      actionId: "act-rogue-reason",
      assetType: "blog_guide",
      kind: "do",
      title: "target_not_observed_in_samples",
      reason: "invented_reason",
      reasonCounts: null,
      queryIds: [],
      sampleIds: [],
      evidenceIds: [],
      targetUrl: null,
      unknowns: [],
      limitations: [],
      requiresHumanReview: true,
    } as unknown as GeoActionCandidateV1;

    const [shown] = deriveGeoSolutionPresentations(GAP, {
      candidates: [rogue],
      zeroActionReason: null,
    });
    expect(shown?.actionKey).toBe("solutions.action.unavailable");
    expect(shown?.inputsKey).toBe("solutions.inputs.unavailable");
    expect(shown?.rejectedAlternativeKey).toBe(
      "solutions.rejected.unavailable",
    );
  });

  it("refuses an unknown asset type even when the reason is real", () => {
    // The mirror of the case above. Both earlier rogue fixtures carried an
    // invalid reason, so the asset-type guard was never the thing that fired.
    const rogue = {
      actionId: "act-rogue-asset",
      assetType: "not_an_asset",
      kind: "do",
      title: "target_not_observed_in_samples",
      reason: "target_not_observed_in_samples",
      reasonCounts: { observed: 0, evaluable: 3 },
      queryIds: [],
      sampleIds: [],
      evidenceIds: [],
      targetUrl: null,
      unknowns: [],
      limitations: [],
      requiresHumanReview: true,
    } as unknown as GeoActionCandidateV1;

    const [shown] = deriveGeoSolutionPresentations(GAP, {
      candidates: [rogue],
      zeroActionReason: null,
    });
    expect(shown?.actionKey).toBe("solutions.action.unavailable");
    // The reason is real, so the observation half still renders normally.
    expect(shown?.issueKey).toBe(
      "solutions.issue.target_not_observed_in_samples",
    );
  });

  it("produces nothing at all when every question already cited the site", () => {
    expect(present(CITED)).toEqual([]);
    expect(deriveGeoActionPlan(CITED).zeroActionReason).toBe(
      "existing_page_fit_confirmed",
    );
  });

  it("keeps 'nothing to say yet' distinct from 'nothing to do'", () => {
    expect(present(BLIND)).toEqual([]);
    // A blind run and a clean run are the opposite findings, and an empty list
    // looks identical for both.
    expect(deriveGeoActionPlan(BLIND).zeroActionReason).toBe(
      "needs_more_evidence",
    );
  });

  it("never infers a public tool from a cited domain", () => {
    // The mapper has no evidence contract that proves a cited page is a tool,
    // so no rendering path may produce one. The mock shows a Tool card; the
    // report may not, until that contract exists.
    expect(present(GAP).map((entry) => entry.assetType)).not.toContain(
      "public_tool",
    );

    // GAP exercises two slots. The claim is about all eight, so it is checked
    // against every slot the mapper can select from rather than against the
    // two this fixture happens to reach.
    const everySlot = reportOf(
      GEO_CORE_SLOTS.map((slot, index) =>
        questionOf(probe({ queryId: `core-${slot}`, slot }), [
          observation([`https://rival${index}.test/a`]),
          observation([`https://rival${index}.test/a`]),
          observation([]),
        ]),
      ),
    );
    expect(
      present(everySlot).map((entry) => entry.assetType),
    ).not.toContain("public_tool");
    expect(everySlot.questions).toHaveLength(GEO_CORE_SLOTS.length);
  });

  it("has a message for every basis a card can be keyed by, in both locales", () => {
    // The fail-closed rule is only worth anything if the keys it produces
    // resolve. next-intl renders a missing key as its own path, so an absent
    // message reaches the reader as `solutions.action.asset_blog_guide`.
    const enPaths = new Set(leafPaths(en.agents.geo, "agents.geo"));
    const zhPaths = new Set(leafPaths(zh.agents.geo, "agents.geo"));

    for (const basis of GEO_SOLUTION_BASES) {
      for (const field of ["action", "inputs", "rejected"]) {
        const path = `agents.geo.solutions.${field}.${basis}`;
        expect(enPaths.has(path), `missing en ${path}`).toBe(true);
        expect(zhPaths.has(path), `missing zh ${path}`).toBe(true);
      }
    }
    for (const reason of [...GEO_ACTION_REASONS, "unavailable"]) {
      for (const field of ["issue", "why"]) {
        const path = `agents.geo.solutions.${field}.${reason}`;
        expect(enPaths.has(path), `missing en ${path}`).toBe(true);
        expect(zhPaths.has(path), `missing zh ${path}`).toBe(true);
      }
    }
  });

  it("has a counted sentence for every reason a card can print counts for", () => {
    // The card prints `actionReasonsCounted.<reason>` whenever a candidate
    // carries a ratio, and `actionReasons.<reason>` when an avoid supplies its
    // own heading. next-intl renders a missing key as the key path, so a reason
    // without copy reaches the reader as `agents.geo.actionReasonsCounted.x`
    // rather than as an error anybody notices.
    const enPaths = new Set(leafPaths(en.agents.geo, "agents.geo"));
    const zhPaths = new Set(leafPaths(zh.agents.geo, "agents.geo"));

    // Every reason that can reach a card as a candidate. The two zero-only
    // reasons are excluded because the mapper returns them as
    // `zeroActionReason`, never as a candidate — asserted directly below.
    const zeroOnly = new Set([
      "needs_more_evidence",
      "existing_page_fit_confirmed",
    ]);
    for (const reason of GEO_ACTION_REASONS) {
      if (zeroOnly.has(reason)) continue;
      const counted = `agents.geo.actionReasonsCounted.${reason}`;
      const plain = `agents.geo.actionReasons.${reason}`;
      expect(
        enPaths.has(counted) || enPaths.has(plain),
        `en has neither ${counted} nor ${plain}`,
      ).toBe(true);
      expect(
        zhPaths.has(counted) || zhPaths.has(plain),
        `zh has neither ${counted} nor ${plain}`,
      ).toBe(true);
    }
    // Every reason gets a zero-state sentence too, since that is the other
    // place a bare reason reaches the screen.
    for (const reason of GEO_ACTION_REASONS) {
      expect(enPaths.has(`agents.geo.solutions.zero.${reason}`)).toBe(true);
      expect(zhPaths.has(`agents.geo.solutions.zero.${reason}`)).toBe(true);
    }
  });

  it("covers every asset type, and only the reasons that have no asset", () => {
    // Walked from the mapper's tables, so an asset type added there without
    // copy fails the parity test above rather than shipping a key path.
    const noAsset = GEO_ACTION_REASONS.filter(
      (reason) => GEO_ACTION_REASON_KIND[reason] !== "do",
    );
    expect(GEO_SOLUTION_BASES).toHaveLength(
      GEO_ASSET_TYPES.length + noAsset.length + 1,
    );
    // A `do` candidate is always described by what it proposes to build, so a
    // reason key for one would be a sentence nothing can reach.
    expect(GEO_SOLUTION_BASES).not.toContain(
      "reason_target_not_observed_in_samples",
    );
  });
});
