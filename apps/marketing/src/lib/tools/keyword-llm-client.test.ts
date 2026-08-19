import { describe, expect, it, vi } from "vitest";

import {
  createKeywordLlmClient,
  EMPTY_KEYWORD_LLM_USAGE,
  KEYWORD_LLM_ERROR_CODE,
  KeywordLlmError,
  MAX_KEYWORD_LLM_RESPONSE_BODY_BYTES,
  mergeKeywordLlmUsage,
  resolveKeywordLlmConfig,
  type KeywordLlmFetch,
  type KeywordLlmRequest,
} from "./keyword-llm-client.ts";

const AZURE_ENV = {
  AZURE_OPENAI_API_KEY: "azure-key",
  AZURE_OPENAI_ENDPOINT: "https://contoso.openai.azure.com/",
  AZURE_OPENAI_DEPLOYMENT: "gg-keyword-4o",
  OPENAI_API_VERSION: "2026-02-01",
  // Present on purpose: the direct pair must lose to a complete Azure set, and
  // OPENAI_MODEL must not leak into the `model` field on that path.
  OPENAI_API_KEY: "direct-key",
  OPENAI_MODEL: "gpt-direct",
} as const;

const DIRECT_ENV = {
  OPENAI_API_KEY: "direct-key",
  OPENAI_MODEL: "gpt-direct",
} as const;

const REQUEST: KeywordLlmRequest = {
  system: "system message",
  user: "user message",
  temperature: 0.3,
  maxOutputTokens: 512,
};

function completion(
  content: unknown,
  usage?: Record<string, unknown>,
): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      ...(usage === undefined ? {} : { usage }),
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

interface Capture {
  readonly calls: { url: string; init: RequestInit | undefined }[];
  readonly fetchImpl: KeywordLlmFetch;
}

function capturing(responder: () => Response | Promise<Response>): Capture {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  return {
    calls,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return responder();
    },
  };
}

function bodyOf(init: RequestInit | undefined): Record<string, unknown> {
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  return (init?.headers ?? {}) as Record<string, string>;
}

