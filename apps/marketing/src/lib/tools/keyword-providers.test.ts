import {
  SourceError,
  type DataForSeoKeywordMetricsClient,
  type DataForSeoSerpOrganicResponse,
} from "@sf/sources";
import { describe, expect, it, vi } from "vitest";
import { createKeywordCostAccumulator } from "./keyword-cost-guard.ts";
import type { KeywordSerpSampleResult } from "./keyword-opportunity-handler.ts";
import {
  createKeywordProviderSeams,
  KEYWORD_SERP_CONCURRENCY,
  MAX_KEYWORD_RDAP_CONCURRENCY,
} from "./keyword-providers.ts";

const OBSERVED_AT = "2026-08-20T12:00:00.000Z";

function serpResponse(
  keyword: string,
  overrides: Partial<DataForSeoSerpOrganicResponse> = {},
): DataForSeoSerpOrganicResponse {
  return {
    keyword,
    rows: [
      {
        rankGroup: 1,
        domain: "publisher.test",
        sitelinkCount: 0,
        title: `${keyword} guide`,
        url: `https://publisher.test/${encodeURIComponent(keyword)}`,
      },
    ],
    itemTypes: ["organic"],
    aiOverview: null,
    communityItems: [],
    unresolvedItemCount: 0,
    costUsd: 0.002,
    providerStatusCode: 20_000,
    taskStatusCode: 20_000,
    ...overrides,
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function afterMicrotasks<T>(turns: number, value: T): Promise<T> {
  for (let turn = 0; turn < turns; turn += 1) {
    await Promise.resolve();
  }
  return value;
}

describe("createKeywordProviderSeams", () => {
  it("requests async AIO and preserves every typed SERP field unchanged", async () => {
    const serpOrganic = vi.fn(async () => ({
      keyword: "agency crm",
      rows: [
        {
          rankGroup: 2,
          domain: "publisher.test",
          sitelinkCount: 0,
          title: "Agency CRM guide",
          url: "https://publisher.test/agency-crm",
        },
      ],
      itemTypes: ["organic", "ai_overview", "discussions_and_forums"],
      aiOverview: {
        markdown: "## Answer",
        isAsync: true,
        references: [
          {
            source: "Reference publisher",
            domain: "reference.test",
            title: "Reference",
            url: "https://reference.test/source",
          },
        ],
      },
      communityItems: [
        {
          type: "discussions_and_forums" as const,
          position: 5,
          title: "Operators compare CRMs",
          url: "https://forum.test/thread",
          domain: "forum.test",
        },
      ],
      unresolvedItemCount: 0,
      costUsd: 0.004,
      providerStatusCode: 20_000,
      taskStatusCode: 20_000,
    }));
    const client: DataForSeoKeywordMetricsClient = {
      keywordOverview: vi.fn(),
      serpOrganic,
      bulkRanks: vi.fn(),
    };
    const costs = createKeywordCostAccumulator();
    const providers = createKeywordProviderSeams({
      costs,
      client,
      now: () => new Date(OBSERVED_AT),
    });

    const result = await providers.sampleSerp({
      keywords: ["agency crm"],
      marketCode: "US",
      languageCode: "en",
    });

    expect(serpOrganic).toHaveBeenCalledWith(
      {
        keyword: "agency crm",
        locationCode: 2840,
        languageCode: "en",
        loadAsyncAiOverview: true,
      },
      expect.any(AbortSignal),
    );
    expect(result).toEqual([
      {
        keyword: "agency crm",
        status: "complete",
        failureReason: null,
        observedAt: OBSERVED_AT,
        results: [
          {
            domain: "publisher.test",
            position: 2,
            title: "Agency CRM guide",
            url: "https://publisher.test/agency-crm",
          },
        ],
        pageItemTypes: ["organic", "ai_overview", "discussions_and_forums"],
        aiOverview: {
          markdown: "## Answer",
          isAsync: true,
          references: [
            {
              source: "Reference publisher",
              domain: "reference.test",
              title: "Reference",
              url: "https://reference.test/source",
            },
          ],
        },
        communityItems: [
          {
            type: "discussions_and_forums",
            position: 5,
            title: "Operators compare CRMs",
            url: "https://forum.test/thread",
            domain: "forum.test",
          },
        ],
      },
    ]);
    expect(costs.byEndpoint().serp_organic).toBe(0.004);
  });

  it("uses provider_no_data only when no usable SERP shape was returned", async () => {
    const responses = [
      {
        keyword: "unreported",
        rows: [],
        itemTypes: null,
        aiOverview: null,
        communityItems: null,
        unresolvedItemCount: 0,
        costUsd: 0.002,
        providerStatusCode: 20_000,
        taskStatusCode: 20_000,
      },
      {
        keyword: "observed empty",
        rows: [],
        itemTypes: [],
        aiOverview: null,
        communityItems: [],
        unresolvedItemCount: 0,
        costUsd: 0.002,
        providerStatusCode: 20_000,
        taskStatusCode: 20_000,
      },
    ];
    const client: DataForSeoKeywordMetricsClient = {
      keywordOverview: vi.fn(),
      serpOrganic: vi.fn(async () => responses.shift()!),
      bulkRanks: vi.fn(),
    };
    const providers = createKeywordProviderSeams({
      costs: createKeywordCostAccumulator(),
      client,
    });

    const result = await providers.sampleSerp({
      keywords: ["unreported", "observed empty"],
      marketCode: "US",
      languageCode: "en",
    });

    expect(result).toEqual([
      {
        keyword: "unreported",
        status: "unavailable",
        failureReason: "provider_no_data",
        observedAt: null,
        results: [],
        pageItemTypes: null,
        aiOverview: null,
        communityItems: null,
      },
      {
        keyword: "observed empty",
        status: "complete",
        failureReason: null,
        observedAt: expect.any(String),
        results: [],
        pageItemTypes: [],
        aiOverview: null,
        communityItems: [],
      },
    ]);
  });

  it("dispatches no further wave once the run deadline has passed", async () => {
    const keywords = Array.from(
      { length: 25 },
      (_unused, index) => `keyword ${String(index)}`,
    );
    let clock = 1_000;
    const deadlineAt = clock + 60_000;
    const serpOrganic = vi.fn(
      async ({ keyword }: { readonly keyword: string }) => {
        // The whole budget goes to the first wave of ten.
        clock += 6_000;
        return serpResponse(keyword);
      },
    );
    const providers = createKeywordProviderSeams({
      costs: createKeywordCostAccumulator(),
      client: {
        keywordOverview: vi.fn(),
        serpOrganic,
        bulkRanks: vi.fn(),
      },
      now: () => new Date(clock),
      deadlineAt,
    });

    const result = await providers.sampleSerp({
      keywords,
      marketCode: "US",
      languageCode: "en",
    });

    // Fifteen serial waves at the candidate cap, each as slow as the slowest
    // of its ten calls, is more wall clock than the route has in total. The
    // stage has to stop on its own or the platform stops the whole function.
    expect(serpOrganic).toHaveBeenCalledTimes(KEYWORD_SERP_CONCURRENCY);
    expect(result).toHaveLength(keywords.length);
    expect(result.map((sample) => sample.keyword)).toEqual(keywords);
    // What it did sample is kept.
    expect(
      result.slice(0, 10).every((sample) => sample.status === "complete"),
    ).toBe(true);
    // Nobody asked about the rest, so they may not say the provider failed.
    for (const sample of result.slice(10)) {
      expect(sample).toMatchObject({
        status: "unavailable",
        failureReason: "budget_exhausted",
        observedAt: null,
        results: [],
      });
    }
  });

  it("stops waiting on a wave that outlives the deadline it started under", async () => {
    const keywords = ["fast", "hung"];
    const fast = deferred<DataForSeoSerpOrganicResponse>();
    const serpOrganic = vi.fn(({ keyword }: { readonly keyword: string }) =>
      keyword === "fast"
        ? fast.promise
        : new Promise<DataForSeoSerpOrganicResponse>(() => {}),
    );
    const providers = createKeywordProviderSeams({
      costs: createKeywordCostAccumulator(),
      client: {
        keywordOverview: vi.fn(),
        serpOrganic,
        bulkRanks: vi.fn(),
      },
      now: () => new Date(1_000),
      deadlineAt: 1_000 + 50,
    });

    const pending = providers.sampleSerp({
      keywords,
      marketCode: "US",
      languageCode: "en",
    });
    await vi.waitFor(() => expect(serpOrganic).toHaveBeenCalledTimes(2));
    fast.resolve(serpResponse("fast"));
    const result = await pending;

    // Declining the next wave would not have been enough: one straggler holds
    // the other nine for its full per-call timeout, and a timeout here is
    // per-keyword rather than stage-wide, so the stage never fails fast.
    expect(result[0]).toMatchObject({ keyword: "fast", status: "complete" });
    // Asked and never answered is not the same fact as never asked.
    expect(result[1]).toMatchObject({
      keyword: "hung",
      status: "unavailable",
      failureReason: "transport_outcome_unknown",
    });
  });

  it("ignores a late empty-handed answer that arrives after the deadline outcome", async () => {
    const late = deferred<DataForSeoSerpOrganicResponse>();
    const serpOrganic = vi.fn(() => late.promise);
    const providers = createKeywordProviderSeams({
      costs: createKeywordCostAccumulator(),
      client: {
        keywordOverview: vi.fn(),
        serpOrganic,
        bulkRanks: vi.fn(),
      },
      now: () => new Date(1_000),
      deadlineAt: 1_000 + 50,
    });

    const pending = providers.sampleSerp({
      keywords: ["slow"],
      marketCode: "US",
      languageCode: "en",
    });
    const result = await pending;
    expect(result[0]).toMatchObject({
      keyword: "slow",
      failureReason: "transport_outcome_unknown",
    });

    // The provider finally answers — with nothing. Writing that now would
    // convert "we stopped waiting" into "the provider had no data", a fact
    // this run never established, and it would mutate an array the caller is
    // already holding.
    late.resolve({
      keyword: "slow",
      rows: [],
      itemTypes: null,
      aiOverview: null,
      communityItems: null,
      unresolvedItemCount: 0,
      costUsd: 0.002,
      providerStatusCode: 20_000,
      taskStatusCode: 20_000,
    });
    await afterMicrotasks(5, null);

    expect(result[0]).toMatchObject({
      keyword: "slow",
      status: "unavailable",
      failureReason: "transport_outcome_unknown",
    });
  });

  it("gates 25 calls at ten workers and preserves the immutable input order", async () => {
    const keywords = Object.freeze(
      Array.from({ length: 25 }, (_, index) => `keyword ${String(index)}`),
    );
    const gate = deferred<void>();
    let active = 0;
    let maxActive = 0;
    const serpOrganic = vi.fn(
      async ({ keyword }: { readonly keyword: string }) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await gate.promise;
        active -= 1;
        return serpResponse(keyword);
      },
    );
    const providers = createKeywordProviderSeams({
      costs: createKeywordCostAccumulator(),
      client: {
        keywordOverview: vi.fn(),
        serpOrganic,
        bulkRanks: vi.fn(),
      },
      now: () => new Date(OBSERVED_AT),
    });

    const pending = providers.sampleSerp({
      keywords,
      marketCode: "US",
      languageCode: "en",
    });
    try {
      await vi.waitFor(() => expect(serpOrganic).toHaveBeenCalledTimes(10));
      expect(KEYWORD_SERP_CONCURRENCY).toBe(10);
      expect(active).toBe(10);
      expect(maxActive).toBe(10);
      expect(keywords).toEqual(
        Array.from({ length: 25 }, (_, index) => `keyword ${String(index)}`),
      );
    } finally {
      gate.resolve();
    }

    const result = await pending;
    expect(serpOrganic).toHaveBeenCalledTimes(25);
    expect(maxActive).toBe(10);
    expect(result.map((sample) => sample.keyword)).toEqual(keywords);
    expect(result.every((sample) => sample.status === "complete")).toBe(true);
  });

  it("returns input order when provider calls finish out of order", async () => {
    const keywords: readonly string[] = ["first", "second", "third"];
    const calls = new Map(
      keywords.map((keyword) => [
        keyword,
        deferred<DataForSeoSerpOrganicResponse>(),
      ]),
    );
    const serpOrganic = vi.fn(
      ({ keyword }: { readonly keyword: string }) =>
        calls.get(keyword)!.promise,
    );
    const providers = createKeywordProviderSeams({
      costs: createKeywordCostAccumulator(),
      client: {
        keywordOverview: vi.fn(),
        serpOrganic,
        bulkRanks: vi.fn(),
      },
      now: () => new Date(OBSERVED_AT),
    });

    const pending = providers.sampleSerp({
      keywords,
      marketCode: "US",
      languageCode: "en",
    });
    await vi.waitFor(() => expect(serpOrganic).toHaveBeenCalledTimes(3));
    calls.get("third")!.resolve(serpResponse("third"));
    calls.get("second")!.resolve(serpResponse("second"));
    calls.get("first")!.resolve(serpResponse("first"));

    await expect(pending).resolves.toMatchObject([
      { keyword: "first", status: "complete" },
      { keyword: "second", status: "complete" },
      { keyword: "third", status: "complete" },
    ]);
  });

  it("isolates three query-specific provider failures among successful calls", async () => {
    const failures = new Map([
      ["rate limited", new SourceError("RATE_LIMITED", "fixture")],
      ["network", new SourceError("NETWORK_ERROR", "fixture")],
      ["unavailable", new SourceError("UNAVAILABLE", "fixture")],
    ]);
    const keywords = ["ok one", ...failures.keys(), "ok two"];
    const serpOrganic = vi.fn(
      async ({ keyword }: { readonly keyword: string }) => {
        const failure = failures.get(keyword);
        if (failure !== undefined) throw failure;
        return serpResponse(keyword);
      },
    );
    const providers = createKeywordProviderSeams({
      costs: createKeywordCostAccumulator(),
      client: {
        keywordOverview: vi.fn(),
        serpOrganic,
        bulkRanks: vi.fn(),
      },
      now: () => new Date(OBSERVED_AT),
    });

    const result = await providers.sampleSerp({
      keywords,
      marketCode: "US",
      languageCode: "en",
    });

    expect(serpOrganic).toHaveBeenCalledTimes(keywords.length);
    expect(
      result.map(({ keyword, status, failureReason }) => ({
        keyword,
        status,
        failureReason,
      })),
    ).toEqual([
      { keyword: "ok one", status: "complete", failureReason: null },
      {
        keyword: "rate limited",
        status: "unavailable",
        failureReason: "provider_unavailable",
      },
      {
        keyword: "network",
        status: "unavailable",
        failureReason: "provider_unavailable",
      },
      {
        keyword: "unavailable",
        status: "unavailable",
        failureReason: "provider_unavailable",
      },
      { keyword: "ok two", status: "complete", failureReason: null },
    ]);
    expect(result[1]).toMatchObject({
      observedAt: null,
      results: [],
      pageItemTypes: null,
      aiOverview: null,
      communityItems: null,
    });
  });

  it("maps timeout to outcome unknown without retrying", async () => {
    const serpOrganic = vi.fn(async () => {
      throw new SourceError("TIMEOUT", "fixture timeout");
    });
    const providers = createKeywordProviderSeams({
      costs: createKeywordCostAccumulator(),
      client: {
        keywordOverview: vi.fn(),
        serpOrganic,
        bulkRanks: vi.fn(),
      },
    });

    await expect(
      providers.sampleSerp({
        keywords: ["one attempt"],
        marketCode: "US",
        languageCode: "en",
      }),
    ).resolves.toEqual([
      {
        keyword: "one attempt",
        status: "unavailable",
        failureReason: "transport_outcome_unknown",
        observedAt: null,
        results: [],
        pageItemTypes: null,
        aiOverview: null,
        communityItems: null,
      },
    ]);
    expect(serpOrganic).toHaveBeenCalledTimes(1);
  });

  it.each([
    "AUTH_REQUIRED",
    "PERMISSION_DENIED",
    "INVALID_CONFIGURATION",
  ] as const)(
    "fails the whole stage on %s, aborts siblings, and dispatches no future calls",
    async (code) => {
      const keywords = Array.from(
        { length: 25 },
        (_, index) => `keyword ${String(index)}`,
      );
      const initialStarted = deferred<void>();
      const stageError = new SourceError(code, "stage-wide fixture");
      let abortedSiblings = 0;
      const signals: AbortSignal[] = [];
      const serpOrganic = vi.fn(
        async (
          { keyword }: { readonly keyword: string },
          signal?: AbortSignal,
        ): Promise<DataForSeoSerpOrganicResponse> => {
          if (signal === undefined) throw new Error("missing shared signal");
          signals.push(signal);
          if (signals.length === KEYWORD_SERP_CONCURRENCY) {
            initialStarted.resolve();
          }
          await initialStarted.promise;
          if (keyword === keywords[0]) throw stageError;
          return await new Promise<DataForSeoSerpOrganicResponse>(
            (_resolve, reject) => {
              const onAbort = (): void => {
                abortedSiblings += 1;
                reject(new SourceError("TIMEOUT", "aborted sibling"));
              };
              if (signal.aborted) onAbort();
              else signal.addEventListener("abort", onAbort, { once: true });
            },
          );
        },
      );
      const providers = createKeywordProviderSeams({
        costs: createKeywordCostAccumulator(),
        client: {
          keywordOverview: vi.fn(),
          serpOrganic,
          bulkRanks: vi.fn(),
        },
      });

      await expect(
        providers.sampleSerp({
          keywords,
          marketCode: "US",
          languageCode: "en",
        }),
      ).rejects.toBe(stageError);
      expect(serpOrganic).toHaveBeenCalledTimes(KEYWORD_SERP_CONCURRENCY);
      expect(new Set(signals)).toHaveLength(1);
      expect(signals[0]?.aborted).toBe(true);
      expect(abortedSiblings).toBe(KEYWORD_SERP_CONCURRENCY - 1);
    },
  );

  it("does not replenish a successful first-wave slot before delayed auth settles", async () => {
    const keywords = Array.from(
      { length: 12 },
      (_, index) => `keyword ${String(index)}`,
    );
    const authGate = deferred<void>();
    const authError = new SourceError("AUTH_REQUIRED", "delayed auth fixture");
    const costs = createKeywordCostAccumulator();
    const serpOrganic = vi.fn(
      async (
        { keyword }: { readonly keyword: string },
        signal?: AbortSignal,
      ): Promise<DataForSeoSerpOrganicResponse> => {
        if (signal === undefined) throw new Error("missing shared signal");
        if (keyword === keywords[0]) return serpResponse(keyword);
        if (keyword === keywords[1]) {
          await authGate.promise;
          throw authError;
        }
        return await new Promise<DataForSeoSerpOrganicResponse>(
          (_resolve, reject) => {
            const onAbort = (): void => {
              reject(new SourceError("TIMEOUT", "aborted sibling"));
            };
            if (signal.aborted) onAbort();
            else signal.addEventListener("abort", onAbort, { once: true });
          },
        );
      },
    );
    const providers = createKeywordProviderSeams({
      costs,
      client: {
        keywordOverview: vi.fn(),
        serpOrganic,
        bulkRanks: vi.fn(),
      },
    });

    const pending = providers.sampleSerp({
      keywords,
      marketCode: "US",
      languageCode: "en",
    });
    await vi.waitFor(() => expect(costs.byEndpoint().serp_organic).toBe(0.002));
    const callsBeforeAuth = serpOrganic.mock.calls.map(
      ([request]) => request.keyword,
    );
    authGate.resolve();

    await expect(pending).rejects.toBe(authError);
    expect(callsBeforeAuth).toEqual(
      keywords.slice(0, KEYWORD_SERP_CONCURRENCY),
    );
    expect(serpOrganic).toHaveBeenCalledTimes(KEYWORD_SERP_CONCURRENCY);
    expect(
      serpOrganic.mock.calls.some(
        ([request]) => request.keyword === keywords[KEYWORD_SERP_CONCURRENCY],
      ),
    ).toBe(false);
  });

  it("rejects promptly on auth even when a current-wave sibling ignores abort", async () => {
    const keywords = Array.from(
      { length: 12 },
      (_, index) => `keyword ${String(index)}`,
    );
    const authGate = deferred<void>();
    const abortObserved = deferred<void>();
    const stubbornResponse = deferred<DataForSeoSerpOrganicResponse>();
    const stubbornReturned = deferred<void>();
    const authError = new SourceError("AUTH_REQUIRED", "prompt auth fixture");
    const costs = createKeywordCostAccumulator();
    const serpOrganic = vi.fn(
      async (
        { keyword }: { readonly keyword: string },
        signal?: AbortSignal,
      ): Promise<DataForSeoSerpOrganicResponse> => {
        if (signal === undefined) throw new Error("missing shared signal");
        if (keyword === keywords[0]) {
          await authGate.promise;
          throw authError;
        }
        if (keyword === keywords[1]) {
          signal.addEventListener("abort", () => abortObserved.resolve(), {
            once: true,
          });
          const response = await stubbornResponse.promise;
          stubbornReturned.resolve();
          return response;
        }
        return serpResponse(keyword, { costUsd: 0 });
      },
    );
    const providers = createKeywordProviderSeams({
      costs,
      client: {
        keywordOverview: vi.fn(),
        serpOrganic,
        bulkRanks: vi.fn(),
      },
    });

    const pending = providers.sampleSerp({
      keywords,
      marketCode: "US",
      languageCode: "en",
    });
    const outcome = pending.then(
      () => ({ kind: "resolved" as const }),
      (error: unknown) => ({ kind: "rejected" as const, error }),
    );
    authGate.resolve();
    await abortObserved.promise;
    const promptOutcome = await Promise.race([
      outcome,
      afterMicrotasks(20, { kind: "pending" as const }),
    ]);

    stubbornResponse.resolve(
      serpResponse(keywords[1]!, {
        costUsd: 0.007,
      }),
    );
    await stubbornReturned.promise;
    await afterMicrotasks(4, undefined);
    const finalOutcome = await outcome;

    expect(promptOutcome).toEqual({ kind: "rejected", error: authError });
    expect(finalOutcome).toEqual({ kind: "rejected", error: authError });
    expect(serpOrganic).toHaveBeenCalledTimes(KEYWORD_SERP_CONCURRENCY);
    expect(costs.byEndpoint().serp_organic).toBe(0.007);
  });

  it("keeps the first observed stage-wide error when another arrives later", async () => {
    const keywords = Array.from(
      { length: 12 },
      (_, index) => `keyword ${String(index)}`,
    );
    const permissionGate = deferred<void>();
    const authGate = deferred<void>();
    const abortObserved = deferred<void>();
    const authThrown = deferred<void>();
    const permissionError = new SourceError(
      "PERMISSION_DENIED",
      "first stage error",
    );
    const authError = new SourceError("AUTH_REQUIRED", "later stage error");
    const serpOrganic = vi.fn(
      async (
        { keyword }: { readonly keyword: string },
        signal?: AbortSignal,
      ): Promise<DataForSeoSerpOrganicResponse> => {
        if (signal === undefined) throw new Error("missing shared signal");
        if (keyword === keywords[0]) {
          await permissionGate.promise;
          throw permissionError;
        }
        if (keyword === keywords[1]) {
          signal.addEventListener("abort", () => abortObserved.resolve(), {
            once: true,
          });
          await authGate.promise;
          authThrown.resolve();
          throw authError;
        }
        return serpResponse(keyword, { costUsd: 0 });
      },
    );
    const providers = createKeywordProviderSeams({
      costs: createKeywordCostAccumulator(),
      client: {
        keywordOverview: vi.fn(),
        serpOrganic,
        bulkRanks: vi.fn(),
      },
    });

    const outcome = providers
      .sampleSerp({
        keywords,
        marketCode: "US",
        languageCode: "en",
      })
      .then(
        () => ({ kind: "resolved" as const }),
        (error: unknown) => ({ kind: "rejected" as const, error }),
      );
    permissionGate.resolve();
    await abortObserved.promise;
    authGate.resolve();
    await authThrown.promise;

    await expect(outcome).resolves.toEqual({
      kind: "rejected",
      error: permissionError,
    });
    expect(serpOrganic).toHaveBeenCalledTimes(KEYWORD_SERP_CONCURRENCY);
    expect(
      serpOrganic.mock.calls.some(
        ([request]) => request.keyword === keywords[KEYWORD_SERP_CONCURRENCY],
      ),
    ).toBe(false);
  });

  it("records cost exactly once for each provider response and never for a thrown call", async () => {
    const costs = createKeywordCostAccumulator();
    const record = vi.spyOn(costs, "record");
    const serpOrganic = vi.fn(
      async ({ keyword }: { readonly keyword: string }) => {
        if (keyword === "throws") {
          throw new SourceError("UNAVAILABLE", "fixture");
        }
        if (keyword === "no data") {
          return serpResponse(keyword, {
            rows: [],
            itemTypes: null,
            aiOverview: null,
            communityItems: null,
            costUsd: 0.004,
            providerStatusCode: 40_102,
            taskStatusCode: 40_102,
          });
        }
        return serpResponse(keyword, { costUsd: 0.003 });
      },
    );
    const providers = createKeywordProviderSeams({
      costs,
      client: {
        keywordOverview: vi.fn(),
        serpOrganic,
        bulkRanks: vi.fn(),
      },
    });

    const result = await providers.sampleSerp({
      keywords: ["complete", "no data", "throws"],
      marketCode: "US",
      languageCode: "en",
    });

    expect(result).toHaveLength(3);
    expect(record).toHaveBeenCalledTimes(2);
    expect(costs.byEndpoint().serp_organic).toBe(0.007);
  });

  it("keeps old injected handler samples compatible without status metadata", () => {
    const legacySample: KeywordSerpSampleResult = {
      keyword: "legacy fixture",
      results: [{ domain: "legacy.test", position: 3 }],
      pageItemTypes: null,
    };

    expect(legacySample).not.toHaveProperty("status");
    expect(legacySample.results[0]).not.toHaveProperty("title");
  });

  it("deduplicates domains, passes the market-specific Labs pair, and preserves zero/null traffic", async () => {
    const estimateTraffic = vi.fn(
      async (input: { readonly onCost?: (costUsd: number) => void }) => {
        input.onCost?.(0.012);
        return {
          rows: [
            {
              target: "WWW.Example.COM.",
              normalizedTarget: "example.com",
              organicEtv: 0,
            },
            {
              target: "publisher.com",
              normalizedTarget: "publisher.com",
              organicEtv: null,
            },
          ],
          unresolvedTargets: ["missing.com"],
          costUsd: 0.012,
          batchCount: 1,
          providerStatusCodes: [20_000],
          taskStatusCodes: [20_000],
        };
      },
    );
    const client: DataForSeoKeywordMetricsClient = {
      keywordOverview: vi.fn(),
      serpOrganic: vi.fn(),
      bulkRanks: vi.fn(),
    };
    const costs = createKeywordCostAccumulator();
    const providers = createKeywordProviderSeams({
      costs,
      client,
      login: "fixture-login",
      password: "fixture-password",
      estimateTraffic,
    });

    const result = await providers.resolveDomainTraffic({
      domains: [
        "WWW.Example.COM.",
        "news.example.com",
        "publisher.com",
        "missing.com",
      ],
      marketCode: "US",
    });

    expect(estimateTraffic).toHaveBeenCalledWith({
      login: "fixture-login",
      password: "fixture-password",
      targets: ["example.com", "publisher.com", "missing.com"],
      marketCode: "US",
      locationCode: 2840,
      languageCode: "en",
      onCost: expect.any(Function),
    });
    expect([...result!.entries()]).toEqual([
      ["example.com", 0],
      ["publisher.com", null],
      ["missing.com", null],
    ]);
    expect(costs.byEndpoint().bulk_traffic).toBe(0.012);
  });

  it("keeps a failed bulk traffic pass unavailable rather than returning a partial map", async () => {
    const providers = createKeywordProviderSeams({
      costs: createKeywordCostAccumulator(),
      client: {
        keywordOverview: vi.fn(),
        serpOrganic: vi.fn(),
        bulkRanks: vi.fn(),
      },
      estimateTraffic: vi.fn(async () => null),
    });

    await expect(
      providers.resolveDomainTraffic({
        domains: ["example.com"],
        marketCode: "US",
      }),
    ).resolves.toBeNull();
  });

  it("books successful traffic batches even when a later batch fails", async () => {
    const costs = createKeywordCostAccumulator();
    const estimateTraffic = vi.fn(
      async (input: { readonly onCost?: (costUsd: number) => void }) => {
        input.onCost?.(0.011);
        return null;
      },
    );
    const providers = createKeywordProviderSeams({
      costs,
      client: {
        keywordOverview: vi.fn(),
        serpOrganic: vi.fn(),
        bulkRanks: vi.fn(),
      },
      estimateTraffic,
    });

    await expect(
      providers.resolveDomainTraffic({
        domains: ["example.com"],
        marketCode: "US",
      }),
    ).resolves.toBeNull();
    expect(costs.byEndpoint().bulk_traffic).toBe(0.011);
  });

  it("fails the whole traffic seam closed before estimation when any domain is invalid", async () => {
    const estimateTraffic = vi.fn(async () => null);
    const providers = createKeywordProviderSeams({
      costs: createKeywordCostAccumulator(),
      client: {
        keywordOverview: vi.fn(),
        serpOrganic: vi.fn(),
        bulkRanks: vi.fn(),
      },
      estimateTraffic,
    });

    await expect(
      providers.resolveDomainTraffic({
        domains: ["example.com", "foo_bar.com"],
        marketCode: "US",
      }),
    ).resolves.toBeNull();
    expect(estimateTraffic).not.toHaveBeenCalled();
  });

  it("shares one request-local RDAP promise for duplicate registrable domains", async () => {
    let release: (() => void) | undefined;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const resolveRegistration = vi.fn(async (domain: string) => {
      await wait;
      return {
        domain,
        availability: "available" as const,
        registeredAt: "2025-01-02T03:04:05.000Z",
        observedAt: "2026-08-20T12:00:00.000Z",
        sourceHost: "rdap.registry.test",
        reason: null,
      };
    });
    const providers = createKeywordProviderSeams({
      costs: createKeywordCostAccumulator(),
      client: {
        keywordOverview: vi.fn(),
        serpOrganic: vi.fn(),
        bulkRanks: vi.fn(),
      },
      resolveRegistration,
    });

    const first = providers.resolveDomainRegistrations([
      "WWW.Example.COM.",
      "other.com",
    ]);
    const second = providers.resolveDomainRegistrations(["news.example.com"]);
    await vi.waitFor(() =>
      expect(resolveRegistration).toHaveBeenCalledTimes(2),
    );
    release?.();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(resolveRegistration.mock.calls.map(([domain]) => domain)).toEqual([
      "example.com",
      "other.com",
    ]);
    expect(firstResult.get("example.com")).toEqual(
      secondResult.get("example.com"),
    );
  });

  it("passes RDAP unavailability through without inventing a registration date", async () => {
    const evidence = {
      domain: "missing.com",
      availability: "unavailable" as const,
      registeredAt: null,
      observedAt: "2026-08-20T12:00:00.000Z",
      sourceHost: "rdap.registry.test",
      reason: "registration_event_missing" as const,
    };
    const providers = createKeywordProviderSeams({
      costs: createKeywordCostAccumulator(),
      client: {
        keywordOverview: vi.fn(),
        serpOrganic: vi.fn(),
        bulkRanks: vi.fn(),
      },
      resolveRegistration: vi.fn(async () => evidence),
    });

    const result = await providers.resolveDomainRegistrations(["missing.com"]);

    expect(result.get("missing.com")).toBe(evidence);
    expect(result.get("missing.com")?.registeredAt).toBeNull();
  });

  it("keeps invalid RDAP input as explicit unavailable evidence", async () => {
    const resolveRegistration = vi.fn(async (domain: string) =>
      domain === "foo_bar.com"
        ? {
            domain: null,
            availability: "unavailable" as const,
            registeredAt: null,
            observedAt: "2026-08-20T12:00:00.000Z",
            sourceHost: null,
            reason: "invalid_domain" as const,
          }
        : {
            domain,
            availability: "available" as const,
            registeredAt: "2025-01-01T00:00:00.000Z",
            observedAt: "2026-08-20T12:00:00.000Z",
            sourceHost: "rdap.registry.test",
            reason: null,
          },
    );
    const providers = createKeywordProviderSeams({
      costs: createKeywordCostAccumulator(),
      client: {
        keywordOverview: vi.fn(),
        serpOrganic: vi.fn(),
        bulkRanks: vi.fn(),
      },
      resolveRegistration,
    });

    const result = await providers.resolveDomainRegistrations([
      "news.example.com",
      "foo_bar.com",
      "www.example.com",
    ]);

    expect(resolveRegistration.mock.calls.map(([domain]) => domain)).toEqual([
      "example.com",
      "foo_bar.com",
    ]);
    expect(result.get("foo_bar.com")).toMatchObject({
      availability: "unavailable",
      registeredAt: null,
      reason: "invalid_domain",
    });
  });

  it("bounds RDAP fanout and preserves input order", async () => {
    let active = 0;
    let maxActive = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const resolveRegistration = vi.fn(async (domain: string) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await gate;
      active -= 1;
      return {
        domain,
        availability: "available" as const,
        registeredAt: "2025-01-01T00:00:00.000Z",
        observedAt: "2026-08-20T12:00:00.000Z",
        sourceHost: "rdap.registry.test",
        reason: null,
      };
    });
    const providers = createKeywordProviderSeams({
      costs: createKeywordCostAccumulator(),
      client: {
        keywordOverview: vi.fn(),
        serpOrganic: vi.fn(),
        bulkRanks: vi.fn(),
      },
      resolveRegistration,
    });
    const domains = Array.from(
      { length: 25 },
      (_, index) => `domain-${index}.com`,
    );

    const pending = providers.resolveDomainRegistrations(domains);
    try {
      await vi.waitFor(() =>
        expect(resolveRegistration.mock.calls.length).toBeGreaterThan(0),
      );
      await Promise.resolve();
      expect(MAX_KEYWORD_RDAP_CONCURRENCY).toBe(10);
      expect(resolveRegistration).toHaveBeenCalledTimes(10);
      expect(maxActive).toBe(10);
    } finally {
      release?.();
    }

    const result = await pending;
    expect([...result.keys()]).toEqual(domains);
    expect(resolveRegistration).toHaveBeenCalledTimes(25);
    expect(maxActive).toBe(10);
  });

  it("isolates a rejected RDAP domain and retries it on the next call", async () => {
    let retryAttempts = 0;
    const resolveRegistration = vi.fn(async (domain: string) => {
      if (domain === "retry.com" && retryAttempts++ === 0) {
        throw new Error("fixture registry outage");
      }
      return {
        domain,
        availability: "available" as const,
        registeredAt: "2025-01-01T00:00:00.000Z",
        observedAt: "2026-08-20T12:00:00.000Z",
        sourceHost: "rdap.registry.test",
        reason: null,
      };
    });
    const providers = createKeywordProviderSeams({
      costs: createKeywordCostAccumulator(),
      client: {
        keywordOverview: vi.fn(),
        serpOrganic: vi.fn(),
        bulkRanks: vi.fn(),
      },
      resolveRegistration,
      now: () => new Date("2026-08-20T12:00:00.000Z"),
    });

    const first = await providers.resolveDomainRegistrations([
      "ok.com",
      "retry.com",
    ]);
    expect(first.get("ok.com")?.availability).toBe("available");
    expect(first.get("retry.com")).toEqual({
      domain: "retry.com",
      availability: "unavailable",
      registeredAt: null,
      observedAt: "2026-08-20T12:00:00.000Z",
      sourceHost: null,
      reason: "registry_unavailable",
    });

    const second = await providers.resolveDomainRegistrations(["retry.com"]);
    expect(second.get("retry.com")?.availability).toBe("available");
    expect(
      resolveRegistration.mock.calls.filter(
        ([domain]) => domain === "retry.com",
      ),
    ).toHaveLength(2);
  });

  it("deduplicates private-suffix RDAP inputs at the ICANN domain", async () => {
    const resolveRegistration = vi.fn(async (domain: string) => ({
      domain,
      availability: "available" as const,
      registeredAt: "2025-01-01T00:00:00.000Z",
      observedAt: "2026-08-20T12:00:00.000Z",
      sourceHost: "rdap.registry.test",
      reason: null,
    }));
    const providers = createKeywordProviderSeams({
      costs: createKeywordCostAccumulator(),
      client: {
        keywordOverview: vi.fn(),
        serpOrganic: vi.fn(),
        bulkRanks: vi.fn(),
      },
      resolveRegistration,
    });

    const result = await providers.resolveDomainRegistrations([
      "foo.github.io",
      "bar.github.io",
    ]);

    expect(resolveRegistration).toHaveBeenCalledTimes(1);
    expect(resolveRegistration).toHaveBeenCalledWith("github.io");
    expect([...result.keys()]).toEqual(["github.io"]);
  });
});
