/**
 * OpenAI structured-artifact client (spec §10.2, §14.4). OpenAI is the
 * first-release provider. This talks to the Chat Completions REST API directly
 * via `fetch` — no SDK, no env reads: the `apiKey` and `model` are injected by
 * the worker, and `fetchImpl` is injectable so tests never touch the network.
 *
 * `generateArtifact` runs the full accept-or-throw pipeline required by the spec:
 *   1. build the allowlisted prompt + hash the canonical input,
 *   2. call the API (mapping HTTP/timeout/transport failures to a typed `LLMError`),
 *   3. JSON + schema validate the returned envelope,
 *   4. reference-integrity check (no fabricated numbers),
 *   5. safety / length check,
 *   6. build `ArtifactContent` + the `AnalysisInvocationRecord`.
 * On any failure it throws an `LLMError` with a stable `code`; the error carries
 * the (failed/rejected) invocation record so the worker can still persist it.
 */

import type {
  AnalysisInvocationRecord,
  ArtifactContent,
  ArtifactPromptInput,
  LLMArtifactResult,
  LLMClient,
} from "../types.ts";
import { PROMPT_SET_VERSION } from "../types.ts";
import {
  buildMessages,
  hashArtifactContent,
  hashPromptInput,
  parseEnvelope,
  toArtifactContent,
} from "./envelope.ts";
import type { LlmArtifactEnvelope } from "./envelope.ts";
import { checkReferences } from "./reference-check.ts";

const OPENAI_CHAT_COMPLETIONS_URL =
  "https://api.openai.com/v1/chat/completions";
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_TIMEOUT_MS = 60_000;

/** Safety/length ceilings for the accepted artifact (spec §14.4 step 3). */
const MAX_MARKDOWN_CHARS = 40_000;
const MAX_TITLE_CHARS = 512;
const MAX_DESCRIPTION_CHARS = 2_048;
const MAX_RATIONALE_CHARS = 8_000;

/** Minimal `fetch` shape so tests can inject a fixture without DOM lib types. */
export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export type LLMErrorCode =
  | "CONFIG_INVALID"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "AUTH_FAILED"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "BAD_REQUEST"
  | "INVALID_RESPONSE"
  | "SCHEMA_INVALID"
  | "REFERENCE_INTEGRITY"
  | "SAFETY_VIOLATION";

/** Typed failure carrying a stable `code` and the invocation record to persist. */
export class LLMError extends Error {
  readonly code: LLMErrorCode;
  readonly invocation: AnalysisInvocationRecord | null;

  constructor(
    code: LLMErrorCode,
    message: string,
    invocation: AnalysisInvocationRecord | null = null,
  ) {
    super(message);
    this.name = "LLMError";
    this.code = code;
    this.invocation = invocation;
  }
}

export interface OpenAIClientOptions {
  readonly apiKey: string;
  readonly model: string;
  /** Defaults to the global `fetch`; injected in tests. */
  readonly fetchImpl?: FetchLike;
  /** Chat Completions endpoint override (tests / Azure OpenAI / self-hosted gateways). */
  readonly baseUrl?: string;
  /**
   * Auth header style. `bearer` (default) sends `Authorization: Bearer <key>`
   * for the OpenAI API; `api-key` sends the `api-key: <key>` header used by an
   * Azure OpenAI deployment (still the OpenAI provider — same models + API shape,
   * only the host + auth header differ, spec §10.2).
   */
  readonly authScheme?: "bearer" | "api-key";
  /** Sampling temperature; low by default for deterministic artifacts. */
  readonly temperature?: number;
  /** Per-request timeout in ms; aborts the fetch when exceeded. */
  readonly timeoutMs?: number;
}

interface Usage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
}

const NO_USAGE: Usage = { inputTokens: null, outputTokens: null };

function mapHttpStatus(status: number): LLMErrorCode {
  if (status === 401 || status === 403) return "AUTH_FAILED";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "SERVER_ERROR";
  return "BAD_REQUEST";
}

