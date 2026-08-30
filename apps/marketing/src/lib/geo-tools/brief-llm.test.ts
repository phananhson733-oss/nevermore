import { describe, expect, it, vi } from "vitest";

import {
  geoBriefUserPrompt,
  resolveGeoBriefLlmConfig,
  runGeoBriefLlm,
  GEO_BRIEF_MAX_OUTPUT_TOKENS,
  GEO_BRIEF_SYSTEM_PROMPT,
  GEO_BRIEF_TEMPERATURE,
  type GeoBriefLlmInput,
} from "./brief-llm.ts";
import type { GeoBriefFact } from "./brief-contract.ts";
import {
  createKeywordLlmClient,
  KeywordLlmError,
  type KeywordLlmClient,
} from "../tools/keyword-llm-client.ts";

const CONFIG = {
  apiKey: "key",
  model: "gpt-test",
  url: "https://provider.test/v1/chat/completions",
  authScheme: "bearer" as const,
  temperature: null,
};

const REQUESTED_PROVIDER = {
  modelRequested: "gpt-test",
  authScheme: "bearer" as const,
  effectiveTemperature: GEO_BRIEF_TEMPERATURE,
  maxOutputTokens: GEO_BRIEF_MAX_OUTPUT_TOKENS,
};

const FACTS: readonly GeoBriefFact[] = [
  {
    key: "pricing",
    value: "$29 per seat",
    reason: null,
    source: "crawl",
    sourceUrl: "https://acme.test/pricing",
    observedAt: "2026-08-29T00:00:00.000Z",
  },
  {
    key: "uptime",
    value: null,
    reason: "notPublished",
    source: "kb",
    sourceUrl: null,
    observedAt: null,
  },
];

const USAGE = {
  inputTokens: 10,
  outputTokens: 20,
  requestCount: 1,
  retryCount: 0,
} as const;

function input(overrides: Partial<GeoBriefLlmInput> = {}): GeoBriefLlmInput {
  return {
    questionText: "best project trackers for mid-market ops",
    officialName: "Acme",
    categoryTerms: ["project tracker"],
    requiredEntities: ["project tracker"],
    subtopics: [
      { id: "Q1", text: "Pricing" },
      { id: "Q2", text: "Who it is for" },
    ],
    facts: FACTS,
    language: "en",
    ...overrides,
  };
}

function client(content: string): KeywordLlmClient {
  return {
    complete: vi.fn(async () => ({
      content,
      modelId: "gpt-test",
      usage: USAGE,
    })),
  } as unknown as KeywordLlmClient;
}

const GOOD_REPLY = JSON.stringify({
  leadAnswerRequirement: "Say what Acme is and who it is for.",
  mustAnswer: [
    { id: "Q1", text: "What does it cost?" },
    { id: "Q2", text: "Which teams is it for?" },
  ],
  outline: [{ heading: "Pricing", answers: ["Q1"] }],
});

