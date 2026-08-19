// @input  -- nothing; the sections the report has and the ones it deliberately lacks
// @output -- the two lists the capability chapter is rendered from
// @pos    -- stated once, so the page and the test that checks its wording agree
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * The report's sections, in the order it shows them.
 *
 * `serp` is here and is not one of the graded categories: the results page is
 * context, and it is also the one paid lookup — leaving it out of the chapter
 * that exists to say what the tool does would be the omission the chapter was
 * written to stop.
 */
export const COVERAGE_GROUPS = [
  "meta",
  "content",
  "keyword",
  "links",
  "media",
  "social",
  "technical",
  "site",
  "serp",
] as const;

/** What it cannot answer, said out loud rather than left to be inferred. */
export const COVERAGE_EXCLUSIONS = [
  "rendering",
  "css",
  "ranking",
  "backlinks",
  "headings",
  "density",
] as const;
