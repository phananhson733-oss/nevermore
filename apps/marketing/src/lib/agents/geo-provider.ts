// @input  -- DATAFORSEO_* env, an injected fetch, one buyer question
// @output -- one bounded ChatGPT answer with its citations, or a typed failure
// @pos    -- the GEO Agent's only provider transport; the sole place answer prose is read

/**
 * Why this exists next to `@sf/sources`' DataForSEO client rather than calling it.
 *
 * That client's `aiCitation()` reaches the same endpoint, but its response type
 * says "provider answer prose is intentionally absent" and it returns only
 * `sourceUrls`. The GEO report has to tell "the answer named this brand but
 * cited somebody else" apart from "the answer ignored it", and that distinction
 * lives entirely in the prose. Extending the shared client would push answer
 * text into the product's worker pipeline, which deliberately does not want it,
 * so the transport safeguards are restated here instead — the same shape
 * `keyword-llm-client.ts` uses for the same reason.
 */

/** Minimal `fetch` shape so a test can inject a fixture without touching DOM types. */
export type GeoProviderFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export const DATAFORSEO_CHAT_GPT_LLM_RESPONSES_LIVE_URL =
  "https://api.dataforseo.com/v3/ai_optimization/chat_gpt/llm_responses/live";

/**
 * Output ceiling for one answer, in tokens.
 *
 * 4096 — the provider's maximum — rather than the 1024 the product's worker
 * pins. This is not a preference. Calibration on 2026-08-17 ran eight questions
 * at 1024 and three of them came back with `output_tokens` exactly equal to
 * `reasoning_tokens`: the model's private reasoning consumed the entire budget,
 * no `message` item was emitted, and the call still billed $0.04. At 4096 the
 * same questions returned an answer every time. A ceiling that silently buys
 * nothing 37% of the time is a defect, and the extra tokens cost about $0.014
 * per call — far less than a third of the calls being wasted.
 */
export const GEO_MAX_OUTPUT_TOKENS = 4_096;

/** Provider ceiling on one prompt; a longer one is a paid round trip that fails. */
export const GEO_MAX_PROMPT_LENGTH = 500;

/** Decoded response ceiling. Generous for one answer, far below a memory risk. */
const MAX_RESPONSE_BODY_BYTES = 4_000_000;

const PROVIDER_SUCCESS_STATUS = 20_000;
const PROVIDER_EMPTY_RESULT_STATUS = 20_100;

/**
 * Why one sample failed, for logs only.
 *
 * Never carries provider response text: a failure message that quotes the body
 * is how a third party's prose reaches a log line.
 */
export type GeoProviderFailureReason =
  | "not_configured"
  | "network_error"
  | "timeout"
  | "auth_failed"
  | "rate_limited"
  | "server_error"
  | "bad_request"
  | "invalid_response";

export class GeoProviderError extends Error {
  readonly reason: GeoProviderFailureReason;
  /**
   * Billed even on some failures, so the caller still has to book it.
   *
   * Null when the provider gave no price — distinct from a genuine zero, which
   * would understate the run instead of flagging it as unpriced.
   */
  readonly costUsd: number | null;

  constructor(
    reason: GeoProviderFailureReason,
    message: string,
    costUsd: number | null = null,
  ) {
    super(message);
    this.name = "GeoProviderError";
    this.reason = reason;
    this.costUsd = costUsd;
  }
}

/**
 * One observed answer.
 *
 * `answerText` is the message prose only. It exists so the caller can decide
 * whether the brand was named, and is never persisted into the report — the
 * report keeps hosts, counts and a bounded excerpt, not a third party's text.
 */
export interface GeoProviderObservation {
  readonly observedAt: string;
  readonly webSearchPerformed: boolean;
  readonly answerText: string;
  readonly citedUrls: readonly string[];
  readonly costUsd: number | null;
  readonly model: string;
}

export interface GeoProviderRequest {
  readonly prompt: string;
  readonly model: string;
  readonly marketCode: string;
}

export interface GeoProviderClient {
  observe(
    request: GeoProviderRequest,
    signal?: AbortSignal,
  ): Promise<GeoProviderObservation>;
}

export interface GeoProviderClientOptions {
  readonly login?: string;
  readonly password?: string;
  /** Offline test seam. Defaults to the global `fetch`. */
  readonly fetchImpl?: GeoProviderFetch;
  readonly timeoutMs?: number;
}

/**
 * Per-call deadline.
 *
 * Calibration tails ran to 44s at the 4096 ceiling, so 90s is roughly twice the
 * slowest observed answer: long enough that a normal slow call is not thrown
 * away after being paid for, short enough that three batches still fit inside
 * the route's own budget.
 */
export const GEO_PROVIDER_TIMEOUT_MS = 90_000;

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cancelBody(body: ReadableStream<Uint8Array> | null): void {
  if (body === null) return;
  try {
    void Promise.resolve(body.cancel()).catch(() => undefined);
  } catch {
    // Best effort only: cancellation must never replace the stable error.
  }
}

function mapHttpStatus(status: number): GeoProviderFailureReason {
  if (status === 401 || status === 403) return "auth_failed";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "bad_request";
}