function mapTransportError(error: unknown): LLMErrorCode {
  if (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  ) {
    return "TIMEOUT";
  }
  return "NETWORK_ERROR";
}

function readUsage(data: unknown): Usage {
  if (typeof data !== "object" || data === null) return NO_USAGE;
  const usage = (data as { usage?: unknown }).usage;
  if (typeof usage !== "object" || usage === null) return NO_USAGE;
  const u = usage as Record<string, unknown>;
  return {
    inputTokens: typeof u.prompt_tokens === "number" ? u.prompt_tokens : null,
    outputTokens:
      typeof u.completion_tokens === "number" ? u.completion_tokens : null,
  };
}

function readMessageContent(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (typeof first !== "object" || first === null) return null;
  const message = (first as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) return null;
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}

function safetyErrors(envelope: LlmArtifactEnvelope): readonly string[] {
  if (envelope.kind === "metadata_rewrite") {
    const errors: string[] = [];
    if (envelope.proposedTitle.length > MAX_TITLE_CHARS)
      errors.push("proposedTitle exceeds length limit");
    if (envelope.currentTitle.length > MAX_TITLE_CHARS)
      errors.push("currentTitle exceeds length limit");
    if (envelope.proposedDescription.length > MAX_DESCRIPTION_CHARS)
      errors.push("proposedDescription exceeds length limit");
    if (envelope.currentDescription.length > MAX_DESCRIPTION_CHARS)
      errors.push("currentDescription exceeds length limit");
    if (envelope.rationale.length > MAX_RATIONALE_CHARS)
      errors.push("rationale exceeds length limit");
    return errors;
  }
  if (envelope.markdown.length > MAX_MARKDOWN_CHARS)
    return ["markdown exceeds length limit"];
  return [];
}

function buildInvocation(params: {
  readonly model: string;
  readonly inputHash: string;
  readonly outputHash: string | null;
  readonly status: AnalysisInvocationRecord["status"];
  readonly usage: Usage;
  readonly latencyMs: number;
  readonly errorCode: LLMErrorCode | null;
}): AnalysisInvocationRecord {
  return {
    task: "artifact_generation",
    provider: "openai",
    model: params.model,
    promptSetVersion: PROMPT_SET_VERSION,
    inputHash: params.inputHash,
    outputHash: params.outputHash,
    status: params.status,
    inputTokens: params.usage.inputTokens,
    outputTokens: params.usage.outputTokens,
    costUsd: null,
    latencyMs: params.latencyMs,
    errorCode: params.errorCode,
  };
}

