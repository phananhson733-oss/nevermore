// @input  -- one CompetitorKeywordGapResultV3
// @output -- every gap row as RFC 4180 CSV, and the filename for it
// @pos    -- the export half of the v3 contract; every row, with each value's source in its own column name
//
// Deliberately not "the same numbers, in a file". The competitor page columns
// describe the best-ranked competitor whose URL survived the safety check,
// while the traffic chip on screen reads the best-ranked competitor whether or
// not its URL is usable, so the two traffic figures can legitimately differ.
// The file therefore names the competitor those page columns belong to, and its
// rank, in their own cells: a reader holding the export next to the screen can
// see WHICH competitor each figure describes rather than finding two numbers
// that disagree with nothing to explain it.

import {
  COMPETITOR_KEYWORD_GAP_TOOL,
  type CompetitorKeywordGapMetric,
  type CompetitorKeywordGapResultV3,
  type CompetitorKeywordGapRow,
} from "./types.ts";

/**
 * Columns, in order.
 *
 * Stable English field ids rather than the localized labels on screen. These
 * files get opened months later, diffed against an older export, and pasted
 * into someone else's sheet; a header row that follows the reader's language
 * makes all three impossible. Renaming an id breaks every sheet keyed on the
 * old one, so the list is frozen from the first build that ships it. The ids
 * below were renamed once, while no export of this file existed anywhere, which
 * is the only moment at which renaming is free.
 *
 * A `dfs` prefix means the value is DataForSEO's -- a third party's estimate or
 * its record of a crawl, never something this tool measured. A `gsc` prefix
 * means it is the site's own Search Console. The unprefixed columns are the
 * run's context and coverage, the row's subject, or this tool's own
 * classification, whose `preScreenBasis` says which of the two IT read. In a
 * spreadsheet the header is the only thing a value keeps, so provenance has to
 * live in each name rather than in a legend that does not get exported.
 *
 * The run context and the run coverage columns repeat on every row on purpose.
 * A gap row means nothing without the market, the language and the site it was
 * measured for, and it means something quite different when a competitor was
 * never fetched at all. Carrying either only in the filename, or only in a
 * summary card on screen, means it stops being true the first time someone
 * renames the file or sorts the sheet.
 */
const COLUMNS = [
  "capturedAt",
  "siteDomain",
  "marketCode",
  "languageCode",
  // Run coverage. Without it a run where one of two competitors failed exports
  // as a file of `dfsCompetitorCount=1` rows with nothing anywhere saying the
  // second was never fetched, and every absence in it reads as evidence that a
  // competitor does not rank.
  "requestedCompetitors",
  "completedCompetitors",
  "unavailableCompetitors",
  "resultTruncated",
  "gscOverlayStatus",
  "gscQueryRowCount",
  "gscQueryPageRowCount",
  "keyword",
  // The tool that wrote the line, and nothing finer. It was called `source`
  // while holding this same constant, which reads as a claim about where the
  // row's numbers came from; that is what the column prefixes answer.
  "tool",
  "dfsCoreKeyword",
  "dfsSearchVolume",
  // Beside the number, never instead of it: without this an empty
  // `dfsSearchVolume` cell cannot be told apart from a provider-reported zero.
  "dfsSearchVolumeAvailability",
  "dfsKeywordDifficulty",
  // Not `cpcUsd`. The value is DataForSEO's `keyword_info.cpc` carried through
  // untouched; nothing in this pipeline converts, tags or checks a currency, so
  // a name asserting one would be the file inventing a fact about the number.
  "dfsCpc",
  "dfsIntent",
  "dfsSearchVolumeTrendMonthly",
  "dfsSearchVolumeTrendQuarterly",
  "dfsSearchVolumeTrendYearly",
  "dfsCompetitorCount",
  "dfsBestCompetitorRank",
  "dfsCompetitorRanks",
  // The competitor the page columns below describe: the best-ranked one whose
  // URL could be linked, which is not always the best-ranked one. Its domain
  // and its rank are exported so the distance between this rank and
  // `dfsBestCompetitorRank` is readable in the line itself.
  "dfsLinkedCompetitorDomain",
  "dfsLinkedCompetitorRank",
  "dfsLinkedCompetitorPageUrl",
  "dfsLinkedCompetitorPageTitle",
  "dfsLinkedCompetitorPageEtv",
  // Ahead of the two cells it governs. An empty `dfsSerpSnapshotUpdatedAt`
  // alone cannot say whether there was no snapshot or a snapshot the provider
  // never dated, and the second case is a third party's undated record sitting
  // in the file looking like something this run observed today.
  "dfsSerpSnapshotState",
  "dfsSerpItemTypes",
  // The provider's snapshot date. It travels with the item types because the
  // snapshot is something a third party stored on a day, not something this
  // run looked at.
  "dfsSerpSnapshotUpdatedAt",
  "preScreenBand",
  "preScreenBasis",
  "preScreenReason",
  "ownState",
  "gscQueryStatus",
  "gscEvidenceBasis",
  "gscQueryImpressions",
  "gscQueryPosition",
  "gscPageStatus",
  "gscPageUrl",
  "gscPageImpressions",
  "gscPagePosition",
  "gscQueryPageCoverage",
  "nextStep",
] as const;

