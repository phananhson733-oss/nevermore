// @input -- exact source catalogues/accepted roles and server-owned GEO LLM config
// @output -- one bounded semantic generation, spent usage and delivery uncertainty
// @pos -- model adapter only: caller reserves/finalizes durable attempts and review
import { createKeywordLlmClient, KeywordLlmError, EMPTY_KEYWORD_LLM_USAGE, type KeywordLlmClient, type KeywordLlmConfig, type KeywordLlmFailureReason, type KeywordLlmRequest, type KeywordLlmUsage } from "../tools/keyword-llm-client.ts";
import { geoGenerationLanguage } from "@sf/public-tools/content-brief/geo-contract";
import { resolveGeoBriefLlmConfig, GEO_BRIEF_TEMPERATURE } from "./brief-llm.ts";
import { GEO_SYNTHESIS_LIMITS, parseGeoRoleSynthesisInput, parseGeoQuestionSynthesisInput, parseGeoRoleSynthesis, parseGeoQuestionSynthesis, type GeoSynthesisParseResult, type GeoRoleSynthesisInput, type GeoRoleSynthesis, type GeoQuestionSynthesisInput, type GeoQuestionSynthesis } from "./kb-synthesis-contract.ts";
import { buildGeoRoleSynthesisPrompt, buildGeoQuestionSynthesisPrompt, type GeoSynthesisPrompt } from "./kb-synthesis-prompts.ts";

export const GEO_ROLE_SYNTHESIS_PROMPT_VERSION = "geo-kb-roles.v1";
export const GEO_QUESTION_SYNTHESIS_PROMPT_VERSION = "geo-kb-questions.v2";
export const GEO_ROLE_SYNTHESIS_MAX_OUTPUT_TOKENS = 8192;
export const GEO_QUESTION_SYNTHESIS_MAX_OUTPUT_TOKENS = 12288;
export const GEO_SYNTHESIS_TIMEOUT_MS = 90_000;
type GeoResponseJsonSchema = NonNullable<KeywordLlmRequest["responseJsonSchema"]>;
const string = { type: "string" } as const;
const strings = { type: "array", items: string } as const;
const roleOutputFields = {
  id: string, label: string, questionLabel: string, segment: string,
  painPoints: strings, alternatives: strings, decisionCriteria: strings, vocabulary: strings, evidenceRefs: strings,
} as const;
const GEO_ROLE_RESPONSE_JSON_SCHEMA: GeoResponseJsonSchema = { name: "geo_kb_roles_v1", schema: {
  type: "object", additionalProperties: false, required: ["roles", "categoryTerms"],
  properties: { roles: { type: "array", items: { $ref: "#/$defs/role" } }, categoryTerms: { type: "array", items: { $ref: "#/$defs/categoryTerm" } } },
  $defs: {
    role: { type: "object", additionalProperties: false, required: Object.keys(roleOutputFields), properties: roleOutputFields },
    categoryTerm: { type: "object", additionalProperties: false, required: ["text", "evidenceRefs"], properties: { text: string, evidenceRefs: strings } },
  },
} };
const GEO_QUESTION_RESPONSE_JSON_SCHEMA: GeoResponseJsonSchema = { name: "geo_kb_questions_v2", schema: {
  type: "object", additionalProperties: false, required: ["entities", "questions"],
  properties: { entities: { type: "array", items: { $ref: "#/$defs/entity" } }, questions: { type: "array", items: { $ref: "#/$defs/question" } } },
  $defs: {
    entity: { type: "object", additionalProperties: false, required: ["id", "text"], properties: { id: string, text: string } },
    question: { type: "object", additionalProperties: false, required: ["id", "text", "layer", "roleId", "entityRefs", "evidenceRefs"], properties: {
      id: string, text: string, layer: { type: "string", enum: ["problem", "discovery", "comparison", "evaluation", "branded"] },
      roleId: { type: ["string", "null"] }, entityRefs: strings, evidenceRefs: strings,
    } },
  },
} };
export interface GeoSynthesisDependencies {
  readonly config?: KeywordLlmConfig | null;
  readonly client?: KeywordLlmClient;
  readonly env?: Record<string, string | undefined>;
  readonly timeoutMs?: number;
}
export interface GeoSynthesisProvider {
  readonly modelRequested: string;
  /** The shared transport falls back to config.model; it cannot prove reported identity. */
  readonly modelReported: null;
  readonly authScheme: KeywordLlmConfig["authScheme"];
  readonly effectiveTemperature: number;
  readonly maxOutputTokens: number;
}
interface GeoSynthesisAttemptMeta {
  readonly usage: KeywordLlmUsage;
  readonly provider: GeoSynthesisProvider | null;
  readonly attemptedCalls: 0 | 1;
  readonly delivery: "not_attempted" | "response_received" | "outcome_unknown";
}
export type GeoSynthesisFailure = GeoSynthesisAttemptMeta & { readonly ok: false; readonly reason: KeywordLlmFailureReason | "invalid_input" | "input_too_large" | "unsupported_language" | "provider_error" | "insufficient_basis" };
export type GeoSynthesisResult<T> =
  | { readonly ok: true; readonly value: T; readonly usage: KeywordLlmUsage; readonly provider: GeoSynthesisProvider; readonly attemptedCalls: 1; readonly delivery: "response_received" }
  | GeoSynthesisFailure;

