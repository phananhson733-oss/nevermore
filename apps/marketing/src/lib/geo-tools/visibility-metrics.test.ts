import { describe, expect, it } from "vitest";

import type { GeoQuestion } from "./kb-questions.ts";
import { describeProportion, wilson } from "./stats.ts";
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
    citedUrls: [],
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
  return {
    ownHost: "acme.test",
    samplesPerQuestion: 5,
    brandNames: ["Acme"],
    ...overrides,
  };
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
  questionsCited: VisibilityProportion = proportion(0, 0),
): VisibilityMetrics {
  return {
    unpromptedMention,
    promptedMention: proportion(0, 0),
    citation,
    questionsMentioned,
    questionsCited,
    questionsAsked: questionsMentioned.trials,
    questionsAnswered: questionsMentioned.trials,
    byLayer: [],
  };
}

function comparisonQuestion(
  questionId: string,
  answered: number,
  mentioned: number,
  overrides: Partial<VisibilityComparisonSide["questions"][number]> = {},
): VisibilityComparisonSide["questions"][number] {
  return {
    questionId,
    text: `question ${questionId}`,
    prompted: false,
    mode: "retrieval",
    answered,
    mentioned,
    citationEvaluable: answered,
    cited: 0,
    ...overrides,
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
      makeQuestion("q02", {
        text: "Is Acme a good choice for small teams?",
        layer: "branded",
        mode: "demand",
        calibrated: false,
      }),
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

  it("treats any question that names the brand as prompted, whatever its layer", () => {
    // The layer says what stage of a search a question belongs to. Whether the
    // brand is already in the words is a different property, and a comparison
    // question written this way is exactly as circular as a branded one.
    const questions = [
      makeQuestion("q01", { text: "best project tools for small teams" }),
      makeQuestion("q02", {
        text: "How does Acme compare to the alternatives?",
        layer: "comparison",
      }),
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

    expect(result.questions[1]?.prompted).toBe(true);
    expect(result.metrics.unpromptedMention.successes).toBe(0);
    expect(result.metrics.unpromptedMention.trials).toBe(2);
    expect(result.metrics.promptedMention.successes).toBe(2);
  });

  it("keeps a mention whose citation list would not parse", () => {
    // One unreadable citation list used to rewrite the whole sample into an
    // error, which removed a real, brand-mentioning answer from the mention
    // denominator as well: a true 1 of 5 was published as 0 of 4.
    const questions = [makeQuestion("q01")];
    const samples = [
      makeSample("q01", 0, { mentioned: true, cited: null }),
      makeSample("q01", 1),
      makeSample("q01", 2),
      makeSample("q01", 3),
      makeSample("q01", 4),
    ];

    const result = aggregateVisibility(questions, samples, makeOptions());

    expect(result.metrics.unpromptedMention.successes).toBe(1);
    expect(result.metrics.unpromptedMention.trials).toBe(5);
    // The unreadable one is in neither citation bucket, and is counted where a
    // reader can see how much of the rate is missing.
    expect(result.questions[0]?.citationEvaluable).toBe(4);
    expect(result.questions[0]?.citationUnknown).toBe(1);
  });

  it("refuses to certify a run whose samples do not fill the plan", () => {
    // Six answered samples against a plan of six, every one of them succeeding.
    // Comparing totals says the plan was met and the run was perfect; four of
    // the six went to q01 and q02 was asked once. The slot check is what tells
    // those apart.
    const questions = [makeQuestion("q01"), makeQuestion("q02")];
    const samples = [
      makeSample("q01", 0),
      makeSample("q01", 1),
      makeSample("q01", 2),
      makeSample("q01", 3),
      makeSample("q02", 0),
      makeSample("q02", 1),
    ];

    const result = aggregateVisibility(
      questions,
      samples,
      makeOptions({ samplesPerQuestion: 3 }),
    );

    expect(result.successRatio).toBe(1);
    expect(result.status).toBe("partial");
  });

  it("drops a repeated slot instead of counting one question twice", () => {
    // A replayed step or a storage misalignment can deliver the same
    // (question, sample) twice. Counted, it inflates that question's evidence
    // and hides the sample that never arrived.
    const questions = [makeQuestion("q01")];
    const samples = [
      makeSample("q01", 0, { mentioned: true }),
      makeSample("q01", 0, { mentioned: true }),
      makeSample("q01", 1),
    ];

    const result = aggregateVisibility(
      questions,
      samples,
      makeOptions({ samplesPerQuestion: 2 }),
    );

    expect(result.questions[0]?.answered).toBe(2);
    expect(result.questions[0]?.mentioned).toBe(1);
    // The duplicate still counts against the run: three records arrived and two
    // could be placed, so the ratio falls below the conclusion threshold. A
    // record that cannot be trusted should suppress conclusions rather than be
    // quietly forgiven - the alternative is a report that looks complete and
    // was built on a question asked twice.
    expect(result.status).toBe("insufficient");
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

/* ------------------------------------------------------------------ */
/* Run over run                                                        */
/* ------------------------------------------------------------------ */

function pairedSide(
  runId: string,
  entries: readonly (readonly [string, number, number])[],
  overrides: Partial<VisibilityComparisonSide["questions"][number]> = {},
): VisibilityComparisonSide {
  return makeSide(
    runId,
    makeMetrics(proportion(0, 0), proportion(0, 0), proportion(0, 0)),
    entries.map(([id, answered, mentioned]) =>
      comparisonQuestion(id, answered, mentioned, overrides),
    ),
  );
}

describe("compareVisibility", () => {
  it("counts the paired unit, not the repeated samples", () => {
    // Six questions, five samples each. Five of the six moved the same way.
    // Pooled over samples this is 5/30 against 25/30 and z-tests at p ~ 2e-7;
    // paired it is five discordant questions, which exact McNemar puts at
    // 0.0625 and refuses to call a change. The pooled number is not a stronger
    // result, it is one result counted five times.
    const ids = ["q1", "q2", "q3", "q4", "q5", "q6"] as const;
    const base = pairedSide(
      "run-base",
      ids.map((id, index) => [id, 5, index === 0 ? 5 : 0] as const),
    );
    const current = pairedSide(
      "run-current",
      ids.map((id, index) => [id, 5, index <= 4 ? 5 : 0] as const),
    );

    const mention = compareVisibility(base, current).aggregates.find(
      (entry) => entry.metric === "questionsMentioned",
    );

    expect(mention?.gained).toBe(4);
    expect(mention?.lost).toBe(0);
    expect(mention?.pairs).toBe(6);
    // Six pairs is below the floor, so no verdict is offered at all.
    expect(mention?.testable).toBe(false);
    expect(mention?.changed).toBe(false);
  });

  it("calls a one-directional move a change once there are enough questions", () => {
    const ids = Array.from({ length: 14 }, (_, index) => `q${index + 1}`);
    const base = pairedSide(
      "run-base",
      ids.map((id) => [id, 5, 0] as const),
    );
    const current = pairedSide(
      "run-current",
      ids.map((id, index) => [id, 5, index < 8 ? 4 : 0] as const),
    );

    const mention = compareVisibility(base, current).aggregates.find(
      (entry) => entry.metric === "questionsMentioned",
    );

    expect(mention?.pairs).toBe(14);
    expect(mention?.gained).toBe(8);
    expect(mention?.lost).toBe(0);
    expect(mention?.testable).toBe(true);
    expect(mention?.changed).toBe(true);
    // The interval is on the share of moved questions that improved, so it
    // sits above an even split rather than above zero.
    expect(mention?.lo).not.toBeNull();
    expect(mention!.lo!).toBeGreaterThan(0.5);
  });

  it("refuses a verdict when the moves cancel out", () => {
    const ids = Array.from({ length: 14 }, (_, index) => `q${index + 1}`);
    const base = pairedSide(
      "run-base",
      ids.map((id, index) => [id, 5, index < 7 ? 0 : 3] as const),
    );
    const current = pairedSide(
      "run-current",
      ids.map((id, index) => [id, 5, index < 7 ? 3 : 0] as const),
    );

    const mention = compareVisibility(base, current).aggregates.find(
      (entry) => entry.metric === "questionsMentioned",
    );

    expect(mention?.gained).toBe(7);
    expect(mention?.lost).toBe(7);
    expect(mention?.testable).toBe(true);
    expect(mention?.changed).toBe(false);
  });

  it("leaves prompted questions out of the mention comparison", () => {
    const ids = Array.from({ length: 12 }, (_, index) => `q${index + 1}`);
    const base = pairedSide(
      "run-base",
      ids.map((id) => [id, 5, 0] as const),
      { prompted: true },
    );
    const current = pairedSide(
      "run-current",
      ids.map((id) => [id, 5, 5] as const),
      { prompted: true },
    );

    const mention = compareVisibility(base, current).aggregates.find(
      (entry) => entry.metric === "questionsMentioned",
    );

    // Every question names the brand, so there is nothing to compare and no
    // verdict - not a twelve-question improvement.
    expect(mention?.pairs).toBe(0);
    expect(mention?.testable).toBe(false);
    expect(mention?.changed).toBe(false);
  });

  it("compares citations only over demand-free wording that could cite", () => {
    const ids = Array.from({ length: 12 }, (_, index) => `q${index + 1}`);
    const base = makeSide(
      "run-base",
      makeMetrics(proportion(0, 0), proportion(0, 0), proportion(0, 0)),
      ids.map((id, index) =>
        comparisonQuestion(id, 5, 0, {
          mode: index < 6 ? "retrieval" : "demand",
          citationEvaluable: 5,
          cited: 0,
        }),
      ),
    );
    const current = makeSide(
      "run-current",
      makeMetrics(proportion(0, 0), proportion(0, 0), proportion(0, 0)),
      ids.map((id, index) =>
        comparisonQuestion(id, 5, 0, {
          mode: index < 6 ? "retrieval" : "demand",
          citationEvaluable: 5,
          cited: 3,
        }),
      ),
    );

    const citation = compareVisibility(base, current).aggregates.find(
      (entry) => entry.metric === "questionsCited",
    );

    // Six retrieval questions moved; the six demand ones are reported but never
    // enter a citation denominator, and the floor of ten pairs is not met.
    expect(citation?.pairs).toBe(6);
    expect(citation?.gained).toBe(6);
    expect(citation?.testable).toBe(false);
  });

  it("reports a direction per question only when the count moved", () => {
    const metrics = makeMetrics(
      proportion(0, 10),
      proportion(0, 0),
      proportion(0, 2),
    );
    const base = makeSide("run-base", metrics, [
      comparisonQuestion("q01", 5, 2, { text: "unchanged" }),
      comparisonQuestion("q02", 5, 1, { text: "gained" }),
      comparisonQuestion("q03", 5, 4, { text: "lost" }),
      comparisonQuestion("q04", 5, 3, { text: "different denominator" }),
      comparisonQuestion("q05", 0, 0, { text: "nothing answered" }),
    ]);
    const current = makeSide("run-current", metrics, [
      comparisonQuestion("q01", 5, 2, { text: "unchanged" }),
      comparisonQuestion("q02", 5, 4, { text: "gained" }),
      comparisonQuestion("q03", 5, 0, { text: "lost" }),
      comparisonQuestion("q04", 3, 2, { text: "different denominator" }),
      comparisonQuestion("q05", 0, 0, { text: "nothing answered" }),
      comparisonQuestion("q06", 5, 5, { text: "new question" }),
    ]);

    const comparison = compareVisibility(base, current);

    // q01 did not move, q04's denominator did (2 of 3 is a higher rate than 3
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

  it("carries both runs' headline proportions through untouched", () => {
    const base = makeSide(
      "run-base",
      makeMetrics(proportion(3, 40), proportion(1, 35), proportion(2, 8)),
    );
    const current = makeSide(
      "run-current",
      makeMetrics(proportion(9, 40), proportion(4, 35), proportion(5, 8)),
    );

    const mention = compareVisibility(base, current).aggregates.find(
      (entry) => entry.metric === "questionsMentioned",
    );

    expect(mention?.base).toEqual(proportion(2, 8));
    expect(mention?.current).toEqual(proportion(5, 8));
    // No paired questions were supplied, so there is a difference to print and
    // no verdict to draw from it.
    expect(mention?.diff).toBeCloseTo(5 / 8 - 2 / 8, 12);
    expect(mention?.testable).toBe(false);
    expect(mention?.changed).toBe(false);
  });

  it("names the baseline it compared against", () => {
    const comparison = compareVisibility(
      pairedSide("run-base", [["q1", 5, 1]]),
      pairedSide("run-current", [["q1", 5, 1]]),
    );
    expect(comparison.baseRunId).toBe("run-base");
    expect(comparison.baseFinishedAt).toBe("2026-08-29T12:00:00.000Z");
  });
});
