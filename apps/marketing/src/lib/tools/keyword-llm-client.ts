// @input  -- provider env/options, an injected fetch, one task-deadlined request
// @output -- request-deadlined JSON mode/strict-schema completion with model/usage, or KeywordLlmError
// @pos    -- the marketing site's only LLM transport; consumed by keyword-prompts.ts
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * The marketing app has no LLM infrastructure of its own: `@sf/artifacts` is a
 * worker-side package and pulling it in here would drag the whole artifact
 * pipeline (and its node-only dependencies) into a Next bundle. So this is a
 * deliberately thin re-statement of the one thing the Keyword Opportunity Map
 * needs — a bounded Chat Completions call in JSON or strict-schema mode — with the same
 * transport safeguards the worker client already proved out: redirects
 * refused, a hard deadline, a decoded-body ceiling, and no response text in any
 * error or log.
 *
 * Configuration is resolved the same way the worker resolves it
 * (`apps/worker/src/env.ts:resolveLlmClientConfig`). Two apps disagreeing about
 * which key wins is how an Azure-only deployment quietly starts talking to
 * api.openai.com, so the precedence is copied rather than re-invented.
 */

/** Minimal `fetch` shape so a test can inject a fixture without touching DOM types. */
export type KeywordLlmFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

/**
 * Why the call failed, for logs only.
 *
 * Kept separate from `code` because the caller-facing code must stay one
 * stable string (below) while an operator still needs to tell an unconfigured
 * deployment apart from a rate-limited provider apart from a model that
 * returned prose. None of these members ever carries response text.
 */
export type KeywordLlmFailureReason =
  | "not_configured"
  | "network_error"
  | "timeout"
  | "auth_failed"
  | "rate_limited"
  | "server_error"
  | "bad_request"
  | "invalid_response"
  | "schema_invalid";

/**
 * The single public error code every LLM failure collapses to.
 *
 * Distinct from `keyword_source_unavailable` on purpose. The model expands
 * candidates before DataForSEO validates them, and collapsing those two
 * dependencies sent visitors to debug the search-data source when the model
 * transport was the component that failed.
 */
export const KEYWORD_LLM_ERROR_CODE = "keyword_generation_unavailable" as const;

/** Transport/config/schema failure carrying the handler-mappable `code`. */
export class KeywordLlmError extends Error {
  readonly code: typeof KEYWORD_LLM_ERROR_CODE = KEYWORD_LLM_ERROR_CODE;
  readonly reason: KeywordLlmFailureReason;
  /**
   * Tokens the failed attempt still burned.
   *
   * Only ever non-empty for `invalid_response`, which is the one failure where
   * the provider answered, charged for the answer, and put nothing usable in
   * it — a reasoning model that spends its whole output budget thinking bills
   * exactly like one that also wrote a reply. A retry that dropped this on the
   * floor would make the expensive failures the cheapest-looking ones in the
   * cost log.
   */
  readonly usage: KeywordLlmUsage;

  constructor(
    reason: KeywordLlmFailureReason,
    message: string,
    usage?: KeywordLlmUsage,
  ) {
    super(message);
    this.name = "KeywordLlmError";
    this.reason = reason;
    this.usage = usage ?? EMPTY_KEYWORD_LLM_USAGE;
  }
}

/** Resolved provider options: direct api.openai.com or an Azure deployment. */
export interface KeywordLlmConfig {
  readonly apiKey: string;
  /** Azure sends the deployment name here; direct OpenAI sends OPENAI_MODEL. */
  readonly model: string;
  readonly url: string;
  readonly authScheme: "bearer" | "api-key";
  /**
   * A sampling temperature the deployment insists on, or null to let each
   * task pick its own.
   *
   * Not a preference. Some deployments accept exactly one value and refuse
   * anything else outright rather than nudging it — the product's Azure
   * `gpt-5.6-luna` runs at 1 for that reason, which the sibling quick-wins
   * draft config already documents. Without this, the two task-tuned
   * temperatures in `keyword-prompts.ts` would make every production request
   * fail with a 400 that reads like a model problem.
   */
  readonly temperature: number | null;
}

const OPENAI_CHAT_COMPLETIONS_URL =
  "https://api.openai.com/v1/chat/completions";

