// @input  -- one CompetitorKeywordGapResultV3
// @output -- the top gap keywords by provider search volume, as RFC 4180 CSV, and the filename for it
// @pos    -- the export half of the v3 contract, shaped as a keyword feed rather than an evidence report
//
// This file is NOT the report. It carries nine columns for a keyword sheet
// someone imports elsewhere; the run's coverage, the Search Console evidence,
// the SERP snapshot and the pre-screen bands stay on the page, where their
// qualifications are next to them. Two consequences worth stating rather than
// discovering: the capture date lives only in the FILENAME, and the file says
// nothing about which competitors failed to return, so a partial run's export
// looks exactly like a complete one.

import {
  type CompetitorKeywordGapMetric,
  type CompetitorKeywordGapResultV3,
  type CompetitorKeywordGapRow,
} from "./types.ts";

/**
 * How many rows the file carries.
 *
 * The export feeds a keyword sheet, not an audit: someone opens it to pick what
 * to write next, and a six-hundred-row file is not a shortlist. The cut is by
 * DataForSEO's monthly search volume estimate over the MERGED row set -- every
 * competitor's keywords together, not a slice per competitor.
 */
export const COMPETITOR_KEYWORD_GAP_CSV_MAX_ROWS = 150;

/**
 * Columns, in order.
 *
 * Stable English field ids rather than the localized labels on screen: this
 * file gets diffed against an older export and pasted into someone else's
 * sheet, and a header row that changes with the reader's language makes both
 * impossible.
 *
 * Every value here is a DataForSEO ESTIMATE, which is what the `dfs` prefix
 * says. Nothing in this file is a measurement of this site.
 */
const COLUMNS = [
  // First, because it is the row's subject: everything after it is a property
  // OF this keyword, and a sheet is read left to right.
  "keyword",
  "marketCode",
  "languageCode",
  "dfsSearchVolume",
  "dfsKeywordDifficulty",
  "dfsCpc",
  // Not `cpcUsd`. The value is DataForSEO's `keyword_info.cpc` carried through
  // untouched; nothing in this pipeline converts, tags or checks a currency, so
  // a name asserting one would be the file inventing a fact about the number.
  "dfsIntent",
  "dfsCompetitorRanks",
  // The best-ranked competitor whose URL survived the safety check, which is
  // not always the best-ranked competitor. No separate domain column is needed
  // to see that: the URL carries its own host, and `dfsCompetitorRanks` beside
  // it lists every competitor with its rank, so a reader can tell which one
  // this page belongs to by looking at it.
  "dfsLinkedCompetitorPageUrl",
] as const;

/**
 * Leading characters Excel and Google Sheets treat as the start of a formula.
 *
 * Keywords are whatever a competitor ranks for, straight from the provider;
 * `=cmd|'/c calc'!A0` in a cell is a known execution path, and these files are
 * opened by the person who downloaded them without a second thought. The guard
 * applies to text cells only -- a negative number we generated ourselves must
 * stay a number, or every declining value becomes unsortable in the sheet.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * Byte-order mark, written as an escape.
 *
 * Excel decodes UTF-8 as the local codepage without one, so every non-ASCII
 * keyword opens as mojibake. Escaped rather than typed: a literal BOM in source
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

/** A text cell, or an empty one where the contract says the value is unknown. */
function optionalText(value: string | null): string {
  return value === null ? "" : text(value);
}

/**
 * A number, or an empty cell when there is no number.
 *
 * Never rounded. The page rounds for reading; the file is what someone runs
 * their own arithmetic against, and a rounded value is a different number from
 * the one the provider reported. Rounding is also how an unavailable value
 * becomes a plausible-looking 0.
 */
function num(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "";
  return String(value);
}

/**
 * The provider's number, or an empty cell when the provider had none.
 *
 * `provider_no_data` is not zero, and writing a 0 for it would turn "we were
 * not told" into "we were told it is nothing" -- in a column someone sorts by.
 */
function metric(value: CompetitorKeywordGapMetric): string {
  return value.availability === "provider_no_data" ? "" : num(value.value);
}

