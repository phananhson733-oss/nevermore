// @input  -- the crawl projection of the submitted target page
// @output -- the visitor-neutral static text kept for keyword comparison
// @pos    -- the only place page text enters the cacheable audit payload
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { CRAWL_PROJECTION_LIMITS, type CrawlPageProjection } from "@sf/sources/crawl-public-preview";

import type { SeoAuditTargetPageExtract } from "../types.ts";
import { cjkShare } from "./text-units.ts";

/** Heading entries kept per list, and characters kept per entry. */
export const MAX_EXTRACT_H1 = 10;
export const MAX_EXTRACT_SUB_HEADINGS = 60;
export const MAX_EXTRACT_ENTRY_CHARS = 200;

/**
 * Share of CJK characters past which a whitespace word count is meaningless.
 *
 * A body written without word gaps counts as one word per paragraph, which is
 * wrong by two orders of magnitude. Past this share the count is withheld
 * rather than published — an obviously absent number can be explained, a
 * confidently wrong one cannot.
 */
const CJK_WORD_COUNT_THRESHOLD = 0.3;

/**
 * Cut to a UTF-16 budget without splitting a character.
 *
 * `slice` counts code units, so cutting mid-pair leaves an orphaned surrogate:
 * corrupted text in the response, and a JSONB write that can fail on it and
 * send us back to re-crawl the same page. The crawl projection documents the
 * same hazard for its own limits.
 */
function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  return /[\uD800-\uDBFF]$/u.test(cut) ? cut.slice(0, -1) : cut;
}

function capList(
  entries: readonly string[],
  max: number,
): { readonly kept: readonly string[]; readonly truncated: boolean } {
  const limited = entries.slice(0, max);
  const kept = limited.map((entry) => truncate(entry, MAX_EXTRACT_ENTRY_CHARS));
  const truncated =
    entries.length > max ||
    limited.some((entry) => entry.length > MAX_EXTRACT_ENTRY_CHARS);
  return { kept, truncated };
}

/**
 * Headings that are not the page's H1s.
 *
 * The crawl projection flattens h1–h6 into one list without levels, so the
 * closest honest answer is the heading list minus the H1 texts, removed once
 * per H1 rather than by value: a page with two identical headings has two, and
 * deleting both would report structure the page does not have.
 *
 * Null once the H1 collector reached its own cap. Past that point the heading
 * list can still contain H1s we were never told about, and the subtraction
 * would quietly delete real sub-headings instead.
 */
function deriveSubHeadings(
  projection: CrawlPageProjection,
): readonly string[] | null {
  if (projection.h1.length >= CRAWL_PROJECTION_LIMITS.maxH1) return null;

  const remaining = new Map<string, number>();
  for (const heading of projection.h1) {
    remaining.set(heading, (remaining.get(heading) ?? 0) + 1);
  }

  const subHeadings: string[] = [];
  for (const heading of projection.headings) {
    const outstanding = remaining.get(heading) ?? 0;
    if (outstanding > 0) {
      remaining.set(heading, outstanding - 1);
      continue;
    }
    subHeadings.push(heading);
  }
  return subHeadings;
}

/**
 * Build the target page extract from one crawl projection.
 *
 * Holds no visitor input, so the result is safe to share across visitors and
 * to keep in the crawl cache; keyword evidence is derived from it per request
 * and never cached.
 */
export function buildTargetPageExtract(
  projection: CrawlPageProjection,
): SeoAuditTargetPageExtract {
  const h1 = capList(projection.h1, MAX_EXTRACT_H1);
  const derived = deriveSubHeadings(projection);
  const subHeadings =
    derived === null ? null : capList(derived, MAX_EXTRACT_SUB_HEADINGS);
  const openingText = projection.bodyExcerpt;

  const wordCountIsMeaningful =
    openingText === null || cjkShare(openingText) <= CJK_WORD_COUNT_THRESHOLD;

  return {
    url: projection.fetchUrl,
    title: projection.title,
    metaDescription: projection.metaDescription,
    h1: h1.kept,
    subHeadings: subHeadings === null ? null : subHeadings.kept,
    openingText,
    staticBodyWords: wordCountIsMeaningful ? projection.wordCount : null,
    truncatedLists: h1.truncated || (subHeadings?.truncated ?? false),
  };
}
