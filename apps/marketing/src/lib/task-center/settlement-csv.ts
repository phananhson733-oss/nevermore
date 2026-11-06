// @input  -- the text of a settlement CSV an admin uploaded, and the currency they picked for it
// @output -- validated rows in integer minor units, or every problem found, by line
// @pos    -- the only reader of settlement files; earnings-store.ts writes what this accepts
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
//
// The platforms' own export format is not known yet, so this reads our
// template: a header row, then one row per promo code per day.
//
//   date,code,orders,ad_amount,income
//   2026-11-04,k7m2xq9p,12,30.50,8.25
//
// Chinese headers (日期, 推广码, 订单数, 广告金额, 收益) work too. An empty cell
// is "the file did not say": it is stored as null and shown as "—".
//
// Anything that could be read two ways is refused rather than guessed: a
// column named twice, a row with more cells than the header, even empty
// ones (an unquoted 1,000.00 splits into two), and text after a closing quote.

import { normalizePromoCode } from "./contracts.ts";

export const MAX_SETTLEMENT_ROWS = 20_000;
export const MAX_SETTLEMENT_BYTES = 2 * 1024 * 1024;

export interface SettlementRow {
  readonly day: string;
  readonly code: string;
  readonly orders: number | null;
  readonly adAmountMinor: number | null;
  readonly incomeMinor: number | null;
}

export interface SettlementProblem {
  /** 1-based line in the file; 1 is the header. */
  readonly line: number;
  readonly problem:
    | "missing_columns"
    | "bad_date"
    | "bad_code"
    | "bad_orders"
    | "bad_ad_amount"
    | "bad_income"
    | "no_figures"
    | "duplicate_row"
    | "too_many_rows"
    | "too_large"
    | "empty_file"
    | "unbalanced_quotes"
    | "text_after_quote"
    | "duplicate_column"
    | "extra_cells";
}

export type SettlementParse =
  | { readonly ok: true; readonly rows: readonly SettlementRow[] }
  | { readonly ok: false; readonly problems: readonly SettlementProblem[] };

type Column = "day" | "code" | "orders" | "adAmount" | "income";

const HEADER_ALIASES: Readonly<Record<string, Column>> = {
  date: "day",
  day: "day",
  日期: "day",
  code: "code",
  promo_code: "code",
  推广码: "code",
  口令码: "code",
  orders: "orders",
  订单数: "orders",
  订单: "orders",
  ad_amount: "adAmount",
  广告金额: "adAmount",
  income: "income",
  收益: "income",
};

/** Report at most this many problems; a wrong file usually fails on every line. */
const MAX_PROBLEMS = 20;

export function isKnownCurrency(code: string): boolean {
  return /^[A-Z]{3}$/.test(code) && Intl.supportedValuesOf("currency").includes(code);
}

/** Digits after the decimal point for this currency: 2 for USD, 0 for JPY. */
export function currencyExponent(currency: string): number {
  return (
    new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}

/** "30.5" in USD is 3050. Done on the string, so no float ever rounds a cent. */
export function toMinorUnits(raw: string, exponent: number): number | null {
  const pattern = exponent === 0 ? /^(\d+)$/ : new RegExp(`^(\\d+)(?:\\.(\\d{1,${exponent}}))?$`);
  const match = raw.match(pattern);
  if (match === null) return null;
  const whole = match[1]!;
  const fraction = (match[2] ?? "").padEnd(exponent, "0");
  const minor = Number(`${whole}${fraction}`);
  return Number.isSafeInteger(minor) ? minor : null;
}

function normalizeDay(raw: string): string | null {
  const match = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (match === null) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

type ParsedRecords =
  | { readonly ok: true; readonly records: string[][]; readonly lines: number[] }
  | { readonly ok: false; readonly line: number; readonly problem: "unbalanced_quotes" | "text_after_quote" };

/** RFC 4180 records: quoted fields may hold commas, newlines and "" for a quote. */
function parseRecords(text: string): ParsedRecords {
  const records: string[][] = [];
  const lines: number[] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        const after = text[i + 1];
        if (after === '"') {
          field += '"';
          i += 1;
        } else if (after === undefined || after === "," || after === "\n" || after === "\r") {
          quoted = false;
        } else {
          // "1"2 would otherwise read as 12.
          return { ok: false, line, problem: "text_after_quote" };
        }
      } else {
        if (char === "\n") line += 1;
        field += char;
      }
      continue;
    }
    if (char === '"' && field === "") {
      quoted = true;
    } else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      record.push(field);
      records.push(record);
      lines.push(recordLine);
      field = "";
      record = [];
      line += 1;
      recordLine = line;
    } else {
      field += char;
    }
  }
  if (quoted) return { ok: false, line: recordLine, problem: "unbalanced_quotes" };
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
    lines.push(recordLine);
  }
  return { ok: true, records, lines };
}

