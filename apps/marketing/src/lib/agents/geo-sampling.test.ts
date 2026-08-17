// @input  -- scripted provider answers, transport failures, and a controlled budget
// @output -- proof that classification, aggregation and the fan-out stay honest
// @pos    -- focused tests for the step that turns answers into reportable evidence

import { describe, expect, it, vi } from "vitest";
import {
  isGeoReportSuccessEnvelope,
  AGENT_GEO_REPORT_SCHEMA_VERSION,
  GEO_SAMPLES_PER_QUESTION,
  type GeoReportSuccessEnvelope,
} from "./geo-report-contract.ts";
import { GeoProviderError, type GeoProviderClient } from "./geo-provider.ts";
import {
  aggregateSamples,
  classifyObservation,
  collectGeoSamples,
  GEO_MAX_CONCURRENCY,
  GEO_MIN_BUDGET_FOR_CALL_MS,
  mentionsBrand,
  normalizeCitedHost,
  type GeoSamplingContext,
} from "./geo-sampling.ts";

const CONTEXT: GeoSamplingContext = {
  targetHost: "acme.test",
  brandTokens: ["acme", "acme analytics"],
  competitorHosts: ["rival.test", "other.test"],
};

function observation(
  overrides: {
    readonly citedUrls?: readonly string[];
    readonly answerText?: string;
    readonly webSearchPerformed?: boolean;
  } = {},
) {
  return {
    observedAt: "2026-08-17T09:21:39.000Z",
    webSearchPerformed: overrides.webSearchPerformed ?? true,
    answerText: overrides.answerText ?? "Several tools cover this.",
    citedUrls: overrides.citedUrls ?? [],
    costUsd: 0.0457,
    model: "gpt-5-2025-08-07",
  };
}

describe("normalizeCitedHost", () => {
  it.each([
    ["https://acme.test/pricing?utm_source=openai", "acme.test"],
    ["https://www.acme.test/", "acme.test"],
    ["https://ACME.test/x", "acme.test"],
    ["https://acme.test:8443/x", "acme.test"],
    ["http://docs.acme.test/guide#a", "docs.acme.test"],
  ] as const)("reduces %s to %s", (url, expected) => {
    expect(normalizeCitedHost(url)).toBe(expected);
  });

  it.each([
    "not a url",
    "ftp://acme.test/x",
    "mailto:a@acme.test",
    "https://localhost/",
  ])("rejects %s", (url) => {
    expect(normalizeCitedHost(url)).toBeNull();
  });
});

describe("mentionsBrand", () => {
  it.each([
    ["Acme is one option.", true],
    ["We recommend ACME today.", true],
    ["Acme's dashboard helps.", true],
    ["Try Acme Analytics for this.", true],
    ["AcmeCorp is unrelated.", false],
    ["The pinnacle of tooling.", false],
    ["", false],
  ] as const)("reads %j as %s", (text, expected) => {
    expect(mentionsBrand(text, CONTEXT.brandTokens)).toBe(expected);
  });

  it("ignores a brand token too short to be distinctive", () => {
    expect(mentionsBrand("We use AI daily.", ["ai"])).toBe(false);
  });
});

describe("classifyObservation", () => {
  it("calls it cited when the target host is among the citations", () => {
    const sample = classifyObservation(
      1,
      observation({
        citedUrls: [
          "https://www.acme.test/pricing?utm_source=openai",
          "https://rival.test/x",
        ],
      }),
      CONTEXT,
    );

    expect(sample.state).toBe("cited");
    expect(sample.citedHosts).toEqual(["acme.test", "rival.test"]);
    expect(sample.competitorHosts).toEqual(["rival.test"]);
  });

  it("prefers cited over mentioned when the answer does both", () => {
    const sample = classifyObservation(
      1,
      observation({
        citedUrls: ["https://acme.test/"],
        answerText: "Acme is the one to use.",
      }),
      CONTEXT,
    );

    expect(sample.state).toBe("cited");
  });

  it("calls it mentioned when the prose names the brand but cites others", () => {
    const sample = classifyObservation(
      1,
      observation({
        citedUrls: ["https://rival.test/x"],
        answerText: "Acme is an option, though this list covers others.",
      }),
      CONTEXT,
    );

    expect(sample.state).toBe("mentioned");
    expect(sample.citedHosts).not.toContain("acme.test");
  });

  it("calls it cited_others_only when neither the host nor the name appears", () => {
    const sample = classifyObservation(
      1,
      observation({
        citedUrls: ["https://rival.test/x", "https://other.test/y"],
        answerText: "Two established vendors lead here.",
      }),
      CONTEXT,
    );

    expect(sample.state).toBe("cited_others_only");
    expect(sample.competitorHosts).toEqual(["rival.test", "other.test"]);
  });

  it("separates an answer that cited nobody from one that cited rivals", () => {
    const sample = classifyObservation(
      1,
      observation({ citedUrls: [], answerText: "Here is a general overview." }),
      CONTEXT,
    );

    expect(sample.state).toBe("answer_had_no_citations");
  });

  it("drops the host lists when the provider never searched", () => {
    const sample = classifyObservation(
      1,
      observation({
        webSearchPerformed: false,
        citedUrls: ["https://acme.test/"],
      }),
      CONTEXT,
    );

    expect(sample.state).toBe("search_not_performed");
    expect(sample.citedHosts).toEqual([]);
    expect(sample.competitorHosts).toEqual([]);
  });

  it("deduplicates hosts cited more than once", () => {
    const sample = classifyObservation(
      1,
      observation({
        citedUrls: [
          "https://acme.test/a",
          "https://www.acme.test/b?utm_source=openai",
        ],
      }),
      CONTEXT,
    );

    expect(sample.citedHosts).toEqual(["acme.test"]);
  });
});

