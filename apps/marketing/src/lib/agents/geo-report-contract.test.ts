// @input  -- a complete v3 envelope and hand-broken variants of it
// @output -- proof the guard refuses every combination the samples cannot support
// @pos    -- focused tests for the public GEO report contract

import { describe, expect, it } from "vitest";

import { geoDomainHash } from "./geo-canonical.ts";
import type { GeoConfirmedAliasV1 } from "./geo-context.ts";
import type { GeoProviderObservation } from "./geo-provider.ts";
import type { GeoQueryUnitV1 } from "./geo-query-contract.ts";
import {
  isGeoReportSuccessEnvelope,
  AGENT_GEO_REPORT_SCHEMA_VERSION,
  type GeoQuestionObservationV3,
  type GeoReportDataV3,
  type GeoRunLimitationCode,
  type GeoSampleV3,
  type GeoSurfaceProvenanceV1,
} from "./geo-report-contract.ts";
import {
  deriveGeoRunCoverage,
  geoReportContentHash,
} from "./geo-report-derive.ts";
import {
  assembleQuestion,
  observeToSample,
  unavailableSample,
  type GeoSamplingContext,
} from "./geo-sampling.ts";

const ALIASES: readonly GeoConfirmedAliasV1[] = [
  { alias: "Acme Analytics", source: "profile_product_name" },
];

const CONTEXT: GeoSamplingContext = {
  targetHost: "acme.test",
  brandAliases: ALIASES,
  aliasScope: "supported",
};

const DIGEST = (seed: string): string =>
  `sha256:${seed.repeat(64).slice(0, 64)}`;

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

function observation(
  overrides: Partial<GeoProviderObservation> = {},
): GeoProviderObservation {
  return {
    observedAt: "2026-08-17T09:21:39.000Z",
    webSearchPerformed: true,
    answerText: "Acme Analytics and others cover this.",
    citations: [
      {
        url: "https://acme.test/pricing",
        title: "Acme pricing",
        annotationText: "([acme.test](https://acme.test/pricing))",
        providerOutputItemIndex: 1,
        sectionIndex: 0,
        annotationOrdinal: 0,
        startIndex: 0,
        endIndex: 4,
        spanBasis: "provider_message_section_text",
      },
    ],
    citationsComplete: true,
    costUsd: 0.0457,
    model: "gpt-5-2025-08-07",
    ...overrides,
  };
}

/**
 * The whole shipped cohort, because the guard now insists on it.
 *
 * Five retrieval probes and three natural-demand questions, one per slot. A
 * fixture with two questions was convenient and dishonest: it proved the guard
 * accepted a report that could never be produced, and the composition rules are
 * exactly what stops a client asking for a 24-call run.
 */
/**
 * The exact rendered strings, because the guard now checks that each question's
 * text really is a rendering of the template it claims. A fixture that reused
 * one sentence across five templates was testing a report no run can produce.
 */
const RETRIEVAL_SLOTS = [
  [
    "category_discovery",
    "geo.retrieval.category_top",
    "What are the top seo tools right now?",
  ],
  [
    "constraint_fit",
    "geo.retrieval.free_plan",
    "Which seo tool has the best free plan right now?",
  ],
  [
    "alternative_status_quo",
    "geo.retrieval.alternatives",
    "Best alternatives to semrush for seo",
  ],
  [
    "due_diligence",
    "geo.retrieval.best_reviews",
    "Which seo tools are getting the best reviews right now?",
  ],
  [
    "negative_fit_objection",
    "geo.retrieval.worth_paying",
    "Which seo tools are worth paying for right now?",
  ],
] as const;

const NATURAL_SLOTS = [
  [
    "jtbd_outcome",
    "geo.natural.jtbd_best_for_buyer",
    "What are the best seo tools for ceo?",
  ],
  [
    "pain_how_to",
    "geo.natural.pain_current_workflow",
    "How do ceo currently handle seo, and which tools do they use?",
  ],
  [
    "brand_comparison",
    "geo.natural.brand_comparison",
    "How does Acme Analytics compare to other seo tools?",
  ],
] as const;

