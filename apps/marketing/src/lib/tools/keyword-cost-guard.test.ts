import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consumeKeywordDailyBudget,
  createKeywordCostAccumulator,
  estimateBulkRanksCostUsd,
  estimateKeywordOverviewCostUsd,
  estimateSerpSampleCostUsd,
  keywordBudgetRefusal,
  keywordDailyBudgetBucket,
  reportKeywordRunCost,
  KEYWORD_DAILY_RUN_MAX,
  KEYWORD_DAILY_WINDOW_SECONDS,
  KEYWORD_MAX_PROVIDER_COST_USD,
  type KeywordBudgetDependencies,
} from "./keyword-cost-guard.ts";

const NOW = Date.parse("2026-08-10T09:30:00.000Z");
const now = () => NOW;

function budgetDeps(
  row: unknown,
  throws?: Error,
): {
  readonly dependencies: KeywordBudgetDependencies;
  readonly callQuota: ReturnType<typeof vi.fn>;
} {
  const callQuota = vi.fn(async () => {
    if (throws) throw throws;
    return row as never;
  });
  return { dependencies: { quota: { callQuota }, now }, callQuota };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createKeywordCostAccumulator", () => {
  it("lets a run at the measured p50 through untouched", () => {
    const costs = createKeywordCostAccumulator();
    costs.record("keyword_overview", 0.017);
    costs.record("serp_organic", 0.04);
    costs.record("bulk_ranks", 0.031);

    expect(costs.spent()).toBe(0.088);
    expect(costs.wouldExceed(0.04)).toBe(false);
    expect(costs.capped()).toBe(false);
    expect(costs.cappedStages()).toEqual([]);
  });

  it("groups spend by endpoint rather than only summing it", () => {
    const costs = createKeywordCostAccumulator();
    costs.record("serp_organic", 0.002);
    costs.record("serp_organic", 0.002);
    costs.record("keyword_overview", 0.033);

    expect(costs.byEndpoint()).toEqual({
      keyword_overview: 0.033,
      serp_organic: 0.004,
      bulk_ranks: 0,
      bulk_traffic: 0,
    });
    expect(costs.spent()).toBe(0.037);
  });

  it("books Labs traffic spend as its own provider endpoint", () => {
    const costs = createKeywordCostAccumulator();

    costs.record("bulk_traffic", 0.012);

    expect(costs.byEndpoint().bulk_traffic).toBe(0.012);
    expect(costs.spent()).toBe(0.012);
  });

  /**
   * The snapshot a caller already holds must not change under it — that is the
   * difference between a report of what a run cost and a live view that can
   * disagree with the log line printed from it.
   */
  it("does not mutate a byEndpoint snapshot taken earlier", () => {
    const costs = createKeywordCostAccumulator();
    costs.record("serp_organic", 0.002);
    const snapshot = costs.byEndpoint();
    costs.record("serp_organic", 0.002);

    expect(snapshot.serp_organic).toBe(0.002);
    expect(costs.byEndpoint().serp_organic).toBe(0.004);
  });

  it("reports the ceiling as crossed once the next stage would not fit", () => {
    const costs = createKeywordCostAccumulator();
    costs.record("keyword_overview", 0.2);

    expect(costs.spent()).toBeLessThan(KEYWORD_MAX_PROVIDER_COST_USD);
    expect(costs.wouldExceed(0.04)).toBe(false);
    expect(costs.wouldExceed(0.06)).toBe(true);
  });

  /**
   * Degrade, never throw. Everything already booked is billed whether or not
   * the caller ever sees a result, so the cost layer must leave the caller able
   * to return what it has paid for and name the stage it skipped.
   */
  it("refuses a stage without throwing and records why", () => {
    const costs = createKeywordCostAccumulator();
    costs.record("keyword_overview", 0.24);

    expect(costs.admitStage("serp_sample", 0.04)).toBe(false);
    expect(costs.capped()).toBe(true);
    expect(costs.cappedStages()).toEqual(["serp_sample"]);
    // The already-paid-for stage is still reportable.
    expect(costs.spent()).toBe(0.24);
  });

  it("admits a stage that fits and leaves the run uncapped", () => {
    const costs = createKeywordCostAccumulator();
    costs.record("keyword_overview", 0.017);

    expect(costs.admitStage("serp_sample", 0.04)).toBe(true);
    expect(costs.capped()).toBe(false);
  });

  /**
   * A NaN booked into the total would disable the ceiling silently: every
   * comparison against NaN is false, so `wouldExceed` would answer "no" for the
   * rest of the run.
   */
  it("keeps an unreadable cost out of the total and counts it instead", () => {
    const costs = createKeywordCostAccumulator();
    costs.record("keyword_overview", 0.017);
    costs.record("serp_organic", Number.NaN);
    costs.record("bulk_ranks", -1);

    expect(costs.spent()).toBe(0.017);
    expect(costs.unpricedCalls()).toBe(2);
    expect(costs.wouldExceed(0.3)).toBe(true);
  });

  it("treats an unusable estimate as not fitting", () => {
    const costs = createKeywordCostAccumulator();
    expect(costs.wouldExceed(Number.NaN)).toBe(true);
    expect(costs.admitStage("serp_sample", Number.NaN)).toBe(false);
  });

  it("honours a caller-supplied ceiling", () => {
    const costs = createKeywordCostAccumulator(0.05);
    costs.record("keyword_overview", 0.04);
    expect(costs.wouldExceed(0.02)).toBe(true);
  });
});

