// @input  -- the granted property and the deployment's model configuration
// @output -- crawl and model seams for Title/Meta drafts, or null when drafts are off
// @pos    -- the only place drafts touch the network
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type {
  DraftCompletion,
  DraftRunDependencies,
  PageMeta,
} from "@sf/public-tools";
import { parsePage } from "@sf/sources";
// The switch itself lives in a module with no imports, so the landing page can
// ask "are drafts on" without pulling the crawler in behind it.
import {
  draftModelFromEnv,
  type DraftModelConfig,
} from "./quick-wins-draft-config.ts";

export { draftModelFromEnv, type DraftModelConfig };

/**
 * Per-call deadline.
 *
 * The calls run concurrently (see `runDrafts`), so this is the drafts' whole
 * share of the wall clock rather than one slice of a sequence. Measured on the
 * deployment this points at, a draft takes 4.5-11 seconds depending on how
 * much the model reasons; 30 seconds leaves room for the tail without putting
 * the route's 60-second budget at risk.
 */
const MODEL_TIMEOUT_MS = 30_000;

/** Per-page fetch deadline. Drafts must never be the reason a run times out. */
const PAGE_FETCH_TIMEOUT_MS = 6_000;
/** A page whose head we cannot read in this much HTML is not worth more. */
const MAX_PAGE_BYTES = 512 * 1024;

/**
 * Ceiling on one reply.
 *
 * Set from measurement against the real deployment, using a prompt built from
 * live pages rather than a short synthetic one. Reasoning dominates and it is
 * not stable: over repeated runs of the same prompt it ranged from 280 to over
 * 1200 tokens, with the visible draft always under 80 of them.
 *
 * That range is why the two earlier values were both wrong. At 400, five of
 * six replies hit the ceiling and came back with `finish_reason: "length"` and
 * an EMPTY string for content — which `JSON.parse` rejects, so the surface
 * reported "the draft came back in a format we cannot use". That was the live
 * bug. At 1200 it was one in six, which is better and still not right. At 4000
 * the same prompt completed eight times out of eight, so 3000 sits above the
 * observed tail with room and still bounds a runaway reply.
 *
 * The cap is not a cost lever. A draft that stops early is paid for in full
 * and then discarded, so a ceiling below what the work costs buys nothing.
 */
const MAX_COMPLETION_TOKENS = 3_000;

/** What one HTTP attempt produced, before any judgement about the content. */
interface CompletionAttempt {
  readonly ok: boolean;
  readonly status: number;
  readonly content: unknown;
  readonly finishReason: unknown;
}

async function attempt(
  prompt: string,
  config: DraftModelConfig,
  fetchImpl: typeof fetch,
  jsonMode: boolean,
  timeoutMs: number,
): Promise<CompletionAttempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(config.url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        // Both forms authenticate against Azure; see DraftAuthScheme for why
        // the switch is still here.
        ...(config.authScheme === "api-key"
          ? { "api-key": config.apiKey }
          : { authorization: `Bearer ${config.apiKey}` }),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: prompt }],
        // `max_completion_tokens`, not `max_tokens`: the older field is
        // refused by reasoning models, which is most of what this would be
        // pointed at now.
        max_completion_tokens: MAX_COMPLETION_TOKENS,
        // Omitted unless configured. A reasoning model refuses the whole
        // request over a temperature it did not want, so the safe default is
        // to let the endpoint use its own.
        ...(config.temperature === null
          ? {}
          : { temperature: config.temperature }),
        // The reason drafts came back "in a format we cannot use": asked for
        // JSON in prose alone, a chatty model wraps it in a sentence.
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
    });

    if (!response.ok) {
      // Drain the body so the connection is released. It is only useful for
      // logs this module does not keep.
      await response.text().catch(() => "");
      return {
        ok: false,
        status: response.status,
        content: undefined,
        finishReason: undefined,
      };
    }

    const body = (await response.json()) as {
      choices?: readonly {
        message?: { content?: unknown };
        finish_reason?: unknown;
      }[];
    };
    const choice = body.choices?.[0];
    return {
      ok: true,
      status: response.status,
      content: choice?.message?.content,
      finishReason: choice?.finish_reason,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One chat completion.
 *
 * Written here rather than pulled from `@sf/artifacts` so the marketing app
 * does not take a dependency on the product's LLM stack for a single call.
 * Throwing is the contract: `runDrafts` turns a throw into
 * `model_unavailable` for that row and leaves the evidence table alone.
 */
async function complete(
  prompt: string,
  config: DraftModelConfig,
  fetchImpl: typeof fetch,
  remainingMs: () => number,
): Promise<DraftCompletion> {
  // ONE deadline for the whole call, not one per attempt. The retry below
  // used to get its own full timeout, so a "per-call deadline" of 30 seconds
  // actually permitted 60 — more than the route's entire budget from a single
  // row. Clamped to what the request has left, because overrunning does not
  // cost a draft, it costs the finished evidence table the handler is holding.
  const deadlineAt = Date.now() + Math.min(MODEL_TIMEOUT_MS, remainingMs());
  const timeLeft = (): number => deadlineAt - Date.now();

  let result = await attempt(
    prompt,
    config,
    fetchImpl,
    config.jsonMode,
    timeLeft(),
  );

  // A 400 while asking for a JSON object is the one rejection worth a second
  // call: `response_format` is the only optional field in the request, and a
  // gateway that does not know it refuses everything. Dropping the field for
  // a deployment that never configured the switch costs one wasted call per
  // draft; not dropping it costs every draft.
  if (!result.ok && result.status === 400 && config.jsonMode) {
    // Only if there is time for it. Out of time, the 400 stands and the row
    // degrades on its own.
    if (timeLeft() <= 0) throw new Error("draft model responded 400");
    result = await attempt(prompt, config, fetchImpl, false, timeLeft());
  }

  if (!result.ok) {
    throw new Error(`draft model responded ${result.status}`);
  }

  // The model stopped because it ran out of budget rather than because it was
  // done. `runDrafts` reports that as its own reason instead of blaming the
  // formatting.
  const truncated = result.finishReason === "length";

  if (typeof result.content !== "string") {
    // A reasoning model can burn the whole budget before emitting any visible
    // text, and then the reply carries `finish_reason: "length"` with no
    // content at all. That is the truncation case in its purest form, so it
    // must not be thrown as "the model is unavailable" — the model answered,
    // we just did not pay for enough of it.
    if (truncated) return { text: "", truncated: true };
    throw new Error("draft model returned no message content");
  }

  return { text: result.content, truncated };
}

/**
 * The origins a draft crawl is allowed to touch, derived from the property.
 *
 * `sc-domain:example.com` covers the bare host and its www form over https.
 * A URL-prefix property covers its own origin. Nothing else is fetchable:
 * the URLs come from Search Console rather than the visitor, but "came from
 * an API response" is not the same as "safe to fetch", and a draft crawl has
 * no business leaving the property it was authorized for.
 */
export function allowedDraftOrigins(property: string): readonly string[] {
  if (property.startsWith("sc-domain:")) {
    const host = property.slice("sc-domain:".length).trim().toLowerCase();
    if (host === "") return [];
    return [`https://${host}`, `https://www.${host}`];
  }
  try {
    const url = new URL(property);
    if (url.protocol !== "https:") return [];
    return [url.origin];
  } catch {
    return [];
  }
}

/** True when the URL is https and inside the authorized property. */
export function isDraftCrawlable(
  url: string,
  allowedOrigins: readonly string[],
): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    return allowedOrigins.includes(parsed.origin);
  } catch {
    return false;
  }
}

