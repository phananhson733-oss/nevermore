// @input  -- the whole v3 result and the tool translator
// @output -- one button that hands the visitor every returned gap row as a CSV file
// @pos    -- the file export control in the Marketing competitor gap results table header

"use client";

import type { CompetitorKeywordGapResultV3 } from "@sf/public-tools/competitor-keyword-gap";
// The narrow subpath, never the `@sf/public-tools/competitor-keyword-gap`
// barrel: that barrel re-exports the report builder, which drags node-only
// modules into this browser chunk. Typecheck and the unit suite both pass on
// the barrel spelling; only `next build` fails, naming this component rather
// than the import.
import {
  competitorKeywordGapCsv,
  competitorKeywordGapCsvFilename,
} from "@sf/public-tools/competitor-keyword-gap/csv";

import {
  ACTION_BUTTON,
  type Translate,
} from "./competitor-keyword-gap-results-shared";

/**
 * Hand the visitor the file.
 *
 * The object URL is released on the next tick rather than immediately: Safari
 * has revoked the blob out from under its own download when the two happen in
 * the same task.
 */
function downloadCsv(result: CompetitorKeywordGapResultV3): void {
  const blob = new Blob([competitorKeywordGapCsv(result)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = competitorKeywordGapCsvFilename(result);
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * The label states the count because the file ignores every filter.
 *
 * The table shows ten rows of whatever lane and band are selected; this export
 * carries `result.rows` entire, which is the only version of the file that can
 * be diffed against another run. Two controls sit side by side here and they do
 * different things, so each one names its own number: the plan copies what is
 * on screen, this exports all of it, and a reader can tell which is which
 * without clicking either.
 */
export function CsvExportButton({
  result,
  t,
}: {
  readonly result: CompetitorKeywordGapResultV3;
  readonly t: Translate;
}) {
  return (
    <button
      type="button"
      data-export-csv
      className={`${ACTION_BUTTON} disabled:cursor-not-allowed disabled:opacity-50`}
      disabled={result.rows.length === 0}
      onClick={() => downloadCsv(result)}
    >
      {t("actions.exportCsv", { count: result.rows.length })}
    </button>
  );
}
