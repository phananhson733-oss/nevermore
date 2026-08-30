// @input  -- the question, the frozen knowledge base's facts, and the subtopics one answer used
// @output -- the assembly reply, or a named reason there is not one
// @pos    -- the GEO Brief's only model call; the sampled answer never reaches it as fact

import {
  createKeywordLlmClient,
  KeywordLlmError,
  type KeywordLlmClient,
  type KeywordLlmConfig,
} from "../tools/keyword-llm-client.ts";
import {
  parseGeoBriefReply,
  type GeoBriefModelReply,
} from "./brief-assemble.ts";
import {
  GEO_BRIEF_LIMITS_MAX,
  type GeoBriefFact,
} from "./brief-contract.ts";

/** The variable set this tool reads. Its own, so it can be moved alone. */
export const GEO_BRIEF_ENV_PREFIX = "GEO_BRIEF";

/**
 * Pinned low. The assembly step is not a writing task - it rewords observed
 * subtopics into questions and orders them. Variety there is drift.
 */
export const GEO_BRIEF_TEMPERATURE = 0.2;

/**
 * Enough for a dozen questions and ten headings, and no more.
 *
 * Sized against the parse bounds rather than guessed: a reply that would not
 * survive `parseGeoBriefReply` is a reply there is no reason to pay for. This
 * is a budget, not a reply length - a reasoning model spends from the same
 * pool, and this repo has been bitten four times by a ceiling set to the size
 * of the answer it wanted.
 */
export const GEO_BRIEF_MAX_OUTPUT_TOKENS = 4096;

export type GeoBriefLlmFailure =
  | "not_configured"
  | "nothing_to_assemble"
  | "timeout"
  | "provider_error"
  | "validation_failed";

export type GeoBriefLlmResult =
  | { readonly ok: true; readonly value: GeoBriefModelReply }
  | { readonly ok: false; readonly reason: GeoBriefLlmFailure };

export interface GeoBriefLlmInput {
  readonly questionText: string;
  readonly officialName: string;
  readonly categoryTerms: readonly string[];
  readonly requiredEntities: readonly string[];
  /** Server-assigned ids, in the order the subtopics were observed. */
  readonly subtopics: readonly { readonly id: string; readonly text: string }[];
  readonly facts: readonly GeoBriefFact[];
  readonly language: string;
}

export interface GeoBriefLlmDependencies {
  readonly config?: KeywordLlmConfig | null;
  readonly client?: KeywordLlmClient;
  readonly env?: Record<string, string | undefined>;
  readonly timeoutMs?: number;
}

function present(
  env: Record<string, string | undefined>,
  key: string,
): string | null {
  const raw = env[key];
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
}

function pinnedTemperature(
  env: Record<string, string | undefined>,
  key: string,
): number | null {
  const raw = present(env, key);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 2 ? value : null;
}

export function resolveGeoBriefLlmConfig(
  env: Record<string, string | undefined> = process.env,
): KeywordLlmConfig | null {
  const apiKey = present(env, `${GEO_BRIEF_ENV_PREFIX}_API_KEY`);
  const model = present(env, `${GEO_BRIEF_ENV_PREFIX}_MODEL`);
  if (apiKey === null || model === null) return null;
  return {
    apiKey,
    model,
    // The same default the keyword client uses, restated rather than imported
    // as a private constant: this tool may be pointed at another deployment
    // without the other one moving.
    url:
      present(env, `${GEO_BRIEF_ENV_PREFIX}_URL`) ??
      "https://api.openai.com/v1/chat/completions",
    authScheme:
      present(env, `${GEO_BRIEF_ENV_PREFIX}_AUTH_SCHEME`)?.toLowerCase() ===
      "api-key"
        ? "api-key"
        : "bearer",
    temperature: pinnedTemperature(
      env,
      `${GEO_BRIEF_ENV_PREFIX}_TEMPERATURE`,
    ),
  };
}

/**
 * The one instruction that matters.
 *
 * Everything else in this prompt is formatting. The rule that the model may not
 * introduce a fact is the reason a brief can be handed to a writer at all: the
 * subtopics come from another company's answer and the numbers come from the
 * customer's own verified table, and a model allowed to blend them would
 * produce a brief that reads like research and is partly invention.
 */
