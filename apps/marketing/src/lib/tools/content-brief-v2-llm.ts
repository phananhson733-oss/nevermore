// @input -- a frozen v2/v3 context, remaining deadline and CONTENT_BRIEF_* configuration
// @output -- the exact model context, validated full assembly and honest usage
// @pos -- one v2 assembly call; no retry, fallback or external source reads
import { ENVELOPE_MS, LLM_MAX_OUTPUT_TOKENS } from "@sf/public-tools/content-brief/constants";
import type { LlmReadMeta, UnavailableReason } from "@sf/public-tools/content-brief/contract";
import type { BriefV2Context, BriefV2Generated } from "@sf/public-tools/content-brief/v2-generation-contract";
import { parseBriefV2Context, validateModelBriefV2 } from "@sf/public-tools/content-brief/v2-generation";
import { CONTENT_BRIEF_LLM_TEMPERATURE, resolveContentBriefLlmConfig, type ContentBriefLlmDependencies } from "./content-brief-llm.ts";
import { prepareContentBriefV2Prompt } from "./content-brief-v2-prompts.ts";
import { validateSectionQuestionsBrief } from "./content-brief-v3-model.ts";
import { createKeywordLlmClient, EMPTY_KEYWORD_LLM_USAGE, KeywordLlmError, type KeywordLlmCompletion, type KeywordLlmFailureReason, type KeywordLlmUsage } from "./keyword-llm-client.ts";

export const CONTENT_BRIEF_V2_LLM_DEADLINE_MS = 30_000;

export interface ContentBriefV2LlmResult {
  readonly context: BriefV2Context;
  readonly output: BriefV2Generated | null;
  readonly reads: LlmReadMeta;
  readonly prompt_bytes: number;
}

const FAILURE_REASONS: Readonly<Record<KeywordLlmFailureReason, UnavailableReason>> = {
  not_configured: "not_configured", timeout: "timeout", network_error: "provider_error", auth_failed: "provider_error",
  rate_limited: "provider_error", server_error: "provider_error", bad_request: "provider_error", invalid_response: "provider_error", schema_invalid: "validation_failed",
};

function unavailable(reason: UnavailableReason, attempted: number, usage: KeywordLlmUsage, modelId: string | null): LlmReadMeta {
  return { status: "unavailable", reason, attempted, calls: usage.requestCount, model_id: modelId, input_tokens: usage.inputTokens, output_tokens: usage.outputTokens };
}

function withoutCall(context: BriefV2Context, reason: UnavailableReason): ContentBriefV2LlmResult {
  return { context, output: null, reads: unavailable(reason, 0, EMPTY_KEYWORD_LLM_USAGE, null), prompt_bytes: 0 };
}

export async function runContentBriefV2Llm(
  input: { readonly context: BriefV2Context; readonly deadlineAt: number },
  deps: ContentBriefLlmDependencies = {},
): Promise<ContentBriefV2LlmResult> {
  const parsed = parseBriefV2Context(input.context);
  if (!parsed.ok) return withoutCall(input.context, "validation_failed");
  if (parsed.value.research.units.length === 0) return withoutCall(parsed.value, "insufficient_evidence");
  const config = deps.config !== undefined ? deps.config : resolveContentBriefLlmConfig(deps.env ?? process.env);
  if (config === null) return withoutCall(parsed.value, "not_configured");
  const prepared = prepareContentBriefV2Prompt(parsed.value);
  if (prepared === null) return withoutCall(parsed.value, "validation_failed");
  if (prepared.context.research.units.length === 0) return withoutCall(prepared.context, "insufficient_evidence");

  const now = deps.now ?? Date.now;
  const startedAt = now();
  const remaining = Math.floor(input.deadlineAt - startedAt - ENVELOPE_MS);
  if (!Number.isFinite(remaining) || remaining <= 0) return withoutCall(prepared.context, "timeout");
  const timeoutMs = Math.min(CONTENT_BRIEF_V2_LLM_DEADLINE_MS, remaining);
  const attemptDeadline = startedAt + timeoutMs;
  const client = deps.client ?? createKeywordLlmClient({ config });
  const { context, prompt_bytes } = prepared;
  let completion: KeywordLlmCompletion;
  try {
    completion = await client.complete({ system: prepared.system, user: prepared.user, temperature: CONTENT_BRIEF_LLM_TEMPERATURE, maxOutputTokens: LLM_MAX_OUTPUT_TOKENS, timeoutMs,
      // Verified on the configured Luna deployment; other deployment names
      // retain provider defaults rather than assuming compatible capabilities.
      ...(config.model === "gpt-5.6-luna" ? { reasoningEffort: "none" as const } : {}),
    });
  } catch (error) {
    if (!(error instanceof KeywordLlmError)) throw error;
    // The shared client omits usage on transport errors after fetch. V2 still
    // knows it attempted one request; only not_configured can fail preflight.
    const usage = { ...error.usage, requestCount: error.reason === "not_configured" ? error.usage.requestCount : Math.max(1, error.usage.requestCount) };
    return { context, output: null, reads: unavailable(FAILURE_REASONS[error.reason], usage.requestCount > 0 ? 1 : 0, usage, null), prompt_bytes };
  }
  const modelId = completion.modelId ?? config.model;
  const fail = (reason: UnavailableReason): ContentBriefV2LlmResult => ({ context, output: null, reads: unavailable(reason, 1, completion.usage, modelId), prompt_bytes });
  const expired = () => { const current = now(); return !Number.isFinite(current) || current >= attemptDeadline; };
  if (expired()) return fail("timeout");
  let raw: unknown;
  try { raw = JSON.parse(completion.content); } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return fail("validation_failed");
  }
  const output = context.serp === undefined ? validateModelBriefV2(raw, context) : validateSectionQuestionsBrief(raw, context);
  if (expired()) return fail("timeout");
  if (!output.ok) return fail("validation_failed");
  return {
    context, output: output.value, prompt_bytes,
    reads: { status: "complete", calls: completion.usage.requestCount, model_id: modelId, temperature_requested: CONTENT_BRIEF_LLM_TEMPERATURE, temperature_effective: config.temperature ?? null, input_tokens: completion.usage.inputTokens, output_tokens: completion.usage.outputTokens },
  };
}