describe("cost estimates", () => {
  /**
   * Checked against the invoices the formulas were fitted to, to a tenth of a
   * cent. Tighter than that would be asserting the regression's residuals, not
   * the property that matters: an estimate close enough to decide with.
   */
  it("prices keyword_overview off returned rows", () => {
    expect(estimateKeywordOverviewCostUsd(175)).toBeCloseTo(0.033, 3);
    expect(estimateKeywordOverviewCostUsd(33)).toBeCloseTo(0.016, 3);
  });

  it("prices SERP sampling at two tenths of a cent per keyword", () => {
    expect(estimateSerpSampleCostUsd(20)).toBe(0.04);
    expect(estimateSerpSampleCostUsd(255)).toBe(0.51);
  });

  it("prices bulk ranks with its fixed component", () => {
    expect(estimateBulkRanksCostUsd(17)).toBeCloseTo(0.0246, 3);
    expect(estimateBulkRanksCostUsd(200)).toBeCloseTo(0.0305, 3);
  });

  it("never prices a negative count below the fixed component", () => {
    expect(estimateSerpSampleCostUsd(-5)).toBe(0);
    expect(estimateBulkRanksCostUsd(-5)).toBe(0.024);
  });
});

describe("consumeKeywordDailyBudget", () => {
  it("claims one run against the dated account bucket", async () => {
    const { dependencies, callQuota } = budgetDeps({
      allowed: true,
      hits: 4,
      reset_at: "2026-08-11T00:00:00.000Z",
    });

    const outcome = await consumeKeywordDailyBudget(dependencies);

    expect(outcome).toEqual({ kind: "allowed", runsToday: 4 });
    expect(callQuota).toHaveBeenCalledWith(
      "public-keyword:budget:2026-08-10",
      KEYWORD_DAILY_RUN_MAX,
      KEYWORD_DAILY_WINDOW_SECONDS,
    );
    expect(keywordBudgetRefusal(outcome)).toBeNull();
  });

  it("expresses the daily dollar budget as a whole number of runs", () => {
    // $5 / $0.088 p50, floored. A fractional run is not a thing to allow.
    expect(KEYWORD_DAILY_RUN_MAX).toBe(56);
  });

  it("rotates the bucket at UTC midnight rather than at first use", () => {
    expect(keywordDailyBudgetBucket(Date.parse("2026-08-10T23:59:59Z"))).toBe(
      "public-keyword:budget:2026-08-10",
    );
    expect(keywordDailyBudgetBucket(Date.parse("2026-08-11T00:00:01Z"))).toBe(
      "public-keyword:budget:2026-08-11",
    );
  });

  it("does not key the account budget per caller", () => {
    const bucket = keywordDailyBudgetBucket(NOW);
    expect(bucket).not.toContain("ip");
    expect(bucket).not.toContain("sub");
  });

  it("turns a spent budget into 503 keyword_source_unavailable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { dependencies } = budgetDeps({
      allowed: false,
      hits: KEYWORD_DAILY_RUN_MAX + 1,
      reset_at: "2026-08-10T09:32:30.000Z",
    });

    const outcome = await consumeKeywordDailyBudget(dependencies);
    expect(outcome).toEqual({ kind: "exhausted", retryAfterSeconds: 150 });

    const response = keywordBudgetRefusal(outcome);
    expect(response?.status).toBe(503);
    expect(response?.headers.get("Retry-After")).toBe("150");
    expect(response?.headers.get("Cache-Control")).toBe("no-store, private");
    await expect(response?.json()).resolves.toEqual({
      error: { code: "keyword_source_unavailable" },
    });
  });

  /**
   * Guardrail 2 of the cost model: a refused run ships no candidate it never
   * paid to validate. The refusal body is the enforcement point, so it carries
   * an error envelope and nothing that could be rendered as findings.
   */
  it("returns no data alongside the refusal", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { dependencies } = budgetDeps({
      allowed: false,
      hits: 99,
      reset_at: "2026-08-11T00:00:00.000Z",
    });

    const response = keywordBudgetRefusal(
      await consumeKeywordDailyBudget(dependencies),
    );
    const body = (await response?.json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["error"]);
    expect(body["data"]).toBeUndefined();
  });

  it("fails closed and names the reason in the server log", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { dependencies } = budgetDeps(
      null,
      new Error("fetch failed: SUPABASE_URL is not a URL"),
    );

    const outcome = await consumeKeywordDailyBudget(dependencies);

    expect(outcome.kind).toBe("unavailable");
    expect(error).toHaveBeenCalledWith(
      "[keyword-cost-guard] budget store unavailable:",
      "fetch failed: SUPABASE_URL is not a URL",
    );

    const response = keywordBudgetRefusal(outcome);
    expect(response?.status).toBe(503);
    expect(response?.headers.get("Retry-After")).toBe("60");
    // The visitor learns a code, never the misconfiguration behind it.
    await expect(response?.json()).resolves.toEqual({
      error: { code: "keyword_source_unavailable" },
    });
  });

  it("logs the tripped breaker so an operator can see it happen", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { dependencies } = budgetDeps({
      allowed: false,
      hits: 99,
      reset_at: "2026-08-11T00:00:00.000Z",
    });

    await consumeKeywordDailyBudget(dependencies);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(
      String(KEYWORD_DAILY_RUN_MAX),
    );
  });
});

