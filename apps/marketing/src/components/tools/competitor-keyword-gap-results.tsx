// @input  -- one versioned competitor keyword gap envelope and locale
// @output -- honest DFS/GSC coverage, gap rows, limitations, and next-step actions
// @pos    -- read-only results surface for the Marketing competitor keyword gap tool

"use client";

import { useTranslations } from "next-intl";
import type {
  CompetitorKeywordGapEnvelope,
  CompetitorKeywordGapMetric,
  CompetitorKeywordGapResultV1,
  CompetitorKeywordGapRow,
} from "@sf/public-tools/competitor-keyword-gap";

const CARD =
  "rounded-card border border-brand-border-card bg-brand-panel p-[22px] md:p-[26px]";
const BADGE =
  "inline-flex items-center rounded-full border border-brand-border-strong bg-brand-panel-sunken px-2.5 py-1 font-mono text-[10px] tracking-[0.05em] text-text-dark-secondary uppercase";
const CANONICAL_PROVIDER_INTENTS = new Set([
  "informational",
  "navigational",
  "commercial",
  "transactional",
]);

type Translate = ReturnType<
  typeof useTranslations<"tools.competitorKeywordGap">
>;

function translated(t: Translate, key: string): string {
  return t(key as Parameters<typeof t>[0]);
}

function number(
  value: number,
  locale: string,
  maximumFractionDigits = 0,
): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits }).format(
    value,
  );
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

function providerIntent(value: string | null, t: Translate): string {
  const normalized = value?.trim() ?? "";
  if (normalized === "") return "—";
  if (CANONICAL_PROVIDER_INTENTS.has(normalized)) {
    return translated(t, `intent.${normalized}`);
  }
  return normalized.slice(0, 64);
}

function metric(
  value: CompetitorKeywordGapMetric,
  locale: string,
  maximumFractionDigits = 0,
) {
  if (value.value === null || value.availability === "provider_no_data") {
    return (
      <span data-metric-availability="provider_no_data" aria-label="unavailable">
        —
      </span>
    );
  }
  return (
    <span data-metric-availability={value.availability}>
      {number(value.value, locale, maximumFractionDigits)}
    </span>
  );
}