async function readBoundedJson(
  response: Response,
  aborted: () => boolean,
): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    /^\d+$/.test(declared.trim()) &&
    Number(declared.trim()) > MAX_RESPONSE_BODY_BYTES
  ) {
    cancelBody(response.body);
    throw new GeoProviderError(
      "invalid_response",
      "Provider response body exceeded the size ceiling.",
    );
  }

  const body = response.body;
  if (body === null) {
    throw new GeoProviderError(
      "invalid_response",
      "Provider response had no body.",
    );
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_RESPONSE_BODY_BYTES) {
        void Promise.resolve(reader.cancel()).catch(() => undefined);
        throw new GeoProviderError(
          "invalid_response",
          "Provider response body exceeded the size ceiling.",
        );
      }
      chunks.push(next.value);
    }
  } catch (error) {
    if (error instanceof GeoProviderError) throw error;
    throw new GeoProviderError(
      aborted() ? "timeout" : "invalid_response",
      "Provider response body could not be read.",
    );
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // An errored stream may keep its lock; no body data is exposed either way.
    }
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(merged));
  } catch {
    throw new GeoProviderError(
      "invalid_response",
      "Provider response was not valid JSON.",
    );
  }
}

/**
 * Convert the provider's timestamp to a canonical ISO instant.
 *
 * It answers `2026-08-17 09:21:39 +00:00`, which `Date.parse` reads
 * inconsistently across runtimes and which the report contract rejects
 * outright. Normalizing here means a shape change shows up as one failed
 * sample rather than as a report that cannot be stored.
 */
export function normalizeProviderTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match =
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?\s*([+-]\d{2}:?\d{2}|Z)?$/.exec(
      value.trim(),
    );
  if (match === null) return null;
  const [, date, time, rawZone] = match;
  const zone =
    rawZone === undefined || rawZone === "Z"
      ? "Z"
      : rawZone.includes(":")
        ? rawZone
        : `${rawZone.slice(0, 3)}:${rawZone.slice(3)}`;
  const parsed = Date.parse(`${date}T${time}${zone}`);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/**
 * Collect the answer prose from a result.
 *
 * Only items typed `message` carry the answer. The sibling `reasoning` items
 * are the model's own scratchpad; reading them as the answer would let a brand
 * name the model merely considered count as a brand it actually mentioned,
 * which is precisely the claim this text is used to make.
 */
function readAnswerText(items: readonly unknown[]): string {
  const parts: string[] = [];
  for (const item of items) {
    if (!isObject(item) || item.type !== "message") continue;
    const sections = item.sections;
    if (!Array.isArray(sections)) continue;
    for (const section of sections) {
      if (isObject(section) && typeof section.text === "string") {
        parts.push(section.text);
      }
    }
  }
  return parts.join("\n");
}

/**
 * Collect citation URLs from a result.
 *
 * An annotation counts when it has no `type` key at all or when that key is
 * `url_citation`. Every annotation the provider actually returned in
 * calibration was of the first kind — `{title, url, start_index, end_index,
 * text}` with no `type` — so a parser that requires `type === "url_citation"`
 * silently finds nothing. Restricted to `message` items for the same reason as
 * the prose above.
 */
function readCitationUrls(items: readonly unknown[]): readonly string[] {
  const urls = new Set<string>();
  for (const item of items) {
    if (!isObject(item) || item.type !== "message") continue;
    const sections = item.sections;
    if (!Array.isArray(sections)) continue;
    for (const section of sections) {
      if (!isObject(section)) continue;
      const annotations = section.annotations;
      if (!Array.isArray(annotations)) continue;
      for (const annotation of annotations) {
        if (!isObject(annotation)) continue;
        if (
          annotation.type !== undefined &&
          annotation.type !== "url_citation"
        ) {
          continue;
        }
        // A missing `type` is how every real citation arrives, so it cannot be
        // rejected — but on its own it is not evidence either. Every observed
        // annotation also carried the anchor text and title of the passage it
        // cites; requiring one of those keeps a bare `{url}` object, which the
        // provider has never emitted, from being counted as a citation the
        // answer never made.
        if (
          typeof annotation.title !== "string" &&
          typeof annotation.text !== "string"
        ) {
          continue;
        }
        const url = annotation.url;
        if (typeof url !== "string") continue;
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          continue;
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          continue;
        }
        urls.add(parsed.href);
      }
    }
  }
  return [...urls];
}

/**
 * The provider's price for one call, or null when it did not give one.
 *
 * Null rather than 0. A call whose price is unknown was still billed, and
 * reporting it as zero is the house's oldest red line — an unavailable number
 * is null, never a zero that reads as "measured, and it was free". The
 * accumulator counts a null as an unpriced call so the gap stays visible
 * instead of quietly understating the run.
 */
