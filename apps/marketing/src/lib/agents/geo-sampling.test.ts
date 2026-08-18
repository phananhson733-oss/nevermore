// @input  -- scripted provider answers, transport failures, and a controlled budget
// @output -- proof the five observation dimensions stay independent and honest
// @pos    -- focused tests for the step that turns answers into reportable evidence

import { describe, expect, it, vi } from "vitest";

import type { GeoConfirmedAliasV1 } from "./geo-context.ts";
import {
  GeoProviderError,
  type GeoProviderCitationAnnotation,
  type GeoProviderClient,
  type GeoProviderObservation,
} from "./geo-provider.ts";
import type { GeoQueryUnitV1 } from "./geo-query-contract.ts";
import { deriveGeoSampleCounts } from "./geo-report-derive.ts";
import type { GeoCitationEvidenceRefV1 } from "./geo-report-contract.ts";
import {
  assembleQuestion,
  buildGeoExecutionPlan,
  collectGeoSamples,
  deriveProbeStatus,
  observeToSample,
  unavailableSample,
  GEO_MIN_BUDGET_FOR_CALL_MS,
  type GeoExecutionSlot,
  type GeoSamplingContext,
} from "./geo-sampling.ts";

const ALIASES: readonly GeoConfirmedAliasV1[] = [
  { alias: "Acme Analytics", source: "profile_product_name" },
  { alias: "Acme", source: "host_label" },
];

const CONTEXT: GeoSamplingContext = {
  targetHost: "acme.test",
  brandAliases: ALIASES,
  aliasScope: "supported",
};

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

function natural(overrides: Partial<GeoQueryUnitV1> = {}): GeoQueryUnitV1 {
  return probe({
    queryId: "core-brand_comparison",
    slot: "brand_comparison",
    text: "How does Acme Analytics compare to other seo tools?",
    mode: "natural_demand",
    brandStance: "brand",
    buyerStage: "decision",
    timeSensitive: false,
    asOf: null,
    templateId: "geo.natural.brand_comparison",
    samplesPlanned: 1,
    ...overrides,
  });
}

function slot(index = 1, queryId = "core-category_discovery"): GeoExecutionSlot {
  return { queryIndex: 0, sampleIndex: index, sampleId: `${queryId}-s${index}` };
}

function annotation(
  overrides: Partial<GeoProviderCitationAnnotation> = {},
): GeoProviderCitationAnnotation {
  return {
    url: "https://acme.test/pricing",
    title: "Acme pricing",
    annotationText: "([acme.test](https://acme.test/pricing))",
    providerOutputItemIndex: 1,
    sectionIndex: 0,
    annotationOrdinal: 0,
    startIndex: 12,
    endIndex: 40,
    spanBasis: "provider_message_section_text",
    ...overrides,
  };
}

function observation(
  overrides: Partial<GeoProviderObservation> = {},
): GeoProviderObservation {
  return {
    observedAt: "2026-08-17T09:21:39.000Z",
    webSearchPerformed: true,
    answerText: "Several tools cover this.",
    citations: [],
    citationsComplete: true,
    costUsd: 0.0457,
    model: "gpt-5-2025-08-07",
    ...overrides,
  };
}

function citations(
  sample: ReturnType<typeof observeToSample>,
): readonly GeoCitationEvidenceRefV1[] {
  return sample.evidence.filter(
    (entry): entry is GeoCitationEvidenceRefV1 => entry.kind === "cited",
  );
}

