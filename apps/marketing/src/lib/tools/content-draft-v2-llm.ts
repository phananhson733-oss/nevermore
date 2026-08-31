// @input -- one exact confirmed Brief v2, section ID/settings, shared deadline and CONTENT_DRAFT config
// @output -- validated v2 section body or closed failure with every actual attempt's usage
// @pos -- Marketing Draft v2 model boundary; no v1 conversion or hidden transport retry
import { ENVELOPE_MS, SECTION_MAX_ATTEMPTS, SECTION_MAX_OUTPUT_TOKENS, SECTION_TIMEOUT_MS } from "@sf/public-tools/content-brief/constants";
import type { SectionFailReason } from "@sf/public-tools/content-brief/contract";
import { parseDraftSettings } from "@sf/public-tools/content-brief/parse-draft";
import { parseConfirmedBriefV2 } from "@sf/public-tools/content-brief/v2-brief";
import { DRAFT_V2_PROMPT_MAX_BYTES, type DraftV2Call, type DraftV2SectionGeneration, type DraftV2Settings } from "@sf/public-tools/content-brief/v2-draft-contract";
import { buildDraftV2SectionScope } from "@sf/public-tools/content-brief/v2-draft-scope";
import { validateDraftV2Section } from "@sf/public-tools/content-brief/v2-draft-section";
import type { ConfirmedBriefV2 } from "@sf/public-tools/content-brief/v2-generation-contract";
import { resolveContentDraftLlmConfig } from "./content-brief-llm.ts";
import { CONTENT_DRAFT_LLM_TEMPERATURE, runDraftCoverage, type ContentDraftLlmDependencies, type DraftCoverageInput, type DraftCoverageResult } from "./content-draft-llm.ts";
import { resolveDraftV2Language } from "./content-draft-v2-language.ts";
import { buildDraftV2SectionSystemPrompt, buildDraftV2SectionUserPrompt, type DraftV2SectionRejection } from "./content-draft-v2-prompts.ts";
import { createKeywordLlmClient, KeywordLlmError, type KeywordLlmConfig, type KeywordLlmFailureReason, type KeywordLlmUsage } from "./keyword-llm-client.ts";

export interface DraftV2SectionInput {
  readonly confirmed: ConfirmedBriefV2;
  readonly sectionId: string;
  readonly settings: DraftV2Settings;
  readonly deadlineAt: number;
}

const FAILURE_REASONS: Readonly<Record<KeywordLlmFailureReason, SectionFailReason>> = {
  not_configured: "not_configured", timeout: "timeout", network_error: "provider_error", auth_failed: "provider_error",
  rate_limited: "provider_error", server_error: "provider_error", bad_request: "provider_error",
  invalid_response: "provider_error", schema_invalid: "validation_failed",
};

/** Unknown is absorbing independently for input/output tokens; no attempt is also unknown. */
function callReceipt(sent: readonly KeywordLlmUsage[], modelId: string | null, config: KeywordLlmConfig | null): DraftV2Call {
  const sum = (values: readonly (number | null)[]) => values.length === 0 || values.some((value) => value === null)
    ? null : values.reduce<number>((total, value) => total + (value ?? 0), 0);
  return {
    attempts: sent.length, model_id: modelId,
    temperature_requested: CONTENT_DRAFT_LLM_TEMPERATURE,
    temperature_effective: sent.length > 0 ? config?.temperature ?? null : null,
    input_tokens: sum(sent.map((usage) => usage.inputTokens)), output_tokens: sum(sent.map((usage) => usage.outputTokens)),
  };
}

