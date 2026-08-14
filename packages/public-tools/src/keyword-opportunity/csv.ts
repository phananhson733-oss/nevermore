// @input  -- one KeywordOpportunityResult
// @output -- the shown rows as RFC 4180 CSV, and the filename for it
// @pos    -- the export half of the map; the same evidence, in a file that survives the tab
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type {
  KeywordOpportunityResult,
  KeywordOpportunityRow,
} from "./types.ts";

/**
 * Columns, in order.
 *
 * Stable field ids rather than the localized labels shown on screen: this
 * file gets opened weeks later and pasted into someone else's sheet, and a
 * header row that changes with the reader's language breaks both.
 *
 * `market`/`language` repeat on every row on purpose. Volume means nothing
 * without the market it was priced for, and carrying it only in the filename
 * stops being true the first time someone renames the file.
 */
const COLUMNS = [
  "market",
  "language",
  "lane",
  "keyword",
  "volume",
  "difficulty",
  "weakestDomainRank",
  "weakestDomain",
  "weakestPosition",
  // Tri-state on purpose: "yes" / "no" only when the provider reported the
  // page's element types; empty when it reported none or the page was never
  // sampled. A blank must stay a blank — "no" for an unsampled page would
  // claim an observation nobody made.
  "aiOverviewObserved",
  "coverage",
  "supportingPageUrl",
  "discoveryBasis",
  "clusterId",
  // Stable check codes joined with "|", not the localized sentences: someone
  // filtering the export filters on `verify_weak_site_breakthrough`, and that
  // has to keep working when the page is read in the other language.
  "checks",
] as const;

/**
 * Leading characters Excel and Google Sheets treat as the start of a formula.
 *
 * Keywords come out of a model reading arbitrary websites; `=cmd|…` in a cell
 * is a known execution path. Text cells only — numbers we produced ourselves
 * must stay numbers or the export becomes unsortable.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * Byte-order mark, written as an escape.
 *
 * Excel decodes UTF-8 as the local codepage without one, so every non-ASCII
 * keyword opens as mojibake. Escaped rather than typed: a literal BOM in
 * source is invisible in every editor and reads as a stray character to lint.
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
 * Never a zero stand-in: an unavailable volume exported as 0 is exactly the
 * conflation the three-state volume design exists to prevent.
 */
function num(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "";
  return String(value);
}

// `undefined` accepted alongside the contract's `null`: a run that started on
// the previous deployment finishes on this one with a payload that predates
// the field, and the export must not crash on it. Both read as "not reported".
function aiOverviewCell(
  itemTypes: readonly string[] | null | undefined,
): string {
  if (itemTypes === null || itemTypes === undefined) return "";
  return itemTypes.includes("ai_overview") ? "yes" : "no";
}

function rowCells(
  result: KeywordOpportunityResult,
  row: KeywordOpportunityRow,
): string {
  return [
    text(result.marketCode),
    text(result.languageCode),
    text(row.lane),
    text(row.keyword),
    num(row.validation.volume),
    num(row.validation.difficulty),
    num(row.serp.weakestTopTenDomainRank),
    text(row.serp.weakestTopTenDomain ?? ""),
    num(row.serp.weakestTopTenPosition),
    aiOverviewCell(row.serp.pageOneItemTypes),
    text(row.coverage),
    text(row.supportingPageUrl ?? ""),
    text(row.discoveryBasis),
    text(row.clusterId ?? ""),
    text(row.nextChecks.join("|")),
  ].join(",");
}

/** The shown rows as CSV, in the order the surface displays them. */
export function keywordOpportunityCsv(
  result: KeywordOpportunityResult,
): string {
  const header = COLUMNS.join(",");
  const rows = result.rows.map((row) => rowCells(result, row));
  // CRLF because RFC 4180 specifies it and Excel is the least forgiving
  // reader of the two conventions.
  return `${BOM}${[header, ...rows].join("\r\n")}`;
}

const CODE = /^[A-Za-z]{2}$/;

/**
 * The download filename, carrying the market the volumes were priced for.
 *
 * The codes arrive from an API payload, so they are validated rather than
 * interpolated; an unrecognized pair loses the suffix instead of the file,
 * since both codes are also inside the file itself.
 */
export function keywordOpportunityCsvFilename(result: {
  readonly marketCode: string;
  readonly languageCode: string;
}): string {
  if (!CODE.test(result.marketCode) || !CODE.test(result.languageCode)) {
    return "keyword-opportunity-map.csv";
  }
  return `keyword-opportunity-map-${result.marketCode.toLowerCase()}-${result.languageCode.toLowerCase()}.csv`;
}
