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

import { codePointLength } from "./geo-canonical.ts";
import { normalizeGeoCitationUrl } from "./geo-url.ts";

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
 * One visible citation attached to the answer.
 *
 * A citation, and nothing more. These are the annotations the provider hangs on
 * the answer prose; they are not OpenAI's `sources` list, not a retrieval trace,
 * and not the text of the page they point at. `annotationText` in particular is
 * the anchor the answer itself carries — typically a markdown link — and calling
 * it a source-page excerpt would be inventing a fact the payload never had.
 */
export interface GeoProviderCitationAnnotation {
  readonly url: string;
  readonly title: string | null;
  /** Text attached to the answer annotation, not a source-page excerpt. */
  readonly annotationText: string | null;
  /** Raw provider output-item index, not an ordinal among message items. */
  readonly providerOutputItemIndex: number;
  readonly sectionIndex: number;
  /** Position of this annotation within its section's annotation array. */
  readonly annotationOrdinal: number;
  readonly startIndex: number | null;
  readonly endIndex: number | null;
  readonly spanBasis: "provider_message_section_text";
}

/** Most citations one sample may carry; calibration saw one answer cite 14. */
export const GEO_MAX_CITATIONS_PER_SAMPLE = 40;

/** Longest annotation values kept verbatim; longer ones are dropped, never cut. */
export const GEO_MAX_ANNOTATION_TITLE_CODE_POINTS = 200;
export const GEO_MAX_ANNOTATION_TEXT_CODE_POINTS = 240;

/**
 * One observed answer.
 *
 * `answerText` is the message prose only. It exists so the caller can decide
 * whether the brand was named, and is never persisted into the report — the
 * report keeps bounded evidence, not a third party's text.
 *
 * `citationsComplete` is the honest half of the citation list. Extraction is
 * all-or-nothing per sample: if the annotation collection could not be safely
 * enumerated, a partial list would let the report say "cited nobody" or "cited
 * only others" about an answer whose citations it failed to read. The flag lets
 * the sampler record `unavailable` instead of a confident wrong answer.
 */