describe("observeToSample", () => {
  it("records a mention on an answer that never searched", () => {
    // The old classifier returned early here and threw the mention away, which
    // is precisely the observation this Agent exists to make: the assistant
    // answered from its own weights and still named the brand.
    const sample = observeToSample(
      slot(),
      probe(),
      observation({
        webSearchPerformed: false,
        answerText: "Acme Analytics is a common choice.",
      }),
      CONTEXT,
    );

    expect(sample.answerStatus).toBe("answered");
    expect(sample.webSearchPerformed).toBe(false);
    // Annotations were inspected and there were none. That is a fact about this
    // answer, not an inapplicable question.
    expect(sample.citationStatus).toBe("observed_none");
    expect(sample.mentionStatus).toBe("observed");
    expect(sample.mentionEligibility).toBe("unprompted");
    expect(sample.recommendationStatus).toBe("not_evaluated");
  });

  it("marks a mention prompted when the question itself named the brand", () => {
    const sample = observeToSample(
      slot(1, "core-brand_comparison"),
      natural(),
      observation({ answerText: "Acme Analytics compares well." }),
      CONTEXT,
    );

    // The answer repeated a word the question supplied. That is tautology, not
    // discovery, and the eligibility field is what keeps it out of the
    // discovery denominator.
    expect(sample.mentionEligibility).toBe("prompted");
    expect(sample.mentionStatus).toBe("observed");
  });

  it("reports observed_target when the target host is cited", () => {
    const sample = observeToSample(
      slot(),
      probe(),
      observation({
        citations: [
          annotation(),
          annotation({
            url: "https://rival.test/overview",
            title: "Rival",
            annotationOrdinal: 1,
            startIndex: 41,
            endIndex: 60,
          }),
        ],
      }),
      CONTEXT,
    );

    expect(sample.citationStatus).toBe("observed_target");
    expect(citations(sample).map((entry) => entry.ownership)).toEqual([
      "target",
      "unknown",
    ]);
    // No URL-only classifier can honestly say whether rival.test is a
    // competitor, a marketplace or a blog.
    expect(citations(sample).map((entry) => entry.sourceType)).toEqual([
      "owned_page",
      "unknown",
    ]);
  });

  it("keeps multiple target paths as separate evidence", () => {
    const sample = observeToSample(
      slot(),
      probe(),
      observation({
        citations: [
          annotation({ url: "https://acme.test/pricing" }),
          annotation({
            url: "https://acme.test/docs",
            annotationOrdinal: 1,
            startIndex: null,
            endIndex: null,
          }),
        ],
      }),
      CONTEXT,
    );

    expect(citations(sample).map((entry) => entry.exactUrl)).toEqual([
      "https://acme.test/pricing",
      "https://acme.test/docs",
    ]);
    expect(sample.citationStatus).toBe("observed_target");
  });

  it("reports observed_others_only when nobody cited the target", () => {
    const sample = observeToSample(
      slot(),
      probe(),
      observation({
        citations: [annotation({ url: "https://rival.test/x", title: "Rival" })],
      }),
      CONTEXT,
    );

    expect(sample.citationStatus).toBe("observed_others_only");
  });

  it("reports observed_none when a searched answer cited nobody", () => {
    const sample = observeToSample(slot(), probe(), observation(), CONTEXT);

    expect(sample.citationStatus).toBe("observed_none");
    expect(sample.evidence).toEqual([]);
  });

  it("preserves the exact URL, title, annotation text and span", () => {
    const sample = observeToSample(
      slot(),
      probe(),
      observation({ citations: [annotation()] }),
      CONTEXT,
    );

    expect(citations(sample)[0]).toEqual({
      kind: "cited",
      evidenceId: "core-category_discovery-s1-c1",
      exactUrl: "https://acme.test/pricing",
      domain: "acme.test",
      title: "Acme pricing",
      annotationText: "([acme.test](https://acme.test/pricing))",
      providerOutputItemIndex: 1,
      sectionIndex: 0,
      startIndex: 12,
      endIndex: 40,
      ownership: "target",
      sourceType: "owned_page",
    });
  });

  it("recomputes the domain rather than trusting one beside the URL", () => {
    const sample = observeToSample(
      slot(),
      probe(),
      observation({
        citations: [annotation({ url: "https://www.acme.test/pricing" })],
      }),
      CONTEXT,
    );

    expect(citations(sample)[0]!.domain).toBe("acme.test");
    expect(citations(sample)[0]!.ownership).toBe("target");
  });

  it("makes citation evaluation unavailable when the list could not be read", () => {
    // All-or-nothing. A partly-read list would let `observed_none` describe an
    // answer whose citations the parser simply failed on.
    const sample = observeToSample(
      slot(),
      probe(),
      observation({ citations: [annotation()], citationsComplete: false }),
      CONTEXT,
    );

    expect(sample.citationStatus).toBe("unavailable");
    expect(citations(sample)).toEqual([]);
    expect(sample.limitations).toContain("citation_extraction_incomplete");
  });

  // Regression: the snippet is cut from the NFC answer, which still carries the
  // paragraph breaks the assistant wrote. Un-normalized it failed the report
  // guard after all eighteen calls had been billed. Found by cross-model review
  // of /qa's fix on 2026-08-18.
  it("normalizes the mention snippet it cuts from the answer", () => {
    const answer = `${"padding ".repeat(40)}\nAcme Analytics\tis  named here.\n${"tail ".repeat(40)}`;
    const sample = observeToSample(
      slot(),
      probe(),
      observation({ answerText: answer }),
      CONTEXT,
    );
    const mention = sample.evidence.find((entry) => entry.kind === "mention");

    expect(mention).toBeDefined();
    if (mention?.kind !== "mention") return;
    expect(mention.mentionSnippet).not.toBeNull();
    // No newline, tab, or doubled space survives into the report.
    expect(mention.mentionSnippet).not.toMatch(/[\n\t]|\s{2}/u);
    expect(mention.mentionSnippet).toContain("Acme Analytics is named here.");
  });

  it("keeps mention evidence free of anything that looks like a citation", () => {
    const sample = observeToSample(
      slot(),
      probe(),
      observation({ answerText: `${"padding ".repeat(60)}Acme is named here.` }),
      CONTEXT,
    );
    const mention = sample.evidence.find((entry) => entry.kind === "mention");

    expect(mention).toBeDefined();
    expect(Object.keys(mention!)).toEqual([
      "kind",
      "evidenceId",
      "matchedAlias",
      "mentionSnippet",
      "snippetBasis",
    ]);
    expect(JSON.stringify(mention)).not.toContain("http");
  });

  it("keeps at most one mention record per sample", () => {
    const sample = observeToSample(
      slot(),
      probe(),
      observation({ answerText: "Acme and Acme Analytics and Acme again." }),
      CONTEXT,
    );

    expect(
      sample.evidence.filter((entry) => entry.kind === "mention"),
    ).toHaveLength(1);
  });

  it("omits the snippet when it would reproduce a short whole answer", () => {
    const sample = observeToSample(
      slot(),
      probe(),
      observation({ answerText: "Acme is a good option." }),
      CONTEXT,
    );
    const mention = sample.evidence.find((entry) => entry.kind === "mention");

    expect(mention).toMatchObject({ mentionSnippet: null, matchedAlias: "Acme" });
  });

  it("reports mention unavailable when the alias set is outside the matcher", () => {
    // "The matcher cannot answer" and "the answer did not name you" are
    // different facts, and only one of them is about the customer.
    const sample = observeToSample(
      slot(),
      probe(),
      observation({ answerText: "Some answer." }),
      { ...CONTEXT, aliasScope: "out_of_scope" },
    );

    expect(sample.mentionStatus).toBe("unavailable");
    expect(sample.mentionStatus).not.toBe("not_observed");
    expect(sample.limitations).toContain("alias_matcher_out_of_scope");
    expect(sample.evidence.some((entry) => entry.kind === "mention")).toBe(false);
  });
});