/**
 * Default per-request deadline.
 *
 * Both stages run inside a serverless function that must still return an error
 * envelope the surface can render, so the model may not own the whole budget.
 * Lightweight calls use this default; heavier callers may set a task-specific
 * request override while preserving the same transport behavior.
 */
export const KEYWORD_LLM_TIMEOUT_MS = 45_000;

/**
 * Absolute deadline ceiling below the route's 300-second execution budget.
 *
 * Sixty seconds remain for response decoding and a controlled error envelope;
 * the shipped expansion deadline is intentionally much lower at 90 seconds.
 */
const MAX_KEYWORD_LLM_TIMEOUT_MS = 240_000;

function resolveKeywordLlmTimeoutMs(
  requestTimeoutMs: number | undefined,
  clientTimeoutMs: number | undefined,
): number {
  const timeoutMs =
    requestTimeoutMs ?? clientTimeoutMs ?? KEYWORD_LLM_TIMEOUT_MS;
  // `setTimeout` coerces negative, fractional, NaN, infinite, and oversized
  // values. Reject them instead of silently turning a configured deadline into
  // an immediate abort or a duration that can outlive the route.
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > MAX_KEYWORD_LLM_TIMEOUT_MS
  ) {
    throw new KeywordLlmError(
      "not_configured",
      "LLM request deadline is outside the supported range.",
    );
  }
  return timeoutMs;
}

/**
 * Decoded response bytes retained before parsing.
 *
 * The largest legitimate reply is the expansion lane: ~150 short candidate
 * objects, about 20 KB of JSON. 256 KiB is an order of magnitude of headroom
 * while still bounding a hostile or misconfigured gateway that streams forever
 * — the reason this is a byte ceiling on the stream and not a check after
 * `response.text()` has already allocated everything.
 */
export const MAX_KEYWORD_LLM_RESPONSE_BODY_BYTES = 256 * 1024;

/** One chat turn. The caller owns the sampling and output budget per task. */
export interface KeywordLlmRequest {
  readonly system: string;
  readonly user: string;
  readonly temperature: number;
  readonly maxOutputTokens: number;
  /** Positive safe-integer task deadline up to the guarded route ceiling. */
  readonly timeoutMs?: number;
  /** Internal structured-output contract. Omitted callers retain JSON mode. */
  readonly responseJsonSchema?: {
    readonly name: string;
    readonly schema: Readonly<Record<string, unknown>>;
  };
}

const MAX_KEYWORD_LLM_REQUEST_SCHEMA_BYTES = 32 * 1024;
const SAFE_RESPONSE_SCHEMA_NAME = /^[A-Za-z0-9_-]{1,64}$/u;
function responseFormat(request: KeywordLlmRequest): unknown {
  const configured = request.responseJsonSchema;
  if (configured === undefined) return { type: "json_object" };
  if (!SAFE_RESPONSE_SCHEMA_NAME.test(configured.name) || typeof configured.schema !== "object" || configured.schema === null || Array.isArray(configured.schema)) {
    throw new KeywordLlmError("not_configured", "LLM response JSON Schema is invalid.");
  }
  try {
    const encoded = JSON.stringify(configured.schema);
    if (new TextEncoder().encode(encoded).byteLength > MAX_KEYWORD_LLM_REQUEST_SCHEMA_BYTES) throw new Error("oversized");
  } catch {
    throw new KeywordLlmError("not_configured", "LLM response JSON Schema is invalid.");
  }
  return { type: "json_schema", json_schema: { name: configured.name, strict: true, schema: configured.schema } };
}

/**
 * What one run spent.
 *
 * `inputTokens`/`outputTokens` are null when the provider reported no usage
 * block — an unknown count, which is not the same fact as zero tokens and must
 * not be summed as if it were. `requestCount` and `retryCount` are always
 * known, because we count them ourselves, so they are plain numbers.
 */
export interface KeywordLlmUsage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly requestCount: number;
  readonly retryCount: number;
}

export const EMPTY_KEYWORD_LLM_USAGE: KeywordLlmUsage = {
  inputTokens: null,
  outputTokens: null,
  requestCount: 0,
  retryCount: 0,
};

function addTokens(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return a + b;
}

/**
 * Fold two usage records into one.
 *
 * Null is absorbing only against null: one attempt reporting 900 input tokens
 * and a second reporting nothing is "at least 900", not "unknown". Reporting
 * unknown there would let a retry storm hide behind a blank cost line.
 */
