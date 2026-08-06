// @input  -- one QuickWinsResult and the locale of the page showing it
// @output -- the filterable, sortable evidence table, its CSV export, and its footnotes
// @pos    -- presentation only; sorting and filtering compute nothing new
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

"use client";

import { Fragment, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import type { QuickWinTrack, QuickWinsResult } from "@sf/public-tools";
// The CSV builder by its own path, not through the package barrel. The barrel
// re-exports the run pipeline, which reaches `@sf/sources` and `node:net`, and
// pulling a value through it drags all of that into the browser bundle — the
// production build fails outright rather than shipping it.
import {
  evidenceCsv,
  evidenceCsvFilename,
} from "@sf/public-tools/quick-wins/csv";
import { trackCounts } from "@sf/public-tools/quick-wins/track";
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

/** Filter order, matching the summary tiles: most actionable first. */
const TRACK_ORDER: readonly QuickWinTrack[] = [
  "compare_with_own_page",
  "read_the_serp",
  "band_is_the_story",
  "gap_within_noise",
  "at_or_above_curve",
];

/**
 * Badge styling per path.
 *
 * Only the two that lead somewhere are coloured. `gap_within_noise` and
 * `at_or_above_curve` are answers of "nothing here", and a table where every
 * row wears a bright chip has no emphasis left to spend on the rows that do.
 */
const TRACK_BADGE: Record<QuickWinTrack, string> = {
  compare_with_own_page: "bg-brand-accent/15 text-brand-accent-text",
  read_the_serp: "bg-brand-info/15 text-brand-info",
  band_is_the_story: "bg-brand-warning/15 text-brand-warning",
  gap_within_noise:
    "border border-brand-border-strong text-text-dark-secondary",
  at_or_above_curve:
    "border border-brand-border-strong text-text-dark-secondary",
};

/** Numeric cells: mono and lining, so a column of rates reads as a column. */
const NUMERIC_CELL =
  "px-3 py-2.5 text-right font-mono text-[12px] tabular-nums";

/**
 * The filter that is actually in force, dropped when this run has no rows on it.
 *
 * A second run replaces the rows without remounting the table, so a filter
 * chosen against the previous result survives into one where its path is
 * empty. By then the chip for it is gone — the chip list only renders paths
 * that have rows — which leaves an empty table, no visible filter, and no
 * control to clear it. The visitor's last choice is kept in state so it comes
 * back if a later run does have those rows; what is derived here is only
 * whether it applies right now.
 */
export function activeTrack(
  selected: QuickWinTrack | null,
  counts: Readonly<Record<QuickWinTrack, number>>,
): QuickWinTrack | null {
  if (selected === null) return null;
  return counts[selected] > 0 ? selected : null;
}

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
  const [selected, setSelected] = useState<QuickWinTrack | null>(null);

  const counts = useMemo(() => trackCounts(result.rows), [result.rows]);

  const track = activeTrack(selected, counts);

  const rows = useMemo(() => {
    const filtered =
      track === null
        ? result.rows
        : result.rows.filter((row) => row.track === track);
    return sortEvidenceRows(filtered, sort);
  }, [result.rows, sort, track]);

  const hasBandCaveat = rows.some((row) => row.baselineBandUnderOnePercent);

  return (
    <section className="rounded-card border border-brand-border-card bg-brand-panel p-[22px] md:p-[26px]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-[16.5px] font-semibold text-text-dark-primary">
            {t("tableTitle")}
          </h3>
          <p className="mt-1.5 max-w-[52em] text-[12.5px] leading-[1.6] text-text-dark-secondary">
            {t("tableIntro")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => downloadCsv(result)}
          className="inline-flex h-11.5 shrink-0 items-center gap-2 rounded-[10px] border border-brand-border-strong bg-brand-panel/60 px-5 text-[13px] font-medium text-text-dark-primary transition-colors hover:border-brand-accent/50"
        >
          <Download aria-hidden="true" className="size-4" />
          {t("download")}
        </button>
      </div>

      {/*
        Filters, not tabs: the export and the counts always describe the whole
        run. A reader who narrows to one path and then downloads gets every row,
        which is the only version of the file that can be diffed against
        another run.
      */}
      <div className="mt-5 flex flex-wrap gap-2">
        <FilterChip
          label={t("trackFilterAll")}
          count={formatCount(result.rows.length, locale)}
          active={track === null}
          onClick={() => setSelected(null)}
        />
        {TRACK_ORDER.filter((candidate) => counts[candidate] > 0).map(
          (candidate) => (
            <FilterChip
              key={candidate}
              label={t(`tracks.${candidate}.label`)}
              count={formatCount(counts[candidate], locale)}
              active={track === candidate}
              onClick={() =>
                setSelected(track === candidate ? null : candidate)
              }
            />
          ),
        )}
      </div>

      {track !== null ? (
        <p
          role="status"
          className="mt-3 max-w-[52em] rounded-[10px] border border-brand-border bg-brand-panel-sunken p-3.5 text-[12.5px] leading-[1.6] text-text-dark-secondary"
        >
          {t(`tracks.${track}.hint`)}
        </p>
      ) : null}

      <div className="mt-4 overflow-x-auto rounded-card border border-brand-border-card">
        <table className="w-full min-w-[860px] text-left text-[13px]">
          <caption className="sr-only">{t("tableCaption")}</caption>
          <thead className="bg-brand-panel-sunken font-mono text-[10px] font-normal tracking-[0.1em] text-text-dark-secondary uppercase">
            <tr>
              {COLUMNS.map((column, index) => (
                <Fragment key={column.key}>
                  <th
                    scope="col"
                    aria-sort={ariaSort(sort, column.key)}
                    className={
                      column.numeric ? "font-medium text-right" : "font-medium"
                    }
                  >
                    {/*
                    A button, not a click handler on the cell: sorting a table
                    is an action, and an action a keyboard cannot reach is not
                    one this table offers.
                  */}
                    <button
                      type="button"
                      onClick={() => setSort(nextSort(sort, column.key))}
                      title={t("sortBy", {
                        column: t(`columns.${column.key}`),
                      })}
                      className={`flex min-h-9 w-full items-center gap-1 px-3 py-2.5 transition-colors hover:text-brand-accent-text ${
                        column.numeric ? "justify-end" : ""
                      } ${sort.key === column.key ? "text-text-dark-primary" : ""}`}
                    >
                      {t(`columns.${column.key}`)}
                      <span
                        aria-hidden="true"
                        className="text-[9px] opacity-70"
                      >
                        {sort.key === column.key
                          ? sort.direction === "asc"
                            ? "▲"
                            : "▼"
                          : ""}
                      </span>
                    </button>
                  </th>
                  {/*
                  Second, not last. It is the column that says what to do, and
                  the table is 860px wide inside a horizontal scroller — last
                  would put the answer nine columns off the right edge of a
                  phone, which is a small rerun of the problem this column was
                  added to solve.
                */}
                  {index === 0 ? (
                    <th scope="col" className="px-3 py-2.5 font-medium">
                      {t("columns.track")}
                    </th>
                  ) : null}
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.query}
                className="border-t border-brand-border-faint align-top"
              >
                <td className="px-3 py-2.5 text-text-dark-primary">
                  {row.query}
                  {row.baselineBandUnderOnePercent ? (
                    <span
                      aria-describedby={BAND_NOTE_ID}
                      className="ml-2 rounded border border-brand-warning/40 px-1.5 py-[2px] font-mono text-[9.5px] text-brand-warning"
                    >
                      {row.bucketId}
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2.5">
                  <span
                    className={`inline-block whitespace-nowrap rounded px-2 py-[3px] font-mono text-[9.5px] tracking-[0.08em] uppercase ${TRACK_BADGE[row.track]}`}
                  >
                    {t(`tracks.${row.track}.label`)}
                  </span>
                </td>
                <td className={`${NUMERIC_CELL} text-text-dark-secondary`}>
                  {formatPosition(row.position, locale)}
                </td>
                <td className={`${NUMERIC_CELL} text-text-dark-secondary`}>
                  {formatCount(row.impressions, locale)}
                </td>
                <td className={`${NUMERIC_CELL} text-text-dark-secondary`}>
                  {formatCount(row.clicks, locale)}
                </td>
                <td className={`${NUMERIC_CELL} text-text-dark-primary`}>
                  {formatPercent(row.observedCtr, locale)}
                </td>
                <td className={`${NUMERIC_CELL} text-text-dark-secondary`}>
                  {formatPercent(row.baselineCtr, locale)}
                </td>
                <td className={`${NUMERIC_CELL} text-text-dark-primary`}>
                  {formatGap(row.clickGap, locale)}
                </td>
                <td className={`${NUMERIC_CELL} text-text-dark-secondary`}>
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
          className="mt-3 max-w-[52em] text-[12.5px] leading-[1.6] text-text-dark-secondary"
        >
          {t("bandWarning")}
        </p>
      ) : null}
      <p className="mt-3 max-w-[52em] text-[12.5px] leading-[1.6] text-text-dark-secondary">
        {t("gapNote")}
      </p>
      <p className="mt-2 max-w-[52em] text-[12.5px] leading-[1.6] text-text-dark-secondary">
        {t("tailNote")}
      </p>
      <p className="mt-2 max-w-[52em] text-[12.5px] leading-[1.6] text-text-dark-secondary">
        {t("downloadNote")}
      </p>
    </section>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  readonly label: string;
  readonly count: string;
  readonly active: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 py-1.5 font-mono text-[10px] tracking-[0.06em] uppercase transition-colors ${
        active
          ? "border-brand-accent/50 bg-brand-accent/12 text-brand-accent-text"
          : "border-brand-border-strong text-text-dark-secondary hover:border-brand-accent/50 hover:text-text-dark-primary"
      }`}
    >
      {label}
      <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}
