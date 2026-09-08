// @input -- one exact receipt-backed synthesis input v2 and the pinned GEO Brief provider config
// @output -- one strict v2 narrative with usage and delivery certainty
// @pos -- provider adapter only; durable reservation/finalization belongs to the caller

/**
 * The v2 runner, beside `kb-knowledge-synthesis.ts` rather than replacing it.
 *
 * v1 is shipped and still serves the v2-path drafts that
 * `kb-generation-preparer.ts` produces. This file is what a v3 run calls. The
 * two differ only in which contract they parse and which prompt they buy: the
 * attempt accounting below is copied on purpose, because "how many calls did we
 * make, and do we know what happened to them" is the one answer a paid step may
 * never get wrong, and two adapters answering it differently would be worse
 * than the duplication.
 *
 * What this adapter deliberately does not do:
 *
 *   - reserve or finalize a generation record. The caller owns the ledger and
 *     must reserve the single attempt *before* calling `synthesize...`.
 *   - retry, repair, or fall back to JSON mode after a schema rejection. One
 *     input buys one call.
 *   - widen the model's output shape. `GEO_KNOWLEDGE_SYNTHESIS_V2_RESPONSE_JSON_SCHEMA`
 *     is the boundary and it is closed at every level; the derived labels a
 *     reviewer reads -- origin, evidence check, item key, review status -- are
 *     computed downstream from evidence, never accepted from model text.
 *   - trim, sample, or reorder the catalogue it is handed. The input arrives
 *     already fitted to the prompt budget by
 *     `projectGeoKnowledgeSynthesisV2Catalogue`, with every shortened source
 *     marked `partial`, and its `contentHash` covers that fitted catalogue. An
 *     input this adapter still cannot afford is refused, never shrunk.
 *   - show the model off-site evidence. `synthesisInput.evidenceContentHash`
 *     covers on-site evidence only and the v2 source catalogue is built from
 *     those receipts alone, which is what lets a paid synthesis be reused when
 *     only the off-site set changed. Feeding off-site pages in here would
 *     change what the knowledge base claims *and* destroy that reuse property.
 */
import { geoGenerationLanguage } from "@sf/public-tools/content-brief/geo-contract";

import {
  createKeywordLlmClient,
  EMPTY_KEYWORD_LLM_USAGE,
  KeywordLlmError,
  type KeywordLlmClient,
  type KeywordLlmConfig,
  type KeywordLlmFailureReason,
  type KeywordLlmRequest,
  type KeywordLlmUsage,
} from "../tools/keyword-llm-client.ts";
import { GEO_BRIEF_TEMPERATURE, resolveGeoBriefLlmConfig } from "./brief-llm.ts";
import { geoV2JsonbBytes } from "./kb-v2-json.ts";
import {
  GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS,
  parseGeoKnowledgeNarrativeV2,
  parseGeoKnowledgeSynthesisInputV2,
  type GeoKnowledgeNarrativeV2,
  type GeoKnowledgeSynthesisInputV2,
} from "./kb-knowledge-synthesis-v2-contract.ts";
import {
  buildGeoKnowledgeSynthesisV2Prompt,
  GEO_KNOWLEDGE_SYNTHESIS_V2_PROMPT_VERSION,
  GEO_KNOWLEDGE_SYNTHESIS_V2_RESPONSE_JSON_SCHEMA,
  type GeoKnowledgeSynthesisV2Prompt,
} from "./kb-knowledge-synthesis-v2-prompts.ts";
import {
  isUsableGeoSynthesisConfig,
  type GeoSynthesisProvider,
} from "./kb-synthesis.ts";

export const GEO_KNOWLEDGE_SYNTHESIS_V2_MAX_OUTPUT_TOKENS = 32_768;
export const GEO_KNOWLEDGE_SYNTHESIS_V2_TIMEOUT_MS = 90_000;
/**
 * A parsed input can be larger than a provider prompt we are willing to buy.
 *
 * The contract admits 163,840 JSONB bytes of synthesis input; this refuses any
 * request whose serialized prompt plus response schema passes 131,072. The
 * refusal is free: `input_too_large` / `not_attempted`, before a single token
 * is spent.
 *
 * It is now a last resort rather than the common fate of a content-rich site.
 * This adapter still refuses to trim anything -- silently changing which
 * evidence an answer rests on is worse than refusing -- but the trimming it
 * will not do is done, visibly and deterministically, one step earlier:
 * `projectGeoKnowledgeSynthesisV2Catalogue` fits the catalogue to a stated rule
 * while the input is being built, marks every shortened source `partial`, and
 * hashes the result, so what this adapter buys is exactly what the narrative is
 * checked against. A full collection therefore reaches the provider; what
 * reaches this guard is a catalogue no collection produces.
 */
export const GEO_KNOWLEDGE_SYNTHESIS_V2_PROMPT_BYTES = 128 * 1024;

type GeoResponseJsonSchema = NonNullable<KeywordLlmRequest["responseJsonSchema"]>;