describe("resolveGeoBriefLlmConfig", () => {
  it("returns null rather than throwing when the set is absent", () => {
    expect(resolveGeoBriefLlmConfig({})).toBeNull();
    expect(resolveGeoBriefLlmConfig({ GEO_BRIEF_API_KEY: "k" })).toBeNull();
    expect(resolveGeoBriefLlmConfig({ GEO_BRIEF_MODEL: "m" })).toBeNull();
  });

  it("reads its own prefix and nobody else's", () => {
    // A tool that fell back to another tool's key would bill the wrong budget
    // and, worse, keep working after that tool was switched off.
    const config = resolveGeoBriefLlmConfig({
      GEO_BRIEF_API_KEY: "k",
      GEO_BRIEF_MODEL: "m",
      CONTENT_BRIEF_API_KEY: "other",
      CONTENT_BRIEF_MODEL: "other",
      CONTENT_BRIEF_TEMPERATURE: "1",
      KEYWORD_MAP_TEMPERATURE: "1",
    });
    expect(config?.model).toBe("m");
    expect(config?.apiKey).toBe("k");
    expect(config?.temperature).toBeNull();
  });

  it("defaults the endpoint and honours an override", () => {
    expect(
      resolveGeoBriefLlmConfig({ GEO_BRIEF_API_KEY: "k", GEO_BRIEF_MODEL: "m" })
        ?.url,
    ).toBe("https://api.openai.com/v1/chat/completions");
    expect(
      resolveGeoBriefLlmConfig({
        GEO_BRIEF_API_KEY: "k",
        GEO_BRIEF_MODEL: "m",
        GEO_BRIEF_URL: "https://azure.test/deploy",
      })?.url,
    ).toBe("https://azure.test/deploy");
  });

  it("leaves the task temperature unpinned when the key is absent", () => {
    const config = resolveGeoBriefLlmConfig({
      GEO_BRIEF_API_KEY: "k",
      GEO_BRIEF_MODEL: "m",
    });
    expect(config).not.toBeNull();
    expect(config?.temperature).toBeNull();
  });

  it.each(["0", "1", "2"])(
    "accepts provider-pinned temperature %j",
    (raw) => {
      const config = resolveGeoBriefLlmConfig({
        GEO_BRIEF_API_KEY: "k",
        GEO_BRIEF_MODEL: "m",
        GEO_BRIEF_TEMPERATURE: raw,
      });
      expect(config?.temperature).toBe(Number(raw));
    },
  );

  it.each(["abc", "3", "-1", "", "   ", "NaN", "Infinity"])(
    "fails the config closed for invalid pinned temperature %j",
    (raw) => {
      expect(
        resolveGeoBriefLlmConfig({
          GEO_BRIEF_API_KEY: "k",
          GEO_BRIEF_MODEL: "m",
          GEO_BRIEF_TEMPERATURE: raw,
        }),
      ).toBeNull();
    },
  );

  it("sends the resolved provider temperature instead of the task default", async () => {
    const config = resolveGeoBriefLlmConfig({
      GEO_BRIEF_API_KEY: "k",
      GEO_BRIEF_MODEL: "gpt-5.6-luna",
      GEO_BRIEF_URL: "https://azure.test/deploy",
      GEO_BRIEF_AUTH_SCHEME: "api-key",
      GEO_BRIEF_TEMPERATURE: "1",
    });
    expect(config).not.toBeNull();
    if (config === null) throw new Error("expected a resolved GEO Brief config");

    let sent: unknown;
    const transport = createKeywordLlmClient({
      config,
      fetchImpl: async (_url, init) => {
        sent = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "{}" } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    await transport.complete({
      system: "system",
      user: "user",
      temperature: GEO_BRIEF_TEMPERATURE,
      maxOutputTokens: GEO_BRIEF_MAX_OUTPUT_TOKENS,
    });

    expect((sent as { readonly temperature: number }).temperature).toBe(1);
  });
});

describe("the prompt", () => {
  it("marks an unverified fact as one the model may not state", () => {
    const prompt = geoBriefUserPrompt(input());
    expect(prompt).toContain("pricing: $29 per seat");
    // The whole sentence, not the word: an assertion on "uptime" alone would
    // pass on a prompt that listed it as a value.
    expect(prompt).toContain(
      "uptime: NOT VERIFIED (notPublished) - do not state a value",
    );
  });

  it("says the subtopics were observed in one answer, with their ids", () => {
    const prompt = geoBriefUserPrompt(input());
    expect(prompt).toContain("- Q1: Pricing");
    expect(prompt).toContain("- Q2: Who it is for");
  });

  it("says so when the answer had no structure", () => {
    const prompt = geoBriefUserPrompt(input({ subtopics: [] }));
    expect(prompt).toContain("(none - the answer had no structure to read)");
  });

  it("forbids inventing facts in the system prompt", () => {
    expect(GEO_BRIEF_SYSTEM_PROMPT).toContain(
      "Never state a fact that is not in the fact table",
    );
  });

  it("reserves Q ids for observed items and M ids for model-added items", () => {
    expect(GEO_BRIEF_SYSTEM_PROMPT).toContain("Never invent a Q id");
    expect(GEO_BRIEF_SYSTEM_PROMPT).toContain("M1, M2, ... M12");
  });
});

describe("runGeoBriefLlm", () => {
  it("returns the parsed reply", async () => {
    const result = await runGeoBriefLlm(input(), {
      config: CONFIG,
      client: client(GOOD_REPLY),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mustAnswer).toHaveLength(2);
      expect(result.value.outline[0]?.heading).toBe("Pricing");
    }
  });

  it("sends the pinned temperature and budget", async () => {
    const spy = client(GOOD_REPLY);
    await runGeoBriefLlm(input(), { config: CONFIG, client: spy });
    const request = (
      (spy.complete as unknown as { mock: { calls: unknown[][] } }).mock
        .calls[0] as [Record<string, unknown>]
    )[0];
    expect(request["temperature"]).toBe(GEO_BRIEF_TEMPERATURE);
    expect(request["maxOutputTokens"]).toBe(GEO_BRIEF_MAX_OUTPUT_TOKENS);
  });

  it("refuses to call when there is nothing to arrange", async () => {
    const spy = client(GOOD_REPLY);
    const result = await runGeoBriefLlm(
      input({ subtopics: [], requiredEntities: [] }),
      { config: CONFIG, client: spy },
    );
    expect(result).toEqual({ ok: false, reason: "nothing_to_assemble" });
    expect(spy.complete).not.toHaveBeenCalled();
  });

  it("says the set is unconfigured instead of calling nothing", async () => {
    const result = await runGeoBriefLlm(input(), { config: null });
    expect(result).toEqual({ ok: false, reason: "not_configured" });
  });

  it("does not mislabel the completion model fallback as observed", async () => {
    const result = await runGeoBriefLlm(input(), {
      config: CONFIG,
      client: client("I could not do that."),
    });
    expect(result).toEqual({
      ok: false,
      reason: "invalid_json",
      usage: USAGE,
      provider: REQUESTED_PROVIDER,
    });
    expect(JSON.stringify(result)).not.toContain("modelObserved");
  });

  it("names a schema refusal and retains the charged usage", async () => {
    const result = await runGeoBriefLlm(input(), {
      config: CONFIG,
      client: client(
        JSON.stringify({
          leadAnswerRequirement: "ok",
          mustAnswer: [{ id: "Q7", text: "invented" }],
          outline: [{ heading: "x", answers: ["Q7"] }],
        }),
      ),
    });
    expect(result).toEqual({
      ok: false,
      reason: "schema_invalid",
      usage: USAGE,
      provider: REQUESTED_PROVIDER,
    });
  });

  it("omits unknown usage on a timeout but keeps requested provider provenance", async () => {
    const timing = {
      complete: vi.fn(async () => {
        throw new KeywordLlmError("timeout", "took too long");
      }),
    } as unknown as KeywordLlmClient;
    expect(
      await runGeoBriefLlm(input(), { config: CONFIG, client: timing }),
    ).toEqual({
      ok: false,
      reason: "timeout",
      provider: REQUESTED_PROVIDER,
    });
  });

  it("omits default empty usage on an HTTP failure and reports a pinned temperature", async () => {
    const broken = {
      complete: vi.fn(async () => {
        throw new KeywordLlmError("server_error", "safe fixture");
      }),
    } as unknown as KeywordLlmClient;
    expect(
      await runGeoBriefLlm(input(), {
        config: { ...CONFIG, temperature: 1 },
        client: broken,
      }),
    ).toEqual({
      ok: false,
      reason: "server_error",
      provider: { ...REQUESTED_PROVIDER, effectiveTemperature: 1 },
    });
  });

  it("retains reported invalid-response usage with requested provenance only", async () => {
    const usage = {
      inputTokens: 17,
      outputTokens: 4096,
      requestCount: 1,
      retryCount: 0,
    } as const;
    const broken = {
      complete: vi.fn(async () => {
        throw new KeywordLlmError("invalid_response", "safe fixture", usage);
      }),
    } as unknown as KeywordLlmClient;
    expect(
      await runGeoBriefLlm(input(), { config: CONFIG, client: broken }),
    ).toEqual({
      ok: false,
      reason: "invalid_response",
      usage,
      provider: REQUESTED_PROVIDER,
    });
  });

  it("lets an unexpected throw through instead of calling it a provider error", async () => {
    const exploding = {
      complete: vi.fn(async () => {
        throw new TypeError("a bug in this file");
      }),
    } as unknown as KeywordLlmClient;
    await expect(
      runGeoBriefLlm(input(), { config: CONFIG, client: exploding }),
    ).rejects.toThrow(TypeError);
  });
});