export function mergeKeywordLlmUsage(
  a: KeywordLlmUsage,
  b: KeywordLlmUsage,
): KeywordLlmUsage {
  return {
    inputTokens: addTokens(a.inputTokens, b.inputTokens),
    outputTokens: addTokens(a.outputTokens, b.outputTokens),
    requestCount: a.requestCount + b.requestCount,
    retryCount: a.retryCount + b.retryCount,
  };
}

export interface KeywordLlmCompletion {
  readonly content: string;
  readonly usage: KeywordLlmUsage;
  /** Bounded provider response model, falling back to the configured model. */
  readonly modelId?: string | null;
}

export interface KeywordLlmClient {
  complete(request: KeywordLlmRequest): Promise<KeywordLlmCompletion>;
}

/**
 * The four variables that must be present together for the Azure path.
 *
 * Named as a list so the "all or nothing" check below cannot drift from the
 * error message the operator reads.
 */
const AZURE_ENV_KEYS = [
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_ENDPOINT",
  "AZURE_OPENAI_DEPLOYMENT",
  "OPENAI_API_VERSION",
] as const;

function present(
  env: Readonly<Record<string, string | undefined>>,
  key: string,
): string | null {
  const raw = env[key];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

function azureUrl(
  endpoint: string,
  deployment: string,
  apiVersion: string,
): string {
  const url = new URL(endpoint);
  const prefix = url.pathname.replace(/\/+$/, "");
  url.pathname =
    `${prefix}/openai/deployments/` +
    `${encodeURIComponent(deployment)}/chat/completions`;
  url.searchParams.set("api-version", apiVersion);
  return url.toString();
}

/**
 * Derive provider options from the environment, Azure first.
 *
 * Mirrors `resolveLlmClientConfig` in the worker, including the detail that is
 * easy to get backwards: on the Azure path the `model` field carries the
 * DEPLOYMENT name, and `OPENAI_MODEL` is only read on the direct path. A
 * partially configured Azure set throws instead of falling through, because
 * silently switching a data-residency-constrained deployment over to public
 * OpenAI is worse than being down.
 */
/**
 * Read a temperature the deployment pins, or null to leave it to the task.
 *
 * An unparseable or out-of-range value resolves to null rather than being
 * sent: a typo in a dashboard should fall back to the task's own choice, not
 * hand the provider a value it will reject.
 */
function pinnedTemperature(
  env: Readonly<Record<string, string | undefined>>,
  key: string,
): number | null {
  const raw = present(env, key);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 2 ? value : null;
}

export function resolveKeywordLlmConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): KeywordLlmConfig {
  // The marketing deployment's own convention comes first. Every tool here
  // carries its own prefixed set — `QUICK_WINS_DRAFT_*` is the sibling — so
  // that one tool can be pointed at a different model, or switched off, without
  // touching the other. The unprefixed Azure and OpenAI names below stay for
  // local development and for parity with the worker, but nothing on the
  // marketing project sets them, so without this branch production resolves to
  // "not configured" no matter how the Azure resource is provisioned.
  const scoped = present(env, "KEYWORD_MAP_API_KEY");
  const scopedModel = present(env, "KEYWORD_MAP_MODEL");
  if (scoped !== null && scopedModel !== null) {
    return {
      apiKey: scoped,
      model: scopedModel,
      url: present(env, "KEYWORD_MAP_URL") ?? OPENAI_CHAT_COMPLETIONS_URL,
      authScheme:
        present(env, "KEYWORD_MAP_AUTH_SCHEME")?.toLowerCase() === "api-key"
          ? "api-key"
          : "bearer",
      temperature: pinnedTemperature(env, "KEYWORD_MAP_TEMPERATURE"),
    };
  }

  const azure = AZURE_ENV_KEYS.map((key) => present(env, key));
  const configuredAzure = azure.filter((value) => value !== null).length;
  const [azureKey, azureEndpoint, azureDeployment, azureApiVersion] = azure;

  if (
    azureKey !== null &&
    azureEndpoint !== null &&
    azureDeployment !== null &&
    azureApiVersion !== null
  ) {
    let url: string;
    try {
      url = azureUrl(azureEndpoint, azureDeployment, azureApiVersion);
    } catch {
      throw new KeywordLlmError(
        "not_configured",
        "AZURE_OPENAI_ENDPOINT is not a valid URL.",
      );
    }
    return {
      apiKey: azureKey,
      model: azureDeployment,
      url,
      authScheme: "api-key",
      temperature: pinnedTemperature(env, "OPENAI_TEMPERATURE"),
    };
  }

  if (configuredAzure > 0) {
    throw new KeywordLlmError(
      "not_configured",
      `Azure OpenAI config is partial: set all of ${AZURE_ENV_KEYS.join(
        ", ",
      )}, or none.`,
    );
  }

  const apiKey = present(env, "OPENAI_API_KEY");
  const model = present(env, "OPENAI_MODEL");
  if (apiKey === null || model === null) {
    throw new KeywordLlmError(
      "not_configured",
      "LLM config required: set OPENAI_API_KEY + OPENAI_MODEL, or the Azure set.",
    );
  }
  return {
    apiKey,
    model,
    url: OPENAI_CHAT_COMPLETIONS_URL,
    authScheme: "bearer",
    temperature: pinnedTemperature(env, "OPENAI_TEMPERATURE"),
  };
}

