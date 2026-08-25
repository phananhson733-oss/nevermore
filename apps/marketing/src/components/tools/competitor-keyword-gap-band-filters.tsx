// @input  -- the lane-filtered rows, the pressed band, the viewer locale, and a change callback
// @output -- one pressed-state chip per contract pre-screen band with its in-lane count
// @pos    -- band filter row for the Marketing competitor gap results table

import {
  COMPETITOR_KEYWORD_GAP_PRE_SCREEN_BANDS,
  type CompetitorKeywordGapPreScreenBand,
  type CompetitorKeywordGapRow,
} from "@sf/public-tools/competitor-keyword-gap";

import {
  ACTION_BUTTON,
  PRIMARY_ACTION_BUTTON,
  number,
  translated,
  type Translate,
} from "./competitor-keyword-gap-results-shared";

export type BandFilter = "all" | CompetitorKeywordGapPreScreenBand;

export function BandFilters({
  rows,
  band,
  locale,
  onChange,
  t,
}: {
  readonly rows: readonly CompetitorKeywordGapRow[];
  readonly band: BandFilter;
  readonly locale: string;
  readonly onChange: (next: BandFilter) => void;
  readonly t: Translate;
}) {
  const options: readonly (readonly [BandFilter, number])[] = [
    ["all", rows.length],
    ...COMPETITOR_KEYWORD_GAP_PRE_SCREEN_BANDS.map(
      (value) =>
        [
          value,
          rows.filter((row) => row.preScreen.band === value).length,
        ] as const,
    ),
  ];
  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-2"
      data-pre-screen-filters
    >
      <span className="mr-1 font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase">
        {t("preScreen.title")}
      </span>
      {options.map(([value, count]) => (
        <button
          key={value}
          type="button"
          data-pre-screen-filter={value}
          aria-pressed={value === band}
          onClick={() => onChange(value)}
          className={
            value === band
              ? `${PRIMARY_ACTION_BUTTON} !py-1.5`
              : `${ACTION_BUTTON} !py-1.5`
          }
        >
          {value === "all"
            ? t("preScreen.filterAll")
            : translated(t, `preScreen.band.${value}`)}{" "}
          · {number(count, locale)}
        </button>
      ))}
    </div>
  );
}
