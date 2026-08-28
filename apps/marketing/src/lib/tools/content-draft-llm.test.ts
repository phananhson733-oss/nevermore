import {
  COVERAGE_MAX_OUTPUT_TOKENS,
  COVERAGE_TIMEOUT_MS,
  DRAFT_TOTAL_BUDGET_MS,
  ENVELOPE_MS,
  MODEL_TEXT_MAX_CHARS,
  SECTION_MAX_ATTEMPTS,
  SECTION_MAX_OUTPUT_TOKENS,
  SECTION_TIMEOUT_MS,
} from "@sf/public-tools/content-brief/constants";
import type {
  ModelCoverageOutput,
  ModelSectionOutput,
  ProfileFact,
} from "@sf/public-tools/content-brief/contract";
import { describe, expect, it } from "vitest";

import {
  CONTENT_DRAFT_COVERAGE_TEMPERATURE,
  CONTENT_DRAFT_LLM_TEMPERATURE,
  generateDraftSection,
  parseModelCoverageShape,
  parseModelSectionShape,
  runDraftCoverage,
  type DraftCoverageInput,
  type DraftSectionInput,
} from "./content-draft-llm.ts";
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
  model: "draft-deployment",
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

function sectionInput(
  overrides: Partial<DraftSectionInput> = {},
): DraftSectionInput {
  return {
    section: {
      id: "O2",
      h2: "Pricing and setup",
      h3: ["Per-provider pricing"],
      answers: ["Q1", "Q2"],
    },
    questions: [
      {
        id: "Q1",
        q: "What does medical billing software cost?",
        members: [
          { observation_id: "C1", heading: "Pricing" },
          { observation_id: "C2", heading: "How much does it cost" },
        ],
      },
      {
        id: "Q2",
        q: "How long does setup take?",
        members: [
          { observation_id: "C2", heading: "Setup time" },
          { observation_id: "C3", heading: "Getting started" },
        ],
      },
    ],
    pages: [
      {
        id: "C1",
        url: "https://competitor-1.example/billing",
        excerpts: [{ heading: "Pricing", text: "Plans start at $99 per provider per month." }],
      },
      {
        id: "C2",
        url: "https://competitor-2.example/claims",
        excerpts: [
          { heading: "How much does it cost", text: "Most vendors charge per provider." },
          { heading: "Setup time", text: "Setup takes two to four weeks." },
        ],
      },
      { id: "C3", url: "https://competitor-3.example/", excerpts: [] },
    ],
    facts: FACTS,
    gapAngle: {
      value: "Same-day claim submission",
      rationale: "No competitor page promises same-day submission.",
    },
    settings: { tone: "explanatory", person: "second", product_mention: "gap_only" },
    language: "en",
    primary: "medical billing software",
    deadlineAt: NOW + DRAFT_TOTAL_BUDGET_MS,
    ...overrides,
  };
}

function validSection(
  overrides: Partial<ModelSectionOutput> = {},
): ModelSectionOutput {
  return {
    paragraphs: [
      {
        sentences: [
          { text: "Most vendors price per provider, from about $99 a month.", claim: "bound", evidence_refs: ["C1", "C2"] },
          { text: "Acme Billing is one of them.", claim: "bound", evidence_refs: ["P1"] },
        ],
      },
      {
        sentences: [
          { text: "Setup usually takes two to four weeks.", claim: "bound", evidence_refs: ["C2"] },
          { text: "Discounts for larger groups are common.", claim: "gap", evidence_refs: [] },
          { text: "That said, the bigger cost is time.", claim: "no_claim", evidence_refs: [] },
          { text: "Same-day submission changes that calculation.", claim: "stance", evidence_refs: ["P2"] },
        ],
      },
    ],
    ...overrides,
  };
}

function coverageInput(
  overrides: Partial<DraftCoverageInput> = {},
): DraftCoverageInput {
  return {
    primary: "medical billing software",
    language: "en",
    questions: [
      { id: "Q1", q: "What does medical billing software cost?" },
      { id: "Q2", q: "How long does setup take?" },
      { id: "Q3", q: "Does it handle denials?" },
    ],
    sections: [
      { id: "O1", h2: "How it works", text: "Claims go out the same day they are coded." },
      { id: "O2", h2: "Pricing and setup", text: "Most vendors price per provider. Setup takes weeks." },
    ],
    deadlineAt: NOW + DRAFT_TOTAL_BUDGET_MS,
    ...overrides,
  };
}

