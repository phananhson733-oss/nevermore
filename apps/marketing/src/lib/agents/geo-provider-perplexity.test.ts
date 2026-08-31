// @input  -- documented DataForSEO Perplexity payloads and injected HTTP transport
// @output -- offline proof of engine-specific requests and observed provenance
// @pos    -- Perplexity extension tests; legacy ChatGPT transport tests stay unchanged

import { describe, expect, it, vi } from "vitest";
import {
  createGeoProviderClient,
  DATAFORSEO_CHAT_GPT_LLM_RESPONSES_LIVE_URL,
  GEO_MAX_OUTPUT_TOKENS,
  GeoProviderError,
  type GeoProviderFetch,
} from "./geo-provider.ts";

const REQUEST = {
  prompt: "Which tools show whether my brand appears in AI search answers?",
  model: "gpt-5-2025-08-07",
  marketCode: "US",
} as const;

/** Mirrors the documented Live Perplexity result, including its null spans. */
function payload(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    status_code: 20_000,
    cost: 0.01,
    tasks_count: 1,
    tasks_error: 0,
    tasks: [{
      id: "08311200-1234-0616-0000-abcdef012345",
      status_code: 20_000,
      cost: 0.01,
      result_count: 1,
      result: [{
        model_name: "sonar-observed-version",
        datetime: "2026-08-31 12:00:00 +00:00",
        web_search: true,
        input_tokens: 16,
        output_tokens: 60,
        money_spent: 0.005,
        items: [{
          type: "message",
          sections: [{
            type: "text",
            text: "Acme is one option [1].",
            annotations: [{
              title: "Acme pricing",
              url: "https://www.acme.test/pricing",
              start_index: null,
              end_index: null,
              text: null,
            }],
          }],
        }],
        fan_out_queries: null,
        ...overrides,
      }],
    }],
  };
}

function respondWith(value: unknown): GeoProviderFetch {
  return vi.fn(async () => new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  }));
}

function client(fetchImpl: GeoProviderFetch) {
  return createGeoProviderClient({
    login: "test-login",
    password: "test-password",
    fetchImpl,
  });
}

describe("GEO provider engine selection", () => {
  it("uses the Sonar live endpoint without a ChatGPT web_search request flag", async () => {
    const fetchImpl = respondWith(payload());
    await client(fetchImpl).observe({ ...REQUEST, engine: "perplexity" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0]!;
    expect(url).toBe("https://api.dataforseo.com/v3/ai_optimization/perplexity/llm_responses/live");
    expect(init?.redirect).toBe("error");
    expect(JSON.parse(String(init?.body))).toEqual([{
      user_prompt: REQUEST.prompt,
      model_name: "sonar",
      max_output_tokens: GEO_MAX_OUTPUT_TOKENS,
      web_search_country_iso_code: "US",
    }]);
    expect(GEO_MAX_OUTPUT_TOKENS).toBeLessThanOrEqual(4096);
  });

  it.each([undefined, "chatgpt"] as const)("keeps the exact ChatGPT request for engine=%s", async (engine) => {
    const fetchImpl = respondWith(payload());
    await client(fetchImpl).observe({ ...REQUEST, ...(engine ? { engine } : {}) });

    const [url, init] = vi.mocked(fetchImpl).mock.calls[0]!;
    expect(url).toBe(DATAFORSEO_CHAT_GPT_LLM_RESPONSES_LIVE_URL);
    expect(JSON.parse(String(init?.body))).toEqual([{
      user_prompt: REQUEST.prompt,
      model_name: REQUEST.model,
      max_output_tokens: GEO_MAX_OUTPUT_TOKENS,
      web_search: true,
      web_search_country_iso_code: "US",
    }]);
  });

  it.each([
    { engine: "chatgpt", expectedMs: 90_000 },
    { engine: "perplexity", expectedMs: 120_000 },
    { engine: "perplexity", timeoutMs: 17, expectedMs: 17 },
  ] as const)("uses the bounded $engine deadline $expectedMs with override precedence", async (testCase) => {
    vi.useFakeTimers();
    try {
      const fetchImpl: GeoProviderFetch = vi.fn(async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
      );
      const provider = createGeoProviderClient({
        login: "test-login",
        password: "test-password",
        fetchImpl,
        ...("timeoutMs" in testCase ? { timeoutMs: testCase.timeoutMs } : {}),
      });
      const result = provider.observe({ ...REQUEST, engine: testCase.engine })
        .catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(testCase.expectedMs - 1);
      expect(vi.mocked(fetchImpl).mock.calls[0]![1]?.signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await result).toMatchObject({ reason: "timeout", costUsd: null });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("GEO provider observed provenance", () => {
  it("keeps the effective request model apart from the model and task actually returned", async () => {
    const observation = await client(respondWith(payload())).observe({
      ...REQUEST, engine: "perplexity",
    });

    expect(observation).toMatchObject({
      model: "sonar-observed-version",
      modelRequested: "sonar",
      modelObserved: "sonar-observed-version",
      providerTaskId: "08311200-1234-0616-0000-abcdef012345",
    });
  });

  it("does not substitute the request model or a synthetic task id for missing provenance", async () => {
    const fixture = payload({ model_name: null });
    const response = {
      ...fixture,
      tasks: fixture.tasks.map((task) => ({ ...task, id: null })),
    };
    const observation = await client(respondWith(response)).observe({
      ...REQUEST, engine: "perplexity",
    });

    expect(observation).toMatchObject({
      model: "unknown",
      modelRequested: "sonar",
      modelObserved: null,
      providerTaskId: null,
    });
  });

  it("exposes explicit requested and observed provenance for legacy ChatGPT too", async () => {
    const observation = await client(respondWith(payload({
      model_name: "gpt-observed-version",
    }))).observe(REQUEST);

    expect(observation.modelRequested).toBe(REQUEST.model);
    expect(observation.modelObserved).toBe("gpt-observed-version");
  });

  it.each([true, false, null, undefined] as const)("retains Perplexity web_search=%s without inferring from Sonar or citations", async (web_search) => {
    const observation = await client(respondWith(payload({ web_search }))).observe({
      ...REQUEST, engine: "perplexity",
    });

    expect(observation.webSearchPerformed).toBe(web_search ?? null);
    expect(observation.citations).toHaveLength(1);
  });

  it.each([null, undefined] as const)("preserves ChatGPT fail-closed behavior when web_search=%s", async (web_search) => {
    await expect(client(respondWith(payload({ web_search }))).observe(REQUEST))
      .rejects.toMatchObject({ reason: "invalid_response", costUsd: 0.01 });
  });

  it("preserves Perplexity annotations without inventing missing text or span offsets", async () => {
    const observation = await client(respondWith(payload())).observe({
      ...REQUEST, engine: "perplexity",
    });

    expect(observation.citationsComplete).toBe(true);
    expect(observation.citations).toEqual([{
      url: "https://www.acme.test/pricing",
      title: "Acme pricing",
      annotationText: null,
      providerOutputItemIndex: 0,
      sectionIndex: 0,
      annotationOrdinal: 0,
      startIndex: null,
      endIndex: null,
      spanBasis: "provider_message_section_text",
    }]);
  });

  it("books task cost once instead of adding envelope or token cost", async () => {
    const observation = await client(respondWith(payload())).observe({
      ...REQUEST, engine: "perplexity",
    });

    expect(observation.costUsd).toBe(0.01);
  });

  it("makes no automatic retry after an ambiguous Perplexity network failure", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("socket closed"); });
    await expect(client(fetchImpl).observe({ ...REQUEST, engine: "perplexity" }))
      .rejects.toBeInstanceOf(GeoProviderError);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