describe("unavailableSample", () => {
  it.each([
    "provider_no_answer",
    "provider_error",
    "transport_error",
    "transport_outcome_unknown",
  ] as const)("records %s without inventing an observation", (limitation) => {
    const sample = unavailableSample(slot(), probe(), CONTEXT, limitation);

    expect(sample.answerStatus).toBe("no_usable_answer");
    expect(sample.citationStatus).toBe("unavailable");
    expect(sample.mentionStatus).toBe("unavailable");
    expect(sample.evidence).toEqual([]);
    expect(sample.limitations).toEqual([limitation]);
    expect(sample.observedAt).toBeNull();
    // Not `false`: a call that produced no answer produced no evidence that a
    // search did not run either.
    expect(sample.webSearchPerformed).toBeNull();
  });
});

describe("deriveProbeStatus", () => {
  const answered = (searched: boolean) =>
    observeToSample(slot(), probe(), observation({ webSearchPerformed: searched }), CONTEXT);

  it("calls a probe valid when every answered sample searched", () => {
    expect(deriveProbeStatus([answered(true), answered(true)])).toBe("valid");
  });

  it("calls a probe trigger_failed when no answered sample searched", () => {
    expect(deriveProbeStatus([answered(false), answered(false)])).toBe(
      "trigger_failed",
    );
  });

  it("keeps a mixed probe as its own verdict rather than rounding it", () => {
    expect(deriveProbeStatus([answered(true), answered(false)])).toBe(
      "degraded_mixed_trigger",
    );
  });

  it("calls a probe provider_failed when nothing answered", () => {
    expect(
      deriveProbeStatus([
        unavailableSample(slot(), probe(), CONTEXT, "provider_error"),
      ]),
    ).toBe("provider_failed");
  });
});