function validCoverage(
  overrides: Partial<ModelCoverageOutput> = {},
): ModelCoverageOutput {
  return {
    items: [
      { question_id: "Q1", status: "covered", covered_in: "O2", gap: null },
      { question_id: "Q2", status: "partial", covered_in: "O2", gap: "Does not say what delays setup." },
      { question_id: "Q3", status: "none", covered_in: null, gap: "Denial handling is never mentioned." },
    ],
    ...overrides,
  };
}

interface Recorder {
  readonly client: KeywordLlmClient;
  readonly requests: KeywordLlmRequest[];
}

interface RecorderOptions {
  readonly modelId?: string | null;
  readonly usage?: { readonly input: number | null; readonly output: number | null };
}

/** Replies are consumed in order; the last one repeats. An Error reply is thrown. */
function recorder(
  replies: readonly (string | Error)[],
  options: RecorderOptions = {},
): Recorder {
  const requests: KeywordLlmRequest[] = [];
  const usage = options.usage ?? { input: 900, output: 350 };
  return {
    requests,
    client: {
      complete: async (request) => {
        requests.push(request);
        const reply = replies[Math.min(requests.length, replies.length) - 1];
        if (reply === undefined) throw new Error("recorder has no reply");
        if (reply instanceof Error) throw reply;
        return {
          content: reply,
          usage: {
            inputTokens: usage.input,
            outputTokens: usage.output,
            requestCount: 1,
            retryCount: 0,
          },
          modelId: options.modelId === undefined ? "draft-deployment-2026" : options.modelId,
        };
      },
    },
  };
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

/* ------------------------------------------------------------------ */
/* generateDraftSection — failure branches                             */
/* ------------------------------------------------------------------ */

describe("generateDraftSection", () => {
  it("fails not_configured without calling when config is null", async () => {
    const rec = recorder([json(validSection())]);
    const result = await generateDraftSection(sectionInput(), {
      client: rec.client,
      config: null,
      now: () => NOW,
    });
    expect(rec.requests).toHaveLength(0);
    expect(result).toEqual({
      status: "failed",
      fail_reason: "not_configured",
      paragraphs: [],
      word_count: 0,
      attempts: 0,
      model_id: null,
      temperature_requested: CONTENT_DRAFT_LLM_TEMPERATURE,
      temperature_effective: null,
      input_tokens: null,
      output_tokens: null,
    });
  });

  it("resolves the config from the injected env, reading only CONTENT_DRAFT_*", async () => {
    const rec = recorder([json(validSection())]);
    const missing = await generateDraftSection(sectionInput(), {
      client: rec.client,
      env: { CONTENT_BRIEF_API_KEY: "k", CONTENT_BRIEF_MODEL: "m", OPENAI_API_KEY: "k", OPENAI_MODEL: "m" },
      now: () => NOW,
    });
    expect(missing.fail_reason).toBe("not_configured");
    expect(rec.requests).toHaveLength(0);

    const present = await generateDraftSection(sectionInput(), {
      client: rec.client,
      env: { CONTENT_DRAFT_API_KEY: "k", CONTENT_DRAFT_MODEL: "env-model" },
      now: () => NOW,
    });
    expect(present.status).toBe("ok");
    expect(rec.requests).toHaveLength(1);
  });

  it("fails timeout without calling when the budget is already spent", async () => {
    const rec = recorder([json(validSection())]);
    const result = await generateDraftSection(
      sectionInput({ deadlineAt: NOW + ENVELOPE_MS }),
      { client: rec.client, config: CONFIG, now: () => NOW },
    );
    expect(rec.requests).toHaveLength(0);
    expect(result).toMatchObject({
      status: "failed",
      fail_reason: "timeout",
      attempts: 0,
      model_id: null,
      temperature_effective: null,
    });
  });

  it("sends the task temperature, the section output cap and min(SECTION_TIMEOUT_MS, remaining budget)", async () => {
    const full = recorder([json(validSection())]);
    await generateDraftSection(sectionInput(), { client: full.client, config: CONFIG, now: () => NOW });
    expect(full.requests[0]).toMatchObject({
      temperature: CONTENT_DRAFT_LLM_TEMPERATURE,
      maxOutputTokens: SECTION_MAX_OUTPUT_TOKENS,
      timeoutMs: SECTION_TIMEOUT_MS,
    });

    const remaining = Math.floor(SECTION_TIMEOUT_MS / 2);
    const short = recorder([json(validSection())]);
    await generateDraftSection(
      sectionInput({ deadlineAt: NOW + ENVELOPE_MS + remaining }),
      { client: short.client, config: CONFIG, now: () => NOW },
    );
    expect(short.requests[0]?.timeoutMs).toBe(remaining);
  });

  it("fails timeout after one attempt when the client times out, without retrying", async () => {
    const rec = recorder([new KeywordLlmError("timeout", "LLM request timed out.")]);
    const result = await generateDraftSection(sectionInput(), {
      client: rec.client,
      config: CONFIG,
      now: () => NOW,
    });
    expect(rec.requests).toHaveLength(1);
    expect(result).toMatchObject({
      status: "failed",
      fail_reason: "timeout",
      attempts: 1,
      paragraphs: [],
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
  ])("maps client reason %s to provider_error after one attempt", async (reason) => {
    const rec = recorder([new KeywordLlmError(reason, "failed")]);
    const result = await generateDraftSection(sectionInput(), {
      client: rec.client,
      config: CONFIG,
      now: () => NOW,
    });
    expect(rec.requests).toHaveLength(1);
    expect(result).toMatchObject({ status: "failed", fail_reason: "provider_error", attempts: 1 });
  });

  it("maps the client's own schema_invalid to validation_failed", async () => {
    const rec = recorder([new KeywordLlmError("schema_invalid", "bad shape")]);
    const result = await generateDraftSection(sectionInput(), {
      client: rec.client,
      config: CONFIG,
      now: () => NOW,
    });
    expect(result).toMatchObject({ fail_reason: "validation_failed", attempts: 1 });
  });

  it("keeps the tokens a billed-but-empty reply burned", async () => {
    const rec = recorder([
      new KeywordLlmError("invalid_response", "no content", {
        inputTokens: 1200,
        outputTokens: 2500,
        requestCount: 1,
        retryCount: 0,
      }),
    ]);
    const result = await generateDraftSection(sectionInput(), {
      client: rec.client,
      config: CONFIG,
      now: () => NOW,
    });
    expect(result).toMatchObject({
      fail_reason: "provider_error",
      input_tokens: 1200,
      output_tokens: 2500,
    });
  });

  it("rethrows anything that is not a KeywordLlmError", async () => {
    const rec = recorder([new TypeError("bug")]);
    await expect(
      generateDraftSection(sectionInput(), { client: rec.client, config: CONFIG, now: () => NOW }),
    ).rejects.toThrow(TypeError);
  });

  /* ---------------------------------------------------------------- */
  /* validation and retry                                              */
  /* ---------------------------------------------------------------- */

  const boundWithoutRefs = validSection({
    paragraphs: [
      { sentences: [{ text: "Plans start at $99.", claim: "bound", evidence_refs: [] }] },
    ],
  });

  it("retries once on a rejected reply and fails validation_failed when the retry is rejected too", async () => {
    const rec = recorder([json(boundWithoutRefs)]);
    const result = await generateDraftSection(sectionInput(), {
      client: rec.client,
      config: CONFIG,
      now: () => NOW,
    });
    expect(rec.requests).toHaveLength(SECTION_MAX_ATTEMPTS);
    expect(result).toEqual({
      status: "failed",
      fail_reason: "validation_failed",
      paragraphs: [],
      word_count: 0,
      attempts: SECTION_MAX_ATTEMPTS,
      model_id: "draft-deployment-2026",
      temperature_requested: CONTENT_DRAFT_LLM_TEMPERATURE,
      temperature_effective: null,
      // Both attempts were billed; the sum is what the run cost.
      input_tokens: 900 * SECTION_MAX_ATTEMPTS,
      output_tokens: 350 * SECTION_MAX_ATTEMPTS,
    });
  });

  it("succeeds with attempts 2 when the first reply is rejected and the retry passes, telling the retry why", async () => {
    const rec = recorder([json(boundWithoutRefs), json(validSection())]);
    const result = await generateDraftSection(sectionInput(), {
      client: rec.client,
      config: CONFIG,
      now: () => NOW,
    });
    expect(result.status).toBe("ok");
    expect(result.attempts).toBe(2);
    expect(result.input_tokens).toBe(1800);
    expect(rec.requests[0]?.user).not.toContain("PREVIOUS REPLY REJECTED");
    expect(rec.requests[1]?.user).toContain(
      'PREVIOUS REPLY REJECTED: rule "bound_without_refs" at paragraphs[0].sentences[0].evidence_refs.',
    );
    // The retry is the same task with one extra line, not a different prompt.
    expect(rec.requests[1]?.system).toBe(rec.requests[0]?.system);
  });

  it("treats a reply that is not JSON, or not the ModelSectionOutput shape, as a rejection", async () => {
    const rec = recorder(["not json at all", json({ paragraphs: [], extra: 1 })]);
    const result = await generateDraftSection(sectionInput(), {
      client: rec.client,
      config: CONFIG,
      now: () => NOW,
    });
    expect(result).toMatchObject({ fail_reason: "validation_failed", attempts: 2 });
    expect(rec.requests[1]?.user).toContain('rule "shape" at the whole reply');
  });

  it("does not spend a retry it cannot afford: a rejected reply with no budget left is validation_failed after one attempt", async () => {
    const clock = [NOW, NOW + DRAFT_TOTAL_BUDGET_MS];
    let tick = 0;
    const rec = recorder([json(boundWithoutRefs)]);
    const result = await generateDraftSection(sectionInput(), {
      client: rec.client,
      config: CONFIG,
      now: () => clock[Math.min(tick++, clock.length - 1)] ?? NOW,
    });
    expect(rec.requests).toHaveLength(1);
    expect(result).toMatchObject({ fail_reason: "validation_failed", attempts: 1 });
  });

  it("refuses a bound claim that cites a page listed without excerpts", async () => {
    const rec = recorder([
      json(validSection({
        paragraphs: [
          { sentences: [{ text: "Getting started is easy.", claim: "bound", evidence_refs: ["C3"] }] },
        ],
      })),
    ]);
    const result = await generateDraftSection(sectionInput(), {
      client: rec.client,
      config: CONFIG,
      now: () => NOW,
    });
    expect(result.fail_reason).toBe("validation_failed");
    expect(rec.requests[1]?.user).toContain('rule "ref_not_citable"');
  });

  it("with no facts, any P* reference is rejected and the claim is never rewritten", async () => {
    const rec = recorder([json(validSection())]);
    const result = await generateDraftSection(sectionInput({ facts: [], gapAngle: null }), {
      client: rec.client,
      config: CONFIG,
      now: () => NOW,
    });
    expect(result.status).toBe("failed");
    expect(result.fail_reason).toBe("validation_failed");
    expect(result.paragraphs).toEqual([]);
    expect(rec.requests[1]?.user).toContain('rule "ref_unknown"');
    // A section with no facts and no gap angle carries neither block.
    expect(rec.requests[0]?.user).toContain("PRODUCT FACTS: none for this section.");
    expect(rec.requests[0]?.user).not.toContain("GAP ANGLE");
  });

  it("with no facts, a section that cites only C* ids succeeds", async () => {
    const rec = recorder([
      json({
        paragraphs: [
          {
            sentences: [
              { text: "Plans start at $99 per provider.", claim: "bound", evidence_refs: ["C1"] },
              { text: "Discounts vary.", claim: "gap", evidence_refs: [] },
            ],
          },
        ],
      }),
    ]);
    const result = await generateDraftSection(sectionInput({ facts: [], gapAngle: null }), {
      client: rec.client,
      config: CONFIG,
      now: () => NOW,
    });
    expect(result.status).toBe("ok");
    expect(result.attempts).toBe(1);
  });

  /* ---------------------------------------------------------------- */
  /* happy path                                                        */
  /* ---------------------------------------------------------------- */

  it("returns the validated sentences with server-derived support_count and word_count", async () => {
    const rec = recorder([json(validSection())]);
    const result = await generateDraftSection(sectionInput(), {
      client: rec.client,
      config: CONFIG,
      now: () => NOW,
    });
    expect(result.status).toBe("ok");
    expect(result.fail_reason).toBeNull();
    expect(result.attempts).toBe(1);
    expect(result.model_id).toBe("draft-deployment-2026");
    expect(result.temperature_requested).toBe(CONTENT_DRAFT_LLM_TEMPERATURE);
    expect(result.temperature_effective).toBeNull();
    expect(result.input_tokens).toBe(900);
    expect(result.output_tokens).toBe(350);
    const sentences = result.paragraphs.flatMap((paragraph) => paragraph.sentences);
    expect(sentences.map((sentence) => [sentence.claim, sentence.support_count])).toEqual([
      ["bound", 2],
      ["bound", 0], // P1 only: profile_only downstream
      ["bound", 1], // C2 only: single_source downstream
      ["gap", 0],
      ["no_claim", 0],
      ["stance", 0],
    ]);
    expect(sentences[0]?.evidence_refs).toEqual(["C1", "C2"]);
    expect(result.word_count).toBe(
      sentences.reduce((sum, sentence) => sum + sentence.text.split(/\s+/u).length, 0),
    );
  });

  it("reports the deployment pin as temperature_effective and falls back to the configured model id", async () => {
    const pinned: KeywordLlmConfig = { ...CONFIG, temperature: 1 };
    const rec = recorder([json(validSection())], { modelId: null });
    const result = await generateDraftSection(sectionInput(), {
      client: rec.client,
      config: pinned,
      now: () => NOW,
    });
    expect(result.temperature_requested).toBe(CONTENT_DRAFT_LLM_TEMPERATURE);
    expect(result.temperature_effective).toBe(1);
    expect(result.model_id).toBe("draft-deployment");
  });

  it("reports the pin on a failed call too, but never before a call was made", async () => {
    const pinned: KeywordLlmConfig = { ...CONFIG, temperature: 1 };
    const failed = recorder([new KeywordLlmError("server_error", "500")]);
    const afterCall = await generateDraftSection(sectionInput(), {
      client: failed.client,
      config: pinned,
      now: () => NOW,
    });
    expect(afterCall.temperature_effective).toBe(1);

    const spent = await generateDraftSection(sectionInput({ deadlineAt: NOW }), {
      client: failed.client,
      config: pinned,
      now: () => NOW,
    });
    expect(spent.temperature_effective).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* parseModelSectionShape                                              */
/* ------------------------------------------------------------------ */

describe("parseModelSectionShape", () => {
  it("accepts the exact shape and returns it unchanged", () => {
    const output = validSection();
    const parsed = parseModelSectionShape(json(output));
    expect(parsed).toEqual({ ok: true, output });
  });

  const sentence = { text: "x", claim: "gap", evidence_refs: [] };

  it.each<[string, unknown, string]>([
    ["non-JSON", "{", ""],
    ["an array root", [], ""],
    ["an extra root key", { paragraphs: [{ sentences: [sentence] }], word_count: 3 }, ""],
    ["a missing root key", {}, ""],
    ["no paragraphs", { paragraphs: [] }, "paragraphs"],
    ["a paragraph with an extra key", { paragraphs: [{ sentences: [sentence], heading: "x" }] }, "paragraphs[0]"],
    ["an empty paragraph", { paragraphs: [{ sentences: [] }] }, "paragraphs[0].sentences"],
    ["a sentence with a server-only key", { paragraphs: [{ sentences: [{ ...sentence, support_count: 1 }] }] }, "paragraphs[0].sentences[0]"],
    ["a non-string text", { paragraphs: [{ sentences: [{ ...sentence, text: 1 }] }] }, "paragraphs[0].sentences[0].text"],
    ["an unknown claim", { paragraphs: [{ sentences: [{ ...sentence, claim: "verified" }] }] }, "paragraphs[0].sentences[0].claim"],
    ["a non-string ref", { paragraphs: [{ sentences: [{ ...sentence, evidence_refs: [1] }] }] }, "paragraphs[0].sentences[0].evidence_refs"],
    ["refs as a string", { paragraphs: [{ sentences: [{ ...sentence, evidence_refs: "C1" }] }] }, "paragraphs[0].sentences[0].evidence_refs"],
  ])("rejects %s at the offending path", (_label, value, path) => {
    const content = typeof value === "string" ? value : json(value);
    expect(parseModelSectionShape(content)).toEqual({ ok: false, path });
  });
});

/* ------------------------------------------------------------------ */
/* runDraftCoverage                                                    */
/* ------------------------------------------------------------------ */

describe("runDraftCoverage", () => {
  it("returns an empty item list without calling when there is no askable question", async () => {
    const rec = recorder([json(validCoverage())]);
    const result = await runDraftCoverage(coverageInput({ questions: [] }), {
      client: rec.client,
      config: CONFIG,
      now: () => NOW,
    });
    expect(rec.requests).toHaveLength(0);
    expect(result).toEqual({
      items: [],
      reads: {
        status: "unavailable",
        reason: "insufficient_evidence",
        attempted: 0,
        calls: 0,
        model_id: null,
        input_tokens: null,
        output_tokens: null,
      },
    });
  });

  it("records not_configured without calling when config is null", async () => {
    const rec = recorder([json(validCoverage())]);
    const result = await runDraftCoverage(coverageInput(), {
      client: rec.client,
      config: null,
      now: () => NOW,
    });
    expect(rec.requests).toHaveLength(0);
    expect(result.items).toBeNull();
    expect(result.reads).toMatchObject({ status: "unavailable", reason: "not_configured", attempted: 0, calls: 0 });
  });

  it("records timeout without calling when the budget is already spent", async () => {
    const rec = recorder([json(validCoverage())]);
    const result = await runDraftCoverage(coverageInput({ deadlineAt: NOW + ENVELOPE_MS }), {
      client: rec.client,
      config: CONFIG,
      now: () => NOW,
    });
    expect(rec.requests).toHaveLength(0);
    expect(result.items).toBeNull();
    expect(result.reads).toMatchObject({ reason: "timeout", attempted: 0 });
  });

  it("asks at temperature 0 with the coverage cap and min(COVERAGE_TIMEOUT_MS, remaining), in a context that never saw the section rules", async () => {
    const rec = recorder([json(validCoverage())]);
    await runDraftCoverage(coverageInput(), { client: rec.client, config: CONFIG, now: () => NOW });
    const request = rec.requests[0];
    expect(request).toMatchObject({
      temperature: CONTENT_DRAFT_COVERAGE_TEMPERATURE,
      maxOutputTokens: COVERAGE_MAX_OUTPUT_TOKENS,
      timeoutMs: COVERAGE_TIMEOUT_MS,
    });
    expect(CONTENT_DRAFT_COVERAGE_TEMPERATURE).toBe(0);
    expect(request?.user).toContain("Most vendors price per provider. Setup takes weeks.");
    expect(request?.user).toContain("Does it handle denials?");
    for (const text of [request?.system ?? "", request?.user ?? ""]) {
      expect(text).not.toContain("CLAIM LABELS");
      expect(text).not.toContain("evidence_refs");
    }

    const remaining = Math.floor(COVERAGE_TIMEOUT_MS / 3);
    const short = recorder([json(validCoverage())]);
    await runDraftCoverage(coverageInput({ deadlineAt: NOW + ENVELOPE_MS + remaining }), {
      client: short.client,
      config: CONFIG,
      now: () => NOW,
    });
    expect(short.requests[0]?.timeoutMs).toBe(remaining);
  });

  it("maps a client timeout and provider failures onto the read", async () => {
    const timedOut = recorder([new KeywordLlmError("timeout", "LLM request timed out.")]);
    const timeout = await runDraftCoverage(coverageInput(), { client: timedOut.client, config: CONFIG, now: () => NOW });
    expect(timeout.items).toBeNull();
    expect(timeout.reads).toEqual({
      status: "unavailable",
      reason: "timeout",
      attempted: 1,
      calls: 0,
      model_id: null,
      input_tokens: null,
      output_tokens: null,
    });

    const limited = recorder([new KeywordLlmError("rate_limited", "429")]);
    const provider = await runDraftCoverage(coverageInput(), { client: limited.client, config: CONFIG, now: () => NOW });
    expect(provider.items).toBeNull();
    expect(provider.reads).toMatchObject({ reason: "provider_error", attempted: 1 });
  });

  it("rethrows anything that is not a KeywordLlmError", async () => {
    const rec = recorder([new RangeError("bug")]);
    await expect(
      runDraftCoverage(coverageInput(), { client: rec.client, config: CONFIG, now: () => NOW }),
    ).rejects.toThrow(RangeError);
  });

  it("records validation_failed with the billed call when the reply is not JSON", async () => {
    const rec = recorder(["all questions are covered, trust me"]);
    const result = await runDraftCoverage(coverageInput(), { client: rec.client, config: CONFIG, now: () => NOW });
    expect(rec.requests).toHaveLength(1);
    expect(result.items).toBeNull();
    expect(result.reads).toEqual({
      status: "unavailable",
      reason: "validation_failed",
      attempted: 1,
      calls: 1,
      model_id: "draft-deployment-2026",
      input_tokens: 900,
      output_tokens: 350,
    });
  });

  it("returns a shape-valid reply untouched even when its ids are wrong: that judgement is validateCoverageOutput's, in the handler", async () => {
    const reply = validCoverage({
      items: [
        { question_id: "Q9", status: "covered", covered_in: "O3", gap: null },
        ...validCoverage().items.slice(1),
      ],
    });
    const rec = recorder([json(reply)]);
    const result = await runDraftCoverage(coverageInput(), { client: rec.client, config: CONFIG, now: () => NOW });
    expect(result.items).toEqual(reply.items);
    expect(result.reads.status).toBe("complete");
  });

  it("returns the ModelCoverageOutput items with a complete read on the happy path", async () => {
    const rec = recorder([json(validCoverage())]);
    const result = await runDraftCoverage(coverageInput(), { client: rec.client, config: CONFIG, now: () => NOW });
    expect(result.items).toEqual(validCoverage().items);
    expect(result.reads).toEqual({
      status: "complete",
      calls: 1,
      model_id: "draft-deployment-2026",
      temperature_requested: 0,
      temperature_effective: null,
      input_tokens: 900,
      output_tokens: 350,
    });
  });

  it("reports the deployment pin as temperature_effective, never the requested 0 by assumption", async () => {
    const rec = recorder([json(validCoverage())]);
    const result = await runDraftCoverage(coverageInput(), {
      client: rec.client,
      config: { ...CONFIG, temperature: 1 },
      now: () => NOW,
    });
    expect(result.reads).toMatchObject({ temperature_requested: 0, temperature_effective: 1 });
  });

  it("cleans gap text through the shared decoder, so the value stored is the value the parser accepts", async () => {
    const reply = validCoverage({
      items: [
        ...validCoverage().items.slice(0, 2),
        { question_id: "Q3", status: "none", covered_in: null, gap: "  <b>Denials</b>\n are   missing " },
      ],
    });
    const rec = recorder([json(reply)]);
    const result = await runDraftCoverage(coverageInput(), { client: rec.client, config: CONFIG, now: () => NOW });
    expect(result.items?.[2]?.gap).toBe("bDenials/b are missing");
  });
});

/* ------------------------------------------------------------------ */
/* parseModelCoverageShape                                             */
/* ------------------------------------------------------------------ */

describe("parseModelCoverageShape", () => {
  it("accepts the exact shape", () => {
    const output = validCoverage();
    expect(parseModelCoverageShape(json(output))).toEqual({ ok: true, output });
  });

  const item = { question_id: "Q1", status: "none", covered_in: null, gap: "x" };

  it.each<[string, unknown, string]>([
    ["non-JSON", "nope", ""],
    ["an extra root key", { items: [item], total: 3 }, ""],
    ["items that are not a list", { items: {} }, "items"],
    ["an item with an extra key", { items: [{ ...item, method: "model" }] }, "items[0]"],
    ["a non-string question id", { items: [{ ...item, question_id: 1 }] }, "items[0].question_id"],
    ["an unknown status", { items: [{ ...item, status: "mostly" }] }, "items[0].status"],
    ["a non-string covered_in", { items: [{ ...item, covered_in: 2 }] }, "items[0].covered_in"],
    ["an empty gap", { items: [{ ...item, gap: "   " }] }, "items[0].gap"],
    ["a gap over MODEL_TEXT_MAX_CHARS", { items: [{ ...item, gap: "g".repeat(MODEL_TEXT_MAX_CHARS + 1) }] }, "items[0].gap"],
    ["a non-string gap", { items: [{ ...item, gap: false }] }, "items[0].gap"],
  ])("rejects %s at the offending path", (_label, value, path) => {
    const content = typeof value === "string" ? value : json(value);
    expect(parseModelCoverageShape(content)).toEqual({ ok: false, path });
  });

  it("leaves which ids and which status/field combinations are legal to validateCoverageOutput", () => {
    // Shape-valid, semantically wrong: an unknown id and a covered item with a gap both pass here.
    const parsed = parseModelCoverageShape(
      json({ items: [{ question_id: "Q9", status: "covered", covered_in: null, gap: "x" }] }),
    );
    expect(parsed.ok).toBe(true);
  });
});
