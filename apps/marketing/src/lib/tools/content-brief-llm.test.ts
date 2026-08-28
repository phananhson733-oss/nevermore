import {
  DO_NOT_COVER_CAP,
  ENVELOPE_MS,
  INTERNAL_LINKS_CAP,
  LLM_DEADLINE_MS,
  LLM_MAX_OUTPUT_TOKENS,
  MODEL_TEXT_MAX_CHARS,
  OUTLINE_CAP,
  QUESTION_MAX_CHARS,
  RUN_BUDGET_MS,
} from "@sf/public-tools/content-brief/constants";
import type {
  BriefGscPageRow,
  ModelBriefOutput,
  ProfileFact,
} from "@sf/public-tools/content-brief/contract";
import { describe, expect, it } from "vitest";

import {
  CONTENT_BRIEF_LLM_TEMPERATURE,
  resolveContentBriefLlmConfig,
  resolveContentDraftLlmConfig,
  runContentBriefLlm,
  type ContentBriefLlmInput,
  type ContentBriefLlmQuestion,
  type ContentBriefObservedPage,
} from "./content-brief-llm.ts";
import {
  KeywordLlmError,
  type KeywordLlmClient,
  type KeywordLlmConfig,
  type KeywordLlmFailureReason,
  type KeywordLlmRequest,
} from "./keyword-llm-client.ts";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const NOW = 1_800_000_000_000;

const CONFIG: KeywordLlmConfig = {
  apiKey: "test-key",
  model: "brief-deployment",
  url: "https://llm.example/v1/chat/completions",
  authScheme: "bearer",
  temperature: null,
};

const FACTS: readonly ProfileFact[] = [
  {
    id: "P1",
    field: "productName",
    text: "Acme Billing",
    derivation: "declared",
    provenance: { method: "observed", origin: "product_profile" },
  },
  {
    id: "P2",
    field: "coreFeatures[0]",
    text: "Same-day claim submission",
    derivation: "inferred",
    provenance: { method: "model", derived_from: ["product_profile"] },
  },
];

const PAGES: readonly BriefGscPageRow[] = [
  {
    id: "G1",
    page: "https://acme.example/pricing",
    clicks: 12,
    impressions: 300,
    position: 4.2,
  },
  {
    id: "G2",
    page: "https://acme.example/blog/claims",
    clicks: 0,
    impressions: 40,
    position: null,
  },
];

const OBSERVED = ["C1", "C2", "C3"] as const;

const OBSERVED_PAGES: readonly ContentBriefObservedPage[] = OBSERVED.map(
  (id, index) => ({
    id,
    url: `https://competitor-${index + 1}.example/billing`,
    h2: ["How it works", "Pricing"],
  }),
);

function question(id: string, heading: string): ContentBriefLlmQuestion {
  return {
    id,
    canonical_heading: heading,
    members: [{ observation_id: "C1", heading, level: "h2" }],
    excerpts: [{ observation_id: "C1", heading, text: `${heading} body` }],
  };
}

const QUESTIONS: readonly ContentBriefLlmQuestion[] = [
  question("Q1", "how it works"),
  question("Q2", "pricing"),
  question("Q3", "setup time"),
];

function input(
  overrides: Partial<ContentBriefLlmInput> = {},
): ContentBriefLlmInput {
  return {
    primary: "medical billing software",
    supporting: ["claims software"],
    language: "en",
    questions: QUESTIONS,
    requestOutline: true,
    facts: FACTS,
    gscPages: PAGES,
    observedIds: [...OBSERVED],
    observedPages: OBSERVED_PAGES,
    deadlineAt: NOW + RUN_BUDGET_MS,
    ...overrides,
  };
}

function validReply(
  overrides: Partial<ModelBriefOutput> = {},
): ModelBriefOutput {
  return {
    questions: [
      { id: "Q1", q: "How does medical billing software work?" },
      { id: "Q2", q: "What does medical billing software cost?" },
      { id: "Q3", q: "How long does setup take?" },
    ],
    outline: [
      { h2: "How it works", h3: ["Claims software basics"], answers: ["Q1"] },
      { h2: "Pricing and setup", h3: [], answers: ["Q2", "Q3"] },
    ],
    gap_angle: {
      value: "Same-day claim submission",
      rationale: "No competitor page promises same-day submission.",
      profile_fact_refs: ["P2"],
      checked_against: [...OBSERVED],
    },
    internal_links: [{ page_ref: "G1", why: "Pricing detail lives there." }],
    do_not_cover: [{ page_ref: "G2", topic: "Claim denial appeals" }],
    ...overrides,
  };
}