/**
 * `dfsSerpSnapshotState` values.
 *
 * Three states because the two empty-date cases are different claims. A
 * snapshot the provider dated can be judged stale; a snapshot it never dated
 * cannot be judged at all, and must not be read as having been taken on the
 * day of the run. On screen the second case renders as "DFS snapshot, undated"
 * for the same reason.
 */
const SNAPSHOT_ABSENT = "no_snapshot";
const SNAPSHOT_DATED = "dfs_snapshot_dated";
const SNAPSHOT_UNDATED = "dfs_snapshot_undated";

/**
 * Leading characters Excel and Google Sheets treat as the start of a formula.
 *
 * Keywords are whatever a competitor ranks for, straight from the provider;
 * `=cmd|'/c calc'!A0` in a cell is a known execution path, and these files are
 * opened by the person who downloaded them without a second thought. The guard
 * applies to text cells only -- a negative number we generated ourselves must
 * stay a number, or every declining trend becomes unsortable in the sheet.
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
 * their own arithmetic against, and a rounded figure is a different number from
 * the one the provider reported. Rounding is also how an unavailable value
 * becomes a plausible-looking 0.
 */
function num(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "";
  return String(value);
}

/**
 * A boundary flag as a word.
 *
 * Not 1/0: this sits in a row of counts, and a `1` under `resultTruncated`
 * reads as one of something rather than as yes.
 */
function bool(value: boolean): string {
  return value ? "true" : "false";
}

/**
 * A provider metric's number, or an empty cell.
 *
 * `provider_no_data` empties the cell whatever value rides along with it. The
 * difference between "the provider reported zero" and "the provider had no
 * figure" is the entire reason `availability` is exported next to the number,
 * and writing the second case as a digit erases it.
 */
function metric(value: CompetitorKeywordGapMetric): string {
  return value.availability === "provider_no_data" ? "" : num(value.value);
}

/**
 * http(s) with no credentials, or nothing.
 *
 * The provider decides these URLs and the cell lands in a spreadsheet one click
 * from being opened. The server bounds them already; re-checking costs nothing
 * and keeps a `javascript:` URL out of the file if that ever loosens.
 */
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

/**
 * The row's competitors, best rank first, ties broken on the domain.
 *
 * Codepoint order rather than `localeCompare`. ICU weighs punctuation and case
 * differently from letters and ships its collation data with the runtime, so
 * for two domains that differ only in those, the answer belongs to whichever
 * Node built the file rather than to the file. Codepoint order is a property of
 * the strings alone: two runs over the same ranks produce the same bytes on any
 * runtime, which is the only thing that makes an export diffable against one
 * taken months earlier.
 */