function questionFor(
  unit: GeoQueryUnitV1,
  build: (index: number) => GeoProviderObservation,
): GeoQuestionObservationV3 {
  const samples = Array.from(
    { length: unit.samplesPlanned },
    (_unused, offset) =>
      observeToSample(
        {
          queryIndex: 0,
          sampleIndex: offset + 1,
          sampleId: `${unit.queryId}-s${offset + 1}`,
        },
        unit,
        build(offset),
        CONTEXT,
      ),
  );
  return assembleQuestion(unit, samples);
}

function questions(): readonly GeoQuestionObservationV3[] {
  return [
    ...RETRIEVAL_SLOTS.map(([slot, templateId, text]) =>
      questionFor(
        probe({ queryId: `core-${slot}`, slot, templateId, text }),
        () => observation(),
      ),
    ),
    ...NATURAL_SLOTS.map(([slot, templateId, text]) =>
      questionFor(
        probe({
          queryId: `core-${slot}`,
          slot,
          templateId,
          text,
          mode: "natural_demand",
          samplesPlanned: 1,
          timeSensitive: false,
          asOf: null,
          brandStance: slot === "brand_comparison" ? "brand" : "unbranded",
        }),
        () => observation({ webSearchPerformed: false, citations: [] }),
      ),
    ),
  ];
}

const PROVENANCE: GeoSurfaceProvenanceV1 = {
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
};

const RUN_LIMITATIONS: readonly GeoRunLimitationCode[] = [
  "report_contents_not_persisted",
  "no_paired_recheck",
  "single_surface_chat_gpt_via_dataforseo",
  "sentinel_cohort_not_full_coverage",
  "recommendation_not_evaluated",
];

async function report(
  build: (
    observations: readonly GeoQuestionObservationV3[],
  ) => readonly GeoQuestionObservationV3[] = (observations) => observations,
  provenance: GeoSurfaceProvenanceV1 = PROVENANCE,
  limitations: readonly GeoRunLimitationCode[] = RUN_LIMITATIONS,
): Promise<{ readonly data: GeoReportDataV3 }> {
  const observations = build(questions());
  const run = {
    schemaVersion: AGENT_GEO_REPORT_SCHEMA_VERSION,
    runId: "run-01",
    sampledAt: "2026-08-18T09:05:00.000Z",
    targetHost: "acme.test",
    contextHash: DIGEST("a"),
    querySetContentHash: DIGEST("b"),
    provenance,
  };
  const reportContentHash = await geoReportContentHash(
    run,
    observations,
    limitations,
  );
  return {
    data: {
      run: {
        agent: "geo",
        mode: "authenticated_agent",
        persistence: "report_contents_not_persisted",
        ...run,
        reportContentHash,
      },
      coverage: deriveGeoRunCoverage(observations),
      questions: observations,
      limitations,
    },
  };
}

function patchSample(
  observations: readonly GeoQuestionObservationV3[],
  patch: Partial<GeoSampleV3>,
): readonly GeoQuestionObservationV3[] {
  const [first, ...rest] = observations;
  const samples = first!.samples.map((sample, index) =>
    index === 0 ? { ...sample, ...patch } : sample,
  );
  return [{ ...first!, samples }, ...rest];
}