export interface GeoKnowledgeSynthesisV2Dependencies {
  readonly config?: KeywordLlmConfig | null;
  readonly client?: KeywordLlmClient;
  readonly env?: Record<string, string | undefined>;
  readonly timeoutMs?: number;
}

interface GeoKnowledgeSynthesisV2AttemptMeta {
  readonly usage: KeywordLlmUsage;
  readonly provider: GeoSynthesisProvider | null;
  readonly attemptedCalls: 0 | 1;
  readonly delivery: "not_attempted" | "response_received" | "outcome_unknown";
}

/**
 * What a refusal says, for the caller that has to turn it into an owner-visible
 * outcome. The four that are not `KeywordLlmFailureReason`:
 *
 *   - `invalid_input`     the value is not a synthesis input v2 at all, or its
 *                         own hashes do not agree with its content. A bug or a
 *                         tampered record; nothing was sent.
 *   - `input_too_large`   a well-formed input whose prompt this adapter will
 *                         not buy. Distinct from `invalid_input` because
 *                         nothing about it is wrong -- it is too big, and the
 *                         answer is fewer or shorter sources, not a fix.
 *                         Nothing was sent and nothing was spent.
 *   - `unsupported_language`  the input's locale is not English.
 *   - `provider_error`    the client threw something that was not a
 *                         `KeywordLlmError`; the outcome is unknown and the
 *                         call is counted as possibly charged.
 */
export type GeoKnowledgeSynthesisV2Failure = GeoKnowledgeSynthesisV2AttemptMeta & {
  readonly ok: false;
  readonly reason:
    | KeywordLlmFailureReason
    | "invalid_input"
    | "input_too_large"
    | "unsupported_language"
    | "provider_error";
};

export type GeoKnowledgeSynthesisV2Result =
  | {
      readonly ok: true;
      readonly value: GeoKnowledgeNarrativeV2;
      readonly usage: KeywordLlmUsage;
      readonly provider: GeoSynthesisProvider;
      readonly attemptedCalls: 1;
      readonly delivery: "response_received";
    }
  | GeoKnowledgeSynthesisV2Failure;

export interface PreparedGeoKnowledgeSynthesisV2 {
  /** Re-parsed here, never the caller's object: the narrative is checked against this. */
  readonly input: GeoKnowledgeSynthesisInputV2;
  readonly prompt: GeoKnowledgeSynthesisV2Prompt;
  readonly provider: GeoSynthesisProvider;
  readonly timeoutMs: number;
  readonly promptVersion: typeof GEO_KNOWLEDGE_SYNTHESIS_V2_PROMPT_VERSION;
  readonly responseJsonSchema: GeoResponseJsonSchema;
}

export type GeoKnowledgeSynthesisV2Preparation =
  | { readonly ok: true; readonly value: PreparedGeoKnowledgeSynthesisV2 }
  | GeoKnowledgeSynthesisV2Failure;

type FailureReason = GeoKnowledgeSynthesisV2Failure["reason"];