function mapHttpStatus(status: number): KeywordLlmFailureReason {
  if (status === 401 || status === 403) return "auth_failed";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "bad_request";
}

function cancelBody(body: ReadableStream<Uint8Array> | null): void {
  if (body === null) return;
  try {
    void Promise.resolve(body.cancel()).catch(() => undefined);
  } catch {
    // Best effort only: cancellation must never replace the stable error.
  }
}

function declaredBytes(response: Response): number | null {
  const raw = response.headers.get("content-length");
  if (raw === null || !/^\d+$/.test(raw.trim())) return null;
  return Number(raw.trim());
}

/**
 * Read the decoded body incrementally, refusing anything over the ceiling.
 *
 * `Content-Length` is only an early-exit hint — it can describe compressed or
 * simply dishonest bytes — so the streamed bytes are counted independently
 * before anything is concatenated or parsed.
 */
async function readBoundedJson(
  response: Response,
  aborted: () => boolean,
): Promise<unknown> {
  const declared = declaredBytes(response);
  if (declared !== null && declared > MAX_KEYWORD_LLM_RESPONSE_BODY_BYTES) {
    cancelBody(response.body);
    throw new KeywordLlmError(
      "invalid_response",
      "LLM response body exceeded the size ceiling.",
    );
  }

  const body = response.body;
  if (body === null) {
    throw new KeywordLlmError("invalid_response", "LLM response had no body.");
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = next.value;
      total += chunk.byteLength;
      if (total > MAX_KEYWORD_LLM_RESPONSE_BODY_BYTES) {
        void Promise.resolve(reader.cancel()).catch(() => undefined);
        throw new KeywordLlmError(
          "invalid_response",
          "LLM response body exceeded the size ceiling.",
        );
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof KeywordLlmError) throw error;
    throw new KeywordLlmError(
      aborted() ? "timeout" : "invalid_response",
      "LLM response body could not be read.",
    );
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // An errored stream may keep its lock; no body data is exposed either way.
    }
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new KeywordLlmError(
      "invalid_response",
      "LLM response body was not JSON.",
    );
  }
}

function readContent(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first: unknown = choices[0];
  if (typeof first !== "object" || first === null) return null;
  const message = (first as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) return null;
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" && content !== "" ? content : null;
}

function readUsage(data: unknown): KeywordLlmUsage {
  const base = { requestCount: 1, retryCount: 0 };
  if (typeof data !== "object" || data === null) {
    return { ...EMPTY_KEYWORD_LLM_USAGE, ...base };
  }
  const usage = (data as { usage?: unknown }).usage;
  if (typeof usage !== "object" || usage === null) {
    return { ...EMPTY_KEYWORD_LLM_USAGE, ...base };
  }
  const record = usage as Record<string, unknown>;
  const input = record["prompt_tokens"];
  const output = record["completion_tokens"];
  return {
    inputTokens: typeof input === "number" ? input : null,
    outputTokens: typeof output === "number" ? output : null,
    ...base,
  };
}

const MAX_KEYWORD_LLM_MODEL_ID_CHARS = 200;
const SAFE_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u;

/** Keep model provenance without retaining arbitrary provider response text. */
function safeModelId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 &&
    trimmed.length <= MAX_KEYWORD_LLM_MODEL_ID_CHARS &&
    SAFE_MODEL_ID.test(trimmed)
    ? trimmed
    : null;
}

