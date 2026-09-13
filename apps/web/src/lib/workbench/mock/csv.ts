/** CSV for exports (R7). Formula-leading strings are neutralised; numbers are not (so -5 stays a number). */
export type CsvValue = string | number | boolean | null | undefined;

const FORMULA_LEAD = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "yes" : "no";
  const text = FORMULA_LEAD.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** LF-separated, no BOM, no trailing newline; the header is escaped like any row. */
export function toCsv(
  header: readonly string[],
  rows: readonly (readonly CsvValue[])[],
): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}