/** All headers stay controller-owned. Only schema/claim-invalid model replies may be retried. */
export async function generateDraftV2Section(input: DraftV2SectionInput, deps: ContentDraftLlmDependencies = {}): Promise<DraftV2SectionGeneration> {
  const sent: KeywordLlmUsage[] = [];
  let config: KeywordLlmConfig | null = null;
  let modelId: string | null = null;
  const failure = (fail_reason: SectionFailReason): DraftV2SectionGeneration => ({ status: "failed", fail_reason, llm: callReceipt(sent, modelId, config) });
  const settings = parseDraftSettings(input.settings);
  const confirmed = await parseConfirmedBriefV2(input.confirmed);
  if (!settings.ok || !confirmed.ok || resolveDraftV2Language(confirmed.value.brief.context.input.language) === null) return failure("validation_failed");
  const scope = buildDraftV2SectionScope(confirmed.value, input.sectionId, settings.value);
  if (!scope.ok) return failure("validation_failed");
  config = deps.config !== undefined ? deps.config : resolveContentDraftLlmConfig(deps.env ?? process.env);
  if (config === null) return failure("not_configured");
  const now = deps.now ?? Date.now;
  const client = deps.client ?? createKeywordLlmClient({ config });
  const system = buildDraftV2SectionSystemPrompt();
  const promptInput = { confirmed: confirmed.value, scope: scope.value, settings: settings.value };
  let rejection: DraftV2SectionRejection | null = null;

  while (sent.length < SECTION_MAX_ATTEMPTS) {
    const user = buildDraftV2SectionUserPrompt(promptInput, rejection);
    if (new TextEncoder().encode(JSON.stringify({ system, user })).byteLength > DRAFT_V2_PROMPT_MAX_BYTES) return failure("validation_failed");
    const startedAt = now();
    const remaining = Math.floor(input.deadlineAt - startedAt - ENVELOPE_MS);
    if (!Number.isFinite(remaining) || remaining <= 0) return failure(rejection === null ? "timeout" : "validation_failed");
    const timeoutMs = Math.min(SECTION_TIMEOUT_MS, remaining);
    let content: string;
    try {
      const completion = await client.complete({ system, user, temperature: CONTENT_DRAFT_LLM_TEMPERATURE, maxOutputTokens: SECTION_MAX_OUTPUT_TOKENS, timeoutMs });
      sent.push(completion.usage);
      modelId = completion.modelId ?? config.model;
      content = completion.content;
    } catch (error) {
      if (!(error instanceof KeywordLlmError)) throw error;
      // A timeout/refusal may still have been billed even without provider usage.
      sent.push(error.usage);
      return failure(FAILURE_REASONS[error.reason]);
    }
    if (now() > startedAt + timeoutMs) return failure("timeout");
    let raw: unknown;
    try { raw = JSON.parse(content); }
    catch { rejection = { code: "invalid_json", path: "" }; continue; }
    const body = validateDraftV2Section(raw, scope.value, confirmed.value.brief.context.input.language);
    if (body.ok) return { status: "ok", body: body.value, llm: callReceipt(sent, modelId, config) };
    rejection = { code: body.code === "brief_reference_invalid" ? "brief_reference_invalid" : "invalid_request", path: body.path };
  }
  return failure("validation_failed");
}

/** Same independent judge and transport, with a validated exact-locale instruction for v2. */
export async function runDraftV2Coverage(input: DraftCoverageInput, deps: ContentDraftLlmDependencies = {}): Promise<DraftCoverageResult> {
  const language = resolveDraftV2Language(input.language);
  if (language === null) return {
    items: null,
    reads: { status: "unavailable", reason: "validation_failed", attempted: 0, calls: 0, model_id: null, input_tokens: null, output_tokens: null },
  };
  const localized = { ...input, language: language.code };
  if (input.questions.length === 0) return runDraftCoverage(localized, deps);
  const config = deps.config !== undefined ? deps.config : resolveContentDraftLlmConfig(deps.env ?? process.env);
  if (config === null) return runDraftCoverage(localized, { ...deps, config });
  const client = deps.client ?? createKeywordLlmClient({ config });
  return runDraftCoverage(localized, {
    ...deps, config,
    client: { complete: (request) => client.complete({
      ...request,
      // Only the canonical tag from the locale validator enters instruction text.
      system: `${request.system}\nUse the exact requested locale ${language.locale} for every coverage gap, including its region and script conventions.`,
    }) },
  });
}
