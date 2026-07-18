/**
 * A dependency-free RFC 4180 CSV parser (spec §7.5). Handles quoted fields,
 * embedded commas/newlines, and `""` escaped quotes; tolerates both LF and
 * CRLF line endings and skips fully-blank lines. The FIRST record is the header
 * row; every subsequent record is a data row.
 *
 * Pure and deterministic (no IO, no ambient state). The data-row count is
 * capped so a hostile or accidental multi-million-row upload cannot exhaust
 * memory before the two-phase import even validates it (spec §7.5).
 */

import { SourceError } from "../adapter.ts";

/** Hard cap on data rows (excludes the header record). Spec §7.5. */
export const MAX_CSV_DATA_ROWS = 200_000;

export interface ParseCsvOptions {
  /** Override the data-row cap (used by tests). Defaults to MAX_CSV_DATA_ROWS. */
  readonly maxDataRows?: number;
}

export interface ParsedCsv {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/**
 * Parse RFC 4180 CSV text into a header record plus data records. Throws
 * `SourceError("INVALID_CONFIGURATION")` when the data-row cap is exceeded.
 */
export function parseCsv(text: string, options?: ParseCsvOptions): ParsedCsv {
  const maxDataRows = options?.maxDataRows ?? MAX_CSV_DATA_ROWS;
  const records: string[][] = [];
  const pushRecord = (record: string[]): void => {
    records.push(record);
    if (records.length - 1 > maxDataRows) {
      throw new SourceError(
        "INVALID_CONFIGURATION",
        `csv exceeds the ${maxDataRows}-data-row limit`,
      );
    }
  };

  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let dirty = false;
  const length = text.length;
  let i = 0;

  while (i < length) {
    const char = text.charAt(i);
    if (inQuotes) {
      if (char === '"') {
        if (text.charAt(i + 1) === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      dirty = true;
      i += 1;
      continue;
    }
    if (char === ",") {
      record.push(field);
      field = "";
      dirty = true;
      i += 1;
      continue;
    }
    if (char === "\n" || char === "\r") {
      if (dirty || record.length > 0 || field !== "") {
        record.push(field);
        pushRecord(record);
      }
      field = "";
      record = [];
      dirty = false;
      i += char === "\r" && text.charAt(i + 1) === "\n" ? 2 : 1;
      continue;
    }
    field += char;
    dirty = true;
    i += 1;
  }

  if (dirty || record.length > 0 || field !== "") {
    record.push(field);
    pushRecord(record);
  }

  const [headerRecord, ...dataRecords] = records;
  return { headers: headerRecord ?? [], rows: dataRecords };
}
