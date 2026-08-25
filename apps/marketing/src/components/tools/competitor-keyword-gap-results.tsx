// @input  -- one v2 competitor gap envelope, selected GSC property, and focus callback
// @output -- compact DFS/GSC evidence table with private, qualified next actions
// @pos    -- non-persistent result surface for the Marketing competitor gap tool

"use client";

import { useState, type MouseEvent as ReactMouseEvent } from "react";
import { useTranslations } from "next-intl";
import type {
  CompetitorKeywordGapEnvelope,
  CompetitorKeywordGapMetric,
  CompetitorKeywordGapResultV2,
  CompetitorKeywordGapRow,
} from "@sf/public-tools/competitor-keyword-gap";

import { localePath } from "../../lib/locale-path";
import { writeToolHandoff } from "../../lib/tools/tool-handoff";

const CARD =
  "rounded-card border border-brand-border-card bg-brand-panel p-[22px] md:p-[26px]";
const BADGE =
  "inline-flex items-center rounded-full border border-brand-border-strong bg-brand-panel-sunken px-2.5 py-1 font-mono text-[10px] tracking-[0.05em] text-text-dark-secondary uppercase";
const TABLE_TEXT = "text-[13px] leading-[1.45]";
const META_TEXT = "text-[12px] leading-[1.35]";
const KEYWORD_TEXT = "text-[15.5px] font-semibold leading-[1.25] text-text-dark-primary";
const CHIP_TEXT =
  "inline-flex items-center rounded-full border border-brand-border-strong bg-brand-panel-sunken px-2 py-1 font-mono text-[11px] leading-none text-text-dark-primary";
const ACTION_BUTTON =
  "inline-flex items-center rounded-[10px] border border-brand-border-strong px-3 py-2 text-[12px] font-medium text-text-dark-primary transition hover:border-brand-accent-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent";
const PRIMARY_ACTION_BUTTON =
  "inline-flex items-center rounded-[10px] bg-brand-accent px-3 py-2 text-[12px] font-semibold text-brand-on-accent transition hover:opacity-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent";

type Translate = ReturnType<
  typeof useTranslations<"tools.competitorKeywordGap">
>;

type Filter = "all" | CompetitorKeywordGapRow["gsc"]["nextStep"];

function translated(t: Translate, key: string): string {
  return t(key as Parameters<typeof t>[0]);
}

function number(
  value: number,
  locale: string,
  maximumFractionDigits = 0,
): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits,
    useGrouping: true,
  }).format(value);
}

