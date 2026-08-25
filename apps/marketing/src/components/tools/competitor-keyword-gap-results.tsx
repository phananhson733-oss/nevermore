// @input  -- one v3 competitor gap envelope, selected GSC property, and focus callback
// @output -- compact DFS/GSC evidence table with competitor pages, pre-screen bands, qualified next actions, and a copy-rows-as-plan export
// @pos    -- non-persistent result surface for the Marketing competitor gap tool

"use client";

import { useState, type MouseEvent as ReactMouseEvent } from "react";
import { useTranslations } from "next-intl";
import type {
  CompetitorKeywordGapEnvelope,
  CompetitorKeywordGapMetric,
  CompetitorKeywordGapResultV3,
  CompetitorKeywordGapRow,
} from "@sf/public-tools/competitor-keyword-gap";

import { localePath } from "../../lib/locale-path";
import { writeToolHandoff } from "../../lib/tools/tool-handoff";
import {
  BandFilters,
  type BandFilter,
} from "./competitor-keyword-gap-band-filters";
import {
  bestCompetitorPageHost,
  bestCompetitorPageUrl,
} from "./competitor-keyword-gap-competitor-pages";
import { CopyPlanButton } from "./competitor-keyword-gap-copy-plan-button";
import {
  CoverageDetails,
  EvidenceBoundaries,
} from "./competitor-keyword-gap-coverage";
import {
  ACTION_BUTTON,
  BADGE,
  CARD,
  CHIP_TEXT,
  COLUMN_BADGE,
  COLUMN_BADGE_TONE,
  KEYWORD_TEXT,
  META_TEXT,
  PRIMARY_ACTION_BUTTON,
  TABLE_TEXT,
  number,
  safePageUrl,
  translated,
  type Translate,
} from "./competitor-keyword-gap-results-shared";
import {
  CompetitorChips,
  SignalChips,
} from "./competitor-keyword-gap-row-chips";

type Filter = "all" | CompetitorKeywordGapRow["gsc"]["nextStep"];

