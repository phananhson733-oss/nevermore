// @input -- exact receipt-backed synthesis input and pinned GEO Brief provider config
// @output -- one strict narrative result with usage and delivery certainty
// @pos -- provider adapter only; durable reservation/finalization belongs to the caller
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
import {
  GEO_BRIEF_TEMPERATURE,
  resolveGeoBriefLlmConfig,
} from "./brief-llm.ts";
import {
  GEO_KNOWLEDGE_NARRATIVE_SCHEMA,
  GEO_KNOWLEDGE_SYNTHESIS_LIMITS,
  parseGeoKnowledgeNarrativeV1,
  parseGeoKnowledgeSynthesisInputV1,
  type GeoKnowledgeNarrativeV1,
  type GeoKnowledgeSynthesisInputV1,
} from "./kb-knowledge-synthesis-contract.ts";
import {
  buildGeoKnowledgeSynthesisPrompt,
  type GeoKnowledgeSynthesisPrompt,
} from "./kb-knowledge-synthesis-prompts.ts";
import { isUsableGeoSynthesisConfig } from "./kb-synthesis.ts";

export const GEO_KNOWLEDGE_SYNTHESIS_PROMPT_VERSION =
  "geo-kb-knowledge-pack.v1" as const;
export const GEO_KNOWLEDGE_SYNTHESIS_MAX_OUTPUT_TOKENS = 32_768;
export const GEO_KNOWLEDGE_SYNTHESIS_TIMEOUT_MS = 90_000;
/** A parsed input can be larger than a provider prompt we are willing to buy. */
export const GEO_KNOWLEDGE_SYNTHESIS_PROMPT_BYTES = 128 * 1024;

type GeoResponseJsonSchema = NonNullable<
  KeywordLlmRequest["responseJsonSchema"]
>;

const ID_PATTERN = "^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$";
const HOSTNAME_PATTERN =
  "^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$";
const textSchema = (maxLength: number) =>
  ({ type: "string", minLength: 1, maxLength }) as const;
const nullableTextSchema = (maxLength: number) =>
  ({ type: ["string", "null"], minLength: 1, maxLength }) as const;
const idSchema = {
  ...textSchema(128),
  pattern: ID_PATTERN,
} as const;
const hostnameSchema = {
  ...textSchema(128),
  pattern: HOSTNAME_PATTERN,
} as const;
const yearSchema = {
  type: ["string", "null"],
  minLength: 4,
  maxLength: 4,
  pattern: "^\\d{4}$",
} as const;
/*
 * No `uniqueItems`, here or in the variant list below.
 *
 * Structured Outputs rejects the keyword outright -- "'uniqueItems' is not
 * permitted" -- and it rejects the whole request, so the model never sees the
 * prompt. The v2 schema carried the same defect and it is what kept the v3
 * knowledge step from ever reaching a provider.
 *
 * Nothing is lost. Duplicates are refused where they were always refused, by
 * the contract that parses the reply: `refine(unique, "Duplicate source
 * reference")` (kb-knowledge-synthesis-contract.ts:97) and
 * `refine(normalizedUnique, "Duplicate variant")` (:103).
 */