describe("assembleQuestion", () => {
  const searched = (index: number, on: boolean) =>
    observeToSample(
      slot(index),
      probe(),
      observation({ webSearchPerformed: on }),
      CONTEXT,
    );

  it("stamps one probe verdict onto every sample of the question", () => {
    const question = assembleQuestion(probe(), [
      searched(1, false),
      searched(2, false),
      searched(3, false),
    ]);

    expect(question.samples.map((sample) => sample.probeStatus)).toEqual([
      "trigger_failed",
      "trigger_failed",
      "trigger_failed",
    ]);
    expect(question.samples[0]!.limitations).toContain(
      "retrieval_trigger_failed",
    );
  });

  it("keeps a failed trigger out of the citation denominator", () => {
    // The wording was measured to reach the live web. When a live run shows it
    // did not, that is an instrumentation failure, not "the customer was not
    // cited".
    const question = assembleQuestion(probe(), [
      searched(1, false),
      searched(2, false),
      searched(3, false),
    ]);

    expect(question.counts.scheduledSamples).toBe(3);
    expect(question.counts.answeredSamples).toBe(3);
    expect(question.counts.citationEvaluableSamples).toBe(0);
    expect(question.counts.targetCitedIn).toBe(0);
  });

  it("leaves a natural-demand question with no probe status at all", () => {
    const question = assembleQuestion(natural(), [
      observeToSample(
        slot(1, "core-brand_comparison"),
        natural(),
        observation({ webSearchPerformed: false }),
        CONTEXT,
      ),
    ]);

    expect(question.samples[0]!.probeStatus).toBeNull();
    expect(question.counts.citationEvaluableSamples).toBe(1);
  });

  it("orders samples by index rather than by completion", () => {
    const question = assembleQuestion(probe(), [
      searched(3, true),
      searched(1, true),
      searched(2, true),
    ]);

    expect(question.samples.map((sample) => sample.sampleIndex)).toEqual([
      1, 2, 3,
    ]);
  });

  it("derives its counts with the same function the guard uses", () => {
    const question = assembleQuestion(probe(), [
      searched(1, true),
      searched(2, true),
      searched(3, true),
    ]);

    expect(question.counts).toEqual(deriveGeoSampleCounts(question.samples));
  });
});

describe("deriveGeoSampleCounts", () => {
  it("keeps a failed call out of every positive denominator", () => {
    const counts = deriveGeoSampleCounts([
      unavailableSample(slot(1), probe(), CONTEXT, "transport_outcome_unknown"),
      observeToSample(slot(2), probe(), observation(), CONTEXT),
    ]);

    expect(counts).toMatchObject({
      scheduledSamples: 2,
      answeredSamples: 1,
      unavailableSamples: 1,
      // The failed call could not say whether a search ran, so it is not in the
      // search denominator either.
      searchEvaluableSamples: 1,
      searchPerformedSamples: 1,
      citationEvaluableSamples: 1,
      mentionEvaluableSamples: 1,
    });
  });

  it("gives searchPerformedSamples an honest denominator", () => {
    const counts = deriveGeoSampleCounts([
      observeToSample(
        slot(1),
        probe(),
        observation({ webSearchPerformed: false }),
        CONTEXT,
      ),
      unavailableSample(slot(2), probe(), CONTEXT, "provider_error"),
    ]);

    expect(counts.searchEvaluableSamples).toBe(1);
    expect(counts.searchPerformedSamples).toBe(0);
  });
});

describe("buildGeoExecutionPlan", () => {
  it("allocates every sample index before any work begins", () => {
    const plan = buildGeoExecutionPlan([probe(), natural()]);

    expect(plan).toHaveLength(4);
    expect(plan.map((entry) => entry.sampleId)).toEqual([
      "core-category_discovery-s1",
      "core-category_discovery-s2",
      "core-category_discovery-s3",
      "core-brand_comparison-s1",
    ]);
  });

  it("sums to eighteen for the shipped core_8 mix", () => {
    const queries = [
      ...Array.from({ length: 5 }, (_unused, index) =>
        probe({ queryId: `p${index}` }),
      ),
      ...Array.from({ length: 3 }, (_unused, index) =>
        natural({ queryId: `n${index}` }),
      ),
    ];

    expect(buildGeoExecutionPlan(queries)).toHaveLength(18);
  });
});