export const GEO_BRIEF_SYSTEM_PROMPT = [
  "You turn observed material into a content brief. You never add facts.",
  "",
  "You are given: one question buyers ask, the subtopics that a real answer to",
  "that question used, and a table of facts the site owner has verified. The",
  "subtopics tell you what the page must cover. The fact table is the only",
  "source of anything specific: numbers, prices, capabilities, dates.",
  "",
  "Rules:",
  "- Never state a fact that is not in the fact table. If a subtopic needs a",
  "  number that is not there, still list it as something to answer, and let",
  "  the writer find the number.",
  "- Never invent a subtopic id. Return the ids you were given, unchanged.",
  "- You may add a must-answer item with a new id only when the question",
  "  obviously requires it and no given subtopic covers it.",
  "- Write in the language named in the input.",
  "",
  "Return only JSON, with this exact shape:",
  '{"leadAnswerRequirement": string,',
  ' "mustAnswer": [{"id": string, "text": string}],',
  ' "outline": [{"heading": string, "answers": [string]}]}',
].join("\n");

function factLines(facts: readonly GeoBriefFact[]): string {
  if (facts.length === 0) return "(none verified)";
  return facts
    .map((fact) =>
      fact.value === null
        ? `- ${fact.key}: NOT VERIFIED (${fact.reason ?? "unknown"}) - do not state a value`
        : `- ${fact.key}: ${fact.value}`,
    )
    .join("\n");
}

export function geoBriefUserPrompt(input: GeoBriefLlmInput): string {
  return [
    `Language: ${input.language}`,
    `Brand: ${input.officialName}`,
    `Category: ${input.categoryTerms.join(", ") || "(not given)"}`,
    "",
    `Question: ${input.questionText}`,
    "",
    "Entities a correct answer must name:",
    input.requiredEntities.length === 0
      ? "(none)"
      : input.requiredEntities.map((entity) => `- ${entity}`).join("\n"),
    "",
    "Subtopics observed in one real answer to this question:",
    input.subtopics.length === 0
      ? "(none - the answer had no structure to read)"
      : input.subtopics.map((entry) => `- ${entry.id}: ${entry.text}`).join("\n"),
    "",
    "Verified facts (the only source of specifics):",
    factLines(input.facts),
    "",
    `Return at most ${String(GEO_BRIEF_LIMITS_MAX.mustAnswer)} must-answer items`,
    `and at most ${String(GEO_BRIEF_LIMITS_MAX.outline)} outline sections.`,
  ].join("\n");
}

/**
 * Ask for the assembly, and refuse a reply that is not the shape.
 *
 * Failure is named rather than thrown. Every one of these reasons is a state
 * the brief can still be built in - without an outline, with the observed
 * subtopics as the must-answer list - and the report says which one happened.
 * A brief that silently lost its outline looks exactly like one whose question
 * did not need many sections.
 */
export async function runGeoBriefLlm(
  input: GeoBriefLlmInput,
  dependencies: GeoBriefLlmDependencies = {},
): Promise<GeoBriefLlmResult> {
  if (input.subtopics.length === 0 && input.requiredEntities.length === 0) {
    // Nothing observed and nothing required: there is no material to arrange,
    // and a model asked to arrange nothing writes the brief itself.
    return { ok: false, reason: "nothing_to_assemble" };
  }
  const config =
    dependencies.config !== undefined
      ? dependencies.config
      : resolveGeoBriefLlmConfig(dependencies.env ?? process.env);
  if (config === null) return { ok: false, reason: "not_configured" };

  const client = dependencies.client ?? createKeywordLlmClient({ config });
  try {
    const completion = await client.complete({
      system: GEO_BRIEF_SYSTEM_PROMPT,
      user: geoBriefUserPrompt(input),
      temperature: GEO_BRIEF_TEMPERATURE,
      maxOutputTokens: GEO_BRIEF_MAX_OUTPUT_TOKENS,
      ...(dependencies.timeoutMs === undefined
        ? {}
        : { timeoutMs: dependencies.timeoutMs }),
    });
    let raw: unknown;
    try {
      raw = JSON.parse(completion.content) as unknown;
    } catch {
      return { ok: false, reason: "validation_failed" };
    }
    const parsed = parseGeoBriefReply(
      raw,
      input.subtopics.map((entry) => entry.id),
    );
    return parsed.ok
      ? { ok: true, value: parsed.value }
      : { ok: false, reason: "validation_failed" };
  } catch (error) {
    if (!(error instanceof KeywordLlmError)) throw error;
    return {
      ok: false,
      reason: error.reason === "timeout" ? "timeout" : "provider_error",
    };
  }
}
