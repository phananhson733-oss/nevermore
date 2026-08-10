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
  ArtifactType,
  LLMArtifactResult,
  LLMClient,
} from "../types.ts";
import { MAX_ARTIFACT_CONTENT_CHARS } from "@sf/contracts";
import {
  CONTENT_SHADOW_PROMPT_SET_VERSION,
  PROMPT_SET_VERSION,
  TECHNICAL_TICKET_PROMPT_SET_VERSION,
} from "../types.ts";
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

/**
 * Maximum decoded HTTP response bytes retained before outer JSON parsing.
 * Artifact output is capped at 40k characters, so 1 MiB leaves ample protocol
 * overhead while bounding a hostile/misconfigured OpenAI or Azure gateway.
 */
export const MAX_OPENAI_RESPONSE_BODY_BYTES = 1024 * 1024;

/** Safety/length ceilings for the accepted artifact (spec §14.4 step 3). */
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
  /**
   * Why the rejection happened, in terms a log can carry.
   *
   * An error code alone says a response was refused but not what about it was
   * wrong, which leaves a production rejection undiagnosable without replaying
   * the request against the provider. Callers that populate this must supply
   * structure only — field paths, issue kinds — never the response text, which
   * is model output about a customer's site and does not belong in a log.
   */
  readonly detail: string | null;

  constructor(
    code: LLMErrorCode,
    message: string,
    invocation: AnalysisInvocationRecord | null = null,
    detail: string | null = null,
  ) {
    super(message);
    this.name = "LLMError";
    this.code = code;
    this.invocation = invocation;
    this.detail = detail;
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
  /** Per-request timeout in ms, including decoded response-body consumption. */
  readonly timeoutMs?: number;
  /** Optional worker-lifecycle signal; composed with the per-request timeout. */
  readonly signal?: AbortSignal;
}

export interface OpenAIUsage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
}

const NO_USAGE: OpenAIUsage = { inputTokens: null, outputTokens: null };

class InvalidResponseBodyError extends Error {
  constructor() {
    super("invalid bounded response body");
    this.name = "InvalidResponseBodyError";
  }
}

function cancelBody(body: ReadableStream<Uint8Array> | null): void {
  if (!body) return;
  try {
    const cancellation = body.cancel();
    void Promise.resolve(cancellation).catch(() => undefined);
  } catch {
    // Cancellation is best-effort and must never replace the stable LLM error.
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("request timed out", "TimeoutError");
}

/**
 * Race one stream read against the request deadline. The read promise always
 * receives handlers, even when abort wins, so a later rejection cannot become
 * unhandled; the abort listener is removed on every terminal path.
 */
function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<{
  readonly done: boolean;
  readonly value: Uint8Array | undefined;
}> {
  if (signal.aborted) return Promise.reject(abortReason(signal));

  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener("abort", onAbort);
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });

    let pendingRead: Promise<{
      readonly done: boolean;
      readonly value: Uint8Array | undefined;
    }>;
    try {
      pendingRead = Promise.resolve(reader.read());
    } catch (error) {
      signal.removeEventListener("abort", onAbort);
      reject(error);
      return;
    }
    void pendingRead.then(
      (result) => {
        signal.removeEventListener("abort", onAbort);
        resolve(result);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function declaredContentLength(response: Response): number | null {
  const raw = response.headers.get("content-length");
  if (raw === null || !/^\d+$/.test(raw.trim())) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : Number.POSITIVE_INFINITY;
}

/**
 * Read the fetch-decoded body incrementally. `Content-Length` is only an early
 * rejection hint (it can describe compressed or dishonest bytes); streamed
 * decoded bytes are always counted independently before allocation/JSON parse.
 */
async function readBoundedJson(
  response: Response,
  signal: AbortSignal,
): Promise<unknown> {
  const body = response.body;
  if (!body) throw new InvalidResponseBodyError();

  const declaredBytes = declaredContentLength(response);
  if (
    declaredBytes !== null &&
    declaredBytes > MAX_OPENAI_RESPONSE_BODY_BYTES
  ) {
    cancelBody(body);
    throw new InvalidResponseBodyError();
  }

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = body.getReader();
  } catch {
    cancelBody(body);
    throw new InvalidResponseBodyError();
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let cancelled = false;
  const cancelReader = (): void => {
    if (cancelled) return;
    cancelled = true;
    try {
      const cancellation = reader.cancel();
      void Promise.resolve(cancellation).catch(() => undefined);
    } catch {
      // Cancellation is best-effort and must not expose a stream error/body.
    }
  };

  try {
    for (;;) {
      const next = await readChunk(reader, signal);
      if (next.done) break;
      const chunk = next.value;
      if (!(chunk instanceof Uint8Array)) {
        cancelReader();
        throw new InvalidResponseBodyError();
      }
      totalBytes += chunk.byteLength;
      if (totalBytes > MAX_OPENAI_RESPONSE_BODY_BYTES) {
        cancelReader();
        throw new InvalidResponseBodyError();
      }
      chunks.push(chunk);
    }
  } catch (error) {
    cancelReader();
    if (signal.aborted) throw abortReason(signal);
    if (error instanceof InvalidResponseBodyError) throw error;
    throw new InvalidResponseBodyError();
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A hostile/errored stream may retain its lock; no body data is exposed.
    }
  }

  if (totalBytes === 0) throw new InvalidResponseBodyError();

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new InvalidResponseBodyError();
  }
}

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

