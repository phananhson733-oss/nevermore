// @input  -- one line of text the visitor typed into the keyword field
// @output -- the queries that will actually be submitted, and what was dropped
// @pos    -- the only place the typed string becomes the list the request carries
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/** The request accepts at most this many, so the field stops at the same number. */
export const MAX_QUERIES = 5;
/** Per query, matching the request validator rather than guessing under it. */
export const MAX_QUERY_CHARS = 80;

/**
 * Both commas, because the audience types both.
 *
 * A Chinese-first product whose keyword field only split on `,` would take
 * `占星, 星盘` as one 6-character query and report it absent from a page that
 * covers both words — a wrong answer produced by a separator, not by the page.
 * Newlines are here for the same reason: a pasted column is a list.
 */
const SEPARATORS = /[,，\n\r]+/u;

export interface ParsedQueries {
  /** In typed order, de-duplicated, capped. Exactly what the request carries. */
  readonly queries: readonly string[];
  /** How many past the cap were dropped, so the form can say so. */
  readonly overflow: number;
  /** How many repeats were folded, counted before the cap was applied. */
  readonly duplicates: number;
  /** The entries refused for length, kept so the message can name one. */
  readonly tooLong: readonly string[];
}

/**
 * Parse without correcting.
 *
 * Every departure from what was typed is counted and returned rather than
 * applied silently: a field that quietly drops the sixth keyword produces a
 * report that answers about five words when the visitor asked about six, and
 * nothing on screen accounts for the difference.
 */
export function parseTargetQueries(input: string): ParsedQueries {
  const seen = new Set<string>();
  const queries: string[] = [];
  const tooLong: string[] = [];
  let overflow = 0;
  let duplicates = 0;

  for (const raw of input.split(SEPARATORS)) {
    const value = raw.trim();
    if (value === "") continue;
    if ([...value].length > MAX_QUERY_CHARS) {
      tooLong.push(value);
      continue;
    }
    // Folded on case because the checks downstream are case-insensitive, so
    // `SEO` and `seo` would produce two identical rows in the evidence table.
    const key = value.toLowerCase();
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    if (queries.length >= MAX_QUERIES) {
      overflow += 1;
      continue;
    }
    queries.push(value);
  }

  return { queries, overflow, duplicates, tooLong };
}