describe("reportKeywordRunCost", () => {
  it("carries the model's request and retry counts", () => {
    // `retryCount` read zero on every production run until 2026-08-11, not
    // because the model never retried but because nothing was wired to the
    // hook that reports it. It is the only signal that says whether the model
    // is answering reliably today.
    const lines: string[] = [];
    const report = reportKeywordRunCost(
      {
        costs: createKeywordCostAccumulator(),
        candidateCount: 150,
        serpSampled: 20,
        llm: {
          inputTokens: 1900,
          outputTokens: 400,
          requestCount: 3,
          retryCount: 1,
        },
      },
      (line) => lines.push(line),
    );

    expect(report.llm.retryCount).toBe(1);
    expect(report.llm.requestCount).toBe(3);
    expect(JSON.parse(lines[0] ?? "{}").llm).toEqual(report.llm);
  });

  it("reports no model calls rather than omitting them", () => {
    // A run that never reached the model and a run whose counts were dropped
    // must not look the same in a log read by a human scanning for retries.
    const report = reportKeywordRunCost(
      {
        costs: createKeywordCostAccumulator(),
        candidateCount: 0,
        serpSampled: 0,
      },
      () => undefined,
    );
    expect(report.llm).toEqual({
      inputTokens: null,
      outputTokens: null,
      requestCount: 0,
      retryCount: 0,
    });
  });

  it("emits one structured line with the per-endpoint split", () => {
    const costs = createKeywordCostAccumulator();
    costs.record("keyword_overview", 0.017);
    costs.record("serp_organic", 0.04);
    costs.record("bulk_ranks", 0.031);
    const lines: string[] = [];

    const report = reportKeywordRunCost(
      { costs, candidateCount: 150, serpSampled: 20 },
      (line) => lines.push(line),
    );

    expect(report).toEqual({
      tool: "keyword_opportunity",
      runCostUsd: 0.088,
      byEndpoint: {
        keyword_overview: 0.017,
        serp_organic: 0.04,
        bulk_ranks: 0.031,
        bulk_traffic: 0,
      },
      candidateCount: 150,
      serpSampled: 20,
      capped: false,
      cappedStages: [],
      unpricedCalls: 0,
      llm: {
        inputTokens: null,
        outputTokens: null,
        requestCount: 0,
        retryCount: 0,
      },
    });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toEqual(report);
  });

  /**
   * A run that stayed cheap because a stage was cut looks identical in the
   * totals to a genuinely cheap run, and the two demand opposite responses.
   */
  it("records the cap as a fact of the run, not only as a lower total", () => {
    const costs = createKeywordCostAccumulator();
    costs.record("keyword_overview", 0.24);
    costs.admitStage("serp_sample", 0.04);
    const lines: string[] = [];

    const report = reportKeywordRunCost(
      { costs, candidateCount: 150, serpSampled: 0 },
      (line) => lines.push(line),
    );

    expect(report.capped).toBe(true);
    expect(report.cappedStages).toEqual(["serp_sample"]);
    expect(report.serpSampled).toBe(0);
    expect(lines[0]).toContain('"capped":true');
  });

  it("surfaces responses whose cost could not be read", () => {
    const costs = createKeywordCostAccumulator();
    costs.record("serp_organic", Number.NaN);

    const report = reportKeywordRunCost(
      { costs, candidateCount: 12, serpSampled: 1 },
      () => {},
    );

    expect(report.unpricedCalls).toBe(1);
    expect(report.runCostUsd).toBe(0);
  });

  it("writes to the console when no sink is injected", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const costs = createKeywordCostAccumulator();
    costs.record("bulk_ranks", 0.031);

    reportKeywordRunCost({ costs, candidateCount: 1, serpSampled: 0 });

    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0]?.[0])).toContain('"runCostUsd":0.031');
  });
});