function rankedDomains(
  row: CompetitorKeywordGapRow,
): readonly (readonly [string, number])[] {
  // `localeCompare`, matching the order the report itself builds the object in
  // and the order every surface reads it back in. A codepoint tie-break was
  // tried here for cross-runtime stability and bought nothing: competitor keys
  // are validated down to [a-z0-9-.], and over that alphabet the two orders
  // agree on every pair. What it did buy was four call sites -- the chips
  // column, the traffic estimate, the linked page, and this cell -- no longer
  // sharing one order.
  return Object.entries(row.competitorRanks).toSorted(
    ([leftDomain, leftRank], [rightDomain, rightRank]) =>
      leftRank - rightRank || leftDomain.localeCompare(rightDomain),
  );
}

/** `domain#rank` pairs in that order, in a single cell. */
function competitorRanks(row: CompetitorKeywordGapRow): string {
  return rankedDomains(row)
    .map(([domain, rank]) => `${domain}#${rank}`)
    .join("|");
}

interface LinkedCompetitorPage {
  readonly domain: string;
  readonly rank: number;
  readonly url: string;
  readonly title: string | null;
  readonly etv: number | null;
}

/**
 * The best-ranked competitor whose page URL survives the safety check, as one
 * entry: the competitor whose page this file can actually point at.
 *
 * Its rank is not necessarily `bestCompetitorRank`. A competitor can rank first
 * and carry no usable URL, in which case these columns describe someone further
 * down -- which is why the domain and the rank travel with the page rather than
 * being left for the reader to assume. All five values read from this single
 * entry so they describe the same page: taking the URL from one competitor and
 * the title or the traffic estimate from whichever competitor happened to have
 * one would put a line in the file about a page that does not exist.
 *
 * When no competitor has a usable URL all five columns are empty. There is no
 * page to name, so there is no competitor, title or traffic estimate to attach
 * to one either.
 */
function linkedCompetitorPage(
  row: CompetitorKeywordGapRow,
): LinkedCompetitorPage | null {
  for (const [domain, rank] of rankedDomains(row)) {
    const page = row.competitorPages[domain];
    const url = safeUrl(page?.url ?? null);
    if (url !== null) {
      return {
        domain,
        rank,
        url,
        title: page?.title ?? null,
        etv: page?.etv ?? null,
      };
    }
  }
  return null;
}

function runContextCells(
  result: CompetitorKeywordGapResultV3,
): readonly string[] {
  return [
    text(result.capturedAt),
    text(result.siteDomain),
    text(result.marketCode),
    text(result.languageCode),
  ];
}

/**
 * What the run actually managed to look at.
 *
 * Every fact in a row is bounded by these five cells. `completedCompetitors`
 * below `requestedCompetitors` means a competitor was never fetched, so its
 * absence from a row says nothing about whether it ranks; `resultTruncated`
 * means the merged result hit its output boundary, so the rows present are not
 * all the rows there were; `gscOverlayStatus` says whether the Search Console
 * half happened at all. On screen these live in a coverage card the export
 * cannot carry, which is exactly how a bounded file comes to read as complete.
 */
function runCoverageCells(
  result: CompetitorKeywordGapResultV3,
): readonly string[] {
  return [
    num(result.requestedCompetitors),
    num(result.completedCompetitors),
    num(result.unavailableCompetitors),
    bool(result.resultTruncated),
    text(result.overlayStatus),
    // The overlay status alone cannot express the wrong-property case. A read
    // that succeeds and returns nothing stays "available", so without the raw
    // counts every row's empty GSC evidence reads as "Search Console was read
    // and this site genuinely has no coverage" -- which is the one inference
    // the boundaries forbid. On screen this case gets its own escalation; a
    // zero here is what carries it into the file.
    num(result.gscQueryRowCount),
    num(result.gscQueryPageRowCount),
  ];
}

function dfsKeywordCells(row: CompetitorKeywordGapRow): readonly string[] {
  const trend = row.searchVolumeTrend;
  return [
    optionalText(row.coreKeyword),
    metric(row.searchVolume),
    text(row.searchVolume.availability),
    metric(row.keywordDifficulty),
    metric(row.cpc),
    optionalText(row.providerIntent),
    num(trend?.monthly ?? null),
    num(trend?.quarterly ?? null),
    num(trend?.yearly ?? null),
  ];
}

