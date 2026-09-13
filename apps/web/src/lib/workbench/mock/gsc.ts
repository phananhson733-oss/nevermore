/**
 * Pasted Search Console performance data (R12): an RFC 4180 record scanner with
 * a detected delimiter, locale-aware numbers, a header recognised by its
 * non-numeric cells, and an honest count of every record that did not become a
 * row. `ctr` stays a percent (0.7 means 0.7%). A number that is missing or
 * cannot be read is `null`, never 0.
 */
import type { GscRow, GscStatus, Profile } from "../types.ts";
import { normQ } from "./text.ts";

export interface ParsedGsc {
  readonly rows: readonly GscRow[];
  /** Non-blank records that are neither the header nor a row: no query, or no metric that parses. */
  readonly skipped: number;
}

type Delimiter = "\t" | "," | ";";

const QUOTE = '"';
const INLINE_SPACE = /[^\S\r\n]/;
const BOM = "\uFEFF";
const DIGITS = /^\d+$/;
const DOT_GROUPED = /^[1-9]\d{0,2}(?:\.\d{3})+$/;
const COMMA_GROUPED = /^[1-9]\d{0,2}(?:,\d{3})+$/;
const LONE_DECIMAL = /^\d+[.,]\d+$/;
const NUMBER_NOISE = /[%\s]/g;
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
function* records(text: string, delimiter: Delimiter): Generator<readonly string[]> {
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

function firstRecordWidth(text: string, delimiter: Delimiter): number {
  for (const cells of records(text, delimiter)) {
    if (!isBlank(cells)) return cells.length;
  }
  return 0;
}

/**
 * Tab when the first record splits on tabs; otherwise whichever of `;` and `,`
 * splits it into more cells, commas on a tie. Counting cells rather than asking
 * "is there a comma" keeps a semicolon export with comma decimals (`0,8%`) intact.
 */
function detectDelimiter(text: string): Delimiter {
  if (firstRecordWidth(text, "\t") > 1) return "\t";
  return firstRecordWidth(text, ";") > firstRecordWidth(text, ",") ? ";" : ",";
}

/* ---------------- numbers ---------------- */

function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

/** Both `.` and `,` present: the last one is the decimal point and the other must group thousands. */
function parseMixed(compact: string): number | null {
  const decimal = compact.lastIndexOf(".") > compact.lastIndexOf(",") ? "." : ",";
  const at = compact.lastIndexOf(decimal);
  const whole = compact.slice(0, at);
  const fraction = compact.slice(at + 1);
  const grouped = decimal === "." ? COMMA_GROUPED : DOT_GROUPED;
  if (!grouped.test(whole) || !DIGITS.test(fraction)) return null;
  return finiteOrNull(Number(`${whole.replace(/[.,]/g, "")}.${fraction}`));
}

/**
 * One kind of separator: valid thousands grouping (`1,234`, `1.234.567`; never a
 * leading `0` group) is thousands, a single separator otherwise is the decimal
 * point (`0,8`, `0.123`, `1234,567`), and anything else is unreadable.
 */
function parseSingleSeparator(compact: string): number | null {
  if (DOT_GROUPED.test(compact) || COMMA_GROUPED.test(compact)) {
    return finiteOrNull(Number(compact.replace(/[.,]/g, "")));
  }
  return LONE_DECIMAL.test(compact) ? finiteOrNull(Number(compact.replace(",", "."))) : null;
}

/** A plain non-negative GSC number in any common locale spelling; `%` and spaces are ignored. Signs and exponents are not GSC numbers. */
function parseNumber(cell: string | undefined): number | null {
  const compact = (cell ?? "").replace(NUMBER_NOISE, "");
  if (compact === "") return null;
  const hasDot = compact.includes(".");
  const hasComma = compact.includes(",");
  if (hasDot && hasComma) return parseMixed(compact);
  if (hasDot || hasComma) return parseSingleSeparator(compact);
  return DIGITS.test(compact) ? finiteOrNull(Number(compact)) : null;
}

/** Ranks start at 1: a position of 0 or below is not a rank, so it is unavailable. */
function parsePosition(cell: string | undefined): number | null {
  const position = parseNumber(cell);
  return position !== null && position > 0 ? position : null;
}

/* ---------------- rows ---------------- */

function isTextCell(cell: string | undefined): boolean {
  return cell !== undefined && cell.trim() !== "" && parseNumber(cell) === null;
}

/** Only the first record can be a header: at least 3 cells, and both the clicks and impressions cells are non-empty text. */
function isHeader(cells: readonly string[]): boolean {
  return cells.length >= 3 && isTextCell(cells[1]) && isTextCell(cells[2]);
}

/** Null when the record has no query or not one metric that parses (a lone query, a repeated header). */
function toRow(cells: readonly string[]): GscRow | null {
  const query = (cells[0] ?? "").trim();
  const row: GscRow = {
    query,
    clicks: parseNumber(cells[1]),
    impressions: parseNumber(cells[2]),
    ctr: parseNumber(cells[3]),
    position: parsePosition(cells[4]),
  };
  const hasMetric = row.clicks !== null || row.impressions !== null || row.ctr !== null || row.position !== null;
  return query !== "" && hasMetric ? row : null;
}

export function parseGsc(text: string): ParsedGsc {
  const body = text.startsWith(BOM) ? text.slice(BOM.length) : text;
  const delimiter = detectDelimiter(body);
  const nonBlank = Array.from(records(body, delimiter)).filter((cells) => !isBlank(cells));
  const [first, ...rest] = nonBlank;
  const data = first !== undefined && isHeader(first) ? rest : nonBlank;
  const rows = data.flatMap((cells) => {
    const parsed = toRow(cells);
    return parsed === null ? [] : [parsed];
  });
  return { rows, skipped: data.length - rows.length };
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