function dfsStatus(result: CompetitorKeywordGapResultV1) {
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
          <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
            {t("summary.eyebrow")}
          </p>
          <h3 className="mt-3 text-[20px] font-semibold tracking-[-0.03em] text-text-dark-primary">
            {t("summary.title")}
          </h3>
          <p className="mt-2 text-[12.5px] leading-[1.6] text-text-dark-secondary">
            {translated(t, `status.${status}`)} · {translated(t, `status.${status}Body`)}
          </p>
          <p className="mt-1 text-[12px] text-text-dark-secondary">
            {t("summary.competitors", {
              completed: result.completedCompetitors,
              requested: result.requestedCompetitors,
            })}{" "}
            · {t("summary.unavailable", { count: result.unavailableCompetitors })}
          </p>
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
          <span key={domain} className={BADGE}>{domain}</span>
        ))}
        <span className={BADGE}>{result.marketCode} · {result.languageCode}</span>
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
  readonly result: CompetitorKeywordGapResultV1;
  readonly locale: string;
  readonly t: Translate;
}) {
  const gscObservedRows = result.rows.filter(
    (row) =>
      row.gsc.queryStatus === "observed_strong" ||
      row.gsc.queryStatus === "observed_weak",
  ).length;
  const gscMetricAvailable =
    result.overlayStatus !== "not_requested" &&
    result.overlayStatus !== "unavailable";
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
      value: `${number(result.completedCompetitors, locale)} / ${number(result.requestedCompetitors, locale)}`,
      body: t("overview.completedCompetitorsBody"),
    },
    {
      metric: "gsc-observed-rows",
      label: t("overview.gscObservedRows"),
      value: gscMetricAvailable ? number(gscObservedRows, locale) : "—",
      body: gscMetricAvailable
        ? t("overview.gscObservedRowsBody")
        : translated(t, `sources.status.${result.overlayStatus}`),
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
          <p className="font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase">
            {card.label}
          </p>
          <p className="mt-3 text-[34px] font-semibold tracking-[-0.04em] text-text-dark-primary">
            {card.value}
          </p>
          <p className="mt-2 text-[12.5px] leading-[1.6] text-text-dark-secondary">
            {card.body}
          </p>
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
  readonly result: CompetitorKeywordGapResultV1;
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
          <p className="mt-1 text-[12.5px] leading-[1.6] text-text-dark-secondary">
            {t("coverage.scope", {
              completed: result.completedCompetitors,
              requested: result.requestedCompetitors,
            })}
          </p>
        </div>
        <span className={BADGE}>
          {t("coverage.requested", { count: result.requestedCompetitors })}
        </span>
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
              <span className={BADGE}>
                {translated(t, `coverage.${competitor.status}`)}
              </span>
            </div>
            <p className="mt-2 text-[12px] text-text-dark-secondary">
              {t("coverage.rows", {
                returned: number(competitor.returnedRows, locale),
                total:
                  competitor.totalCount === null
                    ? "—"
                    : number(competitor.totalCount, locale),
              })}
            </p>
            {competitor.failureCode !== null ? (
              <p className="mt-1 text-[11.5px] text-text-dark-secondary">
                {t("coverage.failure", { code: competitor.failureCode })}
              </p>
            ) : null}
            {competitor.truncated ? (
              <p className="mt-1.5 text-[12px] text-brand-warning">
                {t("coverage.truncated")}
              </p>
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
  readonly result: CompetitorKeywordGapResultV1;
  readonly t: Translate;
}) {
  const items = [
    ...(result.resultTruncated ? ["limitations.resultTruncated"] : []),
    ...(result.gscQueryTruncated ? ["limitations.gscQueryTruncated"] : []),
    ...(result.gscQueryPageTruncated
      ? ["limitations.gscQueryPageTruncated"]
      : []),
    ...(result.overlayStatus === "unavailable"
      ? ["limitations.gscUnavailable"]
      : []),
  ];
  if (items.length === 0) return null;
  return (
    <section className="rounded-card border border-brand-warning/30 bg-brand-warning/[0.08] p-[22px]">
      <h3 className="text-[15px] font-semibold text-text-dark-primary">
        {t("limitations.title")}
      </h3>
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
      (competitor) =>
        competitor.status === "unavailable" || competitor.truncated,
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

function SearchSnapshot({
  row,
  locale,
  t,
}: {
  readonly row: CompetitorKeywordGapRow;
  readonly locale: string;
  readonly t: Translate;
}) {
  return (
    <div className="space-y-1.5 text-[12px]">
      <p className="text-text-dark-secondary">
        {t("metrics.searchVolume")}: {metric(row.searchVolume, locale)}
      </p>
      <p className="text-text-dark-secondary">
        {t("metrics.cpc")}: {metric(row.cpc, locale, 2)}
      </p>
      <p className="text-text-dark-secondary">
        {t("metrics.difficulty")}: {metric(row.keywordDifficulty, locale)}
      </p>
    </div>
  );
}

function GscEvidence({
  row,
  locale,
  t,
}: {
  readonly row: CompetitorKeywordGapRow;
  readonly locale: string;
  readonly t: Translate;
}) {
  const page = safePageUrl(row.gsc.pageUrl);
  return (
    <div className="space-y-1.5 text-[12px]">
      <span className={BADGE}>{translated(t, `gsc.${row.gsc.queryStatus}`)}</span>
      <p className="text-text-dark-secondary">
        {translated(t, `ownState.${row.ownState}`)}
      </p>
      <p className="text-text-dark-secondary">
        {t("gsc.impressions")}: {row.gsc.queryImpressions === null
          ? "—"
          : number(row.gsc.queryImpressions, locale)}
      </p>
      <p className="text-text-dark-secondary">
        {t("gsc.position")}: {row.gsc.queryPosition === null
          ? "—"
          : number(row.gsc.queryPosition, locale, 1)}
      </p>
      {page !== null ? (
        <a
          href={page}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 break-all text-brand-accent-text underline underline-offset-2"
        >
          {t("gsc.page")}
        </a>
      ) : null}
    </div>
  );
}

function RecommendationCell({
  row,
  t,
}: {
  readonly row: CompetitorKeywordGapRow;
  readonly t: Translate;
}) {
  return (
    <p data-recommendation className="max-w-[26ch] text-[12px] leading-[1.6] text-text-dark-secondary">
      {translated(t, `nextSteps.${row.gsc.nextStep}`)}
    </p>
  );
}

function TableLegend({
  result,
  t,
}: {
  readonly result: CompetitorKeywordGapResultV1;
  readonly t: Translate;
}) {
  return (
    <section data-source-legend className={`${CARD} flex flex-wrap items-center gap-2`}>
      <SourceBadge source="dfs" status={dfsStatus(result)} t={t} />
      <SourceBadge source="gsc" status={result.overlayStatus} t={t} />
      <p className="text-[12px] leading-[1.6] text-text-dark-secondary">
        {t("table.legend")}
      </p>
    </section>
  );
}

function ResultsTable({
  result,
  locale,
  t,
}: {
  readonly result: CompetitorKeywordGapResultV1;
  readonly locale: string;
  readonly t: Translate;
}) {
  return (
    <section className={CARD}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3
            id="competitor-keyword-gap-table-title"
            className="text-[16px] font-semibold text-text-dark-primary"
          >
            {t("table.title")}
          </h3>
          <p className="mt-1 text-[12.5px] leading-[1.6] text-text-dark-secondary">
            {t("table.subtitle")}
          </p>
        </div>
      </div>
      <div
        tabIndex={0}
        aria-labelledby="competitor-keyword-gap-table-title"
        className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
      >
        <table className="min-w-[760px] w-full border-collapse text-left text-[12.5px]">
          <caption className="sr-only">{t("table.caption")}</caption>
          <thead>
            <tr className="border-b border-brand-border-strong text-text-dark-secondary">
              {[
                "keyword",
                "dfsEstimates",
                "competitorRanks",
                "ownSiteGsc",
                "recommendation",
              ].map((column) => (
                <th
                  key={column}
                  scope="col"
                  className="px-3 py-3 font-mono text-[10px] tracking-[0.07em] uppercase"
                >
                  {translated(t, `table.${column}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <tr
                key={row.keyword}
                className="border-b border-brand-border-card align-top last:border-0"
              >
                <td className="px-3 py-4">
                  <p className="font-medium text-text-dark-primary">
                    {row.keyword}
                  </p>
                  <p className="mt-1 text-[11px] text-text-dark-secondary">
                    {t("competitors.snapshot", {
                      count: row.competitorCount,
                      bestRank: row.bestCompetitorRank,
                    })}
                  </p>
                  <p className="mt-2 text-[11px] text-text-dark-secondary">
                    {t("metrics.intent")}: {providerIntent(row.providerIntent, t)}
                  </p>
                </td>
                <td className="px-3 py-4">
                  <SearchSnapshot row={row} locale={locale} t={t} />
                </td>
                <td className="px-3 py-4">
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(row.competitorRanks)
                      .toSorted(([a], [b]) => a.localeCompare(b))
                      .map(([domain, rank]) => (
                        <span
                          key={domain}
                          data-competitor-rank={domain}
                          className="rounded-full border border-brand-border-strong bg-brand-panel-sunken px-2 py-1 font-mono text-[10.5px] text-text-dark-primary"
                        >
                          {domain} #{rank}
                        </span>
                      ))}
                  </div>
                </td>
                <td className="px-3 py-4">
                  <GscEvidence row={row} locale={locale} t={t} />
                </td>
                <td className="px-3 py-4">
                  <RecommendationCell row={row} t={t} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function CompetitorKeywordGapResults({
  envelope,
  locale,
}: {
  readonly envelope: CompetitorKeywordGapEnvelope;
  readonly locale: string;
}) {
  const t = useTranslations("tools.competitorKeywordGap");
  const { result } = envelope;

  return (
    <div className="mt-8 space-y-4">
      <ReportContext envelope={envelope} locale={locale} t={t} />
      <OverviewCards result={result} locale={locale} t={t} />
      <TableLegend result={result} t={t} />

      {result.rows.length > 0 ? (
        <ResultsTable result={result} locale={locale} t={t} />
      ) : envelope.run.status !== "unavailable" ? (
        <section className={CARD}>
          <h3 className="text-[16px] font-semibold text-text-dark-primary">
            {t("empty.title")}
          </h3>
          <p className="mt-2 text-[12.5px] leading-[1.6] text-text-dark-secondary">
            {t("empty.body")}
          </p>
        </section>
      ) : null}
      <CoverageDetails envelope={envelope} locale={locale} t={t} />
      <EvidenceBoundaries t={t} />
    </div>
  );
}
