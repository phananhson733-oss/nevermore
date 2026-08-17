// @input  -- candidate GEO report envelopes and the three frozen run fixtures
// @output -- proof that the guard accepts only self-consistent sampled evidence
// @pos    -- focused contract tests shared by the GEO API and client rendering

import { describe, expect, it } from "vitest";
import {
  AGENT_GEO_REPORT_SCHEMA_VERSION,
  GEO_QUESTIONS_PER_RUN,
  GEO_SAMPLES_PER_QUESTION,
  geoCoverageAvailability,
  geoQuestionVerdict,
  isGeoReportSuccessEnvelope,
  type GeoQuestionObservation,
  type GeoReportSuccessEnvelope,
  type GeoSample,
  type GeoSampleState,
} from "./geo-report-contract.ts";

const TARGET_HOST = "acme.test";
const SAMPLED_AT = "2026-08-17T09:00:00.000Z";
const EXPIRES_AT = "2026-08-24T09:00:00.000Z";

const ADMISSIBLE = new Set<GeoSampleState>([
  "cited",
  "mentioned",
  "cited_others_only",
  "answer_had_no_citations",
]);

/**
 * Build one sample whose fields agree with its state.
 *
 * The hosts are derived from the state rather than passed in, because every
 * inconsistent combination is something the guard is supposed to reject — a
 * fixture helper that could produce one would make the happy-path tests
 * accidentally assert the opposite of what they claim.
 */
function sample(sampleIndex: number, state: GeoSampleState): GeoSample {
  const citedHosts =
    state === "cited"
      ? [TARGET_HOST, "rival.test"]
      : state === "cited_others_only"
        ? ["rival.test", "other.test"]
        : state === "mentioned"
          ? ["rival.test"]
          : [];
  return {
    sampleIndex,
    state,
    observedAt: state === "unavailable" ? null : SAMPLED_AT,
    webSearchPerformed:
      state !== "unavailable" && state !== "search_not_performed",
    citedHosts,
    competitorHosts: citedHosts.filter((host) => host === "rival.test"),
    limitation:
      state === "unavailable" ? "The provider returned no answer." : null,
  };
}

/** Build a question whose aggregate is recomputed from its sample states. */
function question(
  questionId: string,
  states: readonly GeoSampleState[],
): GeoQuestionObservation {
  const samples = states.map((state, index) => sample(index + 1, state));
  const admissibleSamples = samples.filter((s) =>
    ADMISSIBLE.has(s.state),
  ).length;
  const targetCitedIn = samples.filter((s) => s.state === "cited").length;
  return {
    questionId,
    question: `Which tools show whether my brand appears in AI answers? (${questionId})`,
    samples,
    aggregate: {
      admissibleSamples,
      targetCitedIn,
      targetMentionedIn: samples.filter((s) => s.state === "mentioned").length,
      verdict: geoQuestionVerdict(admissibleSamples, targetCitedIn),
    },
  };
}

/** Build a full envelope whose coverage is recomputed from its questions. */
function report(
  questions: readonly GeoQuestionObservation[],
): GeoReportSuccessEnvelope {
  const samples = questions.flatMap((q) => q.samples);
  const samplesObserved = samples.filter((s) => ADMISSIBLE.has(s.state)).length;
  return {
    data: {
      run: {
        agent: "geo",
        mode: "authenticated_agent",
        persistence: "expiring",
        schemaVersion: AGENT_GEO_REPORT_SCHEMA_VERSION,
        sampledAt: SAMPLED_AT,
        expiresAt: EXPIRES_AT,
        targetHost: TARGET_HOST,
        provider: {
          tool: "dataforseo_chat_gpt_llm_responses",
          model: "gpt-5-2025-08-07",
          marketCode: "US",
          languageCode: "en",
          samplesPerQuestion: GEO_SAMPLES_PER_QUESTION,
          costUsd: 0.7712,
        },
      },
      coverage: {
        questionsRequested: questions.length,
        samplesAttempted: samples.length,
        samplesObserved,
        samplesSearchNotPerformed: samples.filter(
          (s) => s.state === "search_not_performed",
        ).length,
        samplesUnavailable: samples.filter((s) => s.state === "unavailable")
          .length,
        availability: geoCoverageAvailability(samples.length, samplesObserved),
      },
      questions,
    },
  };
}