function capturedTime(value: string, locale: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function pagePath(value: string | null): string | null {
  const page = safePageUrl(value);
  if (page === null) return null;
  const url = new URL(page);
  return `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`;
}

/**
 * The path alone, for a button that has to name the page it opens without
 * pushing every other column off the screen. The host is this visitor's own
 * site in every case, so repeating it buys nothing; the full `hostname + path`
 * still goes in the link title.
 */
const ACTION_PATH_MAX = 28;

function ownPagePath(value: string | null): string | null {
  const page = safePageUrl(value);
  if (page === null) return null;
  const { pathname } = new URL(page);
  const path = pathname === "" ? "/" : pathname;
  return path.length <= ACTION_PATH_MAX
    ? path
    : `${path.slice(0, ACTION_PATH_MAX - 1)}\u2026`;
}

/**
 * Display order for the lanes, matching the filter row above the table so the
 * two never disagree about which lane comes first.
 */
const LANE_ORDER = [
  "optimize_existing",
  "review_existing_query",
  "review_content_gap",
  "verify_own_coverage",
] as const satisfies readonly CompetitorKeywordGapRow["gsc"]["nextStep"][];

/**
 * The lanes actually on screen, so each lane's sentence is stated ONCE.
 *
 * It used to sit in every row. A site with no Search Console hits puts every
 * row in one lane, so the column was the same sentence 553 times -- noise that
 * crowded out the one thing that did vary, which is the row's own next action.
 * Stating it per lane keeps the reasoning and drops the repetition: at most
 * four lines here, never one per row.
 */
function lanesPresent(
  rows: readonly CompetitorKeywordGapRow[],
): readonly CompetitorKeywordGapRow["gsc"]["nextStep"][] {
  const present = new Set(rows.map((row) => row.gsc.nextStep));
  return LANE_ORDER.filter((lane) => present.has(lane));
}

/** Stable and bounded; the full keyword remains only in the validated payload. */
function evidenceIdFor(row: CompetitorKeywordGapRow): string {
  let fingerprint = 0x811c9dc5;
  for (let index = 0; index < row.keyword.length; index += 1) {
    fingerprint ^= row.keyword.charCodeAt(index);
    fingerprint = Math.imul(fingerprint, 0x01000193);
  }
  return `competitor-gap:${(fingerprint >>> 0).toString(16).padStart(8, "0")}:${row.gsc.pageStatus}`;
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

function dfsStatus(result: CompetitorKeywordGapResultV3) {
  if (result.completedCompetitors === 0) return "unavailable";
  return result.completedCompetitors < result.requestedCompetitors
    ? "partial"
    : "available";
}

function SourceBadge({
  source,
  status,
  t,
}: {
  readonly source: "dfs" | "gsc";
  readonly status: string;
  readonly t: Translate;
}) {
  return (
    <span data-source={source} data-source-status={status} className={BADGE}>
      {translated(t, `sources.${source}`)} ·{" "}
      {translated(t, `sources.status.${status}`)}
    </span>
  );
}

/**
 * Why this run is `partial`, derived rather than asserted.
 *
 * The single stock sentence used to say "at least one competitor is
 * unavailable" for every partial run, including the common one where all
 * competitors completed and only the optional GSC overlay was missing -- the
 * surface stated a competitor failure that the same card's own counters
 * disproved two lines below. Nothing here is new contract data: the three
 * causes are already distinguishable from the counters and the overlay status.
 *
 * `unspecified` is not reachable from today's report builder, which only marks
 * a run partial when one of the three holds. It exists so that a future status
 * rule cannot make this function assert a cause it has not established.
 */
function partialCause(
  result: CompetitorKeywordGapResultV3,
): "competitors" | "gscUnavailable" | "gscPartial" | "both" | "unspecified" {
  const competitorsIncomplete =
    result.completedCompetitors < result.requestedCompetitors;
  const overlayDegraded =
    result.overlayStatus === "unavailable" || result.overlayStatus === "partial";
  if (competitorsIncomplete && overlayDegraded) return "both";
  if (competitorsIncomplete) return "competitors";
  if (!overlayDegraded) return "unspecified";
  return result.overlayStatus === "partial" ? "gscPartial" : "gscUnavailable";
}

function statusBody(
  status: CompetitorKeywordGapEnvelope["run"]["status"],
  result: CompetitorKeywordGapResultV3,
  t: Translate,
): string {
  return status === "partial"
    ? translated(t, `status.partialBody.${partialCause(result)}`)
    : translated(t, `status.${status}Body`);
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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
            {t("summary.eyebrow")}
          </div>
          <h3 className="mt-3 text-[20px] font-semibold tracking-[-0.03em] text-text-dark-primary">
            {t("summary.title")}
          </h3>
          <div className="mt-2 text-[12.5px] leading-[1.6] text-text-dark-secondary">
            {translated(t, `status.${status}`)} ·{" "}
            {statusBody(status, result, t)}
          </div>
          <div className="mt-1 text-[12px] text-text-dark-secondary">
            {t("summary.competitors", {
              completed: result.completedCompetitors,
              requested: result.requestedCompetitors,
            })}{" "}
            ·{" "}
            {t("summary.unavailable", { count: result.unavailableCompetitors })}
          </div>
        </div>
      </div>
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

function OverviewCards({
  result,
  locale,
  t,
}: {
  readonly result: CompetitorKeywordGapResultV3;
  readonly locale: string;
  readonly t: Translate;
}) {
  const observedRows =
    result.overlayStatus === "available" || result.overlayStatus === "partial"
      ? result.rows.filter(
          (row) =>
            row.gsc.queryStatus === "observed_strong" ||
            row.gsc.queryStatus === "observed_weak",
        ).length
      : null;
  const gscQueryRows = observedRows === null ? null : result.gscQueryRowCount;
  const cards = [
    {
      metric: "returned-gap-rows",
      label: t("overview.returnedGapRows"),
      value: number(result.rows.length, locale),
      body: t("overview.returnedGapRowsBody"),
      gscQueryRows: null,
    },
    {
      metric: "completed-competitors",
      label: t("overview.completedCompetitors"),
      value: `${number(result.completedCompetitors, locale)} / ${number(
        result.requestedCompetitors,
        locale,
      )}`,
      body: t("overview.completedCompetitorsBody"),
      gscQueryRows: null,
    },
    {
      metric: "gsc-observed-rows",
      label: t("overview.gscObservedRows"),
      value: observedRows === null ? "—" : number(observedRows, locale),
      body:
        observedRows === null
          ? t(`sources.status.${result.overlayStatus}`)
          : t("overview.gscObservedRowsBody"),
      gscQueryRows:
        gscQueryRows === null
          ? null
          : t("overview.gscQueryRows", { count: gscQueryRows }),
    },
  ] as const;

  return (
    <section data-overview-metrics className="grid gap-4 md:grid-cols-3">
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
          {card.gscQueryRows !== null ? (
            <div
              data-gsc-query-rows
              className="mt-1 text-[12.5px] leading-[1.6] text-text-dark-secondary"
            >
              {card.gscQueryRows}
            </div>
          ) : null}
        </article>
      ))}
    </section>
  );
}

