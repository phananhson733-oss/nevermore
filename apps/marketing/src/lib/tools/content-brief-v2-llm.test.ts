import { describe, expect, it } from "vitest";
import { LLM_DEADLINE_MS } from "@sf/public-tools/content-brief/constants";
import { buildResearchBundle, parseResearchBundle } from "@sf/public-tools/content-brief/v2-research";
import type { ResearchPage } from "@sf/public-tools/content-brief/v2-contract";
import type { BriefV2Context, ModelBriefV2Output } from "@sf/public-tools/content-brief/v2-generation-contract";
import { parseBriefV2Context } from "@sf/public-tools/content-brief/v2-generation";
import { buildSerpObservations } from "@sf/public-tools/content-brief/assemble";
import { runContentBriefV2Llm } from "./content-brief-v2-llm.ts";
import { createKeywordLlmClient, KeywordLlmError, type KeywordLlmClient, type KeywordLlmConfig, type KeywordLlmFailureReason, type KeywordLlmRequest } from "./keyword-llm-client.ts";

const NOW = 1_800_000_000_000;
const CONFIG: KeywordLlmConfig = { apiKey: "test-key", model: "brief-deployment", url: "https://llm.example/v1/chat/completions", authScheme: "bearer", temperature: null };
// An independently authored response, not assembled by the parser under test.
const RESPONSE = `{
  "research":{"questions":[{"anchor":"U1","q":"How does medical billing software validate claims?","sources":["U1","U2"]}],"outline":[{"h2":"Validate claims before submission","h3":["Insurance checks"],"answers":["U1"]}]},
  "intent":{"value":"informational","rationale":"The material explains how claim validation works."},
  "format":{"value":"guide","rationale":"A procedural guide can answer the selected question."},
  "page_plan":{"action":"create","rationale":"No matching owned page was observed in the complete query sample; this is not a site-wide absence claim.","target_ref":null,"steps":[]},
  "gap_angle":null,"internal_links":[],"do_not_cover":[]
}`;

function page(id = "C1", chinese = false, segments = 1): ResearchPage {
  return {
    id, role: id.startsWith("T") ? "owned" : "competitor", url: `https://${id.toLowerCase()}.example/billing`, final_url: `https://${id.toLowerCase()}.example/billing`,
    fetched_at: "2026-08-31T00:00:00.000Z", content_hash: "a".repeat(64), body_complete: true,
    research: { segments: Array.from({ length: segments }, () => ({ heading: chinese ? { level: "h2", text: "题".repeat(160) } : null, text: chinese ? "医".repeat(300) : "Medical billing software checks insurance eligibility and validates claim codes before submission.", truncated: false })), segments_total: segments, omitted_segments: 0, length: chinese ? { value: 460 * segments, unit: "non_whitespace_characters", tokenizer: "unicode_code_points" } : { value: 13 * segments, unit: "words", tokenizer: "whitespace" } },
  };
}

function context(pages: ResearchPage[] = [page()]): BriefV2Context {
  const research = buildResearchBundle(pages, [{ id: "A1", question: "How does medical billing validate claims?", seed_question: null }]);
  if (!research.ok) throw new Error(research.path);
  return {
    input: { primary: "medical billing software", supporting: ["claims software"], market: "US", language: "en" },
    research: research.value, facts: [], profile_snapshot: null,
    gsc: { status: "complete", property: "sc-domain:owned.example", window: { start: "2026-08-01", end: "2026-08-28", lookback_days: 28 }, reason: null, matches: [], omitted_matches: 0 },
    candidates: [],
  };
}

function recorder(reply: string | Error = RESPONSE) {
  const requests: KeywordLlmRequest[] = [];
  const client: KeywordLlmClient = { complete: async (request) => {
    requests.push(request);
    if (reply instanceof Error) throw reply;
    return { content: reply, modelId: "deployment-reported", usage: { requestCount: 1, retryCount: 0, inputTokens: 1200, outputTokens: 500 } };
  } };
  return { client, requests };
}

