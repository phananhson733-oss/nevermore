// @input  -- one crawl result from the page-value-ordered context profile
// @output -- the flatter shape the keyword orchestration and its prompts read
// @pos    -- adapter only; it drops nothing and invents nothing
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { ContextProfileResult } from "@sf/sources/crawl-context-profile";
import type { KeywordContextCrawlResult } from "./keyword-opportunity-handler.ts";

/**
 * Flatten a crawl result for the orchestration.
 *
 * The crawl layer reports a missing title, description or body as `null`,
 * which is the repo's rule: an empty string would read as "the page says
 * nothing under this heading" when the truth is "there was no heading". The
 * two consumers here both want a string, and for both of them the honest
 * substitution is the empty one — a page with no title contributes no title
 * to the prompt, and contributes no tokens to the coverage check, so it can
 * never be the page that marks a candidate as already covered.
 *
 * Headings arrive grouped by level and are flattened in document order, h1
 * first. The prompt reads them as a list of what the page is about, and the
 * level is not information it can use; keeping the grouping would only give
 * the model a structure to over-read.
 */
export function toKeywordContextCrawl(
  result: ContextProfileResult,
): KeywordContextCrawlResult {
  return {
    pages: result.pages.map((page) => ({
      url: page.url,
      title: page.title ?? "",
      headings: [...page.headings.h1, ...page.headings.h2, ...page.headings.h3],
      text: page.text ?? "",
      score: page.score,
    })),
    pagesFetched: result.pagesFetched,
    productPagesFetched: result.productPagesFetched,
    // The crawl reports `null` for "ran to completion". The orchestration
    // carries this straight into the sealed token and then into the report, so
    // it needs a word rather than an absence.
    stopReason: result.stopReason ?? "completed",
  };
}
