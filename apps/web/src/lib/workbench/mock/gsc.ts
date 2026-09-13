/**
 * Pasted Search Console performance data (R12): an RFC 4180 record scanner with
 * a scored delimiter, locale-aware numbers, a header recognised and read by
 * its supported labels, and an honest count of every record that
 * did not become a row. `ctr` stays a percent (0.7 means 0.7%). A number that is
 * missing or cannot be read is `null`, never 0.
 */
import type { GscRow, GscStatus, Profile } from "../types.ts";
import { normQ } from "./text.ts";

export type GscMetric = "clicks" | "impressions" | "ctr" | "position";

export interface ParsedGsc {
  readonly rows: readonly GscRow[];
  /** Non-blank records that are neither the header nor a row: no query, or no metric that parses. */
  readonly skipped: number;
  /**
   * True when the columns were read from a recognised header's labels. False for
   * both "no header record" and "a header whose only known label is the query",
   * where the export's positional layout is assumed; that record is still
   * consumed as a header, so it is neither a row nor a skip.
   */
  readonly headerDetected: boolean;
  /**
   * Which metrics this parse has a column for (Q7). A view names the missing ones
   * from here and never infers them from the rows: a mapped column whose cells
   * are all blank or unreadable yields the same nulls as a column no header
   * named. With `headerDetected` false these are the positional assumption.
   */
  readonly recognized: Readonly<Record<GscMetric, boolean>>;
}

type Delimiter = "\t" | "," | ";";
type Metric = GscMetric;

interface Columns {
  readonly query: number;
  readonly clicks: number | null;
  readonly impressions: number | null;
  readonly ctr: number | null;
  readonly position: number | null;
}

interface DelimiterScore {
  readonly consistent: boolean;
  readonly numericCells: number;
}

