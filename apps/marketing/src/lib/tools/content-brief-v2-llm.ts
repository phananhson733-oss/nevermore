// @input -- a frozen v2/v3 context, remaining deadline and CONTENT_BRIEF_* configuration
// @output -- the exact model context, validated full assembly and honest usage
// @pos -- one v2 assembly call; no retry, fallback or external source reads; a rejected optional field is dropped, never rewritten
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
  /**
   * The exact rule the model's reply broke, for the run log only.
   *
   * A rejected reply is reported to the visitor as one unavailable read, which
   * says nothing about why. Two production runs on 2026-09-07 were diagnosed by
   * reading the model's output by hand because the run log recorded only that
   * validation failed. This is the validator's own path, so it names the rule
   * without carrying any of the reply's text; it is never part of the brief.
   */
  readonly validation_path?: string;
  /**
   * The rules that cost the reply an optional field, one path per drop.
   *
   * Run log only, like validation_path, and read the same way: the path names
   * the rule, and its first segment names the field that went with it. The
   * brief carries each dropped field in its own empty state, which is what the
   * result page already reports; nothing here reaches the visitor.
   */
  readonly dropped_paths?: readonly string[];
}

interface DroppableField {
  readonly name: string;
  readonly absent: unknown;
}

/**
 * The fields a brief can go without, and the value that stands for absent.
 *
 * A rejected reply used to discard the whole run. On 2026-09-08 a production
 * brief was thrown away because gap_angle cited an owned page where the rule
 * admits only competitor pages: the SERP call, ten crawled pages, a GSC read
 * and the model call were all already paid for, and the visitor got a failure
 * screen offering to run them again. Every field listed here is nullable or
 * emptyable in the contract and already has an empty state on the result page,
 * so dropping the one the model got wrong keeps the brief the visitor paid
 * for. A drop can only remove: unlike asking the model to repair its reply, no
 * text that was never validated can enter the brief this way.
 *
 * Structure is deliberately absent from this list. research, page_plan, intent
 * and format are the brief; without them there is nothing to keep, and a reply
 * that breaks one of them still fails whole.
 */
const DROPPABLE_FIELDS: readonly DroppableField[] = [
  { name: "gap_angle", absent: null },
  { name: "internal_links", absent: [] },
  { name: "do_not_cover", absent: [] },
];

/** The droppable field a rejection path belongs to, if the reply is still an object we can rebuild. */
function droppableField(path: string, reply: unknown): DroppableField | null {
  if (typeof reply !== "object" || reply === null || Array.isArray(reply)) return null;
  const head = path.split(/[.[]/u)[0] ?? "";
  const field = DROPPABLE_FIELDS.find((item) => item.name === head);
  if (field === undefined) return null;
  // An unknown top-level key is reported as its own name, so a model that sends
  // a key literally called "gap_angle.extra" produces a path that reads like a
  // defect inside gap_angle. The reply tells the two apart: only the literal
  // key is an own property of the reply under the whole path. A path that is
  // exactly the field name is the field itself, own property or not.
  return path !== field.name && Object.hasOwn(reply, path) ? null : field;
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
      ...(config.model === "gpt-5.6-luna" ? { reasoningEffort: "low" as const } : {}),
    });
  } catch (error) {
    if (!(error instanceof KeywordLlmError)) throw error;
    // The shared client omits usage on transport errors after fetch. V2 still
    // knows it attempted one request; only not_configured can fail preflight.
    const usage = { ...error.usage, requestCount: error.reason === "not_configured" ? error.usage.requestCount : Math.max(1, error.usage.requestCount) };
    return { context, output: null, reads: unavailable(FAILURE_REASONS[error.reason], usage.requestCount > 0 ? 1 : 0, usage, null), prompt_bytes };
  }
  const modelId = completion.modelId ?? config.model;
  const dropped: string[] = [];
  const fail = (reason: UnavailableReason, path?: string): ContentBriefV2LlmResult =>
    ({ context, output: null, reads: unavailable(reason, 1, completion.usage, modelId), prompt_bytes, ...(path === undefined ? {} : { validation_path: path }), ...(dropped.length === 0 ? {} : { dropped_paths: [...dropped] }) });
  const expired = () => { const current = now(); return !Number.isFinite(current) || current >= attemptDeadline; };
  if (expired()) return fail("timeout");
  let raw: unknown;
  try { raw = JSON.parse(completion.content); } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return fail("validation_failed");
  }
  // Generation is the one place the language rule applies; reading a brief back
  // must not judge it by a rule that did not exist when it was issued.
  const validate = (reply: unknown) => context.serp === undefined
    ? validateModelBriefV2(reply, context, { checkLanguage: true })
    : validateSectionQuestionsBrief(reply, context, { checkLanguage: true });
  // One pass per droppable field, which is all a reply can need: each drop
  // installs a value the validator accepts and that has no inner path of its
  // own, so a dropped field cannot be rejected twice. Validation is pure CPU
  // over an already-parsed reply; no further call is made.
  let reply = raw;
  let output = validate(reply);
  for (let attempt = 0; !output.ok && attempt < DROPPABLE_FIELDS.length; attempt += 1) {
    const field = droppableField(output.path, reply);
    if (field === null) break;
    dropped.push(output.path);
    reply = { ...(reply as Record<string, unknown>), [field.name]: field.absent };
    output = validate(reply);
  }
  if (expired()) return fail("timeout");
  if (!output.ok) return fail("validation_failed", output.path);
  return {
    context, output: output.value, prompt_bytes,
    ...(dropped.length === 0 ? {} : { dropped_paths: [...dropped] }),
    reads: { status: "complete", calls: completion.usage.requestCount, model_id: modelId, temperature_requested: CONTENT_BRIEF_LLM_TEMPERATURE, temperature_effective: config.temperature ?? null, input_tokens: completion.usage.inputTokens, output_tokens: completion.usage.outputTokens },
  };
}