/**
 * Fixture 1 — a complete run.
 *
 * Every sample is admissible, and the eight questions between them exercise
 * each verdict a complete run can produce, including the intermittent case
 * that calibration says is the most common real result.
 */
const COMPLETE_STATES: readonly (readonly GeoSampleState[])[] = [
  ["cited", "cited", "cited"],
  ["cited", "cited_others_only", "answer_had_no_citations"],
  ["cited", "mentioned", "cited_others_only"],
  ["cited_others_only", "cited_others_only", "cited_others_only"],
  ["answer_had_no_citations", "answer_had_no_citations", "mentioned"],
  ["mentioned", "mentioned", "mentioned"],
  ["answer_had_no_citations", "cited_others_only", "answer_had_no_citations"],
  ["cited", "cited", "mentioned"],
];

const completeReport = report(
  COMPLETE_STATES.map((states, index) => question(`q-${index + 1}`, states)),
);

/**
 * Fixture 2 — a partial run.
 *
 * Carries both non-counting states, and one question whose three samples are
 * all inadmissible so the inconclusive verdict has a case to prove.
 */
const partialReport = report([
  question("q-1", ["cited", "search_not_performed", "cited"]),
  question("q-2", ["cited_others_only", "unavailable", "mentioned"]),
  question("q-3", [
    "search_not_performed",
    "unavailable",
    "search_not_performed",
  ]),
  question("q-4", [
    "answer_had_no_citations",
    "answer_had_no_citations",
    "cited",
  ]),
]);

/** Fixture 3 — every sample failed. */
const unavailableReport = report([
  question("q-1", ["unavailable", "unavailable", "unavailable"]),
  question("q-2", ["unavailable", "unavailable", "unavailable"]),
]);

type Mutable = {
  data: {
    run: Record<string, unknown> & { provider: Record<string, unknown> };
    coverage: Record<string, unknown>;
    questions: Array<{
      questionId: string;
      question: string;
      samples: Array<Record<string, unknown>>;
      aggregate: Record<string, unknown>;
    }>;
  };
};

function mutate(base: GeoReportSuccessEnvelope): Mutable {
  return structuredClone(base) as unknown as Mutable;
}

