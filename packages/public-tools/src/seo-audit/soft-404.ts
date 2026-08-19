// @input  -- a collected page's title and the body text the crawl normalised
// @output -- whether the page answers 200 while saying it has nothing
// @pos    -- pure; the detection behind A4 and 1.8, and the reason both are safe
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { TextUnits } from "./keyword-evidence/text-units.ts";
import type { SeoAuditPage } from "./types.ts";

/**
 * The version of this detection.
 *
 * Published beside the finding because both checks it feeds are Blocker-level:
 * a run that condemned a page has to be readable back against the exact rule
 * that condemned it.
 */
export const SOFT_404_VERSION = "soft_404.v1" as const;

/**
 * How little body text still counts as an empty shell.
 *
 * Counted in `text_units.v1`, which is words for Latin script and characters
 * for CJK. A whitespace word count cannot be used here at any threshold: a
 * Chinese page has no spaces, splits into one or two "words", and a published
 * floor would mark EVERY page of a Chinese site as a soft 404 — with A4 a
 * Blocker, on a product whose own site is Chinese first.
 *
 * The number is a corroboration, not the finding. On its own a short page is a
 * short page, which is a different check.
 */
export const SOFT_404_BODY_FLOOR_UNITS = 200;

/**
 * Phrases a page uses to say it has nothing, in the two languages this tool
 * ships in.
 *
 * Matched against the title and the opening of the body, never the whole page:
 * a footer link reading "404" appears on sites that are entirely healthy, and
 * an article about error pages says "page not found" in its body on purpose.
 */
const NOT_FOUND_PHRASES: readonly RegExp[] = [
  /\b404\b/,
  /\bpage\s+not\s+found\b/i,
  /\bnot\s+found\b/i,
  /\bno\s+longer\s+(?:exists|available)\b/i,
  /\bdoes\s*n[o']?t\s+exist\b/i,
  /\bwe\s+can'?t\s+find\b/i,
  /页面?不存在/,
  /找不到(?:该|这个)?页面/,
  /页面?已(?:删除|移除|下线)/,
  /无法找到/,
];

/** How much of the body is read for a not-found phrase. */
const OPENING_CHARS = 300;

export interface SoftNotFoundVerdict {
  readonly matchedPhrase: string;
  readonly bodyUnits: TextUnits;
}

/**
 * Whether a page answers 200 while telling the reader it has nothing.
 *
 * Two independent signals are required, and that is the whole design. Thin
 * content alone is a short page, which several other checks already report;
 * condemning it here would fail a pricing page with six words and a table. A
 * not-found phrase alone is an article about error pages. Together they are a
 * page that says it is missing and has nothing else on it, which is the thing
 * A4 and 1.8 name.
 *
 * Returns null for anything it cannot read, never a guess. Both checks are
 * Blocker-capable, so a false positive costs more than a miss.
 */
export function softNotFoundVerdict(
  page: SeoAuditPage,
  /**
   * The whole body's text measure, from the raw crawl.
   *
   * `main` already counts CJK code points one unit each and the remaining
   * whitespace runs separately, which is exactly the measure this needs and the
   * reason a whitespace word count cannot be used: a Chinese page has no spaces
   * and splits into one or two "words", so a published word floor would mark
   * EVERY page of a Chinese site as a soft 404 — at Blocker severity, on a
   * product whose own site is Chinese first.
   */
  textMetrics: {
    readonly cjkChars: number;
    readonly nonCjkWords: number;
  } | null,
  /** Opening text, for the phrase match. Null when the crawl captured none. */
  openingText: string | null,
): SoftNotFoundVerdict | null {
  if (page.finalStatus !== 200) return null;
  if (textMetrics === null) return null;

  const units = textMetrics.cjkChars + textMetrics.nonCjkWords;
  if (units >= SOFT_404_BODY_FLOOR_UNITS) return null;

  const searched = `${page.title ?? ""} ${(openingText ?? "").slice(0, OPENING_CHARS)}`;
  for (const phrase of NOT_FOUND_PHRASES) {
    const match = phrase.exec(searched);
    if (match !== null) {
      return {
        matchedPhrase: match[0],
        bodyUnits: {
          units,
          basis:
            textMetrics.cjkChars > 0 && textMetrics.nonCjkWords > 0
              ? "mixed"
              : textMetrics.cjkChars > 0
                ? "cjk_chars"
                : "words",
        },
      };
    }
  }
  return null;
}