const sourceRefsSchema = {
  type: "array",
  minItems: 1,
  maxItems: GEO_KNOWLEDGE_SYNTHESIS_LIMITS.sourceRefs,
  items: idSchema,
} as const;
const definitionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["w25", "w55", "w120"],
  properties: {
    w25: textSchema(GEO_KNOWLEDGE_SYNTHESIS_LIMITS.definitionCodePoints.w25),
    w55: textSchema(GEO_KNOWLEDGE_SYNTHESIS_LIMITS.definitionCodePoints.w55),
    w120: textSchema(
      GEO_KNOWLEDGE_SYNTHESIS_LIMITS.definitionCodePoints.w120,
    ),
  },
} as const;
const audienceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["who", "notFor"],
  properties: { who: textSchema(800), notFor: nullableTextSchema(800) },
} as const;
const foundedSchema = {
  type: "object",
  additionalProperties: false,
  required: ["year", "team", "location"],
  properties: {
    year: yearSchema,
    team: nullableTextSchema(800),
    location: nullableTextSchema(800),
  },
} as const;
const entitySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "definitions",
    "audience",
    "founded",
    "disambiguation",
    "sourceRefs",
  ],
  properties: {
    definitions: definitionSchema,
    audience: audienceSchema,
    founded: foundedSchema,
    disambiguation: nullableTextSchema(800),
    sourceRefs: sourceRefsSchema,
  },
} as const;
const factSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "type", "statement", "sourceRefs"],
  properties: {
    id: idSchema,
    type: {
      type: "string",
      enum: [
        "price",
        "policy",
        "feature",
        "integration",
        "company",
        "audience",
        "data",
        "other",
      ],
    },
    statement: textSchema(800),
    sourceRefs: sourceRefsSchema,
  },
} as const;
const qaSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "intent",
    "question",
    "variants",
    "directAnswer",
    "expansion",
    "sourceRefs",
  ],
  properties: {
    id: idSchema,
    intent: {
      type: "string",
      enum: [
        "definition",
        "comparison",
        "price",
        "operation",
        "trust",
        "boundary",
        "alternative",
        "applicability",
        "other",
      ],
    },
    question: textSchema(800),
    variants: {
      type: "array",
      minItems: 0,
      maxItems: GEO_KNOWLEDGE_SYNTHESIS_LIMITS.variants,
      items: textSchema(800),
    },
    directAnswer: textSchema(800),
    expansion: nullableTextSchema(2_400),
    sourceRefs: sourceRefsSchema,
  },
} as const;
const competitorSchema = {
  type: "object",
  additionalProperties: false,
  required: ["key", "name", "confirmed"],
  properties: {
    key: hostnameSchema,
    name: textSchema(200),
    confirmed: { type: "boolean", const: true },
  },
} as const;
const comparisonRowVariant = (
  availability: "available" | "partial" | "unavailable",
  product:
    | ReturnType<typeof textSchema>
    | ReturnType<typeof nullableTextSchema>
    | { readonly type: "null" },
  competitor:
    | ReturnType<typeof textSchema>
    | ReturnType<typeof nullableTextSchema>
    | { readonly type: "null" },
) =>
  ({
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "dimension",
      "product",
      "competitor",
      "sourceRefs",
      "availability",
    ],
    properties: {
      id: idSchema,
      dimension: textSchema(120),
      product,
      competitor,
      sourceRefs: sourceRefsSchema,
      availability: { type: "string", enum: [availability] },
    },
  }) as const;
const comparisonRowSchema = {
  // Mutually exclusive availability values make these branches an exact
  // encoding of the local row invariant without unsupported if/then syntax.
  anyOf: [
    comparisonRowVariant("available", textSchema(800), textSchema(800)),
    comparisonRowVariant(
      "partial",
      nullableTextSchema(800),
      nullableTextSchema(800),
    ),
    comparisonRowVariant("unavailable", { type: "null" }, { type: "null" }),
  ],
} as const;
const comparisonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "competitor", "rows", "verdict", "sourceRefs"],
  properties: {
    id: idSchema,
    competitor: competitorSchema,
    rows: {
      type: "array",
      minItems: 1,
      maxItems: GEO_KNOWLEDGE_SYNTHESIS_LIMITS.comparisonRows,
      items: comparisonRowSchema,
    },
    verdict: textSchema(800),
    sourceRefs: sourceRefsSchema,
  },
} as const;
const statementSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "text", "sourceRefs"],
  properties: {
    id: idSchema,
    text: textSchema(800),
    sourceRefs: sourceRefsSchema,
  },
} as const;
const scopeListSchema = {
  type: "array",
  minItems: 0,
  maxItems: GEO_KNOWLEDGE_SYNTHESIS_LIMITS.scopeItems,
  items: statementSchema,
} as const;
const scopeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["does", "doesNot", "needsHuman", "misconceptions"],
  properties: {
    does: scopeListSchema,
    doesNot: scopeListSchema,
    needsHuman: scopeListSchema,
    misconceptions: scopeListSchema,
  },
  /*
   * "At least one statement across the four groups" is deliberately not stated
   * here. It could be: this is a choice about size, not a provider limit.
   *
   * It used to be four `anyOf` branches that each tightened one array's
   * `minItems` from 0 to 1 and named nothing else. Structured Outputs reads
   * every `anyOf` branch as a schema in its own right and requires each to be
   * complete -- a `type`, `additionalProperties: false`, and a `required`
   * naming every property -- so those branches were refused, and the refusal
   * was the whole request.
   *
   * Written properly the union does express the rule, the way
   * `comparisonRowSchema` above already does, at the cost of repeating all
   * four scope lists four times. The v2 schema is where that price was
   * measured -- 8 222 bytes, against a request ceiling that already refuses
   * real sites -- and v1 follows the same decision.
   *
   * So the rule lives in two places instead of three: the prompt states it in
   * words, and `refine(... "Scope cannot be empty")` in
   * kb-knowledge-synthesis-contract.ts:107 refuses an empty scope. An empty
   * scope now costs a rejected reply rather than an unsendable request.
   */
} as const;