function statusTone(
  status: CompetitorKeywordGapRow["gsc"]["queryStatus"],
): string {
  switch (status) {
    case "observed_strong":
      return "border-brand-success/35 bg-brand-success/10 text-brand-success";
    case "observed_weak":
      return "border-brand-warning/35 bg-brand-warning/10 text-brand-warning";
    case "not_observed_in_gsc_query_sample":
      return "border-brand-error/25 bg-brand-error/[0.06] text-brand-error";
    case "gsc_query_sample_not_read":
      return "border-brand-border-strong bg-brand-panel-sunken text-text-dark-secondary";
  }
}

/**
 * What this row's cell offers, and what it is about to open.
 *
 * The lane still decides the verb -- that has not changed and is still GSC's
 * call alone. What changed is that the label now names the OBJECT: the page
 * Search Console attributed to this query, or the competitor whose page the
 * link opens. "Check the existing page" repeated down a column tells a reader
 * nothing they cannot already see in the status chip; "/pricing" tells them
 * where to go.
 */
type RowAction =
  | { readonly kind: "checker"; readonly label: string; readonly page: string }
  | { readonly kind: "page"; readonly label: string; readonly page: string }
  | {
      readonly kind: "competitor";
      readonly label: string;
      readonly href: string;
    }
  | { readonly kind: "copy"; readonly label: string }
  | { readonly kind: "focus"; readonly label: string };

interface RowActions {
  readonly primary: RowAction;
  readonly secondary: RowAction | null;
}