interface Recorder {
  readonly client: KeywordLlmClient;
  readonly requests: KeywordLlmRequest[];
}

interface RecorderOptions {
  readonly modelId?: string | null;
  readonly usage?: {
    readonly input: number | null;
    readonly output: number | null;
  };
}

function recorder(
  reply: string | Error,
  options: RecorderOptions = {},
): Recorder {
  const requests: KeywordLlmRequest[] = [];
  const usage = options.usage ?? { input: 900, output: 350 };
  return {
    requests,
    client: {
      complete: async (request) => {
        requests.push(request);
        if (reply instanceof Error) throw reply;
        return {
          content: reply,
          usage: {
            inputTokens: usage.input,
            outputTokens: usage.output,
            requestCount: 1,
            retryCount: 0,
          },
          modelId:
            options.modelId === undefined
              ? "brief-deployment-2026"
              : options.modelId,
        };
      },
    },
  };
}

async function runWithReply(
  reply: unknown,
  overrides: Partial<ContentBriefLlmInput> = {},
  config: KeywordLlmConfig = CONFIG,
) {
  const rec = recorder(
    typeof reply === "string" ? reply : JSON.stringify(reply),
  );
  const result = await runContentBriefLlm(input(overrides), {
    client: rec.client,
    config,
    now: () => NOW,
  });
  return { result, rec };
}

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

describe("resolveContentBriefLlmConfig", () => {
  it("resolves the minimal set with OpenAI defaults and no pinned temperature", () => {
    const config = resolveContentBriefLlmConfig({
      CONTENT_BRIEF_API_KEY: " key ",
      CONTENT_BRIEF_MODEL: "gpt-brief",
    });
    expect(config).toEqual({
      apiKey: "key",
      model: "gpt-brief",
      url: "https://api.openai.com/v1/chat/completions",
      authScheme: "bearer",
      temperature: null,
    });
  });

  it("honours url, api-key scheme (any case) and a pinned temperature", () => {
    const config = resolveContentBriefLlmConfig({
      CONTENT_BRIEF_API_KEY: "key",
      CONTENT_BRIEF_MODEL: "deployment",
      CONTENT_BRIEF_URL:
        "https://azure.example/openai/deployments/d/chat/completions?api-version=1",
      CONTENT_BRIEF_AUTH_SCHEME: "API-Key",
      CONTENT_BRIEF_TEMPERATURE: "1",
    });
    expect(config?.url).toBe(
      "https://azure.example/openai/deployments/d/chat/completions?api-version=1",
    );
    expect(config?.authScheme).toBe("api-key");
    expect(config?.temperature).toBe(1);
  });

  it.each(["abc", "3", "-1", ""])(
    "drops an unusable pinned temperature %j back to null",
    (raw) => {
      const config = resolveContentBriefLlmConfig({
        CONTENT_BRIEF_API_KEY: "key",
        CONTENT_BRIEF_MODEL: "m",
        CONTENT_BRIEF_TEMPERATURE: raw,
      });
      expect(config?.temperature).toBeNull();
    },
  );

  it("returns null when the key or model is missing, even if the keyword tool or Azure set is present", () => {
    const neighbours = {
      KEYWORD_MAP_API_KEY: "k",
      KEYWORD_MAP_MODEL: "m",
      OPENAI_API_KEY: "k",
      OPENAI_MODEL: "m",
      AZURE_OPENAI_API_KEY: "k",
      AZURE_OPENAI_ENDPOINT: "https://azure.example",
      AZURE_OPENAI_DEPLOYMENT: "d",
      OPENAI_API_VERSION: "2026-01-01",
    };
    expect(resolveContentBriefLlmConfig(neighbours)).toBeNull();
    expect(
      resolveContentBriefLlmConfig({
        ...neighbours,
        CONTENT_BRIEF_API_KEY: "key",
      }),
    ).toBeNull();
    expect(
      resolveContentBriefLlmConfig({ ...neighbours, CONTENT_BRIEF_MODEL: "m" }),
    ).toBeNull();
    expect(
      resolveContentBriefLlmConfig({
        CONTENT_BRIEF_API_KEY: "   ",
        CONTENT_BRIEF_MODEL: "m",
      }),
    ).toBeNull();
  });
});