describe("collectGeoSamples", () => {
  function provider(
    observe: GeoProviderClient["observe"],
  ): GeoProviderClient {
    return { observe };
  }

  function dependencies(overrides: Record<string, unknown> = {}) {
    return {
      provider: provider(vi.fn(async () => Promise.resolve(observation()))),
      model: "gpt-5-2025-08-07",
      marketCode: "US",
      remainingMs: () => 240_000,
      admitCall: () => true,
      settleCall: vi.fn(),
      noteModel: vi.fn(),
      ...overrides,
    } as Parameters<typeof collectGeoSamples>[2];
  }

  it("dispatches exactly the planned number of calls", async () => {
    const observe = vi.fn(async () => Promise.resolve(observation()));
    const questions = await collectGeoSamples(
      [probe(), natural()],
      CONTEXT,
      dependencies({ provider: provider(observe) }),
    );

    expect(observe).toHaveBeenCalledTimes(4);
    expect(questions.map((question) => question.samples.length)).toEqual([3, 1]);
  });

  it("keeps paid results when one call fails", async () => {
    let call = 0;
    const observe = vi.fn(async () => {
      call += 1;
      if (call === 2) {
        throw new GeoProviderError("server_error", "boom", 0.01);
      }
      return Promise.resolve(observation());
    });
    const questions = await collectGeoSamples(
      [probe()],
      CONTEXT,
      dependencies({ provider: provider(observe) }),
    );

    expect(questions[0]!.counts.answeredSamples).toBe(2);
    expect(questions[0]!.counts.unavailableSamples).toBe(1);
  });

  it("never retries a request whose outcome is unknown", async () => {
    // An aborted call may still have reached the provider, been answered and
    // been billed. Retrying it would be a nineteenth charge.
    const observe = vi.fn(async () => {
      throw new GeoProviderError("timeout", "gone", null);
    });
    const questions = await collectGeoSamples(
      [probe()],
      CONTEXT,
      dependencies({ provider: provider(observe) }),
    );

    expect(observe).toHaveBeenCalledTimes(3);
    expect(
      questions[0]!.samples.every((sample) =>
        sample.limitations.includes("transport_outcome_unknown"),
      ),
    ).toBe(true);
  });

  it("stops issuing calls when the time budget runs out", async () => {
    const observe = vi.fn(async () => Promise.resolve(observation()));
    const questions = await collectGeoSamples(
      [probe()],
      CONTEXT,
      dependencies({
        provider: provider(observe),
        remainingMs: () => GEO_MIN_BUDGET_FOR_CALL_MS - 1,
      }),
    );

    expect(observe).not.toHaveBeenCalled();
    expect(
      questions[0]!.samples.every((sample) =>
        sample.limitations.includes("time_budget"),
      ),
    ).toBe(true);
  });

  it("records the cost ceiling rather than silently dropping the sample", async () => {
    const questions = await collectGeoSamples(
      [probe()],
      CONTEXT,
      dependencies({ admitCall: () => false }),
    );

    expect(questions[0]!.samples).toHaveLength(3);
    expect(questions[0]!.counts.unavailableSamples).toBe(3);
  });

  it("reports every observed model label to the caller", async () => {
    const noteModel = vi.fn();
    await collectGeoSamples(
      [natural()],
      CONTEXT,
      dependencies({ noteModel }),
    );

    expect(noteModel).toHaveBeenCalledWith("gpt-5-2025-08-07");
  });

  it("orders samples by plan position, not by completion order", async () => {
    let call = 0;
    const observe = vi.fn(async () => {
      call += 1;
      const delay = call === 1 ? 5 : 0;
      await new Promise((resolve) => setTimeout(resolve, delay));
      return observation();
    });
    const questions = await collectGeoSamples(
      [probe()],
      CONTEXT,
      dependencies({ provider: provider(observe) }),
    );

    expect(questions[0]!.samples.map((sample) => sample.sampleIndex)).toEqual([
      1, 2, 3,
    ]);
  });
});

describe("probe verdict and per-sample trigger marking", () => {
  const answered = (index: number, searched: boolean) =>
    observeToSample(
      slot(index),
      probe(),
      observation({ webSearchPerformed: searched }),
      CONTEXT,
    );

  it("marks only the calls that actually failed to trigger", () => {
    // Citation evaluability is judged per sample, so a mixed probe's unsearched
    // call leaves the denominator — and a sample that leaves without saying why
    // is a number the report cannot explain.
    const question = assembleQuestion(probe(), [
      answered(1, true),
      answered(2, false),
      answered(3, true),
    ]);

    expect(question.samples.map((sample) => sample.probeStatus)).toEqual([
      "degraded_mixed_trigger",
      "degraded_mixed_trigger",
      "degraded_mixed_trigger",
    ]);
    expect(
      question.samples.map((sample) =>
        sample.limitations.includes("retrieval_trigger_failed"),
      ),
    ).toEqual([false, true, false]);
    // Two searched calls counted, the unsearched one excluded.
    expect(question.counts.citationEvaluableSamples).toBe(2);
  });

  it("judges the verdict only over samples that could say whether a search ran", () => {
    const failed = unavailableSample(
      slot(1),
      probe(),
      CONTEXT,
      "transport_outcome_unknown",
    );

    // The failed call carries no search evidence either way, so it cannot drag
    // the verdict toward "never searched".
    expect(deriveProbeStatus([failed, answered(2, true)])).toBe("valid");
    expect(deriveProbeStatus([failed])).toBe("provider_failed");
  });
});