function rowActions(
  row: CompetitorKeywordGapRow,
  selectedProperty: string,
  t: Translate,
): RowActions {
  const copy: RowAction = { kind: "copy", label: t("actions.copyKeyword") };
  if (row.gsc.nextStep === "verify_own_coverage") {
    return {
      primary: { kind: "focus", label: t("actions.focusProperty") },
      secondary: null,
    };
  }
  if (row.gsc.nextStep === "review_content_gap") {
    const href = bestCompetitorPageUrl(row);
    const host = bestCompetitorPageHost(row);
    return href === null || host === null
      ? { primary: copy, secondary: null }
      : {
          primary: {
            kind: "competitor",
            href,
            label: t("actions.openCompetitorPageNamed", { domain: host }),
          },
          secondary: copy,
        };
  }

  // Both remaining lanes have query-level GSC evidence. The only thing that
  // separates them here is whether the page attribution is complete enough to
  // hand the On-Page Checker a page to audit.
  const page = safePageUrl(row.gsc.pageUrl);
  const path = ownPagePath(row.gsc.pageUrl);
  if (page === null || path === null) return { primary: copy, secondary: null };
  return selectedProperty !== "" &&
    row.gsc.pageStatus === "observed_sufficient"
    ? {
        primary: {
          kind: "checker",
          page,
          label: t("actions.optimizeObservedPage", { page: path }),
        },
        secondary: null,
      }
    : {
        primary: {
          kind: "page",
          page,
          label: t("actions.reviewObservedPage", { page: path }),
        },
        secondary: null,
      };
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
  const counts = {
    all: result.rows.length,
    optimize_existing: result.rows.filter(
      (row) => row.gsc.nextStep === "optimize_existing",
    ).length,
    review_existing_query: result.rows.filter(
      (row) => row.gsc.nextStep === "review_existing_query",
    ).length,
    review_content_gap: result.rows.filter(
      (row) => row.gsc.nextStep === "review_content_gap",
    ).length,
    verify_own_coverage: result.rows.filter(
      (row) => row.gsc.nextStep === "verify_own_coverage",
    ).length,
  } as const;
  const [filter, setFilter] = useState<Filter>("all");
  const [band, setBand] = useState<BandFilter>("all");
  const [expanded, setExpanded] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const laneRows =
    filter === "all"
      ? result.rows
      : result.rows.filter((row) => row.gsc.nextStep === filter);
  const filteredRows =
    band === "all"
      ? laneRows
      : laneRows.filter((row) => row.preScreen.band === band);
  const visibleRows = expanded ? filteredRows : filteredRows.slice(0, 10);
  const remaining = Math.max(0, filteredRows.length - visibleRows.length);
  // visibleRows, not filteredRows: a collapsed row is not on screen, and a
  // lane note above an empty lane describes something the reader cannot see.
  const noticeLanes = lanesPresent(visibleRows);

  function changeFilter(next: Filter): void {
    setFilter(next);
    setExpanded(false);
    setActionError(null);
  }

  function changeBandFilter(next: BandFilter): void {
    setBand(next);
    setExpanded(false);
    setActionError(null);
  }

  async function copyKeyword(keyword: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(keyword);
      setActionError(null);
    } catch {
      setActionError(t("actions.copyFailed"));
    }
  }

  function focusProperty(): void {
    onFocusProperty();
    setActionError(null);
  }

  function prepareCheckerHandoff(
    event: ReactMouseEvent<HTMLAnchorElement>,
    row: CompetitorKeywordGapRow,
    pageUrl: string,
  ): void {
    try {
      if (
        !writeToolHandoff(window.sessionStorage, Date.now(), {
          source: "competitor-keyword-gap",
          destination: "on-page-seo-check",
          scope: "query_page",
          property: selectedProperty,
          query: row.keyword,
          page: pageUrl,
          evidenceId: evidenceIdFor(row),
          marketCode: result.marketCode,
          languageCode: result.languageCode,
        })
      ) {
        event.preventDefault();
        setActionError(t("actions.handoffFailed"));
        return;
      }
      setActionError(null);
    } catch {
      event.preventDefault();
      setActionError(t("actions.handoffFailed"));
    }
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
        <div className="flex flex-wrap items-center gap-3">
          <div
            data-table-legend
            className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-[1.6] text-text-dark-secondary"
          >
            <span
              className={`${COLUMN_BADGE} !ml-0 ${COLUMN_BADGE_TONE.dfs}`}
            >
              {t("sources.short.dfs")}
            </span>
            <span>{t("legend.dfsMeans")}</span>
            <span aria-hidden="true">·</span>
            <span className={`${COLUMN_BADGE} !ml-0 ${COLUMN_BADGE_TONE.gsc}`}>
              {t("sources.short.gsc")}
            </span>
            <span>{t("legend.gscMeans")}</span>
          </div>
          {/* Keyed on the filter so a copied-count status never outlives the rows it counted. */}
          <CopyPlanButton
            key={`${filter}|${band}`}
            result={result}
            rows={visibleRows}
            rowsNotShown={remaining}
            laneFilter={filter}
            bandFilter={band}
            locale={locale}
            onActionError={setActionError}
            t={t}
          />
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2" data-next-step-filters>
        {(
          [
            ["all", counts.all],
            ["optimize_existing", counts.optimize_existing],
            ["review_existing_query", counts.review_existing_query],
            ["review_content_gap", counts.review_content_gap],
            ["verify_own_coverage", counts.verify_own_coverage],
          ] as const
        ).map(([value, count]) => (
          <button
            key={value}
            type="button"
            data-next-step-filter={value}
            aria-pressed={value === filter}
            onClick={() => changeFilter(value)}
            className={
              value === filter
                ? `${PRIMARY_ACTION_BUTTON} !py-1.5`
                : `${ACTION_BUTTON} !py-1.5`
            }
          >
            {translated(t, `filters.${value}`)} · {number(count, locale)}
          </button>
        ))}
      </div>

      <BandFilters
        rows={laneRows}
        band={band}
        locale={locale}
        onChange={changeBandFilter}
        t={t}
      />

      {noticeLanes.length === 0 ? null : (
        <div
          data-lane-notes
          className="mb-4 flex flex-col gap-2 rounded-[10px] border border-brand-border bg-brand-panel-sunken px-4 py-3"
        >
          {noticeLanes.map((lane) => (
            <div
              key={lane}
              data-lane-note={lane}
              className={`flex flex-wrap items-baseline gap-2 ${TABLE_TEXT} text-text-dark-strong`}
            >
              <span className={BADGE}>{translated(t, `filters.${lane}`)}</span>
              <span>{translated(t, `nextSteps.${lane}`)}</span>
            </div>
          ))}
        </div>
      )}

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
            {visibleRows.map((row) => {
              const queryObserved =
                row.gsc.queryStatus === "observed_strong" ||
                row.gsc.queryStatus === "observed_weak";
              const pageObserved =
                row.gsc.pageStatus === "observed_sufficient" ||
                row.gsc.pageStatus === "observed_partial";
              const queryStatusLabel = translated(
                t,
                `gsc.${row.gsc.queryStatus}`,
              );
              const evidenceBasisLabel =
                row.gsc.evidenceBasis === null
                  ? null
                  : translated(t, `gsc.evidenceBasis.${row.gsc.evidenceBasis}`);
              const actions = rowActions(row, selectedProperty, t);
              return (
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
                    <div
                      data-gsc-status
                      aria-label={
                        evidenceBasisLabel === null
                          ? queryStatusLabel
                          : `${queryStatusLabel} · ${evidenceBasisLabel}`
                      }
                      className={`inline-flex rounded-full border px-2.5 py-1 ${META_TEXT} ${statusTone(row.gsc.queryStatus)}`}
                    >
                      {queryStatusLabel}
                    </div>
                    {row.gsc.evidenceBasis === "query_page" ? (
                      <div
                        className={`mt-2 ${META_TEXT} text-text-dark-secondary`}
                      >
                        {evidenceBasisLabel}
                      </div>
                    ) : null}
                    {row.gsc.queryImpressions !== null &&
                    row.gsc.queryPosition !== null ? (
                      <div
                        data-gsc-metrics="query"
                        className={`mt-2 ${TABLE_TEXT} text-text-dark-primary`}
                      >
                        {t("gsc.metricLine", {
                          impressions: number(row.gsc.queryImpressions, locale),
                          position: number(row.gsc.queryPosition, locale, 1),
                        })}
                      </div>
                    ) : null}
                    {pageObserved || queryObserved ? (
                      <div
                        className={`mt-2 ${META_TEXT} text-text-dark-secondary`}
                      >
                        {translated(t, `gsc.pageStatus.${row.gsc.pageStatus}`)}
                        {pageObserved && pagePath(row.gsc.pageUrl)
                          ? ` · ${pagePath(row.gsc.pageUrl)}`
                          : ""}
                      </div>
                    ) : null}
                    {row.gsc.evidenceBasis === "query_page" &&
                    row.gsc.pageImpressions !== null &&
                    row.gsc.pagePosition !== null ? (
                      <div
                        data-gsc-metrics="query-page"
                        className={`mt-1 ${META_TEXT} text-text-dark-secondary`}
                      >
                        {t("gsc.pageMetricLine", {
                          impressions: number(row.gsc.pageImpressions, locale),
                          position: number(row.gsc.pagePosition, locale, 1),
                        })}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-4">
                    <SignalChips row={row} locale={locale} t={t} />
                  </td>
                  <td className="px-3 py-4">
                    <div className="flex flex-col items-start gap-2">
                      {[actions.primary, actions.secondary].map((action) =>
                        action === null ? null : action.kind === "checker" ? (
                          <a
                            key={action.kind}
                            data-row-action="open-checker"
                            href={localePath(locale, "/tools/on-page-seo-check")}
                            title={pagePath(row.gsc.pageUrl) ?? undefined}
                            className={PRIMARY_ACTION_BUTTON}
                            onClick={(event) =>
                              prepareCheckerHandoff(event, row, action.page)
                            }
                          >
                            {action.label}
                          </a>
                        ) : action.kind === "page" ? (
                          <a
                            key={action.kind}
                            data-row-action="open-observed-page"
                            href={action.page}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={pagePath(row.gsc.pageUrl) ?? undefined}
                            className={ACTION_BUTTON}
                            onClick={() => setActionError(null)}
                          >
                            {action.label}
                          </a>
                        ) : action.kind === "competitor" ? (
                          <a
                            key={action.kind}
                            data-row-action="open-competitor-page"
                            href={action.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={ACTION_BUTTON}
                            onClick={() => setActionError(null)}
                          >
                            {action.label}
                          </a>
                        ) : action.kind === "copy" ? (
                          <button
                            key={action.kind}
                            type="button"
                            data-row-action="copy-keyword"
                            className={ACTION_BUTTON}
                            onClick={() => void copyKeyword(row.keyword)}
                          >
                            {action.label}
                          </button>
                        ) : (
                          <button
                            key={action.kind}
                            type="button"
                            data-row-action="focus-property"
                            className={ACTION_BUTTON}
                            onClick={focusProperty}
                          >
                            {action.label}
                          </button>
                        ),
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
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

      {filteredRows.length > 10 ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-[12.5px] text-text-dark-secondary">
            {expanded
              ? t("actions.showingAll", { count: filteredRows.length })
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
      <section
        data-source-legend
        className={`${CARD} flex flex-wrap items-center gap-2`}
      >
        <SourceBadge source="dfs" status={dfsStatus(result)} t={t} />
        <SourceBadge source="gsc" status={result.overlayStatus} t={t} />
        <div className="text-[12px] leading-[1.6] text-text-dark-secondary">
          {t("legend.ownState")}
        </div>
      </section>

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
