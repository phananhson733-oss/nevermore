// @input  -- the /api/tools/seo-audit Response, streamed NDJSON or one buffered object
// @output -- shape-dispatched progress / result / error events
// @pos    -- the only reader of the public SEO Audit wire format
// Once this file is updated, update the header comment.

import type { SeoAuditPayload } from "@sf/public-tools";

/**
 * The wire grammar: one JSON value per `\n`, four disjoint top-level keys.
 * Dispatch is by shape, never by status code, so the same reader handles the
 * streamed branch, the buffered branch, and every gate refusal.
 */
export type SeoAuditStreamEvent =
  | {
      readonly kind: "progress";
      /** The crawl engine's collected-page count, not a request count. */
      readonly pagesCrawled: number;
      readonly requestsSent: number;
    }
  /** The crawl has stopped and the run has moved on to something else. */
  | { readonly kind: "stage"; readonly stage: "building_report" }
  | { readonly kind: "result"; readonly payload: SeoAuditPayload }
  | { readonly kind: "error"; readonly code: string };

/**
 * Stage names this client has copy for. An unknown one is dropped rather than
 * passed on: the panel would have nothing honest to say about it.
 */
const KNOWN_STAGES = new Set(["building_report"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function eventOf(segment: string): SeoAuditStreamEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(segment);
  } catch {
    // A malformed segment is one unreadable observation, not a failed run.
    return null;
  }
  const record = asRecord(parsed);
  if (!record) return null;

  const progress = asRecord(record.progress);
  if (
    progress &&
    typeof progress.pagesCrawled === "number" &&
    typeof progress.requestsSent === "number"
  ) {
    return {
      kind: "progress",
      pagesCrawled: progress.pagesCrawled,
      requestsSent: progress.requestsSent,
    };
  }
  if (typeof record.stage === "string" && KNOWN_STAGES.has(record.stage)) {
    return { kind: "stage", stage: "building_report" };
  }
  const data = asRecord(record.data);
  // The caller renders `payload.result`. A `data` object without one used to be
  // accepted as the answer, which set an undefined report and announced the run
  // complete, leaving the reader with no report and no error.
  if (data && asRecord(data.result)) {
    return { kind: "result", payload: data as unknown as SeoAuditPayload };
  }
  const error = asRecord(record.error);
  if (error) {
    return {
      kind: "error",
      code: typeof error.code === "string" ? error.code : "unknown",
    };
  }
  return null;
}

function isTerminal(event: SeoAuditStreamEvent): boolean {
  return event.kind === "result" || event.kind === "error";
}

/**
 * Read one response to completion, emitting every event it carries.
 *
 * Always emits exactly one terminal event. A stream that ends without one is
 * an answer we never received, and is reported as `unknown` — the same code
 * the buffered client produced when a body could not be parsed.
 */
export async function readSeoAuditStream(
  response: Response,
  onEvent: (event: SeoAuditStreamEvent) => void,
): Promise<void> {
  let terminated = false;
  const emit = (event: SeoAuditStreamEvent): void => {
    if (terminated) return;
    if (isTerminal(event)) terminated = true;
    onEvent(event);
  };

  const flush = (segment: string): void => {
    const trimmed = segment.trim();
    if (trimmed.length === 0) return;
    const event = eventOf(trimmed);
    if (event) emit(event);
  };

  try {
    const body = response.body;
    if (!body) {
      flush(await response.text());
    } else {
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (!terminated) {
          const next = await reader.read();
          if (next.done) break;
          buffer += decoder.decode(next.value, { stream: true });
          let newline = buffer.indexOf("\n");
          while (newline >= 0) {
            flush(buffer.slice(0, newline));
            buffer = buffer.slice(newline + 1);
            if (terminated) break;
            newline = buffer.indexOf("\n");
          }
        }
        // A body that never ends in a newline — every buffered JSON response,
        // including the three Playwright fixtures — lives entirely here.
        if (!terminated) flush(buffer + decoder.decode());
      } finally {
        try {
          await reader.cancel();
        } catch {
          // Cancellation is best effort; the answer is already delivered.
        }
      }
    }
  } catch {
    // Fall through to the unknown terminal below: a read that failed is not a
    // result, and must not be rendered as one.
  }

  if (!terminated) onEvent({ kind: "error", code: "unknown" });
}