export function parseSettlementCsv(text: string, currency: string): SettlementParse {
  // The limit is on the file's UTF-8 bytes; text.length counts UTF-16 units.
  if (new TextEncoder().encode(text).byteLength > MAX_SETTLEMENT_BYTES) {
    return { ok: false, problems: [{ line: 1, problem: "too_large" }] };
  }
  const parsed = parseRecords(text.replace(/^\uFEFF/, ""));
  if (!parsed.ok) {
    return { ok: false, problems: [{ line: parsed.line, problem: parsed.problem }] };
  }
  const nonEmpty = parsed.records
    .map((cells, index) => ({ cells, line: parsed.lines[index]! }))
    .filter(({ cells }) => cells.some((cell) => cell.trim() !== ""));
  const [header, ...body] = nonEmpty;
  if (header === undefined || body.length === 0) {
    return { ok: false, problems: [{ line: 1, problem: "empty_file" }] };
  }
  if (body.length > MAX_SETTLEMENT_ROWS) {
    return { ok: false, problems: [{ line: 1, problem: "too_many_rows" }] };
  }

  const index = new Map<Column, number>();
  let duplicate = false;
  header.cells.forEach((cell, position) => {
    const column = HEADER_ALIASES[cell.trim().toLowerCase()];
    if (column === undefined) return;
    // income and 收益 side by side: which one is the figure?
    if (index.has(column)) duplicate = true;
    else index.set(column, position);
  });
  if (duplicate) {
    return { ok: false, problems: [{ line: header.line, problem: "duplicate_column" }] };
  }
  const hasFigure = index.has("orders") || index.has("adAmount") || index.has("income");
  if (!index.has("day") || !index.has("code") || !hasFigure) {
    return { ok: false, problems: [{ line: header.line, problem: "missing_columns" }] };
  }

  const exponent = currencyExponent(currency);
  const problems: SettlementProblem[] = [];
  const rows: SettlementRow[] = [];
  const seen = new Set<string>();
  const cell = (cells: readonly string[], column: Column): string => {
    const position = index.get(column);
    return position === undefined ? "" : (cells[position] ?? "").trim();
  };
  const report = (line: number, problem: SettlementProblem["problem"]) => {
    if (problems.length < MAX_PROBLEMS) problems.push({ line, problem });
  };

  for (const { cells, line } of body) {
    // Fewer cells than the header only leaves trailing figures empty; more
    // means a value split in two, and every cell after it may have shifted,
    // even when the cell pushed past the end is the empty one.
    if (cells.length > header.cells.length) {
      report(line, "extra_cells");
      continue;
    }
    const day = normalizeDay(cell(cells, "day"));
    if (day === null) {
      report(line, "bad_date");
      continue;
    }
    const code = normalizePromoCode(cell(cells, "code"));
    if (code === null) {
      report(line, "bad_code");
      continue;
    }
    const rawOrders = cell(cells, "orders");
    const orders = rawOrders === "" ? null : /^\d{1,9}$/.test(rawOrders) ? Number(rawOrders) : undefined;
    if (orders === undefined) {
      report(line, "bad_orders");
      continue;
    }
    const rawAd = cell(cells, "adAmount");
    const adAmountMinor = rawAd === "" ? null : toMinorUnits(rawAd, exponent) ?? undefined;
    if (adAmountMinor === undefined) {
      report(line, "bad_ad_amount");
      continue;
    }
    const rawIncome = cell(cells, "income");
    const incomeMinor = rawIncome === "" ? null : toMinorUnits(rawIncome, exponent) ?? undefined;
    if (incomeMinor === undefined) {
      report(line, "bad_income");
      continue;
    }
    if (orders === null && adAmountMinor === null && incomeMinor === null) {
      report(line, "no_figures");
      continue;
    }
    const key = `${code} ${day}`;
    if (seen.has(key)) {
      report(line, "duplicate_row");
      continue;
    }
    seen.add(key);
    rows.push({ day, code, orders, adAmountMinor, incomeMinor });
  }

  return problems.length > 0 ? { ok: false, problems } : { ok: true, rows };
}