function readModelId(data: unknown, configuredModel: string): string | null {
  const responseModel =
    typeof data === "object" && data !== null
      ? (data as Record<string, unknown>)["model"]
      : undefined;
  return safeModelId(responseModel) ?? safeModelId(configuredModel);
}

export interface KeywordLlmClientOptions {
  /** Offline test seam. Skips the env read entirely. */
  readonly config?: KeywordLlmConfig;
  /** Offline test seam. Defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Offline test seam. Defaults to the global `fetch`. */
  readonly fetchImpl?: KeywordLlmFetch;
  /** Positive safe-integer fallback seam; requests may override it per task. */
  readonly timeoutMs?: number;
}

class ChatCompletionsClient implements KeywordLlmClient {
  private readonly options: KeywordLlmClientOptions;
  private config: KeywordLlmConfig | null;

  constructor(options: KeywordLlmClientOptions) {
    this.options = options;
    this.config = options.config ?? null;
  }

  /**
   * Resolved on first use, not in the constructor.
   *
   * A route module builds its dependency object at import time. Throwing there
   * takes down every endpoint in the file — including the ones that do not use
   * a model — instead of producing one honest
   * `keyword_generation_unavailable` for the request that actually needed it.
   */
  private resolveConfig(): KeywordLlmConfig {
    if (this.config === null) {
      this.config = resolveKeywordLlmConfig(this.options.env ?? process.env);
    }
    return this.config;
  }

  async complete(request: KeywordLlmRequest): Promise<KeywordLlmCompletion> {
    const timeoutMs = resolveKeywordLlmTimeoutMs(
      request.timeoutMs,
      this.options.timeoutMs,
    );
    const config = this.resolveConfig();
    const fetchImpl = this.options.fetchImpl ?? globalThis.fetch;

    const body = JSON.stringify({
      model: config.model,
      // A deployment that pins its temperature overrides the task's choice.
      // The task-tuned values are the right default, but a deployment that
      // accepts exactly one value refuses the whole request otherwise, and a
      // 400 from the provider reads like a model outage rather than a config
      // mismatch.
      temperature: config.temperature ?? request.temperature,
      // `max_tokens` is rejected by the current reasoning-capable models and
      // by recent Azure api-versions; `max_completion_tokens` is the field
      // both accept, and an output ceiling is not optional here — it is the
      // cost bound on a call whose length a third-party page can influence.
      max_completion_tokens: request.maxOutputTokens,
      // JSON mode is load-bearing, not a convenience: it removes the "model
      // wrote prose around the object" failure that would otherwise tempt a
      // free-text salvage path, and a salvage path is exactly how injected
      // page text gets read as output.
      response_format: responseFormat(request),
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.user },
      ],
    });

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      let response: Response;
      try {
        response = await fetchImpl(config.url, {
          method: "POST",
          headers: {
            ...(config.authScheme === "api-key"
              ? { "api-key": config.apiKey }
              : { Authorization: `Bearer ${config.apiKey}` }),
            "Content-Type": "application/json",
          },
          body,
          // A redirect would re-send the API key to whatever host the response
          // named. There is no legitimate redirect on this endpoint.
          redirect: "error",
          signal: controller.signal,
        });
      } catch {
        throw new KeywordLlmError(
          timedOut ? "timeout" : "network_error",
          "LLM request did not reach the provider.",
        );
      }

      if (timedOut) {
        cancelBody(response.body);
        throw new KeywordLlmError("timeout", "LLM request timed out.");
      }

      if (!response.ok) {
        cancelBody(response.body);
        throw new KeywordLlmError(
          mapHttpStatus(response.status),
          `LLM request failed with HTTP ${response.status}.`,
        );
      }

      const data = await readBoundedJson(response, () => timedOut);
      const content = readContent(data);
      if (content === null) {
        throw new KeywordLlmError(
          "invalid_response",
          "LLM response carried no message content.",
          readUsage(data),
        );
      }
      return {
        content,
        usage: readUsage(data),
        modelId: readModelId(data, config.model),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Factory used by the route wiring and by tests. */
export function createKeywordLlmClient(
  options: KeywordLlmClientOptions = {},
): KeywordLlmClient {
  return new ChatCompletionsClient(options);
}