function readCost(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

class HttpGeoProviderClient implements GeoProviderClient {
  constructor(private readonly options: GeoProviderClientOptions) {}

  private authorization(): string {
    const login = this.options.login ?? process.env["DATAFORSEO_LOGIN"] ?? "";
    const password =
      this.options.password ?? process.env["DATAFORSEO_PASSWORD"] ?? "";
    if (login === "" || password === "") {
      throw new GeoProviderError(
        "not_configured",
        "DataForSEO credentials are not configured.",
      );
    }
    return `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`;
  }

  async observe(
    request: GeoProviderRequest,
    signal?: AbortSignal,
  ): Promise<GeoProviderObservation> {
    if (
      request.prompt.trim() !== request.prompt ||
      request.prompt.length === 0 ||
      request.prompt.length > GEO_MAX_PROMPT_LENGTH
    ) {
      throw new GeoProviderError(
        "bad_request",
        "The question is empty or longer than the provider accepts.",
      );
    }
    if (!/^[A-Z]{2}$/.test(request.marketCode)) {
      throw new GeoProviderError("bad_request", "The market code is invalid.");
    }

    const authorization = this.authorization();
    const fetchImpl = this.options.fetchImpl ?? globalThis.fetch;
    const timeoutMs = this.options.timeoutMs ?? GEO_PROVIDER_TIMEOUT_MS;

    const body = JSON.stringify([
      {
        user_prompt: request.prompt,
        model_name: request.model,
        max_output_tokens: GEO_MAX_OUTPUT_TOKENS,
        // Not a parameter. An answer written without searching says nothing
        // about who gets cited when the model does search, so a run that let
        // this vary would be averaging two different questions.
        web_search: true,
        web_search_country_iso_code: request.marketCode,
      },
    ]);

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = (): void => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      let response: Response;
      try {
        response = await fetchImpl(DATAFORSEO_CHAT_GPT_LLM_RESPONSES_LIVE_URL, {
          method: "POST",
          headers: {
            Authorization: authorization,
            "Content-Type": "application/json",
          },
          body,
          // A redirect would re-send the credentials to whatever host the
          // response named. This endpoint has no legitimate redirect.
          redirect: "error",
          signal: controller.signal,
        });
      } catch {
        throw new GeoProviderError(
          timedOut ? "timeout" : "network_error",
          "The provider request did not complete.",
        );
      }

      if (timedOut) {
        cancelBody(response.body);
        throw new GeoProviderError(
          "timeout",
          "The provider request timed out.",
        );
      }
      if (!response.ok) {
        cancelBody(response.body);
        throw new GeoProviderError(
          mapHttpStatus(response.status),
          `The provider request failed with HTTP ${response.status}.`,
        );
      }

      return this.parse(await readBoundedJson(response, () => timedOut));
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  private parse(payload: unknown): GeoProviderObservation {
    if (!isObject(payload)) {
      throw new GeoProviderError(
        "invalid_response",
        "The provider response was not an object.",
      );
    }
    const envelopeCost = readCost(payload.cost);
    const tasks = payload.tasks;
    if (!Array.isArray(tasks) || tasks.length !== 1 || !isObject(tasks[0])) {
      throw new GeoProviderError(
        "invalid_response",
        "The provider response did not contain exactly one task.",
        envelopeCost,
      );
    }

    const task = tasks[0];
    const cost = readCost(task.cost) ?? envelopeCost;
    const taskStatus = task.status_code;
    if (taskStatus === PROVIDER_EMPTY_RESULT_STATUS) {
      throw new GeoProviderError(
        "invalid_response",
        "The provider returned no result for this question.",
        cost,
      );
    }
    if (taskStatus !== PROVIDER_SUCCESS_STATUS) {
      throw new GeoProviderError(
        typeof taskStatus === "number" && taskStatus >= 40_000
          ? "bad_request"
          : "server_error",
        `The provider task failed with status ${String(taskStatus)}.`,
        cost,
      );
    }

    const results = task.result;
    if (
      !Array.isArray(results) ||
      results.length !== 1 ||
      !isObject(results[0])
    ) {
      throw new GeoProviderError(
        "invalid_response",
        "The provider task did not contain exactly one result.",
        cost,
      );
    }

    const result = results[0];
    const observedAt = normalizeProviderTimestamp(result.datetime);
    if (observedAt === null) {
      throw new GeoProviderError(
        "invalid_response",
        "The provider result carried no usable observation time.",
        cost,
      );
    }
    const items = Array.isArray(result.items) ? result.items : [];
    const answerText = readAnswerText(items);
    if (answerText.trim() === "") {
      // Distinct from a transport failure: the call succeeded and billed, the
      // model simply spent its whole output budget on reasoning. Reported as a
      // failure rather than as an empty answer because an answer that does not
      // exist is not evidence that nobody was cited.
      throw new GeoProviderError(
        "invalid_response",
        "The provider returned no answer text for this question.",
        cost,
      );
    }

    return {
      observedAt,
      webSearchPerformed: result.web_search === true,
      answerText,
      citedUrls: readCitationUrls(items),
      costUsd: cost,
      model:
        typeof result.model_name === "string" && result.model_name !== ""
          ? result.model_name
          : "unknown",
    };
  }
}

export function createGeoProviderClient(
  options: GeoProviderClientOptions = {},
): GeoProviderClient {
  return new HttpGeoProviderClient(options);
}