type FailureReason = Extract<GeoSynthesisResult<never>, { readonly ok: false }>["reason"];
const notAttempted = (reason: FailureReason): GeoSynthesisFailure => ({ ok: false, reason, usage: EMPTY_KEYWORD_LLM_USAGE, provider: null, attemptedCalls: 0, delivery: "not_attempted" });

/** No capability/provider fallback. Invalid configuration is refused before dispatch. */
export function isUsableGeoSynthesisConfig(config: KeywordLlmConfig | null): config is KeywordLlmConfig {
  if (!config || !config.apiKey.trim() || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u.test(config.model)
    || (config.authScheme !== "bearer" && config.authScheme !== "api-key")
    || (config.temperature !== null && (!Number.isFinite(config.temperature) || config.temperature < 0 || config.temperature > 2))) return false;
  try { const url = new URL(config.url); return url.protocol === "https:" && url.username === "" && url.password === ""; }
  catch { return false; }
}
export interface PreparedGeoSynthesis<T> {
  readonly input: T;
  readonly prompt: GeoSynthesisPrompt;
  readonly provider: GeoSynthesisProvider;
  readonly timeoutMs: number;
  readonly promptVersion: string;
  readonly responseJsonSchema: GeoResponseJsonSchema;
}
export type GeoSynthesisPreparation<T> = { readonly ok: true; readonly value: PreparedGeoSynthesis<T> } | Extract<GeoSynthesisResult<never>, { readonly ok: false }>;

function finishPreparation<T>(input: T, prompt: GeoSynthesisPrompt, maxOutputTokens: number, promptVersion: string, responseJsonSchema: GeoResponseJsonSchema, config: KeywordLlmConfig | null, timeoutMs: number): GeoSynthesisPreparation<T> {
  if (new TextEncoder().encode(JSON.stringify({ prompt, responseJsonSchema })).byteLength > GEO_SYNTHESIS_LIMITS.promptBytes) return notAttempted("input_too_large");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 45_000 || timeoutMs > 120_000) return notAttempted("not_configured");
  if (!isUsableGeoSynthesisConfig(config)) return notAttempted("not_configured");
  const provider: GeoSynthesisProvider = { modelRequested: config.model, modelReported: null, authScheme: config.authScheme, effectiveTemperature: config.temperature ?? GEO_BRIEF_TEMPERATURE, maxOutputTokens };
  return { ok: true, value: { input, prompt, provider, timeoutMs, promptVersion, responseJsonSchema } };
}

