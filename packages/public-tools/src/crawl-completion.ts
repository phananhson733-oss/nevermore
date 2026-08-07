/**
 * The one question a shared crawl cache has to ask before it keeps a result:
 * did the crawl behind it end on its own terms, or was it cut off?
 *
 * Every public crawl tool runs the same crawler under the same profile, so the
 * rule belongs here rather than beside any one of them. Two copies of it would
 * be two chances for one tool to keep caching truncated runs after the other
 * stopped.
 */

/**
 * The crawl engine's stop reason for a run its caller aborted (`STOP_ABORTED`
 * in crawl/engine.ts). Restated here rather than imported because the engine
 * keeps its stop vocabulary private, exactly as `robots_disallowed` and
 * `robots_unreachable` already are in each tool's scan module.
 */
export const CRAWL_ABORTED_STOP_REASON = "aborted";

/** The only part of a crawl result this rule reads. */
export interface CrawlCompletionFacts {
  readonly stopReason: string | null;
}

/**
 * Whether the crawl behind this result ended on its own terms.
 *
 * A run the caller aborted stops wherever it happened to be, and nothing in
 * the payload says which pages it never reached: the stop reason reads
 * `aborted`, but the page list simply looks short. Every other stop reason is
 * one of this profile's fixed ceilings — the next visitor crawling the same
 * site reaches the same place — so a bounded result is a real answer while a
 * cut-off one is only an answer for the caller who cut it off.
 */
export function crawlRanToCompletion(raw: CrawlCompletionFacts): boolean {
  return raw.stopReason !== CRAWL_ABORTED_STOP_REASON;
}