describe("isGeoReportSuccessEnvelope", () => {
  it("accepts the complete run fixture", () => {
    expect(isGeoReportSuccessEnvelope(completeReport)).toBe(true);
    expect(completeReport.data.questions).toHaveLength(GEO_QUESTIONS_PER_RUN);
    expect(completeReport.data.coverage.samplesAttempted).toBe(24);
    expect(completeReport.data.coverage.samplesObserved).toBe(24);
    expect(completeReport.data.coverage.availability).toBe("available");
  });

  it("accepts the partial run fixture and keeps the excluded states out of the denominator", () => {
    expect(isGeoReportSuccessEnvelope(partialReport)).toBe(true);

    const { coverage } = partialReport.data;
    expect(coverage.samplesAttempted).toBe(12);
    expect(coverage.samplesSearchNotPerformed).toBe(3);
    expect(coverage.samplesUnavailable).toBe(2);
    expect(coverage.samplesObserved).toBe(7);
    expect(
      coverage.samplesObserved +
        coverage.samplesSearchNotPerformed +
        coverage.samplesUnavailable,
    ).toBe(coverage.samplesAttempted);
    expect(coverage.availability).toBe("partial");
  });

  it("accepts the unavailable run fixture", () => {
    expect(isGeoReportSuccessEnvelope(unavailableReport)).toBe(true);
    expect(unavailableReport.data.coverage.samplesObserved).toBe(0);
    expect(unavailableReport.data.coverage.availability).toBe("unavailable");
  });

  it("reports a question with no admissible sample as inconclusive, never as not observed", () => {
    const allInadmissible = partialReport.data.questions[2]!;

    expect(allInadmissible.aggregate.admissibleSamples).toBe(0);
    expect(allInadmissible.aggregate.verdict).toBe("inconclusive");
    expect(allInadmissible.aggregate.verdict).not.toBe("not_observed");
  });

  it.each([
    ["stable_cited", 0],
    ["intermittent", 1],
    ["not_observed", 3],
  ] as const)("derives the %s verdict from the samples", (verdict, index) => {
    expect(completeReport.data.questions[index]!.aggregate.verdict).toBe(
      verdict,
    );
  });

  it("treats an answer that cited nobody as observed, not as unavailable", () => {
    const noCitations = completeReport.data.questions[6]!;

    expect(noCitations.aggregate.admissibleSamples).toBe(
      GEO_SAMPLES_PER_QUESTION,
    );
    expect(noCitations.aggregate.targetCitedIn).toBe(0);
    expect(noCitations.aggregate.verdict).toBe("not_observed");
  });

  it.each([
    ["admissibleSamples", "admissibleSamples"],
    ["targetCitedIn", "targetCitedIn"],
    ["targetMentionedIn", "targetMentionedIn"],
  ] as const)("rejects an inflated %s", (_label, key) => {
    const malformed = mutate(completeReport);
    const aggregate = malformed.data.questions[0]!.aggregate;
    aggregate[key] = (aggregate[key] as number) + 1;

    expect(isGeoReportSuccessEnvelope(malformed)).toBe(false);
  });

  it("rejects a verdict the counts do not support", () => {
    const malformed = mutate(completeReport);
    malformed.data.questions[1]!.aggregate.verdict = "stable_cited";

    expect(isGeoReportSuccessEnvelope(malformed)).toBe(false);
  });

  it("rejects coverage that counts an inadmissible sample as observed", () => {
    const malformed = mutate(partialReport);
    const { coverage } = malformed.data;
    coverage.samplesObserved = (coverage.samplesObserved as number) + 1;
    coverage.samplesUnavailable = (coverage.samplesUnavailable as number) - 1;

    expect(isGeoReportSuccessEnvelope(malformed)).toBe(false);
  });

  it("rejects coverage claiming availability the samples contradict", () => {
    const malformed = mutate(partialReport);
    malformed.data.coverage.availability = "available";

    expect(isGeoReportSuccessEnvelope(malformed)).toBe(false);
  });

  it.each([
    ["fewer", -1],
    ["more", 1],
  ] as const)("rejects a question with %s than three samples", (_label, d) => {
    const malformed = mutate(completeReport);
    const { samples } = malformed.data.questions[0]!;
    if (d < 0) samples.pop();
    else samples.push(structuredClone(samples[0]!));

    expect(isGeoReportSuccessEnvelope(malformed)).toBe(false);
  });

  it("rejects duplicate sample indexes", () => {
    const malformed = mutate(completeReport);
    const { samples } = malformed.data.questions[0]!;
    samples[1]!["sampleIndex"] = samples[0]!["sampleIndex"];

    expect(isGeoReportSuccessEnvelope(malformed)).toBe(false);
  });

  it("rejects duplicate question ids", () => {
    const malformed = mutate(completeReport);
    malformed.data.questions[1]!.questionId =
      malformed.data.questions[0]!.questionId;

    expect(isGeoReportSuccessEnvelope(malformed)).toBe(false);
  });

  it("rejects a cited sample whose citations do not include the target", () => {
    const malformed = mutate(completeReport);
    const target = malformed.data.questions[0]!.samples[0]!;
    target["citedHosts"] = ["rival.test"];
    target["competitorHosts"] = ["rival.test"];

    expect(isGeoReportSuccessEnvelope(malformed)).toBe(false);
  });

  it("rejects a cited_others_only sample that did cite the target", () => {
    const malformed = mutate(completeReport);
    const target = malformed.data.questions[3]!.samples[0]!;
    target["citedHosts"] = [TARGET_HOST, "rival.test"];

    expect(isGeoReportSuccessEnvelope(malformed)).toBe(false);
  });

  it("rejects an answer_had_no_citations sample that carries citations", () => {
    const malformed = mutate(completeReport);
    const target = malformed.data.questions[4]!.samples[0]!;
    target["citedHosts"] = ["rival.test"];

    expect(isGeoReportSuccessEnvelope(malformed)).toBe(false);
  });

  it("rejects a searched state that reports no search", () => {
    const malformed = mutate(completeReport);
    malformed.data.questions[0]!.samples[0]!["webSearchPerformed"] = false;

    expect(isGeoReportSuccessEnvelope(malformed)).toBe(false);
  });

  it("rejects a search_not_performed sample that claims a search ran", () => {
    const malformed = mutate(partialReport);
    malformed.data.questions[0]!.samples[1]!["webSearchPerformed"] = true;

    expect(isGeoReportSuccessEnvelope(malformed)).toBe(false);
  });

  it("rejects an unavailable sample that carries an observation time", () => {
    const malformed = mutate(unavailableReport);
    malformed.data.questions[0]!.samples[0]!["observedAt"] = SAMPLED_AT;

    expect(isGeoReportSuccessEnvelope(malformed)).toBe(false);
  });

  it("rejects an unavailable sample with no limitation", () => {
    const malformed = mutate(unavailableReport);
    malformed.data.questions[0]!.samples[0]!["limitation"] = null;

    expect(isGeoReportSuccessEnvelope(malformed)).toBe(false);
  });

  it("rejects a competitor host that was never cited", () => {
    const malformed = mutate(completeReport);
    malformed.data.questions[0]!.samples[0]!["competitorHosts"] = [
      "ghost.test",
    ];

    expect(isGeoReportSuccessEnvelope(malformed)).toBe(false);
  });

  it.each([
    ["uppercase", "Acme.test"],
    ["a www prefix", "www.acme.test"],
    ["a scheme", "https://acme.test"],
    ["a path", "acme.test/pricing"],
    ["a port", "acme.test:443"],
  ] as const)("rejects a cited host carrying %s", (_label, host) => {
    const malformed = mutate(completeReport);
    malformed.data.questions[0]!.samples[0]!["citedHosts"] = [
      TARGET_HOST,
      host,
    ];
    malformed.data.questions[0]!.samples[0]!["competitorHosts"] = [];

    expect(isGeoReportSuccessEnvelope(malformed)).toBe(false);
  });

  it("rejects an expiry that is not after the sampling instant", () => {
    const malformed = mutate(completeReport);
    malformed.data.run["expiresAt"] = SAMPLED_AT;

    expect(isGeoReportSuccessEnvelope(malformed)).toBe(false);
  });

  it("rejects a run that claims another agent's persistence", () => {
    const malformed = mutate(completeReport);
    malformed.data.run["persistence"] = "none";

    expect(isGeoReportSuccessEnvelope(malformed)).toBe(false);
  });

  it("rejects an unknown schema version", () => {
    const malformed = mutate(completeReport);
    malformed.data.run["schemaVersion"] = "agent_geo_report.v2";

    expect(isGeoReportSuccessEnvelope(malformed)).toBe(false);
  });

  it("rejects a provider sample count that contradicts the samples", () => {
    const malformed = mutate(completeReport);
    malformed.data.run.provider["samplesPerQuestion"] = 1;

    expect(isGeoReportSuccessEnvelope(malformed)).toBe(false);
  });

  it.each([
    ["run", "data.run"],
    ["sample", "sample"],
    ["aggregate", "aggregate"],
    ["coverage", "data.coverage"],
  ] as const)("rejects an unexpected key on the %s", (_label, where) => {
    const malformed = mutate(completeReport);
    const target =
      where === "data.run"
        ? malformed.data.run
        : where === "data.coverage"
          ? malformed.data.coverage
          : where === "aggregate"
            ? malformed.data.questions[0]!.aggregate
            : malformed.data.questions[0]!.samples[0]!;
    target["futureField"] = "surprise";

    expect(isGeoReportSuccessEnvelope(malformed)).toBe(false);
  });

  it("rejects a question longer than the provider accepts", () => {
    const malformed = mutate(completeReport);
    malformed.data.questions[0]!.question = "a".repeat(501);

    expect(isGeoReportSuccessEnvelope(malformed)).toBe(false);
  });

  it.each([null, undefined, 42, "report", [], { data: {} }])(
    "rejects the non-envelope %s",
    (value) => {
      expect(isGeoReportSuccessEnvelope(value)).toBe(false);
    },
  );
});

describe("geoQuestionVerdict", () => {
  it.each([
    [0, 0, "inconclusive"],
    [1, 0, "not_observed"],
    [3, 0, "not_observed"],
    [3, 1, "intermittent"],
    [3, 2, "intermittent"],
    [3, 3, "stable_cited"],
    [1, 1, "stable_cited"],
  ] as const)(
    "maps %i admissible and %i cited to %s",
    (admissible, cited, expected) => {
      expect(geoQuestionVerdict(admissible, cited)).toBe(expected);
    },
  );
});

describe("geoCoverageAvailability", () => {
  it.each([
    [24, 24, "available"],
    [24, 21, "partial"],
    [24, 0, "unavailable"],
    [0, 0, "unavailable"],
  ] as const)(
    "maps %i attempted and %i observed to %s",
    (attempted, observed, expected) => {
      expect(geoCoverageAvailability(attempted, observed)).toBe(expected);
    },
  );
});
