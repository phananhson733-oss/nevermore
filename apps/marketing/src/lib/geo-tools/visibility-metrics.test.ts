import { describe, expect, it } from "vitest";

import type { GeoQuestion } from "./kb-questions.ts";
import { describeProportion, twoProportionP, wilson } from "./stats.ts";
import type {
  VisibilityMetrics,
  VisibilityProportion,
  VisibilitySample,
} from "./visibility-contract.ts";
import {
  aggregateVisibility,
  compareVisibility,
  VISIBILITY_MAX_SAMPLE_URLS,
  type VisibilityAggregateOptions,
  type VisibilityComparisonSide,
} from "./visibility-metrics.ts";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function makeQuestion(
  id: string,
  overrides: Partial<GeoQuestion> = {},
): GeoQuestion {
  return {
    id,
    text: `question ${id}`,
    layer: "discovery",
    mode: "retrieval",
    roleId: null,
    requiredEntities: [],
    templateId: "geo.retrieval.category_top",
    calibrated: true,
    ...overrides,
  };
}

function makeSample(
  questionId: string,
  sampleIndex: number,
  overrides: Partial<VisibilitySample> = {},
): VisibilitySample {
  return {
    questionId,
    sampleIndex,
    status: "ok",
    webSearchPerformed: true,
    mentioned: false,
    cited: false,
    citedDomains: [],
    competitorsMentioned: [],
    excerpt: null,
    costUsd: 0.0457,
    observedAt: "2026-08-29T00:00:00.000Z",
    ...overrides,
  };
}

function makeOptions(
  overrides: Partial<VisibilityAggregateOptions> = {},
): VisibilityAggregateOptions {
  return { ownHost: "acme.test", samplesPerQuestion: 5, ...overrides };
}

function proportion(successes: number, trials: number): VisibilityProportion {
  const interval = wilson(successes, trials);
  return {
    successes,
    trials,
    point: interval.point,
    lo: interval.lo,
    hi: interval.hi,
  };
}

function makeMetrics(
  unpromptedMention: VisibilityProportion,
  citation: VisibilityProportion,
  questionsMentioned: VisibilityProportion,
): VisibilityMetrics {
  return {
    unpromptedMention,
    promptedMention: proportion(0, 0),
    citation,
    questionsMentioned,
    byLayer: [],
  };
}

function makeSide(
  runId: string,
  metrics: VisibilityMetrics,
  questions: VisibilityComparisonSide["questions"] = [],
): VisibilityComparisonSide {
  return {
    runId,
    finishedAt: "2026-08-29T12:00:00.000Z",
    metrics,
    questions,
  };
}

/* ------------------------------------------------------------------ */
/* Denominators                                                        */
/* ------------------------------------------------------------------ */