/** http(s) only and never credentialed, so a provider URL can go in a cell. */
function safeUrl(value: string | null): string | null {
  if (value === null) return null;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === ""
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function rankedDomains(
  row: CompetitorKeywordGapRow,
): readonly (readonly [string, number])[] {
  // `localeCompare`, matching the order the report builds the object in and the
  // order every surface reads it back in, so the chips column, the linked page
  // and this cell never disagree about which competitor comes first.
  return Object.entries(row.competitorRanks).toSorted(
    ([leftDomain, leftRank], [rightDomain, rightRank]) =>
      leftRank - rightRank || leftDomain.localeCompare(rightDomain),
  );
}

/** `domain#rank` pairs, best rank first, in a single cell. */
function competitorRanks(row: CompetitorKeywordGapRow): string {
  return rankedDomains(row)
    .map(([domain, rank]) => `${domain}#${rank}`)
    .join("|");
}

function linkedCompetitorPageUrl(row: CompetitorKeywordGapRow): string | null {
  for (const [domain] of rankedDomains(row)) {
    const url = safeUrl(row.competitorPages[domain]?.url ?? null);
    if (url !== null) return url;
  }
  return null;
}

/**
 * Search volume for ordering, and `null` for a row that has none.
 *
 * A row the provider reported no volume for is not a row with zero volume, and
 * it must not sort among the small numbers as if it were. It sorts last, which
 * is where "not known" belongs in a list ordered by size -- and with a cut at
 * the top, that keeps unknowns out of a file whose whole premise is "the
 * biggest ones".
 */
function sortableVolume(row: CompetitorKeywordGapRow): number | null {
  const { availability, value } = row.searchVolume;
  if (availability === "provider_no_data" || value === null) return null;
  return Number.isFinite(value) ? value : null;
}

function selectedRows(
  result: CompetitorKeywordGapResultV3,
): readonly CompetitorKeywordGapRow[] {
  return result.rows
    .toSorted((left, right) => {
      const leftVolume = sortableVolume(left);
      const rightVolume = sortableVolume(right);
      if (leftVolume !== rightVolume) {
        if (leftVolume === null) return 1;
        if (rightVolume === null) return -1;
        return rightVolume - leftVolume;
      }
      // A deterministic second key. Volumes tie constantly down the long tail,
      // and without one, two exports of the SAME run could differ, which is the
      // one thing a file meant to be diffed must not do.
      return left.keyword.localeCompare(right.keyword);
    })
    .slice(0, COMPETITOR_KEYWORD_GAP_CSV_MAX_ROWS);
}

/** How many rows an export of this result will contain. */
export function competitorKeywordGapCsvRowCount(
  result: Pick<CompetitorKeywordGapResultV3, "rows">,
): number {
  return Math.min(result.rows.length, COMPETITOR_KEYWORD_GAP_CSV_MAX_ROWS);
}

/** The top gap keywords by provider search volume estimate, as CSV. */
export function competitorKeywordGapCsv(
  result: CompetitorKeywordGapResultV3,
): string {
  const header = COLUMNS.join(",");
  const rows = selectedRows(result).map((row) =>
    [
      text(row.keyword),
      text(result.marketCode),
      text(result.languageCode),
      metric(row.searchVolume),
      metric(row.keywordDifficulty),
      metric(row.cpc),
      optionalText(row.providerIntent),
      text(competitorRanks(row)),
      optionalText(linkedCompetitorPageUrl(row)),
    ].join(","),
  );

  // CRLF for the same reason as the mark: RFC 4180 specifies it, and Excel is
  // the least forgiving reader of the two conventions.
  return `${BOM}${[header, ...rows].join("\r\n")}`;
}

const CAPTURED_DATE = /^(\d{4}-\d{2}-\d{2})T/;
const FILENAME_DOMAIN =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*$/;
const MAX_DOMAIN_LENGTH = 253;

/**
 * The calendar day out of `capturedAt`, or null.
 *
 * The shape check alone passes `2026-13-45`, so the candidate is round-tripped
 * through `Date`: a month or day that does not exist either fails to parse or
 * comes back as a different date, and both mean this is not a day we can put in
 * a filename.
 */
function capturedDate(capturedAt: string): string | null {
  const date = CAPTURED_DATE.exec(capturedAt)?.[1];
  if (date === undefined) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === date ? date : null;
}

/**
 * The download filename, carrying the day the run captured its evidence.
 *
 * Validated rather than interpolated: the date arrives from an API response and
 * the domain from what the visitor typed, and neither has any business putting
 * a path separator or a quote into a `download` attribute. It matters more than
 * usual here, because the columns no longer carry the date -- an unrecognized
 * one loses it from the file entirely rather than writing something false.
 */
export function competitorKeywordGapCsvFilename(
  result: Pick<CompetitorKeywordGapResultV3, "capturedAt" | "siteDomain">,
): string {
  const date = capturedDate(result.capturedAt);
  const domain = result.siteDomain;
  if (
    date === null ||
    domain.length > MAX_DOMAIN_LENGTH ||
    !FILENAME_DOMAIN.test(domain)
  ) {
    return "competitor-keyword-gap.csv";
  }
  return `competitor-keyword-gap-${domain}-${date}.csv`;
}
