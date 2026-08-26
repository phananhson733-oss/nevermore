// @input  -- one v3 competitor gap envelope, selected GSC property, and focus callback
// @output -- compact DFS/GSC evidence table with competitor pages, one qualified next action per row, a reading-order toggle, and the capped CSV export
// @pos    -- non-persistent result surface for the Marketing competitor gap tool

"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type {
  CompetitorKeywordGapEnvelope,
  CompetitorKeywordGapMetric,
  CompetitorKeywordGapResultV3,
} from "@sf/public-tools/competitor-keyword-gap";

import {
  CoverageDetails,
  EvidenceBoundaries,
} from "./competitor-keyword-gap-coverage";
import { CsvExportButton } from "./competitor-keyword-gap-csv-button";
import {
  ACTION_BUTTON,
  BADGE,
  CARD,
  CHIP_TEXT,
  COLUMN_BADGE,
  COLUMN_BADGE_TONE,
  KEYWORD_TEXT,
  PRIMARY_ACTION_BUTTON,
  TABLE_TEXT,
  number,
  translated,
  type Translate,
} from "./competitor-keyword-gap-results-shared";
import { RowActionCell } from "./competitor-keyword-gap-row-actions";
import {
  CompetitorChips,
  SignalChips,
  StatusCell,
} from "./competitor-keyword-gap-row-chips";
import {
  COMPETITOR_KEYWORD_GAP_SORTS,
  sortCompetitorKeywordGapRows,
  type CompetitorKeywordGapSort,
} from "./competitor-keyword-gap-sort";

