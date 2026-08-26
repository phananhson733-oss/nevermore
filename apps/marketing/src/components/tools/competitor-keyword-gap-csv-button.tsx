// @input  -- the whole v3 result and the tool translator
// @output -- one button that hands the visitor the capped keyword CSV, and the line naming which keywords are in it
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
  competitorKeywordGapCsvRowCount,
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
 * The label counts what the FILE will hold, never what the run returned.
 *
 * The export is capped and ordered by the provider's search volume estimate, so
 * a 653-row run produces a 150-row file. The old label said "export all 653
 * rows" and was false past the cap. The count alone still leaves "which 150?"
 * unanswered, so the line under the button names the rule the cut was made on;
 * neither half is enough by itself.
 *
 * The count comes from the export module rather than being recomputed here: a
 * label that derives the cap a second way is a label that can drift from the
 * file it describes.
 */
export function CsvExportButton({
  result,
  t,
}: {
  readonly result: CompetitorKeywordGapResultV3;
  readonly t: Translate;
}) {
  const rowCount = competitorKeywordGapCsvRowCount(result);
  // Two different sentences, because below the cap nothing was left out. Saying
  // the file "holds the highest-volume keywords" when it holds every one of
  // them understates it, and the zh wording was outright exclusive ("only
  // includes"). Below the cap the line can only claim the ORDER, which is true.
  const basis =
    rowCount < result.rows.length
      ? t("actions.exportCsvBasisCapped", { count: rowCount })
      : t("actions.exportCsvBasisComplete");
  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        data-export-csv
        className={`${ACTION_BUTTON} disabled:cursor-not-allowed disabled:opacity-50`}
        disabled={rowCount === 0}
        onClick={() => downloadCsv(result)}
      >
        {t("actions.exportCsv", { count: rowCount })}
      </button>
      <div
        data-export-csv-basis
        className="max-w-[280px] text-[11.5px] leading-[1.5] text-text-dark-secondary"
      >
        {basis}
      </div>
      {result.unavailableCompetitors > 0 ? (
        // The nine columns carry no run coverage, so a partial run's file is
        // shaped exactly like a complete one and its competitor-rank cells read
        // as evidence the missing competitors do not rank. The file cannot say
        // so; this line, next to the control that produces it, can.
        <div
          data-export-csv-partial
          className="max-w-[280px] text-[11.5px] leading-[1.5] text-brand-warning"
        >
          {t("actions.exportCsvPartial", {
            count: result.unavailableCompetitors,
          })}
        </div>
      ) : null}
    </div>
  );
}