function capturedTime(value: string, locale: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function safePageUrl(value: string | null): string | null {
  if (value === null) return null;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === ""
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function pagePath(value: string | null): string | null {
  const page = safePageUrl(value);
  if (page === null) return null;
  const url = new URL(page);
  return `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`;
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

function dfsStatus(result: CompetitorKeywordGapResultV2) {
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
            {translated(t, `status.${status}`)} · {translated(t, `status.${status}Body`)}
          </div>
          <div className="mt-1 text-[12px] text-text-dark-secondary">
            {t("summary.competitors", {
              completed: result.completedCompetitors,
              requested: result.requestedCompetitors,
            })}{" "}
            · {t("summary.unavailable", { count: result.unavailableCompetitors })}
          </div>
        </div>
      </div>
      <div
        data-scope-strip
        className="mt-5 flex flex-wrap items-center gap-2 border-t border-brand-border-card pt-4"
      >
        <span className={BADGE}>{result.siteDomain}</span>
        <span data-scope-versus className="font-mono text-[11px] text-text-dark-secondary">
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
          <time dateTime={result.capturedAt}>{capturedTime(result.capturedAt, locale)}</time>
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
  readonly result: CompetitorKeywordGapResultV2;
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
  const cards = [
    {
      metric: "returned-gap-rows",
      label: t("overview.returnedGapRows"),
      value: number(result.rows.length, locale),
      body: t("overview.returnedGapRowsBody"),
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
    {
      metric: "gsc-observed-rows",
      label: t("overview.gscObservedRows"),
      value: observedRows === null ? "—" : number(observedRows, locale),
      body:
        observedRows === null
          ? t(`sources.status.${result.overlayStatus}`)
          : t("overview.gscObservedRowsBody"),
    },
  ] as const;

  return (
    <section data-overview-metrics className="grid gap-4 md:grid-cols-3">
      {cards.map((card) => (
        <article key={card.metric} data-summary-metric={card.metric} className={CARD}>
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

function CoverageCards({
  result,
  locale,
  t,
}: {
  readonly result: CompetitorKeywordGapResultV2;
  readonly locale: string;
  readonly t: Translate;
}) {
  return (
    <section className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[16px] font-semibold text-text-dark-primary">
            {t("coverage.title")}
          </h3>
          <div className="mt-1 text-[12.5px] leading-[1.6] text-text-dark-secondary">
            {t("coverage.scope", {
              completed: result.completedCompetitors,
              requested: result.requestedCompetitors,
            })}
          </div>
        </div>
        <span className={BADGE}>{t("coverage.requested", { count: result.requestedCompetitors })}</span>
      </div>
      <ul className="mt-4 grid gap-3 xl:grid-cols-2">
        {result.competitors.map((competitor) => (
          <li
            key={competitor.domain}
            data-competitor-status={competitor.status}
            className="rounded-[10px] border border-brand-border-card bg-brand-bg p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-[12px] text-text-dark-primary">
                {competitor.domain}
              </span>
              <span className={BADGE}>{translated(t, `coverage.${competitor.status}`)}</span>
            </div>
            <div className="mt-2 text-[12px] text-text-dark-secondary">
              {t("coverage.rows", {
                returned: number(competitor.returnedRows, locale),
                total:
                  competitor.totalCount === null
                    ? "—"
                    : number(competitor.totalCount, locale),
              })}
            </div>
            {competitor.failureCode !== null ? (
              <div className="mt-1 text-[11.5px] text-text-dark-secondary">
                {t("coverage.failure", { code: competitor.failureCode })}
              </div>
            ) : null}
            {competitor.truncated ? (
              <div className="mt-1.5 text-[12px] text-brand-warning">
                {t("coverage.truncated")}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Limitations({
  result,
  t,
}: {
  readonly result: CompetitorKeywordGapResultV2;
  readonly t: Translate;
}) {
  const items = [
    ...(result.resultTruncated ? ["limitations.resultTruncated"] : []),
    ...(result.gscQueryTruncated ? ["limitations.gscQueryTruncated"] : []),
    ...(result.gscQueryPageTruncated ? ["limitations.gscQueryPageTruncated"] : []),
    ...(result.overlayStatus === "unavailable" ? ["limitations.gscUnavailable"] : []),
  ];
  if (items.length === 0) return null;
  return (
    <section className="rounded-card border border-brand-warning/30 bg-brand-warning/[0.08] p-[22px]">
      <h3 className="text-[15px] font-semibold text-text-dark-primary">{t("limitations.title")}</h3>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-[12.5px] leading-[1.6] text-text-dark-secondary">
        {items.map((key) => (
          <li key={key}>{translated(t, key)}</li>
        ))}
      </ul>
    </section>
  );
}

function CoverageDetails({
  envelope,
  locale,
  t,
}: {
  readonly envelope: CompetitorKeywordGapEnvelope;
  readonly locale: string;
  readonly t: Translate;
}) {
  const { result } = envelope;
  const hasWarning =
    envelope.run.status !== "complete" ||
    result.resultTruncated ||
    result.gscQueryTruncated ||
    result.gscQueryPageTruncated ||
    result.overlayStatus === "partial" ||
    result.overlayStatus === "unavailable" ||
    result.competitors.some(
      (competitor) => competitor.status === "unavailable" || competitor.truncated,
    );

  return (
    <details data-coverage-details open={hasWarning} className={CARD}>
      <summary className="cursor-pointer text-[15px] font-semibold text-text-dark-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent">
        {t("coverage.detailsSummary")}
      </summary>
      <div className="mt-4 space-y-4">
        <CoverageCards result={result} locale={locale} t={t} />
        <Limitations result={result} t={t} />
      </div>
    </details>
  );
}

function EvidenceBoundaries({ t }: { readonly t: Translate }) {
  return (
    <section data-evidence-boundaries className={CARD}>
      <h3 className="text-[15px] font-semibold text-text-dark-primary">
        {t("boundaries.title")}
      </h3>
      <ul className="mt-3 grid gap-2 text-[12.5px] leading-[1.6] text-text-dark-secondary md:grid-cols-2">
        {[
          "dfsEstimates",
          "gscOwnSample",
          "competitorOutcomesUnavailable",
          "manualSnapshot",
        ].map((key) => (
          <li key={key} className="rounded-[10px] bg-brand-bg px-4 py-3">
            {translated(t, `boundaries.${key}`)}
          </li>
        ))}
      </ul>
    </section>
  );
}

function statusTone(status: CompetitorKeywordGapRow["gsc"]["queryStatus"]): string {
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

function actionLabelKey(row: CompetitorKeywordGapRow, selectedProperty: string): string {
  if (row.gsc.nextStep === "review_content_gap") return "actions.copyKeyword";
  if (row.gsc.nextStep === "verify_own_coverage") {
    return "actions.focusProperty";
  }
  if (selectedProperty === "") return "actions.openObservedPage";
  if (row.gsc.pageStatus === "observed_sufficient") {
    return "actions.openChecker";
  }
  return "actions.openObservedPage";
}

function ResultsTable({
  result,
  locale,
  selectedProperty,
  onFocusProperty,
  t,
}: {
  readonly result: CompetitorKeywordGapResultV2;
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
  const [expanded, setExpanded] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const filteredRows =
    filter === "all"
      ? result.rows
      : result.rows.filter((row) => row.gsc.nextStep === filter);
  const visibleRows = expanded ? filteredRows : filteredRows.slice(0, 10);
  const remaining = Math.max(0, filteredRows.length - visibleRows.length);

  function changeFilter(next: Filter): void {
    setFilter(next);
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
          <h3 id="competitor-keyword-gap-table-title" className="text-[16px] font-semibold text-text-dark-primary">
            {t("table.title")}
          </h3>
          <div className="mt-1 text-[12.5px] leading-[1.6] text-text-dark-secondary">
            {t("table.subtitle")}
          </div>
        </div>
        <div className="text-[12px] text-text-dark-secondary">{t("table.legend")}</div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2" data-next-step-filters>
        {([
          ["all", counts.all],
          ["optimize_existing", counts.optimize_existing],
          ["review_existing_query", counts.review_existing_query],
          ["review_content_gap", counts.review_content_gap],
          ["verify_own_coverage", counts.verify_own_coverage],
        ] as const).map(([value, count]) => (
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

      <div
        tabIndex={0}
        aria-labelledby="competitor-keyword-gap-table-title"
        className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
      >
        <table className={`min-w-[1080px] w-full border-collapse text-left ${TABLE_TEXT}`}>
          <caption className="sr-only">{t("table.caption")}</caption>
          <thead>
            <tr className="border-b border-brand-border-strong">
              {[
                "keyword",
                "monthlySearchVolume",
                "competitorCoverage",
                "yourStatus",
                "opportunitySignals",
                "nextCheck",
              ].map((column) => (
                <th
                  key={column}
                  scope="col"
                  className="px-3 py-3 font-mono text-[11px] tracking-[0.07em] uppercase text-text-dark-secondary"
                >
                  {translated(t, `table.${column}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const page = safePageUrl(row.gsc.pageUrl);
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
              const canOpenChecker =
                page !== null &&
                selectedProperty !== "" &&
                row.gsc.pageStatus === "observed_sufficient";
              const canOpenPage = page !== null;
              return (
                <tr key={row.keyword} className="border-b border-brand-border-card align-top last:border-0">
                  <td className="px-3 py-4">
                    <div
                      data-keyword
                      className={`${KEYWORD_TEXT} break-words [overflow-wrap:anywhere]`}
                    >
                      {row.keyword}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className={CHIP_TEXT}>{providerIntent(row.providerIntent, t)}</span>
                    </div>
                  </td>
                  <td className="px-3 py-4">
                    <div
                      data-monthly-volume
                      className={`${TABLE_TEXT} font-semibold tabular-nums text-text-dark-primary`}
                    >
                      {metric(row.searchVolume, locale)}
                    </div>
                  </td>
                  <td className="px-3 py-4">
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(row.competitorRanks)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([domain, rank]) => (
                          <span
                            key={domain}
                            data-competitor-rank={domain}
                            className={`${CHIP_TEXT} max-w-[240px] break-all`}
                          >
                            {domain} #{rank}
                          </span>
                        ))}
                    </div>
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
                      <div className={`mt-2 ${META_TEXT} text-text-dark-secondary`}>
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
                      <div className={`mt-2 ${META_TEXT} text-text-dark-secondary`}>
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
                    <div className={`flex flex-wrap gap-2 ${META_TEXT}`}>
                      <span className={CHIP_TEXT}>
                        {t("signals.bestRank", { rank: row.bestCompetitorRank })}
                      </span>
                      <span className={CHIP_TEXT}>
                        {t("signals.difficulty", {
                          value:
                            row.keywordDifficulty.value === null
                              ? "—"
                              : number(row.keywordDifficulty.value, locale),
                        })}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-4">
                    <div data-next-step-copy className={`${TABLE_TEXT} text-text-dark-primary`}>
                      {translated(t, `nextSteps.${row.gsc.nextStep}`)}
                    </div>
                    <div className="mt-3">
                      {row.gsc.nextStep === "review_content_gap" ? (
                        <button
                          type="button"
                          data-row-action="copy-keyword"
                          className={ACTION_BUTTON}
                          onClick={() => void copyKeyword(row.keyword)}
                        >
                          {translated(t, actionLabelKey(row, selectedProperty))}
                        </button>
                      ) : row.gsc.nextStep === "verify_own_coverage" ? (
                        <button
                          type="button"
                          data-row-action="focus-property"
                          className={ACTION_BUTTON}
                          onClick={focusProperty}
                        >
                          {translated(t, actionLabelKey(row, selectedProperty))}
                        </button>
                      ) : canOpenChecker && page !== null ? (
                        <a
                          data-row-action="open-checker"
                          href={localePath(locale, "/tools/on-page-seo-check")}
                          className={PRIMARY_ACTION_BUTTON}
                          onClick={(event) =>
                            prepareCheckerHandoff(event, row, page)
                          }
                        >
                          {translated(t, actionLabelKey(row, selectedProperty))}
                        </a>
                      ) : canOpenPage && page !== null ? (
                        <a
                          data-row-action="open-observed-page"
                          href={page}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={ACTION_BUTTON}
                          onClick={() => setActionError(null)}
                        >
                          {translated(t, actionLabelKey(row, selectedProperty))}
                        </a>
                      ) : null}
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
      <section data-source-legend className={`${CARD} flex flex-wrap items-center gap-2`}>
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
          <h3 className="text-[16px] font-semibold text-text-dark-primary">{t("empty.title")}</h3>
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