describe("aggregateVisibility denominators", () => {
  it("keeps branded mentions out of the unprompted rate", () => {
    const questions = [
      makeQuestion("q01"),
      makeQuestion("q02", { layer: "branded", mode: "demand", calibrated: false }),
    ];
    const samples = [
      makeSample("q01", 0),
      makeSample("q01", 1),
      makeSample("q02", 0, { mentioned: true }),
      makeSample("q02", 1, { mentioned: true }),
    ];

    const result = aggregateVisibility(
      questions,
      samples,
      makeOptions({ samplesPerQuestion: 2 }),
    );

    // The branded question mentions the brand twice; a rate that counted them
    // would read 2/4 for a site nobody found unprompted.
    expect(result.metrics.unpromptedMention.successes).toBe(0);
    expect(result.metrics.unpromptedMention.trials).toBe(2);
    expect(result.metrics.promptedMention.successes).toBe(2);
    expect(result.metrics.promptedMention.trials).toBe(2);
    // Same exclusion at the question level, and the denominator says so.
    expect(result.metrics.questionsMentioned.successes).toBe(0);
    expect(result.metrics.questionsMentioned.trials).toBe(1);
  });

  it("reports demand-mode citations without letting them into the citation rate", () => {
    const questions = [
      makeQuestion("q01"),
      makeQuestion("q02", { layer: "problem", mode: "demand", calibrated: false }),
    ];
    const samples = [
      makeSample("q01", 0, { cited: true, citedDomains: ["acme.test"] }),
      makeSample("q01", 1),
      makeSample("q02", 0, { cited: true, citedDomains: ["acme.test"] }),
      makeSample("q02", 1, { cited: true, citedDomains: ["acme.test"] }),
    ];

    const result = aggregateVisibility(
      questions,
      samples,
      makeOptions({ samplesPerQuestion: 2 }),
    );

    expect(result.metrics.citation.successes).toBe(1);
    expect(result.metrics.citation.trials).toBe(2);
    // The count itself is not thrown away: it is reported beside the wording.
    const demand = result.questions[1];
    expect(demand?.cited).toBe(2);
    expect(demand?.citationEvaluable).toBe(2);
  });

  it("counts an unsearched answer as a mention trial and not as a citation trial", () => {
    const questions = [makeQuestion("q01")];
    const samples = [
      makeSample("q01", 0, {
        mentioned: true,
        cited: true,
        citedDomains: ["acme.test"],
      }),
      makeSample("q01", 1),
      makeSample("q01", 2, { webSearchPerformed: false, mentioned: true }),
      makeSample("q01", 3, { webSearchPerformed: null, mentioned: true }),
    ];

    const result = aggregateVisibility(
      questions,
      samples,
      makeOptions({ samplesPerQuestion: 4 }),
    );

    expect(result.metrics.unpromptedMention.successes).toBe(3);
    expect(result.metrics.unpromptedMention.trials).toBe(4);
    expect(result.metrics.citation.successes).toBe(1);
    expect(result.metrics.citation.trials).toBe(2);
  });

  it("ignores links reported beside webSearchPerformed false", () => {
    const questions = [makeQuestion("q01")];
    const samples = [
      makeSample("q01", 0, {
        webSearchPerformed: false,
        cited: true,
        citedDomains: ["acme.test"],
      }),
      makeSample("q01", 1, {
        webSearchPerformed: false,
        cited: true,
        citedDomains: ["acme.test"],
      }),
    ];

    // Counting these would push successes past trials and make Wilson throw.
    const result = aggregateVisibility(
      questions,
      samples,
      makeOptions({ samplesPerQuestion: 2 }),
    );

    expect(result.questions[0]?.citationEvaluable).toBe(0);
    expect(result.questions[0]?.cited).toBe(0);
    expect(result.metrics.citation.trials).toBe(0);
    expect(result.metrics.citation.point).toBeNull();
    // The answers still pointed at the site, and the table still says so.
    expect(result.citedDomains[0]).toMatchObject({
      domain: "acme.test",
      answers: 2,
      isOwn: true,
    });
  });

  it("does not let a failed sample count as a miss", () => {
    const questions = [makeQuestion("q01")];
    const samples = [
      makeSample("q01", 0, { mentioned: true }),
      makeSample("q01", 1, {
        status: "timeout",
        webSearchPerformed: null,
        costUsd: null,
        observedAt: null,
      }),
    ];

    const result = aggregateVisibility(
      questions,
      samples,
      makeOptions({ samplesPerQuestion: 2 }),
    );

    expect(result.metrics.unpromptedMention.successes).toBe(1);
    expect(result.metrics.unpromptedMention.trials).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* The zero claim                                                      */
/* ------------------------------------------------------------------ */

describe("aggregateVisibility zero claim", () => {
  it("calls seven questions at five samples unobserved rather than 0.0%", () => {
    const questions = Array.from({ length: 7 }, (_unused, index) =>
      makeQuestion(`q0${index + 1}`),
    );
    const samples = questions.flatMap((question) =>
      Array.from({ length: 5 }, (_unused, index) =>
        makeSample(question.id, index),
      ),
    );

    const result = aggregateVisibility(questions, samples, makeOptions());

    // Pooled over samples the run clears the n >= 35 bar and would print 0.0%,
    // which is exactly why the question-level projection exists: the same
    // observation, counted in questions, is seven trials and not a conclusion.
    expect(result.metrics.unpromptedMention.trials).toBe(35);
    expect(describeProportion(wilson(0, 35)).kind).toBe("zero");

    expect(result.metrics.questionsMentioned.trials).toBe(7);
    const described = describeProportion(
      wilson(
        result.metrics.questionsMentioned.successes,
        result.metrics.questionsMentioned.trials,
      ),
    );
    expect(described.kind).toBe("unobserved");
    expect(result.status).toBe("ok");
  });

  it("reports no trials as unavailable rather than zero", () => {
    const result = aggregateVisibility([], [], makeOptions());

    expect(result.metrics.unpromptedMention.point).toBeNull();
    expect(describeProportion(wilson(0, 0)).kind).toBe("unavailable");
    expect(result.citedDomains).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Success ratio and status                                            */
/* ------------------------------------------------------------------ */

describe("aggregateVisibility success ratio", () => {
  const twoQuestions = [makeQuestion("q01"), makeQuestion("q02")];

  it("divides answered samples by the calls the run planned", () => {
    const samples = [
      makeSample("q01", 0),
      makeSample("q01", 1),
      makeSample("q02", 0),
      makeSample("q02", 1),
    ];

    const result = aggregateVisibility(
      twoQuestions,
      samples,
      makeOptions({ samplesPerQuestion: 2 }),
    );

    expect(result.answered).toBe(4);
    expect(result.calls).toBe(4);
    expect(result.successRatio).toBe(1);
    expect(result.status).toBe("ok");
  });

  it("counts a sample the run never made against the ratio", () => {
    const samples = [
      makeSample("q01", 0),
      makeSample("q01", 1),
      makeSample("q02", 0),
    ];

    const result = aggregateVisibility(
      twoQuestions,
      samples,
      makeOptions({ samplesPerQuestion: 2 }),
    );

    expect(result.calls).toBe(4);
    expect(result.successRatio).toBe(0.75);
    expect(result.status).toBe("partial");
  });

  it("draws no conclusions below the minimum success ratio", () => {
    const samples = [
      makeSample("q01", 0),
      makeSample("q01", 1, { status: "error", webSearchPerformed: null }),
      makeSample("q02", 0, { status: "blocked", webSearchPerformed: null }),
      makeSample("q02", 1),
    ];

    const result = aggregateVisibility(
      twoQuestions,
      samples,
      makeOptions({ samplesPerQuestion: 2 }),
    );

    expect(result.successRatio).toBe(0.5);
    expect(result.status).toBe("insufficient");
  });

  it("lets a sample carrying an unknown question id drag the ratio down", () => {
    const samples = [
      makeSample("q01", 0),
      makeSample("q01", 1),
      makeSample("q02", 0),
      makeSample("q02", 1),
      makeSample("q99-not-in-the-set", 0),
      makeSample("q99-not-in-the-set", 1),
    ];

    const result = aggregateVisibility(
      twoQuestions,
      samples,
      makeOptions({ samplesPerQuestion: 2 }),
    );

    // A mislabelled id must make a run look worse than it was, never better.
    expect(result.answered).toBe(4);
    expect(result.calls).toBe(6);
    expect(result.successRatio).toBeCloseTo(0.6667, 4);
    expect(result.status).toBe("insufficient");
  });

  it("does not report a ratio above one when a question was sampled deeper", () => {
    const samples = [
      makeSample("q01", 0),
      makeSample("q01", 1),
      makeSample("q01", 2),
      makeSample("q02", 0),
      makeSample("q02", 1),
    ];

    const result = aggregateVisibility(
      twoQuestions,
      samples,
      makeOptions({ samplesPerQuestion: 2 }),
    );

    expect(result.calls).toBe(5);
    expect(result.successRatio).toBe(1);
  });

  it("is partial when an engine returned nothing at all", () => {
    const samples = [
      makeSample("q01", 0),
      makeSample("q01", 1),
      makeSample("q02", 0),
      makeSample("q02", 1),
    ];

    const result = aggregateVisibility(
      twoQuestions,
      samples,
      makeOptions({ samplesPerQuestion: 2, engineFailures: ["perplexity"] }),
    );

    expect(result.successRatio).toBe(1);
    expect(result.status).toBe("partial");
  });

  it("refuses a nonsense sample plan", () => {
    expect(() =>
      aggregateVisibility([], [], makeOptions({ samplesPerQuestion: 2.5 })),
    ).toThrow(RangeError);
  });
});

/* ------------------------------------------------------------------ */
/* Cited domains                                                       */
/* ------------------------------------------------------------------ */

describe("aggregateVisibility cited domains", () => {
  const questions = [makeQuestion("q01"), makeQuestion("q02")];

  it("ranks by answers, marks the site and confirmed rivals, and caps links", () => {
    const samples = [
      makeSample("q01", 0, {
        cited: true,
        citedDomains: ["zeta.test", "rival.test", "alpha.test", "acme.test"],
      }),
      makeSample("q01", 1, {
        cited: true,
        citedDomains: ["zeta.test", "rival.test", "alpha.test"],
      }),
      makeSample("q02", 0, {
        cited: true,
        citedDomains: ["zeta.test", "rival.test", "alpha.test", "other.test"],
      }),
    ];

    const result = aggregateVisibility(
      questions,
      samples,
      makeOptions({
        samplesPerQuestion: 2,
        competitors: [
          { domain: "rival.test", brandName: "Rival", confirmed: true },
          { domain: "other.test", brandName: "", confirmed: false },
        ],
        citationUrls: [
          "https://rival.test/a",
          "https://rival.test/a",
          "https://rival.test/b",
          "https://rival.test/c",
          "https://rival.test/d",
        ],
      }),
    );

    expect(result.citedDomains.map((entry) => entry.domain)).toEqual([
      "alpha.test",
      "rival.test",
      "zeta.test",
      "acme.test",
      "other.test",
    ]);
    expect(result.citedDomains[1]).toMatchObject({
      domain: "rival.test",
      answers: 3,
      isOwn: false,
      isCompetitor: true,
    });
    expect(result.citedDomains[1]?.sampleUrls).toEqual([
      "https://rival.test/a",
      "https://rival.test/b",
      "https://rival.test/c",
    ]);
    expect(result.citedDomains[1]?.sampleUrls.length).toBe(
      VISIBILITY_MAX_SAMPLE_URLS,
    );
    expect(result.citedDomains[3]).toMatchObject({
      domain: "acme.test",
      answers: 1,
      isOwn: true,
      isCompetitor: false,
    });
    // An unconfirmed competitor is a guess, not a rival.
    expect(result.citedDomains[4]).toMatchObject({
      domain: "other.test",
      isCompetitor: false,
      sampleUrls: [],
    });
  });

  it("counts an answer once per domain and skips answers that never arrived", () => {
    const samples = [
      makeSample("q01", 0, {
        cited: true,
        citedDomains: ["alpha.test", "alpha.test"],
      }),
      makeSample("q02", 0, {
        status: "timeout",
        webSearchPerformed: null,
        citedDomains: ["alpha.test"],
        costUsd: null,
        observedAt: null,
      }),
    ];

    const result = aggregateVisibility(
      questions,
      samples,
      makeOptions({ samplesPerQuestion: 1 }),
    );

    expect(result.citedDomains).toHaveLength(1);
    expect(result.citedDomains[0]?.answers).toBe(1);
  });

  it("does not label the site under test as its own competitor", () => {
    const samples = [
      makeSample("q01", 0, { cited: true, citedDomains: ["acme.test"] }),
    ];

    const result = aggregateVisibility(
      questions,
      samples,
      makeOptions({
        samplesPerQuestion: 1,
        competitors: [
          { domain: "https://www.acme.test/", brandName: "Acme", confirmed: true },
        ],
      }),
    );

    expect(result.citedDomains[0]).toMatchObject({
      isOwn: true,
      isCompetitor: false,
    });
  });
});

/* ------------------------------------------------------------------ */
/* Layers                                                              */
/* ------------------------------------------------------------------ */

describe("aggregateVisibility layers", () => {
  it("prints layers in a fixed order and cites only measured wording", () => {
    const questions = [
      makeQuestion("q01", { layer: "branded", mode: "demand", calibrated: false }),
      makeQuestion("q02", { layer: "problem", mode: "demand", calibrated: false }),
      makeQuestion("q03", { layer: "discovery" }),
      makeQuestion("q04", { layer: "discovery", mode: "demand", calibrated: false }),
    ];
    const samples = [
      makeSample("q01", 0, { mentioned: true }),
      makeSample("q02", 0, { cited: true, citedDomains: ["acme.test"] }),
      makeSample("q03", 0, { mentioned: true }),
      makeSample("q04", 0, { cited: true, citedDomains: ["acme.test"] }),
    ];

    const result = aggregateVisibility(
      questions,
      samples,
      makeOptions({ samplesPerQuestion: 1 }),
    );

    expect(result.metrics.byLayer.map((entry) => entry.layer)).toEqual([
      "problem",
      "discovery",
      "branded",
    ]);
    // The problem layer has no retrieval wording at all, so it has no citation
    // denominator - which is not the same as never being cited.
    expect(result.metrics.byLayer[0]?.citation.trials).toBe(0);
    expect(result.metrics.byLayer[0]?.citation.point).toBeNull();
    // The discovery layer holds one measured and one unmeasured question; only
    // the measured one carries a denominator.
    expect(result.metrics.byLayer[1]?.mention.trials).toBe(2);
    expect(result.metrics.byLayer[1]?.citation.trials).toBe(1);
    expect(result.metrics.byLayer[1]?.citation.successes).toBe(0);
  });

  it("orders samples by sample index rather than arrival", () => {
    const questions = [makeQuestion("q01")];
    const samples = [
      makeSample("q01", 2),
      makeSample("q01", 0),
      makeSample("q01", 1),
    ];

    const result = aggregateVisibility(
      questions,
      samples,
      makeOptions({ samplesPerQuestion: 3 }),
    );

    expect(result.questions[0]?.samples.map((entry) => entry.sampleIndex)).toEqual(
      [0, 1, 2],
    );
  });
});

/* ------------------------------------------------------------------ */
/* Run over run                                                        */
/* ------------------------------------------------------------------ */

describe("compareVisibility", () => {
  it("refuses to call a change significant while the interval crosses zero", () => {
    const base = makeSide(
      "run-base",
      makeMetrics(proportion(10, 30), proportion(0, 0), proportion(0, 7)),
    );
    const current = makeSide(
      "run-current",
      makeMetrics(proportion(17, 30), proportion(0, 0), proportion(0, 7)),
    );

    const comparison = compareVisibility(base, current);
    const unprompted = comparison.aggregates[0];

    // The test on its own rejects at q = 0.10; the difference interval does not
    // exclude zero, and the page would otherwise print "significant" beside an
    // interval that contains no change at all.
    expect(twoProportionP(10, 30, 17, 30)).toBeLessThan(0.1);
    expect(unprompted?.metric).toBe("unpromptedMention");
    expect(unprompted?.testable).toBe(true);
    expect(unprompted?.lo).toBeLessThan(0);
    expect(unprompted?.hi).toBeGreaterThan(0);
    expect(unprompted?.changed).toBe(false);
  });

  it("calls a change a change when both halves agree", () => {
    const base = makeSide(
      "run-base",
      makeMetrics(proportion(10, 30), proportion(0, 0), proportion(0, 7)),
    );
    const current = makeSide(
      "run-current",
      makeMetrics(proportion(19, 30), proportion(0, 0), proportion(0, 7)),
    );

    const comparison = compareVisibility(base, current);

    expect(comparison.aggregates[0]?.changed).toBe(true);
    expect(comparison.aggregates[0]?.diff).toBeCloseTo(0.3, 6);
    expect(comparison.baseRunId).toBe("run-base");
    expect(comparison.baseFinishedAt).toBe("2026-08-29T12:00:00.000Z");
  });

  it("leaves an untestable aggregate untested without spending its neighbour's power", () => {
    const base = makeSide(
      "run-base",
      makeMetrics(proportion(1, 5), proportion(10, 40), proportion(0, 7)),
    );
    const current = makeSide(
      "run-current",
      makeMetrics(proportion(4, 5), proportion(30, 40), proportion(0, 7)),
    );

    const comparison = compareVisibility(base, current);

    expect(comparison.aggregates.map((entry) => entry.metric)).toEqual([
      "unpromptedMention",
      "citation",
      "questionsMentioned",
    ]);
    expect(comparison.aggregates[0]?.testable).toBe(false);
    expect(comparison.aggregates[0]?.changed).toBe(false);
    // The rejection has to land on the hypothesis it was computed for.
    expect(comparison.aggregates[1]?.testable).toBe(true);
    expect(comparison.aggregates[1]?.changed).toBe(true);
    expect(comparison.aggregates[2]?.testable).toBe(false);
    expect(comparison.aggregates[2]?.changed).toBe(false);
  });

  it("reports a direction per question only when the count moved", () => {
    const metrics = makeMetrics(
      proportion(0, 10),
      proportion(0, 0),
      proportion(0, 2),
    );
    const base = makeSide("run-base", metrics, [
      { questionId: "q01", text: "unchanged", answered: 5, mentioned: 2 },
      { questionId: "q02", text: "gained", answered: 5, mentioned: 1 },
      { questionId: "q03", text: "lost", answered: 5, mentioned: 4 },
      { questionId: "q04", text: "different denominator", answered: 5, mentioned: 3 },
      { questionId: "q05", text: "nothing answered", answered: 0, mentioned: 0 },
    ]);
    const current = makeSide("run-current", metrics, [
      { questionId: "q01", text: "unchanged", answered: 5, mentioned: 2 },
      { questionId: "q02", text: "gained", answered: 5, mentioned: 4 },
      { questionId: "q03", text: "lost", answered: 5, mentioned: 0 },
      { questionId: "q04", text: "different denominator", answered: 3, mentioned: 2 },
      { questionId: "q05", text: "nothing answered", answered: 0, mentioned: 0 },
      { questionId: "q06", text: "new question", answered: 5, mentioned: 5 },
    ]);

    const comparison = compareVisibility(base, current);

    // q01 did not move, q04's denominator did (3 of 3 is a higher rate than 3
    // of 5 and would have been printed as a loss), q05 has nothing to compare
    // and q06 has no baseline.
    expect(comparison.questions).toEqual([
      {
        questionId: "q02",
        text: "gained",
        baseMentioned: 1,
        currentMentioned: 4,
        of: 5,
        direction: "gained",
      },
      {
        questionId: "q03",
        text: "lost",
        baseMentioned: 4,
        currentMentioned: 0,
        of: 5,
        direction: "lost",
      },
    ]);
  });

  it("consumes the aggregate proportions it was handed", () => {
    const base = makeSide(
      "run-base",
      makeMetrics(proportion(3, 40), proportion(1, 35), proportion(2, 8)),
    );
    const current = makeSide(
      "run-current",
      makeMetrics(proportion(4, 40), proportion(2, 35), proportion(3, 8)),
    );

    const comparison = compareVisibility(base, current);

    expect(comparison.aggregates[0]?.base).toEqual(proportion(3, 40));
    expect(comparison.aggregates[0]?.current).toEqual(proportion(4, 40));
    expect(comparison.aggregates[1]?.base.trials).toBe(35);
    expect(comparison.aggregates[2]?.testable).toBe(false);
  });
});
