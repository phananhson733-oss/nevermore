// @input  -- a granted property, the visitor's brand terms, and their access token
// @output -- the finished SEO Quick Wins envelope for that property
// @pos    -- binds the pure per-run plan to one request's Search Console token
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { runQuickWins, type QuickWinsEnvelope } from "@sf/public-tools";
import { createSearchAnalyticsClient } from "@sf/sources";
import { createDraftDependencies } from "./quick-wins-drafts.ts";

/** Per-call deadline for a single Search Console request. */
const READ_TIMEOUT_MS = 20_000;

/**
 * Whole-request budget, well inside the route's maxDuration.
 *
 * The per-call timeout alone does not bound the request: readQueryRows pages
 * up to four times sequentially and each page may retry once, so without this
 * the worst case is roughly four times (timeout + backoff + timeout). Blowing
 * past the platform limit costs more than a slow response — the visitor gets a
 * bare 504 instead of a stable envelope, and the handler's `finally` never
 * runs to release the shared Search Console slot.
 */
const REQUEST_BUDGET_MS = 45_000;

export interface QuickWinsReadInput {
  readonly property: string;
  readonly brandTerms: readonly string[];
}

/**
 * Build the reader for one visitor's request.
 *
 * The access token is captured per call and never stored on a module-level
 * client: it belongs to one request, and a client that outlived the request
 * would be a token that outlived it too.
 */
export function createQuickWinsReader(options: {
  readonly accessToken: string;
  readonly now?: () => Date;
}): (input: QuickWinsReadInput) => Promise<QuickWinsEnvelope> {
  const now = options.now ?? (() => new Date());

  return ({ property, brandTerms }) => {
    // ONE absolute deadline, shared by the paging loop and every HTTP attempt
    // on both reads. A page-boundary check alone did not bound the request:
    // a page starting just under the budget could still run its own timeout
    // plus a retry and carry the request past the platform limit.
    const deadlineAt = now().getTime() + REQUEST_BUDGET_MS;
    const remainingMs = () => deadlineAt - now().getTime();

    // Null when the deployment has no draft model configured, which skips the
    // two extra Search Console reads as well as the crawl. The evidence table
    // does not depend on any of it.
    //
    // `remainingMs` is the same clock the reads run against, on purpose: the
    // drafts are the last and slowest thing in the request, and the handler
    // awaits them before returning, so a draft that overruns does not cost a
    // draft — it costs the finished table.
    const draftDependencies = createDraftDependencies({
      property,
      remainingMs,
    });

    return runQuickWins({
      client: createSearchAnalyticsClient({
        siteUrl: property,
        accessToken: options.accessToken,
        requestTimeoutMs: READ_TIMEOUT_MS,
        remainingMs,
      }),
      now: now(),
      brandTerms,
      budget: { isExpired: () => remainingMs() <= 0 },
      ...(draftDependencies === null ? {} : { draftDependencies }),
    });
  };
}