function readUsage(data: unknown): OpenAIUsage {
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

export interface OpenAIChatMessages {
  readonly system: string;
  readonly user: string;
}

export interface OpenAIChatCompletion {
  readonly content: string | null;
  readonly usage: OpenAIUsage;
}

/**
 * Low-level, body-free transport failure. Callers attach their task-specific
 * AnalysisInvocationRecord before allowing the error to cross their boundary.
 */
export class OpenAITransportError extends Error {
  readonly code: LLMErrorCode;

  constructor(code: LLMErrorCode, message: string) {
    super(message);
    this.name = "OpenAITransportError";
    this.code = code;
  }
}

/**
 * Shared bounded Chat Completions transport. Artifact and finding-summary
 * adapters reuse this exact path so redirect, timeout, decoded-body, and auth
 * safeguards cannot drift between the two first-release LLM tasks.
 */
export class OpenAIChatCompletionsTransport {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: FetchLike;
  private readonly url: string;
  private readonly authScheme: "bearer" | "api-key";
  private readonly temperature: number | undefined;
  private readonly timeoutMs: number;
  private readonly externalSignal: AbortSignal | undefined;

  constructor(options: OpenAIClientOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.url = options.baseUrl ?? OPENAI_CHAT_COMPLETIONS_URL;
    this.authScheme = options.authScheme ?? "bearer";
    this.temperature =
      options.temperature ??
      (this.authScheme === "api-key" ? undefined : DEFAULT_TEMPERATURE);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.externalSignal = options.signal;
  }

  async complete(messages: OpenAIChatMessages): Promise<OpenAIChatCompletion> {
    const body = JSON.stringify({
      model: this.model,
      ...(this.temperature === undefined
        ? {}
        : { temperature: this.temperature }),
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: messages.system },
        { role: "user", content: messages.user },
      ],
    });

    const controller = new AbortController();
    let timeoutReached = false;
    let externalAbortReached = false;
    const onExternalAbort = (): void => {
      externalAbortReached = true;
      controller.abort(
        new DOMException("OpenAI request aborted", "AbortError"),
      );
    };
    if (this.externalSignal) {
      this.externalSignal.addEventListener("abort", onExternalAbort, {
        once: true,
      });
      if (this.externalSignal.aborted) onExternalAbort();
    }
    const timer = setTimeout(() => {
      timeoutReached = true;
      controller.abort(
        new DOMException("OpenAI request timed out", "TimeoutError"),
      );
    }, this.timeoutMs);
    try {
      if (externalAbortReached) {
        throw new OpenAITransportError(
          "TIMEOUT",
          "OpenAI request was aborted.",
        );
      }
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
          redirect: "error",
          signal: controller.signal,
        });
      } catch (error) {
        const code =
          timeoutReached || externalAbortReached
            ? "TIMEOUT"
            : mapTransportError(error);
        throw new OpenAITransportError(
          code,
          "OpenAI request failed to reach the API.",
        );
      }

      if (timeoutReached || externalAbortReached) {
        cancelBody(response.body);
        throw new OpenAITransportError(
          "TIMEOUT",
          timeoutReached
            ? "OpenAI request timed out."
            : "OpenAI request was aborted.",
        );
      }

      if (!response.ok) {
        cancelBody(response.body);
        throw new OpenAITransportError(
          mapHttpStatus(response.status),
          `OpenAI request failed with HTTP ${response.status}.`,
        );
      }

      let data: unknown;
      try {
        data = await readBoundedJson(response, controller.signal);
      } catch {
        const requestAborted = timeoutReached || externalAbortReached;
        const code = requestAborted ? "TIMEOUT" : "INVALID_RESPONSE";
        const message = requestAborted
          ? timeoutReached
            ? "OpenAI request timed out."
            : "OpenAI request was aborted."
          : "OpenAI returned an invalid response body.";
        throw new OpenAITransportError(code, message);
      }
      return {
        content: readMessageContent(data),
        usage: readUsage(data),
      };
    } finally {
      clearTimeout(timer);
      this.externalSignal?.removeEventListener("abort", onExternalAbort);
    }
  }
}

