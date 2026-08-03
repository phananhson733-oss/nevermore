// @input  -- one QuickWinsResult
// @output -- the evidence table as RFC 4180 CSV, and the filename for it
// @pos    -- the export half of v3.1 §2.1; the same numbers, in a file
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { QuickWinsResult } from "./types.ts";

/**
 * Below this a probability is written as a floor, never as a bare 0.
 *
 * Matches the threshold the table on screen uses. The file and the page are
 * the same claim; a reader who exports and then compares must not find them
 * disagreeing about whether something is impossible.
 */
export const CSV_TAIL_FLOOR = 0.0001;

/**
 * Columns, in order.
 *
 * Stable field ids rather than the localized labels shown on screen: this file
 * gets opened months later, diffed against an older export, and pasted into
 * someone else's sheet. A header row that changes with the reader's language
 * makes all three impossible.
 *
 * `windowStart`/`windowEnd` repeat on every row on purpose. The period is the
 * one fact the numbers are meaningless without, and carrying it only in the
 * filename means it stops being true the first time someone renames the file.
 */
const COLUMNS = [
  "windowStart",
  "windowEnd",
  "query",
  "position",
  "bucketId",
  "impressions",
  "clicks",
  "observedCtr",
  "baselineCtr",
  "expectedClicks",
  "clickGap",
  "tailProbability",
  "baselineBandUnderOnePercent",
] as const;

/**
 * Leading characters Excel and Google Sheets treat as the start of a formula.
 *
 * Queries are whatever people typed into Search; `=cmd|'/c calc'!A0` in a cell
 * is a known execution path, and these files are opened by the person who
 * downloaded them without a second thought. The guard applies to text cells
 * only — a negative number we generated ourselves must stay a number, or every
 * above-baseline row becomes unsortable in the spreadsheet.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * Byte-order mark, written as an escape.
 *
 * Excel decodes UTF-8 as the local codepage without one, so every non-ASCII
 * query opens as mojibake. Escaped rather than typed: a literal BOM in source
 * is invisible in every editor and reads as a stray character to lint.
 */
const BOM = "\uFEFF";

function quote(value: string): string {
  if (!/["\n\r,]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function text(value: string): string {
  return quote(FORMULA_LEAD.test(value) ? `'${value}` : value);
}

/**
 * A number, or an empty cell when there is no number.
 *
 * Never rounded. The page rounds for reading; the file is what someone runs
 * their own arithmetic against, and a rounded rate is a different number from
 * the one the engine computed. Rounding is also how an unavailable value
 * becomes a plausible-looking 0.
 */
function num(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "";
  return String(value);
}

/**
 * A tail probability, floored rather than allowed to print as 0.
 *
 * Double precision runs out of exponent long before a probability becomes an
 * impossibility. `0` in this column would tell the reader the observation
 * cannot happen; what actually happened is that we cannot write the number
 * down.
 */
function tail(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "";
  if (value < CSV_TAIL_FLOOR) return `<${CSV_TAIL_FLOOR}`;
  return String(value);
}

/** The evidence table as CSV, in the order the engine sorted it. */
export function evidenceCsv(result: QuickWinsResult): string {
  const header = COLUMNS.join(",");
  const rows = result.rows.map((row) =>
    [
      text(result.window.startDate),
      text(result.window.endDate),
      text(row.query),
      num(row.position),
      text(row.bucketId),
      num(row.impressions),
      num(row.clicks),
      num(row.observedCtr),
      num(row.baselineCtr),
      num(row.expectedClicks),
      num(row.clickGap),
      tail(row.tailProbability),
      String(row.baselineBandUnderOnePercent),
    ].join(","),
  );

  // CRLF for the same reason as the mark: RFC 4180 specifies it, and Excel is
  // the least forgiving reader of the two conventions.
  return `${BOM}${[header, ...rows].join("\r\n")}`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The download filename, carrying the window it covers.
 *
 * The dates arrive from an API response, so they are validated rather than
 * interpolated: a path separator or a quote has no business reaching a
 * `download` attribute. An unrecognized window loses the dates instead of the
 * file, since the window is also inside the file itself.
 */
export function evidenceCsvFilename(window: {
  readonly startDate: string;
  readonly endDate: string;
}): string {
  if (!ISO_DATE.test(window.startDate) || !ISO_DATE.test(window.endDate)) {
    return "seo-quick-wins.csv";
  }
  return `seo-quick-wins-${window.startDate}-to-${window.endDate}.csv`;
}