function notAttempted(reason: FailureReason): GeoKnowledgeSynthesisV2Failure {
  return {
    ok: false,
    reason,
    usage: EMPTY_KEYWORD_LLM_USAGE,
    provider: null,
    attemptedCalls: 0,
    delivery: "not_attempted",
  };
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/**
 * Why the rejected value is measured instead of the thrown message being read.
 *
 * v1 tells "too large" apart from "malformed" by running `/exceeds byte budget/`
 * over the error text. That makes an owner-visible label depend on prose that
 * four different modules are free to reword -- rewording `assertInputBytes` in
 * the contract would silently start reporting oversized inputs as malformed,
 * and no test in either file would notice. Measuring the value decides the
 * label from the thing that is actually wrong with it.
 *
 * The deliberate consequence: a value that is both over budget and malformed
 * for some other reason is reported as `input_too_large`, because its size is
 * the first thing that has to change. Either way it is refused before dispatch
 * and nothing is bought.
 */
function oversizedInput(value: unknown): boolean {
  try {
    return geoV2JsonbBytes(value) > GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.inputBytes;
  } catch {
    return false;
  }
}

function parsedInput(
  input: unknown,
):
  | { readonly ok: true; readonly value: GeoKnowledgeSynthesisInputV2 }
  | { readonly ok: false; readonly reason: "invalid_input" | "input_too_large" } {
  try {
    return { ok: true, value: parseGeoKnowledgeSynthesisInputV2(input) };
  } catch {
    return { ok: false, reason: oversizedInput(input) ? "input_too_large" : "invalid_input" };
  }
}

/** Shared with durable admission so a refusal cannot consume an attempt. */
export function prepareGeoKnowledgeSynthesisV2(
  input: unknown,
  config: KeywordLlmConfig | null,
  timeoutMs = GEO_KNOWLEDGE_SYNTHESIS_V2_TIMEOUT_MS,
): GeoKnowledgeSynthesisV2Preparation {
  const parsed = parsedInput(input);
  if (!parsed.ok) return notAttempted(parsed.reason);
  if (geoGenerationLanguage(parsed.value.language) === null) {
    return notAttempted("unsupported_language");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 45_000 || timeoutMs > 120_000) {
    return notAttempted("not_configured");
  }
  if (!isUsableGeoSynthesisConfig(config)) return notAttempted("not_configured");

  const prompt = buildGeoKnowledgeSynthesisV2Prompt(parsed.value);
  if (
    byteLength(
      JSON.stringify({
        prompt,
        responseJsonSchema: GEO_KNOWLEDGE_SYNTHESIS_V2_RESPONSE_JSON_SCHEMA,
      }),
    ) > GEO_KNOWLEDGE_SYNTHESIS_V2_PROMPT_BYTES
  ) {
    return notAttempted("input_too_large");
  }

  const provider: GeoSynthesisProvider = {
    modelRequested: config.model,
    modelReported: null,
    authScheme: config.authScheme,
    effectiveTemperature: config.temperature ?? GEO_BRIEF_TEMPERATURE,
    maxOutputTokens: GEO_KNOWLEDGE_SYNTHESIS_V2_MAX_OUTPUT_TOKENS,
  };
  return {
    ok: true,
    value: {
      input: parsed.value,
      prompt,
      provider,
      timeoutMs,
      promptVersion: GEO_KNOWLEDGE_SYNTHESIS_V2_PROMPT_VERSION,
      responseJsonSchema: GEO_KNOWLEDGE_SYNTHESIS_V2_RESPONSE_JSON_SCHEMA,
    },
  };
}

/**
 * Failures the provider answered on: the answer was bought and must be recorded
 * as spent.
 *
 * `not_configured` is absent on purpose, and it is the only one of the nine
 * that a throw from `complete()` raises without a request ever leaving the
 * process -- an unusable response schema or reasoning-effort value, refused by
 * the shared client before it builds a request. Calling that "the provider
 * answered" would write `delivery: "response_received"` and `attemptedCalls: 1`
 * into a durable generation attempt for a call that was never sent. It is
 * reported as `outcome_unknown` instead of `not_attempted` deliberately: by the
 * time a throw arrives this adapter cannot tell from the error whether the
 * request went out, and over-stating a possible charge is the only safe
 * direction to be wrong in.
 */
function responseReceived(reason: KeywordLlmFailureReason): boolean {
  return [
    "auth_failed",
    "rate_limited",
    "server_error",
    "bad_request",
    "invalid_response",
    "schema_invalid",
  ].includes(reason);
}

export async function synthesizeGeoKnowledgeNarrativeV2(
  input: unknown,
  dependencies: GeoKnowledgeSynthesisV2Dependencies = {},
): Promise<GeoKnowledgeSynthesisV2Result> {
  const config =
    dependencies.config !== undefined
      ? dependencies.config
      : resolveGeoBriefLlmConfig(dependencies.env);
  const prepared = prepareGeoKnowledgeSynthesisV2(input, config, dependencies.timeoutMs);
  if (!prepared.ok) return prepared;

  const { prompt, provider, responseJsonSchema, timeoutMs } = prepared.value;
  const client = dependencies.client ?? createKeywordLlmClient({ config: config! });
  try {
    // Durable code must reserve the one attempt before entering this adapter.
    // There is deliberately no fallback, repair request, or automatic retry.
    const completion = await client.complete({
      ...prompt,
      temperature: provider.effectiveTemperature,
      maxOutputTokens: provider.maxOutputTokens,
      timeoutMs,
      responseJsonSchema,
    });
    const meta = {
      usage: completion.usage,
      provider,
      attemptedCalls: 1 as const,
      delivery: "response_received" as const,
    };
    if (byteLength(completion.content) > GEO_KNOWLEDGE_SYNTHESIS_V2_LIMITS.narrativeBytes) {
      return { ...meta, ok: false, reason: "invalid_response" };
    }

    let raw: unknown;
    try {
      raw = JSON.parse(completion.content);
    } catch {
      return { ...meta, ok: false, reason: "invalid_response" };
    }
    try {
      // Checked against the input this call actually sent, so a cited source id
      // has to exist in the catalogue the model was shown.
      return { ...meta, ok: true, value: parseGeoKnowledgeNarrativeV2(raw, prepared.value.input) };
    } catch {
      return { ...meta, ok: false, reason: "schema_invalid" };
    }
  } catch (error) {
    const reason = error instanceof KeywordLlmError ? error.reason : "provider_error";
    return {
      ok: false,
      reason,
      usage: error instanceof KeywordLlmError ? error.usage : EMPTY_KEYWORD_LLM_USAGE,
      provider,
      attemptedCalls: 1,
      delivery:
        error instanceof KeywordLlmError && responseReceived(error.reason)
          ? "response_received"
          : "outcome_unknown",
    };
  }
}