function safetyErrors(envelope: LlmArtifactEnvelope): readonly string[] {
  if (envelope.kind === "metadata_rewrite") {
    const errors: string[] = [];
    if (envelope.proposedTitle.length > MAX_TITLE_CHARS)
      errors.push("proposedTitle exceeds length limit");
    if (
      envelope.currentTitle !== null &&
      envelope.currentTitle.length > MAX_TITLE_CHARS
    )
      errors.push("currentTitle exceeds length limit");
    if (envelope.proposedDescription.length > MAX_DESCRIPTION_CHARS)
      errors.push("proposedDescription exceeds length limit");
    if (
      envelope.currentDescription !== null &&
      envelope.currentDescription.length > MAX_DESCRIPTION_CHARS
    )
      errors.push("currentDescription exceeds length limit");
    if (envelope.rationale.length > MAX_RATIONALE_CHARS)
      errors.push("rationale exceeds length limit");
    return errors;
  }
  if (envelope.markdown.length > MAX_ARTIFACT_CONTENT_CHARS)
    return ["markdown exceeds length limit"];
  return [];
}

/**
 * The prompt set an invocation belongs to. `english_blog_draft` carries the
 * extra `contentBriefOutline` field and its own contract paragraph, while the
 * technical ticket pins validator-aligned headings. Each changed prompt records
 * its own scoped version; content briefs and metadata rewrites keep the global
 * version. Recording one shared name for differently shaped prompts would make
 * the invocation ledger lie.
 */
function promptSetVersionFor(artifactType: ArtifactType): string {
  if (artifactType === "english_blog_draft") {
    return CONTENT_SHADOW_PROMPT_SET_VERSION;
  }
  if (artifactType === "technical_ticket") {
    return TECHNICAL_TICKET_PROMPT_SET_VERSION;
  }
  return PROMPT_SET_VERSION;
}

function buildInvocation(params: {
  readonly model: string;
  readonly promptSetVersion: string;
  readonly inputHash: string;
  readonly outputHash: string | null;
  readonly status: AnalysisInvocationRecord["status"];
  readonly usage: OpenAIUsage;
  readonly latencyMs: number;
  readonly errorCode: LLMErrorCode | null;
}): AnalysisInvocationRecord {
  return {
    task: "artifact_generation",
    provider: "openai",
    model: params.model,
    promptSetVersion: params.promptSetVersion,
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
  private readonly model: string;
  private readonly transport: OpenAIChatCompletionsTransport;

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
    this.model = options.model;
    this.transport = new OpenAIChatCompletionsTransport(options);
  }

  async generateArtifact(
    input: ArtifactPromptInput,
  ): Promise<LLMArtifactResult> {
    const startedAt = Date.now();
    const promptSetVersion = promptSetVersionFor(input.artifactType);
    const inputHash = hashPromptInput(input);

    const raw = await this.callApi(
      input,
      promptSetVersion,
      inputHash,
      startedAt,
    );
    const usage = raw.usage;

    const contentText = raw.content;
    if (contentText === null) {
      throw this.fail(
        "INVALID_RESPONSE",
        "OpenAI response had no message content.",
        { promptSetVersion, inputHash, usage, startedAt },
      );
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(contentText);
    } catch {
      throw this.reject("SCHEMA_INVALID", "Model output was not valid JSON.", {
        promptSetVersion,
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
          promptSetVersion,
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
          promptSetVersion,
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
          promptSetVersion,
          inputHash,
          usage,
          startedAt,
        },
      );
    }

    const content: ArtifactContent = toArtifactContent(parsed.envelope, input);
    const invocation = buildInvocation({
      model: this.model,
      promptSetVersion,
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
    promptSetVersion: string,
    inputHash: string,
    startedAt: number,
  ): Promise<OpenAIChatCompletion> {
    try {
      return await this.transport.complete(buildMessages(input));
    } catch (error) {
      if (error instanceof OpenAITransportError) {
        throw this.fail(error.code, error.message, {
          promptSetVersion,
          inputHash,
          usage: NO_USAGE,
          startedAt,
        });
      }
      throw this.fail("NETWORK_ERROR", "OpenAI request failed.", {
        promptSetVersion,
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
      readonly promptSetVersion: string;
      readonly inputHash: string;
      readonly usage: OpenAIUsage;
      readonly startedAt: number;
    },
  ): LLMError {
    return new LLMError(
      code,
      message,
      buildInvocation({
        model: this.model,
        promptSetVersion: ctx.promptSetVersion,
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
      readonly promptSetVersion: string;
      readonly inputHash: string;
      readonly usage: OpenAIUsage;
      readonly startedAt: number;
    },
  ): LLMError {
    return new LLMError(
      code,
      message,
      buildInvocation({
        model: this.model,
        promptSetVersion: ctx.promptSetVersion,
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