async function readPageMeta(
  url: string,
  allowedOrigins: readonly string[],
  fetchImpl: typeof fetch,
): Promise<PageMeta | null> {
  if (!isDraftCrawlable(url, allowedOrigins)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { accept: "text/html" },
    });
    if (!response.ok) return null;

    const type = response.headers.get("content-type") ?? "";
    if (!type.toLowerCase().includes("text/html")) return null;

    // Bounded read: the title and description live in the head, so a
    // half-megabyte prefix is generous and a page that streams forever
    // cannot hold the request open.
    const buffer = await response.arrayBuffer();
    const html = new TextDecoder().decode(buffer.slice(0, MAX_PAGE_BYTES));

    const parsed = parsePage(html, url);
    return {
      title: parsed.title,
      metaDescription: parsed.metaDescription,
    };
  } catch {
    // An unreadable page is a skipped row upstream, never a failed run.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build the draft seams for one request, or null when drafts are off.
 *
 * The crawl is scoped to the property the visitor granted, and the model call
 * carries no visitor data beyond the two pages' own titles and the query they
 * both rank for.
 */
/**
 * One model completion, with this deployment's retry, JSON-mode fallback and
 * token ceiling already applied.
 *
 * Narrower than `createDraftDependencies` because the second consumer — the
 * Agent audit's Stage 04 drafts — has a page in hand and needs no crawl seam.
 * What it does need is every lesson baked into `complete`: the ceiling
 * calibrated against the real deployment, the retry that drops `json_mode` for
 * gateways that reject the field, and the deadline. A second implementation
 * would relearn all three the expensive way.
 *
 * Returns null when this deployment has no model configured, which is the
 * signal to offer no drafts rather than to fail.
 */
export function createDraftCompletion(options: {
  readonly remainingMs: () => number;
  readonly fetchImpl?: typeof fetch;
  readonly model?: DraftModelConfig | null;
}): ((prompt: string) => Promise<DraftCompletion>) | null {
  const model =
    options.model === undefined ? draftModelFromEnv() : options.model;
  if (model === null) return null;
  const fetchImpl = options.fetchImpl ?? fetch;
  return (prompt: string) =>
    complete(prompt, model, fetchImpl, options.remainingMs);
}

export function createDraftDependencies(options: {
  readonly property: string;
  /**
   * Milliseconds left in the request, from the reader's one absolute deadline.
   *
   * The same clock the Search Console reads run against, so the drafts cannot
   * quietly spend budget those reads were counting on.
   */
  readonly remainingMs: () => number;
  readonly fetchImpl?: typeof fetch;
  readonly model?: DraftModelConfig | null;
}): DraftRunDependencies | null {
  const model =
    options.model === undefined ? draftModelFromEnv() : options.model;
  if (model === null) return null;

  const allowedOrigins = allowedDraftOrigins(options.property);
  if (allowedOrigins.length === 0) return null;

  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    fetchPageMeta: (url: string) =>
      readPageMeta(url, allowedOrigins, fetchImpl),
    complete: (prompt: string) =>
      complete(prompt, model, fetchImpl, options.remainingMs),
    remainingMs: options.remainingMs,
  };
}