function capturedTime(value: string, locale: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function providerIntent(value: string | null, t: Translate): string {
  const normalized = value?.trim() ?? "";
  if (normalized === "") return translated(t, "intent.unknown");
  const canonical = normalized.toLowerCase();
  if (
    canonical === "informational" ||
    canonical === "navigational" ||
    canonical === "commercial" ||
    canonical === "transactional"
  ) {
    return translated(t, `intent.${canonical}`);
  }
  return normalized.slice(0, 64);
}

function metric(
  value: CompetitorKeywordGapMetric,
  locale: string,
  maximumFractionDigits = 0,
): string {
  if (value.value === null || value.availability === "provider_no_data") {
    return "—";
  }
  return number(value.value, locale, maximumFractionDigits);
}

function ReportContext({
  envelope,
  locale,
  t,
}: {
  readonly envelope: CompetitorKeywordGapEnvelope;
  readonly locale: string;
  readonly t: Translate;
}) {
  const status = envelope.run.status;
  const warning = status !== "complete";
  const { result } = envelope;
  return (
    <section
      data-run-status={status}
      className={
        warning
          ? "rounded-card border border-brand-warning/30 bg-brand-warning/[0.08] p-[22px]"
          : CARD
      }
    >
      <div className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
        {t("summary.eyebrow")}
      </div>
      <h3 className="mt-3 text-[20px] font-semibold tracking-[-0.03em] text-text-dark-primary">
        {t("summary.title")}
      </h3>
      {status === "unavailable" ? (
        // The per-run status sentences were removed on purpose, but this case
        // cannot go with them: when no competitor returned, the card is an
        // orange frame with no text and the count below it reads 0, which a
        // reader takes as "these competitors rank for nothing". It says the
        // opposite -- nothing was read, so nothing was ruled out.
        <p
          data-run-unavailable
          className="mt-3 text-[12.5px] leading-[1.6] text-text-dark-secondary"
        >
          {t("status.unavailableBody")}
        </p>
      ) : null}
      <div
        data-scope-strip
        className="mt-5 flex flex-wrap items-center gap-2 border-t border-brand-border-card pt-4"
      >
        <span className={BADGE}>{result.siteDomain}</span>
        <span
          data-scope-versus
          className="font-mono text-[11px] text-text-dark-secondary"
        >
          {t("summary.versus")}
        </span>
        {result.competitorDomains.map((domain) => (
          <span key={domain} className={BADGE}>
            {domain}
          </span>
        ))}
        <span className={BADGE}>
          {result.marketCode} · {result.languageCode}
        </span>
        <span className="text-[11.5px] text-text-dark-secondary">
          {t("summary.capturedAt")}{" "}
          <time dateTime={result.capturedAt}>
            {capturedTime(result.capturedAt, locale)}
          </time>
        </span>
      </div>
    </section>
  );
}

/**
 * Two cards, and the second is not filler.
 *
 * The run summary above states no counters at all any more, so this is the only
 * place the surface says how much of the run came back. Without the completed
 * count, a run where three of four competitors failed reads exactly like a
 * complete one -- same table, same gap total, no sign anything is missing.
 *
 * There is no "new this period" card and there cannot be one: this tool keeps
 * no history and never refreshes on its own, as its own evidence boundary says,
 * so there is no earlier run to compare this one against.
 */
function OverviewCards({
  result,
  locale,
  t,
}: {
  readonly result: CompetitorKeywordGapResultV3;
  readonly locale: string;
  readonly t: Translate;
}) {
  const cards = [
    {
      metric: "returned-gap-rows",
      label: t("overview.returnedGapRows"),
      value: number(result.rows.length, locale),
      // The rank bound comes from the run's own sample rule rather than a
      // number typed into the sentence: a rule change would otherwise leave
      // this card describing a cut the run did not make.
      body: t("overview.returnedGapRowsBody", {
        maxRank: result.sampleRule.maxCompetitorRank,
      }),
    },
    {
      metric: "completed-competitors",
      label: t("overview.completedCompetitors"),
      value: `${number(result.completedCompetitors, locale)} / ${number(
        result.requestedCompetitors,
        locale,
      )}`,
      body: t("overview.completedCompetitorsBody"),
    },
  ] as const;

  return (
    <section data-overview-metrics className="grid gap-4 md:grid-cols-2">
      {cards.map((card) => (
        <article
          key={card.metric}
          data-summary-metric={card.metric}
          className={CARD}
        >
          <div className="font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase">
            {card.label}
          </div>
          <div className="mt-3 text-[34px] font-semibold tracking-[-0.04em] text-text-dark-primary">
            {card.value}
          </div>
          <div className="mt-2 text-[12.5px] leading-[1.6] text-text-dark-secondary">
            {card.body}
          </div>
        </article>
      ))}
    </section>
  );
}

function ResultsTable({
  result,
  locale,
  selectedProperty,
  onFocusProperty,
  t,
}: {
  readonly result: CompetitorKeywordGapResultV3;
  readonly locale: string;
  readonly selectedProperty: string;
  readonly onFocusProperty: () => void;
  readonly t: Translate;
}) {
  const [sort, setSort] = useState<CompetitorKeywordGapSort>("impressions");
  const [expanded, setExpanded] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const sortedRows = useMemo(
    () => sortCompetitorKeywordGapRows(result.rows, sort),
    [result.rows, sort],
  );
  const visibleRows = expanded ? sortedRows : sortedRows.slice(0, 10);
  const remaining = Math.max(0, sortedRows.length - visibleRows.length);

  /**
   * The collapse resets with the order.
   *
   * "The first ten" means something different in each order, and leaving a
   * hundred rows expanded across the change hands the reader a screen where the
   * order they pressed is no longer the reason for what they are looking at.
   */
  function changeSort(next: CompetitorKeywordGapSort): void {
    // Pressing the toggle that is already pressed changes no order, so it must
    // not throw away an expanded table and send the reader back to the top.
    if (next === sort) return;
    setSort(next);
    setExpanded(false);
    setActionError(null);
  }

  return (
    <section
      data-results-table
      className={`${CARD} relative left-1/2 w-[calc(100vw-32px)] max-w-[1440px] -translate-x-1/2`}
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3
            id="competitor-keyword-gap-table-title"
            className="text-[16px] font-semibold text-text-dark-primary"
          >
            {t("table.title")}
          </h3>
          <div className="mt-1 text-[12.5px] leading-[1.6] text-text-dark-secondary">
            {t("table.subtitle")}
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-3">
          <div
            data-table-legend
            className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-[1.6] text-text-dark-secondary"
          >
            <span className={`${COLUMN_BADGE} !ml-0 ${COLUMN_BADGE_TONE.dfs}`}>
              {t("sources.short.dfs")}
            </span>
            <span>{t("legend.dfsMeans")}</span>
            <span aria-hidden="true">·</span>
            <span className={`${COLUMN_BADGE} !ml-0 ${COLUMN_BADGE_TONE.gsc}`}>
              {t("sources.short.gsc")}
            </span>
            <span>{t("legend.gscMeans")}</span>
          </div>
          <CsvExportButton result={result} t={t} />
        </div>
      </div>

      <div
        className="mb-4 flex flex-wrap items-center justify-end gap-2"
        data-sort-toggles
      >
        {COMPETITOR_KEYWORD_GAP_SORTS.map((value) => (
          <button
            key={value}
            type="button"
            data-sort-toggle={value}
            aria-pressed={value === sort}
            onClick={() => changeSort(value)}
            className={
              value === sort
                ? `${PRIMARY_ACTION_BUTTON} !py-1.5`
                : `${ACTION_BUTTON} !py-1.5`
            }
          >
            {translated(t, `sort.${value}`)}
          </button>
        ))}
      </div>

      <div
        tabIndex={0}
        aria-labelledby="competitor-keyword-gap-table-title"
        className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
      >
        <table
          className={`min-w-[1080px] w-full border-collapse text-left ${TABLE_TEXT}`}
        >
          <caption className="sr-only">{t("table.caption")}</caption>
          <thead>
            <tr className="border-b border-brand-border-strong">
              {(
                [
                  ["keyword", null],
                  ["monthlySearchVolume", "dfs"],
                  ["competitorCoverage", "dfs"],
                  ["yourStatus", "gsc"],
                  // No column badge: this column mixes provider estimates with
                  // this tool's own heuristics, so the basis belongs on the
                  // pre-screen chip that varies, not on the whole column.
                  ["opportunitySignals", null],
                  ["nextAction", null],
                ] as const
              ).map(([column, source]) => (
                <th
                  key={column}
                  scope="col"
                  className="px-3 py-3 font-mono text-[11px] tracking-[0.07em] whitespace-nowrap uppercase text-text-dark-secondary"
                >
                  <span data-column-label>
                    {translated(t, `table.${column}`)}
                  </span>
                  {source === null ? null : (
                    <span
                      data-column-source={source}
                      className={`${COLUMN_BADGE} ${COLUMN_BADGE_TONE[source]}`}
                    >
                      {translated(t, `sources.short.${source}`)}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr
                key={row.keyword}
                className="border-b border-brand-border-card align-top last:border-0"
              >
                <td className="px-3 py-4">
                  <div
                    data-keyword
                    className={`${KEYWORD_TEXT} break-words [overflow-wrap:anywhere]`}
                  >
                    {row.keyword}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className={CHIP_TEXT}>
                      {providerIntent(row.providerIntent, t)}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-4">
                  <div
                    data-monthly-volume
                    className={`${TABLE_TEXT} font-mono font-semibold tabular-nums whitespace-nowrap text-text-dark-primary`}
                  >
                    {metric(row.searchVolume, locale)}
                  </div>
                </td>
                <td className="px-3 py-4">
                  <CompetitorChips row={row} />
                </td>
                <td className="px-3 py-4">
                  <StatusCell row={row} locale={locale} t={t} />
                </td>
                <td className="px-3 py-4">
                  <SignalChips row={row} locale={locale} t={t} />
                </td>
                <td className="px-3 py-4">
                  <RowActionCell
                    row={row}
                    result={result}
                    locale={locale}
                    selectedProperty={selectedProperty}
                    onFocusProperty={onFocusProperty}
                    onActionError={setActionError}
                    t={t}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {actionError !== null ? (
        <div
          role="alert"
          aria-live="assertive"
          className="mt-4 text-[12.5px] text-brand-error"
        >
          {actionError}
        </div>
      ) : null}

      {sortedRows.length > 10 ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-[12.5px] text-text-dark-secondary">
            {expanded
              ? t("actions.showingAll", { count: sortedRows.length })
              : t("actions.remaining", { count: remaining })}
          </div>
          <button
            type="button"
            className={ACTION_BUTTON}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? t("actions.showLess") : t("actions.showAll")}
          </button>
        </div>
      ) : null}
    </section>
  );
}

export interface CompetitorKeywordGapResultsProps {
  readonly envelope: CompetitorKeywordGapEnvelope;
  readonly locale: string;
  readonly selectedProperty: string;
  readonly onFocusProperty: () => void;
}

export function CompetitorKeywordGapResults({
  envelope,
  locale,
  selectedProperty,
  onFocusProperty,
}: CompetitorKeywordGapResultsProps) {
  const t = useTranslations("tools.competitorKeywordGap");
  const { result } = envelope;

  return (
    <div className="mt-8 space-y-4">
      <ReportContext envelope={envelope} locale={locale} t={t} />
      <OverviewCards result={result} locale={locale} t={t} />

      {result.rows.length > 0 ? (
        <ResultsTable
          result={result}
          locale={locale}
          selectedProperty={selectedProperty}
          onFocusProperty={onFocusProperty}
          t={t}
        />
      ) : envelope.run.status !== "unavailable" ? (
        <section className={CARD}>
          <h3 className="text-[16px] font-semibold text-text-dark-primary">
            {t("empty.title")}
          </h3>
          <div className="mt-2 text-[12.5px] leading-[1.6] text-text-dark-secondary">
            {t("empty.body")}
          </div>
        </section>
      ) : null}
      <CoverageDetails envelope={envelope} locale={locale} t={t} />
      <EvidenceBoundaries t={t} />
    </div>
  );
}
