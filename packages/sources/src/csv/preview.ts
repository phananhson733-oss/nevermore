/**
 * PREVIEW phase of the two-phase keyword-gap CSV import (spec §7.5). Parses the
 * uploaded `.csv` safely WITHOUT any canonical write and returns everything the
 * operator needs to confirm a mapping: the total data-row count, detected
 * columns, a suggested column -> canonical-field mapping, the first rows, and
 * file-level validation errors/warnings.
 *
 * Enforces the size (<= 20MB) and row (<= 200,000) caps before doing any real
 * work, throwing `SourceError("INVALID_CONFIGURATION")` past either limit.
 */

import { SourceError } from "../adapter.ts";
import { parseCsv } from "./parse.ts";
import {
  detectColumns,
  suggestMapping,
  type CsvColumnMapping,
  type DetectedColumn,
} from "./mapping.ts";

/** Only the keyword-gap template is supported in the MVP (spec §7.5). */
export const KEYWORD_GAP_TEMPLATE_ID = "keyword_gap_v1";

/** Maximum uploaded file size in bytes (20MB). Spec §7.5. */
export const MAX_CSV_BYTES = 20 * 1024 * 1024;

/** Number of leading data rows returned for preview. Spec §7.5. */
export const PREVIEW_ROW_LIMIT = 20;

export interface CsvValidationIssue {
  readonly code: string;
  readonly message: string;
  /** 0-based data-row index, or `null` for a file-level issue. */
  readonly rowIndex: number | null;
  readonly column: string | null;
}

export interface CsvPreviewResult {
  readonly rowCount: number;
  readonly detectedColumns: readonly DetectedColumn[];
  readonly suggestedMapping: CsvColumnMapping;
  readonly previewRows: readonly (readonly string[])[];
  readonly validationErrors: readonly CsvValidationIssue[];
  readonly validationWarnings: readonly CsvValidationIssue[];
}

const fileIssue = (code: string, message: string): CsvValidationIssue => ({
  code,
  message,
  rowIndex: null,
  column: null,
});

/**
 * Parse and inspect a keyword-gap CSV without writing anything. Rejects a
 * non-keyword-gap `templateId` and oversize/over-row uploads.
 */
export function previewCsv(text: string, templateId: string): CsvPreviewResult {
  if (templateId !== KEYWORD_GAP_TEMPLATE_ID) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      `unsupported csv templateId "${templateId}"; expected "${KEYWORD_GAP_TEMPLATE_ID}"`,
    );
  }

  const byteLength = Buffer.byteLength(text, "utf8");
  if (byteLength > MAX_CSV_BYTES) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      `csv is ${byteLength} bytes; the limit is ${MAX_CSV_BYTES} bytes`,
    );
  }

  const { headers, rows } = parseCsv(text);
  const detectedColumns = detectColumns(headers);
  const suggestedMapping = suggestMapping(headers);
  const previewRows = rows.slice(0, PREVIEW_ROW_LIMIT);

  const validationErrors: CsvValidationIssue[] = [];
  const validationWarnings: CsvValidationIssue[] = [];

  if (headers.length === 0) {
    validationErrors.push(fileIssue("no_columns", "The file has no header row."));
  }
  if (rows.length === 0) {
    validationErrors.push(fileIssue("no_data_rows", "The file has no data rows."));
  }
  if (suggestedMapping.keyword === null) {
    validationWarnings.push(
      fileIssue("keyword_unmapped", "Could not auto-detect a keyword column; map it manually."),
    );
  }
  if (suggestedMapping.searchVolume === null) {
    validationWarnings.push(
      fileIssue("search_volume_unmapped", "Could not auto-detect a search volume column; map it manually."),
    );
  }
  if (suggestedMapping.marketCode === null) {
    validationWarnings.push(
      fileIssue("market_unmapped", "Could not auto-detect a market/country column; map it or set a default."),
    );
  }
  if (suggestedMapping.languageCode === null) {
    validationWarnings.push(
      fileIssue("language_unmapped", "Could not auto-detect a language column; map it or set a default."),
    );
  }
  previewRows.forEach((row, index) => {
    if (headers.length > 0 && row.length !== headers.length) {
      validationWarnings.push({
        code: "ragged_row",
        message: `Row ${index + 1} has ${row.length} columns; expected ${headers.length}.`,
        rowIndex: index,
        column: null,
      });
    }
  });

  return {
    rowCount: rows.length,
    detectedColumns,
    suggestedMapping,
    previewRows,
    validationErrors,
    validationWarnings,
  };
}