describe("aggregateSamples", () => {
  it("counts only admissible samples in the denominator", () => {
    const samples = [
      classifyObservation(
        1,
        observation({ citedUrls: ["https://acme.test/"] }),
        CONTEXT,
      ),
      classifyObservation(
        2,
        observation({ webSearchPerformed: false }),
        CONTEXT,
      ),
      classifyObservation(3, observation({ citedUrls: [] }), CONTEXT),
    ];

    const question = aggregateSamples("q-1", "A question?", samples);

    expect(question.aggregate.admissibleSamples).toBe(2);
    expect(question.aggregate.targetCitedIn).toBe(1);
    expect(question.aggregate.verdict).toBe("intermittent");
  });

  it("reports a question with no admissible sample as inconclusive", () => {
    const samples = [
      classifyObservation(
        1,
        observation({ webSearchPerformed: false }),
        CONTEXT,
      ),
      classifyObservation(
        2,
        observation({ webSearchPerformed: false }),
        CONTEXT,
      ),
      classifyObservation(
        3,
        observation({ webSearchPerformed: false }),
        CONTEXT,
      ),
    ];

    expect(
      aggregateSamples("q-1", "A question?", samples).aggregate,
    ).toMatchObject({
      admissibleSamples: 0,
      verdict: "inconclusive",
    });
  });

  it("orders samples by index regardless of completion order", () => {
    const samples = [
      classifyObservation(3, observation(), CONTEXT),
      classifyObservation(1, observation(), CONTEXT),
      classifyObservation(2, observation(), CONTEXT),
    ];

    expect(
      aggregateSamples("q-1", "A question?", samples).samples.map(
        (s) => s.sampleIndex,
      ),
    ).toEqual([1, 2, 3]);
  });
});

function questions(count: number) {
  return Array.from({ length: count }, (_value, index) => ({
    questionId: `q-${index + 1}`,
    question: `Question number ${index + 1}?`,
  }));
}

function dependencies(
  provider: GeoProviderClient,
  overrides: {
    readonly remainingMs?: () => number;
    readonly admitCall?: () => boolean;
  } = {},
) {
  const costs: number[] = [];
  return {
    deps: {
      provider,
      model: "gpt-5-2025-08-07",
      marketCode: "US",
      remainingMs: overrides.remainingMs ?? ((): number => 300_000),
      admitCall: overrides.admitCall ?? ((): boolean => true),
      settleCall: (cost: number): void => {
        costs.push(cost);
      },
    },
    costs,
  };
}