describe("resolveKeywordLlmConfig", () => {
  it("prefers a complete Azure set and names the deployment as the model", () => {
    const config = resolveKeywordLlmConfig(AZURE_ENV);

    expect(config.authScheme).toBe("api-key");
    expect(config.apiKey).toBe("azure-key");
    // The reversal that matters: Azure bills the deployment name, not OPENAI_MODEL.
    expect(config.model).toBe("gg-keyword-4o");
    expect(config.url).toBe(
      "https://contoso.openai.azure.com/openai/deployments/gg-keyword-4o/chat/completions?api-version=2026-02-01",
    );
  });

  it("keeps a path prefix on the Azure endpoint and encodes the deployment", () => {
    const config = resolveKeywordLlmConfig({
      ...AZURE_ENV,
      AZURE_OPENAI_ENDPOINT: "https://gw.example/llm/",
      AZURE_OPENAI_DEPLOYMENT: "gg keyword/4o",
    });

    expect(config.url).toBe(
      "https://gw.example/llm/openai/deployments/gg%20keyword%2F4o/chat/completions?api-version=2026-02-01",
    );
  });

  it("prefers this tool's own prefixed set, which is the only one production sets", () => {
    // The marketing project gives each tool its own prefix — `QUICK_WINS_DRAFT_*`
    // is the sibling — so one tool can be repointed or switched off without
    // touching the other. Nothing there sets the unprefixed Azure or OpenAI
    // names, so a resolver that only reads those resolves to "not configured"
    // in production no matter how the Azure resource is provisioned.
    const config = resolveKeywordLlmConfig({
      ...AZURE_ENV,
      KEYWORD_MAP_API_KEY: "scoped-key",
      KEYWORD_MAP_MODEL: "gpt-5.6-luna",
      KEYWORD_MAP_URL: "https://gw.example/deployments/x/chat/completions",
      KEYWORD_MAP_AUTH_SCHEME: "api-key",
      KEYWORD_MAP_TEMPERATURE: "1",
    });

    expect(config).toEqual({
      apiKey: "scoped-key",
      model: "gpt-5.6-luna",
      url: "https://gw.example/deployments/x/chat/completions",
      authScheme: "api-key",
      temperature: 1,
    });
  });

  it("sends the temperature the deployment pins instead of the task's choice", async () => {
    // Not a preference. The product's Azure `gpt-5.6-luna` accepts exactly 1
    // and refuses anything else outright, so the task-tuned 0.2 and 0.7 would
    // make every production call fail with a 400 that reads like an outage.
    let sent: unknown;
    const client = createKeywordLlmClient({
      config: {
        apiKey: "k",
        model: "gpt-5.6-luna",
        url: "https://llm.test/v1",
        authScheme: "api-key",
        temperature: 1,
      },
      fetchImpl: async (_url, init) => {
        sent = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "{}" } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    await client.complete({ ...REQUEST, temperature: 0.2 });

    expect((sent as { readonly temperature: number }).temperature).toBe(1);
  });

  it("leaves the task's temperature alone when the deployment pins none", async () => {
    let sent: unknown;
    const client = createKeywordLlmClient({
      config: {
        apiKey: "k",
        model: "m",
        url: "https://llm.test/v1",
        authScheme: "bearer",
        temperature: null,
      },
      fetchImpl: async (_url, init) => {
        sent = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "{}" } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    await client.complete({ ...REQUEST, temperature: 0.2 });

    expect((sent as { readonly temperature: number }).temperature).toBe(0.2);
  });

  it("falls back to the direct OpenAI pair with bearer auth", () => {
    const config = resolveKeywordLlmConfig(DIRECT_ENV);

    expect(config).toEqual({
      apiKey: "direct-key",
      model: "gpt-direct",
      url: "https://api.openai.com/v1/chat/completions",
      authScheme: "bearer",
      temperature: null,
    });
  });

  it("refuses a partial Azure set instead of silently using public OpenAI", () => {
    let thrown: unknown;
    try {
      resolveKeywordLlmConfig({
        ...DIRECT_ENV,
        AZURE_OPENAI_API_KEY: "azure-key",
        AZURE_OPENAI_ENDPOINT: "https://contoso.openai.azure.com/",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(KeywordLlmError);
    expect((thrown as KeywordLlmError).reason).toBe("not_configured");
  });

  it("rejects an Azure endpoint that is not a URL", () => {
    expect(() =>
      resolveKeywordLlmConfig({
        ...AZURE_ENV,
        AZURE_OPENAI_ENDPOINT: "not a url",
      }),
    ).toThrow(KeywordLlmError);
  });

  it("throws a handler-mappable error when nothing is configured", () => {
    let thrown: unknown;
    try {
      resolveKeywordLlmConfig({ OPENAI_MODEL: "   " });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(KeywordLlmError);
    // The code names the model stage instead of blaming the later search-data
    // validation stage, and it belongs to the surface's exhaustive error union.
    expect((thrown as KeywordLlmError).code).toBe(
      "keyword_generation_unavailable",
    );
    expect(KEYWORD_LLM_ERROR_CODE).toBe("keyword_generation_unavailable");
  });
});

describe("mergeKeywordLlmUsage", () => {
  it("treats an unreported count as unknown, not as zero", () => {
    const merged = mergeKeywordLlmUsage(
      { inputTokens: 900, outputTokens: null, requestCount: 1, retryCount: 0 },
      { inputTokens: null, outputTokens: 40, requestCount: 1, retryCount: 1 },
    );

    expect(merged).toEqual({
      inputTokens: 900,
      outputTokens: 40,
      requestCount: 2,
      retryCount: 1,
    });
  });

  it("stays unknown only when neither side reported", () => {
    expect(
      mergeKeywordLlmUsage(EMPTY_KEYWORD_LLM_USAGE, EMPTY_KEYWORD_LLM_USAGE),
    ).toEqual(EMPTY_KEYWORD_LLM_USAGE);
  });
});

describe("createKeywordLlmClient", () => {
  it("sends a JSON-mode chat request with bearer auth and no redirects", async () => {
    const capture = capturing(() => completion("{}", { prompt_tokens: 11 }));
    const client = createKeywordLlmClient({
      env: DIRECT_ENV,
      fetchImpl: capture.fetchImpl,
    });

    const result = await client.complete(REQUEST);

    expect(result.content).toBe("{}");
    expect(result.usage).toEqual({
      inputTokens: 11,
      outputTokens: null,
      requestCount: 1,
      retryCount: 0,
    });
    const call = capture.calls[0];
    expect(call.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(call.init?.redirect).toBe("error");
    expect(headersOf(call.init)["Authorization"]).toBe("Bearer direct-key");
    expect(headersOf(call.init)["api-key"]).toBeUndefined();
    const body = bodyOf(call.init);
    expect(body["model"]).toBe("gpt-direct");
    expect(body["response_format"]).toEqual({ type: "json_object" });
    expect(body["max_completion_tokens"]).toBe(512);
    expect(body["temperature"]).toBe(0.3);
    expect(body["messages"]).toEqual([
      { role: "system", content: "system message" },
      { role: "user", content: "user message" },
    ]);
  });

  it("sends the api-key header and the deployment URL on the Azure branch", async () => {
    const capture = capturing(() => completion("{}"));
    const client = createKeywordLlmClient({
      env: AZURE_ENV,
      fetchImpl: capture.fetchImpl,
    });

    await client.complete(REQUEST);

    const call = capture.calls[0];
    expect(call.url).toContain("/openai/deployments/gg-keyword-4o/");
    expect(headersOf(call.init)["api-key"]).toBe("azure-key");
    expect(headersOf(call.init)["Authorization"]).toBeUndefined();
    expect(bodyOf(call.init)["model"]).toBe("gg-keyword-4o");
  });

  it("resolves the env lazily so an unconfigured deploy fails per request", async () => {
    const client = createKeywordLlmClient({
      env: {},
      fetchImpl: capturing(() => completion("{}")).fetchImpl,
    });

    await expect(client.complete(REQUEST)).rejects.toMatchObject({
      code: "keyword_generation_unavailable",
      reason: "not_configured",
    });
  });

  it.each([
    [401, "auth_failed"],
    [403, "auth_failed"],
    [429, "rate_limited"],
    [500, "server_error"],
    [400, "bad_request"],
  ])("maps HTTP %i to %s", async (status, reason) => {
    const client = createKeywordLlmClient({
      config: {
        apiKey: "k",
        model: "m",
        url: "https://llm.test/v1",
        authScheme: "bearer",
        temperature: null,
      },
      fetchImpl: async () => new Response("nope", { status }),
    });

    await expect(client.complete(REQUEST)).rejects.toMatchObject({ reason });
  });

  it("maps a transport failure to network_error without leaking its message", async () => {
    const client = createKeywordLlmClient({
      env: DIRECT_ENV,
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED 10.0.0.1:443");
      },
    });

    const error = await client.complete(REQUEST).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(KeywordLlmError);
    expect((error as KeywordLlmError).reason).toBe("network_error");
    expect((error as KeywordLlmError).message).not.toContain("10.0.0.1");
  });

  it("aborts the request at the deadline", async () => {
    const client = createKeywordLlmClient({
      env: DIRECT_ENV,
      timeoutMs: 5,
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    });

    await expect(client.complete(REQUEST)).rejects.toMatchObject({
      reason: "timeout",
    });
  });

  it.each([
    ["injected client", 5],
    ["default", undefined],
  ])(
    "prefers the request deadline over the %s deadline",
    async (_label, injectedTimeoutMs) => {
      vi.useFakeTimers();
      let signal: AbortSignal | undefined;
      let result: Promise<unknown> | undefined;
      try {
        const client = createKeywordLlmClient({
          env: DIRECT_ENV,
          ...(injectedTimeoutMs === undefined
            ? {}
            : { timeoutMs: injectedTimeoutMs }),
          fetchImpl: (_url, init) => {
            signal = init?.signal ?? undefined;
            return new Promise((_resolve, reject) => {
              signal?.addEventListener("abort", () => {
                reject(new DOMException("aborted", "AbortError"));
              });
            });
          },
        });

        result = client
          .complete({ ...REQUEST, timeoutMs: 90 })
          .catch((error: unknown) => error);

        await vi.advanceTimersByTimeAsync(89);
        expect(signal?.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(signal?.aborted).toBe(true);
        await expect(result).resolves.toMatchObject({ reason: "timeout" });
      } finally {
        await vi.runAllTimersAsync();
        await result;
        vi.useRealTimers();
      }
    },
  );

  it("keeps the 45-second default when a request has no override", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    let result: Promise<unknown> | undefined;
    try {
      const client = createKeywordLlmClient({
        env: DIRECT_ENV,
        fetchImpl: (_url, init) => {
          signal = init?.signal ?? undefined;
          return new Promise((_resolve, reject) => {
            signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          });
        },
      });

      result = client.complete(REQUEST).catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(44_999);
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(signal?.aborted).toBe(true);
      await expect(result).resolves.toMatchObject({ reason: "timeout" });
    } finally {
      await vi.runAllTimersAsync();
      await result;
      vi.useRealTimers();
    }
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["NaN", Number.NaN],
    ["fractional", 90.5],
    ["over the safety ceiling", 240_001],
  ])(
    "rejects a %s request deadline before calling fetch",
    async (_label, timeoutMs) => {
      const capture = capturing(() => completion("{}"));
      const client = createKeywordLlmClient({
        env: DIRECT_ENV,
        timeoutMs: 90,
        fetchImpl: capture.fetchImpl,
      });

      await expect(
        client.complete({ ...REQUEST, timeoutMs }),
      ).rejects.toMatchObject({
        code: "keyword_generation_unavailable",
        reason: "not_configured",
      });
      expect(capture.calls).toHaveLength(0);
    },
  );

  it("validates an injected deadline when the request has no override", async () => {
    const capture = capturing(() => completion("{}"));
    const client = createKeywordLlmClient({
      env: DIRECT_ENV,
      timeoutMs: 0,
      fetchImpl: capture.fetchImpl,
    });

    await expect(client.complete(REQUEST)).rejects.toMatchObject({
      code: "keyword_generation_unavailable",
      reason: "not_configured",
    });
    expect(capture.calls).toHaveLength(0);
  });

  it("discards a response that only arrives after the deadline", async () => {
    const client = createKeywordLlmClient({
      env: DIRECT_ENV,
      timeoutMs: 5,
      fetchImpl: (_url, init) =>
        new Promise((resolve) => {
          init?.signal?.addEventListener("abort", () => {
            resolve(completion("{}"));
          });
        }),
    });

    await expect(client.complete(REQUEST)).rejects.toMatchObject({
      reason: "timeout",
    });
  });

  it("rejects a body whose declared length is over the ceiling", async () => {
    const client = createKeywordLlmClient({
      env: DIRECT_ENV,
      fetchImpl: async () =>
        new Response("{}", {
          status: 200,
          headers: {
            "content-length": String(MAX_KEYWORD_LLM_RESPONSE_BODY_BYTES + 1),
          },
        }),
    });

    await expect(client.complete(REQUEST)).rejects.toMatchObject({
      reason: "invalid_response",
    });
  });

  it("stops reading a stream that runs past the ceiling", async () => {
    const chunk = new Uint8Array(64 * 1024);
    let emitted = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        emitted += 1;
        // Five 64 KiB chunks is 320 KiB against a 256 KiB ceiling; a client
        // that only checked at the end would have allocated all of it.
        if (emitted > 5) {
          controller.close();
          return;
        }
        controller.enqueue(chunk);
      },
    });
    const client = createKeywordLlmClient({
      env: DIRECT_ENV,
      fetchImpl: async () => new Response(stream, { status: 200 }),
    });

    await expect(client.complete(REQUEST)).rejects.toMatchObject({
      reason: "invalid_response",
    });
  });

  it("rejects a body that is not JSON", async () => {
    const client = createKeywordLlmClient({
      env: DIRECT_ENV,
      fetchImpl: async () =>
        new Response("<html>gateway</html>", {
          status: 200,
        }),
    });

    await expect(client.complete(REQUEST)).rejects.toMatchObject({
      reason: "invalid_response",
    });
  });

  it("rejects a stream that errors mid-body", async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("socket reset"));
      },
    });
    const client = createKeywordLlmClient({
      env: DIRECT_ENV,
      fetchImpl: async () => new Response(stream, { status: 200 }),
    });

    await expect(client.complete(REQUEST)).rejects.toMatchObject({
      reason: "invalid_response",
    });
  });

  it.each([
    ["no choices", { choices: [] }],
    ["no message", { choices: [{}] }],
    ["non-string content", { choices: [{ message: { content: 7 } }] }],
    ["empty content", { choices: [{ message: { content: "" } }] }],
    ["not an object", "just a string"],
  ])("rejects a reply with %s", async (_label, payload) => {
    const client = createKeywordLlmClient({
      env: DIRECT_ENV,
      fetchImpl: async () =>
        new Response(JSON.stringify(payload), { status: 200 }),
    });

    await expect(client.complete(REQUEST)).rejects.toMatchObject({
      reason: "invalid_response",
    });
  });

  it("reports unknown token counts when the provider omits usage", async () => {
    const client = createKeywordLlmClient({
      env: DIRECT_ENV,
      fetchImpl: async () => completion("{}", undefined),
    });

    const result = await client.complete(REQUEST);

    expect(result.usage.inputTokens).toBeNull();
    expect(result.usage.outputTokens).toBeNull();
    expect(result.usage.requestCount).toBe(1);
  });

  it("reports unknown token counts when usage is not an object", async () => {
    const client = createKeywordLlmClient({
      env: DIRECT_ENV,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "{}" } }],
            usage: "n/a",
          }),
          { status: 200 },
        ),
    });

    const result = await client.complete(REQUEST);

    expect(result.usage.inputTokens).toBeNull();
    expect(result.usage.requestCount).toBe(1);
  });
});

describe("an empty reply's cost", () => {
  it("is carried on the error, because the retry above it has to bill for it", () => {
    // A reasoning model that spends its whole output budget thinking bills
    // exactly like one that also wrote a reply, so the caller that retries
    // needs the number the failed attempt burned.
    const error = new KeywordLlmError("invalid_response", "empty", {
      inputTokens: 900,
      outputTokens: 0,
      requestCount: 1,
      retryCount: 0,
    });
    expect(error.usage.inputTokens).toBe(900);
  });

  it("defaults to nothing counted for failures that never reached the model", () => {
    expect(new KeywordLlmError("timeout", "slow").usage).toEqual(
      EMPTY_KEYWORD_LLM_USAGE,
    );
  });
});