export class OpenAIClient implements LLMClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: FetchLike;
  private readonly url: string;
  private readonly authScheme: "bearer" | "api-key";
  private readonly temperature: number;
  private readonly timeoutMs: number;

  constructor(options: OpenAIClientOptions) {
    if (options.apiKey.trim() === "") {
      throw new LLMError(
        "CONFIG_INVALID",
        "OpenAIClient requires a non-empty apiKey.",
      );
    }
    if (options.model.trim() === "") {
      throw new LLMError(
        "CONFIG_INVALID",
        "OpenAIClient requires a non-empty model.",
      );
    }
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.url = options.baseUrl ?? OPENAI_CHAT_COMPLETIONS_URL;
    this.authScheme = options.authScheme ?? "bearer";
    this.temperature = options.temperature ?? DEFAULT_TEMPERATURE;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async generateArtifact(
    input: ArtifactPromptInput,
  ): Promise<LLMArtifactResult> {
    const startedAt = Date.now();
    const inputHash = hashPromptInput(input);

    const raw = await this.callApi(input, inputHash, startedAt);
    const usage = readUsage(raw.data);

    const contentText = readMessageContent(raw.data);
    if (contentText === null) {
      throw this.fail(
        "INVALID_RESPONSE",
        "OpenAI response had no message content.",
        { inputHash, usage, startedAt },
      );
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(contentText);
    } catch {
      throw this.reject("SCHEMA_INVALID", "Model output was not valid JSON.", {
        inputHash,
        usage,
        startedAt,
      });
    }

    const parsed = parseEnvelope(input.artifactType, parsedJson);
    if (!parsed.ok) {
      throw this.reject(
        "SCHEMA_INVALID",
        `Model envelope failed schema validation: ${parsed.issues.join("; ")}`,
        {
          inputHash,
          usage,
          startedAt,
        },
      );
    }

    const referenceErrors = checkReferences(input, parsed.envelope);
    if (referenceErrors.length > 0) {
      throw this.reject(
        "REFERENCE_INTEGRITY",
        `Reference-integrity check failed: ${referenceErrors.join("; ")}`,
        {
          inputHash,
          usage,
          startedAt,
        },
      );
    }

    const safety = safetyErrors(parsed.envelope);
    if (safety.length > 0) {
      throw this.reject(
        "SAFETY_VIOLATION",
        `Safety/length check failed: ${safety.join("; ")}`,
        {
          inputHash,
          usage,
          startedAt,
        },
      );
    }

    const content: ArtifactContent = toArtifactContent(parsed.envelope);
    const invocation = buildInvocation({
      model: this.model,
      inputHash,
      outputHash: hashArtifactContent(content),
      status: "succeeded",
      usage,
      latencyMs: Date.now() - startedAt,
      errorCode: null,
    });

    return { content, invocation };
  }

  private async callApi(
    input: ArtifactPromptInput,
    inputHash: string,
    startedAt: number,
  ): Promise<{ readonly data: unknown }> {
    const { system, user } = buildMessages(input);
    const body = JSON.stringify({
      model: this.model,
      temperature: this.temperature,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(this.url, {
        method: "POST",
        headers: {
          ...(this.authScheme === "api-key"
            ? { "api-key": this.apiKey }
            : { Authorization: `Bearer ${this.apiKey}` }),
          "Content-Type": "application/json",
        },
        body,
        signal: controller.signal,
      });
    } catch (error) {
      throw this.fail(
        mapTransportError(error),
        "OpenAI request failed to reach the API.",
        {
          inputHash,
          usage: NO_USAGE,
          startedAt,
        },
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw this.fail(
        mapHttpStatus(response.status),
        `OpenAI request failed with HTTP ${response.status}.`,
        {
          inputHash,
          usage: NO_USAGE,
          startedAt,
        },
      );
    }

    try {
      return { data: await response.json() };
    } catch {
      throw this.fail("INVALID_RESPONSE", "OpenAI returned a non-JSON body.", {
        inputHash,
        usage: NO_USAGE,
        startedAt,
      });
    }
  }

  /** Build a `failed` (transport/HTTP/parse) LLMError with an attached invocation. */
  private fail(
    code: LLMErrorCode,
    message: string,
    ctx: {
      readonly inputHash: string;
      readonly usage: Usage;
      readonly startedAt: number;
    },
  ): LLMError {
    return new LLMError(
      code,
      message,
      buildInvocation({
        model: this.model,
        inputHash: ctx.inputHash,
        outputHash: null,
        status: "failed",
        usage: ctx.usage,
        latencyMs: Date.now() - ctx.startedAt,
        errorCode: code,
      }),
    );
  }

  /** Build a `rejected` (model produced content but it failed validation) LLMError. */
  private reject(
    code: LLMErrorCode,
    message: string,
    ctx: {
      readonly inputHash: string;
      readonly usage: Usage;
      readonly startedAt: number;
    },
  ): LLMError {
    return new LLMError(
      code,
      message,
      buildInvocation({
        model: this.model,
        inputHash: ctx.inputHash,
        outputHash: null,
        status: "rejected",
        usage: ctx.usage,
        latencyMs: Date.now() - ctx.startedAt,
        errorCode: code,
      }),
    );
  }
}

/** Factory the worker uses: `createOpenAIClient({ apiKey, model })`. */
export function createOpenAIClient(options: OpenAIClientOptions): OpenAIClient {
  return new OpenAIClient(options);
}