describe("resolveContentDraftLlmConfig", () => {
  it("reads only the CONTENT_DRAFT_* set", () => {
    const briefOnly = {
      CONTENT_BRIEF_API_KEY: "key",
      CONTENT_BRIEF_MODEL: "m",
    };
    expect(resolveContentDraftLlmConfig(briefOnly)).toBeNull();
    expect(
      resolveContentDraftLlmConfig({
        ...briefOnly,
        CONTENT_DRAFT_API_KEY: "draft-key",
        CONTENT_DRAFT_MODEL: "draft-model",
        CONTENT_DRAFT_AUTH_SCHEME: "api-key",
      }),
    ).toEqual({
      apiKey: "draft-key",
      model: "draft-model",
      url: "https://api.openai.com/v1/chat/completions",
      authScheme: "api-key",
      temperature: null,
    });
  });
});

/* ------------------------------------------------------------------ */
/* runContentBriefLlm — reads branches                                 */
/* ------------------------------------------------------------------ */

describe("runContentBriefLlm", () => {
  it("records not_configured without calling when config is null", async () => {
    const rec = recorder(JSON.stringify(validReply()));
    const result = await runContentBriefLlm(input(), {
      client: rec.client,
      config: null,
      now: () => NOW,
    });
    expect(rec.requests).toHaveLength(0);
    expect(result.output).toBeNull();
    expect(result.reads).toEqual({
      status: "unavailable",
      reason: "not_configured",
      attempted: 0,
      calls: 0,
      model_id: null,
      input_tokens: null,
      output_tokens: null,
    });
  });

  it("resolves the config from the injected env when none is given", async () => {
    const rec = recorder(JSON.stringify(validReply()));
    const missing = await runContentBriefLlm(input(), {
      client: rec.client,
      env: { OPENAI_API_KEY: "k", OPENAI_MODEL: "m" },
      now: () => NOW,
    });
    expect(missing.reads.status).toBe("unavailable");
    expect(rec.requests).toHaveLength(0);

    const present = await runContentBriefLlm(input(), {
      client: rec.client,
      env: { CONTENT_BRIEF_API_KEY: "k", CONTENT_BRIEF_MODEL: "env-model" },
      now: () => NOW,
    });
    expect(present.reads.status).toBe("complete");
    expect(rec.requests).toHaveLength(1);
  });

  it("records insufficient_evidence without calling when there is nothing to ask", async () => {
    const rec = recorder(JSON.stringify(validReply()));
    const empty = { questions: [], facts: null, gscPages: null };
    const result = await runContentBriefLlm(input(empty), {
      client: rec.client,
      config: CONFIG,
      now: () => NOW,
    });
    expect(rec.requests).toHaveLength(0);
    expect(result.output).toBeNull();
    expect(result.reads).toEqual({
      status: "unavailable",
      reason: "insufficient_evidence",
      attempted: 0,
      calls: 0,
      model_id: null,
      input_tokens: null,
      output_tokens: null,
    });
    expect(result.derived_from).toEqual(["crawl", "user_input"]);

    // "Nothing to ask" is the more specific fact and wins over "no model".
    const unconfigured = await runContentBriefLlm(input(empty), {
      client: rec.client,
      config: null,
      now: () => NOW,
    });
    expect(unconfigured.reads).toMatchObject({ reason: "insufficient_evidence" });
  });

  it("still calls when any one of questions, facts or pages is present", async () => {
    const cases: Partial<ContentBriefLlmInput>[] = [
      { facts: null, gscPages: null, requestOutline: false },
      { questions: [], gscPages: null, requestOutline: false },
      { questions: [], facts: null, requestOutline: false },
    ];
    for (const overrides of cases) {
      const rec = recorder(JSON.stringify(validReply()));
      await runContentBriefLlm(input(overrides), {
        client: rec.client,
        config: CONFIG,
        now: () => NOW,
      });
      expect(rec.requests).toHaveLength(1);
    }
  });

  it("records timeout without calling when the budget is already spent", async () => {
    const rec = recorder(JSON.stringify(validReply()));
    const result = await runContentBriefLlm(
      input({ deadlineAt: NOW + ENVELOPE_MS }),
      { client: rec.client, config: CONFIG, now: () => NOW },
    );
    expect(rec.requests).toHaveLength(0);
    expect(result.reads).toEqual({
      status: "unavailable",
      reason: "timeout",
      attempted: 0,
      calls: 0,
      model_id: null,
      input_tokens: null,
      output_tokens: null,
    });
  });

  it("sends the task temperature, the output cap and the smaller of LLM_DEADLINE_MS and the remaining budget", async () => {
    const full = await runWithReply(validReply());
    expect(full.rec.requests[0]).toMatchObject({
      temperature: CONTENT_BRIEF_LLM_TEMPERATURE,
      maxOutputTokens: LLM_MAX_OUTPUT_TOKENS,
      timeoutMs: LLM_DEADLINE_MS,
    });

    const remaining = Math.floor(LLM_DEADLINE_MS / 2);
    const short = await runWithReply(validReply(), {
      deadlineAt: NOW + ENVELOPE_MS + remaining,
    });
    expect(short.rec.requests[0]?.timeoutMs).toBe(remaining);
  });

  it("maps a client timeout to reads.timeout with the attempt counted", async () => {
    const rec = recorder(
      new KeywordLlmError("timeout", "LLM request timed out."),
    );
    const result = await runContentBriefLlm(input(), {
      client: rec.client,
      config: CONFIG,
      now: () => NOW,
    });
    expect(result.output).toBeNull();
    expect(result.reads).toEqual({
      status: "unavailable",
      reason: "timeout",
      attempted: 1,
      calls: 0,
      model_id: null,
      input_tokens: null,
      output_tokens: null,
    });
  });

  it.each<KeywordLlmFailureReason>([
    "network_error",
    "auth_failed",
    "rate_limited",
    "server_error",
    "bad_request",
    "invalid_response",
  ])("maps client reason %s to provider_error", async (reason) => {
    const rec = recorder(new KeywordLlmError(reason, "failed"));
    const result = await runContentBriefLlm(input(), {
      client: rec.client,
      config: CONFIG,
      now: () => NOW,
    });
    expect(result.output).toBeNull();
    expect(result.reads.status).toBe("unavailable");
    expect(result.reads).toMatchObject({
      reason: "provider_error",
      attempted: 1,
    });
  });

  it("keeps the tokens a billed-but-empty reply burned", async () => {
    const rec = recorder(
      new KeywordLlmError("invalid_response", "no content", {
        inputTokens: 1200,
        outputTokens: 4000,
        requestCount: 1,
        retryCount: 0,
      }),
    );
    const result = await runContentBriefLlm(input(), {
      client: rec.client,
      config: CONFIG,
      now: () => NOW,
    });
    expect(result.reads).toMatchObject({
      reason: "provider_error",
      calls: 1,
      input_tokens: 1200,
      output_tokens: 4000,
    });
  });

  it("rethrows anything that is not a KeywordLlmError", async () => {
    const rec = recorder(new TypeError("bug"));
    await expect(
      runContentBriefLlm(input(), {
        client: rec.client,
        config: CONFIG,
        now: () => NOW,
      }),
    ).rejects.toThrow(TypeError);
  });

  it("returns the validated output with a complete read on the happy path", async () => {
    const reply = validReply();
    const { result } = await runWithReply(reply);
    expect(result.output).toEqual(reply);
    expect(result.reads).toEqual({
      status: "complete",
      calls: 1,
      model_id: "brief-deployment-2026",
      temperature_requested: CONTENT_BRIEF_LLM_TEMPERATURE,
      temperature_effective: null,
      input_tokens: 900,
      output_tokens: 350,
    });
  });

  it("falls back to the configured model when the provider reports none", async () => {
    const rec = recorder(JSON.stringify(validReply()), { modelId: null });
    const result = await runContentBriefLlm(input(), {
      client: rec.client,
      config: CONFIG,
      now: () => NOW,
    });
    expect(result.reads.model_id).toBe(CONFIG.model);
  });

  it("reports the pinned temperature as effective and null when nothing is pinned", async () => {
    const pinned = await runWithReply(
      validReply(),
      {},
      { ...CONFIG, temperature: 1 },
    );
    expect(pinned.result.reads).toMatchObject({
      temperature_requested: CONTENT_BRIEF_LLM_TEMPERATURE,
      temperature_effective: 1,
    });

    const unpinned = await runWithReply(validReply());
    expect(unpinned.result.reads).toMatchObject({
      temperature_effective: null,
    });
    expect(unpinned.result.reads).not.toMatchObject({
      temperature_effective: CONTENT_BRIEF_LLM_TEMPERATURE,
    });
  });

  it("strips control characters and angle brackets from the free text it keeps", async () => {
    const { result } = await runWithReply(
      validReply({
        questions: [{ id: "Q1", q: "How  does <b>it</b>\u0007 work?" }],
      }),
    );
    expect(result.output?.questions).toEqual([
      { id: "Q1", q: "How does bit/b work?" },
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* derived_from                                                        */
/* ------------------------------------------------------------------ */

describe("runContentBriefLlm derived_from", () => {
  it("is crawl + user_input when neither facts nor pages were fed", async () => {
    const { result } = await runWithReply(
      validReply({ gap_angle: null, internal_links: null, do_not_cover: null }),
      { facts: null, gscPages: null },
    );
    expect(result.reads.status).toBe("complete");
    expect(result.derived_from).toEqual(["crawl", "user_input"]);
  });

  it("adds product_profile when facts were fed", async () => {
    const { result } = await runWithReply(
      validReply({ internal_links: null, do_not_cover: null }),
      { gscPages: null },
    );
    expect(result.reads.status).toBe("complete");
    expect(result.derived_from).toEqual([
      "crawl",
      "user_input",
      "product_profile",
    ]);
  });

  it("adds gsc when pages were fed, and both when both were", async () => {
    const gscOnly = await runWithReply(validReply({ gap_angle: null }), {
      facts: null,
    });
    expect(gscOnly.result.reads.status).toBe("complete");
    expect(gscOnly.result.derived_from).toEqual(["crawl", "user_input", "gsc"]);

    const both = await runWithReply(validReply());
    expect(both.result.derived_from).toEqual([
      "crawl",
      "user_input",
      "product_profile",
      "gsc",
    ]);
  });

  it("is computed from the input even when the model call failed", async () => {
    const rec = recorder(new KeywordLlmError("timeout", "slow"));
    const result = await runContentBriefLlm(input({ gscPages: null }), {
      client: rec.client,
      config: CONFIG,
      now: () => NOW,
    });
    expect(result.derived_from).toEqual([
      "crawl",
      "user_input",
      "product_profile",
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* validation_failed — one counter-example per rule                    */
/* ------------------------------------------------------------------ */

// A mutable tuple on purpose: vitest's `it.each` only spreads `T extends any[]`
// into the callback's parameters; a readonly tuple falls through to the
// overload that types every argument as `unknown`.
type Counterexample = [
  name: string,
  reply: unknown,
  overrides?: Partial<ContentBriefLlmInput>,
];

const GAP = validReply().gap_angle!;
/** Answers every fixture question, so a row built on it fails only for its own rule. */
const SECTION = { h2: "H", h3: [], answers: [...QUESTIONS.map((q) => q.id)] };
const MANY_PAGES: readonly BriefGscPageRow[] = Array.from(
  { length: Math.max(INTERNAL_LINKS_CAP, DO_NOT_COVER_CAP) + 1 },
  (_, index) => ({ ...PAGES[0]!, id: `G${index + 1}` }),
);
function overCap(cap: number, extra: Record<string, string>) {
  return MANY_PAGES.slice(0, cap + 1).map((page) => ({
    page_ref: page.id,
    ...extra,
  }));
}

const LINK = { page_ref: "G1", why: "because" };
const COVER = { page_ref: "G1", topic: "topic" };

const MANY_QUESTIONS = Array.from({ length: OUTLINE_CAP + 1 }, (_, index) =>
  question(`Q${index + 1}`, `topic ${index + 1}`),
);
const TOO_MANY_SECTIONS = MANY_QUESTIONS.map((item) => ({
  ...SECTION,
  h2: item.canonical_heading,
  answers: [item.id],
}));

function repeat<T>(count: number, item: T): T[] {
  return Array.from({ length: count }, () => item);
}

function withoutKey(key: keyof ModelBriefOutput): Record<string, unknown> {
  const { [key]: _dropped, ...rest } = validReply();
  return rest;
}

function withQuestions(questions: unknown): ModelBriefOutput {
  return validReply({ questions: questions as never });
}

function withOutline(outline: unknown): ModelBriefOutput {
  return validReply({ outline: outline as never });
}

function withGap(patch: Record<string, unknown>): ModelBriefOutput {
  return validReply({ gap_angle: { ...GAP, ...patch } as never });
}

function withLinks(internal_links: unknown): ModelBriefOutput {
  return validReply({ internal_links: internal_links as never });
}

function withCover(do_not_cover: unknown): ModelBriefOutput {
  return validReply({ do_not_cover: do_not_cover as never });
}

const LONG_QUESTION = "x".repeat(QUESTION_MAX_CHARS + 1);
const LONG_TEXT = "x".repeat(MODEL_TEXT_MAX_CHARS + 1);

const COUNTEREXAMPLES: readonly Counterexample[] = [
  ["reply is not JSON", "not json at all"],
  ["reply is a JSON array, not an object", []],
  ["extra top-level key", { ...validReply(), notes: "extra" }],
  ["missing top-level key", withoutKey("do_not_cover")],
  ["question id not in the input", withQuestions([{ id: "Q9", q: "Who?" }])],
  ["question id repeated", withQuestions(repeat(2, { id: "Q1", q: "A?" }))],
  ["question with extra key", withQuestions([{ id: "Q1", q: "A?", x: 1 }])],
  ["question text empty", withQuestions([{ id: "Q1", q: "  " }])],
  ["question text over cap", withQuestions([{ id: "Q1", q: LONG_QUESTION }])],
  ["outline given but not requested", validReply(), { requestOutline: false }],
  ["outline null when requested", withOutline(null)],
  ["outline empty", withOutline([])],
  ["outline over OUTLINE_CAP", withOutline(TOO_MANY_SECTIONS), { questions: MANY_QUESTIONS }],
  ["section h2 empty", withOutline([{ ...SECTION, h2: "" }])],
  ["section h2 over MODEL_TEXT_MAX_CHARS", withOutline([{ ...SECTION, h2: LONG_TEXT }])],
  ["section h3 not an array", withOutline([{ ...SECTION, h3: "one" }])],
  ["section h3 has an empty string", withOutline([{ ...SECTION, h3: [""] }])],
  ["section h3 item over MODEL_TEXT_MAX_CHARS", withOutline([{ ...SECTION, h3: [LONG_TEXT] }])],
  ["section answers repeat a question", withOutline([{ ...SECTION, answers: ["Q1", "Q1"] }])],
  ["section answers empty", withOutline([{ ...SECTION, answers: [] }])],
  ["section answers unknown question", withOutline([{ ...SECTION, answers: ["Q9"] }])],
  ["same question in two sections", withOutline([SECTION, { ...SECTION, h2: "B" }])],
  ["outline leaves a question unanswered", withOutline([{ ...SECTION, answers: ["Q1", "Q2"] }])],
  ["outline leaves Q4 unanswered", validReply(), { questions: [...QUESTIONS, question("Q4", "support")] }],
  ["section with extra key", withOutline([{ ...SECTION, note: "x" }])],
  ["gap_angle given but no facts fed", validReply(), { facts: null }],
  ["gap_angle null when facts fed", validReply({ gap_angle: null })],
  ["gap_angle value empty", withGap({ value: "" })],
  ["gap_angle value over MODEL_TEXT_MAX_CHARS", withGap({ value: LONG_TEXT })],
  ["gap_angle rationale empty", withGap({ rationale: "" })],
  ["gap_angle rationale over MODEL_TEXT_MAX_CHARS", withGap({ rationale: LONG_TEXT })],
  ["gap_angle profile_fact_refs empty", withGap({ profile_fact_refs: [] })],
  ["gap_angle unknown fact ref", withGap({ profile_fact_refs: ["P9"] })],
  ["gap_angle fact ref repeated", withGap({ profile_fact_refs: ["P1", "P1"] })],
  ["gap_angle checked_against misses an id", withGap({ checked_against: ["C1", "C2"] })],
  ["gap_angle checked_against extra id", withGap({ checked_against: [...OBSERVED, "C4"] })],
  ["gap_angle checked_against repeats an id", withGap({ checked_against: ["C1", "C1", "C2", "C3"] })],
  ["gap_angle checked_against repeat hides a missing id", withGap({ checked_against: ["C1", "C1", "C2"] })],
  ["gap_angle with extra key", withGap({ extra: 1 })],
  ["internal_links given but no pages fed", validReply({ do_not_cover: null }), { gscPages: null }],
  ["internal_links null when pages fed", withLinks(null)],
  ["internal_links over INTERNAL_LINKS_CAP", withLinks(overCap(INTERNAL_LINKS_CAP, { why: "because" })), { gscPages: MANY_PAGES }],
  ["internal_links page_ref repeated", withLinks([LINK, { ...LINK, why: "again" }])],
  ["internal_links unknown page", withLinks([{ ...LINK, page_ref: "G9" }])],
  ["internal_links why empty", withLinks([{ ...LINK, why: "" }])],
  ["internal_links why over MODEL_TEXT_MAX_CHARS", withLinks([{ ...LINK, why: LONG_TEXT }])],
  ["internal_links item with extra key", withLinks([{ ...LINK, url: "x" }])],
  ["do_not_cover given but no pages fed", validReply({ internal_links: null }), { gscPages: null }],
  ["do_not_cover null when pages fed", withCover(null)],
  ["do_not_cover over DO_NOT_COVER_CAP", withCover(overCap(DO_NOT_COVER_CAP, { topic: "topic" })), { gscPages: MANY_PAGES }],
  ["do_not_cover page_ref repeated", withCover([COVER, { ...COVER, topic: "again" }])],
  ["do_not_cover unknown page", withCover([{ ...COVER, page_ref: "G9" }])],
  ["do_not_cover topic empty", withCover([{ ...COVER, topic: "" }])],
  ["do_not_cover topic over MODEL_TEXT_MAX_CHARS", withCover([{ ...COVER, topic: LONG_TEXT }])],
  ["do_not_cover item with extra key", withCover([{ ...COVER, url: "x" }])],
];

describe("runContentBriefLlm validation_failed", () => {
  it.each(COUNTEREXAMPLES)("%s", async (_name, reply, overrides = {}) => {
    const { result } = await runWithReply(reply, overrides);
    expect(result.output).toBeNull();
    expect(result.reads).toEqual({
      status: "unavailable",
      reason: "validation_failed",
      attempted: 1,
      calls: 1,
      model_id: "brief-deployment-2026",
      input_tokens: 900,
      output_tokens: 350,
    });
  });

  it("accepts a subset of the questions as long as the outline answers all of them, an empty h3 and empty link lists", async () => {
    const reply = validReply({
      questions: [{ id: "Q2", q: "What does it cost?" }],
      outline: [{ h2: "Everything", h3: [], answers: ["Q1", "Q2", "Q3"] }],
      internal_links: [],
      do_not_cover: [],
    });
    const { result } = await runWithReply(reply);
    expect(result.reads.status).toBe("complete");
    expect(result.output).toEqual(reply);
  });

  it("accepts null for every optional field when nothing was fed and no outline was requested", async () => {
    const reply = validReply({
      outline: null,
      gap_angle: null,
      internal_links: null,
      do_not_cover: null,
    });
    const { result } = await runWithReply(reply, {
      requestOutline: false,
      facts: null,
      gscPages: null,
    });
    expect(result.reads.status).toBe("complete");
    expect(result.output).toEqual(reply);
  });
});