export interface GeoProviderObservation {
  readonly observedAt: string;
  readonly webSearchPerformed: boolean;
  readonly answerText: string;
  readonly citations: readonly GeoProviderCitationAnnotation[];
  readonly citationsComplete: boolean;
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

/** Keep a verbatim value, or nothing. Never a shortened version of it. */
function boundedVerbatim(value: unknown, limit: number): string | null {
  if (typeof value !== "string") return null;
  // Dropped rather than truncated. The report says these strings are exactly
  // what the provider attached to the answer, and a silently shortened one
  // would make that sentence false for the record that carries it.
  return value.length > 0 && codePointLength(value) <= limit ? value : null;
}

/**
 * Read the annotation's answer span, or decide it does not have a usable one.
 *
 * Zero-based, end-exclusive UTF-16 offsets into this section's own text — the
 * provider numbers them per section, not into the newline-joined answer, which
 * is why the section location travels with every citation. An out-of-range or
 * reversed pair makes both ends null rather than being clamped: a repaired span
 * points somewhere the provider never pointed.
 */
function readSpan(
  annotation: Readonly<Record<string, unknown>>,
  sectionTextLength: number,
): { readonly startIndex: number | null; readonly endIndex: number | null } {
  const start = annotation.start_index;
  const end = annotation.end_index;
  if (
    Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    (start as number) >= 0 &&
    (start as number) <= (end as number) &&
    (end as number) <= sectionTextLength
  ) {
    return { startIndex: start as number, endIndex: end as number };
  }
  return { startIndex: null, endIndex: null };
}

interface CitationExtraction {
  readonly citations: readonly GeoProviderCitationAnnotation[];
  readonly complete: boolean;
}

/**
 * Collect citation annotations from a result, and say whether the list is whole.
 *
 * An annotation counts when it has no `type` key at all or when that key is
 * `url_citation`. Every annotation the provider actually returned in
 * calibration was of the first kind — `{title, url, start_index, end_index,
 * text}` with no `type` — so a parser that requires `type === "url_citation"`
 * silently finds nothing. Restricted to `message` items, because the sibling
 * `reasoning` items are the model's scratchpad: a source it merely considered
 * is not a source it cited.
 *
 * Two failure modes are deliberately different. A bare `{url}` with no title and
 * no anchor text is a shape the provider has never emitted, and it is REJECTED
 * without making the list incomplete — otherwise an injected object could push
 * every sample to `unavailable`. Anything the parser cannot read at all — a
 * non-array annotation collection, an annotation that is not an object, a
 * citation-shaped entry whose URL will not normalize — makes the list
 * INCOMPLETE, because the alternative is reporting "cited nobody" about an
 * answer whose citations were unreadable.
 */
function readCitations(items: readonly unknown[]): CitationExtraction {
  const citations: GeoProviderCitationAnnotation[] = [];
  const seen = new Set<string>();
  let complete = true;

  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const item = items[itemIndex];
    if (!isObject(item) || item.type !== "message") continue;
    const sections = item.sections;
    if (!Array.isArray(sections)) {
      complete = false;
      continue;
    }

    for (
      let sectionIndex = 0;
      sectionIndex < sections.length;
      sectionIndex += 1
    ) {
      const section = sections[sectionIndex];
      if (!isObject(section)) {
        complete = false;
        continue;
      }
      const annotations = section.annotations;
      if (annotations === undefined || annotations === null) continue;
      if (!Array.isArray(annotations)) {
        complete = false;
        continue;
      }
      const sectionTextLength =
        typeof section.text === "string" ? section.text.length : 0;

      for (let ordinal = 0; ordinal < annotations.length; ordinal += 1) {
        const annotation = annotations[ordinal];
        if (!isObject(annotation)) {
          complete = false;
          continue;
        }
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
        const looksLikeCitation =
          typeof annotation.title === "string" ||
          typeof annotation.text === "string";
        if (!looksLikeCitation) continue;

        const url = normalizeGeoCitationUrl(annotation.url);
        if (url === null) {
          complete = false;
          continue;
        }
        if (citations.length >= GEO_MAX_CITATIONS_PER_SAMPLE) {
          complete = false;
          continue;
        }

        const span = readSpan(annotation, sectionTextLength);
        // Never host alone, and never URL alone: the same page cited at two
        // places in one answer is two observations, and two same-URL
        // annotations with no span in one section are still two annotations —
        // which is why the ordinal joins the key exactly when the span is null.
        const key = [
          url,
          itemIndex,
          sectionIndex,
          span.startIndex ?? `o${ordinal}`,
          span.endIndex ?? "",
        ].join("|");
        if (seen.has(key)) continue;
        seen.add(key);

        citations.push({
          url,
          title: boundedVerbatim(
            annotation.title,
            GEO_MAX_ANNOTATION_TITLE_CODE_POINTS,
          ),
          annotationText: boundedVerbatim(
            annotation.text,
            GEO_MAX_ANNOTATION_TEXT_CODE_POINTS,
          ),
          providerOutputItemIndex: itemIndex,
          sectionIndex,
          annotationOrdinal: ordinal,
          ...span,
          spanBasis: "provider_message_section_text",
        });
      }
    }
  }

  return { citations, complete };
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

    // Coercing a missing flag to `false` would manufacture "did not search" out
    // of "could not tell", and that fabricated observation would then be
    // reported as an instrumentation failure or, on a natural-demand question,
    // as a fact about the answer. Fail closed instead: the sample becomes an
    // honest no-usable-answer.
    if (typeof result.web_search !== "boolean") {
      throw new GeoProviderError(
        "invalid_response",
        "The provider result did not say whether a web search ran.",
        cost,
      );
    }

    const extraction = readCitations(items);
    return {
      observedAt,
      webSearchPerformed: result.web_search,
      answerText,
      citations: extraction.citations,
      citationsComplete: extraction.complete,
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