describe("isGeoReportSuccessEnvelope", () => {
  it("accepts a complete v3 envelope", async () => {
    expect(isGeoReportSuccessEnvelope(await report())).toBe(true);
  });

  // Regression: the first real run returned 502 geo_report_invalid after all
  // eighteen calls had been billed. The provider layer kept annotation strings
  // exactly as the answer carried them, the guard required normalized text, and
  // one citation title with a line break in it voided the whole report. Asserted
  // against the guard rather than against the normalizer, because asserting the
  // producer's own function back at itself proves nothing.
  // Found by /qa on 2026-08-18.
  it.each([
    ["a line break", "Best AI visibility tools\nRanked for 2026"],
    ["a run of spaces", "Best AI visibility  tools in 2026"],
    ["surrounding space", "  Best AI visibility tools  "],
    ["a tab", "Best AI\tvisibility tools"],
    // Escaped, not typed: an editor saves a typed "é" as NFC already, which
    // would make this row assert nothing.
    ["a decomposed accent", "Cafe\u0301 Analytics \u2014 the review"],
    ["a CRLF pair", "Best AI visibility tools\r\nRanked"],
  ])(
    "accepts a report whose provider citation title carries %s",
    async (_label, rawTitle) => {
      const envelope = await report((observations) =>
        observations.map((question, index) =>
          index === 0
            ? questionFor(probe(), () =>
                observation({
                  citations: [
                    {
                      url: "https://acme.test/pricing",
                      title: rawTitle,
                      annotationText: rawTitle,
                      providerOutputItemIndex: 1,
                      sectionIndex: 0,
                      annotationOrdinal: 0,
                      startIndex: 0,
                      endIndex: 4,
                      spanBasis: "provider_message_section_text",
                    },
                  ],
                }),
              )
            : question,
        ),
      );
      expect(isGeoReportSuccessEnvelope(envelope)).toBe(true);

      // Envelope validity alone is not the fix: `title` and `annotationText`
      // are nullable, so an implementation that dropped every provider string
      // would pass every row above. Pin that the evidence survived, normalized.
      const evidence = envelope.data.questions[0]?.samples[0]?.evidence[0];
      expect(evidence?.kind).toBe("cited");
      if (evidence?.kind !== "cited") return;
      const expected = rawTitle.normalize("NFC").replace(/\s+/gu, " ").trim();
      expect(evidence.title).toBe(expected);
      expect(evidence.annotationText).toBe(expected);
    },
  );

  // Same outcome, different door: NFC does not repair an unpaired surrogate and
  // the run fingerprint refuses to serialize one, so leaving it in place voided
  // the report at hashing time instead of at the guard. Dropped rather than
  // carried, which is what the nullable field is for.
  it("drops a provider string carrying an unpaired surrogate", async () => {
    const envelope = await report((observations) =>
      observations.map((question, index) =>
        index === 0
          ? questionFor(probe(), () =>
              observation({
                citations: [
                  {
                    url: "https://acme.test/pricing",
                    title: "Best AI visibility tools \uD800 ranked",
                    annotationText: "Best AI visibility tools \uD800 ranked",
                    providerOutputItemIndex: 1,
                    sectionIndex: 0,
                    annotationOrdinal: 0,
                    startIndex: 0,
                    endIndex: 4,
                    spanBasis: "provider_message_section_text",
                  },
                ],
              }),
            )
          : question,
      ),
    );

    expect(isGeoReportSuccessEnvelope(envelope)).toBe(true);
    const evidence = envelope.data.questions[0]?.samples[0]?.evidence[0];
    expect(evidence?.kind).toBe("cited");
    if (evidence?.kind !== "cited") return;
    expect(evidence.title).toBeNull();
    expect(evidence.annotationText).toBeNull();
  });

  it("refuses a legacy v2 payload outright", async () => {
    // A v2 client recomputes the old verdict rule and would disagree with this
    // payload; the version literal is what makes the refusal deliberate.
    const legacy = {
      data: {
        run: {
          agent: "geo",
          mode: "authenticated_agent",
          persistence: "none",
          schemaVersion: "agent_geo_report.v2",
          sampledAt: "2026-08-18T09:05:00.000Z",
          targetHost: "acme.test",
          provider: {
            tool: "dataforseo_chat_gpt_llm_responses",
            model: "gpt-5-2025-08-07",
            marketCode: "US",
            languageCode: "en",
            samplesPerQuestion: 3,
            costUsd: 1.1,
          },
        },
        coverage: {
          questionsRequested: 1,
          samplesAttempted: 3,
          samplesObserved: 3,
          samplesSearchNotPerformed: 0,
          samplesUnavailable: 0,
          availability: "available",
        },
        questions: [],
      },
    };

    expect(isGeoReportSuccessEnvelope(legacy)).toBe(false);
  });

  it.each([
    [
      "an unknown top-level key",
      (r: { data: GeoReportDataV3 }) => ({ ...r, extra: 1 }),
    ],
    [
      "an unknown run key",
      (r: { data: GeoReportDataV3 }) => ({
        data: { ...r.data, run: { ...r.data.run, extra: 1 } },
      }),
    ],
    [
      "a persistence claim of none",
      (r: { data: GeoReportDataV3 }) => ({
        data: { ...r.data, run: { ...r.data.run, persistence: "none" } },
      }),
    ],
    [
      "a non-digest report hash",
      (r: { data: GeoReportDataV3 }) => ({
        data: { ...r.data, run: { ...r.data.run, reportContentHash: "x" } },
      }),
    ],
    [
      "a target host that is not canonical",
      (r: { data: GeoReportDataV3 }) => ({
        data: {
          ...r.data,
          run: { ...r.data.run, targetHost: "www.acme.test" },
        },
      }),
    ],
  ] as const)("refuses %s", async (_label, mutate) => {
    expect(isGeoReportSuccessEnvelope(mutate(await report()))).toBe(false);
  });

  it("refuses counts the samples do not produce", async () => {
    const envelope = await report();
    const [first, ...rest] = envelope.data.questions;
    const tampered = {
      data: {
        ...envelope.data,
        questions: [
          { ...first!, counts: { ...first!.counts, targetCitedIn: 99 } },
          ...rest,
        ],
      },
    };

    expect(isGeoReportSuccessEnvelope(tampered)).toBe(false);
  });

  it("refuses a coverage block that disagrees with the questions", async () => {
    const envelope = await report();
    const tampered = {
      data: {
        ...envelope.data,
        coverage: {
          ...envelope.data.coverage,
          citation: {
            ...envelope.data.coverage.citation,
            retrieval_probe: {
              ...envelope.data.coverage.citation.retrieval_probe,
              targetCitedIn: 99,
            },
          },
        },
      },
    };

    expect(isGeoReportSuccessEnvelope(tampered)).toBe(false);
  });

  it.each([
    [
      "observed_target with no target citation",
      { citationStatus: "observed_target" as const, evidence: [] },
    ],
    [
      "observed_none while carrying citations",
      { citationStatus: "observed_none" as const },
    ],
    [
      "unavailable while carrying citations",
      { citationStatus: "unavailable" as const },
    ],
    [
      "a mention status of observed with no mention record",
      { mentionStatus: "observed" as const, evidence: [] },
    ],
    ["a probe status of null on a retrieval sample", { probeStatus: null }],
    ["an answered sample with no observation time", { observedAt: null }],
    [
      "a recommendation this build cannot evaluate",
      { recommendationStatus: "recommended" as never },
    ],
  ] as const)("refuses a sample claiming %s", async (_label, patch) => {
    const envelope = await report((observations) =>
      patchSample(observations, patch),
    );

    expect(isGeoReportSuccessEnvelope(envelope)).toBe(false);
  });

  it("refuses an unavailable citation status with no extraction limitation", async () => {
    const envelope = await report((observations) =>
      patchSample(observations, {
        citationStatus: "unavailable",
        evidence: [],
        limitations: [],
      }),
    );

    expect(isGeoReportSuccessEnvelope(envelope)).toBe(false);
  });

  it("refuses an unavailable mention status with no matcher limitation", async () => {
    const envelope = await report((observations) =>
      patchSample(observations, {
        mentionStatus: "unavailable",
        evidence: [],
        limitations: [],
      }),
    );

    expect(isGeoReportSuccessEnvelope(envelope)).toBe(false);
  });

  it("refuses a failed call that still carries evidence", async () => {
    const envelope = await report((observations) => {
      const [first, ...rest] = observations;
      const broken: GeoSampleV3 = {
        ...unavailableSample(
          {
            queryIndex: 0,
            sampleIndex: 1,
            sampleId: "core-category_discovery-s1",
          },
          probe(),
          CONTEXT,
          "provider_error",
        ),
        evidence: first!.samples[0]!.evidence,
      };
      return [
        { ...first!, samples: [broken, ...first!.samples.slice(1)] },
        ...rest,
      ];
    });

    expect(isGeoReportSuccessEnvelope(envelope)).toBe(false);
  });

  it("refuses a probe whose samples disagree about the probe verdict", async () => {
    const envelope = await report((observations) => {
      const [first, ...rest] = observations;
      const samples = first!.samples.map((sample, index) =>
        index === 0
          ? { ...sample, probeStatus: "trigger_failed" as const }
          : sample,
      );
      return [{ ...first!, samples }, ...rest];
    });

    expect(isGeoReportSuccessEnvelope(envelope)).toBe(false);
  });

  it("refuses a natural-demand sample carrying a probe verdict", async () => {
    const envelope = await report((observations) => {
      const [first, ...rest] = observations;
      const naturalIndex = rest.findIndex(
        (question) => question.mode === "natural_demand",
      );
      const natural = rest[naturalIndex]!;
      const samples = natural.samples.map((sample) => ({
        ...sample,
        probeStatus: "valid" as const,
      }));
      return [
        first!,
        ...rest.map((question, index) =>
          index === naturalIndex ? { ...natural, samples } : question,
        ),
      ];
    });

    expect(isGeoReportSuccessEnvelope(envelope)).toBe(false);
  });

  it("refuses a domain that disagrees with its own URL", async () => {
    const envelope = await report((observations) => {
      const [first, ...rest] = observations;
      const [sample, ...others] = first!.samples;
      const evidence = sample!.evidence.map((entry) =>
        entry.kind === "cited" ? { ...entry, domain: "evil.test" } : entry,
      );
      return [
        { ...first!, samples: [{ ...sample!, evidence }, ...others] },
        ...rest,
      ];
    });

    expect(isGeoReportSuccessEnvelope(envelope)).toBe(false);
  });

  it("refuses ownership target on a host that is not the target", async () => {
    const envelope = await report((observations) => {
      const [first, ...rest] = observations;
      const [sample, ...others] = first!.samples;
      const evidence = sample!.evidence.map((entry) =>
        entry.kind === "cited"
          ? {
              ...entry,
              exactUrl: "https://rival.test/x",
              domain: "rival.test",
              ownership: "target" as const,
            }
          : entry,
      );
      return [
        { ...first!, samples: [{ ...sample!, evidence }, ...others] },
        ...rest,
      ];
    });

    expect(isGeoReportSuccessEnvelope(envelope)).toBe(false);
  });

  it("refuses an evidence kind this build has no evaluator for", async () => {
    // Injected after the report was assembled, because the producer cannot
    // build this shape: the fingerprint projection refuses to serialize an
    // unknown evidence kind, which is its own fail-closed layer.
    const envelope = await report();
    const [first, ...rest] = envelope.data.questions;
    const [sample, ...others] = first!.samples;
    const tampered = {
      data: {
        ...envelope.data,
        questions: [
          {
            ...first!,
            samples: [
              {
                ...sample!,
                evidence: [
                  { kind: "evaluation", evidenceId: "x" } as never,
                  ...sample!.evidence,
                ],
              },
              ...others,
            ],
          },
          ...rest,
        ],
      },
    };

    expect(isGeoReportSuccessEnvelope(tampered)).toBe(false);
  });

  it("refuses duplicate evidence ids across the whole report", async () => {
    const envelope = await report((observations) => {
      const [first, ...rest] = observations;
      const [a, b, ...others] = first!.samples;
      return [
        {
          ...first!,
          samples: [a!, { ...b!, evidence: a!.evidence }, ...others],
        },
        ...rest,
      ];
    });

    expect(isGeoReportSuccessEnvelope(envelope)).toBe(false);
  });
});