describe("collectGeoSamples", () => {
  it("takes three samples of every question", async () => {
    const observe = vi.fn(async () => Promise.resolve(observation()));
    const { deps } = dependencies({ observe });

    const result = await collectGeoSamples(questions(8), CONTEXT, deps);

    expect(observe).toHaveBeenCalledTimes(24);
    expect(result).toHaveLength(8);
    for (const question of result) {
      expect(question.samples).toHaveLength(GEO_SAMPLES_PER_QUESTION);
      expect(question.samples.map((s) => s.sampleIndex)).toEqual([1, 2, 3]);
    }
  });

  it("never exceeds the measured concurrency ceiling", async () => {
    let inFlight = 0;
    let peak = 0;
    const observe = vi.fn(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return observation();
    });
    const { deps } = dependencies({ observe });

    await collectGeoSamples(questions(8), CONTEXT, deps);

    expect(peak).toBeLessThanOrEqual(GEO_MAX_CONCURRENCY);
    expect(peak).toBeGreaterThan(1);
  });

  it("books the cost of a failed call and records the sample as unavailable", async () => {
    const observe = vi.fn(async () => {
      throw new GeoProviderError("rate_limited", "internal detail", 0.0121);
    });
    const { deps, costs } = dependencies({ observe });

    const result = await collectGeoSamples(questions(1), CONTEXT, deps);

    expect(costs).toEqual([0.0121, 0.0121, 0.0121]);
    expect(result[0]!.aggregate.admissibleSamples).toBe(0);
    expect(result[0]!.aggregate.verdict).toBe("inconclusive");
    for (const sample of result[0]!.samples) {
      expect(sample.state).toBe("unavailable");
      expect(sample.limitation).toBe(
        "The provider rate limit made this sample unavailable.",
      );
    }
  });

  it("never leaks the provider's own message into the report", async () => {
    const observe = vi.fn(async () => {
      throw new GeoProviderError(
        "server_error",
        "upstream said something quotable",
        0,
      );
    });
    const { deps } = dependencies({ observe });

    const result = await collectGeoSamples(questions(1), CONTEXT, deps);

    for (const sample of result[0]!.samples) {
      expect(sample.limitation).not.toContain("quotable");
    }
  });

  it("stops sampling once the cost ceiling refuses another call", async () => {
    const observe = vi.fn(async () => Promise.resolve(observation()));
    let admitted = 0;
    const { deps } = dependencies(
      { observe },
      {
        admitCall: () => {
          admitted += 1;
          return admitted <= 4;
        },
      },
    );

    const result = await collectGeoSamples(questions(4), CONTEXT, deps);

    expect(observe).toHaveBeenCalledTimes(4);
    const unavailable = result
      .flatMap((q) => q.samples)
      .filter((s) => s.state === "unavailable");
    expect(unavailable).toHaveLength(8);
    expect(unavailable[0]!.limitation).toContain("cost ceiling");
  });

  it("stops paying for samples once the budget cannot fit another call", async () => {
    const observe = vi.fn(async () => Promise.resolve(observation()));
    let remaining = GEO_MIN_BUDGET_FOR_CALL_MS + 1;
    const { deps } = dependencies(
      { observe },
      {
        remainingMs: () => {
          remaining -= GEO_MIN_BUDGET_FOR_CALL_MS;
          return remaining;
        },
      },
    );

    const result = await collectGeoSamples(questions(4), CONTEXT, deps);

    expect(observe.mock.calls.length).toBeLessThan(12);
    const states = result.flatMap((q) => q.samples.map((s) => s.state));
    expect(states).toContain("unavailable");
    expect(result.flatMap((q) => q.samples)).toHaveLength(12);
  });

  it("produces a payload the frozen report guard accepts", async () => {
    // The end-to-end check: sampling and the contract must agree, or the run
    // pays for evidence the client refuses to render.
    const answers = [
      observation({ citedUrls: ["https://www.acme.test/a?utm_source=openai"] }),
      observation({
        citedUrls: ["https://rival.test/x"],
        answerText: "Acme is worth a look.",
      }),
      observation({ citedUrls: [], answerText: "A general overview." }),
    ];
    let call = 0;
    const observe = vi.fn(async () => {
      const next = answers[call % answers.length]!;
      call += 1;
      return next;
    });
    const { deps, costs } = dependencies({ observe });

    const collected = await collectGeoSamples(questions(8), CONTEXT, deps);
    const samples = collected.flatMap((q) => q.samples);
    const observed = samples.filter(
      (s) => s.state !== "search_not_performed" && s.state !== "unavailable",
    ).length;

    const envelope: GeoReportSuccessEnvelope = {
      data: {
        run: {
          agent: "geo",
          mode: "authenticated_agent",
          persistence: "expiring",
          schemaVersion: AGENT_GEO_REPORT_SCHEMA_VERSION,
          sampledAt: "2026-08-17T09:00:00.000Z",
          expiresAt: "2026-08-24T09:00:00.000Z",
          targetHost: CONTEXT.targetHost,
          provider: {
            tool: "dataforseo_chat_gpt_llm_responses",
            model: "gpt-5-2025-08-07",
            marketCode: "US",
            languageCode: "en",
            samplesPerQuestion: GEO_SAMPLES_PER_QUESTION,
            costUsd: costs.reduce((total, cost) => total + cost, 0),
          },
        },
        coverage: {
          questionsRequested: collected.length,
          samplesAttempted: samples.length,
          samplesObserved: observed,
          samplesSearchNotPerformed: samples.filter(
            (s) => s.state === "search_not_performed",
          ).length,
          samplesUnavailable: samples.filter((s) => s.state === "unavailable")
            .length,
          availability: "available",
        },
        questions: collected,
      },
    };

    expect(isGeoReportSuccessEnvelope(envelope)).toBe(true);
  });
});