function dfsCompetitorCells(row: CompetitorKeywordGapRow): readonly string[] {
  const linked = linkedCompetitorPage(row);
  return [
    num(row.competitorCount),
    num(row.bestCompetitorRank),
    text(competitorRanks(row)),
    optionalText(linked?.domain ?? null),
    num(linked?.rank ?? null),
    optionalText(linked?.url ?? null),
    optionalText(linked?.title ?? null),
    num(linked?.etv ?? null),
  ];
}

/**
 * Whether the stored snapshot carries a date a reader can actually resolve.
 *
 * Not `updatedAt !== null`: the provider's timestamp is copied through
 * unvalidated, and the surface calls an unparseable one UNDATED. Deciding on
 * null alone made the file say `dated` for the same snapshot the screen
 * labelled undated -- the two disagreeing about precisely the distinction this
 * column exists to draw.
 */
function snapshotIsDated(updatedAt: string | null): boolean {
  if (updatedAt === null) return false;
  return Number.isFinite(new Date(updatedAt).getTime());
}

function dfsSerpCells(row: CompetitorKeywordGapRow): readonly string[] {
  const snapshot = row.serpSnapshot;
  if (snapshot === null) return [SNAPSHOT_ABSENT, "", ""];
  return [
    snapshotIsDated(snapshot.updatedAt) ? SNAPSHOT_DATED : SNAPSHOT_UNDATED,
    text(snapshot.itemTypes.join("|")),
    optionalText(snapshot.updatedAt),
  ];
}

function preScreenCells(row: CompetitorKeywordGapRow): readonly string[] {
  return [
    text(row.preScreen.band),
    text(row.preScreen.basis),
    text(row.preScreen.reason),
  ];
}

function gscCells(row: CompetitorKeywordGapRow): readonly string[] {
  const gsc = row.gsc;
  return [
    text(gsc.queryStatus),
    optionalText(gsc.evidenceBasis),
    num(gsc.queryImpressions),
    num(gsc.queryPosition),
    text(gsc.pageStatus),
    optionalText(safeUrl(gsc.pageUrl)),
    num(gsc.pageImpressions),
    num(gsc.pagePosition),
    num(gsc.queryPageCoverage),
    text(gsc.nextStep),
  ];
}

/** Every gap row as CSV, in the order the engine sorted them. */
export function competitorKeywordGapCsv(
  result: CompetitorKeywordGapResultV3,
): string {
  const header = COLUMNS.join(",");
  const run = [...runContextCells(result), ...runCoverageCells(result)];
  const rows = result.rows.map((row) =>
    [
      ...run,
      text(row.keyword),
      COMPETITOR_KEYWORD_GAP_TOOL,
      ...dfsKeywordCells(row),
      ...dfsCompetitorCells(row),
      ...dfsSerpCells(row),
      ...preScreenCells(row),
      // On every row rather than in a footnote: it is the fact that makes the
      // line a gap at all, and a filtered sheet keeps no footnotes.
      text(row.ownState),
      ...gscCells(row),
    ].join(","),
  );

  // CRLF for the same reason as the mark: RFC 4180 specifies it, and Excel is
  // the least forgiving reader of the two conventions.
  return `${BOM}${[header, ...rows].join("\r\n")}`;
}

const CAPTURED_DATE = /^(\d{4}-\d{2}-\d{2})(?:[T ]|$)/;

/**
 * Hostname labels only, so nothing in the name can steer where a browser puts
 * the file.
 */
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
 * The download filename, carrying the site and the day it was captured.
 *
 * Both halves are validated rather than interpolated: `capturedAt` arrives in
 * an API response and `siteDomain` started life as something a person typed, so
 * a path separator or a quote could otherwise reach a `download` attribute. A
 * value that fails loses the detail rather than the file, since the site, the
 * date and the scope are all inside the file itself.
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