describe("provenance and cost", () => {
  it("refuses a cost claimed complete while samples went unpriced", async () => {
    const envelope = await report(undefined, {
      ...PROVENANCE,
      costComplete: true,
      unknownCostSamples: 2,
    });

    expect(isGeoReportSuccessEnvelope(envelope)).toBe(false);
  });

  it("accepts an incomplete cost that says so", async () => {
    const envelope = await report(
      undefined,
      { ...PROVENANCE, costComplete: false, unknownCostSamples: 2 },
      [...RUN_LIMITATIONS, "cost_incomplete"],
    );

    expect(isGeoReportSuccessEnvelope(envelope)).toBe(true);
  });

  it("refuses a non-US market that claims calibrated trigger behaviour", async () => {
    // The wording was calibrated with US market settings. Another country has
    // not been calibrated, and saying otherwise sells an unmeasured run.
    const envelope = await report(undefined, {
      ...PROVENANCE,
      webSearchCountryIsoCodeRequested: "DE",
      triggerCalibrationScope: "calibrated_market",
    });

    expect(isGeoReportSuccessEnvelope(envelope)).toBe(false);
  });

  it("accepts a non-US market that admits it is outside the calibration", async () => {
    const envelope = await report(
      undefined,
      {
        ...PROVENANCE,
        webSearchCountryIsoCodeRequested: "DE",
        triggerCalibrationScope: "outside_calibrated_market",
      },
      [...RUN_LIMITATIONS, "outside_calibrated_market"],
    );

    expect(isGeoReportSuccessEnvelope(envelope)).toBe(true);
  });

  it("refuses a non-US run that omits the calibration limitation", async () => {
    // The scope field and the limitations list are two ways of saying the same
    // thing to a reader, and a payload may not say it in one place only.
    const envelope = await report(undefined, {
      ...PROVENANCE,
      webSearchCountryIsoCodeRequested: "DE",
      triggerCalibrationScope: "outside_calibrated_market",
    });

    expect(isGeoReportSuccessEnvelope(envelope)).toBe(false);
  });

  it("refuses observed model labels in arrival order rather than sorted", async () => {
    const envelope = await report(undefined, {
      ...PROVENANCE,
      modelObserved: ["gpt-5-mini", "gpt-5-2025-08-07"],
    });

    expect(isGeoReportSuccessEnvelope(envelope)).toBe(false);
  });

  it("refuses a lower output ceiling than the run identity claims", async () => {
    const envelope = await report(undefined, {
      ...PROVENANCE,
      maxOutputTokensRequested: 1_024 as never,
    });

    expect(isGeoReportSuccessEnvelope(envelope)).toBe(false);
  });
});