async function run(reply: string | Error = RESPONSE, data = context()) {
  const recorded = recorder(reply);
  const result = await runContentBriefV2Llm({ context: data, deadlineAt: NOW + 45_000 }, { config: CONFIG, client: recorded.client, now: () => NOW });
  return { ...recorded, result };
}

function updateFixture() {
  const data = context([page("C1"), page("T1")]);
  const owned = { ...data, gsc: { ...data.gsc, property: "sc-domain:t1.example", matches: [{ id: "G1", query: "claims software", keyword: "claims software", scope: "supporting" as const, page: "https://t1.example/billing", clicks: 0, impressions: 1, position: 80 }] }, candidates: [{ id: "T1", url: "https://t1.example/billing", match_refs: ["G1"], read: "observed" as const }] };
  const raw = JSON.parse(RESPONSE) as ModelBriefV2Output;
  const output: ModelBriefV2Output = { ...raw, page_plan: { action: "update", target_ref: "T1", rationale: "The observed page already explains the validation workflow, despite low supporting-query impressions.", steps: [{ kind: "rewrite", instruction: "Clarify insurance checks using the existing explanation.", sources: ["U2"], answers: ["U1"] }] } };
  return { owned, output };
}

describe("one-call Brief v2 assembly", () => {
  it("assembles v3 section-owned questions through the strict graph validator in one Luna call", async () => {
    const original = context();
    const data = { ...original, serp: { rows: buildSerpObservations([{ rank: 1, url: original.research.pages[0]!.url, title: "Medical billing guide", domain: "c1.example" }]), read: { status: "partial" as const, requested: 10, returned: 1, unresolved: 0 } } };
    const response = JSON.parse(RESPONSE);
    response.research = { sections: [{ h2: "Validate claims before submission", h3: ["Insurance checks"], questions: [{ anchor: "U1", q: "How does medical billing software validate claims?", sources: ["U1", "U2"] }] }] };
    const recorded = recorder(JSON.stringify(response));
    const result = await runContentBriefV2Llm({ context: data, deadlineAt: NOW + 45_000 }, { config: { ...CONFIG, model: "gpt-5.6-luna", temperature: 1 }, client: recorded.client, now: () => NOW });
    expect(result.output?.research.questions).toEqual([{ id: "Q1", anchor: "U1", q: "How does medical billing software validate claims?", source_refs: ["U1", "U2"], covered_by: 1, paa_refs: ["A1"] }]);
    expect(result.output?.research.outline).toEqual([{ id: "O1", h2: "Validate claims before submission", h3: ["Insurance checks"], answers: ["Q1"] }]);
    expect(recorded.requests).toHaveLength(1);
    expect(recorded.requests[0]).toMatchObject({ reasoningEffort: "none", timeoutMs: 30_000, maxOutputTokens: 4000 });
    expect(JSON.parse(recorded.requests[0]!.user).serp).toEqual(data.serp);
    expect(result.reads).toMatchObject({ status: "complete", calls: 1, input_tokens: 1200, output_tokens: 500 });
  });

  it.each(["brief-deployment", "gpt-5.6-sol", "gpt-5.6-luna-custom"])("does not opt unknown deployment %s into Luna reasoning behavior", async model => {
    const recorded = recorder();
    await runContentBriefV2Llm({ context: context(), deadlineAt: NOW + 45_000 }, { config: { ...CONFIG, model }, client: recorded.client, now: () => NOW });
    expect(recorded.requests[0]).not.toHaveProperty("reasoningEffort");
  });
  it("accepts one page plus PAA as one relevant question and usable outline, with server-assigned coverage", async () => {
    const { result, requests } = await run();
    expect(result.output).not.toBeNull();
    expect(result.output?.research.questions).toEqual([{ id: "Q1", anchor: "U1", q: "How does medical billing software validate claims?", source_refs: ["U1", "U2"], covered_by: 1, paa_refs: ["A1"] }]);
    expect(result.output?.research.outline).toEqual([{ id: "O1", h2: "Validate claims before submission", h3: ["Insurance checks"], answers: ["Q1"] }]);
    expect(result.output?.page_plan).toMatchObject({ action: "create", steps: [] });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ temperature: 0.2, timeoutMs: 30_000, maxOutputTokens: 4000 });
    expect(LLM_DEADLINE_MS).toBe(15_000);
    expect(result.reads).toEqual({ status: "complete", calls: 1, model_id: "deployment-reported", temperature_requested: 0.2, temperature_effective: null, input_tokens: 1200, output_tokens: 500 });
    expect(result.prompt_bytes).toBe(new TextEncoder().encode(JSON.stringify({ system: requests[0]!.system, user: requests[0]!.user })).byteLength);
  });

  it("accepts Chinese question and outline text without a whitespace-language gate", async () => {
    const data = { ...context([page("C1", true)]), input: { ...context().input, primary: "医疗账单软件", language: "zh" } };
    const raw = JSON.parse(RESPONSE) as ModelBriefV2Output;
    const chinese = { ...raw, research: { questions: [{ anchor: "U1", q: "医疗账单软件如何验证索赔？", sources: ["U1", "U2"] }], outline: [{ h2: "提交前验证索赔", h3: ["检查保险资格"], answers: ["U1"] }] } };
    const { result, requests } = await run(JSON.stringify(chinese), data);
    expect(result.output?.research.questions[0]?.q).toBe("医疗账单软件如何验证索赔？");
    expect(JSON.parse(requests[0]!.user).input.language).toBe("zh");
    expect(result.context.research.pages[0]?.research.length.unit).toBe("non_whitespace_characters");
  });

  it("keeps PAA-only questions writable without inventing factual or competitor coverage", async () => {
    const raw = JSON.parse(RESPONSE) as ModelBriefV2Output;
    const paaOnly = { ...raw, research: { questions: [{ anchor: "U1", q: "How does medical billing validate claims?", sources: ["U1"] }], outline: [{ h2: "Understand claim validation", h3: [], answers: ["U1"] }] } };
    const { result } = await run(JSON.stringify(paaOnly), context([]));
    expect(result.output?.research.questions[0]).toMatchObject({ covered_by: 0, paa_refs: ["A1"] });
    expect(result.output?.page_plan.steps).toEqual([]);
  });

  it("binds a supporting-query rewrite to an actually observed owned target", async () => {
    const { owned, output } = updateFixture();
    const { result } = await run(JSON.stringify(output), owned);
    expect(result.output?.page_plan).toMatchObject({ action: "update", target_ref: "T1", steps: [{ kind: "rewrite", sources: ["U2"], answers: ["Q1"] }] });
  });

  it("assembles the differentiated angle, owned links and excluded topics in the same call as questions and the rewrite", async () => {
    const { owned, output } = updateFixture();
    const relatedUrl = "https://t1.example/validation";
    const research = buildResearchBundle([page("C1"), page("T1"), { ...page("T2"), url: relatedUrl, final_url: relatedUrl }], []);
    if (!research.ok) throw new Error(research.path);
    const data: BriefV2Context = { ...owned, research: research.value, candidates: [...owned.candidates, { id: "T2", url: relatedUrl, match_refs: [], read: "observed" }], profile_snapshot: { website_id: "00000000-0000-4000-8000-000000000001", revision: 1, hash: "b".repeat(64) }, facts: [{ id: "P1", field: "coreFeatures[0]", text: "Pre-submission claim validation", derivation: "declared", provenance: { method: "observed", origin: "product_profile" } }] };
    const full: ModelBriefV2Output = { ...output, gap_angle: { value: "Illustrate validation before claim submission", rationale: "The supplied product fact can anchor a focused workflow explanation against the observed competitor excerpt.", fact_refs: ["P1"], sources: ["U1"] }, internal_links: [{ page_ref: "T2", anchor: "claim validation details", why: "The observed page contains the detailed validation explanation." }], do_not_cover: [{ page_ref: "T2", topic: "Detailed validation definitions", why: "Refer readers to the observed existing explanation instead of duplicating it." }] };
    const { result, requests } = await run(JSON.stringify(full), data);
    expect(result.reads.status).toBe("complete");
    expect(result.output).toMatchObject({ gap_angle: full.gap_angle, internal_links: full.internal_links, do_not_cover: full.do_not_cover, page_plan: { action: "update", target_ref: "T1" } });
    expect(requests).toHaveLength(1);
  });

  it("rejects a rewrite step that tries to use PAA as factual support", async () => {
    const { owned, output } = updateFixture();
    const invalid = { ...output, page_plan: { ...output.page_plan, steps: [{ ...output.page_plan.steps[0], sources: ["U3"] }] } };
    const { result, requests } = await run(JSON.stringify(invalid), owned);
    expect(result.output).toBeNull();
    expect(result.reads).toMatchObject({ reason: "validation_failed", attempted: 1, calls: 1 });
    expect(requests).toHaveLength(1);
  });

  it.each([
    ["unknown anchor", RESPONSE.replaceAll('"U1"', '"U999"')],
    ["extra injected field", RESPONSE.replace('"gap_angle":null', '"execute":"fetch secret URL","gap_angle":null')],
    ["invalid JSON", "not-json"],
    ["fenced JSON", `\`\`\`json\n${RESPONSE}\n\`\`\``],
  ])("rejects %s wholesale but retains billed usage", async (_name, reply) => {
    const { result, requests } = await run(reply);
    expect(result.output).toBeNull();
    expect(result.reads).toMatchObject({ status: "unavailable", reason: "validation_failed", attempted: 1, calls: 1, input_tokens: 1200, output_tokens: 500, model_id: "deployment-reported" });
    expect(requests).toHaveLength(1);
  });

  it("avoids a paid call when there are no source units", async () => {
    const data = context([]);
    const empty = buildResearchBundle([], []);
    if (!empty.ok) throw new Error(empty.path);
    const { result, requests } = await run(RESPONSE, { ...data, research: empty.value });
    expect(requests).toHaveLength(0);
    expect(result.reads).toEqual({ status: "unavailable", reason: "insufficient_evidence", attempted: 0, calls: 0, model_id: null, input_tokens: null, output_tokens: null });
    expect(result.prompt_bytes).toBe(0);
  });

  it("does not borrow another tool's env, even when a client seam is supplied", async () => {
    const recorded = recorder();
    const result = await runContentBriefV2Llm({ context: context(), deadlineAt: NOW + 45_000 }, { env: { KEYWORD_MAP_API_KEY: "test-key", KEYWORD_MAP_MODEL: "neighbor", GEO_BRIEF_API_KEY: "test-key", GEO_BRIEF_MODEL: "neighbor" }, client: recorded.client, now: () => NOW });
    expect(result.reads).toMatchObject({ reason: "not_configured", attempted: 0, calls: 0 });
    expect(recorded.requests).toHaveLength(0);
  });

  it("resolves CONTENT_BRIEF config and records only the configured effective temperature", async () => {
    const recorded = recorder();
    const result = await runContentBriefV2Llm({ context: context(), deadlineAt: NOW + 45_000 }, { env: { CONTENT_BRIEF_API_KEY: "test-key", CONTENT_BRIEF_MODEL: "brief", CONTENT_BRIEF_TEMPERATURE: "1" }, client: recorded.client, now: () => NOW });
    expect(result.reads).toMatchObject({ status: "complete", temperature_effective: 1 });
    expect(recorded.requests).toHaveLength(1);
  });

  it.each([NOW, NOW + 5000, Number.NaN, Number.POSITIVE_INFINITY])("does not call with an exhausted/invalid deadline %s", async (deadlineAt) => {
    const recorded = recorder();
    const result = await runContentBriefV2Llm({ context: context(), deadlineAt }, { config: CONFIG, client: recorded.client, now: () => NOW });
    expect(result.reads).toMatchObject({ reason: "timeout", attempted: 0, calls: 0 });
    expect(recorded.requests).toHaveLength(0);
  });

  it("reserves 5 seconds for the response envelope", async () => {
    const recorded = recorder();
    await runContentBriefV2Llm({ context: context(), deadlineAt: NOW + 6200 }, { config: CONFIG, client: recorded.client, now: () => NOW });
    expect(recorded.requests[0]?.timeoutMs).toBe(1200);
  });

  it.each([30_000, 30_001])("rejects an otherwise valid completion at or after the call deadline (%s ms) and preserves its usage", async (elapsed) => {
    const recorded = recorder();
    let clock = NOW;
    const client: KeywordLlmClient = { complete: async (request) => { const response = await recorded.client.complete(request); clock = NOW + elapsed; return response; } };
    const result = await runContentBriefV2Llm({ context: context(), deadlineAt: NOW + 45_000 }, { config: CONFIG, client, now: () => clock });
    expect(result.output).toBeNull();
    expect(result.reads).toMatchObject({ reason: "timeout", attempted: 1, calls: 1, input_tokens: 1200, output_tokens: 500 });
  });

  it.each([
    ["timeout", "timeout"], ["network_error", "provider_error"], ["auth_failed", "provider_error"], ["rate_limited", "provider_error"],
    ["server_error", "provider_error"], ["bad_request", "provider_error"], ["invalid_response", "provider_error"], ["schema_invalid", "validation_failed"], ["not_configured", "not_configured"],
  ] as const)("maps %s without retry while preserving unknown token counts", async (reason: KeywordLlmFailureReason, expected) => {
    const { result, requests } = await run(new KeywordLlmError(reason, "redacted provider error", { requestCount: 1, retryCount: 0, inputTokens: null, outputTokens: 40 }));
    expect(requests).toHaveLength(1);
    expect(result.reads).toEqual({ status: "unavailable", reason: expected, attempted: 1, calls: 1, model_id: null, input_tokens: null, output_tokens: 40 });
  });

  it.each(["network_error", 400, 401, 429, 500, "invalid_json"] as const)("counts the factory client's attempted fetch for %s without inventing token usage", async (failure) => {
    let fetches = 0;
    const client = createKeywordLlmClient({ config: CONFIG, fetchImpl: async () => {
      fetches += 1;
      if (failure === "network_error") throw new TypeError("fixture network failure");
      return failure === "invalid_json" ? new Response("not JSON") : new Response(null, { status: failure });
    } });
    const result = await runContentBriefV2Llm({ context: context(), deadlineAt: NOW + 45_000 }, { config: CONFIG, client, now: () => NOW });
    expect(fetches).toBe(1);
    expect(result.output).toBeNull();
    expect(result.reads).toEqual({ status: "unavailable", reason: "provider_error", attempted: 1, calls: 1, model_id: null, input_tokens: null, output_tokens: null });
  });

  it("keeps the factory client's preflight configuration failure at zero attempted calls", async () => {
    let fetches = 0;
    const client = createKeywordLlmClient({ env: {}, fetchImpl: async () => { fetches += 1; return new Response(null); } });
    const result = await runContentBriefV2Llm({ context: context(), deadlineAt: NOW + 45_000 }, { config: CONFIG, client, now: () => NOW });
    expect(fetches).toBe(0);
    expect(result.reads).toEqual({ status: "unavailable", reason: "not_configured", attempted: 0, calls: 0, model_id: null, input_tokens: null, output_tokens: null });
  });

  it("never starts the factory client's fetch when only envelope time remains", async () => {
    let fetches = 0;
    const client = createKeywordLlmClient({ config: CONFIG, fetchImpl: async () => { fetches += 1; return new Response(null); } });
    const result = await runContentBriefV2Llm({ context: context(), deadlineAt: NOW + 5000 }, { config: CONFIG, client, now: () => NOW });
    expect(fetches).toBe(0);
    expect(result.reads).toEqual({ status: "unavailable", reason: "timeout", attempted: 0, calls: 0, model_id: null, input_tokens: null, output_tokens: null });
  });

  it("rethrows programming errors instead of blaming the provider", async () => {
    const failure = new TypeError("implementation error");
    await expect(run(failure)).rejects.toBe(failure);
  });

  it("rejects forged context before any paid call", async () => {
    const data = context();
    const { result, requests } = await run(RESPONSE, { ...data, research: { ...data.research, budget: { ...data.research.budget, page_units_retained: 59 } } });
    expect(result.reads).toMatchObject({ reason: "validation_failed", attempted: 0 });
    expect(requests).toHaveLength(0);
  });

  it("does not buy a response when legal first-party context alone exceeds the prompt budget", async () => {
    const data = context();
    const crowded: BriefV2Context = { ...data, profile_snapshot: { website_id: "00000000-0000-4000-8000-000000000001", revision: 1, hash: "b".repeat(64) }, facts: Array.from({ length: 32 }, (_, index) => ({ id: `P${index + 1}`, field: `field${index}${"x".repeat(1900)}`, text: "Declared product feature", derivation: "declared", provenance: { method: "observed", origin: "product_profile" } })) };
    expect(parseBriefV2Context(crowded).ok).toBe(true);
    const { result, requests } = await run(RESPONSE, crowded);
    expect(result.output).toBeNull();
    expect(result.reads).toMatchObject({ reason: "validation_failed", attempted: 0, calls: 0 });
    expect(result.prompt_bytes).toBe(0);
    expect(requests).toHaveLength(0);
    expect(result.context.facts).toEqual(crowded.facts);
  });

  it("normalizes free-text whitespace without repairing source IDs or mappings", async () => {
    const raw = JSON.parse(RESPONSE) as ModelBriefV2Output;
    const padded = { ...raw, research: { ...raw.research, questions: [{ ...raw.research.questions[0], q: "  How does\nmedical billing software validate claims?  " }] } };
    const { result } = await run(JSON.stringify(padded));
    expect(result.output?.research.questions[0]?.q).toBe("How does medical billing software validate claims?");
    const paddedId = JSON.stringify(padded).replaceAll('"U1"', '" U1 "');
    expect((await run(paddedId)).result.reads).toMatchObject({ reason: "validation_failed", attempted: 1 });
  });

  it("allows a reviewed empty assembly for wholly irrelevant evidence", async () => {
    const raw: ModelBriefV2Output = { research: { questions: [], outline: [] }, intent: null, format: null, page_plan: { action: "undecidable", target_ref: null, steps: [], rationale: "The supplied sources do not address this topic." }, gap_angle: null, internal_links: [], do_not_cover: [] };
    const { result } = await run(JSON.stringify(raw));
    expect(result.reads.status).toBe("complete");
    expect(result.output?.research).toEqual({ questions: [], outline: [] });
    expect(result.output?.page_plan.action).toBe("undecidable");
  });

  it("returns exactly the reduced CJK context used in the prompt, without mutating the caller", async () => {
    const data = context(Array.from({ length: 10 }, (_, i) => page(`C${i + 1}`, true, 12)));
    const before = JSON.stringify(data);
    const { result, requests } = await run(RESPONSE, data);
    expect(requests).toHaveLength(1);
    expect(result.prompt_bytes).toBeLessThanOrEqual(48 * 1024);
    expect(result.context.research.budget.page_units_retained).toBeLessThan(data.research.budget.page_units_retained);
    expect(parseResearchBundle(result.context.research).ok).toBe(true);
    expect(JSON.parse(requests[0]!.user).units.map((unit: { id: string }) => unit.id)).toEqual(result.context.research.units.map((unit) => unit.id));
    expect(JSON.stringify(data)).toBe(before);
  });
});