/** Candidate order is the tie-break. */
const DELIMITERS: readonly Delimiter[] = ["\t", ",", ";"];
const DELIMITER_SAMPLE_RECORDS = 5;
const QUOTE = '"';
const INLINE_SPACE = /[^\S\r\n]/;
const BOM = "\uFEFF";
const HAS_DIGIT = /\p{Nd}/u;
const DIGITS = /^\d+$/;
const DOT_GROUPED = /^[1-9]\d{0,2}(?:\.\d{3})+$/;
const COMMA_GROUPED = /^[1-9]\d{0,2}(?:,\d{3})+$/;
const LAKH_GROUPED = /^[1-9]\d?(?:,\d{2})*,\d{3}$/;
const APOSTROPHE_GROUPED = /^\d{1,3}(?:['\u2019]\d{3})+$/;
const LONE_DECIMAL = /^\d+[.,]\d+$/;
const WHITESPACE = /\s/g;
const PERCENT = "%";
const POSITIONAL: Columns = { query: 0, clicks: 1, impressions: 2, ctr: 3, position: 4 };
/** Compared against `normQ(label)` (NFKC, lowercase, trimmed, spaces collapsed), so each label is written in that form: `ä` precomposed. */
const QUERY_LABELS: readonly string[] = [
  "top queries", "queries", "query", "热门查询", "查询", "häufigste suchanfragen", "suchanfragen", "suchanfrage",
];
const METRIC_LABELS: Readonly<Record<Metric, readonly string[]>> = {
  clicks: ["clicks", "点击次数", "klicks"],
  impressions: ["impressions", "展示次数", "impressionen"],
  ctr: ["ctr", "点击率", "klickrate"],
  position: ["position", "排名", "durchschnittliche position"],
};
/** Every supported label: a first record is a header only when one of its cells is one of these. */
const HEADER_LABELS: ReadonlySet<string> = new Set([...QUERY_LABELS, ...Object.values(METRIC_LABELS).flat()]);
const RANKED_MAX_POSITION = 10;
const BORDERLINE_MAX_POSITION = 30;
const DEMO_BRAND_KEY = "gengrowth";

/* ---------------- records ---------------- */

function skipPadding(text: string, from: number, delimiter: Delimiter): number {
  let i = from;
  while (i < text.length && text.charAt(i) !== delimiter && INLINE_SPACE.test(text.charAt(i))) {
    i += 1;
  }
  return i;
}

function isFieldEnd(text: string, at: number, delimiter: Delimiter): boolean {
  const char = text.charAt(at);
  return at >= text.length || char === delimiter || char === "\n" || char === "\r";
}

/**
 * Looks ahead from the opening quote at `openAt`. Null unless it is a
 * well-formed quoted field — closed, then only spaces before the field ends —
 * so the caller treats a stray quote (a query like `"hello` or `"best seo" tools`)
 * as text instead of letting it swallow the following lines into one record.
 * A well-formed field is kept whatever it holds, delimiters and line breaks
 * included, as RFC 4180 and `packages/sources/src/csv/parse.ts` keep it.
 */
function readQuoted(text: string, openAt: number, delimiter: Delimiter): { readonly value: string; readonly end: number } | null {
  let value = "";
  let i = openAt + 1;
  while (i < text.length) {
    const char = text.charAt(i);
    if (char !== QUOTE) {
      value += char;
      i += 1;
    } else if (text.charAt(i + 1) === QUOTE) {
      value += QUOTE;
      i += 2;
    } else {
      const end = skipPadding(text, i + 1, delimiter);
      return isFieldEnd(text, end, delimiter) ? { value, end } : null;
    }
  }
  return null;
}

/**
 * RFC 4180 records, ported from `packages/sources/src/csv/parse.ts` with the
 * delimiter as a parameter: quoted fields may hold delimiters, line breaks and
 * `""`; `\r\n`, `\n` and `\r` all end a record; empty lines yield nothing. A
 * quote opens a quoted field only at the start of a field (spaces allowed).
 */
function* scanRecords(text: string, delimiter: Delimiter): Generator<readonly string[]> {
  let record: readonly string[] = [];
  let field = "";
  let i = 0;
  while (i < text.length) {
    const char = text.charAt(i);
    const quoted = char === QUOTE && field.trim() === "" ? readQuoted(text, i, delimiter) : null;
    if (quoted !== null) {
      field = quoted.value;
      i = quoted.end;
    } else if (char === delimiter) {
      record = [...record, field];
      field = "";
      i += 1;
    } else if (char === "\n" || char === "\r") {
      if (record.length > 0 || field !== "") yield [...record, field];
      record = [];
      field = "";
      i += char === "\r" && text.charAt(i + 1) === "\n" ? 2 : 1;
    } else {
      field += char;
      i += 1;
    }
  }
  if (record.length > 0 || field !== "") yield [...record, field];
}

function isBlank(cells: readonly string[]): boolean {
  return cells.every((cell) => cell.trim() === "");
}

/** Records with at least one non-blank cell; whitespace- and delimiter-only lines carry nothing and are not counted. */
function* nonBlankRecords(text: string, delimiter: Delimiter): Generator<readonly string[]> {
  for (const cells of scanRecords(text, delimiter)) {
    if (!isBlank(cells)) yield cells;
  }
}

function* take<T>(source: Iterable<T>, limit: number): Generator<T> {
  let taken = 0;
  for (const item of source) {
    yield item;
    taken += 1;
    if (taken >= limit) return;
  }
}

/** A count, or a CTR with its trailing `%`. */
function readsAsNumber(cell: string): boolean {
  return parseCount(cell) !== null || parseCtr(cell) !== null;
}

function scoreDelimiter(text: string, delimiter: Delimiter): DelimiterScore {
  const sample = Array.from(take(nonBlankRecords(text, delimiter), DELIMITER_SAMPLE_RECORDS));
  const width = sample[0]?.length ?? 0;
  const numericCells = sample.reduce(
    (sum, cells) => sum + cells.slice(1, 5).filter(readsAsNumber).length,
    0,
  );
  return { consistent: width > 1 && sample.every((cells) => cells.length === width), numericCells };
}

function outranks(challenger: DelimiterScore, incumbent: DelimiterScore): boolean {
  if (challenger.consistent !== incumbent.consistent) return challenger.consistent;
  return challenger.numericCells > incumbent.numericCells;
}

/**
 * Scores each candidate over the first five non-blank records: a consistent
 * width of two or more cells first, then how many of cells 1-4 read as numbers.
 * Commas inside a query or in `0,8%` then cannot outvote a semicolon export.
 */
function detectDelimiter(text: string): Delimiter {
  const scored = DELIMITERS.map((delimiter) => ({ delimiter, score: scoreDelimiter(text, delimiter) }));
  return scored.reduce((best, next) => (outranks(next.score, best.score) ? next : best)).delimiter;
}

/* ---------------- numbers ---------------- */

function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

/** Drops every space, so `1 234` and `0,8 %` read; a `%` stays, and only `parseCtr` accepts one. */
function compactCell(cell: string | undefined): string {
  return (cell ?? "").replace(WHITESPACE, "");
}

function isCommaGrouped(value: string): boolean {
  return COMMA_GROUPED.test(value) || LAKH_GROUPED.test(value);
}

function parsePlain(compact: string): number | null {
  return DIGITS.test(compact) ? finiteOrNull(Number(compact)) : null;
}

function parseLoneDecimal(compact: string): number | null {
  return LONE_DECIMAL.test(compact) ? finiteOrNull(Number(compact.replace(",", "."))) : null;
}

/** Both `.` and `,` present: the last one is the decimal point and the other must group thousands. */
function parseMixed(compact: string): number | null {
  const decimal = compact.lastIndexOf(".") > compact.lastIndexOf(",") ? "." : ",";
  const at = compact.lastIndexOf(decimal);
  const whole = compact.slice(0, at);
  const fraction = compact.slice(at + 1);
  const grouped = decimal === "." ? isCommaGrouped(whole) : DOT_GROUPED.test(whole);
  if (!grouped || !DIGITS.test(fraction)) return null;
  return finiteOrNull(Number(`${whole.replace(/[.,]/g, "")}.${fraction}`));
}

/**
 * Clicks and impressions: valid grouping is thousands (`1,234`, `1.234.567`,
 * lakh `1,23,456`, Swiss `1'234` with an ASCII or U+2019 apostrophe; never a leading `0` group for `.`/`,`), a
 * single separator otherwise is the decimal point, anything else is unreadable.
 * Signs, exponents and `%` are not GSC counts.
 */
function parseCount(cell: string | undefined): number | null {
  const compact = compactCell(cell);
  if (APOSTROPHE_GROUPED.test(compact)) return finiteOrNull(Number(compact.replace(/['\u2019]/g, "")));
  const hasDot = compact.includes(".");
  const hasComma = compact.includes(",");
  if (hasDot && hasComma) return parseMixed(compact);
  if (DOT_GROUPED.test(compact) || isCommaGrouped(compact)) {
    return finiteOrNull(Number(compact.replace(/[.,]/g, "")));
  }
  return hasDot || hasComma ? parseLoneDecimal(compact) : parsePlain(compact);
}

/** CTR and position never reach 1,000, so a lone separator is always the decimal point (`1.125` is 1.125) and grouping is unreadable. */
function parseDecimal(compact: string): number | null {
  return parsePlain(compact) ?? parseLoneDecimal(compact);
}

/** CTR is a percent: one trailing `%` is allowed (`0,8 %`); a `%` anywhere else, or a second one, is unreadable. */
function parseCtr(cell: string | undefined): number | null {
  const compact = compactCell(cell);
  return parseDecimal(compact.endsWith(PERCENT) ? compact.slice(0, -PERCENT.length) : compact);
}

/** Ranks start at 1: a position of 0 or below is not a rank, so it is unavailable. */
function parsePosition(cell: string | undefined): number | null {
  const position = parseDecimal(compactCell(cell));
  return position !== null && position > 0 ? position : null;
}

/* ---------------- rows ---------------- */

/**
 * Only the first record can be a header: no digit anywhere, and at least one
 * cell that is a supported label. Digit-free cells alone are not enough:
 * `shoes - - - -` is a row with nothing available, and `Query,Position` is a
 * header with two columns.
 */
function isHeader(cells: readonly string[]): boolean {
  return !cells.some((cell) => HAS_DIGIT.test(cell)) && cells.some((cell) => HEADER_LABELS.has(normQ(cell)));
}

function labelIndex(labels: readonly string[], names: readonly string[]): number | null {
  const index = labels.findIndex((label) => names.includes(label));
  return index >= 0 ? index : null;
}

interface HeaderMapping {
  readonly columns: Columns;
  /** False when the positional layout was assumed rather than read from labels. */
  readonly fromLabels: boolean;
}

const POSITIONAL_MAPPING: HeaderMapping = { columns: POSITIONAL, fromLabels: false };

/**
 * The GSC web table's columns follow its metric toggles, so a header is read by
 * label; a metric without a column is null. A header whose only known label is
 * the query falls back to the export's positional layout.
 */
function headerColumns(header: readonly string[]): HeaderMapping {
  const labels = header.map(normQ);
  const metric = (name: Metric): number | null => labelIndex(labels, METRIC_LABELS[name]);
  const mapped: Columns = {
    query: labelIndex(labels, QUERY_LABELS) ?? 0,
    clicks: metric("clicks"),
    impressions: metric("impressions"),
    ctr: metric("ctr"),
    position: metric("position"),
  };
  const namesMetric = mapped.clicks !== null || mapped.impressions !== null || mapped.ctr !== null || mapped.position !== null;
  return namesMetric ? { columns: mapped, fromLabels: true } : POSITIONAL_MAPPING;
}

/** Derived from the mapping the rows were read with, so the two cannot disagree. */
function recognizedColumns(columns: Columns): Readonly<Record<GscMetric, boolean>> {
  return {
    clicks: columns.clicks !== null,
    impressions: columns.impressions !== null,
    ctr: columns.ctr !== null,
    position: columns.position !== null,
  };
}

/** Null when the record has no query or not one metric that parses (a lone query, a repeated header). */
function toRow(cells: readonly string[], columns: Columns): GscRow | null {
  const cellAt = (index: number | null): string | undefined => (index === null ? undefined : cells[index]);
  const query = (cellAt(columns.query) ?? "").trim();
  const row: GscRow = {
    query,
    clicks: parseCount(cellAt(columns.clicks)),
    impressions: parseCount(cellAt(columns.impressions)),
    ctr: parseCtr(cellAt(columns.ctr)),
    position: parsePosition(cellAt(columns.position)),
  };
  const hasMetric = row.clicks !== null || row.impressions !== null || row.ctr !== null || row.position !== null;
  return query !== "" && hasMetric ? row : null;
}

export function parseGsc(text: string): ParsedGsc {
  const body = text.startsWith(BOM) ? text.slice(BOM.length) : text;
  const records = Array.from(nonBlankRecords(body, detectDelimiter(body)));
  const [first, ...rest] = records;
  const header = first !== undefined && isHeader(first) ? first : null;
  const data = header === null ? records : rest;
  const mapping = header === null ? POSITIONAL_MAPPING : headerColumns(header);
  const rows = data.flatMap((cells) => {
    const parsed = toRow(cells, mapping.columns);
    return parsed === null ? [] : [parsed];
  });
  return {
    rows,
    skipped: data.length - rows.length,
    headerDetected: mapping.fromLabels,
    recognized: recognizedColumns(mapping.columns),
  };
}

/* ---------------- status ---------------- */

export function gscStatus(row: { readonly position?: number | null }): GscStatus {
  const { position } = row;
  if (position === undefined || position === null || !Number.isFinite(position) || position <= 0) {
    return "unknown";
  }
  if (position <= RANKED_MAX_POSITION) return "ranked";
  return position <= BORDERLINE_MAX_POSITION ? "borderline" : "gap";
}

export function countByGscStatus(
  rows: readonly { readonly position?: number | null }[],
): Readonly<Record<GscStatus, number>> {
  const statuses = rows.map(gscStatus);
  const count = (status: GscStatus): number => statuses.filter((value) => value === status).length;
  return { ranked: count("ranked"), borderline: count("borderline"), gap: count("gap"), unknown: count("unknown") };
}

/* ---------------- demo ---------------- */

/** The prototype's sample paste, verbatim (jsx:436-443). */
export const DEMO_GSC_TEXT = `ai visibility checker\t18\t2410\t0.7%\t14.2
geo optimization tool\t6\t1580\t0.4%\t22.8
llm seo checklist\t41\t3120\t1.3%\t8.4
how to rank in chatgpt\t2\t910\t0.2%\t31.5
answer engine optimization\t12\t2050\t0.6%\t16.9
gengrowth pricing\t63\t740\t8.5%\t2.1
content brief generator\t9\t1330\t0.7%\t18.3
best geo tools 2026\t4\t1120\t0.4%\t27.6`;

/** Sample rows for a project; queries naming GenGrowth only appear when the project is GenGrowth itself. */
export function demoGscRows(profile: Pick<Profile, "brand">): readonly GscRow[] {
  const { rows } = parseGsc(DEMO_GSC_TEXT);
  if (normQ(profile.brand) === DEMO_BRAND_KEY) return rows;
  return rows.filter((row) => !normQ(row.query).startsWith(DEMO_BRAND_KEY));
}