export const GEO_KNOWLEDGE_SYNTHESIS_RESPONSE_JSON_SCHEMA: GeoResponseJsonSchema =
  {
    name: "marketing_geo_knowledge_narrative_v1",
    schema: {
      type: "object",
      additionalProperties: false,
      required: [
        "schemaVersion",
        "entity",
        "facts",
        "qa",
        "comparisons",
        "scope",
      ],
      properties: {
        schemaVersion: {
          type: "string",
          enum: [GEO_KNOWLEDGE_NARRATIVE_SCHEMA],
        },
        entity: entitySchema,
        facts: {
          type: "array",
          minItems: 0,
          maxItems: GEO_KNOWLEDGE_SYNTHESIS_LIMITS.facts,
          items: factSchema,
        },
        qa: {
          type: "array",
          minItems: 0,
          maxItems: GEO_KNOWLEDGE_SYNTHESIS_LIMITS.qa,
          items: qaSchema,
        },
        comparisons: {
          type: "array",
          minItems: 0,
          maxItems: GEO_KNOWLEDGE_SYNTHESIS_LIMITS.comparisons,
          items: comparisonSchema,
        },
        scope: scopeSchema,
      },
    },
  };

export interface GeoKnowledgeSynthesisDependencies {
  readonly config?: KeywordLlmConfig | null;
  readonly client?: KeywordLlmClient;
  readonly env?: Record<string, string | undefined>;
  readonly timeoutMs?: number;
}

export interface GeoKnowledgeSynthesisProvider {
  readonly modelRequested: string;
  /** The shared transport cannot prove whether its model ID was provider-reported. */
  readonly modelReported: null;
  readonly authScheme: KeywordLlmConfig["authScheme"];
  readonly effectiveTemperature: number;
  readonly maxOutputTokens: number;
}

interface GeoKnowledgeSynthesisAttemptMeta {
  readonly usage: KeywordLlmUsage;
  readonly provider: GeoKnowledgeSynthesisProvider | null;
  readonly attemptedCalls: 0 | 1;
  readonly delivery: "not_attempted" | "response_received" | "outcome_unknown";
}

export type GeoKnowledgeSynthesisFailure =
  GeoKnowledgeSynthesisAttemptMeta & {
    readonly ok: false;
    readonly reason:
      | KeywordLlmFailureReason
      | "invalid_input"
      | "input_too_large"
      | "unsupported_language"
      | "provider_error";
  };

export type GeoKnowledgeSynthesisResult =
  | {
      readonly ok: true;
      readonly value: GeoKnowledgeNarrativeV1;
      readonly usage: KeywordLlmUsage;
      readonly provider: GeoKnowledgeSynthesisProvider;
      readonly attemptedCalls: 1;
      readonly delivery: "response_received";
    }
  | GeoKnowledgeSynthesisFailure;

export interface PreparedGeoKnowledgeSynthesis {
  readonly input: GeoKnowledgeSynthesisInputV1;
  readonly prompt: GeoKnowledgeSynthesisPrompt;
  readonly provider: GeoKnowledgeSynthesisProvider;
  readonly timeoutMs: number;
  readonly promptVersion: typeof GEO_KNOWLEDGE_SYNTHESIS_PROMPT_VERSION;
  readonly responseJsonSchema: GeoResponseJsonSchema;
}

export type GeoKnowledgeSynthesisPreparation =
  | { readonly ok: true; readonly value: PreparedGeoKnowledgeSynthesis }
  | GeoKnowledgeSynthesisFailure;

