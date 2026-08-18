// @input  -- reports whose evidence spreads across samples, questions and modes
// @output -- proof the aggregate counts against the same denominator the report does
// @pos    -- focused tests for the run-level source view

import { describe, expect, it } from "vitest";

import type { GeoConfirmedAliasV1 } from "./geo-context.ts";
import type {
  GeoProviderCitationAnnotation,
  GeoProviderObservation,
} from "./geo-provider.ts";
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
import { deriveGeoSourceLandscape } from "./geo-source-landscape.ts";

const CONTEXT: GeoSamplingContext = {
  targetHost: "acme.test",
  brandAliases: [
    { alias: "Acme Analytics", source: "profile_product_name" },
  ] as readonly GeoConfirmedAliasV1[],
  aliasScope: "supported",
};

function annotation(
  url: string,
  ordinal: number,
): GeoProviderCitationAnnotation {
  return {
    url,
    title: null,
    annotationText: null,
    providerOutputItemIndex: 1,
    sectionIndex: 0,
    annotationOrdinal: ordinal,
    startIndex: ordinal * 10,
    endIndex: ordinal * 10 + 4,
    spanBasis: "provider_message_section_text",
  };
}

function observation(
  urls: readonly string[],
  searched = true,
): GeoProviderObservation {
  return {
    observedAt: "2026-08-17T09:21:39.000Z",
    webSearchPerformed: searched,
    answerText: "Several tools cover this.",
    citations: urls.map((url, index) => annotation(url, index)),
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
    asOf: "2026-08-18T09:00:00.000Z",
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
      sampledAt: "2026-08-18T09:05:00.000Z",
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

describe("deriveGeoSourceLandscape", () => {
  it("separates reach across samples from reach across questions", () => {
    // rival.test is cited in every sample of one question; wide.test appears
    // once in each of two questions. A single count would make them look the
    // same, and they are not the same finding.
    const landscape = deriveGeoSourceLandscape(
      reportOf([
        questionOf(probe(), [
          observation(["https://rival.test/a"]),
          observation(["https://rival.test/a"]),
          observation(["https://rival.test/a", "https://wide.test/x"]),
        ]),
        questionOf(
          probe({ queryId: "core-due_diligence", slot: "due_diligence" }),
          [
            observation(["https://wide.test/y"]),
            observation([]),
            observation([]),
          ],
        ),
      ]),
    );

    const rival = landscape.sources.find((s) => s.domain === "rival.test");
    const wide = landscape.sources.find((s) => s.domain === "wide.test");

    expect(rival).toEqual(
      expect.objectContaining({ citedInSamples: 3, citedInQuestions: 1 }),
    );
    expect(wide).toEqual(
      expect.objectContaining({ citedInSamples: 2, citedInQuestions: 2 }),
    );
  });

  it("counts one host once per sample however often the answer linked it", () => {
    // The evidence list keeps every annotation span, because the same page
    // cited twice in one answer is two observations. Reach is a different
    // question and must not inherit that multiplicity.
    const landscape = deriveGeoSourceLandscape(
      reportOf([
        questionOf(probe({ samplesPlanned: 1 }), [
          observation([
            "https://rival.test/a",
            "https://rival.test/b",
            "https://rival.test/c",
          ]),
        ]),
      ]),
    );

    expect(landscape.sources).toHaveLength(1);
    expect(landscape.sources[0]?.citedInSamples).toBe(1);
    expect(landscape.sources[0]?.urls).toHaveLength(3);
  });

  it("excludes a retrieval sample that never searched, like the coverage block", () => {
    // The denominator has to be the one printed above this table. A landscape
    // counting an unsearched probe would disagree with the numbers beside it.
    const landscape = deriveGeoSourceLandscape(
      reportOf([
        questionOf(probe(), [
          observation(["https://rival.test/a"]),
          observation(["https://ghost.test/a"], false),
          observation(["https://rival.test/a"]),
        ]),
      ]),
    );

    expect(landscape.citationEvaluableSamples).toBe(2);
    expect(landscape.sources.map((s) => s.domain)).not.toContain("ghost.test");
  });

  it("marks the customer's own host and says so at the run level", () => {
    const landscape = deriveGeoSourceLandscape(
      reportOf([
        questionOf(probe({ samplesPlanned: 1 }), [
          observation(["https://acme.test/pricing", "https://rival.test/a"]),
        ]),
      ]),
    );

    expect(landscape.targetObserved).toBe(true);
    expect(
      landscape.sources.find((s) => s.domain === "acme.test")?.isTarget,
    ).toBe(true);
    expect(
      landscape.sources.find((s) => s.domain === "rival.test")?.isTarget,
    ).toBe(false);
  });

  it("is empty, not wrong, when nothing was cited", () => {
    const landscape = deriveGeoSourceLandscape(
      reportOf([questionOf(probe({ samplesPlanned: 1 }), [observation([])])]),
    );

    expect(landscape.sources).toEqual([]);
    expect(landscape.distinctDomains).toBe(0);
    expect(landscape.targetObserved).toBe(false);
    expect(landscape.citationEvaluableSamples).toBe(1);
  });

  it("orders by sample reach, then question reach, then host", () => {
    const landscape = deriveGeoSourceLandscape(
      reportOf([
        questionOf(probe(), [
          observation(["https://b.test/x", "https://a.test/x"]),
          observation(["https://b.test/x"]),
          observation([]),
        ]),
      ]),
    );

    expect(landscape.sources.map((s) => s.domain)).toEqual([
      "b.test",
      "a.test",
    ]);
  });
});
