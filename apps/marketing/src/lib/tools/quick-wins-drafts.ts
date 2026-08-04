// @input  -- the granted property and the deployment's model configuration
// @output -- crawl and model seams for Title/Meta drafts, or null when drafts are off
// @pos    -- the only place drafts touch the network
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { DraftRunDependencies, PageMeta } from "@sf/public-tools";
import { parsePage } from "@sf/sources";
// The switch itself lives in a module with no imports, so the landing page can
// ask "are drafts on" without pulling the crawler in behind it.
import {
  draftModelFromEnv,
  type DraftModelConfig,
} from "./quick-wins-draft-config.ts";

export { draftModelFromEnv, type DraftModelConfig };

/** The model call is the last thing in a run; it does not get to be slow. */
const MODEL_TIMEOUT_MS = 20_000;

/** Per-page fetch deadline. Drafts must never be the reason a run times out. */
const PAGE_FETCH_TIMEOUT_MS = 6_000;
/** A page whose head we cannot read in this much HTML is not worth more. */
const MAX_PAGE_BYTES = 512 * 1024;

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
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
  try {
    const response = await fetchImpl(config.url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        // Azure rejects the bearer form outright; see DraftAuthScheme.
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
        // pointed at now. The cap itself stays — the validator rejects
        // anything longer anyway, and this stops a runaway reply from being
        // paid for and then discarded. Reasoning tokens count against it, so
        // it is generous relative to a title and a description.
        max_completion_tokens: 400,
        temperature: config.temperature,
      }),
    });
    if (!response.ok) {
      throw new Error(`draft model responded ${response.status}`);
    }
    const body = (await response.json()) as {
      choices?: readonly { message?: { content?: unknown } }[];
    };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error("draft model returned no message content");
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
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
export function createDraftDependencies(options: {
  readonly property: string;
  readonly fetchImpl?: typeof fetch;
  readonly model?: DraftModelConfig | null;
}): DraftRunDependencies | null {
  const model = options.model === undefined ? draftModelFromEnv() : options.model;
  if (model === null) return null;

  const allowedOrigins = allowedDraftOrigins(options.property);
  if (allowedOrigins.length === 0) return null;

  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    fetchPageMeta: (url: string) =>
      readPageMeta(url, allowedOrigins, fetchImpl),
    complete: (prompt: string) => complete(prompt, model, fetchImpl),
  };
}
