// @input  -- one QuickWinsResult and the locale of the page showing it
// @output -- the sortable evidence table, its CSV export, and its footnotes
// @pos    -- presentation only; sorting reorders rows and computes nothing new
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

"use client";

import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import type { QuickWinsResult } from "@sf/public-tools";
// The CSV builder by its own path, not through the package barrel. The barrel
// re-exports the run pipeline, which reaches `@sf/sources` and `node:net`, and
// pulling a value through it drags all of that into the browser bundle — the
// production build fails outright rather than shipping it.
import {
  evidenceCsv,
  evidenceCsvFilename,
} from "@sf/public-tools/quick-wins/csv";
// Relative, not `@/`: the unit runner maps `@/` to the OTHER app, so a
// component reached through it is unimportable from a test. See vitest.config.
import {
  DEFAULT_SORT,
  ariaSort,
  nextSort,
  sortEvidenceRows,
  type QuickWinsSort,
  type QuickWinsSortKey,
} from "../../lib/tools/quick-wins-sort";
import {
  formatCount,
  formatGap,
  formatPercent,
  formatPosition,
  formatTail,
} from "../../lib/tools/quick-wins-format";

/** The id the band badges point at, so the caveat is read and not hovered. */
const BAND_NOTE_ID = "quick-wins-band-note";

const COLUMNS: readonly {
  readonly key: QuickWinsSortKey;
  readonly numeric: boolean;
}[] = [
  { key: "query", numeric: false },
  { key: "position", numeric: true },
  { key: "impressions", numeric: true },
  { key: "clicks", numeric: true },
  { key: "observedCtr", numeric: true },
  { key: "baselineCtr", numeric: true },
  { key: "clickGap", numeric: true },
  { key: "tailProbability", numeric: true },
];

/**
 * Hand the visitor the file.
 *
 * The object URL is released on the next tick rather than immediately: Safari
 * has revoked the blob out from under its own download when the two happen in
 * the same task.
 */
function downloadCsv(result: QuickWinsResult): void {
  const blob = new Blob([evidenceCsv(result)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = evidenceCsvFilename(result.window);
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function QuickWinsEvidenceTable({
  result,
  locale,
}: {
  readonly result: QuickWinsResult;
  readonly locale: string;
}) {
  const t = useTranslations("tools.quickWins");
  const [sort, setSort] = useState<QuickWinsSort>(DEFAULT_SORT);
  const rows = useMemo(
    () => sortEvidenceRows(result.rows, sort),
    [result.rows, sort],
  );
  const hasBandCaveat = result.rows.some(
    (row) => row.baselineBandUnderOnePercent,
  );

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-text-dark-primary">
            {t("tableTitle")}
          </h3>
          <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-text-dark-secondary">
            {t("tableIntro")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => downloadCsv(result)}
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-brand-border/70 px-4 text-[13px] font-semibold text-text-dark-primary transition-colors hover:bg-brand-bg-alt/60"
        >
          <Download aria-hidden="true" className="size-4" />
          {t("download")}
        </button>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-brand-border/60">
        <table className="w-full min-w-[720px] text-left text-[13px]">
          <caption className="sr-only">{t("tableCaption")}</caption>
          <thead className="bg-brand-bg-alt/50 text-[12px] text-text-dark-secondary">
            <tr>
              {COLUMNS.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={ariaSort(sort, column.key)}
                  className={`font-medium ${column.numeric ? "text-right" : ""}`}
                >
                  {/*
                    A button, not a click handler on the cell: sorting a table
                    is an action, and an action a keyboard cannot reach is not
                    one this table offers.
                  */}
                  <button
                    type="button"
                    onClick={() => setSort(nextSort(sort, column.key))}
                    title={t("sortBy", { column: t(`columns.${column.key}`) })}
                    className={`flex min-h-9 w-full items-center gap-1 px-3 py-2.5 transition-colors hover:text-text-dark-primary ${
                      column.numeric ? "justify-end" : ""
                    } ${sort.key === column.key ? "text-text-dark-primary" : ""}`}
                  >
                    {t(`columns.${column.key}`)}
                    <span aria-hidden="true" className="text-[10px] opacity-70">
                      {sort.key === column.key
                        ? sort.direction === "asc"
                          ? "▲"
                          : "▼"
                        : ""}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.query}
                className="border-t border-brand-border/40 align-top"
              >
                <td className="px-3 py-2.5 text-text-dark-primary">
                  {row.query}
                  {row.baselineBandUnderOnePercent ? (
                    <span
                      aria-describedby={BAND_NOTE_ID}
                      className="ml-2 rounded border border-brand-warning/40 px-1.5 py-0.5 text-[11px] text-text-dark-secondary"
                    >
                      {row.bucketId}
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-text-dark-secondary">
                  {formatPosition(row.position, locale)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-text-dark-secondary">
                  {formatCount(row.impressions, locale)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-text-dark-secondary">
                  {formatCount(row.clicks, locale)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-text-dark-primary">
                  {formatPercent(row.observedCtr, locale)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-text-dark-secondary">
                  {formatPercent(row.baselineCtr, locale)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-text-dark-primary">
                  {formatGap(row.clickGap, locale)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-text-dark-secondary">
                  {formatTail(row.tailProbability, locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/*
        The band caveat used to live only in a `title` attribute, which a touch
        screen never shows and a screen reader reaches inconsistently. It is a
        condition on how the rows above should be read, so it is written down.
      */}
      {hasBandCaveat ? (
        <p
          id={BAND_NOTE_ID}
          className="mt-3 max-w-2xl text-[12px] leading-relaxed text-text-dark-secondary"
        >
          {t("bandWarning")}
        </p>
      ) : null}
      <p className="mt-3 max-w-2xl text-[12px] leading-relaxed text-text-dark-secondary">
        {t("gapNote")}
      </p>
      <p className="mt-2 max-w-2xl text-[12px] leading-relaxed text-text-dark-secondary">
        {t("tailNote")}
      </p>
      <p className="mt-2 max-w-2xl text-[12px] leading-relaxed text-text-dark-secondary">
        {t("downloadNote")}
      </p>
    </section>
  );
}