type FailureReason = GeoKnowledgeSynthesisFailure["reason"];

function notAttempted(reason: FailureReason): GeoKnowledgeSynthesisFailure {
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

function parsedInput(
  input: unknown,
):
  | { readonly ok: true; readonly value: GeoKnowledgeSynthesisInputV1 }
  | { readonly ok: false; readonly reason: "invalid_input" | "input_too_large" } {
  try {
    return { ok: true, value: parseGeoKnowledgeSynthesisInputV1(input) };
  } catch (error) {
    const reason =
      error instanceof Error && /exceeds byte budget/iu.test(error.message)
        ? "input_too_large"
        : "invalid_input";
    return { ok: false, reason };
  }
}

/** Shared with durable admission so a refusal cannot consume an attempt. */
export function prepareGeoKnowledgeSynthesis(
  input: unknown,
  config: KeywordLlmConfig | null,
  timeoutMs = GEO_KNOWLEDGE_SYNTHESIS_TIMEOUT_MS,
): GeoKnowledgeSynthesisPreparation {
  const parsed = parsedInput(input);
  if (!parsed.ok) return notAttempted(parsed.reason);
  if (geoGenerationLanguage(parsed.value.language) === null) {
    return notAttempted("unsupported_language");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 45_000 || timeoutMs > 120_000) {
    return notAttempted("not_configured");
  }
  if (!isUsableGeoSynthesisConfig(config)) {
    return notAttempted("not_configured");
  }

  const prompt = buildGeoKnowledgeSynthesisPrompt(parsed.value);
  if (
    byteLength(
      JSON.stringify({
        prompt,
        responseJsonSchema: GEO_KNOWLEDGE_SYNTHESIS_RESPONSE_JSON_SCHEMA,
      }),
    ) > GEO_KNOWLEDGE_SYNTHESIS_PROMPT_BYTES
  ) {
    return notAttempted("input_too_large");
  }

  const provider: GeoKnowledgeSynthesisProvider = {
    modelRequested: config.model,
    modelReported: null,
    authScheme: config.authScheme,
    effectiveTemperature: config.temperature ?? GEO_BRIEF_TEMPERATURE,
    maxOutputTokens: GEO_KNOWLEDGE_SYNTHESIS_MAX_OUTPUT_TOKENS,
  };
  return {
    ok: true,
    value: {
      input: parsed.value,
      prompt,
      provider,
      timeoutMs,
      promptVersion: GEO_KNOWLEDGE_SYNTHESIS_PROMPT_VERSION,
      responseJsonSchema: GEO_KNOWLEDGE_SYNTHESIS_RESPONSE_JSON_SCHEMA,
    },
  };
}

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

export async function synthesizeGeoKnowledgeNarrative(
  input: unknown,
  dependencies: GeoKnowledgeSynthesisDependencies = {},
): Promise<GeoKnowledgeSynthesisResult> {
  const config =
    dependencies.config !== undefined
      ? dependencies.config
      : resolveGeoBriefLlmConfig(dependencies.env);
  const prepared = prepareGeoKnowledgeSynthesis(
    input,
    config,
    dependencies.timeoutMs,
  );
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
    if (
      byteLength(completion.content) >
      GEO_KNOWLEDGE_SYNTHESIS_LIMITS.narrativeBytes
    ) {
      return { ...meta, ok: false, reason: "invalid_response" };
    }

    let raw: unknown;
    try {
      raw = JSON.parse(completion.content);
    } catch {
      return { ...meta, ok: false, reason: "invalid_response" };
    }
    try {
      return {
        ...meta,
        ok: true,
        value: parseGeoKnowledgeNarrativeV1(raw, prepared.value.input),
      };
    } catch {
      return { ...meta, ok: false, reason: "schema_invalid" };
    }
  } catch (error) {
    const reason =
      error instanceof KeywordLlmError ? error.reason : "provider_error";
    return {
      ok: false,
      reason,
      usage:
        error instanceof KeywordLlmError
          ? error.usage
          : EMPTY_KEYWORD_LLM_USAGE,
      provider,
      attemptedCalls: 1,
      delivery:
        error instanceof KeywordLlmError && responseReceived(error.reason)
          ? "response_received"
          : "outcome_unknown",
    };
  }
}