/** Shared with HTTP admission, so rejected config/input never consumes an attempt. */
export function prepareGeoRoleSynthesis(input: GeoRoleSynthesisInput, config: KeywordLlmConfig | null, timeoutMs = GEO_SYNTHESIS_TIMEOUT_MS): GeoSynthesisPreparation<GeoRoleSynthesisInput> {
  const parsed = parseGeoRoleSynthesisInput(input);
  if (!parsed.ok) return notAttempted("invalid_input");
  if (geoGenerationLanguage(parsed.value.questionLanguage) === null) return notAttempted("unsupported_language");
  return finishPreparation(parsed.value, buildGeoRoleSynthesisPrompt(parsed.value), GEO_ROLE_SYNTHESIS_MAX_OUTPUT_TOKENS, GEO_ROLE_SYNTHESIS_PROMPT_VERSION, GEO_ROLE_RESPONSE_JSON_SCHEMA, config, timeoutMs);
}
export function prepareGeoQuestionSynthesis(input: GeoQuestionSynthesisInput, config: KeywordLlmConfig | null, timeoutMs = GEO_SYNTHESIS_TIMEOUT_MS): GeoSynthesisPreparation<GeoQuestionSynthesisInput> {
  const parsed = parseGeoQuestionSynthesisInput(input);
  if (!parsed.ok) return notAttempted("invalid_input");
  if (geoGenerationLanguage(parsed.value.language) === null) return notAttempted("unsupported_language");
  return finishPreparation(parsed.value, buildGeoQuestionSynthesisPrompt(parsed.value), GEO_QUESTION_SYNTHESIS_MAX_OUTPUT_TOKENS, GEO_QUESTION_SYNTHESIS_PROMPT_VERSION, GEO_QUESTION_RESPONSE_JSON_SCHEMA, config, timeoutMs);
}

async function generate<T>(prepared: PreparedGeoSynthesis<unknown>, config: KeywordLlmConfig, parse: (raw: unknown) => GeoSynthesisParseResult<T>, dependencies: GeoSynthesisDependencies): Promise<GeoSynthesisResult<T>> {
  const { prompt, provider, timeoutMs } = prepared;
  const client = dependencies.client ?? createKeywordLlmClient({ config });
  try {
    // The durable caller must reserve this single attempt before invoking us.
    // No JSON repair, automatic retry, or release-on-timeout happens here.
    const completion = await client.complete({ ...prompt, temperature: provider.effectiveTemperature, maxOutputTokens: provider.maxOutputTokens, timeoutMs, responseJsonSchema: prepared.responseJsonSchema });
    const meta = { usage: completion.usage, provider, attemptedCalls: 1 as const, delivery: "response_received" as const };
    if (new TextEncoder().encode(completion.content).byteLength > GEO_SYNTHESIS_LIMITS.responseBytes) return { ...meta, ok: false, reason: "invalid_response" };
    let raw: unknown;
    try { raw = JSON.parse(completion.content); } catch { return { ...meta, ok: false, reason: "invalid_response" }; }
    const parsed = parse(raw);
    return parsed.ok ? { ...meta, ok: true, value: parsed.value } : { ...meta, ok: false, reason: parsed.reason };
  } catch (error) {
    // A fetch rejection cannot prove that a remote provider did not charge.
    // In particular, its default requestCount:0 is not no-dispatch evidence.
    const reason = error instanceof KeywordLlmError ? error.reason : "provider_error";
    const responseReceived = ["auth_failed", "rate_limited", "server_error", "bad_request"].includes(reason);
    return { ok: false, reason, provider, usage: error instanceof KeywordLlmError ? error.usage : EMPTY_KEYWORD_LLM_USAGE, attemptedCalls: 1, delivery: responseReceived ? "response_received" : "outcome_unknown" };
  }
}

export async function synthesizeGeoKbRoles(input: GeoRoleSynthesisInput, dependencies: GeoSynthesisDependencies = {}): Promise<GeoSynthesisResult<GeoRoleSynthesis>> {
  const config = dependencies.config !== undefined ? dependencies.config : resolveGeoBriefLlmConfig(dependencies.env);
  const prepared = prepareGeoRoleSynthesis(input, config, dependencies.timeoutMs);
  if (!prepared.ok) return prepared;
  // Successful preparation proved config non-null without returning its secret.
  return generate(prepared.value, config!, raw => parseGeoRoleSynthesis(raw, prepared.value.input), dependencies);
}
export async function synthesizeGeoKbQuestions(input: GeoQuestionSynthesisInput, dependencies: GeoSynthesisDependencies = {}): Promise<GeoSynthesisResult<GeoQuestionSynthesis>> {
  const config = dependencies.config !== undefined ? dependencies.config : resolveGeoBriefLlmConfig(dependencies.env);
  const prepared = prepareGeoQuestionSynthesis(input, config, dependencies.timeoutMs);
  if (!prepared.ok) return prepared;
  return generate(prepared.value, config!, raw => parseGeoQuestionSynthesis(raw, prepared.value.input), dependencies);
}