describe("run limitations", () => {
  it("requires a degraded run to say so", async () => {
    const envelope = await report((observations) => {
      const [first, ...rest] = observations;
      const samples = first!.samples.map((sample) => ({
        ...sample,
        webSearchPerformed: false,
        probeStatus: "trigger_failed" as const,
        citationStatus: "observed_none" as const,
        evidence: sample.evidence.filter((entry) => entry.kind === "mention"),
        limitations: ["retrieval_trigger_failed" as const],
      }));
      return [{ ...first!, samples, counts: first!.counts }, ...rest];
    });

    // The counts no longer match either, so this must fail; the point of the
    // test is that a degraded run cannot slip through as a clean one.
    expect(isGeoReportSuccessEnvelope(envelope)).toBe(false);
  });

  it("refuses an unknown run limitation code", async () => {
    const envelope = await report(undefined, PROVENANCE, [
      ...RUN_LIMITATIONS,
      "everything_is_fine" as GeoRunLimitationCode,
    ]);

    expect(isGeoReportSuccessEnvelope(envelope)).toBe(false);
  });
});

describe("the report fingerprint", () => {
  it("is reproducible from the report's own contents", async () => {
    const envelope = await report();
    const { run } = envelope.data;

    await expect(
      geoReportContentHash(
        {
          schemaVersion: run.schemaVersion,
          runId: run.runId,
          sampledAt: run.sampledAt,
          targetHost: run.targetHost,
          contextHash: run.contextHash,
          querySetContentHash: run.querySetContentHash,
          provenance: run.provenance,
        },
        envelope.data.questions,
        envelope.data.limitations,
      ),
    ).resolves.toBe(run.reportContentHash);
  });

  it("uses its own hash domain", async () => {
    const envelope = await report();

    await expect(
      geoDomainHash("geo_context.v1", { anything: true }),
    ).resolves.not.toBe(envelope.data.run.reportContentHash);
  });
});
